import { describe, it, expect } from 'vitest'
import { cleanup } from './cleanup.js'
import { humanize } from './index.js'

// Helper: run cleanup with a default ctx and just return the output string.
function clean(input, opts = {}) {
  return cleanup(input, { options: opts, protectedWords: opts.protectedWords || [] }).text
}

// Helper: return { text, changes } for assertions on records.
function cleanResult(input, opts = {}) {
  return cleanup(input, { options: opts, protectedWords: opts.protectedWords || [] })
}

describe('cleanup — whitespace and typography', () => {
  it('collapses runs of spaces and trims edges', () => {
    expect(clean('  hello   world  \t ')).toBe('hello world')
  })

  it('normalizes line endings and collapses 3+ newlines to a paragraph break', () => {
    expect(clean('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('removes space before punctuation and adds a single space after ,;: when missing', () => {
    expect(clean('Stop , go ; now :go.')).toBe('Stop, go; now: go.')
  })

  it('converts curly quotes to ASCII quotes', () => {
    expect(clean('\u201Chello\u201D')).toBe('"hello"')
    expect(clean('it\u2019s')).toBe("it's")
    expect(clean('em\u2014dash and en\u2013dash')).toBe('em--dash and en-dash')
    expect(clean('a\u2026b')).toBe('a...b')
  })

  it('collapses repeated punctuation', () => {
    expect(clean('Wow!!!')).toBe('Wow!')
    expect(clean('Wait...')).toBe('Wait...') // 3 dots is fine
    expect(clean('Wait......')).toBe('Wait...') // 6 dots → ellipsis
    expect(clean('What?!')).toBe('What!') // mixed → last char (strongest)
    expect(clean('Hello... world!!!')).toBe('Hello... world!')
  })
})

describe('cleanup — formal mode (strip emojis)', () => {
  it('leaves emojis alone when formal is off', () => {
    expect(clean('Hello 👋 world 😀')).toBe('Hello 👋 world 😀')
  })

  it('strips emojis when formal is on', () => {
    expect(clean('Hello 👋 world 😀', { formal: true })).toBe('Hello world')
  })

  it('does NOT strip an emoji that lives inside a quoted (protected) span', () => {
    // Because "He said 👋" is a protected double-quoted span, the emoji must be kept.
    expect(clean('He said "hi 👋" and left.', { formal: true })).toBe('He said "hi 👋" and left.')
  })

  it('does NOT strip an emoji inside inline code', () => {
    expect(clean('See the `const 🔥 = 1` example.', { formal: true })).toBe('See the `const 🔥 = 1` example.')
  })
})

describe('cleanup — removeFormatting', () => {
  it('strips Markdown bold markers while preserving inner text', () => {
    expect(clean('This is **bold** text', { removeFormatting: true })).toBe('This is bold text')
  })

  it('strips Markdown italic markers (* and _)', () => {
    expect(clean('This is *italic* text', { removeFormatting: true })).toBe('This is italic text')
    expect(clean('An _italic_ phrase.', { removeFormatting: true })).toBe('An italic phrase.')
  })

  it('strips bold+italic together', () => {
    expect(clean('**Bold** and *italic* and __bold__', { removeFormatting: true }))
      .toBe('Bold and italic and bold')
  })

  it('does not strip markdown markers inside inline code', () => {
    expect(clean('See `**not bold**`.', { removeFormatting: true })).toBe('See `**not bold**`.')
  })
})

describe('cleanup — chatbot leftovers', () => {
  it('removes sentence-initial "Certainly!" opener', () => {
    expect(clean('Certainly! Here is the answer. The sky is blue.'))
      .toBe('The sky is blue.')
  })

  it('removes "Sure, here is ..." line opener', () => {
    expect(clean('Sure, here is the list: apples, bananas, oranges. Enjoy.'))
      .toBe('Enjoy.')
  })

  it('removes "I hope this helps!" closer', () => {
    expect(clean('The sky is blue. I hope this helps!'))
      .toBe('The sky is blue.')
  })

  it('removes "Let me know if you\'d like..." closer', () => {
    expect(clean('Set the timer. Let me know if you\'d like further details.'))
      .toBe('Set the timer.')
  })

  it('removes "Feel free to ask..."', () => {
    expect(clean('Use the form below. Feel free to ask if you have questions.'))
      .toBe('Use the form below.')
  })

  it('removes "As an AI language model" self-id sentence', () => {
    expect(clean('As an AI language model, I cannot do that. But here is info about cats.'))
      .toBe('But here is info about cats.')
  })

  it('removes "Thank you!" closer', () => {
    expect(clean('Add the flour. Thank you!')).toBe('Add the flour.')
  })

  it('removes "Great question!" opener', () => {
    expect(clean('Great question! The answer is 42.')).toBe('The answer is 42.')
  })
})

describe('cleanup — protected spans are never touched', () => {
  it('preserves URLs verbatim', () => {
    expect(clean('See https://example.com/a?b=1   for docs.'))
      .toBe('See https://example.com/a?b=1 for docs.')
  })

  it('preserves emails verbatim', () => {
    expect(clean('Email  a@b.io   for help.')).toBe('Email a@b.io for help.')
  })

  it('preserves inline code verbatim (including internal spaces)', () => {
    // Inside backticks spaces should NOT be collapsed.
    expect(clean('Use `let   x   =   1` please.'))
      .toBe('Use `let   x   =   1` please.')
  })

  it('preserves fenced code blocks verbatim', () => {
    const input = 'See:\n```\nconst   x   = 1\n```\nDone.'
    expect(clean(input)).toBe('See:\n```\nconst   x   = 1\n```\nDone.')
  })

  it('preserves citations like [1] and (Smith, 2020)', () => {
    // Citations include parens & commas; ensure punctuation-spacing rules don't reflow them.
    expect(clean('A claim is made  (Smith,2020)  [1].'))
      .toBe('A claim is made (Smith,2020) [1].')
  })

  it('preserves user-supplied protected words verbatim', () => {
    expect(clean('Plainwrite   is   cool.', { protectedWords: ['Plainwrite'] }))
      .toBe('Plainwrite is cool.')
  })
})

describe('cleanup — edge cases', () => {
  it('handles empty string', () => {
    const r = cleanResult('')
    expect(r.text).toBe('')
    expect(r.changes).toEqual([])
  })

  it('handles whitespace-only input', () => {
    expect(clean('    \n\n   ')).toBe('')
  })

  it('every edit produces a change record (non-empty changes array for edits)', () => {
    const r = cleanResult('  Hello   world!!  ', {})
    expect(r.text).toBe('Hello world!')
    expect(r.changes.length).toBeGreaterThan(0)
    // Every change record has the proper shape.
    for (const c of r.changes) {
      expect(c).toHaveProperty('original')
      expect(c).toHaveProperty('replacement')
      expect(c.rule.stage).toBe('cleanup')
      expect(typeof c.rule.id).toBe('string')
      expect(typeof c.start).toBe('number')
      expect(typeof c.end).toBe('number')
      // Position ranges must be valid within the output string.
      expect(c.start).toBeGreaterThanOrEqual(0)
      expect(c.end).toBeGreaterThanOrEqual(c.start)
      expect(c.end).toBeLessThanOrEqual(r.text.length)
    }
  })
})

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------
//
// Every fixture below is run through two checks:
//
//   1. Position integrity — for each change record,
//        output.slice(start, end) === replacement
//      and a pure deletion (replacement === '') must have start === end.
//
//   2. Replay integrity — applying the change records back onto the ORIGINAL
//      input reproduces the output exactly. Records carry additive
//      inputStart/inputEnd metadata (the contract's start/end stay
//      output-relative) so the replay is unambiguous and order-independent.

/** Re-apply change records onto the original input. */
function replay(input, changes) {
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

// [input, options, expectedOutput]
const FIXTURES = [
  // --- whitespace / typography ---
  ['  hello   world  \t ', {}, 'hello world'],
  ['a\n\n\n\nb', {}, 'a\n\nb'],
  ['Stop , go ; now :go.', {}, 'Stop, go; now: go.'],
  ['\u201Chello\u201D', {}, '"hello"'],
  ["it\u2019s", {}, "it's"],
  ['em\u2014dash and en\u2013dash', {}, 'em--dash and en-dash'],
  ['a\u2026b', {}, 'a...b'],
  ['Wow!!!', {}, 'Wow!'],
  ['Wait...', {}, 'Wait...'],
  ['Wait......', {}, 'Wait...'],
  ['What?!', {}, 'What!'],
  ['Hello... world!!!', {}, 'Hello... world!'],
  ['a\u00A0\u00A0b', {}, 'a b'],

  // --- emojis ---
  ['Hello \u{1F44B} world \u{1F600}', {}, 'Hello \u{1F44B} world \u{1F600}'],
  ['Hello \u{1F44B} world \u{1F600}', { formal: true }, 'Hello world'],
  ['He said "hi \u{1F44B}" and left.', { formal: true }, 'He said "hi \u{1F44B}" and left.'],
  ['See the `const \u{1F525} = 1` example.', { formal: true }, 'See the `const \u{1F525} = 1` example.'],

  // --- markdown ---
  ['This is **bold** text', { removeFormatting: true }, 'This is bold text'],
  ['This is *italic* text', { removeFormatting: true }, 'This is italic text'],
  ['An _italic_ phrase.', { removeFormatting: true }, 'An italic phrase.'],
  ['**Bold** and *italic* and __bold__', { removeFormatting: true }, 'Bold and italic and bold'],
  ['See `**not bold**`.', { removeFormatting: true }, 'See `**not bold**`.'],

  // --- chatbot leftovers ---
  ['Certainly! Here is the answer. The sky is blue.', {}, 'The sky is blue.'],
  ['Sure, here is the list: apples, bananas, oranges. Enjoy.', {}, 'Enjoy.'],
  ['The sky is blue. I hope this helps!', {}, 'The sky is blue.'],
  ["Set the timer. Let me know if you'd like further details.", {}, 'Set the timer.'],
  ['Use the form below. Feel free to ask if you have questions.', {}, 'Use the form below.'],
  ['As an AI language model, I cannot do that. But here is info about cats.', {}, 'But here is info about cats.'],
  ['Add the flour. Thank you!', {}, 'Add the flour.'],
  ['Great question! The answer is 42.', {}, 'The answer is 42.'],

  // --- protected spans ---
  ['See https://example.com/a?b=1   for docs.', {}, 'See https://example.com/a?b=1 for docs.'],
  ['Email  a@b.io   for help.', {}, 'Email a@b.io for help.'],
  ['Use `let   x   =   1` please.', {}, 'Use `let   x   =   1` please.'],
  ['See:\n```\nconst   x   = 1\n```\nDone.', {}, 'See:\n```\nconst   x   = 1\n```\nDone.'],
  ['A claim is made  (Smith,2020)  [1].', {}, 'A claim is made (Smith,2020) [1].'],
  ['Plainwrite   is   cool.', { protectedWords: ['Plainwrite'] }, 'Plainwrite is cool.'],

  // --- edge cases ---
  ['', {}, ''],
  ['    \n\n   ', {}, ''],
  ['  Hello   world!!  ', {}, 'Hello world!'],
  ['Hello.World', {}, 'Hello. World'],
  ['A.  I hope this helps. B.', {}, 'A. B.'],
  ['Great question!\n\nReal content here.', {}, 'Real content here.'],
  ['Real content.\n\nLet me know if you would like more.', {}, 'Real content.'],
  [
    'Sure! I hope this helps. Real content stays.',
    {},
    'Real content stays.',
  ],
]

describe('cleanup — invariants (position integrity + replay)', () => {
  it.each(FIXTURES)('%# — %j', (input, opts, expected) => {
    const r = cleanup(input, { options: opts, protectedWords: opts.protectedWords || [] })

    // Expected output.
    expect(r.text).toBe(expected)

    // Invariant 1: every change record's positions describe its replacement in
    // the output; a pure deletion is a zero-width range.
    for (const c of r.changes) {
      expect(c.rule).toEqual({ stage: 'cleanup', id: expect.any(String) })
      expect(typeof c.start).toBe('number')
      expect(typeof c.end).toBe('number')
      expect(c.start).toBeGreaterThanOrEqual(0)
      expect(c.end).toBeGreaterThanOrEqual(c.start)
      expect(c.end).toBeLessThanOrEqual(r.text.length)
      expect(r.text.slice(c.start, c.end)).toBe(c.replacement)
      if (c.replacement === '') expect(c.start).toBe(c.end)
    }

    // Invariant 2: replaying the records onto the input reproduces the output.
    expect(replay(input, r.changes)).toBe(r.text)

    // A change must exist whenever the input actually changed.
    if (r.text !== input) expect(r.changes.length).toBeGreaterThan(0)
  })
})

describe('cleanup — protected content survives even when it looks like leftovers', () => {
  it('keeps an emoji AND a chatbot phrase that both live inside quotes', () => {
    const input = 'She said "I hope this helps \u{1F44B}" and left.'
    // formal mode strips emojis; chatbot removal deletes "I hope this helps".
    // Both are inside a protected quoted span, so neither may fire.
    expect(clean(input, { formal: true })).toBe(input)
  })

  it('keeps them inside curly quotes too (curly quotes are normalized, content is not)', () => {
    const input = 'She said \u201CI hope this helps \u{1F44B}\u201D and left.'
    // Only the two curly quote characters change; the emoji and the phrase stay.
    expect(clean(input, { formal: true })).toBe('She said "I hope this helps \u{1F44B}" and left.')
  })

  it('removes the same chatbot phrase when it is NOT inside quotes', () => {
    expect(clean('She left. I hope this helps!')).toBe('She left.')
  })

  it('keeps an emoji inside a fenced code block in formal mode', () => {
    const input = 'Run it:\n```\necho "\u{1F680}"\n```\nDone.'
    expect(clean(input, { formal: true })).toBe(input)
  })
})

describe('cleanup — wired into pipeline and toggleable', () => {
  it('runs cleanup by default and produces a trimmed/collapsed output', () => {
    const r = humanize('  hello   world!!!  ', { seed: 1 })
    expect(r.output).toBe('hello world!')
    expect(r.changes.find(c => c.rule.stage === 'cleanup')).toBeTruthy()
  })

  it('can be disabled via options.stages.cleanup = false', () => {
    // normalize is still on and collapses tabs/spaces/line-endings but does NOT
    // trim-edges or collapse repeated punctuation.
    const r = humanize('  hello   world!!!  ', { seed: 1, stages: { cleanup: false } })
    // normalize trims edges AND collapses spaces; it does NOT touch punctuation,
    // so we expect "hello world!!!" (three ! preserved).
    expect(r.output).toBe('hello world!!!')
  })
})
