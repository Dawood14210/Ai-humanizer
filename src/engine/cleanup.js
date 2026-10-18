// cleanup.js — final-pass tidy-up: collapses extra spaces, repairs punctuation spacing,
// and ensures the output ends with proper terminal punctuation when appropriate.
// Signature: (text, ctx) => { text, changes }
// Stage id: "cleanup"
export function cleanup(text, ctx) {
  // Pass-through stub; real cleanup logic will live here.
  return { text: typeof text === 'string' ? text : '', changes: [] }
}
