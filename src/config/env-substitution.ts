/**
 * Configuration environment-variable substitution.
 *
 * Supports `${VAR}` and `${VAR:-default}` syntax with recursive resolution.
 */

// ==================== Error types ====================

/**
 * Thrown when a required environment variable is missing.
 */
export class MissingEnvVarError extends Error {
  constructor(
    public readonly varName: string,
    public readonly path?: string
  ) {
    const pathInfo = path ? ` at ${path}` : '';
    super(`Missing required environment variable: ${varName}${pathInfo}`);
    this.name = 'MissingEnvVarError';
  }
}

// ==================== Type definitions ====================

/**
 * Options for environment-variable substitution.
 */
export interface EnvSubstitutionOptions {
  /** Environment-variable map. */
  env?: Record<string, string | undefined>;
  /** Whether to throw when a variable is missing. */
  throwOnMissing?: boolean;
  /** Whether to preserve unresolved variables. */
  preserveUnresolved?: boolean;
  /** Custom variable resolver. */
  resolver?: (varName: string, defaultValue?: string) => string | undefined;
}

// ==================== Constants ====================

/**
 * Environment-variable pattern. Supports:
 * - `${VAR}`           - basic variable
 * - `${VAR:-default}`  - with default value
 * - `${VAR:=default}`  - with default value (same as above)
 */
const ENV_VAR_PATTERN = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)(?::-?(.+?))?\}/g;

// ==================== Core functions ====================

/**
 * Substitute environment variables in a string.
 */
export function substituteEnvVars(
  value: string,
  options: EnvSubstitutionOptions = {}
): string {
  const {
    env = process.env,
    throwOnMissing = true,
    preserveUnresolved = false,
    resolver,
  } = options;

  return value.replace(ENV_VAR_PATTERN, (match, varName: string, defaultValue?: string) => {
    // Use the custom resolver first.
    if (resolver) {
      const resolved = resolver(varName, defaultValue);
      if (resolved !== undefined) {
        return resolved;
      }
    }

    // Read from the environment.
    const envValue = env[varName];

    // Return the value if present.
    if (envValue !== undefined && envValue !== '') {
      return envValue;
    }

    // Fall back to the default value if provided.
    if (defaultValue !== undefined) {
      // Recursively substitute variables in the default value.
      return substituteEnvVars(defaultValue, options);
    }

    // Throw if required.
    if (throwOnMissing) {
      throw new MissingEnvVarError(varName);
    }

    // Preserve the unresolved variable if requested.
    if (preserveUnresolved) {
      return match;
    }

    // Otherwise return an empty string.
    return '';
  });
}

/**
 * Recursively substitute environment variables across an object.
 */
export function resolveConfigEnvVars<T>(
  value: T,
  options: EnvSubstitutionOptions = {}
): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return substituteEnvVars(value, options) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveConfigEnvVars(item, options)) as T;
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolveConfigEnvVars(val, options);
    }
    return result as T;
  }

  return value;
}

/**
 * Collect the environment variables referenced in a config value.
 */
export function collectEnvVarRefs(value: unknown): string[] {
  const refs = new Set<string>();

  function collect(val: unknown): void {
    if (typeof val === 'string') {
      let match;
      const pattern = new RegExp(ENV_VAR_PATTERN.source, 'g');
      while ((match = pattern.exec(val)) !== null) {
        refs.add(match[1]);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) {
        collect(item);
      }
    } else if (val && typeof val === 'object') {
      for (const v of Object.values(val)) {
        collect(v);
      }
    }
  }

  collect(value);
  return Array.from(refs);
}

/**
 * Check whether all referenced environment variables are set.
 */
export function checkEnvVarsSet(
  value: unknown,
  env: Record<string, string | undefined> = process.env
): { missing: string[]; set: string[] } {
  const refs = collectEnvVarRefs(value);
  const missing: string[] = [];
  const set: string[] = [];

  for (const ref of refs) {
    if (env[ref] !== undefined && env[ref] !== '') {
      set.push(ref);
    } else {
      missing.push(ref);
    }
  }

  return { missing, set };
}

/**
 * Create an environment-variable resolver backed by a set of defaults.
 */
export function createEnvResolver(
  defaults: Record<string, string>
): (varName: string, defaultValue?: string) => string | undefined {
  return (varName: string, defaultValue?: string) => {
    const envValue = process.env[varName];
    if (envValue !== undefined && envValue !== '') {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return defaults[varName];
  };
}

/**
 * Safely substitute environment variables (never throws).
 */
export function safeSubstituteEnvVars(
  value: string,
  env: Record<string, string | undefined> = process.env
): { result: string; missing: string[] } {
  const missing: string[] = [];

  const result = value.replace(
    ENV_VAR_PATTERN,
    (match, varName: string, defaultValue?: string) => {
      const envValue = env[varName];

      if (envValue !== undefined && envValue !== '') {
        return envValue;
      }

      if (defaultValue !== undefined) {
        return defaultValue;
      }

      missing.push(varName);
      return '';
    }
  );

  return { result, missing };
}
