# Backend

Minimal Express backend scaffold for the extension.

## Current routes

- `GET /health`
- `POST /api/posts/batch`
- `GET /api/posts`

## Run

1. `cd backend`
2. `npm install`
3. `npm run dev`

## Current behavior

- accepts a batch of posts
- performs basic request validation
- stores posts in SQLite under `backend/data/feeds-temperature.db`
- deduplicates by `platform + tweetId`
- exposes all currently stored posts via `GET /api/posts`

## Notes

- the database is initialized automatically at startup
- `author` and `media` are stored as JSON strings in SQLite
- duplicate posts are ignored by the database uniqueness constraint
