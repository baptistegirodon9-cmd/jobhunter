'use strict';

/**
 * Indeed France scraper — puppeteer-extra + stealth plugin.
 *
 * Strategy: 25 keyword queries × 4 pages (16 jobs/page) = up to 1 600 jobs.
 * Cookie consent is accepted automatically.
 */

const { launchBrowser, createStealthPage } = require('./browser');

const QUERIES = [
  // Tech
  { q: 'développeur',          l: 'France' },
  { q: 'développeur',          l: 'Paris' },
  { q: 'développeur',          l: 'Lyon' },
  { q: 'data scientist',       l: 'France' },
  { q: 'data analyst',         l: 'France' },
  { q: 'data engineer',        l: 'France' },
  { q: 'product manager',      l: 'France' },
  { q: 'chef de projet',       l: 'France' },
  { q: 'devops cloud',         l: 'France' },
  { q: 'designer UX UI',       l: 'France' },
  { q: 'ingénieur logiciel',   l: 'France' },
  { q: 'architecte logiciel',  l: 'France' },
  { q: 'cybersécurité',        l: 'France' },
  { q: 'machine learning',     l: 'France' },
  // Business
  { q: 'commercial B2B',       l: 'France' },
  { q: 'commercial terrain',   l: 'France' },
  { q: 'marketing digital',    l: 'France' },
  { q: 'chargé communication', l: 'France' },
  { q: 'consultant',           l: 'France' },
  { q: 'manager',              l: 'France' },
  // Finance & RH
  { q: 'comptable',            l: 'France' },
  { q: 'contrôleur de gestion',l: 'France' },
  { q: 'recrutement RH',       l: 'France' },
  // Industry
  { q: 'ingénieur mécanique',  l: 'France' },
  { q: 'technicien',           l: 'France' },
];

const MAX_PAGES = 4; // 4 × 16 = 64 per query

function detectContract(text = '') {
  const t = text.toLowerCase();
  if (t.includes('alternance') || t.includes('apprentissage')) return 'Alternance';
  if (t.includes('stage'))      return 'Stage';
  if (t.includes('freelance') || t.includes('indépendant'))    return 'Freelance';
  if (t.includes('intérim') || t.includes('interim'))          return 'Interim';
  if (t.includes('cdd'))        return 'CDD';
  return 'CDI';
}

async function scrapeQueryPage(browser, q, l, start = 0) {
  const page = await createStealthPage(browser);
  const jobs = [];

  try {
    const url = `https://fr.indeed.com/emplois?q=${encodeURIComponent(q)}&l=${encodeURIComponent(l)}&sort=date&start=${start}&fromage=30`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Accept cookie consent
    try {
      await page.waitForSelector(
        '#onetrust-accept-btn-handler, [data-testid="gdpr-consent-accept"], #CookieBannerAccept',
        { timeout: 5000 }
      );
      await page.click('#onetrust-accept-btn-handler, [data-testid="gdpr-consent-accept"], #CookieBannerAccept');
      await new Promise(r => setTimeout(r, 2000));
    } catch { /* no banner */ }

    try {
      await page.waitForSelector('[data-jk], .job_seen_beacon, .resultContent', { timeout: 15000 });
    } catch {
      const title = await page.title();
      if (/captcha|challenge|verify/i.test(title)) {
        console.warn(`[indeed] Captcha on "${q}" — skipping.`);
      } else {
        console.warn(`[indeed] No cards for "${q}" (${title.slice(0, 50)})`);
      }
      return [];
    }

    await new Promise(r => setTimeout(r, 2000));

    // Scroll to load all cards
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) {
        window.scrollBy(0, 500);
        await new Promise(r => setTimeout(r, 300));
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    const extracted = await page.evaluate(() => {
      const seen    = new Set();
      const results = [];

      const cardEls = document.querySelectorAll('.job_seen_beacon, li[class*="Result"], .resultContent');
      cardEls.forEach(card => {
        const titleLink = card.querySelector('a[data-jk]');
        const jk = titleLink?.getAttribute('data-jk');
        if (!jk || seen.has(jk)) return;
        seen.add(jk);

        const titleSpan = titleLink?.querySelector('span[title], span[id^="jobTitle"]');
        let title = titleSpan?.getAttribute('title') || titleSpan?.textContent?.trim() || titleLink?.textContent?.trim() || '';
        title = title.replace(/^(new|nouveau)\s*/i, '').trim();
        if (!title) return;

        // Company
        let company = '';
        const compSelectors = [
          '[data-testid="company-name"]', '.companyName', '[class*="companyName"]',
          'a[href*="/cmp/"]', '[class*="company-name"]',
        ];
        for (const s of compSelectors) {
          const el = card.querySelector(s);
          if (el) { company = el.textContent.trim(); break; }
        }
        if (!company) {
          const lines = (card.innerText || '').split(/\n|\|/).map(l => l.trim()).filter(Boolean);
          const titleIdx = lines.findIndex(l => l === title || title.startsWith(l.slice(0, 20)));
          if (titleIdx !== -1 && lines[titleIdx + 1]) {
            const candidate = lines[titleIdx + 1];
            if (!/^\d|€|par an|km|paris|lyon|france|remote|télétravail/i.test(candidate)) {
              company = candidate;
            }
          }
        }

        // Location
        let location = '';
        const locSelectors = ['[data-testid="text-location"]', '.companyLocation', '[class*="Location"]'];
        for (const s of locSelectors) {
          const el = card.querySelector(s);
          if (el) { location = el.textContent.trim(); break; }
        }
        if (!location) {
          const lines = (card.innerText || '').split(/\n|\|/).map(l => l.trim()).filter(Boolean);
          const locLine = lines.find(l =>
            /paris|lyon|bordeaux|marseille|france|remote|nantes|lille|toulouse|strasbourg|montpellier|rennes|nice|grenoble|télétravail/i.test(l) && l.length < 60
          );
          if (locLine) location = locLine;
        }

        const salary = card.querySelector('.salary-snippet-container, [data-testid="attribute_snippet_testid"], .salaryOnly, [class*="salary"]')?.textContent?.trim() || '';
        const desc   = card.querySelector('.job-snippet, [data-testid="job-snippet"], ul li, [class*="snippet"]')?.textContent?.replace(/\s+/g, ' ').trim() || '';

        results.push({ jk, title, company, location, salary, desc });
      });

      return results;
    });

    console.log(`[indeed] "${q}" in ${l} start=${start} → ${extracted.length} cards`);

    for (const item of extracted) {
      jobs.push({
        source:        'indeed',
        external_id:   item.jk,
        title:         item.title,
        company:       item.company || null,
        location:      item.location || l || 'France',
        contract_type: detectContract(`${item.title} ${item.desc}`),
        sector:        q,
        description:   item.desc,
        salary:        item.salary || null,
        url:           `https://fr.indeed.com/viewjob?jk=${item.jk}`,
        posted_at:     new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn(`[indeed] "${q}" in ${l} start=${start} failed: ${err.message}`);
  } finally {
    await page.close();
  }

  return jobs;
}

async function scrapeQuery(browser, { q, l }) {
  const jobs = [];
  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const start    = pageNum * 16;
    const pageJobs = await scrapeQueryPage(browser, q, l, start);
    jobs.push(...pageJobs);
    if (pageJobs.length < 8) break;
    if (pageNum < MAX_PAGES - 1) await new Promise(r => setTimeout(r, 1500));
  }
  return jobs;
}

async function scrape() {
  let browser;
  try {
    browser = await launchBrowser();

    const seen = new Set();
    const jobs = [];

    for (const query of QUERIES) {
      const results = await scrapeQuery(browser, query);
      for (const job of results) {
        if (seen.has(job.external_id)) continue;
        seen.add(job.external_id);
        jobs.push(job);
      }
      // Human-like delay
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
    }

    console.log(`[indeed] Done — ${jobs.length} unique jobs`);
    return jobs;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrape };
