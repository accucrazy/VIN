# 10 — Engineering Discipline: Evidence, Restraint, Honesty

> Three habits run through this codebase, as much a part of how I built it as any
> algorithm: **prove changes before asserting them** (verification gates), **do
> less on purpose** (explicit do-NOT lists, trimming over speculative building), and
> **label illustrative code so it is never mistaken for live**. None of these are
> tied to a single feature; they are just how the repo is put together.

Grounded in:
- [`../scripts/secret-scan.sh`](../scripts/secret-scan.sh) — the secret-scan verification gate
- [`../src/tools/tool-name.ts`](../src/tools/tool-name.ts) — the structural invariant enforced at register time
- [`../src/tools/registry.ts`](../src/tools/registry.ts) — fail-loud registration
- [`../src/memory/embed.ts`](../src/memory/embed.ts), [`../src/memory/rerank.ts`](../src/memory/rerank.ts) — seams labeled as not-yet-wired
- [`../src/cautionary/`](../src/cautionary/) — illustrative code, explicitly marked NOT EXECUTED

Related chapters: [11 — Mechanism Over Form](11-mechanism-over-form.md) · [12 — A Future Control Plane](12-future-control-plane.md)

---

## 1. Evidence before assertions

A change isn't "done" because it looks done — it's done when something *checks* it.
I wired that into runnable gates rather than relying on review attention.

### The secret-scan gate

[`secret-scan.sh`](../scripts/secret-scan.sh) is a one-file gate: it greps the tree for
forbidden patterns — known API-key shapes, private-key headers, internal identifiers,
cloud endpoint hostnames — and **exits non-zero** if any appear. The literal pattern
list lives in [`secret-scan.sh`](../scripts/secret-scan.sh) and is kept out of this doc
so it doesn't trip its own scanner; the shape is:

```sh
PATTERN='...'   # see scripts/secret-scan.sh for the actual list
HITS=$(grep -rEnI "$PATTERN" "$ROOT" --exclude-dir=node_modules --exclude-dir=.git ...)
if [ -n "$HITS" ]; then echo "SECRET-SCAN FAIL:"; echo "$HITS"; exit 1; fi
echo "SECRET-SCAN PASS"; exit 0
```

For a public repo, "I didn't commit a secret" is a *claim*; a passing scan is
*evidence*. The gate makes the safe state cheap to verify and the unsafe state loud.
It runs against any directory: `bash scripts/secret-scan.sh docs`.

### Structural checks (invariants enforced in code)

The other form of evidence here is an invariant the code refuses to violate at runtime.
[`tool-name.ts → assertNameSourceInvariant`](../src/tools/tool-name.ts) enforces the
bidirectional rule **`mcp__` prefix ⟺ `source === 'mcp'`**:

```ts
export function assertNameSourceInvariant(name: string, source: ToolSource): void {
  if (isMcpToolName(name) !== (source === 'mcp')) {
    throw new Error(`"mcp__" is a reserved namespace for MCP materialized tools: ...`);
  }
}
```

[`registry.ts → register`](../src/tools/registry.ts) calls it on every registration, so
a mislabeled tool fails *at register time*, loudly, not silently three layers later
when a policy rule misses it. It's the same shape as `getMemoryAdapter()` throwing when
memory was never initialized: a missing precondition is surfaced as a bug, not papered
over with a default. That's **loud-fail over silent-fallback** as a structural check.

## 2. Disciplined non-doing

The hardest part of the discipline is *not* writing code. Two forms of that show up
throughout.

### Explicit do-NOT lists

Decisions about what was deliberately left out are written down, not just absent. The
cautionary README (see [`../src/cautionary/`](../src/cautionary/)) states the
single-user form ships *without* a quota gate, *without* a global queue per tenant,
*without* ownership ACLs — and then explains why each omission is correct for the form
and exactly where copying the omission would break under concurrency. An omission that
is documented is a decision; an omission that is merely missing is an accident waiting
to be "fixed" by the next contributor.

### Trimming over speculative building

The codebase is described in its own type spine as **distilled** from a larger
production harness, with product-specific machinery *removed* rather than rebuilt
green-field ([`../src/types.ts`](../src/types.ts) header). Where a feature isn't needed
in the single-user form, I trim it to a seam rather than keep a half-wired version that
looks live. `tool-name.ts` does this even for a tiny detail: `TOOL_NAME_ALIASES` ships
**empty**, with a comment that it is *a mechanism, not a place for business shortcuts*.
The mechanism is present; speculative content is not. It's the Karpathy-style "minimum
code that solves the problem, nothing speculative" applied at architecture scale.

## 3. Labeling illustrative code

The most dangerous thing in a repo like this is code that *looks* live but isn't —
because a reader will copy it as if it ran. Two conventions guard against that.

### Seams are labeled as seams

A seam is a function with the right signature whose real work is intentionally
deferred. [`embed.ts`](../src/memory/embed.ts) **throws** until you configure a local
embedder, with the error pointing at this docs set; [`rerank.ts`](../src/memory/rerank.ts)
is a graceful no-op that returns the input order and says so. Neither pretends to work.
You can tell at a glance "this is wired to nothing yet" — which is honest, and which
keeps the demo from silently returning wrong results.

### Cautionary code is fenced off

Everything in [`../src/cautionary/`](../src/cautionary/) carries a first-line banner —
`// ILLUSTRATIVE — NOT EXECUTED. Nothing here is imported by the harness.` — and the
folder README repeats it: **nothing in that folder runs**, no file is imported. These
files show multi-tenant mechanisms (a global `currentUserId` trap, the IDOR a missing
ownership check creates, an unmetered-spend gap) paired with the exact line where the
single-user shortcut breaks and the mechanism that fixes it. The contrast only works
because it is unmistakably marked as not-live. Leaving unmarked dead code that *reads*
as live would directly contradict habit #1: it would let someone assert "the harness
does X" without evidence that X actually runs.

## How the three fit together

These three habits reinforce each other. Verification gates make claims checkable.
Restraint keeps the surface small enough that the gates stay meaningful. Honest
labeling keeps anyone from mistaking a seam or a cautionary sample for a proven
mechanism. Together they are why the repo can say "this works" and mean it — and why it
can show a *broken* pattern without that pattern leaking into a production copy.
