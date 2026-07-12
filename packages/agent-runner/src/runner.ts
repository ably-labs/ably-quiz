// The default answer core (BRIEF §B2.7 step 2–4): build the prompt from the
// agent's persona + crib + shared digest, stream one model call in the real
// answer shape, and enforce the deadline — answer by `limitMs − 2000`, else
// abort and force a best guess. A late/failed agent scores 0; the quiz never
// waits. AIT session/presence/publish wiring layers on top of this in S4.2.

import {
  extractAnswerLoose,
  streamAnswer,
  type AnswerJson,
  type Choice,
  type StreamFn,
} from './providers';
import type { AgentManifest, Question } from './schema';

const LETTERS = ['A', 'B', 'C', 'D'] as const;
const DEFAULT_MAX_TOKENS = 400;
const DEADLINE_SAFETY_MS = 2000;
const MIN_DEADLINE_MS = 1000;

export type AnswerContext = {
  /** Shared Ably digest (packages/core/src/ably-digest.md, curated at S4.3). */
  digest?: string;
  /** The agent's pre-learned crib (agents/<slug>/crib.md), if any. */
  crib?: string;
};

export type AnswerOptions = AnswerContext & {
  /** Hard deadline from question start; defaults to `limitMs − 2000` (min 1000). */
  deadlineMs?: number;
  maxTokens?: number;
  /** Streamed think-aloud deltas — the runner pipes these to the AIT session (S4.2). */
  onThinking?: (delta: string, fullText: string) => void;
  /** Injectable stream fn; defaults to the real provider adapters. Tests pass a fake. */
  stream?: StreamFn;
};

export type AnswerOutcome = {
  /** null only when nothing usable streamed (scores 0). */
  choice: Choice | null;
  confidence: number;
  quip: string;
  /** The visible think-aloud (text before the JSON). */
  thinking: string;
  ttftMs: number | null;
  answerMs: number | null;
  /** The stream was aborted at the deadline. */
  timedOut: boolean;
  /** We didn't get a clean strict-JSON answer (loose parse or no answer). */
  forcedGuess: boolean;
};

export async function answerQuestion(
  agent: AgentManifest,
  question: Question,
  opts: AnswerOptions = {},
): Promise<AnswerOutcome> {
  const stream = opts.stream ?? streamAnswer;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const deadlineMs = Math.max(
    MIN_DEADLINE_MS,
    opts.deadlineMs ?? question.limitMs - DEADLINE_SAFETY_MS,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  let text = '';
  let res;
  try {
    res = await stream({
      provider: agent.provider,
      model: agent.model,
      system: buildSystem(agent, opts),
      user: buildUser(question),
      maxTokens,
      signal: controller.signal,
      onDelta: (delta, full) => {
        text = full;
        opts.onThinking?.(delta, full);
      },
    });
  } finally {
    clearTimeout(timer);
  }

  const thinking = thinkingOf(res.text || text);

  // Prefer the strict streamed answer; else recover a clear choice from
  // malformed JSON (the S0 unescaped-quote failure mode); else score 0.
  let answer: AnswerJson | null = res.answer;
  let forcedGuess = false;
  if (!answer) {
    answer = extractAnswerLoose(res.text);
    forcedGuess = true;
  }

  return {
    choice: answer?.choice ?? null,
    confidence: answer?.confidence ?? 0,
    quip: answer?.quip ?? '',
    thinking,
    ttftMs: res.ttftMs,
    answerMs: res.answerMs,
    timedOut: res.aborted,
    forcedGuess,
  };
}

const BASE_SYSTEM = `You are a contestant in a live, timed multiple-choice quiz. Faster correct answers score more points, so be quick but accurate.

Respond in EXACTLY this format and nothing else:
1) One or two short sentences of visible reasoning (your think-aloud), under ~40 words.
2) Then, on a new line, a single JSON object with NO markdown fences and no extra text:
{"choice":"A","confidence":0.72,"quip":"a short playful one-liner"}

Constraints:
- "choice" must be exactly one of "A", "B", "C", or "D".
- "confidence" is your probability of being correct, between 0 and 1.
- "quip" is at most 80 characters and MUST NOT contain double-quote characters.
- Put the reasoning first, then the JSON. Output nothing after the JSON.`;

function buildSystem(agent: AgentManifest, ctx: AnswerContext): string {
  const parts = [BASE_SYSTEM];
  if (agent.personality) {
    parts.push(
      `Your persona: ${agent.personality} Stay in character in your think-aloud and quip.`,
    );
  }
  if (ctx.crib?.trim()) {
    parts.push(`Notes you prepared while studying (use when relevant):\n${ctx.crib.trim()}`);
  }
  if (ctx.digest?.trim()) {
    parts.push(`Reference material you have studied (use when relevant):\n${ctx.digest.trim()}`);
  }
  return parts.join('\n\n');
}

function buildUser(q: Question): string {
  const lines = q.options.map((opt, i) => `${LETTERS[i]}) ${opt}`);
  const limitS = Math.round(q.limitMs / 1000);
  const category = q.category ? `Category: ${q.category}\n` : '';
  return `${category}Question: ${q.prompt}\n${lines.join('\n')}\nTime limit: ${limitS} seconds. Answer now.`;
}

/** The visible think-aloud is everything before the answer JSON. */
function thinkingOf(text: string): string {
  const brace = text.indexOf('{');
  return (brace === -1 ? text : text.slice(0, brace)).trim();
}
