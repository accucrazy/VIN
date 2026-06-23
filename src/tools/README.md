# `tools/` — the capability registry

One registry holds **core**, **plugin**, and **MCP-materialized** tools under a single
`AgentTool` contract (defined in [`../types.ts`](../types.ts)). The only thing that distinguishes
them is a `source` tag — and the naming invariant that ties the name to the source. Read this before
the files; it explains the one rule you cannot break.

## What each file is

- **`registry.ts`** — `ToolRegistry` (singleton via `getInstance()`; also exported as
  `toolRegistry`). Holds tools with their `source`/`pluginId`, runs them, and lists them. Two
  separate views: `listTools()` is the **LLM-facing** roster (no `source` leaks to the model);
  `listToolsMeta()` is the **governance** view. `register()` enforces the name⟺source invariant and
  warns on overwrite. `unregisterByPlugin()` gives clean plugin teardown.
- **`tool-name.ts`** — the namespace seam. Owns the `mcp__` prefix, normalization, and
  `assertNameSourceInvariant`. This file owns *naming*; allow/deny *policy* lives in
  [`../policy/`](../policy/).
- **`index.ts`** — barrel + `registerBuiltinTools()`, which registers the three demo tools as
  `source: 'core'`. Call once at startup.
- **`echo.tool.ts` / `web-fetch.tool.ts` / `memory-search.tool.ts`** — the demo capabilities, each
  showing a different plane (below).

## The contract

An `AgentTool` is `name` + `description` + `inputSchema` + `execute(args, context)`. Nothing more is
required to be a first-class capability. `echo.tool.ts` is the minimal example.

```ts
export const echoTool: AgentTool = {
  name: 'echo',
  description: '…',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async execute(args) { return { success: true, data: args.text }; },
};
```

## The invariant: `mcp__` ⟺ `source: 'mcp'`

External MCP-server tools are materialized under a reserved namespace
`mcp__<serverId>__<toolName>` (`__` not `:`, because OpenAI/Gemini function names disallow colons).
`assertNameSourceInvariant` enforces both directions at register time and **throws loudly** on a
violation:

- a non-`mcp` tool must **not** use the `mcp__` prefix (it would collide with real MCP tools);
- a `source: 'mcp'` tool **must** carry the prefix, or a `mcp__*` allow/deny policy rule would miss
  it and the namespace seam would be silently bypassed.

This is "naming is a boundary" made executable: the invariant is checked at registration, so
governance rules written against `mcp__*` can never quietly fail to match.

## The three demo tools (one plane each)

| Tool | Plane it demonstrates |
|---|---|
| `echo` | the **authoring pattern** — the smallest possible `AgentTool` |
| `web_fetch` | **security in the runtime** — `validateUrlForSsrf()` ([`../lib/net/`](../lib/net/)) throws on private/metadata targets; `wrapExternalContent()` ([`../security/`](../security/)) wraps the body so injected instructions are never treated as commands |
| `memory_search` | the **memory plane via a seam** — never touches a DB directly; asks the active `MemoryAdapter` ([`../memory/`](../memory/)) to `hybridSearch`, passing `context.userId` (default `'local'`) |

## The seam to swap

To add a capability: write an `AgentTool` and `registry.register(tool, { source })` it (or
`{ pluginId }`, which derives `source: 'plugin'`). It joins the same gate and the same
registry-derived roster the [agent loop](../agent/) sees — no special path. Materialized MCP tools
go in as `source: 'mcp'` with the `mcp__` prefix; everything downstream treats all three sources
identically.
