// STEP 04 · Retry with backoff + timeout — pure helpers (unit-tested).

export interface RetryOptions {
  /** Total attempts (1 = no retry). */
  attempts: number;
  /** Base backoff delay in ms (linear: delay * attemptIndex). */
  baseDelayMs: number;
  /** Optional predicate to decide whether an error is retryable. */
  shouldRetry?: (error: unknown) => boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying on failure up to `attempts` times with linear backoff.
 * Returns the resolved value and how many attempts it took.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<{ value: T; attempts: number }> {
  const { attempts, baseDelayMs, shouldRetry } = options;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const value = await fn();
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (shouldRetry && !shouldRetry(error)) throw error;
      if (attempt < attempts) {
        await sleep(baseDelayMs * attempt); // linear backoff
      }
    }
  }
  throw lastError;
}

/** Rejects with a timeout error if `promise` does not settle within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Gateway timeout after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
