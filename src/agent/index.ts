/**
 * Agent module barrel.
 *
 * Agents are data (`AgentDefinition`); the roster comes from `agentRegistry.list()`. Delegation
 * is a single data-driven tool (`delegate_to_agent`) — adding an agent is one more definition,
 * not a new tool or class. This demo ships two: Vin (generalist, can delegate) and Researcher
 * (focused sub-agent, cannot re-delegate).
 */

export type { AgentDefinition } from './types.js';
export { agentRegistry } from './registry.js';
export { VIN } from './vin.js';
export { RESEARCHER } from './researcher.js';
export { runAgent } from './executor.js';
export { executeReActLoop, type ReActOptions } from './react-loop.js';
export { delegateTool, registerDelegation, MAX_DELEGATION_DEPTH } from './delegate.tool.js';
