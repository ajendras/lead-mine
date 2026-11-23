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
  source?: ScrapeSource;
  profileUrl?: string;
}

export interface GoogleSheetsOptions {
  spreadsheetId?: string;
  sheetName?: string;
  serviceAccountKeyPath?: string;
}

export interface ScrapeOptions {
  source: ScrapeSource;
  category?: string;
  location?: string;
  query?: string;
  limit: number;
  enrich: boolean;
  verifyEmails: boolean;
  useLLMScoring: boolean;
  ollamaModel: string;
  headless: boolean;
  rpm: number;
  minRating?: number;
  userAgent?: string;
  proxy?: string | string[];
  googleSheets?: GoogleSheetsOptions;
  concurrency: number;
}

export const ScrapeOptionsSchema = z
  .object({
    source: z
      .enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase'])
      .default('maps'),
    category: z.string().optional(),
    location: z.string().optional(),
    query: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(25),
    enrich: z.boolean().default(true),
    verifyEmails: z.boolean().default(false),
    useLLMScoring: z.boolean().default(false),
    ollamaModel: z.string().default('llama3.1'),
    headless: z.boolean().default(true),
    rpm: z.number().default(20),
    minRating: z.number().min(0).max(5).optional(),
    userAgent: z.string().optional(),
    proxy: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .default([]),
    googleSheets: z
      .object({
        spreadsheetId: z.string().optional(),
        sheetName: z.string().default('Leads'),
        serviceAccountKeyPath: z.string().optional(),
      })
      .optional()
      .default({}),
    concurrency: z.number().min(1).max(6).default(3),
  })
  .passthrough();

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'html' | 'hubspot' | 'salesforce';
