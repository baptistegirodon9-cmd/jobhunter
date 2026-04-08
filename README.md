# 📡 JobRadar

Auto-aggregating French job board. Pulls listings from **Indeed**, **France Travail**, **APEC** and **Welcome to the Jungle** every 6 hours and serves them through a clean search UI.

## Quick start

```bash
cd jobRadar
cp .env.example .env        # then edit .env with your keys
npm install
node src/server.js
```

Open http://localhost:3000 — 10 demo jobs are seeded on first launch.

---

## Environment variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port (default: `3000`) |
| `FRANCETRAVAIL_CLIENT_ID` | For France Travail scraper | OAuth2 client ID |
| `FRANCETRAVAIL_CLIENT_SECRET` | For France Travail scraper | OAuth2 client secret |
| `REFRESH_SECRET` | Yes | Secret header value for `POST /api/refresh` |
| `ADMIN_PASSWORD` | No | Admin dashboard password (default: `admin123`) |
| `CRON_SCHEDULE` | No | Cron expression for auto-refresh (default: `0 */6 * * *`) |

---

## Getting a France Travail API key

1. Go to **https://francetravail.io/data/api/offres-emploi** and click **"S'abonner"**
2. Create a free account (or log in)
3. Create a new application — choose the **"Offres d'emploi v2"** API
4. Select the scope **`api_offresdemploiv2 o2dsoffre`**
5. Copy your **Identifiant** → `FRANCETRAVAIL_CLIENT_ID`
6. Copy your **Clé secrète** → `FRANCETRAVAIL_CLIENT_SECRET`

The API is free with a rate limit of ~200 requests/day — more than enough for a 6-hour refresh cycle.

---

## API reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/jobs` | Paginated job list. Params: `q`, `location`, `contract_type`, `source`, `sector`, `page` |
| `GET` | `/api/jobs/:id` | Full job detail |
| `GET` | `/api/stats` | Total count, breakdown by source, last update time |
| `POST` | `/api/refresh` | Trigger manual scrape. Header: `x-refresh-secret: <REFRESH_SECRET>` |
| `POST` | `/api/admin/login` | Body: `{ "password": "..." }` → returns `{ "token": "..." }` |
| `GET` | `/api/admin/logs` | Scraper run history (requires `x-admin-token` header) |
| `POST` | `/api/admin/refresh` | Admin-triggered scrape (requires `x-admin-token` header) |
| `GET` | `/api/admin/stats` | Stats for the admin dashboard |

---

## Project structure

```
jobRadar/
├── src/
│   ├── server.js           Express app + all API routes
│   ├── database.js         SQLite setup, schema, seed data, query helpers
│   ├── scheduler.js        node-cron — auto-refresh every 6 hours
│   └── scrapers/
│       ├── index.js        Orchestrator — runs all scrapers concurrently
│       ├── francetravail.js OAuth2 + REST API
│       ├── indeed.js       RSS feed parser
│       ├── apec.js         JSON API + HTML fallback
│       └── wttj.js         Public REST API
├── public/
│   ├── index.html          Full frontend (vanilla JS, no framework)
│   └── admin.html          Admin dashboard
├── data/
│   └── jobradar.db         SQLite database (auto-created)
├── .env.example
└── package.json
```

---

## Admin dashboard

Visit **http://localhost:3000/admin.html** and log in with your `ADMIN_PASSWORD`.

The dashboard shows:
- Active job count per source
- Per-scraper success/error status
- Full scraper run log (jobs found, inserted, updated, errors, duration)
- Manual refresh button

---

## Scraper behaviour

- All scrapers run **concurrently** — one failure never blocks the others
- Results are **upserted**: existing jobs are updated, missing ones marked `is_active = false`
- Each run is logged to the `scraper_logs` table
- France Travail scraper caches its OAuth token and refreshes it 1 minute before expiry

## Adding a new source

1. Create `src/scrapers/mysource.js` that exports `async function scrape()` returning an array of job objects
2. Register it in `src/scrapers/index.js` sources array
3. Restart the server — it will be picked up automatically on the next refresh cycle
