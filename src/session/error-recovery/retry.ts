/**
 * Retry utilities.
 *
 * Exponential backoff with jitter.
 */

import type {
  RetryConfig,
  RetryInfo,
  RetryOptions,
} from './types.js';
import { DEFAULT_RETRY_CONFIG } from './types.js';
import { isRetryableError } from './error-classifier.js';

// ==================== Helpers ====================

/**
 * Sleep for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure the value is a finite number.
 */
function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Clamp a value to a range.
 */
function clampNumber(
  value: unknown,
  fallback: number,
  min?: number,
  max?: number
): number {
  const next = asFiniteNumber(value);
  if (next === undefined) {
    return fallback;
  }
  const floor = typeof min === 'number' ? min : Number.NEGATIVE_INFINITY;
  const ceiling = typeof max === 'number' ? max : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(next, floor), ceiling);
}

/**
 * Resolve the retry config.
 */
export function resolveRetryConfig(
  defaults: Required<RetryConfig> = DEFAULT_RETRY_CONFIG,
  overrides?: RetryConfig
): Required<RetryConfig> {
  const attempts = Math.max(
    1,
    Math.round(clampNumber(overrides?.attempts, defaults.attempts, 1))
  );
  const minDelayMs = Math.max(
    0,
    Math.round(clampNumber(overrides?.minDelayMs, defaults.minDelayMs, 0))
  );
  const maxDelayMs = Math.max(
    minDelayMs,
    Math.round(clampNumber(overrides?.maxDelayMs, defaults.maxDelayMs, 0))
  );
  const jitter = clampNumber(overrides?.jitter, defaults.jitter, 0, 1);
  return { attempts, minDelayMs, maxDelayMs, jitter };
}

/**
 * Apply jitter to a delay.
 */
function applyJitter(delayMs: number, jitter: number): number {
  if (jitter <= 0) {
    return delayMs;
  }
  const offset = (Math.random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(delayMs * (1 + offset)));
}

/**
 * Compute the exponential-backoff delay.
 */
export function calculateBackoffDelay(
  attempt: number,
  config: Required<RetryConfig>
): number {
  const baseDelay = config.minDelayMs * Math.pow(2, attempt - 1);
  let delay = Math.min(baseDelay, config.maxDelayMs);
  delay = applyJitter(delay, config.jitter);
  return Math.min(Math.max(delay, config.minDelayMs), config.maxDelayMs);
}

// ==================== Main retry function ====================

/**
 * Retry an async function.
 *
 * @param fn The async function to retry.
 * @param attemptsOrOptions Attempt count or full options.
 * @param initialDelayMs Initial delay (only used when attemptsOrOptions is a number).
 * @returns A promise resolving to the function result.
 *
 * @example
 * ```typescript
 * // Simple usage
 * const result = await retryAsync(() => fetchData(), 3);
 *
 * // Full config
 * const result = await retryAsync(() => fetchData(), {
 *   attempts: 5,
 *   minDelayMs: 500,
 *   maxDelayMs: 10000,
 *   jitter: 0.2,
 *   label: 'fetchData',
 *   shouldRetry: (err) => isRetryableError(err),
 *   onRetry: (info) => console.log(`Retry ${info.attempt}/${info.maxAttempts}`),
 * });
 * ```
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  attemptsOrOptions: number | RetryOptions = 3,
  initialDelayMs = 300
): Promise<T> {
  // Simple mode: attempt count only.
  if (typeof attemptsOrOptions === 'number') {
    const attempts = Math.max(1, Math.round(attemptsOrOptions));
    let lastErr: unknown;

    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (i === attempts - 1) {
          break;
        }
        const delay = initialDelayMs * Math.pow(2, i);
        await sleep(delay);
      }
    }

    throw lastErr ?? new Error('Retry failed');
  }

  // Full config mode.
  const options = attemptsOrOptions;
  const resolved = resolveRetryConfig(DEFAULT_RETRY_CONFIG, options);
  const maxAttempts = resolved.attempts;
  const minDelayMs = resolved.minDelayMs;
  const maxDelayMs =
    Number.isFinite(resolved.maxDelayMs) && resolved.maxDelayMs > 0
      ? resolved.maxDelayMs
      : Number.POSITIVE_INFINITY;
  const jitter = resolved.jitter;
  const shouldRetry = options.shouldRetry ?? ((err) => isRetryableError(err));

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      // Should we keep retrying?
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        break;
      }

      // Compute the delay.
      const retryAfterMs = options.retryAfterMs?.(err);
      const hasRetryAfter = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs);
      const baseDelay = hasRetryAfter
        ? Math.max(retryAfterMs, minDelayMs)
        : minDelayMs * Math.pow(2, attempt - 1);
      let delay = Math.min(baseDelay, maxDelayMs);
      delay = applyJitter(delay, jitter);
      delay = Math.min(Math.max(delay, minDelayMs), maxDelayMs);

      // Fire the callback.
      options.onRetry?.({
        attempt,
        maxAttempts,
        delayMs: delay,
        err,
        label: options.label,
      });

      await sleep(delay);
    }
  }

  throw lastErr ?? new Error('Retry failed');
}

/**
 * Run an async function with a timeout.
 *
 * @param fn The async function to run.
 * @param timeoutMs Timeout (ms).
 * @param errorMessage Timeout error message.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

/**
 * Run an async function with both retry and timeout.
 */
export async function retryWithTimeout<T>(
  fn: () => Promise<T>,
  options: RetryOptions & { timeoutMs?: number }
): Promise<T> {
  const { timeoutMs, ...retryOptions } = options;

  const wrappedFn = timeoutMs
    ? () => withTimeout(fn, timeoutMs)
    : fn;

  return retryAsync(wrappedFn, retryOptions);
}

// ==================== Utilities ====================

/**
 * Create a retry-wrapping function.
 *
 * @param options Retry options.
 * @returns A wrapper function.
 *
 * @example
 * ```typescript
 * const withRetry = createRetryWrapper({ attempts: 3 });
 * const result = await withRetry(() => fetchData());
 * ```
 */
export function createRetryWrapper(options: RetryOptions = {}) {
  return <T>(fn: () => Promise<T>): Promise<T> => {
    return retryAsync(fn, options);
  };
}

/**
 * Delay execution.
 */
export async function delay(ms: number): Promise<void> {
  return sleep(ms);
}
