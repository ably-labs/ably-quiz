// Ably client wiring. The browser authenticates via /api/ably-auth (which
// mints a role-scoped Ably JWT); the API key secret never reaches the client.
// The LiveObjects plugin is always attached — the main channel carries the
// quiz's LiveObjects state (§B2.3).

import * as Ably from 'ably';
import { LiveObjects } from 'ably/liveobjects';
import type { Kind, Role } from '@ably-quiz/core';

export type ConnectParams = {
  quizId: string;
  role: Role;
  /** Player's persisted id base (nickname-derived); ignored for agents. */
  clientId?: string;
  /** Agent slug (role=agent). */
  slug?: string;
};

export type TokenResponse = { token: string; clientId: string; kind: Kind };

// authBase is '' in the browser (relative /api/ably-auth); the Node e2e sim
// passes an absolute origin so it can exercise this exact code path.
export async function fetchToken(params: ConnectParams, authBase = ''): Promise<TokenResponse> {
  const res = await fetch(`${authBase}/api/ably-auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `auth failed (${res.status})`);
  }
  return (await res.json()) as TokenResponse;
}

export type Connection = { client: Ably.Realtime; clientId: string; kind: Kind };

/** Learn our authoritative clientId, then open a Realtime client that keeps its
 *  token fresh via the same endpoint. */
export async function connect(params: ConnectParams, authBase = ''): Promise<Connection> {
  // Every token fetch (initial + renewals) must resolve to the SAME clientId, or
  // Ably rejects with "invalid clientId for credentials". Agents derive it from
  // their slug (deterministic); players pass a stable base; the host sends
  // neither, so pin a base up front rather than let the server randomise each fetch.
  const stable: ConnectParams =
    params.role === 'agent' || params.clientId ? params : { ...params, clientId: randomBase() };

  const { clientId, kind } = await fetchToken(stable, authBase);
  const client = new Ably.Realtime({
    clientId,
    plugins: { LiveObjects },
    authCallback: (_tokenParams, callback) => {
      fetchToken(stable, authBase).then(
        (r) => callback(null, r.token),
        (err: unknown) => callback(err instanceof Error ? err.message : String(err), null),
      );
    },
  });
  return { client, clientId, kind };
}

function randomBase(): string {
  return Math.random().toString(36).slice(2, 10);
}
