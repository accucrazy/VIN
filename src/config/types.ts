/**
 * Configuration type definitions.
 *
 * The config schema plus its defaults. This file is self-contained: the small
 * union types that the per-agent sub-configs reference (typing / scope / chunk
 * modes) are declared inline here rather than imported from runtime modules, so
 * the config layer can be read on its own.
 */

import type { QueueMode, QueueDropPolicy } from '../session/followup-queue/types.js';
import type { ErrorCategory, ErrorSeverity } from '../session/error-recovery/types.js';

// ==================== Inlined enums ====================
// These were union types owned by runtime session sub-modules (typing / scoping /
// block-reply) that are not part of this demo. They are reproduced here so the
// config schema stays self-describing.

/** Typing-indicator mode. */
export type TypingMode = 'never' | 'instant' | 'thinking' | 'message';

/** Session scope: keyed per sender, or one shared session. */
export type SessionScope = 'per-sender' | 'global';

/** Direct-message scope granularity. */
export type DmScope = 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';

/** Block-reply chunking strategy. */
export type ChunkMode = 'length' | 'newline' | 'paragraph';

/** Preferred break point when chunking. */
export type ChunkBreakPreference = 'paragraph' | 'newline' | 'sentence' | 'word';

// ==================== Validation result types ====================

/**
 * A single config validation problem.
 */
export interface ConfigValidationIssue {
  /** Config path. */
  path: string;
  /** Problem description. */
  message: string;
  /** Severity. */
  severity?: 'error' | 'warning';
}

/**
 * Validation result.
 */
export type ConfigValidationResult =
  | { ok: true; config: TPCAIConfig; warnings?: ConfigValidationIssue[] }
  | { ok: false; issues: ConfigValidationIssue[] };

// ==================== Base config types ====================

/**
 * Metadata config.
 */
export interface ConfigMeta {
  /** Version. */
  version?: string;
  /** Last-updated timestamp. */
  lastUpdatedAt?: string;
  /** Config description. */
  description?: string;
}

/**
 * Retry config.
 */
export interface RetryConfig {
  /** Max retry attempts. */
  maxAttempts?: number;
  /** Initial delay (ms). */
  initialDelayMs?: number;
  /** Max delay (ms). */
  maxDelayMs?: number;
  /** Backoff factor. */
  backoffFactor?: number;
  /** Jitter factor (0-1). */
  jitter?: number;
}

/**
 * Timeout config.
 */
export interface TimeoutConfig {
  /** Default timeout (ms). */
  defaultMs?: number;
  /** Connection timeout (ms). */
  connectionMs?: number;
  /** Read timeout (ms). */
  readMs?: number;
}

// ==================== Provider / memory / identity (default shape) ====================

/**
 * Model-provider config. Defaults target an OpenAI-compatible setup.
 */
export interface ProviderConfig {
  /** Provider id (e.g. 'openai'). */
  provider?: string;
  /** Base URL for an OpenAI-compatible endpoint. */
  baseUrl?: string;
  /** Default model id. */
  model?: string;
}

/**
 * Memory backend config. Defaults to a local SQLite file.
 */
export interface MemoryConfig {
  /** Backend kind (e.g. 'sqlite'). */
  backend?: string;
  /** Path to the SQLite database file. */
  path?: string;
}

/**
 * Caller identity. Single-user by default.
 */
export interface IdentityConfig {
  /** Stable user id. 'local' for single-user setups. */
  userId?: string;
}

// ==================== Session config ====================

/**
 * Session persistence config.
 */
export interface SessionPersistenceConfig {
  /** Whether persistence is enabled. */
  enabled?: boolean;
  /** Whether caching is enabled. */
  cacheEnabled?: boolean;
  /** Cache TTL (ms). */
  cacheTtlMs?: number;
  /** Max cache entries. */
  cacheMaxEntries?: number;
}

/**
 * Session scope config.
 */
export interface SessionScopeConfig {
  /** Session scope. */
  scope?: SessionScope;
  /** DM scope. */
  dmScope?: DmScope;
  /** Main key name. */
  mainKey?: string;
  /** Agent id. */
  agentId?: string;
}

/**
 * Session cleanup config.
 */
export interface SessionCleanupConfig {
  /** Idle timeout (ms). */
  idleTimeoutMs?: number;
  /** Max sessions. */
  maxSessions?: number;
  /** Cleanup interval (ms). */
  cleanupIntervalMs?: number;
}

/**
 * Session config.
 */
export interface SessionConfig {
  /** Persistence config. */
  persistence?: SessionPersistenceConfig;
  /** Scope config. */
  scope?: SessionScopeConfig;
  /** Cleanup config. */
  cleanup?: SessionCleanupConfig;
}

// ==================== Queue config ====================

/**
 * Followup-queue config.
 */
export interface QueueConfig {
  /** Queue mode. */
  mode?: QueueMode;
  /** Max capacity. */
  capacity?: number;
  /** Overflow drop policy. */
  dropPolicy?: QueueDropPolicy;
  /** Dedup mode. */
  dedupeMode?: 'none' | 'exact' | 'fuzzy';
  /** Drain delay (ms). */
  drainDelayMs?: number;
}

// ==================== Typing config ====================

/**
 * Typing-indicator config.
 */
export interface TypingConfig {
  /** Typing mode. */
  mode?: TypingMode;
  /** Interval (seconds). */
  intervalSeconds?: number;
  /** TTL (ms). */
  ttlMs?: number;
  /** Group mode. */
  groupMode?: TypingMode;
}

// ==================== Block-reply config ====================

/**
 * Coalescing config.
 */
export interface CoalescingConfig {
  /** Whether enabled. */
  enabled?: boolean;
  /** Min chars. */
  minChars?: number;
  /** Max chars. */
  maxChars?: number;
  /** Idle time (ms). */
  idleMs?: number;
}

/**
 * Chunk config.
 */
export interface ChunkConfig {
  /** Chunk limit. */
  limit?: number;
  /** Chunk mode. */
  mode?: ChunkMode;
  /** Break preference. */
  breakPreference?: ChunkBreakPreference;
}

/**
 * Block-reply config.
 */
export interface BlockReplyConfig {
  /** Coalescing config. */
  coalescing?: CoalescingConfig;
  /** Chunking config. */
  chunking?: ChunkConfig;
  /** Timeout (ms). */
  timeoutMs?: number;
}

// ==================== Error-recovery config ====================

/**
 * Error-recovery strategy config.
 */
export interface ErrorRecoveryStrategyConfig {
  /** Strategy id. */
  id: string;
  /** Whether enabled. */
  enabled?: boolean;
  /** Priority. */
  priority?: number;
  /** Applicable error categories. */
  categories?: ErrorCategory[];
  /** Applicable severities. */
  severities?: ErrorSeverity[];
}

/**
 * Error-recovery config.
 */
export interface ErrorRecoveryConfig {
  /** Retry config. */
  retry?: RetryConfig;
  /** Session-reset config. */
  sessionReset?: {
    /** Whether auto-reset is enabled. */
    autoResetEnabled?: boolean;
    /** Number of history records to archive. */
    archiveHistoryCount?: number;
  };
  /** Strategy config. */
  strategies?: ErrorRecoveryStrategyConfig[];
}

// ==================== Agent config ====================

/**
 * Agent model config.
 */
export interface AgentModelConfig {
  /** Primary model. */
  primary?: string;
  /** Fallback models. */
  fallbacks?: string[];
  /** Image model. */
  imageModel?: string;
}

/**
 * Agent tool config.
 */
export interface AgentToolConfig {
  /** Tool profile. */
  profile?: 'default' | 'minimal' | 'full' | string;
  /** Extra tools to allow. */
  alsoAllow?: string[];
  /** Tools to deny. */
  deny?: string[];
  /** Per-provider config. */
  byProvider?: Record<string, unknown>;
}

/**
 * Agent identity config.
 */
export interface AgentIdentityConfig {
  /** Name. */
  name?: string;
  /** Description. */
  description?: string;
  /** Avatar. */
  avatar?: string;
  /** System prompt. */
  systemPrompt?: string;
}

/**
 * Agent config.
 */
export interface AgentConfig {
  /** Agent id. */
  id?: string;
  /** Identity config. */
  identity?: AgentIdentityConfig;
  /** Model config. */
  model?: AgentModelConfig;
  /** Tool config. */
  tools?: AgentToolConfig;
  /** Session config. */
  session?: SessionConfig;
  /** Queue config. */
  queue?: QueueConfig;
  /** Typing config. */
  typing?: TypingConfig;
  /** Block-reply config. */
  blockReply?: BlockReplyConfig;
  /** Error-recovery config. */
  errorRecovery?: ErrorRecoveryConfig;
}

// ==================== Root config type ====================

/**
 * Top-level configuration.
 */
export interface TPCAIConfig {
  /** Metadata. */
  meta?: ConfigMeta;
  /** Model provider. */
  provider?: ProviderConfig;
  /** Memory backend. */
  memory?: MemoryConfig;
  /** Caller identity. */
  identity?: IdentityConfig;
  /** Default sub-configs applied to every agent. */
  defaults?: {
    /** Session config. */
    session?: SessionConfig;
    /** Queue config. */
    queue?: QueueConfig;
    /** Typing config. */
    typing?: TypingConfig;
    /** Block-reply config. */
    blockReply?: BlockReplyConfig;
    /** Error-recovery config. */
    errorRecovery?: ErrorRecoveryConfig;
    /** Timeout config. */
    timeout?: TimeoutConfig;
    /** Retry config. */
    retry?: RetryConfig;
  };
  /** Agent settings. */
  agent?: {
    /** Default agent id. */
    default?: string;
  };
  /** Agent list. */
  agents?: AgentConfig[];
  /** Environment variables. */
  env?: Record<string, string>;
  /** Custom extensions. */
  extensions?: Record<string, unknown>;
}

// ==================== Config file snapshot ====================

/**
 * A snapshot of the config file on disk.
 */
export interface ConfigFileSnapshot {
  /** File path. */
  path: string;
  /** Whether it exists. */
  exists: boolean;
  /** Raw contents. */
  raw: string | null;
  /** Parsed object. */
  parsed: unknown;
  /** Whether it is valid. */
  valid: boolean;
  /** Parsed config. */
  config: TPCAIConfig;
  /** Content hash. */
  hash: string;
  /** Validation issues. */
  issues: ConfigValidationIssue[];
  /** Warnings. */
  warnings: ConfigValidationIssue[];
}

// ==================== Defaults ====================

/**
 * Generic default config.
 *
 * Provider points at a local OpenAI-compatible endpoint, memory at a local
 * SQLite file, identity is single-user ('local'), and the default agent is
 * 'vin'. The per-agent sub-config defaults below are runtime tunables, not
 * deployment specifics.
 */
export const CONFIG_DEFAULTS: Required<
  Pick<TPCAIConfig, 'provider' | 'memory' | 'identity' | 'agent' | 'defaults'>
> = {
  provider: {
    provider: 'openai',
    baseUrl: process.env.TPC_AI_BASE_URL ?? '',
    model: process.env.TPC_AI_MODEL ?? 'gpt-4o-mini',
  },
  memory: {
    backend: 'sqlite',
    path: process.env.TPC_AI_MEMORY_PATH ?? './tpc-ai.memory.sqlite',
  },
  identity: {
    userId: 'local',
  },
  agent: {
    default: 'vin',
  },
  defaults: {
    session: {
      persistence: {
        enabled: true,
        cacheEnabled: true,
        cacheTtlMs: 45000,
        cacheMaxEntries: 1000,
      },
      scope: {
        scope: 'per-sender',
        dmScope: 'per-peer',
      },
      cleanup: {
        idleTimeoutMs: 30 * 60 * 1000, // 30 minutes
        maxSessions: 1000,
        cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
      },
    },
    queue: {
      mode: 'followup',
      capacity: 10,
      dropPolicy: 'old',
      dedupeMode: 'exact',
      drainDelayMs: 100,
    },
    typing: {
      mode: 'thinking',
      intervalSeconds: 4,
      ttlMs: 6000,
      groupMode: 'message',
    },
    blockReply: {
      coalescing: {
        enabled: true,
        minChars: 50,
        maxChars: 1000,
        idleMs: 300,
      },
      chunking: {
        limit: 2000,
        mode: 'length',
        breakPreference: 'paragraph',
      },
      timeoutMs: 60000,
    },
    errorRecovery: {
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffFactor: 2,
        jitter: 0.1,
      },
      sessionReset: {
        autoResetEnabled: true,
        archiveHistoryCount: 5,
      },
    },
    timeout: {
      defaultMs: 30000,
      connectionMs: 10000,
      readMs: 60000,
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffFactor: 2,
      jitter: 0.1,
    },
  },
};
