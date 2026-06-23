/**
 * MCP client module (stdio-first).
 *
 * Exposes only ensureMcpReady (awaited at the run entry point) and disposeMcp
 * (for tests / shutdown). Disabled-by-default: with MCP_SERVERS unset,
 * ensureMcpReady immediately no-ops.
 *
 * one contract, two boundaries: external MCP tools become ordinary AgentTools.
 */

import { mcpRuntime } from './runtime.js';

/**
 * Ensure MCP tools are connected and registered into the global registry (memoized).
 * Must be awaited before the synchronous tool assembly.
 */
export function ensureMcpReady(): Promise<void> {
  return mcpRuntime.ensureReady();
}

/** Close all MCP connections and remove registrations (for tests / shutdown). */
export function disposeMcp(): Promise<void> {
  return mcpRuntime.dispose();
}

export { loadMcpServerConfigs } from './config.js';
export type { McpServerConfig } from './types.js';
