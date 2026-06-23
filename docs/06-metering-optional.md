# 06 · Metering (optional)

> The accounting is `reserve → delta → finalize` and it is identical in both deployment
> forms. In single-user it is a local spend meter; in multi-tenant the same numbers feed
> a quota gate. Only the gate differs — the accounting does not.

## What this is

Metering is usually thought of as a multi-tenant billing concern, so a single-user
harness "doesn't need it." Here I separate two ideas that are normally conflated:

- **accounting** — measuring what a run actually cost (tokens, steps, dollars); and
- **gating** — refusing to run when a budget is exhausted.

The accounting is useful everywhere and ships in both forms. The gate is the part that
only multi-tenant needs. Keeping them separate means single-user gets a useful spend
meter for free, and multi-tenant adds a gate without touching the accounting.

## The accounting types

The accounting lives in the core contracts ([`../src/types.ts`](../src/types.ts)), which
is itself how I treat metering as a first-class plane, not an add-on:

```ts
/** Per-run usage accumulation. In single-user this drives a local spend meter, not a quota gate. */
export interface AgentRunUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  llmSteps: number;
  toolSteps: number;
  costUsd: number;
}

/** Additive usage increment reported after each LLM/tool call (so a mid-run throw still books spend). */
export interface UsageDelta {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  llmSteps?: number;
  toolSteps?: number;
  provider?: string;
  model?: string;
  costUsd?: number;
}
```

`AgentRunUsage` is the running total for a run; `UsageDelta` is an increment reported
after each LLM or tool call. The comment on `UsageDelta` names the reason it is additive:
**a mid-run throw still books spend.** If a run crashes on iteration 4, the cost of
iterations 1–3 has already been accumulated as deltas, so nothing is lost. (The provider
layer feeds these — `TokenUsage` in
[`../src/providers/types.ts`](../src/providers/types.ts) reports per-generation tokens,
including `cachedTokens` for prompt-cache hit-rate observability.)

## reserve → delta → finalize

The accounting protocol is shown end-to-end in
[`../src/cautionary/quota.example.ts`](../src/cautionary/quota.example.ts). (As with
everything in that folder, **it is illustrative and never executed** — see
[chapter 05](05-tenant-isolation-collapsed.md) — but it documents the live mechanism.)

```ts
class SpendMeter {
  private spent: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  /** Optimistically reserve before a call so a mid-run crash still books the estimate. */
  reserve(estCostUsd: number): { settle: (actual: Usage) => void } {
    this.spent.costUsd += estCostUsd; // reserved
    return {
      settle: (actual) => {
        // finalize: replace the estimate with the measured delta.
        this.spent.costUsd += actual.costUsd - estCostUsd;
        this.spent.inputTokens += actual.inputTokens;
        this.spent.outputTokens += actual.outputTokens;
      },
    };
  }

  total(): Usage { return { ...this.spent }; }
}
```

The three phases:

1. **reserve** — before a call, optimistically add an estimate. If the process dies
   between here and the call returning, the estimate is already booked, so spend is never
   silently undercounted.
2. **delta** — each call reports its actual `UsageDelta` as it completes.
3. **finalize** — `settle` reconciles the estimate against the measured cost
   (`actual.costUsd - estCostUsd`), so the total reflects reality once the call returns.

Reserve-first is the key robustness property: the alternative (charge only on success)
loses the cost of any run that fails partway, which over many runs systematically
underreports spend.

## Single-user: a spend meter

In single-user, the accounting *is* the whole feature — a dashboard number, no gate:

```ts
// SINGLE-USER: this is all you need — a dashboard number. No gate.
//   const meter = new SpendMeter();
//   const r = meter.reserve(0.01); ... r.settle(measured);
//   console.log('spent so far', meter.total().costUsd);
```

This is genuinely useful even with one user: it answers "how much did this session cost?"
and lets you set an optional soft cap on local spend. Nothing about it is multi-tenant
ceremony.

## Multi-tenant: the same numbers, plus a gate

The only thing multi-tenant adds is a gate that *reads* the accounting and refuses to run
when a tenant is over budget:

```ts
class QuotaError extends Error {
  constructor(public readonly httpStatus: 429 | 503) { super('quota exceeded'); }
}

function checkQuota(perUserSpent: Map<string, number>, userId: string, monthlyCapUsd: number) {
  if ((perUserSpent.get(userId) ?? 0) >= monthlyCapUsd) {
    throw new QuotaError(429); // reject before doing the work
  }
}
```

The gate is checked *before* the work, so an over-budget tenant is rejected cheaply rather
than after running up more cost. The failure surfaces as a 429 (too many requests) or 503
(unavailable) — exactly the categories the error classifier already understands as
`rate_limit` (see [chapter 04](04-resilience-and-data-discipline.md)), so the recovery
path needs no special case.

The file states the relationship plainly:

```ts
// The live harness ships the SpendMeter accounting (as AgentRunUsage / UsageDelta in
// src/types.ts) and leaves `checkQuota` OUT for single-user. Re-introducing the per-UID gate is
// additive — the accounting it depends on is already there.
```

## Why only the gate differs

This is the cleanest case of the repo's central move (see
[chapter 05](05-tenant-isolation-collapsed.md)): **keep the mechanism, collapse the
dimension.** The expensive, easy-to-get-wrong part — correct reserve/delta/finalize
accounting that survives crashes — is built once and shipped in both forms. The
tenant-specific part — a per-UID gate keyed on `userId` — is a small additive layer over
accounting that already exists.

A harness that bolted metering on later, single-user-first, would have to retrofit the
accounting itself: thread usage through every call site, handle the mid-run-throw case,
reconcile estimates. By keeping the accounting as a live plane from the start (it is in
`types.ts`, the spine), "add a quota gate" becomes a feature, not a refactor — the
foundations-over-features bet from [chapter 00](00-foundations-over-features.md),
collected.

## Where to go next

- [05 · Tenant isolation, collapsed](05-tenant-isolation-collapsed.md) — metering as one of three seams; the cautionary framing in full.
- [04 · Resilience and data discipline](04-resilience-and-data-discipline.md) — why a `UsageDelta` is booked even when a run throws.
- [`../src/types.ts`](../src/types.ts) — `AgentRunUsage` / `UsageDelta`, the accounting in the core contract.
