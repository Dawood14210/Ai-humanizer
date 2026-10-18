// transitions.js — trims or simplifies repetitive sentence-opening connectors.
// Every candidate is found against the original input, then one applyEdits()
// call applies the complete, non-overlapping edit set.
// Signature: (text, ctx) => { text, changes }
// Stage id: "transitions"

import { applyEdits } from './edits.js'
import { findProtectedSpans, forceImmutableProtection, overlapsProtectedSpans } from './protected.js'
import { makeRng } from './rng.js'

export const TRANSITION_CONNECTORS = Object.freeze([
  'In conclusion', 'In addition', 'In summary', 'Furthermore',
  'Additionally', 'Consequently', 'Ultimately', 'Moreover',
  'However', 'Notably', 'Overall',
])
const CONNECTOR_RE = [...TRANSITION_CONNECTORS]
  .sort((a, b) => b.length - a.length)
  .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ \\t]+'))
  .join('|')

// The prefix recognizes starts after sentence punctuation or line/paragraph
// breaks. Markdown heading/list prefixes and opening quotes are included so
// those occurrences can be counted, then explicitly left unchanged.
const OPENING_RE = new RegExp(
  `(^|[.!?][\\"')\\u201D\\u2019\\]]?[ \\t\\r\\n]+)([ \\t]*(?:(?:#{1,6}|[-*+•])[ \\t]+|\\d+[.)][ \\t]+)?[\\"“'‘]?)(${CONNECTOR_RE})\\b`,
  'gim',
)

const ADDITIVE_ALTERNATIVES = ['Also', 'And']
const OVERUSE_ALTERNATIVES = {
  'in addition': ADDITIVE_ALTERNATIVES,
  'additionally': ADDITIVE_ALTERNATIVES,
  'furthermore': ADDITIVE_ALTERNATIVES,
  'moreover': ADDITIVE_ALTERNATIVES,
  'however': ['But', 'Still'],
  'consequently': ['So'],
}

function normalizeConnector(value) {
  return value.toLowerCase().replace(/[ \t]+/g, ' ')
}

function overlapsProtected(start, end, spans) {
  return overlapsProtectedSpans(start, end, spans)
}

/** Count connector occurrences after the first two, matching this stage's overuse threshold. */
export function countRepeatedConnectors(text, protectedSpans = []) {
  if (typeof text !== 'string' || text.length === 0) return 0
  OPENING_RE.lastIndex = 0
  const counts = new Map()
  let repeated = 0
  let match
  while ((match = OPENING_RE.exec(text)) !== null) {
    const prefix = match[1] + match[2]
    const start = match.index + prefix.length
    const end = start + match[3].length
    if (overlapsProtected(start, end, protectedSpans)) continue
    const canonical = normalizeConnector(match[3])
    const ordinal = (counts.get(canonical) || 0) + 1
    counts.set(canonical, ordinal)
    if (ordinal > 2) repeated++
  }
  return repeated
}

function startsHeadingOrList(text, connectorStart) {
  const lineStart = text.lastIndexOf('\n', connectorStart - 1) + 1
  const before = text.slice(lineStart, connectorStart)
  return /^\s*(?:#{1,6}\s+|[-*+•]\s+|\d+[.)]\s+)/.test(before)
}

function trailingPunctuationEnd(text, end) {
  const tail = text.slice(end)
  const m = /^(?:,[ \t]*|[ \t]+)/.exec(tail)
  return m ? end + m[0].length : end
}

function capitalizeNext(text, index) {
  const ch = text[index]
  if (!ch || !/[a-z]/.test(ch)) return ''
  return ch.toUpperCase()
}

function editForRemoval(text, start, connectorEnd) {
  const end = trailingPunctuationEnd(text, connectorEnd)
  // A connector without a following word is not useful to remove: doing so
  // could erase a complete sentence or leave punctuation in an odd position.
  if (end >= text.length || /[.!?\r\n"“'‘]/.test(text[end])) return null
  const first = capitalizeNext(text, end)
  const finalEnd = first ? end + 1 : end
  return {
    start,
    end: finalEnd,
    original: text.slice(start, finalEnd),
    replacement: first,
    rule: 'transitionRemove',
  }
}

function editForAlternative(text, start, connectorEnd, alternative) {
  const end = trailingPunctuationEnd(text, connectorEnd)
  if (end >= text.length || /[.!?\r\n]/.test(text[end])) return null
  // And/But read best without a comma; other listed transitions take one.
  const word = alternative.toLowerCase()
  const replacement = word === 'and' || word === 'but'
    ? `${alternative} `
    : `${alternative}, `
  return {
    start,
    end,
    original: text.slice(start, end),
    replacement,
    rule: 'transitionReplace',
  }
}

/**
 * Rewrite repetitive sentence-opening connectors.
 * @param {string} text
 * @param {object} [ctx] Pipeline context: options, rng, protectedWords.
 * @returns {{text:string, changes:Array}}
 */
export function addTransitions(text, ctx = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: '', changes: [] }
  }

  const options = ctx.options || {}
  const rng = typeof ctx.rng === 'function'
    ? ctx.rng
    : makeRng(Number.isFinite(options.seed) ? options.seed : 0x9e3779b9)
  const spans = findProtectedSpans(text, {
    protectedWords: Array.isArray(ctx.protectedWords) ? ctx.protectedWords : [],
    protect: forceImmutableProtection(options.protect),
  })

  OPENING_RE.lastIndex = 0
  const matches = []
  let match
  while ((match = OPENING_RE.exec(text)) !== null) {
    const prefix = match[1] + match[2]
    const start = match.index + prefix.length
    const end = start + match[3].length
    const canonical = normalizeConnector(match[3])
    const after = text.slice(end)

    // "However you do it" is a subordinate construction, not a transition;
    // likewise "in addition to" introduces a noun phrase rather than a new
    // sentence-level connector.
    if (canonical === 'however' && !/^,[ \t]*/.test(after)) continue
    if (canonical === 'in addition' && /^[ \t]+to\b/i.test(after)) continue

    matches.push({
      start,
      end,
      canonical,
      protected: overlapsProtected(start, end, spans) || startsHeadingOrList(text, start),
    })
    if (match[0] === '') OPENING_RE.lastIndex++
  }

  // Counts include headings, list items, and quoted occurrences: they still
  // contribute to overuse, even though those protected instances are untouched.
  const counts = new Map()
  const overflowIndex = new Map()
  const edits = []
  for (const item of matches) {
    const ordinal = (counts.get(item.canonical) || 0) + 1
    counts.set(item.canonical, ordinal)
    if (item.protected) continue

    if (ordinal > 2) {
      const alternatives = OVERUSE_ALTERNATIVES[item.canonical] || []
      if (alternatives.length > 0) {
        const index = overflowIndex.get(item.canonical) || 0
        overflowIndex.set(item.canonical, index + 1)
        const replacement = editForAlternative(
          text,
          item.start,
          item.end,
          alternatives[index % alternatives.length],
        )
        if (replacement) edits.push(replacement)
      } else {
        const removal = editForRemoval(text, item.start, item.end)
        if (removal) edits.push(removal)
      }
      continue
    }

    // Contrast and cause carry meaning, so retain them or use a close plain
    // alternative; never silently delete those relationships. Other listed
    // openers are removable filler, and approximately half are dropped.
    if (item.canonical === 'however' || item.canonical === 'consequently') {
      if (rng() < 0.5) {
        const alternative = item.canonical === 'however' ? 'But' : 'So'
        const replacement = editForAlternative(text, item.start, item.end, alternative)
        if (replacement) edits.push(replacement)
      }
      continue
    }

    if (rng() < 0.5) {
      const removal = editForRemoval(text, item.start, item.end)
      if (removal) edits.push(removal)
    }
  }

  const result = applyEdits(text, edits, 'transitions', { excludedChanges: ctx.excludedChanges })
  return { text: result.text, changes: result.changes, copied: result.copied }
}
