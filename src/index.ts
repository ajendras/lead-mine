import { type Lead, type ScrapeOptions, ScrapeOptionsSchema, type ExportFormat, inferFormatFromPath } from './types.js';
import { scrapeGoogleMaps } from './scrapers/maps.js';
import { scrapeGoogleSearch } from './scrapers/search.js';
import { scrapeYelp as scrapeYelpInternal } from './scrapers/yelp.js';
import { scrapeYellowPages as scrapeYellowPagesInternal } from './scrapers/yellowpages.js';
import { scrapeCrunchbase as scrapeCrunchbaseInternal } from './scrapers/crunchbase.js';
import { enrichLead, scoreLeadWithOllama } from './enricher.js';
import { exportLeads, exportToSheets } from './exporter.js';
import { withRateLimit, randomDelay } from './utils/throttle.js';
import { setProxies } from './utils/browser.js';

/**
 * Removes duplicate leads based on a normalized key composed of name + address or website.
 * Preserves the first occurrence.
 */
function deduplicateLeads(leads: Lead[]): Lead[] {
  const seen = new Set<string>();
  const unique: Lead[] = [];

  for (const lead of leads) {
    const key = [
      lead.name.toLowerCase().trim(),
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
 * Processes an array of items with limited concurrency using a worker pool pattern.
 * Used to enable parallel browser contexts while respecting rate limits.
 */
async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index]!;
      try {
        results[index] = await processor(item);
      } catch (error) {
        console.warn(`Worker error processing item ${index}:`, error);
        results[index] = item as unknown as R;
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length || 1) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/**
 * Scrape targeted business leads from Google Maps.
 *
 * @param category - Business category or search term (e.g. "plumbers", "roof repair")
 * @param location - Geographic target (e.g. "Portland, OR", "Austin, TX")
 * @param options - Scrape configuration (merged with values from ~/.leadmine/config.json).
 *                  Supports `proxy`, `concurrency`, `verifyEmails`, `useLLMScoring` and all other ScrapeOptions.
 * @returns Array of enriched, deduplicated Lead records
 * @throws {Error} When category or location are missing or invalid
 */
export async function scrapeMaps(
  category: string,
  location: string,
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  const validated = ScrapeOptionsSchema.parse(options);
  setProxies(validated.proxy);

  if (!category?.trim()) {
    throw new Error(
      'Category is required. Provide a business type such as "plumbers", "coffee shops" or "dentists".'
    );
  }
  if (!location?.trim()) {
    throw new Error(
      'Location is required. Provide a city and state, e.g. "Portland, OR" or "London, UK".'
    );
  }

  console.log(
    `🔎 Scraping Google Maps for "${category}" near "${location}" (limit: ${validated.limit})`
  );

  let leads = await scrapeGoogleMaps(category.trim(), location.trim(), validated.limit);

  // Normalize and attach metadata
  leads = leads.map((lead) => ({
    ...lead,
    category: category.trim(),
    location: location.trim(),
    scrapedAt: new Date().toISOString(),
    source: 'maps' as const,
  })) as Lead[];

  // Rating filter
  if (validated.minRating !== undefined) {
    leads = leads.filter((lead) => (lead.rating ?? 0) >= validated.minRating!);
  }

  // Enrichment with parallel browser contexts via worker pool
  if (validated.enrich && leads.length > 0) {
    console.log(`Enriching ${leads.length} leads with ${validated.concurrency} parallel workers...`);
    const throttledEnrich = withRateLimit(
      (lead: Lead) => enrichLead(lead, validated.verifyEmails),
      validated.rpm
    );
    leads = await processWithConcurrency(
      leads,
      throttledEnrich,
      validated.concurrency
    );
  }

  if (validated.useLLMScoring && leads.length > 0) {
    console.log(`🧠 Scoring ${leads.length} leads with Ollama...`);
    const throttledScore = withRateLimit(
      (lead: Lead) => scoreLeadWithOllama(lead, category, validated.ollamaModel),
      10
    );
    leads = await processWithConcurrency(
      leads,
      throttledScore,
      Math.min(validated.concurrency, 2)
    );
  }

  const unique = deduplicateLeads(leads);
  console.log(`✅ Retrieved ${unique.length} unique leads from Google Maps.`);

  return unique;
}

/**
 * Scrape leads via Google organic search results and linked contact pages.
 *
 * @param query - Full search query (e.g. "plumbers Portland OR contact")
 * @param options - Scrape configuration (merged with values from ~/.leadmine/config.json).
 *                  Supports `proxy`, `concurrency`, `verifyEmails`, `useLLMScoring` and all other ScrapeOptions.
 * @returns Array of enriched, deduplicated Lead records
 */
export async function scrapeSearch(
  query: string,
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  const validated = ScrapeOptionsSchema.parse(options);
  setProxies(validated.proxy);

  if (!query?.trim()) {
    throw new Error('Search query is required.');
  }

  console.log(`🔎 Performing Google search for "${query}" (limit: ${validated.limit})`);

  let leads = await scrapeGoogleSearch(query.trim(), validated.limit);

  leads = leads.map((lead) => ({
    ...lead,
    category: query.trim(),
    scrapedAt: new Date().toISOString(),
    source: 'search' as const,
  })) as Lead[];

  if (validated.minRating !== undefined) {
    leads = leads.filter((lead) => (lead.rating ?? 0) >= validated.minRating!);
  }

  if (validated.enrich && leads.length > 0) {
    console.log(`Enriching ${leads.length} leads with ${validated.concurrency} parallel workers...`);
    const throttledEnrich = withRateLimit(
      (lead: Lead) => enrichLead(lead, validated.verifyEmails),
      Math.min(validated.rpm, 15)
    );
    leads = await processWithConcurrency(
      leads,
      throttledEnrich,
      validated.concurrency
    );
  }

  if (validated.useLLMScoring && leads.length > 0) {
    console.log(`🧠 Scoring ${leads.length} leads with Ollama...`);
    const throttledScore = withRateLimit(
      (lead: Lead) => scoreLeadWithOllama(lead, query, validated.ollamaModel),
      10
    );
    leads = await processWithConcurrency(
      leads,
      throttledScore,
      Math.min(validated.concurrency, 2)
    );
  }

  const unique = deduplicateLeads(leads);
  console.log(`✅ Retrieved ${unique.length} unique leads from Google Search.`);

  return unique;
}

/**
 * Scrape leads from Yelp business listings.
 *
 * @param category - Business category (e.g. "plumbers")
 * @param location - City or neighborhood
 * @param options - Scrape configuration (merged with values from ~/.leadmine/config.json).
 *                  Supports `proxy`, `concurrency`, `verifyEmails`, `useLLMScoring` and all other ScrapeOptions.
 * @returns Array of enriched, deduplicated Lead records
 */
export async function scrapeYelp(
  category: string,
  location: string,
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  const validated = ScrapeOptionsSchema.parse(options);
  setProxies(validated.proxy);

  if (!category?.trim()) {
    throw new Error('Category is required for Yelp scraping.');
  }
  if (!location?.trim()) {
    throw new Error('Location is required for Yelp scraping.');
  }

  console.log(
    `🔎 Scraping Yelp for "${category}" in "${location}" (limit: ${validated.limit})`
  );

  let leads = await scrapeYelpInternal(category.trim(), location.trim(), validated.limit);

  leads = leads.map((lead) => ({
    ...lead,
    category: category.trim(),
    location: location.trim(),
    scrapedAt: new Date().toISOString(),
    source: 'yelp' as const,
  })) as Lead[];

  if (validated.minRating !== undefined) {
    leads = leads.filter((lead) => (lead.rating ?? 0) >= validated.minRating!);
  }

  if (validated.enrich && leads.length > 0) {
    console.log(`Enriching ${leads.length} leads with ${validated.concurrency} parallel workers...`);
    const throttledEnrich = withRateLimit(
      (lead: Lead) => enrichLead(lead, validated.verifyEmails),
      validated.rpm
    );
    leads = await processWithConcurrency(
      leads,
      throttledEnrich,
      validated.concurrency
    );
  }

  if (validated.useLLMScoring && leads.length > 0) {
    console.log(`🧠 Scoring ${leads.length} leads with Ollama...`);
    const throttledScore = withRateLimit(
      (lead: Lead) => scoreLeadWithOllama(lead, category, validated.ollamaModel),
      10
    );
    leads = await processWithConcurrency(
      leads,
      throttledScore,
      Math.min(validated.concurrency, 2)
    );
  }

  const unique = deduplicateLeads(leads);
  console.log(`✅ Retrieved ${unique.length} unique leads from Yelp.`);

  return unique;
}

/**
 * Scrape leads from YellowPages directory.
 *
 * @param category - Business category (e.g. "plumbers")
 * @param location - City and state
 * @param options - Scrape configuration (merged with values from ~/.leadmine/config.json).
 *                  Supports `proxy`, `concurrency`, `verifyEmails`, `useLLMScoring` and all other ScrapeOptions.
 * @returns Array of enriched, deduplicated Lead records
 */
export async function scrapeYellowPages(
  category: string,
  location: string,
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  const validated = ScrapeOptionsSchema.parse(options);
  setProxies(validated.proxy);

  if (!category?.trim()) {
    throw new Error('Category is required for YellowPages scraping.');
  }
  if (!location?.trim()) {
    throw new Error('Location is required for YellowPages scraping.');
  }

  console.log(
    `🔎 Scraping YellowPages for "${category}" in "${location}" (limit: ${validated.limit})`
  );

  let leads = await scrapeYellowPagesInternal(category.trim(), location.trim(), validated.limit);

  leads = leads.map((lead) => ({
    ...lead,
    category: category.trim(),
    location: location.trim(),
    scrapedAt: new Date().toISOString(),
    source: 'yellowpages' as const,
  })) as Lead[];

  if (validated.minRating !== undefined) {
    leads = leads.filter((lead) => (lead.rating ?? 0) >= validated.minRating!);
  }

  if (validated.enrich && leads.length > 0) {
    console.log(`Enriching ${leads.length} leads with ${validated.concurrency} parallel workers...`);
    const throttledEnrich = withRateLimit(
      (lead: Lead) => enrichLead(lead, validated.verifyEmails),
      validated.rpm
    );
    leads = await processWithConcurrency(
      leads,
      throttledEnrich,
      validated.concurrency
    );
  }

  if (validated.useLLMScoring && leads.length > 0) {
    console.log(`🧠 Scoring ${leads.length} leads with Ollama...`);
    const throttledScore = withRateLimit(
      (lead: Lead) => scoreLeadWithOllama(lead, category, validated.ollamaModel),
      10
    );
    leads = await processWithConcurrency(
      leads,
      throttledScore,
      Math.min(validated.concurrency, 2)
    );
  }

  const unique = deduplicateLeads(leads);
  console.log(`✅ Retrieved ${unique.length} unique leads from YellowPages.`);

  return unique;
}

/**
 * Scrape startup/company leads from Crunchbase.
 *
 * @param query - Search query (e.g. "fintech" or "AI companies Portland")
 * @param options - Scrape configuration (merged with values from ~/.leadmine/config.json).
 *                  Supports `proxy`, `concurrency`, `verifyEmails`, `useLLMScoring` and all other ScrapeOptions.
 * @returns Array of enriched, deduplicated Lead records
 */
export async function scrapeCrunchbase(
  query: string,
  options: ScrapeOptions = {}
): Promise<Lead[]> {
  const validated = ScrapeOptionsSchema.parse(options);
  setProxies(validated.proxy);

  if (!query?.trim()) {
    throw new Error('Query is required for Crunchbase scraping.');
  }

  console.log(`🔎 Scraping Crunchbase for "${query}" (limit: ${validated.limit})`);

  let leads = await scrapeCrunchbaseInternal(query.trim(), validated.limit);

  leads = leads.map((lead) => ({
    ...lead,
    category: query.trim(),
    scrapedAt: new Date().toISOString(),
    source: 'crunchbase' as const,
  })) as Lead[];

  if (validated.minRating !== undefined) {
    leads = leads.filter((lead) => (lead.rating ?? 0) >= validated.minRating!);
  }

  if (validated.enrich && leads.length > 0) {
    console.log(`Enriching ${leads.length} leads with ${validated.concurrency} parallel workers...`);
    const throttledEnrich = withRateLimit(
      (lead: Lead) => enrichLead(lead, validated.verifyEmails),
      Math.min(validated.rpm, 10)
    );
    leads = await processWithConcurrency(
      leads,
      throttledEnrich,
      validated.concurrency
    );
  }

  if (validated.useLLMScoring && leads.length > 0) {
    console.log(`🧠 Scoring ${leads.length} leads with Ollama...`);
    const throttledScore = withRateLimit(
      (lead: Lead) => scoreLeadWithOllama(lead, query, validated.ollamaModel),
      10
    );
    leads = await processWithConcurrency(
      leads,
      throttledScore,
      Math.min(validated.concurrency, 2)
    );
  }

  const unique = deduplicateLeads(leads);
  console.log(`✅ Retrieved ${unique.length} unique leads from Crunchbase.`);

  return unique;
}

/**
 * Export an array of leads to a file in the requested format.
 * Format is inferred from filepath extension when not explicitly provided.
 *
 * @param leads - Leads to export
 * @param filepath - Destination file path (e.g. "leads.csv", "output.xlsx")
 * @param format - Optional explicit format (overrides extension)
 */
export async function saveLeads(
  leads: Lead[],
  filepath: string,
  format?: ExportFormat
): Promise<void> {
  if (!leads || leads.length === 0) {
    console.warn('No leads to export.');
    return;
  }

  const exportFormat = format ?? inferFormatFromPath(filepath);

  console.log(`💾 Exporting ${leads.length} leads as ${exportFormat.toUpperCase()} to ${filepath}...`);

  await exportLeads(leads, exportFormat, filepath);
  console.log('✅ Export completed.');
}

/**
 * Export leads directly to Google Sheets.
 * Re-exported from exporter.ts (full implementation and docs live there).
 */
export { exportToSheets };

export { deduplicateLeads };
export { loadConfig, saveConfig, CONFIG_PATH, SERVICE_ACCOUNT_PATH } from './config.js';
export type { Lead, ScrapeOptions, ExportFormat, ScrapeSource, ConfigOptions, GoogleSheetsOptions } from './types.js';
export { ScrapeOptionsSchema, inferFormatFromPath } from './types.js';
export { isDisposableEmail } from './enricher.js';
export { getWorkerPool, closeWorkerPool, BrowserWorkerPool } from './utils/browser.js';
