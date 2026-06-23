/**
 * Plugin system types.
 *
 * Unified registration contract for Tools, Skills, Agents, Hooks, and Services.
 *
 * ============================================================
 * Important: plugin registration vs file-based registration
 * ============================================================
 *
 * The plugin system is a *runtime* registration mechanism:
 * - Registered entries live in memory (Maps).
 * - Nothing is written to the tools/, skills/, or agent/ directories.
 * - Plugins must be re-loaded after a restart.
 *
 * For persistent core capabilities, create .ts / .md files directly in the
 * corresponding directory instead:
 * - tools/*.ts     -> tool implementations
 * - skills/*.md    -> skill definitions
 * - agent/agents/* -> agent definitions
 *
 * Both registration paths converge on the same Registry and can coexist.
 */

import type { AgentTool } from '../types.js';
import type { SkillEntry } from '../skills/types.js';
import type { AgentDefinition } from '../agent/types.js';

// ============================================================
// Plugin Manifest (JSON definition file)
// ============================================================

/**
 * Plugin Manifest — the structure of tpc-ai.plugin.json.
 */
export interface PluginManifest {
  /** Unique plugin identifier (required). */
  id: string;
  /** Plugin name. */
  name?: string;
  /** Plugin version. */
  version?: string;
  /** Plugin description. */
  description?: string;
  /** Tool paths to auto-load. */
  tools?: string[];
  /** Skill paths to auto-load. */
  skills?: string[];
  /** Agent paths to auto-load. */
  agents?: string[];
  /** Config schema (JSON Schema format). */
  configSchema?: Record<string, unknown>;
  /** IDs of other plugins this one depends on. */
  dependencies?: string[];
  /** UI configuration hints. */
  uiHints?: Record<string, PluginConfigUiHint>;
}

/**
 * Manifest load result.
 */
export type PluginManifestLoadResult =
  | { ok: true; manifest: PluginManifest; manifestPath: string }
  | { ok: false; error: string; manifestPath: string };

/**
 * UI hint for a config field.
 */
export interface PluginConfigUiHint {
  /** Field label. */
  label?: string;
  /** Help text. */
  help?: string;
  /** Whether this is an advanced option. */
  advanced?: boolean;
  /** Whether this is sensitive data. */
  sensitive?: boolean;
  /** Input placeholder text. */
  placeholder?: string;
}

// ============================================================
// Hook system
// ============================================================

/**
 * Hook event names.
 */
export type PluginHookName =
  | 'before_agent_start'
  | 'agent_end'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'before_compaction'
  | 'after_compaction'
  | 'message_received'
  | 'message_sending'
  | 'session_start'
  | 'session_end';

// ==================== Hook event types ====================

/** Agent context (shared). */
export interface PluginHookAgentContext {
  agentId?: string;
  sessionKey?: string;
  userId?: string;
  conversationId?: string;
}

/** before_agent_start event */
export interface BeforeAgentStartEvent {
  prompt: string;
  messages?: unknown[];
}

/** before_agent_start result */
export interface BeforeAgentStartResult {
  systemPrompt?: string;
  prependContext?: string;
}

/** agent_end event */
export interface AgentEndEvent {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
  /** This run is a delegated sub-agent run (top-level-only hooks, e.g. reflection, skip on this flag). */
  delegation?: boolean;
  /** The user's raw question (clean input, free of wrapper noise — used by memory reflection). */
  rawQuestion?: string;
  /** Final answer (for excerpting; absent on the failure path). */
  answer?: string;
}

/** before_tool_call event */
export interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
}

/** before_tool_call result */
export interface BeforeToolCallResult {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
}

/** after_tool_call event */
export interface AfterToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  /** Full unextracted tool result (kept once the executor is the single hook owner, for zero-loss billing/audit). */
  rawResult?: unknown;
  durationMs?: number;
}

/** before_compaction event */
export interface BeforeCompactionEvent {
  messageCount: number;
  tokenCount?: number;
}

/** after_compaction event */
export interface AfterCompactionEvent {
  messageCount: number;
  tokenCount?: number;
  compactedCount: number;
}

/** message_received event */
export interface MessageReceivedEvent {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

/** message_sending event */
export interface MessageSendingEvent {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/** message_sending result */
export interface MessageSendingResult {
  content?: string;
  cancel?: boolean;
}

/** session_start event */
export interface SessionStartEvent {
  sessionId: string;
  userId?: string;
  resumedFrom?: string;
}

/** session_end event */
export interface SessionEndEvent {
  sessionId: string;
  messageCount: number;
  durationMs?: number;
}

// ==================== Hook type maps ====================

/**
 * Hook event type map.
 */
export interface PluginHookEventMap {
  before_agent_start: BeforeAgentStartEvent;
  agent_end: AgentEndEvent;
  before_tool_call: BeforeToolCallEvent;
  after_tool_call: AfterToolCallEvent;
  before_compaction: BeforeCompactionEvent;
  after_compaction: AfterCompactionEvent;
  message_received: MessageReceivedEvent;
  message_sending: MessageSendingEvent;
  session_start: SessionStartEvent;
  session_end: SessionEndEvent;
}

/**
 * Hook result type map.
 */
export interface PluginHookResultMap {
  before_agent_start: BeforeAgentStartResult | void;
  agent_end: void;
  before_tool_call: BeforeToolCallResult | void;
  after_tool_call: void;
  before_compaction: void;
  after_compaction: void;
  message_received: void;
  message_sending: MessageSendingResult | void;
  session_start: void;
  session_end: void;
}

/**
 * Hook context type map.
 */
export interface PluginHookContextMap {
  before_agent_start: PluginHookAgentContext;
  agent_end: PluginHookAgentContext;
  before_tool_call: PluginHookAgentContext & { toolName: string };
  after_tool_call: PluginHookAgentContext & { toolName: string };
  before_compaction: PluginHookAgentContext;
  after_compaction: PluginHookAgentContext;
  message_received: { channelId?: string; accountId?: string };
  message_sending: { channelId?: string; accountId?: string };
  session_start: { agentId?: string };
  session_end: { agentId?: string };
}

/**
 * Hook handler type.
 */
export type PluginHookHandler<K extends PluginHookName> = (
  event: PluginHookEventMap[K],
  context: PluginHookContextMap[K]
) => Promise<PluginHookResultMap[K]> | PluginHookResultMap[K];

/**
 * Hook registration info.
 */
export interface PluginHookRegistration<K extends PluginHookName = PluginHookName> {
  pluginId: string;
  hookName: K;
  handler: PluginHookHandler<K>;
  priority: number;
}

// ============================================================
// Service system
// ============================================================

/**
 * Service context.
 */
export interface PluginServiceContext {
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  workspaceDir?: string;
  stateDir?: string;
  logger: PluginLogger;
}

/**
 * Plugin Service definition.
 */
export interface PluginService {
  /** Unique service identifier. */
  id: string;
  /** Start the service. */
  start(ctx: PluginServiceContext): void | Promise<void>;
  /** Stop the service (optional). */
  stop?(ctx: PluginServiceContext): void | Promise<void>;
}

// ============================================================
// HTTP Route system
// ============================================================

/**
 * HTTP request handler.
 */
export type HttpRouteHandler = (
  req: HttpRequest,
  res: HttpResponse
) => void | Promise<void>;

/**
 * HTTP request (simplified).
 */
export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

/**
 * HTTP response (simplified).
 */
export interface HttpResponse {
  status(code: number): HttpResponse;
  json(data: unknown): void;
  send(data: string | Buffer): void;
  end(): void;
}

/**
 * HTTP route registration params.
 */
export interface HttpRouteParams {
  /** Route path (e.g. "/api/my-plugin/data"). */
  path: string;
  /** Request method (defaults to GET). */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Handler. */
  handler: HttpRouteHandler;
}

// ============================================================
// Plugin Logger
// ============================================================

/**
 * Plugin Logger.
 */
export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

// ============================================================
// Plugin Runtime
// ============================================================

/**
 * Plugin Runtime — runtime utilities provided to a plugin.
 */
export interface PluginRuntime {
  /** Current working directory. */
  workspaceDir?: string;
  /** State storage directory. */
  stateDir?: string;
  /** Environment variables. */
  env: Record<string, string | undefined>;
}

// ============================================================
// Plugin API
// ============================================================

/**
 * Plugin API — the full interface handed to a plugin.
 *
 * This is the injection surface: a plugin uses these methods to inject tools,
 * skills, agents, hooks, services, and HTTP routes into the host.
 */
export interface PluginApi {
  /** Plugin ID. */
  id: string;
  /** Plugin name. */
  name: string;
  /** Plugin version. */
  version?: string;
  /** Plugin description. */
  description?: string;
  /** Plugin source path. */
  source: string;
  /** Global config. */
  config: Record<string, unknown>;
  /** Plugin-specific config. */
  pluginConfig?: Record<string, unknown>;
  /** Logger. */
  logger: PluginLogger;
  /** Runtime. */
  runtime: PluginRuntime;

  // ==================== Registration methods ====================

  /**
   * Register a tool.
   */
  registerTool(tool: AgentTool): void;

  /**
   * Register a skill.
   */
  registerSkill(skill: SkillEntry): void;

  /**
   * Register an agent.
   */
  registerAgent(agent: AgentDefinition): void;

  /**
   * Register a hook.
   */
  registerHook<K extends PluginHookName>(
    event: K | K[],
    handler: PluginHookHandler<K>,
    opts?: { priority?: number }
  ): void;

  /**
   * Register a service.
   */
  registerService(service: PluginService): void;

  /**
   * Register an HTTP route.
   */
  registerHttpRoute(params: HttpRouteParams): void;

  // ==================== Utility methods ====================

  /**
   * Resolve a relative path to an absolute path.
   */
  resolvePath(input: string): string;

  /**
   * Get a config value.
   */
  getConfig<T>(key: string): T | undefined;
}

// ============================================================
// Plugin Definition
// ============================================================

/**
 * Config schema (simplified JSON Schema).
 */
export interface PluginConfigSchema {
  /** Zod-style safeParse. */
  safeParse?: (value: unknown) => {
    success: boolean;
    data?: unknown;
    error?: { issues?: Array<{ path: Array<string | number>; message: string }> };
  };
  /** JSON Schema definition. */
  jsonSchema?: Record<string, unknown>;
  /** UI hints. */
  uiHints?: Record<string, PluginConfigUiHint>;
}

/**
 * Plugin definition — the code entry point.
 */
export interface PluginDefinition {
  /** Plugin ID (optional; can be taken from the manifest). */
  id?: string;
  /** Plugin name. */
  name?: string;
  /** Plugin version. */
  version?: string;
  /** Plugin description. */
  description?: string;
  /** Config schema. */
  configSchema?: PluginConfigSchema;
  /**
   * Register function — runs immediately on load.
   * Used to register tools, skills, agents, hooks, and services.
   */
  register?(api: PluginApi): void | Promise<void>;
  /**
   * Activate function — runs after all plugins have loaded.
   * Used for initialization logic that depends on other plugins.
   */
  activate?(api: PluginApi): void | Promise<void>;
  /**
   * Unregister function — runs when the plugin is unloaded.
   */
  unregister?(): void | Promise<void>;
}

/**
 * Plugin module — either a definition object or a function.
 */
export type PluginModule =
  | PluginDefinition
  | ((api: PluginApi) => void | Promise<void>);

// ============================================================
// Plugin Config
// ============================================================

/**
 * Plugin config.
 */
export interface PluginConfig {
  /** Whether enabled. */
  enabled: boolean;
  /** Custom settings. */
  settings?: Record<string, unknown>;
}

// ============================================================
// Plugin Metadata
// ============================================================

/**
 * Plugin metadata (runtime).
 */
export interface PluginMetadata {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  dependencies?: string[];
  registeredAt: Date;
  activatedAt?: Date;
  toolCount: number;
  skillCount: number;
  agentCount: number;
  hookCount: number;
  serviceCount: number;
  httpRouteCount: number;
}

// ============================================================
// Loaded Plugin
// ============================================================

/**
 * A loaded plugin.
 */
export interface LoadedPlugin {
  /** Plugin definition. */
  definition: PluginDefinition;
  /** Manifest (if any). */
  manifest?: PluginManifest;
  /** Config. */
  config: PluginConfig;
  /** Metadata. */
  metadata: PluginMetadata;
  /** API instance. */
  api: PluginApi;
  /** Status. */
  status: 'registered' | 'activated' | 'error';
  /** Error message (if any). */
  error?: string;
}

// ============================================================
// Discovered Plugin
// ============================================================

/**
 * A discovered plugin (before load).
 */
export interface DiscoveredPlugin {
  /** Plugin path. */
  path: string;
  /** Manifest (if any). */
  manifest?: PluginManifest;
  /** Origin type. */
  origin: 'directory' | 'file' | 'config';
}
