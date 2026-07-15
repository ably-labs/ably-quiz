// POST /api/mcp/register — begin the host's MCP OAuth (§S6). Proxies
// discovery + Dynamic Client Registration through our server so the browser
// never hits the Worker's OAuth endpoints directly (avoids CORS). Returns the
// endpoints + a fresh public client_id; the browser then does PKCE + redirect.
//
// No secret is stored: DCR yields a public client (token_endpoint_auth_method
// "none"), and the resulting token lives only in the host's browser.

import { NextResponse } from 'next/server';
import { mcpOrigin } from '@/lib/ably-os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Endpoints = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
};

/** RFC 8414 discovery, with a fallback to the workers-oauth-provider defaults. */
async function discover(base: string): Promise<Endpoints> {
  const fallback: Endpoints = {
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
  };
  try {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return fallback;
    const meta = (await res.json()) as Partial<Endpoints>;
    return {
      authorization_endpoint: meta.authorization_endpoint ?? fallback.authorization_endpoint,
      token_endpoint: meta.token_endpoint ?? fallback.token_endpoint,
      registration_endpoint: meta.registration_endpoint ?? fallback.registration_endpoint,
    };
  } catch {
    return fallback;
  }
}

export async function POST(req: Request): Promise<Response> {
  let redirectUri: string;
  try {
    ({ redirectUri } = (await req.json()) as { redirectUri: string });
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!redirectUri) {
    return NextResponse.json({ error: 'redirectUri is required' }, { status: 400 });
  }

  const base = mcpOrigin();
  if (!base) {
    return NextResponse.json(
      { error: 'MCP grounding not configured (set ABLY_MCP_URL)' },
      { status: 501 },
    );
  }

  const endpoints = await discover(base);

  const reg = await fetch(endpoints.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Carbon vs Silicon — the Ably Quiz',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none', // public client (PKCE)
      grant_types: ['authorization_code'],
      response_types: ['code'],
    }),
  });
  const data = (await reg.json().catch(() => ({}))) as { client_id?: string; error?: string };
  if (!reg.ok || !data.client_id) {
    return NextResponse.json(
      { error: data.error ?? `registration failed (${reg.status})` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    clientId: data.client_id,
    authorizationEndpoint: endpoints.authorization_endpoint,
    tokenEndpoint: endpoints.token_endpoint,
  });
}
