'use client';

import type { ReactNode } from 'react';
import { getAlgo } from '@ably-quiz/core';
import { JoinQr } from '@/components/JoinQr';
import { Lobby } from '@/components/Lobby';
import { Countdown, QuestionCard, Scoreboard, TallyBars, TugOfWar } from '@/components/quiz';
import { useAbly, usePresence } from '@/hooks/useAbly';
import { useQuizId } from '@/hooks/useQuizId';
import { useQuizState } from '@/hooks/useQuizState';

export default function ScreenPage() {
  const quizId = useQuizId();
  // The screen only READS (control + LiveObjects + presence) — all player
  // capabilities — so the link works from any device without the host key.
  const params =
    typeof quizId === 'string' ? { quizId, role: 'player' as const, clientId: 'screen' } : null;
  const { conn } = useAbly(params);
  const view = useQuizState(conn, quizId ?? '');
  const members = usePresence(conn, quizId ?? '', { name: 'screen', enter: false });

  if (quizId === undefined) return <Centered>Loading…</Centered>;
  if (quizId === null) return <Centered>No quiz specified.</Centered>;

  const joinUrl = `${window.location.origin}/play?quiz=${quizId}`;
  const algo = view.config ? getAlgo(view.config.scoringAlgoId) : null;
  const q = view.question;
  const inQuestion = (view.phase === 'asking' || view.phase === 'locked') && q;
  const revealed = view.phase === 'revealed' && q;
  const ended = view.phase === 'podium' || view.phase === 'analysis' || view.phase === 'done';

  return (
    <main className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-sm tracking-[0.3em] text-ably uppercase">the Ably Quiz</p>
          <h1 className="text-4xl font-extrabold tracking-tight">
            Carbon <span className="text-neutral-600">vs</span> Silicon
          </h1>
          {view.config && (
            <p className="mt-1 text-sm text-neutral-500">
              {view.config.questionCount} questions · scoring:{' '}
              {algo?.label ?? view.config.scoringAlgoId}
              {view.config.streakEnabled ? ' + streak' : ''}
            </p>
          )}
        </div>
        {view.phase === 'lobby' && (
          <div className="text-center">
            <JoinQr url={joinUrl} size={160} />
            <p className="mt-2 font-mono text-xs text-neutral-400">{joinUrl}</p>
          </div>
        )}
      </header>

      {view.phase === 'lobby' && <Lobby members={members} />}

      {inQuestion && (
        <section className="space-y-8">
          <div className="flex flex-col items-center gap-6">
            <QuestionCard prompt={q.prompt} />
            <Countdown startedAt={q.startedAt} limitMs={q.limitMs} />
          </div>
          <TallyBars options={q.options} tallies={view.tallies} />
          <TugOfWar scoreboard={view.scoreboard} />
        </section>
      )}

      {revealed && (
        <section className="space-y-8">
          <QuestionCard prompt={q.prompt} />
          <TallyBars options={q.options} tallies={view.tallies} correct={view.correct} />
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm tracking-widest text-neutral-500 uppercase">
                Scoreboard
              </h3>
              <Scoreboard scoreboard={view.scoreboard} />
            </div>
            <div className="self-start">
              <TugOfWar scoreboard={view.scoreboard} />
            </div>
          </div>
        </section>
      )}

      {ended && (
        <section className="space-y-8">
          <h2 className="text-center text-3xl font-extrabold">Final standings</h2>
          <Scoreboard scoreboard={view.scoreboard} limit={12} />
          <TugOfWar scoreboard={view.scoreboard} />
        </section>
      )}
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
