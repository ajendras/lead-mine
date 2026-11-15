import type { Page, Browser } from 'playwright';
import { launchStealthBrowser } from '../utils/browser.js';
import { randomDelay } from '../utils/throttle.js';
import type { Lead } from '../types.js';

/**
 * Scrapes Google organic search results for business leads.
 * Performs a Google search, extracts titles, links and contact snippets from result cards,
 * then selectively visits a small subset of websites to pull additional contact details.
 * Enrichment via the dedicated enricher is still recommended for full coverage.
 *
 * @param query - Complete search query (category + location + optional keywords)
 * @param limit - Maximum number of leads to return
 * @returns Array of Lead records
 */
export async function scrapeGoogleSearch(
  query: string,
  limit: number = 20
): Promise<Lead[]> {
  if (!query?.trim()) {
    throw new Error('Search query is required.');
  }

  const maxResults = Math.min(limit, 30);
  const leads: Lead[] = [];
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await launchStealthBrowser();
    page = await browser.newPage();
    await page.setViewportSize({ width: 1366, height: 900 });

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;

    console.log(`🌐 Searching Google for "${query}"`);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Handle consent if shown
    try {
      await page.waitForSelector('button:has-text("Reject all")', { timeout: 5000 });
      await page.click('button:has-text("Reject all")');
      await randomDelay(900, 1600);
    } catch {
      // No consent dialog
    }

    await randomDelay(1400, 2500);

    // Extract leads from organic results
    const rawResults = await page.evaluate((): Array<Omit<Lead, 'scrapedAt'>> => {
      const results: Array<Omit<Lead, 'scrapedAt'>> = [];
      const blocks = document.querySelectorAll('div.g, .g');

      for (const block of Array.from(blocks)) {
        if (results.length >= 40) break;

        const titleEl = block.querySelector('h3, .LC20lb, .DKV0Md');
        if (!titleEl) continue;

        const name = titleEl.textContent?.trim();
        if (!name || name.length < 4) continue;

        // Skip obvious non-business results
        if (/google|youtube|facebook|linkedin|wiki|news/i.test(name)) continue;

        const linkEl = block.querySelector('a');
        const website = linkEl?.getAttribute('href') || '';

        const snippetEl = block.querySelector('.VwiC3b, .aCOpRe, .MUxG7d');
        const snippet = snippetEl?.textContent?.trim() || '';

        // Extract phone from snippet if present
        let phone: string | undefined;
        const phoneMatch = snippet.match(/\b(?:\+?1[-.\s]?)?\(?([2-9][0-9]{2})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/);
        if (phoneMatch) {
          phone = phoneMatch[0];
        }

        results.push({
          name,
          website: website && website.startsWith('http') ? website : undefined,
          phone,
          source: 'search' as const,
        });
      }

      return results;
    });

    for (const result of rawResults.slice(0, maxResults)) {
      leads.push({
        ...result,
        scrapedAt: new Date().toISOString(),
      });
    }

    // Politely visit a few top websites to pull missing contact info
    console.log(`🔗 Visiting ${Math.min(6, leads.length)} sites for contact enrichment...`);
    for (let i = 0; i < Math.min(6, leads.length); i++) {
      const lead = leads[i];
      if (!lead.website) continue;

      try {
        await page.goto(lead.website, {
          waitUntil: 'domcontentloaded',
          timeout: 12000,
        });
        await randomDelay(1100, 2100);

        const extra = await extractContactInfo(page);
        if (extra.phone && !lead.phone) lead.phone = extra.phone;
        if (extra.email) lead.email = extra.email;
        if (extra.address) lead.address = extra.address;
      } catch (visitErr) {
        // Ignore individual site failures
      }
    }

    console.log(`✅ Extracted ${leads.length} leads from Google Search.`);
    return leads;
  } catch (err) {
    console.error('Google Search scraper failed:', (err as Error).message);
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Scans a page (usually a business homepage or contact page) for email, phone and address.
 * Uses simple but effective regex and meta tag inspection.
 */
async function extractContactInfo(page: Page): Promise<{
  phone?: string;
  email?: string;
  address?: string;
}> {
  return page.evaluate(() => {
    const text = document.body.innerText || '';
    const html = document.documentElement.outerHTML;

    // Phone
    let phone: string | undefined;
    const phoneRegex = /\b(?:\+?1[-.\s]?)?\(?([2-9][0-9]{2})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g;
    const phoneMatches = [...text.matchAll(phoneRegex)];
    if (phoneMatches.length > 0) {
      phone = phoneMatches[0][0];
    }

    // Email
    let email: string | undefined;
    const emailRegex = /[\w.%+-]+@[\w.-]+\.[a-zA-Z]{2,}/gi;
    const emailMatches = [...text.matchAll(emailRegex)];
    if (emailMatches.length > 0) {
      // Prefer non-info@ addresses
      const preferred = emailMatches.find((m) => !/info@|contact@|hello@/i.test(m[0]));
      email = preferred ? preferred[0] : emailMatches[0][0];
    }

    // Very basic address extraction (look for ZIP codes with surrounding text)
    let address: string | undefined;
    const zipMatch = text.match(/\b(\d{5}(?:-\d{4})?)\b/);
    if (zipMatch) {
      const idx = text.indexOf(zipMatch[0]);
      const start = Math.max(0, idx - 80);
      address = text.slice(start, idx + 12).trim();
    }

    // Check meta tags as fallback
    if (!email) {
      const metaEmail = document.querySelector('meta[property="og:email"], meta[name="email"]');
      if (metaEmail) email = metaEmail.getAttribute('content') || undefined;
    }

    return { phone, email, address };
  });
}
