import { describe, it, expect } from 'vitest'
import { addTransitions } from './transitions.js'
import { makeRng } from './rng.js'
import { invariantSuite } from './testInvariants.js'

const DEFAULT_SEED = 1234

function run(input, opts = {}) {
  const seed = opts.seed ?? DEFAULT_SEED
  return addTransitions(input, {
    options: opts,
    rng: makeRng(seed),
    protectedWords: opts.protectedWords || [],
  })
}

function rewrite(input, opts = {}) {
  return run(input, opts).text
}

describe('transitions — sentence-opening connectors', () => {
  it('removes an unnecessary opener and capitalizes the next word', () => {
    // Seed 2 selects removal for the second opener.
    expect(rewrite('The first point stands. Additionally, the next point helps.', { seed: 0 }))
      .toBe('The first point stands. The next point helps.')
  })

  it('does not delete contrast or cause; it retains or uses a fitting alternative', () => {
    const outputs = []
    for (let seed = 0; seed < 20; seed++) {
      outputs.push(rewrite('The forecast looked clear. However, rain arrived.', { seed }))
    }
    for (const output of outputs) {
      expect(output).toMatch(/(?:However,\s+|But )rain arrived\./)
      expect(output).not.toBe('The forecast looked clear. Rain arrived.')
    }
  })

  it('rotates connectors that occur more than twice into plain alternatives', () => {
    const out = rewrite(
      'Moreover, one. Moreover, two. Moreover, three. Moreover, four.',
      { seed: 10 },
    )
    expect(out).not.toMatch(/Moreover[^.]*three|Moreover[^.]*four/)
    expect(out).toContain('Also, three.')
    expect(out).toContain('And four.')
  })

  it('removes only about half of eligible remaining openers, reproducibly', () => {
    const input = [
      'Moreover, first.', 'Furthermore, second.', 'Additionally, third.',
      'In addition, fourth.', 'Overall, fifth.', 'Ultimately, sixth.',
      'Notably, seventh.', 'In conclusion, eighth.',
    ].join('\n')
    const a = rewrite(input, { seed: 81 })
    const b = rewrite(input, { seed: 81 })
    expect(a).toBe(b)
    const remaining = (a.match(/(?:Moreover|Furthermore|Additionally|In addition|Overall|Ultimately|Notably|In conclusion),/g) || []).length
    expect(remaining).toBeGreaterThanOrEqual(3)
    expect(remaining).toBeLessThanOrEqual(5)
  })

  it('does not alter connectors in headings, list items, or quoted spans', () => {
    const input = [
      '# However, a heading',
      '- Moreover, a list item',
      '1. Additionally, a numbered item',
      'The quote was “Furthermore, this still stands.”',
    ].join('\n')
    expect(rewrite(input, { seed: 2 })).toBe(input)
  })

  it('keeps quoted and list-item connectors protected even when quote toggles are off', () => {
    const quoted = '"Additionally, this is quoted."'
    expect(rewrite(quoted, { seed: 0, protect: { doubleQuote: false } })).toBe(quoted)
    const bullet = '• Furthermore, a bullet item'
    expect(rewrite(bullet, { seed: 0 })).toBe(bullet)
  })

  it('recognizes the listed multiword openers and avoids subordinate uses', () => {
    expect(rewrite('In addition, this helps.', { seed: 0 })).toBe('This helps.')
    expect(rewrite('In addition to cost, time matters.', { seed: 2 }))
      .toBe('In addition to cost, time matters.')
    expect(rewrite('However you frame it, the point remains.', { seed: 2 }))
      .toBe('However you frame it, the point remains.')
  })

  it('detects every requested sentence-opening connector', () => {
    const connectors = [
      'Moreover', 'Furthermore', 'Additionally', 'In addition', 'However',
      'Overall', 'Ultimately', 'Consequently', 'Notably', 'In conclusion', 'In summary',
    ]
    for (const connector of connectors) {
      const input = `${connector}, this point stands.`
      const outputs = Array.from({ length: 20 }, (_, seed) => rewrite(input, { seed }))
      expect(outputs.some(output => output !== input), connector).toBe(true)
      if (connector === 'However') {
        for (const output of outputs) expect(output).toMatch(/^(?:However,\s+|But )this point stands\.$/)
      }
      if (connector === 'Consequently') {
        for (const output of outputs) expect(output).toMatch(/^(?:Consequently,\s+|So, )this point stands\.$/)
      }
    }
  })

  it('records every applied edit with the transitions stage id', () => {
    const result = run('First. Additionally, second.', { seed: 0 })
    expect(result.changes.length).toBeGreaterThan(0)
    for (const change of result.changes) {
      expect(change.rule).toEqual({ stage: 'transitions', id: expect.any(String) })
    }
  })
})

const FIXTURES = [
  ['The first point stands. Additionally, the next point helps.', { seed: 0 }, 'The first point stands. The next point helps.'],
  ['The forecast looked clear. However, rain arrived.', { seed: 0 }, 'The forecast looked clear. But rain arrived.'],
  ['Moreover, one. Moreover, two. Moreover, three. Moreover, four.', { seed: 1 }, 'Moreover, one. Two. Also, three. And four.'],
  ['# However, a heading\n- Moreover, a list item\n1. Additionally, a numbered item', { seed: 2 }, '# However, a heading\n- Moreover, a list item\n1. Additionally, a numbered item'],
  ['The quote was “Furthermore, this still stands.”', { seed: 2 }, 'The quote was “Furthermore, this still stands.”'],
  ['In addition to cost, time matters.', { seed: 2 }, 'In addition to cost, time matters.'],
  ['The plain sentence stays.', { seed: 2 }, 'The plain sentence stays.'],
  ['', { seed: 2 }, ''],
]

invariantSuite('transitions', FIXTURES, (input, opts) => run(input, opts))
