---
name: concise-summaries
description: How to write a tight, faithful summary. Loaded on demand when the user asks for a summary.
tags: [writing, summarization]
priority: 10
alwaysApply: false
---

# Concise summaries

This skill demonstrates **progressive disclosure**: only the frontmatter above is injected into
the system prompt as part of the `<available_skills>` index. This full body is read *on demand*
(via the `read` tool) only after the model decides the skill is relevant — so the skill library
can grow large without bloating every prompt.

## Instructions

1. Lead with the single most important point in one sentence.
2. Keep only claims supported by the source. Never invent specifics.
3. Prefer concrete nouns and numbers over adjectives.
4. End with the one thing the reader should do or decide next, if any.

## Anti-patterns

- Restating the prompt back to the user.
- Hedging ("it depends", "various factors") without saying on what.
- Burying the conclusion under preamble.
