'use client';

import type {
  AgentRosterEntry,
  Choice,
  CounterfactualPayload,
  ScoreboardEntry,
  Tallies,
} from '@ably-quiz/core';
import { useEffect, useState } from 'react';
import type { AgentThinkState } from '@/hooks/useAgentThinking';

export const LETTERS: Choice[] = ['A', 'B', 'C', 'D'];

// Every contestant gets an icon: agents wear their manifest emoji, humans get a
// stable, friendly one derived from their clientId (so it's consistent all game
// without anyone choosing). Keeps identity visual + reduces reliance on badges.
const HUMAN_EMOJIS = [
  '🦊', '🐼', '🦁', '🐙', '🦉', '🐝', '🦄', '🐢',
  '🦈', '🐸', '🐵', '🦩', '🐺', '🦥', '🐬', '🦔',
];
export function identityEmoji(clientId: string, agents: AgentRosterEntry[] = []): string {
  if (clientId.startsWith('a:')) {
    const slug = clientId.slice(2);
    return agents.find((a) => a.slug === slug)?.emoji ?? '🤖';
  }
  let h = 0;
  for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) >>> 0;
  return HUMAN_EMOJIS[h % HUMAN_EMOJIS.length]!;
}
/** Small character mark for a team — Carbon (the brain) or Silicon (the chip),
 *  derived from the hero. Used sparingly for identity continuity (rosters, the
 *  tug-of-war) without dragging the whole scene onto every screen. Size via
 *  className. Background-image (not <img>) so a missing asset just shows the
 *  dark chip, never a broken glyph. */
export function TeamMark({
  team,
  className = '',
}: {
  team: 'carbon' | 'silicon';
  className?: string;
}) {
  const src = team === 'carbon' ? '/team-carbon.webp' : '/team-silicon.webp';
  return (
    <span
      className={`inline-block shrink-0 rounded-full border border-neutral-700 bg-neutral-950 bg-cover bg-center ${className}`}
      style={{ backgroundImage: `url(${src})` }}
      role="img"
      aria-label={team === 'carbon' ? 'Carbon — the humans' : 'Silicon — the agents'}
    />
  );
}

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
  picked,
}: {
  options: string[];
  tallies: Tallies;
  correct?: Choice | null;
  /** The viewer's own choice — rings that row and tags it "you" (player view). */
  picked?: Choice | null;
}) {
  const max = Math.max(1, ...LETTERS.map((l) => tallies[l]));
  return (
    <div className="space-y-2">
      {options.map((opt, i) => {
        const letter = LETTERS[i]!;
        const count = tallies[letter];
        const isCorrect = correct === letter;
        const isPicked = picked === letter;
        return (
          <div key={letter} className="flex items-center gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded font-bold text-white ${OPTION_TINT[letter]}`}
            >
              {letter}
            </span>
            <div
              className={`relative h-8 flex-1 overflow-hidden rounded bg-neutral-800/60 ${
                isPicked ? 'ring-2 ring-white/70' : ''
              }`}
            >
              <div
                className={`h-full transition-[width] duration-300 ${isCorrect ? 'bg-emerald-600/70' : 'bg-neutral-600/60'}`}
                style={{ width: `${(count / max) * 100}%` }}
              />
              <span className="absolute inset-0 flex items-center gap-2 px-3 text-sm">
                {correct != null && (isCorrect ? '✓ ' : '✗ ')}
                <span className="truncate">{opt}</span>
                {isPicked && (
                  <span className="rounded bg-white/20 px-1.5 text-xs font-semibold">you</span>
                )}
              </span>
            </div>
            <span className="w-10 text-right tabular-nums text-neutral-400">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

/** On-screen agent thinking (§S4.5): one card per declared agent showing its
 *  live think-aloud while it works, then its settled reasoning + quip. */
export function AgentThinkingWall({
  agents,
  thinking,
}: {
  agents: AgentRosterEntry[];
  thinking: Record<string, AgentThinkState>;
}) {
  if (agents.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm tracking-widest text-neutral-500 uppercase">Agents thinking</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => {
          const t = thinking[a.slug];
          const errored = t?.phase === 'error';
          const answered = t?.phase === 'answered';
          const active = t?.phase === 'thinking';
          return (
            <div
              key={a.slug}
              className={`rounded-xl border p-3 transition-colors ${
                errored
                  ? 'border-amber-800/60 bg-amber-950/20'
                  : active
                    ? 'border-ably/60 bg-ably/5'
                    : 'border-neutral-800 bg-neutral-900/40'
              }`}
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="text-lg" aria-hidden>
                  {a.emoji}
                </span>
                <span className="truncate font-semibold">{a.name}</span>
                <span className="ml-auto shrink-0 text-xs tabular-nums">
                  {errored ? (
                    <span className="text-amber-400">⚠️ issue</span>
                  ) : answered ? (
                    <span className="text-emerald-400">✓ answered</span>
                  ) : active ? (
                    <span className="animate-pulse text-ably">thinking…</span>
                  ) : (
                    <span className="text-neutral-600">ready</span>
                  )}
                </span>
              </div>
              {errored ? (
                <p className="line-clamp-2 text-sm text-amber-300/80">{t?.text || 'failed to answer'}</p>
              ) : (
                <>
                  {t?.text && <p className="line-clamp-3 text-sm text-neutral-400">{t.text}</p>}
                  {answered && t?.quip && (
                    <p className="mt-1 text-sm text-neutral-200 italic">“{t.quip}”</p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
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
        <span className="flex items-center gap-1.5 text-sky-400">
          <TeamMark team="carbon" className="h-5 w-5" />
          Humans {totals.human}
        </span>
        <span className="flex items-center gap-1.5 text-ably">
          {totals.agent} Agents
          <TeamMark team="silicon" className="h-5 w-5" />
        </span>
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
  agents = [],
  highlightId,
}: {
  scoreboard: Record<string, ScoreboardEntry>;
  limit?: number;
  /** Skip this many top entries (e.g. 3 to list runners-up beneath a podium). */
  offset?: number;
  /** Declared roster, to resolve each agent's emoji. */
  agents?: AgentRosterEntry[];
  /** The viewer's own clientId — that row is highlighted as "you". */
  highlightId?: string;
}) {
  const rows = Object.entries(scoreboard)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(offset, offset + limit);
  return (
    <ol className="space-y-1">
      {rows.map(([clientId, e], i) => {
        const mine = clientId === highlightId;
        return (
          <li
            key={clientId}
            className={`flex items-center gap-3 rounded-lg px-4 py-2 ${
              mine ? 'bg-ably/10 ring-1 ring-ably/40' : 'bg-neutral-900/60'
            }`}
          >
            <span className="w-6 text-right font-bold text-neutral-500 tabular-nums">
              {offset + i + 1}
            </span>
            <span className="text-lg" aria-hidden>
              {identityEmoji(clientId, agents)}
            </span>
            <span className="flex-1 truncate">
              {e.name}
              {mine && (
                <span className="ml-2 rounded bg-ably/20 px-1.5 align-middle text-xs font-semibold text-ably">
                  you
                </span>
              )}
            </span>
            <span className="font-bold tabular-nums">{e.score}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** End-of-quiz podium (§B2.10): top three on a staggered stage, everyone else
 *  in a runners-up list, and the Carbon-vs-Silicon verdict. Confetti + richer
 *  motion land in the S5.2 polish pass; this is the structural results view. */
export function Podium({
  scoreboard,
  agents = [],
}: {
  scoreboard: Record<string, ScoreboardEntry>;
  agents?: AgentRosterEntry[];
}) {
  const ranked = Object.entries(scoreboard)
    .map(([clientId, e]) => ({ clientId, ...e }))
    .sort((a, b) => b.score - a.score);
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
                <span className="text-lg" aria-hidden>
                  {identityEmoji(col.entry.clientId, agents)}
                </span>
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
          <Scoreboard scoreboard={scoreboard} offset={3} limit={12} agents={agents} />
        </div>
      )}

      <TugOfWar scoreboard={scoreboard} />
    </div>
  );
}

/** The geeky "by the way…" panel (§S5.1): the same answers scored under every
 *  algorithm. Collapsed by default; opening it reveals who'd have won under each
 *  rule, so a different winner under, say, `fastest-finger` is the fun reveal.
 *  Pure recompute — the payload arrives on the main channel at analysis. */
export function CounterfactualPanel({
  payload,
  agents = [],
  className = '',
}: {
  payload: CounterfactualPayload;
  agents?: AgentRosterEntry[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const algos = payload.algos.filter((a) => a.top.length > 0);
  if (algos.length === 0) return null;

  const winnerOf = (id: string) => algos.find((a) => a.id === id)?.top[0];
  const activeWinner = winnerOf(payload.activeAlgoId);
  // The hook: how many algorithms would crown someone other than the live winner.
  const upsets = activeWinner
    ? algos.filter((a) => a.id !== payload.activeAlgoId && a.top[0]?.clientId !== activeWinner.clientId)
    : [];

  return (
    <section className={`rounded-2xl border border-neutral-800 bg-neutral-900/40 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className="text-xl" aria-hidden>
          📊
        </span>
        <span className="flex-1">
          <span className="font-semibold">by the way…</span>{' '}
          <span className="text-sm text-neutral-400">
            {upsets.length > 0
              ? `${upsets.length} scoring rule${upsets.length === 1 ? '' : 's'} would crown a different winner`
              : 'the same answers under every scoring rule'}
          </span>
        </span>
        <span className="text-neutral-500" aria-hidden>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <ul className="space-y-2 border-t border-neutral-800 px-5 py-4">
          {algos.map((a) => {
            const winner = a.top[0]!;
            const active = a.id === payload.activeAlgoId;
            const changed = !active && activeWinner && winner.clientId !== activeWinner.clientId;
            return (
              <li
                key={a.id}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                  changed ? 'bg-ably/10 ring-1 ring-ably/30' : 'bg-neutral-900/60'
                }`}
              >
                <span className="w-28 shrink-0">
                  <span className="block text-sm font-semibold">{a.label}</span>
                  {active && <span className="text-[0.65rem] tracking-wide text-ably uppercase">scored live</span>}
                </span>
                <span className="hidden flex-1 truncate text-xs text-neutral-500 sm:block">
                  {a.blurb}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-base" aria-hidden>
                    {identityEmoji(winner.clientId, agents)}
                  </span>
                  <span className="max-w-[8rem] truncate text-sm font-medium">{winner.name}</span>
                </span>
                <span className="w-12 text-right text-sm font-bold tabular-nums text-neutral-300">
                  {winner.score}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

