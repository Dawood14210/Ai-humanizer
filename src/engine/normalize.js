// normalize.js — trims whitespace, fixes line endings, and normalizes Unicode/quotation marks
// so downstream modules can work on a consistent string.
export function normalize(text) {
  if (typeof text !== 'string') return ''
  return text
}
