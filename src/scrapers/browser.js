'use strict';

/**
 * Shared stealth browser launcher.
 * Uses puppeteer-extra + stealth plugin to evade bot detection
 * on sites like Indeed, LinkedIn (via Google), Cloudflare, etc.
 *
 * Usage:
 *   const { launchBrowser } = require('./browser');
 *   const browser = await launchBrowser();
 *   // ... use browser ...
 *   await browser.close();
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Apply stealth plugin — patches navigator.webdriver, chrome.runtime,
// plugin/mime types, languages, WebGL vendor, etc.
puppeteer.use(StealthPlugin());

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
      '--lang=fr-FR',
    ],
  });
}

/**
 * Create a page with realistic fingerprint settings.
 */
async function createStealthPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
  });
  // Override navigator.webdriver (belt-and-suspenders with stealth plugin)
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return page;
}

module.exports = { launchBrowser, createStealthPage };
