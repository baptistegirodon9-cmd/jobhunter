'use strict';

/**
 * RemoteOK.com scraper — free public JSON API, no key needed.
 * ~100 remote tech jobs, refreshed regularly.
 * API: https://remoteok.com/api
 */

const axios = require('axios');

const API_URL = 'https://remoteok.com/api';

function normalise(job) {
  const desc = (job.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

  const tags = Array.isArray(job.tags) ? job.tags : [];

  let salary = null;
  if (job.salary_min && job.salary_max) {
    salary = `$${Number(job.salary_min).toLocaleString()}–$${Number(job.salary_max).toLocaleString()} / an`;
  }

  return {
    source:        'remoteok',
    external_id:   String(job.id),
    title:         (job.position ?? 'Sans titre').replace(/&amp;/g, '&'),
    company:       (job.company ?? 'Entreprise confidentielle').replace(/&amp;/g, '&'),
    location:      job.location || 'Remote — Worldwide',
    contract_type: 'CDI',
    sector:        tags.slice(0, 3).join(', '),
    description:   desc,
    salary,
    url:           job.apply_url || job.url || `https://remoteok.com/remote-jobs/${job.slug}`,
    posted_at:     job.date ? new Date(job.date).toISOString() : new Date().toISOString(),
  };
}

async function scrape() {
  const res = await axios.get(API_URL, {
    headers: { 'User-Agent': 'JobRadar/1.0' },
    timeout: 15000,
  });

  const items = Array.isArray(res.data) ? res.data.filter(j => j.id) : [];

  // Filter last 30 days
  const thirtyDaysAgo = Date.now() - 30 * 86400000;

  return items
    .filter(j => {
      if (!j.date) return true;
      return new Date(j.date).getTime() >= thirtyDaysAgo;
    })
    .map(normalise);
}

module.exports = { scrape };
