/**
 * Plugin Service Manager
 *
 * Manages the lifecycle of plugin background services.
 */

import type {
  PluginService,
  PluginServiceContext,
  PluginLogger,
} from './types.js';

/**
 * Registered service info.
 */
interface RegisteredService {
  service: PluginService;
  pluginId: string;
  status: 'registered' | 'running' | 'stopped' | 'error';
  error?: string;
  startedAt?: Date;
  stoppedAt?: Date;
}

/**
 * Service Manager
 *
 * Manages plugin background services.
 */
export class ServiceManager {
  private services: Map<string, RegisteredService> = new Map();
  private defaultContext: Partial<PluginServiceContext> = {};

  /**
   * Set the default context.
   */
  setDefaultContext(context: Partial<PluginServiceContext>): void {
    this.defaultContext = { ...this.defaultContext, ...context };
  }

  /**
   * Register a service.
   *
   * @param service Service definition
   * @param pluginId Owning plugin ID
   */
  register(service: PluginService, pluginId: string): void {
    const existing = this.services.get(service.id);
    if (existing) {
      console.warn(
        `[ServiceManager] Service "${service.id}" already registered by plugin "${existing.pluginId}", skipping`
      );
      return;
    }

    this.services.set(service.id, {
      service,
      pluginId,
      status: 'registered',
    });

    console.log(`[ServiceManager] Registered service: ${service.id} (from ${pluginId})`);
  }

  /**
   * Unregister all services for a plugin.
   *
   * @param pluginId Plugin ID
   */
  async unregisterByPlugin(pluginId: string): Promise<number> {
    let count = 0;

    for (const [serviceId, registered] of this.services) {
      if (registered.pluginId === pluginId) {
        // Stop a running service first.
        if (registered.status === 'running') {
          await this.stopService(serviceId);
        }
        this.services.delete(serviceId);
        count++;
      }
    }

    return count;
  }

  /**
   * Start a specific service.
   *
   * @param serviceId Service ID
   * @param context Context (optional)
   */
  async startService(
    serviceId: string,
    context?: Partial<PluginServiceContext>
  ): Promise<boolean> {
    const registered = this.services.get(serviceId);
    if (!registered) {
      console.warn(`[ServiceManager] Service not found: ${serviceId}`);
      return false;
    }

    if (registered.status === 'running') {
      console.warn(`[ServiceManager] Service already running: ${serviceId}`);
      return true;
    }

    const fullContext = this.buildContext(context);

    try {
      await registered.service.start(fullContext);
      registered.status = 'running';
      registered.startedAt = new Date();
      registered.error = undefined;
      console.log(`[ServiceManager] Started service: ${serviceId}`);
      return true;
    } catch (error) {
      registered.status = 'error';
      registered.error = String(error);
      console.error(`[ServiceManager] Failed to start service "${serviceId}":`, error);
      return false;
    }
  }

  /**
   * Stop a specific service.
   *
   * @param serviceId Service ID
   * @param context Context (optional)
   */
  async stopService(
    serviceId: string,
    context?: Partial<PluginServiceContext>
  ): Promise<boolean> {
    const registered = this.services.get(serviceId);
    if (!registered) {
      console.warn(`[ServiceManager] Service not found: ${serviceId}`);
      return false;
    }

    if (registered.status !== 'running') {
      return true; // Already stopped.
    }

    const fullContext = this.buildContext(context);

    try {
      if (registered.service.stop) {
        await registered.service.stop(fullContext);
      }
      registered.status = 'stopped';
      registered.stoppedAt = new Date();
      console.log(`[ServiceManager] Stopped service: ${serviceId}`);
      return true;
    } catch (error) {
      registered.status = 'error';
      registered.error = String(error);
      console.error(`[ServiceManager] Failed to stop service "${serviceId}":`, error);
      return false;
    }
  }

  /**
   * Start all registered services.
   *
   * @param context Context (optional)
   */
  async startAll(context?: Partial<PluginServiceContext>): Promise<{
    started: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const started: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const [serviceId, registered] of this.services) {
      if (registered.status === 'running') {
        continue; // Already running.
      }

      const success = await this.startService(serviceId, context);
      if (success) {
        started.push(serviceId);
      } else {
        failed.push({
          id: serviceId,
          error: registered.error ?? 'Unknown error',
        });
      }
    }

    return { started, failed };
  }

  /**
   * Stop all running services.
   *
   * @param context Context (optional)
   */
  async stopAll(context?: Partial<PluginServiceContext>): Promise<{
    stopped: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const stopped: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const [serviceId, registered] of this.services) {
      if (registered.status !== 'running') {
        continue; // Not running.
      }

      const success = await this.stopService(serviceId, context);
      if (success) {
        stopped.push(serviceId);
      } else {
        failed.push({
          id: serviceId,
          error: registered.error ?? 'Unknown error',
        });
      }
    }

    return { stopped, failed };
  }

  /**
   * Get service status.
   *
   * @param serviceId Service ID
   */
  getStatus(serviceId: string): RegisteredService | undefined {
    return this.services.get(serviceId);
  }

  /**
   * Get the status of all services.
   */
  getAllStatuses(): Map<string, RegisteredService> {
    return new Map(this.services);
  }

  /**
   * Number of running services.
   */
  getRunningCount(): number {
    let count = 0;
    for (const registered of this.services.values()) {
      if (registered.status === 'running') {
        count++;
      }
    }
    return count;
  }

  /**
   * Build the full context.
   */
  private buildContext(context?: Partial<PluginServiceContext>): PluginServiceContext {
    const logger: PluginLogger = {
      debug: (msg, ...args) => console.debug('[Service]', msg, ...args),
      info: (msg, ...args) => console.log('[Service]', msg, ...args),
      warn: (msg, ...args) => console.warn('[Service]', msg, ...args),
      error: (msg, ...args) => console.error('[Service]', msg, ...args),
    };

    return {
      config: {},
      logger,
      ...this.defaultContext,
      ...context,
    };
  }

  /**
   * Clear all services.
   */
  clear(): void {
    this.services.clear();
  }
}

// Global singleton
let globalServiceManager: ServiceManager | null = null;

/**
 * Get the global Service Manager instance.
 */
export function getServiceManager(): ServiceManager {
  if (!globalServiceManager) {
    globalServiceManager = new ServiceManager();
  }
  return globalServiceManager;
}

/**
 * Reset the global Service Manager (mainly for tests).
 */
export function resetServiceManager(): void {
  globalServiceManager?.clear();
  globalServiceManager = null;
}

// Export the singleton.
export const serviceManager = getServiceManager();
