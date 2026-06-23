/**
 * Ollama native provider.
 *
 * Talks to Ollama's native HTTP API (`/api/chat`, `/api/embed`, `/api/tags`) instead
 * of the OpenAI-compatible compatibility shim. Why prefer this over the
 * OpenAI-compatible adapter when Ollama is your runtime?
 *
 *  1. `keep_alive`             — keep models loaded in VRAM between calls (no warm-up cost).
 *  2. `num_ctx` / `num_predict`— per-call context-window / output overrides without
 *                                bouncing the model.
 *  3. Native tool calling       — Ollama emits proper structured `tool_calls`
 *                                (no JSON-mode hacking) on supported models.
 *  4. `/api/tags`               — list installed local models (drives the catalog
 *                                instead of a hand-maintained list).
 *  5. No `Authorization` header — small simplification when on a fully air-gapped LAN.
 *
 * This file mirrors the shape of `openai.ts` so adding Ollama is a registry
 * tweak rather than a runtime change. Imports only `fetch`.
 *
 * @module providers/ollama
 */

import type {
  AgentMessage,
  AgentToolCall,
  AgentToolResult,
} from '../types.js';
import type {
  LLMProvider,
  ProviderId,
  ModelInfo,
  GenerateParams,
  GenerateResult,
  ProviderErrorType,
} from './types.js';
import { ProviderError } from './types.js';

// ============================================================
// Config (env-driven; never hard-coded)
// ============================================================

/** Base URL for Ollama. Defaults to a local install. */
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
/** Default model id (Ollama tag format, e.g. `qwen2.5:14b`). */
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';
/**
 * How long Ollama should keep the model resident after the request.
 *  - '5m'   (default) good for interactive
 *  - '24h'  keep hot all day for an always-on agent
 *  - '0'    unload immediately to free VRAM
 *  - '-1'   keep forever
 */
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE ?? '5m';

/**
 * Curated catalog of on-prem models that VIN officially tunes for.
 *
 * IMPORTANT: at runtime the provider also calls `/api/tags` to discover any
 * additional models you've pulled locally and merges them into this list.
 * Adding a new model to your Ollama install means it just shows up — no code
 * change required.
 */
export const OLLAMA_MODELS_BUILTIN: ModelInfo[] = [
  // ============ Qwen — primary recommendation ============
  {
    id: 'qwen2.5:7b',
    provider: 'ollama',
    contextWindow: 32_768,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'fast',
    description: 'Qwen2.5 7B — fast, strong tool-calling. ~5GB VRAM at Q4_K_M.',
  },
  {
    id: 'qwen2.5:14b',
    provider: 'ollama',
    contextWindow: 32_768,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'balanced',
    description: 'Qwen2.5 14B — VIN-AIOS default; sweet spot for agent + tool-use.',
  },
  {
    id: 'qwen2.5:32b',
    provider: 'ollama',
    contextWindow: 32_768,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'powerful',
    description: 'Qwen2.5 32B — best tool-use under 70B.',
  },
  {
    id: 'qwen2.5:72b',
    provider: 'ollama',
    contextWindow: 131_072,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'powerful',
    description: 'Qwen2.5 72B — near-frontier; 128k context.',
  },

  // ============ Nemotron — NVIDIA reasoning-tuned ============
  {
    id: 'nemotron:70b',
    provider: 'ollama',
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsReasoning: true,
    reasoningLevels: ['none', 'low', 'medium', 'high'],
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'powerful',
    description: 'Llama-3.1-Nemotron 70B — NVIDIA reasoning-tuned.',
  },
  {
    id: 'nemotron-mini:4b',
    provider: 'ollama',
    contextWindow: 4_096,
    maxOutput: 2_048,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'fast',
    description: 'Nemotron Mini 4B — function-calling on edge / CPU.',
  },

  // ============ Gemma — Google open-weight ============
  {
    id: 'gemma2:9b',
    provider: 'ollama',
    contextWindow: 8_192,
    maxOutput: 4_096,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'fast',
    description: 'Gemma 2 9B — small + strong general knowledge.',
  },
  {
    id: 'gemma2:27b',
    provider: 'ollama',
    contextWindow: 8_192,
    maxOutput: 4_096,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'balanced',
    description: 'Gemma 2 27B — best Gemma chat quality below 70B.',
  },
  {
    id: 'gemma3:12b',
    provider: 'ollama',
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'balanced',
    description: 'Gemma 3 12B — multimodal (text + image), 128k context.',
  },
];

/** Default model id (mirrors OLLAMA_MODEL; kept as a named export for callers). */
export const DEFAULT_OLLAMA_MODEL = OLLAMA_MODEL;

/** HTTP status -> normalized error category. */
export const OLLAMA_ERROR_CODES: Record<number, string> = {
  400: 'invalid_request',
  404: 'not_found',
  500: 'server_error',
  502: 'server_error',
  503: 'server_error',
};

/** Whether an HTTP status is worth retrying. */
export function isRetryableOllamaError(statusCode: number): boolean {
  return [500, 502, 503].includes(statusCode);
}

// ============================================================
// Message formatting (Ollama native chat shape)
// ============================================================
//
// Ollama's `/api/chat` accepts the same {role, content, tool_calls, tool_call_id}
// shape as OpenAI Chat Completions — but is far stricter about pairing tool
// results to the prior assistant turn. We compute deterministic per-turn ids
// (the same scheme `openai.ts` uses) so the two providers behave identically.

function stringifyToolResult(r: AgentToolResult | undefined, fallback: string): string {
  if (!r) return fallback ?? '';
  const anyR = r as any;
  if (typeof anyR.success === 'boolean') {
    if (anyR.success) {
      return typeof anyR.data === 'string' ? anyR.data : JSON.stringify(anyR.data ?? {});
    }
    return anyR.error ? `Error: ${anyR.error}` : 'Error';
  }
  if (anyR.content) {
    if (Array.isArray(anyR.content)) {
      return anyR.content.map((c: any) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c))).join('\n');
    }
    return String(anyR.content);
  }
  return fallback ?? '';
}

export function formatMessagesForOllama(messages: AgentMessage[]): any[] {
  const out: any[] = [];
  let lastToolCallIds: string[] = [];

  messages.forEach((msg, turnIdx) => {
    const calls: AgentToolCall[] | undefined =
      msg.role === 'assistant'
        ? (msg.toolCalls && msg.toolCalls.length > 0
            ? msg.toolCalls
            : (msg.toolCall ? [msg.toolCall] : undefined))
        : undefined;

    if (calls && calls.length > 0) {
      const ids = calls.map((_, i) => `call_${turnIdx}_${i}`);
      lastToolCallIds = ids;
      out.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: calls.map((tc, i) => ({
          id: ids[i],
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments ?? {} },
        })),
      });
      return;
    }

    if (msg.role === 'tool') {
      const results: (AgentToolResult | undefined)[] =
        msg.toolResults && msg.toolResults.length > 0
          ? msg.toolResults
          : (msg.toolResult ? [msg.toolResult] : []);
      const n = lastToolCallIds.length;
      if (n > 0) {
        for (let i = 0; i < n; i++) {
          const content =
            results[i] !== undefined
              ? stringifyToolResult(results[i], msg.content)
              : i === 0 ? (msg.content ?? '') : '';
          out.push({ role: 'tool', tool_call_id: lastToolCallIds[i], content: content ?? '' });
        }
        lastToolCallIds = [];
        return;
      }
      out.push({ role: 'user', content: msg.content });
      return;
    }

    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    out.push({ role, content: msg.content });
  });

  return out;
}

// ============================================================
// Provider implementation
// ============================================================

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, any> | string };
    }>;
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    model: string;
    size: number;
    details?: {
      parameter_size?: string;
      family?: string;
      quantization_level?: string;
    };
  }>;
}

/**
 * Ollama native provider.
 *
 * Implements LLMProvider over Ollama's native /api/chat endpoint. Discovers
 * locally-installed models via /api/tags on first call.
 */
export class OllamaProvider implements LLMProvider {
  readonly id: ProviderId = 'ollama';
  readonly name = 'Ollama (local)';

  private baseUrl: string;
  private keepAlive: string;
  /** Local models discovered via /api/tags; merged on top of the builtin catalog. */
  private discoveredModels: ModelInfo[] = [];
  private discoveryDone = false;

  constructor(baseUrl?: string, keepAlive?: string) {
    this.baseUrl = baseUrl ?? OLLAMA_BASE_URL;
    this.keepAlive = keepAlive ?? OLLAMA_KEEP_ALIVE;
  }

  /** Available if the daemon answers /api/tags. */
  isAvailable(): boolean {
    // We can't synchronously probe HTTP; treat 'local Ollama URL set' as available.
    // The first generateContent call will surface real connectivity errors.
    return !!this.baseUrl;
  }

  async generateContent(params: GenerateParams): Promise<GenerateResult> {
    const {
      messages,
      systemPrompt,
      model: modelId,
      tools,
      temperature,
      maxOutputTokens,
      stopSequences,
      responseMimeType,
      responseJsonSchema,
    } = params;

    const model = modelId || DEFAULT_OLLAMA_MODEL;

    const ollamaMessages: any[] = [
      { role: 'system', content: systemPrompt },
      ...formatMessagesForOllama(messages),
    ];

    const requestBody: any = {
      model,
      messages: ollamaMessages,
      stream: false,
      keep_alive: this.keepAlive,
      options: {},
    };

    if (temperature !== undefined) requestBody.options.temperature = temperature;
    if (maxOutputTokens !== undefined) requestBody.options.num_predict = maxOutputTokens;
    if (stopSequences && stopSequences.length > 0) requestBody.options.stop = stopSequences;

    if (tools && tools.length > 0) {
      requestBody.tools = tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    // Ollama supports JSON-mode via `format: 'json'` or a JSON schema.
    if (responseJsonSchema) {
      requestBody.format = responseJsonSchema;
    } else if (responseMimeType === 'application/json') {
      requestBody.format = 'json';
    }

    try {
      console.log(`[OllamaProvider] Calling ${model} (keep_alive=${this.keepAlive})`);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleHttpError(response.status, errorData);
      }

      const data: OllamaChatResponse = await response.json();
      const text = data.message?.content || '';
      const rawCalls = data.message?.tool_calls ?? [];

      if (!text && rawCalls.length === 0) {
        throw new ProviderError('Empty response from Ollama', 'ollama', 'server_error', 500, true);
      }

      const usage = (data.prompt_eval_count !== undefined || data.eval_count !== undefined) ? {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      } : undefined;

      const toolCalls = rawCalls.map(tc => ({
        name: tc.function.name,
        arguments: typeof tc.function.arguments === 'string'
          ? safeJsonParse(tc.function.arguments)
          : (tc.function.arguments ?? {}),
      }));

      return {
        text,
        provider: 'ollama',
        model,
        usage,
        finishReason: toolCalls.length > 0
          ? 'tool_calls'
          : this.mapDoneReason(data.done_reason),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error: any) {
      if (error instanceof ProviderError) throw error;
      throw this.handleError(error);
    }
  }

  /**
   * Discover locally-installed models via /api/tags. Synthesises ModelInfo for
   * anything not already in the builtin catalog so user-pulled fine-tunes work
   * out of the box.
   */
  async discoverModels(): Promise<ModelInfo[]> {
    if (this.discoveryDone) return this.discoveredModels;
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data: OllamaTagsResponse = await response.json();
      const builtinIds = new Set(OLLAMA_MODELS_BUILTIN.map(m => m.id));
      const extras: ModelInfo[] = (data.models ?? [])
        .filter(m => !builtinIds.has(m.name))
        .map(m => ({
          id: m.name,
          provider: 'ollama' as ProviderId,
          contextWindow: 32_768, // sane default; user can override per-call via num_ctx
          maxOutput: 8_192,
          supportsReasoning: false,
          costPer1MInput: 0,
          costPer1MOutput: 0,
          tier: 'balanced' as const,
          description: `Locally installed via Ollama (family=${m.details?.family ?? 'unknown'}, params=${m.details?.parameter_size ?? '?'}, quant=${m.details?.quantization_level ?? '?'}).`,
        }));
      this.discoveredModels = extras;
      this.discoveryDone = true;
      if (extras.length > 0) {
        console.log(`[OllamaProvider] Discovered ${extras.length} extra local model(s): ${extras.map(m => m.id).join(', ')}`);
      }
      return extras;
    } catch (e) {
      console.warn(`[OllamaProvider] /api/tags discovery failed: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * Generate an embedding via Ollama's /api/embed. The memory subsystem's
   * embed.ts seam delegates here.
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    const embedModel = model ?? process.env.EMBEDDING_MODEL ?? 'nomic-embed-text';
    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: embedModel, input: text }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleHttpError(response.status, errorData);
      }
      const data = await response.json() as { embeddings: number[][] };
      const vec = data.embeddings?.[0];
      if (!vec || vec.length === 0) {
        throw new ProviderError(`Empty embedding from Ollama for model ${embedModel}`, 'ollama', 'server_error', 500, true);
      }
      return vec;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw this.handleError(e);
    }
  }

  getModels(): ModelInfo[] {
    return [...OLLAMA_MODELS_BUILTIN, ...this.discoveredModels];
  }

  getDefaultModel(): ModelInfo {
    return this.getModel(DEFAULT_OLLAMA_MODEL) ?? OLLAMA_MODELS_BUILTIN[0];
  }

  getModel(modelId: string): ModelInfo | undefined {
    return this.getModels().find(m => m.id === modelId);
  }

  async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private mapDoneReason(reason?: string): GenerateResult['finishReason'] {
    switch (reason) {
      case 'stop': return 'stop';
      case 'length': return 'length';
      case 'load': return 'stop';
      default: return undefined;
    }
  }

  private handleHttpError(statusCode: number, errorData: any): ProviderError {
    const errorType = (OLLAMA_ERROR_CODES[statusCode] as ProviderErrorType) || 'unknown';
    const retryable = isRetryableOllamaError(statusCode);
    const message = errorData?.error || `Ollama API error: ${statusCode}`;
    return new ProviderError(message, 'ollama', errorType, statusCode, retryable);
  }

  private handleError(error: any): ProviderError {
    if (error.name === 'TypeError' && error.message?.includes('fetch')) {
      return new ProviderError(
        `Network error connecting to Ollama at ${this.baseUrl}. Is the daemon running?`,
        'ollama', 'network', undefined, true, error,
      );
    }
    return new ProviderError(error.message || 'Unknown Ollama error', 'ollama', 'unknown', undefined, false, error);
  }
}

function safeJsonParse(s: string): Record<string, any> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** Create an Ollama native provider instance. */
export function createOllamaProvider(baseUrl?: string, keepAlive?: string): OllamaProvider {
  return new OllamaProvider(baseUrl, keepAlive);
}
