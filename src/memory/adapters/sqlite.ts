/**
 * SQLiteAdapter — local SQLite memory backend.
 *
 * Uses Node.js built-in node:sqlite + the sqlite-vec vector extension.
 * Good for local development, desktop apps, or anywhere you do not want a
 * cloud database.
 *
 * userId defaults to 'local' in single-user. This is a SEAM — see src/cautionary/.
 *
 * Dependencies:
 * - Node.js 22+ (built-in node:sqlite)
 * - sqlite-vec (npm install sqlite-vec) — optional, enables vector search
 *
 * @example
 * ```typescript
 * import { initMemory, createSQLiteAdapter } from '../index.js';
 *
 * // File database
 * initMemory(createSQLiteAdapter({ dbPath: './data/memory.db' }));
 *
 * // In-memory database (no persistence)
 * initMemory(createSQLiteAdapter({ dbPath: ':memory:' }));
 * ```
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import {
  MemoryAdapter,
  ConversationData,
  MessageData,
  MessageInput,
  ConversationListItem,
  MemorySearchResult,
} from '../adapter.js';
import { SearchOptions, EMBEDDING_CONFIG } from '../types.js';
import { generateEmbedding } from '../embed.js';

// Node.js SQLite type
type DatabaseSync = import('node:sqlite').DatabaseSync;

/** SQLite adapter configuration. */
export interface SQLiteAdapterConfig {
  /** Database file path (use ':memory:' for an in-memory database). */
  dbPath: string;
  /** Enable vector search (requires sqlite-vec). */
  enableVector?: boolean;
  /** sqlite-vec extension path (optional, auto-detected by default). */
  vectorExtensionPath?: string;
  /** Embedding dimensions (must match your embedder). */
  embeddingDimensions?: number;
}

/** Load the node:sqlite module. */
function requireNodeSqlite(): typeof import('node:sqlite') {
  // Suppress the ExperimentalWarning emitted by node:sqlite.
  const originalEmit = process.emit.bind(process) as (event: string, ...args: any[]) => boolean;
  process.emit = function (event: string, ...args: any[]) {
    if (event === 'warning' && args[0]?.name === 'ExperimentalWarning') {
      return false;
    }
    return originalEmit(event, ...args);
  } as typeof process.emit;

  return require('node:sqlite');
}

/**
 * Load the sqlite-vec extension.
 *
 * Note: sqlite-vec is an optional dependency. If it is not installed, vector
 * search is disabled and the adapter falls back to keyword search.
 */
async function loadSqliteVecExtension(
  db: DatabaseSync,
  extensionPath?: string
): Promise<{ ok: boolean; extensionPath?: string; error?: string }> {
  try {
    // Dynamic require to avoid static bundler analysis; keeps compilation working
    // even when the module is absent.
    const moduleName = 'sqlite-vec';
    let sqliteVec: any;

    try {
      sqliteVec = require(moduleName);
    } catch {
      sqliteVec = await import(/* webpackIgnore: true */ moduleName);
    }

    const resolvedPath = extensionPath?.trim() || undefined;
    const loadPath = resolvedPath ?? sqliteVec.getLoadablePath();

    db.enableLoadExtension(true);
    if (resolvedPath) {
      db.loadExtension(loadPath);
    } else {
      sqliteVec.load(db);
    }

    return { ok: true, extensionPath: loadPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SQLiteAdapter] sqlite-vec not available: ${message}`);
    console.warn('[SQLiteAdapter] Vector search will be disabled. Install with: npm install sqlite-vec');
    return { ok: false, error: message };
  }
}

/** Ensure a directory exists. */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Generate a UUID. */
function generateId(): string {
  return crypto.randomUUID();
}

/** Convert an embedding to a Float32Array buffer. */
function vectorToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/** SQLiteAdapter. */
export class SQLiteAdapter implements MemoryAdapter {
  private db: DatabaseSync;
  private vectorEnabled: boolean = false;
  private dimensions: number;

  constructor(config: SQLiteAdapterConfig) {
    this.dimensions = config.embeddingDimensions || EMBEDDING_CONFIG.DIMENSIONS;

    // Ensure the database directory exists
    if (config.dbPath !== ':memory:') {
      const dir = path.dirname(config.dbPath);
      ensureDir(dir);
    }

    // Open the database
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(config.dbPath, {
      allowExtension: config.enableVector !== false,
    });

    // Initialize schema
    this.initSchema();

    // Load the vector extension (async, does not block the constructor)
    if (config.enableVector !== false) {
      this.initVector(config.vectorExtensionPath);
    }

    console.log(`[SQLiteAdapter] Initialized: ${config.dbPath}`);
  }

  /** Initialize the database schema. */
  private initSchema(): void {
    // Conversations
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
    `);

    // Messages
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    `);

    // Embedding cache
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        hash TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // Metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /** Initialize vector search. */
  private async initVector(extensionPath?: string): Promise<void> {
    try {
      const result = await loadSqliteVecExtension(this.db, extensionPath);

      if (result.ok) {
        this.vectorEnabled = true;

        // Create the vector virtual table
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS messages_vec USING vec0(
            id TEXT PRIMARY KEY,
            embedding FLOAT[${this.dimensions}]
          );
        `);

        console.log(`[SQLiteAdapter] Vector search enabled (sqlite-vec: ${result.extensionPath})`);
      } else {
        console.warn(`[SQLiteAdapter] Vector search disabled: ${result.error}`);
        console.warn('[SQLiteAdapter] Install sqlite-vec for vector search: npm install sqlite-vec');
      }
    } catch (error) {
      console.warn('[SQLiteAdapter] Failed to load vector extension:', error);
    }
  }

  /**
   * Produce an embedding for text, with an on-disk cache.
   *
   * Embeddings are produced by the single provider-agnostic seam in ../embed.ts.
   */
  private async embed(text: string): Promise<number[] | null> {
    // Check the cache
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const cached = this.db
      .prepare('SELECT embedding FROM embedding_cache WHERE hash = ?')
      .get(hash) as { embedding: string } | undefined;

    if (cached) {
      return JSON.parse(cached.embedding);
    }

    try {
      // generateEmbedding L2-normalizes; see ../embed.ts.
      const normalized = await generateEmbedding(text);
      if (!normalized || normalized.length === 0) return null;

      // Store in the cache
      this.db
        .prepare('INSERT OR REPLACE INTO embedding_cache (hash, embedding, created_at) VALUES (?, ?, ?)')
        .run(hash, JSON.stringify(normalized), Date.now());

      return normalized;
    } catch (error) {
      console.warn('[SQLiteAdapter] Embedding generation failed:', error);
      return null;
    }
  }

  // ==================== Conversation operations ====================

  async createConversation(userId: string, title?: string): Promise<string> {
    const id = generateId();
    const now = Date.now();

    this.db
      .prepare(`
        INSERT INTO conversations (id, user_id, title, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `)
      .run(id, userId, title || 'New conversation', now, now);

    console.log(`[SQLiteAdapter] Created conversation: ${id}`);
    return id;
  }

  async getConversation(conversationId: string): Promise<ConversationData | null> {
    const row = this.db
      .prepare(`
        SELECT id, user_id, title, status, created_at, updated_at,
               (SELECT COUNT(*) FROM messages WHERE conversation_id = ?) as message_count
        FROM conversations
        WHERE id = ?
      `)
      .get(conversationId, conversationId) as any;

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      messageCount: row.message_count,
      status: row.status,
    };
  }

  async getUserConversations(userId: string, limit: number = 20, offset: number = 0): Promise<ConversationListItem[]> {
    const rows = this.db
      .prepare(`
        SELECT c.id, c.title, c.updated_at, c.status,
               (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
        FROM conversations c
        WHERE c.user_id = ? AND c.status = 'active'
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(userId, limit, offset) as any[];

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      updatedAt: new Date(row.updated_at),
      messageCount: row.message_count,
      status: row.status,
    }));
  }

  async updateTitle(conversationId: string, title: string): Promise<void> {
    this.db
      .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), conversationId);

    console.log(`[SQLiteAdapter] Updated title for ${conversationId}`);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.db
      .prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?')
      .run('deleted', Date.now(), conversationId);

    console.log(`[SQLiteAdapter] Soft deleted conversation: ${conversationId}`);
  }

  async verifyOwnership(conversationId: string, userId: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT user_id FROM conversations WHERE id = ?')
      .get(conversationId) as { user_id: string } | undefined;

    return row?.user_id === userId;
  }

  // ==================== Message operations ====================

  async addMessage(conversationId: string, message: MessageInput): Promise<string> {
    const id = generateId();
    const now = Date.now();

    // Generate embedding
    let embedding: number[] | null = null;
    if (message.generateEmbedding !== false && message.content) {
      embedding = await this.embed(message.content);
    }

    // Insert message
    this.db
      .prepare(`
        INSERT INTO messages (
          id, conversation_id, role, content, embedding, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        conversationId,
        message.role,
        message.content,
        embedding ? JSON.stringify(embedding) : null,
        now
      );

    // Insert into the vector table (if enabled)
    if (embedding && this.vectorEnabled) {
      try {
        this.db
          .prepare('INSERT INTO messages_vec (id, embedding) VALUES (?, ?)')
          .run(id, vectorToBlob(embedding));
      } catch (error) {
        console.warn('[SQLiteAdapter] Failed to insert into vector table:', error);
      }
    }

    // Touch conversation updated time
    this.db
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(now, conversationId);

    console.log(`[SQLiteAdapter] Added message to ${conversationId}: ${id}`);
    return id;
  }

  async getMessages(conversationId: string, limit: number = 50): Promise<MessageData[]> {
    const rows = this.db
      .prepare(`
        SELECT id, role, content, embedding, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
        LIMIT ?
      `)
      .all(conversationId, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: new Date(row.created_at),
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
    }));
  }

  // ==================== Search operations ====================

  async search(
    userId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    const { maxResults = 10, minScore = 0.3 } = options;

    // Use vector search if available
    if (this.vectorEnabled) {
      return this._doVectorSearch(userId, query, maxResults, minScore);
    }

    // Fall back to keyword search
    return this._doKeywordSearch(userId, query, maxResults);
  }

  /**
   * Internal vector search.
   * (Underscore prefix avoids clashing with the optional MemoryAdapter methods.)
   */
  private async _doVectorSearch(
    userId: string,
    query: string,
    maxResults: number,
    minScore: number
  ): Promise<MemorySearchResult[]> {
    const queryEmbedding = await this.embed(query);
    if (!queryEmbedding) {
      return this._doKeywordSearch(userId, query, maxResults);
    }

    try {
      const rows = this.db
        .prepare(`
          SELECT m.id, m.conversation_id, m.content, m.role, m.created_at,
                 vec_distance_cosine(v.embedding, ?) AS dist
          FROM messages_vec v
          JOIN messages m ON m.id = v.id
          JOIN conversations c ON c.id = m.conversation_id
          WHERE c.user_id = ? AND c.status = 'active'
          ORDER BY dist ASC
          LIMIT ?
        `)
        .all(vectorToBlob(queryEmbedding), userId, maxResults) as any[];

      return rows
        .map(row => ({
          messageId: row.id,
          conversationId: row.conversation_id,
          content: row.content,
          role: row.role,
          score: 1 - row.dist, // cosine similarity = 1 - distance
          timestamp: new Date(row.created_at),
        }))
        .filter(r => r.score >= minScore);
    } catch (error) {
      console.warn('[SQLiteAdapter] Vector search failed, falling back to keyword:', error);
      return this._doKeywordSearch(userId, query, maxResults);
    }
  }

  /**
   * Internal keyword search.
   * (Underscore prefix avoids clashing with the optional MemoryAdapter methods.)
   */
  private _doKeywordSearch(
    userId: string,
    query: string,
    maxResults: number
  ): Promise<MemorySearchResult[]> {
    const queryLower = query.toLowerCase();
    const pattern = `%${queryLower}%`;

    const rows = this.db
      .prepare(`
        SELECT m.id, m.conversation_id, m.content, m.role, m.created_at
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ? AND c.status = 'active'
          AND LOWER(m.content) LIKE ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `)
      .all(userId, pattern, maxResults) as any[];

    return Promise.resolve(
      rows.map((row, index) => ({
        messageId: row.id,
        conversationId: row.conversation_id,
        content: row.content,
        role: row.role,
        score: 1 - index * 0.05, // simple ranking score
        timestamp: new Date(row.created_at),
      }))
    );
  }

  // ==================== Helpers ====================

  /** Whether vector search is available. */
  isVectorEnabled(): boolean {
    return this.vectorEnabled;
  }

  /** Get statistics. */
  getStats(): { conversations: number; messages: number; cacheSize: number } {
    const convCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as any
    ).count;
    const msgCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as any
    ).count;
    const cacheCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM embedding_cache').get() as any
    ).count;

    return {
      conversations: convCount,
      messages: msgCount,
      cacheSize: cacheCount,
    };
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
    console.log('[SQLiteAdapter] Database closed');
  }
}

/**
 * Create a SQLiteAdapter instance.
 *
 * @param config SQLite configuration
 * @returns MemoryAdapter
 *
 * @example
 * ```typescript
 * import { initMemory, createSQLiteAdapter } from '../index.js';
 *
 * initMemory(createSQLiteAdapter({ dbPath: './data/memory.db', enableVector: true }));
 *
 * // In-memory (tests)
 * initMemory(createSQLiteAdapter({ dbPath: ':memory:' }));
 * ```
 */
export function createSQLiteAdapter(config: SQLiteAdapterConfig): MemoryAdapter {
  return new SQLiteAdapter(config);
}

/**
 * Create a SQLiteAdapter from environment variables.
 *
 * Environment variables:
 * - SQLITE_DB_PATH (required)
 * - SQLITE_ENABLE_VECTOR (optional, default true)
 */
export function createSQLiteAdapterFromEnv(): MemoryAdapter {
  const dbPath = process.env.SQLITE_DB_PATH;
  if (!dbPath) {
    throw new Error('Missing SQLITE_DB_PATH environment variable');
  }

  return createSQLiteAdapter({
    dbPath,
    enableVector: process.env.SQLITE_ENABLE_VECTOR !== 'false',
  });
}
