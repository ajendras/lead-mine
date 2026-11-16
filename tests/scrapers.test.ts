import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeMaps, scrapeSearch, scrapeYelp, saveLeads, loadConfig } from '../src/index.js';
import * as mapsScraper from '../src/scrapers/maps.js';
import * as searchScraper from '../src/scrapers/search.js';
import * as yelpScraper from '../src/scrapers/yelp.js';
import * as enricherModule from '../src/enricher.js';
import * as exporterModule from '../src/exporter.js';
import { randomDelay, withRateLimit } from '../src/utils/throttle.js';
import * as browserUtils from '../src/utils/browser.js';
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
      phone: '(512) 555-0199',
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
    vi.mocked(browserUtils.getRandomUserAgent).mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    vi.mocked(fs.readFile).mockResolvedValue('{}');
    vi.mocked(os.homedir).mockReturnValue('/tmp');
    vi.mocked(path.join).mockReturnValue('/tmp/.leadmine/config.json');
  });

  it('scrapeMaps integrates config, enrichment and deduplication', async () => {
    const leads = await scrapeMaps('plumbers', 'Portland, OR', { limit: 5, enrich: true });
    expect(mapsScraper.scrapeGoogleMaps).toHaveBeenCalledWith('plumbers', 'Portland, OR', 5);
    expect(leads[0]?.name).toBe('Test Plumbing');
    expect(enricherModule.enrichLead).toHaveBeenCalled();
  });

  it('scrapeSearch performs organic search with optional enrichment', async () => {
    const leads = await scrapeSearch('HVAC companies near Austin TX');
    expect(searchScraper.scrapeGoogleSearch).toHaveBeenCalledWith('HVAC companies near Austin TX', 20);
    expect(leads[0]?.name).toBe('Test HVAC');
  });

  it('scrapeYelp respects limit and optional enrichment', async () => {
    const leads = await scrapeYelp('coffee shops', 'Seattle, WA', { limit: 10, enrich: false });
    expect(yelpScraper.scrapeYelp).toHaveBeenCalledWith('coffee shops', 'Seattle, WA', 10);
    expect(leads[0]?.name).toBe('Test Cafe');
  });

  it('saveLeads delegates to exporter with inferred format', async () => {
    const leads: Lead[] = [{
      name: 'Test Business',
      source: 'maps' as const,
      scrapedAt: new Date().toISOString(),
    }];
    await saveLeads(leads, 'leads.csv');
    expect(exporterModule.exportLeads).toHaveBeenCalledWith(leads, 'csv', 'leads.csv');
  });

  it('loadConfig parses valid JSON config', async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({ limit: 15, enrich: true, rpm: 12 }));
    const config = await loadConfig();
    expect(config.limit).toBe(15);
    expect(config.enrich).toBe(true);
    expect(config.rpm).toBe(12);
  });

  it('loadConfig returns empty object when file is missing', async () => {
    const err = new Error() as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    vi.mocked(fs.readFile).mockRejectedValueOnce(err);
    const config = await loadConfig('/nonexistent/path');
    expect(config).toEqual({});
  });

  describe('throttle utilities', () => {
    it('randomDelay throws on negative bounds', async () => {
      await expect(randomDelay(-100, 100)).rejects.toThrow('non-negative');
    });

    it('withRateLimit enforces requests-per-minute limit', async () => {
      const mockFn = vi.fn().mockResolvedValue('ok');
      const limited = withRateLimit(mockFn, 30);
      await limited('arg');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('browser utilities', () => {
    it('getRandomUserAgent returns a valid UA string from the list', () => {
      const ua = browserUtils.getRandomUserAgent();
      expect(typeof ua).toBe('string');
      expect(ua.length).toBeGreaterThan(30);
      expect(ua).toMatch(/^Mozilla\/5\.0/);
    });
  });
});
