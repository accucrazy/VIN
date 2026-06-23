/**
 * SkillManager — the skills system manager.
 *
 * Responsibilities:
 * - Load and manage SKILL.md files.
 * - Filter applicable skills by context.
 * - Build the dynamic system prompt (progressive disclosure).
 * - Track plugin provenance.
 */

import * as path from 'path';
import {
  SkillEntry,
  SkillContext,
  SkillManagerConfig,
  DEFAULT_SKILL_CONFIG,
} from './types.js';
import { scanAndLoadSkills } from './loader.js';

/**
 * Skill registration options.
 */
export interface SkillRegisterOptions {
  /** ID of the plugin registering this skill. */
  pluginId?: string;
}

/**
 * Internal record for a registered skill.
 */
interface RegisteredSkill {
  skill: SkillEntry;
  pluginId?: string;
  registeredAt: Date;
}

/**
 * SkillManager class.
 */
export class SkillManager {
  private skills: Map<string, RegisteredSkill> = new Map();
  private config: SkillManagerConfig;
  private lastLoadTime: number = 0;

  constructor(config?: Partial<SkillManagerConfig>) {
    this.config = { ...DEFAULT_SKILL_CONFIG, ...config };

    if (this.config.autoLoad) {
      this.loadSkills();
    }
  }

  /**
   * Load all skills.
   */
  loadSkills(directories?: string[], opts?: SkillRegisterOptions): SkillEntry[] {
    const dirs = directories || [this.config.skillsDirectory];
    const loadedSkills: SkillEntry[] = [];

    for (const dir of dirs) {
      // Resolve relative paths against the current working directory.
      const fullPath = path.isAbsolute(dir)
        ? dir
        : path.join(process.cwd(), dir);

      console.log(`[SkillManager] Scanning skills directory: ${fullPath}`);

      const skills = scanAndLoadSkills(fullPath, true);

      for (const skill of skills) {
        this.skills.set(skill.name, {
          skill,
          pluginId: opts?.pluginId,
          registeredAt: new Date(),
        });
        loadedSkills.push(skill);
      }
    }

    this.lastLoadTime = Date.now();
    console.log(`[SkillManager] Loaded ${loadedSkills.length} skills`);

    return loadedSkills;
  }

  /**
   * Reload skills if the cache TTL has elapsed.
   */
  reloadIfNeeded(): boolean {
    const now = Date.now();
    if (now - this.lastLoadTime > (this.config.cacheTTL || 60000)) {
      this.loadSkills();
      return true;
    }
    return false;
  }

  /**
   * Get every loaded skill.
   */
  getAllSkills(): SkillEntry[] {
    return Array.from(this.skills.values()).map(r => r.skill);
  }

  /**
   * Get a skill by name.
   */
  getSkill(name: string): SkillEntry | undefined {
    return this.skills.get(name)?.skill;
  }

  /**
   * Get the plugin ID that registered a skill.
   */
  getPluginId(name: string): string | undefined {
    return this.skills.get(name)?.pluginId;
  }

  /**
   * Get every skill registered by a given plugin.
   */
  getSkillsByPlugin(pluginId: string): SkillEntry[] {
    const skills: SkillEntry[] = [];
    for (const registered of this.skills.values()) {
      if (registered.pluginId === pluginId) {
        skills.push(registered.skill);
      }
    }
    return skills;
  }

  /**
   * Get the skills applicable to the current context.
   */
  getApplicableSkills(context: SkillContext): SkillEntry[] {
    const applicable: SkillEntry[] = [];

    for (const { skill } of this.skills.values()) {
      if (this.isSkillApplicable(skill, context)) {
        applicable.push(skill);
      }
    }

    // Sort by priority.
    applicable.sort((a, b) => {
      const priorityA = a.frontmatter.priority ?? 100;
      const priorityB = b.frontmatter.priority ?? 100;
      return priorityA - priorityB;
    });

    return applicable;
  }

  /**
   * Decide whether a skill applies to the current context.
   */
  private isSkillApplicable(skill: SkillEntry, context: SkillContext): boolean {
    const { frontmatter } = skill;

    // Check the agent whitelist (only when an agents field is present).
    if (frontmatter.agents && frontmatter.agents.length > 0) {
      if (!context.agentId || !frontmatter.agents.includes(context.agentId)) {
        return false;
      }
    }

    // Check whether this is an A2A skill (tags include 'a2a').
    const isA2ASkill = frontmatter.tags?.includes('a2a');
    if (isA2ASkill && !context.enableA2A) {
      // Skip A2A skills when A2A is disabled.
      return false;
    }

    // alwaysApply skills always load (once the checks above pass).
    if (frontmatter.alwaysApply) {
      return true;
    }

    // Check required tools.
    if (frontmatter.requiresTools && frontmatter.requiresTools.length > 0) {
      const hasAllTools = frontmatter.requiresTools.every(
        tool => context.tools.includes(tool)
      );
      if (!hasAllTools) {
        return false;
      }
    }

    // Load every skill without special conditions by default.
    return true;
  }

  /**
   * Get a skill's content.
   */
  async getSkillContent(name: string): Promise<string | null> {
    const registered = this.skills.get(name);
    if (!registered) {
      return null;
    }
    return registered.skill.content;
  }

  /**
   * Build the <available_skills> XML index (metadata only).
   *
   * This drives dynamic skill selection:
   * - Includes only name, description, and location.
   * - Omits full content (the model loads it on demand with a read tool).
   *
   * @param allowedSkills - Skill names permitted by the agent config (whitelist).
   * @returns The XML skills index.
   */
  formatSkillsForPrompt(allowedSkills: string[]): string {
    // Keep only skills allowed by the agent config.
    const skills = allowedSkills
      .map(name => this.getSkill(name))
      .filter((skill): skill is SkillEntry => skill !== undefined);

    if (skills.length === 0) {
      return '';
    }

    const skillsXml = skills.map(skill => {
      const description = skill.frontmatter.description || skill.frontmatter.name || skill.name;
      return `  <skill>
    <name>${skill.name}</name>
    <description>${description}</description>
    <location>${skill.path}</location>
  </skill>`;
    }).join('\n');

    return `<available_skills>\n${skillsXml}\n</available_skills>`;
  }

  /**
   * Get the alwaysApply skills.
   * Their full content is embedded directly into the system prompt.
   */
  getAlwaysApplySkills(allowedSkills: string[]): SkillEntry[] {
    return allowedSkills
      .map(name => this.getSkill(name))
      .filter((skill): skill is SkillEntry =>
        skill !== undefined && skill.frontmatter.alwaysApply === true
      );
  }

  /**
   * Get the dynamically selected skills (non-alwaysApply).
   * These appear only as index entries in the system prompt.
   */
  getDynamicSkills(allowedSkills: string[]): SkillEntry[] {
    return allowedSkills
      .map(name => this.getSkill(name))
      .filter((skill): skill is SkillEntry =>
        skill !== undefined && skill.frontmatter.alwaysApply !== true
      );
  }

  /**
   * Build the skills portion of the system prompt (progressive disclosure).
   *
   * Two tiers:
   * 1. alwaysApply skills — full content front-loaded into the prompt.
   * 2. Every allowed skill — name/description/location index only; the model
   *    reads full content on demand from <location>.
   *
   * @param allowedSkills - Skill names permitted by the agent config (whitelist).
   * @returns The assembled system-prompt fragment (empty string when nothing applies).
   */
  getSystemPrompt(allowedSkills: string[]): string {
    const sections: string[] = [];

    // Tier 1: front-load full content for alwaysApply skills.
    const alwaysApply = this.getAlwaysApplySkills(allowedSkills);
    for (const skill of alwaysApply) {
      sections.push(`<skill name="${skill.name}">\n${skill.content}\n</skill>`);
    }

    // Tier 2: index of every allowed skill (loaded on demand).
    const index = this.formatSkillsForPrompt(allowedSkills);
    if (index) {
      sections.push(index);
    }

    return sections.join('\n\n');
  }

  /**
   * Add a skill manually (not loaded from a file).
   */
  addSkill(skill: SkillEntry, opts?: SkillRegisterOptions): void {
    this.skills.set(skill.name, {
      skill,
      pluginId: opts?.pluginId,
      registeredAt: new Date(),
    });
    const source = opts?.pluginId ? ` (from plugin: ${opts.pluginId})` : '';
    console.log(`[SkillManager] Added skill: ${skill.name}${source}`);
  }

  /**
   * Remove a skill.
   */
  removeSkill(name: string): boolean {
    return this.skills.delete(name);
  }

  /**
   * Remove every skill registered by a given plugin.
   */
  removeSkillsByPlugin(pluginId: string): number {
    let count = 0;
    for (const [name, registered] of this.skills) {
      if (registered.pluginId === pluginId) {
        this.skills.delete(name);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[SkillManager] Removed ${count} skills from plugin: ${pluginId}`);
    }
    return count;
  }

  /**
   * Clear all skills.
   */
  clear(): void {
    this.skills.clear();
  }

  /**
   * Number of loaded skills.
   */
  get size(): number {
    return this.skills.size;
  }
}

// Default singleton instance.
let defaultManager: SkillManager | null = null;

/**
 * Get the default SkillManager instance.
 */
export function getSkillManager(): SkillManager {
  if (!defaultManager) {
    defaultManager = new SkillManager();
  }
  return defaultManager;
}

/**
 * Create a new SkillManager instance.
 */
export function createSkillManager(config?: Partial<SkillManagerConfig>): SkillManager {
  return new SkillManager(config);
}
