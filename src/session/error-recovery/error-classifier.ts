/**
 * Error classifier.
 *
 * Classifies an error's category and severity from its message.
 */

import type {
  ErrorCategory,
  ErrorSeverity,
  ErrorClassification,
} from './types.js';
import { ERROR_MESSAGES } from './types.js';

// ==================== Pattern definitions ====================

type ErrorPattern = RegExp | string;

/**
 * Pattern map per error category.
 */
const ERROR_PATTERNS: Record<ErrorCategory, readonly ErrorPattern[]> = {
  rate_limit: [
    /rate[_\s]?limit/i,
    /too many requests/i,
    /429/,
    'exceeded your current quota',
    'resource has been exhausted',
    'quota exceeded',
    'resource_exhausted',
    'usage limit',
  ],
  timeout: [
    'timeout',
    'timed out',
    'deadline exceeded',
    'context deadline exceeded',
    /ETIMEDOUT/i,
    /ESOCKETTIMEDOUT/i,
  ],
  auth: [
    /invalid[_\s]?api[_\s]?key/i,
    'incorrect api key',
    'invalid token',
    'authentication',
    're-authenticate',
    'oauth token refresh failed',
    'unauthorized',
    'forbidden',
    'access denied',
    'expired',
    'token has expired',
    /\b401\b/,
    /\b403\b/,
    'no credentials found',
    'no api key found',
  ],
  billing: [
    /\b402\b/,
    'payment required',
    'insufficient credits',
    'credit balance',
    'plans & billing',
    'billing',
  ],
  context_overflow: [
    'request_too_large',
    'request exceeds the maximum size',
    'context length exceeded',
    'maximum context length',
    'prompt is too long',
    'exceeds model context window',
    /request size exceeds.*context window/i,
    'context overflow',
    /413.*too large/i,
  ],
  format: [
    'string should match pattern',
    'tool_use.id',
    'tool_use_id',
    'invalid request format',
    /incorrect role information/i,
    /roles must alternate/i,
    /tool_(?:use|call)\.(?:input|arguments).*?(?:field required|required)/i,
  ],
  network: [
    /ECONNREFUSED/i,
    /ECONNRESET/i,
    /ENOTFOUND/i,
    /ENETUNREACH/i,
    'network error',
    'fetch failed',
    'connection refused',
    'dns resolution',
  ],
  service: [
    /\b500\b/,
    /\b502\b/,
    /\b503\b/,
    /\b504\b/,
    'internal server error',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
    'overloaded_error',
    'overloaded',
  ],
  unknown: [], // Fallback category.
};

/**
 * Severity map per error category.
 */
const SEVERITY_MAP: Record<ErrorCategory, ErrorSeverity> = {
  rate_limit: 'retryable',
  timeout: 'retryable',
  auth: 'user_action',
  billing: 'user_action',
  context_overflow: 'recoverable',
  format: 'recoverable',
  network: 'retryable',
  service: 'retryable',
  unknown: 'retryable',
};

/**
 * Error categories that warrant a session reset.
 */
const SESSION_RESET_CATEGORIES: Set<ErrorCategory> = new Set([
  'context_overflow',
  'format',
]);

// ==================== Helpers ====================

/**
 * Coerce an error to a string.
 */
function errorToString(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    // Try to parse an API error response.
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      return obj.message;
    }
    if (typeof obj.error === 'string') {
      return obj.error;
    }
    if (obj.error && typeof obj.error === 'object') {
      const innerError = obj.error as Record<string, unknown>;
      if (typeof innerError.message === 'string') {
        return innerError.message;
      }
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/**
 * Check whether a string matches any pattern.
 */
function matchesPatterns(value: string, patterns: readonly ErrorPattern[]): boolean {
  if (!value || patterns.length === 0) {
    return false;
  }
  const lower = value.toLowerCase();
  return patterns.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(value) : lower.includes(pattern.toLowerCase())
  );
}

// ==================== Main classification ====================

/**
 * Classify an error.
 *
 * @param error An error object or message.
 * @returns The classification result.
 */
export function classifyError(error: unknown): ErrorClassification {
  const rawMessage = errorToString(error);

  // Try each category in order.
  for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
    if (patterns.length > 0 && matchesPatterns(rawMessage, patterns)) {
      const errorCategory = category as ErrorCategory;
      const severity = SEVERITY_MAP[errorCategory];

      return {
        category: errorCategory,
        severity,
        isRetryable: severity === 'retryable' || severity === 'recoverable',
        shouldResetSession: SESSION_RESET_CATEGORIES.has(errorCategory),
        userMessage: ERROR_MESSAGES[errorCategory],
        rawMessage,
      };
    }
  }

  // Default to unknown.
  return {
    category: 'unknown',
    severity: 'retryable',
    isRetryable: true,
    shouldResetSession: false,
    userMessage: ERROR_MESSAGES.unknown,
    rawMessage,
  };
}

// ==================== Specific error detectors ====================

/**
 * Whether this is a rate-limit error.
 */
export function isRateLimitError(error: unknown): boolean {
  const message = errorToString(error);
  return matchesPatterns(message, ERROR_PATTERNS.rate_limit);
}

/**
 * Whether this is a timeout error.
 */
export function isTimeoutError(error: unknown): boolean {
  const message = errorToString(error);
  return matchesPatterns(message, ERROR_PATTERNS.timeout);
}

/**
 * Whether this is an authentication error.
 */
export function isAuthError(error: unknown): boolean {
  const message = errorToString(error);
  return matchesPatterns(message, ERROR_PATTERNS.auth);
}

/**
 * Whether this is a billing error.
 */
export function isBillingError(error: unknown): boolean {
  const message = errorToString(error);
  return matchesPatterns(message, ERROR_PATTERNS.billing);
}

/**
 * Whether this is a context-overflow error.
 */
export function isContextOverflowError(error: unknown): boolean {
  const message = errorToString(error);
  return matchesPatterns(message, ERROR_PATTERNS.context_overflow);
}

/**
 * Whether this is a format error.
 */
export function isFormatError(error: unknown): boolean {
  const message = errorToString(error);
  return matchesPatterns(message, ERROR_PATTERNS.format);
}

/**
 * Whether this is a network error.
 */
export function isNetworkError(error: unknown): boolean {
  const message = errorToString(error);
  return matchesPatterns(message, ERROR_PATTERNS.network);
}

/**
 * Whether this is a service error.
 */
export function isServiceError(error: unknown): boolean {
  const message = errorToString(error);
  return matchesPatterns(message, ERROR_PATTERNS.service);
}

/**
 * Whether the error is retryable.
 */
export function isRetryableError(error: unknown): boolean {
  const classification = classifyError(error);
  return classification.isRetryable;
}

/**
 * Whether the error requires user action.
 */
export function requiresUserAction(error: unknown): boolean {
  const classification = classifyError(error);
  return classification.severity === 'user_action';
}

/**
 * Whether the error should reset the session.
 */
export function shouldResetSession(error: unknown): boolean {
  const classification = classifyError(error);
  return classification.shouldResetSession;
}

// ==================== Message formatting ====================

/**
 * Format an error message for the user.
 */
export function formatErrorForUser(error: unknown): string {
  const classification = classifyError(error);
  return classification.userMessage;
}

/**
 * Format an error message for the log.
 */
export function formatErrorForLog(error: unknown): string {
  const classification = classifyError(error);
  const raw = classification.rawMessage || 'Unknown error';
  return `[${classification.category}/${classification.severity}] ${raw}`;
}
