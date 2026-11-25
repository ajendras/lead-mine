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
  relevanceScore?: number;
  budgetScore?: number;
  scoringNotes?: string;
  emailVerified?: boolean;
  scrapedAt?: string;
  description?: string;
  category?: string;
  location?: string;
  foundedYear?: number;
}

export interface GoogleSheetsOptions {
  spreadsheetId?: string;
  sheetName?: string;
  serviceAccountKeyPath?: string;
}

export type ExportFormat =
  | 'csv'
  | 'json'
  | 'xlsx'
  | 'html'
  | 'hubspot'
  | 'salesforce';

export type RateLimitOptions =
  | number
  | {
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
  enrich: { rpm: 8 },
  llm: { rpm: 6 },
} as const;

const sourceEnum = z.enum([
  'maps',
  'search',
  'yelp',
  'yellowpages',
  'crunchbase',
]);

export const ScrapeOptionsSchema = z
  .object({
    source: sourceEnum.default('maps'),
    category: z.string().optional(),
    location: z.string().optional(),
    query: z.string().optional(),
    limit: z.number().int().positive().default(20),
    enrich: z.boolean().default(true),
    verifyEmails: z.boolean().default(false),
    useLLMScoring: z.boolean().default(false),
    ollamaModel: z.string().default('llama3.1'),
    headless: z.boolean().default(true),
    rpm: z.number().int().positive().optional(),
    minRating: z.number().min(0).max(5).optional(),
    minScore: z.number().min(0).max(10).default(0),
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
    append: z.boolean().default(false),
  })
  .passthrough();

export type ScrapeOptions = z.infer<typeof ScrapeOptionsSchema>;
