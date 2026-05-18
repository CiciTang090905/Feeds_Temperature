# Backend — operational reference

Express + PostgreSQL backend that ingests captured X posts, deduplicates and
stores them, labels them with the model, and serves aggregate label stats.

This is the **operational deep-dive only**. For architecture, data model,
setup, scripts, gotchas, and project status, see the
[root README](../README.md). This file deliberately does not repeat those.

## Env loading

`src/config/loadEnv.js` loads exactly one file, in this precedence:

1. `ENV_FILE` if explicitly set (absolute, or relative to cwd)
2. `.env.local` if present
3. `.env`

Local dev → `.env.local`. Server → `.env`. They are never merged.

## Routes

All `/api/posts/*` and `/api/users/me` routes require a `Bearer <googleId>`
header (`middleware/requireUser.js`). `auto-login` and `health` do not.

| Method + path | Purpose |
|---|---|
| `GET /health` | Service health |
| `POST /api/users/auto-login` | Create or restore a user from the Chrome profile Google ID |
| `PATCH /api/users/me` | Update the signed-in username |
| `POST /api/posts/batch` | Ingest a batch of captured posts (rate-limited) |
| `GET /api/posts` | List the signed-in user's stored posts (newest first) |
| `GET /api/posts/stats` | Aggregate post + label statistics for the panel |
| `GET /api/posts/events` | Server-Sent Events stream of stats updates (heartbeat every 25s) |

`POST /api/posts/batch` returns `202` with
`{ receivedCount, insertedCount, duplicateCount, acceptedIds, duplicateIds }`.
Rate limit: per-user, default 1000 posts/hour (`INGEST_POST_LIMIT_PER_HOUR`),
in-memory, resets on restart.

## `/api/posts/stats` response shape

Top-level sections: `allTime`, `last24Hours`, `lastWeek`.

For each section:

- `totalPostsWatched` — total labeled rows in that window.
- `allPosts.highlyNegativeArousal.{count,percent,baseline,ratio,zone}` — HAN
  over all posts.
- `allPosts.political.{count,percent,baseline,ratio,zone}` — political over all
  posts.
- `politicalPosts.totalPosts` — number of political posts.
- `politicalPosts.metrics.<metric>.{count,percent,baseline,ratio,zone}` —
  metric over political posts only.

Metric field meanings:

- `count` — number of matching posts.
- `percent` — absolute percentage within the relevant denominator.
- `baseline` — average comparison percentage used by the gauge.
- `ratio` — `percent / baseline * 100`, rounded.
- `zone` — one of `low`, `typical`, `elevated`, `high`.

Political metric keys (camelCase in the response): `partisanAnimosity`,
`supportUndemocraticPractices`, `supportPartisanViolence`,
`supportUndemocraticCandidates`, `oppositionToBipartisanCooperation`,
`socialDistrust`, `socialDistance`, `biasedEvaluationOfPoliticizedFacts`.

## Baselines and zones

Stats ratios compare each user's feed percentages against fixed average
comparison values. The baseline constants and the `low`/`typical`/`elevated`/
`high` zone mapping live in `src/services/baselines.js`. Tune severity
thresholds there.

## Ingest / dedup behavior

`services/postService.js`:

- Upserts the canonical `posts` row on conflict `(platform, tweet_id)`,
  `COALESCE`-ing missing fields and keeping the greatest `captured_at` /
  `received_at`.
- Inserts a `user_posts` link; on conflict updates that user's `captured_at` /
  `received_at` and counts the post as a duplicate for that user.
- Everything runs inside one transaction per batch (`db.withTransaction`).

## Label worker

`labeling/sync/labelWorker.js` polls every `LABEL_POLL_INTERVAL_MS`
(default 10000). Pass 1 = HAN + `is_political`; pass 2 (only if political) = the
8 sublabels. Retriable Azure 5xx / timeout / image-download errors are retried;
content-filter rejections are recorded as an all-zero fallback with a skip
reason so the worker keeps moving.

## Migrations

`node-pg-migrate`, directory `backend/migrations/`, table `pgmigrations`,
single-transaction, advisory-locked. `runDbMigrations()` runs automatically on
backend boot via `db/database.js` → a broken migration blocks startup, not just
the CLI. `npm run db:migrate:create -- <name>` scaffolds from
`scripts/templates/migration-template.mjs`.
