'use strict';

// Charge le .env depuis le dossier racine du projet, peu importe d'où node est lancé
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express            = require('express');
const path               = require('path');
const { queryJobs, getJobById, getStats, getScraperLogs } = require('./database');
const { runAllScrapers } = require('./scrapers');
const { startScheduler } = require('./scheduler');

const app  = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

const REFRESH_SECRET = process.env.REFRESH_SECRET ?? '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin123';

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Auth helpers ──────────────────────────────────────────────────────────────

function requireAdminToken(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── API routes ────────────────────────────────────────────────────────────────

/**
 * GET /api/jobs
 * Query params: q, location, contract_type, source, sector, page
 */
app.get('/api/jobs', (req, res) => {
  try {
    const result = queryJobs({
      q:             req.query.q             ?? '',
      location:      req.query.location      ?? '',
      contract_type: req.query.contract_type ?? '',
      source:        req.query.source        ?? '',
      sector:        req.query.sector        ?? '',
      page:          req.query.page          ?? 1,
    });
    res.json(result);
  } catch (err) {
    console.error('[GET /api/jobs]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/jobs/:id
 */
app.get('/api/jobs/:id', (req, res) => {
  const job = getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

/**
 * GET /api/stats
 */
app.get('/api/stats', (_req, res) => {
  try {
    res.json(getStats());
  } catch (err) {
    console.error('[GET /api/stats]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/refresh
 * Header: x-refresh-secret: <REFRESH_SECRET>
 * Triggers a full scrape in the background.
 */
app.post('/api/refresh', (req, res) => {
  const secret = req.headers['x-refresh-secret'] ?? '';
  if (!REFRESH_SECRET || secret !== REFRESH_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing x-refresh-secret header' });
  }

  // Respond immediately; scrape runs in background
  res.json({ message: 'Refresh started', timestamp: new Date().toISOString() });

  runAllScrapers().catch(err =>
    console.error('[POST /api/refresh] Unhandled scraper error:', err.message)
  );
});

// ── Admin API ─────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/login
 * Body: { password }
 * Returns { token } on success (token === the admin password for simplicity).
 */
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body ?? {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  res.json({ token: ADMIN_PASSWORD }); // use password as bearer token (sufficient for a local tool)
});

/**
 * GET /api/admin/logs
 * Returns the last 100 scraper log entries.
 */
app.get('/api/admin/logs', requireAdminToken, (_req, res) => {
  res.json(getScraperLogs(100));
});

/**
 * POST /api/admin/refresh
 * Triggers a refresh from the admin dashboard.
 */
app.post('/api/admin/refresh', requireAdminToken, (req, res) => {
  res.json({ message: 'Refresh started', timestamp: new Date().toISOString() });
  runAllScrapers().catch(err =>
    console.error('[POST /api/admin/refresh] Unhandled scraper error:', err.message)
  );
});

/**
 * GET /api/admin/stats
 */
app.get('/api/admin/stats', requireAdminToken, (_req, res) => {
  res.json(getStats());
});

// ── SPA fallback — serve index.html for unknown routes ───────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

startScheduler();

app.listen(PORT, () => {
  console.log(`\n  JobHunter is running at http://localhost:${PORT}`);
  console.log(`  Admin dashboard : http://localhost:${PORT}/admin.html\n`);

  // Auto-scrape on startup so the DB is populated after every Render restart.
  // Delay slightly to let the server fully initialize first.
  setTimeout(() => {
    console.log('[startup] Triggering initial scrape...');
    runAllScrapers().catch(err =>
      console.error('[startup] Scrape error:', err.message)
    );
  }, 5000);
});
