'use strict';

/**
 * Scraper orchestrator — runs all sources, upserts results,
 * and writes a log entry per source regardless of success/failure.
 *
 * Sources:
 *  - API-based (fast):     Remotive, RemoteOK, Himalayas, Jobicy, TheMuse, France Travail
 *  - Puppeteer (slow):     Indeed, WTTJ
 */

const { upsertJobs, logScraper } = require('../database');

const sources = [
  // ── Fast API sources (run first) ──
  { name: 'remotive',      mod: require('./remotive')      },
  { name: 'remoteok',      mod: require('./remoteok')      },
  { name: 'himalayas',     mod: require('./himalayas')     },
  { name: 'jobicy',        mod: require('./jobicy')        },
  { name: 'themuse',       mod: require('./themuse')       },
  { name: 'francetravail', mod: require('./francetravail') },
  // ── Puppeteer sources (slower, run after) ──
  { name: 'indeed',        mod: require('./indeed')        },
  { name: 'wttj',          mod: require('./wttj')          },
  { name: 'linkedin',      mod: require('./linkedin')      },
];

async function runScraper({ name, mod }) {
  const start = Date.now();
  console.log(`[scraper] ▶ ${name} — starting…`);

  try {
    const jobs = await mod.scrape();
    const { inserted, updated } = jobs.length ? upsertJobs(jobs) : { inserted: 0, updated: 0 };

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
 * Run all scrapers. API sources run concurrently, then Puppeteer sources
 * run sequentially (to avoid launching too many Chrome instances).
 */
async function runAllScrapers() {
  console.log('[scraper] === Starting full refresh ===');

  // Split into fast (API) and slow (Puppeteer)
  const apiSources       = sources.filter(s => !['indeed', 'wttj'].includes(s.name));
  const puppeteerSources = sources.filter(s =>  ['indeed', 'wttj', 'linkedin'].includes(s.name));

  // Run API sources concurrently
  const apiResults = await Promise.all(apiSources.map(runScraper));

  // Run Puppeteer sources sequentially to limit memory
  const puppeteerResults = [];
  for (const src of puppeteerSources) {
    puppeteerResults.push(await runScraper(src));
  }

  const results = [...apiResults, ...puppeteerResults];
  const ok  = results.filter(r => r.ok).length;
  const err = results.length - ok;
  const totalJobs = results.reduce((sum, r) => sum + (r.jobs_found ?? 0), 0);
  console.log(`[scraper] === Done: ${ok} succeeded, ${err} failed — ${totalJobs} total jobs found ===`);
  return results;
}

module.exports = { runAllScrapers };
