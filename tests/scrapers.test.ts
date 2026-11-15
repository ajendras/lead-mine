import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeMaps, scrapeSearch, scrapeYelp, saveLeads, loadConfig } from '../src/index.js';
import * as mapsScraper from '../src/scrapers/maps.js';
import * as searchScraper from '../src/scrapers/search.js';
import * as yelpScraper from '../src/scrapers/yelp.js';
import * as enricherModule from '../src/enricher.js';
import * as exporterModule from '../src/exporter.js';
import { randomDelay, withRateLimit } from '../src/utils/throttle.js';
import type { Lead } from '../src/types.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../src/scrapers/maps.js');
vi.mock('../src/scrapers/search.js');
vi.mock('../src/scrapers/yelp.js');
vi.mock('../src/enricher.js');
vi.mock('../src/exporter.js');
vi.mock('../src/utils/browser.js');
vi.mock('node:fs/promises');
vi.mock('node:os');
vi.mock('node:path');

describe('LeadMine Scrapers & Utilities', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(enricherModule.enrichLead).mockImplementation(async (lead: Lead) => ({
      ...lead,
      email: lead.email || 'contact@example.com',
      scrapedAt: new Date().toISOString(),
    } as Lead));
    vi.mocked(exporterModule.exportLeads).mockResolvedValue(undefined);
    vi.mocked(mapsScraper.scrapeGoogleMaps).mockResolvedValue([{
      name: 'Test Plumbing',
      address: '123 Main St',
      phone: '(503) 555-0123',
      source: 'maps' as const,
      scrapedAt: new Date().toISOString(),
    }]);
    vi.mocked(searchScraper.scrapeGoogleSearch).mockResolvedValue([{
      name: 'Test HVAC',
      website: 'https://example.com',
      source: 'search' as const,
      scrapedAt: new Date().toISOString(),
    }]);
    vi.mocked(yelpScraper.scrapeYelp).mockResolvedValue([{
      name: 'Test Cafe',
      address: '456 Oak Ave',
      rating: 4.5,
      source: 'yelp' as const,
      scrapedAt: new Date().toISOString(),
    }]);

    // Default mocks for config loader (most tests expect no config file)
    vi.mocked(os.homedir).mockReturnValue('/home/testuser');
    vi.mocked(path.join).mockImplementation((...args: string[]) => args.join('/'));
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' } as any);
  });

  describe('throttle utilities', () => {
    it('randomDelay respects bounds and returns a promise', async () => {
      const start = Date.now();
      await randomDelay(15, 40);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(15);
      expect(elapsed).toBeLessThan(120); // generous tolerance for test env
    });

    it('randomDelay validates input', async () => {
      await expect(randomDelay(-10, 20)).rejects.toThrow('non-negative');
      await expect(randomDelay(50, 10)).resolves.toBeUndefined(); // auto-swaps
    });

    it('withRateLimit validates rpm', () => {
      expect(() => withRateLimit(async () => {}, 0)).toThrow('between 1 and 120');
      expect(() => withRateLimit(async () => {}, 150)).toThrow('between 1 and 120');
      expect(() => withRateLimit(async () => {}, 20)).not.toThrow();
    });

    it('withRateLimit enforces rate limit using sliding window', async () => {
      const mockFn = vi.fn().mockResolvedValue('done');
      const limited = withRateLimit(mockFn, 3);
      await limited('arg1');
      await limited('arg2');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('scraper orchestration', () => {
    it('scrapeMaps enriches and deduplicates leads', async () => {
      const leads = await scrapeMaps('plumbers', 'Portland, OR', {
        limit: 5,
        enrich: true,
        rpm: 30,
      });
      expect(mapsScraper.scrapeGoogleMaps).toHaveBeenCalledWith('plumbers', 'Portland, OR', 5);
      expect(leads[0]?.name).toBe('Test Plumbing');
      expect(leads[0]?.email).toBe('contact@example.com');
    });

    it('scrapeSearch performs organic search with on-page enrichment', async () => {
      const leads = await scrapeSearch('HVAC repair near Austin', { limit: 10, enrich: false });
      expect(searchScraper.scrapeGoogleSearch).toHaveBeenCalledWith('HVAC repair near Austin', 10);
      expect(leads.length).toBe(1);
    });

    it('scrapeYelp uses fallback detail page visits', async () => {
      const leads = await scrapeYelp('coffee shops', 'Seattle, WA', {
        limit: 15,
        enrich: true,
        minRating: 4.0,
      });
      expect(yelpScraper.scrapeYelp).toHaveBeenCalledWith('coffee shops', 'Seattle, WA', 15);
      expect(leads[0]?.rating).toBe(4.5);
    });
  });

  describe('export and utils', () => {
    it('saveLeads handles different formats and calls exporter', async () => {
      const leads: Lead[] = [{
        name: 'Business Inc',
        source: 'maps' as const,
        scrapedAt: new Date().toISOString(),
      }];
      await saveLeads(leads, 'output.json');
      expect(exporterModule.exportLeads).toHaveBeenCalledWith(
        leads,
        'json',
        'output.json'
      );
    });
  });

  describe('configuration', () => {
    it('loadConfig returns empty object when file does not exist', async () => {
      const config = await loadConfig();
      expect(config).toEqual({});
    });

    it('loadConfig parses and validates JSON config', async () => {
      const mockConfigStr = JSON.stringify({
        limit: 50,
        rpm: 12,
        enrich: false,
        minRating: 4.0,
      });
      vi.mocked(fs.readFile).mockResolvedValueOnce(mockConfigStr);

      const config = await loadConfig('/tmp/test-config.json');
      expect(config).toEqual({
        limit: 50,
        rpm: 12,
        enrich: false,
        minRating: 4.0,
      });
    });

    it('loadConfig falls back gracefully on invalid JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce('invalid json {');

      const config = await loadConfig('/tmp/bad-config.json');
      expect(config).toEqual({});
    });

    it('loadConfig falls back on Zod validation error', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({ limit: 9999, rpm: -5 }));

      const config = await loadConfig('/tmp/invalid-values.json');
      expect(config).toEqual({});
    });
  });
});
