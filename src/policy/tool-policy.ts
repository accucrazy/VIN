/**
 * Tool policy resolution + checking.
 *
 * The mechanism: normalize → expand groups → compile patterns → resolve effective policy
 * (profile + custom, deny over allow) → match. Layered checks run global → provider → agent → group.
 */

import type {
  ToolPolicy,
  ToolPolicyResult,
  ToolProfileId,
  CompiledPattern,
  PolicyMatchContext,
} from './types.js';
import { TOOL_GROUPS, getProfilePolicy, isOwnerOnlyTool } from './profiles.js';
import { normalizeToolName, normalizeToolList } from '../tools/tool-name.js';

// ==================== pattern matching ====================

/** Compile a pattern: `*` (all), exact, or wildcard (`prefix*` / `*suffix` / `mcp__server__*`). */
export function compilePattern(pattern: string): CompiledPattern {
  const normalized = normalizeToolName(pattern);
  if (!normalized) return { kind: 'exact', value: '' };
  if (normalized === '*') return { kind: 'all' };
  if (!normalized.includes('*')) return { kind: 'exact', value: normalized };
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { kind: 'regex', value: new RegExp(`^${escaped.replaceAll('\\*', '.*')}$`) };
}

export function compilePatterns(patterns?: string[]): CompiledPattern[] {
  if (!Array.isArray(patterns)) return [];
  return expandToolGroups(patterns)
    .map(compilePattern)
    .filter((p) => p.kind !== 'exact' || p.value);
}

export function matchesAnyPattern(name: string, patterns: CompiledPattern[]): boolean {
  for (const p of patterns) {
    if (p.kind === 'all') return true;
    if (p.kind === 'exact' && name === p.value) return true;
    if (p.kind === 'regex' && p.value.test(name)) return true;
  }
  return false;
}

// ==================== group expansion ====================

/**
 * Expand `group:xxx` entries into actual tool names.
 * @example expandToolGroups(['group:web', 'echo']) // => ['web_fetch', 'echo']
 */
export function expandToolGroups(list?: string[]): string[] {
  const normalized = normalizeToolList(list);
  const expanded: string[] = [];
  for (const value of normalized) {
    const group = TOOL_GROUPS[value];
    if (group) {
      expanded.push(...group);
      continue;
    }
    expanded.push(value);
  }
  return Array.from(new Set(expanded));
}

// ==================== allow / alsoAllow ====================

function unionAllow(base?: string[], extra?: string[]): string[] | undefined {
  if (!Array.isArray(extra) || extra.length === 0) return base;
  // No base allowlist → alsoAllow extends an implicit allow-all.
  if (!Array.isArray(base) || base.length === 0) return Array.from(new Set(['*', ...extra]));
  return Array.from(new Set([...base, ...extra]));
}

// ==================== effective policy ====================

/** Merge a profile's defaults with a custom policy. Custom deny has the highest precedence. */
export function resolveEffectivePolicy(params: {
  profile?: ToolProfileId;
  customPolicy?: ToolPolicy;
}): ToolPolicy | undefined {
  const profilePolicy = getProfilePolicy(params.profile ?? params.customPolicy?.profile);
  const customPolicy = params.customPolicy;

  if (!profilePolicy && !customPolicy) return undefined;
  if (!profilePolicy) {
    if (!customPolicy) return undefined;
    return { allow: unionAllow(customPolicy.allow, customPolicy.alsoAllow), deny: customPolicy.deny };
  }
  if (!customPolicy) {
    return { allow: unionAllow(profilePolicy.allow, profilePolicy.alsoAllow), deny: profilePolicy.deny };
  }
  const mergedAllow = unionAllow(
    customPolicy.allow ?? profilePolicy.allow,
    customPolicy.alsoAllow ?? profilePolicy.alsoAllow
  );
  return {
    allow: mergedAllow,
    deny: [...(profilePolicy.deny ?? []), ...(customPolicy.deny ?? [])].filter(Boolean),
  };
}

/** Build a matcher closure for a policy. deny is checked first (deny wins). */
export function createPolicyMatcher(policy: ToolPolicy) {
  const deny = compilePatterns(policy.deny);
  const allow = compilePatterns(policy.allow);
  return (name: string): ToolPolicyResult => {
    const normalized = normalizeToolName(name);
    if (matchesAnyPattern(normalized, deny)) {
      return { allowed: false, reason: `Tool '${name}' is in deny list` };
    }
    if (allow.length === 0) return { allowed: true }; // no allowlist → default allow
    if (matchesAnyPattern(normalized, allow)) return { allowed: true };
    return { allowed: false, reason: `Tool '${name}' is not in allow list` };
  };
}

// ==================== owner-only ====================

/** Strip/guard owner-only tools for non-owner callers. */
export function applyOwnerOnlyPolicy<T extends { name: string; execute?: unknown }>(
  tools: T[],
  senderIsOwner: boolean
): T[] {
  const guarded = tools.map((tool) => {
    if (!isOwnerOnlyTool(tool.name) || senderIsOwner || !tool.execute) return tool;
    return { ...tool, execute: async () => { throw new Error('Tool restricted to owner senders.'); } };
  });
  return senderIsOwner ? guarded : guarded.filter((t) => !isOwnerOnlyTool(t.name));
}

// ==================== filtering ====================

export function filterToolsByPolicy<T extends { name: string }>(tools: T[], policy?: ToolPolicy): T[] {
  if (!policy) return tools;
  const matcher = createPolicyMatcher(policy);
  return tools.filter((t) => matcher(t.name).allowed);
}

export function isToolAllowedByPolicy(name: string, policy?: ToolPolicy): boolean {
  if (!policy) return true;
  return createPolicyMatcher(policy)(name).allowed;
}

export function isToolAllowedByPolicies(name: string, policies: Array<ToolPolicy | undefined>): boolean {
  return policies.every((p) => isToolAllowedByPolicy(name, p));
}

// ==================== main check functions ====================

/**
 * Check whether a tool is allowed.
 *  1. no policy → allow
 *  2. owner-only tool + non-owner → deny
 *  3. in deny list → deny
 *  4. has allow list → must match
 *  5. no allow list → allow
 */
export function checkToolPolicy(params: {
  toolName: string;
  policy?: ToolPolicy;
  profile?: ToolProfileId;
  isOwner?: boolean;
}): ToolPolicyResult {
  const normalized = normalizeToolName(params.toolName);
  if (isOwnerOnlyTool(normalized) && !params.isOwner) {
    return { allowed: false, reason: `Tool '${params.toolName}' is restricted to owner senders` };
  }
  const effective = resolveEffectivePolicy({ profile: params.profile, customPolicy: params.policy });
  if (!effective) return { allowed: true };
  return createPolicyMatcher(effective)(params.toolName);
}

/** Layered, context-aware check: global → provider → agent → group. First denial wins. */
export function checkToolPolicyWithContext(
  context: PolicyMatchContext,
  policies: { global?: ToolPolicy; agent?: ToolPolicy; provider?: ToolPolicy; group?: ToolPolicy }
): ToolPolicyResult {
  const { toolName, isOwner } = context;
  const normalized = normalizeToolName(toolName);
  if (isOwnerOnlyTool(normalized) && !isOwner) {
    return { allowed: false, reason: `Tool '${toolName}' is restricted to owner senders` };
  }
  const layers = [policies.global, policies.provider, policies.agent, policies.group].filter(
    (p): p is ToolPolicy => p !== undefined
  );
  for (const policy of layers) {
    const result = createPolicyMatcher(policy)(toolName);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

export function describePolicyConfig(policy?: ToolPolicy): string {
  if (!policy) return 'No policy (all tools allowed)';
  const parts: string[] = [];
  if (policy.profile) parts.push(`Profile: ${policy.profile}`);
  if (policy.allow?.length) parts.push(`Allow: ${policy.allow.join(', ')}`);
  if (policy.alsoAllow?.length) parts.push(`AlsoAllow: ${policy.alsoAllow.join(', ')}`);
  if (policy.deny?.length) parts.push(`Deny: ${policy.deny.join(', ')}`);
  return parts.length ? parts.join(' | ') : 'Empty policy (all tools allowed)';
}
