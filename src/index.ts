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
 * Wraps the processor with rate limiting and executes in batches.
 * This is the internal utility tested by scrapers.test.ts.
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  limit: number = 3
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = [];
  const rateLimitedProcessor = withRateLimit(processor);

  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchPromises = batch.map((item) => rateLimitedProcessor(item));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    if (i + limit < items.length) {
      await randomDelay(400, 900);
    }
  }

  return results;
}

/**
 * Applies deduplication, enrichment, LLM scoring and final limit.
 * Uses processWithConcurrency for parallel execution where enabled.
 */
async function postProcessLeads(leads: Lead[], options: ScrapeOptions): Promise<Lead[]> {
  let processed = deduplicateLeads(leads);

  if (options.enrich !== false && processed.length > 0) {
    const enriched = await processWithConcurrency(
      processed,
      (lead) => enrichLead(lead, options.verifyEmails ?? false),
      options.concurrency ?? 3
    );
    processed = enriched;
  }

  if (options.useLLMScoring && processed.length > 0) {
    const scored = await processWithConcurrency(
      processed,
      (lead) => scoreLeadWithOllama(lead, options.category || options.query || 'business', options.ollamaModel),
      2
    );
    processed = scored;
  }

  return processed.slice(0, options.limit ?? 20);
}

// Public scraper API wrappers (apply config, proxies, post-processing, deduplication)
export async function scrapeMaps(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'maps' as const,
    category,
    location,
    ...options,
  });

  await setProxies(opts.proxy);

  let leads = await scrapeGoogleMaps(category, location, opts);
  leads = await postProcessLeads(leads, opts);
  return leads;
}

export async function scrapeSearch(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'search' as const,
    query,
    ...options,
  });

  await setProxies(opts.proxy);

  let leads = await scrapeGoogleSearch(query, opts);
  leads = await postProcessLeads(leads, opts);
  return leads;
}

export async function scrapeYelp(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'yelp' as const,
    category,
    location,
    ...options,
  });

  await setProxies(opts.proxy);

  let leads = await scrapeYelpInternal(category, location, opts);
  leads = await postProcessLeads(leads, opts);
  return leads;
}

export async function scrapeYellowPages(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'yellowpages' as const,
    category,
    location,
    ...options,
  });

  await setProxies(opts.proxy);

  let leads = await scrapeYellowPagesInternal(category, location, opts);
  leads = await postProcessLeads(leads, opts);
  return leads;
}

export async function scrapeCrunchbase(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'crunchbase' as const,
    query,
    ...options,
  });

  await setProxies(opts.proxy);

  let leads = await scrapeCrunchbaseInternal(query, opts);
  leads = await postProcessLeads(leads, opts);
  return leads;
}

// Re-exports for public API (matches README examples, CLI usage, and test expectations)
export {
  loadConfig,
  saveConfig,
  CONFIG_PATH,
  enrichLead,
  isDisposableEmail,
  scoreLeadWithOllama,
  exportLeads,
  exportToSheets,
  withRateLimit,
  randomDelay,
  setProxies,
  processWithConcurrency,
  deduplicateLeads,
};

export type { Lead, ScrapeOptions, ScrapeSource, ExportFormat, GoogleSheetsOptions } from './types.js';
export { ScrapeOptionsSchema };
