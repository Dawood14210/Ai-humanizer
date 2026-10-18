# Plainwrite

Plainwrite is a **rule-based text humanizer** that runs entirely in the browser.
Paste in stiff or obviously AI-sounding text, and Plainwrite rewrites it to read
more like something a real person typed — using only local JavaScript rules.

It **never** calls an LLM and **never** hits an external API. All processing
happens in the tab, and your text never leaves your machine.

## Stack

- **React** + **Vite** for the UI and dev/build tooling
- **Tailwind CSS** for styling
- **Vitest** for unit tests against the engine
- No backend, no network calls at runtime

## Getting started

```bash
npm install
npm run dev       # start the dev server (http://localhost:5173)
npm run test      # run the Vitest suite
npm run build     # production build into /dist
npm run preview   # preview the production build
```

## Folder layout

```
.
├── index.html               # Vite entry HTML
├── package.json
├── vite.config.js           # Vite + Vitest config
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.jsx             # React bootstrap
    ├── App.jsx              # Top-level UI
    ├── index.css            # Tailwind directives
    └── engine/              # Pure JS text engine (no React imports)
        ├── index.js         # Public API: humanize(), computeStats(), makeRng()
        ├── normalize.js     # Whitespace / unicode normalization
        ├── cleanup.js       # Final-pass punctuation & spacing fixes
        ├── phrases.js       # Multi-word phrase rewrites
        ├── transitions.js   # Conversational transition insertion
        ├── contractions.js  # Natural English contractions
        ├── rhythm.js        # Sentence-length variation, splitting long sentences
        ├── synonyms.js      # Single-word synonym swaps
        ├── stats.js         # Word/sentence/readability stats
        ├── rng.js           # Seedable PRNG (Mulberry32) for deterministic runs
        ├── index.test.js    # Vitest smoke tests
        └── data/            # JSON dictionaries (phrases, transitions, etc.)
            ├── phrases.json
            ├── transitions.json
            ├── contractions.json
            ├── synonyms.json
            └── README.md
```

## Engine design notes

- The engine in `src/engine` is **plain JavaScript** with no React dependencies,
  so it can be imported directly in Node (for Vitest) or in the browser.
- Each module has one responsibility and is independently testable.
- A seedable RNG (`makeRng`) is threaded through the transform passes so output
  is reproducible in tests and for "re-roll with same seed" features in the UI.
- Transformation passes compose in `engine/index.js`:
  `normalize → synonym swap → phrase rewrite → contractions → rhythm → transitions → cleanup`.
- Dictionaries live as editable JSON under `src/engine/data/` so non-engineers
  can tune output without touching code.

## Roadmap (what the empty modules will grow into)

- `normalize.js`: smart quotes → ASCII, collapsing whitespace, fixing ellipses/em dashes.
- `synonyms.js`: weighted word replacements keyed by part-of-speech-aware regex.
- `phrases.js`: case-insensitive multi-word matching against `data/phrases.json`.
- `contractions.js`: rate-controlled (not every possible) contraction application.
- `rhythm.js`: split overlong sentences; occasionally combine short choppy ones;
  vary sentence openings.
- `transitions.js`: sparse insertion of discourse markers so prose doesn't feel
  list-like.
- `cleanup.js`: fix spaces before punctuation, re-capitalize, terminal punctuation.
- `stats.js`: Flesch–Kincaid-ish readability score + sentence-length histogram.

## License

MIT.
