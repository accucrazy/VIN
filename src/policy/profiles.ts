/**
 * Tool groups and profiles.
 *
 * Groups and profiles are generic here (no business tool names). They demonstrate the
 * mechanism: reference a whole group via `group:xxx`; pick a baseline via a profile.
 */

import type { ToolGroupsMap, ToolProfilesMap, ToolPolicy, ToolProfileId } from './types.js';

/**
 * Tool groups. Reference an entire group with `group:xxx` in allow/deny.
 *
 * Note: MCP-materialized tools are dynamic and are NOT listed as a static group — match them
 * with the `mcp__<server>__*` prefix pattern in allow/deny (compilePattern supports prefixes).
 */
export const TOOL_GROUPS: ToolGroupsMap = {
  'group:web': ['web_fetch', 'web_search'],
  'group:memory': ['memory_search'],
  'group:demo': ['echo', 'web_fetch', 'web_search', 'memory_search'],
  // Generic filesystem / runtime groups — illustrate owner-gated, side-effecting tools.
  'group:fs': ['read', 'write', 'edit'],
  'group:runtime': ['exec', 'process'],
  // Everything (wildcard).
  'group:all': ['*'],
};

/**
 * Owner-only tools — side-effecting tools gated to the owner caller. A real runtime boundary,
 * not a prompt instruction. In single-user the owner is implicit; this stays as a SEAM
 * (see src/cautionary/ownership.example.ts). None of these are registered in the demo;
 * they are forward-looking guards.
 */
export const OWNER_ONLY_TOOLS = new Set<string>(['write', 'exec']);

/**
 * Default profiles:
 *  - minimal:  read-only-ish baseline
 *  - standard: web + memory
 *  - full:     unrestricted (empty policy)
 */
export const TOOL_PROFILES: ToolProfilesMap = {
  minimal: { allow: ['echo', 'read'] },
  standard: { allow: ['group:web', 'group:memory'] },
  full: {}, // empty == no restriction
};

export function isValidProfileId(id: string): id is ToolProfileId {
  return id in TOOL_PROFILES;
}

export function getAvailableProfiles(): ToolProfileId[] {
  return Object.keys(TOOL_PROFILES) as ToolProfileId[];
}

export function getGroupTools(groupId: string): string[] | undefined {
  return TOOL_GROUPS[groupId];
}

export function isOwnerOnlyTool(toolName: string): boolean {
  return OWNER_ONLY_TOOLS.has(toolName.trim().toLowerCase());
}

export function registerToolGroup(groupId: string, tools: string[]): void {
  if (!groupId.startsWith('group:')) {
    throw new Error(`Group ID must start with 'group:', got: ${groupId}`);
  }
  TOOL_GROUPS[groupId] = [...tools];
}

export function registerOwnerOnlyTool(toolName: string): void {
  OWNER_ONLY_TOOLS.add(toolName.trim().toLowerCase());
}

/** Resolve a profile id to its policy (undefined == unrestricted). */
export function getProfilePolicy(profileId?: string): ToolPolicy | undefined {
  if (!profileId) return undefined;
  const policy = TOOL_PROFILES[profileId as keyof typeof TOOL_PROFILES];
  if (!policy) return undefined;
  if (!policy.allow && !policy.deny && !policy.alsoAllow) return undefined; // full
  return {
    allow: policy.allow ? [...policy.allow] : undefined,
    alsoAllow: policy.alsoAllow ? [...policy.alsoAllow] : undefined,
    deny: policy.deny ? [...policy.deny] : undefined,
  };
}

export function describeProfile(profileId: ToolProfileId): string {
  switch (profileId) {
    case 'minimal':
      return 'Minimal: read-only baseline';
    case 'standard':
      return 'Standard: web + memory tools';
    case 'full':
      return 'Full: unrestricted';
    default:
      return `Unknown profile: ${profileId}`;
  }
}
