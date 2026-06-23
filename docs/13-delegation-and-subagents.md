# 13 · Delegation and sub-agents

Multi-agent here is deliberately small: an agent is a row of data, and delegation is a single
tool. There's no orchestrator and no per-target wiring — adding an agent is one more
`AgentDefinition` in the registry.

## The pieces

- The roster is data: [`../src/agent/registry.ts`](../src/agent/registry.ts) holds the
  `AgentDefinition`s and `list()` derives the roster. The demo registers two — `Vin` (generalist)
  and `Researcher` (a focused sub-agent).
- Delegation is one tool: [`../src/agent/delegate.tool.ts`](../src/agent/delegate.tool.ts) —
  `delegate_to_agent(agentId, task)`. It looks the target up in the registry, runs that agent's own
  ReAct loop, and returns its answer (spawn-and-return).

```ts
async execute(args, context) {
  const depth = (context?.agentState?.delegationDepth as number) ?? 0;
  if (depth >= MAX_DELEGATION_DEPTH) return { success: false, error: '…max depth…' };
  if (args.agentId === context?.agentState?.agentId) return { success: false, error: 'no self-delegation' };
  const child = agentRegistry.get(args.agentId);
  if (!child) return { success: false, error: 'unknown agent…' };
  const result = await runAgent(child, args.task, { delegationDepth: depth + 1 });
  return { success: true, data: { agentId: child.id, answer: result.answer } };
}
```

## Three guards, all in code

- **Depth** — `MAX_DELEGATION_DEPTH` bounds recursion; each hop increments `delegationDepth`, which
  travels in the tool context (`agentState`), not a global.
- **No self-delegation** — an agent can't delegate to itself (the caller id is in the context).
- **Who can delegate is policy** — `delegate_to_agent` is an ordinary tool, so the policy gate
  decides who may call it. Vin's policy allows it (`alsoAllow: ['delegate_to_agent']`); Researcher's
  doesn't, so a sub-agent can't re-delegate. See [chapter 03](03-tool-runtime-security.md).

## What's left out

The production version carries streaming (live agent/tool events), usage metering across the child
run, and concurrency lanes (main / sub-agent / nested) with a command queue — plus an async path
(background spawn, then announce the result back). None of that is here. `delegate_to_agent` is the
synchronous spawn-and-return core; the rest is what matters when it runs for real, not what shows
the shape.

## Where to go next

- [01 · Capability map](01-capability-map.md) — `delegate_to_agent` is just another `AgentTool`.
- [03 · Tool runtime + security](03-tool-runtime-security.md) — the policy gate that decides who can delegate.
