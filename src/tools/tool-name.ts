/**
 * Tool naming — the namespace seam where "naming = boundary discipline" is enforced.
 *
 * External MCP-server tools are materialized under a reserved `mcp__<serverId>__<toolName>`
 * namespace. `__` (double underscore) is used instead of `:` because OpenAI / Gemini function
 * names disallow colons.
 *
 * This file owns the *naming* concern (prefix, normalization, the source⟺name invariant).
 * Policy (groups, profiles, allow/deny resolution) lives in ../policy/.
 *
 * See docs/02-naming-and-boundaries.md.
 */

import type { ToolSource } from '../types.js';

/** Reserved namespace prefix for MCP-materialized tools. */
export const MCP_TOOL_NAME_PREFIX = 'mcp__';

/**
 * Tool-name aliases (normalization shortcuts). Empty by default — this is a mechanism, not
 * a place for business shortcuts. Add e.g. `{ 'fetch': 'web_fetch' }` if you want aliases.
 */
export const TOOL_NAME_ALIASES: Record<string, string> = {};

/**
 * Is this a materialized MCP tool name (`mcp__<serverId>__<toolName>`)?
 * Case-insensitive, matching normalizeToolName's lowercasing.
 */
export function isMcpToolName(name: string): boolean {
  return name.toLowerCase().startsWith(MCP_TOOL_NAME_PREFIX);
}

/**
 * Normalize a tool name: trim, lowercase, resolve alias.
 * Tool names are expected to be lowercase `[a-z0-9_]` so that normalizeToolName(name) === name —
 * this closes the "gate allows but registry lookup misses" case-sensitivity hole.
 */
export function normalizeToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

/** Normalize a list of tool names, dropping empties. */
export function normalizeToolList(list?: string[]): string[] {
  if (!list) return [];
  return list.map(normalizeToolName).filter(Boolean);
}

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
