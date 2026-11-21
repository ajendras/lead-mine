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
 * Uses simple batching to respect the concurrency limit and inserts polite random delays
 * between batches. Called by enrichment and LLM scoring steps (as exercised by tests).
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number | undefined = 3
): Promise<R[]> {
  if (!items.length) return [];

  const limit = Math.max(1, concurrency ?? 3);
  const results: R[] = [];

  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map((item) => processor(item)));
    results.push(...batchResults);

    // polite delay between batches (skipped after final batch)
    if (i + limit < items.length) {
      await randomDelay(900, 1700);
    }
  }

  return results;
}

/**
 * Common post-processing pipeline: deduplication + optional enrichment + optional LLM scoring.
 * Uses the corrected `opts.concurrency` value so TS is happy with the Zod-parsed options object.
 */
async function postProcessLeads(
  leads: Lead[],
  opts: ScrapeOptions,
  targetCategory: string
): Promise<Lead[]> {
  let processed = deduplicateLeads(leads);

  if (opts.enrich !== false) {
    const enrichProcessor = (lead: Lead) => enrichLead(lead, !!opts.verifyEmails);
    processed = await processWithConcurrency(
      processed,
      enrichProcessor,
      opts.concurrency
    );
  }

  if (opts.useLLMScoring) {
    const scoringProcessor = (lead: Lead) =>
      scoreLeadWithOllama(lead, targetCategory, opts.ollamaModel || 'llama3.1');
    processed = await processWithConcurrency(
      processed,
      scoringProcessor,
      opts.concurrency
    );
  }

  return processed;
}

export async function scrapeMaps(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const config = await loadConfig();
  const mergedOpts = {
    ...config,
    source: 'maps' as ScrapeSource,
    category: category.trim(),
    location: location.trim(),
    ...options,
  };
  const opts = ScrapeOptionsSchema.parse(mergedOpts) as ScrapeOptions;

  if (opts.proxy) {
    const proxyList = Array.isArray(opts.proxy) ? opts.proxy : [opts.proxy];
    setProxies(proxyList);
  }

  const scrape = () => scrapeGoogleMaps(category, location, opts.limit);
  let leads = await withRateLimit(scrape, opts.rpm);
  leads = await postProcessLeads(leads, opts, category);

  return leads;
}

export async function scrapeSearch(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const config = await loadConfig();
  const mergedOpts = {
    ...config,
    source: 'search' as ScrapeSource,
    query,
    category: options.category || query,
    ...options,
  };
  const opts = ScrapeOptionsSchema.parse(mergedOpts) as ScrapeOptions;

  if (opts.proxy) {
    const proxyList = Array.isArray(opts.proxy) ? opts.proxy : [opts.proxy];
    setProxies(proxyList);
  }

  const scrape = () => scrapeGoogleSearch(query, opts.limit);
  let leads = await withRateLimit(scrape, opts.rpm);
  leads = await postProcessLeads(leads, opts, query);

  return leads;
}

export async function scrapeYelp(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const config = await loadConfig();
  const mergedOpts = {
    ...config,
    source: 'yelp' as ScrapeSource,
    category: category.trim(),
    location: location.trim(),
    enrich: options.enrich ?? false, // matches CLI default for Yelp
    ...options,
  };
  const opts = ScrapeOptionsSchema.parse(mergedOpts) as ScrapeOptions;

  if (opts.proxy) {
    const proxyList = Array.isArray(opts.proxy) ? opts.proxy : [opts.proxy];
    setProxies(proxyList);
  }

  const scrape = () => scrapeYelpInternal(category, location, opts.limit);
  let leads = await withRateLimit(scrape, opts.rpm);
  leads = await postProcessLeads(leads, opts, category);

  return leads;
}

export async function scrapeYellowPages(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const config = await loadConfig();
  const mergedOpts = {
    ...config,
    source: 'yellowpages' as ScrapeSource,
    category: category.trim(),
    location: location.trim(),
    ...options,
  };
  const opts = ScrapeOptionsSchema.parse(mergedOpts) as ScrapeOptions;

  if (opts.proxy) {
    const proxyList = Array.isArray(opts.proxy) ? opts.proxy : [opts.proxy];
    setProxies(proxyList);
  }

  const scrape = () => scrapeYellowPagesInternal(category, location, opts.limit);
  let leads = await withRateLimit(scrape, opts.rpm);
  leads = await postProcessLeads(leads, opts, category);

  return leads;
}

export async function scrapeCrunchbase(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const config = await loadConfig();
  const mergedOpts = {
    ...config,
    source: 'crunchbase' as ScrapeSource,
    query,
    category: options.category || 'startup',
    ...options,
  };
  const opts = ScrapeOptionsSchema.parse(mergedOpts) as ScrapeOptions;

  if (opts.proxy) {
    const proxyList = Array.isArray(opts.proxy) ? opts.proxy : [opts.proxy];
    setProxies(proxyList);
  }

  const scrape = () => scrapeCrunchbaseInternal(query, opts.limit);
  let leads = await withRateLimit(scrape, opts.rpm);
  leads = await postProcessLeads(leads, opts, query);

  return leads;
}

/**
 * Saves leads to disk. Infers format from file extension and delegates to exportLeads.
 * Exported so CLI and programmatic consumers (including wizard) can call leadMine.saveLeads.
 */
export async function saveLeads(leads: Lead[], filepath: string = 'leads.csv'): Promise<void> {
  if (!Array.isArray(leads) || leads.length === 0) {
    console.warn('⚠️ No leads to save.');
    return;
  }

  const format = inferFormatFromPath(filepath);
  await exportLeads(leads, format, filepath);
  console.log(`✅ Saved ${leads.length} leads to ${filepath}`);
}

/**
 * Public API re-exports (makes previously "unused" imports actually used, eliminates
 * redeclaration errors, and matches all documented usage in README and CLI).
 */
export {
  loadConfig,
  saveConfig,
  exportToSheets,
  enrichLead,
  scoreLeadWithOllama,
  isDisposableEmail,
  withRateLimit,
  randomDelay,
  CONFIG_PATH,
};

export type {
  Lead,
  ScrapeOptions,
  ExportFormat,
  ScrapeSource,
};

export { ScrapeOptionsSchema, inferFormatFromPath };
