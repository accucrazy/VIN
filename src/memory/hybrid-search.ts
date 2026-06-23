/**
 * Hybrid search.
 *
 * Combines keyword (BM25 / FTS) search with vector search, merging results with
 * a weighted score to improve quality. Also provides RRF fusion, MMR diversity
 * re-ranking, and n-gram dedup — all pure functions, backend-agnostic.
 */

import type {
  VectorSearchResult,
  KeywordSearchResult,
  HybridSearchResult,
  HybridSearchConfig,
  MMRConfig,
  MMRItem,
} from './types.js';
import { HYBRID_SEARCH_DEFAULTS, MMR_DEFAULTS } from './types.js';

/**
 * Build a plain full-text query string.
 *
 * Uses loose OR semantics (no AND tokenization). Strips special characters and
 * collapses whitespace; keeps word characters and CJK.
 *
 * @param raw Raw query string
 * @returns Cleaned query string
 */
export function buildPlainQuery(raw: string): string {
  return raw
    .replace(/[^\w\s一-鿿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert a BM25 rank into a 0-1 score.
 *
 * Full-text rank values are higher when more relevant; this maps them into a
 * 0-1 range so they can be merged with vector scores.
 *
 * @param rank BM25 rank value
 * @returns Normalized score (0-1)
 */
export function bm25RankToScore(rank: number): number {
  // rank is typically 0-0.5, occasionally higher; map via a saturating curve.
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 0;
  return normalized / (normalized + 0.1);
}

/**
 * Merge hybrid search results with a weighted score.
 *
 * @param params Merge parameters
 * @returns Merged, sorted results
 *
 * @example
 * ```typescript
 * const results = mergeHybridResults({
 *   vector: vectorResults,
 *   keyword: keywordResults,
 *   config: { vectorWeight: 0.7, keywordWeight: 0.3 },
 * });
 * ```
 */
export function mergeHybridResults(params: {
  vector: VectorSearchResult[];
  keyword: KeywordSearchResult[];
  config?: Partial<HybridSearchConfig>;
}): HybridSearchResult[] {
  const config = { ...HYBRID_SEARCH_DEFAULTS, ...params.config };

  // Merge by ID using a Map
  const byId = new Map<string, {
    id: string;
    conversationId: string;
    content: string;
    role: string;
    timestamp: Date;
    vectorScore: number;
    keywordScore: number;
  }>();

  // Vector results
  for (const r of params.vector) {
    byId.set(r.id, {
      id: r.id,
      conversationId: r.conversationId,
      content: r.content,
      role: r.role,
      timestamp: r.timestamp,
      vectorScore: r.vectorScore,
      keywordScore: 0,
    });
  }

  // Keyword results
  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.keywordScore = r.textScore;
    } else {
      byId.set(r.id, {
        id: r.id,
        conversationId: r.conversationId,
        content: r.content,
        role: r.role,
        timestamp: r.timestamp,
        vectorScore: 0,
        keywordScore: r.textScore,
      });
    }
  }

  // Compute weighted score and convert to results
  const merged: HybridSearchResult[] = Array.from(byId.values()).map((entry) => {
    const score =
      config.vectorWeight * entry.vectorScore +
      config.keywordWeight * entry.keywordScore;

    return {
      id: entry.id,
      conversationId: entry.conversationId,
      content: entry.content,
      role: entry.role as any,
      score,
      vectorScore: entry.vectorScore > 0 ? entry.vectorScore : undefined,
      keywordScore: entry.keywordScore > 0 ? entry.keywordScore : undefined,
      timestamp: entry.timestamp,
    };
  });

  // Sort by score descending
  return merged.sort((a, b) => b.score - a.score);
}

/**
 * Merge results with Reciprocal Rank Fusion (RRF).
 *
 * RRF is a more stable fusion method that does not depend on absolute scores.
 *
 * @param params Merge parameters
 * @param k RRF constant (default 60)
 * @returns Merged, sorted results
 */
export function mergeWithRRF(params: {
  vector: VectorSearchResult[];
  keyword: KeywordSearchResult[];
}, k: number = 60): HybridSearchResult[] {
  // Compute each document's rank in each list
  const vectorRanks = new Map<string, number>();
  const keywordRanks = new Map<string, number>();

  params.vector.forEach((r, i) => vectorRanks.set(r.id, i + 1));
  params.keyword.forEach((r, i) => keywordRanks.set(r.id, i + 1));

  // Collect all unique IDs
  const allIds = new Set([
    ...params.vector.map(r => r.id),
    ...params.keyword.map(r => r.id),
  ]);

  // Map ID -> content
  const contentMap = new Map<string, VectorSearchResult | KeywordSearchResult>();
  for (const r of params.vector) contentMap.set(r.id, r);
  for (const r of params.keyword) contentMap.set(r.id, r);

  // Compute RRF scores
  const results: HybridSearchResult[] = [];

  for (const id of allIds) {
    const vectorRank = vectorRanks.get(id) ?? Infinity;
    const keywordRank = keywordRanks.get(id) ?? Infinity;

    // RRF formula: 1/(k + rank)
    const rrfScore =
      (vectorRank !== Infinity ? 1 / (k + vectorRank) : 0) +
      (keywordRank !== Infinity ? 1 / (k + keywordRank) : 0);

    const item = contentMap.get(id)!;

    results.push({
      id: item.id,
      conversationId: item.conversationId,
      content: item.content,
      role: item.role as any,
      score: rrfScore,
      vectorScore: 'vectorScore' in item ? item.vectorScore : undefined,
      keywordScore: 'textScore' in item ? (item as KeywordSearchResult).textScore : undefined,
      timestamp: item.timestamp,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

/** Get the default hybrid search config. */
export function getHybridSearchDefaults(): HybridSearchConfig {
  return { ...HYBRID_SEARCH_DEFAULTS };
}

// ==================== MMR (Maximal Marginal Relevance) ====================

/**
 * Jaccard similarity between two strings.
 *
 * Used for MMR dedup when no vector embeddings are available.
 *
 * @param a Text A
 * @param b Text B
 * @returns Similarity (0-1)
 */
export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  // Character n-gram (n=3) Jaccard similarity
  const ngramSize = 3;

  const getNgrams = (text: string): Set<string> => {
    const ngrams = new Set<string>();
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    for (let i = 0; i <= normalized.length - ngramSize; i++) {
      ngrams.add(normalized.slice(i, i + ngramSize));
    }
    return ngrams;
  };

  const ngramsA = getNgrams(a);
  const ngramsB = getNgrams(b);

  if (ngramsA.size === 0 || ngramsB.size === 0) return 0;

  // Intersection
  let intersection = 0;
  for (const ngram of ngramsA) {
    if (ngramsB.has(ngram)) intersection++;
  }

  // Jaccard = |A ∩ B| / |A ∪ B|
  const union = ngramsA.size + ngramsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Cosine similarity between two vectors.
 *
 * @param a Vector A
 * @param b Vector B
 * @returns Similarity (-1 to 1, typically 0-1 once normalized)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * MMR re-ranking.
 *
 * Re-orders results with Maximal Marginal Relevance so they are both relevant
 * and diverse.
 *
 * MMR formula:
 *   MMR = λ * Sim(d, q) - (1-λ) * max(Sim(d, di))
 *
 * @param items Candidate items
 * @param config MMR config
 * @param maxResults Max returned count
 * @returns Re-ranked items
 *
 * @example
 * ```typescript
 * const reranked = applyMMR(results, { enabled: true, lambda: 0.7 }, 5);
 * ```
 */
export function applyMMR<T extends MMRItem>(
  items: T[],
  config: Partial<MMRConfig> = {},
  maxResults: number = 10
): T[] {
  const mmrConfig = { ...MMR_DEFAULTS, ...config };

  if (!mmrConfig.enabled || items.length <= 1) {
    return items.slice(0, maxResults);
  }

  const { lambda } = mmrConfig;
  const selected: T[] = [];
  const remaining = [...items];

  while (selected.length < maxResults && remaining.length > 0) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];

      // Max similarity to already-selected items
      let maxSimilarity = 0;
      for (const sel of selected) {
        let similarity: number;

        // Prefer vector similarity, otherwise text similarity
        if (candidate.embedding && sel.embedding) {
          similarity = cosineSimilarity(candidate.embedding, sel.embedding);
        } else {
          similarity = textSimilarity(candidate.content, sel.content);
        }

        maxSimilarity = Math.max(maxSimilarity, similarity);
      }

      // MMR formula
      const mmrScore = lambda * candidate.score - (1 - lambda) * maxSimilarity;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) {
      selected.push(remaining[bestIndex]);
      remaining.splice(bestIndex, 1);
    } else {
      break;
    }
  }

  return selected;
}

/**
 * Simple MMR: dedup by text similarity.
 *
 * For scenarios without vector embeddings, using n-gram similarity.
 *
 * @param items Items
 * @param similarityThreshold Threshold above which two items are duplicates (default 0.7)
 * @returns Deduplicated items
 */
export function deduplicateByText<T extends { content: string }>(
  items: T[],
  similarityThreshold: number = 0.7
): T[] {
  if (items.length <= 1) return items;

  const result: T[] = [];

  for (const item of items) {
    let isDuplicate = false;

    for (const selected of result) {
      const similarity = textSimilarity(item.content, selected.content);
      if (similarity >= similarityThreshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(item);
    }
  }

  return result;
}

/** Get the default MMR config. */
export function getMMRDefaults(): MMRConfig {
  return { ...MMR_DEFAULTS };
}
