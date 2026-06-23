/**
 * VIN-AIOS bootstrap — how the planes wire together, in one place.
 *
 * This is a runnable fork of TPC-AIOS focused on on-premise deployment. Out of
 * the box it expects a local Ollama daemon at http://localhost:11434 with a
 * model pulled (e.g. `ollama pull qwen2.5:14b`). The embedding seam is wired
 * to Ollama's /api/embed by default (`nomic-embed-text`).
 *
 * Boot order is provider-first → tools → delegation → memory. Identity stays
 * 'local'; the tool gate is fail-closed (regex-forged or denied tools never run).
 */

import { initializeProviders } from './providers/registry.js';
import { registerBuiltinTools } from './tools/index.js';
import { initMemoryFromEnv } from './memory/index.js';
import { runAgent, VIN, registerDelegation } from './agent/index.js';

/** Wire the planes: providers (Ollama-first) → tools → delegation → memory. */
export async function boot(): Promise<void> {
  initializeProviders(); // Ollama (default) + OpenAI-compatible + optional Gemini
  registerBuiltinTools(); // echo / web_fetch / memory_search (source: 'core')
  registerDelegation(); // delegate_to_agent — the multi-agent seam
  await initMemoryFromEnv(); // sqlite (default) or inmemory; embeddings via Ollama
}

/** Ask the one agent. Identity is implicit ('local'); the tool gate is fail-closed. */
export async function ask(input: string) {
  return runAgent(VIN, input);
}

// Example (uncomment once Ollama is running and you've `ollama pull qwen2.5:14b`):
// await boot();
// console.log((await ask('Summarize the architecture in 3 bullets.')).answer);

export { VIN } from './agent/vin.js';
