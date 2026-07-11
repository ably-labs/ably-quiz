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

export async function fetchToken(params: ConnectParams): Promise<TokenResponse> {
  const res = await fetch('/api/ably-auth', {
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
export async function connect(params: ConnectParams): Promise<Connection> {
  const { clientId, kind } = await fetchToken(params);
  const client = new Ably.Realtime({
    clientId,
    plugins: { LiveObjects },
    authCallback: (_tokenParams, callback) => {
      fetchToken(params).then(
        (r) => callback(null, r.token),
        (err: unknown) => callback(err instanceof Error ? err.message : String(err), null),
      );
    },
  });
  return { client, clientId, kind };
}
