import { z } from 'zod';

export type ScrapeSource = 'maps' | 'search' | 'yelp' | 'yellowpages' | 'crunchbase';

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
  emailVerified?: boolean;
  relevanceScore?: number;
  budgetScore?: number;
  scoringNotes?: string;
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
  headless?: boolean;
  rpm?: number;
  minRating?: number;
  userAgent?: string;
  proxy?: string | string[];
  googleSheets?: GoogleSheetsOptions;
  useLLMScoring?: boolean;
  ollamaModel?: string;
}

export const ScrapeOptionsSchema = z
  .object({
    source: z
      .enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase'])
      .default('maps' as ScrapeSource),
    category: z.string().optional(),
    location: z.string().optional(),
    limit: z.preprocess(
      (val) => (typeof val === 'string' ? parseInt(val, 10) : val),
      z.number().int().min(1).max(200).default(20)
    ),
    enrich: z.boolean().default(true),
    verifyEmails: z.boolean().default(false),
    headless: z.boolean().default(true),
    rpm: z.preprocess(
      (val) => (typeof val === 'string' ? parseInt(val, 10) : val),
      z.number().int().min(5).max(60).default(20)
    ),
    minRating: z.preprocess(
      (val) => (typeof val === 'string' ? parseFloat(val as string) : val),
      z.number().min(0).max(5).optional()
    ),
    userAgent: z.string().optional(),
    proxy: z.union([z.string(), z.array(z.string())]).optional(),
    googleSheets: z
      .object({
        spreadsheetId: z.string().optional(),
        sheetName: z.string().default('Leads'),
        serviceAccountKeyPath: z.string().optional(),
      })
      .optional(),
    useLLMScoring: z.boolean().default(false),
    ollamaModel: z.string().default('llama3.1'),
  })
  .passthrough();

export type ExportFormat = 'csv' | 'json' | 'xlsx';

export function inferFormatFromPath(filepath: string): ExportFormat {
  const ext = filepath.toLowerCase().split('.').pop();
  if (ext === 'json') return 'json';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  return 'csv';
}

export type ConfigOptions = Partial<ScrapeOptions>;
