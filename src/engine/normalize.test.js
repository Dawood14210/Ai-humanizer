import { describe, expect, it } from 'vitest'
import { normalize } from './normalize.js'

describe('normalize stage', () => {
  it('normalizes original-text whitespace once and emits no no-op edits', () => {
    const input = '  one\t  two\r\n\r\n\r\nthree  '
    const result = normalize(input)
    expect(result.text).toBe('one two\n\nthree')
    expect(result.changes.length).toBeGreaterThan(0)
    expect(normalize(result.text).changes).toEqual([])
  })

  it('does not rewrite quote, code, URL, citation, or number spans even if protection toggles are false', () => {
    const protectedContent = [
      '“Quoted   text.”', '`code   value`', '```\nraw   code\n```',
      'https://example.com/a?q=42', '[1]', '(Lee, 2024)', '42.5',
    ]
    const input = `  lead   ${protectedContent.join(' / ')}   tail  `
    const result = normalize(input, {
      options: { protect: Object.fromEntries(['codeBlock', 'inlineCode', 'doubleQuote', 'singleQuote', 'url', 'email', 'citation', 'number', 'userWord'].map(key => [key, false])) },
    })
    for (const span of protectedContent) expect(result.text).toContain(span)
  })
})
