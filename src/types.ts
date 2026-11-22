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
  emailVerified?: boolean;
  relevanceScore?: number;
  budgetScore?: number;
  scoringNotes?: string;
}

export type ScrapeSource = 'maps' | 'search' | 'yelp' | 'yellowpages' | 'crunchbase';

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'html' | 'hubspot' | 'salesforce';

export interface GoogleSheetsOptions {
  spreadsheetId: string;
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
  googleSheets?: Omit<GoogleSheetsOptions, 'spreadsheetId'> & { spreadsheetId?: string };
  concurrency?: number;
}

export const ScrapeOptionsSchema = z
  .object({
    source: z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']).optional().default('maps'),
    category: z.string().optional(),
    location: z.string().optional(),
    query: z.string().optional(),
    limit: z.number().int().positive().default(20),
    enrich: z.boolean().default(true),
    verifyEmails: z.boolean().default(false),
    useLLMScoring: z.boolean().default(false),
    ollamaModel: z.string().default('llama3.1'),
    rpm: z.number().int().positive().default(20),
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

export function inferFormatFromPath(filepath: string): ExportFormat {
  const lower = filepath.toLowerCase();
  if (lower.includes('hubspot')) return 'hubspot';
  if (lower.includes('salesforce')) return 'salesforce';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.html')) return 'html';
  return 'csv';
}
