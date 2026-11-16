#!/usr/bin/env node
import { Command, Option } from 'commander';
import * as leadMine from './index.js';
import { type ScrapeSource, ScrapeOptionsSchema } from './types.js';
import { z } from 'zod';

const program = new Command();

program
  .name('lead-mine')
  .description(
    'Self-hosted CLI to scrape and enrich business leads from Google Maps, Search, Yelp and directories.\n' +
      'Transparent, polite, and under your control.'
  )
  .version('0.1.0')
  .helpOption('-h, --help', 'Display help')
  .addHelpText(
    'after',
    `
Examples:
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --limit=30 --output=leads.csv
  $ lead-mine scrape --source=search --query="HVAC companies near Austin TX" --output=results.json --enrich
  $ lead-mine scrape --source=yelp --category="roof repair" --location="Seattle, WA" --limit=15
  $ lead-mine scrape --category="lawyers" --location="New York, NY" --proxy="http://user-zone:pass@gate.smartproxy.com:7000"
    `
  );

program
  .command('scrape')
  .description('Run a lead scraping job')
  .addOption(
    new Option('-s, --source <source>', 'Data source')
      .choices(['maps', 'search', 'yelp'])
      .default('maps')
  )
  .requiredOption(
    '-c, --category <category>',
    'Business category or industry keyword (used as query for search source)'
  )
  .option(
    '-l, --location <location>',
    'Geographic location (required for maps and yelp)',
    'Portland, OR'
  )
  .option('-q, --query <query>', 'Override full Google search query')
  .option('--limit <number>', 'Maximum number of leads', '25')
  .option(
    '-o, --output <filepath>',
    'Output file path. Extension determines format (csv/json/xlsx)',
    'leads.csv'
  )
  .option('--headless', 'Run browser in headless mode (default)', true)
  .option('--no-headless', 'Show browser window during scraping')
  .option('--enrich', 'Visit websites to discover emails and metadata (default for most sources)')
  .option('--no-enrich', 'Skip website enrichment step')
  .addOption(
    new Option(
      '--proxy <proxies...>',
      'One or more proxy URLs for rotation (http://user:pass@host:port). Residential gateway URLs supported.'
    )
  )
  .action(async (cmdOptions) => {
    try {
      const config = await leadMine.loadConfig();

      const limit = parseInt(cmdOptions.limit, 10);
      if (Number.isNaN(limit) || limit < 1) {
        program.error('Limit must be a positive integer.');
      }

      const source = cmdOptions.source as ScrapeSource;
      const outputPath = cmdOptions.output;
      const query = cmdOptions.query || cmdOptions.category;

      // Config file values are merged first; CLI flags override them
      const scrapeOpts = ScrapeOptionsSchema.parse({
        ...config,
        limit,
        headless: cmdOptions.headless,
        enrich: cmdOptions.enrich !== false,
        proxy: cmdOptions.proxy,
      });

      let leads: leadMine.Lead[] = [];

      if (source === 'maps') {
        if (!cmdOptions.location?.trim()) {
          program.error('--location is required when using --source=maps');
        }
        leads = await leadMine.scrapeMaps(cmdOptions.category, cmdOptions.location, scrapeOpts);
      } else if (source === 'yelp') {
        if (!cmdOptions.location?.trim()) {
          program.error('--location is required when using --source=yelp');
        }
        leads = await leadMine.scrapeYelp(cmdOptions.category, cmdOptions.location, {
          ...scrapeOpts,
          enrich: scrapeOpts.enrich !== undefined ? scrapeOpts.enrich : false,
        });
      } else if (source === 'search') {
        if (!query?.trim()) {
          program.error('A query or category is required for search source.');
        }
        leads = await leadMine.scrapeSearch(query, scrapeOpts);
      } else {
        program.error(`Unsupported source: ${source}`);
      }

      await leadMine.saveLeads(leads, outputPath);
      console.log(`\n🎉 Done. Captured ${leads.length} high-quality leads.`);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('\n❌ Invalid options:');
        error.errors.forEach((err) => console.error(`   • ${err.message}`));
        process.exit(1);
      }

      if (error instanceof Error) {
        console.error(`\n❌ ${error.message}`);
      } else {
        console.error('\n❌ An unknown error occurred during scraping.');
        console.error(error);
      }
      process.exit(1);
    }
  });

program.parse(process.argv);
