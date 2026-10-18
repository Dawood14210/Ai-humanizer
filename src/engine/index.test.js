import { describe, it, expect } from 'vitest'
import { humanize, makeRng, computeStats, findProtectedSpans } from './index.js'

describe('Plainwrite engine', () => {
  // --- Shape / API contract -----------------------------------------------
  it('humanize returns { output, changes, stats }', () => {
    const r = humanize('Hello world.')
    expect(r).toHaveProperty('output')
    expect(r).toHaveProperty('changes')
    expect(r).toHaveProperty('stats')
    expect(typeof r.output).toBe('string')
    expect(Array.isArray(r.changes)).toBe(true)
    expect(typeof r.stats).toBe('object')
  })

  it('handles non-string input gracefully', () => {
    expect(humanize(null).output).toBe('')
    expect(humanize(undefined).output).toBe('')
    expect(humanize(123).output).toBe('')
  })

  it('makeRng returns a deterministic function given a seed', () => {
    const a = makeRng(42)
    const b = makeRng(42)
    const c = makeRng(43)
    expect(a()).toBe(b())
    expect(a()).toBe(b())
    expect(a()).toBe(b())
    // A different seed should (very likely) produce a different first value.
    expect(b()).not.toBe(c())
  })

  it('computeStats returns a stats object with the expected keys', () => {
    const s = computeStats('One two. Three four. Five six.')
    expect(s.words).toBe(6)
    expect(s.sentences).toBe(3)
    expect(s.avgSentenceLength).toBeCloseTo(2, 1)
    expect(s.chars).toBeGreaterThan(0)
  })

  // --- Determinism ---------------------------------------------------------
  it('produces identical output for identical (input, options, seed)', () => {
    const text = '  This   is a    test.  \r\nIt is important to note that we utilize numbers like 42. '
    const a = humanize(text, { seed: 7 })
    const b = humanize(text, { seed: 7 })
    expect(a.output).toBe(b.output)
    expect(a.changes).toEqual(b.changes)
    expect(a.stats).toEqual(b.stats)
  })

  it('defaults to a fixed seed (does not use Date.now()) so repeat calls match', () => {
    const a = humanize('Hello world. Normalize me.')
    const b = humanize('Hello world. Normalize me.')
    expect(a.output).toBe(b.output)
  })

  it('different seeds do not crash (and may differ once stages are non-trivial)', () => {
    const text = 'Some text.'
    const a = humanize(text, { seed: 1 })
    const b = humanize(text, { seed: 2 })
    expect(typeof a.output).toBe('string')
    expect(typeof b.output).toBe('string')
  })

  // --- Stage ordering & toggles -------------------------------------------
  it('runs stages in the declared order: normalize→cleanup→phrases→transitions→contractions→rhythm→synonyms', () => {
    // We monkey-patch via options? No — instead, verify the change records from
    // the normalize pass have stage:"normalize" and appear before any others.
    // Since non-normalize stages are currently stubs, only normalize produces changes.
    const r = humanize('  hello   world\r\n')
    const stages = r.changes.map(c => c.stage)
    expect(stages.every(s => s === 'normalize')).toBe(true)
    // Output must be trimmed/whitespace-collapsed by normalize (first stage)
    expect(r.output).toBe('hello world')
  })

  it('skips stages disabled via options.stages', () => {
    const text = '  hello   world\r\n'
    const enabled = humanize(text, { seed: 1 })
    expect(enabled.changes.length).toBeGreaterThan(0) // normalize + cleanup produce changes
    // Disable all currently-active stages (normalize + cleanup); remaining are stubs
    // and must produce no changes, output must equal input exactly.
    const disabled = humanize(text, {
      seed: 1,
      stages: { normalize: false, cleanup: false },
    })
    expect(disabled.changes).toEqual([])
    expect(disabled.output).toBe(text)
  })

  it('turning off one stage leaves others runnable', () => {
    const text = 'Hello world.'
    const r = humanize(text, { seed: 1, stages: { synonyms: false } })
    expect(r.output).toBe('Hello world.')
  })

  // --- Change record shape ------------------------------------------------
  it('change records carry original, replacement, rule, start, end, stage', () => {
    const r = humanize('  a  b\r\nc  ')
    for (const c of r.changes) {
      expect(typeof c.original).toBe('string')
      expect(typeof c.replacement).toBe('string')
      expect(c.rule).toHaveProperty('stage')
      expect(c.rule).toHaveProperty('id')
      expect(typeof c.start).toBe('number')
      expect(typeof c.end).toBe('number')
      expect(typeof c.stage).toBe('string')
    }
  })

  // --- Protected spans ----------------------------------------------------
  describe('findProtectedSpans', () => {
    it('finds double-quoted spans', () => {
      const spans = findProtectedSpans('He said "do not touch" and left.')
      const dq = spans.filter(s => s.type === 'doubleQuote')
      expect(dq).toHaveLength(1)
      expect(dq[0].start).toBe(8)
      expect(dq[0].end).toBe(22) // length of '"do not touch"'
    })

    it('finds inline code and fenced code blocks', () => {
      const text = 'Use `const x = 1` in code:\n```\nconst y = 2\n```'
      const spans = findProtectedSpans(text)
      expect(spans.find(s => s.type === 'inlineCode')).toBeTruthy()
      expect(spans.find(s => s.type === 'codeBlock')).toBeTruthy()
    })

    it('finds URLs and emails', () => {
      const text = 'Visit https://example.com/a?b=1 or email a@b.io.'
      const spans = findProtectedSpans(text)
      expect(spans.find(s => s.type === 'url')).toBeTruthy()
      expect(spans.find(s => s.type === 'email')).toBeTruthy()
    })

    it('finds numeric citations [1] and author-year citations', () => {
      const text = 'As shown [1] (Smith, 2020) and (Jones & Doe, 2018) and (Lee et al., 2021).'
      const spans = findProtectedSpans(text)
      const cits = spans.filter(s => s.type === 'citation')
      expect(cits.length).toBeGreaterThanOrEqual(4)
    })

    it('finds numbers', () => {
      const spans = findProtectedSpans('About 1,234.5 kg weighing $99 or 50%.')
      const nums = spans.filter(s => s.type === 'number')
      expect(nums.length).toBeGreaterThanOrEqual(3)
    })

    it('honors user-supplied protected words', () => {
      const text = 'We do not alter Plainwrite anywhere.'
      const spans = findProtectedSpans(text, { protectedWords: ['Plainwrite'] })
      const pw = spans.filter(s => s.type === 'userWord')
      expect(pw).toHaveLength(1)
      expect(text.slice(pw[0].start, pw[0].end)).toBe('Plainwrite')
    })

    it('returns non-overlapping, sorted spans', () => {
      const text = 'a "quoted with a `code` inside" and https://x.com'
      const spans = findProtectedSpans(text)
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end)
      }
    })
  })

  // --- Protected spans honored by pipeline --------------------------------
  it('passes protectedWords through ctx so they can be respected by stages', () => {
    // With normalize enabled alone, text should still be trimmed/collapsed even
    // when protected words are present — protected words constrain *swaps*, not whitespace.
    const r = humanize('  Hello  Plainwrite   world  ', {
      seed: 1,
      protectedWords: ['Plainwrite'],
    })
    expect(r.output).toBe('Hello Plainwrite world')
  })
})
