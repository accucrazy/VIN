/**
 * Unified memory search.
 *
 * Searches conversation history (messages) and merges results with Reciprocal
 * Rank Fusion (RRF). Optional temporal decay weights newer memories higher, and
 * an optional LLM re-rank pass (via the rerank seam) refines the final ordering.
 *
 * In the production harness this also fused a separate long-term-memory store;
 * that source has been removed here, leaving the message search plus the fusion,
 * decay, and re-rank algorithms intact.
 *
 * @example
 * ```typescript
 * import { unifiedSearch } from './unified-search.js';
 *
 * const results = await unifiedSearch('local', 'project plan', { maxResults: 10 });
 * ```
 */

import type {
  MemorySearchSource,
  UnifiedSearchResult,
  UnifiedSearchResultItem,
  UnifiedSearchOptions,
} from './types.js';
import type { MemorySearchResult } from './adapter.js';
import { getMemoryAdapter, isMemoryInitialized } from './adapter.js';
import { rerankWithLLM } from './rerank.js';

// ==================== Config ====================

/** Default search config. */
const DEFAULTS = {
  sources: 'messages' as MemorySearchSource,
  maxResults: 10,
  minScore: 0.3,
  /** Temporal decay half-life in days. */
  temporalDecayHalfLifeDays: 30,
} as const;

/** RRF constant (k value, controls rank decay). */
const RRF_K = 60;

// ==================== Internal helpers ====================

/**
 * Reciprocal Rank Fusion score.
 *
 * RRF(d) = Σ 1/(k + r(d))
 * where k is a constant (typically 60) and r(d) is the rank of document d in a list.
 *
 * @param rank Rank (1-based)
 * @param k RRF constant
 */
function calculateRRFScore(rank: number, k: number = RRF_K): number {
  return 1 / (k + rank);
}

/**
 * Temporal decay.
 *
 * Half-life formula: score * 0.5^(age / halfLife). Newer memories score higher.
 *
 * @param score Raw score
 * @param timestamp Message timestamp
 * @param halfLifeDays Half-life in days
 * @returns Decayed score
 */
function applyTemporalDecay(score: number, timestamp: Date, halfLifeDays: number): number {
  const ageMs = Date.now() - timestamp.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const decay = Math.pow(0.5, ageDays / halfLifeDays);
  return score * decay;
}

/** Convert a message search result into the unified format. */
function convertMessageResult(
  result: MemorySearchResult,
  rank: number
): UnifiedSearchResultItem & { rrfScore: number } {
  return {
    id: result.messageId,
    source: 'message',
    content: result.content,
    score: result.score,
    timestamp: result.timestamp,
    metadata: {
      conversationId: result.conversationId,
      role: result.role,
    },
    rrfScore: calculateRRFScore(rank),
  };
}

/**
 * Merge items with RRF.
 *
 * @param items Items carrying an rrfScore
 * @param maxResults Max results
 */
function mergeWithRRF(
  items: Array<UnifiedSearchResultItem & { rrfScore: number }>,
  maxResults: number
): UnifiedSearchResultItem[] {
  // Sort by RRF score
  const sorted = items.sort((a, b) => b.rrfScore - a.rrfScore);

  // Drop the rrfScore field and take the top N
  return sorted.slice(0, maxResults).map(({ rrfScore, ...item }) => item);
}

// ==================== Main ====================

/**
 * Unified search over conversation history.
 *
 * @param userId User ID
 * @param queryText Search text
 * @param options Search options
 * @returns Unified search result
 *
 * @example
 * ```typescript
 * const results = await unifiedSearch('local', 'brand analysis');
 * ```
 */
export async function unifiedSearch(
  userId: string,
  queryText: string,
  options: UnifiedSearchOptions = {}
): Promise<UnifiedSearchResult> {
  const startTime = Date.now();

  const {
    sources = DEFAULTS.sources,
    maxResults = DEFAULTS.maxResults,
    minScore = DEFAULTS.minScore,
    withinDays,
    roleFilter,
    applyTemporalDecay: useTemporalDecay = false,
    temporalDecayHalfLifeDays = DEFAULTS.temporalDecayHalfLifeDays,
  } = options;

  const allItems: Array<UnifiedSearchResultItem & { rrfScore: number }> = [];
  let messagesCount = 0;

  // Search messages
  try {
    if (!isMemoryInitialized()) {
      console.warn('[UnifiedSearch] Memory adapter not initialized');
    } else {
      const adapter = getMemoryAdapter();

      if (!adapter.search) {
        console.warn('[UnifiedSearch] Memory adapter does not support search');
      } else {
        const results = await adapter.search(userId, queryText, {
          maxResults: maxResults * 2, // over-fetch candidates for fusion
          minScore,
          withinDays,
          roleFilter,
        });

        messagesCount = results.length;

        results.forEach((result, index) => {
          const item = convertMessageResult(result, index + 1);
          // Optional temporal decay on the base relevance score
          if (useTemporalDecay) {
            item.score = applyTemporalDecay(item.score, item.timestamp, temporalDecayHalfLifeDays);
          }
          allItems.push(item);
        });
      }
    }
  } catch (error) {
    console.error('[UnifiedSearch] Messages search failed:', error);
  }

  // Merge with RRF (over-fetch when reranking is enabled)
  const rerankEnabled = options.rerank?.enabled;
  const rrfLimit = rerankEnabled ? maxResults * 2 : maxResults;
  const mergedItems = mergeWithRRF(allItems, rrfLimit);

  // Reranking (if enabled)
  const finalItems = rerankEnabled
    ? (await rerankWithLLM(queryText, mergedItems, options.rerank)).slice(0, maxResults)
    : mergedItems;

  const durationMs = Date.now() - startTime;

  console.log(
    `[UnifiedSearch] Completed in ${durationMs}ms: ` +
    `${messagesCount} messages, ${finalItems.length} merged` +
    (rerankEnabled ? ' (reranked)' : '')
  );

  return {
    items: finalItems,
    sources,
    durationMs,
    counts: {
      messages: messagesCount,
      total: finalItems.length,
    },
  };
}

/** Quick helper: search conversation history. */
export async function searchMessages(
  userId: string,
  queryText: string,
  maxResults: number = 10
): Promise<UnifiedSearchResult> {
  return unifiedSearch(userId, queryText, {
    sources: 'messages',
    maxResults,
  });
}
