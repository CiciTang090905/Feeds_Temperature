# Feeds Temperature

A research instrument for studying exposure to affectively-polarizing political
content on X / Twitter. A Chrome extension passively captures the posts a user
actually sees in their feed, a backend stores and labels them with the model,
and an in-page panel reflects back the emotional and political "temperature" of
what that user has been exposed to.

This README is the **single source of truth for orientation**. For backend
operational detail (full route list, `/stats` response shape, baselines), see
[`backend/README.md`](backend/README.md).

---

## Architecture at a glance

```
                          BROWSER (user's Chrome profile)
  ┌───────────────────────────────────────────────────────────────────────┐
  │  content.js                         background.js (service worker)     │
  │  ┌─────────────────────┐            ┌──────────────────────────────┐   │
  │  │ scan visible posts  │  chrome.   │ read backlog                 │   │
  │  │ every 1s on x.com   │──storage──▶│ auto-login via Chrome ID     │   │
  │  │ dedupe by tweet_id  │  .local    │ POST batches (≤15)           │   │
  │  └─────────────────────┘ captured_  │ retry every 5s if offline    │   │
  │  ┌─────────────────────┐  posts     └──────────────┬───────────────┘   │
  │  │ stats panel (10s    │◀── GET /api/posts/stats ───┤                   │
  │  │ refresh, draggable) │                            │                   │
  │  └─────────────────────┘                            │                   │
  └─────────────────────────────────────────────────────┼───────────────────┘
                                                         │ HTTP, Bearer = Google ID
                          HOSTED MACHINE (Ubuntu, EC2)   ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │  nginx :80  ──▶  Node backend 127.0.0.1:3001                    │
  │                 pm2 process: feeds-temperature-backend           │
  │                       │                                                │
  │                       ├─ Express API (users / posts / stats / events)  │
  │                       │                                                │
  │                       ├─ label worker (polls unlabeled rows)           │
  │                       │     pass 1: HAN + is_political                 │
  │                       │     pass 2 (if political): 8 sublabels         │
  │                       │            │                                   │
  │                       ▼            ▼                                   │
  │             PostgreSQL 16 (localhost:5432 only)                        │
  │             posts ── user_posts ── users                               │
  │                       │                                                │
  │             daily pg_dump ▶ /var/backups/feeds-temperature (7 days)    │
  └───────────────────────────────────────────────────────────────────────┘
                                       ▲
                        Azure OpenAI (chat completions) for labeling
```

### Data flow (capture → upload → label → display)

1. `content.js` scans `article[data-testid="tweet"]` elements that are in the
   viewport, extracts text / author / media / quoted-post context, dedupes by
   `tweetId`, and appends to `chrome.storage.local` under `captured_posts`.
2. `background.js` resolves the user from the signed-in Chrome profile
   (`chrome.identity.getProfileUserInfo`), auto-logs-in against the backend, and
   uploads the local backlog in batches of up to 15 via `POST /api/posts/batch`.
   If the backend is unreachable it retries every 5 seconds.
3. The backend upserts a **canonical** row into `posts` (deduplicated on
   `(platform, tweet_id)` across all users) and a per-user link row into
   `user_posts`.
4. The label worker polls for unlabeled rows. Pass 1 classifies HAN
   (high-arousal negative emotion) and `is_political`. If political, pass 2
   classifies the 8 political sublabels. Non-political posts get `NULL`
   sublabels.
5. The in-page panel polls `GET /api/posts/stats` every 10 seconds and renders
   per-window percentages with severity zones against baseline averages.

---

## Demonstration

### Live stats panel

The extension injects a draggable, minimizable panel onto `x.com` /
`twitter.com`. It refreshes every 10 seconds and reflects the emotional and
political temperature of the posts the user has actually been exposed to,
across All time / Last 24h / Last week windows, with severity zones relative to
baseline averages.

![Feed Temperature stats panel overlaid on the X feed, showing the labeled-progress bar, time-window tabs, and severity gauges for negative arousal, political content, partisan animosity, and undemocratic practices](docs/stats-panel-demo.webp)

### Data model in practice

The canonical `posts` table: one deduplicated row per `(platform, tweet_id)`,
with JSONB columns for `author` / `media` / `quoted_post` / `label_confidence`
and the HAN, `is_political`, and 8 political sublabel columns populated by the
two-pass label worker.

![The posts table schema showing the id, platform, tweet_id, author, label, and the eight political sublabel columns](docs/posts-schema.webp)

---

## Repository layout

```
.
├── manifest.json              Chrome MV3 extension manifest
├── content.js                 In-page capture + draggable stats panel
├── background.js              Service worker: auth, batching, sync, retry
├── popup.js / popup.html      Extension popup (status, pending/synced counts)
├── console.js                 Standalone DevTools-paste capture script (legacy/manual)
├── icon.png
├── docs/                      Screenshots used in this README
└── backend/
    ├── package.json           Scripts live here (see Scripts section)
    ├── migrations/            node-pg-migrate migrations (run automatically on boot)
    ├── scripts/               One-off + eval scripts (labeling, db, sqlite copy)
    └── src/
        ├── server.js          Boot: init DB, start label worker, listen
        ├── app.js             Express app + route mounting
        ├── config/loadEnv.js  Single-file env loader (precedence below)
        ├── db/
        │   ├── database.js    pg Pool, query/run/all, withTransaction
        │   └── migrate.js     getDatabaseUrl(), runDbMigrations()
        ├── routes/            health, users, posts
        ├── controllers/       request handling
        ├── middleware/        requireUser (Bearer = Google ID), ingestRateLimit
        ├── services/          postService, userService, labelService, baselines
        └── labeling/
            ├── sync/labelWorker.js   the polling worker
            └── shared/               catalog.js (label defs) + prompts.js
```

---

## Data model

Three tables. The key idea: a post is stored **once** canonically; which users
saw it is tracked separately.

| Table        | Purpose | Notable columns |
|--------------|---------|-----------------|
| `posts`      | Canonical deduplicated post + its labels | `UNIQUE(platform, tweet_id)`; `author`/`media`/`quoted_post`/`label_confidence` are `JSONB`; `captured_at` `bigint` (ms epoch); `received_at` `timestamptz`; `han_label`, `is_political`, and 8 sublabel `smallint` columns |
| `users`      | One row per study participant | `token_hash` (unique), `username`, `created_at`, `last_seen`. Resolved from the Chrome profile Google ID. |
| `user_posts` | Many-to-many: which user saw which post | PK `(user_id, post_id)`; per-user `captured_at` (ms epoch) and `received_at` |

The 8 political sublabel columns: `partisan_animosity`,
`support_undemocratic_practices`, `support_partisan_violence`,
`support_undemocratic_candidates`, `opposition_bipartisan_cooperation`,
`social_distrust`, `social_distance`, `biased_evaluation_politicized_facts`.

The schema is created and migrated **automatically when the backend boots**
(`ensureInitialized()` → `runDbMigrations()` in `backend/src/db/database.js`).
There is no manual schema SQL file — the `migrations/` directory is the schema.

---

## The labeling system

Two-pass, conditional, model-based classification. Definitions and per-label
guidance live in `backend/src/labeling/shared/catalog.js`; prompt templates in
`backend/src/labeling/shared/prompts.js`.

- **Pass 1 (every post):** HAN — high-arousal negative emotion (anger, outrage,
  hostility — *not* sadness/worry/neutral), and `is_political`.
- **Pass 2 (only if `is_political = 1`):** the 8 sublabels above, each scored
  independently as 0/1 with a confidence value.
- Posts can attach an image / video thumbnail and quoted-post text as supporting
  context; there is an automatic text-only fallback on image-download timeouts.
- Azure OpenAI content-filter rejections are caught and recorded as an all-zero
  fallback with a skip reason rather than crashing the worker.
- Confidence values and image-usage flags are stored in the `label_confidence`
  JSONB column for auditing.

---

## Local developer setup

```bash
cd backend
npm install
npm run db:migrate     # optional; the backend also runs migrations on boot
npm run dev            # nodemon + label worker
```

Create `backend/.env.local`:

```bash
PORT=3001
LABEL_POLL_INTERVAL_MS=10000
DATABASE_URL=postgres://USER:PASSWORD@HOST/DBNAME?sslmode=require
AZURE_OPENAI_ENDPOINT=...
AZURE_OPENAI_KEY=...
AZURE_OPENAI_DEPLOYMENT=...
AZURE_OPENAI_API_VERSION=2024-10-21
```

> **SSL gotcha — read this.** `DATABASE_URL` is passed verbatim to the `pg`
> Pool, so SSL is decided entirely by the connection string.
> - Remote managed Postgres → keep `?sslmode=require`.
> - **Local loopback Postgres → drop `?sslmode=require`**, i.e.
>   `postgres://USER:PASSWORD@127.0.0.1:5432/DBNAME`. Leaving it on will fail
>   unless you configure server certs.

Load the unpacked extension:

1. `chrome://extensions` → enable Developer Mode
2. "Load unpacked" → select the **project root** (where `manifest.json` is)

End users do not configure env files or API keys. They are signed in
automatically from the active Chrome profile.

---

## Hosted deployment

- Ubuntu + Node 22 EC2 machine.
- Backend managed by `pm2` as `feeds-temperature-backend`, listening on
  `127.0.0.1:3001`.
- `nginx` reverse-proxies public port `80` to the backend.
- PostgreSQL 16 on the same machine, bound to `localhost:5432` only (never
  externally reachable).
- App database `feeds_temperature`, app role `feeds_app`.
- Server env file: `backend/.env` (uncommitted; holds the local Postgres
  password and Azure credentials).
- Daily `pg_dump` via root cron → `/var/backups/feeds-temperature/`, root-owned,
  7-day retention. Backup auth uses root's `0600` `~/.pgpass`.
- Public health check: `http://34.207.146.239/health`

### Server runbook

After `ssh dialog-temperature`:

```bash
pm2 status
pm2 logs feeds-temperature-backend --lines 100
curl -s http://127.0.0.1:3001/health        # app direct
curl -s http://127.0.0.1/health             # via nginx
sudo -u postgres psql -d feeds_temperature  # inspect DB
sudo /usr/local/bin/backup-feeds-db.sh      # manual backup (run before risky migrations)
```

### Database inspection from DBeaver

Postgres is not publicly reachable. Use an SSH tunnel through the backend
machine:

- SSH host: `34.207.146.239`
- SSH port: `22`
- SSH user: `ubuntu`
- SSH auth: your local key from the `dialog-temperature` SSH config
- Database host inside the tunnel: `127.0.0.1`
- Database port: `5432`
- Database name: `feeds_temperature`
- Database user: `feeds_app`
- Database password: read from the server-only `backend/.env`; never commit it

---

## Things to note

- **The backend IP `34.207.146.239` is hardcoded.** It appears in
  `manifest.json` (`host_permissions`) and as the `BACKEND_*_URL` constants in
  `background.js`. If the EC2 box ever gets a new public IP, the extension
  **silently stops working** with no visible error. Both files must be updated
  together and the extension reloaded.
- **SSL in `DATABASE_URL`** — see the boxed gotcha in Local setup. This is the
  single most common local-vs-server breakage.
- **Two env files, loaded one at a time** by `backend/src/config/loadEnv.js`,
  in this precedence: `ENV_FILE` (if set) → `.env.local` (if present) →
  `.env`. On the server you usually want `.env`; locally `.env.local`. Editing
  the wrong one is a classic "why is nothing changing" trap.
- **`captured_at` lives in two places.** `posts.captured_at` is on the shared
  canonical row; `user_posts.captured_at` is the per-user feed-exposure time.
  For any per-participant analysis use `user_posts.captured_at`, and
  `to_timestamp(user_posts.captured_at / 1000.0)` for readable SQL (it is a
  millisecond epoch, not a timestamp).
- **Migrations auto-run on boot.** A bad migration will block startup, not just
  `npm run db:migrate`. Run `sudo /usr/local/bin/backup-feeds-db.sh` before
  deploying a risky migration.
- **Backups are same-machine only.** They protect against bad migrations / wrong
  commands / app bugs, *not* whole-machine loss. An off-machine encrypted copy
  is the intended next step before real study data lands.
- **`console.js` is not the extension.** It is a separate manual
  paste-into-DevTools capture script using `localStorage`. The real pipeline is
  `content.js` + `background.js` using `chrome.storage.local`. Don't confuse the
  two when debugging capture.
- **Ingest rate limit** is per-user, default 1000 posts/hour
  (`INGEST_POST_LIMIT_PER_HOUR`), enforced in-memory — it resets on backend
  restart.

---

## Backend scripts

Run from `backend/`. This is the canonical list; `backend/README.md` has the
operational detail.

| Command | What it does |
|---|---|
| `npm run dev` | Start backend with nodemon + label worker |
| `npm run start` | Start backend (production) |
| `npm run db:migrate` | Run pending migrations |
| `npm run db:rollback` | Roll back one migration |
| `npm run db:migrate:create -- <name>` | Create a migration stub |
| `npm run db:copy:sqlite` | Copy rows from legacy SQLite into Postgres |
| `npm run label:one -- --text "<text>"` | Label one ad-hoc text |
| `npm run label:one -- <db_id>` | Label one DB row by id |
| `npm run label:all` | One-shot labeling pass |
| `npm run label:watch` | Continuous labeling loop |
| `npm run labels:show` | Print latest labels |
| `npm run label:eval15` | Re-label 15 random labeled posts, report agreement |
| `npm run label:stability -- 15 10` | Re-label one 15-post sample over 10 shuffled rounds, compare stability |
| `npm test` | Jest (`--runInBand`) |

---

## Security notes

- Secrets (Postgres password, Azure credentials) live only in the backend env
  file **on the machine that runs the backend**. Never in the extension. Do not
  commit `backend/.env` or `backend/.env.local`.
- Browser auth is Chrome identity only: the Google ID is sent as a Bearer token
  and looked up server-side (`middleware/requireUser.js`). No API keys reach the
  browser.
- On the server, root's `/root/.pgpass` (used by the backup job) must stay mode
  `0600`.
- The old Neon prototyping database has been **deleted**, so the connection
  string that was previously committed to `.vscode/settings.json` is dead and
  no longer a live exposure. (Closed item, kept here for history.)
