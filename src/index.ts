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
 * Removes duplicate leads using a composite key (name + website + address).
 */
function deduplicateLeads(leads: Lead[]): Lead[] {
  const seen = new Set<string>();
  const unique: Lead[] = [];
  for (const lead of leads) {
    const key = [
      (lead.name || '').toLowerCase().trim(),
      lead.website || '',
      (lead.address || '').toLowerCase().trim(),
    ].join('|');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(lead);
    }
  }
  return unique;
}

/**
 * Processes an array of items with bounded concurrency and rate limiting.
 * Uses per-source presets (see RATE_LIMIT_PRESETS) and exponential backoff
 * when rate-limit or block errors are detected.
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 3,
  rateLimit: RateLimitOptions = 20
): Promise<R[]> {
  if (!items.length) return [];

  const rateLimitedProcessor = withRateLimit(processor, rateLimit);
  const results: R[] = [];
  const limit = Math.max(1, Math.min(concurrency, 6));

  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(
      batch.map((item) => rateLimitedProcessor(item))
    );
    results.push(...batchResults);

    if (i + limit < items.length) {
      await randomDelay(350, 750);
    }
  }

  return results;
}

/**
 * Scrape Google Maps with post-processing (dedup, enrich, score).
 */
export async function scrapeMaps(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({ 
    ...options, 
    source: 'maps', 
    category, 
    location 
  }) as ScrapeOptions;
  console.log(`🗺️ Scraping Google Maps for "${category}" in "${location}"...`);

  let leads = await scrapeMapsImpl(category, location, opts.limit);

  leads = deduplicateLeads(leads);
  if (opts.minRating !== undefined) {
    leads = leads.filter((l: Lead) => !l.rating || l.rating >= opts.minRating!);
  }

  const rateLimitOpts: RateLimitOptions = options.rpm !== undefined 
    ? options.rpm 
    : { source: opts.source };

  if (opts.enrich) {
    console.log(`🔧 Enriching ${leads.length} leads (concurrency=${opts.concurrency})...`);
    leads = await processWithConcurrency(
      leads,
      (lead: Lead) => enrichLead(lead, opts.verifyEmails),
      opts.concurrency,
      rateLimitOpts
    );
  }

  if (opts.useLLMScoring && opts.category) {
    console.log(`🧠 Scoring leads with Ollama (${opts.ollamaModel})...`);
    leads = await processWithConcurrency(
      leads,
      (lead: Lead) => scoreLeadWithOllama(lead, opts.category!, opts.ollamaModel),
      opts.concurrency,
      rateLimitOpts
    );
  }

  return leads;
}

/**
 * Scrape organic Google search results.
 */
export async function scrapeSearch(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({ 
    ...options, 
    source: 'search', 
    query 
  }) as ScrapeOptions;
  console.log(`🔎 Searching Google for "${query}"...`);

  let leads = await scrapeSearchImpl(query, opts.limit);

  leads = deduplicateLeads(leads);

  const rateLimitOpts: RateLimitOptions = options.rpm !== undefined 
    ? options.rpm 
    : { source: opts.source };

  if (opts.enrich !== false) {
    leads = await processWithConcurrency(
      leads,
      (lead: Lead) => enrichLead(lead, opts.verifyEmails),
      opts.concurrency,
      rateLimitOpts
    );
  }

  if (opts.useLLMScoring) {
    leads = await processWithConcurrency(
      leads,
      (lead: Lead) => scoreLeadWithOllama(lead, opts.category || query, opts.ollamaModel),
      opts.concurrency,
      rateLimitOpts
    );
  }

  return leads;
}

/**
 * Scrape Yelp listings.
 */
export async function scrapeYelp(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({ 
    ...options, 
    source: 'yelp', 
    category, 
    location 
  }) as ScrapeOptions;
  console.log(`📍 Scraping Yelp for "${category}" near "${location}"...`);

  let leads = await scrapeYelpImpl(category, location, opts.limit);

  leads = deduplicateLeads(leads);

  const rateLimitOpts: RateLimitOptions = options.rpm !== undefined 
    ? options.rpm 
    : { source: opts.source };

  if (opts.enrich !== false) {
    leads = await processWithConcurrency(
      leads,
      (lead: Lead) => enrichLead(lead, opts.verifyEmails),
      opts.concurrency,
      rateLimitOpts
    );
  }

  if (opts.useLLMScoring) {
    leads = await processWithConcurrency(
      leads,
      (lead: Lead) => scoreLeadWithOllama(lead, category, opts.ollamaModel),
      opts.concurrency,
      rateLimitOpts
    );
  }

  return leads;
}

/**
 * Scrape YellowPages directory.
 */
export async function scrapeYellowPages(
  category: string,
  location: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({ 
    ...options, 
    source: 'yellowpages', 
    category, 
    location 
  }) as ScrapeOptions;
  console.log(`🟨 Scraping YellowPages for "${category}" in "${location}"...`);

  let leads = await scrapeYellowPagesImpl(category, location, opts.limit);

  leads = deduplicateLeads(leads);

  const rateLimitOpts: RateLimitOptions = options.rpm !== undefined 
    ? options.rpm 
    : { source: opts.source };

  if (opts.enrich) {
    leads = await processWithConcurrency(
      leads,
      (lead: Lead) => enrichLead(lead, opts.verifyEmails),
      opts.concurrency,
      rateLimitOpts
    );
  }

  if (opts.useLLMScoring) {
    leads = await processWithConcurrency(
      leads,
      (lead: Lead) => scoreLeadWithOllama(lead, category, opts.ollamaModel),
      opts.concurrency,
      rateLimitOpts
    );
  }

  return leads;
}

/**
 * Scrape Crunchbase profiles.
 */
export async function scrapeCrunchbase(
  query: string,
  options: Partial<ScrapeOptions> = {}
): Promise<Lead[]> {
  const opts = ScrapeOptionsSchema.parse({ 
    ...options, 
    source: 'crunchbase', 
    query 
  }) as ScrapeOptions;
  console.log(`💼 Scraping Crunchbase for "${query}"...`);

  let leads = await scrapeCrunchbaseImpl(query, opts.limit);

  leads = deduplicateLeads(leads);

  const rateLimitOpts: RateLimitOptions = options.rpm !== undefined 
    ? options.rpm 
    : { source: opts.source };

  if (opts.enrich) {
    leads = await processWithConcurrency(
      leads,
      (lead: Lead) => enrichLead(lead, opts.verifyEmails),
      opts.concurrency,
      rateLimitOpts
    );
  }

  if (opts.useLLMScoring) {
    leads = await processWithConcurrency(
      leads,
      (lead: Lead) => scoreLeadWithOllama(lead, query, opts.ollamaModel),
      opts.concurrency,
      rateLimitOpts
    );
  }

  return leads;
}

/**
 * Saves leads to disk; format is inferred from file extension or name.
 * If append=true and the file exists, CSV and JSON will be appended to
 * (CSV skips header on append; JSON concatenates the arrays). Other formats
 * always overwrite.
 */
export async function saveLeads(leads: Lead[], filepath: string = 'leads.csv', append: boolean = false): Promise<void> {
  if (!Array.isArray(leads) || leads.length === 0) {
    throw new Error('Cannot save: leads array must be non-empty');
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

/**
 * Export leads directly to a Google Sheet (re-export from exporter).
 */
export async function exportToSheets(
  leads: Lead[],
  spreadsheetId: string,
  options: GoogleSheetsOptions = {}
): Promise<void> {
  return exportToSheetsImpl(leads, spreadsheetId, options);
}
