// Streaming provider adapters + incremental JSON extraction — the heart of the
// agent runner, carried over from the proven S0 latency spike (BRIEF §B2.7).
//
// Each call streams a short visible think-aloud then strict answer JSON; we
// parse the answer incrementally so the quiz can act the moment it's valid.
// The stream is abort-tolerant: on the deadline (§B2.7 step 3) the caller aborts
// and we return whatever streamed, so the runner can still force a best guess.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { Provider } from './schema';

export type Choice = 'A' | 'B' | 'C' | 'D';
export type AnswerJson = { choice: Choice; confidence: number; quip: string };

/** Remote MCP grounding via the provider's native connector (§S6, Option A).
 *  The provider holds the connection; the host's short-lived read-only token is
 *  passed here per turn and never stored. Only Anthropic wired for now. */
export type McpConnector = {
  url: string;
  authorizationToken: string;
  /** Tools EXPOSED to the model (not searchAblyTools — the catalog is pre-injected). */
  allowedTools: readonly string[];
};

export type StreamArgs = {
  provider: Provider;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
  /** Fires per streamed text delta (the runner pipes this to the AIT session in S4.2). */
  onDelta?: (delta: string, fullText: string) => void;
  /** When set, ground this turn against a remote MCP server (Anthropic only). */
  mcp?: McpConnector;
};

// The connector is a Messages beta; pin the version the wiring is built against.
const ANTHROPIC_MCP_BETA = 'mcp-client-2025-11-20';

export type StreamResult = {
  ttftMs: number | null;
  /** When a valid answer JSON could first be parsed (strict). */
  answerMs: number | null;
  totalMs: number;
  text: string;
  answer: AnswerJson | null;
  aborted: boolean;
};

export type StreamFn = (args: StreamArgs) => Promise<StreamResult>;

const now = (): number => performance.now();

/** Default provider streaming. Anthropic uses its SDK; OpenAI + xAI share the
 *  OpenAI-compatible chat API (xAI just swaps the base URL). */
export const streamAnswer: StreamFn = (args) => {
  switch (args.provider) {
    case 'anthropic':
      return streamAnthropic(args);
    case 'openai':
    case 'xai':
      return streamOpenAiCompatible(args);
    default:
      return Promise.reject(
        new Error(
          `provider "${args.provider}" has no default streaming adapter — override answer() in agent.ts`,
        ),
      );
  }
};

async function streamAnthropic(args: StreamArgs): Promise<StreamResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const t0 = now();
  const state = newState();
  const opts = args.signal ? { signal: args.signal } : {};
  try {
    if (args.mcp) {
      // Grounded turn: beta Messages API + the remote-MCP connector. The provider
      // drives the tool loop, so we still just read the streamed text.
      const stream = client.beta.messages.stream(
        {
          model: args.model,
          max_tokens: args.maxTokens,
          system: args.system,
          messages: [{ role: 'user', content: args.user }],
          betas: [ANTHROPIC_MCP_BETA],
          mcp_servers: [
            {
              type: 'url',
              name: 'ably-os',
              url: args.mcp.url,
              authorization_token: args.mcp.authorizationToken,
              tool_configuration: { allowed_tools: [...args.mcp.allowedTools] },
            },
          ],
        },
        opts,
      );
      stream.on('text', (delta: string) => onText(state, delta, t0, args));
      await stream.finalMessage();
    } else {
      const stream = client.messages.stream(
        {
          model: args.model,
          max_tokens: args.maxTokens,
          system: args.system,
          messages: [{ role: 'user', content: args.user }],
        },
        opts,
      );
      stream.on('text', (delta: string) => onText(state, delta, t0, args));
      await stream.finalMessage();
    }
  } catch (err) {
    if (!isAbort(err, args.signal)) throw err;
    state.aborted = true;
  }
  return finalize(state, t0);
}

async function streamOpenAiCompatible(args: StreamArgs): Promise<StreamResult> {
  const isXai = args.provider === 'xai';
  const client = new OpenAI({
    apiKey: process.env[isXai ? 'XAI_API_KEY' : 'OPENAI_API_KEY'],
    ...(isXai ? { baseURL: 'https://api.x.ai/v1' } : {}),
  });
  const t0 = now();
  const state = newState();
  try {
    const stream = await client.chat.completions.create(
      {
        model: args.model,
        // OpenAI's current models (gpt-5.x, o-series) reject `max_tokens` and
        // require `max_completion_tokens`; xAI's grok still uses `max_tokens`.
        ...(isXai
          ? { max_tokens: args.maxTokens }
          : { max_completion_tokens: args.maxTokens }),
        stream: true,
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
      },
      args.signal ? { signal: args.signal } : {},
    );
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) onText(state, delta, t0, args);
    }
  } catch (err) {
    if (!isAbort(err, args.signal)) throw err;
    state.aborted = true;
  }
  return finalize(state, t0);
}

// --- shared streaming state -------------------------------------------------
type StreamState = {
  text: string;
  ttftMs: number | null;
  answerMs: number | null;
  answer: AnswerJson | null;
  aborted: boolean;
};
function newState(): StreamState {
  return { text: '', ttftMs: null, answerMs: null, answer: null, aborted: false };
}
function onText(s: StreamState, delta: string, t0: number, args: StreamArgs): void {
  if (s.ttftMs === null) s.ttftMs = now() - t0;
  s.text += delta;
  args.onDelta?.(delta, s.text);
  if (!s.answer) {
    const parsed = extractAnswer(s.text);
    if (parsed) {
      s.answer = parsed;
      s.answerMs = now() - t0;
    }
  }
}
function finalize(s: StreamState, t0: number): StreamResult {
  return {
    ttftMs: s.ttftMs,
    answerMs: s.answerMs,
    totalMs: now() - t0,
    text: s.text,
    answer: s.answer,
    aborted: s.aborted,
  };
}
function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const name = (err as { name?: string })?.name;
  return name === 'AbortError' || name === 'APIUserAbortError';
}

// --- JSON extraction --------------------------------------------------------
// The stream is "<prose think-aloud>\n<json>". Strict: find the first '{' and
// try the largest balanced-looking substring, shrinking until one parses to a
// valid AnswerJson. Returns null until a valid answer is present.
export function extractAnswer(buffer: string): AnswerJson | null {
  const start = buffer.indexOf('{');
  if (start === -1) return null;
  for (let end = buffer.length; end > start; end--) {
    if (buffer[end - 1] !== '}') continue;
    try {
      const ans = coerceAnswer(JSON.parse(buffer.slice(start, end)));
      if (ans) return ans;
    } catch {
      // keep shrinking
    }
  }
  return null;
}

// Loose fallback for when strict JSON never parses — e.g. an unescaped quote in
// the quip (observed in S0: 99.7% valid, the one miss had a clear choice). The
// choice is what scores, so recover it (+ best-effort confidence/quip) by regex.
export function extractAnswerLoose(buffer: string): AnswerJson | null {
  const choiceM = /"choice"\s*:\s*"?\\?"?([ABCD])/i.exec(buffer);
  if (!choiceM) return null;
  const choice = choiceM[1]!.toUpperCase() as Choice;
  const confM = /"confidence"\s*:\s*(-?[0-9]*\.?[0-9]+)/.exec(buffer);
  const confidence = confM ? clamp01(Number(confM[1])) : 0;
  const quipM = /"quip"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/.exec(buffer.trim());
  const quip = (quipM?.[1] ?? '').slice(0, 80);
  return { choice, confidence, quip };
}

function coerceAnswer(obj: unknown): AnswerJson | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const choice = typeof o.choice === 'string' ? o.choice.trim().toUpperCase() : '';
  if (choice !== 'A' && choice !== 'B' && choice !== 'C' && choice !== 'D') return null;
  const confidence = typeof o.confidence === 'number' ? o.confidence : Number(o.confidence);
  const quip = typeof o.quip === 'string' ? o.quip : '';
  return { choice, confidence: Number.isFinite(confidence) ? clamp01(confidence) : 0, quip };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
