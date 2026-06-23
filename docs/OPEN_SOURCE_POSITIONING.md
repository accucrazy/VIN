# VIN Open-Source Positioning

VIN is packaged for builders who want the agent stack to live close to their data.

The project deliberately combines two ideas:

1. **Hermes-style provider pluggability**  
   Search, model runtime, and external tools should be selected by configuration, not hard-coded into the app.

2. **OpenClaw-style local action**  
   When an API key is not available, the agent should still be able to use local capabilities such as a real browser, files, tools, and eventually desktop automation.

## What VIN Optimizes For

- Local models first: Qwen, Nemotron, Gemma, or any OpenAI-compatible endpoint.
- Enterprise data boundaries: no default cloud model dependency.
- Tool visibility: users should see what the agent called, why, and what came back.
- Swappable infrastructure: Ollama today, vLLM tomorrow, a managed cloud endpoint only when explicitly configured.
- Honest open source: no hidden hosted dependency required for the default demo.

## What VIN Borrows From Other Agent Runtimes

| Runtime | Lesson VIN adopts |
|---|---|
| Hermes Agent | Provider plugins for web search/extract; config-driven backend selection. |
| OpenClaw | Local-first gateway mindset; real browser/computer-use path when API search is not configured. |
| TPC-AIOS | ReAct loop, tool contract, policy gate, memory lifecycle, and skill platform. |

## Current Scope

VIN currently ships:

- a TypeScript agent harness,
- Ollama-native local model support,
- OpenAI-compatible runtime support,
- MCP client seams,
- SQLite-backed memory,
- browser-backed web search,
- a standalone Next.js chat UI,
- and the architecture recap deck.

The next logical open-source additions are:

- `web_extract` / `web_fetch` with the same provider registry,
- SSE bridge between the harness and web UI,
- richer multi-agent delegation traces,
- and a local computer-use MCP adapter.
