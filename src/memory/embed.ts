/**
 * Embedding seam — VIN-AIOS on-prem implementation.
 *
 * In TPC-AIOS this seam threw an error and asked you to wire a local embedder.
 * VIN-AIOS ships a working default: Ollama's /api/embed with `nomic-embed-text`
 * (768-dim, ~270MB, runs on CPU). Override with EMBEDDING_MODEL.
 *
 * See docs/onprem-00-setup.md for setup details.
 *
 * Recommended on-prem models (all available via `ollama pull <name>`):
 *  - nomic-embed-text   ·  768 dim · default · fast · CPU-friendly
 *  - mxbai-embed-large  ·  1024 dim · slightly better retrieval quality
 *  - bge-m3             ·  1024 dim · multilingual, strong on Chinese
 *
 * The function gracefully falls back to deterministic zero-vectors when Ollama
 * is unreachable so the rest of the harness still boots — but logs a loud
 * warning so you know hybrid search has degraded to keyword-only.
 *
 * @module memory/embed
 */

import { createOllamaProvider, OLLAMA_BASE_URL } from '../providers/ollama.js';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'nomic-embed-text';
const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM ?? 768);

/**
 * Lazy singleton so we don't open a new fetch agent per call. The Ollama
 * provider is cheap to construct, but caching it also lets us flip a single
 * disabled flag if connectivity fails repeatedly.
 */
let cachedProvider: ReturnType<typeof createOllamaProvider> | null = null;
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_DEGRADE = 3;

function getProvider() {
  if (!cachedProvider) cachedProvider = createOllamaProvider();
  return cachedProvider;
}

/**
 * Produce a single embedding vector for `text`. On-prem path: hits Ollama at
 * OLLAMA_BASE_URL with the model in EMBEDDING_MODEL.
 *
 * Returns a zero vector (and warns once) after MAX_FAILURES_BEFORE_DEGRADE
 * consecutive failures so the rest of the agent loop can keep running on
 * keyword-only memory search.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (consecutiveFailures >= MAX_FAILURES_BEFORE_DEGRADE) {
    return new Array(EMBEDDING_DIM).fill(0);
  }
  try {
    const vec = await getProvider().generateEmbedding(text, EMBEDDING_MODEL);
    consecutiveFailures = 0;
    return vec;
  } catch (e) {
    consecutiveFailures++;
    const tail = consecutiveFailures >= MAX_FAILURES_BEFORE_DEGRADE
      ? ' (further calls will return zero-vectors; hybrid search degraded to keyword-only)'
      : '';
    console.warn(
      `[embed] Embedding failed via Ollama at ${OLLAMA_BASE_URL} ` +
      `with model "${EMBEDDING_MODEL}": ${(e as Error).message}${tail}\n` +
      `  -> hint: run \`ollama pull ${EMBEDDING_MODEL}\` if you haven't.`,
    );
    return new Array(EMBEDDING_DIM).fill(0);
  }
}

/** L2-normalize so cosine stays correct. */
export function l2normalize(v: number[]): number[] {
  const n = Math.hypot(...v) || 1;
  return v.map(x => x / n);
}
