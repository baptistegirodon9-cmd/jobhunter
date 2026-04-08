'use strict';

/**
 * Indeed France scraper — puppeteer-extra + stealth plugin.
 *
 * Key findings from testing:
 * - Stealth plugin DOES bypass Cloudflare on fr.indeed.com
 * - Cookie consent banner must be accepted first
 * - Job cards use [data-jk] attribute with 48 cards per page
 * - Need to wait for full DOM render after consent
 */

const { launchBrowser, createStealthPage } = require('./browser');

const QUERIES = [
  { q: 'développeur',          l: 'Paris' },
  { q: 'développeur',          l: 'Lyon' },
  { q: 'data scientist',       l: 'France' },
  { q: 'product manager',      l: 'Paris' },
  { q: 'chef de projet',       l: 'France' },
  { q: 'devops cloud',         l: 'France' },
  { q: 'designer UX UI',       l: 'Paris' },
  { q: 'commercial B2B',       l: 'France' },
  { q: 'marketing digital',    l: 'France' },
  { q: 'ingénieur logiciel',   l: 'France' },
];

function detectContract(text = '') {
  const t = text.toLowerCase();
  if (t.includes('alternance') || t.includes('apprentissage')) return 'Alternance';
  if (t.includes('stage'))      return 'Stage';
  if (t.includes('freelance') || t.includes('indépendant'))    return 'Freelance';
  if (t.includes('intérim') || t.includes('interim'))          return 'Interim';
  if (t.includes('cdd'))        return 'CDD';
  return 'CDI';
}

async function scrapeQuery(browser, { q, l }) {
  const jobs = [];
  const MAX_PAGES = 3; // 3 pages × ~16 cards = ~48 results per query

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const start = pageNum * 16;
    const pageJobs = await scrapeQueryPage(browser, q, l, start);
    jobs.push(...pageJobs);
    if (pageJobs.length < 10) break; // no more results
    if (pageNum < MAX_PAGES - 1) await new Promise(r => setTimeout(r, 1500));
  }

  return jobs;
}

async function scrapeQueryPage(browser, q, l, start = 0) {
  const page = await createStealthPage(browser);
  const jobs = [];

  try {
    const url = `https://fr.indeed.com/emplois?q=${encodeURIComponent(q)}&l=${encodeURIComponent(l)}&sort=date&start=${start}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Accept cookie consent if present (critical for Indeed France)
    try {
      await page.waitForSelector(
        '#onetrust-accept-btn-handler, [data-testid="gdpr-consent-accept"], #CookieBannerAccept',
        { timeout: 5000 }
      );
      await page.click('#onetrust-accept-btn-handler, [data-testid="gdpr-consent-accept"], #CookieBannerAccept');
      await new Promise(r => setTimeout(r, 2000));
    } catch { /* no consent banner — continue */ }

    // Wait for job cards — Indeed loads them with [data-jk]
    try {
      await page.waitForSelector('[data-jk], .job_seen_beacon, .resultContent', { timeout: 15000 });
    } catch {
      // Check if the page loaded at all
      const title = await page.title();
      if (/captcha|challenge|verify/i.test(title)) {
        console.warn(`[indeed] Captcha on "${q}" — skipping.`);
      } else {
        console.warn(`[indeed] No cards for "${q}" (title: ${title.slice(0, 50)})`);
      }
      return [];
    }

    // Let all cards finish rendering
    await new Promise(r => setTimeout(r, 2000));

    // Scroll down to reveal all lazy-loaded cards
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) {
        window.scrollBy(0, 500);
        await new Promise(r => setTimeout(r, 300));
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    // Extract all job cards
    const extracted = await page.evaluate(() => {
      const seen = new Set();
      const results = [];

      // Indeed renders cards as .job_seen_beacon or .resultContent list items
      // The [data-jk] attribute is on the title <a> link inside the card
      const cardEls = document.querySelectorAll('.job_seen_beacon, li[class*="Result"], .resultContent');

      cardEls.forEach(card => {
        // Get jk from the title link inside the card
        const titleLink = card.querySelector('a[data-jk]');
        const jk = titleLink?.getAttribute('data-jk');
        if (!jk || seen.has(jk)) return;
        seen.add(jk);

        // Title from span[title] inside the link
        const titleSpan = titleLink?.querySelector('span[title], span[id^="jobTitle"]');
        let title = titleSpan?.getAttribute('title') || titleSpan?.textContent?.trim() || titleLink?.textContent?.trim() || '';
        title = title.replace(/^(new|nouveau)\s*/i, '').trim();
        if (!title) return;

        // Company — try dedicated selectors first, then fall back to innerText parsing
        let company = '';
        const compSelectors = [
          '[data-testid="company-name"]',
          '.companyName',
          '[class*="companyName"]',
          'a[href*="/cmp/"]',
          '[class*="company-name"]',
        ];
        for (const s of compSelectors) {
          const el = card.querySelector(s);
          if (el) { company = el.textContent.trim(); break; }
        }

        // If still empty, parse innerText: structure is usually "Title | Company | Location | …"
        if (!company) {
          const lines = (card.innerText || '').split(/\n|\|/).map(l => l.trim()).filter(Boolean);
          // Skip the first line (title), second non-empty non-location line is often company
          const titleIdx = lines.findIndex(l => l === title || title.startsWith(l.slice(0,20)));
          if (titleIdx !== -1 && lines[titleIdx + 1]) {
            const candidate = lines[titleIdx + 1];
            // Must not look like a location or salary
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
        // Fallback: find line that looks like a location in innerText
        if (!location) {
          const lines = (card.innerText || '').split(/\n|\|/).map(l => l.trim()).filter(Boolean);
          const locLine = lines.find(l => /paris|lyon|bordeaux|marseille|france|remote|nantes|lille|toulouse|strasbourg|montpellier|rennes|nice|grenoble|télétravail/i.test(l) && l.length < 60);
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
    console.warn(`[indeed] Query "${q}" in ${l} failed: ${err.message}`);
  } finally {
    await page.close();
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
      // Human-like delay: 3-6 seconds between queries
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
    }

    return jobs;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrape };
