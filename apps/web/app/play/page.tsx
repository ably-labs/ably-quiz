'use client';

import type { ReactNode } from 'react';
import { answersChannel, type Choice } from '@ably-quiz/core';
import { useEffect, useMemo, useState } from 'react';
import {
  AnswerButtons,
  CommentaryCard,
  Countdown,
  CounterfactualPanel,
  identityEmoji,
  MiniPodium,
  QuestionCard,
  Scoreboard,
  TallyBars,
  TeamMark,
} from '@/components/quiz';
import { BrandMark } from '@/components/BrandMark';
import { Lobby } from '@/components/Lobby';
import { useAbly, usePresence } from '@/hooks/useAbly';
import { useCommentary } from '@/hooks/useCommentary';
import { useQuizId } from '@/hooks/useQuizId';
import { useQuizState } from '@/hooks/useQuizState';
import { getPlayerBaseId } from '@/lib/player';

export default function PlayPage() {
  const quizId = useQuizId();
  const [nickname, setNickname] = useState('');
  const [joined, setJoined] = useState(false);
  const base = useMemo(() => getPlayerBaseId(), []);

  // Reload resilience: the clientId already survives a refresh (getPlayerBaseId
  // → sessionStorage), so restore the nickname and rejoin automatically — the
  // player lands back in the game with their score, not on the join screen.
  useEffect(() => {
    if (!quizId) return;
    const saved = sessionStorage.getItem(`ably-quiz:nick:${quizId}`);
    if (saved) {
      setNickname(saved);
      setJoined(true);
    }
  }, [quizId]);

  const params = joined && quizId ? { quizId, role: 'player' as const, clientId: base } : null;
  const { conn, status, error } = useAbly(params);
  const view = useQuizState(conn, quizId ?? '');
  const commentary = useCommentary(conn, quizId ?? '');
  const members = usePresence(conn, quizId ?? '', {
    name: nickname.trim() || 'Player',
    enter: joined,
  });

  const [pick, setPick] = useState<{ idx: number; choice: Choice } | null>(null);
  const currentIdx = view.question?.idx ?? -1;
  useEffect(() => {
    setPick((p) => (p && p.idx === currentIdx ? p : null));
  }, [currentIdx]);

  const me = conn ? view.scoreboard[conn.clientId] : undefined;
  const ranking = Object.entries(view.scoreboard).sort((a, b) => b[1].score - a[1].score);
  const myRank = conn ? ranking.findIndex(([id]) => id === conn.clientId) + 1 : 0;

  function submit(choice: Choice) {
    if (!conn || !quizId || !view.question || view.phase !== 'asking') return;
    if (pick) return; // first answer wins
    setPick({ idx: view.question.idx, choice });
    void conn.client.channels.get(answersChannel(quizId)).publish('answer', {
      idx: view.question.idx,
      choice,
    });
  }

  if (quizId === undefined) return <Centered>Loading…</Centered>;
  if (quizId === null) return <Centered>No quiz specified. Scan the join QR code.</Centered>;

  if (!joined) {
    return (
      <Centered>
        {/* The imagery is the first thing someone sees from a shared link (§S5.2). */}
        <div
          className="mb-6 aspect-[16/9] w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950 bg-cover bg-center"
          style={{ backgroundImage: 'url(/hero.webp)' }}
          role="img"
          aria-label="Carbon vs Silicon — a brain arm-wrestles a microchip"
        />
        <BrandMark className="mb-4" />
        <p className="text-xs font-medium tracking-[0.3em] text-neutral-500 uppercase">
          join the quiz
        </p>
        <h1 className="mt-1 mb-6 text-3xl font-bold">{quizId}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = nickname.trim();
            if (!n) return;
            if (quizId) sessionStorage.setItem(`ably-quiz:nick:${quizId}`, n);
            setJoined(true);
          }}
          className="flex w-full max-w-xs flex-col gap-3"
        >
          <input
            autoFocus
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={24}
            placeholder="Your nickname"
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-center text-lg outline-none focus:border-ably"
          />
          <button
            type="submit"
            disabled={!nickname.trim()}
            className="rounded-lg bg-ably px-6 py-3 font-semibold text-black disabled:opacity-40"
          >
            Join
          </button>
        </form>
      </Centered>
    );
  }

  return (
    <main className="mx-auto max-w-md px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {conn && (
            <span className="text-2xl" aria-hidden>
              {identityEmoji(conn.clientId)}
            </span>
          )}
          <div>
            <p className="text-xs tracking-widest text-neutral-500 uppercase">
              {nickname.trim() || 'Player'}
            </p>
            <p className="text-lg font-bold tabular-nums">{me?.score ?? 0} pts</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Compact Carbon-vs-Silicon identity in the corner (§S5.2). */}
          <div className="flex items-center gap-1" aria-label="Carbon vs Silicon">
            <TeamMark team="carbon" className="h-8 w-8" />
            <span className="text-[0.6rem] font-bold text-neutral-600">vs</span>
            <TeamMark team="silicon" className="h-8 w-8" />
          </div>
          <StatusDot status={status} />
        </div>
      </div>
      {error && <p className="mb-4 text-sm text-red-400">⚠️ {error}</p>}

      {view.phase === 'lobby' && (
        <>
          <div
            className="mb-5 aspect-[16/9] w-full rounded-2xl border border-neutral-800 bg-neutral-950 bg-cover bg-center"
            style={{ backgroundImage: 'url(/hero.webp)' }}
            role="img"
            aria-label="Carbon vs Silicon — a brain arm-wrestles a microchip"
          />
          <p className="mb-4 text-center text-neutral-400">Waiting for the host to start…</p>
          <Lobby members={members} agents={view.config?.agents} />
        </>
      )}

      {(view.phase === 'asking' || view.phase === 'locked') && view.question && (
        <div className="space-y-6">
          <QuestionCard prompt={view.question.prompt} />
          {view.phase === 'asking' && (
            <Countdown startedAt={view.question.startedAt} limitMs={view.question.limitMs} />
          )}
          {view.phase === 'locked' ? (
            <p className="text-center text-neutral-400">
              Answers locked{pick ? ` — you picked ${pick.choice}` : ''}.
            </p>
          ) : (
            <AnswerButtons
              options={view.question.options}
              picked={pick?.choice ?? null}
              disabled={pick !== null}
              onPick={submit}
            />
          )}
          {pick && view.phase === 'asking' && (
            <p className="text-center text-sm text-neutral-500">
              Locked in {pick.choice}. Hold tight…
            </p>
          )}
        </div>
      )}

      {view.phase === 'revealed' && view.question && (
        <div className="space-y-5">
          <QuestionCard prompt={view.question.prompt} />
          <div className="text-center">
            {pick ? (
              pick.choice === view.correct ? (
                <p className="text-2xl font-bold text-emerald-400">✓ Correct!</p>
              ) : (
                <p className="text-2xl font-bold text-rose-400">
                  ✗ You picked {pick.choice} — correct was {view.correct}
                </p>
              )
            ) : (
              <p className="text-xl text-neutral-400">No answer — correct was {view.correct}</p>
            )}
          </div>
          <div>
            <p className="mb-2 text-center text-xs tracking-widest text-neutral-500 uppercase">
              What everyone picked
            </p>
            <TallyBars
              options={view.question.options}
              tallies={view.tallies}
              correct={view.correct}
              picked={pick?.choice ?? null}
            />
          </div>
          <p className="text-center text-neutral-400">{me?.score ?? 0} pts total</p>
        </div>
      )}

      {(view.phase === 'podium' || view.phase === 'analysis' || view.phase === 'done') && (
        <div className="space-y-6">
          {/* Result first (rank + mini podium), then the pundit's take, then the
              long tail of standings — the narrative reads top to bottom (§S5.2). */}
          <div className="space-y-2 text-center">
            <p className="text-2xl font-bold">That&apos;s a wrap!</p>
            {myRank > 0 ? (
              <p className="text-5xl font-extrabold tabular-nums">
                #{myRank}
                <span className="text-2xl font-normal text-neutral-500"> of {ranking.length}</span>
              </p>
            ) : null}
            <p className="text-neutral-400">{me?.score ?? 0} pts</p>
          </div>
          <MiniPodium
            scoreboard={view.scoreboard}
            agents={view.config?.agents}
            highlightId={conn?.clientId}
          />
          <CommentaryCard text={commentary.text} done={commentary.done} size="sm" />
          {ranking.length > 3 && (
            <div>
              <h3 className="mb-2 text-center text-xs tracking-widest text-neutral-500 uppercase">
                Final standings
              </h3>
              <Scoreboard
                scoreboard={view.scoreboard}
                offset={3}
                limit={12}
                agents={view.config?.agents}
                highlightId={conn?.clientId}
              />
            </div>
          )}
          {view.counterfactual && (
            <CounterfactualPanel payload={view.counterfactual} agents={view.config?.agents} />
          )}
        </div>
      )}
    </main>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      {children}
    </main>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'connected' ? 'bg-green-500' : status === 'failed' ? 'bg-red-500' : 'bg-amber-500';
  return (
    <span className="flex items-center gap-2 text-xs text-neutral-500">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {status}
    </span>
  );
}
