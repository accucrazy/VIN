# 07 — Context Feeding: Store, Then Reference

> A tool can produce far more than the model needs to read. The cheap, naive move is
> to pour the whole payload into the prompt. What this code does instead is **store the
> full result and feed the model a representative slice**, with an explicit way to
> pull more on demand — plus a safeguard that keeps the *unsummarizable* facts alive
> when history is compacted.

Grounded in:
- [`../src/context/tool-result-truncation.ts`](../src/context/tool-result-truncation.ts) — `formatToolResult`, layered rendering, head+tail truncation
- [`../src/context/compaction-safeguard.ts`](../src/context/compaction-safeguard.ts) — preserving facts a summary cannot carry
- [`../src/context/index.ts`](../src/context/index.ts) — the context module barrel

Related chapters: [08 — Memory Lifecycle](08-memory-lifecycle.md) · [10 — Engineering Discipline](10-engineering-discipline.md) · [SECURITY.md](SECURITY.md)

---

## What

There are two complementary mechanisms in this plane, and they solve two different
problems:

1. **Store-then-reference** (`formatToolResult`) — the primary path for large,
   *list-shaped* results. The full result stays cached in agent state so the UI can
   render every row; the **model** is fed only the top-N items, each clipped to a
   short character budget. A trailing marker tells the model how to retrieve the
   rest instead of re-running the tool.

2. **Compaction safeguard** (`executeCompactionSafeguard`) — when conversation
   history is summarized to free up context, some facts must **not** be lost in the
   lossy compression: tool *failures*, and the lists of files *read* and *modified*.
   These are collected and appended to the summary (or used as a standalone fallback
   if summarization itself fails).

There is also a last-resort `truncateToolResultText` (head+tail) for a single
finished text block — useful when you cannot structure the result as a list. It
keeps the head plus any error/summary tail so the meaningful parts survive.

## Why

A tool that searches a corpus might return 50 items of ~500 characters each — that
is ~25K characters the model rarely needs in full. It usually wants to *know what is
there* and read a few items closely. Feeding all 50 in full does three bad things:

- **Cost** — every token in the prompt is paid for on every subsequent turn.
- **Latency** — larger prompts are slower to process.
- **Dilution** — the signal the model needs is buried in rows it will never use.

The rule the source file states for itself:

> *Never pour a full payload into the prompt just because the model might want a few
> fields from it.*

Store-then-reference makes "the full set exists and is reachable" a property of the
system, not a property of the prompt. The model reads a slice; the data layer holds
the population.

## How

### Layered rendering (`formatToolResult`)

The config that controls the slice is `ToolRenderConfig`. The default
([`tool-result-truncation.ts`](../src/context/tool-result-truncation.ts), `DEFAULT_RENDER_CONFIG`):

```ts
export const DEFAULT_RENDER_CONFIG: ToolRenderConfig = {
  itemLimit: 50,   // at most 50 items reach the model context
  frontCount: 10,  // the first 10 are "long"
  frontChars: 250, // long items get 250 chars of content
  restChars: 100,  // the rest get 100 chars
};
```

So the model sees: the top 10 items at 250 chars, items 11–50 at 100 chars, and
**nothing beyond 50** — those rows live only in the cache. The leading items get a
larger budget because they are the most likely to matter; the tail is there for
breadth, not depth.

`formatToolResult` renders that slice and appends a cache marker:

```
[CACHE] Cached 312 item(s); rendered top 50. These are representative rows, not the
full population. Use retrieve_cached_data to access the full cached result instead of
re-running this tool.
```

Two things this marker does deliberately:

- It tells the model the slice is **representative, not complete** — so the model
  does not reason as if 50 is the whole world.
- It names the retrieval path — `retrieve_cached_data` — so the model pulls more from
  the cache rather than re-running the (expensive) tool. The full `result` is never
  mutated; it remains available to the UI and the cache. The retrieval tool reads it
  back out of `AgentToolContext.agentState` (see
  [`../src/types.ts`](../src/types.ts), `AgentToolContext.agentState`).

### Config is normalized and clamped

`normalizeRenderConfig` exists because the render config can come from
admin/API/client input. Every field is parsed to an integer and clamped to bounds
(`RENDER_CONFIG_BOUNDS`): `itemLimit ∈ [1,50]`, `frontChars ∈ [20,500]`,
`restChars ∈ [20,300]`, and `frontCount` is clamped to `[0, itemLimit]`. A
non-object input falls back to the full default. This is the same "untrusted input is
clamped at the boundary, not trusted" posture used across the harness — you can tune
the slice, but you cannot tune it into something that defeats the budget.

### Head+tail truncation (the safety net)

When a single result is one big text block rather than a list, `truncateToolResultText`
caps it. It is not a dumb prefix cut: `hasImportantTail` checks the last ~2000 chars
for error/exception/summary markers (or JSON closing structure). If the tail looks
important, the budget is split — head plus a `[... middle content omitted ...]`
marker plus the tail — so an error message or a final summary at the *end* of the
output is not silently dropped. `calculateMaxToolResultChars` derives the cap from
the context-window size (a single tool result should not exceed
`MAX_TOOL_RESULT_CONTEXT_SHARE` = 30% of the window, hard-capped at
`HARD_MAX_TOOL_RESULT_CHARS` = 400K chars).

### Compaction safeguard: the unsummarizable residue

When older turns are dropped and replaced with a summary, the summary is lossy *by
design*. Two classes of fact must survive anyway
([`compaction-safeguard.ts`](../src/context/compaction-safeguard.ts)):

- **Tool failures** — what was tried and why it failed
  (`collectToolFailures` / `collectToolFailuresFromTraces`). If the agent loses the
  memory that `web_fetch https://… → timeout`, it will cheerfully retry the exact
  broken call. The safeguard formats a `## Tool Failures` section
  (`formatToolFailuresSection`), capped at `maxToolFailures` (default 8), each
  summary clipped to `maxToolFailureChars` (default 240), deduplicated.

- **File operations** — the set of files **read** and the set **modified**
  (`computeFileOperations`). Tool names are inspected: `read`/`search` →
  read-set, `write`/`edit`/`create`/`update` → modified-set; modified files are
  removed from the read-set. These are emitted as `<read-files>` / `<modified-files>`
  blocks (`formatFileOperations`) so the agent keeps a stable map of what it has
  already touched.

`executeCompactionSafeguard` collects both, builds `appendToSummary`, and also builds
a `fallbackSummary` (`"Summary unavailable due to context limits…"` + the same
appended facts) for the case where summarization itself fails. So even a *failed*
summarization step still carries forward the facts an agent cannot afford to forget.

## How this fits the rest

This plane is one instance of a rule that recurs in the harness: decide what the
model actually needs to reason, and feed exactly that — no more (cost/latency/
dilution) and no less (don't drop the facts that prevent repeated mistakes). The
slice is representative; the cache is authoritative; the safeguard is the floor below
which compaction does not take you.

Note for small-context local models: `formatToolResult`'s slice is the *primary*
feeding limiter on the happy path. If you run a model with a small context window,
this is the lever that matters most — shrink `itemLimit` / `frontChars` /
`restChars` before reaching for heavier pruning.
