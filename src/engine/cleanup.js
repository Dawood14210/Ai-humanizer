// cleanup.js — final-pass tidy-up for the Plainwrite engine.
//
// ARCHITECTURE (important — read before editing)
// ---------------------------------------------
// Every transform is a pure "edit finder": it scans the ORIGINAL segment text
// and returns a list of edits {start, end, original, replacement, rule}. No
// transform ever sees another transform's output, so positions can never drift
// between passes.
//
// All edits for a segment are then fed to a single helper, applyEdits(), which:
//   1. sorts by start,
//   2. drops overlaps by priority,
//   3. applies them in ONE left-to-right pass,
//   4. reports change records whose start/end are OUTPUT-relative, computed
//      from a running length delta, plus input-relative inputStart/inputEnd.
//
// The one exception is the curly-quote pre-pass, which is length-preserving
// (one curly char → one ASCII char) and therefore records changes at the very
// same indices it found them; it shifts nothing. Because it is length
// preserving, working-text indices stay identical to input indices.
//
// Protected spans are split out first and copied through verbatim.
//
// Stage options (ctx.options):
//   • replaceDashes   (default true)  em dash → ", " when it joins two clauses,
//                                     " - " otherwise. Set false to keep them.
//   • formal          (default false) strip emojis outside protected spans.
//   • removeFormatting (default false) strip Markdown bold/italic markers.
//
// Signature: (text, ctx) => { text, changes }

import { findProtectedSpans, forceImmutableProtection, overlapsProtectedSpans } from './protected.js'
import { applyEdits, mapIndex, splitByProtected } from './edits.js'

// ---------- character maps -----------------------------------------------

// Length-PRESERVING pre-pass: every key maps to exactly one ASCII character.
const CURLY_QUOTES = {
  '\u201C': '"', // “  left double quotation mark
  '\u201D': '"', // ”  right double quotation mark
  '\u2018': "'", // ‘  left single quotation mark
  '\u2019': "'", // ’  right single quotation mark / apostrophe
  '\u201A': "'", // ‚  single low-9 quote
  '\u201B': "'", // ‛  single high-reversed-9 quote
  '\u201E': '"', // „  double low-9 quote
  '\u201F': '"', // ‟  double high-reversed-9 quote
}

// Length-CHANGING typographic substitutions, emitted as ordinary edits so they
// still respect protected spans. The em dash is NOT here — it has its own
// context-sensitive rule below (see getEmDashEdits).
const TYPOGRAPHY = [
  { from: '\u2013', to: '-' },   // en dash
  { from: '\u2026', to: '...' }, // horizontal ellipsis
]

const EM_DASH = '\u2014'

// Non-breaking space is 1:1 with a normal space, but it competes with the
// horizontal-run collapse rule: for "a\u00A0\u00A0b" we want the COLLAPSE to win
// (one space), while for "a\u00A0b" only the nbsp rule can fire. Giving it a
// lower priority than `whitespace` makes the collapse win whenever it applies.
const NBSP = '\u00A0'

// ---------- shared helpers ----------------------------------------------

// ---------- edit finders -------------------------------------------------
// Each takes the original string and returns edits against it.

/** Chatbot leftovers: delete the whole sentence containing the phrase. */
function getChatbotEdits(str) {
  const OPENER = [
    /^\s*certainly!?/im,
    /^\s*of\s+course!?/im,
    /^\s*absolutely!?/im,
    /^\s*great\s+question!?/im,
    /^\s*good\s+question!?/im,
    /^\s*sure[,.!]?\s*(?:here\s+(?:is|are)|here's)?/im,
    /^\s*here(?:'s|\s+is|\s+are)\b/im,
  ]
  const ANYWHERE = [
    /\bas\s+an\s+ai(?:\s+language\s+model)?\b/i,
    /\bas\s+a\s+language\s+model\b/i,
    /\bi(?:'m|\s+am)\s+an\s+ai\b/i,
    /\bi\s+hope\s+(?:this|that)\s+helps!?/i,
    /\bhope\s+(?:this|that)\s+helps!?/i,
    /\bhope\s+that\s+makes\s+sense!?/i,
  ]
  // Only remove standalone courtesy sign-offs. Phrases such as "Thank you for
  // reviewing my application" and "Thanks to the volunteers" carry user
  // meaning and must not trigger whole-sentence deletion.
  const STANDALONE_SIGNOFF = /^\s*(?:thank\s+you(?:\s+(?:very\s+much|so\s+much|in\s+advance))?|thanks)[!.]?\s*$/i

  // Sentence = body + terminator, with NO trailing whitespace (whitespace gaps
  // are handled explicitly below so we never leave a double space).
  const sentRe = /([^.!?\n]*?)([.!?]+|\n+|$)/g
  const raw = []
  for (const m of str.matchAll(sentRe)) {
    const whole = m[1] + m[2]
    if (whole === '') continue
    const start = m.index
    const end = start + whole.length
    if (/^\s*$/.test(whole)) continue
    const hit = (start === 0 ? OPENER.some(re => re.test(whole)) : false) ||
      OPENER.some(re => re.test(whole)) ||
      ANYWHERE.some(re => re.test(whole)) ||
      STANDALONE_SIGNOFF.test(whole)
    if (!hit) continue

    // The body may carry leading whitespace ("  I hope this helps."); the
    // sentence proper starts after it.
    const lead = /^\s*/.exec(whole)[0].length
    const contentStart = start + lead

    // Also swallow the whitespace gap that separates this sentence from its
    // neighbour, so deleting it leaves no double space. Prefer the gap BEFORE
    // the sentence; if there is none (e.g. it starts the document), take the
    // gap AFTER it.
    let delStart = contentStart
    let delEnd = end
    let i = contentStart
    while (i > 0 && /\s/.test(str[i - 1])) i--
    if (i < contentStart) {
      delStart = i
    } else {
      let j = end
      while (j < str.length && /\s/.test(str[j])) j++
      delEnd = j
    }
    raw.push({ start: delStart, end: delEnd })
  }

  // Merge overlapping / whitespace-separated deletions (e.g. an opener followed
  // by a closer) into one edit so nothing is left behind.
  raw.sort((a, b) => a.start - b.start)
  const merged = []
  for (const e of raw) {
    const prev = merged[merged.length - 1]
    if (prev && (e.start <= prev.end || /^\s*$/.test(str.slice(prev.end, e.start)))) {
      prev.end = Math.max(prev.end, e.end)
      continue
    }
    merged.push({ ...e })
  }

  // A deletion that runs to the document start must not leave the output
  // beginning with whitespace: swallow the gap that follows it too.
  for (const e of merged) {
    if (e.start === 0) {
      let j = e.end
      while (j < str.length && /\s/.test(str[j])) j++
      e.end = j
    }
  }

  return merged.map(e => ({
    start: e.start,
    end: e.end,
    original: str.slice(e.start, e.end),
    replacement: '',
    rule: 'chatbotLeftover',
  }))
}

/** Markdown bold (**x** / __x__) and italic (*x* / _x_): drop the markers. */
function getMarkdownEdits(str) {
  const edits = []
  const bold = /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g
  for (const m of str.matchAll(bold)) {
    const inner = m[1] !== undefined ? m[1] : m[2]
    edits.push({
      start: m.index,
      end: m.index + m[0].length,
      original: m[0],
      replacement: inner,
      rule: 'markdownBold',
    })
  }
  const ital = /(^|[\s(\[])\*([^*\n]+?)\*(?=[\s)\].,!?;:]|$)|(^|[\s(\[])_([^_\n]+?)_(?=[\s)\].,!?;:]|$)/g
  for (const m of str.matchAll(ital)) {
    let prefix, inner
    if (m[2] !== undefined) { prefix = m[1]; inner = m[2] }
    else { prefix = m[3]; inner = m[4] }
    edits.push({
      start: m.index,
      end: m.index + m[0].length,
      original: m[0],
      replacement: prefix + inner,
      rule: 'markdownItalic',
    })
  }
  return edits
}

const HSPACE = /[ \t\u00A0]/

/** Emojis (formal mode only). Deleting one must not leave a stray space. */
function getEmojiEdits(str) {
  const edits = []
  const re = /\p{Extended_Pictographic}/gu
  for (const m of str.matchAll(re)) {
    let start = m.index
    let end = m.index + m[0].length
    const nextIsSpace = end < str.length && HSPACE.test(str[end])
    const prevIsSpace = start > 0 && HSPACE.test(str[start - 1])
    if (nextIsSpace) {
      // Consume the horizontal space run that follows, so "a 👋 b" → "a b".
      while (end < str.length && HSPACE.test(str[end])) end++
    } else if (prevIsSpace) {
      // Otherwise take the preceding run, so "a 👋" → "a".
      while (start > 0 && HSPACE.test(str[start - 1])) start--
    }
    edits.push({
      start,
      end,
      original: str.slice(start, end),
      replacement: '',
      rule: 'emoji',
    })
  }
  return edits
}

/**
 * Em dash → ", " when it joins two clauses, " - " otherwise.
 *
 * "Joining two clauses" means the dash is tightly attached to visible text on
 * both sides ("word—word"), the classic parenthetical / appositive em dash.
 * Any other placement — spaced out ("word — word"), at a line break, or at the
 * very start/end of the text — gets " - ".
 *
 * The edit swallows the horizontal whitespace hugging the dash so the
 * replacement supplies its own spacing; at a line/text boundary the outer space
 * is dropped so we never leave a stray leading or trailing space.
 *
 * Only ranges inside `str` are edited, but classification may look at `full`
 * (the whole document) via `offset`, so a dash sitting right next to a
 * protected span is classified correctly.
 *
 * @param {string} str   the segment text (edits are relative to this)
 * @param {{offset?:number, full?:string}} [ctx]
 */
function getEmDashEdits(str, ctx = {}) {
  const full = ctx.full || str
  const offset = ctx.offset || 0
  const edits = []
  let i = 0
  for (;;) {
    const at = str.indexOf(EM_DASH, i)
    if (at === -1) break
    i = at + 1

    const abs = offset + at
    const charBefore = abs > 0 ? full[abs - 1] : ''
    const charAfter = abs + 1 < full.length ? full[abs + 1] : ''
    const joinsClauses =
      charBefore !== '' && !/\s/.test(charBefore) &&
      charAfter !== '' && !/\s/.test(charAfter)

    if (joinsClauses) {
      edits.push({ start: at, end: at + 1, original: EM_DASH, replacement: ', ', rule: 'emDash' })
      continue
    }

    // Not a clause joiner: absorb the horizontal whitespace hugging the dash
    // (never crossing a newline) and supply our own spacing.
    let start = at
    let end = at + 1
    while (start > 0 && HSPACE.test(str[start - 1])) start--
    while (end < str.length && HSPACE.test(str[end])) end++

    const absStart = offset + start
    const absEnd = offset + end
    const atLineStart = absStart === 0 || full[absStart - 1] === '\n'
    const atLineEnd = absEnd >= full.length || full[absEnd] === '\n'

    let replacement
    if (atLineStart && atLineEnd) replacement = '-'
    else if (atLineStart) replacement = '- '
    else if (atLineEnd) replacement = ' -'
    else replacement = ' - '

    edits.push({ start, end, original: str.slice(start, end), replacement, rule: 'emDash' })
  }
  return edits
}

/** En dash / ellipsis / NBSP → ASCII. */
function getTypographyEdits(str) {
  const edits = []
  for (const { from, to } of TYPOGRAPHY) {
    let i = 0
    for (;;) {
      const at = str.indexOf(from, i)
      if (at === -1) break
      edits.push({ start: at, end: at + from.length, original: from, replacement: to, rule: 'typography' })
      i = at + from.length
    }
  }
  // Non-breaking space (lower priority than the run collapse — see NBSP above).
  let j = 0
  for (;;) {
    const at = str.indexOf(NBSP, j)
    if (at === -1) break
    edits.push({ start: at, end: at + NBSP.length, original: NBSP, replacement: ' ', rule: 'nbsp' })
    j = at + NBSP.length
  }
  return edits
}

/** Collapse repeated punctuation. Leaves exactly "..." alone. */
function getPunctuationEdits(str) {
  const edits = []
  const re = /(\.{4,})|(!)\2+|(\?)\3+|([.!?]*[!?][.!?]*){2,}/g
  for (const m of str.matchAll(re)) {
    const original = m[0]
    let replacement
    if (m[1]) replacement = '...'
    else if (m[2]) replacement = '!'
    else if (m[3]) replacement = '?'
    else replacement = original[original.length - 1]
    if (original === replacement) continue
    edits.push({
      start: m.index,
      end: m.index + original.length,
      original,
      replacement,
      rule: 'repeatedPunctuation',
    })
  }
  return edits
}

/**
 * Whitespace normalization and document edge trimming.
 * @param {string} str
 * @param {{docStart?:boolean, docEnd?:boolean}} [opts]
 */
function getWhitespaceEdits(str, opts = {}) {
  const edits = []
  const push = (start, end, original, replacement, rule = 'whitespace') => {
    if (end < start) return
    if (original === replacement && start === end) return
    edits.push({ start, end, original, replacement, rule })
  }

  // Document edges first (higher priority than the generic collapse rules, so
  // they win overlaps and actually remove the run rather than shrink it).
  if (opts.docStart) {
    const m = /^[\s\u00A0]+/.exec(str)
    if (m) push(0, m[0].length, m[0], '', 'trimEdges')
  }
  if (opts.docEnd) {
    const m = /[\s\u00A0]+$/.exec(str)
    if (m) push(str.length - m[0].length, str.length, m[0], '', 'trimEdges')
  }

  // Tabs → single space.
  for (const m of str.matchAll(/\t+/g)) {
    push(m.index, m.index + m[0].length, m[0], ' ')
  }
  // 3+ newlines → paragraph break.
  for (const m of str.matchAll(/\n{3,}/g)) {
    push(m.index, m.index + m[0].length, m[0], '\n\n')
  }
  // Trailing spaces at end of line (before the run collapse, so they win).
  for (const m of str.matchAll(/[ \t\u00A0]+\n/g)) {
    push(m.index, m.index + m[0].length - 1, m[0].slice(0, -1), '')
  }
  // Leading spaces at start of a line.
  for (const m of str.matchAll(/\n[ \t\u00A0]+/g)) {
    push(m.index + 1, m.index + m[0].length, m[0].slice(1), '')
  }
  // Collapse runs of horizontal whitespace to a single space.
  for (const m of str.matchAll(/[ \t\u00A0]{2,}/g)) {
    push(m.index, m.index + m[0].length, m[0], ' ')
  }
  // Space before , . ! ? : ;
  for (const m of str.matchAll(/[ \t\u00A0]+([,.!?:;])/g)) {
    push(m.index, m.index + m[0].length - 1, m[0].slice(0, -1), '')
  }
  // Space just inside brackets: "( x" → "(x", "x )" → "x)".
  for (const m of str.matchAll(/[([][ \t\u00A0]+/g)) {
    push(m.index + 1, m.index + m[0].length, m[0].slice(1), '')
  }
  for (const m of str.matchAll(/[ \t\u00A0]+[)\]]/g)) {
    push(m.index, m.index + m[0].length - 1, m[0].slice(0, -1), '')
  }
  // Missing space after , . ! ? : ; when followed by a letter or "(".
  for (const m of str.matchAll(/([,.!?:;])(?=[A-Za-z(])/g)) {
    // Skip decimal points such as 3.14
    if (m[0] === '.' && m.index > 0 && /\d/.test(str[m.index - 1]) && /\d/.test(str[m.index + 1])) continue
    push(m.index + 1, m.index + 1, '', ' ')
  }
  return edits
}

// ---------- curly-quote pre-pass ----------------------------------------

/**
 * Length-preserving curly→ASCII quote conversion over the whole text.
 * Positions are recorded at the same indices they were found at (no shifting),
 * which is safe because every substitution is exactly 1 char → 1 char.
 */
function applyCurlyQuotes(str, excludedChanges = [], protectedSpans = []) {
  const changes = []
  let out = ''
  let spanIndex = 0
  for (let i = 0; i < str.length; i++) {
    while (spanIndex < protectedSpans.length && protectedSpans[spanIndex].end <= i) spanIndex++
    const ch = str[i]
    const rep = Object.prototype.hasOwnProperty.call(CURLY_QUOTES, ch) ? CURLY_QUOTES[ch] : null
    const span = protectedSpans[spanIndex]
    const inProtectedSpan = Boolean(span && span.start < i + ch.length && span.end > i)
    const excluded = rep !== null && (
      inProtectedSpan
      || excludedChanges.some(change =>
        change.stage === 'cleanup' && change.id === 'curlyQuotes'
        && change.inputStart === i && change.inputEnd === i + ch.length)
    )
    if (rep !== null && !excluded) {
      out += rep
      changes.push({
        original: ch,
        replacement: rep,
        rule: { stage: 'cleanup', id: 'curlyQuotes' },
        start: i,
        end: i + rep.length,
        inputStart: i,
        inputEnd: i + ch.length,
      })
    } else {
      out += ch
    }
  }
  return { text: out, changes }
}

// ---------- stage entry point -------------------------------------------

export function cleanup(text, ctx = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: '', changes: [] }
  }
  const opts = ctx.options || {}
  const protectedWords = Array.isArray(ctx.protectedWords) ? ctx.protectedWords : []
  const protectOpts = { protectedWords, protect: forceImmutableProtection(opts.protect) }
  const originalSpans = findProtectedSpans(text, protectOpts)

  // 1) Normalize curly quotes only outside immutable protected spans. Their
  //    positions stay fixed because every allowed replacement is one char.
  const pre = applyCurlyQuotes(text, ctx.excludedChanges, originalSpans)
  const working = pre.text
  const curly = pre.changes

  // 2) Protected spans on the post-pre-pass text; split into segments.
  const spans = findProtectedSpans(working, protectOpts)
  const segs = splitByProtected(working, spans)

  // 3) Bucket curly-quote changes by the segment they live in.
  const curlyBySeg = new Map()
  for (const c of curly) {
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      if (c.inputStart >= seg.offset && c.inputStart < seg.offset + seg.text.length) {
        if (!curlyBySeg.has(i)) curlyBySeg.set(i, [])
        curlyBySeg.get(i).push(c)
        break
      }
    }
  }

  const allChanges = []
  const copiedMap = []
  let out = ''

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const base = out.length
    const segCurly = curlyBySeg.get(i) || []

    // --- protected segment: copy verbatim ---
    if (seg.protected) {
      if (seg.text.length > 0) copiedMap.push({ inStart: seg.offset, inEnd: seg.offset + seg.text.length, outStart: base })
      for (const c of segCurly) {
        const local = c.inputStart - seg.offset
        allChanges.push({ ...c, start: base + local, end: base + local + c.replacement.length })
      }
      out += seg.text
      continue
    }

    // --- editable segment: every transform reads the ORIGINAL segment text ---
    const isDocStart = seg.offset === 0
    const isDocEnd = seg.offset + seg.text.length === working.length

    const edits = [
      ...getChatbotEdits(seg.text),
      ...(opts.removeFormatting ? getMarkdownEdits(seg.text) : []),
      ...(opts.formal ? getEmojiEdits(seg.text) : []),
      // options.replaceDashes defaults to ON; set it false to keep em dashes.
      ...(opts.replaceDashes !== false
        ? getEmDashEdits(seg.text, { offset: seg.offset, full: working })
        : []),
      ...getTypographyEdits(seg.text),
      ...getPunctuationEdits(seg.text),
      ...getWhitespaceEdits(seg.text, { docStart: isDocStart, docEnd: isDocEnd }),
    ]

    const { text: newSeg, changes: segChanges, copied } = applyEdits(seg.text, edits, 'cleanup', {
      excludedChanges: ctx?.excludedChanges,
      inputOffset: seg.offset,
      outputOffset: base,
    })
    for (const range of copied) {
      copiedMap.push({
        inStart: seg.offset + range.inStart,
        inEnd: seg.offset + range.inEnd,
        outStart: base + range.outStart,
      })
    }

    for (const c of segChanges) {
      allChanges.push({
        original: c.original,
        replacement: c.replacement,
        rule: c.rule,
        start: base + c.start,
        end: base + c.end,
        inputStart: seg.offset + c.inputStart,
        inputEnd: seg.offset + c.inputEnd,
      })
    }

    // Remap the curly-quote pre-pass positions onto the segment output. A curly
    // change whose character was consumed by a later edit is dropped: that
    // edit's replacement already contains the normalized character.
    for (const c of segCurly) {
      const local = c.inputStart - seg.offset
      const mapped = mapIndex(copied, local)
      if (mapped === -1) continue
      allChanges.push({
        original: c.original,
        replacement: c.replacement,
        rule: c.rule,
        start: base + mapped,
        end: base + mapped + c.replacement.length,
        inputStart: c.inputStart,
        inputEnd: c.inputEnd,
      })
    }

    out += newSeg
  }

  // 4) Changes are emitted in a stable, document order (by input position) so a
  //    consumer can replay them left-to-right.
  allChanges.sort((a, b) => (a.inputStart - b.inputStart) || (a.start - b.start))

  // The quote-normalization pre-pass is length-preserving but still rewrites
  // characters. Exclude those source positions from the copied map so changes
  // from earlier stages that cover a quote are marked superseded.
  const curlyPositions = curly.map(change => change.inputStart).sort((a, b) => a - b)
  const copied = []
  let curlyIndex = 0
  for (const range of copiedMap) {
    while (curlyIndex < curlyPositions.length && curlyPositions[curlyIndex] < range.inStart) curlyIndex++
    let scan = curlyIndex
    let cursor = range.inStart
    while (scan < curlyPositions.length && curlyPositions[scan] < range.inEnd) {
      const position = curlyPositions[scan]
      if (cursor < position) copied.push({
        inStart: cursor,
        inEnd: position,
        outStart: range.outStart + (cursor - range.inStart),
      })
      cursor = position + 1
      scan++
    }
    if (cursor < range.inEnd) copied.push({
      inStart: cursor,
      inEnd: range.inEnd,
      outStart: range.outStart + (cursor - range.inStart),
    })
    curlyIndex = scan
  }

  return { text: out, changes: allChanges, copied }
}
