/**
 * Skills system type definitions.
 *
 * Supports SKILL.md files with YAML frontmatter and Markdown content.
 */

/**
 * Skill frontmatter (YAML metadata at the top of a SKILL.md file).
 */
export interface SkillFrontmatter {
  /** Skill name. */
  name?: string;
  /** Skill description. */
  description?: string;
  /** Applicable file glob patterns (reserved; not currently used). */
  globs?: string[];
  /** Whether this skill is always applied. */
  alwaysApply?: boolean;
  /** Tags (used for classification and filtering). */
  tags?: string[];
  /** Priority (lower number wins). */
  priority?: number;
  /** Required tools (skill only loads when these tools are present). */
  requiresTools?: string[];
  /**
   * Agent ID whitelist.
   * Only agents in this list will load the skill.
   * If omitted, every agent may load it. No default whitelist is shipped —
   * this is a generic mechanism; supply your own agent IDs as needed.
   */
  agents?: string[];
}

/**
 * A loaded skill entry.
 */
export interface SkillEntry {
  /** Skill identifier (inferred from the path when not set in frontmatter). */
  name: string;
  /** Skill file path. */
  path: string;
  /** Parsed frontmatter. */
  frontmatter: SkillFrontmatter;
  /** Skill content (Markdown). */
  content: string;
  /** Load timestamp. */
  loadedAt: Date;
}

/**
 * Skill context (used to decide which skills apply).
 */
export interface SkillContext {
  /** Registered tool names. */
  tools: string[];
  /** Whether the memory system is enabled. */
  hasMemory: boolean;
  /** Current brand (if any). */
  brand?: string;
  /** Current conversation topics. */
  topics?: string[];
  /** User ID. */
  userId?: string;
  /** Current agent ID (used for skill agent filtering). */
  agentId?: string;
  /** Whether agent-to-agent (A2A) collaboration mode is enabled. */
  enableA2A?: boolean;
}

/**
 * Skill load options.
 */
export interface SkillLoadOptions {
  /** Directories to scan. */
  directories: string[];
  /** Whether to scan recursively. */
  recursive?: boolean;
  /** Path patterns to exclude. */
  excludePatterns?: string[];
}

/**
 * SkillManager configuration.
 */
export interface SkillManagerConfig {
  /** Skills root directory. */
  skillsDirectory: string;
  /** Whether to auto-load on startup. */
  autoLoad?: boolean;
  /** Cache TTL in milliseconds. */
  cacheTTL?: number;
}

/**
 * Result of parsing a SKILL.md file.
 */
export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  content: string;
}

/**
 * Default configuration.
 */
export const DEFAULT_SKILL_CONFIG: SkillManagerConfig = {
  skillsDirectory: 'src/skills/entries',
  autoLoad: true,
  cacheTTL: 60000, // 1 minute
};
