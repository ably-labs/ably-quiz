// POST /api/commentator — the analysis-phase AI commentator (§B2.9). Streams a
// witty ~80-word breakdown of the results token-by-token onto /screen (the
// visible streaming showcase). Fable's model, a commentary prompt, no answer
// duty. Fire-and-forget from the host when the quiz enters `analysis`.

import { streamAnswer } from '@ably-quiz/agent-runner';
import { agentChannel, type CommentaryMessage } from '@ably-quiz/core';
import Ably from 'ably';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fable — the commentator, per §B2.9. */
const COMMENTATOR_MODEL = 'claude-fable-5';
const THROTTLE_MS = 200;

type Standing = { name: string; kind: 'human' | 'agent'; score: number };
type Body = {
  quizId?: string;
  standings?: Standing[];
  humanTotal?: number;
  agentTotal?: number;
  questionCount?: number;
};

function buildPrompt(b: Required<Omit<Body, 'quizId'>>): string {
  const board = b.standings
    .map((s, i) => `${i + 1}. ${s.name} (${s.kind === 'agent' ? 'AI' : 'human'}) — ${s.score}`)
    .join('\n');
  const verdict =
    b.agentTotal === b.humanTotal
      ? 'a dead heat'
      : b.agentTotal > b.humanTotal
        ? 'Silicon (the AIs) ahead'
        : 'Carbon (the humans) ahead';
  return `Here are the final results of a ${b.questionCount}-question quiz.\n\nFinal standings:\n${board}\n\nTeam totals — Humans ${b.humanTotal}, Agents ${b.agentTotal} (${verdict}).\n\nGive the breakdown.`;
}

const SYSTEM = `You are the live commentator for "Carbon vs Silicon", an Ably company quiz where humans battle AI agents head-to-head. Deliver a witty, punchy ~80-word breakdown (3–4 sentences) of how it all went: call the human-vs-AI battle, praise or roast the top and bottom of the table by name, and land the verdict. Sports-commentary energy — confident, a little cheeky, quick. Plain prose only, no lists or headings. Do not exceed ~80 words.`;

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { quizId, standings, humanTotal, agentTotal, questionCount } = body;
  if (!quizId || !standings) {
    return NextResponse.json({ error: 'quizId and standings are required' }, { status: 400 });
  }
  const apiKey = process.env.ABLY_API_KEY;
  // Fable's commentary streams through the Vercel AI Gateway like every agent turn.
  if (!apiKey || !process.env.AI_GATEWAY_API_KEY) {
    return NextResponse.json({ error: 'server keys not configured' }, { status: 500 });
  }

  const rest = new Ably.Rest({ key: apiKey });
  const channel = rest.channels.get(agentChannel(quizId, 'commentator'));
  const emit = (msg: CommentaryMessage) => {
    void channel
      .publish({ name: 'commentary', data: msg, clientId: 'a:commentator' })
      .catch(() => {});
  };

  const prompt = buildPrompt({
    standings,
    humanTotal: humanTotal ?? 0,
    agentTotal: agentTotal ?? 0,
    questionCount: questionCount ?? standings.length,
  });

  let full = '';
  let lastEmit = 0;
  try {
    const result = await streamAnswer({
      provider: 'anthropic',
      model: COMMENTATOR_MODEL,
      system: SYSTEM,
      user: prompt,
      maxTokens: 400,
      onDelta: (_delta, fullText) => {
        full = fullText;
        const now = Date.now();
        if (now - lastEmit < THROTTLE_MS) return;
        lastEmit = now;
        emit({ text: full, done: false });
      },
    });
    full = result.text;
  } catch (err) {
    console.error('[commentator] failed:', err);
    emit({ text: full || '…', done: true });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 502 },
    );
  }

  emit({ text: full, done: true });
  return NextResponse.json({ ok: true });
}
