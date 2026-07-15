// POST /api/mcp/token — complete the host's MCP OAuth (§S6). Proxies the
// PKCE authorization-code → token exchange through our server (avoids browser
// CORS on the Worker). The access token is returned to the browser and lives
// there only — never persisted server-side, never logged.

import { NextResponse } from 'next/server';
import { mcpOrigin } from '@/lib/ably-os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
};

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { tokenEndpoint, code, codeVerifier, clientId, redirectUri } = body;
  if (!tokenEndpoint || !code || !codeVerifier || !clientId || !redirectUri) {
    return NextResponse.json({ error: 'missing OAuth exchange fields' }, { status: 400 });
  }

  // SSRF guard: only ever exchange against the configured MCP server origin.
  const base = mcpOrigin();
  if (!base) {
    return NextResponse.json(
      { error: 'MCP grounding not configured (set ABLY_MCP_URL)' },
      { status: 501 },
    );
  }
  try {
    if (new URL(tokenEndpoint).origin !== new URL(base).origin) {
      return NextResponse.json({ error: 'tokenEndpoint origin not allowed' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'invalid tokenEndpoint' }, { status: 400 });
  }

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    return NextResponse.json(
      { error: data.error_description ?? data.error ?? `token exchange failed (${res.status})` },
      { status: 502 },
    );
  }
  // Return the token to the browser only. Do NOT log it.
  return NextResponse.json({ accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 });
}
