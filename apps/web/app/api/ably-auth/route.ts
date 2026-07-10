// POST /api/ably-auth — issue a short-lived Ably JWT scoped to the caller's role
// (§B2.5). The Ably API key secret stays server-side; the client uses the
// returned token (e.g. via authCallback).
//
// Body: { quizId, role: 'player'|'host'|'agent', clientId?, slug?, hostKey? }
// host/agent require the correct hostKey. Returns { token, clientId, kind }.

import { authorize, type AuthRequestBody } from '@/lib/authorize';
import { createAblyJwt, splitApiKey } from '@/lib/ably-jwt';

export const runtime = 'nodejs'; // needs node:crypto and the server-only API key
export const dynamic = 'force-dynamic'; // never cache an auth response

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour — a quiz fits comfortably inside

export async function POST(req: Request): Promise<Response> {
  let body: AuthRequestBody;
  try {
    body = (await req.json()) as AuthRequestBody;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const decision = authorize(body, process.env.HOST_KEY);
  if (!decision.ok) {
    return Response.json({ error: decision.error }, { status: decision.status });
  }

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ABLY_API_KEY not configured' }, { status: 500 });
  }

  let token: string;
  try {
    const { keyName, keySecret } = splitApiKey(apiKey);
    token = createAblyJwt({
      keyName,
      keySecret,
      clientId: decision.clientId,
      capability: decision.capability,
      ttlSeconds: TOKEN_TTL_SECONDS,
    });
  } catch {
    return Response.json({ error: 'server auth misconfigured' }, { status: 500 });
  }

  return Response.json({
    token,
    clientId: decision.clientId,
    kind: decision.kind,
    expiresInSeconds: TOKEN_TTL_SECONDS,
  });
}
