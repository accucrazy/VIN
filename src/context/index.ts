/**
 * Context module barrel.
 *
 * Three context-management building blocks:
 *  - tool-result-truncation: keep a single tool result from flooding the prompt
 *    (head+tail truncation + store-then-reference layered rendering).
 *  - compaction-safeguard: preserve "unsummarizable" facts across compaction
 *    (tool failures, read/modified file lists).
 *  - summarization: chunked/staged conversation summarization via the provider
 *    registry abstraction.
 */

// Tool Result Truncation
export {
  truncateToolResultText,
  calculateMaxToolResultChars,
  formatToolResult,
  normalizeRenderConfig,
  DEFAULT_RENDER_CONFIG,
  RENDER_CONFIG_BOUNDS,
  MIN_KEEP_CHARS,
  HARD_MAX_TOOL_RESULT_CHARS,
  MAX_TOOL_RESULT_CONTEXT_SHARE,
} from './tool-result-truncation.js';
export type {
  TruncationOptions,
  ToolRenderConfig,
  RenderableItem,
  FormatToolResultOptions,
} from './tool-result-truncation.js';

// Compaction Safeguard
export {
  collectToolFailures,
  collectToolFailuresFromTraces,
  formatToolFailuresSection,
  computeFileOperations,
  formatFileOperations,
  buildSafeguardedSummary,
  executeCompactionSafeguard,
  getDefaultSafeguardConfig,
  COMPACTION_SAFEGUARD_DEFAULTS,
} from './compaction-safeguard.js';
export type {
  ToolFailure,
  FileOperations,
  CompactionSafeguardConfig,
  CompactionSafeguardResult,
  InternalMessage,
} from './compaction-safeguard.js';

// Summarization
export {
  SUMMARIZATION_CONFIG,
  summarizeMessages,
  summarizeWithFallback,
  summarizeInStages,
  createSummaryMessage,
} from './summarization.js';
export type { SummaryResult, SummarizeOptions } from './summarization.js';
