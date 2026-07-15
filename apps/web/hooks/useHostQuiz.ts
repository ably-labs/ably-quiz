'use client';

import {
  parseAgentTranscript,
  parseAnswerMessage,
  parseControlMessage,
  Quizmaster,
  type AgentTranscript,
  type Choice,
  type CounterfactualPayload,
  type InboundAnswer,
  type QuizState,
} from '@ably-quiz/core';
import type * as Ably from 'ably';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Connection } from '@/lib/ably';
import { presenceToMembers, type Member } from '@/hooks/useAbly';
import { upsertTranscript, type QuestionBroadcast } from '@/hooks/useQuizState';
import {
  AblyBroadcaster,
  AblyLiveStore,
  AGENT_QUIPS_EVENT,
  AGENT_TRANSCRIPT_EVENT,
  answersChannel,
  getMainChannel,
  INITIAL_STATE,
  loadAgentTranscripts,
  loadAnswerHistory,
  loadControlHistory,
  publishCounterfactual,
  subscribeQuizState,
  type LiveQuizState,
} from '@/lib/quiz-live';
import type { StoredQuiz } from '@/lib/quiz-storage';

/** Stable empty default for the optional `unavailable` set (avoids re-renders). */
const EMPTY_SET: ReadonlySet<string> = new Set();

export type HostControls = {
  next: () => Promise<void>;
  lock: () => Promise<void>;
  reveal: () => Promise<void>;
  podium: () => Promise<void>;
  /** podium → analysis (fires the commentator, §B2.9). */
  analysis: () => Promise<void>;
  /** analysis → done. */
  done: () => Promise<void>;
};

/** Runs the quizmaster in the host browser: wires Ably answers → ingest,
 *  presence → display names + roster, and exposes phase state + host controls. */
export function useHostQuiz(
  conn: Connection | null,
  quiz: StoredQuiz | null,
  /** Host's MCP token (§S6). When present, grounded agents look up Ably
   *  knowledge; passed per turn, never stored server-side. */
  mcpToken: string | null = null,
  /** Agent slugs that failed the preflight — don't fire their turns, and drop
   *  them from the expected-answerer count so a dead model can't stall the quiz. */
  unavailable: ReadonlySet<string> = EMPTY_SET,
): {
  state: QuizState;
  /** Correct letter for the current question (host-only readout). */
  correct: Choice | null;
  /** The current question as broadcast (shuffled options), for the host console. */
  question: QuestionBroadcast | null;
  /** Live tallies + scoreboard the quizmaster is publishing (read back off LiveObjects). */
  live: LiveQuizState;
  controls: HostControls;
  answersIn: number;
  /** Humans present + declared agents — the "X of Y answered" denominator (§S4.4). */
  expectedAnswerers: number;
  busy: boolean;
  members: Member[];
  /** "By the way…" standings under every algorithm — built + published at analysis (§S5.1). */
  counterfactual: CounterfactualPayload | null;
  /** Every agent's per-question turn record for the conversation viewer (§S6.6). */
  agentTranscripts: AgentTranscript[];
} {
  const qmRef = useRef<Quizmaster | null>(null);
  // The writable main channel, stashed so `reveal` can re-publish the gathered
  // quips at reveal time (§S5.3) without re-deriving the channel/modes.
  const mainRef = useRef<Ably.RealtimeChannel | null>(null);
  // Agents' one-liners captured off the host-only answers fan-in, keyed idx→slug→quip.
  // Web-only: the quizmaster engine never sees quips (kept out of core). Released
  // to /screen at reveal via `agent-quips` on the main channel (§S5.3).
  const quipsRef = useRef<Map<number, Map<string, string>>>(new Map());
  // Full per-turn transcripts captured off the host-only fan-in, keyed
  // idx→slug→transcript. Released at reveal on the main channel for the
  // conversation viewer (§S6.6) — same wire-safe path as quips.
  const transcriptsRef = useRef<Map<number, Map<string, AgentTranscript>>>(new Map());
  const [state, setState] = useState<QuizState>({ phase: 'lobby', questionIdx: -1 });
  const [correct, setCorrect] = useState<Choice | null>(null);
  const [question, setQuestion] = useState<QuestionBroadcast | null>(null);
  const [live, setLive] = useState<LiveQuizState>(INITIAL_STATE);
  // clientIds that answered the currently-open question (from the engine log).
  // We keep the ids, not a raw count, so the "answered" total can exclude a
  // preflight-failed agent's answer reactively (see the derived `answersIn`).
  const [answeredIds, setAnsweredIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [counterfactual, setCounterfactual] = useState<CounterfactualPayload | null>(null);
  // Correct-stamped transcripts the host released at reveal, read back off the
  // main channel (own echoes) for the host's own conversation viewer (§S6.6).
  const [agentTranscripts, setAgentTranscripts] = useState<AgentTranscript[]>([]);

  useEffect(() => {
    if (!conn || !quiz) return;
    const client = conn.client;
    const qm = new Quizmaster({
      quizId: quiz.quizId,
      questions: quiz.questions,
      config: quiz.config,
      broadcaster: new AblyBroadcaster(client, quiz.quizId),
      store: new AblyLiveStore(client, quiz.quizId),
    });
    qmRef.current = qm;
    // Seed declared agents' display names so the scoreboard reads "Matt GPT" even
    // though on-demand agents answer via /api/agent-turn without entering presence.
    for (const a of quiz.config.agents ?? []) qm.setDisplayName(`a:${a.slug}`, a.name);

    const main = getMainChannel(client, quiz.quizId, { write: true });
    mainRef.current = main; // reused by `reveal` to release quips (§S5.3)
    const answers = client.channels.get(answersChannel(quiz.quizId));
    const refresh = async () => {
      const roster = presenceToMembers(await main.presence.get());
      setMembers(roster);
      for (const m of roster) qm.setDisplayName(m.clientId, m.name);
    };

    // Until history is replayed the engine hasn't got its phase/T₀ back, so
    // buffer inbound answers rather than feeding them to a lobby-state engine
    // that would ignore them. The engine dedupes on replay, so a buffered
    // answer that also appears in history is counted once.
    let ready = false;
    const buffer: InboundAnswer[] = [];
    const ingest = (raw: InboundAnswer) => {
      qm.ingest(raw);
      // Count distinct answers for the CURRENTLY-OPEN question from the engine's
      // authoritative log — not a raw increment (which over-counts late/duplicate
      // messages) and not the scoreboard's `answered` flag (which lags a question
      // transition over LiveObjects and reads stale, tripping a premature
      // auto-lock that drops slower answerers — 2026-07-13 4-agent smoke).
      const openIdx = qm.getState().questionIdx;
      setAnsweredIds(
        qm
          .getAnswerLog()
          .filter((e) => e.idx === openIdx)
          .map((e) => e.clientId),
      );
    };
    // Stash an agent's reveal-time quip off the fan-in (host-subscribe-only, so it
    // never reaches players mid-question). Keyed idx→slug→quip; the engine ignores
    // quips — this is a web-only capture released at reveal (§S5.3).
    const captureQuip = (clientId: string, data: unknown) => {
      if (!clientId.startsWith('a:')) return;
      const parsed = parseAnswerMessage(data);
      if (!parsed?.quip) return;
      const slug = clientId.slice(2);
      let byIdx = quipsRef.current.get(parsed.idx);
      if (!byIdx) {
        byIdx = new Map();
        quipsRef.current.set(parsed.idx, byIdx);
      }
      byIdx.set(slug, parsed.quip);
    };
    // Stash an agent's full turn transcript off the fan-in (host-subscribe-only,
    // so its reasoning/tools never reach players mid-question). Keyed idx→slug;
    // released at reveal (§S6.6). `transcript` messages are NOT answers — never
    // ingested by the engine.
    const captureTranscript = (msg: Ably.Message) => {
      const t = parseAgentTranscript(msg.data);
      if (!t) return;
      let byIdx = transcriptsRef.current.get(t.idx);
      if (!byIdx) {
        byIdx = new Map();
        transcriptsRef.current.set(t.idx, byIdx);
      }
      byIdx.set(t.slug, { ...t, receivedAt: msg.timestamp ?? Date.now() });
    };
    const onAnswer = (msg: Ably.Message) => {
      if (msg.name === 'transcript') {
        captureTranscript(msg);
        return;
      }
      const raw: InboundAnswer = {
        clientId: msg.clientId ?? '',
        data: msg.data,
        serverTs: msg.timestamp ?? Date.now(),
      };
      captureQuip(raw.clientId, raw.data);
      if (ready) ingest(raw);
      else buffer.push(raw);
    };

    let cancelled = false;
    let disposed = false;

    // Mirror the broadcast question + the tallies/scoreboard the quizmaster writes,
    // so the host console shows exactly what players see. Both read off the SAME
    // write channel — no read-only mode clash with the quizmaster's own attach.
    const onControl = (msg: Ably.Message) => {
      const m = parseControlMessage(msg.data);
      if (disposed || m?.type !== 'question') return;
      setQuestion({
        idx: m.idx,
        prompt: m.prompt,
        options: m.options,
        limitMs: m.limitMs,
        startedAt: msg.timestamp ?? Date.now(),
      });
    };

    // The host reads back its own reveal-released transcripts (correct-stamped)
    // off the main channel for its own conversation viewer (§S6.6).
    const onTranscript = (msg: Ably.Message) => {
      const t = parseAgentTranscript(msg.data);
      if (t && !disposed) setAgentTranscripts((cur) => upsertTranscript(cur, t));
    };

    void (async () => {
      // Subscribe FIRST (attaches the channels) so no live message slips through
      // the gap between reading history and going live.
      await answers.subscribe(onAnswer);
      await main.subscribe('control', onControl);
      await main.subscribe(AGENT_TRANSCRIPT_EVENT, onTranscript);
      await main.presence.subscribe(() => void refresh());
      await subscribeQuizState(main, (s) => {
        if (!disposed) setLive(s);
      });
      await refresh();

      // Recover already-released transcripts so a host refresh mid-quiz keeps the
      // conversation viewer populated (§S6.6). Live echoes upsert over these.
      void loadAgentTranscripts(main).then((list) => {
        if (cancelled || !list.length) return;
        setAgentTranscripts((cur) => list.reduce(upsertTranscript, cur));
      });

      const [controlHistory, answerHistory] = await Promise.all([
        loadControlHistory(main),
        loadAnswerHistory(answers),
      ]);
      if (cancelled) return;

      // A quiz that already broadcast a question is mid-flight → rebuild it;
      // otherwise this is a fresh start.
      if (controlHistory.some((c) => c.msg.type === 'question')) {
        qm.recover(controlHistory, answerHistory);
        // Seed the console's question view too (host refresh mid-question).
        for (let i = controlHistory.length - 1; i >= 0; i--) {
          const c = controlHistory[i]!;
          if (c.msg.type === 'question') {
            const qm2 = c.msg;
            if (!disposed)
              setQuestion({
                idx: qm2.idx,
                prompt: qm2.prompt,
                options: qm2.options,
                limitMs: qm2.limitMs,
                startedAt: c.serverTs,
              });
            break;
          }
        }
      } else {
        qm.init();
      }

      ready = true;
      for (const raw of buffer.splice(0)) qm.ingest(raw); // dedup handles overlap
      const idx = qm.getState().questionIdx;
      setAnsweredIds(
        qm
          .getAnswerLog()
          .filter((e) => e.idx === idx)
          .map((e) => e.clientId),
      );
      setCorrect(qm.getCorrect(idx) ?? null);
      setState(qm.getState());
    })();

    return () => {
      cancelled = true;
      disposed = true;
      qmRef.current = null;
      mainRef.current = null;
      answers.unsubscribe();
      main.unsubscribe('control', onControl);
      main.unsubscribe(AGENT_TRANSCRIPT_EVENT, onTranscript);
      main.presence.unsubscribe();
    };
  }, [conn, quiz]);

  // Release the just-revealed question's agent quips on the main channel (§S5.3).
  // Fire-and-forget; only publishes when there are quips to show. Stable (refs
  // only), so it doesn't churn the `controls` memo.
  const publishQuips = useCallback((idx: number) => {
    const main = mainRef.current;
    const byIdx = quipsRef.current.get(idx);
    if (!main || !byIdx || byIdx.size === 0) return;
    const quips = [...byIdx].map(([slug, quip]) => ({ slug, quip }));
    void main.publish(AGENT_QUIPS_EVENT, { idx, quips }).catch(() => {});
  }, []);

  // Release this question's gathered agent transcripts on the main channel at
  // reveal (§S6.6) — one message per agent, stamped with `correct` now that the
  // answer is known. Off the host-only fan-in, so reasoning/tools never leaked
  // while the question was open. Fire-and-forget; stable (refs only).
  const publishTranscripts = useCallback((idx: number) => {
    const main = mainRef.current;
    const byIdx = transcriptsRef.current.get(idx);
    if (!main || !byIdx || byIdx.size === 0) return;
    const correctLetter = qmRef.current?.getCorrect(idx) ?? null;
    for (const t of byIdx.values()) {
      const correct = t.choice != null && correctLetter != null && t.choice === correctLetter;
      void main.publish(AGENT_TRANSCRIPT_EVENT, { ...t, correct }).catch(() => {});
    }
  }, []);

  const run = useCallback(async (fn: (qm: Quizmaster) => Promise<void>) => {
    const qm = qmRef.current;
    if (!qm) return;
    setBusy(true);
    try {
      await fn(qm);
    } catch (err) {
      // Auto-advance (timer + all-answered) is best-effort: a benign race — e.g. a
      // stale lock timer firing after the question already locked, or after End
      // early → podium — must not crash the host. The state machine still rejects
      // the illegal move; we just resync and carry on.
      console.warn('quizmaster control skipped:', err instanceof Error ? err.message : err);
    } finally {
      const next = qm.getState();
      setState(next);
      setCorrect(qm.getCorrect(next.questionIdx) ?? null);
      setBusy(false);
    }
  }, []);

  // Stable so the auto-advance effects below don't re-fire on every render.
  const controls = useMemo<HostControls>(
    () => ({
      next: () =>
        run(async (qm) => {
          setAnsweredIds([]);
          await qm.askNext();
        }),
      lock: () => run((qm) => qm.lock()),
      reveal: () =>
        run(async (qm) => {
          await qm.reveal();
          // The wire-safe reveal release: push this question's gathered agent
          // one-liners (§S5.3) and full transcripts (§S6.6) to the main channel.
          const idx = qm.getState().questionIdx;
          publishQuips(idx);
          publishTranscripts(idx);
        }),
      podium: () => run((qm) => qm.podium()),
      analysis: () => run((qm) => qm.analysis()),
      done: () => run((qm) => qm.done()),
    }),
    [run, publishQuips, publishTranscripts],
  );

  // Fire the commentator once when the quiz enters `analysis` (§B2.9). Standings
  // come from the live scoreboard; the breakdown streams to /screen. Alongside
  // it, publish the "by the way…" counterfactual (§S5.1) — recomputed standings
  // under every algorithm — so /screen · /play · host can show how the podium
  // would shift under other scoring rules.
  const firedCommentator = useRef(false);
  useEffect(() => {
    if (state.phase !== 'analysis' || !quiz || firedCommentator.current) return;
    firedCommentator.current = true;

    const qm = qmRef.current;
    if (conn && qm) {
      const payload = qm.buildCounterfactual();
      setCounterfactual(payload);
      const main = getMainChannel(conn.client, quiz.quizId, { write: true });
      void publishCounterfactual(main, payload).catch(() => undefined);
    }

    const entries = Object.values(live.scoreboard);
    const standings = entries
      .map((e) => ({ name: e.name, kind: e.kind, score: e.score }))
      .sort((a, b) => b.score - a.score);
    const totalOf = (kind: 'human' | 'agent') =>
      entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.score, 0);
    void fetch('/api/commentator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quizId: quiz.quizId,
        standings,
        humanTotal: totalOf('human'),
        agentTotal: totalOf('agent'),
        questionCount: quiz.questions.length,
      }),
    }).catch(() => undefined);
  }, [state.phase, quiz, live.scoreboard, conn]);

  // --- Auto-advance (Matt, 2026-07-13) ---------------------------------------
  // A question resolves the moment it's decided — everyone present has answered,
  // OR the timer runs out — no waiting on the host to Lock. Then it auto-reveals
  // (unless the quiz turns that off, to hold on "locked" for suspense).
  // Expected answerers = humans in presence + the declared agent roster (§S4.4).
  // On-demand agents answer via /api/agent-turn WITHOUT entering presence, so the
  // auto-lock target can't be presence-only. Union present + declared agent slugs
  // so a co-hosted persistent runner (also present) is never double-counted.
  const humanCount = members.filter((m) => m.kind === 'human').length;
  const agentSlugs = new Set<string>();
  for (const m of members) if (m.kind === 'agent') agentSlugs.add(m.clientId.replace(/^a:/, ''));
  for (const a of quiz?.config.agents ?? []) agentSlugs.add(a.slug);
  for (const slug of unavailable) agentSlugs.delete(slug); // don't wait on a failed model
  const expectedAnswerers = humanCount + agentSlugs.size;
  // Count only answers from expected answerers: a preflight-failed agent that
  // still managed to answer (e.g. it answered before being marked unavailable)
  // must not inflate the numerator and trip a premature auto-lock that skips
  // slower humans — the numerator/denominator must exclude the same agents (§S5.2).
  const answersIn = answeredIds.filter(
    (id) => !(id.startsWith('a:') && unavailable.has(id.slice(2))),
  ).length;
  const autoLockedIdx = useRef(-1);

  useEffect(() => {
    if (state.phase !== 'asking' || !question) return;
    const idx = state.questionIdx;
    const lockOnce = () => {
      if (autoLockedIdx.current === idx) return; // already auto-locked this question
      autoLockedIdx.current = idx;
      void controls.lock();
    };
    // Everyone expected has answered THIS question → done. `answersIn` is the
    // engine's per-idx count (see ingest), so it can't be tripped by the previous
    // question's stale `answered` flags mid-transition — the premature-lock race.
    if (expectedAnswerers > 0 && answersIn >= expectedAnswerers) {
      lockOnce();
      return;
    }
    // Otherwise lock when the window expires.
    const remaining = question.startedAt + question.limitMs - Date.now();
    const timer = setTimeout(lockOnce, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [state.phase, state.questionIdx, question, expectedAnswerers, answersIn, controls]);

  // Fire each declared agent's turn when a question is broadcast (§S4.4). Request-
  // based, fire-and-forget: one POST per agent; the answer returns on the fan-in,
  // and one agent failing never stalls the quiz. Once per question idx, and only
  // once `question` matches the current idx (so we never send a stale question).
  const firedTurnIdx = useRef(-1);
  useEffect(() => {
    if (state.phase !== 'asking' || !question || !quiz) return;
    if (question.idx !== state.questionIdx) return;
    const agents = quiz.config.agents ?? [];
    if (agents.length === 0 || firedTurnIdx.current === question.idx) return;
    firedTurnIdx.current = question.idx;
    const payloadQuestion = {
      idx: question.idx,
      prompt: question.prompt,
      options: question.options,
      limitMs: question.limitMs,
    };
    for (const a of agents) {
      if (unavailable.has(a.slug)) continue; // preflight-failed → skip a doomed turn
      void fetch('/api/agent-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizId: quiz.quizId,
          slug: a.slug,
          question: payloadQuestion,
          ...(mcpToken ? { mcpToken } : {}),
        }),
      }).catch(() => undefined);
    }
  }, [state.phase, state.questionIdx, question, quiz, mcpToken, unavailable]);

  useEffect(() => {
    if (state.phase !== 'locked') return;
    if (quiz?.config.autoReveal === false) return; // suspense mode: host reveals
    const timer = setTimeout(() => void controls.reveal(), 800); // beat, so "locked" registers
    return () => clearTimeout(timer);
  }, [state.phase, quiz, controls]);

  // Auto-advance podium → analysis so the AI commentary streams on its own, no
  // separate host click (§S5.2). A beat first, so the podium/confetti lands.
  useEffect(() => {
    if (state.phase !== 'podium') return;
    const timer = setTimeout(() => void controls.analysis(), 3000);
    return () => clearTimeout(timer);
  }, [state.phase, controls]);

  return {
    state,
    correct,
    question,
    live,
    controls,
    answersIn,
    expectedAnswerers,
    busy,
    members,
    counterfactual,
    agentTranscripts,
  };
}
