import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Correlation-ID propagation.
 *
 * A single correlationId threads through every log line in a request's async
 * call chain. It is set once at request entry (CorrelationMiddleware) and read
 * automatically by BusinessLogger — no manual threading through call args.
 *
 * Built on Node's AsyncLocalStorage (node:async_hooks) — zero dependencies,
 * stable since Node 14.
 */

export interface CorrelationStore {
  correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationStore>();

/**
 * Run `fn` inside a fresh correlation context. Everything awaited within `fn`
 * (the entire downstream async chain) sees the same correlationId.
 */
export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/** The correlationId for the current async context, or undefined outside one. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Rebind the active context's correlationId. Webhook handlers call this once
 * they have parsed the provider event id so the rest of the chain correlates
 * on the real business id rather than the entry-generated UUID. Mutates the
 * existing store object so already-captured async frames see the new value.
 */
export function bindCorrelationId(correlationId: string): void {
  const store = storage.getStore();
  if (store) store.correlationId = correlationId;
}

/** Generate a fresh correlationId (UUID v4, no dependency). */
export function newCorrelationId(): string {
  return randomUUID();
}
