/**
 * Conversation summarization service.
 *
 * Context summarization for long conversations:
 * - chunked summarization, then merge
 * - progressive fallback for oversized messages
 * - custom summarization instructions
 *
 * Provider access goes through the ProviderRegistry abstraction — this module
 * does NOT import any concrete cloud SDK. That keeps the "which LLM runs the
 * summary" decision behind the registry instead of leaking a vendor client into
 * a context-management module.
 */

import { getProviderRegistry } from '../providers/registry.js';
import {
  countTokens,
  countMessageTokens,
  countHistoryTokens,
  chunkMessagesByMaxTokens,
  splitMessagesByTokenShare,
  isOversizedForSummary,
  COMPACTION_CONFIG,
} from './token-counter.js';

/**
 * Summarization config.
 */
export const SUMMARIZATION_CONFIG = {
  // Model used for summarization (a cheaper/faster model is fine here).
  model: 'gpt-5-mini',
  // Max output tokens for a summary.
  maxOutputTokens: 800,
  // Max input tokens per summarization chunk.
  maxChunkTokens: 30000,
  // Temperature (low, to stay accurate).
  temperature: 0.3,
  // Default fallback summary (no history).
  defaultFallback: 'No prior history.',
  // Instruction for merging partial summaries.
  mergeInstructions:
    'Merge these partial summaries into one coherent summary. Preserve decisions, ' +
    'TODOs, open questions, and any constraints.',
} as const;

/**
 * Message interface (compatible with several Message shapes).
 */
interface Message {
  role?: 'user' | 'assistant' | 'system' | string;
  content: string;
  data?: any[];
  trendData?: any[];
  traces?: any[];
}

/**
 * Summary result.
 */
export interface SummaryResult {
  /** Generated summary. */
  summary: string;
  /** Token count of the summary. */
  summaryTokens: number;
  /** Token count of the original messages. */
  originalTokens: number;
  /** Compression ratio. */
  compressionRatio: number;
  /** Number of messages summarized. */
  messageCount: number;
  /** Number of oversized messages skipped. */
  oversizedSkipped: number;
}

/**
 * Summarize options.
 */
export interface SummarizeOptions {
  /** Custom summarization instructions. */
  customInstructions?: string;
  /** Previous summary (for incremental summarization). */
  previousSummary?: string;
  /** Max chunk token count. */
  maxChunkTokens?: number;
  /** Number of parts to split into. */
  parts?: number;
}

/**
 * Convert a message list into conversation text.
 */
function messagesToText(messages: Message[]): string {
  return messages
    .map((m) => {
      const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'AI' : 'System';
      return `${role}: ${m.content}`;
    })
    .join('\n\n');
}

/**
 * Generate a summary for a single chunk.
 */
async function generateChunkSummary(
  messages: Message[],
  options: SummarizeOptions = {}
): Promise<string> {
  if (messages.length === 0) {
    return options.previousSummary || SUMMARIZATION_CONFIG.defaultFallback;
  }

  const conversationText = messagesToText(messages);

  // Build the prompt
  let prompt = `Summarize the following conversation into key points, preserving important information (entities, data, conclusions):

${conversationText}`;

  // If there is a previous summary, include it as context
  if (options.previousSummary) {
    prompt = `Previous conversation summary:
${options.previousSummary}

---

${prompt}

Integrate the previous summary with the new conversation to produce an updated, complete summary.`;
  }

  // Custom instructions
  if (options.customInstructions) {
    prompt += `\n\nAdditional requirements:\n${options.customInstructions}`;
  }

  prompt += `

Summary format:
- Use concise bullet points
- Preserve important numbers and conclusions
- Keep it under ~400 words`;

  try {
    // Provider access via the registry abstraction — no concrete cloud SDK here.
    const provider = getProviderRegistry().get('openai');
    if (!provider) {
      throw new Error('No "openai" provider registered.');
    }

    const response = await provider.generateContent({
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '',
      model: SUMMARIZATION_CONFIG.model,
      temperature: SUMMARIZATION_CONFIG.temperature,
      maxOutputTokens: SUMMARIZATION_CONFIG.maxOutputTokens,
    });

    return response.text || SUMMARIZATION_CONFIG.defaultFallback;
  } catch (error) {
    console.error('[Summarization] Chunk summary failed:', error);
    throw error;
  }
}

/**
 * Chunked summarization.
 */
async function summarizeChunks(
  messages: Message[],
  options: SummarizeOptions = {}
): Promise<string> {
  if (messages.length === 0) {
    return options.previousSummary || SUMMARIZATION_CONFIG.defaultFallback;
  }

  const maxChunkTokens = options.maxChunkTokens || SUMMARIZATION_CONFIG.maxChunkTokens;
  const chunks = chunkMessagesByMaxTokens(messages, maxChunkTokens);

  let summary = options.previousSummary;

  for (const chunk of chunks) {
    summary = await generateChunkSummary(chunk, {
      ...options,
      previousSummary: summary,
    });
  }

  return summary || SUMMARIZATION_CONFIG.defaultFallback;
}

/**
 * Summarization with progressive fallback.
 *
 * If the full summarization fails, attempt a partial summary (excluding
 * oversized messages).
 *
 * TODO: add a summary-timeout fallback (skeleton: not implemented).
 */
export async function summarizeWithFallback(
  messages: Message[],
  options: SummarizeOptions = {}
): Promise<SummaryResult> {
  const originalTokens = countHistoryTokens(messages);

  if (messages.length === 0) {
    return {
      summary: options.previousSummary || SUMMARIZATION_CONFIG.defaultFallback,
      summaryTokens: 0,
      originalTokens: 0,
      compressionRatio: 1,
      messageCount: 0,
      oversizedSkipped: 0,
    };
  }

  // Attempt the full summary
  try {
    const summary = await summarizeChunks(messages, options);
    const summaryTokens = countTokens(summary);

    return {
      summary,
      summaryTokens,
      originalTokens,
      compressionRatio: originalTokens > 0 ? (originalTokens - summaryTokens) / originalTokens : 0,
      messageCount: messages.length,
      oversizedSkipped: 0,
    };
  } catch (fullError) {
    console.warn(`[Summarization] Full summarization failed, trying partial:`,
      fullError instanceof Error ? fullError.message : String(fullError)
    );
  }

  // Fallback 1: summarize only small messages, note the oversized ones
  const smallMessages: Message[] = [];
  const oversizedNotes: string[] = [];

  for (const msg of messages) {
    if (isOversizedForSummary(msg)) {
      const tokens = countMessageTokens(msg);
      oversizedNotes.push(
        `[Large ${msg.role} message (~${Math.round(tokens / 1000)}K tokens) omitted from summary]`
      );
    } else {
      smallMessages.push(msg);
    }
  }

  if (smallMessages.length > 0) {
    try {
      const partialSummary = await summarizeChunks(smallMessages, options);
      const notes = oversizedNotes.length > 0 ? `\n\n${oversizedNotes.join('\n')}` : '';
      const finalSummary = partialSummary + notes;
      const summaryTokens = countTokens(finalSummary);

      return {
        summary: finalSummary,
        summaryTokens,
        originalTokens,
        compressionRatio: originalTokens > 0 ? (originalTokens - summaryTokens) / originalTokens : 0,
        messageCount: messages.length,
        oversizedSkipped: oversizedNotes.length,
      };
    } catch (partialError) {
      console.warn(`[Summarization] Partial summarization also failed:`,
        partialError instanceof Error ? partialError.message : String(partialError)
      );
    }
  }

  // Final fallback: just record what was there
  const fallbackSummary =
    `Conversation contained ${messages.length} message(s) (${oversizedNotes.length} oversized). ` +
    `A detailed summary could not be generated due to size limits.`;

  return {
    summary: fallbackSummary,
    summaryTokens: countTokens(fallbackSummary),
    originalTokens,
    compressionRatio: 0,
    messageCount: messages.length,
    oversizedSkipped: oversizedNotes.length,
  };
}

/**
 * Staged summarization.
 *
 * Split messages into several parts, summarize each, then merge.
 * Suited for very long conversations.
 */
export async function summarizeInStages(
  messages: Message[],
  options: SummarizeOptions = {}
): Promise<SummaryResult> {
  if (messages.length === 0) {
    return {
      summary: options.previousSummary || SUMMARIZATION_CONFIG.defaultFallback,
      summaryTokens: 0,
      originalTokens: 0,
      compressionRatio: 1,
      messageCount: 0,
      oversizedSkipped: 0,
    };
  }

  const originalTokens = countHistoryTokens(messages);
  const parts = options.parts || COMPACTION_CONFIG.DEFAULT_PARTS;
  const maxChunkTokens = options.maxChunkTokens || SUMMARIZATION_CONFIG.maxChunkTokens;
  const minMessagesForSplit = COMPACTION_CONFIG.MIN_MESSAGES_FOR_SPLIT;

  // If there are too few messages or not many tokens, use the fallback path directly
  if (
    parts <= 1 ||
    messages.length < minMessagesForSplit ||
    originalTokens <= maxChunkTokens
  ) {
    return summarizeWithFallback(messages, options);
  }

  // Split the messages
  const splits = splitMessagesByTokenShare(messages, parts).filter((chunk) => chunk.length > 0);

  if (splits.length <= 1) {
    return summarizeWithFallback(messages, options);
  }

  console.log(`[Summarization] Staged summarization: ${splits.length} parts`);

  // Summarize each part separately
  const partialSummaries: string[] = [];
  let totalOversizedSkipped = 0;

  for (let i = 0; i < splits.length; i++) {
    const result = await summarizeWithFallback(splits[i], {
      ...options,
      previousSummary: undefined,
    });
    partialSummaries.push(result.summary);
    totalOversizedSkipped += result.oversizedSkipped;
    console.log(`[Summarization] Part ${i + 1}/${splits.length} complete`);
  }

  // If there is only one part, return it directly
  if (partialSummaries.length === 1) {
    const summaryTokens = countTokens(partialSummaries[0]);
    return {
      summary: partialSummaries[0],
      summaryTokens,
      originalTokens,
      compressionRatio: originalTokens > 0 ? (originalTokens - summaryTokens) / originalTokens : 0,
      messageCount: messages.length,
      oversizedSkipped: totalOversizedSkipped,
    };
  }

  // Merge all partial summaries
  const summaryMessages: Message[] = partialSummaries.map((summary, idx) => ({
    role: 'user' as const,
    content: `Part ${idx + 1} summary:\n${summary}`,
  }));

  const mergeInstructions = options.customInstructions
    ? `${SUMMARIZATION_CONFIG.mergeInstructions}\n\nAdditional requirements:\n${options.customInstructions}`
    : SUMMARIZATION_CONFIG.mergeInstructions;

  const mergedResult = await summarizeWithFallback(summaryMessages, {
    customInstructions: mergeInstructions,
  });

  return {
    summary: mergedResult.summary,
    summaryTokens: mergedResult.summaryTokens,
    originalTokens,
    compressionRatio: originalTokens > 0 ? (originalTokens - mergedResult.summaryTokens) / originalTokens : 0,
    messageCount: messages.length,
    oversizedSkipped: totalOversizedSkipped,
  };
}

/**
 * Simplified version (backward compatible).
 */
export async function summarizeMessages(
  messages: Message[]
): Promise<SummaryResult> {
  return summarizeWithFallback(messages);
}

/**
 * Build a history-summary message.
 */
export function createSummaryMessage(summary: string): Message {
  return {
    role: 'system',
    content: `[Conversation history summary]\n${summary}`,
  };
}

export default {
  SUMMARIZATION_CONFIG,
  summarizeMessages,
  summarizeWithFallback,
  summarizeInStages,
  createSummaryMessage,
};
