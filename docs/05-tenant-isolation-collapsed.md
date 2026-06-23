# 05 · Tenant isolation, collapsed

> Notes on the single ↔ multi-tenant contrast in this repo. It marks three seams where
> the obvious single-user shortcut would become a data breach under concurrency or
> multiple users. The example files are ILLUSTRATIVE and are never executed.

## What this is

A harness built single-user from day one never has to solve tenant isolation — and so it
has nowhere to put isolation back when it grows. This repo is the reverse: it is a
multi-tenant-grade harness *collapsed* to single-user, with the isolation mechanisms kept
as **live seams** rather than deleted. The form is single-user (implicit `userId:
'local'`, no quota gate, one global queue); the mechanisms are intact, so re-expanding to
multi-tenant is a configuration change, not a rewrite.

What I find useful is the contrast itself. For each seam you can see, side by side: the
single-user shortcut, the exact line where copying it breaks, and the mechanism that
fixes it. That is why I *kept* the multi-tenant code (reframed alongside the shortcut)
rather than removing it.

## A warning not to miss

**Nothing in [`../src/cautionary/`](../src/cautionary/) runs.** Every file there opens
with the same banner:

```ts
// ILLUSTRATIVE — NOT EXECUTED. Nothing here is imported by the harness. See ./README.md.
```

These files are not wired into the runtime; no part of the harness imports them. They
exist purely to make the failure visible. Reading them as if they were live code — "the
harness checks quotas, look, here is the quota gate" — would be exactly backwards: the
gate is shown precisely *because* the single-user form leaves it out. They are annotated
diagrams, not behavior. The [cautionary README](../src/cautionary/README.md) states this
up front and tabulates all three seams.

## Seam 1 — per-call context (identity)

The single most dangerous shortcut to copy into a long-lived process is a process-global
identity. [`per-call-context.example.ts`](../src/cautionary/per-call-context.example.ts)
shows the trap:

```ts
let currentUserId: string | null = null;
function setCurrentUser(id: string) { currentUserId = id; }
async function loadUserMemoryTrap(): Promise<string> {
  return `memory for ${currentUserId}`; // reads ambient global state
}
```

In a single-user demo this looks fine — there is only one user. The file then shows the
exact interleaving where it breaks in a concurrent process:

```
req A: setCurrentUser('alice');     // currentUserId = 'alice'
req B: setCurrentUser('bob');       // currentUserId = 'bob'   (clobbers A)
req A: await loadUserMemoryTrap();  // returns BOB's memory to ALICE  ← leak
```

The fix is identity that travels *with the call*, and that fails loudly when absent:

```ts
async function loadUserMemory(ctx: CallContext): Promise<string> {
  if (!ctx.userId) {
    throw new Error('loadUserMemory: ctx.userId is required (no global fallback).');
  }
  return `memory for ${ctx.userId}`;
}
```

This is the shape the **live** harness uses. `AgentTool.execute(args, context)`
([`../src/types.ts`](../src/types.ts)) threads an `AgentToolContext` whose `userId` is the
caller identity; the run loop passes `{ userId: opts.userId ?? 'local' }`
([`../src/agent/react-loop.ts`](../src/agent/react-loop.ts)). In single-user that value is
always `'local'` — but it is a *seam*, never a constant baked into a global, so
concurrency can never leak one caller's data to another. Loud-fail over silent-fallback
turns a latent cross-tenant breach into an immediate, testable error.

## Seam 2 — ownership

In single-user, ownership is trivially true: every row belongs to the one user. The
shortcut is to drop the check.
[`ownership.example.ts`](../src/cautionary/ownership.example.ts) shows where that breaks
the moment a second user exists:

```ts
function getConversationTrap(conversationId: string): Row | undefined {
  return db.find((r) => r.id === conversationId);
}
// getConversationTrap('bobs-private-thread')  // returns Bob's row to Alice  ← IDOR
```

That is an Insecure Direct Object Reference — anyone who knows (or guesses) an id reads
anyone's data. The fix makes ownership a runtime boundary, enforced in code rather than
assumed:

```ts
async function getConversation(conversationId: string, userId: string): Promise<Row | undefined> {
  if (!(await verifyOwnership(conversationId, userId))) {
    throw new Error('Not found'); // do not reveal existence of rows you do not own
  }
  return db.find((r) => r.id === conversationId && r.userId === userId); // WHERE id AND user_id
}
```

The live memory adapter keeps `verifyOwnership(conversationId, userId)` in its interface
and carries `userId` into every query. In single-user that id is always `'local'` and the
check is a near-no-op — but the boundary *exists*, so going multi-tenant is a config
change, not a security re-audit. This is the same runtime-not-prompt stance as
[chapter 03](03-tool-runtime-security.md), applied to data access. One small but
important detail: the error says "Not found," not "Forbidden," so the system never reveals
the existence of rows you do not own.

## Seam 3 — metering

Metering is the third seam, covered in depth in [chapter 06](06-metering-optional.md).
[`quota.example.ts`](../src/cautionary/quota.example.ts) shows that the *accounting* —
`reserve → delta → finalize` — is identical in both forms; only the **gate** differs. In
single-user it is a local spend meter (a dashboard number). In multi-tenant the same
accounting feeds a per-UID quota gate that returns 429/503 when a tenant exceeds its
budget, so one tenant cannot exhaust a shared budget and starve everyone else. The gate
is *additive*: the accounting it depends on already ships, so re-introducing it adds code
rather than rewriting it.

## The pattern across all three seams

Every seam follows the same three-part shape:

| Seam | Single-user shortcut | Where it breaks | Mechanism that fixes it |
|---|---|---|---|
| per-call context | a global `currentUserId` | two concurrent requests interleave → cross-user leak | identity in `context.userId`; missing context **fails loudly** |
| ownership | "every row is mine" | another user's id can read/write your rows | `verifyOwnership` + `WHERE user_id` as a runtime boundary |
| metering | unmetered local spend | one tenant exhausts shared budget | `reserve → delta → finalize` + a per-UID gate |

The unifying move is: **keep the seam, collapse the dimension.** The tenant dimension is
flattened (one user, id `'local'`), but the *place where the dimension would live* —
`context.userId`, `verifyOwnership`, the metering gate — is preserved. A seam costs almost
nothing in single-user (an always-`'local'` parameter, a near-no-op check) and saves a
rewrite later.

## Why keep dead code at all

Because the contrast is what carries the meaning. As the cautionary README puts it: every
seam the live harness keeps only makes sense once you can see the multi-tenant failure it
was shaped to prevent. Delete the multi-tenant code and the seams look like pointless
ceremony — an always-`'local'` argument, a check that never fails. Keep it, clearly
labeled as illustrative, and the seams read as deliberate, load-bearing foundations in the
sense of [chapter 00](00-foundations-over-features.md).

## Where to go next

- [06 · Metering](06-metering-optional.md) — the third seam in full: accounting identical, only the gate differs.
- [00 · Foundations over features](00-foundations-over-features.md) — why a cheap seam beats a future rewrite.
- [`../src/cautionary/README.md`](../src/cautionary/README.md) — the source files, with the warning banner.
