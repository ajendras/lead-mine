<!-- header:start -->
<div align="center">

<img src="./assets/banner.svg" alt="LeadMine" width="100%">

<a href="#-quick-start"><img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&pause=1000&color=d9c2a3&center=true&vCenter=true&width=640&lines=Target+any+niche+%26+location;Extracts+contacts+%26+websites;Clean+CSVs%2C+zero+SaaS+fees" alt="Target any niche &amp; location · Extracts contacts &amp; websites · Clean CSVs, zero SaaS fees"></a>

<a href="LICENSE"><img src="https://img.shields.io/github/license/ajendras/lead-mine?style=for-the-badge&color=3f2a1e" alt="License"></a>
<img src="https://img.shields.io/badge/TypeScript-3f2a1e?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
<a href="https://github.com/ajendras/lead-mine/stargazers"><img src="https://img.shields.io/github/stars/ajendras/lead-mine?style=for-the-badge&logo=github&color=d9c2a3" alt="Stars"></a>
<a href="https://github.com/ajendras/lead-mine/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ajendras/lead-mine/ci.yml?style=for-the-badge&label=CI" alt="CI"></a>
<img src="https://img.shields.io/github/last-commit/ajendras/lead-mine?style=for-the-badge&color=3f2a1e" alt="Last commit">
<a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-22c55e?style=for-the-badge" alt="PRs welcome"></a>

**CLI to scrape and enrich targeted business leads from Google Search, Maps, Yelp, YellowPages, Crunchbase and directories**

[✨ Features](#-features) • [⚡ Quick start](#-quick-start) • [🧰 Usage](#-usage) • [🧩 Architecture](#-architecture) • [📍 Roadmap](#-roadmap) • [🤝 Contributing](#-contributing)

</div>
<!-- header:end -->

## ✨ Why LeadMine?

Freelancers, agencies and sales teams burn hours hunting prospects on Google and Maps. Commercial tools are pricey, opaque and rate-limited. LeadMine gives full control with a transparent, self-hosted CLI that pulls public data for any category and locale.

- **Self-hosted & transparent** — full visibility into every request, no vendor lock-in or surprise billing
- **Polite by design** — built-in rate limiting, random delays, user-agent rotation and stealth via Playwright
- **Multi-source enrichment** — Google Maps, organic Search, Yelp, YellowPages and Crunchbase with automatic website crawling for emails and missing phones
- **Clean, flexible exports** — deduplicated leads written to CSV, JSON or XLSX with consistent columns

## 🎬 Demo

<p align="center"><img src="./assets/demo.svg" alt="LeadMine demo" width="760"></p>

## 🚀 Features

<table>
<tr>
<td>
🗺️ <b>Maps Scraper</b><br>
Pulls name, address, phone, rating and website from Google Maps results using Playwright
</td>
<td>
🔎 <b>Search Leads</b><br>
Extracts organic Google results and linked contact pages for broader web leads
</td>
</tr>
<tr>
<td>
📍 <b>Yelp Support</b><br>
Scrapes business listings from Yelp with fallback when Maps data is thin
</td>
<td>
🟨 <b>YellowPages &amp; Crunchbase</b><br>
Additional US directory and startup ecosystem sources with profile enrichment
</td>
</tr>
<tr>
<td>
📤 <b>Smart Export</b><br>
Writes clean CSV, JSON or XLSX with configurable columns and deduplication
</td>
<td>
🔧 <b>Contact Enricher</b><br>
Visits websites to discover email patterns, social links and missing phones
</td>
</tr>
<tr>
<td>
⏱️ <b>Polite Crawling</b><br>
Built-in rate limiting, random delays, user-agent rotation and stealth to reduce blocks
</td>
<td>
🎯 <b>Targeted Filters</b><br>
Category, location, rating, review count and keyword filters for high-quality leads
</td>
</tr>
<tr>
<td>
📋 <b>Config File</b><br>
Persistent defaults via ~/.leadmine/config.json (CLI flags override)
</td>
<td>
🔄 <b>Proxy Rotation + Residential</b><br>
Configurable proxy lists with automatic rotation; native support for residential proxy providers (Smartproxy, Oxylabs, Bright Data gateway URLs)
</td>
</tr>
<tr>
<td>
🧪 <b>Mockable Tests</b><br>
Unit tests with recorded HTML fixtures so CI stays fast and reliable
</td>
<td></td>
</tr>
</table>

## 📦 Installation

**Requirements:** Node.js >= 18.0.0 (see `engines` in package.json).

```bash
npm install -g lead-mine
```

The CLI is available immediately as `lead-mine`. For local development:

```bash
git clone https://github.com/ajendras/lead-mine.git
cd lead-mine
npm install
npm run build
```

## ⚡ Quick start

```ts
import { loadConfig, scrapeMaps, scrapeYellowPages, saveLeads } from 'lead-mine';

const config = await loadConfig();

// Config values are merged; explicit options override them
const leads = await scrapeYellowPages('plumbers', 'Portland, OR', {
  ...config,
  limit: 30,
  enrich: true,
  rpm: 12,
  proxy: 'http://user:pass@residential.provider:22222',
});

await saveLeads(leads, 'leads.csv');
console.log(`Captured ${leads.length} leads`);
```

## 🧰 Usage

Run the CLI (most common workflow). The CLI automatically loads defaults from `~/.leadmine/config.json` if it exists. Flags override config values.

```bash
lead-mine scrape --category="plumbers" --location="Portland, OR" --limit=30 --output=leads.csv
```

Search-focused run with enrichment:

```bash
lead-mine scrape --source=search --query="HVAC companies near Austin TX" --output=results.json --enrich
```

Yelp fallback when Maps coverage is thin:

```bash
lead-mine scrape --source=yelp --category="roof repair" --location="Seattle, WA" --limit=15
```

YellowPages and Crunchbase examples:

```bash
lead-mine scrape --source=yellowpages --category="electricians" --location="Chicago, IL" --limit=25
lead-mine scrape --source=crunchbase --query="fintech startups" --limit=15 --enrich
```

Residential proxy example (rotates IPs via provider gateway):

```bash
lead-mine scrape --category="lawyers" --location="New York, NY" --limit=50 \
  --proxy="http://youruser-zone-residential:yourpass@gate.smartproxy.com:7000"
```

Multiple proxies (CLI rotates through them):

```bash
lead-mine scrape --category="plumbers" --location="Portland, OR" \
  --proxy http://proxy1.example.com:8080 http://proxy2.example.com:8080
```

Programmatic usage with custom options (see `src/index.ts`):

```ts
import { loadConfig, scrapeYellowPages, scrapeCrunchbase, saveLeads } from 'lead-mine';

const config = await loadConfig();

const leads = await scrapeYellowPages('coffee shops', 'Portland, OR', {
  ...config,
  limit: 25,
  minRating: 4.0,
  enrich: true,
  proxy: ['http://proxy1:8080', 'http://proxy2:8080'],
});

await saveLeads(leads, 'coffee-leads.xlsx');
```

<details><summary>Advanced: custom rate-limit and headless control</summary>

```ts
import { loadConfig, scrapeCrunchbase } from 'lead-mine';

const config = await loadConfig();

const leads = await scrapeCrunchbase('AI companies', {
  ...config,
  limit: 20,
  headless: false,
  rpm: 8,
  enrich: true,
});
```
</details>

## 🔧 Configuration

**Configuration File**

LeadMine automatically loads defaults from `~/.leadmine/config.json` (created manually). Any `ScrapeOptions` can be set here. Command-line flags and programmatic options take precedence.

Example `~/.leadmine/config.json`:

```json
{
  "limit": 30,
  "enrich": true,
  "rpm": 12,
  "headless": true,
  "minRating": 4.0,
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "proxy": "http://user:pass@zproxy.lumproxy.com:22222"
}
```

| Option      | Default | Description |
|-------------|---------|-------------|
| limit       | 20      | Maximum number of leads to return (`ScrapeOptionsSchema`) |
| enrich      | true    | Visit websites to discover emails and metadata |
| headless    | true    | Run browser without GUI (`--no-headless` to disable) |
| rpm         | 20      | Requests per minute for rate limiting (`withRateLimit`) |
| minRating   | —       | Filter leads by minimum rating (0–5) |
| userAgent   | —       | Override default stealth user agent |
| proxy       | —       | Single proxy URL or array of URLs for rotation. Residential proxies supported via provider gateway (e.g. `http://user-zone-resi:pass@gate.smartproxy.com:7000`). Rotates automatically across browser sessions. |

All options are validated by `ScrapeOptionsSchema` (Zod) in `src/types.ts`.

## 🧩 Architecture

```mermaid
flowchart TD
    CLI[cli.ts<br>Commander.js flags] --> Index[src/index.ts<br>orchestrator]
    Index --> Maps[src/scrapers/maps.ts<br>Playwright scroll + panel extraction]
    Index --> Search[src/scrapers/search.ts<br>organic results + snippet parsing]
    Index --> Yelp[src/scrapers/yelp.ts<br>list + detail page visits]
    Index --> YellowPages[src/scrapers/yellowpages.ts<br>list extraction with stable classes]
    Index --> Crunchbase[src/scrapers/crunchbase.ts<br>profile scraping + website extraction]
    Maps & Search & Yelp & YellowPages & Crunchbase --> Throttle[src/utils/throttle.ts<br>randomDelay + withRateLimit]
    Index --> Enrich[enricher.ts<br>launchStealthBrowser + regex extraction]
    Enrich --> Browser[src/utils/browser.ts<br>stealth Chromium + proxy rotator]
    Index --> Dedup[deduplicateLeads<br>name+address+website key]
    Dedup --> Export[exporter.ts<br>csv-writer / xlsx / JSON]
    Export --> FS[CSV / JSON / XLSX output]
    style Index fill:#d9c2a3,stroke:#3f2a1e
```

`src/index.ts` coordinates scraping, enrichment, deduplication and export. All scrapers return a uniform `Lead[]` shape defined in `src/types.ts`. Browser sessions are created fresh per scrape/enrichment to maintain stealth. Proxy rotation (including residential gateways) is handled centrally in `browser.ts`.

## 📁 Project structure

```text
.
├── src/
│   ├── index.ts          # Public API: scrapeMaps(), scrapeSearch(), scrapeYelp(), scrapeYellowPages(), scrapeCrunchbase(), saveLeads(), loadConfig()
│   ├── cli.ts            # Commander.js command definition with all flags
│   ├── config.ts         # loadConfig() + CONFIG_PATH for ~/.leadmine/config.json
│   ├── types.ts          # Lead interface, ScrapeOptions, Zod schema, ExportFormat, ConfigOptions
│   ├── enricher.ts       # enrichLead() + extractEnrichedInfo (mailto, regex, tel:)
│   ├── exporter.ts       # exportLeads() using csv-writer, xlsx, fs
│   ├── scrapers/
│   │   ├── maps.ts       # scrapeGoogleMaps() + extractFromSidePanel
│   │   ├── search.ts     # scrapeGoogleSearch() + extractContactInfo
│   │   ├── yelp.ts       # scrapeYelp() + extractYelpDetail
│   │   ├── yellowpages.ts # scrapeYellowPages() + extractYellowPagesResults
│   │   └── crunchbase.ts # scrapeCrunchbase() + extractCrunchbaseResults/Profile
│   └── utils/
│       ├── browser.ts    # launchStealthBrowser() + setProxies() + rotation
│       └── throttle.ts   # randomDelay(), withRateLimit()
├── tests/
│   └── scrapers.test.ts  # Vitest mocks + fixture tests for parsers, dedup, export
├── playwright.config.ts  # Headless config, user-agent, timeouts
├── tsconfig.json
└── package.json          # bin:"lead-mine", scripts, dependencies
```

## 🧪 Testing

```bash
npm test
```

Runs the Vitest suite in `tests/scrapers.test.ts`. Covers mocked scraper fixtures, `Lead` shape validation, deduplication logic, enrichment fallbacks, throttle utilities (`randomDelay`, `withRateLimit`), export formats, CLI option parsing, the `loadConfig()` helper, new proxy rotation behaviour, and the YellowPages/Crunchbase parsers.

## 📍 Roadmap

<!-- roadmap:start -->
- [x] **v0.1.0** — first release: Maps Scraper, Search Leads, Yelp Support, Smart Export
- [x] Add configuration file support (~/.leadmine/config.json)
- [x] Implement proxy rotation and residential proxy interface
- [x] Add more directory scrapers (YellowPages, Crunchbase)
- [ ] Email verification step using disposable checker or SMTP
- [ ] Interactive wizard mode for first-time users
- [ ] Google Sheets direct export via service account
- [ ] Local LLM lead scoring with Ollama (relevance, budget signals)
- [ ] Parallel browser contexts with worker pool
- [ ] HTML report generator with embedded map previews
- [ ] Docker image with bundled Chromium for server use
- [ ] CRM import templates (HubSpot CSV, Salesforce)
- [ ] Rate-limit presets per source with exponential backoff

> 🤖 This roadmap is worked through continuously — ideas and PRs welcome!
<!-- roadmap:end -->

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](https://github.com/ajendras/lead-mine/blob/main/CONTRIBUTING.md) and follow our [Code of Conduct](https://github.com/ajendras/lead-mine/blob/main/CODE_OF_CONDUCT.md). Good-first-issue PRs around new directory sources, improved enrichment patterns, or additional export columns are especially appreciated.

## 📄 License

MIT © ajendras. See [LICENSE](LICENSE) for details.

<!-- footer:start -->
<div align="center">

### ⭐ Star history

<a href="https://star-history.com/#ajendras/lead-mine&Date"><img src="https://api.star-history.com/svg?repos=ajendras/lead-mine&type=Date" alt="Star history" width="600"></a>

If **LeadMine** saves you time, a ⭐ helps others find it.

Made with ❤️ by [Ajendra](https://ajendra.info)

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:3f2a1e,100:d9c2a3&height=120&section=footer" width="100%" alt="">

</div>
<!-- footer:end -->
