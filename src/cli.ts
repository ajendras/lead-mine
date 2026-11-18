#!/usr/bin/env node
import { Command, Option } from 'commander';
import * as leadMine from './index.js';
import { type ScrapeSource, ScrapeOptionsSchema } from './types.js';
import { z } from 'zod';
import * as readline from 'node:readline/promises';

const program = new Command();

program
  .name('lead-mine')
  .description(
    'Self-hosted CLI to scrape and enrich business leads from Google Maps, Search, Yelp, YellowPages, Crunchbase and directories.\n' +
      'Transparent, polite, and under your control.'
  )
  .version('0.1.0')
  .helpOption('-h, --help', 'Display help')
  .addHelpText(
    'after',
    `
Examples:
  $ lead-mine wizard
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --limit=30 --output=leads.csv
  $ lead-mine scrape --source=search --query="HVAC companies near Austin TX" --output=results.json --enrich
  $ lead-mine scrape --source=yelp --category="roof repair" --location="Seattle, WA" --limit=15
  $ lead-mine scrape --source=yellowpages --category="electricians" --location="Chicago, IL"
  $ lead-mine scrape --source=crunchbase --query="fintech startups" --limit=15 --enrich
  $ lead-mine scrape --category="lawyers" --location="New York, NY" --proxy="http://user-zone:pass@gate.smartproxy.com:7000"
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --verify-emails
    `
  );

program
  .command('scrape')
  .description('Run a lead scraping job')
  .addOption(
    new Option('-s, --source <source>', 'Data source')
      .choices(['maps', 'search', 'yelp', 'yellowpages', 'crunchbase'])
      .default('maps')
  )
  .requiredOption(
    '-c, --category <category>',
    'Business category or industry keyword (used as query for search source)'
  )
  .option(
    '-l, --location <location>',
    'Geographic location (required for maps, yelp and yellowpages)',
    'Portland, OR'
  )
  .option('-q, --query <query>', 'Override full Google search query')
  .option('--limit <number>', 'Maximum number of leads to return', '25')
  .option(
    '-o, --output <filepath>',
    'Output file path. Extension determines format (csv/json/xlsx)',
    'leads.csv'
  )
  .option('--headless', 'Run browser in headless mode (default)', true)
  .option('--no-headless', 'Show browser window during scraping')
  .option('--enrich', 'Visit websites to discover emails and metadata (default for most sources)')
  .option('--no-enrich', 'Skip website enrichment step')
  .option('--verify-emails', 'Verify extracted emails are not from disposable providers')
  .option('--no-verify-emails', 'Skip email verification step')
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

      const cliOpts: Record<string, any> = {
        limit,
        headless: cmdOptions.headless,
        enrich: cmdOptions.enrich !== false,
        proxy: cmdOptions.proxy,
      };

      if (cmdOptions.verifyEmails !== undefined) {
        cliOpts.verifyEmails = cmdOptions.verifyEmails === true;
      }

      // Config file values are merged first; CLI flags override them
      const scrapeOpts = ScrapeOptionsSchema.parse({
        ...config,
        ...cliOpts,
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
      } else if (source === 'yellowpages') {
        if (!cmdOptions.location?.trim()) {
          program.error('--location is required when using --source=yellowpages');
        }
        leads = await leadMine.scrapeYellowPages(cmdOptions.category, cmdOptions.location, scrapeOpts);
      } else if (source === 'search') {
        if (!query?.trim()) {
          program.error('A query or category is required for search source.');
        }
        leads = await leadMine.scrapeSearch(query, scrapeOpts);
      } else if (source === 'crunchbase') {
        if (!query?.trim()) {
          program.error('A query or category is required for crunchbase source.');
        }
        leads = await leadMine.scrapeCrunchbase(query, scrapeOpts);
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

program
  .command('wizard')
  .description('Interactive setup wizard for first-time users')
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (text: string): Promise<string> => rl.question(`\n${text} `);

    try {
      console.log('\n🪄 Welcome to the LeadMine Interactive Wizard!');
      console.log(
        'This guided mode creates a config file with your preferences and runs a sample scrape.\n'
      );

      const sourceChoice = await question(
        'Primary source? (maps/search/yelp/yellowpages/crunchbase) [maps]:'
      );
      const source = ((sourceChoice.trim() || 'maps') as ScrapeSource).toLowerCase() as ScrapeSource;

      const category =
        (await question('Default business category? (e.g. plumbers) [plumbers]:')) || 'plumbers';

      const location =
        (await question('Default location? (e.g. Portland, OR) [Portland, OR]:')) || 'Portland, OR';

      const enrichAnswer = await question('Enable website enrichment by default? (Y/n):');
      const enrich = !enrichAnswer.toLowerCase().startsWith('n');

      const verifyAnswer = await question('Enable email verification? (Y/n):');
      const verifyEmails = !verifyAnswer.toLowerCase().startsWith('n');

      const limitAnswer = await question('Default number of leads? [25]:');
      let limit = parseInt(limitAnswer.trim(), 10);
      if (Number.isNaN(limit) || limit < 5) limit = 25;
      if (limit > 100) limit = 100;

      const config: Partial<leadMine.ScrapeOptions> = {
        source,
        category: category.trim(),
        location: location.trim(),
        limit,
        enrich,
        verifyEmails,
        headless: true,
        rpm: 15,
        minRating: 4.0,
      };

      await leadMine.saveConfig(config);

      console.log(`\n✅ Configuration saved to ${leadMine.CONFIG_PATH}`);
      console.log('\nYou can edit this file anytime to update defaults.');
      console.log('\nSaved values:');
      console.log(JSON.stringify(config, null, 2));

      const runAnswer = await question('\nRun a sample scrape now using these settings? (Y/n):');
      if (!runAnswer.toLowerCase().startsWith('n')) {
        console.log('\n🚀 Running your first scrape...');

        const scrapeOpts = ScrapeOptionsSchema.parse({
          ...config,
          limit,
        });

        let leads: leadMine.Lead[] = [];
        const cat = config.category!;
        const loc = config.location!;
        const query = `${cat} ${loc}`;

        switch (source) {
          case 'maps':
            leads = await leadMine.scrapeMaps(cat, loc, scrapeOpts);
            break;
          case 'search':
            leads = await leadMine.scrapeSearch(query, scrapeOpts);
            break;
          case 'yelp':
            leads = await leadMine.scrapeYelp(cat, loc, scrapeOpts);
            break;
          case 'yellowpages':
            leads = await leadMine.scrapeYellowPages(cat, loc, scrapeOpts);
            break;
          case 'crunchbase':
            leads = await leadMine.scrapeCrunchbase(query, scrapeOpts);
            break;
          default:
            leads = await leadMine.scrapeMaps(cat, loc, scrapeOpts);
        }

        const outputPath = 'sample-leads.csv';
        await leadMine.saveLeads(leads, outputPath);
        console.log(
          `\n🎉 Done! Captured ${leads.length} leads and saved them to ${outputPath}.`
        );
        console.log('Open the CSV to explore your leads.');
      } else {
        console.log(
          '\nRun scrapes anytime with: lead-mine scrape --category="roofers" --location="Austin, TX"'
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`\n❌ Wizard error: ${error.message}`);
      } else {
        console.error('\n❌ An unknown error occurred in the wizard.');
      }
      process.exit(1);
    } finally {
      rl.close();
    }
  });

program.parse(process.argv);
