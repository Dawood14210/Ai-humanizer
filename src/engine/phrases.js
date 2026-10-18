// phrases.js — replaces AI-flavoured words, phrases and templates with plain
// English, driven by the dictionary in ./data/phrases.json.
//
// ARCHITECTURE (identical to cleanup.js — see edits.js for the shared contract)
// ---------------------------------------------------------------------------
// Every rule is a pure "match finder": it scans the ORIGINAL text and returns
// edits {start, end, original, replacement, rule}. No rule ever sees another
// rule's output. All edits for the stage are then handed to ONE applyEdits()
// call, which sorts, de-overlaps by priority and applies them left-to-right.
//
// Because every edit is expressed against the original text, the paragraph
// density rule (see below) can count markers before anything is rewritten, and
// the change records can be replayed against the input byte-for-byte.
//
// PIPELINE
// --------
//   1. Find protected spans; matches touching them are discarded.
//   2. Find paragraphs (for the density rule).
//   3. Collect markers from every dictionary entry, resolve overlaps
//      (longest / highest-priority first), and count markers per paragraph.
//   4. Turn each surviving marker into an edit:
//        • flagOnly entries only fire when their paragraph holds
//          >= densityThreshold markers (default 3);
//        • the replacement is picked from `replacements` with the seeded RNG,
//          inflected to the matched surface form, and re-cased to match;
//        • entries with deleteOk may instead be deleted outright.
//   5. applyEdits(text, edits, 'phrases') — a single pass.
//
// Signature: (text, ctx) => { text, changes }
// Stage id: "phrases"

import { findProtectedSpans, forceImmutableProtection, overlapsProtectedSpans } from './protected.js'
import { applyEdits } from './edits.js'
import { makeRng } from './rng.js'
import dictionary from './data/phrases.json'

const HSPACE = /[ \t\u00A0]/
const WORD = /[A-Za-z][A-Za-z'\u2019-]*/

// ---------------------------------------------------------------------------
// Dictionary compilation (done once, at module load)
// ---------------------------------------------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build one matcher per dictionary entry.
 * @returns {Array<{entry:object, re:RegExp, priority:string}>}
 */
function buildMatchers(entries) {
  const matchers = []
  for (const entry of entries) {
    if (entry.type === 'word') {
      // Longest form first so "delving" wins over "delve" even without \b.
      const forms = Object.keys(entry.inflections || {}).sort((a, b) => b.length - a.length)
      if (forms.length === 0) continue
      matchers.push({
        entry,
        re: new RegExp(`\\b(?:${forms.map(escapeRe).join('|')})\\b`, 'gi'),
        rule: entry.flagOnly ? 'phraseFlagged' : 'phraseWord',
      })
    } else if (entry.type === 'phrase') {
      // Whitespace-flexible so "a  testament   to" still matches.
      const parts = String(entry.lemma).split(/\s+/).filter(Boolean).map(escapeRe)
      matchers.push({
        entry,
        re: new RegExp(`\\b${parts.join('[ \\t\\u00A0]+')}\\b`, 'gi'),
        rule: entry.flagOnly ? 'phraseFlagged' : 'phrasePhrase',
      })
    } else if (entry.type === 'template') {
      matchers.push({
        entry,
        re: new RegExp(entry.pattern, 'gi'),
        rule: 'phraseTemplate',
      })
    }
  }
  return matchers
}

const MATCHERS = buildMatchers(dictionary.entries || [])

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Paragraph ranges, split on blank lines. */
export function findParagraphs(text) {
  const paras = []
  let start = 0
  const re = /\n[ \t\u00A0]*\n+/g
  let m
  while ((m = re.exec(text)) !== null) {
    paras.push({ start, end: m.index })
    start = m.index + m[0].length
  }
  paras.push({ start, end: text.length })
  return paras
}

/** Index of the paragraph containing `pos`, or -1. */
function paragraphIndexAt(paragraphs, pos) {
  for (let i = 0; i < paragraphs.length; i++) {
    if (pos >= paragraphs[i].start && pos < paragraphs[i].end) return i
    if (pos < paragraphs[i].start) return i === 0 ? 0 : i - 1
  }
  return paragraphs.length - 1
}

function wordBefore(text, start) {
  const m = new RegExp(`(${WORD.source})[^A-Za-z]*$`).exec(text.slice(0, start))
  return m ? m[1].toLowerCase() : ''
}

function wordAfter(text, end) {
  const m = new RegExp(`^[^A-Za-z]*(${WORD.source})`).exec(text.slice(end))
  return m ? m[1].toLowerCase() : ''
}

/** True when `pos` begins a sentence, so a deletion there must re-capitalise. */
function atSentenceStart(text, pos) {
  if (pos === 0) return true
  return /[.!?]["')\u201D\u2019\]]?[ \t\u00A0]*$/.test(text.slice(0, pos))
}

// Words that take "a" even though they start with a vowel letter, because the
// first sound is a consonant ("a user", "a one-off", "an hour" goes the other
// way and is listed in AN_WORDS).
const A_WORDS = new Set([
  'use', 'used', 'useful', 'useless', 'user', 'users', 'usual', 'usually',
  'unique', 'unit', 'unite', 'unity', 'universe', 'universal', 'university',
  'uniform', 'union', 'one', 'once', 'euro', 'european', 'eulogy', 'euphoria',
])
// Words that take "an" despite starting with a consonant letter (silent h).
const AN_WORDS = new Set(['hour', 'hours', 'honest', 'honesty', 'honour', 'honor', 'heir', 'heirs'])

/** Does `word` require the article "an" rather than "a"? */
export function needsAn(word) {
  const w = String(word).toLowerCase()
  if (!w) return false
  if (AN_WORDS.has(w)) return true
  if (A_WORDS.has(w)) return false
  return /^[aeiou]/i.test(w)
}

/**
 * If the marker is preceded by a/an whose form no longer suits the
 * replacement, return the extended edit start and the corrected article.
 * Prevents "an intricate" -> "an complex".
 *
 * @returns {{start:number, prefix:string}|null}
 */
function adjustArticle(text, start, replacement) {
  if (!replacement) return null
  const firstWord = replacement.split(/[^A-Za-z'\u2019]+/).filter(Boolean)[0]
  if (!firstWord) return null

  const before = text.slice(0, start)
  const m = /(a|an)([^A-Za-z]*)$/i.exec(before)
  if (!m) return null

  const actual = m[1]
  const needed = needsAn(firstWord) ? 'an' : 'a'
  const wanted =
    actual.length > 1 && actual === actual.toUpperCase() ? needed.toUpperCase()
      : /^[A-Z]/.test(actual) ? needed.charAt(0).toUpperCase() + needed.slice(1)
        : needed
  if (wanted === actual) return null

  return { start: start - m[0].length, prefix: wanted + m[2] }
}

/**
 * Copy the capitalisation of `source` onto `target`.
 *   DELVE -> DIG, Delve -> Dig, delve -> dig
 */
export function applyCapitalization(source, target) {
  if (!target) return target
  if (source.length > 1 && source === source.toUpperCase() && /[A-Z]/.test(source)) {
    return target.toUpperCase()
  }
  if (/^\p{Lu}/u.test(source)) {
    return target.charAt(0).toUpperCase() + target.slice(1)
  }
  return target
}

// ---------------------------------------------------------------------------
// Marker detection
// ---------------------------------------------------------------------------

function overlapsSpan(start, end, spans) {
  return overlapsProtectedSpans(start, end, spans)
}

/**
 * Find every dictionary marker in `text`, resolving overlaps.
 * Matches are non-overlapping and sorted by start.
 *
 * @param {string} text
 * @param {Array} spans  protected spans to avoid
 * @param {string[]|null} [tiers]  optional tier filter, e.g. ['A']
 * @returns {Array<{start,end,text,entry,rule,match}>}
 */
export function findMarkers(text, spans = [], tiers = null) {
  const allowed = tiers ? new Set(tiers) : null
  const found = []

  for (const { entry, re, rule } of MATCHERS) {
    if (allowed && !allowed.has(entry.tier)) continue
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue }
      const start = m.index
      const end = start + m[0].length
      if (overlapsSpan(start, end, spans)) continue
      found.push({ start, end, text: m[0], entry, rule, match: m })
    }
  }

  // Resolve overlaps: earliest start wins; at the same start, the longest
  // match wins, then the higher-priority rule, then the earlier dictionary id
  // (so results are stable regardless of the order matches were collected in).
  const ORDER = { phraseTemplate: 3, phrasePhrase: 2, phraseWord: 1, phraseFlagged: 0 }
  found.sort((a, b) =>
    (a.start - b.start) ||
    (b.end - a.end) ||
    ((ORDER[b.rule] || 0) - (ORDER[a.rule] || 0)) ||
    (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0)
  )

  const kept = []
  let lastEnd = -1
  for (const f of found) {
    if (f.start < lastEnd) continue
    kept.push(f)
    lastEnd = f.end
  }
  return kept
}

// ---------------------------------------------------------------------------
// Replacement rendering
// ---------------------------------------------------------------------------

/** Pick one element deterministically from a list using the seeded RNG. */
function pick(list, rng) {
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  return list[Math.floor(rng() * list.length) % list.length]
}

/**
 * Render the plain-English replacement for one marker.
 * @returns {string|null} null when the marker should not fire
 */
function renderReplacement(f, rng, originalText) {
  const { entry, text: matched, match } = f

  // Guards apply to every rule type, including regex templates. Keep this
  // ahead of template rendering so a template cannot bypass its dictionary
  // conditions simply because it has a different replacement format.
  const guard = entry.guard || {}
  if (guard.notBefore?.includes(wordBefore(originalText, f.start))) return null
  if (guard.notAfter?.includes(wordAfter(originalText, f.end))) return null

  if (entry.type === 'template') {
    const templates = entry.templates || []
    if (templates.length === 0) {
      return entry.deleteOk ? '' : null
    }
    const tpl = pick(templates, rng)
    const rendered = tpl.replace(/\{([XY])\}/g, (_, name) => {
      const idx = name === 'X' ? 1 : 2
      return match[idx] !== undefined ? match[idx] : ''
    })
    // Only re-case when the template starts with literal text; if it starts
    // with a capture, that capture already carries its own capitalisation.
    return /^\{/.test(tpl) ? rendered : applyCapitalization(matched, rendered)
  }

  // Candidate replacements. Deletion is an extra candidate when deleteOk is set.
  const candidates = [...(entry.replacements || [])]
  if (entry.deleteOk) candidates.push('')

  const chosen = pick(candidates, rng)

  if (entry.type === 'word') {
    const surface = matched.toLowerCase()
    const table = (entry.inflections || {})[surface]
    const inflected = table && table[chosen] !== undefined ? table[chosen] : chosen
    return applyCapitalization(matched, inflected)
  }

  // phrase
  return applyCapitalization(matched, chosen)
}

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Rewrite AI-flavoured words and phrases.
 * @param {string} text
 * @param {object} [ctx]  { options, rng, protectedWords }
 * @returns {{text:string, changes:Array}}
 */
export function rewritePhrases(text, ctx = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: '', changes: [] }
  }

  const opts = ctx.options || {}
  const rng = typeof ctx.rng === 'function'
    ? ctx.rng
    : makeRng(Number.isFinite(opts.seed) ? opts.seed : 0x9e3779b9)
  const protectedWords = Array.isArray(ctx.protectedWords) ? ctx.protectedWords : []

  const spans = findProtectedSpans(text, { protectedWords, protect: forceImmutableProtection(opts.protect) })
  const threshold = Number.isFinite(opts.densityThreshold)
    ? opts.densityThreshold
    : (dictionary.densityThreshold || 3)

  const markers = findMarkers(text, spans, opts.tiers || null)
  const paragraphs = findParagraphs(text)

  // Density: how many markers each paragraph holds (including flag-only ones).
  const counts = new Array(paragraphs.length).fill(0)
  const paraOf = markers.map(m => paragraphIndexAt(paragraphs, m.start))
  for (const i of paraOf) if (i >= 0) counts[i]++

  const edits = []
  for (let i = 0; i < markers.length; i++) {
    const f = markers[i]
    // Flag-only "ordinary" words stay put unless the paragraph is dense enough.
    if (f.entry.flagOnly && counts[paraOf[i]] < threshold) continue

    const replacement = renderReplacement(f, rng, text)
    if (replacement === null) continue

    let start = f.start
    let end = f.end
    let finalReplacement = replacement

    // Keep "a"/"an" in agreement with the new first word.
    const article = adjustArticle(text, start, finalReplacement)
    if (article) {
      start = article.start
      finalReplacement = article.prefix + finalReplacement
    }

    if (replacement === '') {
      // Deleting: swallow the horizontal space that follows so we never leave a
      // double space, and re-capitalise if this opened the sentence.
      while (end < text.length && HSPACE.test(text[end])) end++
      if (atSentenceStart(text, start) && /[a-z]/.test(text[end] || '')) {
        finalReplacement = text[end].toUpperCase()
        end += 1
      } else if (start > 0 && HSPACE.test(text[start - 1]) && !/\n/.test(text[start - 1] || '')) {
        // Nothing follows: take one preceding space instead.
        start -= 1
      }
    }

    edits.push({
      start,
      end,
      original: text.slice(start, end),
      replacement: finalReplacement,
      rule: f.rule,
      meta: {
        ruleName: f.entry.id,
        tier: f.entry.tier,
        source: f.entry.source,
      },
    })
  }

  const { text: out, changes, copied } = applyEdits(text, edits, 'phrases', { excludedChanges: ctx.excludedChanges })
  return { text: out, changes, copied }
}

/** The loaded dictionary (handy for tests and tooling). */
export const PHRASE_DICTIONARY = dictionary
