// synonyms.js — curated, local, rule-based substitutions. The dictionary is
// bundled with the browser app; no WordNet or remote lexical service is used.
// Every candidate is found on the original sentence, and a single applyEdits
// call applies the selected, non-overlapping edits.
// Signature: (text, ctx) => { text, changes }
// Stage id: "synonyms" (opt in with options.synonyms: true)

import { applyEdits } from './edits.js'
import { findProtectedSpans, forceImmutableProtection, overlapsProtectedSpans } from './protected.js'
import { makeRng } from './rng.js'
import { tokenizeSentences } from './rhythm.js'
import dictionary from './data/synonyms.json'

const INTENSITY = { light: 0.3, medium: 0.6, strong: 0.9 }
const SUBJECTS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'these', 'those', 'there'])
const OBJECTS = new Set(['me', 'you', 'him', 'her', 'it', 'us', 'them'])
const DETERMINERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her',
  'its', 'our', 'their', 'some', 'any', 'many', 'few', 'several', 'each', 'every',
  'another', 'both', 'much', 'enough', 'one', 'two', 'three',
])
const PREPOSITIONS = new Set([
  'about', 'above', 'across', 'after', 'against', 'among', 'around', 'at', 'before',
  'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'by', 'despite', 'during',
  'for', 'from', 'in', 'inside', 'into', 'near', 'of', 'off', 'on', 'onto', 'out',
  'outside', 'over', 'through', 'to', 'toward', 'under', 'until', 'upon', 'with', 'within',
  'without', 'and', 'but', 'or', 'nor', 'so', 'yet',
])
const AUXILIARIES = new Set([
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did',
  'have', 'has', 'had', 'can', 'could', 'may', 'might', 'must', 'shall', 'should',
  'will', 'would',
])
const LINKING_VERBS = new Set([
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'become', 'became',
  'seem', 'seems', 'seemed', 'look', 'looks', 'looked', 'feel', 'feels', 'felt',
  'remain', 'remains', 'remained', 'sound', 'sounds', 'sounded', 'appear', 'appears', 'appeared',
])
const DEGREE_WORDS = new Set(['very', 'quite', 'rather', 'too', 'so', 'more', 'most', 'less', 'least', 'fairly'])
const VERB_HINTS = new Set([
  'add', 'answer', 'ask', 'be', 'become', 'begin', 'bring', 'build', 'call', 'carry',
  'change', 'check', 'choose', 'clean', 'close', 'come', 'cook', 'create', 'cut',
  'decide', 'deliver', 'describe', 'develop', 'discuss', 'do', 'draw', 'drink', 'drive',
  'eat', 'end', 'explain', 'feel', 'find', 'finish', 'fix', 'follow', 'get', 'give',
  'go', 'grow', 'help', 'hold', 'improve', 'include', 'keep', 'know', 'learn', 'leave',
  'like', 'listen', 'live', 'look', 'make', 'mean', 'meet', 'move', 'need', 'notice',
  'offer', 'open', 'pay', 'play', 'provide', 'read', 'receive', 'reduce', 'remain',
  'remember', 'return', 'say', 'see', 'send', 'show', 'sit', 'sleep', 'speak', 'spend',
  'start', 'stay', 'stop', 'study', 'support', 'take', 'talk', 'teach', 'tell', 'think',
  'try', 'turn', 'understand', 'use', 'visit', 'wait', 'walk', 'want', 'watch', 'wear',
  'win', 'work', 'write',
])
const COMMON_NOUNS = new Set([
  'answer', 'book', 'car', 'child', 'city', 'company', 'cost', 'day', 'dog', 'error',
  'example', 'family', 'friend', 'group', 'house', 'idea', 'job', 'language', 'letter',
  'man', 'method', 'money', 'name', 'number', 'office', 'paper', 'person', 'place',
  'plan', 'problem', 'question', 'reason', 'report', 'result', 'road', 'school', 'system',
  'task', 'team', 'thing', 'time', 'tool', 'town', 'woman', 'word', 'work', 'year',
])

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const RULES_BY_SURFACE = new Map()
for (const entry of dictionary.entries || []) {
  for (const [form, surface] of Object.entries(entry.inflections?.source || {})) {
    if (typeof surface !== 'string' || surface.length === 0) continue
    const key = surface.toLowerCase()
    const rules = RULES_BY_SURFACE.get(key) || []
    rules.push({ entry, form })
    RULES_BY_SURFACE.set(key, rules)
  }
}
const SURFACES = [...RULES_BY_SURFACE.keys()].sort((a, b) => b.length - a.length)
const WORD_RE = SURFACES.length
  ? new RegExp(`\\b(?:${SURFACES.map(escapeRegExp).join('|')})\\b`, 'gi')
  : /(?!)/g

const VERB_SURFACES = new Set()
const ADJECTIVE_SURFACES = new Set()
const NOUN_SURFACES = new Set()
for (const entry of dictionary.entries || []) {
  const target = entry.pos === 'verb' ? VERB_SURFACES
    : entry.pos === 'adjective' ? ADJECTIVE_SURFACES
      : entry.pos === 'noun' ? NOUN_SURFACES
        : null
  if (target) {
    for (const surface of Object.values(entry.inflections?.source || {})) target.add(surface.toLowerCase())
  }
}

function getSentenceIndex(sentences, position) {
  return sentences.findIndex(sentence => position >= sentence.start && position < sentence.end)
}

function isHeadingOrList(text, sentence) {
  const lineStart = text.lastIndexOf('\n', sentence.start - 1) + 1
  const lineEndAt = text.indexOf('\n', sentence.start)
  const line = text.slice(lineStart, lineEndAt < 0 ? text.length : lineEndAt)
  return /^\s{0,3}#{1,6}\s+/.test(line) || /^\s*(?:[-*+•]|\d+[.)])\s+/.test(line)
}

function tokenizeContext(text, sentence, start, end) {
  const local = text.slice(sentence.start, sentence.end)
  const wordRe = /[A-Za-z]+(?:'[A-Za-z]+)?/g
  let previous = '', beforePrevious = '', beforeBeforePrevious = '', next = '', afterNext = ''
  const nextWords = []
  let match
  while ((match = wordRe.exec(local)) !== null) {
    const absoluteStart = sentence.start + match.index
    const absoluteEnd = absoluteStart + match[0].length
    if (absoluteEnd <= start) {
      beforeBeforePrevious = beforePrevious
      beforePrevious = previous
      previous = match[0].toLowerCase()
    } else if (absoluteStart >= end) {
      nextWords.push(match[0].toLowerCase())
    }
  }
  next = nextWords[0] || ''
  afterNext = nextWords[1] || ''
  return { previous, beforePrevious, beforeBeforePrevious, next, afterNext }
}

function isSubjectCandidate(word, prior, prior2) {
  if (!word) return false
  if (SUBJECTS.has(word)) return true
  if (DETERMINERS.has(word) || ADJECTIVE_SURFACES.has(word)) return false
  if (DETERMINERS.has(prior) || (prior2 && DETERMINERS.has(prior2))) return true
  if (NOUN_SURFACES.has(word) || COMMON_NOUNS.has(word) || (word.endsWith('s') && word.length > 2)) return true
  return !PREPOSITIONS.has(word) && !AUXILIARIES.has(word) && !DEGREE_WORDS.has(word)
    && !['not', 'never', 'also', 'still', 'then', 'very', 'often', 'usually'].includes(word)
}

function isVerbContext(context, form) {
  const { previous, beforePrevious, next, afterNext } = context
  let subject = SUBJECTS.has(previous)
  if (!subject && previous && !AUXILIARIES.has(previous)) {
    subject = isSubjectCandidate(previous, beforePrevious, context.beforeBeforePrevious)
  }
  if (AUXILIARIES.has(previous)) subject = isSubjectCandidate(beforePrevious, context.beforeBeforePrevious, '')
  if (['not', 'never'].includes(previous) && AUXILIARIES.has(beforePrevious)) {
    subject = isSubjectCandidate(context.beforeBeforePrevious || '', '', '')
  }
  if (!subject && !previous) {
    // Sentence-initial imperatives have no written subject, but a direct object
    // pronoun makes the verb reading clear ("Assist us").
    subject = OBJECTS.has(next)
  }
  if (!subject) return false
  if (LINKING_VERBS.has(previous) && form === 'base') return false
  if ((previous === 'have' || previous === 'has' || previous === 'had') && form !== 'past') return false
  if ((previous === 'am' || previous === 'is' || previous === 'are' || previous === 'was' || previous === 'were') && form !== '-ing' && form !== 'past') return false
  if (next && (next === 'is' || next === 'are' || next === 'was' || next === 'were')) return false
  if (afterNext && next === 'to' && !['want', 'need', 'try', 'plan'].includes(previous)) return false
  return true
}

function isNounContext(context, sentenceStart) {
  const { previous, beforePrevious, next } = context
  if (DETERMINERS.has(previous) || DEGREE_WORDS.has(previous)) return true
  if (ADJECTIVE_SURFACES.has(previous)) return true
  if (PREPOSITIONS.has(previous) && !['and', 'but', 'or'].includes(previous)) return true
  if (VERB_SURFACES.has(previous) || VERB_HINTS.has(previous)) return true
  if (AUXILIARIES.has(next) || next === 'of' || next === 'to' || next === 'for' || next === 'with' || !next) return true
  if (sentenceStart && (VERB_SURFACES.has(next) || VERB_HINTS.has(next))) return true
  if (beforePrevious && DETERMINERS.has(beforePrevious)) return true
  return false
}

function isAdjectiveContext(context, sentenceStart) {
  const { previous, beforePrevious, next } = context
  if (LINKING_VERBS.has(previous) || DEGREE_WORDS.has(previous)) return true
  if (sentenceStart && (NOUN_SURFACES.has(next) || COMMON_NOUNS.has(next))) return true
  if (DETERMINERS.has(previous) && (NOUN_SURFACES.has(next) || COMMON_NOUNS.has(next))) return true
  if (DETERMINERS.has(beforePrevious) && (NOUN_SURFACES.has(next) || COMMON_NOUNS.has(next))) return true
  return false
}

function isAdverbContext(context, sentenceStart) {
  const { previous, next } = context
  if (sentenceStart && next) return true
  return VERB_SURFACES.has(previous) || VERB_HINTS.has(previous)
    || ADJECTIVE_SURFACES.has(previous) || VERB_SURFACES.has(next) || VERB_HINTS.has(next)
    || DEGREE_WORDS.has(previous)
}

function hasPartOfSpeechContext(entry, context, sentenceStart, form) {
  if (entry.pos === 'verb') return isVerbContext(context, form)
  if (entry.pos === 'noun') return isNounContext(context, sentenceStart)
  if (entry.pos === 'adjective') return isAdjectiveContext(context, sentenceStart)
  if (entry.pos === 'adverb') return isAdverbContext(context, sentenceStart)
  return false
}

function applyCapitalization(source, target) {
  if (source.length > 0 && source === source.toUpperCase() && /[A-Z]/.test(source)) return target.toUpperCase()
  if (/^[A-Z]/.test(source)) return target.charAt(0).toUpperCase() + target.slice(1).toLowerCase()
  return target.toLowerCase()
}

function replacementFor(entry, form, rng) {
  const options = entry.replacements || []
  if (options.length === 0) return ''
  const selected = options.length === 1 ? options[0] : options[Math.floor(rng() * options.length) % options.length]
  const forms = entry.inflections?.replacements?.[selected]
  return forms?.[form] || forms?.base || selected
}

/**
 * Apply a curated word substitution to at most one eligible word per sentence.
 * The stage is opt-in: pass `options.synonyms: true` to enable it.
 */
export function swapSynonyms(text, ctx = {}) {
  if (typeof text !== 'string' || text.length === 0) return { text: typeof text === 'string' ? text : '', changes: [] }
  const options = ctx.options || {}
  if (options.synonyms !== true) return { text, changes: [] }

  const probability = typeof options.intensity === 'number'
    ? Math.max(0, Math.min(1, options.intensity))
    : (INTENSITY[options.intensity] ?? INTENSITY.medium)
  const rng = typeof ctx.rng === 'function'
    ? ctx.rng
    : makeRng(Number.isFinite(options.seed) ? options.seed : 0x9e3779b9)
  const spans = findProtectedSpans(text, {
    protectedWords: Array.isArray(ctx.protectedWords) ? ctx.protectedWords : [],
    protect: forceImmutableProtection(options.protect),
  })
  const sentences = tokenizeSentences(text)
  const edits = []
  const handledSentences = new Set()

  WORD_RE.lastIndex = 0
  let match
  while ((match = WORD_RE.exec(text)) !== null) {
    const start = match.index
    const end = start + match[0].length
    const sentenceIndex = getSentenceIndex(sentences, start)
    if (sentenceIndex < 0 || handledSentences.has(sentenceIndex)) continue
    const sentence = sentences[sentenceIndex]
    if (isHeadingOrList(text, sentence)) continue
    if (overlapsProtectedSpans(start, end, spans)) continue

    const prefix = text.slice(sentence.start, start)
    const atSentenceStart = /^[ \t\u00A0]*$/.test(prefix)
    const allCapsSentence = sentence.text.length > 0 && sentence.text === sentence.text.toUpperCase()
    if (/^[A-Z]/.test(match[0]) && !atSentenceStart && !allCapsSentence) continue // likely a proper noun

    const candidates = RULES_BY_SURFACE.get(match[0].toLowerCase()) || []
    const context = tokenizeContext(text, sentence, start, end)
    let chosen = null
    for (const candidate of candidates) {
      if (!hasPartOfSpeechContext(candidate.entry, context, atSentenceStart, candidate.form)) continue
      chosen = candidate
      break
    }
    if (!chosen || rng() >= probability) continue

    const replacement = replacementFor(chosen.entry, chosen.form, rng)
    const cased = applyCapitalization(match[0], replacement)
    if (!cased || cased === match[0]) continue

    edits.push({
      start,
      end,
      original: match[0],
      replacement: cased,
      rule: `synonym-${chosen.entry.word}`,
    })
    handledSentences.add(sentenceIndex)
  }

  const result = applyEdits(text, edits, 'synonyms', { excludedChanges: ctx.excludedChanges })
  return { text: result.text, changes: result.changes, copied: result.copied }
}

export const SYNONYM_DICTIONARY = dictionary
