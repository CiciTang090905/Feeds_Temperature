# Feeds Temperature

Chrome extension + backend for collecting visible X/Twitter posts, uploading them to managed Postgres, and labeling political-emotion metrics.

## What it does

- Captures visible posts on `x.com` / `twitter.com` in the content script.
- Stores captured posts locally first in `chrome.storage.local` (`captured_posts`).
- Uploads local backlog from the background worker to backend in batches.
- Retries upload every 5 seconds if backend is unavailable.
- Stores posts in Postgres via `DATABASE_URL` with dedupe on `user_id + platform + tweet_id`.
- Uses a pseudonymous access code stored in `chrome.storage.local` to locate each user's own data.
- Runs real-time sync labeling in the backend worker.
- Supports a hosted backend deployment behind `nginx` on port `80`.
- Prompt structure is still separated for clarity:
  - HAN
  - political
  - 8 individual sublabels
- The previous batch implementation is archived in the repo for future reference.
- Shows an in-page stats panel on X:
  - draggable
  - minimize/expand toggle
  - refreshes every 10 seconds from backend stats API
  - sections for both `All Time` and `Last 24 Hours`:
    - Posts watched
    - % of all posts (HAN, Political)
    - % of political posts (8 sublabels)

## Data flow (captured -> uploaded -> labeled)

1. Content script captures visible posts and writes them to local extension storage.
2. Background script syncs `captured_posts` to backend via `POST /api/posts/batch`.
3. Backend saves rows in Postgres.
4. Sync label worker picks up unlabeled rows:
   - first pass: HAN + is_political
   - second pass (conditional): 8 political sublabels when `is_political = 1`
5. Content script fetches `GET /api/posts/stats` and renders percentages in the panel.

## API endpoints used

- Local backend:
  - `GET http://localhost:3001/health`
  - `POST http://localhost:3001/api/users/register`
  - `POST http://localhost:3001/api/users/login`
  - `PATCH http://localhost:3001/api/users/me`
  - `POST http://localhost:3001/api/posts/batch`
  - `GET http://localhost:3001/api/posts`
  - `GET http://localhost:3001/api/posts/stats`
- Current hosted backend:
  - `GET http://34.207.146.239/health`
  - `POST http://34.207.146.239/api/users/register`
  - `POST http://34.207.146.239/api/users/login`
  - `PATCH http://34.207.146.239/api/users/me`
  - `POST http://34.207.146.239/api/posts/batch`
  - `GET http://34.207.146.239/api/posts`
  - `GET http://34.207.146.239/api/posts/stats`

## Local developer setup

1. Install backend dependencies:
```bash
cd backend
npm install
```
2. Create `backend/.env.local` and set:
```bash
PORT=3001
LABEL_POLL_INTERVAL_MS=10000
DATABASE_URL=postgres://USER:PASSWORD@HOST/DBNAME?sslmode=require
OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_KEY=...
AZURE_OPENAI_DEPLOYMENT=...
AZURE_OPENAI_API_VERSION=2024-10-21
```
   For a future cloud machine, use `backend/.env` instead of `backend/.env.local`.
   If you want a custom location, set `ENV_FILE=/absolute/path/to/your.env`.
3. Start backend:
```bash
npm run db:migrate
npm run dev
```
4. Load extension in Chrome:
- open `chrome://extensions`
- enable Developer Mode
- choose "Load unpacked" and select project root

## Current hosted deployment

- Backend machine runs Ubuntu + Node 22
- App process is managed by `pm2` as `feeds-temperature-backend`
- Node backend listens internally on `127.0.0.1:3001`
- `nginx` proxies public port `80` to the backend
- Public health endpoint:
  - `http://34.207.146.239/health`

Useful server commands after `ssh dialog-temperature`:

```bash
pm2 status
pm2 logs feeds-temperature-backend --lines 100
curl -s http://127.0.0.1:3001/health
curl -s http://127.0.0.1/health
```

End users do not need to set up env files or handle API keys. Those stay on the backend machine only.

## Backend scripts

Run from `backend/`:

- `npm run dev` -> start backend with auto-reload and label worker
- `npm run start` -> start backend
- `npm run db:migrate` -> run pending Postgres migrations
- `npm run db:rollback` -> roll back one Postgres migration
- `npm run db:migrate:create -- <name>` -> create a new migration stub
- `npm run db:copy:sqlite` -> copy rows from `backend/data/feeds-temperature.db` into Postgres
- `npm run archived:batch:submit-now` -> archived batch submitter helper
- `npm run archived:batch:poll-now` -> archived batch poller helper
- `npm run archived:batch:status` -> archived batch status helper
- `npm run archived:batch:inspect -- <id>` -> inspect one archived batch job
- `npm run label:one -- --text "<post text>"` -> test one input text
- `npm run label:one -- <db_id>` -> label one DB row by id
- `npm run label:all` -> one-shot labeling pass
- `npm run label:watch` -> continuous labeling loop
- `npm run labels:show` -> print latest labels
- `npm run label:eval15` -> sample 15 labeled posts, re-label, and print agreement report
- `npm run label:stability -- 15 10` -> sample 15 posts once, rerun labeling on the same set for 10 shuffled rounds, and compare stability

## Archived Batch Note

- The old batch pipeline is archived, not active.
- Only the backend machine should have these env files. The extension/frontend should never contain API keys.

## Captured post fields

- `platform`
- `tweetId`
- `author`
- `postedAt`
- `text`
- `media`
- `quotedPost` (optional quoted-post context: `url`, `tweetId`, `author`, `text`, `media`)
- `capturedAt`
- `pageUrl`

## DevTools helpers on X

- `showStoredPosts()`
- `clearStoredPosts()`
- `stopPostCapture()`

## Troubleshooting

- `Backend unavailable: Failed to fetch`
  - local mode: ensure backend is running on `http://localhost:3001`
  - hosted mode: check `http://34.207.146.239/health`
  - run `cd backend && npm run dev` for local development
- `EADDRINUSE: address already in use :::3001`
  - another process already uses port 3001
  - check `lsof -nP -iTCP:3001 -sTCP:LISTEN`
  - stop old process and restart backend
- Pending local posts do not drain
  - confirm backend is healthy
  - reload extension after extension code changes

## Evaluation report output

- `npm run label:eval15` also writes the latest report to:
  - `backend/tmp/label-eval-latest.txt`
- `npm run label:stability -- 15 10` also writes the latest report to:
  - `backend/tmp/label-stability-latest.txt`
- `backend/tmp/` is git-ignored.
