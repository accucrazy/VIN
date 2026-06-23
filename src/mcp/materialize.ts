/**
 * Materialize an MCP tool into an internal AgentTool.
 *
 * one contract, two boundaries: external MCP tools become ordinary AgentTools.
 *
 * - naming:  mcp__<safeServer>__<safeTool> (sanitize + collision suffix)
 * - schema:  MCP inputSchema -> repo JSONSchema (top-level object enforced; skip if not representable)
 * - result:  CallToolResult -> AgentToolResultStandard, text data wrapped as untrusted
 * - errors:  always return a valid result, so the ReAct loop never has a dangling call
 */

import type { AgentTool, AgentToolResult, JSONSchema, JSONSchemaProperty } from '../types.js';
import { MCP_TOOL_NAME_PREFIX } from '../tools/tool-name.js';
import { wrapExternalContent } from '../security/external-content.js';
import type { McpServerConfig, McpToolDescriptor } from './types.js';

// ==================== Naming ====================

/**
 * Sanitize a string into a function-name-safe component ([a-z0-9_]).
 *
 * Always **lowercased**: the fail-closed gate calls normalizeToolName() which
 * lowercases, while registry lookup is case-sensitive. If the materialized name
 * kept its original casing, any lowercasing layer (text fallback / provider) would
 * cause "the gate allows but registry lookup misses". All-lowercase makes
 * normalize(name) === name === the registered name, consistent with existing tool
 * naming conventions. (When actually calling the MCP server, the original tool name
 * is used — see buildMcpAgentTool's originalToolName.)
 */
export function sanitizeNameComponent(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'x';
}

/** Build the materialized tool name, using a reserved set to avoid collisions. */
export function buildMaterializedName(serverId: string, toolName: string, reserved: Set<string>): string {
  const base = `${MCP_TOOL_NAME_PREFIX}${sanitizeNameComponent(serverId)}__${sanitizeNameComponent(toolName)}`;
  if (!reserved.has(base)) {
    return base;
  }
  let n = 2;
  while (reserved.has(`${base}_${n}`)) {
    n += 1;
  }
  return `${base}_${n}`;
}

// ==================== Schema ====================

/**
 * MCP inputSchema -> repo JSONSchema.
 * - missing / non-object -> treat as a no-arg tool { type:'object', properties:{} }
 * - explicit non-object type -> not representable -> return null (caller skips the tool)
 * - definitions -> $defs (preserved for provider compatibility)
 */
export function toAgentInputSchema(mcp: unknown): JSONSchema | null {
  if (!mcp || typeof mcp !== 'object') {
    return { type: 'object', properties: {} };
  }
  const s = mcp as Record<string, unknown>;
  if (s.type !== undefined && s.type !== 'object') {
    return null;
  }
  const properties = s.properties && typeof s.properties === 'object'
    ? (s.properties as Record<string, JSONSchemaProperty>)
    : {};
  const out: Record<string, unknown> = { ...s, type: 'object', properties };
  if (s.definitions && !s.$defs) {
    out.$defs = s.definitions;
    delete out.definitions;
  }
  return out as unknown as JSONSchema;
}

// ==================== Tool filter ====================

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Filter by config.tools.include/exclude (glob: '*' matches anything). */
export function applyToolFilter(
  descriptors: McpToolDescriptor[],
  filter?: McpServerConfig['tools'],
): McpToolDescriptor[] {
  if (!filter) {
    return descriptors;
  }
  const inc = filter.include?.map(globToRegExp);
  const exc = filter.exclude?.map(globToRegExp);
  return descriptors.filter((d) => {
    if (inc && inc.length > 0 && !inc.some((re) => re.test(d.name))) {
      return false;
    }
    if (exc && exc.some((re) => re.test(d.name))) {
      return false;
    }
    return true;
  });
}

// ==================== Result normalization ====================

interface RawCallToolResult {
  content?: Array<Record<string, unknown>>;
  isError?: boolean;
  structuredContent?: unknown;
}

/** Extract text from content[]; downgrade non-text blocks to a short text summary. */
function extractText(content?: Array<Record<string, unknown>>): string {
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const block of content) {
    const type = block?.type;
    if (type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (type === 'image') {
      parts.push(`[image ${typeof block.mimeType === 'string' ? block.mimeType : ''}]`.trim());
    } else if (type === 'resource' || type === 'resource_link') {
      parts.push(`[resource]`);
    } else if (type === 'audio') {
      parts.push(`[audio]`);
    } else {
      try {
        parts.push(JSON.stringify(block));
      } catch {
        parts.push('[unserializable content]');
      }
    }
  }
  return parts.join('\n');
}

/**
 * CallToolResult -> AgentToolResultStandard.
 * External returns are untrusted by nature: successful text data is wrapped as
 * untrusted right here (source:'mcp').
 */
export function normalizeMcpResult(
  raw: unknown,
  serverId: string,
  toolName: string,
): AgentToolResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as RawCallToolResult;
  const text = extractText(r.content);

  if (r.isError) {
    return {
      success: false,
      error: text || `MCP tool ${toolName} returned an error`,
      metadata: { mcpServer: serverId, mcpTool: toolName },
    };
  }

  const wrapped = wrapExternalContent(text, {
    source: 'mcp',
    sourceLabel: `${serverId}/${toolName}`,
    includeWarning: true,
  });

  const metadata: Record<string, unknown> = { mcpServer: serverId, mcpTool: toolName };
  if (r.structuredContent !== undefined && r.structuredContent !== null) {
    metadata.structuredContent = r.structuredContent;
  }

  return { success: true, data: wrapped, metadata };
}

// ==================== Build AgentTool ====================

/**
 * Wrap a single MCP tool descriptor into an internal AgentTool.
 * @param callFn Provided by the runtime; calls the matching server's client.callTool(originalName, args)
 */
export function buildMcpAgentTool(params: {
  serverId: string;
  descriptor: McpToolDescriptor;
  materializedName: string;
  inputSchema: JSONSchema;
  callFn: (originalToolName: string, args: Record<string, unknown>) => Promise<unknown>;
}): AgentTool {
  const { serverId, descriptor, materializedName, inputSchema, callFn } = params;
  const originalToolName = descriptor.name;

  return {
    name: materializedName,
    description: descriptor.description?.trim()
      || `MCP tool "${originalToolName}" from server "${serverId}"`,
    inputSchema,
    category: 'custom',
    async execute(args, _context) {
      try {
        const raw = await callFn(originalToolName, (args ?? {}) as Record<string, unknown>);
        return normalizeMcpResult(raw, serverId, originalToolName);
      } catch (err) {
        return {
          success: false,
          error: `MCP tool ${originalToolName} (server ${serverId}) failed: ${(err as Error).message}`,
          metadata: { mcpServer: serverId, mcpTool: originalToolName },
        };
      }
    },
  };
}
