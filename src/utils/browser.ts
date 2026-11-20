import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

let proxies: string[] = [];
let proxyIndex = 0;

export function setProxies(input: string | string[] | undefined): void {
  if (!input) {
    proxies = [];
    proxyIndex = 0;
    return;
  }
  proxies = Array.isArray(input) ? [...input] : [input];
  proxyIndex = 0;
}

export function getRandomUserAgent(): string {
  return userAgents[Math.floor(Math.random() * userAgents.length)]!;
}

export async function launchStealthBrowser(headless: boolean = true): Promise<Browser> {
  const proxy = proxies.length > 0 ? proxies[proxyIndex % proxies.length] : undefined;
  if (proxies.length > 0) {
    proxyIndex += 1;
  }
  const browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=site-per-process',
    ],
    proxy: proxy ? { server: proxy } : undefined,
  });
  return browser;
}

/**
 * Manages a pool of browser instances for parallel execution of tasks using
 * separate contexts. Limits resource usage while enabling concurrency.
 * Each run() acquires a browser, creates a fresh context with random UA and proxy rotation,
 * executes the task, then releases the browser for the next task.
 */
export class BrowserWorkerPool {
  public readonly size: number;
  private workers: Browser[] = [];
  private inUse: Set<number> = new Set();
  private queue: Array<() => void> = [];
  private initialized = false;

  constructor(size: number = 3) {
    this.size = Math.max(1, Math.min(size, 6));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    console.log(`🔧 Initializing browser worker pool (size=${this.size}) for parallel contexts...`);
    for (let i = 0; i < this.size; i++) {
      const browser = await launchStealthBrowser(true);
      this.workers.push(browser);
    }
    this.initialized = true;
  }

  private getNextProxy(): string | undefined {
    if (proxies.length === 0) return undefined;
    const proxy = proxies[proxyIndex % proxies.length];
    proxyIndex = (proxyIndex + 1) % proxies.length;
    return proxy;
  }

  /**
   * Runs a task with a dedicated browser context from the pool.
   * Guarantees the context is cleaned up after use.
   */
  async run<T>(task: (page: Page) => Promise<T>): Promise<T> {
    await this.initialize();
    const workerId = await this.acquire();
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      const proxy = this.getNextProxy();
      context = await this.workers[workerId]!.newContext({
        userAgent: getRandomUserAgent(),
        viewport: { width: 1366, height: 920 },
        locale: 'en-US',
        timezoneId: 'America/Los_Angeles',
        proxy: proxy ? { server: proxy } : undefined,
      });
      page = await context.newPage();
      await page.addInitScript(() => {
        (window as any).navigator.webdriver = undefined;
      });
      const result = await task(page);
      return result;
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      this.release(workerId);
    }
  }

  private async acquire(): Promise<number> {
    for (let i = 0; i < this.workers.length; i++) {
      if (!this.inUse.has(i)) {
        this.inUse.add(i);
        return i;
      }
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.acquire().then(resolve);
      });
    });
  }

  private release(id: number): void {
    this.inUse.delete(id);
    if (this.queue.length > 0) {
      const nextTask = this.queue.shift()!;
      nextTask();
    }
  }

  async close(): Promise<void> {
    for (const browser of this.workers) {
      await browser.close().catch(() => {});
    }
    this.workers = [];
    this.inUse.clear();
    this.queue = [];
    this.initialized = false;
  }
}

let globalPool: BrowserWorkerPool | null = null;

export function getWorkerPool(concurrency: number = 3): BrowserWorkerPool {
  if (!globalPool) {
    globalPool = new BrowserWorkerPool(concurrency);
  }
  return globalPool;
}

export async function closeWorkerPool(): Promise<void> {
  if (globalPool) {
    await globalPool.close();
    globalPool = null;
  }
}
