// POST /api/agent-health — preflight for the agent roster. Runs a tiny real
// gateway call per agent so a quota/auth/unknown-model problem shows up BEFORE
// the quiz (Matt's "a simple test to make sure they work"). Cheap (max_tokens 4)
// and on demand, not per question.
//
// Body: { slugs?: string[] } — limit to these agents, else all in the registry.

import { access } from 'node:fs/promises';
import path from 'node:path';
import { loadRegistry, pingModel } from '@ably-quiz/agent-runner';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function agentsDir(): Promise<string> {
  for (const dir of [process.env.REPO_ROOT, path.resolve(process.cwd(), '../..'), process.cwd()]) {
    if (!dir) continue;
    try {
      await access(path.join(dir, 'agents'));
      return path.join(dir, 'agents');
    } catch {
      /* next */
    }
  }
  return path.join(process.cwd(), 'agents');
}

export async function POST(req: Request): Promise<Response> {
  const { slugs } = (await req.json().catch(() => ({}))) as { slugs?: string[] };

  if (!process.env.AI_GATEWAY_API_KEY) {
    return NextResponse.json({
      configured: false,
      results: [],
      error: 'AI_GATEWAY_API_KEY is not set — agents answer through the Vercel AI Gateway.',
    });
  }

  const registry = await loadRegistry(await agentsDir());
  const agents = registry.agents.filter(
    (a) => !slugs || slugs.includes(a.manifest.slug),
  );

  // Grounded turns need a direct Anthropic key; surface if it's missing so the
  // host knows grounding will silently fall back to ungrounded.
  const groundingKey = Boolean(process.env.ANTHROPIC_API_KEY);

  const results = await Promise.all(
    agents.map(async (a) => {
      const error = await pingModel(a.manifest.provider, a.manifest.model);
      return { slug: a.manifest.slug, name: a.manifest.name, ok: error === null, error: error ?? undefined };
    }),
  );

  return NextResponse.json({ configured: true, groundingKey, results });
}
