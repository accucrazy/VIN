/**
 * Tool Result Truncation
 *
 * Two complementary mechanisms for keeping a single tool result from blowing up
 * the model's context window:
 *
 *   1. head+tail truncation of a finished text block (truncateToolResultText) —
 *      a last-resort safety net that preserves the beginning plus any
 *      error/summary content near the end.
 *
 *   2. store-then-reference (formatToolResult) — the primary, smarter path for
 *      large *structured* results (lists of rows/items). The FULL result stays
 *      cached in agent state so the UI can render every row, while the MODEL is
 *      fed only the top-N items, each clipped to a short character budget. A
 *      trailing marker tells the model how to pull the rest on demand instead of
 *      re-running the tool — in this repo that retrieval tool is
 *      `retrieve_cached_data` (it reads the cached full result back out of agent
 *      state; see src/types.ts AgentToolContext.agentState).
 *
 * The store-then-reference idea is the important one: never pour a full payload
 * into the prompt just because the model might want a few fields from it.
 */

// === Head+tail truncation constants ===

/**
 * Minimum characters to keep when truncating.
 * We always keep at least the first portion so the model understands
 * what was in the content.
 */
export const MIN_KEEP_CHARS = 2_000;

/**
 * Hard character limit for a single tool result text block.
 * Even for the largest context windows (~2M tokens), a single tool result
 * should not exceed ~400K characters (~100K tokens).
 * This acts as a safety net when we don't know the context window size.
 */
export const HARD_MAX_TOOL_RESULT_CHARS = 400_000;

/**
 * Maximum share of the context window a single tool result should occupy.
 * This is intentionally conservative – a single tool result should not
 * consume more than 30% of the context window even without other messages.
 */
export const MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3;

/**
 * Suffix appended to truncated tool results.
 */
const TRUNCATION_SUFFIX =
  "\n\n[WARNING] [Content truncated — original was too large. " +
  "The content above is a partial view.]";

/**
 * Marker inserted between head and tail when using head+tail truncation.
 */
const MIDDLE_OMISSION_MARKER =
  "\n\n[WARNING] [... middle content omitted — showing head and tail ...]\n\n";

/**
 * Truncation options
 */
export interface TruncationOptions {
  suffix?: string;
  minKeepChars?: number;
}

/**
 * Detect whether text likely contains error/diagnostic content near the end,
 * which should be preserved during truncation.
 */
function hasImportantTail(text: string): boolean {
  // Check last ~2000 chars for error-like patterns
  const tail = text.slice(-2000).toLowerCase();
  return (
    /\b(error|exception|failed|fatal|traceback|panic|stack trace|errno|exit code)\b/.test(tail) ||
    // JSON closing — if the output is JSON, the tail has closing structure
    /\}\s*$/.test(tail.trim()) ||
    // Summary/result lines often appear at the end
    /\b(total|summary|result|complete|finished|done)\b/.test(tail)
  );
}

/**
 * Truncate a single text string to fit within maxChars.
 *
 * Uses a head+tail strategy when the tail contains important content
 * (errors, results, JSON structure), otherwise preserves the beginning.
 * This ensures error messages and summaries at the end of tool output
 * aren't lost during truncation.
 */
export function truncateToolResultText(
  text: string,
  maxChars: number,
  options: TruncationOptions = {},
): string {
  const suffix = options.suffix ?? TRUNCATION_SUFFIX;
  const minKeepChars = options.minKeepChars ?? MIN_KEEP_CHARS;

  if (text.length <= maxChars) {
    return text;
  }

  const budget = Math.max(minKeepChars, maxChars - suffix.length);

  // If tail looks important, split budget between head and tail
  if (hasImportantTail(text) && budget > minKeepChars * 2) {
    const tailBudget = Math.min(Math.floor(budget * 0.3), 4_000);
    const headBudget = budget - tailBudget - MIDDLE_OMISSION_MARKER.length;

    if (headBudget > minKeepChars) {
      // Find clean cut points at newline boundaries
      let headCut = headBudget;
      const headNewline = text.lastIndexOf("\n", headBudget);
      if (headNewline > headBudget * 0.8) {
        headCut = headNewline;
      }

      let tailStart = text.length - tailBudget;
      const tailNewline = text.indexOf("\n", tailStart);
      if (tailNewline !== -1 && tailNewline < tailStart + tailBudget * 0.2) {
        tailStart = tailNewline + 1;
      }

      return text.slice(0, headCut) + MIDDLE_OMISSION_MARKER + text.slice(tailStart) + suffix;
    }
  }

  // Default: keep the beginning
  let cutPoint = budget;
  const lastNewline = text.lastIndexOf("\n", budget);
  if (lastNewline > budget * 0.8) {
    cutPoint = lastNewline;
  }
  return text.slice(0, cutPoint) + suffix;
}

/**
 * Calculate the maximum allowed characters for a single tool result
 * based on the model's context window tokens.
 *
 * Uses a rough 4 chars ~= 1 token heuristic (conservative for English text;
 * actual ratio varies by tokenizer).
 */
export function calculateMaxToolResultChars(contextWindowTokens: number): number {
  const maxTokens = Math.floor(contextWindowTokens * MAX_TOOL_RESULT_CONTEXT_SHARE);
  // Rough conversion: ~4 chars per token on average
  const maxChars = maxTokens * 4;
  return Math.min(maxChars, HARD_MAX_TOOL_RESULT_CHARS);
}

// === Store-then-reference (layered rendering) ===

/**
 * Layered render config for feeding a list-shaped tool result into the model.
 *
 * The cap is `itemLimit` items total. The first `frontCount` items get a longer
 * per-item character budget (`frontChars`); the remaining items up to the cap
 * get a shorter one (`restChars`). Anything beyond the cap is NOT placed in the
 * prompt — it stays in the cached full result, reachable via retrieval.
 */
export interface ToolRenderConfig {
  /** Max items rendered into the model context. */
  itemLimit: number;
  /** Number of leading "long" items (0..itemLimit). */
  frontCount: number;
  /** Per-item content chars for the front items. */
  frontChars: number;
  /** Per-item content chars for the remaining items. */
  restChars: number;
}

export const DEFAULT_RENDER_CONFIG: ToolRenderConfig = {
  itemLimit: 50,
  frontCount: 10,
  frontChars: 250,
  restChars: 100,
};

/** Clamp bounds (mirror whatever the data layer can actually guarantee). */
export const RENDER_CONFIG_BOUNDS = {
  itemLimit: { min: 1, max: 50 },
  frontChars: { min: 20, max: 500 },
  restChars: { min: 20, max: 300 },
} as const;

/** Parse to an integer and clamp to [min,max]; non-finite falls back. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Normalize arbitrary (possibly admin-supplied / API-body / client) input into a
 * safe ToolRenderConfig.
 * - Non-object -> full DEFAULT_RENDER_CONFIG
 * - Missing/bad field -> per-field default + clamp
 * - frontCount clamped to [0, itemLimit]
 */
export function normalizeRenderConfig(raw: unknown): ToolRenderConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_RENDER_CONFIG };
  }
  const r = raw as Record<string, unknown>;

  const itemLimit = clampInt(
    r.itemLimit,
    RENDER_CONFIG_BOUNDS.itemLimit.min,
    RENDER_CONFIG_BOUNDS.itemLimit.max,
    DEFAULT_RENDER_CONFIG.itemLimit,
  );
  const frontChars = clampInt(
    r.frontChars,
    RENDER_CONFIG_BOUNDS.frontChars.min,
    RENDER_CONFIG_BOUNDS.frontChars.max,
    DEFAULT_RENDER_CONFIG.frontChars,
  );
  const restChars = clampInt(
    r.restChars,
    RENDER_CONFIG_BOUNDS.restChars.min,
    RENDER_CONFIG_BOUNDS.restChars.max,
    DEFAULT_RENDER_CONFIG.restChars,
  );
  // frontCount upper bound follows itemLimit; missing -> min(default, itemLimit)
  const frontCount = clampInt(
    r.frontCount,
    0,
    itemLimit,
    Math.min(DEFAULT_RENDER_CONFIG.frontCount, itemLimit),
  );

  return { itemLimit, frontCount, frontChars, restChars };
}

/**
 * A single list item to render. Intentionally loose — a tool result row is
 * whatever the producing tool put in `data`. `title`/`content` are the common
 * fields we clip; everything else is ignored for the model view (but still lives
 * in the cached full result).
 */
export interface RenderableItem {
  title?: string;
  content?: string;
  [key: string]: unknown;
}

/**
 * Render a list of items into the layered, character-budgeted text view.
 *
 * Front items get frontChars, the rest get restChars, capped at itemLimit.
 */
function renderItems(items: RenderableItem[], cfg: ToolRenderConfig): string {
  return items
    .slice(0, cfg.itemLimit)
    .map((row, i) => {
      const chars = i < cfg.frontCount ? cfg.frontChars : cfg.restChars;
      const content = (typeof row.content === 'string' ? row.content : '').slice(0, chars);
      const title = typeof row.title === 'string' ? row.title : 'No title';
      return `${i + 1}. ${title}\n${content}...`;
    })
    .join('\n\n');
}

/**
 * Options for formatToolResult.
 */
export interface FormatToolResultOptions {
  /** Layered render config; omitted -> DEFAULT_RENDER_CONFIG. */
  renderConfig?: ToolRenderConfig;
  /** Tool name, used only to label the output block. */
  toolName?: string;
}

/**
 * Format a list-shaped tool result for the model using store-then-reference.
 *
 * `result` is expected to be an array of items (the tool's full payload). This
 * function:
 *   1. renders only the top-N items (layered char budget) into the returned
 *      string, and
 *   2. appends a [CACHE] marker telling the model the full set is stored and how
 *      to fetch the rest — via `retrieve_cached_data` — rather than re-running
 *      the tool.
 *
 * The full `result` is NOT mutated and remains available to the UI / cache. This
 * is the central anti-context-bloat move: the prompt carries a representative
 * slice, never the whole population.
 */
export function formatToolResult(
  result: unknown,
  opts: FormatToolResultOptions = {},
): string {
  const cfg = opts.renderConfig ?? DEFAULT_RENDER_CONFIG;
  const label = opts.toolName ? `[${opts.toolName}] ` : '';

  if (
    result &&
    typeof result === 'object' &&
    'success' in result &&
    'data' in result
  ) {
    return formatToolResult((result as { data?: unknown }).data, opts);
  }

  if (!Array.isArray(result)) {
    if (typeof result === 'string') return `${label}${result}`;
    if (result && typeof result === 'object') return `${label}${JSON.stringify(result).slice(0, cfg.frontChars)}`;
    return `${label}No list result.`;
  }

  const total = result.length;
  if (total === 0) {
    return `${label}No results found.`;
  }

  const shown = Math.min(cfg.itemLimit, total);
  const body = renderItems(result, cfg);

  // The model sees only `shown` of `total`; the rest live in the cached full
  // result. Point the model at the retrieval tool instead of a re-run.
  const cacheNote =
    `\n\n[CACHE] Cached ${total} item(s); rendered top ${shown}. ` +
    `These are representative rows, not the full population. ` +
    `Use retrieve_cached_data to access the full cached result instead of re-running this tool.`;

  return `${label}Showing ${shown} of ${total} item(s):\n\n${body}${cacheNote}`;
}
