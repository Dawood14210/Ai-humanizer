import { describe, expect, it } from 'vitest'
import { computeStyleMetrics } from './stats.js'
import { humanize } from './index.js'

const NO_STAGES_BUT_PHRASES = {
  normalize: false, cleanup: false, transitions: false, contractions: false,
  rhythm: false, synonyms: false,
}

describe('style metrics', () => {
  it('counts words, sentences, average length and population deviation from the shared tokenizer', () => {
    const metrics = computeStyleMetrics('One two. Three four five.')
    expect(metrics.words).toBe(5)
    expect(metrics.sentences).toBe(2)
    expect(metrics.avgSentenceLength).toBe(2.5)
    expect(metrics.sentenceLengthStdDev).toBe(0.5)
  })

  it('counts flag-only markers separately from phrase tiers A, B and C', () => {
    const metrics = computeStyleMetrics('We utilize this tool. It is a testament to the work, a game-changer, and potential.')
    expect(metrics.flaggedMarkers).toMatchObject({
      tierA: 1,
      tierB: 1,
      tierC: 1,
      flagOnly: 1,
      total: 4,
    })
  })

  it('counts repeated sentence-opening connectors using the transition stage list and threshold', () => {
    const metrics = computeStyleMetrics('However, first. However, second. However, third. “However, quoted.”')
    expect(metrics.repeatedConnectors).toBe(1)
    expect(metrics.repeatedConnectorCount).toBe(1)
  })

  it('skips words and sentences inside quotes, code, URLs, citations and numeric spans', () => {
    const text = 'One two. "Hidden three four." `code words here` https://example.com [1] 42. Five.'
    const metrics = computeStyleMetrics(text)
    expect(metrics.words).toBe(3)
    expect(metrics.sentences).toBe(2)
    expect(metrics.avgSentenceLength).toBe(1.5)
  })

  it('does not count protected marker occurrences', () => {
    const metrics = computeStyleMetrics('We utilize the tool. "We utilize the hidden tool." `utilize` https://utilize.example [1]')
    expect(metrics.flaggedMarkers.tierA).toBe(1)
    expect(metrics.flaggedMarkerCount).toBe(1)
  })

  it('recomputes the metrics after a phrase change is reverted', () => {
    const text = 'We utilize this tool.'
    const options = { seed: 7, stages: NO_STAGES_BUT_PHRASES }
    const before = computeStyleMetrics(text)
    const first = humanize(text, options)
    const edited = computeStyleMetrics(first.output)
    const selected = first.changes.find(change => change.stage === 'phrases' && !change.superseded)
    expect(selected).toBeTruthy()
    expect(edited.flaggedMarkerCount).toBeLessThan(before.flaggedMarkerCount)

    const reverted = humanize(text, {
      ...options,
      excludedChanges: [{
        stage: selected.stage,
        id: selected.rule.id,
        inputStart: selected.inputStart,
        inputEnd: selected.inputEnd,
      }],
    })
    const recomputed = computeStyleMetrics(reverted.output)
    expect(reverted.output).toBe(text)
    expect(recomputed).toEqual(before)
  })
})
