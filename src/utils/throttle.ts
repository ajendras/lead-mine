/**
 * Utility for polite, human-like delays and rate limiting.
 * Prevents aggressive scraping that could lead to blocks while
 * maintaining reasonable throughput.
 */

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Pauses execution for a random duration between `minMs` and `maxMs`.
 * Adds natural jitter to mimic human browsing behavior and reduce
 * the chance of being flagged by anti-bot systems.
 *
 * @param minMs - Minimum delay in milliseconds (must be >= 0)
 * @param maxMs - Maximum delay in milliseconds (must be >= minMs)
 * @returns Promise that resolves after the random delay
 * @throws {Error} If bounds are negative or min > max (after auto-swap)
 */
export async function randomDelay(
  minMs: number = 800,
  maxMs: number = 2200
): Promise<void> {
  if (typeof minMs !== 'number' || typeof maxMs !== 'number') {
    throw new Error('randomDelay: minMs and maxMs must be numbers');
  }
  if (minMs < 0 || maxMs < 0) {
    throw new Error('randomDelay: delay bounds must be non-negative numbers');
  }
  const effectiveMin = Math.min(minMs, maxMs);
  const effectiveMax = Math.max(minMs, maxMs);

  const delay = getRandomInt(effectiveMin, effectiveMax);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Wraps an async function with a rate limiter that enforces a maximum
 * number of calls per minute using a sliding-window approach.
 * Automatically inserts delays when the limit would be exceeded.
 *
 * The wrapper is safe for both sequential and concurrent usage.
 *
 * @param fn - Async function to rate-limit
 * @param rpm - Maximum requests per minute (1-120). Default 20.
 * @returns Wrapped function that respects the rate limit
 * @throws {Error} If rpm is outside the allowed range
 */
export function withRateLimit<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  rpm: number = 20
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  if (typeof rpm !== 'number' || !Number.isInteger(rpm)) {
    throw new Error('withRateLimit: rpm must be an integer');
  }
  if (rpm < 1 || rpm > 120) {
    throw new Error(
      'withRateLimit: rpm must be between 1 and 120 (reasonable politeness range)'
    );
  }

  const windowMs = 60_000;
  const callTimestamps: number[] = [];

  return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    const now = Date.now();

    // Remove calls older than the sliding window
    while (callTimestamps.length > 0 && callTimestamps[0]! <= now - windowMs) {
      callTimestamps.shift();
    }

    // If we've hit the limit, wait until the oldest call falls out of the window
    if (callTimestamps.length >= rpm) {
      const waitUntil = callTimestamps[0]! + windowMs + 50; // small safety buffer
      const waitTime = waitUntil - now;
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    callTimestamps.push(Date.now());
    return fn(...args);
  };
}
