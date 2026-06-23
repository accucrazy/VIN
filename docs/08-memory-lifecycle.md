# 08 — Memory as a Lifecycle, Not Two Endpoints

> The simplest view of agent memory is two functions: `write(text)` and `read(query)`.
> That view produces a store that only grows, retrieves by one signal, returns
> near-duplicates, and treats a note from a year ago the same as one from this
> morning. Here memory is a **lifecycle** with deliberate stages —
> fusion, diversification, dedup, temporal weighting, optional re-rank — behind a
> single pluggable adapter and a single embedding seam.

Grounded in:
- [`../src/memory/adapter.ts`](../src/memory/adapter.ts) — the `MemoryAdapter` contract + feature detection
- [`../src/memory/unified-search.ts`](../src/memory/unified-search.ts) — RRF fusion, temporal decay, rerank wiring
- [`../src/memory/hybrid-search.ts`](../src/memory/hybrid-search.ts) — weighted/RRF merge, MMR, n-gram dedup, cosine
- [`../src/memory/embed.ts`](../src/memory/embed.ts) — the single `generateEmbedding` seam
- [`../src/memory/rerank.ts`](../src/memory/rerank.ts) — the LLM re-rank seam

Related chapters: [07 — Context Feeding](07-context-feeding.md) · [SECURITY.md](SECURITY.md) (write-point injection scanning)

---

## What

Retrieval here is not "embed the query, return the nearest N". It is a small pipeline,
each stage with a specific job:

1. **Over-fetch** candidates (≈2× the requested results) so later stages have room to
   work.
2. **Fuse** ranked lists with **Reciprocal Rank Fusion (RRF, k=60)** — rank-based, so
   it merges cosine and BM25 scores without normalizing them onto a common scale.
3. **Decay** scores by recency with a half-life curve (`0.5^(age/halfLife)`, 30-day
   half-life) so newer memories outweigh stale ones.
4. **Diversify** with **Maximal Marginal Relevance (MMR, λ=0.7)** so the result set is
   not five paraphrases of the same fact.
5. **Dedup** with **3-gram Jaccard** similarity when no embeddings are available.
6. **Re-rank** (optional) with an LLM that reads query intent.

All of step 2–6 are pure, backend-agnostic functions. The backend itself is hidden
behind the `MemoryAdapter` interface, and every embedding is produced at one seam.

## Why

Each stage is there because a single-signal store fails in a specific way:

- **One score is brittle.** Vector search misses exact-keyword matches; keyword search
  misses paraphrases. Fusing two ranked lists is more robust than trusting either —
  and RRF fuses *ranks*, so you never have to make cosine and BM25 numbers comparable.
- **Recency matters but shouldn't dominate.** A hard "last N days" filter throws away
  relevant old facts. A smooth half-life keeps them but lets fresh facts win ties.
- **Relevant ≠ useful.** Ten near-identical hits waste the budget protected in
  [chapter 07](07-context-feeding.md). MMR trades a little relevance for diversity so
  the model sees *different* facts.
- **Embeddings aren't always present.** When they're missing, 3-gram Jaccard still
  removes obvious duplicates — graceful degradation, not a crash.

And the structural reason: by hiding all of this behind `MemoryAdapter` and a single
`generateEmbedding`, the *algorithms* are portable and the *backend* is swappable.

## How

### RRF fusion (k=60)

`unified-search.ts` over-fetches `maxResults * 2` candidates, assigns each a
rank-based score, and merges:

```ts
// RRF(d) = Σ 1/(k + r(d)),  k = 60
function calculateRRFScore(rank: number, k: number = RRF_K): number {
  return 1 / (k + rank);
}
```

`k=60` is the standard RRF constant; it controls how fast the contribution decays
with rank. Because the score depends only on *position in a list*, two lists scored on
totally different scales (cosine vs BM25) fuse cleanly. `hybrid-search.ts` provides
the two-list version (`mergeWithRRF`) used when both vector and keyword results are
available; `mergeHybridResults` is the alternative weighted merge
(`vectorWeight * v + keywordWeight * k`) when you'd rather tune weights directly.

### Temporal decay (30-day half-life)

`unified-search.ts`, when `applyTemporalDecay` is enabled:

```ts
const decay = Math.pow(0.5, ageDays / halfLifeDays); // halfLifeDays default 30
return score * decay;
```

A memory exactly 30 days old keeps half its score; 60 days, a quarter; and so on. It
never hits zero, so an old-but-relevant memory can still surface — it just has to be
*more* relevant to beat a fresher one.

### MMR diversification (λ=0.7)

`hybrid-search.ts → applyMMR`:

```
MMR = λ * Sim(d, q) - (1-λ) * max(Sim(d, di))
```

At λ=0.7, selection is weighted 70% toward relevance to the query and 30% toward being
*different* from what's already chosen. Similarity to already-selected items uses
cosine when both have embeddings, falling back to text (3-gram) similarity otherwise.

### 3-gram Jaccard dedup

`textSimilarity` builds character 3-gram sets and computes Jaccard
(`|A∩B| / |A∪B|`). `deduplicateByText` drops any item whose similarity to an
already-kept item exceeds a threshold (default 0.7). This is the embeddings-free
duplicate filter; it also backs MMR's diversity term when vectors are unavailable.

### The single `generateEmbedding` seam

[`embed.ts`](../src/memory/embed.ts) is **the one place** embeddings are produced. In
a production harness this kind of call tends to get scattered across every adapter via
a cloud SDK; here it is one provider-agnostic function:

```ts
export async function generateEmbedding(text: string): Promise<number[]> { /* wire your local embedder */ }
export function l2normalize(v: number[]): number[] { /* keep cosine correct */ }
```

Point it at a local embedder (e.g. `nomic-embed-text` / `bge` / `MiniLM` via Ollama)
and the entire retrieval pipeline runs locally. `l2normalize` is provided so cosine
similarity stays correct once vectors are wired. (In this demo the function throws
until configured — it is a seam, not a stub pretending to work; see
[chapter 10](10-engineering-discipline.md) on labeling not-yet-live code.)

### The LLM re-rank seam

[`rerank.ts`](../src/memory/rerank.ts) is the optional final pass. `unified-search.ts`
only invokes it when `options.rerank.enabled` is set, and when it does it over-fetches
to `maxResults * 2` for RRF first, then lets the re-ranker pick the final `maxResults`.
The re-rank prompt and response parser (`parseRerankResponse`) are written out in full;
the LLM call itself is a seam that defaults to a graceful no-op (returns RRF order
unchanged) until you wire a local model. So enabling re-rank is a config + one wiring
change, not a rewrite.

### Pluggability: `MemoryAdapter` + feature detection

[`adapter.ts`](../src/memory/adapter.ts) defines the contract every backend implements
(SQLite, in-memory, or your own). The required methods are conversation/message CRUD
plus `verifyOwnership`. The four search methods — `search`, `keywordSearch`,
`vectorSearch`, `hybridSearch` — are **optional**, and callers feature-detect:

```ts
if (!adapter.search) {
  console.warn('[UnifiedSearch] Memory adapter does not support search');
} else {
  const results = await adapter.search(userId, queryText, { maxResults: maxResults * 2, ... });
}
```

A backend that can't do vector search simply doesn't implement `vectorSearch`; the
pipeline degrades to what's available instead of throwing. `initMemory(adapter)` swaps
the backend at startup; `getMemoryAdapter()` throws a clear error if you forgot to call
it (loud-fail, no silent default).

## Note on identity (the seam, not a constant)

Every adapter method carries `userId`, and `verifyOwnership(conversationId, userId)` is
part of the required interface. In this single-user demo `userId` is always `'local'`
and ownership is a near-no-op — but it is a **seam**, never hardcoded. That is why
re-expanding to multi-tenant is a configuration change rather than a re-audit; the
write-point injection scanning and the ownership boundary are covered in
[SECURITY.md](SECURITY.md) and the cautionary material in
[`../src/cautionary/`](../src/cautionary/).

## How this fits together

Memory here is not a bag you append to and grep. It has stages, and each stage exists
to fix a concrete failure of the naive read/write model. The stages stay pure and
backend-agnostic, the backend hides behind one adapter, embeddings come from one seam
— and the whole lifecycle moves between deployment shapes (cloud → local) without
touching the algorithms.
