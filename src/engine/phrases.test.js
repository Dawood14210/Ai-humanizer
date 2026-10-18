import { describe, it, expect } from 'vitest'
import {
  rewritePhrases,
  findMarkers,
  findParagraphs,
  applyCapitalization,
  needsAn,
  PHRASE_DICTIONARY as DICT,
} from './phrases.js'
import { makeRng } from './rng.js'
import { findProtectedSpans } from './protected.js'
import { invariantSuite } from './testInvariants.js'

const SEED = 1234

/** Run the stage the way the pipeline does, with a seeded RNG. */
function run(input, opts = {}) {
  return rewritePhrases(input, {
    options: opts,
    rng: makeRng(opts.seed ?? SEED),
    protectedWords: opts.protectedWords || [],
  })
}

/** Just the output text. */
function swap(input, opts = {}) {
  return run(input, opts).text
}

/** All distinct outputs the stage produces across many seeds. */
function outputsAcrossSeeds(input, opts = {}, seeds = 40) {
  const seen = new Set()
  for (let s = 0; s < seeds; s++) seen.add(swap(input, { ...opts, seed: s }))
  return [...seen]
}

// ===========================================================================
// Dictionary shape & integrity
// ===========================================================================

describe('phrases.json — shape', () => {
  const entries = DICT.entries

  it('carries a version and a lastReviewed date', () => {
    expect(typeof DICT.version).toBe('string')
    expect(DICT.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(typeof DICT.lastReviewed).toBe('string')
    expect(DICT.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('has at least 150 entries spread over tiers A, B and C', () => {
    expect(entries.length).toBeGreaterThanOrEqual(150)
    const tiers = {}
    for (const e of entries) tiers[e.tier] = (tiers[e.tier] || 0) + 1
    expect(tiers.A).toBeGreaterThan(0)
    expect(tiers.B).toBeGreaterThan(0)
    expect(tiers.C).toBeGreaterThan(0)
  })

  it('contains the words and phrases named in the tier definitions', () => {
    const lemmas = new Set(entries.map(e => e.lemma).filter(Boolean))

    // Tier A examples: peer-reviewed excess-word studies
    for (const w of [
      'delve', 'underscore', 'showcase', 'intricate', 'meticulous', 'pivotal',
      'realm', 'tapestry', 'commendable', 'seamless', 'leverage', 'foster',
      'garner', 'elucidate',
    ]) expect(lemmas, `tier A word "${w}"`).toContain(w)

    // Tier B examples: Wikipedia "Signs of AI writing"
    for (const p of [
      'pivotal moment', 'broader movement', 'encompassing', 'valuable insight',
      'key turning point', 'serves as', 'a testament to', 'rich tapestry',
    ]) expect(lemmas, `tier B phrase "${p}"`).toContain(p)

    // Tier C examples: blog-compiled phrases
    for (const p of [
      "it's important to note that", "in today's fast-paced world",
      'navigate the complexities', 'treasure trove', 'game-changer',
    ]) expect(lemmas, `tier C phrase "${p}"`).toContain(p)
  })

  it('gives every entry the required fields', () => {
    const required = [
      'id', 'type', 'pos', 'inflections', 'replacements',
      'deleteOk', 'tier', 'source', 'guard', 'notes',
    ]
    for (const e of entries) {
      for (const key of required) {
        expect(e, `entry ${e.id}`).toHaveProperty(key)
      }
      // "lemma or pattern"
      expect(
        (typeof e.lemma === 'string' && e.lemma.length > 0) ||
        (typeof e.pattern === 'string' && e.pattern.length > 0),
        `entry ${e.id} needs a lemma or a pattern`
      ).toBe(true)
      expect(['word', 'phrase', 'template']).toContain(e.type)
      expect(['A', 'B', 'C']).toContain(e.tier)
      expect(typeof e.deleteOk).toBe('boolean')
      expect(typeof e.guard).toBe('object')
      expect(typeof e.notes).toBe('string')
      expect(e.notes.length).toBeGreaterThan(0)
    }
  })

  it('has unique ids', () => {
    const ids = entries.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps one lemma per word/phrase entry so two rules cannot fight', () => {
    const keys = entries.filter(e => e.type !== 'template').map(e => `${e.type}:${e.lemma}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('word entries: every inflection key maps each replacement to a form', () => {
    for (const e of entries.filter(x => x.type === 'word')) {
      expect(Object.keys(e.inflections).length, e.id).toBeGreaterThan(0)
      for (const [form, table] of Object.entries(e.inflections)) {
        expect(form.toLowerCase(), e.id).toBe(form)
        for (const base of e.replacements) {
          expect(table[base], `${e.id}: form "${form}" missing replacement "${base}"`).toBeTypeOf('string')
        }
      }
    }
  })

  it('template entries: placeholder count matches capture-group count', () => {
    for (const e of entries.filter(x => x.type === 'template')) {
      const groups = new RegExp(`${e.pattern}|`).exec('').length - 1
      for (const t of e.templates || []) {
        const placeholders = (t.match(/\{[XY]\}/g) || []).length
        expect(placeholders, `${e.id}: template "${t}"`).toBe(groups)
      }
      // A template with no rendering must at least be safe to delete.
      if ((e.templates || []).length === 0) expect(e.deleteOk, e.id).toBe(true)
    }
  })
})

// ===========================================================================
// Replacements must be plain words, and must never themselves be markers
// ===========================================================================

describe('phrases.json — replacement vs marker integrity', () => {
  const entries = DICT.entries
  const plain = new Set(DICT.plainWords.map(w => w.toLowerCase()))

  /** Every surface form the dictionary can match on. */
  const markerSurfaces = new Set()
  for (const e of entries) {
    if (e.type === 'word') Object.keys(e.inflections).forEach(f => markerSurfaces.add(f.toLowerCase()))
    else if (e.type === 'phrase') markerSurfaces.add(e.lemma.toLowerCase())
    // templates match arbitrary text, so they contribute no fixed surface
  }

  /** Every string the engine can emit as a replacement. */
  function replacementStrings(e) {
    if (e.type === 'word') {
      const out = new Set()
      for (const table of Object.values(e.inflections)) out.add(...Object.values(table))
      return [...out]
    }
    if (e.type === 'phrase') return [...e.replacements]
    return []
  }

  it('every replacement is built only from whitelisted plain words', () => {
    const offenders = []
    for (const e of entries) {
      for (const r of replacementStrings(e)) {
        for (const token of r.toLowerCase().split(/[^a-z']+/).filter(Boolean)) {
          if (!plain.has(token)) offenders.push(`${e.id} → "${r}" (word "${token}")`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('no replacement (or inflected form) is itself a marker', () => {
    const offenders = []
    for (const e of entries) {
      for (const r of replacementStrings(e)) {
        if (markerSurfaces.has(r.toLowerCase())) offenders.push(`${e.id} → "${r}"`)
      }
      for (const base of e.replacements || []) {
        if (markerSurfaces.has(base.toLowerCase())) offenders.push(`${e.id} → "${base}"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no whitelisted plain word appears in any marker list', () => {
    const offenders = [...markerSurfaces].filter(s => plain.has(s))
    expect(offenders).toEqual([])
  })

  it('the whitelist is non-trivial and lower-case', () => {
    expect(plain.size).toBeGreaterThan(100)
    for (const w of DICT.plainWords) expect(w).toBe(w.toLowerCase())
  })
})

// ===========================================================================
// Inflections
// ===========================================================================

describe('phrases — inflections', () => {
  it('inflects a single-replacement verb across every form', () => {
    // "leverage" → "use" is unambiguous, so the output is seed-independent.
    expect(swap('We leverage the data.')).toBe('We use the data.')
    expect(swap('It leverages the data.')).toBe('It uses the data.')
    expect(swap('Leveraging the data helps.')).toBe('Using the data helps.')
    expect(swap('They leveraged the data.')).toBe('They used the data.')
  })

  it('inflects each candidate replacement to the matched form (delve)', () => {
    // delve/delves/delving/delved → dig…/explore… in the same form.
    const expected = {
      delve: ['dig', 'explore'],
      delves: ['digs', 'explores'],
      delving: ['digging', 'exploring'],
      delved: ['dug', 'explored'],
    }
    for (const [form, allowed] of Object.entries(expected)) {
      // not "delve into": that is a tier-B phrase entry of its own
      const outs = outputsAcrossSeeds(`We ${form} deeper.`)
      const tails = outs.map(o => o.replace(/^We /, '').replace(/ deeper\.$/, ''))
      expect(tails.length).toBeGreaterThan(0)
      for (const t of tails) expect(allowed).toContain(t)
    }
  })

  it('handles irregular inflections (delved → dug, not "delveded")', () => {
    const outs = outputsAcrossSeeds('They delved deeper.')
    for (const o of outs) expect(o).toMatch(/^They (dug|explored) deeper\.$/)
  })

  it('keeps the matched form when the entry has no separate inflection', () => {
    // Adjectives/nouns are stored with a single base form.
    expect(swap('A robust plan.', { seed: 1 })).toBe('A solid plan.')
    expect(swap('A robust plan.')).toBe('A strong plan.')
  })

  it('still matches plural/possessive-looking neighbours without mangling them', () => {
    expect(swap('The realms of gold.')).toBe('The areas of gold.')
  })
})

// ===========================================================================
// Capitalization
// ===========================================================================

describe('phrases — capitalization', () => {
  it('preserves sentence case', () => {
    expect(swap('Leverage the data.')).toBe('Use the data.')
  })

  it('preserves ALL CAPS', () => {
    expect(swap('LEVERAGE THE DATA.')).toBe('USE THE DATA.')
  })

  it('preserves mid-sentence lowercase', () => {
    expect(swap('We should leverage it.')).toBe('We should use it.')
  })

  it('keeps a/an in agreement with the new first word', () => {
    // "an intricate" -> "a detailed"/"a complex" (never "an complex")
    const outs = outputsAcrossSeeds('An intricate pattern.')
    for (const o of outs) expect(o).toMatch(/^A (detailed|complex) pattern\.$/)
    // and the other direction: "a ubiquitous" -> "an everywhere" (but "a common")
    const outs2 = outputsAcrossSeeds('A ubiquitous habit.')
    expect(outs2).toContain('An everywhere habit.')
    expect(outs2).toContain('A common habit.')
    for (const o of outs2) expect(o).toMatch(/^(An everywhere|A common) habit\.$/)
  })

  it('needsAn respects vowel-letter vs vowel-sound words', () => {
    expect(needsAn('complex')).toBe(false)
    expect(needsAn('intricate')).toBe(true)
    expect(needsAn('hour')).toBe(true)   // silent h
    expect(needsAn('user')).toBe(false)  // "yoo-zer"
    expect(needsAn('one')).toBe(false)
  })

  it('applyCapitalization handles all three cases', () => {
    expect(applyCapitalization('Delve', 'dig')).toBe('Dig')
    expect(applyCapitalization('DELVE', 'dig')).toBe('DIG')
    expect(applyCapitalization('delve', 'dig')).toBe('dig')
    // A single capital letter is treated as normal capitalisation, not shouty.
    expect(applyCapitalization('A', 'dig')).toBe('Dig')
  })

  it('recapitalizes the next word when an opener is deleted', () => {
    // "It is important to note that" is deleteOk, so the opener may vanish and
    // the following sentence must not be left lowercase.
    const outs = outputsAcrossSeeds('It is important to note that the sky is blue.')
    for (const o of outs) expect(o).toMatch(/^(The sky is blue\.|Note that the sky is blue\.)$/)
  })
})

// ===========================================================================
// Density rule (flag-only "ordinary" words)
// ===========================================================================

describe('phrases — density rule', () => {
  it('leaves an ordinary word alone when the paragraph is not dense', () => {
    expect(swap('The results were significant.')).toBe('The results were significant.')
    expect(swap('We looked across the field.')).toBe('We looked across the field.')
  })

  it('fires ordinary words once a paragraph holds 3+ markers', () => {
    // 3 markers in one paragraph: delve (always fires), significant, across.
    const out = swap('We delve into significant results across the study.')
    expect(out).not.toContain('delve')
    expect(out).not.toContain('significant')
    expect(out).not.toContain('across')
  })

  it('counts flag-only markers themselves toward the threshold', () => {
    // significant + across + framework = 3 flag-only markers, no always-fire marker.
    const out = swap('A significant shift across the framework.')
    expect(out).not.toBe('A significant shift across the framework.')
    expect(out).toMatch(/A (big|notable) shift (over|through) the (structure|system)\./)
  })

  it('does not fire at 2 markers', () => {
    expect(swap('A significant shift across the team.')).toBe('A significant shift across the team.')
  })

  it('counts markers per paragraph, not per document', () => {
    const dense = 'A significant shift across the framework.'
    const thin = 'The results were significant.'
    const both = `${dense}\n\n${thin}`
    const out = swap(both)
    const [p1, p2] = out.split('\n\n')
    expect(p1).not.toBe(dense) // dense paragraph rewrites
    expect(p2).toBe(thin)      // sparse paragraph keeps "significant"
  })

  it('honours a custom densityThreshold', () => {
    // With a threshold of 1, a single flag-only marker fires.
    expect(swap('The results were significant.', { densityThreshold: 1 }))
      .toMatch(/The results were (big|notable)\./)
    // With a very high threshold, even a dense paragraph stays put.
    expect(swap('A significant shift across the framework.', { densityThreshold: 99 }))
      .toBe('A significant shift across the framework.')
  })

  it('always-fire markers ignore the density rule', () => {
    expect(swap('We delve into it.')).toMatch(/We (dig|explore) into it\./)
  })
})

// ===========================================================================
// Templates, deletion, RNG, protected spans
// ===========================================================================

describe('phrases — templates', () => {
  it('rewrites a template while preserving both capture groups', () => {
    const out = swap('Diet plays a pivotal role in health.')
    expect(out).toMatch(/^Diet (matters for|shapes|drives) health\.$/)
  })

  it('preserves capitalisation inside captures', () => {
    const out = swap('AI plays a crucial role in medicine.')
    expect(out).toMatch(/^AI (matters for|shapes|drives) medicine\.$/)
  })

  it('collapses a padded opener to its captured tail', () => {
    const out = swap('In the ever-evolving landscape of medicine, things change.')
    expect(out).toBe('In medicine, things change.')
  })

  it('applies a two-group template', () => {
    const out = swap('It is not only fast but also cheap.')
    expect(out).toMatch(/^It is (fast and cheap|fast, and cheap too)\.$/)
  })

  it('the template beats the single word it contains', () => {
    // "plays a pivotal role in" (template) wins over the "pivotal" word rule.
    const out = swap('Diet plays a pivotal role in health.')
    expect(out).not.toContain('pivotal')
    expect(out).not.toContain('role in')
  })
})

describe('phrases — deletion (deleteOk)', () => {
  it('deletes a throat-clearing opener and re-capitalises', () => {
    const outs = outputsAcrossSeeds('It is important to note that the sky is blue.')
    expect(outs.some(o => o === 'The sky is blue.')).toBe(true)
  })

  it('can delete a redundant wordiness phrase', () => {
    const outs = outputsAcrossSeeds('We left early in order to beat traffic.')
    // in order to → "to"; deleteOk makes plain deletion possible too.
    for (const o of outs) expect(o).toMatch(/^We left early (to beat traffic|beat traffic)\.$/)
  })

  it('never deletes when deleteOk is false', () => {
    const outs = outputsAcrossSeeds('The results were significant.', { densityThreshold: 1 })
    for (const o of outs) expect(o).toMatch(/^The results were \w+\.$/)
  })
})

describe('phrases — seeded RNG', () => {
  it('is deterministic for a given seed', () => {
    const a = swap('We delve into a robust plan in the realm of art.', { seed: 77 })
    const b = swap('We delve into a robust plan in the realm of art.', { seed: 77 })
    expect(a).toBe(b)
  })

  it('different seeds can pick different replacements', () => {
    const outs = outputsAcrossSeeds('A robust plan.')
    expect(outs).toContain('A strong plan.')
    expect(outs).toContain('A solid plan.')
  })

  it('produces identical changes for identical seeds', () => {
    const a = run('We delve into a robust plan.', { seed: 5 })
    const b = run('We delve into a robust plan.', { seed: 5 })
    expect(a.changes).toEqual(b.changes)
  })

  it('works without an explicit rng in ctx (falls back to the seed)', () => {
    const a = rewritePhrases('We leverage it.', { options: { seed: 3 } })
    const b = rewritePhrases('We leverage it.', { options: { seed: 3 } })
    expect(a.text).toBe(b.text)
    expect(a.text).toBe('We use it.')
  })
})

describe('phrases — protected spans are skipped', () => {
  const spans = t => findProtectedSpans(t, { protectedWords: ['Plainwrite'] })

  it('never rewrites inside quotes', () => {
    expect(swap('He said "we delve into it" and left.')).toBe('He said "we delve into it" and left.')
  })

  it('never rewrites inside inline code', () => {
    expect(swap('Run `delve into` please.')).toBe('Run `delve into` please.')
  })

  it('never rewrites inside a fenced code block', () => {
    const src = 'Before.\n```\ndelve into\n```\nAfter.'
    expect(swap(src)).toBe(src)
  })

  it('never rewrites a user-supplied protected word', () => {
    expect(findMarkers('Plainwrite delves in.', spans('Plainwrite delves in.'), null)
      .some(m => m.text.toLowerCase() === 'plainwrite')).toBe(false)
    expect(swap('Plainwrite delves in.')).toMatch(/^Plainwrite (digs|explores) in\.$/)
  })

  it('never rewrites inside a URL', () => {
    expect(swap('See https://example.com/delve-into for more.'))
      .toBe('See https://example.com/delve-into for more.')
  })

  it('findMarkers drops matches that touch a protected span', () => {
    const text = 'delve into "delve into" delve into'
    const markers = findMarkers(text, spans(text), null)
    expect(markers).toHaveLength(2)
    expect(markers[0].start).toBe(0)
    expect(markers[1].start).toBe(text.length - 'delve into'.length)
  })
})

describe('phrases — paragraphs & markers', () => {
  it('findParagraphs splits on blank lines', () => {
    const text = 'one\n\ntwo\n\n\nthree'
    const p = findParagraphs(text)
    expect(p).toHaveLength(3)
    expect(text.slice(p[0].start, p[0].end)).toBe('one')
    expect(text.slice(p[1].start, p[1].end)).toBe('two')
    expect(text.slice(p[2].start, p[2].end)).toBe('three')
  })

  it('findMarkers returns non-overlapping matches in document order', () => {
    const text = 'We delve into the realm of art and leverage it.'
    const markers = findMarkers(text, [], null)
    expect(markers.length).toBeGreaterThan(1)
    for (let i = 1; i < markers.length; i++) {
      expect(markers[i].start).toBeGreaterThanOrEqual(markers[i - 1].end)
    }
  })

  it('respects the tiers option', () => {
    const text = 'We delve into it. It is a game-changer.'
    expect(findMarkers(text, [], ['A']).every(m => m.entry.tier === 'A')).toBe(true)
    expect(findMarkers(text, [], ['C']).every(m => m.entry.tier === 'C')).toBe(true)
    // Tier A only: "game-changer" (C) must survive.
    expect(swap(text, { tiers: ['A'] })).toMatch(/^We (dig|explore) into it\. It is a game-changer\.$/)
  })
})

describe('phrases — edge cases', () => {
  it('handles empty and non-string input', () => {
    expect(rewritePhrases('', {}).text).toBe('')
    expect(rewritePhrases(null, {}).text).toBe('')
    expect(rewritePhrases(undefined, {}).text).toBe('')
  })

  it('returns no changes when nothing matches', () => {
    const r = run('The cat sat on the mat.')
    expect(r.changes).toEqual([])
    expect(r.text).toBe('The cat sat on the mat.')
  })

  it('stamps every change record with the phrases stage', () => {
    const r = run('We delve into the realm of art.')
    expect(r.changes.length).toBeGreaterThan(0)
    for (const c of r.changes) expect(c.rule.stage).toBe('phrases')
  })
})

// ===========================================================================
// Shared invariants — phrase fixtures run through the same runner as cleanup
// ===========================================================================

// [input, options, expectedOutput]
// Fixtures deliberately use single-replacement entries (or assert-tolerant
// patterns are avoided) so the expected output does not depend on the seed.
const FIXTURES = [
  // --- single words, always fire ---
  ['We leverage the data.', {}, 'We use the data.'],
  ['It leverages the data.', {}, 'It uses the data.'],
  ['Leveraging the data helps.', {}, 'Using the data helps.'],
  ['They leveraged the data.', {}, 'They used the data.'],
  ['A robust plan.', { seed: 1 }, 'A solid plan.'],
  ['The realms of gold.', { seed: 2 }, 'The fields of gold.'],
  ['An intricate pattern.', { seed: 3 }, 'A complex pattern.'],
  ['We utilize it.', {}, 'We use it.'],
  ['She elucidated the point.', {}, 'She explained the point.'],

  // --- phrases ---
  ['It was a pivotal moment.', {}, 'It was a turning point.'],
  ['The bridge serves as a link.', { seed: 4 }, 'The bridge works as a link.'],
  ['In order to win, we commence.', { seed: 5 }, 'To win, we begin.'],
  ['At the end of the day, it works.', { seed: 6 }, 'Ultimately, it works.'],
  ['When it comes to cost, it is fine.', { seed: 7 }, 'For cost, it is fine.'],
  ['It is a treasure trove.', { seed: 8 }, 'It is a goldmine.'],

  // --- templates ---
  ['Diet plays a pivotal role in health.', { seed: 9 }, 'Diet matters for health.'],
  ['In the ever-evolving landscape of medicine, things change.', { seed: 10 }, 'In medicine, things change.'],

  // --- deletion ---
  ['It is important to note that the sky is blue.', { seed: 11 }, 'The sky is blue.'],

  // --- capitalization ---
  ['LEVERAGE THE DATA.', {}, 'USE THE DATA.'],

  // --- density rule ---
  ['The results were significant.', {}, 'The results were significant.'],
  ['We looked across the field.', {}, 'We looked across the field.'],
  ['A significant shift across the framework.', { seed: 12 }, 'A big shift over the system.'],
  ['Dense: delve into significant results across the study.', { seed: 13 }, 'Dense: look at big results over the study.'],

  // --- protected spans ---
  ['He said "we delve into it" and left.', {}, 'He said "we delve into it" and left.'],
  ['Run `delve into` please.', {}, 'Run `delve into` please.'],
  ['See https://example.com/delve-into for more.', {}, 'See https://example.com/delve-into for more.'],

  // --- tiers ---
  ['We delve into it. It is a game-changer.', { tiers: ['A'], seed: 14 }, 'We dig into it. It is a game-changer.'],

  // --- no-ops ---
  ['The cat sat on the mat.', {}, 'The cat sat on the mat.'],
  ['', {}, ''],
]

invariantSuite('phrases', FIXTURES, (input, opts) => run(input, opts))
