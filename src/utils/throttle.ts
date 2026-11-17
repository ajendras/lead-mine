/**
 * Utility for polite scraping: random delays and rate-limited wrappers.
 * Used by all scrapers and the enricher to stay under rate limits and
 * appear more human-like.
 */

export async function randomDelay(minMs: number = 500, maxMs: number = 1500): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
}

export function withRateLimit<T, R>(
  fn: (arg: T) => Promise<R>,
  rpm: number = 20
): (arg: T) => Promise<R> {
  if (typeof fn !== 'function') {
    throw new Error('withRateLimit expects a function as first argument');
  }

  const minInterval = 60000 / Math.max(1, rpm);
  let lastCall = 0;

  return async (arg: T): Promise<R> => {
    const now = Date.now();
    const timeSinceLast = now - lastCall;

    if (timeSinceLast < minInterval) {
      const wait = minInterval - timeSinceLast;
      await randomDelay(wait, wait + 250);
    } else {
      // Always add a small random breathing room on every call
      await randomDelay(300, 750);
    }

    const result = await fn(arg);
    lastCall = Date.now();
    return result;
  };
}
