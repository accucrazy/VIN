declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: { allowExtension?: boolean });
    exec(sql: string): void;
    close(): void;
    enableLoadExtension(enabled: boolean): void;
    loadExtension(path: string): void;
    prepare(sql: string): StatementSync;
  }

  export class StatementSync {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
}
