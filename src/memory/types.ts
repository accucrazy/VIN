/**
 * Memory subsystem type definitions.
 *
 * Database-agnostic types shared across adapters (sqlite / inmemory / your own)
 * and the search layer (hybrid / unified). Distilled from a production harness;
 * business-specific message fields (trend data, chart config, scraper payloads,
 * multi-agent sub-messages) have been removed. What remains is the generic
 * conversation/message/embedding shape plus the search algorithm contracts.
 */

/**
 * Embedding configuration.
 *
 * The model name is provider-agnostic here — point EMBEDDING_MODEL at a local
 * embedder (nomic-embed-text / bge / MiniLM). Dimensions must match the model.
 */
export const EMBEDDING_CONFIG = {
  MODEL: process.env.EMBEDDING_MODEL ?? 'nomic-embed-text',
  DIMENSIONS: 768,
  DISTANCE_MEASURE: 'COSINE' as const,
} as const;

/** Conversation lifecycle status. */
export type ConversationStatus = 'active' | 'archived' | 'deleted';

/** Message author role. */
export type MessageRole = 'user' | 'assistant' | 'system';

/** Search options shared by keyword / vector / hybrid search. */
export interface SearchOptions {
  /** Maximum number of results. */
  maxResults?: number;
  /** Minimum similarity score threshold. */
  minScore?: number;
  /** Time window in days. */
  withinDays?: number;
  /** Restrict to a specific message role. */
  roleFilter?: MessageRole | 'both';
}

/** Pagination options. */
export interface PaginationOptions {
  limit?: number;
  startAfter?: any;
}

// ==================== Search result shapes ====================

/** Generic memory search result (used by adapter.search). */
export interface MemorySearchResult {
  messageId: string;
  conversationId: string;
  content: string;
  role: MessageRole;
  /** Similarity score. */
  score: number;
  timestamp: Date;
}

/** Vector-only search result. */
export interface VectorSearchResult {
  id: string;
  conversationId: string;
  content: string;
  role: MessageRole;
  /** Vector similarity score (0-1, higher is more similar). */
  vectorScore: number;
  timestamp: Date;
}

/** Keyword (FTS / BM25) search result. */
export interface KeywordSearchResult {
  id: string;
  conversationId: string;
  content: string;
  role: MessageRole;
  /** BM25 rank (lower is more relevant). */
  rank: number;
  /** Normalized score (0-1, higher is more relevant). */
  textScore: number;
  timestamp: Date;
}

// ==================== Hybrid search ====================

/** Hybrid search configuration. */
export interface HybridSearchConfig {
  enableVector: boolean;
  enableKeyword: boolean;
  /** Vector search weight (0-1, default 0.7). */
  vectorWeight: number;
  /** Keyword search weight (0-1, default 0.3). */
  keywordWeight: number;
}

/** Hybrid search defaults. */
export const HYBRID_SEARCH_DEFAULTS: HybridSearchConfig = {
  enableVector: true,
  enableKeyword: true,
  vectorWeight: 0.7,
  keywordWeight: 0.3,
};

/** Hybrid search result (weighted merge of vector + keyword). */
export interface HybridSearchResult {
  id: string;
  conversationId: string;
  content: string;
  role: MessageRole;
  /** Final weighted score. */
  score: number;
  /** Vector component (if present). */
  vectorScore?: number;
  /** Keyword component (if present). */
  keywordScore?: number;
  timestamp: Date;
}

/** Hybrid search options (extends SearchOptions). */
export interface HybridSearchOptions extends SearchOptions {
  hybridConfig?: Partial<HybridSearchConfig>;
}

// ==================== Search config constants ====================

export const SEARCH_CONFIG = {
  /** Maximum snippet length (characters). */
  SNIPPET_MAX_CHARS: 700,
  /** Candidate over-fetch multiplier. */
  CANDIDATE_MULTIPLIER: 4,
  /** Default maximum results. */
  DEFAULT_MAX_RESULTS: 10,
  /** Default minimum score threshold. */
  DEFAULT_MIN_SCORE: 0.3,
} as const;

// ==================== Unified search ====================

/** Memory search source. */
export type MemorySearchSource = 'messages';

/** A single unified search result item. */
export interface UnifiedSearchResultItem {
  id: string;
  source: 'message';
  content: string;
  /** Similarity score (0-1). */
  score: number;
  timestamp: Date;
  /** Source-specific metadata. */
  metadata: {
    conversationId?: string;
    role?: MessageRole;
  };
}

/** Unified search result envelope. */
export interface UnifiedSearchResult {
  items: UnifiedSearchResultItem[];
  sources: MemorySearchSource;
  /** Elapsed time (ms). */
  durationMs: number;
  counts: {
    messages: number;
    total: number;
  };
}

/** Unified search options. */
export interface UnifiedSearchOptions {
  /** Search source, default 'messages'. */
  sources?: MemorySearchSource;
  /** Maximum results, default 10. */
  maxResults?: number;
  /** Minimum similarity score, default 0.3. */
  minScore?: number;
  /** Time window in days. */
  withinDays?: number;
  /** Role filter. */
  roleFilter?: MessageRole;
  /** Apply temporal decay (newer memories weighted higher). */
  applyTemporalDecay?: boolean;
  /** Temporal decay half-life in days, default 30. */
  temporalDecayHalfLifeDays?: number;
  /** MMR diversity re-ranking config. */
  mmr?: Partial<MMRConfig>;
  /** LLM re-ranking config (optional). */
  rerank?: Partial<RerankConfig>;
}

/** LLM re-ranking configuration. */
export interface RerankConfig {
  /** Whether re-ranking is enabled, default false. */
  enabled: boolean;
  /** Model name (provider-agnostic — wire to your local LLM). */
  model: string;
  /** Thinking/reasoning level, default 'minimal'. */
  thinkingLevel: string;
  /** Max candidates sent to the LLM, default 20. */
  maxCandidates: number;
}

/**
 * Conversation recall defaults (cross-conversation Auto-Recall).
 */
export const CONVERSATION_RECALL_DEFAULTS = {
  MAX_RESULTS: 5,
  MIN_SCORE: 0.4,
  WITHIN_DAYS: 90,
  SNIPPET_LENGTH: 500,
  EXCLUDE_CURRENT_CONV: true,
  ROLE_FILTER: 'both' as const,
  APPLY_TEMPORAL_DECAY: true,
  /** Temporal decay half-life in days. */
  TEMPORAL_DECAY_HALF_LIFE_DAYS: 30,
} as const;

// ==================== MMR (Maximal Marginal Relevance) ====================

/**
 * MMR configuration — ensures result diversity, avoids near-duplicate results.
 */
export interface MMRConfig {
  enabled: boolean;
  /**
   * Diversity weight (0-1):
   * - 1.0: fully relevance-biased (ignores diversity)
   * - 0.5: balanced
   * - 0.0: fully diversity-biased (ignores relevance)
   *
   * Default 0.7 (relevance-biased but keeps some diversity).
   */
  lambda: number;
}

/** MMR defaults. */
export const MMR_DEFAULTS: MMRConfig = {
  enabled: false,
  lambda: 0.7,
};

/** A candidate item for MMR computation. */
export interface MMRItem {
  id: string;
  content: string;
  /** Raw relevance score. */
  score: number;
  /** Optional embedding for cosine-based diversity. */
  embedding?: number[];
}
