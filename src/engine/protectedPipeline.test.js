import { describe, expect, it } from 'vitest'
import { humanize } from './index.js'
import { findProtectedSpans } from './protected.js'
import { makeRng } from './rng.js'

const FRAGMENTS = [
  'The design is important to the team.',
  'We are able to offer a clear result.',
  'It is important to note that useful work continues.',
  'The outcome is significant and easy to follow.',
  'Although the method is simple, the result is crucial.',
]
const IMMUTABLE = [
  '“We utilize the 42 key features.”',
  '`It is important to note that code stays exactly as written.`',
  '```js\nconst  answer  = 42; // keep spacing\n```',
  'https://example.com/path?q=42',
  '(Smith, 2021)',
  '[17]',
  '$99.95',
  '2024-10-05',
]

describe('whole-pipeline protected-span property', () => {
  it('preserves generated protected spans byte-for-byte through every stage', () => {
    const random = makeRng(84021)
    for (let sample = 0; sample < 40; sample++) {
      const parts = []
      for (let i = 0; i < 3; i++) {
        parts.push(FRAGMENTS[Math.floor(random() * FRAGMENTS.length)])
        parts.push(IMMUTABLE[Math.floor(random() * IMMUTABLE.length)])
      }
      const input = parts.join(sample % 2 ? '  ' : '\n')
      const protectedSpans = findProtectedSpans(input)
      const result = humanize(input, {
        seed: sample + 1,
        intensity: 'strong',
        formal: true,
        synonyms: true,
        replaceDashes: true,
        protect: {
          codeBlock: false, inlineCode: false, doubleQuote: false, singleQuote: false,
          url: false, email: false, citation: false, number: false, userWord: false,
        },
      })
      let cursor = 0
      for (const span of protectedSpans) {
        const original = input.slice(span.start, span.end)
        const location = result.output.indexOf(original, cursor)
        expect(location, `protected ${span.type} in sample ${sample}: ${original}`).toBeGreaterThanOrEqual(0)
        cursor = location + original.length
      }
    }
  })
})
