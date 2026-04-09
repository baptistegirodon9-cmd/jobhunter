'use strict';

/**
 * Welcome to the Jungle scraper — Algolia API.
 *
 * Strategy: day-by-day × contract-type bucketing.
 * With 72 000+ jobs over 30 days, each bucket (1 day × 1 contract type)
 * averages ~400 hits → well under Algolia's 1 000-result cap.
 * Result: near-complete coverage of the full WTTJ catalogue.
 *
 * Algolia app: CSEKHVMS53
 * Index: wttj_jobs_production_fr
 */

const https = require('https');

const ALGOLIA_APP_ID  = 'CSEKHVMS53';
const ALGOLIA_API_KEY = '4bd8f6215d0cc52b26430765769e65a0';
const ALGOLIA_INDEX   = 'wttj_jobs_production_fr';

const CONTRACT_MAP = {
  full_time:      'CDI',
  part_time:      'CDI',
  internship:     'Stage',
  apprenticeship: 'Alternance',
  freelance:      'Freelance',
  temporary:      'CDD',
};

// All WTTJ contract types to iterate over
const CONTRACT_TYPES = ['full_time', 'part_time', 'internship', 'apprenticeship', 'freelance', 'temporary'];

// French regions — used to sub-split on overflowing buckets
const REGIONS = [
  'Île-de-France', 'Auvergne-Rhône-Alpes', 'Nouvelle-Aquitaine', 'Occitanie',
  'Hauts-de-France', 'Provence-Alpes-Côte d\'Azur', 'Grand Est', 'Bretagne',
  'Normandie', 'Pays de la Loire', 'Bourgogne-Franche-Comté', 'Centre-Val de Loire',
  'Corse', 'Martinique', 'Guadeloupe', 'La Réunion',
];

function algoliaQuery(filters, page = 0, hitsPerPage = 1000) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      query:       '',
      hitsPerPage: String(hitsPerPage),
      page:        String(page),
      filters,
      attributesToRetrieve: [
        'name', 'organization', 'offices', 'contract_type', 'published_at',
        'profile', 'summary', 'slug', 'objectID',
        'salary_minimum', 'salary_maximum', 'salary_currency', 'salary_period',
      ].join(','),
      attributesToHighlight: '',
    }).toString();

    const body = JSON.stringify({ params });

    const options = {
      hostname: `${ALGOLIA_APP_ID}-dsn.algolia.net`,
      path:     `/1/indexes/${ALGOLIA_INDEX}/query`,
      method:   'POST',
      headers:  {
        'X-Algolia-Application-Id': ALGOLIA_APP_ID,
        'X-Algolia-API-Key':        ALGOLIA_API_KEY,
        'Content-Type':             'application/json',
        'Content-Length':           Buffer.byteLength(body),
        'Referer':                  'https://www.welcometothejungle.com/',
        'Origin':                   'https://www.welcometothejungle.com',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.message) return reject(new Error(`Algolia: ${parsed.message}`));
          resolve(parsed);
        } catch {
          reject(new Error('Invalid JSON from Algolia'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildJobUrl(hit) {
  const orgSlug = hit.organization?.slug;
  const jobSlug = hit.slug;
  if (orgSlug && jobSlug) {
    return `https://www.welcometothejungle.com/fr/companies/${orgSlug}/jobs/${jobSlug}`;
  }
  return `https://www.welcometothejungle.com/fr/jobs?query=${encodeURIComponent(hit.name || '')}`;
}

function formatSalary(hit) {
  if (!hit.salary_minimum) return null;
  const min    = hit.salary_minimum;
  const max    = hit.salary_maximum;
  const curr   = hit.salary_currency || 'EUR';
  const period = hit.salary_period === 'yearly' ? '/an' : '/mois';
  if (max && max !== min) return `${min.toLocaleString('fr-FR')} – ${max.toLocaleString('fr-FR')} ${curr}${period}`;
  return `${min.toLocaleString('fr-FR')} ${curr}${period}`;
}

function processHit(hit, seen, jobs) {
  const id = hit.objectID;
  if (!id || seen.has(id)) return;
  seen.add(id);

  const office       = (hit.offices || [])[0] || {};
  const location     = [office.city, office.country].filter(Boolean).join(', ') || 'France';
  const contractType = CONTRACT_MAP[hit.contract_type] || 'CDI';
  const description  = (hit.summary || hit.profile || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);

  jobs.push({
    source:        'wttj',
    external_id:   id,
    title:         hit.name || 'Poste à définir',
    company:       hit.organization?.name || null,
    location,
    contract_type: contractType,
    sector:        hit.contract_type || '',
    description,
    salary:        formatSalary(hit),
    url:           buildJobUrl(hit),
    posted_at:     hit.published_at || new Date().toISOString(),
  });
}

/** Fetch one bucket; if it hits the 1000-cap, auto-split by region */
async function fetchBucket(baseFilter, seen, jobs) {
  const result = await algoliaQuery(baseFilter, 0, 1000);
  const hits   = result.hits || [];

  for (const hit of hits) processHit(hit, seen, jobs);

  // If capped → subdivide by region to catch the rest
  if (hits.length >= 1000) {
    console.warn(`[wttj] Bucket capped (${result.nbHits} total) — sub-splitting by region…`);
    for (const region of REGIONS) {
      const regionFilter = `${baseFilter} AND offices.state:${region}`;
      try {
        const sub = await algoliaQuery(regionFilter, 0, 1000);
        for (const hit of (sub.hits || [])) processHit(hit, seen, jobs);
        await new Promise(r => setTimeout(r, 150));
      } catch (err) {
        console.warn(`[wttj] Region "${region}" failed: ${err.message}`);
      }
    }
  }
}

async function scrape() {
  const seen = new Set();
  const jobs = [];

  const nowSec = Math.floor(Date.now() / 1000);

  let totalBuckets = 0;
  let doneBuckets  = 0;

  // 30 days × 6 contract types = 180 buckets
  for (let day = 0; day < 30; day++) {
    const dayEnd   = nowSec - day * 86400;
    const dayStart = dayEnd  - 86400;

    for (const ct of CONTRACT_TYPES) {
      totalBuckets++;
      const filter = `offices.country_code:FR AND published_at_timestamp >= ${dayStart} AND published_at_timestamp < ${dayEnd} AND contract_type:${ct}`;
      try {
        await fetchBucket(filter, seen, jobs);
        doneBuckets++;
        if (doneBuckets % 30 === 0) {
          console.log(`[wttj] Progress: ${doneBuckets}/${180} buckets — ${jobs.length} unique jobs`);
        }
      } catch (err) {
        console.warn(`[wttj] Day ${day + 1} ${ct} failed: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 120)); // ~120 ms between calls
    }
  }

  console.log(`[wttj] Done — ${jobs.length} unique jobs from ${doneBuckets} buckets`);
  return jobs;
}

module.exports = { scrape };
