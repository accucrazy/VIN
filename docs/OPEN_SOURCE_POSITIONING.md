# VIN Open-Source Positioning

VIN is packaged for builders who want the agent stack to live close to their data.

VIN is also a public packaging of The Pocket Company / Turn Cloud / TSpace agent direction: local model runtime, multi-agent harness engineering, and tool visibility for enterprise workflows.

中文定位：VIN 是 The Pocket Company、Turn Cloud（騰雲科技）與 TSpace 生態下的開源 AIOS 實驗包裝。目標不是做另一個雲端聊天機器人，而是把「本地模型 + harness 工程 + 工具治理 + 多代理協作」整理成能被企業自架、檢查、改造的開源基座。

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
- and open-source positioning / setup documentation.

The next logical open-source additions are:

- `web_extract` / `web_fetch` with the same provider registry,
- SSE bridge between the harness and web UI,
- richer multi-agent delegation traces,
- and a local computer-use MCP adapter.
