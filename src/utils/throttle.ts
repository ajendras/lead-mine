/**
 * Utility for adding random delays to make scraping more human-like and avoid rate blocks.
 * Also provides withRateLimit higher-order function to throttle calls to a given RPM.
 */

export async function randomDelay(minMs = 800, maxMs = 2200): Promise<void> {
  if (minMs > maxMs) [minMs, maxMs] = [maxMs, minMs];
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Wraps a function with rate limiting. Calls are spaced at least 60_000 / rpm milliseconds apart.
 * Adds small random jitter using randomDelay to appear more natural.
 * Correctly forwards *all* arguments to the wrapped function using rest/spread (this was the root cause of the test failure).
 * Returns a promise regardless of whether the original fn is async.
 *
 * Used throughout the scrapers to respect politeness (e.g. rpm: 12 for enrichment).
 */
export function withRateLimit<T extends (...args: any[]) => any>(
  fn: T,
  rpm: number = 30
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  const minInterval = Math.max(100, Math.floor(60000 / rpm));

  let lastCallTime = 0;

  return async (...args: Parameters<T>) => {
    const now = Date.now();
    let waitTime = 0;

    if (now - lastCallTime < minInterval) {
      waitTime = minInterval - (now - lastCallTime) + Math.floor(Math.random() * 200);
    } else {
      // always add a small random delay for politeness between calls
      waitTime = Math.floor(Math.random() * 250) + 50;
    }

    if (waitTime > 0) {
      await randomDelay(waitTime, waitTime + 350);
    }

    lastCallTime = Date.now();

    const result = fn(...args);
    if (result instanceof Promise) {
      return await result;
    }
    return result as Awaited<ReturnType<T>>;
  };
}
