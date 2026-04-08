'use strict';

/**
 * Welcome to the Jungle scraper — Algolia API.
 *
 * WTTJ exposes its Algolia config in the page source (window.env).
 * The public API key allows searches from the WTTJ origin.
 * This approach is far more reliable than Puppeteer DOM scraping.
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

// Job keywords to search (French-focused)
const QUERIES = [
  'développeur',
  'data scientist',
  'product manager',
  'devops',
  'designer UX',
  'commercial',
  'marketing digital',
  'ingénieur',
  'chef de projet',
  '',   // empty query = all recent jobs in France
];

function algoliaQuery(query, page = 0) {
  return new Promise((resolve, reject) => {
    // Filter: French offices only + last 30 days
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    const filters = `offices.country_code:FR AND published_at_timestamp > ${thirtyDaysAgo}`;

    const params = new URLSearchParams({
      query,
      hitsPerPage: '50',
      page: String(page),
      filters,
      attributesToRetrieve: 'name,organization,offices,contract_type,published_at,profile,summary,slug,objectID,salary_minimum,salary_maximum,salary_currency,salary_period',
      attributesToHighlight: '',
    }).toString();

    const body = JSON.stringify({ params });

    const options = {
      hostname: `${ALGOLIA_APP_ID}-dsn.algolia.net`,
      path: `/1/indexes/${ALGOLIA_INDEX}/query`,
      method: 'POST',
      headers: {
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
        } catch (e) {
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
  const min = hit.salary_minimum;
  const max = hit.salary_maximum;
  const curr = hit.salary_currency || 'EUR';
  const period = hit.salary_period === 'yearly' ? '/an' : '/mois';
  if (max && max !== min) {
    return `${min.toLocaleString('fr-FR')} – ${max.toLocaleString('fr-FR')} ${curr}${period}`;
  }
  return `${min.toLocaleString('fr-FR')} ${curr}${period}`;
}

async function scrape() {
  const seen = new Set();
  const jobs = [];

  for (const query of QUERIES) {
    try {
      // Fetch page 0 (up to 50 results per query)
      const result = await algoliaQuery(query, 0);
      const hits = result.hits || [];

      console.log(`[wttj] "${query || '*'}" → ${hits.length} hits (${result.nbHits} total)`);

      for (const hit of hits) {
        const id = hit.objectID;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const office = (hit.offices || [])[0] || {};
        const location = [office.city, office.country].filter(Boolean).join(', ') || 'France';
        const contractType = CONTRACT_MAP[hit.contract_type] || 'CDI';
        const description  = (hit.summary || hit.profile || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        jobs.push({
          source:        'wttj',
          external_id:   id,
          title:         hit.name || 'Poste à définir',
          company:       hit.organization?.name || 'Entreprise confidentielle',
          location,
          contract_type: contractType,
          sector:        query || 'Général',
          description:   description.slice(0, 500),
          salary:        formatSalary(hit),
          url:           buildJobUrl(hit),
          posted_at:     hit.published_at || new Date().toISOString(),
        });
      }

      // Small delay between queries (be polite)
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      console.warn(`[wttj] Query "${query}" failed: ${err.message}`);
    }
  }

  return jobs;
}

module.exports = { scrape };
