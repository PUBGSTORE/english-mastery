# English Mastery — Setup guide

Everything you need to run your own copy. No build step, no server. Ten minutes end to end.

## What you get

A personal English-learning app (spaced repetition, grammar, pronunciation, shadowing, listening, writing, AI tutor, YouTube video miner, Get Fast Knowledge, everyday vocabulary, progress tracking) that runs as a website and installs on iPad/iPhone/Android/desktop as an app. All your progress stays in your browser and backs up to your own GitHub account.

## 1. Put the site online (GitHub Pages, free)

1. Create a GitHub account if you don't have one, then create a new **public** repository named `english-mastery`.
2. Unzip this archive and upload everything inside it to the repository. Either drag the files into the GitHub web page ("Add file → Upload files"), or from a terminal:

   ```bash
   cd english-mastery
   git init && git add . && git commit -m "English Mastery"
   git branch -M main
   git remote add origin https://github.com/<your-username>/english-mastery.git
   git push -u origin main
   ```

3. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root) → Save**.
4. After about a minute the app is live at `https://<your-username>.github.io/english-mastery/`.

To run it on your own computer instead: `python3 -m http.server 8080` inside the folder, then open `http://localhost:8080`.

## 2. Install it on iPad / iPhone / Android

Open the link in Safari (iOS) or Chrome (Android) → **Share → Add to Home Screen**. It runs full-screen and works offline after the first load. On iPad, download an "Enhanced" English voice under Settings → Accessibility → Spoken Content → Voices for much better audio.

## 3. Turn on the AI (DeepSeek, a few rupees a month)

1. Create an account at <https://platform.deepseek.com>, add a small balance, and set a monthly spending limit there.
2. Create an API key.
3. In the app: **Settings → AI tutor → API key → Save key → Test connection**.

The key is stored only in that browser. The AI is called only when you press an AI button; Settings shows spend per feature and lets you set a monthly cap. Without a key everything else still works.

## 4. Turn on automatic backups (GitHub Gist, free)

1. Go to <https://github.com/settings/tokens/new>, name it "English Mastery backup", tick only the **gist** scope, set the expiry you want, and generate it.
2. In the app: **Settings → Cloud backup → paste the token → Connect**.

From then on every study session is backed up automatically to a private Gist on your account. On a new device: install the app, paste the same token, tap **Connect and restore existing backup**. Keep the token somewhere safe; it is never written into export files.

Manual export/import (a JSON file) is also in Settings.

## 5. Video miner and Get Fast Knowledge (transcripts)

Browsers cannot fetch YouTube transcripts directly, so the app uses a tiny proxy on Cloudflare (free). One is built in already. To run your own:

1. Sign in at <https://dash.cloudflare.com> → **Workers & Pages → Create → Start with Hello World → Deploy → Edit code**.
2. Delete the sample code, paste the contents of `worker/youtube-transcript.js`, and change the `ALLOWED_ORIGINS` line to your own site address (for example `https://<your-username>.github.io`). Click **Deploy**.
3. Copy the worker URL (`https://something.yourname.workers.dev`) into **Settings → Video miner → Transcript proxy URL → Test proxy**.

Or from a terminal: `cd worker && npx wrangler login && npx wrangler deploy`.

YouTube sometimes blocks automated access for a minute; the app retries, offers **Try again**, and always lets you paste the transcript (open the video → "…more" → Show transcript → copy).

## 6. First day

1. Take the 5-minute placement test when the app offers it.
2. Open **Today**, pick 20 minutes, and follow the bar at the top.
3. Try **🌞 Every day vocab → Today's 10**.
4. Switch to **🧠 Knowledge** (top of the sidebar) for Daily Discovery, video analysis and the Book explainer.

## Adding your own content

All lessons and word lists are JSON files in `data/`. Edit them in any text editor, run `python3 tools/validate.py` to check them, bump `VERSION` in `sw.js`, and push. See `README.md` for every file's shape.

## If something breaks

- **"A new version is ready"** toast: tap Reload. If you don't see new features after an update, close the app completely and open it twice.
- **No meanings for mined words**: add the DeepSeek key (Settings) and tap Look up.
- **Transcript failed**: tap Try again after a minute, or paste the transcript.
- **Lost progress**: Settings → Cloud backup → Restore, or Settings → Local auto-backups → Restore.
