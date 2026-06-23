# 02 · Naming and boundaries

> Naming is boundary discipline. A reserved namespace plus an invariant that ties a name
> to its source tag makes a boundary impossible to cross by accident — a breach becomes a
> registration-time error, not a latent bug.

## What this is

Naming here is a real boundary, not just a convention. The harness reserves a namespace
for tools materialized from external MCP servers (`mcp__<serverId>__<toolName>`) and
protects it with a single, bidirectional invariant: a name carries the `mcp__` prefix
**if and only if** its source is `'mcp'`. Pair that with name normalization so the policy
gate and the registry can never disagree, and naming becomes a hard boundary the registry
upholds for you.

## The invariant: prefix ⟺ source

The boundary between in-process tools (core/plugin) and tools materialized from real
external MCP servers is enforced by a single invariant in
[`../src/tools/tool-name.ts`](../src/tools/tool-name.ts):

```ts
/**
 * The bidirectional invariant: `mcp__` prefix  ⟺  source === 'mcp'.
 *  - forward:  a non-'mcp' source must NOT use the mcp__ prefix (avoids colliding with real MCP tools).
 *  - reverse:  a source:'mcp' tool MUST carry the mcp__ prefix, or `mcp__*` allow/deny policy
 *              would miss it and the namespace seam would be bypassed.
 * Both violations fail loudly at register time.
 */
export function assertNameSourceInvariant(name: string, source: ToolSource): void {
  if (isMcpToolName(name) !== (source === 'mcp')) {
    throw new Error(
      `[tool-name] "${MCP_TOOL_NAME_PREFIX}" is a reserved namespace for MCP materialized tools: ` +
        `tool name prefix and source:'mcp' must match (tool "${name}", source: ${source}).`
    );
  }
}
```

It reads as an equivalence. Both directions matter:

- **Forward** — a core or plugin tool may not squat on the `mcp__` namespace. Otherwise it
  could collide with a materialized MCP tool and shadow it.
- **Reverse** — an MCP tool must carry the prefix. Otherwise an operator's
  `deny: ['mcp__*']` policy rule would silently miss it, and the namespace boundary would be
  bypassed without any error.

The check runs inside `register()` ([`../src/tools/registry.ts`](../src/tools/registry.ts))
on *every* tool, so a violation can't reach the running system — it throws at registration.
This is the same "loud-fail over silent-fallback" stance the harness takes with identity
(see [chapter 05](05-tenant-isolation-collapsed.md)): a boundary breach becomes an
immediate, testable error rather than a latent leak.

## Normalization closes the case-sensitivity hole

A name boundary is only as strong as the matching that enforces it. The same file normalizes
names so the gate and the registry can never disagree:

```ts
export function normalizeToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}
```

Tool names are expected to be lowercase `[a-z0-9_]` so that
`normalizeToolName(name) === name`. This closes the "gate allows but registry lookup misses"
case-sensitivity hole: if the policy gate lowercased a name (`MyTool` → `mytool`) but the
registry stored it case-sensitively (`MyTool`), a careless — or malicious — caller could
craft a casing the gate evaluates as allowed while the registry resolves to a different (or
no) entry. Forcing all names to a single normal form removes the gap. MCP materialization
follows the same rule: `sanitizeNameComponent` in
[`../src/mcp/materialize.ts`](../src/mcp/materialize.ts) lowercases every component, so a
materialized name is already in normal form when it's registered.

A small but telling detail: `__` (double underscore) is the namespace separator instead of
`:` because OpenAI and Gemini function-calling APIs disallow colons in tool names. The
boundary marker is chosen to survive the provider layer unchanged.

## Why it's separate

Naming reads like a style concern, but here it's a foundation in the sense of
[chapter 00](00-foundations-over-features.md): an enforced invariant turns a soft convention
into a hard boundary the registry upholds for you. The same instinct shows up elsewhere in
the repo — when a name implies a boundary, I make the system reject any state where the name
and the reality disagree.

## Where to go next

- [01 · Capability map](01-capability-map.md) — the `AgentTool` contract and the `source` axis this invariant guards.
- [03 · Tool runtime + security](03-tool-runtime-security.md) — how `mcp__*` patterns are used in policy allow/deny.
