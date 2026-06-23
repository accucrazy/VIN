/**
 * Followup-queue types.
 *
 * Handles user messages that arrive while the agent is busy.
 * Supports 6 queue modes.
 */

/**
 * Context of the currently running turn (used for smarter replies).
 *
 * Was imported from the session-manager layer in the harness; inlined here so
 * the followup queue stands alone.
 */
export interface ActiveRunContext {
  /** Run id. */
  runId: string;
  /** Start time. */
  startedAt: number;
  /** Conversation id this run belongs to. */
  conversationId?: string;
  /** Task description (extracted from the user message). */
  taskDescription: string;
  /** Tool currently executing (if any). */
  currentTool?: string;
  /** Tools completed so far. */
  completedTools: string[];
}

/**
 * Queue mode.
 *
 * - steer: new messages steer the in-flight run; the AI factors them into its response
 * - interrupt: abort the in-flight run and handle the new message immediately
 * - collect: merge all followup messages and let the AI respond once at the end (default)
 * - followup: process followup messages one by one
 * - steer-backlog: steer mode + drain the backlog afterwards
 * - queue: standard queue behavior (same as steer)
 */
export type QueueMode =
  | 'steer'
  | 'interrupt'
  | 'collect'
  | 'followup'
  | 'steer-backlog'
  | 'queue';

/**
 * Drop policy on overflow.
 *
 * - old: drop the oldest message
 * - new: drop the newest message
 * - summarize: summarize the dropped messages
 */
export type QueueDropPolicy = 'old' | 'new' | 'summarize';

/**
 * A followup message item.
 */
export interface FollowupRun {
  /** User message (may include enriched content such as source context / attachment hints, for the agent to act on). */
  prompt: string;
  /** Raw user message (without enrichment, for persistence to the transcript). */
  rawMessage?: string;
  /** Conversation id. */
  conversationId?: string;
  /** Time received. */
  enqueuedAt: number;
  /** Summary line (for merged display). */
  summaryLine?: string;
  /** Persisted message id (used at drain time to dedup against history and decide whether re-storing is needed). */
  messageId?: string;
  /** Associated task id (created when replying {status:'received'}; completed after drain). */
  taskId?: string;
  /** Originating channel type. */
  originatingChannel?: string;
  /** Originating target (group/user id). */
  originatingTo?: string;
  /** Originating account id. */
  originatingAccountId?: string;
  /** Originating thread id (for reply routing). */
  originatingThreadId?: string | number;
}

/**
 * Queue settings.
 */
export interface QueueSettings {
  /** Queue mode. */
  mode: QueueMode;
  /** Debounce time (ms), default 1000. */
  debounceMs: number;
  /** Queue capacity cap, default 20. */
  cap: number;
  /** Drop policy on overflow. */
  dropPolicy: QueueDropPolicy;
}

/**
 * Dedup mode.
 */
export type QueueDedupeMode = 'message-id' | 'prompt' | 'none';

/**
 * Default queue settings.
 */
export const DEFAULT_QUEUE_SETTINGS: QueueSettings = {
  mode: 'collect',
  debounceMs: 1000,
  cap: 20,
  dropPolicy: 'old',
};

/**
 * Default constants.
 */
export const DEFAULT_QUEUE_DEBOUNCE_MS = 1000;
export const DEFAULT_QUEUE_CAP = 20;
export const DEFAULT_QUEUE_DROP: QueueDropPolicy = 'old';

/**
 * Queue state.
 */
export interface FollowupQueueState {
  /** Queued messages. */
  items: FollowupRun[];
  /** Whether the queue is draining. */
  draining: boolean;
  /** Time of the last enqueue. */
  lastEnqueuedAt: number;
  /** Queue mode. */
  mode: QueueMode;
  /** Debounce time. */
  debounceMs: number;
  /** Capacity cap. */
  cap: number;
  /** Drop policy on overflow. */
  dropPolicy: QueueDropPolicy;
  /** Active run context (for smart replies). */
  activeRunContext?: ActiveRunContext;
  /** Number of dropped messages. */
  droppedCount: number;
  /** Summary of dropped messages. */
  droppedSummary?: string;
  /** Last run (for collect mode). */
  lastRun?: FollowupRun;
  /** Whether a steer message is pending. */
  hasPendingSteer: boolean;
  /** Current interrupt request (for interrupt mode). */
  interruptRequest?: FollowupRun;
}

/**
 * Steer message (steers the in-flight run).
 */
export interface SteerMessage {
  /** Message content. */
  content: string;
  /** Time received. */
  receivedAt: number;
  /** Source user. */
  userId?: string;
}

/**
 * Create an empty queue state.
 */
export function createEmptyQueueState(settings?: Partial<QueueSettings>): FollowupQueueState {
  const merged = { ...DEFAULT_QUEUE_SETTINGS, ...settings };
  return {
    items: [],
    draining: false,
    lastEnqueuedAt: 0,
    mode: merged.mode,
    debounceMs: merged.debounceMs,
    cap: merged.cap,
    dropPolicy: merged.dropPolicy,
    droppedCount: 0,
    hasPendingSteer: false,
  };
}

/**
 * Normalize a queue mode.
 */
export function normalizeQueueMode(raw?: string): QueueMode | undefined {
  if (!raw) {
    return undefined;
  }
  const cleaned = raw.trim().toLowerCase();

  switch (cleaned) {
    case 'queue':
    case 'queued':
    case 'steer':
    case 'steering':
      return 'steer';
    case 'interrupt':
    case 'interrupts':
    case 'abort':
      return 'interrupt';
    case 'followup':
    case 'follow-ups':
    case 'followups':
      return 'followup';
    case 'collect':
    case 'coalesce':
      return 'collect';
    case 'steer+backlog':
    case 'steer-backlog':
    case 'steer_backlog':
      return 'steer-backlog';
    default:
      return undefined;
  }
}

/**
 * Normalize a drop policy.
 */
export function normalizeQueueDropPolicy(raw?: string): QueueDropPolicy | undefined {
  if (!raw) {
    return undefined;
  }
  const cleaned = raw.trim().toLowerCase();

  switch (cleaned) {
    case 'old':
    case 'oldest':
      return 'old';
    case 'new':
    case 'newest':
      return 'new';
    case 'summarize':
    case 'summary':
      return 'summarize';
    default:
      return undefined;
  }
}
