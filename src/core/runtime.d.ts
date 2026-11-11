/**
 * Minimal cross-runtime standard globals available identically in Browser, Bun, and Node 20+
 * without pulling in DOM (`window`, `document`, `localStorage`) or Node (`fs`, `process`) types.
 * Note: `console.log` is intentionally omitted so core engines never pollute MCP stdio stdout.
 */
declare const console: {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare const crypto: {
  randomUUID(): string;
};

