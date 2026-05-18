# Feeds Temperature

Chrome extension + backend for collecting visible X/Twitter posts, uploading them to Postgres on the hosted backend machine, and labeling political-emotion metrics.

## What it does

- Captures visible posts on `x.com` / `twitter.com` in the content script.
- Stores captured posts locally first in `chrome.storage.local` (`captured_posts`).
- Uploads local backlog from the background worker to backend in batches.
- Retries upload every 5 seconds if backend is unavailable.
- Stores canonical posts in Postgres via `DATABASE_URL` with dedupe on `platform + tweet_id`, plus per-user links in `user_posts`.
- Uses the signed-in Chrome profile to auto-create and restore each user's backend account.
- Runs real-time sync labeling in the backend worker.
- Hosted deployment runs the Node backend and Postgres on the same Ubuntu machine; Postgres is bound to localhost only.
- Prompt structure is still separated for clarity:
  - HAN
  - political
  - 8 individual sublabels
- Shows an in-page stats panel on X:
  - draggable
  - minimize/expand toggle
  - refreshes every 10 seconds from backend stats API
  - tabs for `All time`, `Last 24h`, and `Last week`:
    - Posts watched
    - % of all posts (HAN, Political)
    - % of political posts (8 sublabels)

## Data flow (captured -> uploaded -> labeled)

1. Content script captures visible posts and writes them to local extension storage.
2. Background script syncs `captured_posts` to backend via `POST /api/posts/batch`.
3. Backend saves rows in Postgres on the backend machine.
4. Sync label worker picks up unlabeled rows:
   - first pass: HAN + is_political
   - second pass (conditional): 8 political sublabels when `is_political = 1`
5. Content script fetches `GET /api/posts/stats` and renders percentages in the panel.

## API endpoints used

- Local backend:
  - `GET http://localhost:3001/health`
  - `POST http://localhost:3001/api/users/auto-login`
  - `PATCH http://localhost:3001/api/users/me`
  - `POST http://localhost:3001/api/posts/batch`
  - `GET http://localhost:3001/api/posts`
  - `GET http://localhost:3001/api/posts/stats`
- Current hosted backend:
  - `GET http://34.207.146.239/health`
  - `POST http://34.207.146.239/api/users/auto-login`
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
   For a local loopback database, use `postgres://USER:PASSWORD@127.0.0.1:5432/DBNAME` without `sslmode=require`.
   On the cloud machine, use `backend/.env` instead of `backend/.env.local`.
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
- PostgreSQL 16 runs on the same machine and listens only on `localhost:5432`
- Server-only `backend/.env` contains `DATABASE_URL` and Azure/OpenAI credentials; do not commit it
- Daily local `pg_dump` backups run from cron into `/var/backups/feeds-temperature/`, keeping 7 days
- Current backup limitation: dumps are on the same machine, so they protect against bad migrations or app mistakes, not whole-machine loss. TODO: add an off-machine encrypted backup copy before real study data lands.
- Public health endpoint:
  - `http://34.207.146.239/health`

Useful server commands after `ssh dialog-temperature`:

```bash
pm2 status
pm2 logs feeds-temperature-backend --lines 100
curl -s http://127.0.0.1:3001/health
curl -s http://127.0.0.1/health
sudo -u postgres psql -d feeds_temperature
sudo /usr/local/bin/backup-feeds-db.sh
```

End users do not need to set up env files or handle API keys. They sign in automatically through the Chrome profile already active in the browser.

## Backend scripts

Run from `backend/`:

- `npm run dev` -> start backend with auto-reload and label worker
- `npm run start` -> start backend
- `npm run db:migrate` -> run pending Postgres migrations
- `npm run db:rollback` -> roll back one Postgres migration
- `npm run db:migrate:create -- <name>` -> create a new migration stub
- `npm run db:copy:sqlite` -> copy rows from `backend/data/feeds-temperature.db` into Postgres
- `npm run label:one -- --text "<post text>"` -> test one input text
- `npm run label:one -- <db_id>` -> label one DB row by id
- `npm run label:all` -> one-shot labeling pass
- `npm run label:watch` -> continuous labeling loop
- `npm run labels:show` -> print latest labels
- `npm run label:eval15` -> sample 15 labeled posts, re-label, and print agreement report
- `npm run label:stability -- 15 10` -> sample 15 posts once, rerun labeling on the same set for 10 shuffled rounds, and compare stability

Only the backend machine should have these env files. The extension/frontend should never contain API keys.

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

`capturedAt` is a Unix timestamp in milliseconds from the browser. In the database:

- `posts.captured_at` is on the canonical deduplicated post row.
- `user_posts.captured_at` is the per-user feed exposure time and is usually the better field for analysis.
- Use `to_timestamp(user_posts.captured_at / 1000.0)` in SQL when you want a readable timestamp.

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
