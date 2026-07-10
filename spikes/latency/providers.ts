// Provider adapters for the S0 latency spike.
//
// Each adapter runs ONE streamed model call in the exact shape the real agent
// runner will use (BRIEF §B2.7): stream a short visible think-aloud, then emit
// strict JSON. We measure, from the same stream:
//   - ttftMs   : time to first streamed text token
//   - answerMs : time until a valid answer JSON object could first be parsed
//   - totalMs  : time until the stream finished
//
// Only providers whose API key is present in the environment are run; the rest
// are skipped and recorded (BRIEF §B3 S0.1). OpenAI/xAI model ids are marked
// VERIFY — they are confirmed at S4 when those keys arrive.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type ProviderId = 'anthropic' | 'openai' | 'xai';

export type ModelSpec = {
  /** stable key used in result tables, e.g. "matt-opus" */
  key: string;
  label: string;
  provider: ProviderId;
  /** provider model id */
  model: string;
};

/** Answer JSON the model is asked to emit (BRIEF §B2.7). */
export type AnswerJson = {
  choice: 'A' | 'B' | 'C' | 'D';
  confidence: number;
  quip: string;
};

export type StreamResult = {
  ttftMs: number | null;
  answerMs: number | null;
  totalMs: number;
  text: string;
  answer: AnswerJson | null;
};

// --- Model registry ---------------------------------------------------------
// Anthropic ids are the real quiz roster (BRIEF §B2.7). OpenAI/xAI ids are
// overridable via env and must be VERIFIED at S4 before the live quiz.
export const MODELS: ModelSpec[] = [
  {
    key: 'matt-opus',
    label: 'Matt Opus (claude-opus-4-8)',
    provider: 'anthropic',
    model: 'claude-opus-4-8',
  },
  {
    key: 'matt-sonnet',
    label: 'Matt Sonnet (claude-sonnet-5)',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
  },
  {
    key: 'matt-fable',
    label: 'Matt Fable (claude-fable-5)',
    provider: 'anthropic',
    model: 'claude-fable-5',
  },
  {
    key: 'matt-gpt',
    label: 'Matt GPT (OpenAI — VERIFY id at S4)',
    provider: 'openai',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o',
  },
  {
    key: 'matt-grok',
    label: 'Matt Grok (xAI — VERIFY id at S4)',
    provider: 'xai',
    model: process.env.XAI_MODEL ?? 'grok-2-latest',
  },
];

/** Env var carrying the key for a provider, and whether it is present. */
export function keyEnvFor(provider: ProviderId): string {
  switch (provider) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'xai':
      return 'XAI_API_KEY';
  }
}

export function hasKey(provider: ProviderId): boolean {
  const v = process.env[keyEnvFor(provider)];
  return typeof v === 'string' && v.trim().length > 0;
}

// --- JSON extraction from a partial stream ----------------------------------
// The stream is "<prose think-aloud>\n<json>". We find the first '{' and try
// the largest balanced-looking substring first, shrinking until one parses to
// a valid AnswerJson. Returns null until a valid answer is present.
export function extractAnswer(buffer: string): AnswerJson | null {
  const start = buffer.indexOf('{');
  if (start === -1) return null;
  for (let end = buffer.length; end > start; end--) {
    if (buffer[end - 1] !== '}') continue;
    const candidate = buffer.slice(start, end);
    try {
      const obj = JSON.parse(candidate) as unknown;
      const ans = coerceAnswer(obj);
      if (ans) return ans;
    } catch {
      // keep shrinking
    }
  }
  return null;
}

function coerceAnswer(obj: unknown): AnswerJson | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const choice = typeof o.choice === 'string' ? o.choice.trim().toUpperCase() : '';
  if (choice !== 'A' && choice !== 'B' && choice !== 'C' && choice !== 'D') return null;
  const confidence = typeof o.confidence === 'number' ? o.confidence : Number(o.confidence);
  const quip = typeof o.quip === 'string' ? o.quip : '';
  return { choice, confidence: Number.isFinite(confidence) ? confidence : 0, quip };
}

// --- Streaming calls ---------------------------------------------------------
export type CallArgs = {
  spec: ModelSpec;
  system: string;
  user: string;
  maxTokens: number;
  /** Omitted when undefined — newer Claude models reject `temperature`. */
  temperature: number | undefined;
  timeoutMs: number;
};

export async function streamAnswer(args: CallArgs): Promise<StreamResult> {
  if (args.spec.provider === 'anthropic') return streamAnthropic(args);
  return streamOpenAiCompatible(args);
}

async function streamAnthropic(args: CallArgs): Promise<StreamResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const t0 = performance.now();
  let ttftMs: number | null = null;
  let answerMs: number | null = null;
  let answer: AnswerJson | null = null;
  let text = '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const stream = client.messages.stream(
      {
        model: args.spec.model,
        max_tokens: args.maxTokens,
        ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      },
      { signal: controller.signal },
    );

    stream.on('text', (delta: string) => {
      if (ttftMs === null) ttftMs = performance.now() - t0;
      text += delta;
      if (!answer) {
        const parsed = extractAnswer(text);
        if (parsed) {
          answer = parsed;
          answerMs = performance.now() - t0;
        }
      }
    });

    await stream.finalMessage();
  } finally {
    clearTimeout(timer);
  }

  return { ttftMs, answerMs, totalMs: performance.now() - t0, text, answer };
}

async function streamOpenAiCompatible(args: CallArgs): Promise<StreamResult> {
  const isXai = args.spec.provider === 'xai';
  const client = new OpenAI({
    apiKey: process.env[keyEnvFor(args.spec.provider)],
    baseURL: isXai ? 'https://api.x.ai/v1' : undefined,
  });
  const t0 = performance.now();
  let ttftMs: number | null = null;
  let answerMs: number | null = null;
  let answer: AnswerJson | null = null;
  let text = '';

  const stream = await client.chat.completions.create(
    {
      model: args.spec.model,
      max_tokens: args.maxTokens,
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      stream: true,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user },
      ],
    },
    { timeout: args.timeoutMs },
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (!delta) continue;
    if (ttftMs === null) ttftMs = performance.now() - t0;
    text += delta;
    if (!answer) {
      const parsed = extractAnswer(text);
      if (parsed) {
        answer = parsed;
        answerMs = performance.now() - t0;
      }
    }
  }

  return { ttftMs, answerMs, totalMs: performance.now() - t0, text, answer };
}
