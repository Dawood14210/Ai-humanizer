// index.js — public entry point for the Plainwrite text engine.
// Runs normalization, then each transformation pass, then cleanup.
// The engine is pure JavaScript, has no React dependencies, and can be imported
// directly in Node (e.g. from Vitest) or from the browser.

import { normalize } from './normalize.js'
import { cleanup } from './cleanup.js'
import { rewritePhrases } from './phrases.js'
import { addTransitions } from './transitions.js'
import { applyContractions } from './contractions.js'
import { adjustRhythm } from './rhythm.js'
import { swapSynonyms } from './synonyms.js'
import { computeStats } from './stats.js'
import { makeRng } from './rng.js'

export function humanize(text, options = {}) {
  const rng = makeRng(options.seed)
  const t0 = normalize(text)
  const t1 = swapSynonyms(t0, rng)
  const t2 = rewritePhrases(t1, rng)
  const t3 = applyContractions(t2, rng)
  const t4 = adjustRhythm(t3, rng)
  const t5 = addTransitions(t4, rng)
  return cleanup(t5)
}

export { computeStats, makeRng }
