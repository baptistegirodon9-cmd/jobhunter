'use strict';

/**
 * Remotive.com scraper — 100% free public API, no key needed.
 * Returns remote-friendly jobs worldwide + France.
 * Docs: https://remotive.com/api/remote-jobs
 */

const axios = require('axios');

const API_URL = 'https://remotive.com/api/remote-jobs';

// Search categories relevant to a French job board
const CATEGORIES = [
  'software-dev',
  'data',
  'design',
  'product',
  'marketing',
  'business',
  'finance',
  'customer-support',
  'devops',
];

const JOB_TYPE_MAP = {
  full_time:    'CDI',
  contract:     'Freelance',
  freelance:    'Freelance',
  part_time:    'CDI',
  internship:   'Stage',
  other:        'CDI',
};

function normalise(job) {
  const desc = (job.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

  const location = job.candidate_required_location || 'Remote';

  return {
    source:        'remotive',
    external_id:   String(job.id),
    title:         job.title ?? 'Sans titre',
    company:       job.company_name ?? 'Entreprise confidentielle',
    location,
    contract_type: JOB_TYPE_MAP[job.job_type] ?? 'CDI',
    sector:        job.category ?? '',
    description:   desc,
    salary:        job.salary || null,
    url:           job.url ?? '',
    posted_at:     job.publication_date
                     ? new Date(job.publication_date).toISOString()
                     : new Date().toISOString(),
  };
}

/** Return true if the job was posted in the last 30 days */
function isRecent(job) {
  if (!job.publication_date) return true;
  const posted = new Date(job.publication_date).getTime();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return posted >= thirtyDaysAgo;
}

async function scrape() {
  const seen = new Set();
  const jobs = [];

  for (const cat of CATEGORIES) {
    try {
      const res = await axios.get(API_URL, {
        params: { category: cat, limit: 50 },
        headers: { 'User-Agent': 'JobRadar/1.0' },
        timeout: 12000,
      });

      const items = res.data?.jobs ?? [];
      for (const item of items) {
        if (!isRecent(item)) continue;
        if (seen.has(String(item.id))) continue;
        seen.add(String(item.id));
        jobs.push(normalise(item));
      }
    } catch (err) {
      console.warn(`[remotive] Category "${cat}" failed: ${err.message}`);
    }
  }

  return jobs;
}

module.exports = { scrape };
