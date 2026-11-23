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

export interface RateLimitPreset {
  rpm: number;
  backoffFactor: number;
  maxDelayMs: number;
}

export const RATE_LIMIT_PRESETS: Record<ScrapeSource, RateLimitPreset> = {
  maps: { rpm: 6, backoffFactor: 2.0, maxDelayMs: 60000 },
  search: { rpm: 10, backoffFactor: 1.8, maxDelayMs: 45000 },
  yelp: { rpm: 15, backoffFactor: 1.6, maxDelayMs: 30000 },
  yellowpages: { rpm: 25, backoffFactor: 1.5, maxDelayMs: 25000 },
  crunchbase: { rpm: 12, backoffFactor: 1.7, maxDelayMs: 40000 },
};

export type RateLimitOptions = number | (Partial<RateLimitPreset> & { source?: ScrapeSource });

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
  rpm?: number;
  headless?: boolean;
  minRating?: number;
  userAgent?: string;
  proxy?: string | string[];
  googleSheets?: GoogleSheetsOptions;
  concurrency?: number;
}

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'html' | 'hubspot' | 'salesforce';

const SourceEnum = z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']);

export const ScrapeOptionsSchema = z
  .object({
    source: SourceEnum.default('maps'),
    category: z.string().optional(),
    location: z.string().optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(25),
    enrich: z.boolean().default(true),
    verifyEmails: z.boolean().default(false),
    useLLMScoring: z.boolean().default(false),
    ollamaModel: z.string().default('llama3.1'),
    rpm: z.number().int().min(1).max(60).optional().default(20),
    headless: z.boolean().default(true),
    minRating: z.number().min(0).max(5).optional(),
    userAgent: z.string().optional(),
    proxy: z.union([z.string(), z.array(z.string())]).optional(),
    googleSheets: z
      .object({
        spreadsheetId: z.string().optional(),
        sheetName: z.string().default('Leads'),
        serviceAccountKeyPath: z.string().optional(),
      })
      .optional(),
    concurrency: z.number().int().min(1).max(6).default(3),
  })
  .passthrough();
