'use strict';

/**
 * APEC scraper.
 * Strategy:
 *  1. Fetch the search page to collect session cookies
 *  2. POST to their internal JSON API using those cookies
 *  3. Fall back to cheerio HTML parsing if the API fails
 */

const axios   = require('axios');
const cheerio = require('cheerio');

const HOME_URL   = 'https://www.apec.fr/candidat/recherche-emploi.html/emploi';
const SEARCH_API = 'https://www.apec.fr/cms/webservices/rechercheOffre/results';

const BASE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Referer':         'https://www.apec.fr/',
  'Origin':          'https://www.apec.fr',
};

const CONTRACT_MAP = {
  101: 'CDI', 102: 'CDD', 103: 'Alternance',
  104: 'Freelance', 105: 'Stage', 106: 'Interim',
};

function normalise(offer) {
  const contractCode = offer.typeContrat?.code ?? offer.listeTypeContrat?.[0]?.code;
  const contractType = CONTRACT_MAP[contractCode] ?? offer.listeTypeContrat?.[0]?.libelle ?? 'CDI';
  const desc = (offer.texteHtml ?? offer.texte ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    source:        'apec',
    external_id:   String(offer.numeroOffre ?? offer.id ?? Math.random()),
    title:         offer.intitule ?? offer.titre ?? 'Sans titre',
    company:       offer.nomSociete ?? offer.entreprise?.nom ?? 'Entreprise confidentielle',
    location:      offer.lieuTravail ?? offer.lieu ?? 'France',
    contract_type: contractType,
    sector:        offer.secteurActivite?.libelle ?? offer.nomMetier ?? '',
    description:   desc,
    salary:        offer.salaireTexte ?? offer.salaire ?? null,
    url:           offer.urlOffre ?? `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${offer.numeroOffre}`,
    posted_at:     offer.datePublication ? new Date(offer.datePublication).toISOString() : new Date().toISOString(),
  };
}

/** Step 1 — grab session cookies from the homepage */
async function getSessionCookies() {
  const res = await axios.get(HOME_URL, {
    headers: { ...BASE_HEADERS, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    timeout: 12000,
    maxRedirects: 5,
  });
  const raw = res.headers['set-cookie'] ?? [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

/** Step 2 — call the JSON search API with cookies */
async function fetchViaApi(cookies) {
  const body = {
    typeOffre:              [],
    typeContrat:            [],
    fonctions:              [],
    secteurs:               [],
    sortsType:              'DATE',
    nombreResultatsParPage: 50,
    numeroPage:             1,
  };

  const res = await axios.post(SEARCH_API, body, {
    headers: {
      ...BASE_HEADERS,
      Accept:         'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Cookie:         cookies,
    },
    timeout: 15000,
  });

  return res.data?.resultats ?? res.data?.listeOffres ?? res.data?.offres ?? [];
}

/** Step 3 — HTML fallback: parse the search result page with cheerio */
async function fetchViaHtml(cookies) {
  const res = await axios.get(`${HOME_URL}?sortsType=DATE&nbParPage=50`, {
    headers: {
      ...BASE_HEADERS,
      Accept:  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie:  cookies,
    },
    timeout: 15000,
  });

  const $    = cheerio.load(res.data);
  const jobs = [];

  // APEC article cards — selectors targeting common APEC HTML patterns
  const selectors = [
    'article[data-id-offre]',
    '.card-result',
    '.result-item',
    'li[data-id-offre]',
  ];

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const $el = $(el);
      const id  = $el.attr('data-id-offre') || $el.find('[data-id-offre]').attr('data-id-offre');
      const title   = $el.find('h2, h3, .title-offer, .card-title').first().text().trim();
      const company = $el.find('.company, .card-company, .company-name').first().text().trim();
      const loc     = $el.find('.location, .card-location, .lieu').first().text().trim();
      const href    = $el.find('a').first().attr('href') ?? '';
      if (!title) return;
      jobs.push({
        source: 'apec', external_id: id ?? title,
        title, company: company || 'Entreprise confidentielle',
        location: loc || 'France', contract_type: 'CDI', sector: '', description: '',
        salary: null,
        url: href.startsWith('http') ? href : `https://www.apec.fr${href}`,
        posted_at: new Date().toISOString(),
      });
    });
    if (jobs.length) break;
  }

  return jobs;
}

async function scrape() {
  let cookies = '';
  try {
    cookies = await getSessionCookies();
  } catch (err) {
    console.warn(`[apec] Could not fetch session cookies: ${err.message}`);
  }

  // Try JSON API first
  try {
    const results = await fetchViaApi(cookies);
    if (results.length) {
      console.log(`[apec] JSON API returned ${results.length} offers`);
      return results.map(normalise);
    }
  } catch (err) {
    console.warn(`[apec] JSON API failed (${err.message}), trying HTML fallback…`);
  }

  // HTML fallback
  try {
    const jobs = await fetchViaHtml(cookies);
    console.log(`[apec] HTML fallback returned ${jobs.length} offers`);
    return jobs;
  } catch (err) {
    console.warn(`[apec] HTML fallback failed: ${err.message}`);
  }

  return [];
}

module.exports = { scrape };
