'use strict';

/**
 * Himalayas.app scraper — free public API, no key needed.
 * Remote-friendly jobs, good variety of tech & business roles.
 * Docs: https://himalayas.app/jobs/api
 */

const axios = require('axios');

const API_URL = 'https://himalayas.app/jobs/api';

const TYPE_MAP = {
  'Full time':   'CDI',
  'Full-Time':   'CDI',
  'Part time':   'CDI',
  'Part-Time':   'CDI',
  Contract:      'Freelance',
  Freelance:     'Freelance',
  Temporary:     'CDD',
  Internship:    'Stage',
};

function normalise(job) {
  const desc = (job.description ?? job.excerpt ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

  const locations = job.locationRestrictions ?? [];
  const location  = locations.length
    ? locations.join(', ')
    : 'Remote — Worldwide';

  let salary = null;
  if (job.minSalary && job.maxSalary) {
    salary = `${job.minSalary.toLocaleString()}–${job.maxSalary.toLocaleString()} ${job.currency ?? 'USD'} / an`;
  } else if (job.minSalary) {
    salary = `${job.minSalary.toLocaleString()}+ ${job.currency ?? 'USD'} / an`;
  }

  const categories = Array.isArray(job.categories) ? job.categories : [];

  return {
    source:        'himalayas',
    external_id:   job.guid ?? (job.companySlug + '-' + (job.title ?? String(Math.random()))),
    title:         job.title ?? 'Sans titre',
    company:       job.companyName ?? 'Entreprise confidentielle',
    location,
    contract_type: TYPE_MAP[job.employmentType] ?? 'CDI',
    sector:        categories[0] ?? '',
    description:   desc,
    salary,
    url:           job.applicationLink ?? `https://himalayas.app/companies/${job.companySlug}/jobs/${job.guid ?? ''}`,
    // pubDate is a Unix timestamp in SECONDS
    posted_at:     job.pubDate
                     ? new Date(job.pubDate * 1000).toISOString()
                     : new Date().toISOString(),
  };
}

async function scrape() {
  const jobs = [];
  const MAX_PAGES = 5;
  const PER_PAGE  = 50;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const res = await axios.get(API_URL, {
        params: { limit: PER_PAGE, offset: (page - 1) * PER_PAGE },
        headers: { 'User-Agent': 'JobRadar/1.0' },
        timeout: 12000,
      });

      const items = res.data?.jobs ?? [];
      if (!items.length) break;

      for (const item of items) {
        // pubDate is Unix timestamp in seconds — filter to last 30 days
        if (item.pubDate) {
          const postedMs = item.pubDate * 1000;
          if (postedMs < Date.now() - 30 * 86400000) continue;
        }
        jobs.push(normalise(item));
      }

      if (items.length < PER_PAGE) break;
    } catch (err) {
      console.warn(`[himalayas] Page ${page} failed: ${err.message}`);
      break;
    }
  }

  return jobs;
}

module.exports = { scrape };
