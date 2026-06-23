# 09 — The Skill Platform: Progressive Disclosure

> A skill library should be able to grow to hundreds of entries without making every
> prompt more expensive. The way this code does that is **progressive disclosure**:
> index only the cheap metadata of every skill, and read the full body of a skill
> *on demand*, after the model has decided it is relevant. These are notes on that
> two-tier design and the small token-economy choices that make it pay off.

Grounded in:
- [`../src/skills/loader.ts`](../src/skills/loader.ts) — parsing `SKILL.md` (frontmatter + body), comment stripping
- [`../src/skills/manager.ts`](../src/skills/manager.ts) — the `<available_skills>` index, alwaysApply front-loading, on-demand content
- [`../src/skills/entries/example-skill/SKILL.md`](../src/skills/entries/example-skill/SKILL.md) — a worked example that explains itself

Related chapters: [07 — Context Feeding](07-context-feeding.md) (same "feed a slice, fetch the rest" instinct) · [10 — Engineering Discipline](10-engineering-discipline.md)

---

## What

A skill is a `SKILL.md` file: YAML frontmatter (name, description, tags, priority,
`alwaysApply`, optional gating fields) followed by a Markdown body of instructions.
The system prompt is assembled in **two tiers**
([`manager.ts → getSystemPrompt`](../src/skills/manager.ts)):

1. **`alwaysApply` skills** — full body front-loaded directly into the prompt.
2. **Every allowed skill** — a compact `<available_skills>` index of *name +
   description + location only*. The body is **not** in the prompt; the model reads it
   on demand from `<location>` using a `read` tool when it decides the skill applies.

So a library of 200 skills costs ~200 short index lines in the prompt, not 200 full
bodies. The bodies are pulled one at a time, only when needed.

## Why

This is the same instinct as [store-then-reference](07-context-feeding.md) applied to
instructions instead of tool results:

- **The prompt stays cheap.** What every prompt pays for is the *index*, which is a
  few lines per skill. Adding a skill adds a few tokens to every prompt, not a few
  hundred.
- **The library can grow.** Because cost scales with the index, not with body length,
  you can ship many specialized skills without a per-prompt tax.
- **The model self-selects.** The description in the index is what the model reads to
  decide relevance — so a good description is the whole interface. The body is loaded
  only after that decision, so irrelevant skills never cost their body.

`alwaysApply` is the deliberate exception: a small number of skills that must shape
*every* turn (house style, safety posture) are front-loaded in full because deferring
them defeats their purpose.

## How

### Parsing and the index

[`loader.ts`](../src/skills/loader.ts) reads a `SKILL.md`, splits the `---`-delimited
YAML frontmatter from the body (`parseSkillContent`), and infers the skill name from
the directory if `name` is absent. `scanAndLoadSkills` walks a directory tree and loads
every `SKILL.md` it finds.

[`manager.ts → formatSkillsForPrompt`](../src/skills/manager.ts) builds the index —
and note what it deliberately includes and omits:

```ts
const skillsXml = skills.map(skill => {
  const description = skill.frontmatter.description || skill.frontmatter.name || skill.name;
  return `  <skill>
    <name>${skill.name}</name>
    <description>${description}</description>
    <location>${skill.path}</location>
  </skill>`;
}).join('\n');
return `<available_skills>\n${skillsXml}\n</available_skills>`;
```

Name, description, location — **no body**. The `<location>` is the path the model reads
from when it wants the full instructions. The full body lives behind
`getSkillContent(name)`, fetched only on demand.

### Two tiers, assembled

`getSystemPrompt(allowedSkills)` puts the two tiers together:

```ts
// Tier 1: front-load full content for alwaysApply skills
for (const skill of alwaysApply) {
  sections.push(`<skill name="${skill.name}">\n${skill.content}\n</skill>`);
}
// Tier 2: index of every allowed skill (loaded on demand)
const index = this.formatSkillsForPrompt(allowedSkills);
```

`getAlwaysApplySkills` and `getDynamicSkills` split the allowed set by the
`alwaysApply` flag, so the two tiers never overlap. The `allowedSkills` argument is the
per-agent whitelist — an agent only ever sees the skills its config permits.

### Applicability filtering

Before a skill is even a candidate, `getApplicableSkills` / `isSkillApplicable` filter
by context: an `agents` whitelist in the frontmatter, an `a2a` tag gated on
`context.enableA2A`, and a `requiresTools` list that must be satisfied by the tools
actually available. `alwaysApply` skills short-circuit to applicable once those gates
pass. Results are sorted by `priority` (default 100, lower first), so the most
important skills lead.

### Token economy: comment stripping

`SKILL.md` bodies are authored documents — they can carry HTML comments and loose
spacing. `loader.ts → cleanSkillContent` strips them on load:

```ts
content
  .replace(/<!--[\s\S]*?-->/g, '')  // drop HTML comments (authoring notes, TODOs)
  .replace(/\n{3,}/g, '\n\n')        // collapse runs of blank lines
  .trim();
```

This means a skill author can leave `<!-- maintainer notes -->` in the file for humans
without paying for them in tokens every time the body is loaded. Small, but it is the
same theme as everywhere else in the harness: don't spend context on bytes the model
doesn't need.

### A skill that explains itself

The shipped example
([`entries/example-skill/SKILL.md`](../src/skills/entries/example-skill/SKILL.md))
makes the mechanism legible — its own body states that only the frontmatter is indexed
and the body is read on demand. `alwaysApply: false` and `priority: 10` are set so it
behaves as a normal on-demand skill.

## How this fits together

The skill platform here is not "paste all the instructions into the prompt." It is an
index of capabilities the model can choose from, plus a way to pull the chosen one's
details on demand. The index stays cheap (metadata only, comments stripped), only what
truly must apply every turn is front-loaded, and the library scales with the number of
skills instead of the token budget.
