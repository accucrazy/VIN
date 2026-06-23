/**
 * memory_search — demonstrates the memory plane through the MemoryAdapter seam.
 *
 * The tool never talks to a database directly: it asks the active adapter to hybrid-search.
 * Identity travels in the context (userId), defaulting to 'local' in single-user.
 * (In the demo the embedding seam throws until wired to a local embedder.)
 */

import type { AgentTool } from '../types.js';
import { getMemoryAdapter } from '../memory/index.js';

export const memorySearchTool: AgentTool = {
  name: 'memory_search',
  description: 'Search past conversation memory (hybrid keyword + vector).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for.' },
      limit: { type: 'number', description: 'Max results (default 5).' },
    },
    required: ['query'],
  },
  async execute(args, context) {
    const adapter = getMemoryAdapter();
    const userId = context?.userId ?? 'local';
    if (!adapter.hybridSearch) {
      return { success: false, error: 'hybridSearch not supported by the active memory backend' };
    }
    const results = await adapter.hybridSearch(userId, args.query, { maxResults: args.limit ?? 5 });
    return { success: true, data: results };
  },
};
