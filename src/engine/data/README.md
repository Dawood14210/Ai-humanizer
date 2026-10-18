# engine/data

JSON dictionaries consumed by the Plainwrite engine modules. Each file is a small,
human-editable map — no code lives here.

- `phrases.json` — AI-flavoured words, phrases and templates → plain English.
- `transitions.json` — conversational sentence starters.
- `contractions.json` — full form → contraction mapping.
- `synonyms.json` — single-word synonym swaps.

## phrases.json

Generated and validated by `scripts/build-phrases.mjs` (the committed JSON is the
source of truth the engine imports at build time).

```
node scripts/build-phrases.mjs
```

Top level:

| key | meaning |
| --- | --- |
| `version` | semver of the dictionary |
| `lastReviewed` | `YYYY-MM-DD` of the last editorial pass |
| `tiers` | label, source and note for tiers A / B / C |
| `entryCount`, `tierCounts` | size of the dictionary |
| `densityThreshold` | markers a paragraph needs before flag-only words fire (3) |
| `plainWords` | curated whitelist; every replacement must be built from it |
| `entries` | the rules |

Each entry:

| field | meaning |
| --- | --- |
| `id` | stable identifier, used in change records |
| `lemma` | the word or phrase to match (`null` for templates) |
| `pattern` | regex source with capture groups (templates only) |
| `type` | `word` \| `phrase` \| `template` |
| `pos` | part of speech, or `phrase` / `template` |
| `inflections` | `{ form: { replacementBase: replacementForm } }` — how each matched form is replaced (`delve`→`dig`, `delves`→`digs`, `delving`→`digging`, `delved`→`dug`) |
| `replacements` | candidate plain words/phrases; one is chosen with the seeded RNG |
| `templates` | candidate renderings for templates, using `{X}` / `{Y}` per capture group |
| `deleteOk` | the marker may be dropped entirely instead of replaced |
| `flagOnly` | "ordinary" word that only fires in a dense paragraph |
| `tier` | `A` peer-reviewed studies, `B` Wikipedia "Signs of AI writing", `C` blog-compiled |
| `source` | where the entry comes from |
| `guard` | `notBefore` / `notAfter` words that suppress the entry |
| `notes` | why the entry exists |

Two invariants are enforced by `phrases.test.js`: every replacement must be built
only from `plainWords`, and no replacement may itself be a marker.
