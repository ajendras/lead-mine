import { z } from 'zod';

export interface Lead {
  name: string;
  website?: string;
  email?: string;
  phone?: string;
  address?: string;
  rating?: number;
  reviewCount?: number;
  category?: string;
  location?: string;
  relevanceScore?: number;
  budgetScore?: number;
  scoringNotes?: string;
  emailVerified?: boolean;
  scrapedAt?: string;
}

export type ScrapeSource = 'maps' | 'search' | 'yelp' | 'yellowpages' | 'crunchbase';

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'html' | 'hubspot' | 'salesforce';

export interface GoogleSheetsOptions {
  spreadsheetId: string;
  sheetName?: string;
  serviceAccountKeyPath?: string;
}

export const ScrapeOptionsSchema = z
  .object({
    source: z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']).default('maps'),
    category: z.string().optional(),
    location: z.string().default('Portland, OR'),
    query: z.string().optional(),
    limit: z.number().int().positive().default(20),
    enrich: z.boolean().default(true),
    verifyEmails: z.boolean().default(false),
    useLLMScoring: z.boolean().default(false),
    ollamaModel: z.string().default('llama3.1'),
    headless: z.boolean().default(true),
    rpm: z.number().int().positive().default(20),
    minRating: z.number().min(0).max(5).optional(),
    userAgent: z.string().optional(),
    proxy: z.union([z.string(), z.array(z.string())]).optional().default([]),
    googleSheets: z
      .object({
        spreadsheetId: z.string().optional(),
        sheetName: z.string().default('Leads'),
        serviceAccountKeyPath: z.string().default('~/.leadmine/service-account.json'),
      })
      .optional()
      .default({}),
    concurrency: z.number().int().min(1).max(6).default(3),
  })
  .passthrough();

export type ScrapeOptions = z.infer<typeof ScrapeOptionsSchema>;
