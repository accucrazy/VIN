/**
 * The ReAct loop — readable skeleton.
 *
 * This is the methodology, not the production engine (which is ~2500 lines carrying
 * business state). The shape it teaches:
 *   1. native Function Calling first
 *   2. regex/text parse as a fallback
 *   3. a FAIL-CLOSED gate: a regex-forged or policy-denied tool name never executes
 *
 * Skeleton: the provider and tool calls are real seams, but the demo is not wired to run.
 */

import { getProviderRegistry } from '../providers/registry.js';
import { ToolRegistry } from '../tools/registry.js';
import { checkToolPolicy } from '../policy/index.js';
import { formatToolResult } from '../context/tool-result-truncation.js';
import type { AgentMessage, AgentToolCall, AgentTrace, ToolPolicy, ProviderId } from '../types.js';
import type { ToolDefinition } from '../providers/types.js';

export interface ReActOptions {
  systemPrompt: string;
  /** Which provider to use. Defaults to env HARNESS_PROVIDER, else 'openai' (the default). */
  provider?: ProviderId;
  model?: string;
  maxIterations?: number;
  policy?: ToolPolicy;
  /** Single-user defaults to 'local'. SEAM — see src/cautionary/. */
  userId?: string;
  /** The running agent's id (so delegate_to_agent can block self-delegation). */
  agentId?: string;
  /** Delegation nesting depth; bounds recursive delegation (see delegate.tool.ts). */
  delegationDepth?: number;
}

export async function executeReActLoop(
  input: string,
  opts: ReActOptions
): Promise<{ answer: string; traces: AgentTrace[] }> {
  const providerId: ProviderId =
    opts.provider ?? (process.env.HARNESS_PROVIDER as ProviderId | undefined) ?? 'ollama';
  const provider = getProviderRegistry().get(providerId);
  if (!provider) throw new Error(`No provider registered: ${providerId}`); // loud-fail, not silent fallback

  const registry = ToolRegistry.getInstance();
  // The roster is derived from the registry — never hand-maintained.
  const toolDefs: ToolDefinition[] = registry.listTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as any,
  }));

  const messages: AgentMessage[] = [{ role: 'user', content: input }];
  const traces: AgentTrace[] = [];

  for (let i = 0; i < (opts.maxIterations ?? 8); i++) {
    const res = await provider.generateContent({
      systemPrompt: opts.systemPrompt,
      messages,
      model: opts.model ?? provider.getDefaultModel().id,
      tools: toolDefs,
    });

    // (1) native Function Calling path
    let calls: AgentToolCall[] = res.toolCalls ?? [];
    // (2) regex fallback when the model emitted a textual tool call instead of FC
    if (calls.length === 0) {
      const parsed = parseTextualToolCall(res.text);
      if (parsed) calls = [parsed];
    }
    // no tool call => final answer
    if (calls.length === 0) return { answer: res.text, traces };

    for (const call of calls) {
      // (3) FAIL-CLOSED GATE: unknown (e.g. regex-forged) name never executes
      if (!registry.get(call.name)) {
        messages.push({ role: 'tool', content: `error: unknown tool ${call.name}` });
        continue;
      }
      // policy gate — deny over allow, layered (see policy/)
      const gate = checkToolPolicy({ toolName: call.name, policy: opts.policy });
      if (!gate.allowed) {
        messages.push({ role: 'tool', content: `error: tool ${call.name} denied by policy: ${gate.reason}` });
        continue;
      }
      const result = await registry.execute(call, {
        userId: opts.userId ?? 'local',
        // agentState carries delegation context so delegate_to_agent can enforce depth/self-checks
        agentState: { agentId: opts.agentId, delegationDepth: opts.delegationDepth ?? 0 },
      });
      traces.push({ tool: call.name, input: call.arguments, output: result, duration: 0 });
      // store-then-reference: the model sees a truncated view; full result is cached
      messages.push({ role: 'tool', content: formatToolResult(result) });
    }
  }
  return { answer: '(max iterations reached)', traces };
}

/** Minimal text fallback parser. Production hardens this; here it documents the mechanism. */
function parseTextualToolCall(text: string): AgentToolCall | null {
  const m = text.match(/```tool\s*\n([\s\S]*?)\n```/);
  if (!m) return null;
  try {
    const { name, arguments: args } = JSON.parse(m[1]);
    return { name, arguments: args ?? {} };
  } catch {
    return null;
  }
}
