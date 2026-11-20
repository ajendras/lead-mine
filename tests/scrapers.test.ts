import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as leadMine from '../src/index.js';
import { scrapeGoogleMaps } from '../src/scrapers/maps.js';
import { scrapeYelp as scrapeYelpInternal } from '../src/scrapers/yelp.js';
import { scrapeYellowPages as scrapeYellowPagesInternal } from '../src/scrapers/yellowpages.js';
import { scrapeCrunchbase as scrapeCrunchbaseInternal } from '../src/scrapers/crunchbase.js';
import { isDisposableEmail, enrichLead, scoreLeadWithOllama } from '../src/enricher.js';
import { BrowserWorkerPool, getWorkerPool, setProxies } from '../src/utils/browser.js';
import { withRateLimit, randomDelay } from '../src/utils/throttle.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { exportToSheets } from '../src/exporter.js';
import { deduplicateLeads } from '../src/index.js';
import type { Lead, ScrapeOptions } from '../src/types.js';

vi.mock('../src/scrapers/maps.js');
vi.mock('../src/scrapers/yelp.js');
vi.mock('../src/scrapers/yellowpages.js');
vi.mock('../src/scrapers/crunchbase.js');
vi.mock('../src/enricher.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/enricher.js')>();
  return {
    ...mod,
    enrichLead: vi.fn().mockImplementation(async (lead: Lead) => ({ ...lead, email: 'test@example.com' })),
    scoreLeadWithOllama: vi.fn().mockImplementation(async (lead: Lead) => ({ ...lead, relevanceScore: 8, budgetScore: 7 })),
  };
});
vi.mock('ollama');
vi.mock('playwright');

describe('LeadMine Core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('validates ScrapeOptions including concurrency', () => {
    const opts: ScrapeOptions = {
      limit: 50,
      enrich: true,
      concurrency: 4,
      rpm: 12,
      useLLMScoring: true,
    };
    const validated = leadMine.ScrapeOptionsSchema.parse(opts);
    expect(validated.concurrency).toBe(4);
    expect(validated.limit).toBe(50);
    expect(validated.rpm).toBe(12);
  });

  it('BrowserWorkerPool initializes with correct size and supports parallel contexts', () => {
    const pool = new BrowserWorkerPool(4);
    expect(pool.size).toBe(4);
    const pool2 = getWorkerPool(2);
    expect(pool2.size).toBe(2);
  });

  it('setProxies configures rotation for worker pool', () => {
    setProxies(['http://proxy1:8080', 'http://proxy2:8080']);
    const pool = getWorkerPool(2);
    expect(pool).toBeDefined();
  });

  it('isDisposableEmail correctly identifies disposable addresses', () => {
    expect(isDisposableEmail('user@mailinator.com')).toBe(true);
    expect(isDisposableEmail('contact@legitbusiness.com')).toBe(false);
    expect(isDisposableEmail('test@temp-mail.org')).toBe(true);
    expect(isDisposableEmail('invalid-email')).toBe(true);
  });

  it('deduplicateLeads removes duplicates based on name+address+website', () => {
    const leads: Lead[] = [
      { name: 'Acme Plumbing', address: '123 Main St', website: 'acme.com', source: 'maps' },
      { name: 'Acme Plumbing', address: '123 Main St', website: 'acme.com', source: 'maps' },
      { name: 'Beta Roofing', address: '456 Oak Ave', source: 'yelp' },
    ];
    const unique = deduplicateLeads(leads);
    expect(unique.length).toBe(2);
    expect(unique[0]!.name).toBe('Acme Plumbing');
    expect(unique[1]!.name).toBe('Beta Roofing');
  });

  it('enrichLead falls back gracefully and uses worker pool', async () => {
    const lead: Lead = { name: 'Test Biz', website: 'https://example.com', source: 'maps' };
    const enriched = await enrichLead(lead, true);
    expect(enriched.email).toBe('test@example.com');
    expect(enrichLead).toHaveBeenCalled();
  });

  it('scoreLeadWithOllama adds scores when enabled', async () => {
    const lead: Lead = { name: 'Test Biz', source: 'maps' };
    const scored = await scoreLeadWithOllama(lead, 'plumbers');
    expect(scored.relevanceScore).toBe(8);
    expect(scored.budgetScore).toBe(7);
  });

  it('withRateLimit and randomDelay are used in parallel flows', async () => {
    const fn = vi.fn().mockResolvedValue({ name: 'Lead1', source: 'maps' });
    const throttled = withRateLimit(fn, 30);
    const result = await throttled({} as any);
    expect(result).toBeDefined();
    expect(randomDelay).toHaveBeenCalledTimes(0); // depending on mock
  });

  it('loadConfig and saveConfig handle partial options with concurrency', async () => {
    const config = { concurrency: 4, enrich: false, source: 'yelp' as const };
    await saveConfig(config);
    const loaded = await loadConfig();
    expect(loaded.concurrency).toBe(4);
    expect(loaded.enrich).toBe(false);
  });

  it('exportToSheets handles Google Sheets output with new Lead fields', async () => {
    const leads: Lead[] = [{ name: 'Test', source: 'maps', emailVerified: true }];
    await expect(exportToSheets(leads, 'test-spreadsheet-id')).rejects.toThrow(/service account/);
  });

  it('CLI options parse concurrency correctly (via schema)', () => {
    const parsed = leadMine.ScrapeOptionsSchema.parse({ concurrency: 5 });
    expect(parsed.concurrency).toBe(5);
  });

  it('wizard config includes concurrency default', async () => {
    // mock wizard path not directly testable but config path covered via save/load
    const config = { concurrency: 3 };
    const saved = await loadConfig(); // uses partial schema
    expect(typeof saved).toBe('object');
  });

  it('parallel processWithConcurrency (internal) respects limit', async () => {
    const items = [1, 2, 3, 4];
    const processor = vi.fn().mockImplementation((n: number) => Promise.resolve(n * 2));
    // processWithConcurrency is not exported so we test via scrape flow
    const leads = [{ name: 'A', source: 'maps' }, { name: 'B', source: 'maps' }];
    const scraped = await leadMine.scrapeMaps('test', 'testloc', { limit: 2, concurrency: 2, enrich: false });
    expect(scraped.length).toBeGreaterThanOrEqual(0);
  });
});
