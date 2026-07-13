'use client';

import {
  parseControlMessage,
  Quizmaster,
  type Choice,
  type InboundAnswer,
  type QuizState,
} from '@ably-quiz/core';
import type * as Ably from 'ably';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Connection } from '@/lib/ably';
import { presenceToMembers, type Member } from '@/hooks/useAbly';
import type { QuestionBroadcast } from '@/hooks/useQuizState';
import {
  AblyBroadcaster,
  AblyLiveStore,
  answersChannel,
  getMainChannel,
  INITIAL_STATE,
  loadAnswerHistory,
  loadControlHistory,
  subscribeQuizState,
  type LiveQuizState,
} from '@/lib/quiz-live';
import type { StoredQuiz } from '@/lib/quiz-storage';

export type HostControls = {
  next: () => Promise<void>;
  lock: () => Promise<void>;
  reveal: () => Promise<void>;
  podium: () => Promise<void>;
};

/** Runs the quizmaster in the host browser: wires Ably answers → ingest,
 *  presence → display names + roster, and exposes phase state + host controls. */
export function useHostQuiz(
  conn: Connection | null,
  quiz: StoredQuiz | null,
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
  busy: boolean;
  members: Member[];
} {
  const qmRef = useRef<Quizmaster | null>(null);
  const [state, setState] = useState<QuizState>({ phase: 'lobby', questionIdx: -1 });
  const [correct, setCorrect] = useState<Choice | null>(null);
  const [question, setQuestion] = useState<QuestionBroadcast | null>(null);
  const [live, setLive] = useState<LiveQuizState>(INITIAL_STATE);
  const [answersIn, setAnswersIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);

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

    const main = getMainChannel(client, quiz.quizId, { write: true });
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
      setAnswersIn(qm.getAnswerLog().filter((e) => e.idx === openIdx).length);
    };
    const onAnswer = (msg: Ably.Message) => {
      const raw: InboundAnswer = {
        clientId: msg.clientId ?? '',
        data: msg.data,
        serverTs: msg.timestamp ?? Date.now(),
      };
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

    void (async () => {
      // Subscribe FIRST (attaches the channels) so no live message slips through
      // the gap between reading history and going live.
      await answers.subscribe(onAnswer);
      await main.subscribe('control', onControl);
      await main.presence.subscribe(() => void refresh());
      await subscribeQuizState(main, (s) => {
        if (!disposed) setLive(s);
      });
      await refresh();

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
      setAnswersIn(qm.getAnswerLog().filter((e) => e.idx === idx).length);
      setCorrect(qm.getCorrect(idx) ?? null);
      setState(qm.getState());
    })();

    return () => {
      cancelled = true;
      disposed = true;
      qmRef.current = null;
      answers.unsubscribe();
      main.unsubscribe('control', onControl);
      main.presence.unsubscribe();
    };
  }, [conn, quiz]);

  const run = useCallback(async (fn: (qm: Quizmaster) => Promise<void>) => {
    const qm = qmRef.current;
    if (!qm) return;
    setBusy(true);
    try {
      await fn(qm);
      const next = qm.getState();
      setState(next);
      setCorrect(qm.getCorrect(next.questionIdx) ?? null);
    } finally {
      setBusy(false);
    }
  }, []);

  // Stable so the auto-advance effects below don't re-fire on every render.
  const controls = useMemo<HostControls>(
    () => ({
      next: () =>
        run(async (qm) => {
          setAnswersIn(0);
          await qm.askNext();
        }),
      lock: () => run((qm) => qm.lock()),
      reveal: () => run((qm) => qm.reveal()),
      podium: () => run((qm) => qm.podium()),
    }),
    [run],
  );

  // --- Auto-advance (Matt, 2026-07-13) ---------------------------------------
  // A question resolves the moment it's decided — everyone present has answered,
  // OR the timer runs out — no waiting on the host to Lock. Then it auto-reveals
  // (unless the quiz turns that off, to hold on "locked" for suspense).
  const presentCount = members.length;
  const autoLockedIdx = useRef(-1);

  useEffect(() => {
    if (state.phase !== 'asking' || !question) return;
    const idx = state.questionIdx;
    const lockOnce = () => {
      if (autoLockedIdx.current === idx) return; // already auto-locked this question
      autoLockedIdx.current = idx;
      void controls.lock();
    };
    // Everyone present has answered THIS question → done. `answersIn` is the
    // engine's per-idx count (see ingest), so it can't be tripped by the previous
    // question's stale `answered` flags mid-transition — the premature-lock race.
    if (presentCount > 0 && answersIn >= presentCount) {
      lockOnce();
      return;
    }
    // Otherwise lock when the window expires.
    const remaining = question.startedAt + question.limitMs - Date.now();
    const timer = setTimeout(lockOnce, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [state.phase, state.questionIdx, question, presentCount, answersIn, controls]);

  useEffect(() => {
    if (state.phase !== 'locked') return;
    if (quiz?.config.autoReveal === false) return; // suspense mode: host reveals
    const timer = setTimeout(() => void controls.reveal(), 800); // beat, so "locked" registers
    return () => clearTimeout(timer);
  }, [state.phase, quiz, controls]);

  return { state, correct, question, live, controls, answersIn, busy, members };
}
