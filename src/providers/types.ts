/**
 * Provider abstraction layer — type definitions.
 *
 * One uniform interface every LLM provider implements. The harness above this
 * layer is provider-agnostic: it speaks `GenerateParams` in and `GenerateResult`
 * out, and never imports a vendor SDK directly.
 *
 * @module providers/types
 */

import type { AgentMessage, ProviderId, ReasoningLevel } from '../types.js';

// Re-export the core ids/levels so consumers can pull everything from one place.
export type { ProviderId, ReasoningLevel };

// ============================================================
// Reasoning config (unifies provider-specific reasoning knobs)
// ============================================================

/**
 * Unified reasoning config.
 *
 * Each provider maps `level` onto its own knob (e.g. OpenAI's reasoning.effort).
 * `xhigh` is OpenAI-only; other providers degrade it to their max.
 */
export interface ReasoningConfig {
  /** Whether reasoning is enabled at all. */
  enabled: boolean;
  /** Reasoning strength. */
  level: ReasoningLevel;
}

// ============================================================
// Model info
// ============================================================

/** Coarse capability tier, used to pick a model by intent rather than by id. */
export type ModelTier = 'fast' | 'balanced' | 'powerful';

/** Static facts about a model, surfaced for routing, costing, and display. */
export interface ModelInfo {
  /** Model id (e.g. 'gpt-5.4-mini'). */
  id: string;
  /** Owning provider. */
  provider: ProviderId;
  /** Context window size (tokens). */
  contextWindow: number;
  /** Max output length (tokens). */
  maxOutput: number;
  /** Whether the model supports reasoning. */
  supportsReasoning: boolean;
  /** Supported reasoning levels (provider-specific strings). */
  reasoningLevels?: string[];
  /** Input price (USD per 1M tokens). */
  costPer1MInput: number;
  /** Output price (USD per 1M tokens). */
  costPer1MOutput: number;
  /** Capability tier. */
  tier: ModelTier;
  /** Knowledge cutoff date. */
  knowledgeCutoff?: string;
  /** Human-readable description. */
  description?: string;
}

// ============================================================
// Tool definition (provider-agnostic)
// ============================================================

/** Tool parameter schema, as passed to a provider's function-calling API. */
export interface ToolParameterSchema {
  type: string;
  description?: string;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  items?: ToolParameterSchema;
  enum?: string[];
  default?: any;
}

/** Tool definition handed to a provider for native function calling. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

// ============================================================
// Generate params & result
// ============================================================

/** A single generation request. */
export interface GenerateParams {
  /** Conversation messages. */
  messages: AgentMessage[];
  /** System prompt. */
  systemPrompt: string;
  /** Model id. */
  model: string;
  /** Reasoning config. */
  reasoning?: ReasoningConfig;
  /** Tools available for native function calling. */
  tools?: ToolDefinition[];
  /** Temperature (0-2). */
  temperature?: number;
  /** Max output tokens. */
  maxOutputTokens?: number;
  /** Stop sequences. */
  stopSequences?: string[];
  /**
   * Response MIME type (e.g. 'application/json').
   * Set to 'application/json' to force JSON output.
   */
  responseMimeType?: string;
  /**
   * Response JSON schema (structured output).
   * Used together with responseMimeType 'application/json' to force the model
   * to emit JSON matching the given schema.
   */
  responseJsonSchema?: Record<string, any>;
}

/** Token usage stats for one generation. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Reasoning tokens, if reported. */
  reasoningTokens?: number;
  /** Input tokens served from prompt cache, if reported (for hit-rate observability). */
  cachedTokens?: number;
}

/** Result of one generation. */
export interface GenerateResult {
  /** Generated text. */
  text: string;
  /** Provider that produced this. */
  provider: ProviderId;
  /** Model that produced this. */
  model: string;
  /** Reasoning info. */
  reasoning?: {
    level: ReasoningLevel;
    /** Whether reasoning was actually applied. */
    used: boolean;
  };
  /** Token usage stats. */
  usage?: TokenUsage;
  /** Completion reason. */
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  /** Native tool calls, if any. */
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
    /**
     * Opaque reasoning signature carried back to the model unchanged across
     * turns. Provider-specific; some providers require it on function calls.
     */
    thoughtSignature?: string;
  }>;
  /** Opaque reasoning signature for the final text turn (non-tool-call), if any. */
  textThoughtSignature?: string;
}

// ============================================================
// Provider interface
// ============================================================

/**
 * The uniform LLM provider contract.
 *
 * Every provider implements this. The agent runtime depends only on this
 * interface — never on a concrete provider.
 */
export interface LLMProvider {
  /** Provider id. */
  readonly id: ProviderId;
  /** Provider display name. */
  readonly name: string;

  /** Whether the provider is usable (API key present). */
  isAvailable(): boolean;

  /** Generate content. */
  generateContent(params: GenerateParams): Promise<GenerateResult>;

  /** List supported models. */
  getModels(): ModelInfo[];

  /** Get the default model. */
  getDefaultModel(): ModelInfo;

  /** Look up a model by id. */
  getModel(modelId: string): ModelInfo | undefined;

  /** Validate the API key (optional). */
  validateApiKey?(): Promise<boolean>;
}

// ============================================================
// Provider errors
// ============================================================

/** Normalized provider error categories (mapped from HTTP status etc.). */
export type ProviderErrorType =
  | 'rate_limit'      // 429
  | 'auth'            // 401, 403
  | 'billing'         // 402
  | 'not_found'       // 404
  | 'server_error'    // 500-599
  | 'timeout'         // request timed out
  | 'network'         // network error
  | 'invalid_request' // 400
  | 'content_filter'  // content filtered
  | 'unknown';        // unknown

/** A normalized provider error. Carries enough to drive retry/fallback decisions. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderId,
    public readonly errorType: ProviderErrorType,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

// ============================================================
// Helpers
// ============================================================

/** Type guard for a valid ReasoningLevel string. */
export function isValidReasoningLevel(level: string): level is ReasoningLevel {
  return ['none', 'low', 'medium', 'high', 'xhigh'].includes(level);
}

/** Default reasoning config. */
export function getDefaultReasoningConfig(): ReasoningConfig {
  return {
    enabled: true,
    level: 'low',
  };
}

/**
 * Compare two ReasoningLevels by strength.
 * Returns -1 (a < b), 0 (a == b), or 1 (a > b).
 */
export function compareReasoningLevels(a: ReasoningLevel, b: ReasoningLevel): number {
  const order: ReasoningLevel[] = ['none', 'low', 'medium', 'high', 'xhigh'];
  return order.indexOf(a) - order.indexOf(b);
}
