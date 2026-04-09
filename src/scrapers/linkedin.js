'use strict';

/**
 * LinkedIn scraper — public job search (no login required).
 *
 * linkedin.com/jobs/search/ renders job cards server-side for unauthenticated
 * users. We use stealth Puppeteer + 30-day filter (f_TPR=r2592000).
 *
 * Strategy: 40 broad queries × 5 pages (25 jobs/page) = up to 5 000 jobs.
 */

const { launchBrowser, createStealthPage } = require('./browser');

// Broad set of French job titles covering many sectors
const QUERIES = [
  // Tech & Data
  'développeur',
  'data scientist',
  'data analyst',
  'data engineer',
  'devops',
  'cloud engineer',
  'ingénieur logiciel',
  'architecte logiciel',
  'product manager',
  'product owner',
  'UX designer',
  'UI designer',
  'web designer',
  'fullstack developer',
  'backend developer',
  'frontend developer',
  'machine learning',
  'cybersécurité',
  'administrateur systèmes',
  // Business & Marketing
  'commercial B2B',
  'commercial terrain',
  'chef de projet',
  'marketing digital',
  'chargé de communication',
  'consultant',
  'analyste',
  'manager',
  'directeur commercial',
  'responsable marketing',
  // Finance & RH
  'comptable',
  'contrôleur de gestion',
  'chargé de recrutement',
  'RH',
  'juriste',
  // Other sectors
  'ingénieur mécanique',
  'technicien',
  'chargé affaires',
  'responsable logistique',
  'infirmier',
  'médecin',
];

const MAX_PAGES_PER_QUERY = 5; // 5 × 25 = 125 jobs per query max

function detectContract(text = '') {
  const t = text.toLowerCase();
  if (t.includes('alternance') || t.includes('apprentissage')) return 'Alternance';
  if (t.includes('stage') || t.includes('intern'))             return 'Stage';
  if (t.includes('freelance') || t.includes('indépendant'))    return 'Freelance';
  if (t.includes('intérim') || t.includes('interim'))          return 'Interim';
  if (t.includes('cdd'))                                       return 'CDD';
  return 'CDI';
}

async function scrapeLinkedInPublic(browser) {
  const jobs = [];
  const seen = new Set();

  for (const q of QUERIES) {
    let queryNewJobs = 0;

    for (let pageNum = 0; pageNum < MAX_PAGES_PER_QUERY; pageNum++) {
      const start = pageNum * 25;
      const page  = await createStealthPage(browser);
      try {
        const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}&location=France&f_TPR=r2592000&start=${start}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

        try {
          await page.waitForSelector('.base-card, .job-search-card, [data-entity-urn]', { timeout: 10000 });
        } catch {
          console.warn(`[linkedin] No cards for "${q}" page ${pageNum + 1} — stopping.`);
          break;
        }

        // Scroll to reveal lazy-loaded cards
        for (let i = 0; i < 8; i++) {
          await page.evaluate(() => window.scrollBy(0, 800));
          await new Promise(r => setTimeout(r, 300));
        }
        await new Promise(r => setTimeout(r, 800));

        const results = await page.evaluate(() => {
          const cards = document.querySelectorAll('.base-card, .job-search-card, [data-entity-urn]');
          return Array.from(cards).map(card => {
            const titleEl   = card.querySelector('.base-search-card__title, h3, .job-card-list__title');
            const companyEl = card.querySelector('.base-search-card__subtitle, h4, .job-card-container__company-name');
            const locEl     = card.querySelector('.job-search-card__location, .base-search-card__metadata span, .job-card-container__metadata-item');
            const linkEl    = card.querySelector('a.base-card__full-link, a[href*="/jobs/view/"]');
            const dateEl    = card.querySelector('time');

            const href    = linkEl?.href || '';
            const idMatch = href.match(/\/view\/[^/]*?-?(\d+)/);
            const urn     = card.getAttribute('data-entity-urn') || '';
            const urnId   = urn.match(/:(\d+)$/)?.[1] || '';

            return {
              title:    titleEl?.textContent?.trim() || '',
              company:  companyEl?.textContent?.trim() || '',
              location: locEl?.textContent?.trim() || '',
              url:      href,
              jobId:    idMatch?.[1] || urnId || href,
              date:     dateEl?.getAttribute('datetime') || '',
            };
          }).filter(j => j.title && j.jobId);
        });

        const newJobs = results.filter(r => !seen.has(r.jobId));
        for (const r of newJobs) {
          seen.add(r.jobId);
          queryNewJobs++;
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

        console.log(`[linkedin] "${q}" page ${pageNum + 1} → ${newJobs.length} new jobs`);
        if (newJobs.length < 5) break; // no more results

      } catch (err) {
        console.warn(`[linkedin] "${q}" page ${pageNum + 1} failed: ${err.message}`);
        break;
      } finally {
        await page.close();
      }

      await new Promise(r => setTimeout(r, 1200 + Math.random() * 1000));
    }

    console.log(`[linkedin] Query "${q}" total new: ${queryNewJobs}`);
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
  }

  return jobs;
}

async function scrape() {
  let browser;
  try {
    browser = await launchBrowser();
    const jobs = await scrapeLinkedInPublic(browser);
    console.log(`[linkedin] Done — ${jobs.length} unique jobs`);
    return jobs;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrape };
