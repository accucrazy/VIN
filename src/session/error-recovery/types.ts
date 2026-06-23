/**
 * Error-recovery types.
 */

/**
 * Error category.
 */
export type ErrorCategory =
  | 'rate_limit'      // API request rate limit
  | 'timeout'         // Request timeout
  | 'auth'            // Authentication error
  | 'billing'         // Billing problem
  | 'context_overflow' // Context window overflow
  | 'format'          // Malformed request/response
  | 'network'         // Network error
  | 'service'         // Server-side error
  | 'unknown';        // Unknown error

/**
 * Error severity.
 */
export type ErrorSeverity =
  | 'recoverable'     // Auto-recoverable
  | 'retryable'       // Retryable
  | 'user_action'     // Requires user action
  | 'fatal';          // Fatal

/**
 * Retry config.
 */
export interface RetryConfig {
  /** Max attempts (default 3). */
  attempts?: number;
  /** Min delay (ms, default 300). */
  minDelayMs?: number;
  /** Max delay (ms, default 30000). */
  maxDelayMs?: number;
  /** Jitter factor (0-1, default 0). */
  jitter?: number;
}

/**
 * Retry info.
 */
export interface RetryInfo {
  /** Current attempt number. */
  attempt: number;
  /** Max attempts. */
  maxAttempts: number;
  /** Delay before the next retry (ms). */
  delayMs: number;
  /** The error. */
  err: unknown;
  /** Operation label. */
  label?: string;
}

/**
 * Retry options.
 */
export interface RetryOptions extends RetryConfig {
  /** Operation label (for logging). */
  label?: string;
  /** Custom predicate for whether to retry. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Parse a retry-after delay from the error. */
  retryAfterMs?: (err: unknown) => number | undefined;
  /** Callback fired before a retry. */
  onRetry?: (info: RetryInfo) => void;
}

/**
 * Error classification result.
 */
export interface ErrorClassification {
  /** Error category. */
  category: ErrorCategory;
  /** Severity. */
  severity: ErrorSeverity;
  /** Whether it is retryable. */
  isRetryable: boolean;
  /** Whether the session should be reset. */
  shouldResetSession: boolean;
  /** Suggested user-facing message. */
  userMessage: string;
  /** Raw error message. */
  rawMessage?: string;
}

/**
 * Session-reset mode used during error recovery.
 */
export type RecoveryResetMode =
  | 'soft'    // Soft reset: clear transient state only
  | 'hard'    // Hard reset: clear all state
  | 'archive'; // Archive: keep history but start a new session

/**
 * Session-reset options.
 */
export interface SessionResetOptions {
  /** Reset mode. */
  mode: RecoveryResetMode;
  /** Reset reason. */
  reason?: string;
  /** Whether to preserve the transcript. */
  preserveTranscript?: boolean;
  /** Whether to notify the user. */
  notifyUser?: boolean;
}

/**
 * Session-reset result.
 */
export interface SessionResetResult {
  /** Whether it succeeded. */
  success: boolean;
  /** New session id (if a new session was created). */
  newSessionId?: string;
  /** Old session id. */
  oldSessionId: string;
  /** Reset mode. */
  mode: RecoveryResetMode;
  /** Error message (if it failed). */
  error?: string;
}

/**
 * Error-recovery strategy.
 */
export interface ErrorRecoveryStrategy {
  /** Strategy name. */
  name: string;
  /** Whether this strategy applies. */
  shouldApply: (error: Error, classification: ErrorClassification) => boolean;
  /** Execute the recovery operation. */
  execute: (error: Error, context: ErrorRecoveryContext) => Promise<ErrorRecoveryResult>;
  /** Priority (lower runs first). */
  priority: number;
}

/**
 * Error-recovery context.
 */
export interface ErrorRecoveryContext {
  /** Session id. */
  sessionId: string;
  /** User id. */
  userId: string;
  /** Error classification. */
  classification: ErrorClassification;
  /** Attempts so far. */
  attemptCount: number;
  /** Last attempt time. */
  lastAttemptAt?: number;
  /** Extra metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Error-recovery result.
 */
export interface ErrorRecoveryResult {
  /** Whether recovery succeeded. */
  recovered: boolean;
  /** Strategy used. */
  strategyUsed: string;
  /** Whether the session was reset. */
  sessionReset: boolean;
  /** New session id (if one was created). */
  newSessionId?: string;
  /** User-facing message. */
  userMessage?: string;
  /** Whether the original operation should be retried. */
  shouldRetryOperation: boolean;
  /** Extra data. */
  data?: Record<string, unknown>;
}

/**
 * Default retry config.
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  attempts: 3,
  minDelayMs: 300,
  maxDelayMs: 30_000,
  jitter: 0.1,
};

/**
 * Default user-facing message per error category.
 */
export const ERROR_MESSAGES: Record<ErrorCategory, string> = {
  rate_limit: 'The service is busy right now. Please try again shortly.',
  timeout: 'The request timed out. Please try again.',
  auth: 'Authentication failed. Please sign in again.',
  billing: 'There is a billing problem. Please check your account status.',
  context_overflow: 'The conversation grew too long and was cleaned up automatically. Please restate your request.',
  format: 'The request was malformed. Please try again shortly.',
  network: 'There is a network connectivity problem. Please check your connection.',
  service: 'The service is temporarily unavailable. Please try again shortly.',
  unknown: 'An unknown error occurred. Please try again shortly.',
};
