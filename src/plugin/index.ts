/**
 * TPC-AIOS Plugin System
 *
 * The entry point for the plugin system.
 * Unified registration of Tools, Skills, Agents, Hooks, and Services.
 */

// Type exports
export * from './types.js';

// Core modules
export { PluginRegistry, pluginRegistry, resetPluginRegistry } from './registry.js';
export { HookRunner, getHookRunner, resetHookRunner, hookRunner, type HookExecutionResult } from './hooks.js';
export { ServiceManager, getServiceManager, resetServiceManager, serviceManager } from './services.js';

// Utility functions
export {
  loadPluginManifest,
  resolvePluginManifestPath,
  hasPluginManifest,
  isValidPluginId,
  inferPluginId,
  emptyPluginConfigSchema,
  PLUGIN_MANIFEST_FILENAME,
  PLUGIN_MANIFEST_FILENAMES,
} from './manifest.js';

export {
  discoverPlugins,
  loadPlugin,
  loadPlugins,
  resolveLoadOrder,
  type PluginLoadResult,
} from './loader.js';
