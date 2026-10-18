// testInvariants.js — the shared invariant runner used by every stage's tests.
//
// Not shipped in the app bundle: only *.test.js files import it.
//
// TWO INVARIANTS, checked against every fixture:
//
//   1. Position integrity — for each change record,
//        output.slice(start, end) === replacement
//      and a pure deletion (replacement === '') must have start === end.
//
//   2. Replay integrity — applying the change records back onto the ORIGINAL
//      input reproduces the output byte-for-byte. Records carry additive
//      inputStart/inputEnd metadata (the contract's start/end stay
//      output-relative) so the replay is unambiguous.
//
// Fixtures are [input, options, expectedOutput] triples.

import { describe, it, expect } from 'vitest'

/**
 * Re-apply change records onto the original input.
 * Throws if two records overlap, which would make the replay ambiguous.
 */
export function replay(input, changes) {
  const ordered = [...changes].sort(
    (a, b) => (a.inputStart - b.inputStart) || (a.inputEnd - b.inputEnd)
  )
  let out = ''
  let cursor = 0
  for (const c of ordered) {
    if (c.inputStart < cursor) {
      throw new Error(`overlapping change records: ${JSON.stringify(c)} at cursor ${cursor}`)
    }
    out += input.slice(cursor, c.inputStart)
    out += c.replacement
    cursor = c.inputEnd
  }
  out += input.slice(cursor)
  return out
}

/** Invariant 1 + record-shape checks, for one stage's output. */
export function assertChangeInvariants(text, changes, stage) {
  expect(Array.isArray(changes)).toBe(true)
  for (const c of changes) {
    expect(typeof c.original).toBe('string')
    expect(typeof c.replacement).toBe('string')
    expect(c.rule).toEqual({ stage, id: expect.any(String) })
    expect(typeof c.start).toBe('number')
    expect(typeof c.end).toBe('number')
    expect(c.start).toBeGreaterThanOrEqual(0)
    expect(c.end).toBeGreaterThanOrEqual(c.start)
    expect(c.end).toBeLessThanOrEqual(text.length)

    // The record must describe the output at its own positions.
    expect(text.slice(c.start, c.end)).toBe(c.replacement)
    // A pure deletion is a zero-width range.
    if (c.replacement === '') expect(c.start).toBe(c.end)
  }
}

/**
 * Register the invariant suite for one stage.
 *
 * @param {string} stage     stage name, e.g. 'cleanup'
 * @param {Array<[string, object, string]>} fixtures  [input, options, expected]
 * @param {(input:string, opts:object) => {text:string, changes:Array}} run
 */
export function invariantSuite(stage, fixtures, run) {
  describe(`${stage} — invariants (position integrity + replay)`, () => {
    it.each(fixtures)('%# — %j', (input, opts, expected) => {
      const r = run(input, opts)

      // Expected output.
      expect(r.text).toBe(expected)

      // Invariant 1.
      assertChangeInvariants(r.text, r.changes, stage)

      // Invariant 2.
      expect(replay(input, r.changes)).toBe(r.text)

      // Changing the text must always be accounted for by a record.
      if (r.text !== input) expect(r.changes.length).toBeGreaterThan(0)
    })
  })
}
