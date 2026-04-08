'use strict';

// node:sqlite est intégré à Node v22+ — aucune dépendance npm, aucune compilation.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

// ── Setup ─────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'jobradar.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    source        TEXT     NOT NULL,
    external_id   TEXT     NOT NULL,
    title         TEXT     NOT NULL,
    company       TEXT     NOT NULL DEFAULT '',
    location      TEXT,
    contract_type TEXT,
    sector        TEXT,
    description   TEXT,
    salary        TEXT,
    url           TEXT     NOT NULL,
    posted_at     DATETIME,
    scraped_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active     INTEGER  NOT NULL DEFAULT 1,
    UNIQUE(source, external_id)
  );

  CREATE TABLE IF NOT EXISTS scraper_logs (
    id             INTEGER  PRIMARY KEY AUTOINCREMENT,
    source         TEXT     NOT NULL,
    status         TEXT     NOT NULL,
    jobs_found     INTEGER  DEFAULT 0,
    jobs_inserted  INTEGER  DEFAULT 0,
    jobs_updated   INTEGER  DEFAULT 0,
    error_message  TEXT,
    started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at   DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_source   ON jobs(source);
  CREATE INDEX IF NOT EXISTS idx_jobs_contract ON jobs(contract_type);
  CREATE INDEX IF NOT EXISTS idx_jobs_active   ON jobs(is_active);
  CREATE INDEX IF NOT EXISTS idx_jobs_posted   ON jobs(posted_at DESC);
`);

// ── Seed data (runs only when table is empty) ─────────────────────────────────

const seedCount = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;

if (seedCount === 0) {
  const now    = new Date();
  const daysAgo = d => new Date(now - d * 86400000).toISOString();

  const seeds = [
    {
      source: 'indeed', external_id: 'seed-001',
      title: 'Développeur Full Stack React / Node.js', company: 'Capgemini',
      location: 'Paris (75)', contract_type: 'CDI', sector: 'Informatique',
      description: 'Rejoignez notre équipe tech pour développer des applications web modernes. Stack : React, Node.js, PostgreSQL, Docker. Télétravail partiel possible.',
      salary: '48 000 – 58 000 € / an', url: 'https://fr.indeed.com/jobs?q=fullstack', posted_at: daysAgo(1),
    },
    {
      source: 'francetravail', external_id: 'seed-002',
      title: 'Chef de Projet Digital', company: 'Orange Business Services',
      location: 'Lyon (69)', contract_type: 'CDI', sector: 'Télécommunications',
      description: 'Pilotage de projets de transformation digitale pour des clients grands comptes. Expérience agile requise.',
      salary: '52 000 – 62 000 € / an', url: 'https://candidat.francetravail.fr/offres/recherche', posted_at: daysAgo(2),
    },
    {
      source: 'apec', external_id: 'seed-003',
      title: 'Data Scientist — NLP & LLM', company: 'Société Générale',
      location: 'Paris (75)', contract_type: 'CDI', sector: 'Banque / Finance',
      description: 'Conception et déploiement de modèles NLP (BERT, GPT) appliqués à l\'analyse de risque crédit. Python, MLflow, Spark.',
      salary: '60 000 – 75 000 € / an', url: 'https://www.apec.fr/candidat/recherche-emploi.html', posted_at: daysAgo(3),
    },
    {
      source: 'wttj', external_id: 'seed-004',
      title: 'Product Manager — SaaS B2B', company: 'Pennylane',
      location: 'Paris (75) — Hybride', contract_type: 'CDI', sector: 'Fintech / SaaS',
      description: 'Définissez la roadmap produit de notre solution de gestion financière pour PME. Vous travaillerez avec des équipes engineering et design.',
      salary: '55 000 – 70 000 € / an', url: 'https://www.welcometothejungle.com/fr/jobs', posted_at: daysAgo(1),
    },
    {
      source: 'indeed', external_id: 'seed-005',
      title: 'Alternance — Développeur Mobile Flutter', company: 'SNCF Connect & Tech',
      location: 'Saint-Denis (93)', contract_type: 'Alternance', sector: 'Transport / Mobilité',
      description: 'Développement de l\'application mobile SNCF Connect avec Flutter. Intégration des APIs de réservation. Encadrement par un senior.',
      salary: null, url: 'https://fr.indeed.com/jobs?q=flutter+alternance', posted_at: daysAgo(4),
    },
    {
      source: 'apec', external_id: 'seed-006',
      title: 'Responsable Marketing Digital', company: 'Decathlon',
      location: 'Villeneuve-d\'Ascq (59)', contract_type: 'CDI', sector: 'Commerce / Retail',
      description: 'Pilotez la stratégie d\'acquisition digitale (SEA, SEO, Social Ads) pour les marchés France et Europe. Budget annuel : 5M€.',
      salary: '45 000 – 55 000 € / an', url: 'https://www.apec.fr/candidat/recherche-emploi.html', posted_at: daysAgo(2),
    },
    {
      source: 'francetravail', external_id: 'seed-007',
      title: 'Ingénieur DevOps / Cloud AWS', company: 'Thales Group',
      location: 'Toulouse (31)', contract_type: 'CDI', sector: 'Défense / Aéronautique',
      description: 'Infrastructure cloud AWS (ECS, EKS, Lambda), CI/CD GitLab, monitoring Datadog. Habilitation Secret requise ou à obtenir.',
      salary: '50 000 – 65 000 € / an', url: 'https://candidat.francetravail.fr/offres/recherche', posted_at: daysAgo(5),
    },
    {
      source: 'wttj', external_id: 'seed-008',
      title: 'Stage — UX/UI Designer', company: 'Doctolib',
      location: 'Paris (75) — Hybride', contract_type: 'Stage', sector: 'Santé / HealthTech',
      description: 'Conception d\'interfaces pour notre plateforme de santé utilisée par 80M de patients. Figma, tests utilisateurs, design system.',
      salary: '1 100 € / mois', url: 'https://www.welcometothejungle.com/fr/jobs', posted_at: daysAgo(1),
    },
    {
      source: 'indeed', external_id: 'seed-009',
      title: 'Consultant SAP FI/CO', company: 'Accenture',
      location: 'Paris (75)', contract_type: 'CDI', sector: 'Conseil / ESN',
      description: 'Conseil et intégration SAP module Finance & Controlling chez des clients industrie et grande distribution. Déplacements ponctuels.',
      salary: '55 000 – 70 000 € / an', url: 'https://fr.indeed.com/jobs?q=SAP+consultant', posted_at: daysAgo(3),
    },
    {
      source: 'wttj', external_id: 'seed-010',
      title: 'Lead Engineer Backend Python', company: 'Alan',
      location: 'Paris (75) — Full remote possible', contract_type: 'CDI', sector: 'InsurTech / Santé',
      description: 'Architecturez et faites grandir nos microservices Python (FastAPI, Kafka, PostgreSQL). Equipe de 8 ingénieurs, culture engineering forte.',
      salary: '70 000 – 90 000 € / an', url: 'https://www.welcometothejungle.com/fr/jobs', posted_at: daysAgo(0),
    },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO jobs
      (source, external_id, title, company, location, contract_type, sector, description, salary, url, posted_at)
    VALUES
      (@source, @external_id, @title, @company, @location, @contract_type, @sector, @description, @salary, @url, @posted_at)
  `);

  db.exec('BEGIN');
  seeds.forEach(j => insert.run(j));
  db.exec('COMMIT');
  console.log(`[DB] Seeded ${seeds.length} demo jobs.`);
}

// ── Query helpers ─────────────────────────────────────────────────────────────

function queryJobs({ q = '', location = '', contract_type = '', source = '', sector = '', page = 1 } = {}) {
  const limit  = 20;
  const offset = (Math.max(1, parseInt(page)) - 1) * limit;

  // Only show jobs from the last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const conditions = ['j.is_active = 1', "j.posted_at >= '" + thirtyDaysAgo + "'"];
  const params     = [];

  if (q)             { conditions.push('(j.title LIKE ? OR j.company LIKE ? OR j.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (location)      { conditions.push('j.location LIKE ?');      params.push(`%${location}%`); }
  if (contract_type) { conditions.push('j.contract_type = ?');    params.push(contract_type); }
  if (source)        { conditions.push('j.source = ?');           params.push(source); }
  if (sector)        { conditions.push('j.sector LIKE ?');        params.push(`%${sector}%`); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) AS n FROM jobs j ${where}`).get(...params).n;
  const jobs  = db.prepare(`
    SELECT j.id, j.source, j.title, j.company, j.location,
           j.contract_type, j.sector, j.salary, j.url, j.posted_at, j.scraped_at
    FROM jobs j ${where}
    ORDER BY j.posted_at DESC, j.scraped_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { jobs, total, page: parseInt(page), pages: Math.ceil(total / limit), limit };
}

function getJobById(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

function getStats() {
  const total     = db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE is_active = 1').get().n;
  const by_source = db.prepare(`
    SELECT source, COUNT(*) AS count FROM jobs WHERE is_active = 1 GROUP BY source ORDER BY count DESC
  `).all();
  const last_log  = db.prepare(`
    SELECT completed_at FROM scraper_logs WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1
  `).get();

  return { total, by_source, last_updated: last_log?.completed_at ?? null };
}

function upsertJobs(jobs) {
  if (!jobs.length) return { inserted: 0, updated: 0 };

  const upsert = db.prepare(`
    INSERT INTO jobs (source, external_id, title, company, location, contract_type, sector, description, salary, url, posted_at, scraped_at, is_active)
    VALUES (@source, @external_id, @title, @company, @location, @contract_type, @sector, @description, @salary, @url, @posted_at, CURRENT_TIMESTAMP, 1)
    ON CONFLICT(source, external_id) DO UPDATE SET
      title         = excluded.title,
      company       = excluded.company,
      location      = excluded.location,
      contract_type = excluded.contract_type,
      sector        = excluded.sector,
      description   = excluded.description,
      salary        = excluded.salary,
      url           = excluded.url,
      posted_at     = excluded.posted_at,
      scraped_at    = CURRENT_TIMESTAMP,
      is_active     = 1
  `);

  const deactivate = db.prepare(`
    UPDATE jobs SET is_active = 0
    WHERE source = ? AND external_id NOT IN (${jobs.map(() => '?').join(',')})
  `);

  let inserted = 0;
  let updated  = 0;

  db.exec('BEGIN');
  try {
    for (const job of jobs) {
      const info = upsert.run(job);
      if (info.changes > 0 && info.lastInsertRowid) inserted++;
      else updated++;
    }
    deactivate.run(jobs[0].source, ...jobs.map(j => j.external_id));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { inserted, updated };
}

function logScraper({ source, status, jobs_found = 0, jobs_inserted = 0, jobs_updated = 0, error_message = null }) {
  return db.prepare(`
    INSERT INTO scraper_logs (source, status, jobs_found, jobs_inserted, jobs_updated, error_message, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(source, status, jobs_found, jobs_inserted, jobs_updated, error_message);
}

function getScraperLogs(limit = 100) {
  return db.prepare('SELECT * FROM scraper_logs ORDER BY started_at DESC LIMIT ?').all(limit);
}

module.exports = { db, queryJobs, getJobById, getStats, upsertJobs, logScraper, getScraperLogs };
