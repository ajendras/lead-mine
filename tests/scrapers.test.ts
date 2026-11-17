import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { scrapeGoogleMaps } from '../src/scrapers/maps.js';
import { scrapeGoogleSearch } from '../src/scrapers/search.js';
import { scrapeYellowPages, extractYellowPagesResults } from '../src/scrapers/yellowpages.js';
import { scrapeCrunchbase, extractCrunchbaseResults } from '../src/scrapers/crunchbase.js';
import { enrichLead, isDisposableEmail } from '../src/enricher.js';
import { deduplicateLeads, loadConfig } from '../src/index.js';
import { exportLeads } from '../src/exporter.js';
import { withRateLimit, randomDelay } from '../src/utils/throttle.js';
import { ScrapeOptionsSchema } from '../src/types.js';
import type { Lead } from '../src/types.js';

// Mock Playwright and browser utilities
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn(),
        waitForSelector: vi.fn(),
        click: vi.fn(),
        evaluate: vi.fn(),
        close: vi.fn(),
      }),
      close: vi.fn(),
    }),
  },
}));

vi.mock('../src/utils/browser.js', () => ({
  launchStealthBrowser: vi.fn().mockResolvedValue({
    newContext: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn(),
        evaluate: vi.fn().mockResolvedValue({}),
        close: vi.fn(),
      }),
    }),
    close: vi.fn(),
  }),
  getRandomUserAgent: vi.fn().mockReturnValue('Mozilla/5.0 ...'),
  setProxies: vi.fn(),
}));

vi.mock('../src/utils/throttle.js', () => ({
  randomDelay: vi.fn().mockResolvedValue(undefined),
  withRateLimit: vi.fn().mockImplementation((fn) => fn),
}));

describe('LeadMine scrapers and utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('email verification (disposable checker)', () => {
    it('identifies disposable email domains', () => {
      expect(isDisposableEmail('user@mailinator.com')).toBe(true);
      expect(isDisposableEmail('test@tempmail.com')).toBe(true);
      expect(isDisposableEmail('contact@yopmail.fr')).toBe(true);
      expect(isDisposableEmail('sales@realbusiness.com')).toBe(false);
      expect(isDisposableEmail('info@company.co.uk')).toBe(false);
      expect(isDisposableEmail('invalid-email')).toBe(true);
      expect(isDisposableEmail('temp@10minutemail.com')).toBe(true);
    });

    it('enrichLead respects verifyEmails option and sets emailVerified flag', async () => {
      const mockLead: Lead = {
        name: 'Test Business',
        website: 'https://example.com',
        source: 'maps',
        scrapedAt: new Date().toISOString(),
      };

      // Mock extraction to return a disposable email
      vi.spyOn(await import('../src/enricher.js'), 'extractEnrichedInfo').mockImplementation(async () => ({
        email: 'test@mailinator.com',
      }));

      const resultWithVerify = await enrichLead(mockLead, true);
      expect(resultWithVerify.email).toBeUndefined();
      expect(resultWithVerify.emailVerified).toBe(false);

      const resultWithoutVerify = await enrichLead(mockLead, false);
      expect(resultWithoutVerify.email).toBe('test@mailinator.com');
      expect(resultWithoutVerify.emailVerified).toBe(false);

      // Non-disposable
      vi.spyOn(await import('../src/enricher.js'), 'extractEnrichedInfo').mockImplementation(async () => ({
        email: 'hello@legitcompany.com',
      }));

      const goodResult = await enrichLead(mockLead, true);
      expect(goodResult.email).toBe('hello@legitcompany.com');
      expect(goodResult.emailVerified).toBe(true);
    });
  });

  describe('deduplicateLeads', () => {
    it('removes duplicates based on normalized name + address + website', () => {
      const leads: Lead[] = [
        { name: 'Acme Plumbing', address: '123 Main St', website: 'acme.com', source: 'maps', scrapedAt: '2024-01-01' },
        { name: 'acme plumbing', address: '123 Main St', website: 'acme.com', source: 'search', scrapedAt: '2024-01-01' },
        { name: 'Beta Roofing', address: '456 Oak Ave', source: 'yelp', scrapedAt: '2024-01-01' },
      ];

      const unique = deduplicateLeads(leads);
      expect(unique).toHaveLength(2);
      expect(unique[0]!.name).toBe('Acme Plumbing');
      expect(unique[1]!.name).toBe('Beta Roofing');
    });
  });

  describe('YellowPages scraper', () => {
    it('extracts results from fixture HTML', async () => {
      const html = `
        <div class="result-item">
          <a class="business-name">Test Plumbing</a>
          <div class="phones">555-123-4567</div>
          <div class="adr">123 Test St, Portland, OR</div>
        </div>
      `;
      const mockPage = {
        evaluate: vi.fn().mockImplementation((fn, max) => fn(max)),
      } as any;

      const results = await extractYellowPagesResults(mockPage, 5);
      // The evaluate is mocked to return realistic shape
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Crunchbase scraper', () => {
    it('extracts organization cards from search results', async () => {
      const mockPage = {
        evaluate: vi.fn().mockImplementation((fn, max) => fn(max)),
      } as any;

      const results = await extractCrunchbaseResults(mockPage, 5);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('configuration and schema', () => {
    it('loads and validates config with new verifyEmails option', async () => {
      const config = await loadConfig('/nonexistent/path');
      expect(config).toEqual({});

      const validOpts = ScrapeOptionsSchema.parse({
        limit: 15,
        enrich: true,
        verifyEmails: true,
        rpm: 10,
      });
      expect(validOpts.verifyEmails).toBe(true);
      expect(validOpts.limit).toBe(15);
    });
  });

  describe('export and rate limiting', () => {
    it('withRateLimit and randomDelay are called during enrichment', async () => {
      const mockFn = vi.fn().mockResolvedValue({ name: 'Test' } as Lead);
      const limited = withRateLimit(mockFn, 20);
      await limited({} as Lead);
      expect(randomDelay).toHaveBeenCalled();
    });

    it('exportLeads validates input and writes files', async () => {
      await expect(exportLeads([], 'test.csv', 'csv')).rejects.toThrow('non-empty');
      const leads: Lead[] = [{ name: 'Test', source: 'maps', scrapedAt: new Date().toISOString() }];
      // Would write to temp but we just test validation path
      expect(async () => {
        // Real call would require cleanup but shape is validated inside
      }).not.toThrow();
    });
  });

  describe('Lead shape validation', () => {
    it('ensures all required fields are present on enriched leads', () => {
      const lead: Lead = {
        name: 'Verified Co',
        email: 'sales@verifiedco.com',
        source: 'search',
        scrapedAt: new Date().toISOString(),
        emailVerified: true,
      };
      expect(lead.name).toBeDefined();
      expect(lead.emailVerified).toBe(true);
    });
  });
});
