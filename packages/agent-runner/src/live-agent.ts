// Put ONE agent into a live quiz (BRIEF §B2.7, §B3 S4.2). This is the only place
// the agent runner touches real Ably + AI Transport; the answer core (runner.ts)
// and the delta→chunk mapper (think-stream.ts) stay I/O-free and unit-tested,
// so this module is what the live end-to-end verification exercises.
//
// The agent wears two presences (§B2.1):
//   1. roster presence on the main channel `quiz:{id}` — {name,emoji,model,owner}
//      + a `a:{slug}` clientId — this is what the host/screen AGENTS column shows.
//   2. AIT session presence on `quiz-agent:{id}:{slug}` — its live status
//      (joining → idle → thinking → answered) alongside the streamed thinking.
//
// Thinking streams over AIT using the "self-invocation" workaround
// (docs/AIT-DX-FINDINGS.md, pinned SDK 0.5.0): AIT has no first-class
// agent-initiated turn, so a co-located ClientSession publishes the question as
// the triggering user turn, we convert that to an Invocation in-process (no
// HTTP), and stream the think-aloud through our AgentSession's run.
//
// Answers do NOT go over AIT — the agent publishes `{idx,choice}` to the plain
// fan-in channel `quiz-answers:{id}`, same clock and contract as every human.

import { createAgentSession, createClientSession, UIMessageCodec } from '@ably/ai-transport/vercel';
import * as Ably from 'ably';
import { LiveObjects } from 'ably/liveobjects';
import {
  agentChannel,
  answersChannel,
  mainChannel,
  parseControlMessage,
  type ControlMessage,
} from '@ably-quiz/core';
import { answerQuestion, type AnswerContext } from './runner';
import { type AgentManifest, type Question } from './schema';
import { createThinkAloudStream } from './think-stream';

/** Ceiling on AIT `run.start()` (trigger location) before we give up on the
 *  thinking stream for a question — degrades to "no thinking", never a hang. */
const START_TIMEOUT_MS = 8000;
/** How long `close()` waits for in-flight work before tearing down regardless. */
const CLOSE_DRAIN_MS = 10_000;
/** Ceiling on the initial connection handshake. A network blip drives the
 *  connection connecting→disconnected→suspended and never emits `failed`, so an
 *  unbounded wait would hang the whole roster's startup (cli.ts awaits them
 *  together). Bound it so a stalled connect fails THIS agent only. */
const CONNECT_TIMEOUT_MS = 15_000;

/** AIT session presence — the agent's live status on its own channel (§B2.1). */
export type AgentPresenceState = 'joining' | 'idle' | 'thinking' | 'answered';
export type AgentPresence = { state: AgentPresenceState; idx?: number; quip?: string };

/** Roster presence on the main channel — what the AGENTS column renders (§B2.7). */
export type AgentRosterPresence = {
  name: string;
  emoji: string;
  model: string;
  owner: string;
};

export type LiveAgentOptions = AnswerContext & {
  quizId: string;
  agent: AgentManifest;
  /** Where `/api/ably-auth` lives (the web dev server; NOT :3000 — see the CLI). */
  authBaseUrl: string;
  /** Optional log sink; defaults to a slug-prefixed console line. */
  log?: (msg: string) => void;
};

export type LiveAgent = {
  readonly clientId: string;
  /** Leave both presences and close the sessions + connection. Idempotent. */
  close: () => Promise<void>;
};

/**
 * Connect `agent` to the quiz and run it for the quiz's lifetime. Resolves once
 * the agent is fully joined (both presences entered, control subscription live);
 * it then reacts to `question` broadcasts until `close()`.
 */
export async function runLiveAgent(opts: LiveAgentOptions): Promise<LiveAgent> {
  const { quizId, agent } = opts;
  const log = opts.log ?? ((m: string) => console.log(`[${agent.slug}] ${m}`));
  const answerCtx: AnswerContext = { digest: opts.digest, crib: opts.crib };

  const { client, clientId } = await connectAgent(quizId, agent.slug, opts.authBaseUrl);
  log(`connected as ${clientId}`);

  // From here on a failure must tear the client down, or a half-joined agent
  // leaks a live connection + a stale presence member (one per failed start).
  const main = client.channels.get(mainChannel(quizId), { modes: ['SUBSCRIBE', 'PRESENCE'] });
  const channelName = agentChannel(quizId, agent.slug);
  const agentSession = createAgentSession({ client, channelName });
  const puppet = createClientSession({ client, channelName });
  const answers = client.channels.get(answersChannel(quizId));

  // The answer path and the AIT thinking stream are DECOUPLED. Answers are what
  // the quiz waits on, so they run per-question and independently — never behind
  // AIT. Thinking is best-effort eye-candy, so it's serialized on its own chain
  // (one AIT run at a time) and can never stall an answer (§B2.7 step 3): even a
  // hung `run.start()` only delays later *thinking*, not later *answers*.
  const answered = new Set<number>(); // first-question-wins, mirrors the human contract
  const answerTasks: Promise<void>[] = [];
  let thinkingChain: Promise<void> = Promise.resolve();

  const onControl = (raw: unknown): void => {
    const msg = parseControlMessage(raw);
    if (!msg || msg.type !== 'question' || answered.has(msg.idx)) return;
    answered.add(msg.idx);
    const question = toQuestion(msg);
    const think = createThinkAloudStream(`q${question.idx}-think`);

    const answerTask = runAnswer({ agent, question, answerCtx, agentSession, answers, think, log });
    answerTasks.push(answerTask);
    // Stream the think-aloud over AIT. It reads the SAME `think` stream the answer
    // path fills — live if it starts in time, else draining the buffered+closed
    // stream — so it's correct whether it runs concurrently or after the answer.
    thinkingChain = thinkingChain.then(() =>
      streamThinking({ question, agentSession, puppet, think, log }),
    );
  };
  const control = (m: Ably.InboundMessage): void => onControl(m.data);

  // From here on a failure must tear the client down, or a half-joined agent
  // leaks a live connection + a stale presence member (one per failed start).
  try {
    // (1) Roster presence on the main channel — the AGENTS column (§B2.7 step 1).
    await main.presence.enter({
      name: agent.name,
      emoji: agent.emoji,
      model: agent.model,
      owner: agent.owner,
    } satisfies AgentRosterPresence);
    // (2) The AIT session pair on the agent channel: our AgentSession streams the
    // thinking; the co-located ClientSession mints the triggering turn (workaround).
    await agentSession.connect();
    await agentSession.presence.enter({ state: 'joining' } satisfies AgentPresence);
    await puppet.connect();
    await agentSession.presence.update({ state: 'idle' } satisfies AgentPresence);
    await main.subscribe('control', control);
  } catch (err) {
    client.close();
    throw err;
  }
  log(`joined quiz ${quizId} — watching for questions`);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    main.unsubscribe('control', control); // stop taking new questions
    // Let in-flight work settle, but never block teardown on it (a hung AIT run
    // must not wedge close() — that would hang the CLI's Ctrl-C shutdown).
    await safe(() => withTimeout(Promise.allSettled(answerTasks), CLOSE_DRAIN_MS));
    await safe(() => withTimeout(thinkingChain, CLOSE_DRAIN_MS));
    await safe(() => agentSession.presence.leave());
    await safe(() => main.presence.leave());
    await safe(() => agentSession.end());
    await safe(() => puppet.close());
    client.close();
  };

  return { clientId, close };
}

// --- the answer path (what the quiz waits on) -------------------------------

type ThinkAloud = ReturnType<typeof createThinkAloudStream>;

type AnswerDeps = {
  agent: AgentManifest;
  question: Question;
  answerCtx: AnswerContext;
  agentSession: ReturnType<typeof createAgentSession>;
  answers: Ably.RealtimeChannel;
  think: ThinkAloud;
  log: (msg: string) => void;
};

/**
 * Produce and publish the agent's answer for one question — the ONLY thing the
 * quiz waits on. Bounded by the runner's own deadline (`limitMs − 2000`, §B2.7
 * step 3). Never throws: a model failure just means no answer (scores 0). Always
 * ends the `think` stream (in `finally`) so the AIT pipe can never hang.
 */
async function runAnswer(deps: AnswerDeps): Promise<void> {
  const { agent, question, answerCtx, agentSession, answers, think, log } = deps;
  const idx = question.idx;

  await safe(() =>
    agentSession.presence.update({ state: 'thinking', idx } satisfies AgentPresence),
  );

  let outcome: Awaited<ReturnType<typeof answerQuestion>> | null = null;
  try {
    outcome = await answerQuestion(agent, question, { ...answerCtx, onThinking: think.onThinking });
  } catch (err) {
    log(`answer for q${idx} errored: ${errMsg(err)}`);
  } finally {
    think.close(); // end the think-aloud message even on error, so the pipe resolves
  }

  if (outcome?.choice) {
    await safe(() =>
      answers.publish('answer', {
        idx,
        choice: outcome.choice,
        ...(Number.isFinite(outcome.confidence) ? { confidence: outcome.confidence } : {}),
      }),
    );
    const flags = [outcome.timedOut && 'timed-out', outcome.forcedGuess && 'forced'].filter(
      Boolean,
    );
    log(
      `q${idx} → ${outcome.choice}${flags.length ? ` (${flags.join(', ')})` : ''}` +
        `${outcome.answerMs ? ` in ${Math.round(outcome.answerMs)}ms` : ''}`,
    );
  } else {
    log(`q${idx} → no answer (scores 0)`);
  }

  await safe(() =>
    agentSession.presence.update({
      state: 'answered',
      idx,
      ...(outcome?.quip ? { quip: outcome.quip } : {}),
    } satisfies AgentPresence),
  );
}

// --- the thinking stream (best-effort, never blocks answers) ----------------

type ThinkingDeps = {
  question: Question;
  agentSession: ReturnType<typeof createAgentSession>;
  puppet: ReturnType<typeof createClientSession>;
  think: ThinkAloud;
  log: (msg: string) => void;
};

/**
 * Stream the visible think-aloud over AIT via the self-invocation workaround: the
 * co-located ClientSession publishes the question as a user turn, we convert it to
 * an Invocation in-process, and pipe the think-aloud through our AgentSession run.
 * Materialized history then gives inspectable per-question runs for free. Best
 * effort — bounded and swallowed, so it can never affect the answer path.
 */
async function streamThinking(deps: ThinkingDeps): Promise<void> {
  const { question, agentSession, puppet, think, log } = deps;
  try {
    const clientRun = await puppet.view.send(
      UIMessageCodec.createUserMessage({
        id: `q-${question.idx}`,
        role: 'user',
        parts: [{ type: 'text', text: renderQuestion(question) }],
      }),
    );
    const run = agentSession.createRun(clientRun.toInvocation());
    // `run.start()` locates the self-published trigger (~500ms). Bound it — the
    // findings doc rates the workaround "fragility moderate"; a lost trigger must
    // degrade to "no thinking shown", never a hung promise on the chain.
    await withTimeout(run.start(), START_TIMEOUT_MS);
    await run.pipe(think.stream); // resolves when runAnswer's finally closes the stream
    await run.end({ reason: 'complete' });
  } catch (err) {
    log(`thinking stream for q${question.idx} failed: ${errMsg(err)}`);
    think.fail(err); // no-op if runAnswer already closed it
  }
}

// --- connection -------------------------------------------------------------

/** Open a Realtime client authed as this agent (clientId `a:{slug}`), token kept
 *  fresh via the same `/api/ably-auth` endpoint humans use. LiveObjects is
 *  attached because AIT sessions may use object modes (§B2.7 auth note). */
async function connectAgent(
  quizId: string,
  slug: string,
  authBaseUrl: string,
): Promise<{ client: Ably.Realtime; clientId: string }> {
  const body = { quizId, role: 'agent', slug };
  // The agent clientId is derived from the slug server-side, so every token
  // fetch resolves to the same `a:{slug}` — safe to pin on the client up front.
  const first = await fetchToken(authBaseUrl, body);
  const client = new Ably.Realtime({
    clientId: first.clientId,
    plugins: { LiveObjects },
    authCallback: (_params, cb) => {
      fetchToken(authBaseUrl, body).then(
        (r) => cb(null, r.token),
        (err: unknown) => cb(err instanceof Error ? err.message : String(err), null),
      );
    },
  });
  // Bound the handshake and close the client if it doesn't connect in time (or
  // fails), so a stalled connect never hangs startup and never leaks a client.
  try {
    await withTimeout(whenConnected(client), CONNECT_TIMEOUT_MS);
  } catch (err) {
    client.close();
    throw err;
  }
  return { client, clientId: first.clientId };
}

type TokenResponse = { token: string; clientId: string };

async function fetchToken(base: string, body: Record<string, unknown>): Promise<TokenResponse> {
  const res = await fetch(`${base}/api/ably-auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`auth ${res.status}: ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

function whenConnected(client: Ably.Realtime): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.connection.state === 'connected') return resolve();
    client.connection.once('connected', () => resolve());
    client.connection.once('failed', () =>
      reject(
        new Error(`connection failed: ${client.connection.errorReason?.message ?? 'unknown'}`),
      ),
    );
  });
}

// --- helpers ----------------------------------------------------------------

function toQuestion(msg: Extract<ControlMessage, { type: 'question' }>): Question {
  return {
    idx: msg.idx,
    prompt: msg.prompt,
    options: msg.options,
    limitMs: msg.limitMs,
    ...(msg.category ? { category: msg.category } : {}),
  };
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Human-readable question for the AIT user turn (materialized history). */
function renderQuestion(q: Question): string {
  const opts = q.options.map((o, i) => `${LETTERS[i]}) ${o}`).join('\n');
  return `${q.prompt}\n${opts}`;
}

/** Run a side-effect, swallowing+logging failures — used for best-effort presence
 *  updates and teardown, which must never throw into the quiz flow. */
async function safe(fn: () => Promise<unknown> | undefined): Promise<void> {
  try {
    await fn();
  } catch {
    /* best-effort */
  }
}

/** Reject if `p` doesn't settle within `ms`. The underlying op keeps running
 *  (detached) — callers use this only where a hung promise must never wedge a
 *  chain; the abandoned work is cleaned up by session/connection teardown. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
