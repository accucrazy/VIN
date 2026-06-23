/**
 * Tool registry — dynamic registration + execution, with source/plugin tracking.
 *
 * One registry holds core, plugin, and MCP-materialized tools under the *same* AgentTool
 * contract. The only difference is the `source` tag. Registration enforces the
 * name⟺source invariant (see tool-name.ts) and fails loudly on violation.
 */

import {
  AgentTool,
  AgentToolDefinition,
  AgentToolCall,
  AgentToolResult,
  AgentToolContext,
  ToolSource,
  isStandardResult,
} from '../types.js';
import { assertNameSourceInvariant } from './tool-name.js';

export interface ToolRegisterOptions {
  /** Plugin that registered this tool. */
  pluginId?: string;
  /** Source; if unset, derived from pluginId (pluginId → 'plugin', else 'core'). 'mcp' is explicit. */
  source?: ToolSource;
}

interface RegisteredTool {
  tool: AgentTool;
  pluginId?: string;
  source: ToolSource;
  registeredAt: Date;
}

/** Singleton tool registry. */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private static instance: ToolRegistry;

  private constructor() {}

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  register(tool: AgentTool, opts?: ToolRegisterOptions): void {
    // Derive source: explicit wins, else pluginId decides.
    const source: ToolSource = opts?.source ?? (opts?.pluginId ? 'plugin' : 'core');

    // Fail loudly if the reserved-namespace invariant is violated.
    assertNameSourceInvariant(tool.name, source);

    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Tool "${tool.name}" already registered, overwriting...`);
    }
    this.tools.set(tool.name, {
      tool,
      pluginId: opts?.pluginId,
      source,
      registeredAt: new Date(),
    });
  }

  registerAll(tools: AgentTool[], opts?: ToolRegisterOptions): void {
    for (const tool of tools) this.register(tool, opts);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Remove every tool registered by a plugin (clean teardown). */
  unregisterByPlugin(pluginId: string): number {
    let count = 0;
    for (const [name, registered] of this.tools) {
      if (registered.pluginId === pluginId) {
        this.tools.delete(name);
        count++;
      }
    }
    return count;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name)?.tool;
  }

  getPluginId(name: string): string | undefined {
    return this.tools.get(name)?.pluginId;
  }

  /** Source of a registered tool (governance truth for static core/plugin tools). */
  getSource(name: string): ToolSource | undefined {
    return this.tools.get(name)?.source;
  }

  /**
   * Governance metadata (source/pluginId). Kept separate from listTools(), which is the
   * LLM-facing view (no source leaks to the model).
   */
  listToolsMeta(): Array<{ name: string; source: ToolSource; pluginId?: string }> {
    return Array.from(this.tools.values()).map(({ tool, source, pluginId }) => ({
      name: tool.name,
      source,
      pluginId,
    }));
  }

  /** LLM-facing tool definitions (the roster is derived from here, never hand-maintained). */
  listTools(): AgentToolDefinition[] {
    return Array.from(this.tools.values()).map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      category: tool.category,
    }));
  }

  listToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getToolsByPlugin(pluginId: string): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const registered of this.tools.values()) {
      if (registered.pluginId === pluginId) tools.push(registered.tool);
    }
    return tools;
  }

  async execute(call: AgentToolCall, context?: AgentToolContext): Promise<AgentToolResult> {
    const registered = this.tools.get(call.name);
    if (!registered) {
      // Do not leak the global tool list to the model — the agent-facing list is reported by
      // the react-loop fail-closed gate (which lists only that agent's own tools).
      return { success: false, error: `Tool not found: ${call.name}.` };
    }

    const { tool } = registered;
    try {
      const startTime = Date.now();
      const result = await tool.execute(call.arguments, context);
      const duration = Date.now() - startTime;
      if (isStandardResult(result)) {
        return { ...result, metadata: { ...result.metadata, executionTime: duration } };
      }
      return result;
    } catch (error) {
      return { success: false, error: (error as Error).message || 'Unknown error' };
    }
  }

  clear(): void {
    this.tools.clear();
  }

  get size(): number {
    return this.tools.size;
  }

  getByCategory(category: string): AgentToolDefinition[] {
    return this.listTools().filter((tool) => tool.category === category);
  }
}

export const toolRegistry = ToolRegistry.getInstance();
