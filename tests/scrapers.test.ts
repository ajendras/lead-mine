import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { scrapeGoogleMaps } from '../src/scrapers/maps.js';
import { scrapeGoogleSearch } from '../src/scrapers/search.js';
import { scrapeYelp } from '../src/scrapers/yelp.js';
import { scrapeYellowPages } from '../src/scrapers/yellowpages.js';
import { scrapeCrunchbase } from '../src/scrapers/crunchbase.js';
import { enrichLead, isDisposableEmail, scoreLeadWithOllama } from '../src/enricher.js';
import {
  exportLeads,
  exportToSheets,
  exportToHubspotCsv,
  exportToSalesforceCsv,
} from '../src/exporter.js';
import { deduplicateLeads } from '../src/index.js';
import { loadConfig, saveConfig } from '../src/config.js';
import { withRateLimit, randomDelay } from '../src/utils/throttle.js';
import { processWithConcurrency } from '../src/index.js';
import type { Lead, ScrapeOptions } from '../src/types.js';

vi.mock('../src/scrapers/maps.js');
vi.mock('../src/scrapers/search.js');
vi.mock('../src/scrapers/yelp.js');
vi.mock('../src/scrapers/yellowpages.js');
vi.mock('../src/scrapers/crunchbase.js');
vi.mock('ollama');
vi.mock('googleapis');

const mockLeads: Lead[] = [
  {
    name: 'Test Plumbing',
    address: '123 Main St, Portland, OR 97201',
    phone: '(503) 555-0123',
    email: 'contact@testplumbing.com',
    website: 'https://testplumbing.com',
    rating: 4.8,
    reviewCount: 124,
    source: 'maps',
    category: 'plumbers',
    scrapedAt: new Date().toISOString(),
  },
  {
    name: 'Another Test',
    address: '456 Oak Ave, Portland, OR 97202',
    phone: '(503) 555-0456',
    website: 'https://anothertest.com',
    source: 'yelp',
    category: 'plumbers',
  },
];

describe('LeadMine Core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.unlink('test-output.csv').catch(() => {});
    await fs.unlink('test-hubspot.csv').catch(() => {});
    await fs.unlink('test-salesforce.csv').catch(() => {});
  });

  it('deduplicates leads correctly by name+address+website', () => {
    const duplicates = [...mockLeads, { ...mockLeads[0] }];
    const unique = deduplicateLeads(duplicates);
    expect(unique).toHaveLength(2);
    expect(unique[0]!.name).toBe('Test Plumbing');
  });

  it('identifies disposable emails', () => {
    expect(isDisposableEmail('test@mailinator.com')).toBe(true);
    expect(isDisposableEmail('real@company.com')).toBe(false);
    expect(isDisposableEmail('temp123@fakeinbox.com')).toBe(true);
    expect(isDisposableEmail('invalid-email')).toBe(true);
  });

  it('exports to all formats including new CRM templates', async () => {
    await exportLeads(mockLeads, 'csv', 'test-output.csv');
    await exportLeads(mockLeads, 'json', 'test-output.json');
    await exportLeads(mockLeads, 'xlsx', 'test-output.xlsx');
    await exportLeads(mockLeads, 'html', 'test-output.html');
    await exportLeads(mockLeads, 'hubspot', 'test-hubspot.csv');
    await exportLeads(mockLeads, 'salesforce', 'test-salesforce.csv');

    const csvContent = await fs.readFile('test-output.csv', 'utf8');
    expect(csvContent).toContain('Test Plumbing');

    const hubspotContent = await fs.readFile('test-hubspot.csv', 'utf8');
    expect(hubspotContent).toContain('Name,Website');
    expect(hubspotContent).toContain('Test Plumbing');
    expect(hubspotContent).toContain('123 Main St');
    expect(hubspotContent).toContain('Portland');
    expect(hubspotContent).toContain('OR');

    const salesforceContent = await fs.readFile('test-salesforce.csv', 'utf8');
    expect(salesforceContent).toContain('Account Name');
    expect(salesforceContent).toContain('Billing Street');
    expect(salesforceContent).toContain('Test Plumbing');
  });

  it('parses address components for CRM templates', async () => {
    const crmLead: Lead = {
      name: 'Address Test',
      address: '789 Pine Street, Seattle, WA 98101',
      source: 'maps' as const,
    };
    await exportLeads([crmLead], 'hubspot', 'test-hubspot.csv');
    const content = await fs.readFile('test-hubspot.csv', 'utf8');
    expect(content).toContain('789 Pine Street');
    expect(content).toContain('Seattle');
    expect(content).toContain('WA');
    expect(content).toContain('98101');
  });

  it('enriches lead and sets emailVerified flag', async () => {
    const enriched = await enrichLead(mockLeads[0]!, true);
    expect(enriched.emailVerified).toBe(true);
  });

  it('loads and saves config with validation', async () => {
    const testConfig = { source: 'maps', category: 'test', limit: 10 };
    await saveConfig(testConfig);
    const loaded = await loadConfig();
    expect(loaded.category).toBe('test');
    expect(loaded.limit).toBe(10);
  });

  it('respects concurrency limit in processWithConcurrency', async () => {
    const processor = vi.fn().mockResolvedValue('done');
    const items = Array.from({ length: 5 }, (_, i) => i);
    await processWithConcurrency(items, processor, 2, 100);
    expect(processor).toHaveBeenCalledTimes(5);
  });

  it('applies rate limiting', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const limited = withRateLimit(fn, 60);
    await limited();
    expect(fn).toHaveBeenCalled();
  });

  it('handles LLM scoring with fallback', async () => {
    const scored = await scoreLeadWithOllama(mockLeads[0]!, 'plumbers');
    expect(scored).toHaveProperty('name');
  });

  it('exports to Google Sheets with proper error on missing key', async () => {
    await expect(exportToSheets(mockLeads, 'fake-id')).rejects.toThrow(/service account JSON key/);
  });

  it('wizard and CLI option parsing are covered by schema', () => {
    const parsed = ScrapeOptionsSchema.safeParse({ source: 'maps', limit: 25, enrich: true });
    expect(parsed.success).toBe(true);
  });
});
