# Backend

Express + SQLite backend for ingesting captured X posts, storing them, and serving aggregate label stats.

## Run locally

```bash
cd backend
npm install
npm run dev
```

The database is auto-initialized at startup.

## Routes

- `GET /health` -> service health.
- `POST /api/posts/batch` -> ingest a batch of captured posts.
- `GET /api/posts` -> list stored posts (newest first).
- `GET /api/posts/stats` -> aggregate post and label statistics for UI display.

## `/api/posts/stats` response shape

- `totalPostsWatched`: total rows in `posts`.
- `metrics.<metricName>.count`: number of posts labeled `1` for that metric.
- `metrics.<metricName>.percent`: rounded percent of total posts for that metric.

Example metric keys include:
- `highlyNegativeArousal`
- `partisanAnimosity`
- `supportUndemocraticPractices`
- `supportPartisanViolence`
- `supportUndemocraticCandidates`
- `oppositionToBipartisanCooperation`
- `socialDistrust`
- `socialDistance`
- `biasedEvaluationOfPoliticizedFacts`

## Storage and labeling behavior

- SQLite file: `backend/data/feeds-temperature.db`
- Deduplication: `UNIQUE(platform, tweet_id)` on `posts`
- `author` and `media` are stored as JSON strings
- Labeling runs in background worker and writes:
  - HAN label: `han_label`
  - extra label columns from label catalog

## Scripts

- `npm run dev` -> backend with nodemon + auto label worker
- `npm run start` -> backend start
- `npm run label:one` -> label one text or one DB row
- `npm run label:all` -> one-pass labeling
- `npm run label:watch` -> continuous labeling loop
- `npm run labels:show` -> print latest labels
