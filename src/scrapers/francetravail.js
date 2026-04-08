'use strict';

/**
 * France Travail (ex-Pôle Emploi) scraper
 * Uses the official OAuth2 + REST API.
 *
 * Registration: https://francetravail.io/data/api/offres-emploi
 * Scope needed: "api_offresdemploiv2 o2dsoffre"
 */

const axios = require('axios');

const TOKEN_URL  = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const SEARCH_URL = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';

// Cache token to avoid hammering the auth endpoint
let _token       = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const clientId     = process.env.FRANCETRAVAIL_CLIENT_ID;
  const clientSecret = process.env.FRANCETRAVAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('FRANCETRAVAIL_CLIENT_ID / FRANCETRAVAIL_CLIENT_SECRET not set in .env');
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
  _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000; // refresh 1 min early
  return _token;
}

/** Map a France Travail API offer to the standard job schema */
function normalise(offer) {
  const contractMap = {
    CDI: 'CDI', CDD: 'CDD',
    MIS: 'Interim', SAI: 'CDD',
    DIN: 'CDI', FRA: 'Freelance',
    LIB: 'Freelance', TTI: 'Alternance',
  };

  return {
    source:        'francetravail',
    external_id:   offer.id,
    title:         offer.intitule || 'Sans titre',
    company:       offer.entreprise?.nom ?? 'Entreprise confidentielle',
    location:      offer.lieuTravail?.libelle ?? '',
    contract_type: contractMap[offer.typeContrat] ?? offer.typeContratLibelle ?? '',
    sector:        offer.secteurActiviteLibelle ?? offer.familleProfessionnelle ?? '',
    description:   offer.description ?? '',
    salary:        offer.salaire?.libelle ?? null,
    url:           offer.origineOffre?.urlOrigine
                     ?? `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}`,
    posted_at:     offer.dateCreation ?? new Date().toISOString(),
  };
}

/**
 * Fetch up to `maxPages` pages of results (50 per page = France Travail max).
 * Returns an array of normalised job objects.
 */
async function scrape({ maxPages = 4 } = {}) {
  const token = await getAccessToken();

  const jobs = [];

  for (let page = 0; page < maxPages; page++) {
    const rangeStart = page * 50;
    const rangeEnd   = rangeStart + 49;

    const res = await axios.get(SEARCH_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        'application/json',
      },
      params: {
        range:      `${rangeStart}-${rangeEnd}`,
        sort:       1,          // sort by date desc
        publieeDepuis: 31,      // last 31 days
      },
      timeout: 15000,
    });

    const offers = res.data?.resultats ?? [];
    if (!offers.length) break;

    jobs.push(...offers.map(normalise));

    // France Travail returns Content-Range header — stop if we've fetched all
    const contentRange = res.headers['content-range'] ?? '';
    const total = parseInt(contentRange.split('/')[1] ?? '0');
    if (rangeEnd + 1 >= total) break;
  }

  return jobs;
}

module.exports = { scrape };
