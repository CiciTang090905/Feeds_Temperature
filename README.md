# Feeds_temperature

Chrome extension + local backend for capturing visible X/Twitter posts, syncing them to SQLite, and auto-labeling high-arousal negative emotion (`han_label` = `0/1`).

## Architecture

- Extension content script captures visible posts on X/Twitter.
- Captured posts are first stored in `chrome.storage.local` (`captured_posts`).
- Background service worker syncs to backend:
  - `POST http://localhost:3001/api/posts/batch`
  - retries every 5 seconds when backend is unavailable
- Backend stores posts in SQLite: `backend/data/feeds-temperature.db`.
- Label worker polls unlabeled rows and writes `han_label`.

## Captured payload

Each captured post includes:

- `platform`
- `tweetId`
- `author`
- `postedAt`
- `text`
- `media`
- `capturedAt`
- `pageUrl`

## Project layout

- `manifest.json`, `content.js`, `background.js`, `popup.*`, `options.*`: extension
- `backend/`: Express + SQLite + labeling scripts

## Local setup

1. Install backend deps:
   - `cd backend`
   - `npm install`
2. Create backend env file:
   - create `backend/.env` from the template values below
3. Fill required values in `backend/.env`:
   - `PORT=3001`
   - `LABEL_POLL_INTERVAL_MS=10000`
   - `AZURE_OPENAI_ENDPOINT=...`
   - `AZURE_OPENAI_KEY=...`
   - `AZURE_OPENAI_DEPLOYMENT=...`
   - `AZURE_OPENAI_API_VERSION=2024-10-21`
4. Start backend:
   - `npm run dev`
5. Load extension in Chrome:
   - Open `chrome://extensions`
   - Enable Developer Mode
   - Load unpacked folder: project root

## Backend scripts

Run from `backend/`:

- `npm run dev`: backend + auto label worker
- `npm run start`: production-style start
- `npm run label:one -- --text "<post text>"`: test one text
- `npm run label:one -- <db_id>`: label a specific DB row by id
- `npm run label:all`: one-shot labeling for unlabeled posts
- `npm run label:watch`: continuous labeling loop
- `npm run labels:show`: show latest labels

## Runtime behavior

- Posts are deduplicated by `UNIQUE(platform, tweet_id)`.
- DB `id` can have gaps (normal with `INSERT OR IGNORE` + autoincrement).
- Label worker batch size is 25 posts per run.
- Worker logs each row as:
  - `processing: <platform>:<platformPostId> | db_id:<id> --> label:<0|1>`
- If provider content filtering blocks a row, worker applies fallback label `0` and continues.

## DevTools helpers on X

The content script exposes:

- `showStoredPosts()`
- `clearStoredPosts()`
- `stopPostCapture()`

## Troubleshooting

- Popup shows `Backend unavailable: Failed to fetch`:
  - backend is not reachable on `http://localhost:3001`
  - start backend and keep it running: `cd backend && npm run dev`
  - verify: `curl http://localhost:3001/health`
- `EADDRINUSE: address already in use :::3001`:
  - another process is already on port 3001
  - check: `lsof -nP -iTCP:3001 -sTCP:LISTEN`
  - stop old process, then restart backend
- Pending posts not draining:
  - reload extension after background code changes
  - confirm backend is running and healthy
