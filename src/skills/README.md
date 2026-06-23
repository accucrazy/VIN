# `skills/` — progressive-disclosure skill loader

Skills are `SKILL.md` files: YAML frontmatter (metadata) + Markdown body (instructions). The point
of this module is **progressive disclosure** — the prompt carries only a small index of every skill,
and the full body is read **on demand** after the model decides a skill is relevant. So the library
can grow large without bloating every prompt. Read this before the files; it tells you the
frontmatter contract and the two-tier prompt assembly.

## What each file is

- **`loader.ts`** — pure file I/O + parsing. `parseSkillContent` (splits `---` frontmatter from
  body, strips HTML comments and excess blank lines to save tokens), `loadSkillFile`,
  `scanAndLoadSkills` (recursive directory scan for `SKILL.md`), `inferSkillName` (falls back to the
  directory name).
- **`manager.ts`** — `SkillManager` (singleton via `getSkillManager()`; `createSkillManager()` for a
  fresh one). Loads/holds skills, filters by context, tracks plugin provenance, and **builds the
  skills portion of the system prompt**. The important method is `getSystemPrompt(allowedSkills)`.
- **`types.ts`** — `SkillFrontmatter`, `SkillEntry`, `SkillContext`, `SkillManagerConfig`,
  `DEFAULT_SKILL_CONFIG` (scans `src/skills/entries`, `autoLoad`, 1-min cache TTL).
- **`entries/`** — the shipped demo skill (`example-skill/SKILL.md`). The default scan root.
- **`index.ts`** — barrel.

## The `SKILL.md` frontmatter contract

```yaml
---
name: concise-summaries          # optional; inferred from dir name if omitted
description: …                    # shown in the <available_skills> index
tags: [writing, summarization]    # classification/filtering; tag `a2a` gates on enableA2A
priority: 10                      # lower wins when sorting applicable skills (default 100)
alwaysApply: false                # true → full body front-loaded into every prompt
requiresTools: [some_tool]        # skill loads only when all listed tools are present
agents: [vin]                     # whitelist; if omitted, any agent may load it
---
# Markdown body — the instructions, read on demand
```

(`globs` exists in the type but is reserved / unused.) `isSkillApplicable` checks, in order: agent
whitelist → A2A gating → `alwaysApply` short-circuit → `requiresTools`.

## The two tiers (progressive disclosure)

`getSystemPrompt(allowedSkills)` emits two sections:

1. **`alwaysApply` skills** → full content embedded directly (`<skill name="…">…body…</skill>`).
   Use sparingly; this content rides in every prompt.
2. **Every allowed skill** → an `<available_skills>` index of `name` / `description` / `location`
   only. The body is **not** included; the model reads it from `<location>` with a read tool when it
   judges the skill relevant.

```
<available_skills>
  <skill><name>…</name><description>…</description><location>…/SKILL.md</location></skill>
</available_skills>
```

The demo skill `entries/example-skill/SKILL.md` (`alwaysApply: false`) exists to make this visible:
only its frontmatter reaches the prompt as an index entry; the body is loaded on demand.

## The seams to swap

| Want to change | Touch |
|---|---|
| Where skills are loaded from | `SkillManagerConfig.skillsDirectory` / `loadSkills(dirs)` |
| Which skills an agent may use | the `allowedSkills` whitelist passed to `getSystemPrompt` |
| When a skill applies | the frontmatter (`agents`, `requiresTools`, `tags`, `priority`) |
| Plugin-provided skills | register with `{ pluginId }`; `removeSkillsByPlugin` for teardown |
