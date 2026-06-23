# ⚠️ Cautionary teaching material — ILLUSTRATIVE, NOT EXECUTED

**Nothing in this folder runs.** No file here is imported by the harness.

These files show **multi-tenant mechanisms** that a production harness was forced to harden,
collapsed to single-user here — each paired with the exact line where copying the single-user
shortcut breaks under concurrency or multiple users, and the mechanism that fixes it.

This is the point of the project: the *form* is single-user (implicit `userId: 'local'`, no quota
gate, one global queue), but the *mechanisms* are kept as live seams so re-expanding to
multi-tenant is a configuration change, not a rewrite. A harness built single-user from day one
never had to solve these — so it has nowhere to put them back.

| File | The single-user shortcut | Where it breaks | The mechanism that fixes it |
|---|---|---|---|
| [`per-call-context.example.ts`](per-call-context.example.ts) | a global `currentUserId` | two concurrent requests interleave → cross-user data leak | identity travels in `context.userId`; missing context **fails loudly** |
| [`ownership.example.ts`](ownership.example.ts) | "every row is mine" | another user's id can read/write your rows | `verifyOwnership` + `WHERE user_id` as a runtime boundary |
| [`quota.example.ts`](quota.example.ts) | unmetered local spend | one tenant can exhaust shared budget | `reserve → delta → finalize` accounting + a per-UID gate |

Read these alongside [`docs/05-tenant-isolation-collapsed.md`](../../docs/05-tenant-isolation-collapsed.md).

> Why keep dead code at all? Because the contrast *is* the lesson. Every seam the live harness
> keeps (`execute(args, context)`, `verifyOwnership`, `reserve→delta→finalize`) only makes sense
> once you can see the multi-tenant failure it was shaped to prevent.
