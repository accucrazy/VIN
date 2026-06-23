# `agent/` — the ReAct loop skeleton

This is the engine. An agent is a row of **data** (`AgentDefinition`); the loop is the
**mechanism**; the two never fuse into a per-agent class. Read this before the files — it tells you
where the seams are so you can swap any of them.

```
runAgent(agent, input)            executor.ts — data → loop seam
        │
        ▼
executeReActLoop(input, opts)      react-loop.ts — the readable engine
        │   for each iteration:
        │     provider.generateContent({ tools })   ← roster derived from ToolRegistry
        │     (1) native function calls?  ───────────────┐
        │     (2) else regex-parse the text  ────────────┤  whichever produced a call
        │     (3) FAIL-CLOSED GATE per call:             ▼
        │           registry.get(name)?  → unknown never runs
        │           checkToolPolicy()    → deny > allow
        │           registry.execute()   → run + trace + truncate
        └─▶ no call ⇒ final answer
```

## What each file is

- **`react-loop.ts`** — `executeReActLoop(input, opts): Promise<{ answer, traces }>`. The whole
  shape in ~90 lines. Production is ~2500 lines carrying business state; this is the methodology
  stripped of that. The loop is a skeleton: the provider and tool calls are real seams but the demo
  is not wired to run end-to-end.
- **`executor.ts`** — `runAgent(agent, input, { delegationDepth? })`. A thin adapter from an
  `AgentDefinition` to `executeReActLoop`. Metering / error-recovery would also hang off here in
  production; here it stays minimal.
- **`registry.ts`** — the `agentRegistry` singleton (registers `VIN` + `RESEARCHER`). The roster is
  `agentRegistry.list()`, never hand-maintained.
- **`vin.ts`** — `VIN`, the generalist agent; its policy allows `delegate_to_agent`.
- **`researcher.ts`** — `RESEARCHER`, a focused sub-agent; not given `delegate_to_agent`, so it
  can't re-delegate.
- **`delegate.tool.ts`** — `delegate_to_agent`, the multi-agent seam as one data-driven tool (see
  [`../../docs/13-delegation-and-subagents.md`](../../docs/13-delegation-and-subagents.md)).
- **`types.ts`** — `AgentDefinition` (`id`, `name`, `systemPrompt`, `policy?`, `provider?`,
  `defaultModel?`, `a2aTools?`).
- **`index.ts`** — module barrel (re-exports the above).

## The three things to understand

**1. Tool-calling is native-first, regex-fallback, fail-closed.** The loop tries the provider's
native function calls (`res.toolCalls`); if empty, it regex-parses a ```` ```tool ```` block out of
the text. Either way every call passes the **fail-closed gate** before it can run:

```ts
if (!registry.get(call.name)) { /* unknown / regex-forged name → never executes */ }
const gate = checkToolPolicy({ toolName: call.name, policy: opts.policy }); // deny > allow
if (!gate.allowed) { /* denied → never executes */ }
```

A name the model hallucinated, or one a regex forged, cannot reach `registry.execute`. The gate is
the security boundary, not the prompt.

**2. The roster is derived, not declared.** `react-loop.ts` builds the provider's `tools` array from
`ToolRegistry.getInstance().listTools()`. Register a tool ([`../tools/`](../tools/)) and it appears
to the model automatically — there is no second list to keep in sync.

**3. An agent is data; delegation is one tool.** Agents are `AgentDefinition`s in the registry, and
`delegate_to_agent` ([`delegate.tool.ts`](delegate.tool.ts)) hands a sub-task to one of them — it runs
that agent's own loop and returns the answer (spawn-and-return), bounded by a depth counter. Adding an
agent is adding a row, not subclassing the loop. See
[`../../docs/13-delegation-and-subagents.md`](../../docs/13-delegation-and-subagents.md).

## The seams to swap

| Want to change | Touch |
|---|---|
| The LLM behind the loop | the provider registry — see [`../providers/`](../providers/) |
| Which tools exist | register into [`../tools/`](../tools/); the roster follows |
| Allow/deny rules | `opts.policy` → [`../policy/`](../policy/) (`checkToolPolicy`) |
| How tool results enter context | `formatToolResult` in [`../context/`](../context/) |
| Caller identity | `opts.userId` (defaults to `'local'`) — a SEAM, see [`../cautionary/`](../cautionary/) |

`userId` defaulting to `'local'` is the single-user collapse. In a multi-tenant harness identity
travels with the call and missing identity fails loudly; here it is a constant. The seam is kept
live so re-expanding is a config change, not a rewrite.
