'use client';

import type { ReactNode } from 'react';

import { getAlgo } from '@ably-quiz/core';
import { useMemo } from 'react';
import { JoinQr } from '@/components/JoinQr';
import { Lobby } from '@/components/Lobby';
import { useAbly, usePresence } from '@/hooks/useAbly';
import { useQuizId } from '@/hooks/useQuizId';
import { loadQuiz } from '@/lib/quiz-storage';

export default function ScreenPage() {
  const quizId = useQuizId();
  const quiz = useMemo(() => (typeof quizId === 'string' ? loadQuiz(quizId) : null), [quizId]);
  const params =
    typeof quizId === 'string' && quiz
      ? { quizId, role: 'host' as const, hostKey: quiz.hostKey }
      : null;
  const { conn } = useAbly(params);
  const members = usePresence(conn, quizId ?? '', { name: 'screen', enter: false });

  if (quizId === undefined) return <Centered>Loading…</Centered>;
  if (quizId === null) return <Centered>No quiz specified.</Centered>;
  if (!quiz) {
    return <Centered>Open the screen from the machine that created this quiz.</Centered>;
  }

  const joinUrl = `${window.location.origin}/play?quiz=${quizId}`;
  const algo = getAlgo(quiz.config.scoringAlgoId);

  return (
    <main className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-10 flex items-start justify-between">
        <div>
          <p className="text-sm tracking-[0.3em] text-ably uppercase">the Ably Quiz</p>
          <h1 className="text-6xl font-extrabold tracking-tight">
            Carbon <span className="text-neutral-600">vs</span> Silicon
          </h1>
          <p className="mt-2 text-neutral-500">
            {quiz.questions.length} questions · scoring: {algo?.label ?? quiz.config.scoringAlgoId}
            {quiz.config.streakEnabled ? ' + streak' : ''}
          </p>
        </div>
        <div className="text-center">
          <JoinQr url={joinUrl} size={180} />
          <p className="mt-2 font-mono text-sm text-neutral-400">{joinUrl}</p>
        </div>
      </header>
      <Lobby members={members} />
    </main>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center text-neutral-400">
      {children}
    </main>
  );
}
