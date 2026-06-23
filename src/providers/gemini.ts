/**
 * Google Gemini provider.
 *
 * Talks to the Gemini API through the official `@google/genai` SDK — an LLM
 * client (like the `openai` package), not GCP infrastructure. This single file
 * consolidates config, message formatting, and the provider implementation. It
 * implements the provider-agnostic LLMProvider contract.
 *
 * The teachable mechanism here is Gemini's *thought signatures*: the model
 * returns an opaque, encrypted reasoning context on its parts (function calls
 * and, optionally, text). That signature MUST be carried back unchanged on the
 * next turn — on a function call it is required (a missing value can 400); on
 * text it is advisory (improves multi-turn reasoning quality). We never inspect
 * it; we pass it through verbatim.
 *
 * @module providers/gemini
 */

import { GoogleGenAI } from '@google/genai';
import type { AgentMessage } from '../types.js';
import type {
  LLMProvider,
  ProviderId,
  ModelInfo,
  ReasoningLevel,
  GenerateParams,
  GenerateResult,
  ProviderErrorType,
  ToolDefinition,
} from './types.js';
import { ProviderError } from './types.js';

// ============================================================
// Config (env-driven; no literal key fallbacks)
// ============================================================

/** API key. Read from the environment; empty when unset. */
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
/** Base URL for the Gemini API (kept for parity/observability; the SDK uses it internally). */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
/** Default model id. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash';

/**
 * Model catalog.
 *
 * A small list of real Gemini model ids. Costs/limits below are illustrative.
 * @see https://ai.google.dev/gemini-api/docs/models
 */
export const GEMINI_MODELS: ModelInfo[] = [
  {
    id: 'gemini-3.5-flash',
    provider: 'gemini',
    contextWindow: 1_048_576, // 1M tokens
    maxOutput: 8_192,
    supportsReasoning: true,
    reasoningLevels: ['minimal', 'low', 'medium', 'high'],
    costPer1MInput: 0.10,
    costPer1MOutput: 0.40,
    tier: 'fast',
    knowledgeCutoff: '2025-01',
    description: 'Gemini 3.5 Flash - fast, low-cost multimodal model.',
  },
];

/** Default model id (mirrors GEMINI_MODEL; kept as a named export for callers). */
export const DEFAULT_GEMINI_MODEL = GEMINI_MODEL;

/**
 * Maps the unified ReasoningLevel onto Gemini's thinkingLevel.
 *
 * Officially supported levels:
 *  - Pro:   low, high
 *  - Flash: minimal, low, medium, high
 *
 * Notes:
 *  - Gemini has no 'none' — the floor is 'minimal' (Flash) or 'low' (Pro).
 *  - Gemini has no 'xhigh' — it degrades to 'high'.
 *  - 'medium' is Flash-only; Pro degrades it to 'low'.
 */
export const THINKING_LEVEL_MAP: Record<ReasoningLevel, string> = {
  none: 'minimal', // no 'none' in Gemini; use minimal (Flash) / low (Pro)
  low: 'low',
  medium: 'medium', // Flash-only
  high: 'high',
  xhigh: 'high', // no 'xhigh' in Gemini; degrade to high
};

/**
 * Convert a unified ReasoningLevel to a Gemini thinkingLevel.
 *
 * @param level   unified reasoning level
 * @param modelId model id (used to decide minimal/medium support)
 */
export function toGeminiThinkingLevel(level: ReasoningLevel, modelId?: string): string {
  const mapped = THINKING_LEVEL_MAP[level] || 'low';

  // Pro does not support minimal/medium — degrade.
  const isProModel = modelId?.includes('pro');
  if (isProModel) {
    if (mapped === 'minimal') return 'low';
    if (mapped === 'medium') return 'low';
  }

  return mapped;
}

/** Whether `modelId` is in the catalog. */
export function isValidGeminiModel(modelId: string): boolean {
  return GEMINI_MODELS.some(m => m.id === modelId);
}

/** Look up a model by id. */
export function getGeminiModel(modelId: string): ModelInfo | undefined {
  return GEMINI_MODELS.find(m => m.id === modelId);
}

/** Get the default model info. */
export function getDefaultGeminiModel(): ModelInfo {
  return GEMINI_MODELS.find(m => m.id === DEFAULT_GEMINI_MODEL) || GEMINI_MODELS[0];
}

/** HTTP status -> normalized error category. */
export const GEMINI_ERROR_CODES: Record<number, string> = {
  400: 'invalid_request',
  401: 'auth',
  403: 'auth',
  404: 'not_found',
  429: 'rate_limit',
  500: 'server_error',
  502: 'server_error',
  503: 'server_error',
};

/** Whether an HTTP status is worth retrying. */
export function isRetryableGeminiError(statusCode: number): boolean {
  return [429, 500, 502, 503].includes(statusCode);
}

// ============================================================
// Provider implementation
// ============================================================

/**
 * Gemini provider.
 *
 * Implements LLMProvider over the `@google/genai` SDK.
 */
export class GeminiProvider implements LLMProvider {
  readonly id: ProviderId = 'gemini';
  readonly name = 'Gemini';

  private apiKey: string;
  private client: GoogleGenAI | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || GEMINI_API_KEY;
  }

  /** Available if a key is set. */
  isAvailable(): boolean {
    return !!GEMINI_API_KEY;
  }

  /** Lazily build the SDK client. */
  private getClient(): GoogleGenAI {
    if (!this.client) {
      if (!this.apiKey) {
        throw new ProviderError('Gemini API key not configured', 'gemini', 'auth', 401, false);
      }
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async generateContent(params: GenerateParams): Promise<GenerateResult> {
    const {
      messages,
      systemPrompt,
      model: modelId,
      reasoning,
      temperature,
      maxOutputTokens,
    } = params;

    const model = modelId || DEFAULT_GEMINI_MODEL;
    const modelInfo = getGeminiModel(model);
    if (!modelInfo) {
      throw new ProviderError(`Unknown Gemini model: ${model}`, 'gemini', 'invalid_request', 400, false);
    }

    const client = this.getClient();

    // Build config.
    const config: any = {
      systemInstruction: systemPrompt,
    };

    // Reasoning/thinking handling.
    // Gemini uses thinkingConfig.thinkingLevel (not `reasoning`).
    // @see https://ai.google.dev/gemini-api/docs/gemini-3
    if (reasoning?.enabled && modelInfo.supportsReasoning) {
      const thinkingLevel = toGeminiThinkingLevel(reasoning.level, model);
      config.thinkingConfig = { thinkingLevel };
    } else {
      // Disable thinking — use the lowest level the model allows.
      const minLevel = model.includes('pro') ? 'low' : 'minimal';
      config.thinkingConfig = { thinkingLevel: minLevel };
    }

    if (temperature !== undefined) config.temperature = temperature;
    if (maxOutputTokens !== undefined) config.maxOutputTokens = maxOutputTokens;

    // Tools: native function calling. (Built-in tools like code execution can't
    // coexist with functionDeclarations in Gemini 3, so we only ship one or the
    // other.)
    config.tools = this.buildToolsConfig(params.tools);

    // Structured Output (responseMimeType / responseJsonSchema).
    //
    // Gemini 3 claims function calling + structured output can be combined, but
    // in practice a large tool set + responseJsonSchema is rejected with a
    // 400 INVALID_ARGUMENT (no field-level cause). Either mode alone is fine;
    // only the combination fails. So: when the request carries function
    // declarations, drop structured output and let the executor's JSON-parse
    // path fall back to regex-based parsing.
    const hasFunctionDeclarations =
      Array.isArray(config.tools) &&
      config.tools.some(
        (t: any) => Array.isArray(t?.functionDeclarations) && t.functionDeclarations.length > 0,
      );
    if (!hasFunctionDeclarations) {
      if (params.responseMimeType) config.responseMimeType = params.responseMimeType;
      if (params.responseJsonSchema) config.responseJsonSchema = params.responseJsonSchema;
    } else if (params.responseMimeType || params.responseJsonSchema) {
      console.warn(
        '[GeminiProvider] Skipping Structured Output because function declarations are present; ' +
        'Gemini rejects the combination with large tool sets.',
      );
    }

    const contents = this.formatMessages(messages);

    try {
      console.log(`[GeminiProvider] Calling ${model} (reasoning: ${reasoning?.level || 'disabled'})`);

      const response = await client.models.generateContent({ model, contents, config });

      // Extract response (text + function calls + thought signatures).
      let text = '';
      let toolCalls: Array<{ name: string; arguments: Record<string, any>; thoughtSignature?: string }> = [];
      let textThoughtSignature: string | undefined;
      const candidates = response.candidates;
      if (candidates && candidates.length > 0 && candidates[0].content?.parts) {
        const extracted = this.extractResponseFromParts(candidates[0].content.parts);
        text = extracted.text;
        toolCalls = extracted.toolCalls;
        textThoughtSignature = extracted.textThoughtSignature;
      }

      if (!text) text = response.text || '';

      // Empty response: if reasoning was medium+, downgrade to low and retry once.
      if (!text && toolCalls.length === 0) {
        const currentLevel = config.thinkingConfig?.thinkingLevel;
        if (currentLevel && currentLevel !== 'low' && currentLevel !== 'minimal') {
          console.warn(`[GeminiProvider] Empty response with thinkingLevel=${currentLevel}, retrying with low`);
          config.thinkingConfig = { thinkingLevel: 'low' };

          const retryResponse = await client.models.generateContent({ model, contents, config });
          const retryCandidates = retryResponse.candidates;
          if (retryCandidates && retryCandidates.length > 0 && retryCandidates[0].content?.parts) {
            const retryExtracted = this.extractResponseFromParts(retryCandidates[0].content.parts);
            text = retryExtracted.text;
            toolCalls = retryExtracted.toolCalls;
            textThoughtSignature = retryExtracted.textThoughtSignature;
          }
          if (!text) text = retryResponse.text || '';
        }
      }

      if (!text && toolCalls.length === 0) {
        throw new ProviderError(
          'Empty response from Gemini (no text or function calls even after reasoning downgrade)',
          'gemini',
          'content_filter',
          200,
          true,
        );
      }

      const usage = response.usageMetadata ? {
        inputTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata.totalTokenCount || 0,
        cachedTokens: response.usageMetadata.cachedContentTokenCount || 0,
      } : undefined;

      return {
        text,
        provider: 'gemini',
        model,
        reasoning: reasoning?.enabled ? { level: reasoning.level, used: true } : undefined,
        usage,
        finishReason: toolCalls.length > 0 ? 'tool_calls' : this.mapFinishReason(candidates?.[0]?.finishReason),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        textThoughtSignature,
      };
    } catch (error: any) {
      if (error instanceof ProviderError) throw error;
      throw this.handleError(error);
    }
  }

  getModels(): ModelInfo[] {
    return GEMINI_MODELS;
  }

  getDefaultModel(): ModelInfo {
    return getDefaultGeminiModel();
  }

  getModel(modelId: string): ModelInfo | undefined {
    return getGeminiModel(modelId);
  }

  async validateApiKey(): Promise<boolean> {
    try {
      const client = this.getClient();
      await client.models.generateContent({
        model: DEFAULT_GEMINI_MODEL,
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        config: { maxOutputTokens: 1 },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Build the tools config for native function calling.
   *
   * Gemini 3 forbids built-in tools (codeExecution, googleSearch, …) alongside
   * functionDeclarations, so we emit function declarations when tools are
   * present and fall back to code execution otherwise.
   *
   * @see https://ai.google.dev/gemini-api/docs/function-calling
   */
  private buildToolsConfig(tools?: ToolDefinition[]): any[] {
    const toolsArray: any[] = [];

    if (tools && tools.length > 0) {
      toolsArray.push({
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      });
    } else {
      // No function declarations: enable code execution (Python sandbox) instead.
      toolsArray.push({ codeExecution: {} });
    }

    return toolsArray;
  }

  /**
   * Extract structured response from Gemini response parts.
   *
   * Handles each part type:
   *  - text: plain text (+ thoughtSignature)
   *  - functionCall: native function calling (+ thoughtSignature, required in Gemini 3)
   *  - executableCode / codeExecutionResult: code execution output
   *
   * Thought signatures: Gemini attaches an encrypted reasoning context to parts
   * that must be returned verbatim on later turns. On function-call parts it is
   * REQUIRED (missing = 400); on text parts it is advisory.
   *
   * @see https://ai.google.dev/gemini-api/docs/thought-signatures
   */
  private extractResponseFromParts(parts: any[]): {
    text: string;
    toolCalls: Array<{ name: string; arguments: Record<string, any>; thoughtSignature?: string }>;
    textThoughtSignature?: string;
  } {
    const textSegments: string[] = [];
    const toolCalls: Array<{ name: string; arguments: Record<string, any>; thoughtSignature?: string }> = [];
    let textThoughtSignature: string | undefined;

    for (const part of parts) {
      if (part.text) {
        textSegments.push(part.text);
        // Last text-part signature wins (per the Gemini 3 spec).
        if (part.thoughtSignature) textThoughtSignature = part.thoughtSignature;
      } else if (part.functionCall) {
        const fc = part.functionCall;
        toolCalls.push({
          name: fc.name,
          arguments: fc.args || {},
          // Pass the thought signature through unchanged (Gemini 3 requires it).
          thoughtSignature: part.thoughtSignature || undefined,
        });
      } else if (part.executableCode) {
        // ponytail: trimmed for the demo — code-execution rendering kept minimal.
        const code = part.executableCode.code || '';
        textSegments.push(`\n<code_execution>\n\`\`\`python\n${code}\n\`\`\`\n`);
      } else if (part.codeExecutionResult) {
        const outcome = part.codeExecutionResult.outcome || 'UNKNOWN';
        const output = part.codeExecutionResult.output || '';
        const label = outcome === 'OUTCOME_OK' ? 'Execution output' : `Execution failed (${outcome})`;
        textSegments.push(`${label}:\n${output}\n</code_execution>\n`);
      } else if (part.thoughtSignature && !part.text && !part.functionCall) {
        // Standalone signature part (can appear in streaming: empty text + signature).
        textThoughtSignature = part.thoughtSignature;
      }
    }

    return { text: textSegments.join(''), toolCalls, textThoughtSignature };
  }

  /**
   * Format AgentMessage[] into Gemini `contents`.
   *
   * Mapping:
   *  - text → { text, thoughtSignature? }
   *  - assistant + toolCalls[] → model turn with parallel { functionCall, thoughtSignature? } parts
   *  - assistant + toolCall    → model turn with one functionCall part
   *  - tool role               → user turn with functionResponse part(s)
   *
   * Thought-signature rule (Gemini 3): a function-call signature is REQUIRED on
   * the way back; a text signature is advisory. Either way it is returned
   * verbatim — never modified, merged, or split.
   */
  private formatMessages(messages: AgentMessage[]): any[] {
    return messages.map(msg => {
      // === Parallel function calling (multiple toolCalls) ===
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        for (const tc of msg.toolCalls) {
          const fcPart: any = { functionCall: { name: tc.name, args: tc.arguments } };
          if (tc.thoughtSignature) fcPart.thoughtSignature = tc.thoughtSignature;
          parts.push(fcPart);
        }
        return { role: 'model', parts };
      }

      // Parallel FC results → one user turn with multiple functionResponse parts.
      if (msg.role === 'tool' && msg.toolCalls && msg.toolCalls.length > 0) {
        const resultContents = msg.content.split('\n---\n');
        const parts = msg.toolCalls.map((tc, i) => ({
          functionResponse: { name: tc.name, response: { result: resultContents[i] || '' } },
        }));
        return { role: 'user', parts };
      }

      // === Single function calling (back-compat) ===
      if (msg.role === 'assistant' && msg.toolCall) {
        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        const fcPart: any = {
          functionCall: { name: msg.toolCall.name, args: msg.toolCall.arguments },
        };
        if (msg.toolCall.thoughtSignature) fcPart.thoughtSignature = msg.toolCall.thoughtSignature;
        parts.push(fcPart);
        return { role: 'model', parts };
      }

      // Single tool result → user turn with functionResponse part.
      if (msg.role === 'tool' && msg.toolCall) {
        return {
          role: 'user',
          parts: [{ functionResponse: { name: msg.toolCall.name, response: { result: msg.content } } }],
        };
      }

      // === Plain text message ===
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: any[] = [];

      if (msg.content) {
        const textPart: any = { text: msg.content };
        // Keep the text thought signature for assistant turns (advisory).
        if (msg.thoughtSignature && msg.role === 'assistant') {
          textPart.thoughtSignature = msg.thoughtSignature;
        }
        parts.push(textPart);
      }

      // ponytail: trimmed for the demo — the core AgentMessage has no `attachments`
      // field, so multimodal parts are read defensively to keep the shape faithful.
      const attachments: any[] | undefined = (msg as any).attachments;
      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.fileUri) {
            parts.push({ fileData: { mimeType: att.mimeType, fileUri: att.fileUri } });
          } else if (att.base64Data) {
            parts.push({ inlineData: { mimeType: att.mimeType, data: att.base64Data } });
          }
        }
      }

      // Ensure at least one part.
      if (parts.length === 0) parts.push({ text: '' });

      return { role, parts };
    });
  }

  private mapFinishReason(reason?: string): GenerateResult['finishReason'] {
    if (!reason) return undefined;
    switch (reason.toUpperCase()) {
      case 'STOP': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'SAFETY':
      case 'RECITATION': return 'content_filter';
      default: return undefined;
    }
  }

  private handleError(error: any): ProviderError {
    const statusCode = error.status || error.statusCode || 500;
    const errorType = (GEMINI_ERROR_CODES[statusCode] as ProviderErrorType) || 'unknown';
    const retryable = isRetryableGeminiError(statusCode);
    return new ProviderError(error.message || 'Unknown Gemini error', 'gemini', errorType, statusCode, retryable, error);
  }
}

/** Create a Gemini provider instance. */
export function createGeminiProvider(apiKey?: string): GeminiProvider {
  return new GeminiProvider(apiKey);
}
