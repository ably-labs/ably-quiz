'use client';

import type { AgentRosterEntry } from '@ably-quiz/core';
import type { ReactNode } from 'react';
import { TeamMark } from '@/components/quiz';
import type { Member } from '@/hooks/useAbly';

/** Lobby roster: humans vs agents. Shared by /screen, /host, /play.
 *
 *  Humans come from live presence. Agents come from the DECLARED roster
 *  (§S4.4) when provided — they're "present" because they were chosen at create
 *  time, invoked per-question rather than running as a process — and a live dot
 *  marks any that are currently connected (thinking). With no declared roster
 *  (e.g. an older quiz), the Agents column falls back to presence. */
export function Lobby({
  members,
  agents,
  unavailable,
}: {
  members: Member[];
  agents?: AgentRosterEntry[];
  /** Agent slugs that failed the host's preflight — shown greyed as "unavailable". */
  unavailable?: ReadonlySet<string>;
}) {
  const humans = members.filter((m) => m.kind === 'human');
  const liveAgentSlugs = new Set(
    members.filter((m) => m.kind === 'agent').map((m) => m.clientId.replace(/^a:/, '')),
  );

  return (
    <div className="grid grid-cols-2 gap-4">
      <Column
        title="Humans"
        accent="text-sky-400"
        mark="carbon"
        count={humans.length}
        emptyHint="waiting for players…"
      >
        {humans.map((m) => (
          <Chip key={m.clientId}>{m.name}</Chip>
        ))}
      </Column>

      {agents ? (
        <Column
          title="Agents"
          accent="text-ably"
          mark="silicon"
          count={agents.length}
          emptyHint="humans only — no agents in this quiz"
        >
          {agents.map((a) => {
            const down = unavailable?.has(a.slug) ?? false;
            return (
              <Chip key={a.slug} live={!down && liveAgentSlugs.has(a.slug)} muted={down}>
                <span className="mr-1">{a.emoji}</span>
                {a.name}
                {down && (
                  <span className="ml-1.5 text-[0.6rem] tracking-wide text-neutral-500 uppercase">
                    unavailable
                  </span>
                )}
              </Chip>
            );
          })}
        </Column>
      ) : (
        <Column
          title="Agents"
          accent="text-ably"
          mark="silicon"
          count={members.filter((m) => m.kind === 'agent').length}
          emptyHint="no agents yet"
        >
          {members
            .filter((m) => m.kind === 'agent')
            .map((m) => (
              <Chip key={m.clientId}>{m.name}</Chip>
            ))}
        </Column>
      )}
    </div>
  );
}

function Column({
  title,
  accent,
  mark,
  count,
  emptyHint,
  children,
}: {
  title: string;
  accent: string;
  mark: 'carbon' | 'silicon';
  count: number;
  emptyHint: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className={`flex items-center gap-2 text-sm font-semibold tracking-wide uppercase ${accent}`}
        >
          <TeamMark team={mark} className="h-6 w-6" />
          {title}
        </h2>
        <span className="text-2xl font-bold tabular-nums">{count}</span>
      </div>
      {count === 0 ? (
        <p className="text-sm text-neutral-600">{emptyHint}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">{children}</ul>
      )}
    </div>
  );
}

/** One roster pill. `live` shows a green dot (connected/thinking); `muted` greys
 *  it out (an agent that failed preflight and won't play). */
function Chip({ children, live, muted }: { children: ReactNode; live?: boolean; muted?: boolean }) {
  return (
    <li
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${
        muted
          ? 'bg-neutral-900 text-neutral-500 opacity-70 grayscale'
          : 'bg-neutral-800 text-neutral-200'
      }`}
    >
      {live && <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-label="live" />}
      {children}
    </li>
  );
}
