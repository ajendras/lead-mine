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
  rpm?: number;
  minRating?: number;
  userAgent?: string;
  proxy?: string | string[];
  googleSheets?: GoogleSheetsOptions;
  concurrency?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
}

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'html' | 'hubspot' | 'salesforce';

export interface RateLimitPreset {
  readonly rpm: number;
  readonly source: ScrapeSource;
  readonly backoffFactor: number;
  readonly maxDelayMs: number;
}

export const RATE_LIMIT_PRESETS = {
  maps: {
    rpm: 6,
    source: 'maps' as const,
    backoffFactor: 2.5,
    maxDelayMs: 90000,
  },
  search: {
    rpm: 10,
    source: 'search' as const,
    backoffFactor: 2.0,
    maxDelayMs: 45000,
  },
  yelp: {
    rpm: 15,
    source: 'yelp' as const,
    backoffFactor: 1.8,
    maxDelayMs: 35000,
  },
  yellowpages: {
    rpm: 25,
    source: 'yellowpages' as const,
    backoffFactor: 1.5,
    maxDelayMs: 25000,
  },
  crunchbase: {
    rpm: 12,
    source: 'crunchbase' as const,
    backoffFactor: 2.0,
    maxDelayMs: 40000,
  },
} as const;

export type RateLimitOptions = number | {
  rpm?: number;
  source?: ScrapeSource;
  backoffFactor?: number;
  maxDelayMs?: number;
};

export const ScrapeOptionsSchema = z
  .object({
    source: z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']).optional(),
    category: z.string().optional(),
    location: z.string().optional(),
    query: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(25),
    enrich: z.boolean().optional().default(true),
    verifyEmails: z.boolean().optional().default(false),
    useLLMScoring: z.boolean().optional().default(false),
    ollamaModel: z.string().optional().default('llama3.1'),
    headless: z.boolean().optional().default(true),
    rpm: z.coerce.number().int().min(1).max(60).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    userAgent: z.string().optional(),
    proxy: z.union([z.string(), z.array(z.string())]).optional(),
    googleSheets: z
      .object({
        spreadsheetId: z.string().optional(),
        sheetName: z.string().optional().default('Leads'),
        serviceAccountKeyPath: z.string().optional(),
      })
      .optional(),
    concurrency: z.coerce.number().int().min(1).max(6).optional().default(3),
    backoffFactor: z.coerce.number().min(1).max(5).optional().default(1.8),
    maxDelayMs: z.coerce.number().int().min(1000).optional().default(30000),
  })
  .passthrough();
