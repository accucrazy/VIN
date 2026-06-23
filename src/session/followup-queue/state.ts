/**
 * Followup-queue state management.
 *
 * Manages a single followup-message queue and its mode / drop policy.
 */

import type { ActiveRunContext, FollowupQueueState, QueueSettings, QueueMode, QueueDropPolicy } from './types.js';
import { createEmptyQueueState } from './types.js';

// Was per-UID in multi-tenant; collapsed to a single global queue for single-user. See src/cautionary/.
let GLOBAL_QUEUE: FollowupQueueState | null = null;

/**
 * Get or create the followup queue.
 *
 * @param settings Queue settings (optional).
 * @returns The queue state.
 */
export function getFollowupQueue(settings?: Partial<QueueSettings>): FollowupQueueState {
  const existing = GLOBAL_QUEUE;

  if (existing) {
    // Update settings if provided.
    if (settings) {
      if (settings.mode !== undefined) existing.mode = settings.mode;
      if (settings.debounceMs !== undefined) existing.debounceMs = Math.max(0, settings.debounceMs);
      if (settings.cap !== undefined && settings.cap > 0) existing.cap = Math.floor(settings.cap);
      if (settings.dropPolicy !== undefined) existing.dropPolicy = settings.dropPolicy;
    }
    return existing;
  }

  // Create a new queue state.
  const newState = createEmptyQueueState(settings);
  GLOBAL_QUEUE = newState;
  return newState;
}

/**
 * Peek at the queue without creating it.
 */
export function peekFollowupQueue(): FollowupQueueState | null {
  return GLOBAL_QUEUE;
}

/**
 * Set the queue mode.
 */
export function setQueueMode(mode: QueueMode): void {
  const queue = getFollowupQueue();
  queue.mode = mode;
}

/**
 * Get the queue mode.
 */
export function getQueueMode(): QueueMode {
  return getFollowupQueue().mode;
}

/**
 * Set the drop policy.
 */
export function setQueueDropPolicy(policy: QueueDropPolicy): void {
  const queue = getFollowupQueue();
  queue.dropPolicy = policy;
}

/**
 * Clear the queue.
 *
 * @returns The number of cleared messages.
 */
export function clearFollowupQueue(): number {
  const queue = GLOBAL_QUEUE;
  if (!queue) return 0;

  const cleared = queue.items.length;
  queue.items = [];
  queue.lastEnqueuedAt = 0;
  queue.activeRunContext = undefined;

  // If the queue is empty and not draining, drop it.
  if (!queue.draining) {
    GLOBAL_QUEUE = null;
  }

  return cleared;
}

/**
 * Set the active run context.
 *
 * @param context The run context.
 */
export function setActiveRunContext(context: ActiveRunContext): void {
  const queue = getFollowupQueue();
  queue.activeRunContext = context;
}

/**
 * Get the active run context.
 *
 * @returns The run context, or undefined.
 */
export function getActiveRunContext(): ActiveRunContext | undefined {
  return GLOBAL_QUEUE?.activeRunContext;
}

/**
 * Update the active run context.
 *
 * @param updates Fields to update.
 */
export function updateActiveRunContext(
  updates: Partial<ActiveRunContext>
): void {
  const queue = GLOBAL_QUEUE;
  if (queue?.activeRunContext) {
    Object.assign(queue.activeRunContext, updates);
  }
}

/**
 * Clear the active run context.
 */
export function clearActiveRunContext(): void {
  const queue = GLOBAL_QUEUE;
  if (queue) {
    queue.activeRunContext = undefined;
  }
}

/**
 * Whether there is an active run.
 *
 * @returns Whether a run is active.
 */
export function hasActiveRun(): boolean {
  return !!GLOBAL_QUEUE?.activeRunContext;
}

/**
 * Drop the queue entirely (mainly for testing).
 */
export function resetFollowupQueue(): void {
  GLOBAL_QUEUE = null;
}
