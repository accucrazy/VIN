/**
 * Configuration defaults application.
 */

import type {
  TPCAIConfig,
  SessionConfig,
  QueueConfig,
  TypingConfig,
  BlockReplyConfig,
  ErrorRecoveryConfig,
  AgentConfig,
} from './types.js';
import { CONFIG_DEFAULTS } from './types.js';

// ==================== Helpers ====================

/**
 * Deep-merge two objects.
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue === undefined) {
      continue;
    }

    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Apply defaults to a value.
 */
function applyDefaults<T extends object>(
  value: Partial<T> | undefined,
  defaults: T
): T {
  if (!value) {
    return { ...defaults };
  }
  return deepMerge(
    defaults as Record<string, unknown>,
    value as Partial<Record<string, unknown>>
  ) as T;
}

// ==================== Session defaults ====================

/**
 * Apply session defaults.
 */
export function applySessionDefaults(
  config: SessionConfig | undefined,
  defaults: SessionConfig = CONFIG_DEFAULTS.defaults.session!
): SessionConfig {
  return applyDefaults<SessionConfig>(config, defaults);
}

// ==================== Queue defaults ====================

/**
 * Apply queue defaults.
 */
export function applyQueueDefaults(
  config: QueueConfig | undefined,
  defaults: QueueConfig = CONFIG_DEFAULTS.defaults.queue!
): QueueConfig {
  return applyDefaults<QueueConfig>(config, defaults);
}

// ==================== Typing defaults ====================

/**
 * Apply typing defaults.
 */
export function applyTypingDefaults(
  config: TypingConfig | undefined,
  defaults: TypingConfig = CONFIG_DEFAULTS.defaults.typing!
): TypingConfig {
  return applyDefaults<TypingConfig>(config, defaults);
}

// ==================== Block-reply defaults ====================

/**
 * Apply block-reply defaults.
 */
export function applyBlockReplyDefaults(
  config: BlockReplyConfig | undefined,
  defaults: BlockReplyConfig = CONFIG_DEFAULTS.defaults.blockReply!
): BlockReplyConfig {
  return applyDefaults<BlockReplyConfig>(config, defaults);
}

// ==================== Error-recovery defaults ====================

/**
 * Apply error-recovery defaults.
 */
export function applyErrorRecoveryDefaults(
  config: ErrorRecoveryConfig | undefined,
  defaults: ErrorRecoveryConfig = CONFIG_DEFAULTS.defaults.errorRecovery!
): ErrorRecoveryConfig {
  return applyDefaults<ErrorRecoveryConfig>(config, defaults);
}

// ==================== Agent defaults ====================

/**
 * Apply agent defaults.
 */
export function applyAgentDefaults(
  agent: AgentConfig,
  globalDefaults?: TPCAIConfig['defaults']
): AgentConfig {
  const defaults = globalDefaults || CONFIG_DEFAULTS.defaults;

  return {
    ...agent,
    session: applySessionDefaults(agent.session, defaults.session),
    queue: applyQueueDefaults(agent.queue, defaults.queue),
    typing: applyTypingDefaults(agent.typing, defaults.typing),
    blockReply: applyBlockReplyDefaults(agent.blockReply, defaults.blockReply),
    errorRecovery: applyErrorRecoveryDefaults(agent.errorRecovery, defaults.errorRecovery),
  };
}

// ==================== Full-config defaults ====================

/**
 * Apply defaults to a full config.
 *
 * The harness recommends fail-loud over silent-fallback for missing required config.
 */
export function applyConfigDefaults(config: TPCAIConfig): TPCAIConfig {
  // Merge global defaults.
  const mergedDefaults = deepMerge(
    CONFIG_DEFAULTS.defaults as Record<string, unknown>,
    (config.defaults || {}) as Record<string, unknown>
  );

  // Apply to each agent.
  const agents = (config.agents || []).map((agent) =>
    applyAgentDefaults(agent, mergedDefaults as TPCAIConfig['defaults'])
  );

  return {
    ...config,
    provider: { ...CONFIG_DEFAULTS.provider, ...config.provider },
    memory: { ...CONFIG_DEFAULTS.memory, ...config.memory },
    identity: { ...CONFIG_DEFAULTS.identity, ...config.identity },
    agent: { ...CONFIG_DEFAULTS.agent, ...config.agent },
    defaults: mergedDefaults as TPCAIConfig['defaults'],
    agents,
  };
}

/**
 * Get the effective session config.
 */
export function getEffectiveSessionConfig(
  agent: AgentConfig,
  globalDefaults?: TPCAIConfig['defaults']
): Required<SessionConfig> {
  const defaults = globalDefaults || CONFIG_DEFAULTS.defaults;
  const merged = applySessionDefaults(agent.session, defaults.session);
  return merged as Required<SessionConfig>;
}

/**
 * Get the effective queue config.
 */
export function getEffectiveQueueConfig(
  agent: AgentConfig,
  globalDefaults?: TPCAIConfig['defaults']
): Required<QueueConfig> {
  const defaults = globalDefaults || CONFIG_DEFAULTS.defaults;
  const merged = applyQueueDefaults(agent.queue, defaults.queue);
  return merged as Required<QueueConfig>;
}

/**
 * Get the effective typing config.
 */
export function getEffectiveTypingConfig(
  agent: AgentConfig,
  globalDefaults?: TPCAIConfig['defaults']
): Required<TypingConfig> {
  const defaults = globalDefaults || CONFIG_DEFAULTS.defaults;
  const merged = applyTypingDefaults(agent.typing, defaults.typing);
  return merged as Required<TypingConfig>;
}

/**
 * Get the effective block-reply config.
 */
export function getEffectiveBlockReplyConfig(
  agent: AgentConfig,
  globalDefaults?: TPCAIConfig['defaults']
): Required<BlockReplyConfig> {
  const defaults = globalDefaults || CONFIG_DEFAULTS.defaults;
  const merged = applyBlockReplyDefaults(agent.blockReply, defaults.blockReply);
  return merged as Required<BlockReplyConfig>;
}

/**
 * Get the effective error-recovery config.
 */
export function getEffectiveErrorRecoveryConfig(
  agent: AgentConfig,
  globalDefaults?: TPCAIConfig['defaults']
): Required<ErrorRecoveryConfig> {
  const defaults = globalDefaults || CONFIG_DEFAULTS.defaults;
  const merged = applyErrorRecoveryDefaults(agent.errorRecovery, defaults.errorRecovery);
  return merged as Required<ErrorRecoveryConfig>;
}
