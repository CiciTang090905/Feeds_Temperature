# Feeds Temperature

Chrome extension + local backend for collecting visible X/Twitter posts, uploading them to SQLite, and labeling political-emotion metrics.

## What it does

- Captures visible posts on `x.com` / `twitter.com` in the content script.
- Stores captured posts locally first in `chrome.storage.local` (`captured_posts`).
- Uploads local backlog from the background worker to backend in batches.
- Retries upload every 5 seconds if backend is unavailable.
- Stores posts in SQLite (`backend/data/feeds-temperature.db`) with dedupe on `platform + tweet_id`.
- Runs an auto-label worker:
  - HAN label (`han_label`: high-arousal negative emotion)
  - extra political/social labels (partisan animosity, social distrust, etc.)
- Shows an in-page stats panel on X:
  - draggable
  - minimize/expand toggle
  - refreshes every 10 seconds from backend stats API

## Data flow (captured -> uploaded -> labeled)

1. Content script captures visible posts and writes them to local extension storage.
2. Background script syncs `captured_posts` to backend via `POST /api/posts/batch`.
3. Backend saves rows in SQLite.
4. Label worker polls unlabeled rows and writes HAN + extra label columns.
5. Content script fetches `GET /api/posts/stats` and renders percentages in the panel.

## API endpoints used

- `GET http://localhost:3001/health`
- `POST http://localhost:3001/api/posts/batch`
- `GET http://localhost:3001/api/posts`
- `GET http://localhost:3001/api/posts/stats`

## Local setup

1. Install backend dependencies:
```bash
cd backend
npm install
```
2. Create `backend/.env` and set:
```bash
PORT=3001
LABEL_POLL_INTERVAL_MS=10000
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_KEY=...
AZURE_OPENAI_DEPLOYMENT=...
AZURE_OPENAI_API_VERSION=2024-10-21
```
3. Start backend:
```bash
npm run dev
```
4. Load extension in Chrome:
- open `chrome://extensions`
- enable Developer Mode
- choose "Load unpacked" and select project root

## Backend scripts

Run from `backend/`:

- `npm run dev` -> start backend with auto-reload and label worker
- `npm run start` -> start backend
- `npm run label:one -- --text "<post text>"` -> test one input text
- `npm run label:one -- <db_id>` -> label one DB row by id
- `npm run label:all` -> one-shot labeling pass
- `npm run label:watch` -> continuous labeling loop
- `npm run labels:show` -> print latest labels

## Captured post fields

- `platform`
- `tweetId`
- `author`
- `postedAt`
- `text`
- `media`
- `capturedAt`
- `pageUrl`

## DevTools helpers on X

- `showStoredPosts()`
- `clearStoredPosts()`
- `stopPostCapture()`

## Troubleshooting

- `Backend unavailable: Failed to fetch`
  - ensure backend is running on `http://localhost:3001`
  - run `cd backend && npm run dev`
  - check `curl http://localhost:3001/health`
- `EADDRINUSE: address already in use :::3001`
  - another process already uses port 3001
  - check `lsof -nP -iTCP:3001 -sTCP:LISTEN`
  - stop old process and restart backend
- Pending local posts do not drain
  - confirm backend is healthy
  - reload extension after extension code changes
