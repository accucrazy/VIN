/**
 * Lightweight token counting utilities.
 *
 * This open-source cut intentionally keeps tokenizer dependencies out of the
 * default install. For context budgeting we use a conservative character-based
 * approximation (roughly 4 chars/token for mixed English/CJK text).
 */

export const COMPACTION_CONFIG = {
  MIN_MESSAGES_FOR_SPLIT: 12,
  DEFAULT_PARTS: 3,
};

type MessageLike = {
  role?: string;
  content?: string;
};

export function countTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

export function countMessageTokens(message: MessageLike): number {
  const content = typeof message.content === 'string' ? message.content : '';
  return countTokens(content);
}

export function countHistoryTokens(messages: MessageLike[]): number {
  return messages.reduce((sum, msg) => sum + countMessageTokens(msg), 0);
}

export function chunkMessagesByMaxTokens<T extends MessageLike>(
  messages: T[],
  maxTokens: number,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const tokens = countMessageTokens(msg);
    if (current.length > 0 && currentTokens + tokens > maxTokens) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(msg);
    currentTokens += tokens;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function splitMessagesByTokenShare<T extends MessageLike>(
  messages: T[],
  parts: number,
): T[][] {
  if (parts <= 1 || messages.length === 0) return [messages];
  const total = Math.max(countHistoryTokens(messages), 1);
  const target = Math.ceil(total / parts);
  return chunkMessagesByMaxTokens(messages, target);
}

export function isOversizedForSummary(
  message: MessageLike,
  maxTokens = 30000,
): boolean {
  return countMessageTokens(message) > maxTokens;
}
