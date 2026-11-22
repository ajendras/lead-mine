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
 * Processes an array of items with limited concurrency.
 * Respects the concurrency option (default 3) and adds polite delays between batches.
 * Used for parallel enrichment and LLM scoring steps. Integrates with the rate limiter
 * indirectly via randomDelay to keep the scraper polite.
 */
export async function processWithConcurrency<T, R = T>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number | undefined = 3
): Promise<R[]> {
  const limit = Math.max(1, concurrency || 3);
  const results: R[] = [];

  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          return await processor(item);
        } catch (err) {
          console.warn(`Processor error for item:`, item, err);
          return item as unknown as R;
        }
      })
    );
    results.push(...batchResults);

    if (i + limit < items.length) {
      await randomDelay(650, 1650);
    }
  }

  return results;
}

/**
 * Internal helper that applies enrichment (if enabled), LLM scoring (if enabled),
 * limit slicing, and deduplication. This centralizes the post-scraping logic
 * that previously caused type mismatches with Zod's output types.
 */
async function applyPostProcessing(
  leads: Lead[],
  opts: ScrapeOptions,
  targetCategory: string
): Promise<Lead[]> {
  let processed = leads.slice(0, opts.limit || 20);

  if (opts.enrich) {
    processed = await processWithConcurrency(
      processed,
      (lead: Lead) => enrichLead(lead, !!opts.verifyEmails),
      opts.concurrency
    );
  }

  if (opts.useLLMScoring) {
    processed = await processWithConcurrency(
      processed,
      (lead: Lead) =>
        scoreLeadWithOllama(lead, targetCategory, opts.ollamaModel || 'llama3.1'),
      opts.concurrency
    );
  }

  return deduplicateLeads(processed);
}

export async function scrapeMaps(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'maps',
    category,
    location,
    ...options,
  }) as ScrapeOptions;

  if (opts.proxy) {
    const proxyList = Array.isArray(opts.proxy) ? opts.proxy : [opts.proxy];
    setProxies(proxyList);
  }

  const scrape = withRateLimit(
    () => scrapeGoogleMaps(category, location, opts),
    opts.rpm
  );

  let leads = await scrape();
  leads = await applyPostProcessing(leads, opts, category);
  return leads;
}

export async function scrapeSearch(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'search',
    query,
    category: options.category || query,
    ...options,
  }) as ScrapeOptions;

  if (opts.proxy) {
    const proxyList = Array.isArray(opts.proxy) ? opts.proxy : [opts.proxy];
    setProxies(proxyList);
  }

  const scrape = withRateLimit(
    () => scrapeGoogleSearch(query, opts),
    opts.rpm
  );

  let leads = await scrape();
  const targetCategory = opts.category || query;
  leads = await applyPostProcessing(leads, opts, targetCategory);
  return leads;
}

export async function scrapeYelp(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'yelp',
    category,
    location,
    enrich: options.enrich !== undefined ? options.enrich : false,
    ...options,
  }) as ScrapeOptions;

  if (opts.proxy) {
    const proxyList = Array.isArray(opts.proxy) ? opts.proxy : [opts.proxy];
    setProxies(proxyList);
  }

  const scrape = withRateLimit(
    () => scrapeYelpInternal(category, location, opts),
    opts.rpm
  );

  let leads = await scrape();
  leads = await applyPostProcessing(leads, opts, category);
  return leads;
}

export async function scrapeYellowPages(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'yellowpages',
    category,
    location,
    ...options,
  }) as ScrapeOptions;

  if (opts.proxy) {
    const proxyList = Array.isArray(opts.proxy) ? opts.proxy : [opts.proxy];
    setProxies(proxyList);
  }

  const scrape = withRateLimit(
    () => scrapeYellowPagesInternal(category, location, opts),
    opts.rpm
  );

  let leads = await scrape();
  leads = await applyPostProcessing(leads, opts, category);
  return leads;
}

export async function scrapeCrunchbase(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({
    source: 'crunchbase',
    query,
    category: options.category || query,
    ...options,
  }) as ScrapeOptions;

  if (opts.proxy) {
    const proxyList = Array.isArray(opts.proxy) ? opts.proxy : [opts.proxy];
    setProxies(proxyList);
  }

  const scrape = withRateLimit(
    () => scrapeCrunchbaseInternal(query, opts),
    opts.rpm
  );

  let leads = await scrape();
  const targetCategory = opts.category || query;
  leads = await applyPostProcessing(leads, opts, targetCategory);
  return leads;
}

export async function saveLeads(
  leads: Lead[],
  filepath: string = 'leads.csv'
): Promise<void> {
  if (!leads?.length) {
    console.warn('⚠️  No leads to export.');
    return;
  }

  const format = inferFormatFromPath(filepath);
  await exportLeads(leads, format, filepath);
  console.log(`✅ Saved ${leads.length} leads to ${filepath}`);
}

/**
 * Public API re-exports (consistent with prior barrel style and README usage).
 */
export {
  loadConfig,
  saveConfig,
  CONFIG_PATH,
};
export { enrichLead, scoreLeadWithOllama } from './enricher.js';
export { isDisposableEmail } from './enricher.js';
export { exportLeads, exportToSheets } from './exporter.js';
export { withRateLimit, randomDelay } from './utils/throttle.js';
export { processWithConcurrency };
export type { Lead, ScrapeOptions, ExportFormat, ScrapeSource } from './types.js';
