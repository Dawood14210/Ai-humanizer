// contractions.js — probabilistically applies common English contractions.
// Each candidate is found against the original text and the complete edit list
// is applied in one shared applyEdits() pass.
// Signature: (text, ctx) => { text, changes }
// Stage id: "contractions"

import { applyEdits } from './edits.js'
import { findProtectedSpans, forceImmutableProtection, overlapsProtectedSpans } from './protected.js'
import { makeRng } from './rng.js'
import contractionMap from './data/contractions.json'

const INTENSITY = { light: 0.3, medium: 0.6, strong: 0.9 }
const HSPACE = '[ \\t\\u00A0]+'

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const RULES = Object.entries(contractionMap)
  .filter(([full, contracted]) => full !== '_comment' && typeof contracted === 'string')
  .sort(([a], [b]) => b.length - a.length)
  .map(([full, contracted]) => {
    const source = full.trim().split(/\s+/).map(escapeRegExp).join(HSPACE)
    const id = `contract-${full.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    return {
      full,
      contracted,
      id,
      re: new RegExp(`\\b${source}\\b`, 'gi'),
    }
  })

function overlapsProtected(start, end, spans) {
  return overlapsProtectedSpans(start, end, spans)
}

function sentenceRanges(text) {
  const ranges = []
  let start = 0
  const boundary = /[.!?]+["'\u201D\u2019)\]]*[ \t\u00A0]*(?:\r?\n+)?/g
  let match
  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[0].length
    if (end > start) ranges.push({ start, end })
    start = end
  }
  if (start < text.length) ranges.push({ start, end: text.length })
  if (ranges.length === 0 && text.length > 0) ranges.push({ start: 0, end: text.length })
  return ranges
}

function sentenceAt(ranges, position) {
  return ranges.findIndex(range => position >= range.start && position < range.end)
}

function normalizedSentence(value) {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase()
}

function isLocked(text, position, ranges, options, ctx) {
  const rangeIndex = sentenceAt(ranges, position)
  if (rangeIndex < 0) return false
  const range = ranges[rangeIndex]
  const locks = options.lockedSentences ?? ctx.lockedSentences ?? options.lockedSentenceIndexes
  if (!Array.isArray(locks) && !(locks instanceof Set)) return false

  for (const lock of locks) {
    if (typeof lock === 'number' && lock === rangeIndex) return true
    if (typeof lock === 'string') {
      if (normalizedSentence(text.slice(range.start, range.end)) === normalizedSentence(lock)) return true
      continue
    }
    if (lock && typeof lock === 'object' && Number.isFinite(lock.start) && Number.isFinite(lock.end)) {
      if (lock.start < range.end && lock.end > range.start) return true
    }
  }
  return false
}

function isHeading(text, start) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const lineEndAt = text.indexOf('\n', start)
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt
  const line = text.slice(lineStart, lineEnd)
  const offset = start - lineStart
  if (/^\s{0,3}#{1,6}\s+/.test(line.slice(0, offset))) return true

  // Setext-style headings are the preceding text line followed by === or ---.
  const nextLineStart = lineEndAt < 0 ? -1 : lineEndAt + 1
  if (nextLineStart >= 0) {
    const nextLineEndAt = text.indexOf('\n', nextLineStart)
    const nextLine = text.slice(nextLineStart, nextLineEndAt < 0 ? text.length : nextLineEndAt)
    if (/^\s*(?:=+|-{3,})\s*$/.test(nextLine)) return true
  }
  return false
}

function endsClause(text, end) {
  return /^(?:[ \t\u00A0]*(?:[.!?;:,]|$)|[ \t\u00A0]+(?:and|but|or)\b)/i.test(text.slice(end))
}

function isTerminalItIs(text, start, end) {
  const prefix = text.slice(0, start)
  const relativeWord = /\b(?:what|who|where|when|why|how)[ \t\u00A0]+$/i.exec(prefix)
  return Boolean(relativeWord && endsClause(text, end))
}

function isThatIsToSay(text, end) {
  return /^[ \t\u00A0]*(?:,[ \t\u00A0]*)?to[ \t\u00A0]+say\b/i.test(text.slice(end))
}

function isEmphaticNegation(text, start, end, matched) {
  const notMatch = /\bnot\b/i.exec(matched)
  if (!notMatch) return false
  const notSurface = notMatch[0]
  if (notSurface.length > 1 && notSurface === notSurface.toUpperCase()) return true

  const before = text.slice(Math.max(0, start - 50), start)
  const after = text.slice(end, Math.min(text.length, end + 100))
  const precededByContrast = /\b(?:but|yet|although|though|whereas|while)\s+[^.!?;:]*$/i.test(before)
  const followedByContrast = /^[^.!?;:]*?\b(?:but rather|but instead|rather than|but)\b/i.test(after)
  return precededByContrast || followedByContrast
}

function caseLike(source, replacement) {
  const letters = source.match(/[A-Za-z]/g) || []
  if (letters.length > 0 && letters.every(char => char === char.toUpperCase())) {
    return replacement.toUpperCase()
  }
  if (/^[A-Z]/.test(source)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
  }
  return replacement.toLowerCase()
}

function isNegationRule(full) {
  return /\bnot\b/i.test(full)
}

/**
 * Contract common full forms according to options.intensity.
 * @param {string} text
 * @param {object} [ctx] Pipeline context: options, rng, protectedWords.
 * @returns {{text:string, changes:Array}}
 */
export function applyContractions(text, ctx = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: typeof text === 'string' ? text : '', changes: [] }
  }

  const options = ctx.options || {}
  const probability = typeof options.intensity === 'number'
    ? Math.max(0, Math.min(1, options.intensity))
    : (INTENSITY[options.intensity] ?? INTENSITY.medium)
  const rng = typeof ctx.rng === 'function'
    ? ctx.rng
    : makeRng(Number.isFinite(options.seed) ? options.seed : 0x9e3779b9)
  const spans = findProtectedSpans(text, {
    protectedWords: Array.isArray(ctx.protectedWords) ? ctx.protectedWords : [],
    protect: forceImmutableProtection(options.protect),
  })
  const ranges = sentenceRanges(text)
  const edits = []

  for (const rule of RULES) {
    rule.re.lastIndex = 0
    let match
    while ((match = rule.re.exec(text)) !== null) {
      const start = match.index
      const end = start + match[0].length
      if (overlapsProtected(start, end, spans) || isHeading(text, start)) continue
      if (isLocked(text, start, ranges, options, ctx)) continue

      const lowerFull = rule.full.toLowerCase()
      if (lowerFull === 'it is' && isTerminalItIs(text, start, end)) continue
      if (lowerFull === 'that is' && isThatIsToSay(text, end)) continue
      if (isNegationRule(rule.full) && isEmphaticNegation(text, start, end, match[0])) continue
      if (rng() >= probability) continue

      edits.push({
        start,
        end,
        original: match[0],
        replacement: caseLike(match[0], rule.contracted),
        rule: rule.id,
      })
      if (match[0] === '') rule.re.lastIndex++
    }
  }

  const result = applyEdits(text, edits, 'contractions', { excludedChanges: ctx.excludedChanges })
  return { text: result.text, changes: result.changes, copied: result.copied }
}
