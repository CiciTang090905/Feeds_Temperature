# Backend

Express + Postgres backend for ingesting captured X posts, storing them, and serving aggregate label stats.

## Backend setup

```bash
cd backend
npm install
npm run db:migrate
npm run dev
```

Env loading uses one file at a time:

- `ENV_FILE=...` if you explicitly set it
- otherwise `backend/.env.local` when present
- otherwise `backend/.env`

Recommended backend setup:

- local development: keep secrets in `backend/.env.local`
- cloud/server machine: keep secrets in `backend/.env`
- end users do not need to set up env files

Current cloud deployment shape:

- Ubuntu server
- Node 22 runtime
- backend managed by `pm2`
- backend app listens on `127.0.0.1:3001`
- `nginx` reverse proxy serves public HTTP on port `80`
- public health endpoint: `http://34.207.146.239/health`

## Routes

- `GET /health` -> service health.
- `POST /api/users/auto-login` -> create or restore a user from the signed-in Chrome profile.
- `PATCH /api/users/me` -> update the signed-in username.
- `POST /api/posts/batch` -> ingest a batch of captured posts.
- `GET /api/posts` -> list stored posts (newest first).
- `GET /api/posts/stats` -> aggregate post and label statistics for UI display.

## `/api/posts/stats` response shape

- top-level sections:
  - `allTime`
  - `last24Hours`
  - `lastWeek`

For each section:
- `totalPostsWatched`: total labeled rows in that window.
- `allPosts.highlyNegativeArousal.{count,percent,baseline,ratio,zone}`: HAN over all posts.
- `allPosts.political.{count,percent,baseline,ratio,zone}`: political posts over all posts.
- `politicalPosts.totalPosts`: number of political posts.
- `politicalPosts.metrics.<metric>.{count,percent,baseline,ratio,zone}`: metric over political posts only.

Metric fields:
- `count`: number of matching posts.
- `percent`: absolute percentage within the relevant denominator.
- `baseline`: average comparison percentage used by the gauge.
- `ratio`: `percent / baseline * 100`, rounded.
- `zone`: one of `low`, `typical`, `elevated`, or `high`.

Political metric keys include:
- `partisanAnimosity`
- `supportUndemocraticPractices`
- `supportPartisanViolence`
- `supportUndemocraticCandidates`
- `oppositionToBipartisanCooperation`
- `socialDistrust`
- `socialDistance`
- `biasedEvaluationOfPoliticizedFacts`

## Averages

Stats ratios compare each user's feed percentages to average comparison values. The constants and zone mapping live in `backend/src/services/baselines.js`.

## Storage and labeling behavior

- Managed Postgres via `DATABASE_URL`
- Cross-user deduplication: canonical `posts` are unique on `(platform, tweet_id)`, and `user_posts` tracks which user saw which post
- `author`, `media`, `quoted_post`, and `label_confidence` are stored as Postgres `JSONB`
- Posts are scoped to a `users` row and identified by the Chrome profile's Google ID sent in the bearer header.
- Real-time sync labeling is the active path.
- Prompt separation is preserved:
  - HAN prompt
  - political prompt
  - 8 individual sublabel prompts
- Internal metadata:
  - confidence and audit fields are stored in `label_confidence`
  - includes image usage flags from model outputs (`image_used_*`)

## Scripts

- `npm run dev` -> backend with nodemon + auto label worker
- `npm run start` -> backend start
- `npm run db:migrate` -> run pending Postgres migrations
- `npm run db:rollback` -> roll back one Postgres migration
- `npm run db:migrate:create -- <name>` -> create a new migration stub
- `npm run db:copy:sqlite` -> copy rows from local SQLite into Postgres
- `npm run label:one` -> label one text or one DB row
- `npm run label:all` -> one-pass labeling
- `npm run label:watch` -> continuous labeling loop
- `npm run labels:show` -> print latest labels
- `npm run label:eval15` -> evaluate label agreement on random 15 labeled posts
- `npm run label:stability -- 15 10` -> rerun labeling on one random 15-post sample across 10 shuffled rounds and compare stability

## Secret handling

- Keep real keys only in the backend env file on the machine that runs the backend.
- Do not commit `backend/.env` or `backend/.env.local`.
- Browser users do not receive these keys unless backend code explicitly exposes them.
- Browser auth now comes from Chrome identity and backend Google ID lookup only.

## Evaluation output

- `label:eval15` prints to terminal and writes latest report to:
  - `backend/tmp/label-eval-latest.txt`
- `label:stability` prints to terminal and writes latest report to:
  - `backend/tmp/label-stability-latest.txt`
