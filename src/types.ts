import { z } from 'zod';

export interface Lead {
  name: string;
  website?: string;
  email?: string;
  phone?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  relevanceScore?: number;
  budgetScore?: number;
  scoringNotes?: string;
  emailVerified?: boolean;
  scrapedAt?: string;
}

export type ScrapeSource = 'maps' | 'search' | 'yelp' | 'yellowpages' | 'crunchbase';

export interface GoogleSheetsOptions {
  spreadsheetId?: string;
  sheetName?: string;
  serviceAccountKeyPath?: string;
}

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'html' | 'hubspot' | 'salesforce';

export type RateLimitOptions = 
  | number 
  | {
      rpm?: number;
      backoffFactor?: number;
      maxDelayMs?: number;
      source?: ScrapeSource;
    };

export interface ScrapeOptions {
  source?: ScrapeSource;
  category?: string;
  location?: string;
  query?: string;
  limit?: number;
  enrich?: boolean;
  verifyEmails?: boolean;
  useLLMScoring?: boolean;
  ollamaModel?: string;
  headless?: boolean;
  minRating?: number;
  rpm?: number;
  proxy?: string | string[];
  googleSheets?: GoogleSheetsOptions;
  concurrency?: number;
  append?: boolean;
  minScore?: number;
}

/**
 * Per-source polite rate limit presets. Can be overridden.
 */
export const RATE_LIMIT_PRESETS: Record<ScrapeSource | 'enrich' | 'llm', { rpm: number }> = {
  maps: { rpm: 6 },
  search: { rpm: 10 },
  yelp: { rpm: 15 },
  yellowpages: { rpm: 25 },
  crunchbase: { rpm: 12 },
  enrich: { rpm: 8 },
  llm: { rpm: 6 },
};

export const ScrapeOptionsSchema = z
  .object({
    source: z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']).default('maps'),
    category: z.string().optional(),
    location: z.string().optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
    enrich: z.boolean().default(true),
    verifyEmails: z.boolean().default(false),
    useLLMScoring: z.boolean().default(false),
    ollamaModel: z.string().default('llama3.1'),
    headless: z.boolean().default(true),
    minRating: z.number().min(0).max(5).optional(),
    rpm: z.number().int().min(1).max(60).optional(),
    proxy: z.union([z.string(), z.array(z.string())]).optional(),
    googleSheets: z
      .object({
        spreadsheetId: z.string().optional(),
        sheetName: z.string().default('Leads'),
        serviceAccountKeyPath: z.string().optional(),
      })
      .optional(),
    concurrency: z.number().int().min(1).max(6).default(3),
    append: z.boolean().default(false),
    minScore: z.number().min(0).max(10).default(0),
  })
  .passthrough();
