'use client';

import { kindFromClientId, Quizmaster, type QuizState } from '@ably-quiz/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Connection } from '@/lib/ably';
import type { Member } from '@/hooks/useAbly';
import { AblyBroadcaster, AblyLiveStore, answersChannel, getMainChannel } from '@/lib/quiz-live';
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
    qm.init();
    setState(qm.getState());

    const main = getMainChannel(client, quiz.quizId, { write: true });
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
    void main.presence.subscribe(() => void refresh());
    void refresh();

    const answers = client.channels.get(answersChannel(quiz.quizId));
    void answers.subscribe((msg) => {
      qm.ingest({
        clientId: msg.clientId ?? '',
        data: msg.data,
        serverTs: msg.timestamp ?? Date.now(),
      });
      setAnswersIn((n) => n + 1);
    });

    return () => {
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
