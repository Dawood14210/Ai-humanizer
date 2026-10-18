import { humanize } from './engine/index.js'
import { computeStyleMetrics } from './engine/stats.js'
import { prepareLanguageOptions } from './engine/language.js'
import phrases from './engine/data/phrases.json'
import transitions from './engine/data/transitions.json'
import contractions from './engine/data/contractions.json'
import synonyms from './engine/data/synonyms.json'

const dictionaryCounts = {
  phrases: phrases.entries?.length || 0,
  phraseVersion: phrases.version || 'unknown',
  lastReviewed: phrases.lastReviewed || 'unknown',
  transitions: transitions.starters?.length || 0,
  contractions: Object.keys(contractions).filter(key => !key.startsWith('_')).length,
  synonyms: synonyms.entries?.length || 0,
}

self.postMessage({ type: 'ready', dictionaries: dictionaryCounts })

self.addEventListener('message', event => {
  const { id, text, options } = event.data || {}
  if (!id) return
  try {
    const startedAt = performance.now()
    const prepared = prepareLanguageOptions(text, options || {})
    const language = prepared.language
    const runOptions = prepared.options
    runOptions.onProgress = progress => self.postMessage({ type: 'progress', id, progress })
    const result = humanize(text, runOptions)
    const metrics = {
      before: computeStyleMetrics(text, runOptions),
      after: computeStyleMetrics(result.output, runOptions),
    }
    self.postMessage({ type: 'result', id, result, metrics, language, runtimeMs: performance.now() - startedAt })
  } catch (error) {
    self.postMessage({ type: 'error', id, error: error?.message || String(error) })
  }
})
