/**
 * Followup-queue enqueue logic.
 *
 * Handles enqueuing user messages across queue modes and drop policies.
 */

import type { FollowupRun, QueueSettings, QueueDedupeMode, FollowupQueueState } from './types.js';
import { getFollowupQueue, peekFollowupQueue } from './state.js';

/**
 * Enqueue result.
 */
export interface EnqueueResult {
  /** Whether the enqueue succeeded. */
  success: boolean;
  /** Reason. */
  reason?: 'duplicate' | 'dropped_old' | 'dropped_new' | 'interrupt' | 'steer';
  /** For interrupt mode, the interrupted run. */
  interruptedRun?: FollowupRun;
}

/**
 * Check whether a message is already queued (dedup).
 *
 * @param run The message to check.
 * @param items Existing queue items.
 * @param dedupeMode Dedup mode.
 * @returns Whether it already exists.
 */
function isRunAlreadyQueued(
  run: FollowupRun,
  items: FollowupRun[],
  dedupeMode: QueueDedupeMode = 'prompt'
): boolean {
  if (dedupeMode === 'none') {
    return false;
  }

  if (dedupeMode === 'message-id' && run.messageId) {
    return items.some(item => item.messageId === run.messageId);
  }

  // Default to prompt-based dedup.
  return items.some(item => item.prompt.trim() === run.prompt.trim());
}

/**
 * Handle queue overflow.
 */
function handleQueueOverflow(
  queue: FollowupQueueState,
  newRun: FollowupRun
): { dropped: FollowupRun | null; shouldEnqueue: boolean } {
  if (queue.items.length < queue.cap) {
    return { dropped: null, shouldEnqueue: true };
  }

  switch (queue.dropPolicy) {
    case 'old':
      // Drop the oldest.
      const droppedOld = queue.items.shift() ?? null;
      if (droppedOld) {
        queue.droppedCount++;
        updateDroppedSummary(queue, droppedOld);
      }
      return { dropped: droppedOld, shouldEnqueue: true };

    case 'new':
      // Drop the new message.
      queue.droppedCount++;
      updateDroppedSummary(queue, newRun);
      return { dropped: newRun, shouldEnqueue: false };

    case 'summarize':
      // Drop the oldest but keep a summary.
      const droppedSummarize = queue.items.shift() ?? null;
      if (droppedSummarize) {
        queue.droppedCount++;
        updateDroppedSummary(queue, droppedSummarize);
      }
      return { dropped: droppedSummarize, shouldEnqueue: true };
  }
}

/**
 * Update the dropped-message summary.
 */
function updateDroppedSummary(queue: FollowupQueueState, dropped: FollowupRun): void {
  const summary = dropped.summaryLine || dropped.prompt.slice(0, 50);
  if (queue.droppedSummary) {
    queue.droppedSummary += `\n- ${summary}`;
  } else {
    queue.droppedSummary = `Dropped messages:\n- ${summary}`;
  }
}

/**
 * Enqueue a message.
 *
 * @param run The message to enqueue.
 * @param settings Queue settings (optional).
 * @param dedupeMode Dedup mode (optional).
 * @returns The enqueue result.
 */
export function enqueueFollowupRun(
  run: FollowupRun,
  settings?: Partial<QueueSettings>,
  dedupeMode: QueueDedupeMode = 'prompt'
): EnqueueResult {
  const queue = getFollowupQueue(settings);

  // Dedup check.
  if (isRunAlreadyQueued(run, queue.items, dedupeMode)) {
    console.log(`[FollowupQueue] Skipped duplicate message`);
    return { success: false, reason: 'duplicate' };
  }

  // Mode-specific handling.
  switch (queue.mode) {
    case 'interrupt':
      // Interrupt mode: set the interrupt request, do not enqueue.
      queue.interruptRequest = run;
      console.log(`[FollowupQueue] Interrupt requested`);
      return { success: true, reason: 'interrupt' };

    case 'steer':
    case 'queue':
      // Steer mode: mark a pending steer.
      queue.hasPendingSteer = true;
      // Continue to enqueue.
      break;

    case 'steer-backlog':
      // Steer + backlog mode.
      queue.hasPendingSteer = true;
      break;

    case 'collect':
    case 'followup':
      // Standard enqueue behavior.
      break;
  }

  // Capacity check and overflow handling.
  const { dropped, shouldEnqueue } = handleQueueOverflow(queue, run);

  if (!shouldEnqueue) {
    console.log(`[FollowupQueue] Queue full, dropped new message`);
    return { success: false, reason: 'dropped_new' };
  }

  if (dropped) {
    const dropReason = queue.dropPolicy === 'new' ? 'dropped_new' : 'dropped_old';
    console.log(`[FollowupQueue] Queue full, ${dropReason}: "${dropped.summaryLine || dropped.prompt.slice(0, 30)}"`);
  }

  // Enqueue.
  queue.items.push(run);
  queue.lastEnqueuedAt = run.enqueuedAt;
  queue.lastRun = run;

  console.log(`[FollowupQueue] Enqueued message, queue depth: ${queue.items.length}, mode: ${queue.mode}`);
  return { success: true };
}

/**
 * Get the queue depth.
 *
 * @returns The number of queued messages.
 */
export function getFollowupQueueDepth(): number {
  const queue = peekFollowupQueue();
  return queue?.items.length ?? 0;
}

/**
 * Whether there are pending followups.
 *
 * @returns Whether any messages are pending.
 */
export function hasPendingFollowups(): boolean {
  return getFollowupQueueDepth() > 0;
}

/**
 * Whether there is a pending steer.
 */
export function hasPendingSteer(): boolean {
  const queue = peekFollowupQueue();
  return queue?.hasPendingSteer ?? false;
}

/**
 * Clear the steer flag.
 */
export function clearPendingSteer(): void {
  const queue = peekFollowupQueue();
  if (queue) {
    queue.hasPendingSteer = false;
  }
}

/**
 * Take and clear the interrupt request.
 */
export function consumeInterruptRequest(): FollowupRun | undefined {
  const queue = peekFollowupQueue();
  if (!queue || !queue.interruptRequest) {
    return undefined;
  }

  const request = queue.interruptRequest;
  queue.interruptRequest = undefined;
  return request;
}

/**
 * Whether there is an interrupt request.
 */
export function hasInterruptRequest(): boolean {
  const queue = peekFollowupQueue();
  return !!queue?.interruptRequest;
}

/**
 * Get the dropped-message count.
 */
export function getDroppedCount(): number {
  const queue = peekFollowupQueue();
  return queue?.droppedCount ?? 0;
}

/**
 * Get the dropped-message summary.
 */
export function getDroppedSummary(): string | undefined {
  const queue = peekFollowupQueue();
  return queue?.droppedSummary;
}

/**
 * Clear the dropped-message record.
 */
export function clearDroppedCount(): void {
  const queue = peekFollowupQueue();
  if (queue) {
    queue.droppedCount = 0;
    queue.droppedSummary = undefined;
  }
}
