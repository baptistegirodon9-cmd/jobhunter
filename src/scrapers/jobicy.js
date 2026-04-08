'use strict';

/**
 * Jobicy.com scraper — free public API, no key needed.
 * Tech & remote jobs.
 * Docs: https://jobicy.com/jobs-rss-feed
 */

const axios = require('axios');

const API_URL = 'https://jobicy.com/api/v2/remote-jobs';

const TYPE_MAP = {
  'Full-Time':  'CDI',
  'Part-Time':  'CDI',
  Contract:     'Freelance',
  Freelance:    'Freelance',
  Temporary:    'CDD',
  Internship:   'Stage',
};

function normalise(job) {
  const desc = (job.jobDescription ?? job.jobExcerpt ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);

  const industries = Array.isArray(job.jobIndustry)
    ? job.jobIndustry.map(i => typeof i === 'string' ? i.replace(/&amp;/g, '&') : i)
    : [];

  const types = Array.isArray(job.jobType) ? job.jobType : [];
  const contractType = types.length
    ? (TYPE_MAP[types[0]] ?? 'CDI')
    : 'CDI';

  let salary = null;
  if (job.annualSalaryMin && job.annualSalaryMax) {
    salary = `${job.annualSalaryMin}–${job.annualSalaryMax} ${job.salaryCurrency ?? 'USD'} / an`;
  }

  return {
    source:        'jobicy',
    external_id:   String(job.id ?? job.jobSlug),
    title:         (job.jobTitle ?? 'Sans titre').replace(/&amp;/g, '&'),
    company:       (job.companyName ?? 'Entreprise confidentielle').replace(/&amp;/g, '&'),
    location:      job.jobGeo ?? 'Remote',
    contract_type: contractType,
    sector:        industries[0] ?? '',
    description:   desc,
    salary,
    url:           job.url ?? '',
    posted_at:     job.pubDate
                     ? new Date(job.pubDate).toISOString()
                     : new Date().toISOString(),
  };
}

async function scrape() {
  try {
    const res = await axios.get(API_URL, {
      params: { count: 50 },
      headers: { 'User-Agent': 'JobRadar/1.0' },
      timeout: 12000,
    });

    const items = res.data?.jobs ?? [];

    return items
      .filter(item => {
        if (!item.pubDate) return true;
        return new Date(item.pubDate).getTime() >= Date.now() - 30 * 86400000;
      })
      .map(normalise);
  } catch (err) {
    console.warn(`[jobicy] API failed: ${err.message}`);
    return [];
  }
}

module.exports = { scrape };
