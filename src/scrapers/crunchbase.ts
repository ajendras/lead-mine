import type { Page, Browser } from 'playwright';
import { launchStealthBrowser } from '../utils/browser.js';
import { randomDelay } from '../utils/throttle.js';
import type { Lead } from '../types.js';

/**
 * Scrapes company data from Crunchbase.
 * Note: Crunchbase is JS-heavy and may show limited results without authentication.
 * This scraper targets publicly visible search results for company names, locations, websites.
 * Enrichment step is highly recommended to fill emails/phones from their sites.
 *
 * @param query - Search term (e.g. "plumbers Portland" or "fintech")
 * @param limit - Max number of results
 * @returns Lead array (rating/reviewCount usually not available)
 */
export async function scrapeCrunchbase(
  query: string,
  limit: number = 20
): Promise<Lead[]> {
  if (!query?.trim()) {
    throw new Error('Query is required for Crunchbase scraping.');
  }

  const maxResults = Math.min(limit, 25);
  const leads: Lead[] = [];
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await launchStealthBrowser();
    page = await browser.newPage();
    await page.setViewportSize({ width: 1366, height: 900 });

    const encodedQuery = encodeURIComponent(query.trim());
    const url = `https://www.crunchbase.com/search/organizations?query=${encodedQuery}`;

    console.log(`🌐 Scraping Crunchbase for "${query}"`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    await randomDelay(2200, 3800);

    const resultData = await extractCrunchbaseResults(page, maxResults);

    let processed = resultData.map((item) => ({
      ...item,
      scrapedAt: new Date().toISOString(),
      source: 'crunchbase' as const,
    })) as Array<Lead & { profileUrl?: string }>;

    const visits = Math.min(6, processed.length);
    if (visits > 0) {
      console.log(`🔗 Visiting ${visits} Crunchbase profiles to extract websites...`);
      for (let i = 0; i < visits; i++) {
        const lead = processed[i]!;
        if (!lead.profileUrl) continue;
        try {
          await page.goto(lead.profileUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });
          await randomDelay(1800, 3200);
          const extra = await extractCrunchbaseProfile(page);
          if (extra.website) lead.website = extra.website;
          if (extra.address && (!lead.address || lead.address.length < 8)) {
            lead.address = extra.address;
          }
        } catch {
          // graceful fallback
        }
      }
    }

    leads.push(...processed.map(({ profileUrl, ...leadData }) => leadData as Lead));

    console.log(`✅ Retrieved ${leads.length} leads from Crunchbase.`);
    return leads;
  } catch (err) {
    console.error('Crunchbase scraper encountered an error:', (err as Error).message);
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Extracts basic company data from Crunchbase search results.
 * Exported for unit testing with HTML fixtures.
 */
export async function extractCrunchbaseResults(page: Page, max: number): Promise<Array<Partial<Lead> & { profileUrl?: string }>> {
  return page.evaluate((maxResults: number) => {
    const results: Array<Partial<Lead> & { profileUrl?: string }> = [];
    const seen = new Set<string>();
    const cards = document.querySelectorAll('div[class*="Card"], .organization-card, a[href*="/organization/"]');

    for (const card of Array.from(cards)) {
      if (results.length >= maxResults) break;

      const nameEl = card.querySelector('h3, .name, .title, a');
      const name = nameEl?.textContent?.trim() || '';
      if (!name || name.length < 2 || seen.has(name)) continue;
      seen.add(name);

      let address = '';
      const locEls = card.querySelectorAll('span, div');
      for (const el of Array.from(locEls)) {
        const txt = el.textContent?.trim() || '';
        if (txt && (txt.includes(',') || /[A-Z]{2}$/.test(txt)) && txt.length < 60) {
          address = txt;
          break;
        }
      }

      let profileUrl = '';
      const profileLink = card.querySelector('a[href^="/organization/"]');
      if (profileLink) {
        const href = profileLink.getAttribute('href') || '';
        if (href) profileUrl = `https://www.crunchbase.com${href}`;
      }

      const descEl = card.querySelector('.description, .snippet');
      const description = descEl?.textContent?.trim();
      if (description && !address) address = description.substring(0, 80);

      results.push({
        name,
        address: address || undefined,
        website: undefined,
        profileUrl,
        source: 'crunchbase' as const,
      });
    }

    return results;
  }, max);
}

/**
 * Extracts website and address from a Crunchbase organization profile page.
 */
async function extractCrunchbaseProfile(page: Page): Promise<{ website?: string; address?: string }> {
  return page.evaluate(() => {
    const result: { website?: string; address?: string } = {};

    const websiteLink = document.querySelector('a[href^="http"]:not([href*="crunchbase.com"])');
    if (websiteLink) {
      result.website = websiteLink.getAttribute('href') || undefined;
    }

    const loc = document.querySelector('[data-test="location"], .location, address');
    if (loc) result.address = loc.textContent?.trim() || undefined;

    return result;
  });
}
