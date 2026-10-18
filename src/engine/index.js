// index.js — public entry point for the Plainwrite text engine.
// Pipeline:
//   normalize → cleanup → phrases → transitions → contractions → rhythm → synonyms
// Each stage is a function (text, ctx) => { text, changes }. A stage returns a
// (possibly) modified string along with a list of change records describing what
// it did. Stages that aren't implemented yet are pass-through stubs.
//
// The engine is pure JavaScript with no React dependencies, so it runs the same
// in Node (Vitest) and in the browser. Same input + options + seed ⇒ same output.

import { normalize } from './normalize.js'
import { cleanup } from './cleanup.js'
import { rewritePhrases } from './phrases.js'
import { addTransitions } from './transitions.js'
import { applyContractions } from './contractions.js'
import { adjustRhythm } from './rhythm.js'
import { swapSynonyms } from './synonyms.js'
import { computeStats } from './stats.js'
import { makeRng } from './rng.js'
import { findProtectedSpans } from './protected.js'

// Ordered stage definitions. The `key` matches the `options.stages?.[key]` toggle
// (true = enabled, false = disabled) and also the `rule.stage` used in change records.
// Each `fn` has signature (text, ctx) => { text, changes }.
const STAGES = [
  { key: 'normalize',    fn: (t, ctx) => normalize(t, ctx) },
  { key: 'cleanup',      fn: (t, ctx) => cleanup(t, ctx) },
  { key: 'phrases',      fn: (t, ctx) => rewritePhrases(t, ctx) },
  { key: 'transitions',  fn: (t, ctx) => addTransitions(t, ctx) },
  { key: 'contractions', fn: (t, ctx) => applyContractions(t, ctx) },
  { key: 'rhythm',       fn: (t, ctx) => adjustRhythm(t, ctx) },
  { key: 'synonyms',     fn: (t, ctx) => swapSynonyms(t, ctx) },
]

function buildContext(options) {
  const seed = Number.isFinite(options?.seed) ? options.seed : 0x9e3779b9
  const protectedWords = Array.isArray(options?.protectedWords) ? options.protectedWords : []
  const protectedConfig = options?.protect || {}
  const stagesToggles = options?.stages || {}
  return {
    options,
    seed,
    rng: makeRng(seed),
    protectedWords,
    protectedConfig,
    stagesToggles,
    // Helper made available to stages:
    findProtectedSpans: (text) => findProtectedSpans(text, { protectedWords, protect: protectedConfig }),
  }
}

/**
 * Run the full Plainwrite pipeline.
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.seed] - RNG seed; defaults to a fixed seed for determinism.
 * @param {string[]} [options.protectedWords] - Words/phrases stages must not alter.
 * @param {object} [options.protect] - Booleans toggling categories in findProtectedSpans.
 * @param {object} [options.stages] - Booleans toggling each stage by key; e.g. { contractions: false }.
 * @returns {{output:string, changes:Array, stats:object}}
 */
export function humanize(text, options = {}) {
  const ctx = buildContext(options)
  let current = typeof text === 'string' ? text : ''
  const allChanges = []

  for (const stage of STAGES) {
    const enabled = ctx.stagesToggles[stage.key] !== false
    if (!enabled) continue
    const result = stage.fn(current, ctx)
    const newText = (result && typeof result.text === 'string') ? result.text : current
    const changes = (result && Array.isArray(result.changes)) ? result.changes : []
    for (const c of changes) {
      allChanges.push({
        original: c.original,
        replacement: c.replacement,
        rule: c.rule || { stage: stage.key, id: 'unknown' },
        start: typeof c.start === 'number' ? c.start : 0,
        end: typeof c.end === 'number' ? c.end : newText.length,
        stage: stage.key,
      })
    }
    current = newText
  }

  return {
    output: current,
    changes: allChanges,
    stats: computeStats(current),
  }
}

export { computeStats, makeRng, findProtectedSpans }
