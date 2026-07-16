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
import {
  agentChannel,
  answersChannel,
  type AgentThinkingMessage,
  type AgentTranscript,
} from '@ably-quiz/core';
import Ably from 'ably';
import { NextResponse } from 'next/server';
import { groundingInstructions, mcpAllowedTools, mcpConnectionUrl } from '@/lib/mcp';
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

  // Live MCP grounding (§S6): available to EVERY provider once the host has
  // authenticated — Anthropic agents run the client-side tool loop against the
  // direct Anthropic API, everyone else runs the same loop through the gateway's
  // OpenAI-compatible function calling (§S6.10; all roster models verified).
  // Token is used for this request only — never stored/logged. Also requires a
  // configured MCP server (ABLY_MCP_URL) — no endpoint, no grounding.
  const mcpUrl = mcpConnectionUrl();
  // The tool ALLOWLIST is a hard requirement for grounding (§S6.9): a full-mode
  // token exposes the server's whole tool surface including WRITE tools, and the
  // server enforces no allowlist — ABLY_MCP_TOOLS is the safety gate. No list,
  // no grounding (the runner refuses too; this keeps `grounded` honest in
  // transcripts and skips a doomed attempt).
  const allowedTools = mcpAllowedTools();
  if (mcpToken && mcpUrl && allowedTools.length === 0) {
    console.warn('[agent-turn] ABLY_MCP_TOOLS is unset — refusing to ground with all tools');
  }
  // Each transport needs its key: direct Anthropic for anthropic agents, the
  // gateway for everyone else (the same key their ungrounded turns already use).
  const groundingKey =
    agent.manifest.provider === 'anthropic'
      ? process.env.ANTHROPIC_API_KEY
      : process.env.AI_GATEWAY_API_KEY;
  const grounded =
    Boolean(mcpToken) && Boolean(mcpUrl) && allowedTools.length > 0 && Boolean(groundingKey);

  // No `onThinking` here by design (S5.3): the reasoning think-aloud must not
  // reach the player-readable agent channel. The answer core runs without a
  // thinking sink; status comes from the emitThinking calls above/below.
  const groundingOpts =
    grounded && mcpUrl
      ? {
          grounding: groundingInstructions(),
          mcp: {
            url: mcpUrl,
            authorizationToken: mcpToken!,
            allowedTools,
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

  const ungrounded = () => answerFn(agent.manifest, question, { digest, crib: agent.crib });
  // `grounded` is what we ATTEMPTED; `usedGrounding` is what actually produced the
  // outcome. Every fallback below flips it, so the transcript (and its "grounded"
  // badge in the viewer) never claims grounding for an ungrounded answer — the
  // live test that surfaced this showed a retired-model 404 falling back
  // ungrounded while the card still read "grounded".
  let usedGrounding = grounded;
  let outcome;
  try {
    outcome = await answerFn(agent.manifest, question, {
      digest,
      crib: agent.crib,
      ...groundingOpts,
    });
  } catch (err) {
    if (!grounded) return fail(err);
    // Grounding setup failed (MCP init/tools) — retry ungrounded before giving up,
    // so grounding is truly best-effort.
    console.warn(`[agent-turn] ${slug} grounded turn failed; retrying ungrounded:`, err);
    try {
      outcome = await ungrounded();
      usedGrounding = false;
    } catch (err2) {
      return fail(err2);
    }
  }
  // A grounded turn that produced NO answer (e.g. it ran out of tool-loop turns or
  // aborted at the deadline) shouldn't score 0 — take one fast ungrounded pass.
  if (grounded && !outcome.choice) {
    console.warn(`[agent-turn] ${slug} grounded turn produced no answer; retrying ungrounded`);
    try {
      outcome = await ungrounded();
      usedGrounding = false;
    } catch (err) {
      return fail(err);
    }
  }

  // Settle the status to `answered` — status ONLY, no reasoning text and no quip
  // (S5.3). The quip rides the host-subscribe-only answers fan-in below and is
  // released to /screen at reveal; it must never touch this player-readable channel.
  // Observability for the grounding question (§S6.6): make it obvious in the
  // server log whether a grounded agent actually called any MCP tools.
  if (usedGrounding) {
    const names = outcome.toolCalls.map((c) => c.name).join(', ');
    console.log(
      `[agent-turn] ${slug} grounded turn: ${outcome.toolCalls.length} tool call(s)${names ? ` — ${names}` : ' (answered from own knowledge)'}`,
    );
  }

  emitThinking({ slug, idx: question.idx, phase: 'answered', text: '' });

  // Full turn transcript for the end-of-quiz conversation viewer (§S6.6): what
  // the agent was asked, how it reasoned, the MCP tools it called, its timing and
  // answer. Rides the host-subscribe-only fan-in (reasoning/tools could reveal
  // the answer), and the host releases it at reveal — the same wire-safe path as
  // the quip. Published even for a no-answer/timeout turn so failures show too.
  const transcript: AgentTranscript = {
    slug,
    idx: question.idx,
    model: agent.manifest.model,
    provider: agent.manifest.provider,
    grounded: usedGrounding,
    question: question.prompt,
    options: question.options,
    reasoning: outcome.thinking,
    toolCalls: outcome.toolCalls,
    choice: outcome.choice,
    confidence: outcome.confidence,
    quip: outcome.quip,
    ttftMs: outcome.ttftMs,
    answerMs: outcome.answerMs,
    totalMs: outcome.totalMs,
    timedOut: outcome.timedOut,
    forcedGuess: outcome.forcedGuess,
  };
  await rest.channels
    .get(answersChannel(quizId))
    .publish({ name: 'transcript', data: transcript, clientId: `a:${slug}` })
    .catch(() => {});

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
