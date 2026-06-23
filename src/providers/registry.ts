/**
 * Provider registry.
 *
 * Owns registration, lookup, and the lifecycle of every LLM provider. A single
 * shared instance (`providerRegistry`) is the one place the harness asks "which
 * providers/models exist and which are usable right now".
 *
 * @module providers/registry
 */

import type {
  LLMProvider,
  ProviderId,
  ModelInfo,
  ReasoningLevel,
} from './types.js';

/**
 * Provider registry.
 *
 * Singleton-style holder for all provider instances.
 */
export class ProviderRegistry {
  private providers: Map<ProviderId, LLMProvider> = new Map();
  private initialized: boolean = false;

  /** Register a provider (replaces an existing one with the same id). */
  register(provider: LLMProvider): void {
    if (this.providers.has(provider.id)) {
      console.warn(`[ProviderRegistry] Provider ${provider.id} already registered, replacing...`);
    }
    this.providers.set(provider.id, provider);
    console.log(`[ProviderRegistry] Registered provider: ${provider.name} (${provider.id})`);
  }

  /** Unregister a provider. */
  unregister(id: ProviderId): boolean {
    const removed = this.providers.delete(id);
    if (removed) {
      console.log(`[ProviderRegistry] Unregistered provider: ${id}`);
    }
    return removed;
  }

  /** Get a provider by id. */
  get(id: ProviderId): LLMProvider | undefined {
    return this.providers.get(id);
  }

  /** Get all registered providers. */
  getAll(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  /** Get all usable providers (API key present). */
  getAvailable(): LLMProvider[] {
    return this.getAll().filter(p => p.isAvailable());
  }

  /** Get the ids of all usable providers. */
  getAvailableIds(): ProviderId[] {
    return this.getAvailable().map(p => p.id);
  }

  /** Whether a provider is registered. */
  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  /** Whether a provider is registered and usable. */
  isAvailable(id: ProviderId): boolean {
    const provider = this.providers.get(id);
    return provider?.isAvailable() ?? false;
  }

  /** Get every model across all providers. */
  getAllModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const provider of this.providers.values()) {
      models.push(...provider.getModels());
    }
    return models;
  }

  /** Get every model across the usable providers. */
  getAvailableModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const provider of this.getAvailable()) {
      models.push(...provider.getModels());
    }
    return models;
  }

  /** Find a model (and its provider) by model id. */
  findModel(modelId: string): { provider: LLMProvider; model: ModelInfo } | undefined {
    for (const provider of this.providers.values()) {
      const model = provider.getModel(modelId);
      if (model) {
        return { provider, model };
      }
    }
    return undefined;
  }

  /** Find the provider that owns a given model id. */
  findProviderByModel(modelId: string): LLMProvider | undefined {
    return this.findModel(modelId)?.provider;
  }

  /** Get usable models that support a given reasoning level. */
  getModelsWithReasoning(level: ReasoningLevel): ModelInfo[] {
    return this.getAvailableModels().filter(m =>
      m.supportsReasoning &&
      m.reasoningLevels?.includes(level)
    );
  }

  /** Get usable models in a given tier. */
  getModelsByTier(tier: ModelInfo['tier']): ModelInfo[] {
    return this.getAvailableModels().filter(m => m.tier === tier);
  }

  /** Number of registered providers. */
  get size(): number {
    return this.providers.size;
  }

  /** Clear all registrations. */
  clear(): void {
    this.providers.clear();
    this.initialized = false;
    console.log('[ProviderRegistry] Cleared all providers');
  }

  /** Mark the registry as initialized. */
  markInitialized(): void {
    this.initialized = true;
  }

  /** Whether the registry has been initialized. */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** A snapshot of registry state, for logging/diagnostics. */
  getStatus(): ProviderRegistryStatus {
    const providers = this.getAll().map(p => ({
      id: p.id,
      name: p.name,
      available: p.isAvailable(),
      modelCount: p.getModels().length,
      defaultModel: p.getDefaultModel().id,
    }));

    return {
      initialized: this.initialized,
      totalProviders: this.size,
      availableProviders: this.getAvailable().length,
      totalModels: this.getAllModels().length,
      availableModels: this.getAvailableModels().length,
      providers,
    };
  }
}

/** Registry state snapshot. */
export interface ProviderRegistryStatus {
  initialized: boolean;
  totalProviders: number;
  availableProviders: number;
  totalModels: number;
  availableModels: number;
  providers: Array<{
    id: ProviderId;
    name: string;
    available: boolean;
    modelCount: number;
    defaultModel: string;
  }>;
}

/** The global provider registry singleton. */
export const providerRegistry = new ProviderRegistry();

/** Get the global provider registry. */
export function getProviderRegistry(): ProviderRegistry {
  return providerRegistry;
}

/**
 * Initialize providers and register them with the global registry.
 * Call once at startup.
 *
 * VIN-AIOS on-prem ordering:
 *  1. Ollama native — registered first, the recommended default
 *  2. OpenAI-compatible — handles vLLM / LM Studio / llama.cpp / OpenAI cloud
 *  3. Gemini — opt-in, only when GEMINI_API_KEY is set (kept off by default)
 *
 * Selection at runtime is controlled by `HARNESS_PROVIDER` (env) or
 * `provider:` on an `AgentDefinition`. Default: 'ollama' for a clean on-prem
 * boot, 'openai' if `OPENAI_API_KEY` is set (cloud or self-hosted compat),
 * 'gemini' only if explicitly chosen.
 */
export function initializeProviders(): void {
  if (providerRegistry.isInitialized()) {
    console.log('[Providers] Already initialized, skipping...');
    return;
  }

  console.log('[Providers] Initializing providers (on-prem first)...');

  // (1) Native Ollama — always registered (the on-prem default).
  providerRegistry.register(createOllamaProvider());

  // (2) OpenAI-compatible — covers vLLM, LM Studio, llama.cpp, TGI, cloud OpenAI.
  providerRegistry.register(createOpenAIProvider());

  // (3) Gemini — opt-in cloud. Off unless GEMINI_API_KEY is explicitly set.
  if (process.env.GEMINI_API_KEY) {
    providerRegistry.register(createGeminiProvider());
    console.log('[Providers] Gemini provider enabled (cloud burst mode).');
  }

  providerRegistry.markInitialized();

  const status = providerRegistry.getStatus();
  console.log(`[Providers] Initialized: ${status.availableProviders}/${status.totalProviders} providers available`);
  for (const p of status.providers) {
    const statusIcon = p.available ? 'ok' : 'unavailable';
    console.log(`  [${statusIcon}] ${p.name} (${p.id}): ${p.modelCount} models, default: ${p.defaultModel}`);
  }
}

import { createOpenAIProvider } from './openai.js';
import { createGeminiProvider } from './gemini.js';
import { createOllamaProvider } from './ollama.js';
