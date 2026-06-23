/**
 * Tools barrel — registers the built-in demo tools into the global registry.
 *
 * Each tool demonstrates a different harness plane:
 *   echo          → the authoring pattern
 *   web_fetch     → security in the runtime (SSRF + untrusted-content boundary)
 *   memory_search → the memory plane via the MemoryAdapter seam
 */

import { ToolRegistry } from './registry.js';
import { echoTool } from './echo.tool.js';
import { webFetchTool } from './web-fetch.tool.js';
import { webSearchTool } from './web-search.tool.js';
import { memorySearchTool } from './memory-search.tool.js';

export { ToolRegistry, toolRegistry } from './registry.js';
export * from './tool-name.js';
export { echoTool, webFetchTool, webSearchTool, memorySearchTool };

/** Register the built-in demo tools (source: 'core'). Call once at startup. */
export function registerBuiltinTools(): void {
  const registry = ToolRegistry.getInstance();
  registry.registerAll(
    [echoTool, webFetchTool, webSearchTool, memorySearchTool],
    { source: 'core' },
  );
}
