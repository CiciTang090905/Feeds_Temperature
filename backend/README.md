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

- SQLite file: `backend/data/feeds-temperature.db`
- Deduplication: `UNIQUE(platform, tweet_id)` on `posts`
- `author` and `media` are stored as JSON strings
- Labeling runs in background worker with 2 passes:
  - pass A for every post: `han_label`, `is_political`
  - pass B only when political: 8 sublabels from label catalog
- Internal metadata:
  - confidence and audit fields are stored in `label_confidence_json`
  - includes image usage flags from model outputs (`image_used_*`)

## Scripts

- `npm run dev` -> backend with nodemon + auto label worker
- `npm run start` -> backend start
- `npm run label:one` -> label one text or one DB row
- `npm run label:all` -> one-pass labeling
- `npm run label:watch` -> continuous labeling loop
- `npm run labels:show` -> print latest labels
- `npm run label:eval15` -> evaluate label agreement on random 15 labeled posts

## Evaluation output

- `label:eval15` prints to terminal and writes latest report to:
  - `backend/tmp/label-eval-latest.txt`
