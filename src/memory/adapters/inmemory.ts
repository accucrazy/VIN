/**
 * InMemoryAdapter — in-memory backend.
 *
 * Pure in-memory storage, no external dependencies. Good for tests or scenarios
 * that do not need persistence.
 *
 * Note: data is lost on restart.
 *
 * @example
 * ```typescript
 * import { initMemory, createInMemoryAdapter } from '../index.js';
 *
 * initMemory(createInMemoryAdapter());
 * ```
 */

import {
  MemoryAdapter,
  ConversationData,
  MessageData,
  MessageInput,
  ConversationListItem,
  MemorySearchResult,
} from '../adapter.js';
import { SearchOptions, ConversationStatus } from '../types.js';

/** Generate a unique ID. */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/** Internal conversation record. */
interface InternalConversation {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: ConversationStatus;
}

/** Internal message record. */
interface InternalMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  embedding?: number[];
}

/** InMemoryAdapter. */
export class InMemoryAdapter implements MemoryAdapter {
  private conversations: Map<string, InternalConversation> = new Map();
  private messages: Map<string, InternalMessage[]> = new Map();

  constructor() {
    console.log('[InMemoryAdapter] Initialized (data will not persist)');
  }

  // ==================== Conversation operations ====================

  async createConversation(userId: string, title?: string): Promise<string> {
    const id = generateId();
    const now = new Date();

    const conversation: InternalConversation = {
      id,
      userId,
      title: title || 'New conversation',
      createdAt: now,
      updatedAt: now,
      status: 'active',
    };

    this.conversations.set(id, conversation);
    this.messages.set(id, []);

    console.log(`[InMemoryAdapter] Created conversation: ${id}`);
    return id;
  }

  async getConversation(conversationId: string): Promise<ConversationData | null> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;

    const messages = this.messages.get(conversationId) || [];

    return {
      id: conversation.id,
      userId: conversation.userId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: messages.length,
      status: conversation.status,
    };
  }

  async getUserConversations(userId: string, limit: number = 20, offset: number = 0): Promise<ConversationListItem[]> {
    const userConversations: ConversationListItem[] = [];

    this.conversations.forEach((conv, id) => {
      if (conv.userId === userId && conv.status === 'active') {
        const messages = this.messages.get(id) || [];
        userConversations.push({
          id: conv.id,
          title: conv.title,
          updatedAt: conv.updatedAt,
          messageCount: messages.length,
          status: conv.status,
        });
      }
    });

    // Sort by updated time (newest first)
    userConversations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return userConversations.slice(offset, offset + limit);
  }

  async updateTitle(conversationId: string, title: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.title = title;
      conversation.updatedAt = new Date();
      console.log(`[InMemoryAdapter] Updated title for ${conversationId}`);
    }
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.status = 'deleted';
      conversation.updatedAt = new Date();
      console.log(`[InMemoryAdapter] Soft deleted conversation: ${conversationId}`);
    }
  }

  async verifyOwnership(conversationId: string, userId: string): Promise<boolean> {
    const conversation = this.conversations.get(conversationId);
    return conversation?.userId === userId;
  }

  // ==================== Message operations ====================

  async addMessage(conversationId: string, message: MessageInput): Promise<string> {
    const id = generateId();
    const now = new Date();

    const newMessage: InternalMessage = {
      id,
      conversationId,
      role: message.role,
      content: message.content,
      timestamp: now,
    };

    const messages = this.messages.get(conversationId) || [];
    messages.push(newMessage);
    this.messages.set(conversationId, messages);

    // Touch conversation updated time
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.updatedAt = now;
    }

    console.log(`[InMemoryAdapter] Added message to ${conversationId}: ${id}`);
    return id;
  }

  async getMessages(conversationId: string, limit: number = 50): Promise<MessageData[]> {
    const messages = this.messages.get(conversationId) || [];

    return messages.slice(0, limit).map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      embedding: msg.embedding,
    }));
  }

  // ==================== Search operations ====================

  async search(
    userId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    const { maxResults = 10 } = options;
    const results: MemorySearchResult[] = [];
    const queryLower = query.toLowerCase();

    // Simple keyword search
    this.conversations.forEach((conv, convId) => {
      if (conv.userId === userId && conv.status === 'active') {
        const messages = this.messages.get(convId) || [];

        messages.forEach(msg => {
          if (msg.content.toLowerCase().includes(queryLower)) {
            // Simple similarity score (occurrences / cap)
            const occurrences = (msg.content.toLowerCase().match(new RegExp(queryLower, 'g')) || []).length;
            const score = Math.min(occurrences / 10, 1);

            results.push({
              messageId: msg.id,
              conversationId: convId,
              content: msg.content,
              role: msg.role,
              score,
              timestamp: msg.timestamp,
            });
          }
        });
      }
    });

    // Sort by score and cap
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  // ==================== Helpers ====================

  /** Clear all data (for tests). */
  clear(): void {
    this.conversations.clear();
    this.messages.clear();
    console.log('[InMemoryAdapter] All data cleared');
  }

  /** Get statistics. */
  getStats(): { conversations: number; messages: number } {
    let totalMessages = 0;
    this.messages.forEach(msgs => {
      totalMessages += msgs.length;
    });

    return {
      conversations: this.conversations.size,
      messages: totalMessages,
    };
  }
}

/**
 * Create an InMemoryAdapter instance.
 *
 * @returns MemoryAdapter
 *
 * @example
 * ```typescript
 * import { initMemory, createInMemoryAdapter } from '../index.js';
 *
 * initMemory(createInMemoryAdapter());
 * ```
 */
export function createInMemoryAdapter(): MemoryAdapter {
  return new InMemoryAdapter();
}
