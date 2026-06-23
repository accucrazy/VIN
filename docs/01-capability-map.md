# 01 · The capability map

> One contract governs every tool. Core tools, plugin tools, and external MCP tools are
> the same shape; only a tag distinguishes them; the whole pipeline applies uniformly.

## What this is

The harness gathers capabilities from several places — built-in code, plugins loaded at
runtime, and external MCP (Model Context Protocol) servers. The obvious design gives each
source its own type and its own handling path. Here I made the opposite choice:
**there's exactly one capability contract, `AgentTool`, and everything is that.** The
source of a tool is a *tag*, not a type. Governance keys off the tag where needed, but
execution, policy, and security treat all tools identically.

## The one contract

From [`../src/types.ts`](../src/types.ts):

```ts
export interface AgentToolDefinition {
  name: string;          // sanitized to lowercase [a-z0-9_]
  description: string;   // what the LLM reads to decide when to call
  inputSchema: JSONSchema;
  category?: ToolCategory;
}

export interface AgentTool extends AgentToolDefinition {
  execute(args: Record<string, any>, context?: AgentToolContext): Promise<AgentToolResult>;
}
```

That's the whole surface a tool must satisfy: a name, a description, an input schema, and
an `execute` function. The model sees the definition; the runtime calls `execute`.

## Source is orthogonal to everything else

The same file defines source as a separate axis:

```ts
/**
 * Tool *source* — orthogonal to *exposure* (whether a tool is externally reachable).
 *  - 'core'   built-in
 *  - 'plugin' registered by a plugin
 *  - 'mcp'    materialized from an external MCP server into this same AgentTool shape
 */
export type ToolSource = 'core' | 'plugin' | 'mcp';
```

The word **orthogonal** is the design statement. *Source* (where the tool came from) is
independent of *exposure* (whether it's externally reachable) and independent of *shape*
(which is always `AgentTool`). Because they're separate axes, each one can be reasoned
about alone: a `core` tool and an `mcp` tool differ only in a string field, so any code
that doesn't specifically care about provenance never has to branch.

## One registry holds all three

The registry ([`../src/tools/registry.ts`](../src/tools/registry.ts)) stores core,
plugin, and MCP-materialized tools in a single `Map`, each entry tagged with its source:

```ts
register(tool: AgentTool, opts?: ToolRegisterOptions): void {
  // Derive source: explicit wins, else pluginId decides.
  const source: ToolSource = opts?.source ?? (opts?.pluginId ? 'plugin' : 'core');
  // Fail loudly if the reserved-namespace invariant is violated.
  assertNameSourceInvariant(tool.name, source);
  ...
}
```

Source is *derived*: a tool registered with a `pluginId` is automatically `plugin`; a
bare registration is `core`; `mcp` is set explicitly during materialization. There's no
way to register a tool without a source, and the name⟺source invariant is checked on
every registration (see [chapter 02](02-naming-and-boundaries.md)).

The registry keeps two deliberately separate views:

```ts
listTools(): AgentToolDefinition[]       // LLM-facing — no source leaks to the model
listToolsMeta(): Array<{ name; source; pluginId }>  // governance truth
```

The model never sees provenance; the governance layer always can. That split is itself an
application of "source is orthogonal to exposure."

## The whole pipeline applies uniformly

Because every tool is an `AgentTool`, the run loop has exactly one execution path. From
[`../src/agent/react-loop.ts`](../src/agent/react-loop.ts):

```ts
// (3) FAIL-CLOSED GATE: unknown (e.g. regex-forged) name never executes
if (!registry.get(call.name)) { /* reject */ continue; }
// policy gate — deny over allow, layered (see policy/)
const gate = checkToolPolicy({ toolName: call.name, policy: opts.policy });
if (!gate.allowed) { /* reject */ continue; }
const result = await registry.execute(call, { userId: opts.userId ?? 'local' });
```

Notice what's *absent*: there's no `if (source === 'mcp')` branch, no special case for
plugin tools. The fail-closed existence check, the policy check, and execution apply to
the call by name. A new source could be added tomorrow and this loop wouldn't change.

## Plugins inject into the same registry

A plugin doesn't own its own tool table. It receives a `PluginApi`
([`../src/plugin/types.ts`](../src/plugin/types.ts)) whose `registerTool` funnels the
tool into the shared registry, tagged with the plugin's id
([`../src/plugin/registry.ts`](../src/plugin/registry.ts)):

```ts
registerTool: (tool: AgentTool) => {
  // Tools registered via a plugin carry source:'plugin' (pluginId implies it).
  toolRegistry.register(tool, { pluginId });
  metadata.toolCount++;
},
```

The same `pluginId` tag enables clean teardown — `unregisterByPlugin(pluginId)` removes
every tool, hook, service, and route a plugin contributed, so a reload leaks nothing. The
plugin system also exposes lifecycle hooks (`before_tool_call` can block a call,
`message_sending` can cancel an outbound message), all priority-ordered and
error-isolated in [`../src/plugin/hooks.ts`](../src/plugin/hooks.ts).

## MCP tools are materialized, not special-cased

External MCP servers are where one contract gets tested hardest. The MCP client
([`../src/mcp/client.ts`](../src/mcp/client.ts)) speaks the real protocol over stdio, but
[`../src/mcp/materialize.ts`](../src/mcp/materialize.ts) wraps each remote tool into an
ordinary `AgentTool`:

```ts
return {
  name: materializedName,          // mcp__<server>__<tool>
  description: ...,
  inputSchema,
  category: 'custom',
  async execute(args, _context) {
    const raw = await callFn(originalToolName, args ?? {});
    return normalizeMcpResult(raw, serverId, originalToolName);
  },
};
```

Once materialized, an MCP tool is registered with `source: 'mcp'` and from that point on
is indistinguishable from a core tool to the run loop. It inherits the policy gate, the
hooks, the fail-closed check, and metering with **zero hot-path changes**. The header of
both MCP files states the principle directly: *"one contract, two boundaries: external
MCP tools become ordinary AgentTools."* The protocol boundary lives entirely inside
materialization; above it, there's just `AgentTool`.

## Why this is a foundation, not a feature

A capability map like this is the kind of cross-cutting decision
[chapter 00](00-foundations-over-features.md) is about investing in early. Every later
capability — a new tool, a plugin, an MCP server — is cheap precisely because it lands on
a contract that already carries governance, security, and metering. The cost was paid
once, in the contract; the benefit gets collected every time the system grows.

## Where to go next

- [02 · Naming and boundaries](02-naming-and-boundaries.md) — how the `mcp__` prefix is enforced as an invariant.
- [03 · Tool runtime + security](03-tool-runtime-security.md) — the policy and security layers the contract feeds into.
- [06 · Metering](06-metering-optional.md) — the usage accounting every tool inherits.
