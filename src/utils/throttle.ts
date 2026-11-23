import { type ScrapeSource, RATE_LIMIT_PRESETS, type RateLimitOptions } from '../types.js';

/**
 * Returns a random delay between minMs and maxMs (inclusive).
 * Used throughout scrapers and enricher to appear more human-like.
 */
export async function randomDelay(minMs = 800, maxMs = 1800): Promise<void> {
  if (minMs > maxMs) [minMs, maxMs] = [maxMs, minMs];
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Wraps an async function with rate limiting and exponential backoff on rate-limit errors.
 * Supports passing a number for rpm, or an object/source to use the per-source presets defined
 * in RATE_LIMIT_PRESETS. The backoff multiplier grows on errors that look like rate limits/blocks
 * (429, timeout, forbidden, cloudflare, etc.) and decays on successful calls. This helps
 * recover gracefully without hammering targets.
 */
export function withRateLimit<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  rateLimit: RateLimitOptions = 20
): (...args: Args) => Promise<T> {
  let lastCall = 0;
  let backoffMultiplier = 1.0;
  let rpm = 20;
  let backoffFactor = 1.6;
  let maxBackoffMs = 30000;

  if (typeof rateLimit === 'number') {
    rpm = rateLimit;
  } else if (rateLimit.source && RATE_LIMIT_PRESETS[rateLimit.source as ScrapeSource]) {
    const preset = RATE_LIMIT_PRESETS[rateLimit.source as ScrapeSource];
    rpm = rateLimit.rpm ?? preset.rpm;
    backoffFactor = rateLimit.backoffFactor ?? preset.backoffFactor;
    maxBackoffMs = rateLimit.maxDelayMs ?? preset.maxDelayMs;
  } else if (typeof rateLimit === 'object' && rateLimit !== null) {
    rpm = rateLimit.rpm ?? rpm;
    backoffFactor = rateLimit.backoffFactor ?? backoffFactor;
    maxBackoffMs = rateLimit.maxDelayMs ?? maxBackoffMs;
  }

  const baseInterval = 60000 / rpm;

  return async (...args: Args): Promise<T> => {
    const now = Date.now();
    let targetWait = baseInterval * backoffMultiplier;

    if (now - lastCall < targetWait) {
      const toWait = targetWait - (now - lastCall) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, Math.floor(toWait)));
    }

    lastCall = Date.now();

    try {
      const result = await fn(...args);
      // decay backoff on success
      backoffMultiplier = Math.max(1.0, backoffMultiplier * 0.75);
      return result;
    } catch (err: any) {
      const message = (err?.message || '').toLowerCase();
      if (
        /429|rate.?limit|too.?many|blocked|forbidden|503|service unavailable|timeout|cloudflare|captcha/i.test(
          message
        )
      ) {
        backoffMultiplier = Math.min(
          backoffMultiplier * backoffFactor,
          maxBackoffMs / baseInterval + 1
        );
        console.warn(
          `🚦 Rate limit or block detected. Increasing backoff (x${backoffMultiplier.toFixed(
            1
          )}).`
        );
        await randomDelay(1200, 2800);
      }
      throw err;
    }
  };
}
