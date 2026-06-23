/**
 * Agent definition — an agent is a row of *data*, not a class.
 *
 * Adding an agent = adding an AgentDefinition. The roster is derived from the registry;
 * there is no per-agent tool/class fork. (This repo ships exactly one: Vin.)
 */

import type { ToolPolicy, ProviderId } from '../types.js';

export interface AgentDefinition {
  /** Stable id. */
  id: string;
  /** Display name. */
  name: string;
  /** English system prompt. */
  systemPrompt: string;
  /** Tool policy (profile and/or allow/deny). */
  policy?: ToolPolicy;
  /** Which provider to use (defaults to env HARNESS_PROVIDER, else 'openai'). */
  provider?: ProviderId;
  /** Default model id (defaults to the active provider's default model). */
  defaultModel?: string;
  /** Tools that grant agent-to-agent delegation (e.g. ['delegate_to_agent']) — intent + documentation. */
  a2aTools?: string[];
}
