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
import { AGENT_MODULES } from '@/lib/agent-modules.generated';

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
  // Pass the generated agent-module map so a per-agent answer() override (from the
  // agent's agent.ts) runs here, in the live turn (§S6.4). JSON-only agents have
  // no module and fall back to the default answer core.
  const registry = await loadRegistry(path.join(root, 'agents'), { modules: AGENT_MODULES });
  const agent = registry.agents.find((a) => a.manifest.slug === slug);
  if (!agent) {
    return NextResponse.json({ error: `unknown agent "${slug}"` }, { status: 404 });
  }
  // The agent's own answer() if it ships one, else the shared default core.
  const answerFn = agent.answer ?? answerQuestion;

  const digest = await readFile(path.join(root, 'packages/core/src/ably-digest.md'), 'utf8').catch(
    () => undefined,
  );

  // Publish STATUS to the agent's own channel so /screen can show a live
  // thinking/answered/error indicator (§S4.5). Players hold read-only subscribe
  // here (§B2.5), so as of S5.3 this channel carries status ONLY — no reasoning
  // text, no quip — to close the mid-question wire-leak. Fire-and-forget; never
  // blocks the turn.
  const rest = new Ably.Rest({ key: apiKey });
  const thinking = rest.channels.get(agentChannel(quizId, slug));
  const emitThinking = (msg: AgentThinkingMessage) => {
    void thinking.publish({ name: 'thinking', data: msg, clientId: `a:${slug}` }).catch(() => {});
  };
  emitThinking({ slug, idx: question.idx, phase: 'thinking', text: '' });

  // Live MCP grounding (§S6, Option A): only when the host has authenticated,
  // the provider supports the MCP connector (Anthropic), AND we have a direct
  // Anthropic key — grounded turns bypass the gateway because the connector is an
  // Anthropic-Messages feature. Everything else answers through the gateway.
  // Token is used for this request only — never stored/logged.
  const grounded =
    Boolean(mcpToken) &&
    agent.manifest.provider === 'anthropic' &&
    Boolean(process.env.ANTHROPIC_API_KEY);

  // No `onThinking` here by design (S5.3): the reasoning think-aloud must not
  // reach the player-readable agent channel. The answer core runs without a
  // thinking sink; status comes from the emitThinking calls above/below.
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
    outcome = await answerFn(agent.manifest, question, {
      digest,
      crib: agent.crib,
      ...groundingOpts,
    });
  } catch (err) {
    if (!grounded) return fail(err);
    // Grounding failed (e.g. a model that doesn't support the connector) — retry
    // ungrounded before giving up, so grounding is truly best-effort.
    console.warn(`[agent-turn] ${slug} grounded turn failed; retrying ungrounded:`, err);
    try {
      outcome = await answerFn(agent.manifest, question, {
        digest,
        crib: agent.crib,
      });
    } catch (err2) {
      return fail(err2);
    }
  }

  // Settle the status to `answered` — status ONLY, no reasoning text and no quip
  // (S5.3). The quip rides the host-subscribe-only answers fan-in below and is
  // released to /screen at reveal; it must never touch this player-readable channel.
  emitThinking({ slug, idx: question.idx, phase: 'answered', text: '' });

  if (!outcome.choice) {
    return NextResponse.json({ slug, answered: false, timedOut: outcome.timedOut });
  }

  // The quip travels with the answer on the fan-in (host-subscribe-only, §B2.5),
  // so the host can gather quips per question and re-release them at reveal (S5.3).
  await rest.channels.get(answersChannel(quizId)).publish({
    name: 'answer',
    data: {
      idx: question.idx,
      choice: outcome.choice,
      confidence: outcome.confidence,
      quip: outcome.quip,
    },
    clientId: `a:${slug}`,
  });

  return NextResponse.json({
    slug,
    answered: true,
    choice: outcome.choice,
    forcedGuess: outcome.forcedGuess,
  });
}
