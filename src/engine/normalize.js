// normalize.js — trims whitespace, fixes line endings, and normalizes Unicode/quotation marks
// so downstream modules can work on a consistent string.
// Signature: (text, ctx) => { text, changes }
// Stage id: "normalize"

export function normalize(text, ctx) {
  if (typeof text !== 'string') return { text: '', changes: [] }

  let out = text
  const changes = []

  // Normalize line endings to \n
  if (out.includes('\r\n') || out.includes('\r')) {
    const original = out
    out = out.replace(/\r\n?/g, '\n')
    changes.push({
      original: original,
      replacement: out,
      rule: { stage: 'normalize', id: 'lineEndings' },
      start: 0,
      end: out.length,
    })
  }

  // Strip leading/trailing whitespace
  const trimmed = out.trim()
  if (trimmed !== out) {
    changes.push({
      original: out,
      replacement: trimmed,
      rule: { stage: 'normalize', id: 'trim' },
      start: 0,
      end: trimmed.length,
    })
    out = trimmed
  }

  // Collapse runs of spaces/tabs (but preserve double-newline paragraph breaks).
  // At this stage we don't touch protected spans because normalization is pre-pass
  // and protected-span detection needs to run on normalized text anyway.
  const collapsed = out
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
  if (collapsed !== out) {
    changes.push({
      original: out,
      replacement: collapsed,
      rule: { stage: 'normalize', id: 'whitespace' },
      start: 0,
      end: collapsed.length,
    })
    out = collapsed
  }

  return { text: out, changes }
}
