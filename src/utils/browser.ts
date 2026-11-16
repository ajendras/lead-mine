import { chromium } from 'playwright';
import type { Browser } from 'playwright';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

/**
 * Returns a random realistic desktop user-agent string from the curated list.
 * Helps vary fingerprints across sessions and leads when used with
 * newContext({ userAgent }).
 */
export function getRandomUserAgent(): string {
  const index = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[index]!;
}

let proxyList: string[] = [];
let proxyIndex = 0;

/**
 * Configures the proxy list for rotation. Subsequent calls to launchStealthBrowser()
 * will cycle through the provided proxies. Supports both datacenter and residential
 * proxies. For residential, use a single rotating gateway URL from your provider
 * (e.g. Bright Data, Smartproxy, Oxylabs) which typically rotates the underlying
 * IP on each new browser/context.
 *
 * Call with undefined/empty to disable.
 */
export function setProxies(proxies?: string | string[] | null): void {
  if (!proxies || (Array.isArray(proxies) && proxies.length === 0)) {
    proxyList = [];
    proxyIndex = 0;
    return;
  }

  proxyList = Array.isArray(proxies)
    ? proxies.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [proxies].filter((p): p is string => typeof p === 'string' && p.length > 0);

  proxyIndex = 0;

  console.log(`🔄 Configured proxy rotation with ${proxyList.length} proxy(ies)`);
}

/**
 * Internal helper to get (and advance) the next proxy in the rotation cycle.
 */
function getNextProxy(): string | undefined {
  if (proxyList.length === 0) {
    return undefined;
  }
  const proxy = proxyList[proxyIndex];
  proxyIndex = (proxyIndex + 1) % proxyList.length;
  return proxy;
}

/**
 * Launches a Chromium browser instance pre-configured with stealth-oriented
 * launch arguments that reduce automation signals. If proxies have been configured
 * via setProxies(), the next proxy in the rotation is automatically applied.
 * This provides proxy rotation across scrapers and the enricher.
 *
 * Residential proxy services are supported by supplying their authenticated
 * rotating gateway URL (credentials are never logged in cleartext).
 */
export async function launchStealthBrowser(): Promise<Browser> {
  const proxy = getNextProxy();

  const launchOptions: any = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=site-per-process,Translate,OptimizationHints,AudioServiceOutOfProcess',
      '--disable-infobars',
      '--disable-background-networking',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-web-security',
    ],
  };

  if (proxy) {
    launchOptions.proxy = { server: proxy };
  }

  const browser = await chromium.launch(launchOptions);

  return browser;
}
