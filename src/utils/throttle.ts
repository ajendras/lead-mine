import type { RateLimitOptions, ScrapeSource } from '../types.js';

const lastCallTimes = new Map<string, number>();
const backoffDelays = new Map<string, number>();

/**
 * Returns a random delay between minMs and maxMs (inclusive).
 * Used to add jitter between requests and appear more human-like.
 */
export async function randomDelay(minMs = 800, maxMs = 2200): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Wraps an async function with per-source rate limiting.
 *
 * Accepts a number (treated as RPM) or a RateLimitOptions object.
 * Enforces RPM-based minimum interval between calls.
 * On 429 / rate-limit errors applies exponential backoff using backoffFactor
 * (capped by maxDelayMs). Retries once after backoff. State is kept in memory
 * for the lifetime of the process.
 */
export async function withRateLimit<T>(
  fn: () => Promise<T>,
  options: RateLimitOptions = 20
): Promise<T> {
  const opts = typeof options === 'number' ? { rpm: options } : options;
  const rpm = opts.rpm ?? 20;
  const backoffFactor = opts.backoffFactor ?? 1.5;
  const maxDelayMs = opts.maxDelayMs ?? 45000;
  const source = opts.source ?? ('default' as ScrapeSource);

  const key = `rl-${source}`;
  const intervalMs = Math.ceil(60000 / rpm);
  const now = Date.now();
  const last = lastCallTimes.get(key) ?? 0;

  if (now - last < intervalMs) {
    await new Promise((r) => setTimeout(r, intervalMs - (now - last)));
  }
  lastCallTimes.set(key, Date.now());

  try {
    const result = await fn();
    backoffDelays.delete(key);
    return result;
  } catch (err: any) {
    const message = (err?.message || '').toLowerCase();
    const isRateLimited =
      err?.status === 429 ||
      err?.response?.status === 429 ||
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('too many requests');

    if (isRateLimited) {
      let delay = backoffDelays.get(key) ?? intervalMs;
      delay = Math.min(Math.floor(delay * backoffFactor), maxDelayMs);
      backoffDelays.set(key, delay);

      console.warn(`🚦 Rate limit hit for ${source}. Backing off ${delay}ms (factor ${backoffFactor})...`);

      await new Promise((r) => setTimeout(r, delay));
      lastCallTimes.set(key, Date.now());
      return await fn();
    }

    throw err;
  }
}
