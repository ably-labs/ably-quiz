// POST /api/agent-turn — run ONE agent's answer for ONE question, on demand
// (§S4.4). The host fires this per declared agent when it broadcasts a question:
// no persistent process, no lease/heartbeat — the agent is a request that runs
// the tested answer core and publishes to the same fan-in humans use, then ends.
//
// Server is the trusted authority here, so it publishes AS the agent with the
// master key (the per-agent capability model is for client-side agents). Thinking
// streams (AIT) and the live "thinking" indicator are Slice C / S4.5.
//
// Body: { quizId, slug, question: { idx, prompt, options, limitMs, category? } }

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { answerQuestion, loadRegistry, type Question } from '@ably-quiz/agent-runner';
import { answersChannel } from '@ably-quiz/core';
import Ably from 'ably';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Locate the repo root (holds `agents/` + `packages/`); `next` runs from apps/web. */
async function repoRoot(): Promise<string> {
  const candidates = [
    process.env.REPO_ROOT,
    path.resolve(process.cwd(), '../..'),
    process.cwd(),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    try {
      await access(path.join(dir, 'agents'));
      return dir;
    } catch {
      /* try next */
    }
  }
  return candidates[0] ?? process.cwd();
}

type TurnBody = { quizId?: string; slug?: string; question?: Question };

export async function POST(req: Request): Promise<Response> {
  let body: TurnBody;
  try {
    body = (await req.json()) as TurnBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { quizId, slug, question } = body;
  if (!quizId || !slug || !question) {
    return NextResponse.json({ error: 'quizId, slug and question are required' }, { status: 400 });
  }

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ABLY_API_KEY not configured' }, { status: 500 });
  }

  const root = await repoRoot();
  const registry = await loadRegistry(path.join(root, 'agents'));
  const agent = registry.agents.find((a) => a.manifest.slug === slug);
  if (!agent) {
    return NextResponse.json({ error: `unknown agent "${slug}"` }, { status: 404 });
  }

  const digest = await readFile(
    path.join(root, 'packages/core/src/ably-digest.md'),
    'utf8',
  ).catch(() => undefined);

  // Run the tested answer core. A throw/timeout scores 0 — never stalls the quiz.
  let outcome;
  try {
    outcome = await answerQuestion(agent.manifest, question, { digest, crib: agent.crib });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'answer failed', slug },
      { status: 502 },
    );
  }

  if (!outcome.choice) {
    return NextResponse.json({ slug, answered: false, timedOut: outcome.timedOut });
  }

  const rest = new Ably.Rest({ key: apiKey });
  await rest.channels.get(answersChannel(quizId)).publish({
    name: 'answer',
    data: { idx: question.idx, choice: outcome.choice, confidence: outcome.confidence },
    clientId: `a:${slug}`,
  });

  return NextResponse.json({
    slug,
    answered: true,
    choice: outcome.choice,
    forcedGuess: outcome.forcedGuess,
  });
}
