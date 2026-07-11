'use client';

import { kindFromClientId, Quizmaster, type InboundAnswer, type QuizState } from '@ably-quiz/core';
import type * as Ably from 'ably';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Connection } from '@/lib/ably';
import type { Member } from '@/hooks/useAbly';
import {
  AblyBroadcaster,
  AblyLiveStore,
  answersChannel,
  getMainChannel,
  loadAnswerHistory,
  loadControlHistory,
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
  controls: HostControls;
  answersIn: number;
  busy: boolean;
  members: Member[];
} {
  const qmRef = useRef<Quizmaster | null>(null);
  const [state, setState] = useState<QuizState>({ phase: 'lobby', questionIdx: -1 });
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
    const toMember = (m: { clientId?: string | undefined; data?: unknown }): Member => ({
      clientId: m.clientId ?? '?',
      kind: kindFromClientId(m.clientId ?? ''),
      name: (m.data as { name?: string } | undefined)?.name ?? m.clientId ?? 'anon',
    });
    const refresh = async () => {
      const present = await main.presence.get();
      setMembers(present.map(toMember));
      for (const m of present) if (m.clientId) qm.setDisplayName(m.clientId, toMember(m).name);
    };

    // Until history is replayed the engine hasn't got its phase/T₀ back, so
    // buffer inbound answers rather than feeding them to a lobby-state engine
    // that would ignore them. The engine dedupes on replay, so a buffered
    // answer that also appears in history is counted once.
    let ready = false;
    const buffer: InboundAnswer[] = [];
    const ingest = (raw: InboundAnswer) => {
      qm.ingest(raw);
      setAnswersIn((n) => n + 1);
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
    void (async () => {
      // Subscribe FIRST (attaches the channels) so no live message slips through
      // the gap between reading history and going live.
      await answers.subscribe(onAnswer);
      await main.presence.subscribe(() => void refresh());
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
      } else {
        qm.init();
      }

      ready = true;
      for (const raw of buffer.splice(0)) qm.ingest(raw); // dedup handles overlap
      const idx = qm.getState().questionIdx;
      setAnswersIn(qm.getAnswerLog().filter((e) => e.idx === idx).length);
      setState(qm.getState());
    })();

    return () => {
      cancelled = true;
      qmRef.current = null;
      answers.unsubscribe();
      main.presence.unsubscribe();
    };
  }, [conn, quiz]);

  const run = useCallback(async (fn: (qm: Quizmaster) => Promise<void>) => {
    const qm = qmRef.current;
    if (!qm) return;
    setBusy(true);
    try {
      await fn(qm);
      setState(qm.getState());
    } finally {
      setBusy(false);
    }
  }, []);

  const controls: HostControls = {
    next: () =>
      run(async (qm) => {
        setAnswersIn(0);
        await qm.askNext();
      }),
    lock: () => run((qm) => qm.lock()),
    reveal: () => run((qm) => qm.reveal()),
    podium: () => run((qm) => qm.podium()),
  };

  return { state, controls, answersIn, busy, members };
}
