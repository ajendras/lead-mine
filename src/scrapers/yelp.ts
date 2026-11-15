import type { Page, Browser } from 'playwright';
import { launchStealthBrowser } from '../utils/browser.js';
import { randomDelay } from '../utils/throttle.js';
import type { Lead } from '../types.js';

/**
 * Scrapes business listings from Yelp.
 * Navigates to a category/location search, extracts data from the list view,
 * then visits a subset of detail pages to retrieve website, full address and phone.
 *
 * @param category - Business category (e.g. "roof repair", "italian restaurants")
 * @param location - City or neighborhood (e.g. "Seattle, WA")
 * @param limit - Maximum number of leads
 * @returns Deduplicated array of Lead objects
 */
export async function scrapeYelp(
  category: string,
  location: string,
  limit: number = 20
): Promise<Lead[]> {
  if (!category?.trim()) {
    throw new Error('Category is required for Yelp scraping.');
  }
  if (!location?.trim()) {
    throw new Error('Location is required for Yelp scraping.');
  }

  const maxResults = Math.min(limit, 40);
  const leads: Lead[] = [];
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await launchStealthBrowser();
    page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 960 });

    const encodedCategory = encodeURIComponent(category.trim());
    const encodedLocation = encodeURIComponent(location.trim());
    const url = `https://www.yelp.com/search?find_desc=${encodedCategory}&find_loc=${encodedLocation}`;

    console.log(`🌐 Scraping Yelp for "${category}" near "${location}"`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Accept cookies if banner appears
    try {
      await page.waitForSelector('button:has-text("Accept")', { timeout: 4000 });
      await page.click('button:has-text("Accept")');
      await randomDelay(800, 1400);
    } catch {
      // No cookie banner
    }

    await randomDelay(1600, 2800);

    // Extract from search result cards
    const resultData = await page.evaluate((max: number): Array<Partial<Lead>> => {
      const items: Array<Partial<Lead>> = [];
      // Yelp uses data-testid attributes in recent versions
      const cards = document.querySelectorAll(
        '[data-testid="serp-result"], div[class*="border-color"] > div, .biz-listing'
      );

      for (const card of Array.from(cards)) {
        if (items.length >= max) break;

        const nameLink = card.querySelector('a[href^="/biz/"]');
        if (!nameLink) continue;

        const name = nameLink.textContent?.trim();
        if (!name || name.length < 3) continue;

        // Rating
        let rating: number | undefined;
        const ratingEl = card.querySelector('[aria-label*="star rating"]');
        if (ratingEl) {
          const label = ratingEl.getAttribute('aria-label') || '';
          const match = label.match(/(\d+\.?\d?)\s*star/);
          if (match) rating = parseFloat(match[1]!);
        }

        // Review count
        let reviewCount: number | undefined;
        const reviewEl = card.querySelector('span[class*="reviewCount"], .review-count');
        if (reviewEl) {
          const countText = reviewEl.textContent?.replace(/[^0-9]/g, '');
          if (countText) reviewCount = parseInt(countText, 10);
        }

        // Address snippet
        let address = '';
        const addressEls = card.querySelectorAll('span, div');
        for (const el of Array.from(addressEls)) {
          const txt = el.textContent?.trim() || '';
          if (/\d+\s+[A-Za-z]|\b[A-Z]{2}\b/.test(txt)) {
            address = txt;
            break;
          }
        }

        items.push({
          name,
          address: address || undefined,
          rating,
          reviewCount,
          website: undefined, // populated from detail page
          source: 'yelp' as const,
        });
      }

      return items;
    }, maxResults);

    leads.push(
      ...resultData.map((item) => ({
        ...item,
        scrapedAt: new Date().toISOString(),
      })) as Lead[]
    );

    // Visit detail pages (up to half the results) to enrich with website and verified phone
    const detailVisits = Math.min(Math.ceil(leads.length / 2), 12);
    console.log(`🔎 Visiting ${detailVisits} Yelp detail pages for deeper data...`);

    for (let i = 0; i < detailVisits && i < leads.length; i++) {
      const lead = leads[i]!;
      // Reconstruct detail URL from name (Yelp slugs are normalized)
      const slug = lead.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const detailUrl = `https://www.yelp.com/biz/${slug}-${location.toLowerCase().replace(/[^a-z]+/g, '-')}`;

      try {
        await page.goto(detailUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await randomDelay(900, 1700);

        const detailInfo = await extractYelpDetail(page);
        if (detailInfo.phone && !lead.phone) lead.phone = detailInfo.phone;
        if (detailInfo.website) lead.website = detailInfo.website;
        if (detailInfo.address && (!lead.address || lead.address.length < 8)) {
          lead.address = detailInfo.address;
        }
      } catch (detailErr) {
        // Many Yelp detail URLs require exact slug; continue gracefully
      }
    }

    console.log(`✅ Retrieved ${leads.length} leads from Yelp.`);
    return leads;
  } catch (err) {
    console.error('Yelp scraper encountered an error:', (err as Error).message);
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Extracts phone, website and full address from a Yelp business detail page.
 */
async function extractYelpDetail(page: Page): Promise<{
  phone?: string;
  website?: string;
  address?: string;
}> {
  return page.evaluate(() => {
    const phoneEl = document.querySelector('a[href^="tel:"]');
    let phone = phoneEl ? phoneEl.getAttribute('href')?.replace(/^tel:/, '') || undefined : undefined;

    let website = '';
    const websiteLink = document.querySelector('a[href^="http"]:not([href*="yelp.com"])');
    if (websiteLink) {
      website = websiteLink.getAttribute('href') || '';
    }

    let address = '';
    const addressContainer = document.querySelector(
      '[data-testid="address"], .street-address, address'
    );
    if (addressContainer) {
      address = addressContainer.textContent?.trim() || '';
    } else {
      // Fallback: look for text that looks like an address near the top
      const allSpans = Array.from(document.querySelectorAll('span, p'));
      for (const span of allSpans) {
        const t = span.textContent || '';
        if (/\d{1,4}.*(St|Ave|Road|Blvd|Ln|Dr).*?(,|\d{5})/i.test(t)) {
          address = t.trim();
          break;
        }
      }
    }

    return { phone, website, address };
  });
}
