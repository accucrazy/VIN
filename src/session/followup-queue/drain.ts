/**
 * Followup-queue drain logic.
 *
 * Drains the queue across 6 modes:
 * - steer: steer the in-flight run
 * - interrupt: abort the in-flight run
 * - collect: merge messages
 * - followup: process one by one
 * - steer-backlog: steer + drain backlog
 * - queue: standard queue
 */

import type { ActiveRunContext } from './types.js';
import type { FollowupRun, FollowupQueueState } from './types.js';
import { peekFollowupQueue, getActiveRunContext, resetFollowupQueue } from './state.js';
import { clearDroppedCount, clearPendingSteer } from './enqueue.js';

/**
 * Format a timestamp.
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Build the prompt for collect mode.
 *
 * Lets the AI see the messages received while it was working and produce a
 * natural reply.
 *
 * @param items Followup messages.
 * @param context Active run context (optional).
 * @returns The built prompt string.
 */
export function buildCollectPrompt(
  items: FollowupRun[],
  context?: ActiveRunContext
): string {
  const header = '[Followup messages the user sent while you were working]';

  const contextInfo = context
    ? `\n(You were just working on: ${context.taskDescription}${
        context.completedTools.length > 0
          ? `, using tools: ${context.completedTools.join(', ')}`
          : ''
      })\n`
    : '';

  const messages = items
    .map(
      (item, idx) =>
        `---\nFollowup #${idx + 1} (${formatTime(item.enqueuedAt)})\n${item.prompt}`
    )
    .join('\n\n');

  return `${header}${contextInfo}\n${messages}\n\nReply to the user naturally and warmly based on the messages above. Do not mention "queue" or "waiting"; just respond to what the user needs.`;
}

/**
 * Build the dropped-messages summary prompt.
 */
export function buildQueueSummaryPrompt(
  state: FollowupQueueState,
  noun: string = 'message'
): string | undefined {
  if (state.droppedCount === 0) {
    return undefined;
  }

  const count = state.droppedCount;
  const summary = state.droppedSummary;

  let prompt = `[Note: ${count} ${noun}(s) were dropped because the queue was full]`;

  if (summary) {
    prompt += `\n${summary}`;
  }

  // Clear the counters.
  state.droppedCount = 0;
  state.droppedSummary = undefined;

  return prompt;
}

/**
 * Build the prompt for steer mode.
 *
 * Lets the AI factor new messages into the in-flight run.
 */
export function buildSteerPrompt(
  items: FollowupRun[],
  context?: ActiveRunContext
): string {
  const header = '[The user sent new instructions; please adjust your direction]';

  const contextInfo = context
    ? `\n(You are currently working on: ${context.taskDescription})\n`
    : '';

  const messages = items
    .map(
      (item, idx) =>
        `New instruction #${idx + 1}:\n${item.prompt}`
    )
    .join('\n\n');

  return `${header}${contextInfo}\n${messages}\n\nAdjust your response direction based on the new instructions.`;
}

/**
 * Wait for the debounce window.
 *
 * Gives rapid consecutive messages a chance to merge.
 */
export async function waitForQueueDebounce(
  queue: { lastEnqueuedAt: number; debounceMs: number }
): Promise<void> {
  const elapsed = Date.now() - queue.lastEnqueuedAt;
  const remaining = queue.debounceMs - elapsed;

  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining));
  }
}

/**
 * Whether there are cross-channel items (to decide one-by-one processing).
 */
function hasCrossChannelItems(items: FollowupRun[]): boolean {
  if (items.length <= 1) {
    return false;
  }

  const firstChannel = items[0].originatingChannel;
  const firstTo = items[0].originatingTo;

  return items.some(item =>
    item.originatingChannel !== firstChannel ||
    item.originatingTo !== firstTo
  );
}

/**
 * Drain callbacks.
 */
export interface DrainCallbacks {
  /** Process a single message. */
  runFollowup: (run: FollowupRun) => Promise<void>;
  /** Process a merged collect-mode message (optional). */
  onCollect?: (collectPrompt: string, items: FollowupRun[]) => Promise<void>;
  /** Process a steer message (optional). */
  onSteer?: (steerPrompt: string, items: FollowupRun[]) => Promise<void>;
  /** Process a dropped-messages summary (optional). */
  onDroppedSummary?: (summary: string) => Promise<void>;
}

/**
 * Schedule a queue drain.
 *
 * @param callbacks Callbacks.
 * @returns A promise that resolves once the current batch is processed.
 */
export async function scheduleFollowupDrain(
  callbacks: DrainCallbacks | ((run: FollowupRun) => Promise<void>),
  onCollectLegacy?: (collectPrompt: string, items: FollowupRun[]) => Promise<void>,
  /**
   * Process only items matching this filter (per-conversation drain; others stay
   * queued for another conversation's drain). Required when multiple conversations
   * run in parallel: convX finishing must not swallow convY's still-running followups.
   */
  filter?: (run: FollowupRun) => boolean,
): Promise<void> {
  // Support the backward-compatible call form.
  const cbs: DrainCallbacks = typeof callbacks === 'function'
    ? { runFollowup: callbacks, onCollect: onCollectLegacy }
    : callbacks;

  const { runFollowup, onCollect, onSteer, onDroppedSummary } = cbs;

  const queue = peekFollowupQueue();

  if (!queue || queue.draining) {
    return;
  }

  if (queue.items.length === 0 && queue.droppedCount === 0) {
    return;
  }

  queue.draining = true;
  let forceIndividualCollect = false;

  try {
    // Labeled while: the collect branch must break the whole loop when no items
    // match the filter (a bare `break` inside the switch only exits the switch,
    // which would loop forever).
    drainLoop:
    while (queue.items.length > 0 || queue.droppedCount > 0) {
      // Wait for debounce.
      await waitForQueueDebounce(queue);

      // Handle the dropped-messages summary.
      const summaryPrompt = buildQueueSummaryPrompt(queue, 'message');
      if (summaryPrompt) {
        if (onDroppedSummary) {
          await onDroppedSummary(summaryPrompt);
        } else if (queue.lastRun) {
          await runFollowup({
            ...queue.lastRun,
            prompt: summaryPrompt,
            enqueuedAt: Date.now(),
          });
        }
        continue;
      }

      // Mode-specific handling.
      switch (queue.mode) {
        case 'collect':
          // Collect mode: merge all messages.
          if (forceIndividualCollect || hasCrossChannelItems(queue.items)) {
            // Process one by one across channels.
            forceIndividualCollect = true;
            const next = queue.items.shift();
            if (next) {
              await runFollowup(next);
            }
            continue;
          }

          if (onCollect && queue.items.length > 0) {
            // Partition: process matching items, return the rest to the queue
            // (per-conversation parallelism guard).
            const items = filter ? queue.items.filter(filter) : queue.items.slice();
            if (items.length === 0) {
              // This drain has no items of its own (the rest belong to other
              // conversations) -> stop and leave them for the other drain.
              // Use a labeled break to exit the while (a bare break only exits
              // the switch -> infinite loop).
              break drainLoop;
            }
            queue.items = filter ? queue.items.filter(r => !filter(r)) : [];
            const context = getActiveRunContext();
            const collectPrompt = buildCollectPrompt(items, context);

            console.log(`[FollowupQueue] Draining ${items.length} messages in collect mode`);
            await onCollect(collectPrompt, items);
          } else if (queue.items.length > 0) {
            const next = queue.items.shift();
            if (next) {
              await runFollowup(next);
            }
          }
          continue;

        case 'steer':
        case 'queue':
          // Steer mode: steer the in-flight run.
          if (onSteer && queue.items.length > 0) {
            const items = queue.items.splice(0, queue.items.length);
            const context = getActiveRunContext();
            const steerPrompt = buildSteerPrompt(items, context);

            console.log(`[FollowupQueue] Steering with ${items.length} messages`);
            await onSteer(steerPrompt, items);
          } else if (queue.items.length > 0) {
            // Fall back to one-by-one processing.
            const next = queue.items.shift();
            if (next) {
              await runFollowup(next);
            }
          }
          clearPendingSteer();
          continue;

        case 'steer-backlog':
          // Steer + backlog: steer first, then drain the backlog.
          if (queue.hasPendingSteer && queue.items.length > 0) {
            // Take the newest item for steering.
            const steerItem = queue.items.pop();
            if (steerItem) {
              if (onSteer) {
                const context = getActiveRunContext();
                const steerPrompt = buildSteerPrompt([steerItem], context);
                await onSteer(steerPrompt, [steerItem]);
              } else {
                await runFollowup(steerItem);
              }
            }
            clearPendingSteer();
            continue;
          }
          // Drain the backlog.
          if (queue.items.length > 0) {
            const next = queue.items.shift();
            if (next) {
              await runFollowup(next);
            }
          }
          continue;

        case 'interrupt':
          // Interrupt mode: the interrupt request is handled at enqueue time.
          // Here we just process any remaining backlog.
          if (queue.items.length > 0) {
            const next = queue.items.shift();
            if (next) {
              await runFollowup(next);
            }
          }
          continue;

        case 'followup':
        default:
          // Followup mode: process one by one.
          if (queue.items.length > 0) {
            const next = queue.items.shift();
            if (next) {
              console.log(`[FollowupQueue] Processing followup message`);
              await runFollowup(next);
            }
          }
          continue;
      }
    }
  } catch (error) {
    console.error(`[FollowupQueue] Drain failed:`, error);
  } finally {
    queue.draining = false;

    // Only reschedule when there is a filter-matching remainder (otherwise the
    // remainder belongs to another conversation; leave it for that drain and do
    // not spin). With no filter, keep the original behavior.
    const hasReschedulable = filter
      ? queue.items.some(filter)
      : (queue.items.length > 0 || queue.droppedCount > 0);

    if (hasReschedulable) {
      void scheduleFollowupDrain(cbs, undefined, filter);
    } else if (queue.items.length === 0 && queue.droppedCount === 0) {
      // Clean up the empty queue.
      resetFollowupQueue();
    }
    // else: the non-matching remainder stays queued for another conversation's drain.
  }
}

/**
 * Group followup messages by their owning conversation (preserving enqueue order).
 *
 * The drain side must attribute each item by its own conversationId, not by the
 * conversation of the request that triggered the drain.
 *
 * @param items Followup messages.
 * @returns Map<conversationId (or ''), that conversation's messages>
 */
export function groupFollowupRuns(items: FollowupRun[]): Map<string, FollowupRun[]> {
  const groups = new Map<string, FollowupRun[]>();
  for (const item of items) {
    const key = item.conversationId ?? '';
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

/**
 * Whether the queue is draining.
 *
 * @returns Whether a drain is in progress.
 */
export function isDraining(): boolean {
  return peekFollowupQueue()?.draining ?? false;
}

/**
 * Force-stop the drain (for interrupt mode).
 */
export function abortDrain(): boolean {
  const queue = peekFollowupQueue();
  if (queue && queue.draining) {
    // Mark as no longer draining so the current loop ends.
    queue.draining = false;
    return true;
  }
  return false;
}
