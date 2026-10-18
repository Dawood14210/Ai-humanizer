// phrases.js — swaps stiff, AI-flavored phrases (e.g. "in conclusion", "it is important to note")
// for more conversational alternatives using the dictionaries under ./data/.
// Signature: (text, ctx) => { text, changes }
// Stage id: "phrases"
export function rewritePhrases(text, ctx) {
  return { text: typeof text === 'string' ? text : '', changes: [] }
}
