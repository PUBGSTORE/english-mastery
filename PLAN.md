# English Mastery — Build Plan

Single-user, offline-first, zero-build static PWA. Plain HTML + CSS + ES modules. Deploys to GitHub Pages from the repo root. Everything below is fixed before code is written so later phases don't fight earlier ones.

---

## 0. Decisions that shape everything else

| Decision | Choice | Why |
|---|---|---|
| Routing | Hash router (`#/vocab/deck/a1`) | GitHub Pages serves no 404 fallback; hash routes survive hard refresh and subpath hosting. |
| Module loading | `<script type="module" src="./js/app.js">`, all imports relative | Works from `/<repo>/` subpath, no bundler. |
| Storage | IndexedDB, one DB `english-mastery`, hand-written `db.js` promise wrapper | Source of truth. Versioned via `onupgradeneeded` with additive migrations only. |
| localStorage | `em.theme`, `em.route`, `em.hindi` only | Theme must apply before IndexedDB opens (avoid flash). |
| Content | Static JSON under `./data/`, loaded lazily per view, cached in memory | Adding a lesson = adding JSON. SW precaches all of it. |
| SRS | SM-2 in `srs.js`, pure functions, unit-testable in browser console | One algorithm for every learnable atom. |
| IDs | Content IDs are stable strings in JSON (`v:a1:0042`, `g:articles-1`, `mp:v-w:03`). Card IDs derive from them (`card:v:a1:0042:cloze`). | Re-importing content never orphans progress. |
| Audio | Web Speech API for TTS (`speechSynthesis`) and ASR (`SpeechRecognition` / `webkit` prefix). `MediaRecorder` for self-recording. | No CDN, no server. iOS Safari lacks `SpeechRecognition` → degrade to record + A/B compare, never fake a score. |
| Charts | Hand-rolled SVG/canvas in `charts.js` | No library. |
| AI | DeepSeek `deepseek-chat` via `fetch` streaming, key in IndexedDB `settings` store | Key never in repo. |
| PWA | `manifest.webmanifest` + `sw.js` (cache-first shell, stale-while-revalidate data, versioned cache name) | Full offline after first load. |
| Time | All timestamps stored as ISO strings in UTC; "day" for streak/daily-5 computed in local time as `YYYY-MM-DD` | Deterministic daily selection; timezone travel doesn't break streaks. |

---

## 1. File list

```
index.html                      shell: nav, <main id="view">, toast root, Ask FAB, chat drawer
manifest.webmanifest
sw.js                           precache shell + ./data/*.json, versioned cache
README.md                       deploy, add content, DeepSeek key, backup
PLAN.md                         this file

css/
  theme.css                     :root tokens, dark default, [data-theme=light], prefers-color-scheme,
                                reduced-motion, Devanagari font stack, type scale (clamp)
  app.css                       layout (tab bar / sidebar), components (card, button, chip, sheet,
                                toast, progress, diff, word-tiles), view-specific sections

js/
  app.js                        boot: theme → db.open() → content index → router.start() → SW register
  router.js                     hash router, route table, params, transitions, last-route persistence
  db.js                         IndexedDB wrapper: open/migrate, get/put/del/getAll/index queries,
                                bulk txn, export/import, every call wrapped + toast on failure
  srs.js                        SM-2: schedule(card, grade), newCard(), dueCards(), daily caps, stats
  content.js                    loads ./data/*.json lazily, memoises, builds lookup maps
  tts.js                        speak(text,{rate,lang}), voice picker, iOS warm-up, cancel, onend
  asr.js                        recognise() → transcript; feature detection; word-level scoring
  audio.js                      MediaRecorder record/stop/play, blob store, A/B playback
  ai.js                         DeepSeek streaming client, context builder, rolling summary, cost est.
  charts.js                     heatmap, line, radar, bar, progress ring (SVG)
  i18n.js                       Hindi toggle state, <hi> reveal component, ui strings
  utils.js                      seeded RNG (mulberry32), dayKey(), levenshtein, damerau, diff,
                                debounce, escapeHtml, fmt, uid, shuffle(seed)
  ui.js                         toast(), sheet(), confirm(), keyboard shortcuts, swipe handler,
                                render helpers (h(), el())
  views/
    home.js                     "Review N due" hero, daily 5, streak, top-5 mistakes, next lesson
    review.js                   the SRS review engine (all card types, grading, keyboard/swipe)
    vocab.js                    deck browser, word detail, search, add-to-SRS
    daily.js                    Daily 5 + history + per-word retention
    grammar.js                  lesson list (CEFR-gated), lesson page, guided practice, free production
    pronunciation.js            hub → phonemes / minimal pairs / stress / rhythm / connected / intonation / twisters
    shadowing.js                listen 1.0 → 0.75 → record → A/B → self-rate → SRS
    listening.js                dictation, numbers/dates/spelling drills
    speaking.js                 daily speaking prompt: record → ASR → AI feedback
    writing.js                  writing studio: templates, rubric, inline diff, corrections → SRS
    chat.js                     DeepSeek threads, streaming, chips, context injection
    notes.js                    notes w/ tags, search, markdown-lite, attach, → SRS card
    mistakes.js                 error notebook, grouped by rule, re-test
    progress.js                 dashboard (heatmap, trend, radar, CEFR bar, time)
    placement.js                30-question adaptive test
    settings.js                 theme, caps, voices, Hindi default, API key, export/import, reset

data/
  index.json                    manifest of all data files + counts + content version
  vocab-a1.json                 200 entries
  vocab-a2.json                 200 entries
  vocab-b1.json                 200 entries
  vocab-b2.json                 200 entries
  vocab-c1.json                 150 entries
  vocab-tech.json               150 entries (security engineering + report writing)
  phrasal-verbs.json            80 entries (same vocab schema, pos "phrasal verb", separable flag)
  idioms.json                   60 entries (same schema)
  collocations.json             150 collocation cards (verb+noun, adj+noun, business)
  grammar.json                  60 lessons, each with 10 guided practice items (= 600 exercise items)
  indianisms.json               40 Indianism → natural equivalent pairs (used by grammar lesson + cards)
  phonemes.json                 44 phonemes
  minimal-pairs.json            120 sets, grouped by contrast
  stress.json                   word stress (120 words), sentence stress (60), reductions (40),
                                connected speech (60), intonation (50)
  tongue-twisters.json          30
  shadowing.json                80 items A1→C1
  listening.json                dictation sentences (150) + numbers/dates/spelling drills (90)
  writing-prompts.json          templates (email, bug report, Slack, essay, incident summary) + 30 prompts
  speaking-prompts.json         90 prompts (3 months)
  placement.json                60-item bank tagged by CEFR, adaptive picks 30

icons/
  icon-192.png  icon-512.png  apple-touch-icon.png  (generated PNGs)  favicon.svg
```

Vocabulary total: 200+200+200+200+150+150+80+60 = **1,240 word entries** + 150 collocations.
Exercise items: 600 grammar practice + 150 dictation + 90 drills + 60 placement = **900**.

---

## 2. Content schemas (JSON under `./data/`)

### 2.1 Vocabulary entry (`vocab-*.json`, `phrasal-verbs.json`, `idioms.json`)

```json
{
  "id": "v:a1:0042",
  "word": "decide",
  "ipa": "/dɪˈsaɪd/",
  "pos": "verb",
  "cefr": "A1",
  "freq_rank": 412,
  "en_def": "to choose something after thinking about it",
  "hi_def": "निर्णय लेना, तय करना",
  "hi_nuance": "Hindi speakers often say 'take a decision'; natural English is 'make a decision'.",
  "examples": [
    { "en": "We decided to leave early.", "hi": "हमने जल्दी निकलने का फ़ैसला किया।" }
  ],
  "collocations": ["decide to do", "decide against", "decide between"],
  "synonyms": ["choose", "settle on"],
  "antonyms": ["hesitate"],
  "word_family": ["decide", "decision", "decisive", "decisively", "undecided"],
  "register": "neutral",
  "common_mistake": { "wrong": "I decided for going.", "right": "I decided to go.", "why": "decide + to-infinitive, not for + -ing" },
  "cloze": { "sentence": "They ____ to cancel the meeting.", "answer": "decided" },
  "tags": ["core", "ngsl"],
  "separable": null
}
```
`examples` has 5–10 items. `cloze.answer` may be an inflected form. `separable` is `true/false` only for phrasal verbs. Idioms use `word` for the whole idiom.

### 2.2 Collocation (`collocations.json`)
```json
{ "id": "col:0012", "phrase": "make a decision", "pattern": "verb + noun", "cefr": "A2",
  "en_def": "...", "hi_def": "...", "wrong": "take a decision", "examples": [{ "en": "...", "hi": "..." }] }
```

### 2.3 Grammar lesson (`grammar.json`)
```json
{
  "id": "g:articles-1",
  "order": 3,
  "cefr": "A1",
  "title": "Articles: a / an / the (part 1)",
  "concept_en": "...",
  "concept_hi": "...",
  "pattern": "a + consonant sound | an + vowel sound | the + specific/known",
  "examples": [{ "en": "...", "hi": "...", "note": "" }],
  "contrast": [{ "wrong": "I am engineer.", "right": "I am an engineer.", "why_en": "...", "why_hi": "..." }],
  "practice": [
    { "id": "g:articles-1:p01", "type": "fill", "prompt": "She is ___ honest person.", "answer": ["an"], "hi": "...", "feedback_en": "...", "feedback_hi": "..." },
    { "id": "g:articles-1:p02", "type": "choose", "prompt": "I saw ___ film yesterday.", "options": ["a", "an", "the", "—"], "answer": ["a"], "feedback_en": "..." },
    { "id": "g:articles-1:p03", "type": "fix", "prompt": "He gave me good advice.", "answer": ["He gave me some good advice."], "feedback_en": "..." },
    { "id": "g:articles-1:p04", "type": "reorder", "words": ["where", "he", "is", "I", "don't", "know"], "answer": ["I don't know where he is."] }
  ],
  "production": { "task_en": "Write 3 sentences about your job using a/an/the.", "task_hi": "..." },
  "related_vocab": ["v:a1:0042"],
  "tags": ["articles", "hindi-l1-priority"]
}
```
Practice types: `fill` (typed, fuzzy), `choose` (tap), `fix` (rewrite the sentence, fuzzy), `reorder` (tap tiles), `tf` (true/false correct?).

### 2.4 Phoneme (`phonemes.json`)
```json
{ "id": "ph:v", "ipa": "v", "type": "consonant", "voiced": true, "label": "v as in van",
  "mouth_en": "Top teeth touch bottom lip; voice on. Do NOT round lips (that makes /w/).",
  "mouth_hi": "ऊपर के दाँत निचले होंठ को छुएँ; आवाज़ चालू। होंठ गोल न करें।",
  "hindi_trap": "Hindi 'व' sits between /v/ and /w/; English separates them.",
  "examples": ["van", "very", "leave", "seven", "value"],
  "contrast_with": ["ph:w", "ph:f"] }
```

### 2.5 Minimal pair set (`minimal-pairs.json`)
```json
{ "id": "mp:v-w:03", "contrast": "v-w", "contrast_label": "/v/ vs /w/", "phonemes": ["ph:v", "ph:w"],
  "a": { "word": "vine", "ipa": "/vaɪn/" }, "b": { "word": "wine", "ipa": "/waɪn/" },
  "sentence_a": "The vine grew fast.", "sentence_b": "The wine tasted fine.",
  "tip_en": "...", "tip_hi": "...", "difficulty": 2 }
```

### 2.6 Stress / rhythm / intonation (`stress.json`)
```json
{
  "word_stress": [{ "id": "ws:001", "word": "photograph", "syllables": ["PHO","to","graph"], "stressed": 0, "ipa": "...", "family": ["photographer:1", "photographic:2"] }],
  "sentence_stress": [{ "id": "ss:001", "sentence": "I want to go to the bank.", "content": [1,3,6], "weak": { "to": "/tə/", "the": "/ðə/" }, "hi": "..." }],
  "reductions": [{ "id": "rd:001", "full": "can", "weak": "/kən/", "example": "I can do it.", "note_en": "...", "note_hi": "..." }],
  "connected": [{ "id": "cs:001", "type": "linking", "phrase": "turn it off", "spoken": "tur-ni-toff", "rule_en": "...", "rule_hi": "..." }],
  "intonation": [{ "id": "in:001", "sentence": "Are you coming?", "type": "yes-no", "contour": [0,0,1,2], "hi": "...", "rule_en": "Rising on the last stressed syllable." }]
}
```
`contour` = per-word pitch level (0 low → 3 high), drawn as a curve.

### 2.7 Shadowing (`shadowing.json`)
```json
{ "id": "sh:b1:012", "cefr": "B1", "text": "...", "hi": "...", "focus": ["linking", "th"],
  "target_wps": [2.2, 3.0], "words": 18 }
```

### 2.8 Listening (`listening.json`)
```json
{ "dictation": [{ "id": "ld:042", "cefr": "A2", "text": "...", "hi": "...", "trap": "contractions" }],
  "numbers": [{ "id": "ln:01", "spoken": "thirteen thousand and fifty", "answer": "13050", "alt": ["13,050"] }],
  "dates":   [{ "id": "ldt:01", "spoken": "the third of March, twenty twenty-four", "answer": "3 March 2024", "alt": ["03/03/2024", "2024-03-03"] }],
  "spelling":[{ "id": "ls:01", "spoken": "B for bravo, A for alpha ...", "answer": "balvant" }] }
```

### 2.9 Writing / speaking prompts, placement
```json
// writing-prompts.json
{ "templates": [{ "id": "wt:bug", "name": "Bug report", "skeleton": "Title:\nSeverity:\nSteps to reproduce:\n...", "register": "formal" }],
  "prompts": [{ "id": "wp:012", "template": "wt:email", "cefr": "B2", "task_en": "...", "task_hi": "...", "min_words": 80 }] }
// speaking-prompts.json
[{ "id": "sp:012", "cefr": "B1", "prompt_en": "...", "prompt_hi": "...", "seconds": 45, "target_vocab": ["v:b1:0031"] }]
// placement.json
[{ "id": "pl:031", "cefr": "B1", "skill": "grammar", "type": "choose", "prompt": "...", "options": [...], "answer": 2 }]
```

---

## 3. IndexedDB schema (`db.js`, DB `english-mastery`, version 1)

Every record carries `v` (record schema version) and `updatedAt` (ISO). Writes are single-object-store transactions unless noted.

| Store | keyPath | Indexes | Purpose |
|---|---|---|---|
| `cards` | `id` | `due`, `deck`, `refId`, `state` | Every SRS card. |
| `reviews` | `id` (uid) | `cardId`, `day`, `ts` | Append-only review log (grade, elapsed ms). Drives retention %, heatmap. |
| `attempts` | `id` | `refId`, `day`, `kind` | Pronunciation/shadowing/dictation attempts: accuracy, fluency, completeness, transcript. |
| `mistakes` | `id` | `rule`, `day`, `source`, `count` | Error notebook. Same normalised mistake increments `count`. |
| `daily` | `day` (`YYYY-MM-DD`) | — | Daily-5 record: `wordIds[]`, `completed`, `completedAt`. |
| `days` | `day` | — | Per-day aggregates: `reviews`, `newCards`, `studyMs`, `skills{}`. Streak derives from here. |
| `notes` | `id` | `updatedAt`, `tags` (multiEntry), `attachedTo` | Notes. |
| `threads` | `id` | `updatedAt` | Chat threads: `title`, `summary`, `tokensIn/Out`, `context`. |
| `messages` | `id` | `threadId`, `ts` | Chat messages. |
| `audio` | `id` (= refId) | `ts` | Latest self-recording blob per item (capped at 200 blobs, LRU eviction). |
| `settings` | `key` | — | `apiKey`, `newPerDay`, `reviewPerDay`, `voice`, `hindiDefault`, `level`, `streakFreezes`, `lastExport`, `placementDone`. |
| `meta` | `key` | — | `schemaVersion`, `contentVersion`, `installedAt`. |

### 3.1 SRS card
```json
{ "id": "card:v:a1:0042:cloze", "refId": "v:a1:0042", "deck": "vocab-a1",
  "kind": "vocab", "cardType": "cloze",
  "ease": 2.5, "interval": 0, "reps": 0, "lapses": 0, "state": "new",
  "due": "2026-09-06T00:00:00.000Z", "lastReview": null, "createdAt": "...", "updatedAt": "...", "v": 1,
  "payload": {} }
```
- `kind`: `vocab | collocation | grammar | phoneme | pair | shadow | mistake | note | correction`
- `cardType` for vocab rotates per review by `reps % 5`: `meaning → produce → cloze → listen → use`. The card stores one schedule; the *prompt* type rotates, so the word is one atom with five faces (Anki-style siblings would 5× the workload; this is deliberate).
- `state`: `new | learning | review | relearning`.
- `payload` holds self-contained data for cards not backed by content JSON (mistakes, notes, AI corrections).

### 3.2 SM-2 (`srs.js`)
```
grade ∈ {0: Again, 1: Hard, 2: Good, 3: Easy}
new/learning steps: Again → 1 min, Hard → 6 min, Good → 10 min then graduate (interval 1d), Easy → graduate 4d
review:
  Again: lapses++, ease = max(1.3, ease − 0.2), interval = 1 (relearning), state = relearning
  Hard:  interval = max(interval+1, interval × 1.2), ease = max(1.3, ease − 0.15)
  Good:  interval = interval × ease
  Easy:  interval = interval × ease × 1.3, ease += 0.15
  ease bounded [1.3, 3.0]; interval bounded [1, 365]; due = now + interval days (fuzz ±5% for ≥3d)
mistake cards: initial ease 2.2, graduate at 1d, relearn step 1 min (more aggressive)
daily caps: newPerDay (default 10), reviewPerDay (100); Daily-5 cards bypass the new cap
queue order: relearning → learning (by due) → review (overdue first) → new (by deck order)
```

### 3.3 Export format
```json
{ "app": "english-mastery", "format": 1, "exportedAt": "...", "schemaVersion": 1,
  "stores": { "cards": [...], "reviews": [...], ... all stores except audio ... },
  "counts": { "cards": 1240, ... }, "checksum": "<fnv1a of stores JSON>" }
```
Import validates `app`, `format ≤ current`, per-store required keys, checksum; runs in one transaction per store; offers **merge** (newer `updatedAt` wins) or **replace**. Audio blobs are excluded from export (size); noted in UI.

---

## 4. Core algorithms

- **Daily 5:** pool = all vocab at user level and one below, minus words already in SRS. `rng = mulberry32(hash(dayKey + level))`, pick 5 by seeded shuffle. Written to `daily[day]` on first view; subsequent loads read the stored record, so even a content update can't reroll a past day.
- **Streak:** consecutive `days` records with `reviews > 0 || studyMs > 5min`. One freeze auto-consumed per missed day (default 1 freeze, earn +1 every 7-day streak, max 3). Freeze usage shown explicitly.
- **Typed-answer fuzzy check:** normalise (lowercase, trim, strip punctuation/articles for `fix` type), Damerau-Levenshtein ≤ 1 for answers ≤ 5 chars, ≤ 2 otherwise → "close" (counts as Hard, shows exact answer).
- **ASR scoring:** tokenise target and transcript; align with word-level Levenshtein (DP with backtrace); per word: exact → green, Damerau ≤ 1 or same metaphone-lite → amber, else red. `accuracy = green + 0.5·amber / target words`; `completeness = aligned words / target words`; `fluency = words / seconds` compared to item `target_wps`. Stored in `attempts`.
- **Dictation diff:** character-level LCS diff rendered as ins/del spans.
- **Writing diff:** word-level LCS diff between my text and AI-corrected text; each change hunk gets a "why" from the AI's structured JSON.
- **AI context injection:** `router` exposes `currentContext()` from the active view (word, rule, sentence, last failure); chat system prompt = base tutor prompt + level + context block.
- **Rolling summary:** when a thread exceeds 12 messages, the older ones are summarised by one cheap call and stored in `threads.summary`; requests send `summary + last 10`.
- **Cost estimate:** tokens ≈ chars/4 for input + streamed output; priced at DeepSeek list price constants in `ai.js` (editable in Settings).

---

## 5. Views and routes

| Route | View | Primary action |
|---|---|---|
| `#/` | home | **Review N due** |
| `#/review?deck=&kind=` | review | grade cards |
| `#/vocab`, `#/vocab/:deck`, `#/word/:id` | vocab | browse / add to SRS |
| `#/daily`, `#/daily/history` | daily | today's 5 |
| `#/grammar`, `#/grammar/:id` | grammar | next lesson |
| `#/pron`, `#/pron/phonemes/:id`, `#/pron/pairs/:contrast`, `#/pron/stress`, `#/pron/rhythm`, `#/pron/connected`, `#/pron/intonation`, `#/pron/twisters` | pronunciation | drill |
| `#/shadow`, `#/shadow/:id` | shadowing | shadow next |
| `#/listen`, `#/listen/:mode` | listening | dictate |
| `#/speak` | speaking | today's prompt |
| `#/write`, `#/write/:id` | writing | write |
| `#/chat`, `#/chat/:threadId` | chat | ask |
| `#/notes`, `#/notes/:id` | notes | new note |
| `#/mistakes` | mistakes | re-test top 5 |
| `#/progress` | progress | — |
| `#/placement` | placement | start |
| `#/settings` | settings | export |

Nav: phone bottom tabs **Home · Learn · Practice · Chat · Progress** (Learn = vocab/daily/grammar/notes; Practice = pron/shadow/listen/speak/write/mistakes). ≥1024px: left sidebar with all sections.

---

## 6. Build order

### P1 — Shell (deployable, empty but functional)
`index.html`, `theme.css`, `app.css`, `app.js`, `router.js`, `db.js`, `ui.js`, `utils.js`, `i18n.js`, `content.js`, `views/home.js` (stub state: "no content loaded yet" is NOT acceptable — home reads `data/index.json` and shows real counts), `views/settings.js` (theme, caps, Hindi default, API key field, export/import, reset), `manifest.webmanifest`, icons, `sw.js` (shell only for now), `data/index.json`.
Test: load from `file://`? No — test with `python3 -m http.server`; toggle theme; export → clear site data → import → settings restored; layout at 390/768/1024/1440.

### P2 — Vocabulary + SRS + Daily 5 + review engine
`srs.js`, `tts.js`, `views/vocab.js`, `views/daily.js`, `views/review.js`; data: `vocab-a1.json`, `vocab-a2.json` (200 each), `index.json` updated. Then `vocab-b1/b2/c1/tech`, `phrasal-verbs`, `idioms`, `collocations` as follow-up content drops.
Test: add deck → home shows "Review N due" → grade with keys 1–4 and swipes → reload → due counts persist → daily 5 same after refresh → history.

### P3 — Grammar + exercises + mistakes notebook
`views/grammar.js`, `views/mistakes.js`; data: `grammar.json` (60 lessons), `indianisms.json`. Wrong answers → `mistakes` + mistake SRS cards. Home shows top-5 recurring mistakes.

### P4 — Pronunciation + shadowing + listening
`asr.js`, `audio.js`, `views/pronunciation.js`, `views/shadowing.js`, `views/listening.js`; data: `phonemes.json`, `minimal-pairs.json`, `stress.json`, `tongue-twisters.json`, `shadowing.json`, `listening.json`. Attempts stored; trend visible in P6.
Priority order inside P4: v/w and th pairs, sentence stress/weak forms, shadowing.

### P5 — AI chat + writing + speaking + notes
`ai.js`, `views/chat.js`, `views/writing.js`, `views/speaking.js`, `views/notes.js`; data: `writing-prompts.json`, `speaking-prompts.json`. Ask FAB wired to every view's context.

### P6 — Progress + placement + PWA + iPad polish + QA
`charts.js`, `views/progress.js`, `views/placement.js`, `sw.js` full precache from `index.json`, auto-export reminder, keyboard shortcuts audit, safe-area audit, reduced-motion audit, offline test, README.

Each phase ends with: what works, how to test on iPad, what's next.

---

## 7. Quality gates (checked before each "phase done")

- No console errors on load or on every route.
- Every visible button performs an action or is absent.
- Hindi renders in Devanagari with line-height ≥ 1.6.
- TTS speaks after a user gesture on iOS (warm-up utterance on first tap).
- Data survives hard refresh and browser restart.
- Layout at 390 / 768 / 1024 / 1440, portrait and landscape, with safe-area insets.
- App loads with network off after first visit (from P6 onward; shell-only from P1).
- All DB failures surface as toasts.
- No `/absolute` paths anywhere; `grep -rn '"/' index.html js css` returns nothing load-bearing.
