// GET /api/mcp/status — is MCP grounding configured? (§S6.5)
// ABLY_MCP_URL is a server-only env var, so the client can't read it directly;
// the host page asks this endpoint whether to show the grounding UI at all.

import { NextResponse } from 'next/server';
import { isMcpConfigured } from '@/lib/mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return NextResponse.json({ configured: isMcpConfigured() });
}
