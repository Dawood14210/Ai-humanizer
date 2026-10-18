import { describe, it, expect } from 'vitest'
import { swapSynonyms, SYNONYM_DICTIONARY as DICT } from './synonyms.js'
import { makeRng } from './rng.js'
import phraseDictionary from './data/phrases.json'
import { invariantSuite } from './testInvariants.js'

function run(input, opts = {}) {
  const seed = opts.seed ?? 0
  return swapSynonyms(input, {
    options: opts,
    rng: makeRng(seed),
    protectedWords: opts.protectedWords || [],
  })
}

function swap(input, opts = {}) {
  return run(input, { synonyms: true, intensity: 'strong', ...opts }).text
}

describe('synonyms.json — curated local dictionary', () => {
  it('contains about 300 structured entries and does not include ambiguous examples', () => {
    expect(DICT.entries.length).toBeGreaterThanOrEqual(275)
    expect(DICT.entries.length).toBeLessThanOrEqual(325)
    for (const ambiguous of ['bank', 'light', 'right', 'run']) {
      expect(DICT.entries.some(entry => entry.word === ambiguous)).toBe(false)
    }
    for (const entry of DICT.entries) {
      expect(entry).toHaveProperty('word')
      expect(['verb', 'noun', 'adjective', 'adverb']).toContain(entry.pos)
      expect(entry.replacements.length).toBeGreaterThan(0)
      expect(entry.inflections.source.base).toBe(entry.word)
      for (const replacement of entry.replacements) {
        expect(entry.inflections.replacements[replacement]?.base).toBe(replacement)
      }
      if (entry.pos === 'verb') {
        expect(Object.keys(entry.inflections.source).sort()).toEqual(['-ing', 'base', 'past', 'thirdPerson'].sort())
        for (const replacement of entry.replacements) {
          expect(Object.keys(entry.inflections.replacements[replacement]).sort())
            .toEqual(['-ing', 'base', 'past', 'thirdPerson'].sort())
        }
      }
    }
  })
})

describe('synonyms — phrase-marker exclusion', () => {
  const markerWords = new Set()
  for (const entry of phraseDictionary.entries) {
    if (entry.type === 'word') {
      for (const surface of Object.keys(entry.inflections || {})) markerWords.add(surface.toLowerCase())
    } else if (entry.type === 'phrase') {
      for (const token of (entry.lemma || '').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []) {
        markerWords.add(token)
      }
    } else if (entry.type === 'template') {
      for (const token of (entry.pattern || '').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []) {
        markerWords.add(token)
      }
    }
  }

  it('fails if any synonym replacement form appears in a phrase marker list', () => {
    const offenders = []
    for (const entry of DICT.entries) {
      for (const replacement of entry.replacements) {
        const forms = entry.inflections.replacements[replacement] || {}
        for (const form of Object.values(forms)) {
          if (markerWords.has(form.toLowerCase())) offenders.push(`${entry.word} → ${form}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('synonyms — opt-in and intensity', () => {
  it('is off by default and can be explicitly disabled', () => {
    expect(run('We assist families.', { intensity: 'strong' }).text).toBe('We assist families.')
    expect(swap('We assist families.', { synonyms: false })).toBe('We assist families.')
  })

  it('uses light, medium, and strong intensity probabilities', () => {
    expect(swap('We assist families.', { intensity: 'light', seed: 1 })).toBe('We assist families.')
    expect(swap('We assist families.', { intensity: 'light', seed: 0 })).toBe('We aid families.')
    expect(swap('We assist families.', { intensity: 'medium', seed: 6 })).toBe('We aid families.')
    expect(swap('We assist families.', { intensity: 'strong', seed: 1 })).toBe('We aid families.')
  })

  it('is deterministic for a fixed seed', () => {
    const input = 'We assist families. The answer was clear.'
    expect(swap(input, { seed: 42 })).toBe(swap(input, { seed: 42 }))
  })
})

describe('synonyms — inflection, capitalization, and POS', () => {
  it('inflects regular verbs to base, third-person, past, and -ing forms', () => {
    expect(swap('We assist families.', { seed: 0 })).toBe('We aid families.')
    expect(swap('She assists families.', { seed: 0 })).toBe('She aids families.')
    expect(swap('They assisted families.', { seed: 0 })).toBe('They aided families.')
    expect(swap('They are assisting families.', { seed: 0 })).toBe('They are aiding families.')
  })

  it('preserves sentence case and ALL CAPS', () => {
    expect(swap('We assist families.', { seed: 0 })).toBe('We aid families.')
    expect(swap('WE ASSIST FAMILIES.', { seed: 0 })).toBe('WE AID FAMILIES.')
    expect(swap('Easy task.', { seed: 0 })).toBe('Simple task.')
  })

  it('uses neighboring words to distinguish noun, adjective, verb, and adverb uses', () => {
    expect(swap('The answer was clear.', { seed: 0 })).toBe('The reply was clear.')
    expect(swap('The plan is easy.', { seed: 0 })).toBe('The plan is simple.')
    expect(swap('They clearly assist families.', { seed: 0 })).toBe('They plainly assist families.')
    // "assist" after a determiner is a noun here, not the verb entry.
    expect(swap('The assist happened.', { seed: 0 })).toBe('The assist happened.')
  })

  it('skips capitalized proper nouns outside sentence starts', () => {
    const input = 'This is easy, but Easy is a name.'
    expect(swap(input, { seed: 0 })).toBe('This is simple, but Easy is a name.')
  })
})

describe('synonyms — one swap per sentence and protection', () => {
  it('makes at most one swap in each sentence', () => {
    const result = run('We assist teams, and they avoid delays.', { synonyms: true, intensity: 'strong', seed: 0 })
    expect(result.changes).toHaveLength(1)
    expect(result.text).toBe('We aid teams, and they avoid delays.')

    const twoSentences = run('We assist teams. They avoid delays.', { synonyms: true, intensity: 'strong', seed: 0 })
    expect(twoSentences.changes).toHaveLength(2)
  })

  it('skips quotes, code, and the user protected words', () => {
    expect(swap('We said "we assist families."', { seed: 0 })).toBe('We said "we assist families."')
    expect(swap('Use `assist` as written.', { seed: 0 })).toBe('Use `assist` as written.')
    expect(swap('We assist families.', { seed: 0, protectedWords: ['assist'] }))
      .toBe('We assist families.')
  })

  it('records each applied swap with the synonyms stage id', () => {
    const result = run('We assist families.', { synonyms: true, intensity: 'strong', seed: 0 })
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].rule).toEqual({ stage: 'synonyms', id: 'synonym-assist' })
  })
})

const FIXTURES = [
  ['We assist families.', { synonyms: true, intensity: 'strong', seed: 0 }, 'We aid families.'],
  ['She assists families.', { synonyms: true, intensity: 'strong', seed: 0 }, 'She aids families.'],
  ['They assisted families.', { synonyms: true, intensity: 'strong', seed: 0 }, 'They aided families.'],
  ['They are assisting families.', { synonyms: true, intensity: 'strong', seed: 0 }, 'They are aiding families.'],
  ['The answer was clear.', { synonyms: true, intensity: 'strong', seed: 0 }, 'The reply was clear.'],
  ['The plan is easy.', { synonyms: true, intensity: 'strong', seed: 0 }, 'The plan is simple.'],
  ['We said "we assist families."', { synonyms: true, intensity: 'strong', seed: 0 }, 'We said "we assist families."'],
  ['We assist families.', { synonyms: true, intensity: 'strong', seed: 0, protectedWords: ['assist'] }, 'We assist families.'],
  ['We assist families.', { intensity: 'strong', seed: 0 }, 'We assist families.'],
  ['', { synonyms: true, intensity: 'strong', seed: 0 }, ''],
]

invariantSuite('synonyms', FIXTURES, (input, opts) => run(input, opts))
