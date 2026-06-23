# `context/` — keeping the window from blowing up

Three independent building blocks that defend the model's context window. They don't share state;
each solves one failure mode. Read this before the files; the central idea is **store-then-reference
— never pour a full payload into the prompt just because the model might want a few fields from it.**

## What each file is

- **`tool-result-truncation.ts`** — two complementary mechanisms for one large tool result.
- **`compaction-safeguard.ts`** — preserves the facts that summarization must not lose.
- **`summarization.ts`** — chunked/staged conversation summarization, via the provider registry.
- **`index.ts`** — barrel.

## 1. Tool-result truncation — store-then-reference (the important one)

`formatToolResult(result, opts)` is what the [ReAct loop](../agent/) calls on every tool result.
For a list-shaped result it feeds the model only a representative slice and keeps the full payload in
agent state:

```
full result (N items)  ──┐
                         ├─▶ model sees: top-K items, front ones longer (frontChars),
cached in agentState ────┘                rest shorter (restChars), capped at itemLimit
                         └─▶ + a [CACHE] marker: "use retrieve_cached_data for the rest"
```

The model gets a "Showing K of N" view plus a pointer to `retrieve_cached_data` (which reads the
cached full result back out of `AgentToolContext.agentState` — see [`../types.ts`](../types.ts)),
**instead of re-running the tool**. `DEFAULT_RENDER_CONFIG` and `normalizeRenderConfig` (clamps
untrusted input to safe bounds) control the budget.

The second mechanism, `truncateToolResultText(text, maxChars)`, is a last-resort safety net for a
finished text block: head+tail truncation that preserves the beginning **and** any error/summary
content near the end (`hasImportantTail` detects it). `calculateMaxToolResultChars` sizes the budget
from the context window (~4 chars/token, capped at `HARD_MAX_TOOL_RESULT_CHARS`).

## 2. Compaction safeguard — the unsummarizable residue

When old turns are compacted into a summary, that summary is lossy by design. Some facts must
survive anyway:

- **tool-FAILURE records** — what was tried and why it failed, so the agent doesn't blindly retry a
  broken call;
- **the files it READ and the files it MODIFIED** — a stable map of what it has already touched.

`executeCompactionSafeguard({ messages, traces })` collects these (`collectToolFailures*`,
`computeFileOperations`) and formats them as sections appended to the summary, or as a standalone
`fallbackSummary` if summarization itself fails. `buildSafeguardedSummary` glues a base summary +
these sections together.

## 3. Summarization — provider-agnostic

`summarizeWithFallback` / `summarizeInStages` / `summarizeMessages` reduce long history to key
points. The discipline here: summarization reaches the LLM **only through the provider registry**
(`getProviderRegistry().get('openai')`) — it imports no concrete cloud SDK, so "which model writes
the summary" stays a registry decision, not a vendor leak inside a context module
([`../providers/`](../providers/)).

It degrades gracefully: full summary → partial (skip oversized messages, note them) → a plain
"contained N messages" fallback. `summarizeInStages` splits very long histories into parts,
summarizes each, then merges. (`SUMMARIZATION_CONFIG.model` names a small/cheap model; token
accounting lives in `./token-counter.js`.)

## The seam to swap

Each block is a pure-ish function you can call from the loop or replace wholesale: change the render
budget (`ToolRenderConfig`), the safeguard policy (`CompactionSafeguardConfig`), or the
summarization model — none of them reach past the [provider](../providers/) abstraction.
