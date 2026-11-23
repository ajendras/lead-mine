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
  minRating?: number;
  rpm?: number;
  proxy?: string | string[];
  concurrency?: number;
  userAgent?: string;
  googleSheets?: GoogleSheetsOptions;
}

export const ScrapeOptionsSchema = z
  .object({
    source: z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']).optional(),
    category: z.string().optional(),
    location: z.string().optional(),
    query: z.string().optional(),
    limit: z.coerce.number().min(1).max(200).default(20),
    enrich: z.boolean().default(true),
    verifyEmails: z.boolean().default(false),
    useLLMScoring: z.boolean().default(false),
    ollamaModel: z.string().default('llama3.1'),
    headless: z.boolean().default(true),
    minRating: z.number().min(0).max(5).optional(),
    rpm: z.number().int().min(1).max(60).optional(),
    proxy: z.union([z.string(), z.array(z.string())]).optional(),
    concurrency: z.number().int().min(1).max(6).default(3),
    userAgent: z.string().optional(),
    googleSheets: z
      .object({
        spreadsheetId: z.string().optional(),
        sheetName: z.string().default('Leads'),
        serviceAccountKeyPath: z.string().optional(),
      })
      .optional()
      .default({}),
  })
  .passthrough();

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'html' | 'hubspot' | 'salesforce';

export type RateLimitOptions = number | { rpm?: number; source?: ScrapeSource };

export const RATE_LIMIT_PRESETS = {
  maps: { rpm: 6, source: 'maps' as const },
  search: { rpm: 10, source: 'search' as const },
  yelp: { rpm: 15, source: 'yelp' as const },
  yellowpages: { rpm: 25, source: 'yellowpages' as const },
  crunchbase: { rpm: 12, source: 'crunchbase' as const },
} as const;
