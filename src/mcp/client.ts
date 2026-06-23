/**
 * MCP Client (stdio) — wraps the official @modelcontextprotocol/sdk.
 *
 * connect -> capability gating -> tools/list (paginated) -> tools/call -> close.
 * Safety: the spawned child only receives the safe-env allowlist + the env keys
 * explicitly listed in the config.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerConfig, McpToolDescriptor } from './types.js';

/**
 * Safe environment-variable allowlist passed to the child process.
 * Only these keys + config.env are forwarded, so host secrets (e.g. other
 * services' keys) are never leaked to the MCP server.
 */
const SAFE_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TMPDIR', 'TEMP', 'TMP',
  // Windows
  'SystemRoot', 'windir', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'ComSpec', 'USERPROFILE',
];

function buildSafeEnv(configEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const v = process.env[key];
    if (typeof v === 'string') {
      env[key] = v;
    }
  }
  if (configEnv) {
    for (const [k, v] of Object.entries(configEnv)) {
      if (typeof v === 'string') {
        env[k] = v;
      }
    }
  }
  return env;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP timeout after ${ms}ms: ${label}`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(private readonly config: McpServerConfig) {}

  /** Open a stdio connection and initialize. */
  async connect(onToolsChanged?: () => void): Promise<void> {
    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      env: buildSafeEnv(this.config.env),
      stderr: 'pipe',
    });
    // Hold the transport early: even if connect times out (the underlying layer
    // may already have spawned the child), close() can still terminate the child
    // and avoid an orphan process.
    this.transport = transport;

    const client = new Client(
      { name: 'tpc-aios', version: '1.0.0' },
      { capabilities: {} },
    );

    try {
      await withTimeout(
        client.connect(transport),
        this.config.connectTimeoutMs ?? 30_000,
        `connect ${this.config.id}`,
      );
    } catch (err) {
      await this.close(); // best-effort cleanup of transport / child
      throw err;
    }

    // tools/list_changed -> trigger a re-sync (best-effort).
    if (onToolsChanged) {
      try {
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
          onToolsChanged();
        });
      } catch {
        /* Some servers do not support this; ignore. */
      }
    }

    this.client = client;
  }

  /** List tools (capability gating + pagination cursor). */
  async listTools(): Promise<McpToolDescriptor[]> {
    if (!this.client) {
      throw new Error(`MCP client ${this.config.id} not connected`);
    }
    // Capability gating: don't ask if the server didn't declare a tools capability.
    const caps = this.client.getServerCapabilities();
    if (!caps?.tools) {
      return [];
    }

    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.listTools(cursor ? { cursor } : {});
      for (const t of res.tools ?? []) {
        tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
      }
      cursor = res.nextCursor;
    } while (cursor);

    return tools;
  }

  /** Call a tool (with timeout); returns the native CallToolResult. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error(`MCP client ${this.config.id} not connected`);
    }
    return withTimeout(
      this.client.callTool({ name, arguments: args ?? {} }),
      this.config.requestTimeoutMs ?? 60_000,
      `callTool ${this.config.id}/${name}`,
    );
  }

  async close(): Promise<void> {
    // Close the client (which closes its transport) + close the transport directly
    // (covers the connect-timeout case where the client isn't set yet but the child
    // has already spawned). Both are best-effort and re-entrant.
    try {
      await this.client?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.transport?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
    this.transport = null;
  }
}
