// transitions.js — softens abrupt sentence starts by occasionally inserting conversational
// transition words ("Still,", "That said,", "On the whole,") drawn from ./data/.
// Signature: (text, ctx) => { text, changes }
// Stage id: "transitions"
export function addTransitions(text, ctx) {
  return { text: typeof text === 'string' ? text : '', changes: [] }
}
