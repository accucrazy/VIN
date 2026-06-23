# `memory/` — pluggable conversation memory

A conversation-memory layer behind one interface (`MemoryAdapter`). Swap the storage backend
without touching the search algorithms; produce embeddings in exactly one place. Read this before the
files; it tells you the two seams (adapter, embed) and where the ranking lives.

```
tool / caller
     │  getMemoryAdapter().hybridSearch(userId, query, opts)
     ▼
MemoryAdapter  ──────────────  one interface, three implementations
  ├─ SQLiteAdapter   (local persistence, node:sqlite + sqlite-vec)
  ├─ InMemoryAdapter (tests, no persistence)
  └─ your own        (implement MemoryAdapter)
         │ vectorSearch / keywordSearch use ↓
         ▼
generateEmbedding(text)  ←── the ONE embed seam (embed.ts)

ranking (pure, backend-agnostic):
  hybrid-search.ts   weighted merge · RRF · MMR diversity · n-gram dedup
  unified-search.ts  RRF fusion + optional temporal decay + optional LLM rerank
```

## What each file is

- **`adapter.ts`** — the `MemoryAdapter` interface + adapter lifecycle (`initMemory`,
  `getMemoryAdapter` — which **throws if not initialized**, `isMemoryInitialized`, `resetMemory`).
  Conversation/message CRUD is required; `search` / `keywordSearch` / `vectorSearch` / `hybridSearch`
  are **optional** (a backend declares what it supports).
- **`embed.ts`** — `generateEmbedding(text)`, the single embed seam, plus `l2normalize`. In the demo
  this **throws** until you point it at a local embedder (`nomic-embed-text` / `bge` / MiniLM via
  Ollama, `EMBEDDING_MODEL`).
- **`unified-search.ts`** — `unifiedSearch(userId, query, opts)` / `searchMessages`. RRF fusion over
  message results, optional **temporal decay** (`score * 0.5^(age/halfLife)`), optional LLM rerank.
- **`hybrid-search.ts`** — the pure ranking toolkit: `mergeHybridResults` (weighted),
  `mergeWithRRF`, `applyMMR` (Maximal Marginal Relevance for diversity), `deduplicateByText`,
  `cosineSimilarity`, `textSimilarity`, `bm25RankToScore`, `buildPlainQuery`.
- **`adapters/`** — `sqlite.ts` (`createSQLiteAdapter`), `inmemory.ts` (`createInMemoryAdapter`),
  and their barrel. `rerank.ts` holds the LLM rerank pass; `types.ts` the shared search types.
- **`index.ts`** — barrel + `initMemoryFromEnv()` / `ensureMemoryInitialized()`
  (`MEMORY_BACKEND=sqlite|inmemory`, default `sqlite`).

## The two seams

**1. The backend — `MemoryAdapter`.** Implement the interface, then `initMemory(adapter)`:

```ts
class MyAdapter implements MemoryAdapter { /* … */ }
initMemory(new MyAdapter());
```

The shipped backends are `SQLiteAdapter` (Node 22+ built-in `node:sqlite`; `sqlite-vec` optional,
enables vector search) and `InMemoryAdapter`. The production harness also had cloud-DB backends;
those are removed here, leaving the two dependency-light ones.

**2. The embedder — `generateEmbedding`.** Every adapter routes through this one function instead of
scattering a cloud SDK across backends. Wire it to your local embedder and vector search lights up
everywhere at once. Until then it throws by design — the demo teaches the shape, it does not run
end-to-end.

## Search: how the ranking composes

`unifiedSearch` over-fetches candidates, fuses them with **RRF** (`1/(k+rank)`, `k=60`) so it does
not depend on absolute scores, optionally applies **temporal decay** to favor recent memory, and can
run an **LLM rerank** pass on the merged top-N. `hybrid-search.ts` adds **MMR** to trade some
relevance for diversity (avoids N near-duplicate hits) and n-gram dedup. All of these are pure
functions — backend-agnostic, unit-testable without a database.

## Single-user note

`userId` is part of every adapter call and defaults to `'local'`. That is the single-user collapse
of a multi-tenant ownership seam — kept live, not removed. See [`../cautionary/`](../cautionary/).
