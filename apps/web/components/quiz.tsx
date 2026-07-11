'use client';

import type { Choice, Kind, ScoreboardEntry, Tallies } from '@ably-quiz/core';
import { useEffect, useState } from 'react';

export const LETTERS: Choice[] = ['A', 'B', 'C', 'D'];
// Functional answer colours (distinct + always paired with the letter, so never
// colour-alone). The brand's single orange accent lives in the chrome (§B2.10).
const OPTION_TINT: Record<Choice, string> = {
  A: 'bg-rose-600',
  B: 'bg-sky-600',
  C: 'bg-amber-500',
  D: 'bg-emerald-600',
};

/** Cosmetic countdown anchored to the question's server timestamp (§B2.2). */
export function Countdown({ startedAt, limitMs }: { startedAt: number; limitMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, startedAt + limitMs - now);
  const frac = Math.max(0, Math.min(1, remaining / limitMs));
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-5xl font-bold tabular-nums">{Math.ceil(remaining / 1000)}</div>
      <div className="h-2 w-64 overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full bg-ably transition-[width] duration-100 ease-linear"
          style={{ width: `${frac * 100}%` }}
        />
      </div>
    </div>
  );
}

export function TallyBars({
  options,
  tallies,
  correct,
}: {
  options: string[];
  tallies: Tallies;
  correct?: Choice | null;
}) {
  const max = Math.max(1, ...LETTERS.map((l) => tallies[l]));
  return (
    <div className="space-y-2">
      {options.map((opt, i) => {
        const letter = LETTERS[i]!;
        const count = tallies[letter];
        const isCorrect = correct === letter;
        return (
          <div key={letter} className="flex items-center gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded font-bold text-white ${OPTION_TINT[letter]}`}
            >
              {letter}
            </span>
            <div className="relative h-8 flex-1 overflow-hidden rounded bg-neutral-800/60">
              <div
                className={`h-full transition-[width] duration-300 ${isCorrect ? 'bg-emerald-600/70' : 'bg-neutral-600/60'}`}
                style={{ width: `${(count / max) * 100}%` }}
              />
              <span className="absolute inset-0 flex items-center px-3 text-sm">
                {correct != null && (isCorrect ? '✓ ' : '✗ ')}
                {opt}
              </span>
            </div>
            <span className="w-10 text-right tabular-nums text-neutral-400">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Persistent Humans ⚡ Agents tug-of-war bar (§B2.10). */
export function TugOfWar({ scoreboard }: { scoreboard: Record<string, ScoreboardEntry> }) {
  const totals = { human: 0, agent: 0 };
  for (const e of Object.values(scoreboard)) totals[e.kind] += e.score;
  const sum = totals.human + totals.agent;
  const humanPct = sum === 0 ? 50 : (totals.human / sum) * 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm font-semibold">
        <span className="text-sky-400">Humans {totals.human}</span>
        <span className="text-ably">{totals.agent} Agents</span>
      </div>
      <div className="flex h-4 overflow-hidden rounded-full">
        <div
          className="bg-sky-500 transition-[width] duration-500"
          style={{ width: `${humanPct}%` }}
        />
        <div className="flex-1 bg-ably transition-[width] duration-500" />
      </div>
    </div>
  );
}

export function QuestionCard({ prompt, category }: { prompt: string; category?: string }) {
  return (
    <div className="text-center">
      {category && (
        <p className="mb-2 text-sm tracking-widest text-neutral-500 uppercase">{category}</p>
      )}
      <h2 className="text-3xl font-bold sm:text-4xl">{prompt}</h2>
    </div>
  );
}

export function AnswerButtons({
  options,
  picked,
  disabled,
  onPick,
}: {
  options: string[];
  picked: Choice | null;
  disabled: boolean;
  onPick: (choice: Choice) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((opt, i) => {
        const letter = LETTERS[i]!;
        const isPicked = picked === letter;
        return (
          <button
            key={letter}
            type="button"
            disabled={disabled}
            onClick={() => onPick(letter)}
            className={`flex items-center gap-3 rounded-xl p-5 text-left text-lg font-semibold text-white transition ${OPTION_TINT[letter]} ${
              disabled && !isPicked ? 'opacity-40' : ''
            } ${isPicked ? 'ring-4 ring-white' : ''}`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded bg-black/25 font-bold">
              {letter}
            </span>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function Scoreboard({
  scoreboard,
  limit = 8,
  offset = 0,
}: {
  scoreboard: Record<string, ScoreboardEntry>;
  limit?: number;
  /** Skip this many top entries (e.g. 3 to list runners-up beneath a podium). */
  offset?: number;
}) {
  const rows = Object.values(scoreboard)
    .sort((a, b) => b.score - a.score)
    .slice(offset, offset + limit);
  return (
    <ol className="space-y-1">
      {rows.map((e, i) => (
        <li
          key={`${e.name}-${offset + i}`}
          className="flex items-center gap-3 rounded-lg bg-neutral-900/60 px-4 py-2"
        >
          <span className="w-6 text-right font-bold text-neutral-500 tabular-nums">
            {offset + i + 1}
          </span>
          <SpeciesBadge kind={e.kind} />
          <span className="flex-1 truncate">{e.name}</span>
          <span className="font-bold tabular-nums">{e.score}</span>
        </li>
      ))}
    </ol>
  );
}

/** End-of-quiz podium (§B2.10): top three on a staggered stage, everyone else
 *  in a runners-up list, and the Carbon-vs-Silicon verdict. Confetti + richer
 *  motion land in the S5.2 polish pass; this is the structural results view. */
export function Podium({ scoreboard }: { scoreboard: Record<string, ScoreboardEntry> }) {
  const ranked = Object.values(scoreboard).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    return <p className="text-center text-neutral-500">No one scored this round.</p>;
  }
  const [gold, silver, bronze] = ranked;
  // Visual order places gold in the centre and tallest; silver left, bronze right.
  const columns = [
    { entry: silver, rank: 2, medal: '🥈', pedestal: 'h-20', delay: '0.15s' },
    { entry: gold, rank: 1, medal: '🥇', pedestal: 'h-32', delay: '0s' },
    { entry: bronze, rank: 3, medal: '🥉', pedestal: 'h-12', delay: '0.3s' },
  ];
  const verdict = gold!.kind === 'agent' ? 'Silicon takes it 🤖' : 'Carbon takes it 🧠';

  return (
    <div className="space-y-10">
      <div className="text-center">
        <p className="text-sm tracking-[0.3em] text-ably uppercase">winner</p>
        <h2 className="mt-1 text-4xl font-extrabold sm:text-5xl">{gold!.name}</h2>
        <p className="mt-1 text-neutral-400">
          {verdict} · {gold!.score} pts
        </p>
      </div>

      <div className="mx-auto flex max-w-2xl items-end justify-center gap-3 sm:gap-6">
        {columns.map((col, i) =>
          col.entry ? (
            <div
              key={i}
              className="flex flex-1 flex-col items-center"
              style={{ animation: `podium-rise 0.5s ease-out ${col.delay} both` }}
            >
              <div className="text-4xl sm:text-5xl">{col.medal}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <SpeciesBadge kind={col.entry.kind} />
                <span className="max-w-[8rem] truncate font-semibold">{col.entry.name}</span>
              </div>
              <div className="text-lg font-bold tabular-nums">{col.entry.score}</div>
              <div
                className={`mt-2 flex w-full ${col.pedestal} justify-center rounded-t-lg ${
                  col.rank === 1 ? 'bg-ably/30' : 'bg-neutral-800'
                }`}
              >
                <span className="mt-2 text-2xl font-black text-neutral-500">{col.rank}</span>
              </div>
            </div>
          ) : (
            <div key={i} className="flex-1" />
          ),
        )}
      </div>

      {ranked.length > 3 && (
        <div>
          <h3 className="mb-2 text-center text-sm tracking-widest text-neutral-500 uppercase">
            Runners-up
          </h3>
          <Scoreboard scoreboard={scoreboard} offset={3} limit={12} />
        </div>
      )}

      <TugOfWar scoreboard={scoreboard} />
    </div>
  );
}

function SpeciesBadge({ kind }: { kind: Kind }) {
  return kind === 'agent' ? (
    <span className="rounded bg-ably/20 px-1.5 text-xs text-ably">AI</span>
  ) : (
    <span className="rounded bg-sky-500/20 px-1.5 text-xs text-sky-400">H</span>
  );
}
