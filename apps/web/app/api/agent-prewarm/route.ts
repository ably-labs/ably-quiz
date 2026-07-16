// POST /api/agent-prewarm — warm the shared MCP session (§S6.9) before the
// first question. The MCP handshake costs ~4-5s; sessions are cached per
// server×token in the agent runner, so warming once at quiz start means even
// question 1's grounded turns skip straight to the model. Fire-and-forget from
// the host the moment it holds an MCP token; failure is harmless (the first
// grounded turn just pays the handshake itself).
//
// Body: { mcpToken } — used for this request only, never stored or logged.

import { getMcpSession } from '@ably-quiz/agent-runner';
import { NextResponse } from 'next/server';
import { mcpConnectionUrl } from '@/lib/mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  let body: { mcpToken?: string };
  try {
    body = (await req.json()) as { mcpToken?: string };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const url = mcpConnectionUrl();
  if (!url || !body.mcpToken) {
    return NextResponse.json({ warmed: false });
  }
  try {
    const session = await getMcpSession(url, body.mcpToken);
    return NextResponse.json({ warmed: true, tools: session.tools.length });
  } catch (err) {
    // Never log the token; the message from our own client is token-free.
    console.warn('[agent-prewarm] handshake failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ warmed: false });
  }
}
