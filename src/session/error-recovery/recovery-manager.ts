/**
 * Error-recovery manager.
 *
 * Coordinates error classification, retry, and session reset.
 */

import type {
  ErrorClassification,
  ErrorRecoveryStrategy,
  ErrorRecoveryContext,
  ErrorRecoveryResult,
  RetryOptions,
} from './types.js';
import { classifyError, formatErrorForUser, formatErrorForLog } from './error-classifier.js';
import { retryAsync } from './retry.js';
import { SessionResetHandler, getSessionResetHandler } from './session-reset.js';

// ==================== Type definitions ====================

/**
 * Session-manager interface.
 */
interface SessionManagerLike {
  getSession(sessionId: string): { userId: string; status: string } | null;
  setStatus(sessionId: string, status: string): void;
  deleteSession(sessionId: string): boolean;
  getOrCreateSession(userId: string): { id: string };
}

/**
 * A recorded recovery attempt.
 */
interface RecoveryAttempt {
  sessionId: string;
  errorCategory: string;
  timestamp: number;
  strategy: string;
  success: boolean;
}

// ==================== Built-in recovery strategies ====================

/**
 * Retry strategy: auto-retry for retryable errors.
 */
const retryStrategy: ErrorRecoveryStrategy = {
  name: 'retry',
  priority: 1,
  shouldApply: (_, classification) => classification.isRetryable,
  execute: async (error, context) => {
    // The retry strategy does not perform the retry itself; it just signals intent.
    return {
      recovered: false,
      strategyUsed: 'retry',
      sessionReset: false,
      shouldRetryOperation: true,
      userMessage: 'Retrying, please wait...',
    };
  },
};

/**
 * Session-reset strategy: reset the session for errors that warrant it.
 */
const sessionResetStrategy: ErrorRecoveryStrategy = {
  name: 'session-reset',
  priority: 2,
  shouldApply: (_, classification) => classification.shouldResetSession,
  execute: async (error, context) => {
    const handler = getSessionResetHandler();
    // Return the strategy recommendation only; the caller performs the reset.
    return {
      recovered: false,
      strategyUsed: 'session-reset',
      sessionReset: false, // Not yet executed.
      shouldRetryOperation: false,
      userMessage: context.classification.userMessage,
      data: {
        recommendedResetMode: handler.determineResetMode(context.classification),
      },
    };

    function classification() {
      return context.classification;
    }
  },
};

/**
 * User-notification strategy: notify the user for errors that require action.
 */
const userNotificationStrategy: ErrorRecoveryStrategy = {
  name: 'user-notification',
  priority: 3,
  shouldApply: (_, classification) => classification.severity === 'user_action',
  execute: async (error, context) => {
    return {
      recovered: false,
      strategyUsed: 'user-notification',
      sessionReset: false,
      shouldRetryOperation: false,
      userMessage: context.classification.userMessage,
    };
  },
};

// ==================== Recovery manager ====================

/**
 * Error-recovery manager.
 */
export class ErrorRecoveryManager {
  private strategies: ErrorRecoveryStrategy[] = [];
  private sessionManager: SessionManagerLike | null = null;
  private resetHandler: SessionResetHandler;
  private attemptHistory: RecoveryAttempt[] = [];
  private maxHistorySize: number = 100;

  constructor() {
    this.resetHandler = getSessionResetHandler();
    // Register the built-in strategies.
    this.registerStrategy(retryStrategy);
    this.registerStrategy(sessionResetStrategy);
    this.registerStrategy(userNotificationStrategy);
  }

  /**
   * Set the session manager.
   */
  setSessionManager(manager: SessionManagerLike): void {
    this.sessionManager = manager;
  }

  /**
   * Register a recovery strategy.
   */
  registerStrategy(strategy: ErrorRecoveryStrategy): void {
    this.strategies.push(strategy);
    // Sort by priority.
    this.strategies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Handle an error and attempt recovery.
   *
   * @param error The error.
   * @param sessionId Session id.
   * @param userId User id.
   * @param attemptCount Attempts so far (optional).
   * @returns The recovery result.
   */
  async handleError(
    error: Error,
    sessionId: string,
    userId: string,
    attemptCount: number = 0
  ): Promise<ErrorRecoveryResult> {
    // Classify the error.
    const classification = classifyError(error);
    console.log(`[ErrorRecoveryManager] ${formatErrorForLog(error)}`);

    // Build the recovery context.
    const context: ErrorRecoveryContext = {
      sessionId,
      userId,
      classification,
      attemptCount,
      lastAttemptAt: Date.now(),
    };

    // Find an applicable strategy.
    for (const strategy of this.strategies) {
      if (strategy.shouldApply(error, classification)) {
        const result = await strategy.execute(error, context);

        // Record the attempt.
        this.recordAttempt({
          sessionId,
          errorCategory: classification.category,
          timestamp: Date.now(),
          strategy: strategy.name,
          success: result.recovered,
        });

        return result;
      }
    }

    // No applicable strategy.
    return {
      recovered: false,
      strategyUsed: 'none',
      sessionReset: false,
      shouldRetryOperation: false,
      userMessage: formatErrorForUser(error),
    };
  }

  /**
   * Execute a function with automatic recovery.
   *
   * @param fn The function to run.
   * @param sessionId Session id.
   * @param userId User id.
   * @param options Retry options.
   */
  async executeWithRecovery<T>(
    fn: () => Promise<T>,
    sessionId: string,
    userId: string,
    options: RetryOptions = {}
  ): Promise<{ result?: T; error?: Error; recovery?: ErrorRecoveryResult }> {
    let lastError: Error | undefined;
    let attemptCount = 0;
    const maxAttempts = options.attempts ?? 3;

    while (attemptCount < maxAttempts) {
      attemptCount++;

      try {
        const result = await fn();
        return { result };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Attempt recovery.
        const recovery = await this.handleError(lastError, sessionId, userId, attemptCount);

        // If we should not retry, return immediately.
        if (!recovery.shouldRetryOperation) {
          return { error: lastError, recovery };
        }

        // If a session reset is recommended, perform it.
        if (recovery.data?.recommendedResetMode && this.sessionManager) {
          const resetResult = await this.resetHandler.autoResetForError(
            this.sessionManager,
            sessionId,
            classifyError(lastError)
          );

          if (resetResult.success && resetResult.newSessionId) {
            return {
              error: lastError,
              recovery: {
                ...recovery,
                sessionReset: true,
                newSessionId: resetResult.newSessionId,
              },
            };
          }
        }

        // Wait, then retry.
        if (attemptCount < maxAttempts) {
          const delay = (options.minDelayMs ?? 300) * Math.pow(2, attemptCount - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed.
    const finalRecovery = await this.handleError(lastError!, sessionId, userId, attemptCount);
    return { error: lastError, recovery: finalRecovery };
  }

  /**
   * Manually trigger a session reset.
   */
  async resetSession(
    sessionId: string,
    mode: 'soft' | 'hard' | 'archive' = 'hard',
    reason?: string
  ): Promise<{ success: boolean; newSessionId?: string; error?: string }> {
    if (!this.sessionManager) {
      return { success: false, error: 'Session manager not configured' };
    }

    const result = await this.resetHandler.resetSession(this.sessionManager, sessionId, {
      mode,
      reason,
    });

    return {
      success: result.success,
      newSessionId: result.newSessionId,
      error: result.error,
    };
  }

  /**
   * Record a recovery attempt.
   */
  private recordAttempt(attempt: RecoveryAttempt): void {
    this.attemptHistory.push(attempt);

    // Cap the history size.
    if (this.attemptHistory.length > this.maxHistorySize) {
      this.attemptHistory = this.attemptHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get the recovery history for a session.
   */
  getRecoveryHistory(sessionId: string): RecoveryAttempt[] {
    return this.attemptHistory.filter((a) => a.sessionId === sessionId);
  }

  /**
   * Clear the history.
   */
  clearHistory(): void {
    this.attemptHistory = [];
  }
}

// ==================== Singleton management ====================

let defaultManager: ErrorRecoveryManager | null = null;

/**
 * Get the default error-recovery manager.
 */
export function getErrorRecoveryManager(): ErrorRecoveryManager {
  if (!defaultManager) {
    defaultManager = new ErrorRecoveryManager();
  }
  return defaultManager;
}

/**
 * Initialize the error-recovery manager.
 */
export function initErrorRecoveryManager(sessionManager: SessionManagerLike): ErrorRecoveryManager {
  const manager = getErrorRecoveryManager();
  manager.setSessionManager(sessionManager);
  return manager;
}

/**
 * Reset the error-recovery manager (mainly for testing).
 */
export function resetErrorRecoveryManager(): void {
  defaultManager = null;
}
