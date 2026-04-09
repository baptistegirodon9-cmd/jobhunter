'use strict';

/**
 * APEC scraper — uses their internal JSON search API.
 *
 * Strategy: multiple keyword searches × pagination.
 * The APEC website calls this endpoint from its React SPA.
 * We replicate the same request (headers + cookies).
 */

const axios = require('axios');

const HOME_URL   = 'https://www.apec.fr/candidat/recherche-emploi.html/emploi';
const SEARCH_API = 'https://www.apec.fr/cms/webservices/rechercheOffre/results';
const COUNT_API  = 'https://www.apec.fr/cms/webservices/rechercheOffre/count';

const BASE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Referer':         HOME_URL,
  'Origin':          'https://www.apec.fr',
  'X-Requested-With': 'XMLHttpRequest',
};

const CONTRACT_MAP = {
  '101': 'CDI', '102': 'CDD', '103': 'Alternance',
  '104': 'Freelance', '105': 'Stage', '106': 'Interim',
};

// APEC function codes (fonctions) to iterate over for better coverage
const APEC_FUNCTIONS = [
  [], // no filter = all
  [28],  // Informatique, Télécom
  [29],  // Comptabilité, Finance
  [30],  // Commercial, Vente
  [31],  // Direction Générale
  [32],  // Marketing, Communication
  [33],  // Ressources Humaines
  [34],  // Logistique, Transport
  [35],  // Production Industrielle
  [36],  // Bureau d'Études, R&D
  [37],  // Achats
  [38],  // Immobilier
  [39],  // Juridique
  [40],  // Santé
  [41],  // Travaux, Chantiers
];

const MAX_PAGES_PER_FUNCTION = 10; // 10 × 50 = 500 per function
const PAGE_SIZE = 50;

function normalise(offer) {
  const contractCode = String(offer.typeContrat?.code ?? offer.listeTypeContrat?.[0]?.code ?? '');
  const contractType = CONTRACT_MAP[contractCode] ?? offer.listeTypeContrat?.[0]?.libelle ?? 'CDI';

  const desc = (offer.texteHtml ?? offer.texte ?? offer.descriptif ?? '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);

  const numOffre = offer.numeroOffre ?? offer.id ?? offer.idOffre ?? String(Math.random());

  return {
    source:        'apec',
    external_id:   String(numOffre),
    title:         offer.intitule ?? offer.titre ?? 'Sans titre',
    company:       offer.nomSociete ?? offer.entreprise?.nom ?? null,
    location:      offer.lieuTravail ?? offer.lieu ?? 'France',
    contract_type: contractType,
    sector:        offer.secteurActivite?.libelle ?? offer.nomMetier ?? offer.fonction?.libelle ?? '',
    description:   desc,
    salary:        offer.salaireTexte ?? offer.salaire ?? null,
    url:           offer.urlOffre
                     ?? `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${numOffre}`,
    posted_at:     offer.datePublication
                     ? new Date(offer.datePublication).toISOString()
                     : new Date().toISOString(),
  };
}

async function getSessionCookies() {
  const res = await axios.get(HOME_URL, {
    headers: { ...BASE_HEADERS, Accept: 'text/html,application/xhtml+xml' },
    timeout: 15000,
    maxRedirects: 5,
  });
  const raw = res.headers['set-cookie'] ?? [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

async function fetchFunctionPage(cookies, fonctions, page) {
  const body = {
    typeOffre:              [],
    typeContrat:            [],
    fonctions,
    secteurs:               [],
    sortsType:              'DATE',
    nombreResultatsParPage: PAGE_SIZE,
    numeroPage:             page,
    publieeDepuis:          30,
  };

  const res = await axios.post(SEARCH_API, body, {
    headers: {
      ...BASE_HEADERS,
      'Accept':         'application/json, text/plain, */*',
      'Content-Type':   'application/json;charset=UTF-8',
      'Cookie':         cookies,
    },
    timeout: 20000,
  });

  // APEC API can return results in different shapes
  const data = res.data;
  return (
    data?.resultats ??
    data?.listeOffres ??
    data?.offres ??
    data?.content ??
    (Array.isArray(data) ? data : [])
  );
}

async function scrape() {
  let cookies = '';
  try {
    cookies = await getSessionCookies();
    console.log('[apec] Session cookies acquired');
  } catch (err) {
    console.warn(`[apec] Could not get session cookies: ${err.message}`);
  }

  const seen = new Set();
  const jobs = [];

  for (const fonctions of APEC_FUNCTIONS) {
    const label = fonctions.length ? `fonction [${fonctions}]` : 'all';
    let gotAny = false;

    for (let page = 1; page <= MAX_PAGES_PER_FUNCTION; page++) {
      try {
        const results = await fetchFunctionPage(cookies, fonctions, page);
        if (!results.length) break;

        gotAny = true;
        for (const offer of results) {
          const id = String(offer.numeroOffre ?? offer.id ?? offer.idOffre ?? '');
          if (!id || seen.has(id)) continue;
          seen.add(id);
          jobs.push(normalise(offer));
        }

        console.log(`[apec] ${label} page ${page} → ${results.length} offers (total: ${jobs.length})`);
        if (results.length < PAGE_SIZE) break; // last page

      } catch (err) {
        if (page === 1) {
          console.warn(`[apec] ${label} failed: ${err.message}`);
        }
        break;
      }

      await new Promise(r => setTimeout(r, 400));
    }

    if (!gotAny && fonctions.length === 0) {
      // If the first (no-filter) call fails, stop — API is likely down
      console.warn('[apec] No results from no-filter query — skipping remaining function queries');
      break;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[apec] Done — ${jobs.length} unique jobs`);
  return jobs;
}

module.exports = { scrape };
