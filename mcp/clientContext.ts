import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-call client identity (HTTP mode: the token name / id that opened the MCP session).
 * Tool handlers run inside `runWithClient`, so deep storage code (audit projection)
 * can attribute writes to the calling Agent without threading config everywhere.
 */
export interface ClientIdentity {
  clientName?: string;
  tokenId?: string;
}

const clientStorage = new AsyncLocalStorage<ClientIdentity>();

export function runWithClient<T>(identity: ClientIdentity, fn: () => T): T {
  if (!identity.clientName && !identity.tokenId) {
    return fn();
  }
  return clientStorage.run(identity, fn);
}

export function currentClient(): ClientIdentity | undefined {
  return clientStorage.getStore();
}
