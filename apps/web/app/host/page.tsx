'use client';

import type { ReactNode } from 'react';

import { useMemo } from 'react';
import { Lobby } from '@/components/Lobby';
import { useAbly, usePresence } from '@/hooks/useAbly';
import { useQuizId } from '@/hooks/useQuizId';
import { loadQuiz } from '@/lib/quiz-storage';

export default function HostPage() {
  const quizId = useQuizId();
  const quiz = useMemo(() => (typeof quizId === 'string' ? loadQuiz(quizId) : null), [quizId]);
  const params =
    typeof quizId === 'string' && quiz
      ? { quizId, role: 'host' as const, hostKey: quiz.hostKey }
      : null;
  const { status, conn, error } = useAbly(params);
  const members = usePresence(conn, quizId ?? '', { name: 'host', enter: false });

  if (quizId === undefined) return <Centered>Loading…</Centered>;
  if (quizId === null) return <Centered>No quiz specified.</Centered>;
  if (!quiz)
    return <Centered>Open host controls from the machine that created this quiz.</Centered>;

  const humans = members.filter((m) => m.kind === 'human').length;
  const agents = members.filter((m) => m.kind === 'agent').length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs tracking-widest text-neutral-500 uppercase">host controls</p>
          <h1 className="text-2xl font-bold">{quizId}</h1>
        </div>
        <span className="text-sm text-neutral-500">
          connection: <span className="font-medium text-neutral-300">{status}</span>
        </span>
      </header>
      {error && <p className="mb-4 text-sm text-red-400">⚠️ {error}</p>}
      <p className="mb-6 text-neutral-400">
        {humans} human{humans === 1 ? '' : 's'} · {agents} agent{agents === 1 ? '' : 's'} in the
        lobby. Question controls arrive next (S3.3).
      </p>
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
