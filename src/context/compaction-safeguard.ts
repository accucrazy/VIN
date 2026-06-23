/**
 * Compaction Safeguard
 *
 * Prevents loss of important context when history is compacted/summarized.
 *
 * The summary that replaces dropped messages is lossy by design. Some facts must
 * NOT be lost in that compression — they are the "unsummarizable" residue an
 * agent still needs after older turns are gone:
 *   - tool-FAILURE records (what was tried, why it failed) — so the agent does
 *     not blindly retry the same broken call, and
 *   - the set of files it READ and the set it MODIFIED — so it keeps a stable
 *     map of what it has already touched.
 *
 * This module collects those facts and formats them as sections appended to the
 * summary (or used as a standalone fallback summary if summarization fails).
 */

import type { AgentTrace } from '../types.js';

// ==================== Types ====================

/**
 * Tool failure record.
 */
export interface ToolFailure {
  /** Tool call id. */
  toolCallId: string;
  /** Tool name. */
  toolName: string;
  /** Error summary. */
  summary: string;
  /** Extra metadata (e.g. status, exitCode). */
  meta?: string;
}

/**
 * File operation record.
 */
export interface FileOperations {
  /** Files that were read. */
  readFiles: string[];
  /** Files that were modified (edited or written). */
  modifiedFiles: string[];
}

/**
 * Compaction Safeguard config.
 */
export interface CompactionSafeguardConfig {
  /** Max tool failures to keep (default 8). */
  maxToolFailures: number;
  /** Max chars per tool-failure summary (default 240). */
  maxToolFailureChars: number;
  /** Whether to preserve tool-failure records. */
  preserveToolFailures: boolean;
  /** Whether to preserve file-operation records. */
  preserveFileOperations: boolean;
}

/**
 * Compaction Safeguard result.
 */
export interface CompactionSafeguardResult {
  /** Collected tool-failure records. */
  toolFailures: ToolFailure[];
  /** File operation records. */
  fileOperations: FileOperations;
  /** Fallback summary (used when normal summarization fails). */
  fallbackSummary: string;
  /** Extra content to append to the summary. */
  appendToSummary: string;
}

/**
 * Default Compaction Safeguard config.
 */
export const COMPACTION_SAFEGUARD_DEFAULTS: CompactionSafeguardConfig = {
  maxToolFailures: 8,
  maxToolFailureChars: 240,
  preserveToolFailures: true,
  preserveFileOperations: true,
};

/**
 * Internal message interface (tolerant of several shapes).
 */
export interface InternalMessage {
  role?: string;
  content?: string | unknown;
  toolCall?: {
    name: string;
    arguments?: Record<string, unknown>;
  };
  toolResult?: {
    success: boolean;
    error?: string;
    data?: unknown;
  };
  isError?: boolean;
  details?: Record<string, unknown>;
}

/**
 * Fallback summary message.
 */
const FALLBACK_SUMMARY =
  'Summary unavailable due to context limits. Older messages were truncated.';

// ==================== Tool failure handling ====================

/**
 * Normalize failure text (collapse whitespace).
 */
function normalizeFailureText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Truncate failure text.
 */
function truncateFailureText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

/**
 * Format tool-failure metadata.
 */
function formatToolFailureMeta(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  const record = details as Record<string, unknown>;
  const status = typeof record.status === 'string' ? record.status : undefined;
  const exitCode = typeof record.exitCode === 'number' && Number.isFinite(record.exitCode)
    ? record.exitCode
    : undefined;

  const parts: string[] = [];
  if (status) {
    parts.push(`status=${status}`);
  }
  if (exitCode !== undefined) {
    parts.push(`exitCode=${exitCode}`);
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Extract the tool-result text from a message.
 */
function extractToolResultText(message: InternalMessage): string {
  // From toolResult
  if (message.toolResult) {
    if (message.toolResult.error) {
      return message.toolResult.error;
    }
    if (message.toolResult.data) {
      return typeof message.toolResult.data === 'string'
        ? message.toolResult.data
        : JSON.stringify(message.toolResult.data).slice(0, 500);
    }
  }

  // From content
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const parts: string[] = [];
    for (const block of message.content) {
      if (block && typeof block === 'object') {
        const rec = block as { type?: unknown; text?: unknown };
        if (rec.type === 'text' && typeof rec.text === 'string') {
          parts.push(rec.text);
        }
      }
    }
    return parts.join('\n');
  }

  return '';
}

/**
 * Collect tool-failure records from a message list.
 *
 * @param messages Message list
 * @param config Safeguard config
 * @returns Tool-failure records
 */
export function collectToolFailures(
  messages: InternalMessage[],
  config: CompactionSafeguardConfig = COMPACTION_SAFEGUARD_DEFAULTS
): ToolFailure[] {
  const failures: ToolFailure[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    // Only tool-result messages
    const role = message.role;
    if (role !== 'tool' && role !== 'toolResult') {
      continue;
    }

    // Only errors
    const isError = message.isError === true ||
      (message.toolResult && message.toolResult.success === false);
    if (!isError) {
      continue;
    }

    // Generate a unique id
    const toolCallId = message.toolCall?.name
      ? `${message.toolCall.name}-${failures.length}`
      : `tool-${failures.length}`;

    if (seen.has(toolCallId)) {
      continue;
    }
    seen.add(toolCallId);

    const toolName = message.toolCall?.name || 'tool';
    const rawText = extractToolResultText(message);
    const meta = formatToolFailureMeta(message.details);
    const normalized = normalizeFailureText(rawText);
    const summary = truncateFailureText(
      normalized || (meta ? 'failed' : 'failed (no output)'),
      config.maxToolFailureChars
    );

    failures.push({ toolCallId, toolName, summary, meta });
  }

  return failures;
}

/**
 * Collect tool-failure records from an AgentTrace list.
 *
 * @param traces Agent trace list
 * @param config Safeguard config
 * @returns Tool-failure records
 */
export function collectToolFailuresFromTraces(
  traces: AgentTrace[],
  config: CompactionSafeguardConfig = COMPACTION_SAFEGUARD_DEFAULTS
): ToolFailure[] {
  const failures: ToolFailure[] = [];
  const seen = new Set<string>();

  for (const trace of traces) {
    if (!trace || trace.output?.success !== false) {
      continue;
    }

    const toolCallId = `${trace.tool}-${trace.timestamp || failures.length}`;
    if (seen.has(toolCallId)) {
      continue;
    }
    seen.add(toolCallId);

    const rawText = trace.output?.error || '';
    const normalized = normalizeFailureText(rawText);
    const summary = truncateFailureText(
      normalized || 'failed (no output)',
      config.maxToolFailureChars
    );

    failures.push({
      toolCallId,
      toolName: trace.tool,
      summary,
      meta: trace.duration ? `duration=${trace.duration}ms` : undefined,
    });
  }

  return failures;
}

/**
 * Format the tool-failures section.
 *
 * @param failures Failure records
 * @param config Safeguard config
 * @returns Formatted text block
 */
export function formatToolFailuresSection(
  failures: ToolFailure[],
  config: CompactionSafeguardConfig = COMPACTION_SAFEGUARD_DEFAULTS
): string {
  if (failures.length === 0) {
    return '';
  }

  const lines = failures.slice(0, config.maxToolFailures).map((failure) => {
    const meta = failure.meta ? ` (${failure.meta})` : '';
    return `- ${failure.toolName}${meta}: ${failure.summary}`;
  });

  if (failures.length > config.maxToolFailures) {
    lines.push(`- ...and ${failures.length - config.maxToolFailures} more`);
  }

  return `\n\n## Tool Failures\n${lines.join('\n')}`;
}

// ==================== File operation handling ====================

/**
 * Compute file operations from an AgentTrace list.
 *
 * @param traces Agent trace list
 * @returns File operation records
 */
export function computeFileOperations(traces: AgentTrace[]): FileOperations {
  const readSet = new Set<string>();
  const modifiedSet = new Set<string>();

  for (const trace of traces) {
    if (!trace) continue;

    // Infer the operation from the tool name
    const toolName = trace.tool?.toLowerCase() || '';
    const input = trace.input as Record<string, unknown> | undefined;

    // Read operations
    if (toolName.includes('read') || toolName.includes('search')) {
      const path = input?.path || input?.file;
      if (typeof path === 'string') {
        readSet.add(path);
      }
    }

    // Modify operations
    if (toolName.includes('write') || toolName.includes('edit') ||
        toolName.includes('create') || toolName.includes('update')) {
      const path = input?.path || input?.file;
      if (typeof path === 'string') {
        modifiedSet.add(path);
      }
    }
  }

  // Remove modified files from the read set
  for (const modified of modifiedSet) {
    readSet.delete(modified);
  }

  return {
    readFiles: [...readSet].sort(),
    modifiedFiles: [...modifiedSet].sort(),
  };
}

/**
 * Format the file-operations section.
 *
 * @param fileOps File operation records
 * @returns Formatted text block
 */
export function formatFileOperations(fileOps: FileOperations): string {
  const sections: string[] = [];

  if (fileOps.readFiles.length > 0) {
    sections.push(`<read-files>\n${fileOps.readFiles.join('\n')}\n</read-files>`);
  }

  if (fileOps.modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${fileOps.modifiedFiles.join('\n')}\n</modified-files>`);
  }

  if (sections.length === 0) {
    return '';
  }

  return `\n\n${sections.join('\n\n')}`;
}

// ==================== Main ====================

/**
 * Build a summary enriched with safeguard information.
 *
 * @param params Params
 * @returns Enriched summary
 */
export function buildSafeguardedSummary(params: {
  baseSummary: string;
  toolFailures: ToolFailure[];
  fileOperations: FileOperations;
  config?: CompactionSafeguardConfig;
}): string {
  const config = params.config || COMPACTION_SAFEGUARD_DEFAULTS;
  let summary = params.baseSummary;

  if (config.preserveToolFailures) {
    summary += formatToolFailuresSection(params.toolFailures, config);
  }

  if (config.preserveFileOperations) {
    summary += formatFileOperations(params.fileOperations);
  }

  return summary;
}

/**
 * Execute the Compaction Safeguard.
 *
 * Collects everything that must survive compaction and prepares it for
 * appending to the summary.
 *
 * @param params Params
 * @returns Safeguard result
 */
export function executeCompactionSafeguard(params: {
  messages: InternalMessage[];
  traces?: AgentTrace[];
  config?: CompactionSafeguardConfig;
}): CompactionSafeguardResult {
  const config = params.config || COMPACTION_SAFEGUARD_DEFAULTS;

  // Collect tool failures
  let toolFailures: ToolFailure[] = [];
  if (config.preserveToolFailures) {
    // Prefer collecting from traces
    if (params.traces && params.traces.length > 0) {
      toolFailures = collectToolFailuresFromTraces(params.traces, config);
    } else {
      toolFailures = collectToolFailures(params.messages, config);
    }
  }

  // Compute file operations
  let fileOperations: FileOperations = { readFiles: [], modifiedFiles: [] };
  if (config.preserveFileOperations && params.traces) {
    fileOperations = computeFileOperations(params.traces);
  }

  // Build the appended content
  const toolFailureSection = config.preserveToolFailures
    ? formatToolFailuresSection(toolFailures, config)
    : '';
  const fileOpsSection = config.preserveFileOperations
    ? formatFileOperations(fileOperations)
    : '';

  const appendToSummary = toolFailureSection + fileOpsSection;

  // Build the fallback summary
  const fallbackSummary = FALLBACK_SUMMARY + appendToSummary;

  return {
    toolFailures,
    fileOperations,
    fallbackSummary,
    appendToSummary,
  };
}

/**
 * Get the default Safeguard config.
 */
export function getDefaultSafeguardConfig(): CompactionSafeguardConfig {
  return { ...COMPACTION_SAFEGUARD_DEFAULTS };
}
