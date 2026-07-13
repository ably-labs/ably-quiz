// GET /api/agents — the agents available to play, read from the `agents/*`
// registry (§S4.4). The create page renders these as a checklist; the chosen set
// is stored in the quiz config as the declarative roster. Server-only (reads the
// filesystem) — the browser fetches this over HTTP, never imports the loader.

import { access } from 'node:fs/promises';
import path from 'node:path';
import { loadRegistry } from '@ably-quiz/agent-runner';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The `agents/` dir lives at the repo root; `next dev`/`start` run from apps/web.
 *  Try the likely locations (override with AGENTS_DIR) and use the first that exists. */
async function resolveAgentsDir(): Promise<string> {
  const candidates = [
    process.env.AGENTS_DIR,
    path.resolve(process.cwd(), '../../agents'),
    path.resolve(process.cwd(), 'agents'),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    try {
      await access(dir);
      return dir;
    } catch {
      /* try the next candidate */
    }
  }
  return candidates[candidates.length - 1] ?? path.resolve(process.cwd(), 'agents');
}

export async function GET() {
  const dir = await resolveAgentsDir();
  const registry = await loadRegistry(dir);
  // Only the display fields the roster needs — never cribs or provider secrets.
  const agents = registry.agents.map((a) => ({
    slug: a.manifest.slug,
    name: a.manifest.name,
    emoji: a.manifest.emoji,
    owner: a.manifest.owner,
    model: a.manifest.model,
    provider: a.manifest.provider,
  }));
  return NextResponse.json({ agents });
}
