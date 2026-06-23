/**
 * Configuration file IO.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  TPCAIConfig,
  ConfigFileSnapshot,
  ConfigValidationIssue,
} from './types.js';
import { validateConfig } from './validation.js';
import { resolveConfigEnvVars, MissingEnvVarError } from './env-substitution.js';
import { applyConfigDefaults } from './defaults.js';

// ==================== Type definitions ====================

/**
 * JSON5 parse result.
 */
export type ParseJson5Result =
  | { ok: true; parsed: unknown }
  | { ok: false; error: string };

/**
 * Config IO dependencies.
 */
export interface ConfigIoDeps {
  fs?: typeof fs;
  json5?: { parse: (value: string) => unknown; stringify?: (value: unknown, replacer?: null, space?: number) => string };
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  logger?: Pick<typeof console, 'error' | 'warn' | 'info'>;
}

/**
 * Config IO interface.
 */
export interface ConfigIO {
  /** Config file path. */
  configPath: string;
  /** Load config (sync). */
  loadConfig: () => TPCAIConfig;
  /** Load config (async). */
  loadConfigAsync: () => Promise<TPCAIConfig>;
  /** Read a config snapshot. */
  readConfigFileSnapshot: () => Promise<ConfigFileSnapshot>;
  /** Write the config file. */
  writeConfigFile: (config: TPCAIConfig) => Promise<void>;
  /** Whether the config exists. */
  exists: () => boolean;
}

// ==================== Constants ====================

const DEFAULT_CONFIG_FILENAME = 'tpc-ai.config.json5';
const CONFIG_BACKUP_COUNT = 5;

// ==================== Helpers ====================

/**
 * Hash content.
 */
function hashContent(content: string | null): string {
  return crypto
    .createHash('sha256')
    .update(content ?? '')
    .digest('hex');
}

/**
 * Try to import JSON5.
 */
let json5Module: { parse: (value: string) => unknown; stringify: (value: unknown, replacer?: null, space?: number) => string } | null = null;

async function getJson5(): Promise<typeof json5Module> {
  if (json5Module) {
    return json5Module;
  }
  try {
    json5Module = await import('json5');
    return json5Module;
  } catch {
    // JSON5 not available, use JSON.
    return null;
  }
}

function getJson5Sync(): typeof json5Module {
  if (json5Module) {
    return json5Module;
  }
  try {
    json5Module = require('json5');
    return json5Module;
  } catch {
    return null;
  }
}

/**
 * Parse JSON5 or JSON.
 */
export function parseConfigJson5(
  raw: string,
  json5?: { parse: (value: string) => unknown }
): ParseJson5Result {
  try {
    const parser = json5 ?? getJson5Sync() ?? JSON;
    return { ok: true, parsed: parser.parse(raw) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Serialize a config.
 */
function stringifyConfig(
  config: TPCAIConfig,
  json5?: { stringify?: (value: unknown, replacer?: null, space?: number) => string }
): string {
  const serializer = json5?.stringify ?? getJson5Sync()?.stringify ?? JSON.stringify;
  return serializer(config, null, 2).trimEnd().concat('\n');
}

/**
 * Rotate config backups.
 */
async function rotateConfigBackups(
  configPath: string,
  fsModule: typeof fs
): Promise<void> {
  if (CONFIG_BACKUP_COUNT <= 1) {
    return;
  }

  const backupBase = `${configPath}.bak`;
  const maxIndex = CONFIG_BACKUP_COUNT - 1;

  // Delete the oldest backup.
  try {
    await fsModule.promises.unlink(`${backupBase}.${maxIndex}`);
  } catch {
    // Ignore.
  }

  // Rotate existing backups.
  for (let index = maxIndex - 1; index >= 1; index -= 1) {
    try {
      await fsModule.promises.rename(
        `${backupBase}.${index}`,
        `${backupBase}.${index + 1}`
      );
    } catch {
      // Ignore.
    }
  }

  // Move the most recent backup.
  try {
    await fsModule.promises.rename(backupBase, `${backupBase}.1`);
  } catch {
    // Ignore.
  }
}

/**
 * Stamp the config version.
 */
function stampConfigVersion(config: TPCAIConfig): TPCAIConfig {
  return {
    ...config,
    meta: {
      ...config.meta,
      lastUpdatedAt: new Date().toISOString(),
    },
  };
}

// ==================== Default config paths ====================

/**
 * Resolve the default config path.
 */
export function resolveDefaultConfigPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  // Prefer the environment variable.
  if (env.TPC_AI_CONFIG_PATH?.trim()) {
    return env.TPC_AI_CONFIG_PATH.trim();
  }

  // Fall back to the current working directory.
  return path.join(process.cwd(), DEFAULT_CONFIG_FILENAME);
}

/**
 * Resolve candidate config paths.
 */
export function resolveConfigCandidates(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const candidates: string[] = [];

  // Path specified by the environment variable.
  if (env.TPC_AI_CONFIG_PATH?.trim()) {
    candidates.push(env.TPC_AI_CONFIG_PATH.trim());
  }

  // Current directory.
  candidates.push(path.join(process.cwd(), DEFAULT_CONFIG_FILENAME));
  candidates.push(path.join(process.cwd(), 'tpc-ai.config.json'));
  candidates.push(path.join(process.cwd(), 'config', DEFAULT_CONFIG_FILENAME));
  candidates.push(path.join(process.cwd(), 'config', 'tpc-ai.config.json'));

  return candidates;
}

// ==================== Config IO factory ====================

/**
 * Create a config IO.
 */
export function createConfigIO(overrides: ConfigIoDeps = {}): ConfigIO {
  const fsModule = overrides.fs ?? fs;
  const env = overrides.env ?? process.env;
  const logger = overrides.logger ?? console;

  // Resolve the config path.
  let configPath: string;
  if (overrides.configPath) {
    configPath = overrides.configPath;
  } else {
    const candidates = resolveConfigCandidates(env);
    configPath = candidates.find((p) => fsModule.existsSync(p)) ?? candidates[0];
  }

  /**
   * Whether the config exists.
   */
  function exists(): boolean {
    return fsModule.existsSync(configPath);
  }

  /**
   * Load the config synchronously.
   *
   * The harness recommends fail-loud over silent-fallback for missing required config.
   */
  function loadConfig(): TPCAIConfig {
    try {
      if (!exists()) {
        return applyConfigDefaults({});
      }

      const raw = fsModule.readFileSync(configPath, 'utf-8');
      const parseResult = parseConfigJson5(raw, overrides.json5);

      if (!parseResult.ok) {
        logger.error(`Failed to parse config at ${configPath}: ${parseResult.error}`);
        return applyConfigDefaults({});
      }

      // Substitute environment variables.
      let resolved: unknown;
      try {
        resolved = resolveConfigEnvVars(parseResult.parsed, { env });
      } catch (err) {
        if (err instanceof MissingEnvVarError) {
          logger.error(`Missing environment variable in config: ${err.varName}`);
          return applyConfigDefaults({});
        }
        throw err;
      }

      // Validate the config.
      const validationResult = validateConfig(resolved);
      if (!validationResult.ok) {
        const details = validationResult.issues
          .map((iss) => `- ${iss.path || '<root>'}: ${iss.message}`)
          .join('\n');
        logger.error(`Invalid config at ${configPath}:\n${details}`);
        return applyConfigDefaults({});
      }

      // Emit warnings.
      if (validationResult.warnings && validationResult.warnings.length > 0) {
        const details = validationResult.warnings
          .map((iss) => `- ${iss.path || '<root>'}: ${iss.message}`)
          .join('\n');
        logger.warn(`Config warnings:\n${details}`);
      }

      return applyConfigDefaults(validationResult.config);
    } catch (err) {
      logger.error(`Failed to load config at ${configPath}:`, err);
      return applyConfigDefaults({});
    }
  }

  /**
   * Load the config asynchronously.
   */
  async function loadConfigAsync(): Promise<TPCAIConfig> {
    try {
      if (!exists()) {
        return applyConfigDefaults({});
      }

      const raw = await fsModule.promises.readFile(configPath, 'utf-8');
      const json5 = overrides.json5 ?? (await getJson5());
      const parseResult = parseConfigJson5(raw, json5 ?? undefined);

      if (!parseResult.ok) {
        logger.error(`Failed to parse config at ${configPath}: ${parseResult.error}`);
        return applyConfigDefaults({});
      }

      // Substitute environment variables.
      let resolved: unknown;
      try {
        resolved = resolveConfigEnvVars(parseResult.parsed, { env });
      } catch (err) {
        if (err instanceof MissingEnvVarError) {
          logger.error(`Missing environment variable in config: ${err.varName}`);
          return applyConfigDefaults({});
        }
        throw err;
      }

      // Validate the config.
      const validationResult = validateConfig(resolved);
      if (!validationResult.ok) {
        const details = validationResult.issues
          .map((iss) => `- ${iss.path || '<root>'}: ${iss.message}`)
          .join('\n');
        logger.error(`Invalid config at ${configPath}:\n${details}`);
        return applyConfigDefaults({});
      }

      // Emit warnings.
      if (validationResult.warnings && validationResult.warnings.length > 0) {
        const details = validationResult.warnings
          .map((iss) => `- ${iss.path || '<root>'}: ${iss.message}`)
          .join('\n');
        logger.warn(`Config warnings:\n${details}`);
      }

      return applyConfigDefaults(validationResult.config);
    } catch (err) {
      logger.error(`Failed to load config at ${configPath}:`, err);
      return applyConfigDefaults({});
    }
  }

  /**
   * Read a config snapshot.
   */
  async function readConfigFileSnapshot(): Promise<ConfigFileSnapshot> {
    const fileExists = exists();

    if (!fileExists) {
      const hash = hashContent(null);
      return {
        path: configPath,
        exists: false,
        raw: null,
        parsed: {},
        valid: true,
        config: applyConfigDefaults({}),
        hash,
        issues: [],
        warnings: [],
      };
    }

    try {
      const raw = await fsModule.promises.readFile(configPath, 'utf-8');
      const hash = hashContent(raw);
      const json5 = overrides.json5 ?? (await getJson5());
      const parseResult = parseConfigJson5(raw, json5 ?? undefined);

      if (!parseResult.ok) {
        return {
          path: configPath,
          exists: true,
          raw,
          parsed: {},
          valid: false,
          config: {},
          hash,
          issues: [{ path: '', message: `JSON5 parse failed: ${parseResult.error}` }],
          warnings: [],
        };
      }

      // Substitute environment variables.
      let resolved: unknown;
      try {
        resolved = resolveConfigEnvVars(parseResult.parsed, { env });
      } catch (err) {
        const message =
          err instanceof MissingEnvVarError
            ? err.message
            : `Env var substitution failed: ${String(err)}`;
        return {
          path: configPath,
          exists: true,
          raw,
          parsed: parseResult.parsed,
          valid: false,
          config: parseResult.parsed as TPCAIConfig,
          hash,
          issues: [{ path: '', message }],
          warnings: [],
        };
      }

      // Validate the config.
      const validationResult = validateConfig(resolved);
      if (!validationResult.ok) {
        return {
          path: configPath,
          exists: true,
          raw,
          parsed: parseResult.parsed,
          valid: false,
          config: resolved as TPCAIConfig,
          hash,
          issues: validationResult.issues,
          warnings: [],
        };
      }

      return {
        path: configPath,
        exists: true,
        raw,
        parsed: parseResult.parsed,
        valid: true,
        config: applyConfigDefaults(validationResult.config),
        hash,
        issues: [],
        warnings: validationResult.warnings || [],
      };
    } catch (err) {
      return {
        path: configPath,
        exists: true,
        raw: null,
        parsed: {},
        valid: false,
        config: {},
        hash: hashContent(null),
        issues: [{ path: '', message: `Read failed: ${String(err)}` }],
        warnings: [],
      };
    }
  }

  /**
   * Write the config file.
   */
  async function writeConfigFile(config: TPCAIConfig): Promise<void> {
    // Validate the config.
    const validationResult = validateConfig(config);
    if (!validationResult.ok) {
      const issue = validationResult.issues[0];
      const pathLabel = issue?.path ? issue.path : '<root>';
      throw new Error(
        `Config validation failed: ${pathLabel}: ${issue?.message ?? 'invalid'}`
      );
    }

    // Ensure the directory exists.
    const dir = path.dirname(configPath);
    await fsModule.promises.mkdir(dir, { recursive: true });

    // Serialize the config.
    const json5 = overrides.json5 ?? (await getJson5());
    const content = stringifyConfig(stampConfigVersion(config), json5 ?? undefined);

    // Atomic write.
    const tmp = path.join(
      dir,
      `${path.basename(configPath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );

    await fsModule.promises.writeFile(tmp, content, { encoding: 'utf-8' });

    // Back up the existing config.
    if (exists()) {
      await rotateConfigBackups(configPath, fsModule);
      try {
        await fsModule.promises.copyFile(configPath, `${configPath}.bak`);
      } catch {
        // Ignore.
      }
    }

    // Atomic replace.
    try {
      await fsModule.promises.rename(tmp, configPath);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Windows does not support atomic rename onto an existing file.
      if (code === 'EPERM' || code === 'EEXIST') {
        await fsModule.promises.copyFile(tmp, configPath);
        try {
          await fsModule.promises.unlink(tmp);
        } catch {
          // Ignore.
        }
        return;
      }
      try {
        await fsModule.promises.unlink(tmp);
      } catch {
        // Ignore.
      }
      throw err;
    }
  }

  return {
    configPath,
    loadConfig,
    loadConfigAsync,
    readConfigFileSnapshot,
    writeConfigFile,
    exists,
  };
}

// ==================== Convenience functions ====================

/**
 * Load the config (using the default path).
 */
export function loadConfig(configPath?: string): TPCAIConfig {
  const io = createConfigIO({ configPath });
  return io.loadConfig();
}

/**
 * Load the config asynchronously.
 */
export async function loadConfigAsync(configPath?: string): Promise<TPCAIConfig> {
  const io = createConfigIO({ configPath });
  return io.loadConfigAsync();
}

/**
 * Read a config snapshot.
 */
export async function readConfigFileSnapshot(
  configPath?: string
): Promise<ConfigFileSnapshot> {
  const io = createConfigIO({ configPath });
  return io.readConfigFileSnapshot();
}

/**
 * Write the config.
 */
export async function writeConfigFile(
  config: TPCAIConfig,
  configPath?: string
): Promise<void> {
  const io = createConfigIO({ configPath });
  return io.writeConfigFile(config);
}
