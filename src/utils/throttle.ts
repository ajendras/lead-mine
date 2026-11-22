/**
 * Throttle utilities for polite scraping with rate limits and random delays.
 * Updated to support generic function signatures so it works with per-item processors.
 */

let lastRequestTime = 0;

/**
 * Wraps an async function with rate limiting based on RPM.
 * Generic over arguments to support functions like (item: T) => Promise<R>.
 */
export function withRateLimit<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  rpm: number = 20
): (...args: T) => Promise<R> {
  const intervalMs = 60000 / rpm;

  return async (...args: T): Promise<R> => {
    const now = Date.now();
    if (lastRequestTime > 0) {
      const elapsed = now - lastRequestTime;
      if (elapsed < intervalMs) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs - elapsed));
      }
    }
    lastRequestTime = Date.now();
    return fn(...args);
  };
}

/**
 * Adds a random polite delay between minMs and maxMs.
 */
export async function randomDelay(minMs: number = 1000, maxMs: number = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Simple throttle for non-async functions (kept for completeness).
 */
export function throttle<T extends any[], R>(
  fn: (...args: T) => R,
  delayMs: number
): (...args: T) => void {
  let lastCall = 0;
  return (...args: T) => {
    const now = Date.now();
    if (now - lastCall >= delayMs) {
      lastCall = now;
      fn(...args);
    }
  };
}
