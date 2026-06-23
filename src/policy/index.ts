/**
 * Policy module — declarative, layered tool permissions.
 *
 * Profiles (minimal/standard/full), groups (`group:*`), wildcard patterns, owner-only gating,
 * and layered resolution (global → provider → agent → group, deny over allow).
 */

export type {
  ToolPolicy,
  ToolProfileId,
  ToolPolicyResult,
  ToolGroupsMap,
  ToolProfilesMap,
  CompiledPattern,
  EffectiveToolPolicy,
  PolicyMatchContext,
} from './types.js';

export {
  TOOL_GROUPS,
  TOOL_PROFILES,
  OWNER_ONLY_TOOLS,
  getProfilePolicy,
  isValidProfileId,
  getAvailableProfiles,
  getGroupTools,
  isOwnerOnlyTool,
  registerToolGroup,
  registerOwnerOnlyTool,
  describeProfile,
} from './profiles.js';

export {
  compilePattern,
  compilePatterns,
  matchesAnyPattern,
  expandToolGroups,
  resolveEffectivePolicy,
  createPolicyMatcher,
  applyOwnerOnlyPolicy,
  filterToolsByPolicy,
  isToolAllowedByPolicy,
  isToolAllowedByPolicies,
  checkToolPolicy,
  checkToolPolicyWithContext,
  describePolicyConfig,
} from './tool-policy.js';
