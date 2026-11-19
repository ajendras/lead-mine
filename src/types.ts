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
}

export type ScrapeSource = 'maps' | 'search' | 'yelp' | 'yellowpages' | 'crunchbase';

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
  headless?: boolean;
  rpm?: number;
  minRating?: number;
  userAgent?: string;
  proxy?: string | string[];
  output?: string;
  googleSheets?: GoogleSheetsOptions;
}

const BaseScrapeOptionsSchema = z.object({
  source: z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']).optional().default('maps' as ScrapeSource),
  category: z.string().optional(),
  location: z.string().optional(),
  query: z.string().optional(),
  limit: z.preprocess((val) => (typeof val === 'string' ? parseInt(val as string, 10) : val), z.number().min(1).max(500).default(20)),
  enrich: z.boolean().optional().default(true),
  verifyEmails: z.boolean().optional().default(false),
  headless: z.boolean().optional().default(true),
  rpm: z.number().min(5).max(60).optional().default(20),
  minRating: z.number().min(0).max(5).optional(),
  userAgent: z.string().optional(),
  proxy: z.union([z.string(), z.array(z.string())]).optional(),
  output: z.string().optional().default('leads.csv'),
  googleSheets: z
    .object({
      spreadsheetId: z.string().min(5),
      sheetName: z.string().optional().default('Leads'),
      serviceAccountKeyPath: z.string().optional(),
    })
    .optional(),
});

export const ScrapeOptionsSchema = BaseScrapeOptionsSchema.passthrough();

export type ExportFormat = 'csv' | 'json' | 'xlsx';

export function inferFormatFromPath(filepath: string): ExportFormat {
  if (!filepath) return 'csv';
  const lower = filepath.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  return 'csv';
}

export type ConfigOptions = Partial<ScrapeOptions>;
