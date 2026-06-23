/**
 * Memory adapters.
 *
 * Exports the built-in memory backends. The production harness also shipped
 * cloud-database backends; this demo keeps the two dependency-light ones.
 */

// SQLite adapter (local persistence + optional vector search)
export {
  SQLiteAdapter,
  createSQLiteAdapter,
  createSQLiteAdapterFromEnv,
  type SQLiteAdapterConfig,
} from './sqlite.js';

// In-memory adapter (tests, no persistence)
export { InMemoryAdapter, createInMemoryAdapter } from './inmemory.js';
