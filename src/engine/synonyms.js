// synonyms.js — lightweight rule-based synonym swaps for word choices that commonly
// read as overly formal or overused in AI output (e.g. "utilize" -> "use").
// Signature: (text, ctx) => { text, changes }
// Stage id: "synonyms"
export function swapSynonyms(text, ctx) {
  return { text: typeof text === 'string' ? text : '', changes: [] }
}
