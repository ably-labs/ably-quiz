'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Lobby } from '@/components/Lobby';
import { useAbly } from '@/hooks/useAbly';
import { useHostQuiz } from '@/hooks/useHostQuiz';
import { useQuizId } from '@/hooks/useQuizId';
import { loadQuiz } from '@/lib/quiz-storage';

export default function HostPage() {
  const quizId = useQuizId();
  const quiz = useMemo(() => (typeof quizId === 'string' ? loadQuiz(quizId) : null), [quizId]);
  const params = typeof quizId === 'string' && quiz ? { quizId, role: 'host' as const } : null;
  const { status, conn, error } = useAbly(params);
  const { state, controls, answersIn, busy, members } = useHostQuiz(conn, quiz);

  if (quizId === undefined) return <Centered>Loading…</Centered>;
  if (quizId === null) return <Centered>No quiz specified.</Centered>;
  if (!quiz)
    return <Centered>Open host controls from the machine that created this quiz.</Centered>;

  const total = quiz.questions.length;
  const qLabel = state.questionIdx >= 0 ? `Q${state.questionIdx + 1} / ${total}` : '';
  const isLast = state.questionIdx + 1 >= total;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs tracking-widest text-neutral-500 uppercase">host controls</p>
          <h1 className="text-2xl font-bold">{quizId}</h1>
        </div>
        <div className="text-right text-sm text-neutral-500">
          <div>
            connection: <span className="font-medium text-neutral-300">{status}</span>
          </div>
          <div>
            phase: <span className="font-medium text-neutral-300">{state.phase}</span> {qLabel}
          </div>
        </div>
      </header>
      {error && <p className="mb-4 text-sm text-red-400">⚠️ {error}</p>}

      <div className="mb-8 flex flex-wrap gap-3">
        {state.phase === 'lobby' && (
          <Control onClick={controls.next} busy={busy} disabled={total === 0} primary>
            Start quiz →
          </Control>
        )}
        {state.phase === 'asking' && (
          <Control onClick={controls.lock} busy={busy} primary>
            Lock answers ({answersIn} in)
          </Control>
        )}
        {state.phase === 'locked' && (
          <Control onClick={controls.reveal} busy={busy} primary>
            Reveal answer
          </Control>
        )}
        {state.phase === 'revealed' && (
          <>
            {!isLast && (
              <Control onClick={controls.next} busy={busy} primary>
                Next question →
              </Control>
            )}
            <Control onClick={controls.podium} busy={busy} primary={isLast}>
              {isLast ? 'Finish → podium' : 'End early → podium'}
            </Control>
          </>
        )}
        {(state.phase === 'podium' || state.phase === 'analysis' || state.phase === 'done') && (
          <p className="text-neutral-400">Quiz complete.</p>
        )}
      </div>

      <Lobby members={members} />
    </main>
  );
}

function Control({
  onClick,
  busy,
  disabled,
  primary,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`rounded-lg px-5 py-3 font-semibold transition disabled:opacity-40 ${
        primary
          ? 'bg-ably text-black'
          : 'border border-neutral-700 text-ink hover:border-neutral-500'
      }`}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center text-neutral-400">
      {children}
    </main>
  );
}
