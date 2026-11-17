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
  scrapedAt: string;
  emailVerified?: boolean;
}

export interface ScrapeOptions {
  limit?: number;
  enrich?: boolean;
  headless?: boolean;
  rpm?: number;
  minRating?: number;
  userAgent?: string;
  proxy?: string | string[];
  verifyEmails?: boolean;
}

export const ScrapeOptionsSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20),
    enrich: z.boolean().default(true),
    headless: z.boolean().default(true),
    rpm: z.number().int().min(1).max(60).default(20),
    minRating: z.number().min(0).max(5).optional(),
    userAgent: z.string().optional(),
    proxy: z.union([z.string(), z.array(z.string())]).optional(),
    verifyEmails: z.boolean().default(false),
  })
  .passthrough();

export type ConfigOptions = Partial<ScrapeOptions>;

export type ExportFormat = 'csv' | 'json' | 'xlsx';

export function inferFormatFromPath(filepath: string): ExportFormat {
  const ext = filepath.toLowerCase().split('.').pop();
  if (ext === 'json') return 'json';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  return 'csv';
}
