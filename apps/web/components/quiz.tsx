'use client';

import type {
  AgentRosterEntry,
  AgentToolCall,
  AgentTranscript,
  Choice,
  CounterfactualPayload,
  ScoreboardEntry,
  Tallies,
} from '@ably-quiz/core';
import { useEffect, useState, type ReactNode } from 'react';
import type { AgentThinkState } from '@/hooks/useAgentThinking';

export const LETTERS: Choice[] = ['A', 'B', 'C', 'D'];

// Every contestant gets an icon: agents wear their manifest emoji, humans get a
// stable, friendly one derived from their clientId (so it's consistent all game
// without anyone choosing). Keeps identity visual + reduces reliance on badges.
const HUMAN_EMOJIS = [
  '🦊',
  '🐼',
  '🦁',
  '🐙',
  '🦉',
  '🐝',
  '🦄',
  '🐢',
  '🦈',
  '🐸',
  '🐵',
  '🦩',
  '🐺',
  '🦥',
  '🐬',
  '🦔',
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
/** A box-with-arrow glyph for links that open a new tab. Sized in `em`. */
export function ExternalLinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block h-[1em] w-[1em] shrink-0 ${className}`}
      aria-hidden
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
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

/** Compact per-agent status while a question is open (§S5.2). One quiet row of
 *  small chips — emoji + name + status only. Deliberately shows NO reasoning:
 *  the full think-aloud used to stream here and leaked the answer off the shared
 *  screen (a live-test finding — e.g. "Seven continents: Africa, Antarctica…"
 *  appeared while the question was still open). Status-only here; the one-liner
 *  quips surface at reveal (`AgentQuipWall`). */
export function AgentStatusStrip({
  agents,
  thinking,
}: {
  agents: AgentRosterEntry[];
  thinking: Record<string, AgentThinkState>;
}) {
  if (agents.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {agents.map((a) => {
        const phase = thinking[a.slug]?.phase;
        return (
          <li
            key={a.slug}
            className="flex items-center gap-1.5 rounded-full bg-neutral-900 px-3 py-1 text-sm text-neutral-200"
          >
            <span aria-hidden>{a.emoji}</span>
            <span className="font-medium">{a.name}</span>
            {phase === 'thinking' ? (
              <span className="animate-pulse text-ably">thinking…</span>
            ) : phase === 'answered' ? (
              <span className="text-emerald-400" aria-label="answered">
                ✓
              </span>
            ) : phase === 'error' ? (
              <span className="text-amber-400" aria-label="issue">
                ⚠️
              </span>
            ) : (
              <span className="text-neutral-600">ready</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Agents' one-liners at reveal (§S5.3). Quips come from the reveal-published
 *  `agent-quips` payload (host-mediated off the answers fan-in) — NOT the agent
 *  status channels, which carry status only mid-question to avoid leaking the
 *  answer on the wire. `quips` is slug→one-liner for the revealed question; the
 *  ⚠️ error state still comes from the status hook (the `error` phase is the one
 *  thing still published there). Skips agents with neither a quip nor an error. */
export function AgentQuipWall({
  agents,
  quips,
  thinking,
}: {
  agents: AgentRosterEntry[];
  /** slug → one-liner for the revealed question (host-released at reveal). */
  quips: Record<string, string>;
  /** Status hook, used only for the ⚠️ error state (+ its short message). */
  thinking: Record<string, AgentThinkState>;
}) {
  const cards = agents
    .map((a) => ({ a, quip: quips[a.slug], errored: thinking[a.slug]?.phase === 'error' }))
    .filter(({ quip, errored }) => errored || quip);
  if (cards.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm tracking-widest text-neutral-500 uppercase">Agent takes</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ a, quip, errored }) => (
          <div
            key={a.slug}
            className={`rounded-xl border p-3 ${
              errored
                ? 'border-amber-800/60 bg-amber-950/20'
                : 'border-neutral-800 bg-neutral-900/40'
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-lg" aria-hidden>
                {a.emoji}
              </span>
              <span className="truncate font-semibold">{a.name}</span>
              {errored && <span className="ml-auto shrink-0 text-xs text-amber-400">⚠️ issue</span>}
            </div>
            {errored ? (
              <p className="line-clamp-2 text-sm text-amber-300/80">
                {thinking[a.slug]?.text || 'failed to answer'}
              </p>
            ) : (
              <p className="text-sm text-neutral-200 italic">“{quip}”</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** End-of-quiz "view the conversation" (§S6.6): per agent, the full record of
 *  every turn — the prompt it saw, its reasoning, any MCP knowledge-tool calls,
 *  its latency, and its answer. Reads the transcripts the host released at each
 *  reveal (off the host-only fan-in, so nothing leaked while a question was
 *  open). A debugging tool AND a player payoff — "what did the machines do?".
 *  Renders nothing until at least one transcript has arrived. */
export function AgentTranscripts({
  agents,
  transcripts,
}: {
  agents: AgentRosterEntry[];
  transcripts: AgentTranscript[];
}) {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  if (transcripts.length === 0) return null;

  const bySlug = new Map<string, AgentTranscript[]>();
  for (const t of transcripts) {
    const list = bySlug.get(t.slug) ?? [];
    list.push(t);
    bySlug.set(t.slug, list);
  }
  const rows = agents.filter((a) => bySlug.has(a.slug));
  if (rows.length === 0) return null;
  const open = openSlug ? (agents.find((a) => a.slug === openSlug) ?? null) : null;
  const openEntries = openSlug
    ? [...(bySlug.get(openSlug) ?? [])].sort((x, y) => x.idx - y.idx)
    : [];

  return (
    <div>
      <h3 className="mb-1 text-sm tracking-widest text-neutral-500 uppercase">
        Behind the answers
      </h3>
      <p className="mb-3 text-sm text-neutral-500">
        Open any agent to see what it was asked, how it reasoned, which knowledge tools it called,
        and how long it took.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((a) => {
          const entries = bySlug.get(a.slug) ?? [];
          const correct = entries.filter((e) => e.correct).length;
          const tools = entries.reduce((n, e) => n + e.toolCalls.length, 0);
          return (
            <button
              key={a.slug}
              type="button"
              onClick={() => setOpenSlug(a.slug)}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-left transition hover:border-neutral-600 hover:bg-neutral-900"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="text-lg" aria-hidden>
                  {a.emoji}
                </span>
                <span className="truncate font-semibold">{a.name}</span>
                <span className="ml-auto shrink-0 text-xs text-ably">view →</span>
              </div>
              <p className="truncate text-xs text-neutral-500">
                {correct}/{entries.length} correct
                {tools > 0 ? ` · ${tools} tool call${tools === 1 ? '' : 's'}` : ''} · {a.model}
              </p>
            </button>
          );
        })}
      </div>
      {open && (
        <AgentConversationModal
          agent={open}
          entries={openEntries}
          onClose={() => setOpenSlug(null)}
        />
      )}
    </div>
  );
}

/** Format a millisecond latency compactly (`820ms` / `3.4s`). */
function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Modal listing one agent's turns across the whole quiz. Closes on backdrop
 *  click or Escape; the inner panel stops propagation so clicks inside stay. */
function AgentConversationModal({
  agent,
  entries,
  onClose,
}: {
  agent: AgentRosterEntry;
  entries: AgentTranscript[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex overflow-y-auto bg-black/70 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.name} — conversation`}
    >
      <div
        className="m-auto w-full max-w-2xl rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 rounded-t-2xl border-b border-neutral-800 bg-neutral-900/95 px-5 py-4 backdrop-blur">
          <span className="text-2xl" aria-hidden>
            {agent.emoji}
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold">{agent.name}</p>
            <p className="truncate text-xs text-neutral-500">
              {agent.model} · built by {agent.owner}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="space-y-4 p-5">
          {entries.length === 0 ? (
            <p className="text-sm text-neutral-500">No turns recorded.</p>
          ) : (
            entries.map((e) => <AgentTurnCard key={e.idx} turn={e} />)
          )}
        </div>
      </div>
    </div>
  );
}

/** One question's turn: prompt, options (chosen marked), reasoning, tool calls,
 *  timing, and the agent's quip — the debug + payoff view for a single answer. */
function AgentTurnCard({ turn: e }: { turn: AgentTranscript }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-neutral-400">
          Q{e.idx + 1}
        </span>
        {e.correct === true && (
          <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-emerald-400">✓ correct</span>
        )}
        {e.correct === false && (
          <span className="rounded bg-rose-950 px-1.5 py-0.5 text-rose-400">✗ wrong</span>
        )}
        {e.grounded && (
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-ably">grounded</span>
        )}
        {e.timedOut && (
          <span className="rounded bg-amber-950 px-1.5 py-0.5 text-amber-400">timed out</span>
        )}
        {e.forcedGuess && (
          <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-amber-300">forced guess</span>
        )}
        <span className="ml-auto text-neutral-500">answered in {fmtMs(e.answerMs)}</span>
      </div>
      <p className="mb-2 font-medium">{e.question}</p>
      <ul className="mb-3 space-y-1 text-sm">
        {e.options.map((opt, i) => {
          const letter = LETTERS[i];
          const chosen = e.choice === letter;
          return (
            <li
              key={i}
              className={`flex gap-2 ${chosen ? 'text-neutral-100' : 'text-neutral-500'}`}
            >
              <span className="font-mono">{letter})</span>
              <span>{opt}</span>
              {chosen && <span className="shrink-0 text-ably">← picked</span>}
            </li>
          );
        })}
      </ul>
      {e.reasoning && (
        <div className="mb-3">
          <p className="mb-1 text-xs tracking-wide text-neutral-500 uppercase">Reasoning</p>
          <p className="text-sm text-neutral-300 italic">{e.reasoning}</p>
        </div>
      )}
      {e.toolCalls.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-xs tracking-wide text-neutral-500 uppercase">
            Tool calls · {e.toolCalls.length}
          </p>
          <div className="space-y-2">
            {e.toolCalls.map((c, i) => (
              <AgentToolCallRow key={i} call={c} />
            ))}
          </div>
        </div>
      )}
      {e.quip && <p className="mt-2 text-sm text-neutral-400 italic">“{e.quip}”</p>}
    </div>
  );
}

function AgentToolCallRow({ call: c }: { call: AgentToolCall }) {
  return (
    <div
      className={`rounded-lg border p-2 font-mono text-xs ${
        c.isError ? 'border-rose-900/60 bg-rose-950/20' : 'border-neutral-800 bg-neutral-950'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-ably">{c.name}</span>
        {c.isError && <span className="text-rose-400">error</span>}
      </div>
      {c.input && <p className="mt-1 break-words text-neutral-500">in: {c.input}</p>}
      {c.result && (
        <p className="mt-1 break-words whitespace-pre-wrap text-neutral-400">→ {c.result}</p>
      )}
    </div>
  );
}

/** The commentator's breakdown as a quiet pundit "lower-third" (§S5.2): a header
 *  row (🎙️ chip + THE COMMENTATOR label) over the streaming verdict, sitting
 *  inside the results narrative rather than shouting as a full-width billboard.
 *  Renders nothing until text arrives. */
export function CommentaryCard({
  text,
  done,
  size = 'base',
}: {
  text: string;
  done: boolean;
  size?: 'sm' | 'base';
}) {
  if (!text) return null;
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="grid h-8 w-8 place-items-center rounded-full bg-neutral-800 text-base"
          aria-hidden
        >
          🎙️
        </span>
        <span className="text-xs tracking-[0.2em] text-ably uppercase">The Commentator</span>
      </div>
      <p className={`${size === 'sm' ? 'text-sm' : 'text-base'} leading-relaxed text-neutral-200`}>
        {text}
        {!done && <span className="ml-0.5 animate-pulse">▍</span>}
      </p>
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

/** Segmented question progress (§S5.2): one segment per question, filled as the
 *  quiz advances, with a "3 / 5" readout. `current` is 1-based. */
export function QuizProgress({ current, total }: { current: number; total: number }) {
  if (total <= 0 || current <= 0) return null;
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => {
          const n = i + 1;
          const cls = n < current ? 'bg-ably' : n === current ? 'bg-ably/60' : 'bg-neutral-800';
          return <div key={i} className={`h-1.5 flex-1 rounded-full ${cls}`} />;
        })}
      </div>
      <span className="shrink-0 text-sm font-semibold text-neutral-400 tabular-nums">
        {current} <span className="text-neutral-600">/</span> {total}
      </span>
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
  interlude,
}: {
  scoreboard: Record<string, ScoreboardEntry>;
  agents?: AgentRosterEntry[];
  /** Optional content between the podium stage and the runners-up (§S5.2) —
   *  e.g. the commentator's lower-third, so the result reads before the detail. */
  interlude?: ReactNode;
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

      {interlude}

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

/** Compact podium for the player's phone (§S5.2): a "🏆 Silicon/Carbon takes it"
 *  subtitle, then the top three as small medal columns (visual silver-gold-bronze,
 *  gold slightly raised), the viewer's own column ringed + tagged "you". Renders
 *  what exists when there are fewer than three; null when the board is empty. */
export function MiniPodium({
  scoreboard,
  agents = [],
  highlightId,
}: {
  scoreboard: Record<string, ScoreboardEntry>;
  agents?: AgentRosterEntry[];
  /** The viewer's own clientId — that column is highlighted as "you". */
  highlightId?: string;
}) {
  const ranked = Object.entries(scoreboard)
    .map(([clientId, e]) => ({ clientId, ...e }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  const [gold, silver, bronze] = ranked;
  // Visual order mirrors Podium: silver left, gold centre (raised), bronze right.
  const columns = [
    { entry: silver, medal: '🥈', delay: '0.15s', lift: '' },
    { entry: gold, medal: '🥇', delay: '0s', lift: 'mb-3' },
    { entry: bronze, medal: '🥉', delay: '0.3s', lift: '' },
  ];
  const subtitle = gold!.kind === 'agent' ? '🏆 Silicon takes it' : '🏆 Carbon takes it';

  return (
    <div className="space-y-3">
      <p className="text-center text-sm font-semibold text-neutral-300">{subtitle}</p>
      <div className="flex items-end justify-center gap-2">
        {columns.map((col, i) =>
          col.entry ? (
            <div
              key={i}
              className={`flex flex-1 flex-col items-center rounded-xl px-2 py-3 ${col.lift} ${
                col.entry.clientId === highlightId
                  ? 'bg-ably/10 ring-1 ring-ably/40'
                  : 'bg-neutral-900/50'
              }`}
              style={{ animation: `podium-rise 0.5s ease-out ${col.delay} both` }}
            >
              <div className="text-2xl">{col.medal}</div>
              <div className="mt-0.5 text-lg" aria-hidden>
                {identityEmoji(col.entry.clientId, agents)}
              </div>
              <div className="mt-0.5 w-full truncate text-center text-xs font-medium">
                {col.entry.name}
              </div>
              <div className="text-sm font-bold tabular-nums">{col.entry.score}</div>
              {col.entry.clientId === highlightId && (
                <span className="mt-1 rounded bg-ably/20 px-1.5 text-[0.6rem] font-semibold text-ably">
                  you
                </span>
              )}
            </div>
          ) : (
            <div key={i} className="flex-1" />
          ),
        )}
      </div>
    </div>
  );
}

/** "What if we'd scored differently?" (§S5.1): the same answers re-scored under
 *  every algorithm — a fun aside, not a scoring control. Collapsed by default;
 *  opening it shows who'd have topped each rule, so a different winner under, say,
 *  `fastest-finger` is the reveal. Pure recompute — payload arrives at analysis. */
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
  const activeLabel = algos.find((a) => a.id === payload.activeAlgoId)?.label ?? 'the live rule';
  // The hook: how many algorithms would crown someone other than the live winner.
  const upsets = activeWinner
    ? algos.filter(
        (a) => a.id !== payload.activeAlgoId && a.top[0]?.clientId !== activeWinner.clientId,
      )
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
          <span className="font-semibold">What if we&apos;d scored differently?</span>{' '}
          <span className="text-sm text-neutral-400">
            {upsets.length > 0
              ? `${upsets.length} other rule${upsets.length === 1 ? '' : 's'} would crown a different winner`
              : 'every scoring rule agrees on the winner'}
          </span>
        </span>
        <span className="text-neutral-500" aria-hidden>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <ul className="space-y-2 border-t border-neutral-800 px-5 py-4">
          <li className="px-1 pb-1 text-xs text-neutral-500">
            This quiz was scored with <span className="text-neutral-300">{activeLabel}</span>. Same
            answers, every rule — here&apos;s who&apos;d have topped each:
          </li>
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
                  {active && (
                    <span className="text-[0.65rem] tracking-wide text-ably uppercase">
                      scored live
                    </span>
                  )}
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
