/**
 * delegate_to_agent — the multi-agent (A2A) seam, as one data-driven tool.
 *
 * An agent is a row of data, and delegation is a single tool — not a per-target fork. The tool
 * looks the target up in the registry, runs its own ReAct loop, and returns its answer
 * (spawn-and-return). A depth counter bounds recursion, and an agent can't delegate to itself.
 *
 * This mirrors the production `delegate_to_agent` after its rewrite to a single data-driven tool;
 * the streaming, metering, and concurrency-lane machinery around it are left out of the demo.
 */

import type { AgentTool } from '../types.js';
import { ToolRegistry } from '../tools/registry.js';
import { agentRegistry } from './registry.js';
import { runAgent } from './executor.js';

export const MAX_DELEGATION_DEPTH = 3;

export const delegateTool: AgentTool = {
  name: 'delegate_to_agent',
  description: 'Delegate a self-contained task to another registered agent and return its answer.',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: "Target agent id (e.g. 'researcher')." },
      task: { type: 'string', description: 'The full, self-contained task to hand off.' },
    },
    required: ['agentId', 'task'],
  },
  async execute(args, context) {
    // Delegation context travels in agentState (set by the loop), not a global.
    const depth = (context?.agentState?.delegationDepth as number) ?? 0;
    if (depth >= MAX_DELEGATION_DEPTH) {
      return { success: false, error: `max delegation depth (${MAX_DELEGATION_DEPTH}) reached` };
    }
    const caller = context?.agentState?.agentId as string | undefined;
    if (args.agentId === caller) {
      return { success: false, error: 'an agent cannot delegate to itself' };
    }
    const child = agentRegistry.get(args.agentId);
    if (!child) {
      const available = agentRegistry.list().map((a) => a.id).join(', ');
      return { success: false, error: `unknown agent '${args.agentId}'. Available: ${available}` };
    }
    // spawn-and-return: run the child's own ReAct loop, one level deeper.
    const result = await runAgent(child, args.task, { delegationDepth: depth + 1 });
    return { success: true, data: { agentId: child.id, answer: result.answer } };
  },
};

/** Register delegate_to_agent into the global ToolRegistry. Call once at startup. */
export function registerDelegation(): void {
  ToolRegistry.getInstance().register(delegateTool, { source: 'core' });
}
