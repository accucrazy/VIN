/**
 * Plugin Registry
 *
 * The central plugin manager that ties all subsystems together:
 * - Loads and registers plugins
 * - Manages hooks and services
 * - Provides the unified Plugin API
 */

import path from 'node:path';
import type { AgentTool } from '../types.js';
import type { SkillEntry } from '../skills/types.js';
import type { AgentDefinition } from '../agent/types.js';
import { toolRegistry } from '../tools/registry.js';
import { getSkillManager } from '../skills/index.js';
import { agentRegistry } from '../agent/index.js';
import type {
  PluginApi,
  PluginDefinition,
  PluginConfig,
  PluginManifest,
  PluginMetadata,
  LoadedPlugin,
  PluginHookName,
  PluginHookHandler,
  PluginService,
  PluginLogger,
  PluginRuntime,
  HttpRouteParams,
  PluginHookEventMap,
  PluginHookContextMap,
} from './types.js';
import { HookRunner, getHookRunner, type HookExecutionResult } from './hooks.js';
import { ServiceManager, getServiceManager } from './services.js';
import { loadPluginManifest, inferPluginId } from './manifest.js';
import { discoverPlugins, loadPlugin, resolveLoadOrder } from './loader.js';

/**
 * Registered HTTP route info.
 */
interface RegisteredHttpRoute {
  path: string;
  method: string;
  handler: HttpRouteParams['handler'];
  pluginId: string;
}

/**
 * Plugin Registry
 */
export class PluginRegistry {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private hookRunner: HookRunner;
  private serviceManager: ServiceManager;
  private httpRoutes: Map<string, RegisteredHttpRoute> = new Map();
  private globalConfig: Record<string, unknown> = {};

  private static instance: PluginRegistry;

  private constructor() {
    this.hookRunner = getHookRunner();
    this.serviceManager = getServiceManager();
  }

  /**
   * Get the singleton instance.
   */
  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }

  /**
   * Set the global config.
   */
  setGlobalConfig(config: Record<string, unknown>): void {
    this.globalConfig = { ...this.globalConfig, ...config };
  }

  // ==================== Loading and registration ====================

  /**
   * Load a plugin from a path.
   *
   * @param pluginPath Plugin path (directory or file)
   * @param config Plugin config
   */
  async load(pluginPath: string, config?: PluginConfig): Promise<void> {
    const loadResult = await loadPlugin(pluginPath);

    if (!loadResult.ok || !loadResult.definition) {
      throw new Error(loadResult.error ?? 'Failed to load plugin');
    }

    await this.register(
      loadResult.definition,
      config,
      loadResult.manifest,
      pluginPath
    );
  }

  /**
   * Load all plugins from a directory.
   *
   * @param directory Plugin directory
   */
  async loadFromDirectory(directory: string): Promise<{
    loaded: string[];
    failed: Array<{ path: string; error: string }>;
  }> {
    const discovered = await discoverPlugins([directory]);
    const sorted = resolveLoadOrder(discovered);

    const loaded: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (const plugin of sorted) {
      try {
        await this.load(plugin.path);
        const id = plugin.manifest?.id ?? inferPluginId(plugin.path);
        loaded.push(id);
      } catch (error) {
        failed.push({
          path: plugin.path,
          error: String(error),
        });
      }
    }

    return { loaded, failed };
  }

  /**
   * Register a plugin.
   *
   * @param definition Plugin definition
   * @param config Plugin config
   * @param manifest Plugin manifest (optional)
   * @param source Plugin source path
   */
  async register(
    definition: PluginDefinition,
    config?: PluginConfig,
    manifest?: PluginManifest,
    source?: string
  ): Promise<void> {
    const id = definition.id ?? manifest?.id ?? 'unknown';

    // Skip if already registered.
    if (this.plugins.has(id)) {
      console.warn(`[PluginRegistry] Plugin "${id}" already registered, skipping`);
      return;
    }

    // Check dependencies.
    const dependencies = manifest?.dependencies ?? [];
    for (const depId of dependencies) {
      if (!this.plugins.has(depId)) {
        throw new Error(`Plugin "${id}" requires "${depId}" which is not registered`);
      }
    }

    // Build config.
    const pluginConfig: PluginConfig = config ?? { enabled: true };

    // Build metadata.
    const metadata: PluginMetadata = {
      id,
      name: definition.name ?? manifest?.name ?? id,
      version: definition.version ?? manifest?.version,
      description: definition.description ?? manifest?.description,
      source: source ?? 'inline',
      dependencies,
      registeredAt: new Date(),
      toolCount: 0,
      skillCount: 0,
      agentCount: 0,
      hookCount: 0,
      serviceCount: 0,
      httpRouteCount: 0,
    };

    // Build the API.
    const api = this.createPluginApi(id, metadata, pluginConfig, source);

    // Build the LoadedPlugin.
    const loadedPlugin: LoadedPlugin = {
      definition,
      manifest,
      config: pluginConfig,
      metadata,
      api,
      status: 'registered',
    };

    // Store the plugin.
    this.plugins.set(id, loadedPlugin);

    // Run the register function.
    if (definition.register) {
      try {
        await definition.register(api);
        console.log(`[PluginRegistry] Registered plugin: ${metadata.name} (${id})`);
      } catch (error) {
        loadedPlugin.status = 'error';
        loadedPlugin.error = String(error);
        console.error(`[PluginRegistry] Failed to register plugin "${id}":`, error);
        throw error;
      }
    }
  }

  /**
   * Unregister a plugin.
   *
   * Clean teardown: every hook/service/route this plugin registered is removed
   * by its pluginId tag, so nothing leaks across reloads. (Tools registered via
   * the registry are likewise removable by pluginId — see
   * toolRegistry.unregisterByPlugin.)
   *
   * @param pluginId Plugin ID
   */
  async unregister(pluginId: string): Promise<boolean> {
    const loadedPlugin = this.plugins.get(pluginId);
    if (!loadedPlugin) {
      return false;
    }

    // Call the unregister callback.
    if (loadedPlugin.definition.unregister) {
      try {
        await loadedPlugin.definition.unregister();
      } catch (error) {
        console.warn(`[PluginRegistry] Error during unregister of "${pluginId}":`, error);
      }
    }

    // Clean up tools registered by this plugin.
    toolRegistry.unregisterByPlugin(pluginId);

    // Clean up hooks.
    this.hookRunner.unregisterByPlugin(pluginId);

    // Clean up services.
    await this.serviceManager.unregisterByPlugin(pluginId);

    // Clean up HTTP routes.
    for (const [key, route] of this.httpRoutes) {
      if (route.pluginId === pluginId) {
        this.httpRoutes.delete(key);
      }
    }

    // Remove the plugin.
    this.plugins.delete(pluginId);

    console.log(`[PluginRegistry] Unregistered plugin: ${pluginId}`);
    return true;
  }

  // ==================== Activation and shutdown ====================

  /**
   * Activate a plugin.
   *
   * @param pluginId Plugin ID
   */
  async activate(pluginId: string): Promise<void> {
    const loadedPlugin = this.plugins.get(pluginId);
    if (!loadedPlugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (loadedPlugin.status === 'activated') {
      return; // Already activated.
    }

    if (loadedPlugin.definition.activate) {
      try {
        await loadedPlugin.definition.activate(loadedPlugin.api);
        loadedPlugin.status = 'activated';
        loadedPlugin.metadata.activatedAt = new Date();
        console.log(`[PluginRegistry] Activated plugin: ${pluginId}`);
      } catch (error) {
        loadedPlugin.status = 'error';
        loadedPlugin.error = String(error);
        throw error;
      }
    } else {
      loadedPlugin.status = 'activated';
      loadedPlugin.metadata.activatedAt = new Date();
    }
  }

  /**
   * Activate all registered plugins.
   */
  async activateAll(): Promise<{
    activated: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const activated: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const [pluginId, loadedPlugin] of this.plugins) {
      if (loadedPlugin.status === 'activated') {
        continue;
      }

      try {
        await this.activate(pluginId);
        activated.push(pluginId);
      } catch (error) {
        failed.push({
          id: pluginId,
          error: String(error),
        });
      }
    }

    // Start all services.
    await this.serviceManager.startAll();

    return { activated, failed };
  }

  /**
   * Shut down all plugins.
   */
  async shutdown(): Promise<void> {
    // Stop all services.
    await this.serviceManager.stopAll();

    // Unregister all plugins.
    const pluginIds = Array.from(this.plugins.keys());
    for (const pluginId of pluginIds) {
      await this.unregister(pluginId);
    }

    console.log('[PluginRegistry] Shutdown complete');
  }

  // ==================== Hook operations ====================

  /**
   * Execute hooks.
   *
   * @param hookName Hook name
   * @param event Event data
   * @param context Context
   */
  async executeHooks<K extends PluginHookName>(
    hookName: K,
    event: PluginHookEventMap[K],
    context: PluginHookContextMap[K]
  ): Promise<HookExecutionResult<K>> {
    return this.hookRunner.execute(hookName, event, context);
  }

  /**
   * Register a hook handler (public method).
   *
   * Used by internal modules (e.g. long-term memory) to register hooks directly,
   * rather than going through the Plugin API.
   *
   * @param hookName Hook name
   * @param handler Handler function
   * @param options Options (pluginId, priority)
   */
  registerHook<K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandler<K>,
    options?: { pluginId?: string; priority?: number }
  ): void {
    this.hookRunner.register(hookName, handler, options);
  }

  /**
   * Unregister all hooks for a given plugin.
   *
   * @param pluginId Plugin ID
   */
  unregisterHooksByPlugin(pluginId: string): void {
    this.hookRunner.unregisterByPlugin(pluginId);
  }

  /**
   * Whether there are any handlers for the given hook.
   */
  hasHooks(hookName: PluginHookName): boolean {
    return this.hookRunner.hasHandlers(hookName);
  }

  // ==================== Query methods ====================

  /**
   * Get a plugin.
   */
  getPlugin(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get all registered plugins.
   */
  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin metadata.
   */
  getMetadata(id: string): PluginMetadata | undefined {
    return this.plugins.get(id)?.metadata;
  }

  /**
   * Get all plugin metadata.
   */
  getAllMetadata(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map((p) => p.metadata);
  }

  /**
   * Whether the plugin is registered.
   */
  has(id: string): boolean {
    return this.plugins.has(id);
  }

  /**
   * Number of registered plugins.
   */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * Get the registered HTTP routes.
   */
  getHttpRoutes(): RegisteredHttpRoute[] {
    return Array.from(this.httpRoutes.values());
  }

  // ==================== Private methods ====================

  /**
   * Build the Plugin API.
   *
   * This is where injection is wired: each register* method funnels the
   * plugin's contribution into the shared registry, tagged with this pluginId
   * so teardown can find it again.
   */
  private createPluginApi(
    pluginId: string,
    metadata: PluginMetadata,
    config: PluginConfig,
    source?: string
  ): PluginApi {
    const logger: PluginLogger = {
      debug: (msg, ...args) => console.debug(`[Plugin:${pluginId}]`, msg, ...args),
      info: (msg, ...args) => console.log(`[Plugin:${pluginId}]`, msg, ...args),
      warn: (msg, ...args) => console.warn(`[Plugin:${pluginId}]`, msg, ...args),
      error: (msg, ...args) => console.error(`[Plugin:${pluginId}]`, msg, ...args),
    };

    const runtime: PluginRuntime = {
      workspaceDir: source ? path.dirname(source) : undefined,
      env: process.env as Record<string, string | undefined>,
    };

    return {
      id: pluginId,
      name: metadata.name,
      version: metadata.version,
      description: metadata.description,
      source: source ?? 'inline',
      config: this.globalConfig,
      pluginConfig: config.settings,
      logger,
      runtime,

      // Registration methods
      registerTool: (tool: AgentTool) => {
        // Tools registered via a plugin carry source:'plugin' (pluginId implies it).
        toolRegistry.register(tool, { pluginId });
        metadata.toolCount++;
      },

      registerSkill: (skill: SkillEntry) => {
        getSkillManager().addSkill(skill, { pluginId });
        metadata.skillCount++;
      },

      registerAgent: (agent: AgentDefinition) => {
        agentRegistry.register(agent);
        metadata.agentCount++;
      },

      registerHook: <K extends PluginHookName>(
        event: K | K[],
        handler: PluginHookHandler<K>,
        opts?: { priority?: number }
      ) => {
        const events = Array.isArray(event) ? event : [event];
        for (const e of events) {
          this.hookRunner.register(e, handler, {
            priority: opts?.priority,
            pluginId,
          });
          metadata.hookCount++;
        }
      },

      registerService: (service: PluginService) => {
        this.serviceManager.register(service, pluginId);
        metadata.serviceCount++;
      },

      registerHttpRoute: (params: HttpRouteParams) => {
        const key = `${params.method ?? 'GET'}:${params.path}`;
        this.httpRoutes.set(key, {
          path: params.path,
          method: params.method ?? 'GET',
          handler: params.handler,
          pluginId,
        });
        metadata.httpRouteCount++;
      },

      // Utility methods
      resolvePath: (input: string) => {
        if (path.isAbsolute(input)) {
          return input;
        }
        const baseDir = source ? path.dirname(source) : process.cwd();
        return path.resolve(baseDir, input);
      },

      getConfig: <T>(key: string): T | undefined => {
        return config.settings?.[key] as T;
      },
    };
  }
}

// Global singleton
export const pluginRegistry = PluginRegistry.getInstance();

/**
 * Reset the Plugin Registry (mainly for tests).
 */
export async function resetPluginRegistry(): Promise<void> {
  await pluginRegistry.shutdown();
}
