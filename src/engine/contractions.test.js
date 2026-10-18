import { describe, it, expect } from 'vitest'
import { applyContractions } from './contractions.js'
import { makeRng } from './rng.js'
import { invariantSuite } from './testInvariants.js'

const DEFAULT_SEED = 0

function run(input, opts = {}) {
  const seed = opts.seed ?? DEFAULT_SEED
  return applyContractions(input, {
    options: opts,
    rng: makeRng(seed),
    protectedWords: opts.protectedWords || [],
    lockedSentences: opts.lockedSentences,
  })
}

function contract(input, opts = {}) {
  return run(input, opts).text
}

describe('contractions — common full forms', () => {
  it.each([
    ['It is ready.', "It's ready."],
    ['That is fine.', "That's fine."],
    ['I do not agree.', "I don't agree."],
    ['She does not agree.', "She doesn't agree."],
    ['They are ready.', "They're ready."],
    ['We have finished.', "We've finished."],
    ['We would not go.', "We wouldn't go."],
    ['I am ready.', "I'm ready."],
    ['This cannot work.', "This can't work."],
  ])('contracts %j', (input, expected) => {
    expect(contract(input, { intensity: 'strong' })).toBe(expected)
  })

  it('preserves capitalization, including ALL CAPS', () => {
    expect(contract('It is fine.', { intensity: 'strong' })).toBe("It's fine.")
    expect(contract('IT IS FINE.', { intensity: 'strong' })).toBe("IT'S FINE.")
    expect(contract('I AM READY.', { intensity: 'strong' })).toBe("I'M READY.")
  })
})

describe('contractions — intensity and seeded RNG', () => {
  it('uses the configured light, medium, and strong probabilities', () => {
    expect(contract('It is ready.', { intensity: 'light', seed: 1 })).toBe('It is ready.')
    expect(contract('It is ready.', { intensity: 'light', seed: 0 })).toBe("It's ready.")
    expect(contract('It is ready.', { intensity: 'medium', seed: 6 })).toBe("It's ready.")
    expect(contract('It is ready.', { intensity: 'strong', seed: 1 })).toBe("It's ready.")
  })

  it('returns the same output for a fixed seed', () => {
    const input = 'It is clear. They are ready. We have finished.'
    const a = contract(input, { intensity: 'medium', seed: 84 })
    const b = contract(input, { intensity: 'medium', seed: 84 })
    expect(a).toBe(b)
    expect(contract(input, { intensity: 'strong', seed: 84 })).not.toBe(input)
  })
})

describe('contractions — meaning and protection guards', () => {
  it('does not contract terminal “what it is” or “that is to say”', () => {
    expect(contract('I know what it is.', { intensity: 'strong' })).toBe('I know what it is.')
    expect(contract('That is to say, we should wait.', { intensity: 'strong' }))
      .toBe('That is to say, we should wait.')
    expect(contract('That is, to say, a different thing.', { intensity: 'strong' }))
      .toBe('That is, to say, a different thing.')
  })

  it('leaves quoted, emphasized, and contrasted negation uncontracted', () => {
    expect(contract('She said "I do not know."', { intensity: 'strong' }))
      .toBe('She said "I do not know."')
    expect(contract('I do NOT know.', { intensity: 'strong' })).toBe('I do NOT know.')
    expect(contract('I do not want tea, but coffee.', { intensity: 'strong' }))
      .toBe('I do not want tea, but coffee.')
  })

  it('skips Markdown and Setext headings', () => {
    const input = '# It is a heading.\n\nThat is another heading.\n---'
    expect(contract(input, { intensity: 'strong' })).toBe(input)
  })

  it('skips protected spans and caller-protected words', () => {
    expect(contract('Use `it is` exactly.', { intensity: 'strong' })).toBe('Use `it is` exactly.')
    expect(contract('It is ready.', {
      intensity: 'strong',
      protectedWords: ['It is'],
    })).toBe('It is ready.')
  })

  it('does not modify a user-locked sentence', () => {
    const input = 'We have finished. They are ready.'
    expect(contract(input, {
      intensity: 'strong',
      lockedSentences: ['We have finished.'],
    })).toBe("We have finished. They're ready.")
    expect(contract(input, { intensity: 'strong', lockedSentences: [1] }))
      .toBe("We've finished. They are ready.")
  })
})

describe('contractions — change records', () => {
  it('records each edit with the contractions stage id', () => {
    const result = run('It is ready. They are set.', { intensity: 'strong' })
    expect(result.changes).toHaveLength(2)
    for (const change of result.changes) {
      expect(change.rule).toEqual({ stage: 'contractions', id: expect.any(String) })
    }
  })
})

const FIXTURES = [
  ['It is ready.', { intensity: 'strong', seed: 0 }, "It's ready."],
  ['That is fine.', { intensity: 'strong', seed: 0 }, "That's fine."],
  ['I do not agree.', { intensity: 'strong', seed: 0 }, "I don't agree."],
  ['She does not agree.', { intensity: 'strong', seed: 0 }, "She doesn't agree."],
  ['They are ready.', { intensity: 'strong', seed: 0 }, "They're ready."],
  ['We have finished.', { intensity: 'strong', seed: 0 }, "We've finished."],
  ['We would not go.', { intensity: 'strong', seed: 0 }, "We wouldn't go."],
  ['I am ready.', { intensity: 'strong', seed: 0 }, "I'm ready."],
  ['This cannot work.', { intensity: 'strong', seed: 0 }, "This can't work."],
  ['I know what it is.', { intensity: 'strong', seed: 0 }, 'I know what it is.'],
  ['That is to say, we should wait.', { intensity: 'strong', seed: 0 }, 'That is to say, we should wait.'],
  ['# It is a heading.', { intensity: 'strong', seed: 0 }, '# It is a heading.'],
  ['She said "I do not know."', { intensity: 'strong', seed: 0 }, 'She said "I do not know."'],
  ['We have finished.', { intensity: 'strong', seed: 0, lockedSentences: ['We have finished.'] }, 'We have finished.'],
  ['It is ready.', { intensity: 'light', seed: 1 }, 'It is ready.'],
  ['The plain sentence stays.', { intensity: 'strong', seed: 0 }, 'The plain sentence stays.'],
  ['', { intensity: 'strong', seed: 0 }, ''],
]

invariantSuite('contractions', FIXTURES, (input, opts) => run(input, opts))
