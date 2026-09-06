# English Mastery

A personal, offline-first English learning system for a Hindi-speaking adult learner. Plain HTML, CSS and vanilla JavaScript ES modules. No build step, no server, no accounts. Everything you do is stored in your browser's IndexedDB and can be exported as one JSON file.

What is inside:

| Module | What it does |
|---|---|
| **Review** | SM-2 spaced repetition for every learnable atom: words, collocations, grammar items, minimal pairs, mistakes, notes, AI corrections. Five rotating card faces per word: meaning, produce from Hindi, cloze, listen and type, use it in a sentence. |
| **Daily 5** | Five new words a day, chosen deterministically by date, with history and per-word retention. Streak with freezes. |
| **Vocabulary** | 1,150+ frequency-ordered entries across A1 to C1, phrasal verbs, idioms, a security-engineering and report-writing deck, and 150 collocations. Each word has IPA, Hindi meaning, Hindi-speaker nuance, 5+ examples with Hindi, collocations, word family and a common Indian-English mistake. |
| **Grammar** | 60 lessons A1 to C1: concept, Hindi explanation, pattern, examples, the mistakes Hindi speakers make, 10 practice items, free production graded by AI. |
| **Pronunciation** | Phoneme lab (44 sounds, record and compare), 122 minimal pairs (ear training then production with speech scoring), word stress trainer, sentence stress and weak forms, connected speech, intonation with pitch curves, tongue twisters. |
| **Shadowing** | 80 sentences: listen at 1.0×, 0.75×, record while shadowing, A/B compare, self-rate, becomes an SRS card. |
| **Listening** | 150 dictation sentences with character diff, plus numbers, dates and spelling drills. |
| **Speaking** | Daily prompt, recording, transcript, AI feedback on grammar, vocabulary range and filler words. |
| **Writing studio** | Email, bug report, Slack, essay, incident and disclosure templates. AI rubric, corrected version with inline diff, every correction becomes a card. |
| **Mistakes** | Every wrong answer and AI correction is logged, grouped by rule, and re-tested more aggressively. |
| **AI tutor** | DeepSeek chat with streaming, context injection from whatever you are studying, threads, rolling summaries, a cost counter, and **long-term memory**: every few messages the tutor distils facts about you (goals, weak points, preferences) into a memory you can view, add to and edit; the Ask button continues your recent conversation instead of starting from zero. |
| **Progress** | Heatmap, skill radar, pronunciation and listening trends, CEFR progress, streak, time studied. |
| **Placement** | 30-question adaptive test on first launch. |
| **Translate** | Hindi → English production drill built from the 6,000+ example pairs in the content; the tutor accepts any natural version. |
| **Tense map** | All 12 tenses on one screen: form, use, signal words, Hindi trap, link to the lesson. |
| **AI words** | Type a topic and the tutor writes full entries (Hindi, examples, common mistake, cloze) into your own deck. |
| **Cloud backup** | Automatic private-Gist backup on your GitHub account; restore on any device with one token. |

## Deploy to GitHub Pages

1. Create a repository (for example `english-mastery`) and push this folder to the `main` branch:

   ```bash
   git init
   git add .
   git commit -m "English Mastery"
   git branch -M main
   git remote add origin git@github.com:<your-user>/english-mastery.git
   git push -u origin main
   ```

2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)`**. Save.
3. After a minute the app is live at `https://<your-user>.github.io/english-mastery/`. All paths are relative, so it works from that subpath.
4. On iPad or iPhone, open the URL in Safari, tap **Share → Add to Home Screen**. The app then runs full-screen and fully offline.

Every time you push, the service worker picks up the new files. If you change JavaScript, CSS or data, bump `VERSION` in `sw.js` so installed devices refresh their cache. Users see a "new version is ready" toast and can reload.

### Run locally

Service workers and ES modules need HTTP, not `file://`:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## The DeepSeek key

DeepSeek is called **only** when you press an AI action (send a message, Look up, Analyse, Grade, Generate, Check with AI, Explain). Nothing runs on a timer, in the background, or on page load. Settings shows calls and spend per feature, this month's spend, and a monthly cap that blocks calls when reached.

The AI tutor, writing rubric, speaking feedback and sentence grading use DeepSeek's `deepseek-chat` model.

1. Create a key at <https://platform.deepseek.com> and set a monthly spending limit there.
2. In the app, go to **Settings → AI tutor**, paste the key, tap **Save key**, then **Test connection**.

The key is stored only in your browser's IndexedDB on that device and is sent only to `https://api.deepseek.com/chat/completions`. It is never in the repository. Do not open the app on a shared or public device. Without a key, everything else still works; the AI features explain how to add one.

## Backups

There is no server. If the browser's site data is cleared, your progress is gone. Two layers protect you:

### Cloud backup (recommended)

Your GitHub account is the account. In **Settings → Cloud backup**, paste a GitHub token (classic, with only the `gist` scope; create it at github.com/settings/tokens/new or run `gh auth token` on your Mac). The app then keeps a private Gist called `english-mastery-backup.json` up to date: about 90 seconds after you stop studying, when you leave the app, and at least once a day. On a new browser or device, paste the same token and tap **Connect and restore existing backup**. Merge keeps both sides (newer record wins). The token is stored only in that browser's IndexedDB and is sent only to api.github.com.

### Manual export

- **Settings → Backup → Export all progress** at least weekly. The app reminds you after seven days. Save the file to iCloud Drive or Files.
- **Import** restores from that file. **Merge** keeps current data and adds the file (newer wins). **Replace** wipes first.
- Exports include cards, reviews, attempts, mistakes, daily sets, notes, chats and settings (including the API key). They exclude audio recordings.
- On iOS, the app asks for persistent storage so Safari is less likely to evict data, but a backup is still the only guarantee.
- The weekly export reminder is silenced once cloud backup is connected.

## Adding your own content

All content lives in `data/*.json`. No code changes are needed to add items. IDs must be unique and stable, because your progress is keyed to them.

| File | Shape | How to add |
|---|---|---|
| `vocab-*.json`, `phrasal-verbs.json`, `idioms.json` | Array of word entries | Append an entry with a new id (`v:b1:0201`). Keep 5+ examples with Hindi. The deck a word belongs to is inferred from its id prefix (`v:a1`, `v:tech`, `v:pv`, `v:id`). |
| `collocations.json` | Array | `col:151`, phrase, pattern, the wrong version, examples. |
| `grammar.json` | Array of lessons | Copy a lesson, give it a new `id`, a unique `order`, exactly 10 practice items (`fill`, `choose`, `fix`, `reorder`, `tf`). |
| `phonemes.json` | Exactly 44 | Edit descriptions only. |
| `minimal-pairs.json` | Array | `mp:<contrast>:NN`, two words with IPA, a sentence each, tips. |
| `stress.json` | Object with five arrays | `sentence_stress.content` are 0-based word indices; `intonation.contour` must have one value per word. |
| `shadowing.json`, `listening.json`, `speaking-prompts.json`, `writing-prompts.json`, `placement.json`, `tenses.json` | See the existing entries | Keep the Hindi fields in Devanagari. |

After editing, run the validator. It checks every required field, Hindi presence, index ranges and duplicate ids:

```bash
python3 tools/validate.py            # all files
python3 tools/validate.py data/grammar.json
```

Then update the counts in `data/index.json` (or regenerate it with the snippet at the top of `tools/validate.py`), bump `VERSION` in `sw.js`, and push.

To add a whole new vocabulary deck, add it to `VOCAB_DECKS` in `js/content.js`, add the filename to `DATA` in `sw.js`, and add a validator entry in `tools/validate.py`.

## Video miner (Phase 7)

Paste any YouTube link (or a video id, or a `youtu.be` short link) on the **Video miner** screen. The app pulls the transcript, finds every word you do not already know, ranks them by how often they appear in that video times how rare they are, keeps the exact sentence each word first appeared in, and hands you a 20/40/60-word lesson with IPA, English and Hindi meanings from DeepSeek. Each word you add becomes a normal review card whose cloze sentence is the line from the video.

**How the transcript is obtained.** A static site cannot fetch YouTube transcripts directly (YouTube sends no CORS headers), so there is a chain:

1. **Transcript proxy (built in).** `worker/youtube-transcript.js` is a small Cloudflare Worker that calls YouTube's player API the way the mobile apps do (the caption URLs embedded in the web page return empty bodies to non-browser clients since 2025). The app ships with Balvant's worker URL as the default; to use your own, deploy it once (dash.cloudflare.com → Workers & Pages → Create → Start with Hello World → Edit code → paste the file → Deploy) and put the URL into **Settings → Video miner**. If YouTube changes its endpoint again, redeploy the latest worker file.
2. **Direct attempt.** Without a proxy the app still tries once and fails fast.
3. **Paste (always works).** Open the video → `…more` → Show transcript → select all → copy → paste into the box the app shows. Timestamps are kept. `.srt`, `.vtt` and `.txt` files can be dropped in too.

Auto-captions arrive without punctuation. If a DeepSeek key is set, the app offers to re-punctuate the text for a few paise so the cloze sentences are real sentences; otherwise each caption line is used as a sentence.

**Meanings.** Right after a video is mined, the app offers to look up the unknown words (one confirm, cost shown). Without a DeepSeek key you get the words and sentences but no explanations, and the page says so in orange. Any word added without a meaning has a **Get meaning** button on its page.

**Cost control.** Every looked-up word is cached forever in your browser (and in your exports), so a word costs money once and never again. Before any lookup you see the estimate in rupees, Settings shows this month's spend, and a monthly cap blocks calls when reached. DeepSeek prices per million tokens and the ₹/$ rate are editable in Settings. Without a key, you still get the word list and the video sentences.

**The protocol.** For each mined video the app walks you through pre-teaching the ten hardest words, watching, then reviewing on day 1 and re-watching on day 3. Re-watching known content is far more effective than chasing new videos.

**Reader mode.** The same engine runs on any pasted text: unknown words are highlighted, tapping one shows the meaning and adds it to reviews, and read-aloud plays sentence by sentence with a "Shadow this" button that hands the line to the shadowing engine.

Transcripts are fetched for your personal study only; keep it that way.

## 🦉 Get Fast Knowledge

Paste any long video (podcast, lecture, course) on the **Get Fast Knowledge** screen. The app fetches the transcript through the same chain as the miner, shows the cost in rupees, and then sends the transcript to DeepSeek **in 2,000-word parts** so nothing is compressed away. Each part comes back as a chapter with every learning written out in full (explanation, examples, steps, a verbatim quote), a Hindi and a Gujarati summary, and glossary terms in English, हिन्दी and ગુજરાતી. A final pass adds the overview, big ideas, an action checklist and a study tip. Guides are stored forever in the library, so a video is paid for once. From the guide page you can save it as its own page in Notes with one tap, write your own notes on it, ask the tutor about it, read it aloud, export Markdown, tick off actions, and ❤ any glossary term into your vocabulary list.

**❤ My vocabulary list.** Every word screen, mined word, reader popup and glossary term has a ❤ button. The list lives at **My vocabulary list** with a revise mode, and it is mirrored as a page in Notes so it survives exports and cloud backup.

## Phase 7 additions at a glance

| Screen | What it does |
|---|---|
| **Today** (landing) | Pick 10 / 20 / 40 minutes; the app composes the session (interleaved reviews → Daily 5 → weakest skill → a lesson → shadowing or re-watch → a production task) and walks you through it with a progress bar. The classic dashboard is at `#/home`. |
| **Video miner** and **Reader** | See the section above. Word cap can be 20/40/60 or **all**; every word has a Google button and Hindi + Gujarati meanings. |
| **Coverage** | Where you stand against the 5,000 most frequent lemmas, estimated text coverage for general / news / academic text, and the 20 highest-value unknown words with one-tap add. |
| **Chunks & phrases** | 300 functional frames (softening, disagreeing, hedging, clarifying, interrupting, bad news, escalating, apologising, summarising, small talk…) and 200 everyday spoken phrases. Cards are production-first: Hindi and function in, English frame out. |
| **Roots & confusables** | 120 Latin/Greek parts with a decode drill, and 106 confusable pairs with a quiz. |
| **Everyday English deck** | 600 items daily life runs on; Daily 5 pulls 3 of its 5 words from here until the deck is finished. |
| **Generate** | New material from your own weaknesses: a reading passage reusing your 8 weakest words, 10 cloze sentences for a word you keep failing, a dialogue on a grammar point you keep breaking, 10 extra practice items for any lesson, and a weekly quiz over this week's mistakes. Strict JSON, validated, cached, cost shown first. |
| **Conversation** | Ten voice roleplays (interview, standup, triage call, doctor, restaurant, bad phone line…). The tutor stays in character and never corrects mid-flow; the report at the end has inline corrections, five "a native would say", your three best moments, and every correction becomes a card. |
| **Commute** | Hands-free audio queue with Media Session controls, sleep timer, star button and a wake-lock toggle. On iPhone/iPad, Safari pauses speech when the screen locks, so keep the screen on. |
| **Pitch curve** | Every recording in the pronunciation drills is analysed for pitch (autocorrelation, 75–350 Hz), speaking rate, and pauses; in the intonation drill your contour is drawn over the model with a one-line verdict. Works on iOS. |
| **Proof** | Weekly cumulative test (25 items across everything), CEFR re-assessment every 30 days with a trajectory chart, a monthly two-minute voice diary you can play side by side, and per-deck retention honesty (decks under 80% are flagged). |
| **Safety** | Anki export (.txt / .csv), GitHub Gist cloud sync, global search on `/`, and the last 3 daily snapshots kept in the browser for one-tap restore. |
| **Say the word** | The third review of every word asks you to say it aloud and scores it (or record-and-compare on iPad), so no word reaches "mastered" unspoken. **Weak-sound detector** on Progress ranks the sounds you actually fail and builds a personal drill deck. Every mined video is closed only after five comprehension questions and a 60-second spoken summary. |

## Security

- **No server, no accounts.** The site is static files on GitHub Pages over HTTPS. There is nothing to log into and no database to breach.
- **Secrets stay on the device.** The DeepSeek key and GitHub token live only in your browser's IndexedDB, are sent only to `api.deepseek.com` and `api.github.com`, and are **never** written into export files or the repository.
- **Content Security Policy.** `index.html` carries a strict CSP: scripts only from the site itself (no inline scripts, no CDNs), network calls only to the listed APIs, no frames, no plugins. A referrer policy of `no-referrer` is set.
- **Output escaping.** All rendering goes through an escaping template helper; user text, AI replies, transcripts and notes are escaped before display, and links from Markdown are restricted to `http(s)` with `rel="noopener"`.
- **Transcript worker.** The Cloudflare Worker answers only requests whose `Origin` is this app (or localhost), so it cannot be used as a free proxy by strangers. It holds no secrets.
- **Third parties you contact when you use the miner:** YouTube (metadata), your own worker, and public Piped mirrors as a fallback (they see the video id only). Cloud backup uses a private Gist under your account.
- **Practical advice:** use a classic GitHub token with only the `gist` scope, set a spending limit on DeepSeek, never open the app on a shared device, and keep exports in a private folder.

## Keyboard shortcuts (desktop)

| Key | Action |
|---|---|
| `Space` | Reveal the card, or apply the suggested grade |
| `1` `2` `3` `4` | Again / Hard / Good / Easy |
| `Enter` | Submit a typed answer, or apply the suggested grade |
| `/` | Focus search |
| `Esc` | Close a sheet, or leave the review |

On a phone or iPad: tap the card to reveal, swipe right for Good, swipe left for Again.

## How it is built

```
index.html               shell
css/theme.css            design tokens, dark default, light theme, Devanagari font stack
css/app.css              layout and components
js/app.js                boot, routes, navigation, service worker registration
js/router.js             hash router; views export render(container, params, query)
js/db.js                 IndexedDB wrapper with versioned additive migrations, export/import
js/srs.js                SM-2 scheduling, queue building
js/store.js              progress operations: cards, reviews, days, streak, daily 5, mistakes, notes
js/content.js            lazy JSON loading and lookups
js/exercise.js           practice item renderer (fill/choose/fix/reorder/tf)
js/tts.js  js/asr.js  js/audio.js   speech synthesis, recognition + word-level scoring, recording
js/ai.js                 DeepSeek streaming client, tutor prompts, structured grading
js/charts.js             SVG heatmap, line, radar, bars, intonation curve
js/i18n.js               Hindi toggle and tap-to-reveal
js/sync.js               cloud backup to a private GitHub Gist
js/lemma.js  js/lemmas.js  js/mine.js  js/youtube.js   tokeniser + lemmatiser, word-state model, mining pipeline, transcript chain
worker/youtube-transcript.js   optional Cloudflare Worker transcript proxy
js/views/*.js            one module per screen
data/*.json              all content
tools/validate.py        content validator;  tools/merge.py merges part files
```

Storage schema, algorithms and content schemas are documented in `PLAN.md`.

## Browser notes

- **iOS and iPadOS Safari** have no `SpeechRecognition`. Scoring drills automatically fall back to record-and-compare with self-rating, which is honest and still effective. Text-to-speech, recording and everything else work. For much better voice quality, download an *Enhanced* English voice under Settings → Accessibility → Spoken Content → Voices.
- **Chrome and Edge** on desktop and Android support speech recognition, so minimal pairs, sentence scoring and speaking prompts get automatic word-by-word feedback.
- Speech recognition sends audio to the browser vendor's service; nothing is sent by this app itself except DeepSeek requests when you use AI features.
