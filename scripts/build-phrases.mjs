#!/usr/bin/env node
// build-phrases.mjs — generates src/engine/data/phrases.json
//
// The committed JSON is the source of truth for the engine; this script exists
// so the (very explicit, very verbose) entry records can be maintained from
// compact tables, and so the plain-word whitelist is validated at build time:
// it throws if any replacement word is not an already-curated plain word.
//
// Usage: node scripts/build-phrases.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const VERSION = '1.4.0'
const LAST_REVIEWED = '2026-10-18'

// ---------------------------------------------------------------------------
// Curated plain-word whitelist.
//
// Hand-written BEFORE the entries below, deliberately: it is the constraint
// that keeps replacements plain. The generator throws if a replacement uses a
// word that is not here, and phrases.test.js re-checks the committed JSON.
// ---------------------------------------------------------------------------
const PLAIN_WORDS = `
a about after again against all almost also although always among an and another
any anyone anything are area areas around as at away back bad base based be
because become been before begin behind being below best better between big
bigger bit both break bring broad brought build building but buy by call came
can car care careful carefully case cause center central change changes
changing check child children city class clear clearly close come common
company completely condition consider continue control cost could count country
course cover create cross cut day days deal deep deeply detail detailed did
different difficult do does doing done down drive during each early earn easy
effect effort eight either end energy enough enter equal even ever every
everyone everything example expect eye face fact fall family far feel felt few
field find fine fire first five follow food foot for force form found four free
friend from front full fully game gave general get girl give given go goal goes
going good got great green ground group grow guess guide had hair half hand
happen hard has have he head hear heard heart held help her here high higher him
his hold home hope horse hot hour house how however huge human hundred idea if
important in include including indeed inside instead into is it its itself just
keep kept key kind knew know known land language large last late later laugh law
lay lead learn least leave left leg less let level lie life light like line list
little live long look lose lost lot love low made main make man many mark market
mass matter may me mean measure men might mile milk mind minute miss model
modern moment money month more morning most mother move much must my name near
need needed never new news next nice night nine no none north note nothing now
number object of off often old on once one only open or order other others our
out over own page paid paper part party pass past pattern pay people perhaps
period person picture piece place plan plane plant play point poor popular
position possible post power present problem provide public pull push put
question quick quickly quite race rain ran range rate reach read ready real
really reason receive record red region remain remember report result return
rich right ring rise river road rock roll room round rule run said same saw say
scale school science sea season seat second see seem seen self send sent serve
set seven several shall shape share she ship short should show side sight sign
simple simply since sing single sit six size skill sky sleep small so social
some someone something sometimes son song soon sort sound south space speak
special stand star start state stay step still stood stop story street strong
study such sudden summer sun sure surface system table take taken talk task tax
teach tell ten term test than that the their them then there these they thing
think third this those though thought thousand three through thus time tiny to
today together told too took top total touch toward town train tree trip true
try turn two under understand unit until up upon us use used useful usual
usually very view voice wait walk wall want warm was watch water way we wear
week weight well went were west what when where which while who whole whom
whose why wide wife will wind window winter wish with without woman women
wonder word work world would write wrong wrote yard year yes yet you young your
bases beliefs centers drivers fields links methods models paths patterns peaks
principles problems puzzles settings signs splits strongholds tastes tendencies
ways

above adds boost digs digging dug explores exploring explored helps helping
helped eases eased starts starting started begins beginning begins tries trying
tried finds finding determines determined buys buying speeds speeding hurries
hurried leads leading simplifies simplified improves improved grows growing
boosts boosted adds adding builds building handles handling raises raising shows
showing showed stresses stressing represents
representing sums summing rings ringing drives driving applies applying carries
carrying tells telling forms forming covers covering
includes including requires requiring backs backing confirms confirming checks
checking fixes fixing works working speeds explain explains explaining
explained encourage encourages encouraging encouraged earn earns earning earned
gets getting hurry

add added ahead applied apply backed balance began boosting bought breakthrough
bright built carried carry checked closely confirm confirmed creative determine
determining difference dig drove ease easing explore fix fixed formed further
goldmine grew handle handled having highlight highlighted hurrying improve
improving led likely lively makes making naturally newest notable parts path
placed points proof proves raise raised represent represented require required
results shifting simplify simplifying slow smoothly sparked sparking sparks sped
speed stress stressed structure sum summed support tips trend uses using wider
wins

turning basis blend mix blends mixes puzzle problem split divide driver spark
teamwork skill liking taste tendency stronghold sign usefulness method belief
principle link peak low setting essence detailed complex careful thorough solid
smooth whole broad complete basic typical ideal everywhere subtle fine varied
chief relevant model fine worthy firm steady loyal lasting great valuable
essential needed natural main unmatched rare tough tangled obscure specialized
vague shapeless extra repeated unneeded real true notably greatly basically
deeply fully rapidly so later then therefore many several some most can before
after while daily every ultimately obviously finally ends wrap up wrap

`
  .split(/\s+/)
  .filter(Boolean)

const PLAIN = new Set(PLAIN_WORDS)

// ---------------------------------------------------------------------------
// Entry builders
// ---------------------------------------------------------------------------

const entries = []
const seenIds = new Set()

function push(entry) {
  if (seenIds.has(entry.id)) throw new Error(`duplicate id: ${entry.id}`)
  seenIds.add(entry.id)
  entries.push(entry)
}

/** Assert every replacement is made only of curated plain words. */
const MISSING = new Set()
function assertPlain(id, text) {
  const tokens = String(text)
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter(Boolean)
  for (const t of tokens) {
    if (!PLAIN.has(t)) MISSING.add(t)
  }
}

/**
 * A single-word entry. `forms` maps each surface form of the marker to an array
 * of replacement forms, positionally parallel to `repl`.
 */
function word(lemma, opts) {
  const {
    pos = 'noun', tier, repl = [], forms = null, pos2, deleteOk = false,
    flagOnly = false, guard = {}, notes = '', id: idOverride,
  } = opts
  const id = idOverride || lemma.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  // Build the explicit per-form inflection map.
  const inflections = {}
  const formMap = forms || { [lemma]: repl }
  for (const [form, replForms] of Object.entries(formMap)) {
    const row = {}
    if (replForms.length !== repl.length) {
      throw new Error(`[${id}] form "${form}" has ${replForms.length} replacement forms but ${repl.length} candidates`)
    }
    replForms.forEach((rf, i) => {
      const base = repl[i]
      assertPlain(id, rf)
      row[base] = rf
    })
    inflections[form] = row
  }
  repl.forEach(r => assertPlain(id, r))

  push({
    id,
    lemma,
    pattern: null,
    type: 'word',
    pos: pos2 || pos,
    inflections,
    replacements: repl,
    deleteOk,
    flagOnly,
    tier,
    source: SOURCES[tier],
    guard: normalizeGuard(guard),
    notes,
  })
}

/** A multi-word phrase entry. Matched literally, whitespace-flexible. */
function phrase(lemma, opts) {
  const {
    pos = 'phrase', tier, repl = [], deleteOk = false, flagOnly = false,
    guard = {}, notes = '', id: idOverride,
  } = opts
  const id = idOverride || lemma.toLowerCase().replace(/[^a-z0-9']+/g, '-').replace(/^-|-$/g, '')
  repl.forEach(r => assertPlain(id, r))
  push({
    id,
    lemma,
    pattern: null,
    type: 'phrase',
    pos,
    inflections: {},
    replacements: repl,
    deleteOk,
    flagOnly,
    tier,
    source: SOURCES[tier],
    guard: normalizeGuard(guard),
    notes,
  })
}

/** A template entry: regex `pattern` with capture groups, rendered from `templates`. */
function template(id, pattern, opts) {
  const { tier, templates = [], deleteOk = false, guard = {}, notes = '' } = opts
  // Validate the regex compiles and count capture groups.
  let groupCount = 0
  try {
    groupCount = new RegExp(pattern + '|').exec('').length - 1
  } catch (e) {
    throw new Error(`[${id}] bad pattern: ${e.message}`)
  }
  for (const t of templates) {
    const placeholders = [...t.matchAll(/\{([XY])\}/g)].map(m => m[1])
    if (placeholders.length !== groupCount) {
      throw new Error(`[${id}] template "${t}" has ${placeholders.length} placeholders but pattern has ${groupCount} groups`)
    }
  }
  push({
    id,
    lemma: null,
    pattern,
    type: 'template',
    pos: 'template',
    inflections: {},
    replacements: [],
    templates,
    deleteOk,
    flagOnly: false,
    tier,
    source: SOURCES[tier],
    guard: normalizeGuard(guard),
    notes,
  })
}

function normalizeGuard(guard) {
  return {
    notBefore: guard.notBefore || [],
    notAfter: guard.notAfter || [],
    notInProtected: true,
  }
}

const SOURCES = {
  A: "Peer-reviewed plain-language / excess-word studies (Garner's Modern English Usage, Plain English Campaign, Plain Writing Act guidance)",
  B: 'Wikipedia: "Signs of AI writing" (essay WP:AISIGNS)',
  C: "Blog-compiled AI-phrase roundups (\"words and phrases ChatGPT overuses\")",
}

// ===========================================================================
// TIER A — peer-reviewed excess-word studies
// ===========================================================================

const A = 'A'

// --- verbs ---------------------------------------------------------------
word('delve', {
  pos: 'verb', tier: A, repl: ['dig', 'explore'],
  forms: {
    delve: ['dig', 'explore'], delves: ['digs', 'explores'],
    delving: ['digging', 'exploring'], delved: ['dug', 'explored'],
  },
  notes: 'Classic AI tell. Rare in ordinary prose; "dig into" or "explore" reads naturally.',
})
word('leverage', {
  pos: 'verb', tier: A, repl: ['use'],
  forms: { leverage: ['use'], leverages: ['uses'], leveraging: ['using'], leveraged: ['used'] },
  notes: 'Corporate verbing of a noun. "Use" is shorter and clearer.',
})
word('foster', {
  pos: 'verb', tier: A, repl: ['encourage'],
  forms: { foster: ['encourage'], fosters: ['encourages'], fostering: ['encouraging'], fostered: ['encouraged'] },
  notes: 'Usually just means encourage or help along.',
})
word('garner', {
  pos: 'verb', tier: A, repl: ['earn', 'get'],
  forms: {
    garner: ['earn', 'get'], garners: ['earns', 'gets'],
    garnering: ['earning', 'getting'], garnered: ['earned', 'got'],
  },
  notes: 'Garnered attention = got attention.',
})
word('elucidate', {
  pos: 'verb', tier: A, repl: ['explain'],
  forms: { elucidate: ['explain'], elucidates: ['explains'], elucidating: ['explaining'], elucidated: ['explained'] },
  notes: 'Plain English Campaign lists it as a needlessly formal synonym of explain.',
})
word('utilize', {
  pos: 'verb', tier: A, repl: ['use'],
  forms: { utilize: ['use'], utilizes: ['uses'], utilizing: ['using'], utilized: ['used'] },
  notes: 'Garner calls utilize "a pompous synonym for use".',
})
word('facilitate', {
  pos: 'verb', tier: A, repl: ['help', 'ease'],
  forms: { facilitate: ['help', 'ease'], facilitates: ['helps', 'eases'], facilitating: ['helping', 'easing'], facilitated: ['helped', 'eased'] },
  notes: 'Facilitate a meeting = run/help a meeting.',
})
word('commence', {
  pos: 'verb', tier: A, repl: ['start', 'begin'],
  forms: { commence: ['start', 'begin'], commences: ['starts', 'begins'], commencing: ['starting', 'beginning'], commenced: ['started', 'began'] },
  notes: 'Formal register; start/begin is preferred in all but legal usage.',
})
word('endeavor', {
  pos: 'verb', tier: A, repl: ['try'],
  forms: { endeavor: ['try'], endeavors: ['tries'], endeavoring: ['trying'], endeavored: ['tried'] },
  notes: 'Try works everywhere endeavor does outside legal writing.',
})
word('ascertain', {
  pos: 'verb', tier: A, repl: ['find', 'determine'],
  forms: { ascertain: ['find', 'determine'], ascertains: ['finds', 'determines'], ascertaining: ['finding', 'determining'], ascertained: ['found', 'determined'] },
  notes: 'Ascertain the cause = find the cause.',
})
word('procure', {
  pos: 'verb', tier: A, repl: ['get', 'buy'],
  forms: { procure: ['get', 'buy'], procures: ['gets', 'buys'], procuring: ['getting', 'buying'], procured: ['got', 'bought'] },
  notes: 'Procure supplies = buy supplies.',
})
word('expedite', {
  pos: 'verb', tier: A, repl: ['speed', 'hurry'],
  forms: { expedite: ['speed', 'hurry'], expedites: ['speeds', 'hurries'], expediting: ['speeding', 'hurrying'], expedited: ['sped', 'hurried'] },
  notes: 'Expedite the order = speed up the order.',
})
word('spearhead', {
  pos: 'verb', tier: A, repl: ['lead'],
  forms: { spearhead: ['lead'], spearheads: ['leads'], spearheading: ['leading'], spearheaded: ['led'] },
  notes: 'Spearhead the effort = lead the effort.',
})
word('streamline', {
  pos: 'verb', tier: A, repl: ['simplify'],
  forms: { streamline: ['simplify'], streamlines: ['simplifies'], streamlining: ['simplifying'], streamlined: ['simplified'] },
  notes: 'Usually means "make simpler / remove steps".',
})
word('optimize', {
  pos: 'verb', tier: A, repl: ['improve'],
  forms: { optimize: ['improve'], optimizes: ['improves'], optimizing: ['improving'], optimized: ['improved'] },
  notes: 'Outside maths/engineering, improve is the honest word.',
})
word('augment', {
  pos: 'verb', tier: A, repl: ['add to', 'boost'],
  forms: { augment: ['add to', 'boost'], augments: ['adds to', 'boosts'], augmenting: ['adding to', 'boosting'], augmented: ['added to', 'boosted'] },
  notes: 'Often a filler intensifier for "improve" or "add to".',
})
word('cultivate', {
  pos: 'verb', tier: A, repl: ['build', 'grow'],
  forms: { cultivate: ['build', 'grow'], cultivates: ['builds', 'grows'], cultivating: ['building', 'growing'], cultivated: ['built', 'grew'] },
  notes: 'Cultivate a relationship = build a relationship.',
})
word('harness', {
  pos: 'verb', tier: A, repl: ['use'],
  forms: { harness: ['use'], harnesses: ['uses'], harnessing: ['using'], harnessed: ['used'] },
  notes: 'Harness the power of = use.',
})
word('elevate', {
  pos: 'verb', tier: A, repl: ['raise'],
  forms: { elevate: ['raise'], elevates: ['raises'], elevating: ['raising'], elevated: ['raised'] },
  notes: 'Elevate the conversation = raise the level of the conversation.',
})
word('illuminate', {
  pos: 'verb', tier: A, repl: ['explain'],
  forms: { illuminate: ['explain'], illuminates: ['explains'], illuminating: ['explaining'], illuminated: ['explained'] },
  notes: 'Figurative use means explain, not light up.',
})
word('underscore', {
  pos: 'verb', tier: A, repl: ['stress'],
  forms: { underscore: ['stress'], underscores: ['stresses'], underscoring: ['stressing'], underscored: ['stressed'] },
  notes: 'Very frequent in AI prose; stress or highlight reads better.',
})
word('showcase', {
  pos: 'verb', tier: A, repl: ['show'],
  forms: { showcase: ['show'], showcases: ['shows'], showcasing: ['showing'], showcased: ['showed'] },
  notes: 'Showcase as a verb is marketing register; show is enough.',
})
word('embody', {
  pos: 'verb', tier: A, repl: ['show', 'represent'],
  forms: { embody: ['show', 'represent'], embodies: ['shows', 'represents'], embodying: ['showing', 'representing'], embodied: ['showed', 'represented'] },
  notes: 'Often used where "is a good example of" is meant.',
})
word('encapsulate', {
  pos: 'verb', tier: A, repl: ['sum up'],
  forms: { encapsulate: ['sum up'], encapsulates: ['sums up'], encapsulating: ['summing up'], encapsulated: ['summed up'] },
  notes: 'Encapsulates the idea = sums up the idea.',
})
word('catalyze', {
  pos: 'verb', tier: A, repl: ['spark', 'drive'],
  forms: { catalyze: ['spark', 'drive'], catalyzes: ['sparks', 'drives'], catalyzing: ['sparking', 'driving'], catalyzed: ['sparked', 'drove'] },
  notes: 'Outside chemistry, spark or drive is clearer.',
})
word('operationalize', {
  pos: 'verb', tier: A, repl: ['apply'],
  forms: { operationalize: ['apply'], operationalizes: ['applies'], operationalizing: ['applying'], operationalized: ['applied'] },
  notes: 'Jargon; "put into practice" or simply apply.',
})
word('implement', {
  pos: 'verb', tier: A, repl: ['carry out', 'do'],
  forms: { implement: ['carry out', 'do'], implements: ['carries out', 'does'], implementing: ['carrying out', 'doing'], implemented: ['carried out', 'did'] },
  notes: 'Implement a plan = carry out a plan.',
})
word('demonstrate', {
  pos: 'verb', tier: A, repl: ['show'],
  forms: { demonstrate: ['show'], demonstrates: ['shows'], demonstrating: ['showing'], demonstrated: ['showed'] },
  notes: 'Results demonstrate = results show.',
})
word('indicate', {
  pos: 'verb', tier: A, repl: ['show'],
  forms: { indicate: ['show'], indicates: ['shows'], indicating: ['showing'], indicated: ['showed'] },
  notes: 'Data indicate = data show.',
})
word('exhibit', {
  pos: 'verb', tier: A, repl: ['show'],
  forms: { exhibit: ['show'], exhibits: ['shows'], exhibiting: ['showing'], exhibited: ['showed'] },
  notes: 'Exhibits a pattern = shows a pattern.',
})
word('possess', {
  pos: 'verb', tier: A, repl: ['have'],
  forms: { possess: ['have'], possesses: ['has'], possessing: ['having'], possessed: ['had'] },
  notes: 'Possesses a quality = has a quality.',
})
word('constitute', {
  pos: 'verb', tier: A, repl: ['form', 'make up'],
  forms: { constitute: ['form', 'make up'], constitutes: ['forms', 'makes up'], constituting: ['forming', 'making up'], constituted: ['formed', 'made up'] },
  notes: 'Constitutes 40% of = makes up 40% of.',
})
word('necessitate', {
  pos: 'verb', tier: A, repl: ['require'],
  forms: { necessitate: ['require'], necessitates: ['requires'], necessitating: ['requiring'], necessitated: ['required'] },
  notes: 'Necessitate = require.',
})
word('substantiate', {
  pos: 'verb', tier: A, repl: ['back up'],
  forms: { substantiate: ['back up'], substantiates: ['backs up'], substantiating: ['backing up'], substantiated: ['backed up'] },
  notes: 'Substantiate a claim = back up a claim.',
})
word('validate', {
  pos: 'verb', tier: A, repl: ['confirm', 'check'],
  forms: { validate: ['confirm', 'check'], validates: ['confirms', 'checks'], validating: ['confirming', 'checking'], validated: ['confirmed', 'checked'] },
  notes: 'Outside therapy/tech jargon, confirm or check is what is meant.',
})
word('rectify', {
  pos: 'verb', tier: A, repl: ['fix'],
  forms: { rectify: ['fix'], rectifies: ['fixes'], rectifying: ['fixing'], rectified: ['fixed'] },
  notes: 'Rectify the error = fix the error.',
})
word('navigate', {
  pos: 'verb', tier: A, repl: ['handle'],
  forms: { navigate: ['handle'], navigates: ['handles'], navigating: ['handling'], navigated: ['handled'] },
  guard: { notAfter: ['to', 'the'] },
  notes: 'Figurative "navigate the complexities" is a strong AI tell; the phrase-level entry handles the common form.',
})

// --- nouns ---------------------------------------------------------------
word('realm', { pos: 'noun', tier: A, repl: ['area', 'field'], forms: { 'realm': ['area', 'field'], 'realms': ['areas', 'fields'] }, notes: 'In the realm of = in.' })
word('tapestry', { pos: 'noun', tier: A, repl: ['mix', 'blend'], forms: { 'tapestry': ['mix', 'blend'], 'tapestries': ['mixes', 'blends'] }, notes: 'A tapestry of = a mix of.' })
word('paradigm', { pos: 'noun', tier: A, repl: ['model', 'pattern'], forms: { 'paradigm': ['model', 'pattern'], 'paradigms': ['models', 'patterns'] }, notes: 'A paradigm for = a model for.' })
word('conduit', { pos: 'noun', tier: A, repl: ['path'], forms: { 'conduit': ['path'], 'conduits': ['paths'] }, notes: 'A conduit for = a path for.' })
word('catalyst', { pos: 'noun', tier: A, repl: ['driver', 'spark'], forms: { 'catalyst': ['driver', 'spark'], 'catalysts': ['drivers', 'sparks'] }, notes: 'A catalyst for = a driver of.' })
word('cornerstone', { pos: 'noun', tier: A, repl: ['basis', 'base'], forms: { 'cornerstone': ['basis', 'base'], 'cornerstones': ['bases', 'bases'] }, notes: 'The cornerstone of = the basis of.' })
word('amalgamation', { pos: 'noun', tier: A, repl: ['mix', 'blend'], forms: { 'amalgamation': ['mix', 'blend'], 'amalgamations': ['mixes', 'blends'] }, notes: 'An amalgamation of = a mix of.' })
word('conglomeration', { pos: 'noun', tier: A, repl: ['mix'], forms: { 'conglomeration': ['mix'], 'conglomerations': ['mixes'] }, notes: 'A conglomeration of = a mix of.' })
word('plethora', { pos: 'noun', tier: A, repl: ['many'], notes: 'A plethora of = many. Note plethora strictly means a harmful excess.' })
word('myriad', { pos: 'noun', tier: A, repl: ['many'], notes: 'A myriad of = many.' })
word('conundrum', { pos: 'noun', tier: A, repl: ['puzzle', 'problem'], forms: { 'conundrum': ['puzzle', 'problem'], 'conundrums': ['puzzles', 'problems'] }, notes: 'A conundrum = a puzzle.' })
word('dichotomy', { pos: 'noun', tier: A, repl: ['split', 'divide'], forms: { 'dichotomy': ['split', 'divide'], 'dichotomies': ['splits', 'splits'] }, notes: 'A false dichotomy = a false split.' })
word('synergy', { pos: 'noun', tier: A, repl: ['teamwork'], notes: 'Buzzword; usually means people working well together.' })
word('prowess', { pos: 'noun', tier: A, repl: ['skill'], notes: 'Technical prowess = skill.' })
word('penchant', { pos: 'noun', tier: A, repl: ['liking', 'taste'], forms: { 'penchant': ['liking', 'taste'], 'penchants': ['tastes', 'tastes'] }, notes: 'A penchant for = a liking for.' })
word('proclivity', { pos: 'noun', tier: A, repl: ['tendency'], forms: { 'proclivity': ['tendency'], 'proclivities': ['tendencies'] }, notes: 'A proclivity for = a tendency to.' })
word('bastion', { pos: 'noun', tier: A, repl: ['stronghold'], forms: { 'bastion': ['stronghold'], 'bastions': ['strongholds'] }, notes: 'A bastion of = a stronghold of.' })
word('harbinger', { pos: 'noun', tier: A, repl: ['sign'], forms: { 'harbinger': ['sign'], 'harbingers': ['signs'] }, notes: 'A harbinger of = a sign of.' })
word('utility', { pos: 'noun', tier: A, repl: ['usefulness'], forms: { 'utility': ['usefulness'], 'utilities': ['usefulness'] }, notes: 'Of limited utility = of limited use.' })
word('modality', { pos: 'noun', tier: A, repl: ['method', 'way'], forms: { 'modality': ['method', 'way'], 'modalities': ['methods', 'ways'] }, notes: 'Treatment modality = treatment method.' })
word('tenet', { pos: 'noun', tier: A, repl: ['belief', 'principle'], forms: { 'tenet': ['belief', 'principle'], 'tenets': ['beliefs', 'principles'] }, notes: 'A core tenet = a core belief.' })
word('underpinning', { pos: 'noun', tier: A, repl: ['basis'], forms: { 'underpinning': ['basis'], 'underpinnings': ['bases'] }, notes: 'The underpinning of = the basis of.' })
word('nexus', { pos: 'noun', tier: A, repl: ['link', 'center'], forms: { 'nexus': ['link', 'center'], 'nexuses': ['links', 'centers'] }, notes: 'A nexus between = a link between.' })
word('zenith', { pos: 'noun', tier: A, repl: ['peak'], forms: { 'zenith': ['peak'], 'zeniths': ['peaks'] }, notes: 'At its zenith = at its peak.' })
word('nadir', { pos: 'noun', tier: A, repl: ['low'], notes: 'At its nadir = at its low point.' })
word('milieu', { pos: 'noun', tier: A, repl: ['setting'], forms: { 'milieu': ['setting'], 'milieus': ['settings'] }, notes: 'A cultural milieu = a setting.' })

// --- adjectives ----------------------------------------------------------
word('intricate', { pos: 'adjective', tier: A, repl: ['detailed', 'complex'], notes: 'Intricate detail = fine detail; often just "complex".' })
word('meticulous', { pos: 'adjective', tier: A, repl: ['careful', 'thorough'], notes: 'Meticulous work = careful work.' })
word('pivotal', { pos: 'adjective', tier: A, repl: ['key', 'central'], guard: { notAfter: ['role'] }, notes: 'Pivotal = key. "Pivotal role" is handled by the template entry.' })
word('commendable', { pos: 'adjective', tier: A, repl: ['good', 'solid'], notes: 'Commendable effort = a good effort.' })
word('seamless', { pos: 'adjective', tier: A, repl: ['smooth'], notes: 'Seamless integration = smooth integration.' })
word('robust', { pos: 'adjective', tier: A, repl: ['strong', 'solid'], notes: 'Robust evidence = strong evidence.' })
word('holistic', { pos: 'adjective', tier: A, repl: ['whole', 'broad'], notes: 'A holistic view = a broad view.' })
word('comprehensive', { pos: 'adjective', tier: A, repl: ['full', 'complete'], notes: 'A comprehensive list = a full list.' })
word('rudimentary', { pos: 'adjective', tier: A, repl: ['basic'], notes: 'Rudimentary version = basic version.' })
word('quintessential', { pos: 'adjective', tier: A, repl: ['typical', 'ideal'], notes: 'The quintessential example = the typical example.' })
word('ubiquitous', { pos: 'adjective', tier: A, repl: ['common', 'everywhere'], notes: 'Ubiquitous = everywhere.' })
word('nuanced', { pos: 'adjective', tier: A, repl: ['subtle', 'fine'], notes: 'A nuanced view = a subtle view.' })
word('multifaceted', { pos: 'adjective', tier: A, repl: ['varied', 'complex'], notes: 'A multifaceted issue = a complex issue.' })
word('paramount', { pos: 'adjective', tier: A, repl: ['top', 'chief'], notes: 'Of paramount importance = of the first importance.' })
word('salient', { pos: 'adjective', tier: A, repl: ['key', 'main'], notes: 'The salient point = the main point.' })
word('pertinent', { pos: 'adjective', tier: A, repl: ['relevant'], notes: 'Pertinent details = relevant details.' })
word('exemplary', { pos: 'adjective', tier: A, repl: ['model', 'fine'], notes: 'Exemplary conduct = model conduct.' })
word('laudable', { pos: 'adjective', tier: A, repl: ['good', 'worthy'], notes: 'A laudable goal = a good goal.' })
word('steadfast', { pos: 'adjective', tier: A, repl: ['firm', 'steady'], notes: 'Steadfast support = firm support.' })
word('unwavering', { pos: 'adjective', tier: A, repl: ['firm', 'steady'], notes: 'Unwavering support = firm support.' })
word('indelible', { pos: 'adjective', tier: A, repl: ['lasting'], notes: 'An indelible mark = a lasting mark.' })
word('profound', { pos: 'adjective', tier: A, repl: ['deep', 'great'], notes: 'A profound effect = a deep effect.' })
word('indispensable', { pos: 'adjective', tier: A, repl: ['essential', 'needed'], notes: 'Indispensable = essential.' })
word('inherent', { pos: 'adjective', tier: A, repl: ['built-in', 'natural'], notes: 'An inherent risk = a built-in risk.' })
word('intrinsic', { pos: 'adjective', tier: A, repl: ['built-in', 'natural'], notes: 'Intrinsic value = built-in value.' })
word('overarching', { pos: 'adjective', tier: A, repl: ['main', 'broad'], notes: 'An overarching goal = a main goal.' })
word('unparalleled', { pos: 'adjective', tier: A, repl: ['unmatched', 'rare'], notes: 'Unparalleled success = success without equal.' })
word('unprecedented', { pos: 'adjective', tier: A, repl: ['new', 'rare'], notes: 'An unprecedented step = a new step.' })
word('painstaking', { pos: 'adjective', tier: A, repl: ['careful', 'slow'], notes: 'Painstaking work = careful work.' })
word('arduous', { pos: 'adjective', tier: A, repl: ['hard', 'tough'], notes: 'An arduous task = a hard task.' })
word('convoluted', { pos: 'adjective', tier: A, repl: ['tangled', 'complex'], notes: 'A convoluted argument = a tangled argument.' })
word('esoteric', { pos: 'adjective', tier: A, repl: ['obscure', 'specialized'], notes: 'Esoteric knowledge = specialized knowledge.' })
word('nebulous', { pos: 'adjective', tier: A, repl: ['vague'], notes: 'A nebulous idea = a vague idea.' })
word('amorphous', { pos: 'adjective', tier: A, repl: ['shapeless', 'vague'], notes: 'An amorphous mass = a shapeless mass.' })
word('superfluous', { pos: 'adjective', tier: A, repl: ['extra', 'unneeded'], notes: 'Superfluous detail = unneeded detail.' })
word('redundant', { pos: 'adjective', tier: A, repl: ['extra', 'repeated'], notes: 'Redundant wording = repeated wording.' })
word('veritable', { pos: 'adjective', tier: A, repl: ['real', 'true'], notes: 'A veritable feast = a real feast.' })
word('visceral', { pos: 'adjective', tier: A, repl: ['deep'], notes: 'A visceral reaction = a deep reaction.' })
word('invaluable', { pos: 'adjective', tier: A, repl: ['valuable', 'useful'], notes: 'Invaluable help = useful help.' })

// --- adverbs -------------------------------------------------------------
word('fundamentally', { pos: 'adverb', tier: A, repl: ['basically'], notes: 'Fundamentally = basically, at bottom.' })
word('inherently', { pos: 'adverb', tier: A, repl: ['naturally'], notes: 'Inherently risky = risky by nature.' })
word('intrinsically', { pos: 'adverb', tier: A, repl: ['naturally'], notes: 'Intrinsically = naturally.' })
word('meticulously', { pos: 'adverb', tier: A, repl: ['carefully'], notes: 'Meticulously planned = carefully planned.' })
word('seamlessly', { pos: 'adverb', tier: A, repl: ['smoothly'], notes: 'Seamlessly = smoothly.' })
word('comprehensively', { pos: 'adverb', tier: A, repl: ['fully'], notes: 'Comprehensively = fully.' })
word('exponentially', { pos: 'adverb', tier: A, repl: ['rapidly', 'quickly'], notes: 'Almost always hyperbolic; rapidly is what is meant.' })
word('accordingly', { pos: 'adverb', tier: A, repl: ['so'], notes: 'Accordingly = so, therefore.' })
word('subsequently', { pos: 'adverb', tier: A, repl: ['later'], notes: 'Subsequently = later.' })
word('consequently', { pos: 'adverb', tier: A, repl: ['so'], notes: 'Consequently = so.' })

// --- flag-only "ordinary" words (fire only in dense paragraphs) ----------
const FLAG = { flagOnly: true }
word('across', { pos: 'preposition', tier: A, repl: ['over', 'through'], guard: { notAfter: ['from'] }, notes: 'Ordinary word; only swapped when a paragraph is already dense with markers.', ...FLAG })
word('within', { pos: 'preposition', tier: A, repl: ['in', 'inside'], notes: 'Ordinary word; flag only.', ...FLAG })
word('potential', { pos: 'adjective', tier: A, repl: ['possible', 'likely'], notes: 'Ordinary word; flag only. "Potential risk" is usually just "risk".', ...FLAG })
word('findings', { pos: 'noun', tier: A, repl: ['results'], notes: 'Ordinary academic word; flag only.', ...FLAG })
word('crucial', { pos: 'adjective', tier: A, repl: ['key', 'important'], guard: { notBefore: ['more', 'most'] }, notes: 'Ordinary intensifier; flag only.', ...FLAG })
word('additionally', { pos: 'adverb', tier: A, repl: ['also', 'too'], notes: 'Ordinary connector; flag only.', ...FLAG })
word('significant', { pos: 'adjective', tier: A, repl: ['big', 'notable'], guard: { notAfter: ['other'] }, notes: 'Ordinary word; flag only. Guard keeps "significant other" intact.', ...FLAG })
word('framework', { pos: 'noun', tier: A, repl: ['structure', 'system'], notes: 'Ordinary word; flag only.', ...FLAG })
word('substantial', { pos: 'adjective', tier: A, repl: ['large', 'big'], notes: 'Ordinary word; flag only.', ...FLAG })
word('considerable', { pos: 'adjective', tier: A, repl: ['large', 'big'], notes: 'Ordinary word; flag only.', ...FLAG })
word('numerous', { pos: 'adjective', tier: A, repl: ['many'], notes: 'Ordinary word; flag only.', ...FLAG })
word('furthermore', { pos: 'adverb', tier: A, repl: ['also'], notes: 'Ordinary connector; flag only.', ...FLAG })
word('moreover', { pos: 'adverb', tier: A, repl: ['also'], notes: 'Ordinary connector; flag only.', ...FLAG })

// ===========================================================================
// TIER B — Wikipedia "Signs of AI writing"
// ===========================================================================

const B = 'B'

phrase('pivotal moment', { tier: B, repl: ['turning point', 'key moment'], notes: 'Listed verbatim in WP:AISIGNS.' })
phrase('broader movement', { tier: B, repl: ['wider trend', 'bigger trend'], notes: 'Vague-significance framing flagged by WP:AISIGNS.' })
phrase('valuable insight', { tier: B, repl: ['useful point'], notes: 'WP:AISIGNS calls out "valuable insight" padding.' })
phrase('key turning point', { tier: B, repl: ['turning point'], notes: 'Redundant with "turning point"; both words are markers.' })
phrase('rich tapestry', { tier: B, repl: ['rich mix', 'wide mix'], notes: 'Named in WP:AISIGNS.' })
phrase('a testament to', { tier: B, repl: ['proof of', 'a sign of'], notes: 'WP:AISIGNS flourish.' })
phrase('encompassing', { tier: B, repl: ['covering', 'including'], notes: 'WP:AISIGNS: vague-scope present participle.' })
phrase('stands as a testament to', { tier: B, repl: ['shows', 'proves'], notes: 'Extended form of the testament flourish.' })
phrase('serves as', { tier: B, repl: ['is', 'works as'], notes: 'WP:AISIGNS: "serves as" is a padded copula.' })
phrase('in the realm of', { tier: B, repl: ['in'], notes: 'WP:AISIGNS: vague-significance padding.' })
phrase('a wide range of', { tier: B, repl: ['many'], notes: 'WP:AISIGNS: vague quantity phrase.' })
phrase('wide array of', { tier: B, repl: ['many'], notes: 'Variant of "a wide range of".' })
phrase('crucial role', { tier: B, repl: ['key part'], notes: 'Pairs with the "plays a ... role in" template.' })
phrase('significant milestone', { tier: B, repl: ['big step'], notes: 'WP:AISIGNS: significance padding.' })
phrase('ever-evolving', { tier: B, repl: ['changing', 'shifting'], notes: 'WP:AISIGNS: "ever-evolving" is a hallmark flourish.' })
phrase('countless', { tier: B, repl: ['many'], notes: 'WP:AISIGNS: vague quantity word.' })
phrase('meticulously crafted', { tier: B, repl: ['careful', 'well made'], notes: 'WP:AISIGNS: flowery praise of the subject.' })
phrase('vibrant', { tier: B, repl: ['lively', 'bright'], notes: 'WP:AISIGNS: vague positive adjective.' })
phrase('boasts', { tier: B, repl: ['has'], notes: 'WP:AISIGNS: promotional verb about the subject.' })
phrase('nestled', { tier: B, repl: ['set', 'placed'], notes: 'WP:AISIGNS: "nestled" for places.' })
phrase('a symphony of', { tier: B, repl: ['a mix of', 'a blend of'], notes: 'WP:AISIGNS: overblown metaphor.' })
phrase('delicate dance', { tier: B, repl: ['balance'], notes: 'WP:AISIGNS: metaphor padding.' })
phrase('intricate dance', { tier: B, repl: ['balance'], notes: 'Variant of the dance metaphor.' })
phrase('showcasing', { tier: B, repl: ['showing'], notes: 'WP:AISIGNS: -ing flourish at clause end.' })
phrase('highlighting', { tier: B, repl: ['showing'], notes: 'WP:AISIGNS: -ing flourish at clause end.' })
phrase('emphasizing', { tier: B, repl: ['stressing'], notes: 'WP:AISIGNS: -ing flourish at clause end.' })
phrase('ensuring', { tier: B, repl: ['making sure'], notes: 'WP:AISIGNS: -ing flourish at clause end.' })
phrase('underscores the importance of', { tier: B, repl: ['shows why', 'points to'], notes: 'Significance-signalling verb phrase.' })
phrase('highlights the significance of', { tier: B, repl: ['points to', 'shows'], notes: 'Significance-signalling verb phrase.' })
phrase('it is important to note that', { tier: B, repl: ['note that'], deleteOk: true, notes: 'WP:AISIGNS: throat-clearing opener; safe to delete outright.' })
phrase("it's important to note that", { tier: B, repl: ['note that'], deleteOk: true, id: 'its-important-to-note-that', notes: 'Contracted variant of the same opener.' })
phrase('it is worth noting that', { tier: B, repl: ['note that'], deleteOk: true, notes: 'Variant throat-clearing opener.' })
phrase('delve into', { tier: B, repl: ['dig into', 'look at'], notes: 'WP:AISIGNS singles out "delve".' })

template('plays-a-role-in',
  '\\b([^.;!?\\n]{1,60}?) (?:plays|play) an? (?:pivotal|key|crucial|vital|important|central|significant) role in ([^.;!?\\n]{1,60}?)\\b',
  { tier: B, templates: ['{X} matters for {Y}', '{X} shapes {Y}', '{X} drives {Y}'], notes: 'WP:AISIGNS: "plays a crucial role in" — the template preserves both sides.' })
template('not-only-but-also',
  '\\bnot only ([^,;\\n]{1,60}?) but also ([^.;!?\\n]{1,60}?)\\b',
  { tier: B, templates: ['{X} and {Y}', '{X}, and {Y} too'], notes: 'WP:AISIGNS: "not only ... but also" is a stock AI construction.' })
template('in-the-ever-evolving-landscape-of',
  '\\bin the (?:ever-evolving|ever-changing|constantly evolving|rapidly evolving) (?:landscape|world|realm) of ([^.;!?\\n]{1,60}?)\\b',
  { tier: B, templates: ['in {X}'], notes: 'WP:AISIGNS: vague-significance scene setting that adds nothing.' })
template('navigate-the-complexities-of',
  '\\b(?:navigate|navigating|navigates) the (?:complexities|challenges|intricacies) of ([^.;!?\\n]{1,60}?)\\b',
  { tier: B, templates: ['deal with {X}', 'work through {X}'], notes: 'WP:AISIGNS: "navigate the complexities of" is almost uniquely AI.' })

// ===========================================================================
// TIER C — blog-compiled phrases
// ===========================================================================

const C = 'C'

phrase('in today\'s fast-paced world', { tier: C, repl: ['these days', 'now'], id: 'in-todays-fast-paced-world', notes: 'Filler scene setter from AI-phrase roundups.' })
phrase('in today\'s world', { tier: C, repl: ['these days', 'now'], id: 'in-todays-world', notes: 'Shorter variant.' })
phrase('treasure trove', { tier: C, repl: ['goldmine', 'find'], notes: 'Clichéd noun phrase.' })
phrase('game-changer', { tier: C, repl: ['big change', 'breakthrough'], id: 'game-changer', notes: 'Business-speak noun.' })
phrase('game changer', { tier: C, repl: ['big change', 'breakthrough'], id: 'game-changer-space', notes: 'Unhyphenated variant.' })
phrase('at the end of the day', { tier: C, repl: ['in the end', 'ultimately'], notes: 'Filler summariser.' })
phrase('when it comes to', { tier: C, repl: ['for', 'about'], notes: 'Wordy way to introduce a topic.' })
phrase('dive deep into', { tier: C, repl: ['dig into', 'look closely at'], notes: 'Blog-speak for "examine".' })
phrase('deep dive', { tier: C, repl: ['close look', 'full study'], notes: 'Noun form of the same cliché.' })
phrase('in the world of', { tier: C, repl: ['in'], notes: 'Empty scene setter.' })
phrase('unlock the potential of', { tier: C, repl: ['improve', 'get more from'], notes: 'Marketing verb phrase.' })
phrase('take it to the next level', { tier: C, repl: ['improve it', 'go further'], notes: 'Business-speak.' })
phrase('the fact that', { tier: C, repl: ['that'], notes: 'Wordy nominalisation.' })
phrase('in order to', { tier: C, repl: ['to'], notes: 'Classic wordiness; "to" is identical in meaning.' })
phrase('due to the fact that', { tier: C, repl: ['because'], notes: 'Wordy causal connector.' })
phrase('at this point in time', { tier: C, repl: ['now'], notes: 'Wordy substitute for "now".' })
phrase('in the event that', { tier: C, repl: ['if'], notes: 'Legalism for "if".' })
phrase('for the purpose of', { tier: C, repl: ['for'], notes: 'Wordy preposition.' })
phrase('with regard to', { tier: C, repl: ['about'], notes: 'Wordy preposition.' })
phrase('in the process of', { tier: C, repl: ['while', 'during'], notes: 'Wordy connector.' })
phrase('a number of', { tier: C, repl: ['some', 'several'], notes: 'Vague quantity phrase.' })
phrase('is able to', { tier: C, repl: ['can'], notes: 'Verbosity for the modal "can".' })
phrase('are able to', { tier: C, repl: ['can'], notes: 'Plural variant.' })
phrase('has the ability to', { tier: C, repl: ['can'], notes: 'Wordy modal.' })
phrase('have the ability to', { tier: C, repl: ['can'], notes: 'Plural variant.' })
phrase('prior to', { tier: C, repl: ['before'], notes: 'Formal substitute for "before".' })
phrase('subsequent to', { tier: C, repl: ['after'], notes: 'Formal substitute for "after".' })
phrase('in conjunction with', { tier: C, repl: ['with'], notes: 'Wordy preposition.' })
phrase('on a daily basis', { tier: C, repl: ['daily', 'every day'], notes: 'Wordy frequency phrase.' })
phrase('the majority of', { tier: C, repl: ['most'], notes: 'Wordy quantifier.' })
phrase('in terms of', { tier: C, repl: ['about', 'for'], notes: 'Often removable filler.' })
phrase('moving forward', { tier: C, repl: ['from now on', 'ahead'], notes: 'Business-speak for the future.' })
phrase('circle back', { tier: C, repl: ['return', 'follow up'], notes: 'Office jargon.' })
phrase('touch base', { tier: C, repl: ['check in', 'talk'], notes: 'Office jargon.' })
phrase('low-hanging fruit', { tier: C, repl: ['easy wins'], id: 'low-hanging-fruit', notes: 'Business cliché.' })
phrase('buy-in', { tier: C, repl: ['support'], id: 'buy-in', notes: 'Business jargon noun.' })
phrase('actionable insights', { tier: C, repl: ['useful tips'], notes: 'Consulting-speak.' })
phrase('best-in-class', { tier: C, repl: ['best'], id: 'best-in-class', notes: 'Marketing superlative.' })
phrase('cutting-edge', { tier: C, repl: ['new', 'leading'], id: 'cutting-edge', notes: 'Marketing adjective.' })
phrase('state-of-the-art', { tier: C, repl: ['modern', 'newest'], id: 'state-of-the-art', notes: 'Marketing adjective.' })
phrase('paradigm shift', { tier: C, repl: ['big change'], notes: 'Overused noun phrase.' })
phrase('move the needle', { tier: C, repl: ['make a difference'], notes: 'Business cliché.' })
phrase('think outside the box', { tier: C, repl: ['be creative'], notes: 'Business cliché.' })
phrase('last but not least', { tier: C, repl: ['finally'], notes: 'Stock list closer.' })
phrase('it goes without saying', { tier: C, repl: ['obviously'], notes: 'Throat-clearing opener.' })
phrase('needless to say', { tier: C, repl: ['obviously'], notes: 'Throat-clearing opener.' })
phrase('in conclusion', { tier: C, repl: ['in the end', 'to wrap up'], notes: 'Essay-frame closer; fine in formal writing, filler elsewhere.' })
phrase('navigate the complexities', { tier: C, repl: ['handle the hard parts'], notes: 'Bare variant; the template entry covers the "of X" form.' })

template('it-is-important-to-note-that-sentence',
  '\\b(?:it is|it\'s) (?:important|worth noting|worth mentioning|crucial|essential) to (?:note|mention|remember|keep in mind) that\\b',
  { tier: C, templates: [], deleteOk: true, notes: 'Bare deletion of the throat-clearing opener; capitalisation of the next word is handled by cleanup.' })
template('serves-as-a-reminder',
  '\\bserves as a (?:reminder|testament) (?:of|that) ([^.;!?\\n]{1,60}?)\\b',
  { tier: C, templates: ['reminds us {X}', 'shows {X}'], notes: 'Blog-compiled flourish with a captured tail.' })

// ===========================================================================
// Build & write
// ===========================================================================

const byTier = entries.reduce((acc, e) => {
  acc[e.tier] = (acc[e.tier] || 0) + 1
  return acc
}, {})

if (Object.keys(byTier).length !== 3) throw new Error(`expected entries in tiers A, B and C, got ${JSON.stringify(byTier)}`)
if (entries.length < 150) throw new Error(`need at least 150 entries, have ${entries.length}`)

if (MISSING.size) {
  console.error('MISSING PLAIN WORDS (' + MISSING.size + '):')
  console.error([...MISSING].sort().join(' '))
  process.exit(1)
}

const doc = {
  version: VERSION,
  lastReviewed: LAST_REVIEWED,
  description: 'AI-flavoured words, phrases and templates with plain-English replacements. Consumed by src/engine/phrases.js.',
  tiers: {
    A: { label: 'Peer-reviewed excess-word studies', source: SOURCES.A, note: 'Single words consistently flagged by plain-language research.' },
    B: { label: 'Wikipedia "Signs of AI writing"', source: SOURCES.B, note: 'Phrases and constructions called out as hallmarks of LLM prose.' },
    C: { label: 'Blog-compiled phrases', source: SOURCES.C, note: 'Clichés and filler gathered from AI-phrase roundups.' },
  },
  entryCount: entries.length,
  tierCounts: byTier,
  densityThreshold: 3,
  plainWords: [...PLAIN].sort(),
  entries,
}

const outFile = resolve(ROOT, 'src/engine/data/phrases.json')
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n', 'utf8')

console.log(`wrote ${outFile}`)
console.log(`  entries: ${entries.length}`, byTier)
console.log(`  plain words: ${doc.plainWords.length}`)
