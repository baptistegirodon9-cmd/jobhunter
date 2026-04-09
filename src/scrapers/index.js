'use strict';

/**
 * Scraper orchestrator — runs all sources, upserts results,
 * and writes a log entry per source regardless of success/failure.
 *
 * Sources:
 *  - API-based (fast, concurrent): WTTJ, Remotive, RemoteOK, Himalayas,
 *                                  Jobicy, TheMuse, France Travail, APEC
 *  - Puppeteer (slow, sequential): Indeed, LinkedIn
 */

const { upsertJobs, logScraper } = require('../database');

const sources = [
  // ── Fast API sources (run concurrently first) ──
  { name: 'wttj',          mod: require('./wttj')          }, // Algolia API — ~72 000 jobs
  { name: 'remotive',      mod: require('./remotive')      },
  { name: 'remoteok',      mod: require('./remoteok')      },
  { name: 'himalayas',     mod: require('./himalayas')     },
  { name: 'jobicy',        mod: require('./jobicy')        },
  { name: 'themuse',       mod: require('./themuse')       },
  { name: 'francetravail', mod: require('./francetravail') },
  { name: 'apec',          mod: require('./apec')          },
  // ── Puppeteer sources (run sequentially to limit memory) ──
  { name: 'indeed',        mod: require('./indeed')        },
  { name: 'linkedin',      mod: require('./linkedin')      },
];

// Which sources require Puppeteer (run sequentially, after API sources)
const PUPPETEER_SOURCES = new Set(['indeed', 'linkedin']);

async function runScraper({ name, mod }) {
  const start = Date.now();
  console.log(`[scraper] ▶ ${name} — starting…`);

  try {
    const jobs = await mod.scrape();
    const { inserted, updated } = jobs.length
      ? upsertJobs(jobs)
      : { inserted: 0, updated: 0 };

    logScraper({ source: name, status: 'success', jobs_found: jobs.length, jobs_inserted: inserted, jobs_updated: updated });
    console.log(`[scraper] ✔ ${name} — ${jobs.length} found, ${inserted} inserted, ${updated} updated (${Date.now() - start}ms)`);

    return { name, ok: true, jobs_found: jobs.length };
  } catch (err) {
    const message = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`
      : err.message;

    logScraper({ source: name, status: 'error', error_message: message });
    console.error(`[scraper] ✖ ${name} — ${message}`);

    return { name, ok: false, error: message };
  }
}

/**
 * Run all scrapers.
 * - API sources run concurrently (fast).
 * - Puppeteer sources run sequentially (to avoid OOM with multiple Chrome instances).
 */
async function runAllScrapers() {
  console.log('[scraper] === Starting full refresh ===');

  const apiSources       = sources.filter(s => !PUPPETEER_SOURCES.has(s.name));
  const puppeteerSources = sources.filter(s =>  PUPPETEER_SOURCES.has(s.name));

  // Run API sources concurrently
  const apiResults = await Promise.all(apiSources.map(runScraper));

  // Run Puppeteer sources sequentially
  const puppeteerResults = [];
  for (const src of puppeteerSources) {
    puppeteerResults.push(await runScraper(src));
  }

  const results   = [...apiResults, ...puppeteerResults];
  const ok        = results.filter(r => r.ok).length;
  const err       = results.length - ok;
  const totalJobs = results.reduce((sum, r) => sum + (r.jobs_found ?? 0), 0);

  console.log(`[scraper] === Done: ${ok} succeeded, ${err} failed — ${totalJobs} total jobs found ===`);
  return results;
}

module.exports = { runAllScrapers };
