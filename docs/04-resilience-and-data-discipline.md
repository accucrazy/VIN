# 04 · Resilience and data discipline

> Errors are classified into types before they are acted on, recovery is tried in a fixed
> order, concurrent user messages have explicit queue semantics, and fetched data is
> treated as untrusted and fed into the prompt by reference, not by value.

## What this is

A harness runs against flaky networks, rate limits, oversized contexts, and users who
keep typing while the agent is still thinking. Robustness here isn't ad-hoc `try/catch` —
it's three deliberate disciplines:

1. **Typed error classification + ordered recovery** — turn an opaque error string into a
   category with a known recovery, and try recoveries in priority order.
2. **Explicit followup-queue semantics** — decide, by mode, what happens to a message
   that arrives mid-run.
3. **Store-then-reference data feeding** — never pour a full external payload into the
   prompt; feed a representative slice and let the model pull the rest on demand.

## 1. Typed error classification

The provider layer normalizes vendor errors into a typed
`ProviderError` ([`../src/providers/types.ts`](../src/providers/types.ts)) that carries
exactly what a retry/fallback decision needs:

```ts
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderId,
    public readonly errorType: ProviderErrorType,  // 'rate_limit' | 'auth' | 'billing' | ...
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly cause?: Error,
  ) { super(message); this.name = 'ProviderError'; }
}
```

`retryable` is a field, not a guess made at the call site. That single decision — "is this
worth retrying?" — is made once, where the error is created, and trusted everywhere
downstream.

Above the provider, [`../src/session/error-recovery/`](../src/session/error-recovery/)
classifies *any* error (including string messages from sources that didn't throw a typed
error) into one of nine categories with a severity and a session-reset hint
([`error-classifier.ts`](../src/session/error-recovery/error-classifier.ts)):

```ts
const SEVERITY_MAP: Record<ErrorCategory, ErrorSeverity> = {
  rate_limit: 'retryable', timeout: 'retryable', network: 'retryable', service: 'retryable',
  auth: 'user_action', billing: 'user_action',
  context_overflow: 'recoverable', format: 'recoverable',
  unknown: 'retryable',
};
const SESSION_RESET_CATEGORIES = new Set(['context_overflow', 'format']);
```

The mapping encodes judgment: a rate limit is *retryable* (wait and try again), an auth
failure is *user_action* (no amount of retrying fixes a bad key), and a context overflow
is *recoverable* but *also* warrants a session reset (the conversation grew too long, so
trim it and restate). Classification is by pattern match against the error text, so it
works even when the underlying client throws a bare `Error`.

## Recovery ordering

`classifyError` decides *what* the error is; the recovery manager
([`recovery-manager.ts`](../src/session/error-recovery/recovery-manager.ts)) decides
*what to do*, trying strategies in a fixed priority order:

```ts
this.registerStrategy(retryStrategy);            // priority 1
this.registerStrategy(sessionResetStrategy);     // priority 2
this.registerStrategy(userNotificationStrategy); // priority 3
```

The order is the policy. Retry comes first because it's the cheapest fix and resolves the
common transient failures. Session reset comes next, for the recoverable-but-broken cases
(context overflow, malformed request) where continuing the same session is futile. User
notification is last, the terminal outcome for `user_action` errors that no automated step
can resolve. `executeWithRecovery` ties it together: it runs the operation, classifies any
failure, applies the first applicable strategy, performs a recommended session reset if one
is signalled, and backs off exponentially between attempts.

Note the seam: the recovery manager operates on a `sessionId` and a `userId` passed in —
it has no global session state. In single-user the `userId` is always `'local'`; the
interface still carries it, so the same code serves multi-tenant unchanged (see
[chapter 05](05-tenant-isolation-collapsed.md)).

## 2. Followup-queue semantics

When a user sends a message while the agent is mid-run, "what happens next" is a UX
decision with real consequences. The followup queue
([`../src/session/followup-queue/`](../src/session/followup-queue/)) makes it explicit via
a `QueueMode` ([`types.ts`](../src/session/followup-queue/types.ts)). The three that
matter most:

```ts
// - steer:     new messages steer the in-flight run; the AI factors them into its response
// - interrupt: abort the in-flight run and handle the new message immediately
// - collect:   merge all followup messages and let the AI respond once at the end (default)
```

- **collect** (the default) coalesces a burst of messages and answers once — right when a
  user fires off three quick clarifications, you don't want three overlapping runs.
- **steer** lets the new message influence the run already in flight, without restarting
  it — useful for "actually, focus on X" mid-task.
- **interrupt** aborts the current run and handles the new message immediately — the
  "stop, do this instead" case.

The queue also debounces (default 1000ms), caps depth (default 20) with an explicit drop
policy (`old` / `new` / `summarize`), and deduplicates. These are the knobs that keep a
chatty client from spawning runaway concurrent work. The queue is collapsed to a single
global instance here for single-user; the *semantics* are the part that transfers.

## 3. Store-then-reference data feeding

External and tool-produced data is the third resilience concern, and it's treated as
**untrusted by default** (see [chapter 03](03-tool-runtime-security.md) for the wrapping)
*and* as too large to dump into the prompt. The discipline lives in
[`../src/context/tool-result-truncation.ts`](../src/context/tool-result-truncation.ts) and
is stated in its header:

> never pour a full payload into the prompt just because the model might want a few
> fields from it.

`formatToolResult` renders a list-shaped result with a layered character budget and then
points the model at a retrieval tool for the rest:

```ts
export const DEFAULT_RENDER_CONFIG: ToolRenderConfig = {
  itemLimit: 50,   // at most 50 items reach the prompt
  frontCount: 10,  // the first 10 get a longer budget...
  frontChars: 250,
  restChars: 100,  // ...the rest get a shorter one
};
```

The full result is **not** mutated — it stays cached in agent state (reachable via
`AgentToolContext.agentState`, see [`../src/types.ts`](../src/types.ts)) so the UI can
render every row. The model is fed a representative slice plus a marker:

```ts
const cacheNote =
  `\n\n[CACHE] Cached ${total} item(s); rendered top ${shown}. ` +
  `These are representative rows, not the full population. ` +
  `Use retrieve_cached_data to access the full cached result instead of re-running this tool.`;
```

This is "store-then-reference": store the full payload, feed a reference. It controls both
cost (the prompt carries a slice, not the population) and correctness (the model fetches
more on demand rather than re-running an expensive tool). A separate last-resort net,
`truncateToolResultText`, head+tail-truncates any single oversized text block, deliberately
preserving error/summary content near the end.

## Data that must survive compaction

When history is summarized away, some facts are too important to lose in a lossy summary.
[`../src/context/compaction-safeguard.ts`](../src/context/compaction-safeguard.ts) treats
two things as **unsummarizable** and re-attaches them to the summary:

- **tool-failure records** — what was tried and why it failed, so the agent doesn't
  blindly retry a known-broken call; and
- **the set of files read vs. modified** — so the agent keeps a stable map of what it has
  already touched.

There's even a fallback path: if summarization itself fails, the safeguard produces a
standalone summary carrying these facts forward. The idea — *identify the residue that
lossy compression must not drop, and protect it explicitly* — is the same
store-then-reference instinct applied to history instead of tool output.

## Why these belong together

Errors, concurrent input, and oversized data are the three ways a long-running agent loses
control of its own state. Each is handled the same way here: name the cases explicitly,
decide once in a single place, and make the data flow by reference rather than by value.
That's the [chapter 00](00-foundations-over-features.md) spine applied to runtime
robustness.

## Where to go next

- [03 · Tool runtime + security](03-tool-runtime-security.md) — the untrusted-content wrapping that precedes feeding.
- [05 · Tenant isolation, collapsed](05-tenant-isolation-collapsed.md) — why recovery and queue keep `userId` as a seam.
- [06 · Metering](06-metering-optional.md) — usage accounting that books a delta even when a run throws mid-flight.
