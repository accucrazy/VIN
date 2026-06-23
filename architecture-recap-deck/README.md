# VIN Architecture Recap Deck

This deck is the visual explanation of the harness engineering behind VIN.

It started as an internal architecture recap for The Pocket Company's production agent stack. In this open-source repo, it serves a different purpose: to show why VIN is shaped as an **AIOS harness** rather than a thin chatbot wrapper.

## View Locally

```bash
open architecture-recap-deck/index.html
```

Keyboard controls:

- Right arrow / space: next slide
- Left arrow: previous slide
- `p`: print

## What It Covers

- Tool runtime and MCP boundaries
- Browser / scraper / external tool discipline
- Session and tenant isolation
- Metering and quota seams
- Context feeding
- Memory lifecycle
- Skill platform
- Engineering discipline
- Why local-model agents need a harness

The PNG exports under `shots/` are kept for README, documentation, and product storytelling.
