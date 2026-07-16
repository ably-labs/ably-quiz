// Shared MCP sessions (§S6.9). The MCP handshake (`initialize` + `tools/list`)
// costs ~4-5s on the worker — paid on EVERY grounded turn if each turn opens its
// own session, which put a flat ~7.6s floor under even no-tool answers (measured
// 2026-07-16). Sessions are process-wide and reusable, so cache ONE initialized
// session (+ its tool list) per server×token and let every turn share it: warm
// turns skip straight to the model, cutting no-tool answers to ~2-3s and
// tool-using answers to ~4-5s.
//
// Design notes:
// - Keyed by URL + a SHA-256 of the token (never the raw token — cache keys must
//   be safe to log). A refreshed token simply keys a new session.
// - The PROMISE is cached, so concurrent turns (the host fires all agents at
//   once) dedupe into a single handshake. A failed handshake evicts itself.
// - Setup runs on its own timeout, NOT a turn's deadline — the session belongs
//   to the process, so one turn aborting must not kill it for everyone else.
//   Per-call signals (mcp-client.ts) carry each turn's own deadline instead.
// - Sessions can die server-side (worker restart/expiry → HTTP 404 per the MCP
//   spec). Callers `invalidate()` and retry once with a fresh session.

import { createHash } from 'node:crypto';
import { makeMcpClient, type McpClient, type McpTool } from './mcp-client';

export type McpSession = {
  client: McpClient;
  /** The server's full tools/list, fetched once at handshake. */
  tools: McpTool[];
  /** Handshake cost (init + tools/list), for observability. */
  setupMs: number;
};

/** Handshake gets its own generous timeout (a cold worker is ~5s). */
const SETUP_TIMEOUT_MS = 15_000;
/** Evict sessions unused for this long — tokens are hour-scale, keep it under. */
const IDLE_TTL_MS = 30 * 60_000;

type Entry = { promise: Promise<McpSession>; lastUsed: number };
const sessions = new Map<string, Entry>();

function keyFor(url: string, token: string): string {
  return `${url}#${createHash('sha256').update(token).digest('hex').slice(0, 16)}`;
}

async function createSession(url: string, token: string): Promise<McpSession> {
  const t0 = Date.now();
  const client = makeMcpClient(url, token);
  const signal = AbortSignal.timeout(SETUP_TIMEOUT_MS);
  const init = await client.initialize({ signal });
  if (init.error || init.status >= 400) {
    throw new Error(`MCP initialize failed (status ${init.status})`);
  }
  const { tools } = await client.listTools({ signal });
  return { client, tools, setupMs: Date.now() - t0 };
}

/** Get (or create) the shared session for this server×token. Concurrent callers
 *  share one handshake; a failed handshake evicts itself so the next call retries. */
export function getMcpSession(url: string, token: string): Promise<McpSession> {
  prune();
  const key = keyFor(url, token);
  const existing = sessions.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.promise;
  }
  const promise = createSession(url, token).catch((err: unknown) => {
    sessions.delete(key); // don't cache a dead handshake
    throw err;
  });
  sessions.set(key, { promise, lastUsed: Date.now() });
  return promise;
}

/** Drop the cached session (e.g. after a 404 = server-side session expiry). */
export function invalidateMcpSession(url: string, token: string): void {
  sessions.delete(keyFor(url, token));
}

function prune(): void {
  const cutoff = Date.now() - IDLE_TTL_MS;
  for (const [key, entry] of sessions) {
    if (entry.lastUsed < cutoff) sessions.delete(key);
  }
}
