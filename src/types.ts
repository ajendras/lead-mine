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

export const ScrapeOptionsSchema = z
  .object({
    source: z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']).default('maps'),
    category: z.string().optional(),
    location: z.string().optional(),
    limit: z.preprocess((val) => (typeof val === 'string' ? parseInt(val as string, 10) : val), z.number().int().min(1).max(100).default(20)),
    enrich: z.boolean().default(true),
    verifyEmails: z.boolean().default(false),
    useLLMScoring: z.boolean().default(false),
    ollamaModel: z.string().default('llama3.1'),
    rpm: z.number().int().min(1).default(20),
    headless: z.boolean().default(true),
    minRating: z.number().min(0).max(5).optional(),
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

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'html';

export function inferFormatFromPath(filepath: string): ExportFormat {
  if (!filepath) return 'csv';
  const extension = filepath.split('.').pop()?.toLowerCase();
  if (extension === 'json') return 'json';
  if (extension === 'xlsx') return 'xlsx';
  if (extension === 'html' || extension === 'htm') return 'html';
  return 'csv';
}

export type ConfigOptions = Partial<ScrapeOptions>;
