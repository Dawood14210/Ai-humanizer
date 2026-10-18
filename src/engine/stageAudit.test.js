import { describe, expect, it } from 'vitest'
import { humanize } from './index.js'

const STAGES = ['normalize', 'cleanup', 'phrases', 'transitions', 'contractions', 'rhythm', 'synonyms']

function runOnly(stage, text, options = {}) {
  const stages = Object.fromEntries(STAGES.map(key => [key, key === stage]))
  return humanize(text, { seed: 10, ...options, stages }).output
}

describe('stage audit — meaning and content safeguards', () => {
  it('normalization changes spacing without dropping lexical content', () => {
    const input = '  The  42 samples\tremained—stable.  '
    const output = runOnly('normalize', input)
    for (const token of ['The', '42', 'samples', 'remained—stable.']) expect(output).toContain(token)
  })

  it('cleanup preserves meaningful acknowledgements and requests instead of dropping their clauses', () => {
    const input = 'Thank you for reviewing my application. Please let me know if you need another reference.'
    expect(runOnly('cleanup', input)).toBe(input)
  })

  it('phrase substitutions retain the sentence subject and object around a changed marker', () => {
    const output = runOnly('phrases', 'The team will delve into the results.')
    expect(output).toMatch(/^The team will (?:(?:dig|explore) into|look at) the results\.$/)
  })

  it('transition cleanup keeps every substantive clause after changing repeated openers', () => {
    const input = [
      'Furthermore, alpha remains.',
      'Furthermore, beta improves.',
      'Furthermore, gamma continues.',
      'Furthermore, delta matters.',
    ].join('\n')
    const output = runOnly('transitions', input)
    for (const word of ['alpha', 'beta', 'gamma', 'delta']) expect(output).toContain(word)
  })

  it('contractions preserve negation and the action in the sentence', () => {
    const output = runOnly('contractions', 'We do not need to change the result.', { intensity: 'strong' })
    expect(output).toBe("We don't need to change the result.")
  })

  it('rhythm rewrites paired-negative clauses without dropping either claim', () => {
    const output = runOnly('rhythm', 'The tool not only saves time but also cuts costs.')
    expect(output).toBe('The tool saves time. The tool cuts costs.')
  })

  it('synonyms stay opt-in and report only a local replacement when enabled', () => {
    const input = 'They assist families.'
    expect(humanize(input, { seed: 0, intensity: 'strong' }).output).toBe(input)
    const output = runOnly('synonyms', input, { synonyms: true, intensity: 'strong' })
    expect(output).toMatch(/^They (?:aid|help) families\.$/)
    expect(output).toContain('They ')
    expect(output).toContain(' families.')
  })

  it('every individual stage leaves immutable quote, code, URL, email, citation, and number spans intact', () => {
    const protectedText = [
      '“It is important to note that quoted marker 123.”',
      '`utilize(42)`',
      '```js\nconst answer = 42;\n```',
      'https://example.com/path?x=42',
      'Jane.Doe@example.com',
      '(Smith, 2020)',
      '$19.95',
    ]
    const input = `The surrounding draft can change.\n${protectedText.join('\n')}`
    for (const stage of STAGES) {
      const output = runOnly(stage, input, {
        formal: true,
        removeFormatting: true,
        replaceDashes: true,
        synonyms: true,
        intensity: 'strong',
      })
      for (const fragment of protectedText) {
        expect(output, `${stage} changed protected span ${fragment}`).toContain(fragment)
      }
    }
  })
})
