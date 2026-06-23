/**
 * Session-reset handler.
 *
 * Handles session reset and recovery under various error conditions.
 */

import type {
  RecoveryResetMode,
  SessionResetOptions,
  SessionResetResult,
  ErrorClassification,
} from './types.js';

// ==================== Type definitions ====================

/**
 * Session-manager interface (loosely coupled).
 */
interface SessionManagerLike {
  getSession(sessionId: string): { userId: string; status: string } | null;
  setStatus(sessionId: string, status: string): void;
  deleteSession(sessionId: string): boolean;
  getOrCreateSession(userId: string): { id: string };
}

/**
 * Session-reset event.
 */
export interface SessionResetEvent {
  type: 'session_reset';
  sessionId: string;
  newSessionId?: string;
  mode: RecoveryResetMode;
  reason?: string;
  timestamp: number;
}

/**
 * Reset-event listener.
 */
export type SessionResetListener = (event: SessionResetEvent) => void;

// ==================== Session-reset handler ====================

/**
 * Session-reset handler.
 */
export class SessionResetHandler {
  private listeners: Set<SessionResetListener> = new Set();

  /**
   * Execute a session reset.
   *
   * @param sessionManager The session manager.
   * @param sessionId The session id to reset.
   * @param options Reset options.
   * @returns The reset result.
   */
  async resetSession(
    sessionManager: SessionManagerLike,
    sessionId: string,
    options: SessionResetOptions
  ): Promise<SessionResetResult> {
    const { mode, reason, notifyUser } = options;

    try {
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return {
          success: false,
          oldSessionId: sessionId,
          mode,
          error: 'Session not found',
        };
      }

      const userId = session.userId;
      let newSessionId: string | undefined;

      switch (mode) {
        case 'soft':
          // Soft reset: update status only.
          sessionManager.setStatus(sessionId, 'active');
          break;

        case 'hard':
          // Hard reset: delete and recreate.
          sessionManager.deleteSession(sessionId);
          const newSession = sessionManager.getOrCreateSession(userId);
          newSessionId = newSession.id;
          break;

        case 'archive':
          // Archive: mark completed and create a new session.
          sessionManager.setStatus(sessionId, 'completed');
          const archivedNewSession = sessionManager.getOrCreateSession(userId);
          newSessionId = archivedNewSession.id;
          break;
      }

      // Emit the reset event.
      const event: SessionResetEvent = {
        type: 'session_reset',
        sessionId,
        newSessionId,
        mode,
        reason,
        timestamp: Date.now(),
      };
      this.notifyListeners(event);

      return {
        success: true,
        oldSessionId: sessionId,
        newSessionId,
        mode,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[SessionResetHandler] Reset failed: ${errorMessage}`);

      return {
        success: false,
        oldSessionId: sessionId,
        mode,
        error: errorMessage,
      };
    }
  }

  /**
   * Determine the reset mode from an error classification.
   */
  determineResetMode(classification: ErrorClassification): RecoveryResetMode {
    switch (classification.category) {
      case 'context_overflow':
        // Context overflow: archive the old session and start fresh.
        return 'archive';

      case 'format':
        // Format error: session state may be corrupt, hard reset.
        return 'hard';

      default:
        // Other errors: try a soft reset.
        return 'soft';
    }
  }

  /**
   * Auto-reset a session based on an error.
   */
  async autoResetForError(
    sessionManager: SessionManagerLike,
    sessionId: string,
    classification: ErrorClassification
  ): Promise<SessionResetResult> {
    if (!classification.shouldResetSession) {
      return {
        success: false,
        oldSessionId: sessionId,
        mode: 'soft',
        error: 'Reset not recommended for this error type',
      };
    }

    const mode = this.determineResetMode(classification);
    const reason = `Auto-reset due to ${classification.category} error`;

    return this.resetSession(sessionManager, sessionId, {
      mode,
      reason,
      notifyUser: true,
    });
  }

  /**
   * Add a reset-event listener.
   */
  addListener(listener: SessionResetListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a reset-event listener.
   */
  removeListener(listener: SessionResetListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Notify all listeners.
   */
  private notifyListeners(event: SessionResetEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[SessionResetHandler] Listener error:', err);
      }
    }
  }
}

// ==================== Factory functions ====================

let defaultHandler: SessionResetHandler | null = null;

/**
 * Get the default session-reset handler.
 */
export function getSessionResetHandler(): SessionResetHandler {
  if (!defaultHandler) {
    defaultHandler = new SessionResetHandler();
  }
  return defaultHandler;
}

/**
 * Reset the default handler (mainly for testing).
 */
export function resetSessionResetHandler(): void {
  defaultHandler = null;
}

// ==================== Convenience functions ====================

/**
 * Soft-reset a session.
 */
export async function softResetSession(
  sessionManager: SessionManagerLike,
  sessionId: string,
  reason?: string
): Promise<SessionResetResult> {
  const handler = getSessionResetHandler();
  return handler.resetSession(sessionManager, sessionId, {
    mode: 'soft',
    reason,
  });
}

/**
 * Hard-reset a session.
 */
export async function hardResetSession(
  sessionManager: SessionManagerLike,
  sessionId: string,
  reason?: string
): Promise<SessionResetResult> {
  const handler = getSessionResetHandler();
  return handler.resetSession(sessionManager, sessionId, {
    mode: 'hard',
    reason,
  });
}

/**
 * Archive and create a new session.
 */
export async function archiveAndCreateSession(
  sessionManager: SessionManagerLike,
  sessionId: string,
  reason?: string
): Promise<SessionResetResult> {
  const handler = getSessionResetHandler();
  return handler.resetSession(sessionManager, sessionId, {
    mode: 'archive',
    reason,
  });
}
