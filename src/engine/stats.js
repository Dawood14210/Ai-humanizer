// stats.js — computes simple readability/text statistics (word count, sentence count,
// average sentence length) useful for surfacing metrics in the UI and tuning rules.
export function computeStats(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { words: 0, sentences: 0, avgSentenceLength: 0, chars: 0 }
  }
  const words = text.split(/\s+/).filter(Boolean).length
  // Sentence-ish split on .!? followed by whitespace/end; avoids splitting on e.g./i.e. perfectly,
  // but is good enough for a UI metric.
  const sentences = Math.max(1, (text.match(/[.!?]+(?=\s|$)/g) || []).length)
  const avgSentenceLength = sentences > 0 ? words / sentences : words
  return { words, sentences, avgSentenceLength: Math.round(avgSentenceLength * 10) / 10, chars: text.length }
}
