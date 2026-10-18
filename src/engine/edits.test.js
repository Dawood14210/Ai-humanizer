import { describe, expect, it } from 'vitest'
import { applyEdits, mapCopiedRange } from './edits.js'

describe('edit-coordinate helpers', () => {
  it('maps only ranges that were copied without a later rewrite', () => {
    const first = applyEdits('alpha beta gamma', [{
      start: 6, end: 10, original: 'beta', replacement: 'B', rule: 'rule-b',
    }], 'stage-one')
    expect(mapCopiedRange(first.copied, 0, 5)).toEqual({ start: 0, end: 5 })
    expect(mapCopiedRange(first.copied, 0, 10)).toBeNull()
    expect(mapCopiedRange(first.copied, 11, 16)).toEqual({ start: 8, end: 13 })
  })

  it('replay-excludes exactly one rule at its stage-input position', () => {
    const source = 'keep this phrase'
    const edit = { start: 5, end: 9, original: 'this', replacement: 'that', rule: 'replace-this' }
    const changed = applyEdits(source, [edit], 'phrases')
    const replay = applyEdits(source, [edit], 'phrases', {
      excludedChanges: [{
        stage: 'phrases', id: 'replace-this', inputStart: 5, inputEnd: 9,
      }],
    })
    expect(changed.text).toBe('keep that phrase')
    expect(replay.text).toBe(source)
    expect(replay.changes).toEqual([])
    expect(replay.copied).toEqual([{ inStart: 0, inEnd: source.length, outStart: 0 }])
  })
})
