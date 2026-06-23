/**
 * Agent registry — the roster as data.
 *
 * Adding an agent = registering an AgentDefinition; the roster comes from `list()`, never
 * hand-maintained. Delegation (delegate_to_agent) looks targets up here at call time.
 */

import type { AgentDefinition } from './types.js';
import { VIN } from './vin.js';
import { RESEARCHER } from './researcher.js';

class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();
  register(a: AgentDefinition): void {
    this.agents.set(a.id, a);
  }
  unregister(id: string): boolean {
    return this.agents.delete(id);
  }
  get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }
  /** The roster — derived, not hand-maintained. */
  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }
}

export const agentRegistry = new AgentRegistry();
agentRegistry.register(VIN); // generalist; allowed to delegate
agentRegistry.register(RESEARCHER); // focused sub-agent; not allowed to re-delegate
