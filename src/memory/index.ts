/**
 * Memory subsystem barrel.
 *
 * A pluggable conversation-memory layer behind one interface (MemoryAdapter).
 * Backends:
 * - SQLite: local persistence + optional vector search (sqlite-vec)
 * - InMemory: tests, no persistence
 * - Your own: implement MemoryAdapter
 *
 * @example
 * ```typescript
 * import { initMemory, createSQLiteAdapter } from './memory/index.js';
 *
 * initMemory(createSQLiteAdapter({ dbPath: './data/memory.db' }));
 * ```
 */

// ==================== Adapter interface & management ====================

export {
  initMemory,
  getMemoryAdapter,
  isMemoryInitialized,
  resetMemory,
} from './adapter.js';

export type {
  MemoryAdapter,
  ConversationData,
  MessageData,
  MessageInput,
  ConversationListItem,
  MemorySearchResult,
} from './adapter.js';

// ==================== Built-in adapters ====================

export {
  SQLiteAdapter,
  createSQLiteAdapter,
  createSQLiteAdapterFromEnv,
  type SQLiteAdapterConfig,
  InMemoryAdapter,
  createInMemoryAdapter,
} from './adapters/index.js';

// ==================== Types ====================

export * from './types.js';

// ==================== Embedding seam ====================

export { generateEmbedding, l2normalize } from './embed.js';

// ==================== Hybrid search ====================

export {
  buildPlainQuery,
  bm25RankToScore,
  mergeHybridResults,
  mergeWithRRF,
  applyMMR,
  deduplicateByText,
  textSimilarity,
  cosineSimilarity,
  getHybridSearchDefaults,
  getMMRDefaults,
} from './hybrid-search.js';

// ==================== Unified search ====================

export {
  unifiedSearch,
  searchMessages,
} from './unified-search.js';

// ==================== Reranking ====================

export {
  rerankWithLLM,
  parseRerankResponse,
  getRerankDefaults,
  RERANK_DEFAULTS,
} from './rerank.js';

// ==================== Initialization ====================

import { initMemory, isMemoryInitialized, type MemoryAdapter } from './adapter.js';
import { createSQLiteAdapter, createInMemoryAdapter } from './adapters/index.js';

/** Memory backend type. */
export type MemoryBackendType = 'sqlite' | 'inmemory';

/** Initialization options. */
export interface InitMemoryOptions {
  /** Force a specific backend (overrides environment). */
  forceBackend?: MemoryBackendType;
  /** Force re-initialization even if already initialized. */
  forceReinit?: boolean;
  /** SQLite database path (default ':memory:'). Used by the 'sqlite' backend. */
  dbPath?: string;
}

/**
 * Resolve the backend type from the environment.
 *
 * - MEMORY_BACKEND=inmemory → in-memory (no persistence)
 * - MEMORY_BACKEND=sqlite or unset → SQLite (default)
 */
export function getMemoryBackendType(): MemoryBackendType {
  const backend = process.env.MEMORY_BACKEND?.toLowerCase();
  if (backend === 'inmemory') return 'inmemory';
  return 'sqlite';
}

/**
 * Initialize the memory system from the environment.
 *
 * Supports the SQLite and in-memory backends only.
 *
 * @param options Initialization options
 * @returns The backend type that was initialized
 *
 * @example
 * ```typescript
 * await initMemoryFromEnv();                       // SQLite (default)
 * await initMemoryFromEnv({ forceBackend: 'inmemory' });
 * ```
 */
export async function initMemoryFromEnv(
  options: InitMemoryOptions = {}
): Promise<MemoryBackendType> {
  const { forceBackend, forceReinit = false, dbPath = ':memory:' } = options;

  if (!forceReinit && isMemoryInitialized()) {
    const currentBackend = getMemoryBackendType();
    console.log(`[Memory] Already initialized with ${currentBackend} backend`);
    return currentBackend;
  }

  const backendType = forceBackend || getMemoryBackendType();
  console.log(`[Memory] Initializing with ${backendType} backend...`);

  let adapter: MemoryAdapter;
  if (backendType === 'inmemory') {
    adapter = createInMemoryAdapter();
  } else {
    adapter = createSQLiteAdapter({ dbPath });
  }

  initMemory(adapter);
  console.log(`[Memory] Initialized with ${backendType} backend`);
  return backendType;
}

/**
 * Ensure the memory system is initialized.
 *
 * @param options Initialization options
 * @returns The backend type in use
 */
export async function ensureMemoryInitialized(
  options: InitMemoryOptions = {}
): Promise<MemoryBackendType> {
  if (isMemoryInitialized()) {
    return getMemoryBackendType();
  }
  return initMemoryFromEnv(options);
}
