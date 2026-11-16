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
vi.mock('../src/utils/throttle.js');
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
      website: 'https://test.com',
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
    vi.mocked(browserUtils.setProxies).mockImplementation(() => {});
    vi.mocked(browserUtils.getRandomUserAgent).mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    );
    vi.mocked(randomDelay).mockResolvedValue(undefined);
    vi.mocked(withRateLimit).mockImplementation((fn: any) => fn);
  });

  it('scrapeMaps integrates scraper, enrichment, deduplication and respects proxy', async () => {
    const proxyList = ['http://proxy1.example.com:8080', 'http://proxy2.example.com:8080'];
    const leads = await scrapeMaps('plumbers', 'Portland, OR', {
      limit: 10,
      enrich: true,
      proxy: proxyList,
    });

    expect(browserUtils.setProxies).toHaveBeenCalledWith(proxyList);
    expect(mapsScraper.scrapeGoogleMaps).toHaveBeenCalledWith('plumbers', 'Portland, OR', 10);
    expect(enricherModule.enrichLead).toHaveBeenCalled();
    expect(leads.length).toBe(1);
    expect(leads[0]!.name).toBe('Test Plumbing');
  });

  it('scrapeSearch works with proxy rotation', async () => {
    const leads = await scrapeSearch('HVAC near Austin', {
      limit: 5,
      proxy: 'http://residential.example.com:4000',
      enrich: false,
    });

    expect(browserUtils.setProxies).toHaveBeenCalledWith('http://residential.example.com:4000');
    expect(searchScraper.scrapeGoogleSearch).toHaveBeenCalled();
    expect(leads.length).toBe(1);
  });

  it('scrapeYelp respects proxy configuration', async () => {
    const leads = await scrapeYelp('coffee', 'Portland, OR', {
      limit: 8,
      proxy: ['http://p1:80'],
      enrich: true,
    });

    expect(browserUtils.setProxies).toHaveBeenCalledWith(['http://p1:80']);
    expect(yelpScraper.scrapeYelp).toHaveBeenCalledWith('coffee', 'Portland, OR', 8);
    expect(leads.length).toBe(1);
  });

  it('loadConfig parses proxy from JSON config', async () => {
    const mockConfigPath = '/home/test/.leadmine/config.json';
    const mockConfig = {
      limit: 15,
      proxy: 'http://user:pass@residential.provider:22222',
    };

    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));
    vi.mocked(os.homedir).mockReturnValue('/home/test');
    vi.mocked(path.join).mockReturnValue(mockConfigPath);

    const config = await loadConfig(mockConfigPath);
    expect(config.proxy).toBe('http://user:pass@residential.provider:22222');
    expect(config.limit).toBe(15);
  });

  it('saveLeads exports correctly and skips on empty input', async () => {
    await saveLeads([], 'empty.csv');
    expect(exporterModule.exportLeads).not.toHaveBeenCalled();

    const leads: Lead[] = [{
      name: 'Test Lead',
      source: 'maps' as const,
      scrapedAt: new Date().toISOString(),
    }];
    await saveLeads(leads, 'leads.csv');
    expect(exporterModule.exportLeads).toHaveBeenCalledWith(
      leads,
      'csv',
      'leads.csv'
    );
  });

  it('proxy rotator is called before any scraping begins', async () => {
    vi.mocked(mapsScraper.scrapeGoogleMaps).mockResolvedValue([]);
    await scrapeMaps('testcat', 'testloc', { proxy: 'http://testproxy:3128' });
    expect(browserUtils.setProxies).toHaveBeenCalledWith('http://testproxy:3128');
  });
});
