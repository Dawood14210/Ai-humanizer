// rhythm.js — varies sentence length and safely unwraps selected paired-negative
// constructions. All edits use offsets from the original stage input and are
// applied exactly once with the shared edit helper.
// Signature: (text, ctx) => { text, changes }
// Stage id: "rhythm"

import { applyEdits } from './edits.js'
import { findProtectedSpans, forceImmutableProtection, overlapsProtectedSpans } from './protected.js'
import { makeRng } from './rng.js'

const CLOSERS = new Set(['"', "'", ')', ']', '}', '\u201D', '\u2019'])
const ABBREVIATIONS = new Set([
  'dr.', 'mr.', 'mrs.', 'ms.', 'prof.', 'sr.', 'jr.', 'st.', 'vs.',
  'e.g.', 'i.e.', 'etc.', 'inc.', 'ltd.', 'no.', 'fig.', 'approx.',
])
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for',
  'from', 'had', 'has', 'have', 'he', 'her', 'here', 'hers', 'him', 'his',
  'i', 'if', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'ours',
  'she', 'that', 'the', 'their', 'theirs', 'them', 'there', 'these', 'they',
  'this', 'those', 'to', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'who', 'why', 'will', 'with', 'you', 'your', 'yours',
])
const SUBJECT_PRONOUNS = new Set([
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'these',
  'those', 'there', 'someone', 'somebody', 'everyone', 'everything',
])
const DETERMINERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his',
  'her', 'its', 'our', 'their', 'each', 'every', 'some', 'many', 'most',
])
const FINITE_VERBS = new Set((
  'am is are was were be been being have has had do does did can could will would '
  + 'should may might must seems seem became become remains remained works worked '
  + 'shows showed helps helped saves saved cuts cut improves improved improves '
  + 'reduced reduces grows grew falls fell rose raises raised runs ran makes made '
  + 'takes took gives gave gets got says said sees saw knows knew finds found '
  + 'uses used matters mattered means meant leads led brings brought comes came '
  + 'leaves left keeps kept holds held feels felt looks looked creates created '
  + 'contains contained includes included supports supported changes changed '
  + 'starts started ends ended increases increased decreases decreased appears '
  + 'appeared produces produced provides provided reports reported moves moved '
  + 'plays played compares compared differs differed connects connected follows '
  + 'followed happens happened costs cost fits fit works worked needs needed '
  + 'wants wanted likes liked runs ran writes wrote reads read builds built '
  + 'tests tested studies studied learns learned learns sends sent spends spent '
  + 'wins won loses lost accepts accepted rejects rejected develops developed '
  + 'proves proved explains explained describes described'
).split(/\s+/))

const NEGATION_RE = /\bnot\s+(?:just|only)\s+(.+?)\s*,?\s+but\s+(?:also\s+)?(.+)$/i
const WORD_RE = /(?:\p{L}+(?:['’.-]\p{L}+)*|\d+(?:[.,]\d+)*)/gu

function readWordCount(value) {
  return (value.match(WORD_RE) || []).length
}

function isUppercaseInitialism(token) {
  return /^(?:[A-Z]\.){2,}$/i.test(token)
}

function nextNonSpace(text, from) {
  let i = from
  while (i < text.length && /\s/.test(text[i])) i++
  return i
}

function periodIsAbbreviation(text, index) {
  if (/\d/.test(text[index - 1] || '') && /\d/.test(text[index + 1] || '')) return true
  if (text[index + 1] === '.') return true // only the last dot in an ellipsis can end a sentence

  let begin = index
  while (begin > 0 && /[A-Za-z.]/.test(text[begin - 1])) begin--
  const token = text.slice(begin, index + 1)
  const lower = token.toLowerCase()
  const after = nextNonSpace(text, index + 1)
  const atEnd = after >= text.length

  if (ABBREVIATIONS.has(lower)) {
    if (atEnd) return false
    // Etc. is often sentence-final before a new capitalized sentence; the
    // remaining abbreviations are overwhelmingly internal (titles, examples).
    if (lower === 'etc.' && /^[A-Z]/.test(text[after])) return false
    return true
  }

  if (isUppercaseInitialism(token)) {
    return !atEnd
  }
  if (/^[A-Z]\.$/.test(token) && !atEnd && /^[A-Z]/.test(text[after])) return true
  return false
}

function isSentenceBoundary(text, index) {
  const char = text[index]
  if (char === '.') return !periodIsAbbreviation(text, index)
  return char === '!' || char === '?'
}

function sentenceEndAfter(text, index) {
  let end = index + 1
  while (end < text.length && CLOSERS.has(text[end])) end++
  return end
}

/**
 * Sentence tokenizer with common abbreviations, decimals, initials and
 * initialisms protected from false stops. Returned offsets exclude whitespace
 * between sentences and preserve every source character in `text`.
 * @returns {Array<{start:number,end:number,text:string,wordCount:number}>}
 */
export function tokenizeSentences(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  const sentences = []
  let start = 0
  let i = 0

  while (i < text.length) {
    if (!isSentenceBoundary(text, i)) {
      i++
      continue
    }
    const end = sentenceEndAfter(text, i)
    const next = nextNonSpace(text, end)
    if (next < text.length && end < text.length && !/\s/.test(text[end])) {
      i++
      continue
    }
    const value = text.slice(start, end)
    if (value.trim()) sentences.push({ start, end, text: value, wordCount: readWordCount(value) })
    start = next
    i = next
  }

  if (start < text.length) {
    const value = text.slice(start)
    if (value.trim()) sentences.push({ start, end: text.length, text: value, wordCount: readWordCount(value) })
  }
  return sentences
}

/** Mean and population standard deviation of tokenized sentence word counts. */
export function sentenceLengthStats(sentences) {
  const lengths = sentences.map(sentence => sentence.wordCount)
  if (lengths.length === 0) return { count: 0, mean: 0, standardDeviation: 0, lengths: [] }
  const mean = lengths.reduce((sum, n) => sum + n, 0) / lengths.length
  const variance = lengths.reduce((sum, n) => sum + ((n - mean) ** 2), 0) / lengths.length
  return { count: lengths.length, mean, standardDeviation: Math.sqrt(variance), lengths }
}

function lineAt(text, position) {
  const start = text.lastIndexOf('\n', position - 1) + 1
  const endAt = text.indexOf('\n', position)
  const end = endAt < 0 ? text.length : endAt
  return { start, end, text: text.slice(start, end) }
}

function isHeadingOrList(text, sentence) {
  const line = lineAt(text, sentence.start)
  if (/^\s{0,3}#{1,6}\s+/.test(line.text)) return true
  if (/^\s*(?:[-*+•]|\d+[.)])\s+/.test(line.text)) return true
  const nextStart = line.end < text.length ? line.end + 1 : -1
  if (nextStart >= 0) {
    const nextEndAt = text.indexOf('\n', nextStart)
    const nextLine = text.slice(nextStart, nextEndAt < 0 ? text.length : nextEndAt)
    if (/^\s*(?:=+|-{3,})\s*$/.test(nextLine)) return true
  }
  return false
}

function normalized(value) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function overlapsProtected(start, end, spans) {
  return overlapsProtectedSpans(start, end, spans)
}

function lockMatchesSentence(lock, sentence, index) {
  if (typeof lock === 'number') return lock === index
  if (typeof lock === 'string') return normalized(lock) === normalized(sentence.text)
  if (lock && typeof lock === 'object' && Number.isFinite(lock.start) && Number.isFinite(lock.end)) {
    return lock.start < sentence.end && lock.end > sentence.start
  }
  return false
}

function isLockedSentence(text, sentence, index, options, ctx) {
  const locks = options.lockedSentences ?? ctx.lockedSentences ?? options.lockedSentenceIndexes
  if (!Array.isArray(locks) && !(locks instanceof Set)) return false
  return Array.from(locks).some(lock => lockMatchesSentence(lock, sentence, index))
}

function firstAlphaUpper(value) {
  const index = value.search(/[A-Za-z]/)
  if (index < 0) return value
  return value.slice(0, index) + value[index].toUpperCase() + value.slice(index + 1)
}

function hasFiniteVerb(words, startAt) {
  for (let i = startAt; i < Math.min(words.length, startAt + 5); i++) {
    const word = words[i].toLowerCase().replace(/[.,;:!?]+$/g, '')
    if (['also', 'never', 'not', 'often', 'still', 'usually'].includes(word)) continue
    if (FINITE_VERBS.has(word) || /(?:s|ed|en)$/.test(word)) return true
  }
  return false
}

/** Conservative subject + finite-predicate heuristic used before splitting. */
export function hasCleanClause(value) {
  const words = value.match(/[\p{L}]+(?:['’][\p{L}]+)?/gu) || []
  if (words.length < 2) return false
  const first = words[0].toLowerCase()
  if (SUBJECT_PRONOUNS.has(first)) return hasFiniteVerb(words, 1)
  if (DETERMINERS.has(first)) return hasFiniteVerb(words, 2)
  // A clause beginning with a finite verb is missing its subject; a proper
  // name or other bare noun can still be the subject of the next verb.
  if (FINITE_VERBS.has(first) || /(?:ed|ing)$/.test(first)) return false
  if (['also', 'quickly', 'slowly', 'then', 'therefore', 'consequently', 'usually', 'often', 'sometimes', 'now', 'still', 'just'].includes(first)) return false
  return hasFiniteVerb(words, 1)
}

function stripClauseThat(value) {
  return value.trim().replace(/^that\s+/i, '').trim()
}

function stripTerminalPunctuation(value) {
  return value.trim().replace(/[.!?]+["'\u201D\u2019)\]]*$/, '').trim()
}

function capSentence(value) {
  return firstAlphaUpper(value.trim())
}

function makeNegationEdit(sentence, negation) {
  const ending = sentence.text.match(/[.!?]+["'\u201D\u2019)\]]*$/)
  const finalPunctuation = ending ? ending[0].match(/[.!?]+/)?.[0] || '.' : '.'
  const closing = ending ? ending[0].slice(finalPunctuation.length) : ''
  const indent = sentence.text.match(/^\s*/)?.[0] || ''
  const first = capSentence(negation.firstClause)
  const second = capSentence(negation.secondClause)
  const replacement = `${indent}${first}. ${second}${finalPunctuation}${closing}`
  return {
    start: sentence.start,
    end: sentence.end,
    original: sentence.text,
    replacement,
    rule: 'rhythm-negation-rewrite',
  }
}

function isSubjectPhrase(value) {
  const words = value.match(/[\p{L}]+(?:['’][\p{L}]+)?/gu) || []
  if (words.length < 1 || words.length > 5 || /[,;:!?]/.test(value)) return false
  const first = words[0].toLowerCase()
  return SUBJECT_PRONOUNS.has(first) || DETERMINERS.has(first) || /^[A-Z]/.test(value.trim())
}

function isPredicateFragment(value) {
  const first = (value.match(/[\p{L}]+/u) || [''])[0].toLowerCase()
  return FINITE_VERBS.has(first) || /(?:s|ed|en)$/.test(first)
}

function detectNegation(sentence) {
  const untrimmedBody = stripTerminalPunctuation(sentence.text)
  const leading = sentence.text.match(/^\s*/)?.[0].length || 0
  const body = untrimmedBody.slice(leading)
  const match = NEGATION_RE.exec(body)
  if (!match) return null
  let firstClause = stripClauseThat(stripTerminalPunctuation(match[1]))
  let secondClause = stripClauseThat(stripTerminalPunctuation(match[2]))
  let clean = hasCleanClause(firstClause) && hasCleanClause(secondClause)

  // Coordinated predicates often share a subject: "The tool not only saves
  // time but also cuts costs." Expand that short shared prefix into two
  // complete clauses before deciding whether the construction is safe to unwrap.
  if (!clean) {
    const subject = body.slice(0, match.index).trim()
    const endsInAuxiliary = /\b(?:am|is|are|was|were|has|have|had|do|does|did|can|could|will|would|should|may|might|must)$/i.test(subject)
    if (subject && (endsInAuxiliary || (isSubjectPhrase(subject) && isPredicateFragment(firstClause) && isPredicateFragment(secondClause)))) {
      const expandedFirst = `${subject} ${firstClause}`
      const expandedSecond = `${subject} ${secondClause}`
      if (hasCleanClause(expandedFirst) && hasCleanClause(expandedSecond)) {
        firstClause = expandedFirst
        secondClause = expandedSecond
        clean = true
      }
    }
  }

  return {
    match,
    clean,
    firstClause,
    secondClause,
    start: sentence.start + leading + match.index,
    end: sentence.start + leading + match.index + match[0].length,
  }
}

function parenthesesDepth(text, start, position) {
  let depth = 0
  for (let i = start; i < position; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && depth > 0) depth--
  }
  return depth
}

function validSplitPoint(text, sentence, spans) {
  const slice = text.slice(sentence.start, sentence.end)
  const re = /,[ \t\u00A0]+(and|but|so|yet)[ \t\u00A0]+/gi
  let match
  while ((match = re.exec(slice)) !== null) {
    const comma = sentence.start + match.index
    const conjunctionEnd = sentence.start + re.lastIndex
    if (overlapsProtected(comma, conjunctionEnd, spans)) continue
    if (parenthesesDepth(text, sentence.start, comma) > 0) continue

    const before = slice.slice(0, match.index).trim()
    const after = slice.slice(re.lastIndex).trim()
    if (!hasCleanClause(before) || !hasCleanClause(after)) continue
    return {
      before,
      after,
      conjunction: match[1].toLowerCase(),
    }
  }
  return null
}

function splitEdit(sentence, candidate) {
  const first = capSentence(stripTerminalPunctuation(candidate.before)).replace(/[,:;]+$/, '').trim()
  const secondClause = lowercaseInitial(stripTerminalPunctuation(candidate.after))
  const second = `${candidate.conjunction.charAt(0).toUpperCase()}${candidate.conjunction.slice(1)} ${secondClause}`
  const originalEnd = sentence.text.match(/[.!?]+["'\u201D\u2019)\]]*$/)
  const ending = originalEnd ? originalEnd[0] : '.'
  const punctuation = ending.match(/[.!?]+/)?.[0] || '.'
  const closing = ending.slice(punctuation.length)
  const indent = sentence.text.match(/^\s*/)?.[0] || ''
  return {
    start: sentence.start,
    end: sentence.end,
    original: sentence.text,
    replacement: `${indent}${first}. ${second}${punctuation}${closing}`,
    rule: 'rhythm-split',
  }
}

function sentenceTokens(sentence) {
  return (sentence.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [])
    .map(word => word.toLowerCase())
    .filter(word => !STOP_WORDS.has(word))
}

function closelyRelated(first, second) {
  const initial = second.trim().match(/^([\p{L}]+)/u)?.[1]?.toLowerCase() || ''
  if (['it', 'they', 'this', 'these', 'those', 'he', 'she', 'we', 'that', 'but', 'however', 'yet'].includes(initial)) return true
  const firstWords = new Set(sentenceTokens(first))
  return sentenceTokens(second).some(word => firstWords.has(word))
}

function removeSentenceLead(value) {
  return value.trim().replace(/^(?:but|however|yet|and|so)[,\s]+/i, '').trim()
}

function lowercaseInitial(value) {
  const match = /^(\s*)([\p{L}]+)/u.exec(value)
  if (!match) return value
  const word = match[2]
  const lower = word.toLowerCase()
  if (word === word.toUpperCase() || lower === 'i') return value
  if (!SUBJECT_PRONOUNS.has(lower) && !DETERMINERS.has(lower) && !['and', 'but', 'so', 'yet', 'also', 'then', 'there'].includes(lower)) return value
  return `${match[1]}${lower}${value.slice(match[0].length)}`
}

function mergeEdit(text, first, second, firstIndex, secondIndex, rng) {
  const firstText = first.text.trim()
  const secondText = second.text.trim()
  if (/[!?]["'\u201D\u2019)\]]*$/.test(firstText)) return null
  if (/["'\u201D\u2019]$/.test(firstText)) return null
  if (!/[.](["'\u201D\u2019)\]]*)$/.test(firstText)) return null
  if (!/[.!?]["'\u201D\u2019)\]]*$/.test(secondText)) return null
  if (!closelyRelated(firstText, secondText)) return null

  const contrast = /^(?:but|however|yet)\b/i.test(secondText)
  const secondBody = lowercaseInitial(removeSentenceLead(stripTerminalPunctuation(secondText)))
  if (!secondBody) return null
  const firstBody = firstText.replace(/[.](["'\u201D\u2019)\]]*)$/, '$1').trim()
  const ending = secondText.match(/[.!?]+["'\u201D\u2019)\]]*$/)?.[0] || '.'

  let replacement
  if (contrast) {
    replacement = `${firstBody}, but ${secondBody}${ending}`
  } else if (rng() < 0.5) {
    replacement = `${firstBody}; ${secondBody}${ending}`
  } else {
    replacement = `${firstBody}, and ${secondBody}${ending}`
  }
  const indent = first.text.match(/^\s*/)?.[0] || ''
  return {
    start: first.start,
    end: second.end,
    original: text.slice(first.start, second.end),
    replacement: `${indent}${replacement}`,
    rule: 'rhythm-merge',
    sentenceIndexes: [firstIndex, secondIndex],
  }
}

function shouldUseLowDeviation(stats) {
  return stats.count > 0 && stats.standardDeviation <= Math.max(4, stats.mean * 0.3)
}

/**
 * Vary sentence length, and safely rewrite selected paired-negative clauses.
 * `options.lockedSentences` accepts exact sentence strings, zero-based sentence
 * indexes, or `{start,end}` ranges in the original stage input.
 */
export function adjustRhythm(text, ctx = {}) {
  if (typeof text !== 'string' || text.length === 0) return { text: '', changes: [] }

  const options = ctx.options || {}
  const rng = typeof ctx.rng === 'function'
    ? ctx.rng
    : makeRng(Number.isFinite(options.seed) ? options.seed : 0x9e3779b9)
  const protectedSpans = findProtectedSpans(text, {
    protectedWords: Array.isArray(ctx.protectedWords) ? ctx.protectedWords : [],
    protect: forceImmutableProtection(options.protect),
  })
  const sentences = tokenizeSentences(text)
  const stats = sentenceLengthStats(sentences)
  const edits = []
  const occupied = new Set()

  // Negation patterns are handled first and reserve their sentence so no split
  // or merge can overlap their rewrite (or their flagged, unchanged record).
  sentences.forEach((sentence, index) => {
    if (isHeadingOrList(text, sentence) || isLockedSentence(text, sentence, index, options, ctx)) return
    const negation = detectNegation(sentence)
    if (!negation) return
    occupied.add(index)
    if (negation.clean && !overlapsProtected(sentence.start, sentence.end, protectedSpans)) {
      edits.push(makeNegationEdit(sentence, negation))
    } else {
      edits.push({
        start: negation.start,
        end: negation.end,
        original: text.slice(negation.start, negation.end),
        replacement: text.slice(negation.start, negation.end),
        rule: 'rhythm-flagged-negation',
      })
    }
  })

  if (shouldUseLowDeviation(stats)) {
    const splitCandidates = []
    const longThreshold = Math.max(16, stats.mean * 0.9)
    sentences.forEach((sentence, index) => {
      if (occupied.has(index) || isHeadingOrList(text, sentence) || isLockedSentence(text, sentence, index, options, ctx)) return
      if (sentence.wordCount < longThreshold) return
      const candidate = validSplitPoint(text, sentence, protectedSpans)
      if (candidate) splitCandidates.push({ sentence, index, candidate })
    })

    // Keep selected operations disjoint. Split decisions are made first;
    // potential merges touching those source sentences are dropped below.
    for (const item of splitCandidates) {
      if (rng() < 0.5) {
        edits.push(splitEdit(item.sentence, item.candidate))
        occupied.add(item.index)
      }
    }

    const shortThreshold = Math.min(12, Math.max(5, stats.mean))
    for (let i = 0; i < sentences.length - 1; i++) {
      const first = sentences[i]
      const second = sentences[i + 1]
      if (occupied.has(i) || occupied.has(i + 1)) continue
      if (isHeadingOrList(text, first) || isHeadingOrList(text, second)) continue
      if (isLockedSentence(text, first, i, options, ctx) || isLockedSentence(text, second, i + 1, options, ctx)) continue
      if (first.wordCount > shortThreshold || second.wordCount > shortThreshold) continue
      if (/\n\s*\n/.test(text.slice(first.end, second.start))) continue
      const edit = mergeEdit(text, first, second, i, i + 1, rng)
      if (!edit) continue
      if (overlapsProtected(edit.start, edit.end, protectedSpans)) continue
      if (rng() < 0.5) {
        edits.push(edit)
        occupied.add(i)
        occupied.add(i + 1)
      }
    }
  }

  const result = applyEdits(text, edits, 'rhythm', { excludedChanges: ctx.excludedChanges })
  return { text: result.text, changes: result.changes, copied: result.copied }
}
