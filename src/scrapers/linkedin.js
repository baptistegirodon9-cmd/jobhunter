'use strict';

/**
 * LinkedIn scraper — via Google search results.
 *
 * Strategy: We search Google for "site:linkedin.com/jobs" with job-related
 * keywords. Google indexes LinkedIn job pages and returns the title, company,
 * location and URL. This avoids touching LinkedIn directly (no login, no
 * anti-bot, no legal issues).
 *
 * Then we also scrape LinkedIn's public job search page (no login required)
 * at linkedin.com/jobs/search/ — which shows basic job cards without auth.
 */

const { launchBrowser, createStealthPage } = require('./browser');

const SEARCH_QUERIES = [
  'développeur CDI France',
  'data scientist Paris',
  'product manager Lyon',
  'chef de projet digital Bordeaux',
  'devops cloud France',
  'marketing digital CDI',
  'ingénieur logiciel France',
  'UX designer CDI Paris',
];

// ── Strategy 1: Google search for LinkedIn jobs ─────────────────────────────

async function scrapeGoogleForLinkedIn(browser) {
  const jobs = [];
  const seen = new Set();

  for (const q of SEARCH_QUERIES) {
    const page = await createStealthPage(browser);
    try {
      const searchUrl = `https://www.google.com/search?q=site:linkedin.com/jobs+${encodeURIComponent(q)}&num=20&hl=fr`;

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

      try {
        await page.waitForSelector('#search, #rso, .g', { timeout: 8000 });
      } catch {
        console.warn(`[linkedin/google] No results page for "${q}"`);
        continue;
      }

      await new Promise(r => setTimeout(r, 1500));

      const results = await page.evaluate(() => {
        const items = [];
        // Google search result blocks
        document.querySelectorAll('.g, [data-hveid]').forEach(el => {
          const linkEl = el.querySelector('a[href*="linkedin.com/jobs"]');
          if (!linkEl) return;

          const href = linkEl.href || '';
          if (!href.includes('linkedin.com/jobs')) return;

          // Extract job ID from LinkedIn URL
          const idMatch = href.match(/\/view\/[^/]*?-(\d+)/);
          const jobId = idMatch?.[1] || href;

          const titleEl = el.querySelector('h3');
          const title = titleEl?.textContent?.trim() || '';

          // Google shows a snippet with company / location info
          const snippetEl = el.querySelector('[data-sncf], .VwiC3b, [style*="-webkit-line-clamp"]');
          const snippet = snippetEl?.textContent?.trim() || '';

          // Try to extract company from snippet (often "Company · Location")
          const parts = snippet.split('·').map(s => s.trim());

          items.push({ href, jobId, title, snippet, parts });
        });
        return items;
      });

      for (const r of results) {
        if (seen.has(r.jobId)) continue;
        seen.add(r.jobId);

        // Clean up title — Google often adds "- LinkedIn" suffix
        const title = r.title
          .replace(/\s*[-–|]\s*LinkedIn.*$/i, '')
          .replace(/\s*[-–|]\s*Emploi.*$/i, '')
          .trim();

        if (!title || title.length < 3) continue;

        // Heuristic: parse "Company · Location · Date" from snippet parts
        const company  = r.parts[0] || '';
        const location = r.parts[1] || '';

        jobs.push({
          source:        'linkedin',
          external_id:   String(r.jobId),
          title,
          company:       company || 'Via LinkedIn',
          location:      location || 'France',
          contract_type: detectContract(title),
          sector:        '',
          description:   r.snippet,
          salary:        null,
          url:           r.href,
          posted_at:     new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn(`[linkedin/google] Query "${q}" failed: ${err.message}`);
    } finally {
      await page.close();
    }

    // Random delay to avoid Google rate limiting
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
  }

  return jobs;
}

// ── Strategy 2: LinkedIn public job search (no login) ───────────────────────

async function scrapeLinkedInPublic(browser) {
  const jobs = [];
  const seen = new Set();

  const queries = [
    'développeur',
    'data scientist',
    'product manager',
    'chef de projet',
    'ingénieur logiciel',
    'devops',
    'designer UX',
    'commercial B2B',
    'marketing digital',
    'analyste',
    'consultant',
    'architecte logiciel',
  ];

  const MAX_PAGES_PER_QUERY = 3; // LinkedIn shows 25 jobs per page, 3 pages = 75 max

  for (const q of queries) {
    for (let pageNum = 0; pageNum < MAX_PAGES_PER_QUERY; pageNum++) {
      const start = pageNum * 25;
    const page = await createStealthPage(browser);
    try {
      // LinkedIn's public job search page — no login required
      // f_TPR=r2592000 = last 30 days
      const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}&location=France&f_TPR=r2592000&start=${start}`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

      try {
        await page.waitForSelector('.base-card, .job-search-card, [data-entity-urn]', { timeout: 10000 });
      } catch {
        console.warn(`[linkedin/direct] No cards for "${q}" page ${pageNum} — stopping.`);
        break;
      }

      // Scroll to load more cards
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await new Promise(r => setTimeout(r, 400));
      }

      await new Promise(r => setTimeout(r, 1000));

      const results = await page.evaluate(() => {
        const cards = document.querySelectorAll('.base-card, .job-search-card, [data-entity-urn]');
        return Array.from(cards).map(card => {
          const titleEl   = card.querySelector('.base-search-card__title, h3, .job-card-list__title');
          const companyEl = card.querySelector('.base-search-card__subtitle, h4, .job-card-container__company-name');
          const locEl     = card.querySelector('.job-search-card__location, .base-search-card__metadata span, .job-card-container__metadata-item');
          const linkEl    = card.querySelector('a.base-card__full-link, a[href*="/jobs/view/"]');
          const dateEl    = card.querySelector('time');

          const href  = linkEl?.href || '';
          const idMatch = href.match(/\/view\/[^/]*?-?(\d+)/);
          const urn   = card.getAttribute('data-entity-urn') || '';
          const urnId = urn.match(/:(\d+)$/)?.[1] || '';

          return {
            title:    titleEl?.textContent?.trim() || '',
            company:  companyEl?.textContent?.trim() || '',
            location: locEl?.textContent?.trim() || '',
            url:      href,
            jobId:    idMatch?.[1] || urnId || href,
            date:     dateEl?.getAttribute('datetime') || '',
          };
        }).filter(j => j.title);
      });

      const newJobs = results.filter(r => r.jobId && !seen.has(r.jobId));
      for (const r of newJobs) {
        seen.add(r.jobId);
        jobs.push({
          source:        'linkedin',
          external_id:   r.jobId,
          title:         r.title,
          company:       r.company || null,
          location:      r.location || 'France',
          contract_type: detectContract(r.title),
          sector:        q,
          description:   '',
          salary:        null,
          url:           r.url || `https://www.linkedin.com/jobs/view/${r.jobId}`,
          posted_at:     r.date ? new Date(r.date).toISOString() : new Date().toISOString(),
        });
      }

      console.log(`[linkedin/direct] "${q}" page ${pageNum+1} → ${newJobs.length} new jobs`);
      if (newJobs.length < 10) break; // no more results on this query

    } catch (err) {
      console.warn(`[linkedin/direct] Query "${q}" page ${pageNum} failed: ${err.message}`);
      break;
    } finally {
      await page.close();
    }

    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
    } // end pageNum loop
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
  }

  return jobs;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function detectContract(text = '') {
  const t = text.toLowerCase();
  if (t.includes('alternance') || t.includes('apprentissage')) return 'Alternance';
  if (t.includes('stage') || t.includes('intern'))             return 'Stage';
  if (t.includes('freelance') || t.includes('indépendant'))    return 'Freelance';
  if (t.includes('intérim') || t.includes('interim'))          return 'Interim';
  if (t.includes('cdd'))                                       return 'CDD';
  return 'CDI';
}

// ── Main scrape ─────────────────────────────────────────────────────────────

async function scrape() {
  let browser;
  try {
    browser = await launchBrowser();

    // Run both strategies
    const [googleJobs, directJobs] = await Promise.all([
      scrapeGoogleForLinkedIn(browser).catch(err => {
        console.warn(`[linkedin] Google strategy failed: ${err.message}`);
        return [];
      }),
      scrapeLinkedInPublic(browser).catch(err => {
        console.warn(`[linkedin] Direct strategy failed: ${err.message}`);
        return [];
      }),
    ]);

    // Merge, dedup by external_id
    const seen = new Set();
    const all  = [];
    for (const job of [...directJobs, ...googleJobs]) {
      if (seen.has(job.external_id)) continue;
      seen.add(job.external_id);
      all.push(job);
    }

    console.log(`[linkedin] ${directJobs.length} direct + ${googleJobs.length} via Google = ${all.length} unique`);
    return all;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrape };
