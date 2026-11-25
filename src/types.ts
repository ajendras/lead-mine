import { z } from 'zod';

export type ScrapeSource = 'maps' | 'search' | 'yelp' | 'yellowpages' | 'crunchbase';

export interface Lead {
  name: string;
  website?: string;
  email?: string;
  phone?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  source?: ScrapeSource;
  relevanceScore?: number;
  budgetScore?: number;
  scoringNotes?: string;
  emailVerified?: boolean;
  scrapedAt?: string;
}

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
  minScore?: number;
  userAgent?: string;
  proxy?: string | string[];
  googleSheets?: GoogleSheetsOptions;
  concurrency?: number;
  append?: boolean;
}

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'html' | 'hubspot' | 'salesforce';

export type RateLimitOptions = number | {
  rpm?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  source?: ScrapeSource;
};

export const RATE_LIMIT_PRESETS = {
  maps: { rpm: 6 },
  search: { rpm: 10 },
  yelp: { rpm: 15 },
  yellowpages: { rpm: 25 },
  crunchbase: { rpm: 12 },
} as const;

export const ScrapeSourceSchema = z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']);

export const ScrapeOptionsSchema = z.object({
  source: ScrapeSourceSchema.optional(),
  category: z.string().optional(),
  location: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().min(1).optional(),
  enrich: z.boolean().optional(),
  verifyEmails: z.boolean().optional(),
  useLLMScoring: z.boolean().optional(),
  ollamaModel: z.string().optional(),
  headless: z.boolean().optional(),
  rpm: z.number().min(1).optional(),
  minRating: z.number().min(0).max(5).optional(),
  minScore: z.number().min(0).max(10).optional(),
  userAgent: z.string().optional(),
  proxy: z.union([z.string(), z.array(z.string())]).optional(),
  googleSheets: z.object({
    spreadsheetId: z.string().optional(),
    sheetName: z.string().optional(),
    serviceAccountKeyPath: z.string().optional(),
  }).optional(),
  concurrency: z.number().min(1).max(6).optional(),
  append: z.boolean().optional(),
}).passthrough();
