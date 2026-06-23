/**
 * OpenAI-compatible provider.
 *
 * Talks to any OpenAI Chat Completions endpoint — the official API, a local
 * Ollama server, vLLM, LM Studio, etc. — by varying OPENAI_BASE_URL/OPENAI_MODEL.
 * The default base URL points at a local Ollama, so the demo runs with no cloud
 * key at all.
 *
 * This single file consolidates config, message formatting, and the provider
 * implementation. It implements the provider-agnostic LLMProvider contract and
 * imports no vendor SDK — just `fetch`.
 *
 * @module providers/openai
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
  ReasoningLevel,
  GenerateParams,
  GenerateResult,
  ProviderErrorType,
} from './types.js';
import { ProviderError } from './types.js';

// ============================================================
// Config (env-driven; no literal key fallbacks)
// ============================================================

/** API key. Empty when talking to a local server that needs none. */
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
/** Base URL. Defaults to a local Ollama OpenAI-compatible endpoint. */
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? 'http://localhost:11434/v1';
/** Default model id. */
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'qwen2.5:14b';

/**
 * Model catalog for the OpenAI-compatible provider.
 *
 * On-premise focus: every entry below is meant to run locally via Ollama, vLLM,
 * LM Studio, llama.cpp, or TGI. Costs are 0 — the harness still tracks token
 * usage so you can monitor throughput, but spend is irrelevant for self-hosted.
 *
 * Naming convention follows Ollama tags (e.g. `qwen2.5:14b`). If you point at
 * vLLM or another runtime that uses different ids, just edit these strings or
 * add new entries; the runtime never hard-codes a model id.
 *
 * Function-calling support varies per model — when in doubt, see
 * docs/01-model-selection.md.
 */
export const OPENAI_MODELS: ModelInfo[] = [
  // ============ Qwen family — strong tool-use, recommended default ============
  {
    id: 'qwen2.5:7b',
    provider: 'openai',
    contextWindow: 32_768,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'fast',
    description: 'Qwen2.5 7B — fastest Qwen, good tool-calling, ~16GB VRAM at FP16 / ~5GB at Q4.',
  },
  {
    id: 'qwen2.5:14b',
    provider: 'openai',
    contextWindow: 32_768,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'balanced',
    description: 'Qwen2.5 14B — recommended default for VIN. Strong native function-calling.',
  },
  {
    id: 'qwen2.5:32b',
    provider: 'openai',
    contextWindow: 32_768,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'powerful',
    description: 'Qwen2.5 32B — best tool-use in the 32B class. Needs ~24GB VRAM at Q4.',
  },
  {
    id: 'qwen2.5:72b',
    provider: 'openai',
    contextWindow: 131_072,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'powerful',
    description: 'Qwen2.5 72B — near-frontier; 128k context. ~48GB VRAM at Q4.',
  },
  {
    id: 'qwen2.5-coder:32b',
    provider: 'openai',
    contextWindow: 32_768,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'powerful',
    description: 'Qwen2.5 Coder 32B — code-specialised; pair with delegate_to_agent for code tasks.',
  },

  // ============ Nemotron family (NVIDIA) — enterprise reasoning ============
  {
    id: 'nemotron:70b',
    provider: 'openai',
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsReasoning: true,
    reasoningLevels: ['none', 'low', 'medium', 'high'],
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'powerful',
    description: 'Llama-3.1-Nemotron 70B — NVIDIA reasoning-tuned; excels at long-chain analysis.',
  },
  {
    id: 'nemotron-mini:4b',
    provider: 'openai',
    contextWindow: 4_096,
    maxOutput: 2_048,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'fast',
    description: 'Nemotron Mini 4B — tuned for function-calling on edge / CPU.',
  },

  // ============ Gemma family (Google open) — multimodal + safe ============
  {
    id: 'gemma2:9b',
    provider: 'openai',
    contextWindow: 8_192,
    maxOutput: 4_096,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'fast',
    description: 'Gemma 2 9B — Google open-weight, small footprint, strong general knowledge.',
  },
  {
    id: 'gemma2:27b',
    provider: 'openai',
    contextWindow: 8_192,
    maxOutput: 4_096,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'balanced',
    description: 'Gemma 2 27B — best Gemma chat quality below 70B class.',
  },
  {
    id: 'gemma3:12b',
    provider: 'openai',
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsReasoning: false,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'balanced',
    description: 'Gemma 3 12B — multimodal (text + image), 128k context.',
  },

];

/**
 * If the env-supplied OPENAI_MODEL is not in the catalog above (e.g. you're
 * pointing at a custom fine-tune via vLLM), synthesise a permissive entry so
 * the runtime accepts it. Keeps the harness extensible without forcing a code
 * change just to try a new model id.
 */
function ensureCatalogEntryFor(modelId: string): void {
  if (!modelId) return;
  if (OPENAI_MODELS.some(m => m.id === modelId)) return;
  OPENAI_MODELS.push({
    id: modelId,
    provider: 'openai',
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsReasoning: true,
    reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh'],
    costPer1MInput: 0,
    costPer1MOutput: 0,
    tier: 'balanced',
    description: `User-specified model "${modelId}" (synthesised catalog entry).`,
  });
}
ensureCatalogEntryFor(OPENAI_MODEL);

/** Default model id (mirrors OPENAI_MODEL; kept as a named export for callers). */
export const DEFAULT_OPENAI_MODEL = OPENAI_MODEL;

/** Maps the unified ReasoningLevel onto OpenAI's reasoning.effort. */
export const REASONING_EFFORT_MAP: Record<ReasoningLevel, string> = {
  none: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
};

/** Convert a unified ReasoningLevel to an OpenAI reasoning.effort string. */
export function toOpenAIReasoningEffort(level: ReasoningLevel): string {
  return REASONING_EFFORT_MAP[level] || 'medium';
}

/** Whether `modelId` is in the catalog. */
export function isValidOpenAIModel(modelId: string): boolean {
  return OPENAI_MODELS.some(m => m.id === modelId);
}

/** Look up a model by id. */
export function getOpenAIModel(modelId: string): ModelInfo | undefined {
  return OPENAI_MODELS.find(m => m.id === modelId);
}

/** Get the default model info. */
export function getDefaultOpenAIModel(): ModelInfo {
  return OPENAI_MODELS.find(m => m.id === DEFAULT_OPENAI_MODEL) || OPENAI_MODELS[0];
}

/** HTTP status -> normalized error category. */
export const OPENAI_ERROR_CODES: Record<number, string> = {
  400: 'invalid_request',
  401: 'auth',
  402: 'billing',
  403: 'auth',
  404: 'not_found',
  429: 'rate_limit',
  500: 'server_error',
  502: 'server_error',
  503: 'server_error',
};

/** Whether an HTTP status is worth retrying. */
export function isRetryableOpenAIError(statusCode: number): boolean {
  return [429, 500, 502, 503].includes(statusCode);
}

// ============================================================
// Message formatting (pure, offline-testable)
// ============================================================
//
// Converts the harness's provider-agnostic AgentMessage[] into the OpenAI Chat
// Completions `messages` shape. The subtle parts (which is where most
// cross-provider 400s come from):
//  - Parallel `toolCalls[]` and the single `toolCall` both map to an assistant
//    `tool_calls[]`, using a deterministic per-turn id (`call_<turnIdx>_<i>`) so
//    same-named tools in one turn don't collide.
//  - A `role:'tool'` turn's parallel `toolResults[]` (or single `toolResult`)
//    is expanded into N tool messages whose `tool_call_id`s line up, in order,
//    with the previous assistant turn's ids (OpenAI requires the pairing).
//  - When an assistant message carries tool_calls, content may be null.

/** Render one tool result into the string content of an OpenAI tool message. */
function stringifyToolResult(r: AgentToolResult | undefined, fallback: string): string {
  if (!r) return fallback ?? '';
  const anyR = r as any;
  // Standard result: { success, data, error, metadata }
  if (typeof anyR.success === 'boolean') {
    if (anyR.success) {
      return typeof anyR.data === 'string' ? anyR.data : JSON.stringify(anyR.data ?? {});
    }
    return anyR.error ? `Error: ${anyR.error}` : 'Error';
  }
  // MCP-style result: { content: [...] }
  if (anyR.content) {
    if (Array.isArray(anyR.content)) {
      return anyR.content.map((c: any) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c))).join('\n');
    }
    return String(anyR.content);
  }
  return fallback ?? '';
}

export function formatMessagesForOpenAI(messages: AgentMessage[]): any[] {
  const out: any[] = [];
  // Ids from the previous assistant turn that carried tool_calls, so the tool
  // results that immediately follow can be paired back to them.
  let lastToolCallIds: string[] = [];

  messages.forEach((msg, turnIdx) => {
    // === assistant with tool calls (parallel toolCalls[] or single toolCall) ===
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
        content: msg.content || null, // OpenAI allows null content when tool_calls are present
        tool_calls: calls.map((tc, i) => ({
          id: ids[i],
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        })),
      });
      return;
    }

    // === tool results -> one tool message per call, paired to the prior assistant turn ===
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
              : i === 0
                ? (msg.content ?? '') // no per-call result (e.g. a block message): hang it on the first
                : '';
          out.push({ role: 'tool', tool_call_id: lastToolCallIds[i], content: content ?? '' });
        }
        lastToolCallIds = [];
        return;
      }
      // No assistant tool_calls to pair with -> degrade to a user message to
      // avoid an orphan tool role (OpenAI would 400).
      out.push({ role: 'user', content: msg.content });
      return;
    }

    // === plain user/assistant text (+ optional multimodal image parts) ===
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    // ponytail: trimmed for the demo — the core AgentMessage has no `attachments`
    // field, so multimodal parts are read defensively to keep the shape faithful.
    const attachments: any[] | undefined = (msg as any).attachments;
    if (!attachments || attachments.length === 0) {
      out.push({ role, content: msg.content });
      return;
    }
    const parts: any[] = [];
    if (msg.content) parts.push({ type: 'text', text: msg.content });
    for (const att of attachments) {
      if (att.mimeType?.startsWith('image/')) {
        if (att.base64Data) {
          parts.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${att.base64Data}` } });
        } else if (att.fileUri) {
          parts.push({ type: 'image_url', image_url: { url: att.fileUri } });
        }
      }
    }
    out.push({ role, content: parts.length > 0 ? parts : msg.content });
  });

  return out;
}

// ============================================================
// Provider implementation
// ============================================================

/** Minimal shape of an OpenAI Chat Completions response. */
interface OpenAIChatCompletion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    reasoning_tokens?: number;
  };
}

/**
 * OpenAI-compatible provider.
 *
 * Implements LLMProvider over the Chat Completions HTTP API.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id: ProviderId = 'openai';
  readonly name = 'OpenAI-compatible';

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey ?? OPENAI_API_KEY;
    this.baseUrl = baseUrl ?? OPENAI_BASE_URL;
  }

  /** Available if a key is set, or if pointed at a local server that needs none. */
  isAvailable(): boolean {
    return (!!this.apiKey && this.apiKey.length > 0) || this.baseUrl.includes('localhost');
  }

  async generateContent(params: GenerateParams): Promise<GenerateResult> {
    const {
      messages,
      systemPrompt,
      model: modelId,
      reasoning,
      tools,
      temperature,
      maxOutputTokens,
      responseMimeType,
      responseJsonSchema,
    } = params;

    const model = modelId || DEFAULT_OPENAI_MODEL;
    const modelInfo = getOpenAIModel(model);
    if (!modelInfo) {
      throw new ProviderError(`Unknown OpenAI model: ${model}`, 'openai', 'invalid_request', 400, false);
    }

    const openaiMessages: any[] = [
      { role: 'system', content: systemPrompt },
      ...formatMessagesForOpenAI(messages),
    ];

    const requestBody: any = {
      model,
      messages: openaiMessages,
    };

    // Reasoning handling.
    //
    // Reasoning models reject `reasoning_effort` together with function tools on
    // /v1/chat/completions (they 400, asking you to use /v1/responses). Since the
    // agent's ReAct loop sends tools every turn, applying reasoning_effort there
    // would fail every call. So: when tools are present, drop reasoning_effort and
    // let the model answer with tools. response_format can stay (it's not subject
    // to this restriction).
    const hasTools = !!(tools && tools.length > 0);
    let reasoningEffortApplied = false;
    if (reasoning?.enabled && modelInfo.supportsReasoning && !hasTools) {
      const effort = toOpenAIReasoningEffort(reasoning.level);
      if (effort !== 'none') {
        requestBody.reasoning_effort = effort;
        reasoningEffortApplied = true;
      }
    } else if (reasoning?.enabled && modelInfo.supportsReasoning && hasTools) {
      console.warn(
        '[OpenAIProvider] Skipping reasoning_effort because function tools are present; ' +
        'reasoning models reject reasoning_effort + tools on /v1/chat/completions.',
      );
    }

    if (temperature !== undefined) requestBody.temperature = temperature;
    if (maxOutputTokens !== undefined) requestBody.max_completion_tokens = maxOutputTokens;
    if (responseMimeType === 'application/json' && responseJsonSchema) {
      requestBody.response_format = {
        type: 'json_schema',
        json_schema: { name: 'tpc_ai_response', schema: responseJsonSchema },
      };
    } else if (responseMimeType === 'application/json') {
      requestBody.response_format = { type: 'json_object' };
    }

    if (hasTools) {
      requestBody.tools = tools!.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    try {
      console.log(`[OpenAIProvider] Calling ${model} (reasoning: ${reasoning?.level || 'disabled'})`);

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.handleHttpError(response.status, errorData);
      }

      const data: OpenAIChatCompletion = await response.json();

      const choice = data.choices?.[0];
      const text = choice?.message?.content || '';

      if (!text && !choice?.message?.tool_calls) {
        throw new ProviderError('Empty response from OpenAI', 'openai', 'server_error', 500, true);
      }

      const usage = data.usage ? {
        inputTokens: data.usage.prompt_tokens || 0,
        outputTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
        reasoningTokens: data.usage.reasoning_tokens,
      } : undefined;

      const toolCalls = choice?.message?.tool_calls?.map(tc => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));

      return {
        text,
        provider: 'openai',
        model,
        reasoning: reasoning?.enabled ? { level: reasoning.level, used: reasoningEffortApplied } : undefined,
        usage,
        finishReason: this.mapFinishReason(choice?.finish_reason),
        toolCalls,
      };
    } catch (error: any) {
      if (error instanceof ProviderError) throw error;
      throw this.handleError(error);
    }
  }

  getModels(): ModelInfo[] {
    return OPENAI_MODELS;
  }

  getDefaultModel(): ModelInfo {
    return getDefaultOpenAIModel();
  }

  getModel(modelId: string): ModelInfo | undefined {
    return getOpenAIModel(modelId);
  }

  async validateApiKey(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
      const response = await fetch(`${this.baseUrl}/models`, { headers });
      return response.ok;
    } catch {
      return false;
    }
  }

  private mapFinishReason(reason?: string): GenerateResult['finishReason'] {
    switch (reason) {
      case 'stop': return 'stop';
      case 'length': return 'length';
      case 'tool_calls': return 'tool_calls';
      case 'content_filter': return 'content_filter';
      default: return undefined;
    }
  }

  private handleHttpError(statusCode: number, errorData: any): ProviderError {
    const errorType = (OPENAI_ERROR_CODES[statusCode] as ProviderErrorType) || 'unknown';
    const retryable = isRetryableOpenAIError(statusCode);
    const message = errorData?.error?.message || `OpenAI API error: ${statusCode}`;
    return new ProviderError(message, 'openai', errorType, statusCode, retryable);
  }

  private handleError(error: any): ProviderError {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return new ProviderError('Network error connecting to OpenAI', 'openai', 'network', undefined, true, error);
    }
    if (error.name === 'AbortError') {
      return new ProviderError('Request to OpenAI timed out', 'openai', 'timeout', undefined, true, error);
    }
    return new ProviderError(error.message || 'Unknown OpenAI error', 'openai', 'unknown', undefined, false, error);
  }
}

/** Create an OpenAI-compatible provider instance. */
export function createOpenAIProvider(apiKey?: string, baseUrl?: string): OpenAIProvider {
  return new OpenAIProvider(apiKey, baseUrl);
}
