#!/usr/bin/env node
import { Command, Option } from 'commander';
import * as leadMine from './index.js';
import { type ScrapeSource, ScrapeOptionsSchema, type ScrapeOptions } from './types.js';
import { z } from 'zod';
import * as readline from 'node:readline/promises';

const program = new Command();

function printTroubleshootingSuggestions(error: unknown): void {
  if (!(error instanceof Error)) {
    return;
  }
  const msg = error.message.toLowerCase();

  console.error('\n🔧 Actionable troubleshooting:');

  if (msg.includes('ollama') || msg.includes('11434') || msg.includes('connection refused') || (msg.includes('connect') && (msg.includes('localhost') || msg.includes('ollama')))) {
    console.error('   • Ollama LLM scoring is enabled but the service is not reachable.');
    console.error('   • Run these commands in a separate terminal:');
    console.error('       ollama serve');
    console.error('       ollama pull llama3.1');
    console.error('   • Verify with: ollama list');
    console.error('   • Or disable with --no-use-llm-scoring (or set useLLMScoring: false in config)');
  } else if (msg.includes('proxy') || msg.includes('econnrefused') || msg.includes('etimedout') || msg.includes('ehostunreach') || msg.includes('proxy error')) {
    console.error('   • Proxy connection failed.');
    console.error('   • Check:');
    console.error('       - Proxy URL format (http://user:pass@host:port)');
    console.error('       - Credentials are valid and the proxy is online');
    console.error('       - Test with: curl -x "<your-proxy>" https://httpbin.org/ip');
    console.error('       - Residential gateways (Smartproxy, Oxylabs, Bright Data) work best');
    console.error('   • Temporarily remove --proxy to isolate the issue');
  } else if (msg.includes('block') || msg.includes('403') || msg.includes('429') || msg.includes('captcha') || msg.includes('cloudflare') || msg.includes('unusual traffic') || msg.includes('forbidden') || msg.includes('detected as bot') || msg.includes('access denied')) {
    console.error('   • The site blocked the request (common with Google services).');
    console.error('   • Try:');
    console.error('       - Residential proxy: --proxy "http://user:pass@gate.smartproxy.com:7000"');
    console.error('       - Lower speed: --rpm=3');
    console.error('       - Visible browser: --no-headless');
    console.error('       - Different source: --source=yelp');
    console.error('       - Smaller --limit');
    console.error('   • Exponential backoff is applied automatically on 429s');
  } else if (msg.includes('service account') || msg.includes('sheets') || msg.includes('google') || msg.includes('enoent')) {
    console.error('   • Google Sheets / service account issue.');
    console.error('   • Follow the "Google Sheets Setup" section in README.md exactly.');
    console.error('   • Confirm ~/.leadmine/service-account.json exists and the client_email has Editor access on the sheet.');
  } else {
    console.error('   • Check your internet connection and firewall.');
    console.error('   • Try a smaller --limit, lower --rpm, or different source.');
    console.error('   • For Docker: add --network=host when using Ollama.');
    console.error('   • Open an issue at https://github.com/ajendras/lead-mine with the full error output.');
  }

  console.error('\n   The scraper is polite by design (rate limits, stealth, backoff).');
}

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
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --output=report.html
  $ lead-mine scrape --source=search --query="HVAC companies near Austin TX" --output=results.json --enrich
  $ lead-mine scrape --source=yelp --category="roof repair" --location="Seattle, WA" --limit=15
  $ lead-mine scrape --source=yellowpages --category="electricians" --location="Chicago, IL"
  $ lead-mine scrape --source=crunchbase --query="fintech startups" --limit=15 --enrich
  $ lead-mine scrape --category="lawyers" --location="New York, NY" --proxy="http://user-zone:pass@gate.smartproxy.com:7000"
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --verify-emails
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --sheets=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --use-llm-scoring --ollama-model=llama3.1
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --concurrency=4
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --output=leads.hubspot.csv --enrich
  $ lead-mine scrape --category="roofers" --location="Austin, TX" --output=accounts.salesforce.csv --enrich --use-llm-scoring
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --rpm=8
  $ lead-mine scrape --category="plumbers" --location="Portland, OR" --output=leads.csv --append
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
    'Output file path. Extension or filename determines format (csv/json/xlsx/html/hubspot/salesforce)',
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
  .addOption(
    new Option(
      '--sheets <spreadsheet-id>',
      'Google Sheets spreadsheet ID for direct export (requires ~/.leadmine/service-account.json with Editor access)'
    )
  )
  .option('--use-llm-scoring', 'Score leads for relevance and budget signals using local Ollama LLM')
  .option('--ollama-model <model>', 'Ollama model to use for scoring', 'llama3.1')
  .addOption(
    new Option('--concurrency <number>', 'Max parallel browser contexts (1-6)')
      .argParser((val) => parseInt(val, 10))
      .default(3)
  )
  .option('--rpm <number>', 'Override requests per minute (polite per-source presets used if omitted; exponential backoff applied on rate limits/blocks)')
  .option('--min-score <number>', 'Minimum relevance score threshold (0-10) when using LLM scoring to filter leads', '0')
  .option('--append', 'Append to existing CSV/JSON file instead of overwriting (CSV/JSON only)')
  .action(async (cmdOptions) => {
    try {
      const config = await leadMine.loadConfig();

      const limit = parseInt(cmdOptions.limit, 10);
      if (Number.isNaN(limit) || limit < 1) {
        program.error('Limit must be a positive integer.');
      }

      const concurrency = cmdOptions.concurrency;
      if (Number.isNaN(concurrency) || concurrency < 1 || concurrency > 6) {
        program.error('Concurrency must be an integer between 1 and 6.');
      }

      let rpm: number | undefined;
      if (cmdOptions.rpm !== undefined) {
        rpm = parseInt(cmdOptions.rpm, 10);
        if (Number.isNaN(rpm) || rpm < 1 || rpm > 60) {
          program.error('rpm must be an integer between 1 and 60.');
        }
      }

      let minScore: number | undefined;
      if (cmdOptions.minScore !== undefined) {
        minScore = parseFloat(cmdOptions.minScore);
        if (Number.isNaN(minScore) || minScore < 0 || minScore > 10) {
          program.error('minScore must be a number between 0 and 10.');
        }
      }

      const source = cmdOptions.source as ScrapeSource;
      const outputPath = cmdOptions.output;
      const query = cmdOptions.query || cmdOptions.category;

      const cliOpts: Record<string, any> = {
        limit,
        headless: cmdOptions.headless,
        enrich: cmdOptions.enrich !== false,
        proxy: cmdOptions.proxy,
        useLLMScoring: cmdOptions.useLlmScoring,
        ollamaModel: cmdOptions.ollamaModel,
        concurrency,
        rpm,
        minScore,
        append: cmdOptions.append,
      };

      if (cmdOptions.verifyEmails !== undefined) {
        cliOpts.verifyEmails = cmdOptions.verifyEmails === true;
      }
      if (cmdOptions.sheets) {
        cliOpts.googleSheets = { spreadsheetId: cmdOptions.sheets };
      }

      // Config file values are merged first; CLI flags override them
      const scrapeOpts = ScrapeOptionsSchema.parse({
        ...config,
        ...cliOpts,
      }) as ScrapeOptions;

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

      if (cmdOptions.sheets || scrapeOpts.googleSheets?.spreadsheetId) {
        const sheetId = cmdOptions.sheets || scrapeOpts.googleSheets!.spreadsheetId!;
        const sheetOpts = { ...(scrapeOpts.googleSheets || {}), spreadsheetId: sheetId };
        await leadMine.exportToSheets(leads, sheetId, sheetOpts);
      } else {
        await leadMine.saveLeads(leads, outputPath, scrapeOpts.append);
      }
      console.log(`\n🎉 Done. Captured ${leads.length} high-quality leads.`);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('\n❌ Invalid options:');
        error.errors.forEach((err) => console.error(`   • ${err.message}`));
        process.exit(1);
      }

      if (error instanceof Error) {
        console.error(`\n❌ ${error.message}`);
        printTroubleshootingSuggestions(error);
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

      const llmAnswer = await question('Enable local LLM scoring (Ollama)? Requires Ollama running (y/N):');
      const useLLMScoring = llmAnswer.toLowerCase().startsWith('y');

      const limitAnswer = await question('Default number of leads? [25]:');
      let limit = parseInt(limitAnswer.trim(), 10);
      if (Number.isNaN(limit) || limit < 5) limit = 25;
      if (limit > 100) limit = 100;

      let rpm = 20;
      switch (source) {
        case 'maps':
          rpm = 6;
          break;
        case 'search':
          rpm = 10;
          break;
        case 'yelp':
          rpm = 15;
          break;
        case 'yellowpages':
          rpm = 25;
          break;
        case 'crunchbase':
          rpm = 12;
          break;
      }

      const config: Partial<ScrapeOptions> = {
        source,
        category: category.trim(),
        location: location.trim(),
        limit,
        enrich,
        verifyEmails,
        useLLMScoring,
        ollamaModel: 'llama3.1',
        headless: true,
        rpm,
        minRating: 4.0,
        minScore: 5.0,
        concurrency: 3,
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
        }) as ScrapeOptions;

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
        printTroubleshootingSuggestions(error);
      } else {
        console.error('\n❌ An unknown error occurred in the wizard.');
      }
      process.exit(1);
    } finally {
      rl.close();
    }
  });

program.parse(process.argv);
