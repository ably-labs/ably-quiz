'use client';

import type { Member } from '@/hooks/useAbly';

/** Lobby roster: humans vs agents, live counts. Shared by /screen, /host, /play. */
export function Lobby({ members }: { members: Member[] }) {
  const humans = members.filter((m) => m.kind === 'human');
  const agents = members.filter((m) => m.kind === 'agent');
  return (
    <div className="grid grid-cols-2 gap-4">
      <Column
        title="Humans"
        accent="text-sky-400"
        members={humans}
        emptyHint="waiting for players…"
      />
      <Column title="Agents" accent="text-ably" members={agents} emptyHint="no agents yet" />
    </div>
  );
}

function Column({
  title,
  accent,
  members,
  emptyHint,
}: {
  title: string;
  accent: string;
  members: Member[];
  emptyHint: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className={`text-sm font-semibold tracking-wide uppercase ${accent}`}>{title}</h2>
        <span className="text-2xl font-bold tabular-nums">{members.length}</span>
      </div>
      {members.length === 0 ? (
        <p className="text-sm text-neutral-600">{emptyHint}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {members.map((m) => (
            <li
              key={m.clientId}
              className="rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-200"
            >
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
