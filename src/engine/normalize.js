// normalize.js — trims whitespace, fixes line endings, and collapses repeated
// horizontal whitespace. All edits are discovered on the original input and
// applied once, so the returned copied map can safely remap earlier changes.
// Signature: (text, ctx) => { text, changes, copied }

import { applyEdits } from './edits.js'
import { findProtectedSpans, forceImmutableProtection, overlapsProtectedSpans } from './protected.js'

function collectMatches(text, regex, replacement, rule) {
  const edits = []
  regex.lastIndex = 0
  let match
  while ((match = regex.exec(text)) !== null) {
    const next = typeof replacement === 'function' ? replacement(match[0]) : replacement
    if (next !== match[0]) {
      edits.push({
        start: match.index,
        end: match.index + match[0].length,
        original: match[0],
        replacement: next,
        rule,
      })
    }
    if (match[0] === '') regex.lastIndex++
  }
  return edits
}

export function normalize(text, ctx = {}) {
  if (typeof text !== 'string') return { text: '', changes: [], copied: [] }

  // Find every edit on the unmodified string. The line-break matcher also
  // absorbs adjacent horizontal whitespace and reduces 3+ consecutive breaks
  // to a paragraph break; higher priority resolves its overlap with whitespace
  // collapse or edge trimming.
  const options = ctx.options || {}
  const spans = findProtectedSpans(text, {
    protectedWords: Array.isArray(ctx.protectedWords) ? ctx.protectedWords : [],
    protect: forceImmutableProtection(options.protect),
  })
  const edits = [
    ...collectMatches(text, /^\s+|\s+$/g, '', 'normalizationTrim'),
    ...collectMatches(text, /[ \t]*(?:\r\n?|\n)+[ \t]*/g, (match) => {
      const breaks = match.match(/\r\n?|\n/g)?.length || 1
      return '\n'.repeat(Math.min(breaks, 2))
    }, 'normalizationLineEndings'),
    ...collectMatches(text, /[ \t]+/g, ' ', 'normalizationWhitespace'),
  ].filter(edit => !overlapsProtectedSpans(edit.start, edit.end, spans))
  const result = applyEdits(text, edits, 'normalize', { excludedChanges: ctx.excludedChanges })
  return { text: result.text, changes: result.changes, copied: result.copied }
}
