import { loadConfig as loadConfigFromFile, saveConfig as saveConfigToFile, CONFIG_PATH } from './config.js';
import { scrapeGoogleMaps as scrapeMapsImpl } from './scrapers/maps.js';
import { scrapeGoogleSearch as scrapeSearchImpl } from './scrapers/search.js';
import { scrapeYelp as scrapeYelpImpl } from './scrapers/yelp.js';
import { scrapeYellowPages as scrapeYellowPagesImpl } from './scrapers/yellowpages.js';
import { scrapeCrunchbase as scrapeCrunchbaseImpl } from './scrapers/crunchbase.js';
import { enrichLead } from './enricher.js';
import { scoreLeadWithOllama } from './enricher.js';
import { exportLeads, exportToSheets as exportToSheetsImpl } from './exporter.js';
import type { Lead, ScrapeOptions, ScrapeSource, ExportFormat, GoogleSheetsOptions, RateLimitOptions } from './types.js';
import { ScrapeOptionsSchema, RATE_LIMIT_PRESETS } from './types.js';
import { randomDelay, withRateLimit } from './utils/throttle.js';

export { CONFIG_PATH };
export type { Lead, ScrapeOptions, ScrapeSource, ExportFormat, GoogleSheetsOptions, RateLimitOptions };
export { withRateLimit, scoreLeadWithOllama, RATE_LIMIT_PRESETS };

/**
 * Loads and merges user configuration (~/.leadmine/config.json).
 */
export async function loadConfig(configPath: string = CONFIG_PATH): Promise<Partial<ScrapeOptions>> {
  return loadConfigFromFile(configPath);
}

/**
 * Saves a configuration object to disk (used by wizard).
 */
export async function saveConfig(config: Partial<ScrapeOptions>, configPath: string = CONFIG_PATH): Promise<void> {
  return saveConfigToFile(config, configPath);
}

/**
 * Removes duplicate leads using a composite key (name + address + website).
 */
function deduplicateLeads(leads: Lead[]): Lead[] {
  const seen = new Set<string>();
  const unique: Lead[] = [];
  for (const lead of leads) {
    const key = [
      (lead.name || '').toLowerCase().trim(),
      (lead.address || '').toLowerCase().trim(),
      (lead.website || '').toLowerCase().trim(),
    ].join('|');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(lead);
    }
  }
  return unique;
}

/**
 * Processes items with limited concurrency. Optionally wraps each processor
 * call with withRateLimit when rateLimitOpts is supplied.
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 3,
  rateLimitOpts?: RateLimitOptions
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const promises = batch.map((item) => {
      const task = () => processor(item);
      return rateLimitOpts ? withRateLimit(task, rateLimitOpts) : task();
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    if (i + concurrency < items.length) {
      await randomDelay(350, 750);
    }
  }
  return results;
}

async function applyPostProcessing(leads: Lead[], opts: ScrapeOptions): Promise<Lead[]> {
  let processed = leads;

  if (opts.enrich !== false) {
    processed = await processWithConcurrency(
      processed,
      (lead) => enrichLead(lead, !!opts.verifyEmails),
      opts.concurrency ?? 3,
      { source: 'enrich' as ScrapeSource, rpm: 8 }
    );
  }

  if (opts.useLLMScoring && opts.category) {
    processed = await processWithConcurrency(
      processed,
      (lead) => scoreLeadWithOllama(lead, opts.category!, opts.ollamaModel),
      2,
      { source: 'llm' as ScrapeSource, rpm: 6 }
    );
  }

  // Filter by minScore if LLM scoring was used and a positive threshold is configured.
  // This implements the configurable threshold from the roadmap.
  if (opts.useLLMScoring && typeof opts.minScore === 'number' && opts.minScore > 0) {
    const threshold = opts.minScore;
    const before = processed.length;
    processed = processed.filter((lead) => (lead.relevanceScore ?? 0) >= threshold);
    const filteredCount = before - processed.length;
    if (filteredCount > 0) {
      console.log(`🧹 Filtered out ${filteredCount} leads below minScore threshold (${threshold})`);
    }
  }

  return processed;
}

export async function scrapeMaps(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const merged = { source: 'maps' as const, ...options, category, location };
  const opts = ScrapeOptionsSchema.parse(merged) as ScrapeOptions;
  const rateOpts: RateLimitOptions = opts.rpm ?? { source: 'maps' as ScrapeSource, rpm: RATE_LIMIT_PRESETS.maps.rpm };

  const raw = await withRateLimit(
    () => scrapeMapsImpl(category, location, opts),
    rateOpts
  );
  let leads = await applyPostProcessing(raw, opts);
  leads = deduplicateLeads(leads);
  return leads.slice(0, opts.limit);
}

export async function scrapeSearch(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const merged = { source: 'search' as const, ...options, query };
  const opts = ScrapeOptionsSchema.parse(merged) as ScrapeOptions;
  const rateOpts: RateLimitOptions = opts.rpm ?? { source: 'search' as ScrapeSource, rpm: RATE_LIMIT_PRESETS.search.rpm };

  const raw = await withRateLimit(
    () => scrapeSearchImpl(query, opts),
    rateOpts
  );
  let leads = await applyPostProcessing(raw, opts);
  leads = deduplicateLeads(leads);
  return leads.slice(0, opts.limit);
}

export async function scrapeYelp(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const merged = { source: 'yelp' as const, enrich: false, ...options, category, location };
  const opts = ScrapeOptionsSchema.parse(merged) as ScrapeOptions;
  const rateOpts: RateLimitOptions = opts.rpm ?? { source: 'yelp' as ScrapeSource, rpm: RATE_LIMIT_PRESETS.yelp.rpm };

  const raw = await withRateLimit(
    () => scrapeYelpImpl(category, location, opts),
    rateOpts
  );
  let leads = await applyPostProcessing(raw, opts);
  leads = deduplicateLeads(leads);
  return leads.slice(0, opts.limit);
}

export async function scrapeYellowPages(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const merged = { source: 'yellowpages' as const, ...options, category, location };
  const opts = ScrapeOptionsSchema.parse(merged) as ScrapeOptions;
  const rateOpts: RateLimitOptions = opts.rpm ?? { source: 'yellowpages' as ScrapeSource, rpm: RATE_LIMIT_PRESETS.yellowpages.rpm };

  const raw = await withRateLimit(
    () => scrapeYellowPagesImpl(category, location, opts),
    rateOpts
  );
  let leads = await applyPostProcessing(raw, opts);
  leads = deduplicateLeads(leads);
  return leads.slice(0, opts.limit);
}

export async function scrapeCrunchbase(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const merged = { source: 'crunchbase' as const, ...options, query };
  const opts = ScrapeOptionsSchema.parse(merged) as ScrapeOptions;
  const rateOpts: RateLimitOptions = opts.rpm ?? { source: 'crunchbase' as ScrapeSource, rpm: RATE_LIMIT_PRESETS.crunchbase.rpm };

  const raw = await withRateLimit(
    () => scrapeCrunchbaseImpl(query, opts),
    rateOpts
  );
  let leads = await applyPostProcessing(raw, opts);
  leads = deduplicateLeads(leads);
  return leads.slice(0, opts.limit);
}

/**
 * Writes leads to disk in the format implied by the filepath extension.
 */
export async function saveLeads(
  leads: Lead[],
  filepath: string = 'leads.csv',
  append: boolean = false
): Promise<void> {
  if (!leads || leads.length === 0) {
    console.warn('No leads to save.');
    return;
  }
  let format: ExportFormat = 'csv';
  const lower = filepath.toLowerCase();
  if (lower.endsWith('.json')) format = 'json';
  else if (lower.endsWith('.xlsx')) format = 'xlsx';
  else if (lower.endsWith('.html')) format = 'html';
  else if (lower.includes('hubspot')) format = 'hubspot';
  else if (lower.includes('salesforce')) format = 'salesforce';

  await exportLeads(leads, format, filepath, append);
}

export const exportToSheets = exportToSheetsImpl;
