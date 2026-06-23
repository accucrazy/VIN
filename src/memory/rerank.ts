/**
 * Reranking module.
 *
 * Semantically re-orders search results with an LLM. On top of the hybrid-search
 * score ordering, an LLM can read the query intent to lift the most relevant
 * results. The production harness wired this to a cloud SDK; here it is a seam.
 *
 * @example
 * ```typescript
 * import { rerankWithLLM } from './rerank.js';
 *
 * const reranked = await rerankWithLLM(
 *   'user preferred analysis style',
 *   candidates,
 *   { maxCandidates: 15 }
 * );
 * ```
 */

import type { UnifiedSearchResultItem, RerankConfig } from './types.js';

// ==================== Defaults ====================

export const RERANK_DEFAULTS: RerankConfig = {
  enabled: false,
  // Provider-agnostic — point at your local LLM.
  model: process.env.RERANK_MODEL ?? '',
  thinkingLevel: 'minimal',
  maxCandidates: 20,
} as const;

// ==================== Reranking prompt ====================

const RERANK_PROMPT = `You are a search-result ranking assistant. Given the query intent, re-order the
candidate results by relevance.

Query: "{query}"

Candidates:
{candidates}

Return the re-ordered result IDs (most relevant first) as a JSON array only, no
other text. Format: ["id1", "id2", "id3", ...]

Rules:
- Only return IDs you consider relevant to the query.
- Omit completely irrelevant results.
- Order from most to least relevant.`;

// ==================== Core ====================

/**
 * Re-order search results with an LLM.
 *
 * The actual LLM call is a seam: in this demo the function is a graceful no-op
 * that returns the candidates in their original order. Wire it to a local LLM
 * to enable semantic re-ranking.
 *
 * @param query Search query
 * @param candidates Candidate results
 * @param config Config
 * @returns Re-ranked results (original order if the LLM call is unavailable)
 */
export async function rerankWithLLM(
  query: string,
  candidates: UnifiedSearchResultItem[],
  config?: Partial<RerankConfig>
): Promise<UnifiedSearchResultItem[]> {
  const mergedConfig = { ...RERANK_DEFAULTS, ...config };

  // Too few candidates to bother re-ranking
  if (candidates.length <= 2) {
    return candidates;
  }

  // Limit candidates
  const limitedCandidates = candidates.slice(0, mergedConfig.maxCandidates);

  // Build the candidate list (kept so the prompt is ready once a seam is wired)
  const candidateText = limitedCandidates
    .map((c, i) => {
      const snippet = c.content.length > 200
        ? c.content.substring(0, 200) + '...'
        : c.content;
      return `[${i + 1}] ID: ${c.id}\n    source: ${c.source}\n    content: ${snippet}`;
    })
    .join('\n\n');

  const prompt = RERANK_PROMPT
    .replace('{query}', query)
    .replace('{candidates}', candidateText);

  // ponytail: LLM rerank seam — wire `prompt` to your local LLM, then parse the
  // response with parseRerankResponse() and re-order limitedCandidates. Until
  // then this is a no-op that preserves the original (RRF) ordering.
  void prompt;
  return limitedCandidates;
}

// ==================== Helpers ====================

/**
 * Parse an LLM reranking response.
 *
 * Supports multiple formats:
 * - JSON array: ["id1", "id2"]
 * - JSON inside a Markdown code block
 *
 * Kept for use once the rerank seam above is wired.
 */
export function parseRerankResponse(response: string): string[] {
  try {
    let jsonStr = response.trim();

    // Strip Markdown code fences
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) {
      return [];
    }

    // Keep only string elements
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    // Fall back to line-by-line ID extraction
    const lines = response.trim().split('\n');
    const ids: string[] = [];
    for (const line of lines) {
      const match = line.match(/["']([a-f0-9-]+)["']/);
      if (match) {
        ids.push(match[1]);
      }
    }
    return ids;
  }
}

/** Get the default reranking config. */
export function getRerankDefaults(): RerankConfig {
  return { ...RERANK_DEFAULTS };
}
