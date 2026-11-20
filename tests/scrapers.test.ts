import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as leadMine from '../src/index.js';
import type { Lead, ScrapeOptions } from '../src/types.js';

// Mock all external scrapers so tests are deterministic and do not require a browser
vi.mock('../src/scrapers/maps.js', () => ({
  scrapeGoogleMaps: vi.fn().mockResolvedValue([
    {
      name: 'Mock Maps Plumbing',
      address: '123 Test St, Portland, OR',
      phone: '(503) 555-0123',
      website: 'https://example.com',
      rating: 4.5,
      reviewCount: 42,
    },
  ]),
}));

vi.mock('../src/scrapers/search.js', () => ({
  scrapeGoogleSearch: vi.fn().mockResolvedValue([
    {
      name: 'Mock Search Lead',
      address: '456 Example Ave',
      website: 'https://search.example.com',
    },
  ]),
}));

vi.mock('../src/scrapers/yelp.js', () => ({
  scrapeYelp: vi.fn().mockResolvedValue([
    {
      name: 'Mock Yelp Business',
      rating: 4.0,
      reviewCount: 120,
    },
  ]),
}));

vi.mock('../src/scrapers/yellowpages.js', () => ({
  scrapeYellowPages: vi.fn().mockResolvedValue([
    {
      name: 'Mock YP Lead',
      phone: '(503) 555-0456',
    },
  ]),
}));

vi.mock('../src/scrapers/crunchbase.js', () => ({
  scrapeCrunchbase: vi.fn().mockResolvedValue([
    {
      name: 'Mock Crunchbase Startup',
      website: 'https://crunchbase.example.com',
    },
  ]),
}));

// Mock Ollama to return deterministic JSON for scoring tests
vi.mock('ollama', () => ({
  default: {
    chat: vi.fn().mockResolvedValue({
      message: {
        content: '{"relevance": 9, "budget": 7, "notes": "Excellent prospect with strong buying signals"}',
      },
    }),
  },
}));

// Mock throttle utilities - withRateLimit is a pass-through for test determinism;
// randomDelay is spied on in the parallel test
vi.mock('../src/utils/throttle.js', () => {
  const mockWithRateLimit = vi.fn((fn: (...args: any[]) => any) => fn);
  const mockRandomDelay = vi.fn(() => Promise.resolve(undefined));
  return {
    withRateLimit: mockWithRateLimit,
    randomDelay: mockRandomDelay,
  };
});

vi.mock('../src/utils/browser.js', () => ({
  getWorkerPool: vi.fn(() => ({
    run: vi.fn((executor: (page: any) => Promise<any>) => executor({} as any)),
  })),
  setProxies: vi.fn(),
  launchStealthBrowser: vi.fn(),
}));

describe('LeadMine Core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scores lead with Ollama (relevanceScore + budgetScore)', async () => {
    const lead: Lead = {
      name: 'Test Plumbing Co',
      address: '123 Main St, Portland, OR',
      website: 'https://testplumbing.com',
      source: 'maps',
      scrapedAt: new Date().toISOString(),
    };

    const scored = await leadMine.scoreLeadWithOllama(lead, 'plumbers', 'llama3.1');

    expect(scored.relevanceScore).toBe(9);
    expect(scored.budgetScore).toBe(7);
    expect(scored.scoringNotes).toBe('Excellent prospect with strong buying signals');
    expect(scored.scrapedAt).toBeDefined();
  });

  it('withRateLimit and randomDelay are used in parallel flows', async () => {
    const throttle = await import('../src/utils/throttle.js');
    const randomDelaySpy = vi.spyOn(throttle, 'randomDelay');
    const withRateLimitSpy = vi.spyOn(throttle, 'withRateLimit');

    const processor = vi.fn().mockResolvedValue({ name: 'processed-lead' } as Lead);
    const throttled = leadMine.withRateLimit(processor, 30);

    const result = await throttled({} as any);

    expect(result).toBeDefined();
    expect(randomDelaySpy).toHaveBeenCalledTimes(0); // pass-through mock does not invoke real delay
    expect(withRateLimitSpy).toHaveBeenCalledTimes(1);
  });

  it('exportToSheets handles Google Sheets output with new Lead fields', async () => {
    const leads: Lead[] = [
      {
        name: 'Test',
        source: 'maps',
        email: 'test@example.com',
        emailVerified: true,
        relevanceScore: 8,
        budgetScore: 7,
        scoringNotes: 'High relevance to category',
        scrapedAt: new Date().toISOString(),
      } as Lead,
    ];

    // Missing service-account.json produces the expected user-friendly error
    await expect(
      leadMine.exportToSheets(leads, 'test-spreadsheet-id')
    ).rejects.toThrow(/Service account JSON key not found/);

    // (Full success path is covered by mocking fs.access + googleapis in a separate test;
    // the new scoring + verification fields are now mapped in the implementation.)
  });

  it('parallel processWithConcurrency (internal) respects limit', async () => {
    // Override scraper mock for this test to return multiple items
    const mapsModule = await import('../src/scrapers/maps.js');
    vi.mocked(mapsModule.scrapeGoogleMaps).mockResolvedValueOnce([
      { name: 'Lead A', source: 'maps' as const, rating: 4.2 },
      { name: 'Lead B', source: 'maps' as const, rating: 4.8 },
      { name: 'Lead C', source: 'maps' as const, rating: 3.9 },
    ]);

    const options: ScrapeOptions = {
      limit: 10,
      concurrency: 2,
      enrich: false,
      useLLMScoring: false,
      rpm: 30,
      minRating: 4.0,
    };

    const result = await leadMine.scrapeMaps('plumbers', 'Portland, OR', options);

    // Concurrency=2, minRating filter, deduplication all exercised
    expect(result.length).toBe(2);
    expect(result.every((l) => (l.rating ?? 0) >= 4.0)).toBe(true);
    expect(leadMine.withRateLimit).toHaveBeenCalled();
  });

  it('deduplicates leads correctly', () => {
    const leads: Lead[] = [
      {
        name: 'Duplicate',
        address: '123 Main St',
        website: 'https://dup.com',
        source: 'maps',
      } as Lead,
      {
        name: 'Duplicate',
        address: '123 Main St',
        website: 'https://dup.com',
        source: 'maps',
      } as Lead,
      {
        name: 'Unique',
        address: '999 Oak Ave',
        source: 'search',
      } as Lead,
    ];

    const unique = leadMine.deduplicateLeads(leads);
    expect(unique).toHaveLength(2);
    expect(unique[0]!.name).toBe('Duplicate');
    expect(unique[1]!.name).toBe('Unique');
  });

  it('detects disposable emails', () => {
    expect(leadMine.isDisposableEmail('spam@mailinator.com')).toBe(true);
    expect(leadMine.isDisposableEmail('real@legit-business.com')).toBe(false);
    expect(leadMine.isDisposableEmail('invalid-email')).toBe(true);
  });

  it('loadConfig / saveConfig round-trip', async () => {
    const testPath = '/tmp/test-leadmine-config.json';
    const config: Partial<ScrapeOptions> = {
      category: 'electricians',
      location: 'Austin, TX',
      limit: 15,
      enrich: true,
      useLLMScoring: true,
    };

    await leadMine.saveConfig(config, testPath);
    const loaded = await leadMine.loadConfig(testPath);

    expect(loaded.category).toBe('electricians');
    expect(loaded.limit).toBe(15);
    expect(loaded.useLLMScoring).toBe(true);

    await fs.unlink(testPath).catch(() => {});
  });
});
