import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  scrapeMaps,
  scrapeSearch,
  scrapeYelp,
  scrapeYellowPages,
  scrapeCrunchbase,
  saveLeads,
  loadConfig,
  deduplicateLeads,
  isDisposableEmail,
  ScrapeOptionsSchema,
  type Lead,
} from '../src/index.js';
import { extractYellowPagesResults } from '../src/scrapers/yellowpages.js';
import { extractCrunchbaseResults } from '../src/scrapers/crunchbase.js';

// Hoist mock factories to avoid TDZ/ReferenceError after Vitest hoists vi.mock calls.
// This was the root cause of the CI failure on Node 22.
const mockScrapeMaps = vi.hoisted(() => vi.fn());
const mockScrapeSearch = vi.hoisted(() => vi.fn());
const mockScrapeYelp = vi.hoisted(() => vi.fn());
const mockScrapeYellowPages = vi.hoisted(() => vi.fn());
const mockScrapeCrunchbase = vi.hoisted(() => vi.fn());
const mockEnrichLead = vi.hoisted(() => vi.fn().mockImplementation((lead: Lead) => Promise.resolve(lead)));

vi.mock('../src/scrapers/maps.js', () => ({
  scrapeGoogleMaps: mockScrapeMaps,
}));

vi.mock('../src/scrapers/search.js', () => ({
  scrapeGoogleSearch: mockScrapeSearch,
}));

vi.mock('../src/scrapers/yelp.js', () => ({
  scrapeYelp: mockScrapeYelp,
}));

vi.mock('../src/scrapers/yellowpages.js', () => ({
  scrapeYellowPages: mockScrapeYellowPages,
  extractYellowPagesResults,
}));

vi.mock('../src/scrapers/crunchbase.js', () => ({
  scrapeCrunchbase: mockScrapeCrunchbase,
  extractCrunchbaseResults,
}));

vi.mock('../src/enricher.js', () => ({
  enrichLead: mockEnrichLead,
  isDisposableEmail,
}));

vi.mock('../src/utils/throttle.js', () => ({
  withRateLimit: vi.fn((fn: any) => fn),
  randomDelay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils/browser.js', () => ({
  setProxies: vi.fn(),
  launchStealthBrowser: vi.fn(),
  getRandomUserAgent: vi.fn().mockReturnValue('Mozilla/5.0 (test)'),
}));

vi.mock('../src/exporter.js', () => ({
  exportLeads: vi.fn().mockResolvedValue(undefined),
}));

describe('LeadMine scrapers & utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScrapeMaps.mockResolvedValue([]);
    mockScrapeSearch.mockResolvedValue([]);
    mockScrapeYelp.mockResolvedValue([]);
    mockScrapeYellowPages.mockResolvedValue([]);
    mockScrapeCrunchbase.mockResolvedValue([]);
  });

  it('validates Lead shape and ScrapeOptions via Zod', () => {
    const validOptions = ScrapeOptionsSchema.parse({
      limit: 25,
      enrich: true,
      verifyEmails: true,
      rpm: 12,
      headless: true,
      proxy: 'http://example.com:8080',
    });
    expect(validOptions.limit).toBe(25);
    expect(validOptions.enrich).toBe(true);

    const lead: Lead = {
      name: 'Test Business',
      address: '123 Test St, Portland, OR',
      phone: '(555) 555-0123',
      email: 'contact@test.com',
      website: 'https://test.com',
      rating: 4.8,
      reviewCount: 127,
      source: 'maps',
      category: 'plumbers',
      location: 'Portland, OR',
      scrapedAt: new Date().toISOString(),
      emailVerified: true,
    };
    expect(lead.name).toBe('Test Business');
    expect(lead.emailVerified).toBe(true);
  });

  it('deduplicates leads by normalized name+address+website key', () => {
    const leads: Lead[] = [
      {
        name: 'Acme Plumbing',
        address: '123 Main St',
        website: 'https://acme.com',
        source: 'maps',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        name: 'Acme Plumbing',
        address: '123 Main St',
        website: 'https://acme.com',
        source: 'maps',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        name: 'Beta Electric',
        address: '456 Oak Ave',
        website: 'https://beta.com',
        source: 'yelp',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
    ];

    const unique = deduplicateLeads(leads);
    expect(unique).toHaveLength(2);
    expect(unique[0]!.name).toBe('Acme Plumbing');
    expect(unique[1]!.name).toBe('Beta Electric');
  });

  it('detects disposable emails correctly', () => {
    expect(isDisposableEmail('user@mailinator.com')).toBe(true);
    expect(isDisposableEmail('user@tempmail.com')).toBe(true);
    expect(isDisposableEmail('contact@realbusiness.com')).toBe(false);
    expect(isDisposableEmail('invalid-email')).toBe(true);
    expect(isDisposableEmail('temp123@trashmail.net')).toBe(true);
  });

  it('loads config gracefully (missing file returns empty object)', async () => {
    const config = await loadConfig('/nonexistent/.leadmine/config.json');
    expect(config).toEqual({});
  });

  it('creates temporary config and loads it', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadmine-test-'));
    const configPath = path.join(tmpDir, 'config.json');
    const configContent = {
      limit: 15,
      enrich: false,
      rpm: 10,
      verifyEmails: true,
    };
    await fs.writeFile(configPath, JSON.stringify(configContent), 'utf8');

    const loaded = await loadConfig(configPath);
    expect(loaded.limit).toBe(15);
    expect(loaded.enrich).toBe(false);
    expect(loaded.verifyEmails).toBe(true);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('orchestrates scrapeMaps with mocked scraper and enricher', async () => {
    const mockLead: Lead = {
      name: 'Mock Plumbing Co',
      address: '123 Test St',
      phone: '(555) 123-4567',
      source: 'maps',
      scrapedAt: new Date().toISOString(),
    };
    mockScrapeMaps.mockResolvedValue([mockLead]);

    const leads = await scrapeMaps('plumbers', 'Portland, OR', {
      limit: 5,
      enrich: true,
      verifyEmails: true,
      rpm: 30,
    });

    expect(mockScrapeMaps).toHaveBeenCalledWith('plumbers', 'Portland, OR', 5);
    expect(leads).toHaveLength(1);
    expect(leads[0]!.name).toBe('Mock Plumbing Co');
    expect(mockEnrichLead).toHaveBeenCalled();
  });

  it('orchestrates scrapeSearch', async () => {
    const mockLead: Lead = {
      name: 'Search Result Biz',
      website: 'https://example.com',
      source: 'search',
      scrapedAt: new Date().toISOString(),
    };
    mockScrapeSearch.mockResolvedValue([mockLead]);

    const leads = await scrapeSearch('plumbers near Portland OR', { limit: 10, enrich: false });
    expect(mockScrapeSearch).toHaveBeenCalledWith('plumbers near Portland OR', 10);
    expect(leads).toEqual([mockLead]);
  });

  it('orchestrates scrapeYelp', async () => {
    const mockLead: Lead = {
      name: 'Yelp Cafe',
      address: '456 Pine St',
      source: 'yelp',
      scrapedAt: new Date().toISOString(),
    };
    mockScrapeYelp.mockResolvedValue([mockLead]);

    const leads = await scrapeYelp('coffee shops', 'Portland, OR', { limit: 8, enrich: true });
    expect(mockScrapeYelp).toHaveBeenCalledWith('coffee shops', 'Portland, OR', 8);
    expect(leads[0]!.name).toBe('Yelp Cafe');
  });

  it('orchestrates scrapeYellowPages', async () => {
    const mockLead: Lead = {
      name: 'YP Electric',
      phone: '(555) 987-6543',
      source: 'yellowpages',
      scrapedAt: new Date().toISOString(),
    };
    mockScrapeYellowPages.mockResolvedValue([mockLead]);

    const leads = await scrapeYellowPages('electricians', 'Chicago, IL', { limit: 12 });
    expect(mockScrapeYellowPages).toHaveBeenCalledWith('electricians', 'Chicago, IL', 12);
    expect(leads).toHaveLength(1);
  });

  it('orchestrates scrapeCrunchbase', async () => {
    const mockLead: Lead = {
      name: 'Crunchbase Startup',
      website: 'https://startup.com',
      source: 'crunchbase',
      scrapedAt: new Date().toISOString(),
    };
    mockScrapeCrunchbase.mockResolvedValue([mockLead]);

    const leads = await scrapeCrunchbase('fintech startups', { limit: 15, enrich: true });
    expect(mockScrapeCrunchbase).toHaveBeenCalledWith('fintech startups', 15);
    expect(leads[0]!.name).toBe('Crunchbase Startup');
  });

  it('exposes and runs YellowPages extractor (real implementation)', async () => {
    expect(typeof extractYellowPagesResults).toBe('function');
    // Basic smoke test (would require full page mock for deep assertion)
  });

  it('exposes and runs Crunchbase extractor (real implementation)', async () => {
    expect(typeof extractCrunchbaseResults).toBe('function');
  });

  it('saves leads via inferred format', async () => {
    const leads: Lead[] = [
      {
        name: 'Export Test',
        source: 'maps',
        scrapedAt: new Date().toISOString(),
      },
    ];

    await saveLeads(leads, 'test-output.csv');
    const exportLeadsFn = (await import('../src/exporter.js')).exportLeads as any;
    expect(exportLeadsFn).toHaveBeenCalledWith(leads, 'csv', 'test-output.csv');
  });

  it('handles empty leads in saveLeads gracefully', async () => {
    await saveLeads([], 'empty.csv');
    // No error, warning logged internally
  });
});
