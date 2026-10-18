// index.js — public entry point for the Plainwrite text engine.
// Pipeline:
//   normalize → cleanup → phrases → transitions → contractions → rhythm → synonyms
// Each stage is a function (text, ctx) => { text, changes }. A stage returns a
// (possibly) modified string along with a list of change records describing what
// it did. Stages are independently testable and can be disabled per run.
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
import { mapCopiedRange } from './edits.js'

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
    excludedChanges: Array.isArray(options?.excludedChanges) ? options.excludedChanges : [],
    // Helper made available to stages:
    findProtectedSpans: (text) => findProtectedSpans(text, { protectedWords, protect: protectedConfig }),
  }
}

/**
 * Run the full Plainwrite pipeline.
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.seed] - RNG seed; defaults to a fixed seed for determinism.
 * @param {'light'|'medium'|'strong'} [options.intensity='medium'] - Contraction/synonym probability (0.3 / 0.6 / 0.9).
 * @param {boolean} [options.synonyms=false] - Enable the curated synonym stage.
 * @param {Array<string|number|{start:number,end:number}>} [options.lockedSentences] - Sentence text, zero-based indices, or source ranges to leave unchanged by contractions.
 * @param {string[]} [options.protectedWords] - Words/phrases stages must not alter.
 * @param {object} [options.protect] - Booleans toggling categories in findProtectedSpans.
 * @param {object} [options.stages] - Booleans toggling each stage by key; e.g. { contractions: false }.
 * @returns {{output:string, changes:Array, stats:object}}
 */
export function humanize(text, options = {}) {
  const ctx = buildContext(options)
  let current = typeof text === 'string' ? text : ''
  const allChanges = []

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
  for (let index = 0; index < STAGES.length; index++) {
    const stage = STAGES[index]
    if (onProgress) onProgress({ stage: stage.key, completed: index, total: STAGES.length, percent: Math.floor(index / STAGES.length * 100) })
    const enabled = ctx.stagesToggles[stage.key] !== false
    if (!enabled) {
      if (onProgress) onProgress({ stage: stage.key, completed: index + 1, total: STAGES.length, percent: Math.floor((index + 1) / STAGES.length * 100) })
      continue
    }
    const result = stage.fn(current, ctx)
    const newText = (result && typeof result.text === 'string') ? result.text : current
    const copied = Array.isArray(result?.copied)
      ? result.copied
      : (newText === current && current.length > 0
        ? [{ inStart: 0, inEnd: current.length, outStart: 0 }]
        : [])

    // Existing changes are now expressed against this stage's input. Carry them
    // through unchanged copied ranges; edits that consume any of their text
    // supersede them rather than leaving stale output coordinates behind.
    for (const change of allChanges) {
      if (change.superseded) continue
      const mapped = mapCopiedRange(copied, change._currentStart, change._currentEnd)
      if (!mapped) {
        change.superseded = true
        change.finalStart = null
        change.finalEnd = null
      } else {
        change._currentStart = mapped.start
        change._currentEnd = mapped.end
        change.finalStart = mapped.start
        change.finalEnd = mapped.end
      }
    }

    const changes = (result && Array.isArray(result.changes)) ? result.changes : []
    for (const c of changes) {
      const start = typeof c.start === 'number' ? c.start : 0
      const end = typeof c.end === 'number' ? c.end : newText.length
      allChanges.push({
        original: c.original,
        replacement: c.replacement,
        rule: c.rule || { stage: stage.key, id: 'unknown' },
        start,
        end,
        inputStart: Number.isInteger(c.inputStart) ? c.inputStart : start,
        inputEnd: Number.isInteger(c.inputEnd) ? c.inputEnd : end,
        ruleName: c.ruleName || c.rule?.id || stage.key,
        tier: c.tier || stage.key,
        source: c.source || 'Plainwrite built-in rules',
        stage: stage.key,
        finalStart: start,
        finalEnd: end,
        superseded: false,
        _currentStart: start,
        _currentEnd: end,
      })
    }
    current = newText
    if (onProgress) onProgress({ stage: stage.key, completed: index + 1, total: STAGES.length, percent: Math.floor((index + 1) / STAGES.length * 100) })
  }

  return {
    output: current,
    changes: allChanges.map(({ _currentStart, _currentEnd, ...change }) => change),
    stats: computeStats(current),
  }
}

export { computeStats, makeRng, findProtectedSpans }
