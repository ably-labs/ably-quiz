'use client';

import { parseControlMessage, type Choice } from '@ably-quiz/core';
import { useEffect, useState } from 'react';
import type { Connection } from '@/lib/ably';
import {
  getMainChannel,
  INITIAL_STATE,
  subscribeQuizState,
  type LiveQuizState,
} from '@/lib/quiz-live';

export type QuestionBroadcast = {
  idx: number;
  prompt: string;
  options: string[];
  limitMs: number;
  /** Ably server timestamp of the question broadcast — the cosmetic-countdown anchor. */
  startedAt: number;
};

export type QuizView = LiveQuizState & {
  /** Current question content (from the control broadcast), null before the first question. */
  question: QuestionBroadcast | null;
  /** Correct letter once revealed for the current question. */
  correct: Choice | null;
};

/** Read-only quiz view for /screen and /play: control broadcasts drive the
 *  question + reveal; LiveObjects drives phase/tallies/scoreboard (+ recovery). */
export function useQuizState(conn: Connection | null, quizId: string): QuizView {
  const [live, setLive] = useState<LiveQuizState>(INITIAL_STATE);
  const [question, setQuestion] = useState<QuestionBroadcast | null>(null);
  const [correct, setCorrect] = useState<Choice | null>(null);

  useEffect(() => {
    if (!conn) return;
    const channel = getMainChannel(conn.client, quizId, { write: false });
    let unsub = () => {};

    void channel.subscribe('control', (msg) => {
      const m = parseControlMessage(msg.data);
      if (!m) return;
      if (m.type === 'question') {
        setQuestion({
          idx: m.idx,
          prompt: m.prompt,
          options: m.options,
          limitMs: m.limitMs,
          startedAt: msg.timestamp ?? Date.now(),
        });
        setCorrect(null);
      } else if (m.type === 'reveal') {
        setCorrect(m.correct);
      }
    });

    void subscribeQuizState(channel, setLive).then((u) => {
      unsub = u;
    });

    return () => {
      channel.unsubscribe();
      unsub();
    };
  }, [conn, quizId]);

  return { ...live, question, correct };
}
