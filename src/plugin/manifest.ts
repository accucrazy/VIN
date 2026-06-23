/**
 * Plugin Manifest Parser
 *
 * Parses and validates tpc-ai.plugin.json manifest files.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PluginManifest, PluginManifestLoadResult, PluginConfigUiHint } from './types.js';

/**
 * Plugin manifest filename.
 */
export const PLUGIN_MANIFEST_FILENAME = 'tpc-ai.plugin.json';

/**
 * Supported manifest filenames.
 */
export const PLUGIN_MANIFEST_FILENAMES = [
  PLUGIN_MANIFEST_FILENAME,
  'plugin.json',
] as const;

/**
 * Whether the value is a Record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Normalize a string array.
 */
function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

/**
 * Resolve the manifest path.
 *
 * @param rootDir Plugin root directory
 * @returns Manifest file path
 */
export function resolvePluginManifestPath(rootDir: string): string {
  for (const filename of PLUGIN_MANIFEST_FILENAMES) {
    const candidate = path.join(rootDir, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  // Fall back to the primary filename.
  return path.join(rootDir, PLUGIN_MANIFEST_FILENAME);
}

/**
 * Whether a manifest exists.
 *
 * @param rootDir Plugin root directory
 * @returns Whether a manifest exists
 */
export function hasPluginManifest(rootDir: string): boolean {
  for (const filename of PLUGIN_MANIFEST_FILENAMES) {
    const candidate = path.join(rootDir, filename);
    if (fs.existsSync(candidate)) {
      return true;
    }
  }
  return false;
}

/**
 * Load and parse a plugin manifest.
 *
 * @param rootDir Plugin root directory
 * @returns Load result
 *
 * @example
 * ```typescript
 * const result = loadPluginManifest('/path/to/my-plugin');
 * if (result.ok) {
 *   console.log('Plugin ID:', result.manifest.id);
 * } else {
 *   console.error('Error:', result.error);
 * }
 * ```
 */
export function loadPluginManifest(rootDir: string): PluginManifestLoadResult {
  const manifestPath = resolvePluginManifestPath(rootDir);

  // Check the file exists.
  if (!fs.existsSync(manifestPath)) {
    return {
      ok: false,
      error: `Plugin manifest not found: ${manifestPath}`,
      manifestPath,
    };
  }

  // Read and parse the JSON.
  let raw: unknown;
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    raw = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse plugin manifest: ${String(err)}`,
      manifestPath,
    };
  }

  // Validate it is an object.
  if (!isRecord(raw)) {
    return {
      ok: false,
      error: 'Plugin manifest must be an object',
      manifestPath,
    };
  }

  // Validate the required field: id.
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) {
    return {
      ok: false,
      error: 'Plugin manifest requires "id" field',
      manifestPath,
    };
  }

  // Validate the required field: configSchema.
  const configSchema = isRecord(raw.configSchema) ? raw.configSchema : {};

  // Parse optional fields.
  const name = typeof raw.name === 'string' ? raw.name.trim() : undefined;
  const version = typeof raw.version === 'string' ? raw.version.trim() : undefined;
  const description = typeof raw.description === 'string' ? raw.description.trim() : undefined;

  // Parse resource paths.
  const tools = normalizeStringArray(raw.tools);
  const skills = normalizeStringArray(raw.skills);
  const agents = normalizeStringArray(raw.agents);
  const dependencies = normalizeStringArray(raw.dependencies);

  // Parse UI hints.
  let uiHints: Record<string, PluginConfigUiHint> | undefined;
  if (isRecord(raw.uiHints)) {
    uiHints = raw.uiHints as Record<string, PluginConfigUiHint>;
  }

  // Build the manifest.
  const manifest: PluginManifest = {
    id,
    configSchema,
    name,
    version,
    description,
    tools: tools.length > 0 ? tools : undefined,
    skills: skills.length > 0 ? skills : undefined,
    agents: agents.length > 0 ? agents : undefined,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
    uiHints,
  };

  return {
    ok: true,
    manifest,
    manifestPath,
  };
}

/**
 * Build an empty configSchema.
 */
export function emptyPluginConfigSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {},
  };
}

/**
 * Validate a plugin ID format.
 *
 * @param id Plugin ID
 * @returns Whether the ID is valid
 */
export function isValidPluginId(id: string): boolean {
  // Allow: lowercase letters, digits, hyphens, underscores.
  return /^[a-z0-9][a-z0-9-_]*$/.test(id);
}

/**
 * Infer a plugin ID from a path.
 *
 * @param pluginPath Plugin path
 * @returns The inferred plugin ID
 */
export function inferPluginId(pluginPath: string): string {
  const basename = path.basename(pluginPath);
  // Strip the file extension.
  const name = basename.replace(/\.(ts|js|mjs|cjs)$/, '');
  // Convert to a valid ID.
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}
