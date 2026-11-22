import { type Lead, type ScrapeOptions, ScrapeOptionsSchema, type ExportFormat, type ScrapeSource, inferFormatFromPath } from './types.js';
import { scrapeGoogleMaps } from './scrapers/maps.js';
import { scrapeGoogleSearch } from './scrapers/search.js';
import { scrapeYelp as scrapeYelpInternal } from './scrapers/yelp.js';
import { scrapeYellowPages as scrapeYellowPagesInternal } from './scrapers/yellowpages.js';
import { scrapeCrunchbase as scrapeCrunchbaseInternal } from './scrapers/crunchbase.js';
import { enrichLead, isDisposableEmail, scoreLeadWithOllama } from './enricher.js';
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
 * Processes an array of items with limited concurrency.
 * This respects the concurrency option and uses randomDelay between batches for politeness.
 * Used for parallel enrichment and LLM scoring.
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 3
): Promise<R[]> {
  if (concurrency < 1) concurrency = 1;
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((item) => processor(item))
    );
    results.push(...batchResults);
    if (i + concurrency < items.length) {
      await randomDelay(250, 650);
    }
  }
  return results;
}

/**
 * Scrapes leads from Google Maps.
 */
export async function scrapeMaps(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'maps' as const,
    category,
    location,
    limit: 25,
    rpm: 20,
    concurrency: 3,
    enrich: true,
    ...options,
  } as ScrapeOptions);

  await setProxies(opts.proxy);

  const scrapeOperation = () => scrapeGoogleMaps(category, location, opts);
  const rateLimitedScrape = withRateLimit(scrapeOperation, opts.rpm);
  let leads = await rateLimitedScrape();

  if (opts.enrich !== false) {
    leads = await processWithConcurrency(
      leads,
      async (lead) => enrichLead(lead, opts.verifyEmails ?? false),
      opts.concurrency
    );
  }

  if (opts.useLLMScoring) {
    leads = await processWithConcurrency(
      leads,
      async (lead) => scoreLeadWithOllama(lead, category, opts.ollamaModel ?? 'llama3.1'),
      opts.concurrency
    );
  }

  leads = deduplicateLeads(leads);
  return leads.slice(0, opts.limit);
}

/**
 * Scrapes leads from Google organic search results.
 */
export async function scrapeSearch(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'search' as const,
    category: query,
    limit: 25,
    rpm: 20,
    concurrency: 3,
    enrich: true,
    ...options,
  } as ScrapeOptions);

  await setProxies(opts.proxy);

  const scrapeOperation = () => scrapeGoogleSearch(query, opts);
  const rateLimitedScrape = withRateLimit(scrapeOperation, opts.rpm);
  let leads = await rateLimitedScrape();

  if (opts.enrich !== false) {
    leads = await processWithConcurrency(
      leads,
      async (lead) => enrichLead(lead, opts.verifyEmails ?? false),
      opts.concurrency
    );
  }

  if (opts.useLLMScoring) {
    leads = await processWithConcurrency(
      leads,
      async (lead) => scoreLeadWithOllama(lead, query, opts.ollamaModel ?? 'llama3.1'),
      opts.concurrency
    );
  }

  leads = deduplicateLeads(leads);
  return leads.slice(0, opts.limit);
}

/**
 * Scrapes leads from Yelp.
 */
export async function scrapeYelp(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'yelp' as const,
    category,
    location,
    limit: 25,
    rpm: 20,
    concurrency: 3,
    enrich: false,
    ...options,
  } as ScrapeOptions);

  await setProxies(opts.proxy);

  const scrapeOperation = () => scrapeYelpInternal(category, location, opts);
  const rateLimitedScrape = withRateLimit(scrapeOperation, opts.rpm);
  let leads = await rateLimitedScrape();

  if (opts.enrich) {
    leads = await processWithConcurrency(
      leads,
      async (lead) => enrichLead(lead, opts.verifyEmails ?? false),
      opts.concurrency
    );
  }

  if (opts.useLLMScoring) {
    leads = await processWithConcurrency(
      leads,
      async (lead) => scoreLeadWithOllama(lead, category, opts.ollamaModel ?? 'llama3.1'),
      opts.concurrency
    );
  }

  leads = deduplicateLeads(leads);
  return leads.slice(0, opts.limit);
}

/**
 * Scrapes leads from YellowPages.
 */
export async function scrapeYellowPages(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'yellowpages' as const,
    category,
    location,
    limit: 25,
    rpm: 20,
    concurrency: 3,
    enrich: true,
    ...options,
  } as ScrapeOptions);

  await setProxies(opts.proxy);

  const scrapeOperation = () => scrapeYellowPagesInternal(category, location, opts);
  const rateLimitedScrape = withRateLimit(scrapeOperation, opts.rpm);
  let leads = await rateLimitedScrape();

  if (opts.enrich !== false) {
    leads = await processWithConcurrency(
      leads,
      async (lead) => enrichLead(lead, opts.verifyEmails ?? false),
      opts.concurrency
    );
  }

  if (opts.useLLMScoring) {
    leads = await processWithConcurrency(
      leads,
      async (lead) => scoreLeadWithOllama(lead, category, opts.ollamaModel ?? 'llama3.1'),
      opts.concurrency
    );
  }

  leads = deduplicateLeads(leads);
  return leads.slice(0, opts.limit);
}

/**
 * Scrapes leads from Crunchbase.
 */
export async function scrapeCrunchbase(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'crunchbase' as const,
    category: query,
    limit: 25,
    rpm: 20,
    concurrency: 3,
    enrich: true,
    ...options,
  } as ScrapeOptions);

  await setProxies(opts.proxy);

  const scrapeOperation = () => scrapeCrunchbaseInternal(query, opts);
  const rateLimitedScrape = withRateLimit(scrapeOperation, opts.rpm);
  let leads = await rateLimitedScrape();

  if (opts.enrich !== false) {
    leads = await processWithConcurrency(
      leads,
      async (lead) => enrichLead(lead, opts.verifyEmails ?? false),
      opts.concurrency
    );
  }

  if (opts.useLLMScoring) {
    leads = await processWithConcurrency(
      leads,
      async (lead) => scoreLeadWithOllama(lead, query, opts.ollamaModel ?? 'llama3.1'),
      opts.concurrency
    );
  }

  leads = deduplicateLeads(leads);
  return leads.slice(0, opts.limit);
}

/**
 * Saves the leads to the specified filepath. The format is inferred from the extension.
 */
export async function saveLeads(leads: Lead[], filepath: string = 'leads.csv'): Promise<void> {
  if (!leads?.length) {
    console.warn('No leads provided to saveLeads.');
    return;
  }

  const format = inferFormatFromPath(filepath);
  await exportLeads(leads, format, filepath);
}

/**
 * Re-exported utilities and types for public API.
 */
export {
  loadConfig,
  saveConfig,
  exportToSheets,
  scoreLeadWithOllama,
  isDisposableEmail,
  randomDelay,
  CONFIG_PATH,
};

export type { Lead, ScrapeOptions, ScrapeSource, ExportFormat, GoogleSheetsOptions } from './types.js';
