/**
 * Plugin Loader
 *
 * Discovers, loads, and resolves plugin modules.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  PluginModule,
  PluginDefinition,
  DiscoveredPlugin,
  PluginManifest,
} from './types.js';
import {
  loadPluginManifest,
  hasPluginManifest,
  inferPluginId,
} from './manifest.js';

/**
 * Plugin load result.
 */
export interface PluginLoadResult {
  ok: boolean;
  module?: PluginModule;
  definition?: PluginDefinition;
  manifest?: PluginManifest;
  error?: string;
  path: string;
}

/**
 * Discover all plugins under the given directories.
 *
 * Scans for:
 * 1. Subdirectories containing a tpc-ai.plugin.json
 * 2. *.plugin.ts / *.plugin.js files
 *
 * @param directories Directories to scan
 * @returns Discovered plugins
 */
export async function discoverPlugins(directories: string[]): Promise<DiscoveredPlugin[]> {
  const discovered: DiscoveredPlugin[] = [];
  const seen = new Set<string>();

  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      continue;
    }

    // Scan the directory contents.
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip duplicates.
      if (seen.has(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        // Check for a manifest.
        if (hasPluginManifest(fullPath)) {
          const manifestResult = loadPluginManifest(fullPath);
          if (manifestResult.ok) {
            seen.add(fullPath);
            discovered.push({
              path: fullPath,
              manifest: manifestResult.manifest,
              origin: 'directory',
            });
          }
        }
      } else if (entry.isFile()) {
        // Check whether it is a plugin file.
        if (isPluginFile(entry.name)) {
          seen.add(fullPath);
          discovered.push({
            path: fullPath,
            origin: 'file',
          });
        }
      }
    }
  }

  return discovered;
}

/**
 * Whether the filename is a plugin file.
 */
function isPluginFile(filename: string): boolean {
  return (
    filename.endsWith('.plugin.ts') ||
    filename.endsWith('.plugin.js') ||
    filename.endsWith('.plugin.mjs')
  );
}

/**
 * Load a single plugin.
 *
 * @param pluginPath Plugin path (directory or file)
 * @returns Load result
 */
export async function loadPlugin(pluginPath: string): Promise<PluginLoadResult> {
  const stat = fs.statSync(pluginPath);
  const isDir = stat.isDirectory();

  // Load the manifest (if a directory).
  let manifest: PluginManifest | undefined;
  if (isDir) {
    const manifestResult = loadPluginManifest(pluginPath);
    if (manifestResult.ok) {
      manifest = manifestResult.manifest;
    }
  }

  // Determine the entry file.
  let entryPath: string = '';
  if (isDir) {
    // Try common entry files.
    const candidates = ['index.ts', 'index.js', 'index.mjs', 'plugin.ts', 'plugin.js'];
    let found = false;
    for (const candidate of candidates) {
      const candidatePath = path.join(pluginPath, candidate);
      if (fs.existsSync(candidatePath)) {
        entryPath = candidatePath;
        found = true;
        break;
      }
    }
    if (!found) {
      return {
        ok: false,
        error: `No entry file found in plugin directory: ${pluginPath}`,
        path: pluginPath,
      };
    }
  } else {
    entryPath = pluginPath;
  }

  // Dynamically load the module.
  try {
    const pluginModule = await importPluginModule(entryPath);
    const definition = normalizePluginModule(pluginModule, pluginPath, manifest);

    return {
      ok: true,
      module: pluginModule,
      definition,
      manifest,
      path: pluginPath,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to load plugin: ${String(error)}`,
      path: pluginPath,
    };
  }
}

/**
 * Dynamically import a plugin module.
 */
async function importPluginModule(entryPath: string): Promise<PluginModule> {
  // Use a dynamic import.
  const moduleUrl = `file://${entryPath.replace(/\\/g, '/')}`;
  const imported = await import(moduleUrl);

  // Support a default export or a named export.
  if (imported.default) {
    return imported.default as PluginModule;
  }

  // Look for a `plugin` export.
  if (imported.plugin) {
    return imported.plugin as PluginModule;
  }

  // Look for any export that looks like a plugin.
  for (const key of Object.keys(imported)) {
    const value = imported[key];
    if (isPluginDefinition(value)) {
      return value as PluginModule;
    }
  }

  // If the whole module looks like a plugin definition.
  if (isPluginDefinition(imported)) {
    return imported as PluginModule;
  }

  throw new Error('No valid plugin export found');
}

/**
 * Whether the value is a plugin definition.
 */
function isPluginDefinition(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Must have at least a register function or an id.
  return typeof obj.register === 'function' || typeof obj.id === 'string';
}

/**
 * Normalize a plugin module into a standard definition.
 */
function normalizePluginModule(
  module: PluginModule,
  pluginPath: string,
  manifest?: PluginManifest
): PluginDefinition {
  // If it's a function, wrap it as a definition.
  if (typeof module === 'function') {
    return {
      id: manifest?.id ?? inferPluginId(pluginPath),
      name: manifest?.name,
      version: manifest?.version,
      description: manifest?.description,
      register: module,
    };
  }

  // Already a definition object.
  const def = module as PluginDefinition;

  return {
    id: def.id ?? manifest?.id ?? inferPluginId(pluginPath),
    name: def.name ?? manifest?.name,
    version: def.version ?? manifest?.version,
    description: def.description ?? manifest?.description,
    configSchema: def.configSchema,
    register: def.register,
    activate: def.activate,
    unregister: def.unregister,
  };
}

/**
 * Resolve plugin load order (handle dependencies).
 *
 * @param plugins Discovered plugins
 * @returns Sorted plugins
 */
export function resolveLoadOrder(plugins: DiscoveredPlugin[]): DiscoveredPlugin[] {
  // Build an ID -> plugin map.
  const byId = new Map<string, DiscoveredPlugin>();
  for (const plugin of plugins) {
    const id = plugin.manifest?.id;
    if (id) {
      byId.set(id, plugin);
    }
  }

  // Topological sort.
  const sorted: DiscoveredPlugin[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(plugin: DiscoveredPlugin): void {
    const id = plugin.manifest?.id ?? plugin.path;

    if (visited.has(id)) {
      return;
    }

    if (visiting.has(id)) {
      console.warn(`[PluginLoader] Circular dependency detected for: ${id}`);
      return;
    }

    visiting.add(id);

    // Process dependencies first.
    const deps = plugin.manifest?.dependencies ?? [];
    for (const depId of deps) {
      const dep = byId.get(depId);
      if (dep) {
        visit(dep);
      }
    }

    visiting.delete(id);
    visited.add(id);
    sorted.push(plugin);
  }

  // Process every plugin.
  for (const plugin of plugins) {
    visit(plugin);
  }

  return sorted;
}

/**
 * Load multiple plugins from paths.
 *
 * @param paths Plugin paths (directories or files)
 * @returns Load results
 */
export async function loadPlugins(paths: string[]): Promise<PluginLoadResult[]> {
  const results: PluginLoadResult[] = [];

  for (const p of paths) {
    const result = await loadPlugin(p);
    results.push(result);
  }

  return results;
}
