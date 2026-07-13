'use client';

import type { AgentRosterEntry } from '@ably-quiz/core';
import type { ReactNode } from 'react';
import type { Member } from '@/hooks/useAbly';

/** Lobby roster: humans vs agents. Shared by /screen, /host, /play.
 *
 *  Humans come from live presence. Agents come from the DECLARED roster
 *  (§S4.4) when provided — they're "present" because they were chosen at create
 *  time, invoked per-question rather than running as a process — and a live dot
 *  marks any that are currently connected (thinking). With no declared roster
 *  (e.g. an older quiz), the Agents column falls back to presence. */
export function Lobby({ members, agents }: { members: Member[]; agents?: AgentRosterEntry[] }) {
  const humans = members.filter((m) => m.kind === 'human');
  const liveAgentSlugs = new Set(
    members.filter((m) => m.kind === 'agent').map((m) => m.clientId.replace(/^a:/, '')),
  );

  return (
    <div className="grid grid-cols-2 gap-4">
      <Column title="Humans" accent="text-sky-400" count={humans.length} emptyHint="waiting for players…">
        {humans.map((m) => (
          <Chip key={m.clientId}>{m.name}</Chip>
        ))}
      </Column>

      {agents ? (
        <Column
          title="Agents"
          accent="text-ably"
          count={agents.length}
          emptyHint="humans only — no agents in this quiz"
        >
          {agents.map((a) => (
            <Chip key={a.slug} live={liveAgentSlugs.has(a.slug)}>
              <span className="mr-1">{a.emoji}</span>
              {a.name}
            </Chip>
          ))}
        </Column>
      ) : (
        <Column
          title="Agents"
          accent="text-ably"
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
  count,
  emptyHint,
  children,
}: {
  title: string;
  accent: string;
  count: number;
  emptyHint: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className={`text-sm font-semibold tracking-wide uppercase ${accent}`}>{title}</h2>
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

/** One roster pill. `live` shows a green dot — the agent is connected/thinking. */
function Chip({ children, live }: { children: ReactNode; live?: boolean }) {
  return (
    <li className="flex items-center gap-1.5 rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-200">
      {live && <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-label="live" />}
      {children}
    </li>
  );
}
