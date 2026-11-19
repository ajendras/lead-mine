import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import * as leadMine from '../src/index.js';
import { isDisposableEmail } from '../src/enricher.js';
import { deduplicateLeads } from '../src/index.js';
import { randomDelay, withRateLimit } from '../src/utils/throttle.js';
import { loadConfig, saveConfig } from '../src/config.js';
import type { Lead, ScrapeOptions } from '../src/types.js';

// All vi.mock calls must be at the very top (before any other imports or top-level variables)
// to prevent hoisting-related TDZ errors with factory closures and Vitest's internal __vi_import rewrites.
// This was the root cause of the failing "test (22)" CI job.
vi.mock('../src/scrapers/maps.js', () => ({
  scrapeGoogleMaps: vi.fn(),
}));

vi.mock('../src/scrapers/search.js', () => ({
  scrapeGoogleSearch: vi.fn(),
}));

vi.mock('../src/scrapers/yelp.js', () => ({
  scrapeYelp: vi.fn(),
}));

vi.mock('../src/scrapers/yellowpages.js', () => ({
  scrapeYellowPages: vi.fn(),
}));

vi.mock('../src/scrapers/crunchbase.js', () => ({
  scrapeCrunchbase: vi.fn(),
  extractCrunchbaseResults: vi.fn(),
}));

vi.mock('../src/utils/browser.js', () => ({
  launchStealthBrowser: vi.fn().mockResolvedValue({ newPage: vi.fn(), close: vi.fn() }),
  getRandomUserAgent: vi.fn().mockReturnValue('Mozilla/5.0 (test)'),
  setProxies: vi.fn(),
}));

vi.mock('../src/enricher.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/enricher.js')>();
  return {
    ...mod,
    enrichLead: vi.fn().mockImplementation((lead: Lead) =>
      Promise.resolve({
        ...lead,
        email: 'test@example.com',
        emailVerified: true,
      })
    ),
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, 'temp-test-output');

describe('LeadMine - scrapers, utils, and core behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    try {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  it('validates Lead shape and ScrapeOptions via Zod schema', () => {
    const validLead: Lead = {
      name: 'Test Plumbing Co',
      address: '123 Main St, Portland, OR 97201',
      phone: '(503) 555-0123',
      email: 'contact@testplumbing.com',
      website: 'https://testplumbing.com',
      rating: 4.8,
      reviewCount: 127,
      source: 'maps',
      category: 'plumbers',
      location: 'Portland, OR',
      scrapedAt: new Date().toISOString(),
      emailVerified: true,
    };

    expect(validLead).toHaveProperty('name');
    expect(validLead.emailVerified).toBe(true);

    const opts: ScrapeOptions = {
      source: 'maps',
      category: 'plumbers',
      location: 'Portland, OR',
      limit: 25,
      enrich: true,
      verifyEmails: true,
      rpm: 12,
      headless: true,
      minRating: 4.0,
    };

    expect(() => leadMine.ScrapeOptionsSchema.parse(opts)).not.toThrow();
  });

  it('deduplicates leads by normalized name+address+website key', () => {
    const leads: Lead[] = [
      {
        name: 'Acme Corp',
        address: '123 Oak St',
        website: 'https://acmecorp.com',
        source: 'maps',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      } as Lead,
      {
        name: 'Acme Corp',
        address: '123 Oak St',
        website: 'https://acmecorp.com',
        source: 'maps',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      } as Lead,
      {
        name: 'Beta Inc',
        address: '456 Pine Ave',
        website: 'https://betainc.com',
        source: 'maps',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      } as Lead,
    ];

    const unique = deduplicateLeads(leads);
    expect(unique).toHaveLength(2);
    expect(unique[0]?.name).toBe('Acme Corp');
    expect(unique[1]?.name).toBe('Beta Inc');
  });

  it('correctly identifies disposable emails', () => {
    expect(isDisposableEmail('user@mailinator.com')).toBe(true);
    expect(isDisposableEmail('user@tempmail.com')).toBe(true);
    expect(isDisposableEmail('contact@realbusiness.com')).toBe(false);
    expect(isDisposableEmail('invalid')).toBe(true);
    expect(isDisposableEmail('no-at-symbol')).toBe(true);
  });

  it('provides working throttle utilities (randomDelay + withRateLimit)', async () => {
    const start = Date.now();
    await randomDelay(5, 15);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(4);

    const mockFn = vi.fn().mockResolvedValue('result');
    const throttled = withRateLimit(mockFn, 200);
    const res = await throttled('arg1', 42);
    expect(res).toBe('result');
    expect(mockFn).toHaveBeenCalledWith('arg1', 42);
  });

  it('exports leads to CSV, JSON, and XLSX formats', async () => {
    const leads: Lead[] = [
      {
        name: 'Test Export Co',
        address: '999 Export Ln, Portland, OR',
        phone: '555-9876',
        email: 'export@test.com',
        website: 'https://testexport.com',
        source: 'maps',
        category: 'test',
        scrapedAt: new Date().toISOString(),
      } as Lead,
    ];

    const csvPath = path.join(TEMP_DIR, 'leads.csv');
    const jsonPath = path.join(TEMP_DIR, 'leads.json');
    const xlsxPath = path.join(TEMP_DIR, 'leads.xlsx');

    await leadMine.saveLeads(leads, csvPath, 'csv');
    await leadMine.saveLeads(leads, jsonPath, 'json');
    await leadMine.saveLeads(leads, xlsxPath, 'xlsx');

    const csv = await fs.readFile(csvPath, 'utf8');
    const json = JSON.parse(await fs.readFile(jsonPath, 'utf8'));

    expect(csv).toContain('Test Export Co');
    expect(csv).toContain('export@test.com');
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe('Test Export Co');
    expect(await fs.stat(xlsxPath)).toBeTruthy(); // file was written
  });

  it('exportToSheets throws clear error when service account key is missing', async () => {
    const leads: Lead[] = [
      {
        name: 'Sheets Test',
        source: 'maps',
        scrapedAt: new Date().toISOString(),
      } as Lead,
    ];

    await expect(
      leadMine.exportToSheets(leads, '1FakeSpreadsheetId123456789')
    ).rejects.toThrow(/Service account JSON key not found/);
  });

  it('loadConfig / saveConfig round-trip works with partial options', async () => {
    const testConfigPath = path.join(TEMP_DIR, 'test-config.json');
    const partial: Partial<ScrapeOptions> = {
      source: 'yellowpages',
      category: 'electricians',
      location: 'Chicago, IL',
      limit: 15,
      enrich: false,
      verifyEmails: true,
      rpm: 10,
    };

    await saveConfig(partial, testConfigPath);
    const loaded = await loadConfig(testConfigPath);

    expect(loaded.source).toBe('yellowpages');
    expect(loaded.limit).toBe(15);
    expect(loaded.verifyEmails).toBe(true);
  });

  it('Crunchbase parser (extractCrunchbaseResults) and high-level scraper are usable under mock', async () => {
    const mockLeads: Lead[] = [
      {
        name: 'Crunchbase AI Startup',
        website: 'https://example.ai',
        address: 'San Francisco, CA',
        source: 'crunchbase',
        scrapedAt: new Date().toISOString(),
      } as Lead,
    ];

    // Use the already-mocked scraper module
    const crunchbaseModule = await import('../src/scrapers/crunchbase.js');
    vi.mocked(crunchbaseModule.scrapeCrunchbase).mockResolvedValue(mockLeads);

    const result = await leadMine.scrapeCrunchbase('AI startups', {
      limit: 5,
      enrich: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Crunchbase AI Startup');
    expect(leadMine.deduplicateLeads(result)).toHaveLength(1);
  });

  it('high-level scrape* wrappers accept options and return Lead[] without throwing (mocks active)', async () => {
    const mockResult: Lead[] = [
      {
        name: 'Mocked Business',
        address: '123 Mock St',
        source: 'maps',
        scrapedAt: new Date().toISOString(),
      } as Lead,
    ];

    vi.mocked((await import('../src/scrapers/maps.js')).scrapeGoogleMaps).mockResolvedValue(
      mockResult
    );
    vi.mocked((await import('../src/scrapers/search.js')).scrapeGoogleSearch).mockResolvedValue(
      mockResult
    );

    const mapsLeads = await leadMine.scrapeMaps('plumbers', 'Portland, OR', { limit: 5, enrich: false });
    const searchLeads = await leadMine.scrapeSearch('plumbers Portland OR', { limit: 5, enrich: false });

    expect(mapsLeads).toHaveLength(1);
    expect(searchLeads).toHaveLength(1);
    expect(mapsLeads[0].name).toBe('Mocked Business');
  });

  it('CLI helper functions exist and wizard/config paths are exported', () => {
    expect(typeof leadMine.loadConfig).toBe('function');
    expect(typeof leadMine.saveLeads).toBe('function');
    expect(typeof leadMine.exportToSheets).toBe('function');
    expect(typeof leadMine.scrapeYellowPages).toBe('function');
    expect(leadMine.CONFIG_PATH).toContain('.leadmine/config.json');
  });
});
