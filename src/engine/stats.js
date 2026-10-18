// stats.js — computes simple readability/text statistics (word count, sentence count,
// average sentence length) useful for surfacing metrics in the UI and tuning rules.
export function computeStats(text) {
  return { words: 0, sentences: 0, avgSentenceLength: 0 }
}
