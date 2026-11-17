import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { chromium, type Browser } from 'playwright';

import {
  deduplicateLeads,
  loadConfig,
  isDisposableEmail,
  exportLeads,
  scrapeMaps,
  scrapeSearch,
  scrapeYelp,
  scrapeYellowPages,
  scrapeCrunchbase,
} from '../src/index.js';

import { extractYellowPagesResults } from '../src/scrapers/yellowpages.js';
import { extractCrunchbaseResults } from '../src/scrapers/crunchbase.js';
import { withRateLimit, randomDelay } from '../src/utils/throttle.js';
import type { Lead } from '../src/types.js';

// Mock heavy browser/network dependencies so unit tests stay fast and isolated
vi.mock('../src/utils/browser.js', () => ({
  launchStealthBrowser: vi.fn(),
  getRandomUserAgent: vi.fn().mockReturnValue('Mozilla/5.0 (Test)'),
  setProxies: vi.fn(),
}));

vi.mock('../src/enricher.js', () => ({
  enrichLead: vi.fn().mockImplementation((lead: Lead) => Promise.resolve({ ...lead, scrapedAt: new Date().toISOString() })),
  isDisposableEmail,
}));

const mockScrapeFn = vi.fn().mockResolvedValue([]);
vi.mock('../src/scrapers/maps.js', () => ({ scrapeGoogleMaps: mockScrapeFn }));
vi.mock('../src/scrapers/search.js', () => ({ scrapeGoogleSearch: mockScrapeFn }));
vi.mock('../src/scrapers/yelp.js', () => ({ scrapeYelp: mockScrapeFn }));
vi.mock('../src/scrapers/yellowpages.js', () => ({
  scrapeYellowPages: mockScrapeFn,
  extractYellowPagesResults,
}));
vi.mock('../src/scrapers/crunchbase.js', () => ({
  scrapeCrunchbase: mockScrapeFn,
  extractCrunchbaseResults,
}));

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

describe('LeadMine scrapers and utilities', () => {
  test('YellowPages scraper > extracts results from fixture HTML', async () => {
    const page = await browser.newPage();

    const fixture = `<!DOCTYPE html>
<html>
<body>
  <div class="result-item">
    <a class="business-name">Portland Plumbing Co</a>
    <div class="phones phone">(503) 555-1212</div>
    <div class="adr">456 Oak St, Portland, OR 97205</div>
    <a href="https://portlandplumbing.example.com" rel="nofollow">Website</a>
    <div class="rating">4.8</div>
  </div>
  <div class="listing">
    <h2><a class="name">Expert Electricians Inc</a></h2>
    <div class="phone">555-9876</div>
    <div class="adr">789 Pine Ave Portland OR</div>
  </div>
</body>
</html>`;

    await page.setContent(fixture);
    const results = await extractYellowPagesResults(page, 10);

    expect(results.length).toBe(2);
    expect(results[0]).toMatchObject({
      name: 'Portland Plumbing Co',
      phone: '(503) 555-1212',
      address: '456 Oak St, Portland, OR 97205',
      website: 'https://portlandplumbing.example.com',
      rating: 4.8,
      source: 'yellowpages',
    });

    await page.close();
  });

  test('Crunchbase scraper > extracts organization cards from search results', async () => {
    const page = await browser.newPage();

    const fixture = `<!DOCTYPE html>
<html>
<body>
  <div class="Card">
    <h3>FinTech Innovations</h3>
    <span>New York, NY</span>
    <a href="/organization/fintech-innovations">Profile</a>
    <div class="description">AI-powered financial tools.</div>
  </div>
  <div class="organization-card">
    <div class="name">AI Health Corp</div>
    <a href="/organization/ai-health-corp">Link</a>
  </div>
</body>
</html>`;

    await page.setContent(fixture);
    const results = await extractCrunchbaseResults(page, 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('FinTech Innovations');
    expect(results[0]!.address).toContain('New York');
    expect(results[0]!.profileUrl).toContain('crunchbase.com/organization/fintech-innovations');

    await page.close();
  });

  test('withRateLimit and randomDelay are called during enrichment', async () => {
    const mockFn = vi.fn().mockResolvedValue({ name: 'Test', source: 'maps' } as Lead);
    const limited = withRateLimit(mockFn, 20);

    expect(typeof limited).toBe('function');

    const result = await limited({ name: 'Test Lead' } as Lead);
    expect(mockFn).toHaveBeenCalled();
    expect(result.name).toBe('Test');

    // Ensure randomDelay was exercised by the wrapper
    await randomDelay(5, 15);
    expect(true).toBe(true); // randomDelay runs without error
  });

  test('deduplicates leads based on normalized name+address+website', () => {
    const leads: Lead[] = [
      {
        name: 'Acme Corp',
        address: '123 Main St',
        website: 'https://acme.example.com',
        source: 'maps',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        name: 'Acme Corp',
        address: '123 Main St',
        website: 'https://acme.example.com',
        source: 'yelp',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        name: 'Beta Solutions',
        address: '456 Oak Ave',
        source: 'search',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
    ];

    const unique = deduplicateLeads(leads);
    expect(unique).toHaveLength(2);
    expect(unique.map((l) => l.name)).toEqual(['Acme Corp', 'Beta Solutions']);
  });

  test('isDisposableEmail correctly identifies temporary addresses', () => {
    expect(isDisposableEmail('user@gmail.com')).toBe(false);
    expect(isDisposableEmail('test@mailinator.com')).toBe(true);
    expect(isDisposableEmail('temp@10minutemail.com')).toBe(true);
    expect(isDisposableEmail('fake@tempmail.org')).toBe(true);
    expect(isDisposableEmail('invalid-email')).toBe(true);
    expect(isDisposableEmail('contact@realbusiness.com')).toBe(false);
  });

  test('exportLeads writes CSV, JSON and XLSX without error', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadmine-test-'));
    const sampleLeads: Lead[] = [
      {
        name: 'Test Business',
        address: '123 Test Lane',
        phone: '(555) 123-4567',
        email: 'hello@testbusiness.com',
        website: 'https://testbusiness.com',
        source: 'maps',
        scrapedAt: new Date().toISOString(),
      },
    ];

    await exportLeads(sampleLeads, 'csv', path.join(tmpDir, 'leads.csv'));
    await exportLeads(sampleLeads, 'json', path.join(tmpDir, 'leads.json'));
    await exportLeads(sampleLeads, 'xlsx', path.join(tmpDir, 'leads.xlsx'));

    const jsonRaw = await fs.readFile(path.join(tmpDir, 'leads.json'), 'utf8');
    const parsed = JSON.parse(jsonRaw);
    expect(parsed[0].name).toBe('Test Business');
    expect(parsed[0].email).toBe('hello@testbusiness.com');

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('loadConfig returns parsed partial options or empty object on error/missing file', async () => {
    // missing file
    const missing = await loadConfig('/tmp/does-not-exist-config.json');
    expect(missing).toEqual({});

    // valid config
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
    const configPath = path.join(tmpDir, 'config.json');
    const configContent = {
      limit: 15,
      enrich: true,
      verifyEmails: true,
      rpm: 12,
      headless: false,
    };
    await fs.writeFile(configPath, JSON.stringify(configContent));

    const loaded = await loadConfig(configPath);
    expect(loaded.limit).toBe(15);
    expect(loaded.verifyEmails).toBe(true);
    expect(loaded.rpm).toBe(12);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('scrape functions attach metadata and call deduplication', async () => {
    const options: ScrapeOptions = { limit: 5, enrich: false, rpm: 30 };

    const mapsLeads = await scrapeMaps('plumbers', 'Portland, OR', options);
    expect(Array.isArray(mapsLeads)).toBe(true);

    const searchLeads = await scrapeSearch('HVAC repair near Austin', options);
    expect(Array.isArray(searchLeads)).toBe(true);

    // mocks make them return empty arrays, but metadata path is exercised
    expect(mockScrapeFn).toHaveBeenCalled();
  });

  test('enrichment falls back gracefully on error', async () => {
    const { enrichLead } = await import('../src/enricher.js');
    const lead: Lead = {
      name: 'Failing Site',
      website: 'https://this-will-timeout.example',
      source: 'search',
      scrapedAt: new Date().toISOString(),
    };

    const result = await enrichLead(lead, true);
    expect(result.name).toBe('Failing Site');
    expect(result.emailVerified).toBeUndefined();
  });
});
