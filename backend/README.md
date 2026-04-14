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

## Routes

- `GET /health` -> service health.
- `POST /api/users/register` -> create a pseudonymous account from a generated access code.
- `POST /api/users/login` -> restore account access from an access code.
- `PATCH /api/users/me` -> update the signed-in username.
- `POST /api/posts/batch` -> ingest a batch of captured posts.
- `GET /api/posts` -> list stored posts (newest first).
- `GET /api/posts/stats` -> aggregate post and label statistics for UI display.

## `/api/posts/stats` response shape

- top-level sections:
  - `allTime`
  - `last24Hours`

For each section:
- `totalPostsWatched`: total labeled rows in that window.
- `allPosts.highlyNegativeArousal.{count,percent}`: HAN over all posts.
- `allPosts.political.{count,percent}`: political posts over all posts.
- `politicalPosts.totalPosts`: number of political posts.
- `politicalPosts.metrics.<metric>.{count,percent}`: metric over political posts only.

Political metric keys include:
- `partisanAnimosity`
- `supportUndemocraticPractices`
- `supportPartisanViolence`
- `supportUndemocraticCandidates`
- `oppositionToBipartisanCooperation`
- `socialDistrust`
- `socialDistance`
- `biasedEvaluationOfPoliticizedFacts`

## Storage and labeling behavior

- Managed Postgres via `DATABASE_URL`
- Deduplication: `UNIQUE(user_id, platform, tweet_id)` on `posts`
- `author`, `media`, `quoted_post`, and `label_confidence` are stored as Postgres `JSONB`
- Posts are scoped to a `users` row and identified by a bearer access code hashed in the backend.
- Real-time sync labeling is the active path again.
- The old batch implementation is archived under `backend/src/labeling/batch_archived/` for future reference.
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
- `npm run archived:batch:submit-now` -> archived batch submitter helper
- `npm run archived:batch:poll-now` -> archived batch poller helper
- `npm run archived:batch:status` -> archived batch status helper
- `npm run archived:batch:inspect -- <id>` -> inspect one archived batch job
- `npm run label:one` -> label one text or one DB row
- `npm run label:all` -> one-pass labeling
- `npm run label:watch` -> continuous labeling loop
- `npm run labels:show` -> print latest labels
- `npm run label:eval15` -> evaluate label agreement on random 15 labeled posts

## Archived Batch Notes

- Batch code is archived and not used by the active backend runtime.
- If you revisit it later, the archived scripts and modules still exist for reference.

## Secret handling

- Keep real keys only in the backend env file on the machine that runs the backend.
- Do not commit `backend/.env` or `backend/.env.local`.
- Browser users do not receive these keys unless backend code explicitly exposes them.

## Evaluation output

- `label:eval15` prints to terminal and writes latest report to:
  - `backend/tmp/label-eval-latest.txt`
