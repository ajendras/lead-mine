let lastRequestTime = Date.now() - 10000;

/**
 * Returns a promise that resolves after a random delay between min and max ms.
 * Used to make scraping appear more human and avoid rate limits.
 */
export function randomDelay(min: number = 800, max: number = 2200): Promise<void> {
  const delay = Math.random() * (max - min) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Wraps the given async operation with rate limiting based on RPM.
 * The returned function can be called to execute the operation under the rate limit.
 * Uses a shared timer to throttle requests across different scrapers.
 */
export function withRateLimit<T>(
  operation: () => Promise<T>,
  rpm: number = 20
): () => Promise<T> {
  return async () => {
    const minInterval = 60000 / rpm;
    const now = Date.now();
    const timeElapsed = now - lastRequestTime;

    if (timeElapsed < minInterval) {
      await randomDelay(
        Math.max(0, minInterval - timeElapsed),
        minInterval - timeElapsed + 150
      );
    }

    lastRequestTime = Date.now();
    return operation();
  };
}
