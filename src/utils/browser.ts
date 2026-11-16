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

/**
 * Launches a Chromium browser instance pre-configured with stealth-oriented
 * launch arguments that reduce automation signals. Callers should supply a
 * realistic userAgent via newContext({ userAgent: getRandomUserAgent() }) for
 * best results.
 *
 * Includes a stub for future proxy configuration. Headless defaults to true
 * (consistent with the CLI's default behavior).
 *
 * @returns Promise<Browser> ready for newContext/newPage usage
 */
export async function launchStealthBrowser(): Promise<Browser> {
  const browser = await chromium.launch({
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
  });

  // Proxy support stub – extend launch options with a proxy object when needed:
  // { proxy: { server: 'http://proxy.example.com:8080' } }

  return browser;
}
