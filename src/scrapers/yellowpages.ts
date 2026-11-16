import type { Page, Browser } from 'playwright';
import { launchStealthBrowser } from '../utils/browser.js';
import { randomDelay } from '../utils/throttle.js';
import type { Lead } from '../types.js';

/**
 * Scrapes business listings from YellowPages.com.
 * Uses the search results page which conveniently includes name, phone, address and website for many entries.
 * Selectors target stable classes like .result, .business-name, .phones etc.
 *
 * @param category - Business category (e.g. "plumbers")
 * @param location - City and state (e.g. "Portland, OR")
 * @param limit - Max results to return
 * @returns Array of Lead objects
 */
export async function scrapeYellowPages(
  category: string,
  location: string,
  limit: number = 20
): Promise<Lead[]> {
  if (!category?.trim()) {
    throw new Error('Category is required for YellowPages scraping.');
  }
  if (!location?.trim()) {
    throw new Error('Location is required for YellowPages scraping.');
  }

  const maxResults = Math.min(limit, 35);
  const leads: Lead[] = [];
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await launchStealthBrowser();
    page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 900 });

    const encodedCategory = encodeURIComponent(category.trim());
    const encodedLocation = encodeURIComponent(location.trim().replace(/, /g, ','));

    const url = `https://www.yellowpages.com/search?search_terms=${encodedCategory}&geo_location_terms=${encodedLocation}`;

    console.log(`🌐 Scraping YellowPages for "${category}" near "${location}"`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 35000,
    });

    await randomDelay(1700, 2900);

    const resultData = await extractYellowPagesResults(page, maxResults);

    for (const item of resultData) {
      leads.push({
        ...item,
        scrapedAt: new Date().toISOString(),
        source: 'yellowpages' as const,
      });
      if (leads.length >= maxResults) break;
    }

    console.log(`✅ Retrieved ${leads.length} leads from YellowPages.`);
    return leads;
  } catch (err) {
    console.error('YellowPages scraper encountered an error:', (err as Error).message);
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Extracts lead data from YellowPages search results page using page.evaluate.
 * Exported for unit testing with HTML fixtures.
 */
export async function extractYellowPagesResults(page: Page, max: number): Promise<Array<Omit<Lead, 'scrapedAt'>>> {
  return page.evaluate((maxResults: number) => {
    const results: Array<Omit<Lead, 'scrapedAt'>> = [];
    const cards = document.querySelectorAll('.result-item, .listing, div[class*="result"]');

    for (const card of Array.from(cards)) {
      if (results.length >= maxResults) break;

      const nameEl = card.querySelector('.business-name a, h2 a, .name');
      const name = nameEl?.textContent?.trim() || '';
      if (!name || name.length < 3) continue;

      const phoneEl = card.querySelector('.phones.phone, .phone');
      const phone = phoneEl?.textContent?.trim() || undefined;

      const addressEl = card.querySelector('.adr, .address, .neighborhood');
      let address = addressEl?.textContent?.trim() || undefined;

      let website: string | undefined;
      const websiteLink = card.querySelector('a[href^="http"]:not([href*="yellowpages.com"])');
      if (websiteLink) {
        website = websiteLink.getAttribute('href') || undefined;
      } else {
        const btn = card.querySelector('a[rel="nofollow"]');
        if (btn) website = btn.getAttribute('href') || undefined;
      }

      let rating: number | undefined;
      const ratingEl = card.querySelector('.rating, .stars');
      if (ratingEl) {
        const text = ratingEl.getAttribute('aria-label') || ratingEl.textContent || '';
        const match = text.match(/(\d\.\d)/);
        if (match) rating = parseFloat(match[1]);
      }

      results.push({
        name,
        address,
        phone,
        website,
        rating,
        source: 'yellowpages' as const,
      });
    }

    return results;
  }, max);
}
