/**
 * Configuration validation.
 */

import type {
  TPCAIConfig,
  ConfigValidationIssue,
  ConfigValidationResult,
  AgentConfig,
  SessionConfig,
  QueueConfig,
  TypingConfig,
  BlockReplyConfig,
  ErrorRecoveryConfig,
} from './types.js';

// ==================== Validator types ====================

type Validator<T> = (value: T, path: string) => ConfigValidationIssue[];

// ==================== Helpers ====================

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function createIssue(
  path: string,
  message: string,
  severity: 'error' | 'warning' = 'error'
): ConfigValidationIssue {
  return { path, message, severity };
}

function validateNumber(
  value: unknown,
  path: string,
  options?: {
    min?: number;
    max?: number;
    integer?: boolean;
    required?: boolean;
  }
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (value === undefined || value === null) {
    if (options?.required) {
      issues.push(createIssue(path, 'Value is required'));
    }
    return issues;
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    issues.push(createIssue(path, 'Must be a number'));
    return issues;
  }

  if (options?.integer && !Number.isInteger(value)) {
    issues.push(createIssue(path, 'Must be an integer'));
  }

  if (options?.min !== undefined && value < options.min) {
    issues.push(createIssue(path, `Must be at least ${options.min}`));
  }

  if (options?.max !== undefined && value > options.max) {
    issues.push(createIssue(path, `Must be at most ${options.max}`));
  }

  return issues;
}

function validateString(
  value: unknown,
  path: string,
  options?: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    enum?: string[];
    required?: boolean;
  }
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (value === undefined || value === null) {
    if (options?.required) {
      issues.push(createIssue(path, 'Value is required'));
    }
    return issues;
  }

  if (typeof value !== 'string') {
    issues.push(createIssue(path, 'Must be a string'));
    return issues;
  }

  if (options?.minLength !== undefined && value.length < options.minLength) {
    issues.push(createIssue(path, `Must be at least ${options.minLength} characters`));
  }

  if (options?.maxLength !== undefined && value.length > options.maxLength) {
    issues.push(createIssue(path, `Must be at most ${options.maxLength} characters`));
  }

  if (options?.pattern && !options.pattern.test(value)) {
    issues.push(createIssue(path, `Must match pattern ${options.pattern}`));
  }

  if (options?.enum && !options.enum.includes(value)) {
    issues.push(createIssue(path, `Must be one of: ${options.enum.join(', ')}`));
  }

  return issues;
}

function validateBoolean(
  value: unknown,
  path: string,
  options?: { required?: boolean }
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (value === undefined || value === null) {
    if (options?.required) {
      issues.push(createIssue(path, 'Value is required'));
    }
    return issues;
  }

  if (typeof value !== 'boolean') {
    issues.push(createIssue(path, 'Must be a boolean'));
  }

  return issues;
}

function validateArray<T>(
  value: unknown,
  path: string,
  itemValidator?: (item: unknown, itemPath: string) => ConfigValidationIssue[],
  options?: {
    minLength?: number;
    maxLength?: number;
    required?: boolean;
  }
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (value === undefined || value === null) {
    if (options?.required) {
      issues.push(createIssue(path, 'Value is required'));
    }
    return issues;
  }

  if (!Array.isArray(value)) {
    issues.push(createIssue(path, 'Must be an array'));
    return issues;
  }

  if (options?.minLength !== undefined && value.length < options.minLength) {
    issues.push(createIssue(path, `Must have at least ${options.minLength} items`));
  }

  if (options?.maxLength !== undefined && value.length > options.maxLength) {
    issues.push(createIssue(path, `Must have at most ${options.maxLength} items`));
  }

  if (itemValidator) {
    for (let i = 0; i < value.length; i++) {
      issues.push(...itemValidator(value[i], `${path}[${i}]`));
    }
  }

  return issues;
}

// ==================== Sub-config validators ====================

/**
 * Validate the session config.
 */
function validateSessionConfig(config: unknown, path: string): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (!isObject(config)) {
    if (config !== undefined) {
      issues.push(createIssue(path, 'Must be an object'));
    }
    return issues;
  }

  const session = config as SessionConfig;

  // Persistence config.
  if (session.persistence) {
    const p = session.persistence;
    issues.push(...validateBoolean(p.enabled, `${path}.persistence.enabled`));
    issues.push(...validateBoolean(p.cacheEnabled, `${path}.persistence.cacheEnabled`));
    issues.push(
      ...validateNumber(p.cacheTtlMs, `${path}.persistence.cacheTtlMs`, { min: 0 })
    );
    issues.push(
      ...validateNumber(p.cacheMaxEntries, `${path}.persistence.cacheMaxEntries`, { min: 1 })
    );
  }

  // Scope config.
  if (session.scope) {
    const s = session.scope;
    issues.push(
      ...validateString(s.scope, `${path}.scope.scope`, {
        enum: ['per-sender', 'global'],
      })
    );
    issues.push(
      ...validateString(s.dmScope, `${path}.scope.dmScope`, {
        enum: ['main', 'per-peer', 'per-channel-peer', 'per-account-channel-peer'],
      })
    );
  }

  // Cleanup config.
  if (session.cleanup) {
    const c = session.cleanup;
    issues.push(
      ...validateNumber(c.idleTimeoutMs, `${path}.cleanup.idleTimeoutMs`, { min: 0 })
    );
    issues.push(
      ...validateNumber(c.maxSessions, `${path}.cleanup.maxSessions`, { min: 1, integer: true })
    );
    issues.push(
      ...validateNumber(c.cleanupIntervalMs, `${path}.cleanup.cleanupIntervalMs`, { min: 0 })
    );
  }

  return issues;
}

/**
 * Validate the queue config.
 */
function validateQueueConfig(config: unknown, path: string): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (!isObject(config)) {
    if (config !== undefined) {
      issues.push(createIssue(path, 'Must be an object'));
    }
    return issues;
  }

  const queue = config as QueueConfig;

  issues.push(
    ...validateString(queue.mode, `${path}.mode`, {
      enum: ['steer', 'interrupt', 'collect', 'followup', 'steer-backlog', 'queue'],
    })
  );
  issues.push(
    ...validateNumber(queue.capacity, `${path}.capacity`, { min: 1, integer: true })
  );
  issues.push(
    ...validateString(queue.dropPolicy, `${path}.dropPolicy`, {
      enum: ['old', 'new', 'summarize'],
    })
  );
  issues.push(
    ...validateString(queue.dedupeMode, `${path}.dedupeMode`, {
      enum: ['none', 'exact', 'fuzzy'],
    })
  );
  issues.push(
    ...validateNumber(queue.drainDelayMs, `${path}.drainDelayMs`, { min: 0 })
  );

  return issues;
}

/**
 * Validate the typing config.
 */
function validateTypingConfig(config: unknown, path: string): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (!isObject(config)) {
    if (config !== undefined) {
      issues.push(createIssue(path, 'Must be an object'));
    }
    return issues;
  }

  const typing = config as TypingConfig;

  issues.push(
    ...validateString(typing.mode, `${path}.mode`, {
      enum: ['never', 'instant', 'thinking', 'message'],
    })
  );
  issues.push(
    ...validateNumber(typing.intervalSeconds, `${path}.intervalSeconds`, { min: 1 })
  );
  issues.push(
    ...validateNumber(typing.ttlMs, `${path}.ttlMs`, { min: 0 })
  );
  issues.push(
    ...validateString(typing.groupMode, `${path}.groupMode`, {
      enum: ['never', 'instant', 'thinking', 'message'],
    })
  );

  return issues;
}

/**
 * Validate the block-reply config.
 */
function validateBlockReplyConfig(config: unknown, path: string): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (!isObject(config)) {
    if (config !== undefined) {
      issues.push(createIssue(path, 'Must be an object'));
    }
    return issues;
  }

  const blockReply = config as BlockReplyConfig;

  // Coalescing config.
  if (blockReply.coalescing) {
    const c = blockReply.coalescing;
    issues.push(...validateBoolean(c.enabled, `${path}.coalescing.enabled`));
    issues.push(
      ...validateNumber(c.minChars, `${path}.coalescing.minChars`, { min: 0, integer: true })
    );
    issues.push(
      ...validateNumber(c.maxChars, `${path}.coalescing.maxChars`, { min: 1, integer: true })
    );
    issues.push(
      ...validateNumber(c.idleMs, `${path}.coalescing.idleMs`, { min: 0 })
    );

    // Logical check.
    if (c.minChars !== undefined && c.maxChars !== undefined && c.minChars > c.maxChars) {
      issues.push(
        createIssue(`${path}.coalescing`, 'minChars must be less than or equal to maxChars')
      );
    }
  }

  // Chunking config.
  if (blockReply.chunking) {
    const c = blockReply.chunking;
    issues.push(
      ...validateNumber(c.limit, `${path}.chunking.limit`, { min: 1, integer: true })
    );
    issues.push(
      ...validateString(c.mode, `${path}.chunking.mode`, {
        enum: ['length', 'newline', 'paragraph'],
      })
    );
    issues.push(
      ...validateString(c.breakPreference, `${path}.chunking.breakPreference`, {
        enum: ['paragraph', 'newline', 'sentence', 'word'],
      })
    );
  }

  issues.push(
    ...validateNumber(blockReply.timeoutMs, `${path}.timeoutMs`, { min: 0 })
  );

  return issues;
}

/**
 * Validate the error-recovery config.
 */
function validateErrorRecoveryConfig(config: unknown, path: string): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (!isObject(config)) {
    if (config !== undefined) {
      issues.push(createIssue(path, 'Must be an object'));
    }
    return issues;
  }

  const errorRecovery = config as ErrorRecoveryConfig;

  // Retry config.
  if (errorRecovery.retry) {
    const r = errorRecovery.retry;
    issues.push(
      ...validateNumber(r.maxAttempts, `${path}.retry.maxAttempts`, { min: 1, integer: true })
    );
    issues.push(
      ...validateNumber(r.initialDelayMs, `${path}.retry.initialDelayMs`, { min: 0 })
    );
    issues.push(
      ...validateNumber(r.maxDelayMs, `${path}.retry.maxDelayMs`, { min: 0 })
    );
    issues.push(
      ...validateNumber(r.backoffFactor, `${path}.retry.backoffFactor`, { min: 1 })
    );
    issues.push(
      ...validateNumber(r.jitter, `${path}.retry.jitter`, { min: 0, max: 1 })
    );
  }

  // Session-reset config.
  if (errorRecovery.sessionReset) {
    const s = errorRecovery.sessionReset;
    issues.push(
      ...validateBoolean(s.autoResetEnabled, `${path}.sessionReset.autoResetEnabled`)
    );
    issues.push(
      ...validateNumber(s.archiveHistoryCount, `${path}.sessionReset.archiveHistoryCount`, {
        min: 0,
        integer: true,
      })
    );
  }

  return issues;
}

/**
 * Validate an agent config.
 */
function validateAgentConfig(config: unknown, path: string): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (!isObject(config)) {
    issues.push(createIssue(path, 'Must be an object'));
    return issues;
  }

  const agent = config as AgentConfig;

  issues.push(...validateString(agent.id, `${path}.id`));

  // Identity config.
  if (agent.identity) {
    issues.push(...validateString(agent.identity.name, `${path}.identity.name`));
    issues.push(...validateString(agent.identity.description, `${path}.identity.description`));
    issues.push(...validateString(agent.identity.avatar, `${path}.identity.avatar`));
    issues.push(...validateString(agent.identity.systemPrompt, `${path}.identity.systemPrompt`));
  }

  // Model config.
  if (agent.model) {
    issues.push(...validateString(agent.model.primary, `${path}.model.primary`));
    issues.push(
      ...validateArray(
        agent.model.fallbacks,
        `${path}.model.fallbacks`,
        (item, itemPath) => validateString(item, itemPath)
      )
    );
    issues.push(...validateString(agent.model.imageModel, `${path}.model.imageModel`));
  }

  // Sub-configs.
  issues.push(...validateSessionConfig(agent.session, `${path}.session`));
  issues.push(...validateQueueConfig(agent.queue, `${path}.queue`));
  issues.push(...validateTypingConfig(agent.typing, `${path}.typing`));
  issues.push(...validateBlockReplyConfig(agent.blockReply, `${path}.blockReply`));
  issues.push(...validateErrorRecoveryConfig(agent.errorRecovery, `${path}.errorRecovery`));

  return issues;
}

// ==================== Main validation ====================

/**
 * Validate a full config.
 */
export function validateConfig(raw: unknown): ConfigValidationResult {
  const issues: ConfigValidationIssue[] = [];
  const warnings: ConfigValidationIssue[] = [];

  if (!isObject(raw)) {
    return {
      ok: false,
      issues: [createIssue('', 'Config must be an object')],
    };
  }

  const config = raw as TPCAIConfig;

  // Metadata validation.
  if (config.meta) {
    issues.push(...validateString(config.meta.version, 'meta.version'));
    issues.push(...validateString(config.meta.lastUpdatedAt, 'meta.lastUpdatedAt'));
    issues.push(...validateString(config.meta.description, 'meta.description'));
  }

  // Defaults validation.
  if (config.defaults) {
    issues.push(...validateSessionConfig(config.defaults.session, 'defaults.session'));
    issues.push(...validateQueueConfig(config.defaults.queue, 'defaults.queue'));
    issues.push(...validateTypingConfig(config.defaults.typing, 'defaults.typing'));
    issues.push(...validateBlockReplyConfig(config.defaults.blockReply, 'defaults.blockReply'));
    issues.push(
      ...validateErrorRecoveryConfig(config.defaults.errorRecovery, 'defaults.errorRecovery')
    );
  }

  // Agent list validation.
  if (config.agents) {
    issues.push(
      ...validateArray(config.agents, 'agents', (item, itemPath) =>
        validateAgentConfig(item, itemPath)
      )
    );

    // Check for duplicate agent ids.
    const agentIds = new Set<string>();
    for (let i = 0; i < config.agents.length; i++) {
      const agent = config.agents[i];
      if (agent.id) {
        if (agentIds.has(agent.id)) {
          issues.push(createIssue(`agents[${i}].id`, `Duplicate agent id: ${agent.id}`));
        } else {
          agentIds.add(agent.id);
        }
      }
    }
  }

  // Environment-variable validation.
  if (config.env && !isObject(config.env)) {
    issues.push(createIssue('env', 'Must be an object'));
  }

  // Separate errors and warnings.
  const errors = issues.filter((i) => i.severity !== 'warning');
  const warningsFromIssues = issues.filter((i) => i.severity === 'warning');

  if (errors.length > 0) {
    return { ok: false, issues: errors };
  }

  return {
    ok: true,
    config: config,
    warnings: [...warnings, ...warningsFromIssues],
  };
}

/**
 * Type guard: whether the config is valid.
 */
export function isValidConfig(raw: unknown): raw is TPCAIConfig {
  return validateConfig(raw).ok;
}

/**
 * Get config validation errors.
 */
export function getConfigErrors(raw: unknown): ConfigValidationIssue[] {
  const result = validateConfig(raw);
  return result.ok ? [] : result.issues;
}
