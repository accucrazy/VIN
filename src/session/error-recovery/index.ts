/**
 * Error-recovery module.
 *
 * Error handling, retry, and session recovery.
 *
 * Features:
 * - Error classification (rate_limit, timeout, auth, context_overflow, ...)
 * - Auto-retry (exponential backoff, jitter)
 * - Session reset (soft, hard, archive)
 * - Recovery-strategy management
 *
 * @example
 * ```typescript
 * import {
 *   classifyError,
 *   retryAsync,
 *   getErrorRecoveryManager,
 * } from './error-recovery';
 *
 * // Classify an error
 * const classification = classifyError(error);
 * console.log(classification.category, classification.userMessage);
 *
 * // Run with retry
 * const result = await retryAsync(() => fetchData(), {
 *   attempts: 3,
 *   minDelayMs: 500,
 * });
 *
 * // Use the recovery manager
 * const manager = getErrorRecoveryManager();
 * const { result, error, recovery } = await manager.executeWithRecovery(
 *   () => processMessage(),
 *   sessionId,
 *   userId
 * );
 * ```
 */

// Types
export type {
  ErrorCategory,
  ErrorSeverity,
  ErrorClassification,
  RetryConfig,
  RetryInfo,
  RetryOptions,
  RecoveryResetMode,
  SessionResetOptions,
  SessionResetResult,
  ErrorRecoveryStrategy,
  ErrorRecoveryContext,
  ErrorRecoveryResult,
} from './types.js';

export {
  DEFAULT_RETRY_CONFIG,
  ERROR_MESSAGES,
} from './types.js';

// Error classifier
export {
  classifyError,
  isRateLimitError,
  isTimeoutError,
  isAuthError,
  isBillingError,
  isContextOverflowError,
  isFormatError,
  isNetworkError,
  isServiceError,
  isRetryableError,
  requiresUserAction,
  shouldResetSession,
  formatErrorForUser,
  formatErrorForLog,
} from './error-classifier.js';

// Retry utilities
export {
  sleep,
  delay,
  resolveRetryConfig,
  calculateBackoffDelay,
  retryAsync,
  withTimeout,
  retryWithTimeout,
  createRetryWrapper,
} from './retry.js';

// Session reset
export {
  SessionResetHandler,
  getSessionResetHandler,
  resetSessionResetHandler,
  softResetSession,
  hardResetSession,
  archiveAndCreateSession,
} from './session-reset.js';

export type {
  SessionResetEvent,
  SessionResetListener,
} from './session-reset.js';

// Recovery manager
export {
  ErrorRecoveryManager,
  getErrorRecoveryManager,
  initErrorRecoveryManager,
  resetErrorRecoveryManager,
} from './recovery-manager.js';
