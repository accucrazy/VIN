/**
 * MCP client types (stdio-first).
 *
 * Standard MCP server config shape (aligned with the official SDK conventions).
 * This first version supports the stdio transport only.
 */

/** Supported transports (stdio only in this version). */
export type McpTransportKind = 'stdio';

/** A single MCP server config (operator/global layer; not per-tenant). */
export interface McpServerConfig {
  /** Unique identifier; becomes the tool namespace mcp__<id>__<tool>. */
  id: string;
  /** Transport type (only 'stdio' allowed in this version). */
  transport: McpTransportKind;
  /** stdio: the command to run (e.g. 'npx', 'node'). */
  command: string;
  /** stdio: command arguments. */
  args?: string[];
  /** stdio: extra environment variables (layered on top of the safe-env allowlist). */
  env?: Record<string, string>;
  /** Whether enabled (defaults to true; false skips the server entirely). */
  enabled?: boolean;
  /** Tool filter (glob: '*' matches anything). */
  tools?: { include?: string[]; exclude?: string[] };
  /** Connect timeout (ms, default 30000). */
  connectTimeoutMs?: number;
  /** Per-call tool timeout (ms, default 60000). */
  requestTimeoutMs?: number;
}

/** Source tracking for a materialized MCP tool (held by the runtime, not the global registry). */
export interface MaterializedMcpToolMeta {
  serverId: string;
  originalToolName: string;
  materializedName: string;
}

/** Tool descriptor reported by an MCP server (from tools/list). */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}
