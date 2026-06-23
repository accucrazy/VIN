# `providers/` — the provider-agnostic LLM layer

One uniform interface (`LLMProvider`) that every model backend implements. Everything above this
layer — the [ReAct loop](../agent/), [summarization](../context/) — speaks `GenerateParams` in and
`GenerateResult` out and **never imports a vendor SDK**. Read this before the files; it tells you the
contract and exactly how to add a provider.

## What each file is

- **`types.ts`** — the contract. `LLMProvider` (the interface), `GenerateParams` / `GenerateResult`
  / `TokenUsage`, the provider-agnostic `ToolDefinition`, `ModelInfo` (+ `ModelTier`),
  `ReasoningConfig` / `ReasoningLevel`, and the normalized `ProviderError` (+ `ProviderErrorType`).
- **`registry.ts`** — `ProviderRegistry` and the global `providerRegistry` singleton
  (`getProviderRegistry()`). The one place the harness asks "which providers/models exist and which
  are usable right now". `initializeProviders()` registers the default and marks the registry
  initialized.
- **`openai.ts`** — the default `OpenAIProvider` (`createOpenAIProvider()`). One file: env-driven
  config, message formatting, and the implementation. Imports only `fetch`.
- **`gemini.ts`** — the optional `GeminiProvider` (`createGeminiProvider()`). Uses the `@google/genai`
  SDK; native function calling + thought-signature passthrough; key from env only. Registered only
  when `GEMINI_API_KEY` is set.
- **`index.ts`** — the public surface (re-exports the above).

## The contract

```ts
interface LLMProvider {
  readonly id: ProviderId;
  readonly name: string;
  isAvailable(): boolean;                                  // usable? (key present, or local)
  generateContent(params: GenerateParams): Promise<GenerateResult>;
  getModels(): ModelInfo[];
  getDefaultModel(): ModelInfo;
  getModel(modelId: string): ModelInfo | undefined;
  validateApiKey?(): Promise<boolean>;                     // optional
}
```

`GenerateResult.toolCalls` is what feeds the loop's **native function-calling path**; when it is
empty the loop falls back to regex (see [`../agent/`](../agent/)).

## The OpenAI-compatible default

`openai.ts` talks to **any** OpenAI Chat Completions endpoint — the official API, or a local Ollama
/ vLLM / LM Studio server — by varying `OPENAI_BASE_URL` / `OPENAI_MODEL`. The default base URL is a
local Ollama (`http://localhost:11434/v1`), so the demo needs no cloud key. Config is read from the
environment with **no literal key fallbacks** (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`).

Two non-obvious bits worth knowing before you read the code:

- **Message formatting** (`formatMessagesForOpenAI`, a pure function) is where most cross-provider
  400s come from. It maps the harness's `AgentMessage[]` onto OpenAI's shape, pairing each `tool`
  result back to the prior assistant turn's `tool_call_id`s in order — get this wrong and the API
  rejects the request.
- **Reasoning + tools** is handled defensively: reasoning models reject `reasoning_effort` together
  with function tools on `/v1/chat/completions`, so when tools are present the provider drops
  `reasoning_effort` rather than 400 on every turn.

`ReasoningLevel` is unified across providers; each maps it onto its own knob. `xhigh` is OpenAI-only;
other providers should degrade it to their max.

## How to add a provider

1. **Implement `LLMProvider`** in a new file (e.g. a Gemini or Anthropic adapter) — map your
   vendor's request/response onto `GenerateParams` / `GenerateResult`, and normalize errors to
   `ProviderError` so retry/fallback decisions stay provider-independent.
2. **Register it** in `initializeProviders()` (`registry.ts`):
   ```ts
   providerRegistry.register(createMyProvider());
   ```

That is the whole change. The rest of the harness depends only on the interface, so nothing else
moves — remember to widen the `ProviderId` union in [`../types.ts`](../types.ts) when you add an id.

**Worked example: `gemini.ts`.** The optional Gemini provider (`createGeminiProvider()`) is exactly
this recipe applied — it implements `LLMProvider`, keeps native function calling and thought-signature
passthrough, reads `GEMINI_API_KEY` from the env (no literal key), and is registered in
`initializeProviders()` only when that key is set. The default stays the OpenAI-compatible provider; set
`HARNESS_PROVIDER=gemini` (or `provider: 'gemini'` on an `AgentDefinition`) to use it.
