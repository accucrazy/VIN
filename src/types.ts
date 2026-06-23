/**
 * TPC-AIOS core type definitions.
 *
 * The capability contract (`AgentTool`) plus the cross-cutting types every plane shares.
 * Designed for LLM readers: read this file first — it is the spine the whole harness hangs on.
 *
 * Distilled from a production harness; product-specific types (visualizations, data-source
 * payloads, multi-tenant SSE variants) have been removed. What remains is the
 * methodology made concrete.
 */

// ============================================================
// JSON Schema
// ============================================================

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: (string | number)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  default?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface JSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

// ============================================================
// The capability contract  (one contract governs core / plugin / MCP tools)
// ============================================================

/** Tool definition — what the model sees. Every tool implements this. */
export interface AgentToolDefinition {
  /** Unique identifier. Sanitized to lowercase [a-z0-9_]; see tools/tool-name.ts. */
  name: string;
  /** Description the LLM reads to decide when to call. */
  description: string;
  /** Input parameter schema. */
  inputSchema: JSONSchema;
  /** Optional grouping category. */
  category?: ToolCategory;
}

export type ToolCategory = 'web' | 'memory' | 'system' | 'document' | 'delegation' | 'custom';

/**
 * Tool *source* — orthogonal to *exposure* (whether a tool is externally reachable).
 *  - 'core'   built-in
 *  - 'plugin' registered by a plugin
 *  - 'mcp'    materialized from an external MCP server into this same AgentTool shape
 *
 * INVARIANT: name starts with 'mcp__'  ⟺  source === 'mcp'   (enforced at register time
 * in tools/tool-name.ts → assertNameSourceInvariant). Naming *is* a boundary; see
 * docs/02-naming-and-boundaries.md.
 */
export type ToolSource = 'core' | 'plugin' | 'mcp';

/** A request to call a tool. */
export interface AgentToolCall {
  name: string;
  arguments: Record<string, any>;
  /**
   * Opaque reasoning signature carried back to the model unchanged across turns.
   * Provider-specific: some providers require it on function calls (a missing value
   * can 400). Kept provider-agnostic here — pass it through, never inspect it.
   */
  thoughtSignature?: string;
}

/** Content part for the MCP-style content result shape (data shape only, not the protocol). */
export interface ToolContentPart {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

/** Standard tool result. */
export interface AgentToolResultStandard {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

/** MCP-style content result. */
export interface AgentToolResultContent {
  content: ToolContentPart[];
}

/**
 * A tool result is one of two shapes:
 *  1. standard: { success, data?, error?, metadata? }
 *  2. content:  { content: [...] }
 */
export type AgentToolResult = AgentToolResultStandard | AgentToolResultContent;

export function isStandardResult(r: AgentToolResult): r is AgentToolResultStandard {
  return 'success' in r;
}
export function isContentResult(r: AgentToolResult): r is AgentToolResultContent {
  return 'content' in r && !('success' in r);
}

/** Execution context threaded through every tool call. Identity travels here, not in a global. */
export interface AgentToolContext {
  sessionKey?: string;
  /** Caller identity. Single-user defaults to 'local'. This is a SEAM — see src/cautionary/. */
  userId?: string;
  agentId?: string;
  /** Progress callback for long-running tools (drives SSE streaming). */
  onProgress?: (data: ToolProgressData) => void;
  /** Reference to agent state (e.g. for retrieve_cached_data). */
  agentState?: any;
}

export interface ToolProgressData {
  phase: string;
  currentIndex?: number;
  totalItems?: number;
  detail?: Record<string, any>;
}

/**
 * Executable tool — the in-process function-calling contract (NOT the MCP protocol).
 * External MCP-server tools are wrapped into this same shape (source: 'mcp').
 */
export interface AgentTool extends AgentToolDefinition {
  execute(args: Record<string, any>, context?: AgentToolContext): Promise<AgentToolResult>;
}

// ============================================================
// Tool policy  (defined here as the single source; resolved in policy/)
// ============================================================

export type ToolProfileId = 'minimal' | 'standard' | 'full';

/** Declarative allow/deny policy. deny wins over allow. Supports `group:*` and globs. */
export interface ToolPolicy {
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
  profile?: ToolProfileId;
}

// ============================================================
// Messages / traces
// ============================================================

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Single tool call (back-compat). */
  toolCall?: AgentToolCall;
  /** Parallel tool calls. */
  toolCalls?: AgentToolCall[];
  toolResult?: AgentToolResult;
  toolResults?: AgentToolResult[];
  /** Opaque reasoning signature for text turns (see AgentToolCall.thoughtSignature). */
  thoughtSignature?: string;
}

export interface AgentTrace {
  tool: string;
  input: any;
  output: any;
  duration: number;
  thought?: string;
  timestamp?: string;
}

// ============================================================
// Metering  (reserve → delta → finalize) — see docs/06-metering-optional.md
// ============================================================

/** Per-run usage accumulation. In single-user this drives a local spend meter, not a quota gate. */
export interface AgentRunUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  llmSteps: number;
  toolSteps: number;
  costUsd: number;
}

/** Additive usage increment reported after each LLM/tool call (so a mid-run throw still books spend). */
export interface UsageDelta {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  llmSteps?: number;
  toolSteps?: number;
  provider?: string;
  model?: string;
  costUsd?: number;
}

// ============================================================
// Agent response (lean)
// ============================================================

export interface AgentResponse {
  answer: string;
  traces: AgentTrace[];
  thought?: string;
  usage?: AgentRunUsage;
}

// ============================================================
// SSE streaming (generic event types only)
// ============================================================

export type SSEEventType = 'tool_call' | 'tool_result' | 'thinking' | 'text' | 'complete' | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data: any;
  timestamp?: string;
  agentId?: string;
  agentName?: string;
}

// ============================================================
// Provider / reasoning
// ============================================================

/**
 * Provider identifiers.
 *
 * VIN-AIOS prioritises on-premise providers:
 *  - 'ollama'  native Ollama API (/api/chat, /api/embed) — recommended default for local use
 *  - 'openai'  OpenAI-compatible Chat Completions endpoint — works with vLLM, LM Studio,
 *              llama.cpp server, TGI, and the official OpenAI cloud
 *  - 'gemini'  Google Gemini — kept for optional cloud burst, OFF by default
 *
 * Add 'anthropic' | 'bedrock' | … by implementing LLMProvider and registering it.
 */
export type ProviderId = 'openai' | 'gemini' | 'ollama';

export type ReasoningLevel = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

// ============================================================
// Agent config (trimmed)
// ============================================================

export interface AgentConfig {
  model?: string;
  reasoningLevel?: ReasoningLevel;
  maxIterations?: number;
  temperature?: number;
  enableMemory?: boolean;
  /** Single-user defaults to 'local'. SEAM — see src/cautionary/. */
  userId?: string;
}
