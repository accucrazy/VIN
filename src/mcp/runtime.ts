/**
 * MCP Runtime Manager
 *
 * Responsibilities:
 * - ensureReady(): memoized, idempotent. Connects every enabled server, materializes
 *   its tools, and registers them into the *global* toolRegistry (source:'mcp'). No
 *   server configured -> immediate no-op.
 * - Global tools (operator config) go in the global registry; per-tenant dynamic tools
 *   are a future bucket.
 * - Tracks the registered tool names per server, for list_changed re-sync and dispose.
 *
 * one contract, two boundaries: external MCP tools become ordinary AgentTools — so they
 * inherit the entire pipeline (policy / hooks / quota) with zero hot-path changes.
 *
 * Note: ensureReady() must be awaited *before* the synchronous tool assembly
 * (factory.getAvailableTools / mergeTools) so the registry is filled first. Call site:
 * the route POST handler entry point.
 */

import { toolRegistry } from '../tools/registry.js';
import type { MaterializedMcpToolMeta, McpServerConfig } from './types.js';
import { loadMcpServerConfigs } from './config.js';
import { McpClient } from './client.js';
import {
  applyToolFilter,
  buildMaterializedName,
  buildMcpAgentTool,
  toAgentInputSchema,
} from './materialize.js';

class McpRuntime {
  private inflight: Promise<void> | null = null;
  private settledOk = false;
  private nextRetryAt = 0;
  private readonly RETRY_COOLDOWN_MS = 60_000;
  private readonly clients = new Map<string, McpClient>();
  /** serverId -> the set of registered materialized tool names. */
  private readonly serverTools = new Map<string, Set<string>>();
  /** materializedName -> origin (serverId / original tool name), for tracking/debugging. */
  private readonly reverseMap = new Map<string, MaterializedMcpToolMeta>();

  /**
   * Memoized initialization; multiple calls share it, and once everything succeeds
   * it never reconnects.
   *
   * Failure (cold-start server unreachable / timeout / tools/list failure) does **not**
   * permanently poison: it sets a cooldown. During the cooldown ensureReady() returns
   * immediately (this round may have no MCP tools, or only the already-connected ones),
   * avoiding a thundering herd per request; after the cooldown the next ensureReady()
   * retries the still-unconnected servers (already-connected ones are skipped, not
   * reconnected).
   */
  ensureReady(): Promise<void> {
    if (this.settledOk) {
      return Promise.resolve();
    }
    if (this.inflight) {
      return this.inflight;
    }
    if (Date.now() < this.nextRetryAt) {
      return Promise.resolve();
    }
    this.inflight = this.init().then(
      (hadFailure) => {
        this.inflight = null;
        if (hadFailure) {
          this.nextRetryAt = Date.now() + this.RETRY_COOLDOWN_MS;
        } else {
          this.settledOk = true;
        }
      },
      (err) => {
        this.inflight = null;
        this.nextRetryAt = Date.now() + this.RETRY_COOLDOWN_MS;
        console.error('[mcp/runtime] init error:', (err as Error).message);
      },
    );
    return this.inflight;
  }

  /** Connect every "not yet connected" server; returns whether any failed (for ensureReady's retry decision). */
  private async init(): Promise<boolean> {
    const configs = loadMcpServerConfigs();
    const pending = configs.filter((c) => !this.clients.has(c.id));
    if (pending.length === 0) {
      if (configs.length === 0) {
        console.log('[mcp/runtime] no MCP servers configured — disabled');
      }
      return false;
    }
    console.log(`[mcp/runtime] connecting ${pending.length} MCP server(s)`);
    let hadFailure = false;
    // Each server connects independently; one failure doesn't affect the others.
    for (const cfg of pending) {
      try {
        await this.connectAndRegister(cfg);
      } catch (err) {
        hadFailure = true;
        console.error(`[mcp/runtime] server "${cfg.id}" failed:`, (err as Error).message);
      }
    }
    return hadFailure;
  }

  private async connectAndRegister(cfg: McpServerConfig): Promise<void> {
    const client = new McpClient(cfg);
    try {
      await client.connect(() => {
        // list_changed: background re-sync (best-effort).
        this.syncServerTools(cfg, client).catch((e) =>
          console.error(`[mcp/runtime] "${cfg.id}" re-sync failed:`, (e as Error).message),
        );
      });
      await this.syncServerTools(cfg, client);
      this.clients.set(cfg.id, client); // only track after connect + first sync both succeed
    } catch (err) {
      await client.close(); // on failure, clean up client / child to avoid an orphan process
      throw err;
    }
  }

  /** After connecting (or after list_changed), re-list tools and sync them into the registry. */
  private async syncServerTools(cfg: McpServerConfig, client: McpClient): Promise<void> {
    const descriptors = applyToolFilter(await client.listTools(), cfg.tools);

    // Remove this server's old registrations first (re-sync).
    this.deregisterServer(cfg.id);

    const reserved = new Set(toolRegistry.listToolNames());
    const names = new Set<string>();

    for (const d of descriptors) {
      const inputSchema = toAgentInputSchema(d.inputSchema);
      if (!inputSchema) {
        console.warn(`[mcp/runtime] ${cfg.id}/${d.name}: non-object inputSchema, skip`);
        continue;
      }
      const materializedName = buildMaterializedName(cfg.id, d.name, reserved);
      reserved.add(materializedName);

      const tool = buildMcpAgentTool({
        serverId: cfg.id,
        descriptor: d,
        materializedName,
        inputSchema,
        callFn: (originalToolName, args) => client.callTool(originalToolName, args),
      });

      try {
        // Registered with source:'mcp' — the name⟺source invariant requires the mcp__ prefix.
        toolRegistry.register(tool, { source: 'mcp' });
        names.add(materializedName);
        this.reverseMap.set(materializedName, {
          serverId: cfg.id,
          originalToolName: d.name,
          materializedName,
        });
      } catch (err) {
        console.error(`[mcp/runtime] register ${materializedName} failed:`, (err as Error).message);
      }
    }

    this.serverTools.set(cfg.id, names);
    console.log(`[mcp/runtime] "${cfg.id}": registered ${names.size} tool(s)`);
  }

  private deregisterServer(serverId: string): void {
    const names = this.serverTools.get(serverId);
    if (!names) {
      return;
    }
    for (const name of names) {
      toolRegistry.unregister(name);
      this.reverseMap.delete(name);
    }
    this.serverTools.delete(serverId);
  }

  /** Close all connections and remove registrations (for tests / shutdown). */
  async dispose(): Promise<void> {
    for (const id of [...this.serverTools.keys()]) {
      this.deregisterServer(id);
    }
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    this.inflight = null;
    this.settledOk = false;
    this.nextRetryAt = 0;
  }
}

/** Process-level singleton. */
export const mcpRuntime = new McpRuntime();
