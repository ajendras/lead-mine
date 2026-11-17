import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { extractYellowPagesResults } from '../src/scrapers/yellowpages.js';
import { extractCrunchbaseResults } from '../src/scrapers/crunchbase.js';
import { deduplicateLeads } from '../src/index.js';
import { randomDelay, withRateLimit } from '../src/utils/throttle.js';
import { loadConfig } from '../src/config.js';
import { exportLeads } from '../src/exporter.js';
import type { Lead } from '../src/types.js';

describe('LeadMine scrapers, parsers and utilities', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('extracts YellowPages results from HTML fixture', async () => {
    const html = `
      <div class="result-item">
        <h2><a class="business-name">Test Plumbing Co</a></h2>
        <div class="phone">555-123-4567</div>
        <div class="adr">123 Main St, Portland, OR 97201</div>
        <a href="https://testplumbing.com" rel="nofollow">Website</a>
        <div class="rating">4.8</div>
      </div>
      <div class="result-item">
        <h2><a class="business-name">Another Service</a></h2>
        <div class="phone">555-987-6543</div>
      </div>
    `;

    await page.setContent(html);
    const results = await extractYellowPagesResults(page, 10);

    expect(results.length).toBe(2);
    expect(results[0]!.name).toBe('Test Plumbing Co');
    expect(results[0]!.phone).toBe('555-123-4567');
    expect(results[0]!.address).toBe('123 Main St, Portland, OR 97201');
    expect(results[0]!.website).toBe('https://testplumbing.com');
    expect(results[0]!.rating).toBe(4.8);
    expect(results[0]!.source).toBe('yellowpages');
  });

  it('extracts Crunchbase results from HTML fixture', async () => {
    const html = `
      <div class="organization-card">
        <h3>FinTech Innovations</h3>
        <span>San Francisco, CA, United States</span>
        <a href="/organization/fintech-innovations">View profile</a>
        <div class="description">AI-powered lending platform.</div>
      </div>
    `;

    await page.setContent(html);
    const results = await extractCrunchbaseResults(page, 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('FinTech Innovations');
    expect(results[0]!.address).toContain('San Francisco');
    expect(results[0]!.profileUrl).toContain('https://www.crunchbase.com/organization/fintech-innovations');
    expect(results[0]!.source).toBe('crunchbase');
  });

  it('deduplicates leads based on normalized name+address+website key', () => {
    const leads: Lead[] = [
      {
        name: 'Acme Corp',
        address: '123 Main St',
        website: 'https://acmecorp.com',
        phone: '(555) 123-4567',
        source: 'maps',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        name: 'Acme Corp',
        address: '123 Main St',
        website: 'https://acmecorp.com',
        source: 'yelp',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        name: 'Beta Solutions',
        address: '456 Oak Ave',
        website: 'https://beta.solutions',
        source: 'search',
        scrapedAt: '2024-01-01T00:00:00.000Z',
      },
    ];

    const unique = deduplicateLeads(leads);
    expect(unique.length).toBe(2);
    expect(unique[0]!.name).toBe('Acme Corp');
    expect(unique[1]!.name).toBe('Beta Solutions');
  });

  it('randomDelay resolves after a short random wait', async () => {
    const start = Date.now();
    await randomDelay(10, 40);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(8);
  });

  it('withRateLimit returns a wrapped function that invokes the original', async () => {
    const mockFn = vi.fn().mockResolvedValue({
      name: 'Test Lead',
      source: 'maps' as const,
      scrapedAt: new Date().toISOString(),
    } as Lead);

    const throttled = withRateLimit(mockFn, 60);
    const result = await throttled({ name: 'input' } as any);

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(result.name).toBe('Test Lead');
  });

  it('loadConfig returns empty object when config file is missing', async () => {
    const config = await loadConfig('/nonexistent/.leadmine/config.json');
    expect(config).toEqual({});
  });

  it('exportLeads writes all supported formats without throwing (using /tmp)', async () => {
    const leads: Lead[] = [{
      name: 'Test Business Inc',
      address: '789 Test Lane, Portland, OR',
      phone: '555-111-2222',
      email: 'hello@testbusiness.com',
      website: 'https://testbusiness.com',
      rating: 4.9,
      reviewCount: 124,
      source: 'maps',
      category: 'plumbing',
      location: 'Portland, OR',
      scrapedAt: new Date().toISOString(),
    }];

    await expect(exportLeads(leads, 'csv', '/tmp/test-leads.csv')).resolves.not.toThrow();
    await expect(exportLeads(leads, 'json', '/tmp/test-leads.json')).resolves.not.toThrow();
    await expect(exportLeads(leads, 'xlsx', '/tmp/test-leads.xlsx')).resolves.not.toThrow();
  });

  it('maintains consistent Lead shape', () => {
    const lead: Lead = {
      name: 'Valid Lead',
      address: '123 Example St',
      source: 'yelp',
      scrapedAt: '2024-01-01T00:00:00.000Z',
    };

    expect(lead).toHaveProperty('name');
    expect(lead).toHaveProperty('source');
    expect(lead).toHaveProperty('scrapedAt');
    expect(typeof lead.name).toBe('string');
  });
});
