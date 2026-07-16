// Streaming provider adapters + incremental JSON extraction — the heart of the
// agent runner, carried over from the proven S0 latency spike (BRIEF §B2.7).
//
// Each call streams a short visible think-aloud then strict answer JSON; we
// parse the answer incrementally so the quiz can act the moment it's valid.
// The stream is abort-tolerant: on the deadline (§B2.7 step 3) the caller aborts
// and we return whatever streamed, so the runner can still force a best guess.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { mcpResultText, type McpCallResult } from './mcp-client';
import { getMcpSession, invalidateMcpSession, type McpSession } from './mcp-session';
import type { Provider } from './schema';

export type Choice = 'A' | 'B' | 'C' | 'D';
export type AnswerJson = { choice: Choice; confidence: number; quip: string };

/** Remote MCP grounding, driven CLIENT-SIDE (§S6.7): we open a direct MCP client
 *  and run the tool loop ourselves rather than via Anthropic's `mcp_servers`
 *  connector (whose transport added ~5s/call + 300s stalls). The host's
 *  short-lived read-only token is passed per turn and never stored. Anthropic
 *  models only (the loop uses the Anthropic Messages tool API). */
export type McpConnector = {
  /** The MCP server endpoint (Streamable HTTP, e.g. `…/mcp?mode=full`). */
  url: string;
  authorizationToken: string;
  /** Tools the model may use — the FAST ones (e.g. getAutomaticContext,
   *  getContextDetail); anything unlisted is filtered out before the model sees it. */
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

/** One MCP tool the model called during a grounded turn (§S6.6). input/result
 *  are truncated server-side so a transcript message stays small. */
export type ToolCall = {
  name: string;
  server?: string;
  input?: string;
  result?: string;
  isError?: boolean;
  /** How long the call itself took — surfaces in the conversation viewer. */
  ms?: number;
};

export type StreamResult = {
  ttftMs: number | null;
  /** When a valid answer JSON could first be parsed (strict). */
  answerMs: number | null;
  totalMs: number;
  text: string;
  answer: AnswerJson | null;
  aborted: boolean;
  /** MCP tool calls the model made this turn (grounded turns only; else empty). */
  toolCalls: ToolCall[];
};

export type StreamFn = (args: StreamArgs) => Promise<StreamResult>;

const now = (): number => performance.now();

/** All agents answer through the Vercel AI Gateway — one key (`AI_GATEWAY_API_KEY`),
 *  unified billing, every provider behind `provider/model`. The ONE exception is a
 *  grounded Anthropic turn: the MCP connector is an Anthropic-Messages feature the
 *  OpenAI-compatible gateway can't carry, so those go direct to Anthropic. */
export const GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

export const streamAnswer: StreamFn = (args) => {
  if (args.mcp) return streamAnthropicGrounded(args);
  return streamViaGateway(args);
};

/** The gateway model id: `provider/model` (e.g. `anthropic/claude-opus-4-8`). */
export function gatewayModel(provider: Provider, model: string): string {
  return `${provider}/${model}`;
}

/** Preflight: a tiny real gateway call to confirm an agent's model answers —
 *  catches auth/quota/unknown-model issues before the quiz. Returns null on
 *  success, else the (short) error message. */
export async function pingModel(provider: Provider, model: string): Promise<string | null> {
  try {
    const client = new OpenAI({
      apiKey: process.env.AI_GATEWAY_API_KEY,
      baseURL: GATEWAY_BASE_URL,
    });
    await client.chat.completions.create({
      model: gatewayModel(provider, model),
      max_tokens: 16, // OpenAI models via the gateway require >= 16
      messages: [{ role: 'user', content: 'ping' }],
    });
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.slice(0, 200);
  }
}

async function streamViaGateway(args: StreamArgs): Promise<StreamResult> {
  const client = new OpenAI({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: GATEWAY_BASE_URL,
  });
  const t0 = now();
  const state = newState();
  try {
    const stream = await client.chat.completions.create(
      {
        model: gatewayModel(args.provider, args.model),
        max_tokens: args.maxTokens,
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

// The grounded loop calls Anthropic directly; some short model ids the gateway
// accepts may need normalizing to a direct-API id here. An unmapped/retired id
// 404s and the turn falls back to ungrounded (live-observed 2026-07-16 with the
// retired claude-3-haiku-20240307) — prefer fixing the agent's manifest to a
// current model over adding an alias.
const DIRECT_MODEL_ALIASES: Record<string, string> = {};

/** How many model↔tool rounds a grounded turn may take before it must answer.
 *  Keeps the loop inside the quiz deadline; the fast primer needs ~3 (§S6.7). */
const GROUNDED_MAX_TURNS = 4;
const GROUNDED_MAX_TOKENS = 1024;

/** Run one tool call on the SHARED session, surviving server-side session expiry:
 *  an HTTP 404 means the session died (worker restart/expiry) — invalidate the
 *  cache, take a fresh session, and retry the call ONCE. */
async function callSharedTool(
  session: McpSession,
  mcp: { url: string; authorizationToken: string },
  name: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<McpCallResult> {
  const r = await session.client.callTool(name, input, { signal });
  if (r.status !== 404) return r;
  invalidateMcpSession(mcp.url, mcp.authorizationToken);
  const fresh = await getMcpSession(mcp.url, mcp.authorizationToken);
  return fresh.client.callTool(name, input, { signal });
}

/**
 * Grounded turn (§S6.7): a CLIENT-SIDE MCP tool loop. Take the SHARED, already-
 * initialized MCP session (§S6.9 — the ~5s handshake is paid once per process,
 * not per turn), hand the ALLOWLISTED tools to the model as ordinary tools, and
 * execute each `tool_use` ourselves — feeding results back until the model
 * produces its answer. When the model batches several tool_use blocks in one
 * turn they run CONCURRENTLY (each call is ~0.1-0.3s; the win is that a batch
 * costs one model round-trip instead of several). This replaces Anthropic's
 * `mcp_servers` connector, whose transport added ~5s/call and stalled up to
 * 300s. Needs ANTHROPIC_API_KEY. Throws on setup failure so the route can retry
 * ungrounded; a deadline abort returns whatever we have.
 */
async function streamAnthropicGrounded(args: StreamArgs): Promise<StreamResult> {
  const mcp = args.mcp!;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = DIRECT_MODEL_ALIASES[args.model] ?? args.model;
  const t0 = now();
  const state = newState();
  // The allowlist is the SAFETY GATE, not an optimization: a full-mode token
  // exposes the server's entire tool surface INCLUDING WRITE TOOLS, and the
  // server does not enforce any allowlist server-side. Refuse to ground rather
  // than hand the model everything — the route falls back to ungrounded.
  const allow = mcp.allowedTools;
  if (allow.length === 0) {
    throw new Error('mcp.allowedTools is empty — set ABLY_MCP_TOOLS; refusing to expose all tools');
  }
  try {
    const session = await getMcpSession(mcp.url, mcp.authorizationToken);
    const usable = session.tools.filter((t) => allow.includes(t.name));
    if (usable.length === 0) throw new Error('MCP server exposed no usable tools');
    const anthropicTools: Anthropic.Tool[] = usable.map((t) => ({
      name: t.name,
      description: (t.description ?? '').slice(0, 1024),
      input_schema: (t.inputSchema ?? { type: 'object' }) as Anthropic.Tool.InputSchema,
    }));

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: args.user }];
    for (let turn = 0; turn < GROUNDED_MAX_TURNS; turn++) {
      if (args.signal?.aborted) {
        state.aborted = true;
        break;
      }
      const res = await anthropic.messages.create(
        {
          model,
          max_tokens: GROUNDED_MAX_TOKENS,
          system: args.system,
          messages,
          tools: anthropicTools,
        },
        args.signal ? { signal: args.signal } : {},
      );
      if (state.ttftMs === null) state.ttftMs = now() - t0;
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (text) {
        state.text = text;
        args.onDelta?.(text, text);
        if (!state.answer) {
          const parsed = extractAnswer(text);
          if (parsed) {
            state.answer = parsed;
            state.answerMs = now() - t0;
          }
        }
      }
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason !== 'tool_use') break;
      // Execute every tool the model asked for — CONCURRENTLY when it batched
      // several in one turn — and feed the results back in request order.
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const settled = await Promise.all(
        uses.map(async (b) => {
          const r = await callSharedTool(session, mcp, b.name, b.input, args.signal);
          return { b, r, out: mcpResultText(r.result) };
        }),
      );
      // Record + feed back in REQUEST order (completion order varies), so the
      // transcript viewer shows the calls as the model asked for them.
      const results: Anthropic.ToolResultBlockParam[] = settled.map(({ b, r, out }) => {
        state.toolCalls.push({
          name: b.name,
          input: truncate(safeJson(b.input), MAX_TOOL_INPUT),
          result: truncate(out || (r.error ? safeJson(r.error) : ''), MAX_TOOL_RESULT),
          isError: Boolean(r.error),
          ms: r.ms,
        });
        return {
          type: 'tool_result' as const,
          tool_use_id: b.id,
          content: out.slice(0, 8000) || 'no content returned',
          is_error: Boolean(r.error),
        };
      });
      messages.push({ role: 'user', content: results });
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
  toolCalls: ToolCall[];
};
function newState(): StreamState {
  return { text: '', ttftMs: null, answerMs: null, answer: null, aborted: false, toolCalls: [] };
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
    toolCalls: s.toolCalls,
  };
}

// Tool input/result are truncated so a transcript message stays small (§S6.6).
const MAX_TOOL_INPUT = 400;
const MAX_TOOL_RESULT = 600;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
function safeJson(v: unknown): string {
  if (v == null) return '';
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return '';
  }
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
