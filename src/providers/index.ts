/**
 * Providers module — public surface.
 *
 * Types, the registry singleton, and the OpenAI-compatible provider. The harness
 * above this layer is provider-agnostic: to add Gemini/Anthropic/etc., implement
 * LLMProvider and register it in initializeProviders().
 *
 * @module providers
 */

// ============================================================
// Types
// ============================================================

export type {
  ProviderId,
  ReasoningLevel,
  ReasoningConfig,
  ModelTier,
  ModelInfo,
  ToolParameterSchema,
  ToolDefinition,
  GenerateParams,
  TokenUsage,
  GenerateResult,
  LLMProvider,
  ProviderErrorType,
} from './types.js';

export {
  ProviderError,
  isValidReasoningLevel,
  getDefaultReasoningConfig,
  compareReasoningLevels,
} from './types.js';

// ============================================================
// Registry
// ============================================================

export {
  ProviderRegistry,
  providerRegistry,
  getProviderRegistry,
  initializeProviders,
} from './registry.js';

export type { ProviderRegistryStatus } from './registry.js';

// ============================================================
// OpenAI-compatible provider
// ============================================================

export { OpenAIProvider, createOpenAIProvider } from './openai.js';
export {
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
  OPENAI_MODELS,
  DEFAULT_OPENAI_MODEL,
  REASONING_EFFORT_MAP,
  toOpenAIReasoningEffort,
  isValidOpenAIModel,
  getOpenAIModel,
  getDefaultOpenAIModel,
  isRetryableOpenAIError,
} from './openai.js';

// ============================================================
// Gemini provider (optional, opt-in)
// ============================================================

export { GeminiProvider, createGeminiProvider } from './gemini.js';
export {
  GEMINI_API_KEY,
  GEMINI_BASE_URL,
  GEMINI_MODEL,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
} from './gemini.js';

// ============================================================
// Ollama native provider (on-prem default)
// ============================================================

export { OllamaProvider, createOllamaProvider } from './ollama.js';
export {
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_MODELS_BUILTIN,
  DEFAULT_OLLAMA_MODEL,
  isRetryableOllamaError,
} from './ollama.js';
