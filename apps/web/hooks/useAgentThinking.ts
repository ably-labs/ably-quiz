'use client';

import { agentChannel, parseAgentThinking, type AgentRosterEntry } from '@ably-quiz/core';
import type * as Ably from 'ably';
import { useEffect, useState } from 'react';
import type { Connection } from '@/lib/ably';

export type AgentThinkState = {
  phase: 'thinking' | 'answered' | 'error';
  /** Status-only as of S5.3: empty for thinking/answered, a short message for error.
   *  Reasoning + quips no longer ride this channel (they leaked the answer). */
  text: string;
  idx: number;
};

/** Live per-agent STATUS for the current question (§S4.5 / §S5.3). Subscribes to
 *  each declared agent's `quiz-agent:{id}:{slug}` channel — the on-demand turn
 *  publishes thinking/answered/error status there (status only; no reasoning, no
 *  quip, to avoid a mid-question wire-leak). Read-only; resets per question. */
export function useAgentThinking(
  conn: Connection | null,
  quizId: string,
  agents: AgentRosterEntry[],
  currentIdx: number,
): Record<string, AgentThinkState> {
  const [bySlug, setBySlug] = useState<Record<string, AgentThinkState>>({});

  // Thinking is per-question — clear the wall when a new question opens.
  useEffect(() => {
    setBySlug({});
  }, [currentIdx]);

  // Re-subscribe only when the connection or the roster changes.
  const slugsKey = agents.map((a) => a.slug).join(',');
  useEffect(() => {
    if (!conn || !quizId || agents.length === 0) return;
    const channels = agents.map((a) => conn.client.channels.get(agentChannel(quizId, a.slug)));
    const handler = (msg: Ably.Message) => {
      const m = parseAgentThinking(msg.data);
      if (!m) return;
      setBySlug((prev) => {
        const existing = prev[m.slug];
        if (existing && m.idx < existing.idx) return prev; // ignore a prior question's tail
        return { ...prev, [m.slug]: { phase: m.phase, text: m.text, idx: m.idx } };
      });
    };
    channels.forEach((ch) => void ch.subscribe('thinking', handler));
    return () => channels.forEach((ch) => ch.unsubscribe('thinking', handler));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, quizId, slugsKey]);

  return bySlug;
}
