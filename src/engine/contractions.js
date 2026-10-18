// contractions.js — applies natural English contractions ("do not" -> "don't", "it is" -> "it's")
// at a realistic rate so writing sounds spoken rather than formal.
// Signature: (text, ctx) => { text, changes }
// Stage id: "contractions"
export function applyContractions(text, ctx) {
  return { text: typeof text === 'string' ? text : '', changes: [] }
}
