import { describe, it, expect } from 'vitest'
import { humanize, makeRng, computeStats } from './index.js'

describe('Plainwrite engine', () => {
  it('exports a humanize function that returns a string', () => {
    expect(typeof humanize('Hello world.')).toBe('string')
  })

  it('returns an empty string for non-string input', () => {
    expect(humanize(null)).toBe('')
    expect(humanize(undefined)).toBe('')
  })

  it('makeRng returns a deterministic function given a seed', () => {
    const a = makeRng(42)
    const b = makeRng(42)
    expect(a()).toBe(b())
    expect(a()).toBe(b())
  })

  it('computeStats returns a stats object', () => {
    const s = computeStats('One. Two. Three.')
    expect(s).toHaveProperty('words')
    expect(s).toHaveProperty('sentences')
    expect(s).toHaveProperty('avgSentenceLength')
  })
})
