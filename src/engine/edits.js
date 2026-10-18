// edits.js — the shared "find edits, then apply them once" machinery used by
// every transformation stage in the Plainwrite engine.
//
// CONTRACT
// --------
// A *transform* is a pure function that scans the ORIGINAL text and returns a
// list of edits:
//
//     { start, end, original, replacement, rule }
//
// No transform ever sees another transform's output. That is what keeps
// positions from drifting: every edit is expressed in the coordinate system of
// the text the stage was handed.
//
// A stage collects edits from all of its transforms and makes exactly ONE call
// to applyEdits(), which sorts them, resolves overlaps by priority, applies
// them left-to-right, and reports change records with OUTPUT-relative
// start/end (plus additive input-relative inputStart/inputEnd, which makes a
// byte-exact replay against the original input possible — see testInvariants).

// ---------- edit priorities (higher wins on overlap) ---------------------
// Shared by every stage. Rule ids are namespaced by convention so two stages
// can never accidentally collide (e.g. "cleanup:whitespace" vs "phrase:word").

export const PRIORITY = {
  // --- normalization stage ---
  normalizationTrim: 70,
  normalizationLineEndings: 60,
  normalizationWhitespace: 50,

  // --- cleanup stage ---
  chatbotLeftover: 50,
  markdownBold: 40,
  markdownItalic: 35,
  emoji: 30,
  emDash: 26,
  typography: 25,
  repeatedPunctuation: 20,
  trimEdges: 15,
  whitespace: 10,
  nbsp: 5,

  // --- phrases stage ---
  // Templates are the most specific match, then multi-word phrases, then
  // always-fire single words, then the flag-only density words.
  phraseTemplate: 48,
  phrasePhrase: 38,
  phraseWord: 28,
  phraseFlagged: 18,
}

/**
 * Apply edits to `str` in a single left-to-right pass.
 *
 * @param {string} str  the ORIGINAL text the edits were computed against
 * @param {Array<{start:number,end:number,original:string,replacement:string,rule:string}>} edits
 * @param {string} [stage]  stage name stamped onto every change record
 * @returns {{
 *   text: string,
 *   changes: Array<{original,replacement,rule:{stage,id},start,end,inputStart,inputEnd}>,
 *   copied: Array<{inStart:number,inEnd:number,outStart:number}>,
 *   kept: Array
 * }}
 */
export function applyEdits(str, edits, stage = 'unknown', options = {}) {
  const withPrio = edits.map(e => ({ ...e, _prio: PRIORITY[e.rule] || 0 }))
  // Sort by start ascending; on ties, higher priority first, then longer first.
  withPrio.sort((a, b) => (a.start - b.start) || (b._prio - a._prio) || (a.end - b.end))

  // Drop overlaps: an edit starting before the previous kept edit's end is
  // dropped unless it has strictly higher priority (then it replaces it).
  const kept = []
  for (const e of withPrio) {
    const prev = kept[kept.length - 1]
    if (prev && e.start < prev.end) {
      if (e._prio > prev._prio) kept[kept.length - 1] = e
      continue
    }
    kept.push(e)
  }

  let out = ''
  let cursor = 0
  const changes = []
  // Ranges copied through verbatim. Used by length-preserving pre-passes to
  // remap positions recorded before this pass changed any lengths.
  const copied = []
  const excludedChanges = Array.isArray(options.excludedChanges) ? options.excludedChanges : []
  const outputOffset = Number.isFinite(options.outputOffset) ? options.outputOffset : 0
  const inputOffset = Number.isFinite(options.inputOffset) ? options.inputOffset : 0
  for (const e of kept) {
    if (e.start < cursor) continue // safety net
    const projectedStart = outputOffset + out.length + (e.start - cursor)
    const projectedEnd = projectedStart + e.replacement.length
    const inputStart = inputOffset + e.start
    const inputEnd = inputOffset + e.end
    const excluded = excludedChanges.some(change =>
      change.stage === stage && change.id === e.rule
      && ((Number.isInteger(change.inputStart) && Number.isInteger(change.inputEnd)
        && change.inputStart === inputStart && change.inputEnd === inputEnd)
        || (change.inputStart == null && change.start === projectedStart && change.end === projectedEnd)))
    if (excluded) continue
    if (e.start > cursor) copied.push({ inStart: cursor, inEnd: e.start, outStart: out.length })
    out += str.slice(cursor, e.start)
    const start = out.length
    out += e.replacement
    changes.push({
      original: e.original,
      replacement: e.replacement,
      rule: { stage, id: e.rule },
      start,
      end: start + e.replacement.length,
      // Additive metadata: the contract's start/end stay output-relative, but
      // keeping the input range makes replay and original-text highlighting
      // unambiguous.
      inputStart: e.start,
      inputEnd: e.end,
      ...(e.meta || {}),
    })
    cursor = e.end
  }
  if (cursor < str.length) copied.push({ inStart: cursor, inEnd: str.length, outStart: out.length })
  out += str.slice(cursor)

  return { text: out, changes, copied, kept }
}

/** Map a copied-through range to output coordinates, or return null if any of it was edited. */
export function mapCopiedRange(copied, start, end) {
  if (!Array.isArray(copied) || start < 0 || end < start) return null
  if (start === end) {
    const containing = copied.find(range => start >= range.inStart && start < range.inEnd)
    if (containing) {
      const point = containing.outStart + (start - containing.inStart)
      return { start: point, end: point }
    }
    const preceding = [...copied].reverse().find(range => start === range.inEnd)
    if (preceding) {
      const point = preceding.outStart + (preceding.inEnd - preceding.inStart)
      return { start: point, end: point }
    }
    return start === 0 && copied.length === 0 ? { start: 0, end: 0 } : null
  }

  let cursor = start
  let outputCursor = null
  let outputStart = null
  for (const range of copied) {
    if (range.inEnd <= cursor) continue
    if (range.inStart > cursor) return null
    const mappedStart = range.outStart + (cursor - range.inStart)
    if (outputCursor !== null && mappedStart !== outputCursor) return null
    if (outputStart === null) outputStart = mappedStart
    const next = Math.min(end, range.inEnd)
    outputCursor = range.outStart + (next - range.inStart)
    cursor = next
    if (cursor === end) return { start: outputStart, end: outputCursor }
  }
  return null
}

/** Map a copied-through input index to its output index, or -1 if consumed. */
export function mapIndex(copied, idx) {
  for (const r of copied) {
    if (idx >= r.inStart && idx < r.inEnd) return r.outStart + (idx - r.inStart)
  }
  return -1
}

/**
 * Split `text` into editable / protected segments.
 * @param {string} text
 * @param {Array<{start:number,end:number}>} spans  non-overlapping, sorted
 * @returns {Array<{text:string, protected:boolean, offset:number}>}
 */
export function splitByProtected(text, spans) {
  if (!spans || spans.length === 0) return [{ text, protected: false, offset: 0 }]
  const segs = []
  let cursor = 0
  for (const s of spans) {
    if (s.start > cursor) segs.push({ text: text.slice(cursor, s.start), protected: false, offset: cursor })
    segs.push({ text: text.slice(s.start, s.end), protected: true, offset: s.start })
    cursor = s.end
  }
  if (cursor < text.length) segs.push({ text: text.slice(cursor), protected: false, offset: cursor })
  return segs
}
