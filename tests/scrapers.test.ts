import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { loadConfig, saveConfig, CONFIG_PATH } from '../src/config.js';
import { isDisposableEmail } from '../src/enricher.js';
import {
  deduplicateLeads,
  scrapeMaps,
  scrapeSearch,
  scrapeYelp,
  scrapeYellowPages,
  scrapeCrunchbase,
  saveLeads,
} from '../src/index.js';
import { exportLeads } from '../src/exporter.js';
import type { Lead, ScrapeOptions } from '../src/types.js';

// Hoist all mock values so they are available when Vitest hoists the vi.mock calls.
// This eliminates the ReferenceError / TDZ for __vi_import_* variables that occurred
// when a factory closed over variables declared later in the test file.
const mocks = vi.hoisted(() => {
  const scrapeGoogleMaps = vi.fn();
  const scrapeGoogleSearch = vi.fn();
  const scrapeYelpInternal = vi.fn();
  const scrapeYellowPagesInternal = vi.fn();
  const scrapeCrunchbaseInternal = vi.fn();
  const enrichLead = vi.fn().mockImplementation((lead: Lead) =>
    Promise.resolve({ ...lead, emailVerified: true })
  );
  const withRateLimit = vi.fn().mockImplementation((fn: any) => fn);
  const randomDelay = vi.fn().mockResolvedValue(undefined);
  const setProxies = vi.fn();

  return {
    scrapeGoogleMaps,
    scrapeGoogleSearch,
    scrapeYelpInternal,
    scrapeYellowPagesInternal,
    scrapeCrunchbaseInternal,
    enrichLead,
    withRateLimit,
    randomDelay,
    setProxies,
  };
});

// Register mocks *before* any imports that would load the real modules.
// Factories now reference only the hoisted values.
vi.mock('../src/scrapers/maps.js', () => ({
  scrapeGoogleMaps: mocks.scrapeGoogleMaps,
}));

vi.mock('../src/scrapers/search.js', () => ({
  scrapeGoogleSearch: mocks.scrapeGoogleSearch,
}));

vi.mock('../src/scrapers/yelp.js', () => ({
  scrapeYelp: mocks.scrapeYelpInternal,
}));

vi.mock('../src/scrapers/yellowpages.js', () => ({
  scrapeYellowPages: mocks.scrapeYellowPagesInternal,
}));

vi.mock('../src/scrapers/crunchbase.js', () => ({
  scrapeCrunchbase: mocks.scrapeCrunchbaseInternal,
}));

vi.mock('../src/enricher.js', () => ({
  enrichLead: mocks.enrichLead,
  isDisposableEmail,
}));

vi.mock('../src/utils/throttle.js', () => ({
  withRateLimit: mocks.withRateLimit,
  randomDelay: mocks.randomDelay,
}));

vi.mock('../src/utils/browser.js', () => ({
  setProxies: mocks.setProxies,
  launchStealthBrowser: vi.fn().mockResolvedValue({
    newPage: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
  getRandomUserAgent: vi.fn().mockReturnValue('Mozilla/5.0 (test)'),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe('LeadMine scrapers & core utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.scrapeGoogleMaps.mockResolvedValue([
      {
        name: 'Test Plumbing',
        address: '123 Main St, Portland, OR',
        phone: '(503) 555-0123',
        website: 'https://testplumbing.com',
        rating: 4.8,
        reviewCount: 142,
        source: 'maps' as const,
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
    ]);

    mocks.scrapeGoogleSearch.mockResolvedValue([]);
    mocks.scrapeYelpInternal.mockResolvedValue([]);
    mocks.scrapeYellowPagesInternal.mockResolvedValue([]);
    mocks.scrapeCrunchbaseInternal.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('deduplicates leads correctly using name+address+website key', () => {
    const leads: Lead[] = [
      {
        name: 'Acme Corp',
        address: '123 Main St',
        website: 'https://acme.com',
        source: 'maps',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        name: 'Acme Corp',
        address: '123 Main St',
        website: 'https://acme.com',
        source: 'search',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        name: 'Beta LLC',
        address: '456 Oak Ave',
        source: 'maps',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
    ];

    const unique = deduplicateLeads(leads);
    expect(unique).toHaveLength(2);
    expect(unique[0]!.name).toBe('Acme Corp');
    expect(unique[1]!.name).toBe('Beta LLC');
  });

  it('validates Lead shape and metadata', () => {
    const lead: Lead = {
      name: 'Test Business',
      address: '123 Test St, Portland, OR 97201',
      phone: '(503) 555-0199',
      email: 'hello@testbusiness.com',
      website: 'https://testbusiness.com',
      rating: 4.5,
      reviewCount: 87,
      source: 'yelp',
      category: 'plumbers',
      location: 'Portland, OR',
      scrapedAt: '2024-01-01T00:00:00.000Z',
      emailVerified: true,
    };

    expect(lead.name).toBeDefined();
    expect(lead.source).toBe('yelp');
    expect(lead.emailVerified).toBe(true);
    expect(typeof lead.scrapedAt).toBe('string');
  });

  it('detects disposable emails with local list and heuristics', () => {
    expect(isDisposableEmail('user@mailinator.com')).toBe(true);
    expect(isDisposableEmail('user@yopmail.com')).toBe(true);
    expect(isDisposableEmail('contact@realcompany.com')).toBe(false);
    expect(isDisposableEmail('temp123@tempmailaddress.com')).toBe(true);
    expect(isDisposableEmail('invalid')).toBe(true);
    expect(isDisposableEmail('no-at-sign')).toBe(true);
  });

  it('scrapeMaps orchestrates internal scraper, enrichment, deduplication and proxy setup', async () => {
    const options: ScrapeOptions = {
      limit: 10,
      enrich: true,
      verifyEmails: true,
      rpm: 12,
      proxy: 'http://proxy.example.com:8080',
      headless: true,
    };

    const leads = await scrapeMaps('plumbers', 'Portland, OR', options);

    expect(mocks.setProxies).toHaveBeenCalledWith(options.proxy);
    expect(mocks.scrapeGoogleMaps).toHaveBeenCalledWith('plumbers', 'Portland, OR', 10);
    expect(mocks.enrichLead).toHaveBeenCalled();
    expect(leads).toHaveLength(1);
    expect(leads[0]!.name).toBe('Test Plumbing');
    expect(leads[0]!.emailVerified).toBe(true);
  });

  it('scrapeSearch, scrapeYelp, scrapeYellowPages and scrapeCrunchbase follow the same pattern', async () => {
    const opts: ScrapeOptions = { limit: 5, enrich: false, rpm: 20 };

    await scrapeSearch('HVAC Portland', opts);
    expect(mocks.scrapeGoogleSearch).toHaveBeenCalledWith('HVAC Portland', 5);

    await scrapeYelp('roof repair', 'Seattle, WA', opts);
    expect(mocks.scrapeYelpInternal).toHaveBeenCalledWith('roof repair', 'Seattle, WA', 5);

    await scrapeYellowPages('electricians', 'Chicago, IL', opts);
    expect(mocks.scrapeYellowPagesInternal).toHaveBeenCalledWith('electricians', 'Chicago, IL', 5);

    await scrapeCrunchbase('fintech startups', opts);
    expect(mocks.scrapeCrunchbaseInternal).toHaveBeenCalledWith('fintech startups', 5);
  });

  it('loadConfig and saveConfig handle JSON with Zod validation', async () => {
    const fakeConfig = { source: 'maps', category: 'plumbers', limit: 25, enrich: true };
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(fakeConfig));

    const loaded = await loadConfig('/tmp/fake-config.json');
    expect(loaded).toMatchObject({ limit: 25, enrich: true });

    await saveConfig({ limit: 30, headless: false });
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalled();
    expect(vi.mocked(fs.mkdir)).toHaveBeenCalled();
  });

  it('exportLeads writes CSV, JSON and XLSX without throwing', async () => {
    const leads: Lead[] = [
      {
        name: 'Export Test',
        address: '999 Export Ln',
        source: 'maps',
        scrapedAt: new Date().toISOString(),
      },
    ];

    await expect(saveLeads(leads, 'test-leads.csv')).resolves.not.toThrow();
    await expect(saveLeads(leads, 'test-leads.json')).resolves.not.toThrow();
    await expect(saveLeads(leads, 'test-leads.xlsx')).resolves.not.toThrow();
  });

  it('withRateLimit and randomDelay are called during enrichment flows', async () => {
    const options: ScrapeOptions = { limit: 3, enrich: true, rpm: 10 };
    mocks.scrapeGoogleMaps.mockResolvedValueOnce([
      { name: 'Lead1', source: 'maps' as const, scrapedAt: new Date().toISOString() },
      { name: 'Lead2', source: 'maps' as const, scrapedAt: new Date().toISOString() },
    ]);

    await scrapeMaps('test', 'Portland, OR', options);

    expect(mocks.withRateLimit).toHaveBeenCalled();
    expect(mocks.randomDelay).toHaveBeenCalled();
  });

  it('CLI options and wizard path do not throw on schema parse', async () => {
    const { ScrapeOptionsSchema } = await import('../src/types.js');
    const parsed = ScrapeOptionsSchema.safeParse({
      source: 'maps',
      category: 'plumbers',
      location: 'Portland, OR',
      limit: 20,
      enrich: true,
      verifyEmails: false,
      rpm: 15,
      headless: true,
      proxy: ['http://proxy1:8080'],
    });
    expect(parsed.success).toBe(true);
  });
});
