// protected.js — detects spans of text that transformation passes must not alter,
// such as quoted strings, inline/code blocks, URLs, numbers, citations, and any
// caller-supplied protected words/phrases. Spans are non-overlapping and sorted
// by start position, measured in UTF-16 code units (same as JS string indices).

export const PROTECTED_TYPES = [
  'codeBlock',    // ``` ... ``` or indented code
  'inlineCode',   // `...`
  'doubleQuote',  // "..." or “...”
  'singleQuote',  // '...' or ‘...’ (best-effort; doesn't do full NLP apostrophe disambiguation)
  'url',          // http(s)://...
  'email',        // user@host.tld
  'citation',     // [1], (Smith, 2020), (Smith & Jones, 2020), (Smith et al., 2020)
  'number',       // numeric literals, optionally with decimals/commas/units
  'userWord',     // exact user-supplied protected words / phrases
]

/**
 * Find protected spans in `text`.
 * @param {string} text
 * @param {object} [opts]
 * @param {string[]} [opts.protectedWords] - Exact words/phrases (case-sensitive) to leave untouched.
 * @param {object} [opts.protect] - Booleans toggling each built-in category; defaults all true.
 * @returns {Array<{start:number,end:number,type:string}>} Non-overlapping, sorted spans.
 */
export function findProtectedSpans(text, opts = {}) {
  if (typeof text !== 'string' || text.length === 0) return []

  const protect = {
    codeBlock: true,
    inlineCode: true,
    doubleQuote: true,
    singleQuote: true,
    url: true,
    email: true,
    citation: true,
    number: true,
    userWord: true,
    ...(opts.protect || {}),
  }
  const userWords = Array.isArray(opts.protectedWords) ? opts.protectedWords : []

  const spans = []

  // --- code blocks: triple backticks (multiline) ---
  if (protect.codeBlock) {
    const re = /```[\s\S]*?```/g
    let m
    while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, type: 'codeBlock' })
  }

  // --- inline code: single backticks ---
  if (protect.inlineCode) {
    const re = /`[^`\n]+`/g
    let m
    while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, type: 'inlineCode' })
  }

  // --- double-quoted spans: ASCII and curly ---
  if (protect.doubleQuote) {
    const re = /"[^"\n]*"|“[^”\n]*”/g
    let m
    while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, type: 'doubleQuote' })
  }

  // --- single-quoted spans: ASCII and curly (best-effort) ---
  if (protect.singleQuote) {
    const re = /'[^'\n]*'|‘[^’\n]*’/g
    let m
    while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, type: 'singleQuote' })
  }

  // --- URLs ---
  if (protect.url) {
    const re = /https?:\/\/[^\s<>"')\]]+/gi
    let m
    while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, type: 'url' })
  }

  // --- emails ---
  if (protect.email) {
    const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
    let m
    while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, type: 'email' })
  }

  // --- citations: [n], (Author, Year), (Author & Author, Year), (Author et al., Year) ---
  if (protect.citation) {
    const res = [
      /\[\d+\]/g,                                                         // [1] or [12]
      /\([A-Z][A-Za-z'\-]+(?:\s+(?:&|and)\s+[A-Z][A-Za-z'\-]+)?(?:\s+et\s+al\.)?,\s*\d{4}[a-z]?\)/g,
    ]
    for (const re of res) {
      let m
      while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, type: 'citation' })
    }
  }

  // --- numbers: integers, decimals, with thousand separators, optional units/percent/currency ---
  if (protect.number) {
    const re = /(?:\$|€|£|¥)?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*(?:%|km|cm|mm|m|kg|g|lb|lbs|mi|ft|in|mph|kph|USD|EUR|GBP))?|\d+\.\d+/g
    let m
    while ((m = re.exec(text)) !== null) {
      const s = m.index, e = s + m[0].length
      // guard: avoid matching pure-year numbers already covered by citation by letting overlap pruning drop it
      spans.push({ start: s, end: e, type: 'number' })
    }
  }

  // --- user-supplied protected words/phrases ---
  if (protect.userWord) {
    for (const word of userWords) {
      if (typeof word !== 'string' || word.length === 0) continue
      let idx = 0
      while (idx <= text.length - word.length) {
        const at = text.indexOf(word, idx)
        if (at === -1) break
        // word boundary check (so "cat" doesn't protect within "category") unless phrase contains spaces
        const beforeOk = at === 0 || !/[A-Za-z0-9_]/.test(text[at - 1]) || /\s/.test(word)
        const afterOk = at + word.length === text.length || !/[A-Za-z0-9_]/.test(text[at + word.length]) || /\s/.test(word)
        if (beforeOk && afterOk) spans.push({ start: at, end: at + word.length, type: 'userWord' })
        idx = at + word.length
      }
    }
  }

  // Prune overlaps: sort by start (ties: longer first), drop anything covered.
  spans.sort((a, b) => (a.start - b.start) || (b.end - b.end))
  const out = []
  for (const sp of spans) {
    const last = out[out.length - 1]
    if (last && sp.start < last.end) {
      // If this span extends past the last, clip or skip.
      if (sp.end > last.end) {
        // Keep the existing span; split out the tail if it's disjoint — but overlapping means
        // the earlier span already protects this region, so skip.
      }
      continue
    }
    out.push(sp)
  }
  return out
}

/** Returns true if the half-open range [start,end) overlaps any protected span. */
export function isProtectedRange(start, end, spans) {
  if (!spans || spans.length === 0) return false
  for (const s of spans) {
    if (s.end <= start) continue
    if (s.start >= end) break // spans are sorted
    if (start < s.end && end > s.start) return true
  }
  return false
}
