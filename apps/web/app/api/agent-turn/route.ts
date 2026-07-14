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
import { agentChannel, answersChannel, type AgentThinkingMessage } from '@ably-quiz/core';
import Ably from 'ably';
import { NextResponse } from 'next/server';
import { ABLY_OS_CONNECTOR_TOOLS, ablyOsMcpUrl, groundingInstructions } from '@/lib/ably-os';

/** Live think-aloud is the text before the answer JSON (the agent streams
 *  reasoning first, then a `{…}`). Strip from the first brace for display. */
function thinkAloud(text: string): string {
  const brace = text.indexOf('{');
  return (brace === -1 ? text : text.slice(0, brace)).trim();
}

/** Throttle streamed thinking to ~1 publish / THROTTLE_MS so a 5-agent field
 *  doesn't flood Ably; the final `answered` message is always sent. */
const THROTTLE_MS = 350;

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

type TurnBody = {
  quizId?: string;
  slug?: string;
  question?: Question;
  /** Host's short-lived MCP OAuth token (§S6). Used for this request only —
   *  never stored, never logged. Grounds Anthropic agents via the MCP connector. */
  mcpToken?: string;
};

export async function POST(req: Request): Promise<Response> {
  let body: TurnBody;
  try {
    body = (await req.json()) as TurnBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { quizId, slug, question, mcpToken } = body;
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

  // Publish the think-aloud to the agent's own channel so /screen can show it
  // live (§S4.5). Fire-and-forget as the agent thinks; never block the turn.
  const rest = new Ably.Rest({ key: apiKey });
  const thinking = rest.channels.get(agentChannel(quizId, slug));
  const emitThinking = (msg: AgentThinkingMessage) => {
    void thinking.publish({ name: 'thinking', data: msg, clientId: `a:${slug}` }).catch(() => {});
  };
  emitThinking({ slug, idx: question.idx, phase: 'thinking', text: '' });
  let lastEmit = 0;

  // Live MCP grounding (§S6, Option A): only when the host has authenticated,
  // the provider supports the MCP connector (Anthropic), AND we have a direct
  // Anthropic key — grounded turns bypass the gateway because the connector is an
  // Anthropic-Messages feature. Everything else answers through the gateway.
  // Token is used for this request only — never stored/logged.
  const grounded =
    Boolean(mcpToken) &&
    agent.manifest.provider === 'anthropic' &&
    Boolean(process.env.ANTHROPIC_API_KEY);

  const onThinking = (_delta: string, full: string) => {
    const now = Date.now();
    if (now - lastEmit < THROTTLE_MS) return;
    lastEmit = now;
    emitThinking({ slug, idx: question.idx, phase: 'thinking', text: thinkAloud(full) });
  };
  const groundingOpts = grounded
    ? {
        grounding: groundingInstructions(),
        mcp: {
          url: ablyOsMcpUrl(),
          authorizationToken: mcpToken!,
          allowedTools: ABLY_OS_CONNECTOR_TOOLS,
        },
      }
    : {};

  // Run the tested answer core. A throw/timeout scores 0 — never stalls the quiz.
  // Grounding is best-effort: if the connector fails (e.g. an older model that
  // doesn't support it), fall back to an ungrounded answer rather than dying.
  // A failed turn: log (never the token), warn on screen, 502.
  const fail = (e: unknown): Response => {
    console.error(`[agent-turn] ${slug} failed (grounded=${grounded}):`, e);
    const msg = e instanceof Error ? e.message : 'failed to answer';
    emitThinking({ slug, idx: question.idx, phase: 'error', text: msg.slice(0, 200) });
    return NextResponse.json({ error: msg, slug }, { status: 502 });
  };

  let outcome;
  try {
    outcome = await answerQuestion(agent.manifest, question, {
      digest,
      crib: agent.crib,
      onThinking,
      ...groundingOpts,
    });
  } catch (err) {
    if (!grounded) return fail(err);
    // Grounding failed (e.g. a model that doesn't support the connector) — retry
    // ungrounded before giving up, so grounding is truly best-effort.
    console.warn(`[agent-turn] ${slug} grounded turn failed; retrying ungrounded:`, err);
    try {
      outcome = await answerQuestion(agent.manifest, question, {
        digest,
        crib: agent.crib,
        onThinking,
      });
    } catch (err2) {
      return fail(err2);
    }
  }

  // Settle the drawer with the final reasoning + quip, whether or not it answered.
  emitThinking({
    slug,
    idx: question.idx,
    phase: 'answered',
    text: outcome.thinking,
    quip: outcome.quip,
  });

  if (!outcome.choice) {
    return NextResponse.json({ slug, answered: false, timedOut: outcome.timedOut });
  }

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
