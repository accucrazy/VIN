/**
 * MCP server config loading.
 *
 * Source: the env var `MCP_SERVERS` (a JSON array). Unset / empty / parse failure
 * -> returns [] (disabled). Global / operator-layer config; per-tenant config is a
 * future bucket.
 */

import type { McpServerConfig } from './types.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Load the enabled MCP server configs.
 * Disabled-by-default: with nothing configured this returns an empty array, and the
 * caller no-ops entirely.
 */
export function loadMcpServerConfigs(): McpServerConfig[] {
  const raw = process.env.MCP_SERVERS;
  if (!raw || !raw.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('[mcp/config] MCP_SERVERS is not valid JSON, ignoring:', (err as Error).message);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error('[mcp/config] MCP_SERVERS must be a JSON array, ignoring');
    return [];
  }

  const out: McpServerConfig[] = [];
  for (const item of parsed) {
    const cfg = normalizeOne(item);
    if (cfg) {
      out.push(cfg);
    }
  }
  return out;
}

function normalizeOne(item: unknown): McpServerConfig | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const c = item as Record<string, unknown>;

  if (c.enabled === false) {
    return null;
  }
  if (typeof c.id !== 'string' || !c.id.trim()) {
    console.warn('[mcp/config] server entry missing string "id", skip');
    return null;
  }
  const transport = (c.transport as string) ?? 'stdio';
  if (transport !== 'stdio') {
    console.warn(`[mcp/config] ${c.id}: only "stdio" transport is supported in this stage, skip`);
    return null;
  }
  if (typeof c.command !== 'string' || !c.command.trim()) {
    console.warn(`[mcp/config] ${c.id}: missing string "command", skip`);
    return null;
  }

  return {
    id: c.id.trim(),
    transport: 'stdio',
    command: c.command,
    args: Array.isArray(c.args) ? c.args.map(String) : [],
    env: isStringRecord(c.env) ? (c.env as Record<string, string>) : undefined,
    enabled: true,
    tools: normalizeToolFilter(c.tools),
    connectTimeoutMs: toPositiveInt(c.connectTimeoutMs) ?? DEFAULT_CONNECT_TIMEOUT_MS,
    requestTimeoutMs: toPositiveInt(c.requestTimeoutMs) ?? DEFAULT_REQUEST_TIMEOUT_MS,
  };
}

function normalizeToolFilter(v: unknown): McpServerConfig['tools'] {
  if (!v || typeof v !== 'object') {
    return undefined;
  }
  const f = v as Record<string, unknown>;
  const include = Array.isArray(f.include) ? f.include.map(String) : undefined;
  const exclude = Array.isArray(f.exclude) ? f.exclude.map(String) : undefined;
  if (!include && !exclude) {
    return undefined;
  }
  return { include, exclude };
}

function isStringRecord(v: unknown): boolean {
  return !!v && typeof v === 'object' && Object.values(v as object).every((x) => typeof x === 'string');
}

function toPositiveInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}
