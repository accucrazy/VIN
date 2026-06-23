/**
 * echo — the minimal AgentTool. Demonstrates the authoring pattern: name + description +
 * inputSchema + execute(args, context). Nothing more is required to be a first-class capability.
 */

import type { AgentTool } from '../types.js';

export const echoTool: AgentTool = {
  name: 'echo',
  description: 'Echo back the given text. Demonstrates the AgentTool authoring pattern.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'Text to echo back.' } },
    required: ['text'],
  },
  async execute(args) {
    return { success: true, data: args.text };
  },
};
