# `session/` — error recovery + the followup queue

Two runtime concerns that keep a long-lived agent session alive: **classify failures and recover in
the right order**, and **handle user messages that arrive while the agent is busy**. Read this before
the files; it tells you the recovery ordering and the single-user collapse in the queue.

## `error-recovery/` — classify, then recover in order

```
error ─▶ classifyError() ─▶ ErrorClassification { category, severity, isRetryable, shouldResetSession }
                                   │
ErrorRecoveryManager picks the first applicable strategy, by priority:
   1. retry            (severity retryable/recoverable)   → signal "retry the operation"
   2. session-reset    (shouldResetSession)               → recommend a reset mode
   3. user-notification(severity user_action)             → surface a message, stop
```

- **`error-classifier.ts`** — `classifyError(error)` matches the message against per-category
  regex/string patterns into one of: `rate_limit`, `timeout`, `auth`, `billing`,
  `context_overflow`, `format`, `network`, `service`, `unknown`. A `SEVERITY_MAP` assigns
  `retryable | recoverable | user_action | fatal`; `context_overflow` and `format` are the categories
  that warrant a session reset. Plus boolean detectors (`isRateLimitError`, …) and
  `formatErrorForUser` / `formatErrorForLog`.
- **`types.ts`** — `ErrorCategory`, `ErrorSeverity`, `ErrorClassification`, the retry types
  (`RetryConfig`/`RetryOptions`/`RetryInfo`, `DEFAULT_RETRY_CONFIG`), reset types
  (`RecoveryResetMode` = `soft|hard|archive`), `ErrorRecoveryStrategy`/`Context`/`Result`, and the
  per-category `ERROR_MESSAGES`.
- **`retry.ts`** — `retryAsync`, `withTimeout`, `retryWithTimeout`, backoff helpers (exponential +
  jitter).
- **`session-reset.ts`** — `SessionResetHandler` (`softReset` / `hardReset` / `archiveAndCreate`);
  `determineResetMode` maps a classification to a mode.
- **`recovery-manager.ts`** — `ErrorRecoveryManager` (singleton via `getErrorRecoveryManager`). The
  **ordering** is the design: strategies are priority-sorted and the *first* applicable one wins, so
  a retryable error retries before anything considers resetting. `executeWithRecovery(fn, …)` wraps a
  call with the whole loop (retry with backoff, reset-if-recommended, give up after `attempts`).
- **`index.ts`** — barrel.

Note the strategies **recommend**; they don't reset by themselves. `execute()` returns
`shouldRetryOperation` / `recommendedResetMode`, and `executeWithRecovery` is the caller that acts on
them. That keeps classification and side-effects separable.

## `followup-queue/` — messages that arrive mid-run

When the user sends a message while the agent is still working, the queue decides what to do with it.
Six modes (`QueueMode`): `collect` (default — merge, reply once), `steer` (factor new instructions
into the in-flight run), `interrupt` (abort and handle now), `followup` (one by one),
`steer-backlog`, `queue` (alias of steer).

- **`types.ts`** — `QueueMode`, `QueueDropPolicy` (`old|new|summarize`), `FollowupRun`,
  `QueueSettings` / `DEFAULT_QUEUE_SETTINGS` (mode `collect`, 1 s debounce, cap 20),
  `FollowupQueueState`, `ActiveRunContext`, and the `normalize*` helpers.
- **`state.ts`** — the queue store. **Collapsed to a single global queue** (`GLOBAL_QUEUE`) for
  single-user; `getFollowupQueue`, `setActiveRunContext`, mode/drop-policy setters.
- **`enqueue.ts`** — `enqueueFollowupRun` (dedup, per-mode handling, overflow via drop policy) and
  the steer/interrupt/dropped-count accessors.
- **`drain.ts`** — `scheduleFollowupDrain(callbacks)`: the debounce-then-drain engine. Per mode it
  builds a prompt (`buildCollectPrompt` / `buildSteerPrompt`) and invokes your callback. Carries a
  `filter` arg so a per-conversation drain doesn't swallow another conversation's items — a live
  multi-conversation seam in otherwise single-user code.
- **`index.ts`** — barrel.

## The single-user collapse (read this)

`state.ts` holds **one** `GLOBAL_QUEUE`. In the multi-tenant harness this was keyed per user/UID;
here it's a global because there is one user. The mechanism — modes, debounce, drop policy,
per-conversation `filter` — is intact; only the keying collapsed. That is the deliberate gap this
repo makes visible. See [`../cautionary/`](../cautionary/) for what re-expanding to per-tenant queues
costs.
