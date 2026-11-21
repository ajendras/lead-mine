import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as leadMine from '../src/index.js';
import ollama from 'ollama';

vi.mock('ollama', () => ({
  default: {
    chat: vi.fn(),
  },
}));

vi.mock('../src/utils/browser.js', () => ({
  setProxies: vi.fn().mockResolvedValue(undefined),
}));

describe('LeadMine Core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scores lead with Ollama (relevanceScore + budgetScore)', async () => {
    const mockChat = vi.fn().mockResolvedValue({
      message: {
        content: '{"relevance": 9, "budget": 7, "notes": "Perfect fit for plumbing services with strong local presence."}',
      },
    });
    (ollama as any).chat = mockChat;

    const lead = {
      name: 'Portland Plumbing Pros',
      address: '1234 SE Division St, Portland, OR 97202',
      website: 'https://portlandplumbingpros.com',
      rating: 4.9,
      reviewCount: 124,
      source: 'maps' as const,
      category: 'plumbers',
    };

    const scored = await leadMine.scoreLeadWithOllama(lead, 'plumbers');

    expect(scored.relevanceScore).toBe(9);
    expect(scored.budgetScore).toBe(7);
    expect(scored.scoringNotes).toBeDefined();
  });

  it('parallel processWithConcurrency (internal) respects limit', async () => {
    const mockProcessor = vi.fn().mockImplementation(async (id: number) => ({
      id,
      name: `Lead ${id}`,
      rating: 4.5,
      source: 'maps' as const,
    }));

    const spy = vi.spyOn(leadMine, 'withRateLimit').mockImplementation((fn: any) => fn);

    const items = [1, 2];
    const result = await leadMine.processWithConcurrency(items, mockProcessor, 2);

    expect(result.length).toBe(2);
    expect(result.every((l: any) => (l.rating ?? 0) >= 4.0)).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('deduplicates leads based on name+address+website', () => {
    const leads = [
      { name: 'Test', address: '123 St', website: 'test.com', source: 'maps' as const },
      { name: 'Test', address: '123 St', website: 'test.com', source: 'maps' as const },
      { name: 'Another', address: '456 St', website: 'other.com', source: 'maps' as const },
    ];

    const unique = leadMine.deduplicateLeads(leads);
    expect(unique.length).toBe(2);
  });

  it('enrichLead adds emailVerified flag', async () => {
    const lead = { name: 'Test', email: 'test@company.com', source: 'maps' as const } as any;
    const enriched = await leadMine.enrichLead(lead, true);
    expect(enriched.emailVerified).toBe(true);
  });

  it('isDisposableEmail detects known providers', () => {
    expect(leadMine.isDisposableEmail('spam@mailinator.com')).toBe(true);
    expect(leadMine.isDisposableEmail('real@company.com')).toBe(false);
  });

  it('exports leads to CSV without error', async () => {
    const leads = [{ name: 'Test Lead', source: 'maps' as const }];
    await expect(leadMine.exportLeads(leads, 'csv' as any, 'test.csv')).resolves.not.toThrow();
  });

  it('loadConfig returns partial options gracefully', async () => {
    const config = await leadMine.loadConfig();
    expect(config).toBeDefined();
  });
});
