import { describe, it, expect } from 'vitest'
import {
  adjustRhythm,
  tokenizeSentences,
  sentenceLengthStats,
} from './rhythm.js'
import { makeRng } from './rng.js'
import { invariantSuite } from './testInvariants.js'

function run(input, opts = {}) {
  const seed = opts.seed ?? 0
  return adjustRhythm(input, {
    options: opts,
    rng: makeRng(seed),
    protectedWords: opts.protectedWords || [],
    lockedSentences: opts.lockedSentences,
  })
}

function rhythm(input, opts = {}) {
  return run(input, opts).text
}

describe('rhythm — sentence tokenizer and length statistics', () => {
  it('handles titles, e.g., i.e., decimals, initials, and initialisms', () => {
    const input = 'Dr. Lee spoke. Examples include e.g. apples and i.e. examples. The value is 3.14 units. J. R. R. Tolkien wrote. The U.S. team left.'
    expect(tokenizeSentences(input).map(sentence => sentence.text)).toEqual([
      'Dr. Lee spoke.',
      'Examples include e.g. apples and i.e. examples.',
      'The value is 3.14 units.',
      'J. R. R. Tolkien wrote.',
      'The U.S. team left.',
    ])
  })

  it('computes mean and population standard deviation in words', () => {
    const stats = sentenceLengthStats(tokenizeSentences('We are ready. This is fine.'))
    expect(stats.lengths).toEqual([3, 3])
    expect(stats.mean).toBe(3)
    expect(stats.standardDeviation).toBe(0)
  })
})

describe('rhythm — paired negative constructions', () => {
  it('rewrites not just / not only when both resulting statements are clean clauses', () => {
    expect(rhythm('The fact is not just that we saved time, but that we reduced costs.'))
      .toBe('We saved time. We reduced costs.')
    expect(rhythm('The tool not only saves time but also cuts costs.'))
      .toBe('The tool saves time. The tool cuts costs.')
  })

  it('leaves unclean halves unchanged and marks them as flagged', () => {
    const input = 'Not just a theory but a claim.'
    const result = run(input)
    expect(result.text).toBe(input)
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].rule.id).toBe('rhythm-flagged-negation')
    expect(result.changes[0].original).toBe('Not just a theory but a claim')
    expect(result.changes[0].replacement).toBe(result.changes[0].original)
  })
})

describe('rhythm — split and merge safety', () => {
  it('splits a long sentence only when the second clause has its own subject', () => {
    const good = 'The team tested the new system for several weeks, and it produced accurate results for every user in the trial.'
    expect(rhythm(good, { seed: 0 })).toBe(
      'The team tested the new system for several weeks. And it produced accurate results for every user in the trial.',
    )

    const missingSubject = 'The researchers examined the long report, and produced accurate results for every user in the trial after extensive analysis.'
    expect(rhythm(missingSubject, { seed: 0 })).toBe(missingSubject)
  })

  it('never splits at a comma-conjunction inside quotes or parentheses', () => {
    const quoted = 'The researchers reviewed a statement (which was long, and which took several weeks to finish) before they prepared the final results for review.'
    expect(rhythm(quoted, { seed: 0 })).toBe(quoted)

    const parenthetical = 'The researchers examined the long report (which was complex, and which took several weeks to finish) before they prepared the final results for review.'
    expect(rhythm(parenthetical, { seed: 0 })).toBe(parenthetical)

    const lockedQuote = 'The team said “the system works, and it saves time” before they wrote the long final report for the review panel.'
    expect(rhythm(lockedQuote, { seed: 0, protect: { doubleQuote: false } })).toBe(lockedQuote)
  })

  it('never changes headings, list items, or locked sentences', () => {
    const input = [
      '# The team tested the new system for several weeks, and it produced accurate results for every user in the trial.',
      '- The tool saves time. It improves the work.',
      'The tool saves time. It improves the work.',
    ].join('\n')
    expect(rhythm(input, { seed: 0, lockedSentences: ['The tool saves time. It improves the work.'] }))
      .toBe(input)
  })

  it('merges related short statements but leaves unrelated ones and does not merge after ? or !', () => {
    expect(rhythm('The tool saves time. It improves the work. The tool helps teams.', { seed: 0 }))
      .toBe('The tool saves time; it improves the work. The tool helps teams.')
    expect(rhythm('Birds migrate south. My laptop needs repair.', { seed: 0 }))
      .toBe('Birds migrate south. My laptop needs repair.')
    expect(rhythm('The tool saves time. But it improves the work.', { seed: 0 }))
      .toBe('The tool saves time, but it improves the work.')
    expect(rhythm('The tool saves time? It improves the work.', { seed: 0 }))
      .toBe('The tool saves time? It improves the work.')
    expect(rhythm('The tool saves time! It improves the work.', { seed: 0 }))
      .toBe('The tool saves time! It improves the work.')
  })

  it('drops a merge that would touch a sentence selected for splitting', () => {
    const input = 'The team tested the updated system for many weeks, and it produced accurate results for every user in the trial. The system saved valuable time for the whole research team during testing. It also improved the final report quality for the full research team.'
    const result = run(input, { seed: 0 })
    expect(result.text).toBe('The team tested the updated system for many weeks. And it produced accurate results for every user in the trial. The system saved valuable time for the whole research team during testing; it also improved the final report quality for the full research team.')
    const sorted = [...result.changes].sort((a, b) => a.inputStart - b.inputStart)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].inputStart).toBeGreaterThanOrEqual(sorted[i - 1].inputEnd)
    }
    expect(sorted.map(change => change.rule.id)).toEqual(['rhythm-split', 'rhythm-merge'])
  })
})

const CONFLICT_INPUT = 'The team tested the updated system for many weeks, and it produced accurate results for every user in the trial. The system saved valuable time for the whole research team during testing. It also improved the final report quality for the full research team.'
const FIXTURES = [
  [CONFLICT_INPUT, { seed: 0 }, 'The team tested the updated system for many weeks. And it produced accurate results for every user in the trial. The system saved valuable time for the whole research team during testing; it also improved the final report quality for the full research team.'],
  ['The team tested the new system for several weeks, and it produced accurate results for every user in the trial.', { seed: 0 }, 'The team tested the new system for several weeks. And it produced accurate results for every user in the trial.'],
  ['The fact is not just that we saved time, but that we reduced costs.', { seed: 0 }, 'We saved time. We reduced costs.'],
  ['Not just a theory but a claim.', { seed: 0 }, 'Not just a theory but a claim.'],
  ['  Not just a theory but a claim.', { seed: 0 }, '  Not just a theory but a claim.'],
  ['The tool saves time. It improves the work. The tool helps teams.', { seed: 0 }, 'The tool saves time; it improves the work. The tool helps teams.'],
  ['The researchers examined the long report, and produced accurate results for every user in the trial after extensive analysis.', { seed: 0 }, 'The researchers examined the long report, and produced accurate results for every user in the trial after extensive analysis.'],
  ['# The team tested the new system for several weeks, and it produced accurate results for every user in the trial.', { seed: 0 }, '# The team tested the new system for several weeks, and it produced accurate results for every user in the trial.'],
  ['', { seed: 0 }, ''],
]

invariantSuite('rhythm', FIXTURES, (input, opts) => run(input, opts))
