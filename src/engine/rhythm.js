// rhythm.js — adjusts sentence-rhythm: varies sentence length, occasionally splits long
// sentences, and breaks up rigid parallel structure to feel less templated.
// Signature: (text, ctx) => { text, changes }
// Stage id: "rhythm"
export function adjustRhythm(text, ctx) {
  return { text: typeof text === 'string' ? text : '', changes: [] }
}
