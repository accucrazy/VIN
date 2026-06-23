# Model selection for VIN

This guide is opinionated: it tells you which on-prem model to pick for which
job, what the gotchas are, and where each fails. All recommendations are tested
against the VIN ReAct loop's specific demands (tool calling + multi-turn
delegation + structured memory recall).

---

## The one-line answer

> **Start with `qwen2.5:14b`. Move to `nemotron:70b` if you need deep reasoning,
> or `gemma3:12b` if you need vision. Drop to `qwen2.5:7b` only if VRAM is tight.**

---

## How to read the table

- **FC** = native function calling. ✓ = emits JSON `tool_calls` reliably. ◐ = works but you'll lean on the regex fallback. ✗ = don't expect it.
- **Tool-use score (1-5)** is VIN's subjective rating after running the harness's standard tool roster (`echo`, `web_fetch`, `memory_search`, `delegate_to_agent`) for 100+ turns.
- **VRAM** is for Q4_K_M quantization. FP16 is ~2-3× higher.

---

## Qwen family — recommended primary

| Model | Context | FC | Tool-use | VRAM (Q4) | Best for |
|---|---|---|---|---|---|
| `qwen2.5:7b` | 32k | ✓ | 4 | ~5GB | Edge, low-RAM laptops |
| `qwen2.5:14b` | 32k | ✓ | **5** | ~9GB | **VIN default** — sweet spot |
| `qwen2.5:32b` | 32k | ✓ | 5 | ~19GB | Heavier workloads with tools |
| `qwen2.5:72b` | 128k | ✓ | 5 | ~48GB | Long-context analysis |
| `qwen2.5-coder:32b` | 32k | ✓ | 5 (code) | ~19GB | Code-heavy delegation |

**Why Qwen for VIN:** Alibaba tuned the 2.5 series explicitly for agent / tool
workloads. The 14B is the cheapest model that consistently emits well-formed
JSON `tool_calls` over 8+ turns without the regex fallback kicking in.

**Gotchas:**
- 32k context is the *advertised* limit; real-world quality on agent traces
  starts degrading past ~24k. If you need true 128k context, jump to 72B.
- Coder variant is significantly better at code-edit tools but slightly weaker
  at general reasoning — use `delegate_to_agent` to route code tasks to it.

---

## Nemotron family — enterprise reasoning

| Model | Context | FC | Tool-use | VRAM (Q4) | Best for |
|---|---|---|---|---|---|
| `nemotron-mini:4b` | 4k | ✓ | 3 | ~2.5GB | Edge agents (Raspberry Pi 5 / mini PC) |
| `nemotron:70b` | 128k | ◐ | 4 | ~43GB | Long-chain reasoning, root-cause analysis |

**Why Nemotron:** NVIDIA fine-tuned Llama 3.1 70B specifically for reasoning
benchmarks (RewardBench, Arena-Hard). It thinks slower but goes deeper than
Qwen on multi-step problems where each step builds on the last.

**Gotchas:**
- Function calling is less reliable than Qwen — expect the regex fallback to
  kick in occasionally. The VIN loop handles this correctly, but it slightly
  slows multi-tool turns.
- 70B is a serious VRAM commitment; do not deploy without 2× A100 40GB / 1× H100.
- `nemotron-mini:4b` is genuinely useful on edge but **not** strong at
  multi-step delegation — use it as a focused sub-agent that another model
  hands work to, not as VIN itself.

---

## Gemma family — Google open-weight

| Model | Context | FC | Tool-use | VRAM (Q4) | Best for |
|---|---|---|---|---|---|
| `gemma2:9b` | 8k | ◐ | 3 | ~6GB | Small footprint, safety-tuned outputs |
| `gemma2:27b` | 8k | ◐ | 3.5 | ~16GB | Better quality, still 8k context |
| `gemma3:12b` | 128k | ✓ | 4 | ~8GB | **Multimodal (text + image)**, long context |

**Why Gemma:** Google's safety tuning is the strongest in the open-weight set
— if your agent will surface answers to end users in a regulated context (HR,
medical, finance) and you don't have human review in the loop, Gemma's output
distribution is the most defensible.

**Gotchas:**
- Gemma 2's 8k context is genuinely small for an agent — store-then-reference
  context feeding in VIN helps but won't save you on long sessions. Prefer Gemma 3.
- Gemma 2 series tool-calling is the weakest of the three families; expect
  more regex-fallback turns.
- Gemma 3 12B's vision input is mediocre on detailed charts but solid on
  photos / documents / screenshots — fine for most agent use cases.

---

## How to switch models at runtime

Three ways, in increasing scope:

```bash
# 1. Per-process default (env)
OLLAMA_MODEL=qwen2.5:32b npx tsx src/index.ts
```

```ts
// 2. Per-agent definition (code)
export const POWER_VIN: AgentDefinition = {
  ...VIN,
  id: 'vin-power',
  model: 'nemotron:70b',
};
```

```ts
// 3. Per-call (advanced — bypasses agent default)
const res = await executeReActLoop(input, {
  systemPrompt: VIN.systemPrompt,
  model: 'gemma3:12b',
  provider: 'ollama',
});
```

---

## When to add a model that's not in the catalog

Just pull it via Ollama. The Ollama provider auto-discovers anything in
`/api/tags` on first call:

```bash
ollama pull deepseek-r1:32b
# next VIN startup logs:
# [OllamaProvider] Discovered 1 extra local model(s): deepseek-r1:32b
```

Then set `OLLAMA_MODEL=deepseek-r1:32b` in `.env`. To give it proper context
window / reasoning-level metadata, add a row to `OLLAMA_MODELS_BUILTIN` in
`src/providers/ollama.ts`.

---

## What VIN does *not* recommend (and why)

| Model | Why we don't ship it as a preset |
|---|---|
| Llama 3.1 base | Decent quality but Nemotron strictly dominates it for reasoning, and Qwen dominates it for tool use |
| Mistral 7B base | Tool calling is unreliable enough to need heavy prompt tuning |
| Phi-3 family | Small + capable, but VIN's regex-fallback assumptions break on its specific failure modes |
| Anything below 4B without a coder/agent fine-tune | The tool gate will refuse most of what they emit |

These all still work via the auto-discovery path — just don't expect VIN to
have hand-tuned for them.
