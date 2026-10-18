// stats.js — style-pattern counts used by the metrics panel. Counts deliberately
// describe writing patterns; they are not an AI-detection score.

import { findProtectedSpans, overlapsProtectedSpans } from './protected.js'
import { findMarkers } from './phrases.js'
import { sentenceLengthStats, tokenizeSentences } from './rhythm.js'
import { countRepeatedConnectors } from './transitions.js'

const WORD_RE = /(?:\p{L}+(?:['’.-]\p{L}+)*)/gu

function metricsProtectedSpans(text, options = {}) {
  return findProtectedSpans(text, {
    protectedWords: Array.isArray(options.protectedWords) ? options.protectedWords : [],
    protect: {
      ...(options.protect || {}),
      codeBlock: true,
      inlineCode: true,
      doubleQuote: true,
      singleQuote: true,
      url: true,
      email: true,
      citation: true,
      number: true,
    },
  })
}

function countVisibleWords(text, start, end, spans) {
  const value = text.slice(start, end)
  WORD_RE.lastIndex = 0
  let count = 0
  let match
  while ((match = WORD_RE.exec(value)) !== null) {
    const absoluteStart = start + match.index
    const absoluteEnd = absoluteStart + match[0].length
    if (!overlapsProtectedSpans(absoluteStart, absoluteEnd, spans)) count++
  }
  return count
}

function markerCounts(text, spans) {
  const markers = findMarkers(text, spans)
  const counts = { flagOnly: 0, tierA: 0, tierB: 0, tierC: 0 }
  for (const marker of markers) {
    if (marker.entry.flagOnly) {
      counts.flagOnly++
      continue
    }
    if (marker.entry.tier === 'A') counts.tierA++
    else if (marker.entry.tier === 'B') counts.tierB++
    else if (marker.entry.tier === 'C') counts.tierC++
  }
  return {
    ...counts,
    total: counts.flagOnly + counts.tierA + counts.tierB + counts.tierC,
  }
}

/**
 * Compute counts using the same sentence, phrase-marker and connector rules as
 * the engine. Fully protected sentences do not contribute to sentence metrics.
 */
export function computeStyleMetrics(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return {
      words: 0,
      wordCount: 0,
      sentences: 0,
      sentenceCount: 0,
      avgSentenceLength: 0,
      sentenceLengthStdDev: 0,
      flaggedMarkers: { flagOnly: 0, tierA: 0, tierB: 0, tierC: 0, total: 0 },
      flaggedMarkerCount: 0,
      repeatedConnectors: 0,
      repeatedConnectorCount: 0,
      chars: 0,
    }
  }

  const spans = metricsProtectedSpans(text, options)
  const tokenized = tokenizeSentences(text)
  const sentenceLengths = tokenized.map(sentence => ({
    wordCount: countVisibleWords(text, sentence.start, sentence.end, spans),
  })).filter(sentence => sentence.wordCount > 0)
  const lengths = sentenceLengthStats(sentenceLengths)
  const words = sentenceLengths.reduce((sum, sentence) => sum + sentence.wordCount, 0)
  const markers = markerCounts(text, spans)
  const repeatedConnectors = countRepeatedConnectors(text, spans)
  const average = lengths.count ? Math.round(lengths.mean * 10) / 10 : 0
  const deviation = Math.round(lengths.standardDeviation * 10) / 10

  return {
    words,
    wordCount: words,
    sentences: lengths.count,
    sentenceCount: lengths.count,
    avgSentenceLength: average,
    sentenceLengthStdDev: deviation,
    flaggedMarkers: markers,
    flaggedMarkerCount: markers.total,
    repeatedConnectors,
    repeatedConnectorCount: repeatedConnectors,
    chars: text.length,
  }
}

// Retain the original public function name for engine callers.
export function computeStats(text, options = {}) {
  return computeStyleMetrics(text, options)
}
