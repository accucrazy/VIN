/**
 * SKILL.md loader.
 *
 * Reads and parses SKILL.md files.
 * Supports YAML frontmatter and Markdown content.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillEntry, SkillFrontmatter, ParsedSkill } from './types.js';

/**
 * Parse YAML frontmatter.
 * Simplified version — only supports basic key: value pairs.
 */
function parseYamlFrontmatter(yamlContent: string): SkillFrontmatter {
  const result: SkillFrontmatter = {};
  const lines = yamlContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();

    // Arrays (simplified).
    if (value.startsWith('[') && value.endsWith(']')) {
      const arrayContent = value.slice(1, -1);
      const items = arrayContent.split(',').map(item =>
        item.trim().replace(/^["']|["']$/g, '')
      ).filter(Boolean);
      (result as any)[key] = items;
    }
    // Booleans.
    else if (value === 'true') {
      (result as any)[key] = true;
    }
    else if (value === 'false') {
      (result as any)[key] = false;
    }
    // Numbers.
    else if (/^\d+$/.test(value)) {
      (result as any)[key] = parseInt(value, 10);
    }
    // Strings.
    else {
      (result as any)[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  return result;
}

/**
 * Clean skill content, stripping comments to save tokens.
 *
 * Removes:
 * - HTML comments <!-- ... -->
 * - Excess consecutive blank lines (3+ newlines collapse to 2)
 */
function cleanSkillContent(content: string): string {
  return content
    // Remove HTML comments (including multi-line).
    .replace(/<!--[\s\S]*?-->/g, '')
    // Collapse runs of blank lines (3+ newlines become 2).
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse the contents of a SKILL.md file.
 * Supports YAML frontmatter (delimited by ---).
 * Automatically cleans comments to save tokens.
 */
export function parseSkillContent(fileContent: string): ParsedSkill {
  let frontmatter: SkillFrontmatter = {};
  let content = fileContent;

  // Check for frontmatter.
  if (fileContent.startsWith('---')) {
    const endIndex = fileContent.indexOf('---', 3);
    if (endIndex !== -1) {
      const yamlContent = fileContent.slice(3, endIndex).trim();
      frontmatter = parseYamlFrontmatter(yamlContent);
      content = fileContent.slice(endIndex + 3).trim();
    }
  }

  // Clean content, removing comments and excess blank lines.
  content = cleanSkillContent(content);

  return { frontmatter, content };
}

/**
 * Infer a skill name from its path.
 */
export function inferSkillName(skillPath: string): string {
  // Use the directory name as the skill name.
  const dir = path.dirname(skillPath);
  const dirName = path.basename(dir);
  return dirName;
}

/**
 * Load a single SKILL.md file.
 */
export function loadSkillFile(filePath: string): SkillEntry | null {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[SkillLoader] File not found: ${filePath}`);
      return null;
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, content } = parseSkillContent(fileContent);

    const name = frontmatter.name || inferSkillName(filePath);

    return {
      name,
      path: filePath,
      frontmatter,
      content,
      loadedAt: new Date(),
    };
  } catch (error) {
    console.error(`[SkillLoader] Failed to load skill: ${filePath}`, error);
    return null;
  }
}

/**
 * Scan a directory and load every SKILL.md file found.
 */
export function scanAndLoadSkills(
  directory: string,
  recursive: boolean = true
): SkillEntry[] {
  const skills: SkillEntry[] = [];

  try {
    if (!fs.existsSync(directory)) {
      console.warn(`[SkillLoader] Directory not found: ${directory}`);
      return skills;
    }

    const entries = fs.readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory() && recursive) {
        // Recurse into subdirectories.
        skills.push(...scanAndLoadSkills(fullPath, recursive));
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        // Load the SKILL.md.
        const skill = loadSkillFile(fullPath);
        if (skill) {
          skills.push(skill);
        }
      }
    }
  } catch (error) {
    console.error(`[SkillLoader] Failed to scan directory: ${directory}`, error);
  }

  return skills;
}
