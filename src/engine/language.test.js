import { describe, expect, it } from 'vitest'
import { detectLanguage, ENGLISH_ONLY_STAGES, prepareLanguageOptions } from './language.js'

describe('simple language routing', () => {
  it('recognizes Spanish from character and stopword signals', () => {
    expect(detectLanguage('El equipo y la ciudad tienen una historia importante.').isEnglish).toBe(false)
  })

  it('recognizes a non-Latin script even in a short sample', () => {
    expect(detectLanguage('这是一个很好的例子').isEnglish).toBe(false)
  })

  it('leaves English stages available for an English sample', () => {
    expect(detectLanguage('The team is working on the next step because it matters.').code).toBe('en')
  })

  it('skips only English-language stages for non-English text, keeping cleanup toggle intact', () => {
    const prepared = prepareLanguageOptions('El equipo y la ciudad tienen una historia importante.', {
      stages: { normalize: true, cleanup: true, phrases: true },
      synonyms: true,
    })
    expect(prepared.language.code).toBe('es')
    expect(prepared.options.stages.cleanup).toBe(true)
    for (const stage of ENGLISH_ONLY_STAGES) expect(prepared.options.stages[stage]).toBe(false)
    expect(prepared.options.synonyms).toBe(false)
  })
})
