// language.js — intentionally simple routing heuristic, not a translation or
// language-identification model. English-only stages are skipped when signals
// point to a different language.

const STOPWORDS = {
  en: new Set('a about after all also an and are as at be because been before between both but by can could did do does for from had has have he her here him his how i if in into is it its may more most no not of on one or our out she so some than that the their them then there these they this those through to too up was we were what when where which who will with would you your'.split(' ')),
  es: new Set('a al algo como con cuando de del desde donde el ella ellas ellos en entre era es esta este esto fue ha hasta la las le les lo los más me mi muy no nos o para pero por que se sin sobre su sus también te tiene todo tu un una uno y ya'.split(' ')),
  fr: new Set('à au aux avec ce ces dans de des elle en et être il ils la le les leur lui ma mais me même mes moi mon ne nos notre nous ou par pas pour que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous'.split(' ')),
  de: new Set('aber als am an auch auf aus bei bin bis das dass dein dem den der des die dies doch du durch ein eine einer einem einen es für hat haben hier ich im in ist ja kein mit nach nicht noch nur oder sein sie sind so über um und uns von vor war was wie wir zu zum zur'.split(' ')),
  pt: new Set('a ao aos aquela aquele as até com como da das de dela dele depois do dos e ela elas ele eles em entre era essa esse esta este eu foi há isso isto já mais mas me mesmo meu minha muito na não nas nem no nos nossa o os ou para pela pelo por quando que quem se sem seu sua também tem um uma você'.split(' ')),
}
export function detectLanguage(text) {
  const source = String(text || '')
  const letters = (source.match(/[\p{L}]/gu) || [])
  const latinLetters = (source.match(/\p{Script=Latin}/gu) || []).length
  const nonLatinShare = letters.length ? (letters.length - latinLetters) / letters.length : 0
  if (nonLatinShare >= 0.25) {
    return { code: 'non-en', isEnglish: false, confidence: Math.min(0.99, 0.65 + nonLatinShare * 0.34) }
  }
  const words = (source.toLowerCase().match(/[\p{L}]+/gu) || [])
  if (words.length < 3) return { code: 'unknown', isEnglish: true, confidence: 0 }

  const scores = Object.entries(STOPWORDS).map(([code, stopwords]) => ({
    code,
    hits: words.reduce((sum, word) => sum + (stopwords.has(word) ? 1 : 0), 0),
    distinct: new Set(words.filter(word => stopwords.has(word))).size,
  })).sort((a, b) => b.hits - a.hits || b.distinct - a.distinct)
  const best = scores[0]
  const english = scores.find(score => score.code === 'en')
  const shortSample = words.length <= 8
  const minimumEvidence = shortSample ? 1 : Math.max(2, Math.ceil(words.length * 0.035))
  const distinctEvidence = shortSample ? 1 : 2
  if (best.code !== 'en' && best.hits >= minimumEvidence && best.hits > english.hits && best.distinct >= distinctEvidence) {
    return { code: best.code, isEnglish: false, confidence: Math.min(0.99, best.hits / Math.max(1, words.length)) }
  }
  if (english.hits >= minimumEvidence && english.distinct >= distinctEvidence) {
    return { code: 'en', isEnglish: true, confidence: Math.min(0.99, english.hits / Math.max(1, words.length)) }
  }
  return { code: 'unknown', isEnglish: true, confidence: 0 }
}

export const ENGLISH_ONLY_STAGES = Object.freeze(['phrases', 'transitions', 'contractions', 'rhythm', 'synonyms'])

export function prepareLanguageOptions(text, options = {}) {
  const language = detectLanguage(text)
  const effectiveOptions = { ...options, stages: { ...(options.stages || {}) } }
  if (!language.isEnglish) {
    for (const stage of ENGLISH_ONLY_STAGES) effectiveOptions.stages[stage] = false
    effectiveOptions.synonyms = false
  }
  return { language, options: effectiveOptions }
}
