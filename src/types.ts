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
}

export interface ScrapeOptions {
  source?: ScrapeSource;
  category?: string;
  location?: string;
  limit?: number;
  enrich?: boolean;
  verifyEmails?: boolean;
  headless?: boolean;
  rpm?: number;
  minRating?: number;
  userAgent?: string;
  proxy?: string | string[];
}

export type ExportFormat = 'csv' | 'json' | 'xlsx';

export type ConfigOptions = Partial<ScrapeOptions>;

export const ScrapeOptionsSchema = z
  .object({
    source: z.enum(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase']).optional(),
    category: z.string().optional(),
    location: z.string().optional(),
    limit: z.number().int().positive().optional().default(20),
    enrich: z.boolean().optional().default(true),
    verifyEmails: z.boolean().optional().default(false),
    headless: z.boolean().optional().default(true),
    rpm: z.number().int().min(1).max(60).optional().default(20),
    minRating: z.number().min(0).max(5).optional(),
    userAgent: z.string().optional(),
    proxy: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough();

export function inferFormatFromPath(filepath: string): ExportFormat {
  const lower = filepath.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  return 'csv';
}
