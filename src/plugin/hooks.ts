/**
 * Plugin Hook Runner
 *
 * Manages and executes plugin hooks.
 * Supports priority ordering, error isolation, and result merging.
 */

import type {
  PluginHookName,
  PluginHookHandler,
  PluginHookEventMap,
  PluginHookContextMap,
  PluginHookResultMap,
  PluginHookRegistration,
} from './types.js';

/**
 * Hook execution result.
 */
export interface HookExecutionResult<K extends PluginHookName> {
  /** Whether it succeeded. */
  success: boolean;
  /** The merged result. */
  result?: PluginHookResultMap[K];
  /** Error list (if any). */
  errors: Array<{ pluginId: string; error: string }>;
  /** Number of handlers executed. */
  executedCount: number;
  /** Total execution time (ms). */
  durationMs: number;
}

/**
 * Hook Runner
 *
 * Manages and executes plugin hooks.
 */
export class HookRunner {
  private hooks: Map<PluginHookName, PluginHookRegistration<any>[]> = new Map();

  /**
   * Register a hook handler.
   *
   * @param hookName Hook name
   * @param handler Handler function
   * @param opts Options
   */
  register<K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandler<K>,
    opts?: { priority?: number; pluginId?: string }
  ): void {
    const registration: PluginHookRegistration<K> = {
      pluginId: opts?.pluginId ?? 'unknown',
      hookName,
      handler,
      priority: opts?.priority ?? 100,
    };

    const existing = this.hooks.get(hookName) ?? [];
    existing.push(registration);

    // Sort by priority (lower number runs first).
    existing.sort((a, b) => a.priority - b.priority);

    this.hooks.set(hookName, existing);
  }

  /**
   * Register a handler for multiple hooks at once.
   *
   * @param hookNames List of hook names
   * @param handler Handler function
   * @param opts Options
   */
  registerMultiple<K extends PluginHookName>(
    hookNames: K[],
    handler: PluginHookHandler<K>,
    opts?: { priority?: number; pluginId?: string }
  ): void {
    for (const hookName of hookNames) {
      this.register(hookName, handler, opts);
    }
  }

  /**
   * Unregister all hooks for a plugin.
   *
   * @param pluginId Plugin ID
   */
  unregisterByPlugin(pluginId: string): number {
    let count = 0;

    for (const [hookName, registrations] of this.hooks) {
      const filtered = registrations.filter((r) => r.pluginId !== pluginId);
      const removed = registrations.length - filtered.length;
      count += removed;

      if (filtered.length === 0) {
        this.hooks.delete(hookName);
      } else {
        this.hooks.set(hookName, filtered);
      }
    }

    return count;
  }

  /**
   * Execute all handlers for the given hook.
   *
   * @param hookName Hook name
   * @param event Event data
   * @param context Context
   * @returns Execution result
   */
  async execute<K extends PluginHookName>(
    hookName: K,
    event: PluginHookEventMap[K],
    context: PluginHookContextMap[K]
  ): Promise<HookExecutionResult<K>> {
    const startTime = Date.now();
    const registrations = this.hooks.get(hookName) ?? [];
    const errors: Array<{ pluginId: string; error: string }> = [];
    let executedCount = 0;
    let mergedResult: PluginHookResultMap[K] | undefined;

    for (const registration of registrations) {
      try {
        const result = await registration.handler(event, context);
        executedCount++;

        // Merge the result.
        if (result !== undefined && result !== null) {
          mergedResult = this.mergeResults(hookName, mergedResult, result);

          // Check whether execution should stop early.
          if (this.shouldStopExecution(hookName, result)) {
            break;
          }
        }
      } catch (error) {
        errors.push({
          pluginId: registration.pluginId,
          error: String(error),
        });
        console.error(
          `[HookRunner] Error in hook "${hookName}" from plugin "${registration.pluginId}":`,
          error
        );
      }
    }

    return {
      success: errors.length === 0,
      result: mergedResult,
      errors,
      executedCount,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Merge hook results.
   */
  private mergeResults<K extends PluginHookName>(
    hookName: K,
    existing: PluginHookResultMap[K] | undefined,
    newResult: PluginHookResultMap[K]
  ): PluginHookResultMap[K] {
    // void results need no merging.
    if (newResult === undefined || newResult === null) {
      return existing as PluginHookResultMap[K];
    }

    if (existing === undefined || existing === null) {
      return newResult;
    }

    // Hook-specific merge rules.
    switch (hookName) {
      case 'before_agent_start':
        return {
          ...existing,
          ...newResult,
        } as PluginHookResultMap[K];

      case 'before_tool_call':
        // If any handler requests a block, block.
        const existingBlock = existing as { block?: boolean } | undefined;
        const newBlock = newResult as { block?: boolean };
        return {
          ...existing,
          ...newResult,
          block: existingBlock?.block || newBlock?.block,
        } as PluginHookResultMap[K];

      case 'message_sending':
        // If any handler requests a cancel, cancel.
        const existingCancel = existing as { cancel?: boolean } | undefined;
        const newCancel = newResult as { cancel?: boolean };
        return {
          ...existing,
          ...newResult,
          cancel: existingCancel?.cancel || newCancel?.cancel,
        } as PluginHookResultMap[K];

      default:
        // Default: later overrides earlier.
        return newResult;
    }
  }

  /**
   * Decide whether to stop running subsequent handlers.
   */
  private shouldStopExecution<K extends PluginHookName>(
    hookName: K,
    result: PluginHookResultMap[K]
  ): boolean {
    if (!result || typeof result !== 'object') {
      return false;
    }

    const obj = result as Record<string, unknown>;

    // before_tool_call: stop when block === true.
    if (hookName === 'before_tool_call' && obj.block === true) {
      return true;
    }

    // message_sending: stop when cancel === true.
    if (hookName === 'message_sending' && obj.cancel === true) {
      return true;
    }

    return false;
  }

  /**
   * Whether any handler is registered for the given hook.
   *
   * @param hookName Hook name
   * @returns Whether a handler exists
   */
  hasHandlers(hookName: PluginHookName): boolean {
    const registrations = this.hooks.get(hookName);
    return registrations !== undefined && registrations.length > 0;
  }

  /**
   * Number of handlers for the given hook.
   *
   * @param hookName Hook name
   * @returns Handler count
   */
  getHandlerCount(hookName: PluginHookName): number {
    return this.hooks.get(hookName)?.length ?? 0;
  }

  /**
   * Stats for all hooks.
   */
  getStats(): Record<PluginHookName, number> {
    const stats = {} as Record<PluginHookName, number>;

    for (const [hookName, registrations] of this.hooks) {
      stats[hookName] = registrations.length;
    }

    return stats;
  }

  /**
   * Clear all hooks.
   */
  clear(): void {
    this.hooks.clear();
  }
}

// Global singleton
let globalHookRunner: HookRunner | null = null;

/**
 * Get the global Hook Runner instance.
 */
export function getHookRunner(): HookRunner {
  if (!globalHookRunner) {
    globalHookRunner = new HookRunner();
  }
  return globalHookRunner;
}

/**
 * Reset the global Hook Runner (mainly for tests).
 */
export function resetHookRunner(): void {
  globalHookRunner?.clear();
  globalHookRunner = null;
}

// Export the singleton (back-compat).
export const hookRunner = getHookRunner();
