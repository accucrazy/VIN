/**
 * Tool policy types.
 *
 * ToolPolicy / ToolProfileId are the single source in ../types.ts (the core contract).
 * This file re-exports them and adds the policy-internal types.
 */

export type { ToolPolicy, ToolProfileId } from '../types.js';

/** Result of a policy check. */
export interface ToolPolicyResult {
  allowed: boolean;
  reason?: string;
  /** Pattern that matched (for debugging). */
  matchedPattern?: string;
}

import type { ToolPolicy, ToolProfileId } from '../types.js';

export type ToolGroupsMap = Record<string, string[]>;
export type ToolProfilesMap = Record<ToolProfileId, ToolPolicy>;

/** A compiled allow/deny pattern. */
export type CompiledPattern =
  | { kind: 'all' }
  | { kind: 'exact'; value: string }
  | { kind: 'regex'; value: RegExp };

/** Context for a context-aware policy check. */
export interface PolicyMatchContext {
  toolName: string;
  isOwner?: boolean;
  providerId?: string;
  modelId?: string;
  agentId?: string;
  groupId?: string;
  senderId?: string;
}

/** Layered policy inputs, resolved global → provider → agent → group. */
export interface EffectiveToolPolicy {
  agentId?: string;
  globalPolicy?: ToolPolicy;
  globalProviderPolicy?: ToolPolicy;
  agentPolicy?: ToolPolicy;
  agentProviderPolicy?: ToolPolicy;
  profile?: string;
}
