// POST /api/agent-test — "stump the agents" (§S7.4). Runs ONE candidate
// question past the WHOLE roster, concurrently, exactly as a live grounded turn
// would run it — so a colleague can find out, before the event, whether their
// question actually beats the machines.
//
// Deliberately ephemeral test tooling: it touches NO Ably channel, no quiz
// state, no LiveObjects, and stores nothing. It is a pure request → answers
// probe that happens to reuse the same answer core the quiz uses.
//
// Body: { question: { prompt, options (2-4), correctIndex? }, mcpToken }

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  answerQuestion,
  loadRegistry,
  type Choice,
  type Question,
  type ToolCall,
} from '@ably-quiz/agent-runner';
import { questionDefSchema } from '@ably-quiz/core';
import { NextResponse } from 'next/server';
import { groundingInstructions, mcpAllowedTools, mcpConnectionUrl } from '@/lib/mcp';
import { AGENT_MODULES } from '@/lib/agent-modules.generated';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LETTERS: Choice[] = ['A', 'B', 'C', 'D'];

/** The same clock a real question runs on, so a test is representative. */
const TEST_LIMIT_MS = 20_000;

/** The candidate question: the live question contract minus the bits a test
 *  doesn't set. Derived from the canonical `questionDefSchema` so this endpoint
 *  can never drift from the shape the real quiz accepts (and so the web app
 *  doesn't need its own zod dependency). `correctIndex` is optional — without it
 *  you still see every agent's answer, just no right/wrong verdict. */
const testQuestionSchema = questionDefSchema
  .omit({ correctIndex: true, limitMs: true })
  .extend({ correctIndex: questionDefSchema.shape.correctIndex.optional() })
  .refine((q) => q.correctIndex === undefined || q.correctIndex < q.options.length, {
    message: 'correctIndex must point at one of the options',
    path: ['correctIndex'],
  });

type TestBody = {
  question?: unknown;
  /** The tester's own short-lived MCP OAuth token. Used for this request only —
   *  never stored, never logged. See the access gate below. */
  mcpToken?: string;
};

export type AgentTestResult = {
  slug: string;
  name: string;
  emoji: string;
  model: string;
  provider: string;
  /** null when the agent produced no usable answer (timeout / parse failure). */
  choice: Choice | null;
  /** Only present when the caller supplied `correctIndex`. */
  correct?: boolean;
  toolCalls: ToolCall[];
  thinking: string;
  totalMs: number | null;
  timedOut: boolean;
  forcedGuess: boolean;
  /** This agent alone failed; the rest of the roster still answered. */
  error?: string;
};

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

export async function POST(req: Request): Promise<Response> {
  let body: TestBody;
  try {
    body = (await req.json()) as TestBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { mcpToken } = body;

  // ---------------------------------------------------------------------------
  // HARD ACCESS GATE — deliberate, and the only thing standing in front of this
  // endpoint. All three conditions must hold or we refuse with a 403:
  //   1. `mcpToken` present. This endpoint is staff-only BY CONSTRUCTION: the
  //      only way to hold a token is to have completed the company's Okta OAuth
  //      against the MCP server, so possession is proof of employment. It also
  //      stops an anonymous visitor who finds the URL from burning model spend —
  //      a full roster run is 8 live model calls plus their tool traffic.
  //   2. A configured MCP server (ABLY_MCP_URL). No endpoint, no grounding, and
  //      an ungrounded dry run would answer the wrong question: the real quiz
  //      agents ARE grounded, so a test without grounding tells you nothing.
  //   3. A non-empty tool allowlist (ABLY_MCP_TOOLS). A full-mode token exposes
  //      the server's entire tool surface including WRITE tools and the server
  //      enforces no allowlist of its own — the env list is the safety gate.
  // Every tool result the agents see is fetched with the TESTER'S OWN
  // credentials, so an agent can never read more than the person testing can.
  // The token is used for this request only: never logged, never persisted.
  // ---------------------------------------------------------------------------
  const mcpUrl = mcpConnectionUrl();
  const allowedTools = mcpAllowedTools();
  if (!mcpToken) {
    return NextResponse.json(
      { error: 'Sign in with your company account first — this tester is staff-only.' },
      { status: 403 },
    );
  }
  if (!mcpUrl || allowedTools.length === 0) {
    return NextResponse.json(
      {
        error:
          'Agent grounding is not configured on this deployment (ABLY_MCP_URL + ABLY_MCP_TOOLS), so questions cannot be tested against grounded agents.',
      },
      { status: 403 },
    );
  }

  const parsed = testQuestionSchema.safeParse(body.question);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'question'}: ${i.message}`)
      .join('; ');
    return NextResponse.json({ error: `invalid question — ${detail}` }, { status: 400 });
  }
  const { prompt, options, category, correctIndex } = parsed.data;
  const question: Question = { idx: 0, prompt, options, limitMs: TEST_LIMIT_MS, category };
  const correctLetter = correctIndex === undefined ? undefined : LETTERS[correctIndex];

  const root = await repoRoot();
  // Same registry load as a live turn (§S4.4/S6.4), including the generated
  // module map so an agent's own answer() override is what gets tested.
  const registry = await loadRegistry(path.join(root, 'agents'), { modules: AGENT_MODULES });
  if (registry.agents.length === 0) {
    return NextResponse.json({ error: 'no agents in the registry' }, { status: 500 });
  }
  const digest = await readFile(path.join(root, 'packages/core/src/ably-digest.md'), 'utf8').catch(
    () => undefined,
  );

  // Whole roster at once — the quiz asks them in parallel too, and a serial run
  // would take minutes rather than the ~20s a single question costs.
  const results: AgentTestResult[] = await Promise.all(
    registry.agents.map(async (a): Promise<AgentTestResult> => {
      const m = a.manifest;
      const base = {
        slug: m.slug,
        name: m.name,
        emoji: m.emoji,
        model: m.model,
        provider: m.provider,
      };
      const answerFn = a.answer ?? answerQuestion;
      const started = Date.now();
      try {
        const outcome = await answerFn(m, question, {
          digest,
          crib: a.crib,
          // Grounded ONLY: no ungrounded retry here (unlike a live turn, which
          // falls back so the quiz never stalls). A silent ungrounded answer
          // would make the test lie about how the agent plays on the night.
          grounding: groundingInstructions(),
          mcp: { url: mcpUrl, authorizationToken: mcpToken, allowedTools },
        });
        return {
          ...base,
          choice: outcome.choice,
          ...(correctLetter === undefined
            ? {}
            : { correct: outcome.choice === correctLetter && outcome.choice !== null }),
          toolCalls: outcome.toolCalls,
          thinking: outcome.thinking,
          totalMs: outcome.totalMs ?? Date.now() - started,
          timedOut: outcome.timedOut,
          forcedGuess: outcome.forcedGuess,
        };
      } catch (err) {
        // One dead model must not sink the whole run — report it in its own card.
        console.error(`[agent-test] ${m.slug} failed:`, err);
        const message = err instanceof Error ? err.message : 'failed to answer';
        return {
          ...base,
          choice: null,
          ...(correctLetter === undefined ? {} : { correct: false }),
          toolCalls: [],
          thinking: '',
          totalMs: Date.now() - started,
          timedOut: false,
          forcedGuess: false,
          error: message,
        };
      }
    }),
  );

  // "Stumped" = every agent that did NOT land the right letter, including the
  // ones that never answered at all — from the question author's point of view
  // a silent agent is just as stumped as a wrong one.
  const summary =
    correctLetter === undefined
      ? { agents: results.length }
      : { agents: results.length, stumped: results.filter((r) => !r.correct).length };

  return NextResponse.json({ correctLetter, results, summary });
}
