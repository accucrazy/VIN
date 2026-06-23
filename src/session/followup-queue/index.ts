/**
 * Followup-queue module.
 *
 * Handles user messages that arrive while the agent is busy.
 *
 * Supports 6 queue modes:
 * - steer: new messages steer the in-flight run
 * - interrupt: abort the in-flight run
 * - collect: merge all messages and respond once (default)
 * - followup: process messages one by one
 * - steer-backlog: steer + drain backlog
 * - queue: standard queue (same as steer)
 *
 * @example
 * ```typescript
 * import {
 *   enqueueFollowupRun,
 *   getFollowupQueueDepth,
 *   scheduleFollowupDrain,
 *   setActiveRunContext,
 *   setQueueMode,
 * } from './followup-queue';
 *
 * // Set the queue mode
 * setQueueMode('steer');
 *
 * // While the agent is busy, enqueue the new message
 * enqueueFollowupRun({
 *   prompt: message,
 *   conversationId,
 *   enqueuedAt: Date.now(),
 * });
 *
 * // After finishing, drain the queue per mode
 * scheduleFollowupDrain({
 *   runFollowup: async (run) => { ... },
 *   onCollect: async (prompt, items) => { ... },
 *   onSteer: async (prompt, items) => { ... },
 * });
 * ```
 */

// Types
export type {
  QueueMode,
  QueueDropPolicy,
  QueueDedupeMode,
  FollowupRun,
  QueueSettings,
  FollowupQueueState,
  SteerMessage,
  ActiveRunContext,
} from './types.js';

export {
  DEFAULT_QUEUE_SETTINGS,
  DEFAULT_QUEUE_DEBOUNCE_MS,
  DEFAULT_QUEUE_CAP,
  DEFAULT_QUEUE_DROP,
  createEmptyQueueState,
  normalizeQueueMode,
  normalizeQueueDropPolicy,
} from './types.js';

// State management
export {
  getFollowupQueue,
  peekFollowupQueue,
  clearFollowupQueue,
  resetFollowupQueue,
  setActiveRunContext,
  getActiveRunContext,
  updateActiveRunContext,
  clearActiveRunContext,
  hasActiveRun,
  setQueueMode,
  getQueueMode,
  setQueueDropPolicy,
} from './state.js';

// Enqueue
export {
  enqueueFollowupRun,
  getFollowupQueueDepth,
  hasPendingFollowups,
  hasPendingSteer,
  clearPendingSteer,
  consumeInterruptRequest,
  hasInterruptRequest,
  getDroppedCount,
  getDroppedSummary,
  clearDroppedCount,
} from './enqueue.js';

export type { EnqueueResult } from './enqueue.js';

// Drain
export {
  buildCollectPrompt,
  buildSteerPrompt,
  buildQueueSummaryPrompt,
  waitForQueueDebounce,
  scheduleFollowupDrain,
  groupFollowupRuns,
  isDraining,
  abortDrain,
} from './drain.js';

export type { DrainCallbacks } from './drain.js';
