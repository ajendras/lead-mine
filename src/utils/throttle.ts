import type { ScrapeSource } from '../types.js';
import { RATE_LIMIT_PRESETS, type RateLimitOptions } from '../types.js';

/**
 * Returns a random delay (in ms) between minMs and maxMs.
 * Used for polite jitter between requests.
 */
export async function randomDelay(minMs = 800, maxMs = 2200): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Wraps an async processor with per-source rate limiting and exponential
 * backoff on rate-limit/block errors (429, 403, timeout, etc.).
 *
 * Uses RATE_LIMIT_PRESETS when a source is supplied; falls back to
 * sensible defaults. Backoff is tracked per wrapper instance.
 */
export function withRateLimit<T, R>(
  processor: (item: T) => Promise<R>,
  rateLimit: RateLimitOptions = 20
): (item: T) => Promise<R> {
  const opts = typeof rateLimit === 'number'
    ? {
        rpm: rateLimit,
        source: 'maps' as ScrapeSource,
        backoffFactor: 1.8,
        maxDelayMs: 30000,
      }
    : {
        rpm:
          rateLimit.rpm ??
          (rateLimit.source && RATE_LIMIT_PRESETS[rateLimit.source]
            ? RATE_LIMIT_PRESETS[rateLimit.source].rpm
            : 20),
        source: rateLimit.source ?? 'maps',
        backoffFactor:
          rateLimit.backoffFactor ??
          (rateLimit.source && RATE_LIMIT_PRESETS[rateLimit.source]
            ? RATE_LIMIT_PRESETS[rateLimit.source].backoffFactor
            : 1.8),
        maxDelayMs:
          rateLimit.maxDelayMs ??
          (rateLimit.source && RATE_LIMIT_PRESETS[rateLimit.source]
            ? RATE_LIMIT_PRESETS[rateLimit.source].maxDelayMs
            : 30000),
      };

  const baseDelayMs = Math.floor(60000 / opts.rpm);
  let currentDelayMs = baseDelayMs;
  let lastCallMs = 0;

  return async (item: T): Promise<R> => {
    const now = Date.now();
    const timeSinceLast = now - lastCallMs;
    let waitMs = baseDelayMs - timeSinceLast;

    if (waitMs > 0) {
      await randomDelay(waitMs, waitMs + 420);
    } else if (currentDelayMs > baseDelayMs) {
      // still apply light jitter when recovering from backoff
      await randomDelay(420, 920);
    }

    lastCallMs = Date.now();

    try {
      const result = await processor(item);

      // success: gradually recover from any previous backoff
      if (currentDelayMs > baseDelayMs) {
        currentDelayMs = Math.max(baseDelayMs, Math.floor(currentDelayMs / 1.35));
      }

      return result;
    } catch (err: any) {
      const message = (err?.message || '').toLowerCase();
      if (
        message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('blocked') ||
        message.includes('403') ||
        message.includes('timeout')
      ) {
        currentDelayMs = Math.min(
          opts.maxDelayMs,
          Math.floor(currentDelayMs * opts.backoffFactor)
        );
        console.warn(
          `🚦 ${opts.source} rate limit / block detected – backing off to ~${currentDelayMs}ms`
        );
        await randomDelay(
          Math.floor(currentDelayMs * 0.7),
          Math.floor(currentDelayMs * 1.4)
        );
      }
      throw err;
    }
  };
}
