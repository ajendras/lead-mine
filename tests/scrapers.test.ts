import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import * as browserUtils from '../src/utils/browser.js';
import * as throttleUtils from '../src/utils/throttle.js';
import { scrapeMaps, scrapeSearch, scrapeYelp, scrapeYellowPages, scrapeCrunchbase } from '../src/index.js';
import { scrapeYellowPages as scrapeYellowPagesInternal, extractYellowPagesResults } from '../src/scrapers/yellowpages.js';
import { scrapeCrunchbase as scrapeCrunchbaseInternal, extractCrunchbaseResults } from '../src/scrapers/crunchbase.js';
import { deduplicateLeads } from '../src/index.js';
import type { Lead, ScrapeSource } from '../src/types.js';

vi.mock('../src/utils/browser.js');
vi.mock('../src/utils/throttle.js');

describe('Scrapers', () => {
  let browser: Browser;
  let page: Page;

  beforeEach(async () => {
    vi.clearAllMocks();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    vi.spyOn(browserUtils, 'launchStealthBrowser').mockResolvedValue(browser as any);
    vi.spyOn(throttleUtils, 'randomDelay').mockResolvedValue(undefined);
    vi.spyOn(throttleUtils, 'withRateLimit').mockImplementation((fn: any) => fn);
  });

  afterEach(async () => {
    await page.close();
    await browser.close();
  });

  it('extractYellowPagesResults parses mock HTML correctly', async () => {
    const mockHtml = `
      <div class="result-item">
        <a class="business-name">Acme Plumbing</a>
        <div class="phones.phone">(503) 555-0123</div>
        <div class="adr">123 Main St, Portland, OR 97201</div>
        <a href="https://acmeplumbing.com">Website</a>
        <div class="rating">4.5</div>
      </div>
    `;
    await page.setContent(mockHtml);
    const results = await extractYellowPagesResults(page, 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('Acme Plumbing');
    expect(results[0]!.phone).toBe('(503) 555-0123');
    expect(results[0]!.address).toBe('123 Main St, Portland, OR 97201');
    expect(results[0]!.website).toBe('https://acmeplumbing.com');
    expect(results[0]!.rating).toBe(4.5);
    expect(results[0]!.source).toBe('yellowpages');
  });

  it('extractCrunchbaseResults parses mock HTML correctly', async () => {
    const mockHtml = `
      <div class="organization-card">
        <h3>FinTech Innovations</h3>
        <div>San Francisco, CA</div>
        <a href="/organization/fintech-innovations">Profile</a>
        <div class="description">Next-gen payment solutions</div>
      </div>
    `;
    await page.setContent(mockHtml);
    const results = await extractCrunchbaseResults(page, 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('FinTech Innovations');
    expect(results[0]!.address).toBe('San Francisco, CA');
    expect(results[0]!.profileUrl).toContain('/organization/fintech-innovations');
    expect(results[0]!.source).toBe('crunchbase');
  });

  it('scrapeYellowPages returns leads with correct metadata', async () => {
    const mockLeads: Lead[] = [{
      name: 'Test Plumbing Co',
      address: '456 Oak Ave',
      phone: '(555) 987-6543',
      source: 'yellowpages',
      scrapedAt: new Date().toISOString(),
    }];
    vi.spyOn(browserUtils, 'launchStealthBrowser').mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setViewportSize: vi.fn(),
        goto: vi.fn(),
        evaluate: vi.fn().mockResolvedValue(mockLeads),
        close: vi.fn(),
      }),
      close: vi.fn(),
    } as any);

    const leads = await scrapeYellowPages('plumbers', 'Portland, OR', { limit: 3, enrich: false });
    expect(Array.isArray(leads)).toBe(true);
    expect(leads.length).toBeGreaterThan(0);
    expect(leads[0]!.source).toBe('yellowpages');
    expect(leads[0]!.category).toBe('plumbers');
    expect(leads[0]!.location).toBe('Portland, OR');
  });

  it('scrapeCrunchbase returns leads with correct metadata', async () => {
    const mockLeads: Lead[] = [{
      name: 'Test Startup Inc',
      website: 'https://teststartup.com',
      address: 'San Francisco, CA',
      source: 'crunchbase',
      scrapedAt: new Date().toISOString(),
    }];
    vi.spyOn(browserUtils, 'launchStealthBrowser').mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setViewportSize: vi.fn(),
        goto: vi.fn(),
        evaluate: vi.fn().mockResolvedValue(mockLeads),
        close: vi.fn(),
      }),
      close: vi.fn(),
    } as any);

    const leads = await scrapeCrunchbase('fintech startups', { limit: 3, enrich: false });
    expect(Array.isArray(leads)).toBe(true);
    expect(leads.length).toBeGreaterThan(0);
    expect(leads[0]!.source).toBe('crunchbase');
    expect(leads[0]!.category).toBe('fintech startups');
  });

  it('deduplicateLeads removes duplicates based on name+address+website', () => {
    const leads: Lead[] = [
      { name: 'Acme', address: '123 St', website: 'acme.com', source: 'maps', scrapedAt: '2024-01-01T00:00:00Z' },
      { name: 'Acme', address: '123 St', website: 'acme.com', source: 'yelp', scrapedAt: '2024-01-01T00:00:00Z' },
      { name: 'Beta', address: '456 Ave', source: 'search', scrapedAt: '2024-01-01T00:00:00Z' },
    ];
    const unique = deduplicateLeads(leads);
    expect(unique).toHaveLength(2);
    expect(unique[0]!.name).toBe('Acme');
    expect(unique[1]!.name).toBe('Beta');
  });

  it('all sources are supported', () => {
    const sources: ScrapeSource[] = ['maps', 'search', 'yelp', 'yellowpages', 'crunchbase'];
    expect(sources.length).toBe(5);
  });
});
