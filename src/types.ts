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

const ScrapeOptionsSchema = z.object({
  source: z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']).optional().default('maps'),
  category: z.string().optional(),
  location: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().int().positive().default(20),
  enrich: z.boolean().default(true),
  verifyEmails: z.boolean().default(false),
  useLLMScoring: z.boolean().default(false),
  ollamaModel: z.string().default('llama3.1'),
  headless: z.boolean().default(true),
  minRating: z.number().min(0).max(5).optional(),
  rpm: z.number().int().positive().optional(),
  proxy: z.union([z.string(), z.array(z.string())]).optional(),
  concurrency: z.number().int().min(1).max(6).default(3),
  googleSheets: z.object({
    spreadsheetId: z.string().optional(),
    sheetName: z.string().optional(),
    serviceAccountKeyPath: z.string().optional(),
  }).optional(),
  append: z.boolean().default(false),
}).passthrough();

export { ScrapeOptionsSchema };
export type ScrapeOptions = z.infer<typeof ScrapeOptionsSchema>;
