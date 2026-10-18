# Plainwrite

Plainwrite is a browser-only, rule-based writing editor. It applies fixed JavaScript rules locally; it does not use an AI model or send draft text to an external service. It is an editing aid, not a detector bypass, and makes no claim about how any AI detector will classify text.

## Run locally

Requirements: Node.js 18+ and npm.

```sh
npm install
npm run dev       # Vite development server (normally http://localhost:5173)
npm test          # complete Vitest suite
npm run build     # production files in dist/
npm run preview   # serve the production build locally
```

## How the engine works

The engine lives in `src/engine/`, has no React dependency, and runs in a Web Worker in the browser. The ordered stages are:

1. **Normalize** — normalize line endings and spacing while keeping edit offsets trackable.
2. **Clean up** — tidy punctuation and formatting, and remove certain chatbot-style filler sentences. This is deliberately a rule-based cleanup, not a semantic check; review every deletion.
3. **Plain-language phrases** — match curated words, phrases, and templates from `src/engine/data/phrases.json`; choose a replacement deterministically from the run seed. Guards and protected-span checks suppress unsafe matches.
4. **Transitions** — find repeated sentence-opening connectors and, after the stage's repetition threshold, remove or simplify eligible instances.
5. **Contractions** — selectively contract supported English forms according to the chosen intensity.
6. **Sentence rhythm** — make limited sentence-length adjustments where the rules allow; it is not a grammar parser.
7. **Synonyms** — optional, opt-in single-word substitutions. They can change nuance, so inspect these edits carefully.

Non-English input is detected heuristically: English-only phrase, transition, contraction, rhythm, and synonym stages are skipped, while cleanup remains available. Detection is not a full language-identification system.

### Phrase tiers

The phrase dictionary has three editorial source tiers. The tier describes where a marker was collected, not how strongly it signals AI writing:

- **A** — words and constructions drawn from plain-language and excess-word guidance.
- **B** — phrases collected from the Wikipedia essay “Signs of AI writing.”
- **C** — phrases collected from blog roundups of commonly noticed AI wording.

The source bases vary in rigor and can become stale as writing conventions change. They are not detector measurements, and a tier is not a quality score. “Flag-only” entries are counted separately and only apply when a paragraph reaches the dictionary's marker-density threshold; the UI distinguishes those counts from tier A/B/C entries. Phrase markers are cues for review, not errors by themselves.

### Worked dictionary example

`phrases.json` is generated and validated by `scripts/build-phrases.mjs`. Add the matching `phrase('…', { … })` rule to that builder, then run `node scripts/build-phrases.mjs` to regenerate the committed JSON. For example, a tier-C phrase rule for “for the reason that” could be written in the builder as:

```js
phrase('for the reason that', {
  tier: 'C',
  repl: ['because'],
  notes: 'A shorter equivalent; retain the causal meaning.',
})
```

The generated `src/engine/data/phrases.json` entry has this shape (the `source` value comes from the tier metadata in the builder):

```json
{
  "id": "for-the-reason-that",
  "lemma": "for the reason that",
  "pattern": null,
  "type": "phrase",
  "pos": "phrase",
  "inflections": {},
  "replacements": ["because"],
  "deleteOk": false,
  "flagOnly": false,
  "tier": "C",
  "source": "Blog-compiled AI-phrase roundups (\"words and phrases ChatGPT overuses\")",
  "guard": { "notBefore": [], "notAfter": [], "notInProtected": true },
  "notes": "A shorter equivalent; retain the causal meaning."
}
```

Before adding a rule, check that the replacement preserves meaning and grammar in context, that its words are in the builder's `PLAIN_WORDS` whitelist, and that the marker does not overlap an existing rule in an unintended way. Word entries also need explicit surface-form/inflection mappings. Use stable unique IDs, a truthful source and a useful note; run the phrase tests after regeneration. The visible dictionary version and `lastReviewed` date are read from the JSON metadata.

## Edit and replay contract

Each stage finds edits against that stage's original input and passes them to the shared `applyEdits()` helper. `applyEdits()` resolves overlapping candidates and applies accepted edits in one left-to-right pass. Change records carry final-output `start`/`end` coordinates and the corresponding `inputStart`/`inputEnd` coordinates. Later stages map earlier changes through copied ranges; superseded changes are tracked rather than silently applied at stale offsets. This lets the UI replay the final output from the original input and selectively revert an edit without corrupting other edits. Tests enforce the mapping, replay, and non-superseded slice invariants—do not replace this with sequential string replacements that shift offsets.

## Tests

```sh
npm test
```

Vitest covers engine stages, deterministic output, edit mapping and replay, revert behavior, protected spans, language gating, progress/cancellation, fixtures and snapshots, and style metrics. `src/engine/data/README.md` and the tests document dictionary validation. When changing stage behavior or dictionary rules, run the full suite and a production build:

```sh
npm test
npm run build
```

## Limits and review guidance

- The rules match text patterns; they do not understand the writer's intent or reliably assess factual accuracy, grammar, audience, or voice.
- Cleanup can delete some entire boilerplate sentences. Phrase substitutions, transitions, sentence adjustments, and especially optional synonyms can alter meaning or sound awkward. Review the highlighted changes and compare the result with the source.
- English detection, tokenization, phrase matching, part-of-speech heuristics, and sentence splitting have edge cases. Non-English detection is best-effort.
- The bundled dictionaries are curated snapshots, not live research. The phrase list draws on published plain-language material and public/community compilations, has different evidence strengths, and needs periodic review. Counts and `lastReviewed` are metadata, not a guarantee of completeness or freshness.
- Style metrics describe surface patterns only; they do not measure writing quality or predict a detector result. The app's disclaimer is: “These metrics describe style patterns only. They do not predict the result of any AI detector.”
- Follow your school or employer's rules on AI tools and editing assistance. You are responsible for deciding whether and how this tool may be used.

## Privacy

Draft text is processed in the browser's Web Worker and is not uploaded or sent to an API. The site still needs ordinary browser requests to load its HTML, JavaScript, styles, and worker bundle. Once loaded, a humanization run should make no network request containing or transmitting the draft. The app does not make requests to AI services.

## Deploy to Vercel

This is a Vite static site. Use the defaults below in Vercel:

- Framework preset: **Vite** (or Other, if auto-detection is unavailable)
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install` (or Vercel's detected npm install)

The current app is served at the root path and needs no rewrite rules; **no `vercel.json` is required**. Confirm these settings in the Vercel project before deploying. The production build output is `dist/`.

## Project layout

```text
src/
  App.jsx                 React UI, worker controls, metrics, privacy/About copy
  engine.worker.js        worker entry point, bundled dictionary metadata
  engine/
    index.js              ordered pipeline and public humanize() API
    edits.js              edit application, coordinate mapping, replay helpers
    protected.js          immutable protected-span detection
    stats.js              style-only metrics
    language.js           best-effort language routing
    data/                 JSON phrase, transition, contraction, synonym rules
scripts/
  build-phrases.mjs       phrase dictionary generator/validator
```

## License

MIT.
