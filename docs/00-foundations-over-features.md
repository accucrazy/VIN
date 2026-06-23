# 00 · Foundations over features

> The idea this repository is built around. Read this first; the other chapters are
> instances of it.

## What this is

This harness has the usual surface features — memory, metering, context compaction, tool
calling — and on their own those are commodities. What I find more interesting is the
**single design spine** that runs through all of them. The features are the visible
surface; the spine is what decides how fast, how safely, and how far that surface can
grow.

This repo is a distillation of a production harness with the cloud and multi-tenant
machinery stripped out. What I kept on purpose is the spine. See the
[README](../README.md) for the one-paragraph framing; this chapter is about why the spine
is the part worth looking at.

## The spine, concretely

Open [`../src/types.ts`](../src/types.ts) before anything else. Its own header says it:

```ts
// Read this file first — it is the spine the whole harness hangs on.
```

Everything downstream is shaped by the contracts declared there. The same file defines:

- `AgentTool` — one contract for core, plugin, and MCP tools alike (see [chapter 01](01-capability-map.md));
- `ToolSource` plus the `mcp__` ⟺ `source === 'mcp'` invariant (see [chapter 02](02-naming-and-boundaries.md));
- `AgentToolContext.userId` — identity that travels with the call, not in a global (see [chapter 05](05-tenant-isolation-collapsed.md));
- `ToolPolicy` — declarative allow/deny resolved in the runtime, not the prompt (see [chapter 03](03-tool-runtime-security.md));
- `AgentRunUsage` / `UsageDelta` — `reserve → delta → finalize` accounting (see [chapter 06](06-metering-optional.md)).

Five different planes, one file of contracts. I co-located them on purpose: these aren't
five features bolted together, they're five expressions of one set of decisions.

## Why foundations buy future speed

A foundation is invisible. When it's done well, nothing in the demo looks different — the
same chat works, the same tool runs. The payoff is deferred and shows up only the next
time the system gets extended:

- Adding a new tool is *one* `AgentTool` and one `register()` call — it inherits the
  policy gate, the fail-closed runtime check, and metering for free, because the
  pipeline keys off the contract, not the tool. There's nothing per-tool to wire.
- Adding an external MCP server adds zero hot-path code: its tools are *materialized*
  into the same `AgentTool` shape and flow through the same gate (see
  [`../src/mcp/materialize.ts`](../src/mcp/materialize.ts)).
- Re-introducing multi-tenant isolation is a configuration change, not a rewrite,
  because identity already travels through `context` as a seam rather than a global
  (see [`../src/cautionary/`](../src/cautionary/)).

The inverse is the cautionary case. A harness built feature-first — each tool wiring its
own permission check, each capability inventing its own identity story — pays a small tax
every time and an enormous tax when a cross-cutting requirement (a new policy, metering,
an audit trail) arrives. There's no single place to add it. You add it N times and miss
the N+1th. The foundation that got skipped becomes the bug that ships.

## When to invest in foundations vs. ship a feature

Foundations aren't free, and "always build the foundation first" is bad advice. The
judgment I tried to encode here:

**Invest in a foundation when the decision is cross-cutting and expensive to reverse.**
The `AgentTool` contract, the name⟺source invariant, and per-call identity are all things
that, once many call sites depend on them, are painful to change. I tried to get those
right early; they're load-bearing.

**Ship the feature directly when it's local and cheap to change.** A single tool's
business logic, a one-off prompt, an additional model id — these touch few call sites and
carry no architectural weight. Wrapping them in speculative abstraction is the opposite
mistake: complexity with no payoff.

The question I ask isn't "is this important?" but "if I get this wrong, how many places
have to change to fix it?" High blast radius → foundation. Low blast radius → ship it.

## Why this reframes "a quiet week"

Foundation work produces no demo. A week spent making identity travel through `context`,
or pushing security enforcement down into the runtime, ends with a system that *looks*
identical and *behaves* identically — and is materially more able to grow. I treat that
as the actual work, not as overhead between features. The invisible upgrade is the one
that buys the next ten features their speed.

## Where to go next

- [01 · Capability map](01-capability-map.md) — the one contract that governs every tool plane.
- [02 · Naming and boundaries](02-naming-and-boundaries.md) — naming as an enforced architectural boundary.
- [03 · Tool runtime + security](03-tool-runtime-security.md) — why enforcement lives in the runtime.
- [05 · Tenant isolation, collapsed](05-tenant-isolation-collapsed.md) — the seams kept live for re-expansion.
