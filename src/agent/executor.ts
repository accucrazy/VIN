/**
 * Executor — a thin seam from an AgentDefinition to the ReAct loop.
 *
 * Keeps the agent (data) separate from the loop (mechanism). In production this is where
 * usage metering, error-recovery, and delegation hang off; here it stays minimal.
 */

import type { AgentDefinition } from './types.js';
import { executeReActLoop } from './react-loop.js';

export async function runAgent(
  agent: AgentDefinition,
  input: string,
  opts?: { delegationDepth?: number }
) {
  return executeReActLoop(input, {
    systemPrompt: agent.systemPrompt,
    provider: agent.provider,
    model: agent.defaultModel,
    policy: agent.policy,
    userId: 'local', // single-user. SEAM — see src/cautionary/.
    agentId: agent.id,
    delegationDepth: opts?.delegationDepth ?? 0,
  });
}
