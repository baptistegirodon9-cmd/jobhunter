'use strict';

/**
 * TheMuse.com scraper — free public API, no key needed.
 * Wide variety of corporate jobs.
 * API: https://www.themuse.com/api/public/jobs?page=0
 */

const axios = require('axios');

const API_URL = 'https://www.themuse.com/api/public/jobs';

function normalise(job) {
  const desc = (job.contents ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

  const locations = (job.locations ?? []).map(l => l.name).filter(Boolean);
  const location  = locations.join(', ') || 'Non précisé';

  const levels = (job.levels ?? []).map(l => l.name).filter(Boolean);
  const categories = (job.categories ?? []).map(c => c.name).filter(Boolean);

  // Detect contract type from level
  let contractType = 'CDI';
  const levelStr = levels.join(' ').toLowerCase();
  if (levelStr.includes('intern'))   contractType = 'Stage';
  if (levelStr.includes('contract')) contractType = 'Freelance';

  return {
    source:        'themuse',
    external_id:   String(job.id),
    title:         job.name ?? 'Sans titre',
    company:       job.company?.name ?? 'Entreprise confidentielle',
    location,
    contract_type: contractType,
    sector:        categories[0] ?? '',
    description:   desc,
    salary:        null,
    url:           job.refs?.landing_page ?? `https://www.themuse.com/jobs/${job.id}`,
    posted_at:     job.publication_date
                     ? new Date(job.publication_date).toISOString()
                     : new Date().toISOString(),
  };
}

async function scrape() {
  const jobs = [];
  const MAX_PAGES = 5;

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const res = await axios.get(API_URL, {
        params: { page, descending: true },
        headers: { 'User-Agent': 'JobRadar/1.0' },
        timeout: 12000,
      });

      const items = res.data?.results ?? [];
      if (!items.length) break;

      const thirtyDaysAgo = Date.now() - 30 * 86400000;

      for (const item of items) {
        if (item.publication_date) {
          const posted = new Date(item.publication_date).getTime();
          if (posted < thirtyDaysAgo) continue;
        }
        jobs.push(normalise(item));
      }

      if (items.length < 20) break; // default page size
    } catch (err) {
      console.warn(`[themuse] Page ${page} failed: ${err.message}`);
      break;
    }
  }

  return jobs;
}

module.exports = { scrape };
