'use strict';

/**
 * France Travail (ex-Pôle Emploi) scraper
 * Uses the official OAuth2 + REST API.
 *
 * Registration: https://francetravail.io/data/api/offres-emploi
 * Scope needed: "api_offresdemploiv2 o2dsoffre"
 *
 * Strategy: 20 keyword queries × up to 20 pages (150/page) = 60 000 potential results.
 */

const axios = require('axios');

const TOKEN_URL  = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const SEARCH_URL = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';

let _token       = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const clientId     = process.env.FRANCETRAVAIL_CLIENT_ID;
  const clientSecret = process.env.FRANCETRAVAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('FRANCETRAVAIL_CLIENT_ID / FRANCETRAVAIL_CLIENT_SECRET not set');
  }

  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'api_offresdemploiv2 o2dsoffre',
  });

  const res = await axios.post(TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });

  _token       = res.data.access_token;
  _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return _token;
}

const CONTRACT_MAP = {
  CDI: 'CDI', CDD: 'CDD',
  MIS: 'Interim', SAI: 'CDD',
  DIN: 'CDI', FRA: 'Freelance',
  LIB: 'Freelance', TTI: 'Alternance',
  ALT: 'Alternance',
};

function normalise(offer) {
  return {
    source:        'francetravail',
    external_id:   offer.id,
    title:         offer.intitule || 'Sans titre',
    company:       offer.entreprise?.nom || null,
    location:      offer.lieuTravail?.libelle || '',
    contract_type: CONTRACT_MAP[offer.typeContrat] || offer.typeContratLibelle || '',
    sector:        offer.secteurActiviteLibelle || offer.familleProfessionnelle || '',
    description:   (offer.description || '').slice(0, 1000),
    salary:        offer.salaire?.libelle || null,
    url:           offer.origineOffre?.urlOrigine
                     || `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}`,
    posted_at:     offer.dateCreation || new Date().toISOString(),
  };
}

// Broad keyword list covering the main French job sectors
const KEYWORDS = [
  '',               // no filter = all recent jobs (sorted by date)
  'développeur',
  'data',
  'ingénieur',
  'commercial',
  'manager',
  'chef de projet',
  'marketing',
  'comptable',
  'ressources humaines',
  'infirmier',
  'technicien',
  'consultant',
  'administrateur',
  'chargé',
  'responsable',
  'analyste',
  'designer',
  'devops',
  'product',
];

async function fetchKeyword(token, keyword, seen, jobs) {
  const MAX_PAGES  = 20; // 20 × 150 = 3 000 per keyword
  const PAGE_SIZE  = 150;

  for (let page = 0; page < MAX_PAGES; page++) {
    const rangeStart = page * PAGE_SIZE;
    const rangeEnd   = rangeStart + PAGE_SIZE - 1;

    const params = {
      range:          `${rangeStart}-${rangeEnd}`,
      sort:           1,
      publieeDepuis:  31,
    };
    if (keyword) params.motsCles = keyword;

    let res;
    try {
      res = await axios.get(SEARCH_URL, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        params,
        timeout: 15000,
      });
    } catch (err) {
      if (err.response?.status === 206 || err.response?.status === 400) {
        // Range exceeded — no more results
        break;
      }
      console.warn(`[francetravail] "${keyword}" page ${page} error: ${err.message}`);
      break;
    }

    const offers = res.data?.resultats || [];
    if (!offers.length) break;

    let added = 0;
    for (const offer of offers) {
      if (!seen.has(offer.id)) {
        seen.add(offer.id);
        jobs.push(normalise(offer));
        added++;
      }
    }

    // Parse Content-Range to detect end
    const contentRange = res.headers['content-range'] || '';
    const total = parseInt(contentRange.split('/')[1] || '0');
    if (total && rangeEnd + 1 >= total) break;
    if (offers.length < PAGE_SIZE) break;

    await new Promise(r => setTimeout(r, 300));
  }
}

async function scrape() {
  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.warn(`[francetravail] Auth failed — ${err.message}. Skipping.`);
    return [];
  }

  const seen = new Set();
  const jobs = [];

  for (const keyword of KEYWORDS) {
    console.log(`[francetravail] Fetching keyword: "${keyword || '*'}"`);
    try {
      await fetchKeyword(token, keyword, seen, jobs);
    } catch (err) {
      console.warn(`[francetravail] Keyword "${keyword}" failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[francetravail] Total: ${jobs.length} unique jobs`);
  return jobs;
}

module.exports = { scrape };
