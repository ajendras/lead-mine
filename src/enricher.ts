import type { Browser, Page } from 'playwright';
import { launchStealthBrowser, getRandomUserAgent } from './utils/browser.js';
import { randomDelay } from './utils/throttle.js';
import type { Lead } from './types.js';

const DISPOSABLE_DOMAINS = new Set<string>([
  '10minutemail.com',
  '20minutemail.com',
  '30minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'mailinator.com',
  'mailinator2.com',
  'yopmail.com',
  'yopmail.fr',
  'sharklasers.com',
  'throwawaymail.com',
  'trashmail.com',
  'getairmail.com',
  'maildrop.cc',
  'dispostable.com',
  'fakeinbox.com',
  'mytrashmail.com',
  'temporary-mail.net',
  'tempail.com',
  'mohmal.com',
  'mail.tm',
  'tempmailaddress.com',
  'discard.email',
  'spamgourmet.com',
  'spam4.me',
  'fake-mail.com',
  'hide-mail.net',
]);

/**
 * Returns true if an email is from a known disposable provider or fails basic
 * validation. Uses a local Set of domains + heuristic patterns. No network calls.
 */
export function isDisposableEmail(email: string): boolean {
  if (typeof email !== 'string' || !email.includes('@')) {
    return true;
  }
  const domain = email.split('@')[1]!.toLowerCase().trim();
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return true;
  }
  if (/^(temp|throw|dispos|fake|trash|spam|junk|hide|tempail|[0-9]{1,3}\.)/i.test(domain)) {
    return true;
  }
  return false;
}

/**
 * Enriches a single lead by visiting its website (when present) and extracting
 * additional contact data — primarily email addresses via mailto: links, regex
 * patterns on page text/HTML, and common business email conventions.
 *
 * Falls back gracefully on any navigation, timeout or parsing error, returning
 * the original lead unchanged. Uses a fresh stealth browser context per lead
 * to minimize fingerprinting and blocks.
 *
 * If verifyEmails is enabled, disposable/temporary emails are discarded and
 * emailVerified is set on the returned Lead.
 *
 * @param lead - Lead record (must contain a valid website to perform enrichment)
 * @param verifyEmails - Whether to filter out disposable email addresses
 * @returns Promise resolving to an enriched Lead (email, phone, address, emailVerified may be added)
 */
export async function enrichLead(lead: Lead, verifyEmails: boolean = false): Promise<Lead> {
  if (!lead.website || !lead.website.startsWith('http')) {
    return { ...lead, emailVerified: lead.emailVerified ?? (lead.email ? !isDisposableEmail(lead.email) : undefined) };
  }

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await launchStealthBrowser();
    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: 1366, height: 920 },
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
    });

    page = await context.newPage();

    console.log(`🌐 Enriching "${lead.name}" via ${new URL(lead.website).hostname}...`);

    await page.goto(lead.website, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    await randomDelay(1350, 2650);

    const extra = await extractEnrichedInfo(page);

    let email = extra.email || lead.email;
    let emailVerified: boolean | undefined = undefined;

    if (email) {
      const isDisposable = isDisposableEmail(email);
      emailVerified = !isDisposable;
      if (verifyEmails && isDisposable) {
        console.log(`   📧 Disposable email detected and skipped for "${lead.name}"`);
        email = undefined;
      }
    }

    const enriched: Lead = {
      ...lead,
      email,
      phone: extra.phone || lead.phone,
      address: extra.address || lead.address,
      emailVerified,
      scrapedAt: new Date().toISOString(),
    };

    return enriched;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️  Enrichment failed for "${lead.name}": ${message}. Returning original data.`);
    return { ...lead };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Internal extraction routine that runs inside the browser context.
 * Prioritizes explicit links (mailto:, tel:), falls back to regex scans,
 * and avoids common false-positive domains.
 */
async function extractEnrichedInfo(
  page: Page
): Promise<{ email?: string; phone?: string; address?: string }> {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    const html = document.documentElement.outerHTML ?? '';
    const result: { email?: string; phone?: string; address?: string } = {};

    // Highest-confidence: explicit mailto link
    const mailto = document.querySelector('a[href^="mailto:"]');
    if (mailto) {
      const href = mailto.getAttribute('href') || '';
      const extracted = (href.replace(/^mailto:/i, '').split('?')[0] || '').trim();
      if (extracted.includes('@') && !extracted.includes('example.com')) {
        result.email = extracted;
      }
    }

    // Email regex across visible text and raw HTML
    if (!result.email) {
      const emailRe = /[\w.%+-]+@[\w.-]+\.[a-zA-Z]{2,}/gi;
      const allMatches = [...text.matchAll(emailRe), ...html.matchAll(emailRe)];

      const candidates = allMatches
        .map((m) => m[0].toLowerCase().trim())
        .filter(
          (e) =>
            !/example\.com|test\.com|yourdomain|placeholder/i.test(e) &&
            !/^\d+@/.test(e) &&
            e.includes('@')
        );

      if (candidates.length > 0) {
        // Prefer non-generic addresses when multiple are present
        const preferred = candidates.find(
          (e) => !/(info|contact|hello|admin|sales|support)@/.test(e)
        );
        result.email = preferred ?? candidates[0]!;
      }
    }

    // Phone from tel: link or North-American phone regex
    const telLink = document.querySelector('a[href^="tel:"]');
    if (telLink) {
      const href = telLink.getAttribute('href') || '';
      const tel = href.replace(/^tel:/i, '').trim();
      if (tel) result.phone = tel;
    } else {
      const phoneRe =
        /\b(?:\+?1[-.\s]?)?\(?([2-9][0-9]{2})\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g;
      const phoneMatches = [...text.matchAll(phoneRe)];
      if (phoneMatches.length > 0) {
        result.phone = phoneMatches[0]![0];
      }
    }

    // Rough address extraction via ZIP code proximity
    if (!result.address) {
      const zipRe = /\b\d{5}(?:-\d{4})?\b/;
      const zipMatch = text.match(zipRe);
      if (zipMatch) {
        const idx = text.indexOf(zipMatch[0]!);
        const start = Math.max(0, idx - 95);
        const slice = text.slice(start, idx + 25).trim();
        if (slice.length > 12 && /[A-Za-z]/.test(slice)) {
          result.address = slice.replace(/\s+/g, ' ');
        }
      }
    }

    return result;
  });
}
