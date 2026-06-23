# 11 — Mechanism Over Form

> This repo keeps a distinction between a *mechanism* — *how* a problem is solved
> (identity travels with the call, ownership is a runtime boundary, spend is accounted
> before it is gated) — and a *form* — *the shape it's deployed in* (single process or
> many, one user or thousands, local disk or a cloud database). It ships in a small
> form but keeps the mechanisms in their general shape, because the mechanism is the
> part that carries across forms and the form is the part that's cheap to change.

Grounded in:
- [`../src/types.ts`](../src/types.ts) — `AgentToolContext.userId` as a threaded seam; `AgentRunUsage` / `UsageDelta`
- [`../src/memory/adapter.ts`](../src/memory/adapter.ts) — `verifyOwnership` and `userId` on every method
- [`../src/cautionary/`](../src/cautionary/) — the same mechanisms shown in single-user form with the breakpoint marked

Related chapters: [10 — Engineering Discipline](10-engineering-discipline.md) · [12 — A Future Control Plane](12-future-control-plane.md) · [08 — Memory Lifecycle](08-memory-lifecycle.md)

---

## What this is

This harness ships in a **single-user, single-process, local** form. There is one
implicit owner (`userId` defaults to `'local'`), no quota gate, one queue. And yet it
keeps mechanisms that only ever *bite* in a multi-user, multi-request, distributed
form: identity is threaded through every call instead of read from a global; the memory
adapter carries `verifyOwnership` on its interface; usage is accumulated as
`reserve → delta → finalize` even though nothing gates on it.

From the outside that can look like over-engineering for a single user. Here it's a
deliberate choice to **keep multi-tenant-grade mechanisms in a single-user form**,
because the mechanism is the part that transfers and the form is the part I can collapse
or expand later.

## Why a mechanism transfers and a form does not

Here are three shortcuts that are *correct* for the single-user form, and what happens
when only the form changes around them.

### 1. Identity

The single-user shortcut is a process global:

```ts
let currentUserId: string | null = null;          // looks fine — there is only one user
async function loadUserMemoryTrap() { return `memory for ${currentUserId}`; }
```

Change *only the form* — same code, now serving two concurrent requests in one
long-lived process — and request B's `setCurrentUser('bob')` clobbers request A's
identity between A's lines. A reads Bob's memory. The code never changed; the form did,
and the form was load-bearing.

The mechanism that survives any form is in [`../src/types.ts`](../src/types.ts):
identity travels in `AgentToolContext.userId`, threaded through `execute(args, context)`,
and a missing identity **fails loudly** rather than falling back to a global. In the
single-user form `userId` is always `'local'`; the mechanism costs almost nothing. But
because it is a *seam, not a constant*, the concurrent-form failure simply cannot
happen. (Worked example: [`../src/cautionary/per-call-context.example.ts`](../src/cautionary/per-call-context.example.ts).)

### 2. Ownership

The single-user shortcut is "every row is mine — drop the check." True for one user.
Change the form to two users and the *same* read function hands Bob's private row to
Alice — an IDOR. The mechanism that survives is ownership as a **runtime boundary**:
[`adapter.ts`](../src/memory/adapter.ts) keeps `verifyOwnership(conversationId, userId)`
on the interface and every query carries `userId`. In single-user it is a near-no-op;
across forms it is the difference between a boundary and a breach. (Worked example:
[`../src/cautionary/ownership.example.ts`](../src/cautionary/ownership.example.ts).)

### 3. Spend

The single-user shortcut is "don't meter — it's my own machine." Fine, until the form
gains a second consumer who can exhaust a shared budget. The mechanism that survives is
the *accounting* — `reserve → delta → finalize` — kept as `AgentRunUsage` /
`UsageDelta` in [`../src/types.ts`](../src/types.ts). In single-user that accounting is
just a spend meter (a dashboard number). Adding a per-consumer gate later is *additive*,
because the accounting it depends on already exists. (Worked example:
[`../src/cautionary/quota.example.ts`](../src/cautionary/quota.example.ts).)

## The asymmetry behind the choice

In all three cases the pattern is identical:

| | The shortcut (form-coupled) | The mechanism (form-independent) |
|---|---|---|
| Identity | global `currentUserId` | `userId` in `execute(args, context)`, loud-fail if absent |
| Ownership | "every row is mine" | `verifyOwnership` + `WHERE user_id` as runtime boundary |
| Spend | unmetered local cost | `reserve → delta → finalize` accounting, gate optional |

Going **mechanism → form** is a configuration change: set `userId = 'local'`, omit the
gate, collapse the queue. Going **form → mechanism** — taking single-user code and
making it safe under concurrency and multiple users — is a re-audit of every place that
assumed there was only one of something. The first direction is cheap and reversible;
the second is expensive and easy to get wrong. So the mechanism is built once, in its
general form, and *collapsed* into the form that's needed — rather than the reverse.

A harness built single-user from day one never had to solve identity-under-concurrency,
ownership-across-users, or shared-budget exhaustion — so it has **nowhere to put those
mechanisms back**. Keeping them as live seams, even when the form makes them look
unnecessary, is what lets this harness move between forms without a rewrite.

## What this is *not*

It is not "build for scale you don't have." The form here is genuinely the small one:
one process, one user, no gate, no cloud store. The mechanisms add seams, not
infrastructure — a `context` argument, a `verifyOwnership` method, two usage structs.
The idea is to keep the *cheap* part of the general solution (the seam) while dropping
the *expensive* part (the gate, the partitioning, the distributed store) until the form
actually demands it. That's the opposite of speculative building — it keeps the option
open at near-zero cost, and avoids baking the form into places the form has no business
being.

## Notes

The same distinction shows up across the repo: the tool contract, the ReAct loop, the
retrieval pipeline, and the safety boundaries are all written as mechanisms that don't
assume the small form — while the form-coupled shortcuts (global identity, a
file-on-disk home directory, the absence of accounting) are exactly the parts kept out
of the general path. Where a shortcut would have been fine for a single user, the
[cautionary samples](../src/cautionary/) keep the mechanism next to it with the
breakpoint marked, so the form-coupled version is visible without being the one that
ships.
