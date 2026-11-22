import {
  type Lead,
  type ScrapeOptions,
  ScrapeOptionsSchema,
  inferFormatFromPath,
} from './types.js';
import { scrapeGoogleMaps } from './scrapers/maps.js';
import { scrapeGoogleSearch } from './scrapers/search.js';
import { scrapeYelp as scrapeYelpInternal } from './scrapers/yelp.js';
import { scrapeYellowPages as scrapeYellowPagesInternal } from './scrapers/yellowpages.js';
import { scrapeCrunchbase as scrapeCrunchbaseInternal } from './scrapers/crunchbase.js';
import { enrichLead, scoreLeadWithOllama } from './enricher.js';
import { exportLeads, exportToSheets } from './exporter.js';
import { withRateLimit, randomDelay } from './utils/throttle.js';
import { setProxies } from './utils/browser.js';
import { loadConfig, saveConfig, CONFIG_PATH } from './config.js';

/**
 * Removes duplicate leads based on a normalized key composed of name + address or website.
 * Preserves the first occurrence.
 */
function deduplicateLeads(leads: Lead[]): Lead[] {
  const seen = new Set<string>();
  const unique: Lead[] = [];

  for (const lead of leads) {
    const key = [
      (lead.name || '').toLowerCase().trim(),
      (lead.address || '').toLowerCase().trim(),
      (lead.website || '').toLowerCase().trim(),
    ]
      .filter(Boolean)
      .join('|');

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(lead);
    }
  }
  return unique;
}

/**
 * Applies enrichment, LLM scoring, deduplication and rating filters to raw leads.
 * Uses processWithConcurrency for parallel operations with rate limiting.
 */
export async function processLeads(
  rawLeads: Lead[],
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  let leads = [...rawLeads];

  const {
    enrich = true,
    verifyEmails = false,
    useLLMScoring = false,
    ollamaModel = 'llama3.1',
    concurrency = 3,
    category = '',
    rpm = 20,
    minRating,
    limit,
  } = options;

  if (options.proxy) {
    setProxies(Array.isArray(options.proxy) ? options.proxy : [options.proxy]);
  }

  if (enrich) {
    leads = await processWithConcurrency(
      leads,
      (lead) => enrichLead(lead, verifyEmails),
      concurrency,
      rpm
    );
  }

  if (useLLMScoring && category) {
    leads = await processWithConcurrency(
      leads,
      (lead) => scoreLeadWithOllama(lead, category, ollamaModel),
      Math.min(concurrency, 2),
      rpm
    );
  }

  leads = deduplicateLeads(leads);

  if (minRating !== undefined) {
    leads = leads.filter((l) => typeof l.rating !== 'number' || l.rating >= minRating);
  }

  return leads.slice(0, limit || leads.length);
}

/**
 * Processes an array of items with controlled concurrency and rate limiting.
 * Batches calls and inserts random delays between batches for polite scraping.
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 3,
  rpm: number = 20
): Promise<R[]> {
  const results: R[] = [];
  const limitedProcessor = withRateLimit(processor, rpm);

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((item) => limitedProcessor(item)));
    results.push(...batchResults);
    if (i + concurrency < items.length) {
      await randomDelay(650, 1450);
    }
  }
  return results;
}

/**
 * Public scraper for Google Maps. Returns processed, deduplicated leads.
 */
export async function scrapeMaps(
  category: string,
  location: string,
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({ ...options, category, location });
  const raw = await withRateLimit(
    () => scrapeGoogleMaps(category, location, opts),
    opts.rpm || 20
  )();
  return processLeads(raw, opts);
}

/**
 * Public scraper for Google organic search results.
 */
export async function scrapeSearch(
  query: string,
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({ ...options, query });
  const raw = await withRateLimit(
    () => scrapeGoogleSearch(query, opts),
    opts.rpm || 20
  )();
  return processLeads(raw, opts);
}

/**
 * Public scraper for Yelp.
 */
export async function scrapeYelp(
  category: string,
  location: string,
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({ ...options, category, location, enrich: options.enrich ?? false });
  const raw = await withRateLimit(
    () => scrapeYelpInternal(category, location, opts),
    opts.rpm || 20
  )();
  return processLeads(raw, opts);
}

/**
 * Public scraper for YellowPages.
 */
export async function scrapeYellowPages(
  category: string,
  location: string,
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({ ...options, category, location });
  const raw = await withRateLimit(
    () => scrapeYellowPagesInternal(category, location, opts),
    opts.rpm || 20
  )();
  return processLeads(raw, opts);
}

/**
 * Public scraper for Crunchbase.
 */
export async function scrapeCrunchbase(
  query: string,
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({ ...options, query });
  const raw = await withRateLimit(
    () => scrapeCrunchbaseInternal(query, opts),
    opts.rpm || 20
  )();
  return processLeads(raw, opts);
}

/**
 * Saves leads to disk. Format is inferred from filepath extension or special
 * filename markers (.hubspot.csv or .salesforce.csv).
 */
export async function saveLeads(leads: Lead[], filepath: string): Promise<void> {
  if (!Array.isArray(leads) || leads.length === 0) {
    console.warn('No leads to save.');
    return;
  }
  const format = inferFormatFromPath(filepath);
  await exportLeads(leads, format, filepath);
}

export {
  loadConfig,
  saveConfig,
  CONFIG_PATH,
  exportToSheets,
  scoreLeadWithOllama,
  withRateLimit,
  randomDelay,
};

export type { Lead, ScrapeOptions, ScrapeSource, ExportFormat };
