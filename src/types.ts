import { z } from 'zod';

export interface Lead {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  source: ScrapeSource;
  category?: string;
  location?: string;
  scrapedAt?: string;
  relevanceScore?: number;
  budgetScore?: number;
  scoringNotes?: string;
  emailVerified?: boolean;
}

export type ScrapeSource = 'maps' | 'search' | 'yelp' | 'yellowpages' | 'crunchbase';

export type ExportFormat = 'csv' | 'json' | 'xlsx';

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
  rpm?: number;
  headless?: boolean;
  minRating?: number;
  userAgent?: string;
  proxy?: string | string[];
  googleSheets?: Partial<GoogleSheetsOptions>;
  concurrency?: number;
  [key: string]: any;
}

export const ScrapeOptionsSchema = z
  .object({
    source: z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']).default('maps'),
    category: z.string().optional(),
    location: z.string().optional(),
    limit: z.number().min(1).max(500).default(25),
    enrich: z.boolean().default(true),
    verifyEmails: z.boolean().default(false),
    useLLMScoring: z.boolean().default(false),
    ollamaModel: z.string().default('llama3.1'),
    rpm: z.number().min(1).max(60).default(20),
    headless: z.boolean().default(true),
    minRating: z.number().min(0).max(5).optional(),
    userAgent: z.string().optional(),
    proxy: z.union([z.string(), z.array(z.string())]).optional(),
    googleSheets: z
      .object({
        spreadsheetId: z.string(),
        sheetName: z.string().default('Leads'),
        serviceAccountKeyPath: z.string().optional(),
      })
      .optional(),
    concurrency: z.number().int().min(1).max(6).default(3),
  })
  .passthrough();

export function inferFormatFromPath(filepath: string): ExportFormat {
  const ext = filepath.toLowerCase().split('.').pop();
  if (ext === 'json') return 'json';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  return 'csv';
}

export type ConfigOptions = Partial<ScrapeOptions>;
