'use client';

import type { ReactNode } from 'react';

import { useMemo, useState } from 'react';
import { Lobby } from '@/components/Lobby';
import { useAbly, usePresence } from '@/hooks/useAbly';
import { useQuizId } from '@/hooks/useQuizId';
import { getPlayerBaseId } from '@/lib/player';

export default function PlayPage() {
  const quizId = useQuizId();
  const [nickname, setNickname] = useState('');
  const [joined, setJoined] = useState(false);
  const base = useMemo(() => getPlayerBaseId(), []);

  const params = joined && quizId ? { quizId, role: 'player' as const, clientId: base } : null;
  const { conn, status, error } = useAbly(params);
  const members = usePresence(conn, quizId ?? '', {
    name: nickname.trim() || 'Player',
    enter: joined,
  });

  if (quizId === undefined) return <Centered>Loading…</Centered>;
  if (quizId === null) return <Centered>No quiz specified. Scan the join QR code.</Centered>;

  if (!joined) {
    return (
      <Centered>
        <p className="text-xs font-medium tracking-[0.3em] text-ably uppercase">join the quiz</p>
        <h1 className="mt-1 mb-6 text-3xl font-bold">{quizId}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nickname.trim()) setJoined(true);
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
    <main className="mx-auto max-w-md px-5 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs tracking-widest text-neutral-500 uppercase">you're in as</p>
          <p className="text-xl font-bold">{nickname.trim() || 'Player'}</p>
        </div>
        <StatusDot status={status} />
      </div>
      {error && <p className="mb-4 text-sm text-red-400">⚠️ {error}</p>}
      <p className="mb-4 text-neutral-400">Waiting for the host to start…</p>
      <Lobby members={members} />
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
