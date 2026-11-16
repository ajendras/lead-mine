import { z } from 'zod';

/**
 * Standardized business lead record returned by all scrapers and the enricher.
 * Fields are optional where the source may not provide them.
 */
export interface Lead {
  /** Business or organization name (always present) */
  name: string;
  /** Full street address with city, state and ZIP if available */
  address?: string;
  /** Primary contact phone number */
  phone?: string;
  /** Official website URL */
  website?: string;
  /** Email address (often populated by the enricher) */
  email?: string;
  /** Average rating (usually 1.0-5.0) */
  rating?: number;
  /** Total number of reviews the rating is based on */
  reviewCount?: number;
  /** Platform the lead was scraped from */
  source: 'maps' | 'search' | 'yelp';
  /** Category/keyword used during the search */
  category?: string;
  /** Geographic location used for the search */
  location?: string;
  /** ISO 8601 timestamp when the lead was captured */
  scrapedAt: string;
}

/**
 * Configuration options shared by scrapeMaps, scrapeSearch and scrapeYelp.
 */
export interface ScrapeOptions {
  /** Maximum number of leads to return (default: 20) */
  limit?: number;
  /** Run browser without UI (default: true) */
  headless?: boolean;
  /** Only keep leads with this rating or higher */
  minRating?: number;
  /** Visit each website to discover emails and social links (default: true) */
  enrich?: boolean;
  /** Custom User-Agent header */
  userAgent?: string;
  /** Maximum requests per minute (politeness control, default: 20) */
  rpm?: number;
  /**
   * Proxy server URL (string) or list of URLs for automatic rotation.
   * Format: http[s]://[user:pass@]host:port or socks5://...
   * For residential proxies supply your provider's rotating gateway URL
   * (e.g. http://user-zone-residential:pass@gate.smartproxy.com:7000).
   * The proxy rotator in browser.ts cycles through the list on each
   * browser launch.
   */
  proxy?: string | string[];
}

/**
 * Supported output formats for exported lead files.
 */
export type ExportFormat = 'csv' | 'json' | 'xlsx';

/**
 * Supported scraping sources.
 */
export type ScrapeSource = 'maps' | 'search' | 'yelp';

/**
 * User configuration shape (all ScrapeOptions fields are optional).
 */
export type ConfigOptions = Partial<ScrapeOptions>;

/**
 * Zod schema for runtime validation of scrape options.
 * Provides clear error messages for invalid configurations.
 */
export const ScrapeOptionsSchema = z
  .object({
    limit: z.number().int().min(1).max(200).default(20),
    headless: z.boolean().default(true),
    minRating: z.number().min(0).max(5).optional(),
    enrich: z.boolean().default(true),
    userAgent: z.string().optional(),
    rpm: z.number().int().min(1).max(60).default(20),
    proxy: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough();

/**
 * Infers export format from a file extension. Falls back to CSV.
 */
export function inferFormatFromPath(filepath: string): ExportFormat {
  const lower = filepath.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  return 'csv';
}
