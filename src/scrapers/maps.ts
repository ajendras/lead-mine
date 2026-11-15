import type { Page, Browser } from 'playwright';
import { launchStealthBrowser } from '../utils/browser.js';
import { randomDelay } from '../utils/throttle.js';
import type { Lead } from '../types.js';

/**
 * Scrapes Google Maps for business leads in a given category and location.
 * Launches a stealth browser, performs a maps search, scrolls the result list,
 * clicks individual entries to populate the side panel, and extracts structured data.
 *
 * Uses robust DOM queries that target stable attributes (role, aria-label, href patterns)
 * rather than brittle class names that change frequently.
 *
 * @param category - Business category (e.g. "plumbers", "coffee shops")
 * @param location - Target geography (e.g. "Portland, OR")
 * @param limit - Maximum number of leads to return
 * @returns Array of Lead objects with as much contact and rating data as available
 */
export async function scrapeGoogleMaps(
  category: string,
  location: string,
  limit: number = 20
): Promise<Lead[]> {
  if (!category?.trim()) {
    throw new Error('Category is required for Google Maps scraping.');
  }
  if (!location?.trim()) {
    throw new Error('Location is required for Google Maps scraping.');
  }

  const maxResults = Math.min(limit, 50);
  const leads: Lead[] = [];
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await launchStealthBrowser();
    page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });

    const query = `${category.trim()} ${location.trim()}`;
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

    console.log(`🌐 Navigating to Google Maps for "${query}"`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // Dismiss consent banner when present
    try {
      await page.waitForSelector('button:has-text("Reject all"), button:has-text("I agree")', {
        timeout: 6000,
      });
      await page.click('button:has-text("Reject all"), button:has-text("I agree")');
      await randomDelay(1200, 2200);
    } catch {
      // Consent dialog not present
    }

    await randomDelay(1800, 3200);

    // Scroll the results panel to load more cards
    const scrollSelector = 'div[role="list"], div[style*="overflow-y"]';
    let lastHeight = 0;
    let scrollCount = 0;
    const maxScrolls = Math.ceil(maxResults / 8);

    while (scrollCount < maxScrolls) {
      const newHeight = await page.evaluate((sel: string) => {
        const container = document.querySelector(sel);
        if (!container) return 0;
        const before = container.scrollHeight;
        container.scrollTop = before;
        return container.scrollHeight;
      }, scrollSelector);

      if (newHeight === lastHeight) break;
      lastHeight = newHeight;
      scrollCount++;
      await randomDelay(1100, 1900);
    }

    // Gather result cards
    const cardLocator = page.locator(
      'a[href*="maps/place"], div[role="listitem"], div[jsaction*="click"]'
    );
    const cards = await cardLocator.all();

    console.log(`📋 Found ${cards.length} candidate results. Extracting up to ${maxResults}...`);

    for (let i = 0; i < Math.min(cards.length, maxResults); i++) {
      const card = cards[i]!;

      try {
        await card.scrollIntoViewIfNeeded();
        await card.click({ timeout: 8000 });
        await randomDelay(1400, 2600);

        const lead = await extractFromSidePanel(page);
        if (lead && lead.name) {
          // Simple in-memory deduplication
          if (!leads.some((existing) => existing.name.toLowerCase() === lead.name.toLowerCase())) {
            leads.push(lead);
            console.log(`  ✓ ${lead.name}`);
          }
        }
      } catch (err) {
        // Continue on transient failures (common with dynamic map UI)
        console.warn(`  ⚠️ Skipped result ${i + 1}: ${(err as Error).message}`);
      }

      if (leads.length >= maxResults) break;

      await randomDelay(700, 1400);
    }

    return leads;
  } catch (err) {
    console.error('Google Maps scraper encountered an error:', (err as Error).message);
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Extracts structured business data from the Google Maps side panel
 * that appears after clicking a result card.
 */
async function extractFromSidePanel(page: Page): Promise<Lead | null> {
  return page.evaluate((): Lead | null => {
    const panel = document.querySelector('div[role="main"] div[role="region"], div[aria-label*="Info"]');
    if (!panel) return null;

    // Name is almost always the prominent heading
    const nameEl =
      panel.querySelector('h1') ||
      panel.querySelector('[role="heading"][aria-level="1"]') ||
      panel.querySelector('h2');
    const name = nameEl?.textContent?.trim();
    if (!name || name.length < 2) return null;

    // Address - look for spans containing street or city patterns
    let address = '';
    const possibleAddresses = Array.from(panel.querySelectorAll('span, button')).filter((el) => {
      const t = (el.textContent || '').trim();
      return (
        /[\d]{1,5}\s+[A-Za-z]/.test(t) ||
        /(St|Ave|Rd|Blvd|Ln|Dr|Way|Suite|Ste)\b/i.test(t) ||
        /\b[A-Z]{2}\s+\d{5}/.test(t)
      );
    });
    if (possibleAddresses.length > 0) {
      address = possibleAddresses[0]!.textContent?.trim() || '';
    }

    // Phone from tel: links or regex in text
    let phone = '';
    const telLink = panel.querySelector('a[href^="tel:"]');
    if (telLink) {
      phone = telLink.getAttribute('href')?.replace(/^tel:/, '').trim() || '';
    } else {
      const allText = panel.textContent || '';
      const phoneRegex = /\(?\b[2-9][0-9]{2}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/;
      const match = allText.match(phoneRegex);
      if (match) phone = match[0]!;
    }

    // Website from first external http link that isn't Google
    let website = '';
    const links = Array.from(panel.querySelectorAll('a[href^="http"]'));
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (
        href &&
        !href.includes('google.com') &&
        !href.includes('maps.google') &&
        !href.includes('support.google')
      ) {
        website = href;
        break;
      }
    }

    // Rating
    let rating: number | undefined;
    const ratingContainer = panel.querySelector('[aria-label*="star"], .fontBodyMedium');
    if (ratingContainer) {
      const aria = ratingContainer.getAttribute('aria-label') || ratingContainer.textContent || '';
      const ratingMatch = aria.match(/(\d+\.?\d?)\s*(?:star|out of)/i);
      if (ratingMatch && ratingMatch[1]) rating = parseFloat(ratingMatch[1]);
    }

    // Review count
    let reviewCount: number | undefined;
    const reviewText = panel.textContent || '';
    const reviewMatch = reviewText.match(/\((\d{1,3}(?:,\d{3})*)\)/);
    if (reviewMatch && reviewMatch[1]) {
      reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''), 10);
    }

    return {
      name,
      address: address || undefined,
      phone: phone || undefined,
      website: website || undefined,
      rating,
      reviewCount,
      source: 'maps' as const,
      scrapedAt: new Date().toISOString(),
    };
  });
}
