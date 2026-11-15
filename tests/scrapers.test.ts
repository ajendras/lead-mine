import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeMaps, scrapeSearch, scrapeYelp, saveLeads } from '../src/index.js';
import * as mapsScraper from '../src/scrapers/maps.js';
import * as searchScraper from '../src/scrapers/search.js';
import * as yelpScraper from '../src/scrapers/yelp.js';
import * as enricherModule from '../src/enricher.js';
import * as exporterModule from '../src/exporter.js';
import { randomDelay, withRateLimit } from '../src/utils/throttle.js';
import type { Lead } from '../src/types.js';

vi.mock('../src/scrapers/maps.js');
vi.mock('../src/scrapers/search.js');
vi.mock('../src/scrapers/yelp.js');
vi.mock('../src/enricher.js');
vi.mock('../src/exporter.js');
vi.mock('../src/utils/browser.js');

describe('LeadMine Scrapers & Utilities', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(enricherModule.enrichLead).mockImplementation(async (lead: Lead) => ({
      ...lead,
      email: lead.email || 'contact@example.com',
      scrapedAt: new Date().toISOString(),
    }));
    vi.mocked(exporterModule.exportLeads).mockResolvedValue(undefined);
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

    it('withRateLimit enforces RPM and calls original function', async () => {
      let counter = 0;
      const mockFn = vi.fn().mockImplementation(async (name: string) => {
        counter++;
        return {
          name,
          source: 'maps' as const,
          scrapedAt: new Date().toISOString(),
        } as Lead;
      });

      const limited = withRateLimit(mockFn, 60);
      const results = await Promise.all([
        limited('One'),
        limited('Two'),
        limited('Three'),
      ]);

      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(3);
      expect(results[0].name).toBe('One');
    });

    it('withRateLimit throws on invalid RPM', () => {
      expect(() => withRateLimit(vi.fn(), 0)).toThrow('between 1 and 120');
      expect(() => withRateLimit(vi.fn(), 150)).toThrow('between 1 and 120');
    });
  });

  describe('scrapeMaps', () => {
    it('returns well-formed Lead objects with metadata', async () => {
      const fixtureLead: Lead = {
        name: 'Portland Plumbing Pros',
        address: '1234 SE Division St, Portland, OR 97202',
        phone: '(503) 555-0199',
        website: 'https://portlandplumbing.example.com',
        rating: 4.9,
        reviewCount: 342,
        source: 'maps',
        category: 'plumbers',
        location: 'Portland, OR',
        scrapedAt: '2024-06-01T12:00:00.000Z',
      };

      vi.mocked(mapsScraper.scrapeGoogleMaps).mockResolvedValue([fixtureLead]);

      const leads = await scrapeMaps('plumbers', 'Portland, OR', {
        limit: 10,
        enrich: false,
        minRating: 4.0,
      });

      expect(leads).toHaveLength(1);
      const lead = leads[0];
      expect(lead).toMatchObject({
        name: 'Portland Plumbing Pros',
        source: 'maps',
        category: 'plumbers',
        location: 'Portland, OR',
      });
      expect(lead.scrapedAt).toBeDefined();
      expect(typeof lead.rating).toBe('number');
    });

    it('applies minRating filter and deduplicates', async () => {
      const rawLeads: Lead[] = [
        {
          name: 'Ace Plumbing',
          address: '111 Main St',
          rating: 4.7,
          source: 'maps' as const,
          scrapedAt: '2024-06-01T12:00:00.000Z',
        },
        {
          name: 'Ace Plumbing',
          address: '111 Main St',
          rating: 4.7,
          source: 'maps' as const,
          scrapedAt: '2024-06-01T12:00:00.000Z',
        }, // duplicate
        {
          name: 'Budget Plumbing',
          address: '222 Oak Ave',
          rating: 3.2,
          source: 'maps' as const,
          scrapedAt: '2024-06-01T12:00:00.000Z',
        },
      ];

      vi.mocked(mapsScraper.scrapeGoogleMaps).mockResolvedValue(rawLeads);

      const leads = await scrapeMaps('plumbers', 'Portland, OR', {
        limit: 5,
        minRating: 4.0,
        enrich: false,
      });

      // Deduplication + rating filter should leave only one
      expect(leads).toHaveLength(1);
      expect(leads[0].name).toBe('Ace Plumbing');
      expect(leads[0].rating).toBe(4.7);
    });

    it('throws helpful errors for missing parameters', async () => {
      await expect(scrapeMaps('', 'Portland, OR')).rejects.toThrow(
        'Category is required'
      );
      await expect(scrapeMaps('plumbers', '')).rejects.toThrow(
        'Location is required'
      );
    });
  });

  describe('scrapeSearch', () => {
    it('extracts leads from organic search and attaches metadata', async () => {
      const fixture: Lead = {
        name: 'Reliable HVAC Services',
        website: 'https://reliablehvac.example.com',
        phone: '(971) 555-0177',
        source: 'search',
        scrapedAt: '2024-06-01T12:00:00.000Z',
      };

      vi.mocked(searchScraper.scrapeGoogleSearch).mockResolvedValue([fixture]);

      const leads = await scrapeSearch('HVAC repair Portland OR', {
        limit: 5,
        enrich: true,
      });

      expect(leads).toHaveLength(1);
      expect(leads[0].category).toBe('HVAC repair Portland OR');
      expect(leads[0].source).toBe('search');
      // Enrichment mock should have added email
      expect(leads[0].email).toBeDefined();
    });

    it('rejects empty query', async () => {
      await expect(scrapeSearch('')).rejects.toThrow('Search query is required');
    });
  });

  describe('scrapeYelp', () => {
    it('returns Yelp leads with correct source and shape', async () => {
      const yelpFixture: Lead = {
        name: 'Best Thai Restaurant',
        address: '567 NE Broadway, Portland, OR',
        phone: '(503) 555-3344',
        rating: 4.5,
        reviewCount: 289,
        source: 'yelp',
        scrapedAt: '2024-06-01T12:00:00.000Z',
      };

      vi.mocked(yelpScraper.scrapeYelp).mockResolvedValue([yelpFixture]);

      const leads = await scrapeYelp('thai food', 'Portland, OR', {
        limit: 8,
        enrich: false,
      });

      expect(leads).toHaveLength(1);
      expect(leads[0].source).toBe('yelp');
      expect(leads[0].location).toBe('Portland, OR');
    });
  });

  describe('enrichment & export integration', () => {
    it('gracefully handles enrichment failures', async () => {
      const baseLead: Lead = {
        name: 'Failing Site Inc',
        website: 'https://fail.example.com',
        source: 'maps' as const,
        scrapedAt: '2024-06-01T12:00:00.000Z',
      };

      vi.mocked(mapsScraper.scrapeGoogleMaps).mockResolvedValue([baseLead]);
      vi.mocked(enricherModule.enrichLead).mockRejectedValueOnce(
        new Error('Timeout while visiting site')
      );

      const leads = await scrapeMaps('test-category', 'Test City', {
        limit: 3,
        enrich: true,
      });

      expect(leads).toHaveLength(1);
      expect(leads[0].name).toBe('Failing Site Inc');
      // Original lead is preserved
      expect(leads[0].website).toBe('https://fail.example.com');
    });

    it('saveLeads calls exporter with inferred format', async () => {
      const leads: Lead[] = [
        {
          name: 'Export Test',
          source: 'search' as const,
          scrapedAt: new Date().toISOString(),
        },
      ];

      await saveLeads(leads, 'results.xlsx');

      expect(exporterModule.exportLeads).toHaveBeenCalledWith(
        leads,
        'xlsx',
        'results.xlsx'
      );
    });
  });

  describe('edge cases', () => {
    it('handles zero results gracefully', async () => {
      vi.mocked(mapsScraper.scrapeGoogleMaps).mockResolvedValue([]);

      const leads = await scrapeMaps('rare-category', 'Remote Village', {
        limit: 50,
        enrich: false,
      });

      expect(leads).toHaveLength(0);
    });

    it('deduplication preserves first occurrence', async () => {
      const duplicates: Lead[] = [
        {
          name: 'Duplicate Business',
          address: '999 Pine St',
          website: 'https://dup.example.com',
          source: 'maps' as const,
          scrapedAt: '2024-06-01T10:00:00.000Z',
        },
        {
          name: 'Duplicate Business',
          address: '999 Pine St',
          website: 'https://dup.example.com',
          source: 'maps' as const,
          scrapedAt: '2024-06-01T11:00:00.000Z',
        },
      ];

      vi.mocked(mapsScraper.scrapeGoogleMaps).mockResolvedValue(duplicates);

      const result = await scrapeMaps('duplicate-test', 'Portland, OR', {
        enrich: false,
      });

      expect(result).toHaveLength(1);
      // First occurrence kept
      expect(result[0].scrapedAt).toBe('2024-06-01T10:00:00.000Z');
    });
  });
});
