'use client';

import {
  parseAgentQuips,
  parseAgentTranscript,
  parseControlMessage,
  parseCounterfactual,
  type AgentQuips,
  type AgentTranscript,
  type Choice,
  type CounterfactualPayload,
} from '@ably-quiz/core';
import { useEffect, useState } from 'react';
import type { Connection } from '@/lib/ably';
import {
  AGENT_QUIPS_EVENT,
  AGENT_TRANSCRIPT_EVENT,
  COUNTERFACTUAL_EVENT,
  getMainChannel,
  INITIAL_STATE,
  loadAgentQuips,
  loadAgentTranscripts,
  loadControlHistory,
  loadCounterfactual,
  subscribeQuizState,
  type LiveQuizState,
} from '@/lib/quiz-live';

export type QuestionBroadcast = {
  idx: number;
  prompt: string;
  options: string[];
  limitMs: number;
  /** Ably server timestamp of the question broadcast — the cosmetic-countdown anchor. */
  startedAt: number;
};

export type QuizView = LiveQuizState & {
  /** Current question content (from the control broadcast), null before the first question. */
  question: QuestionBroadcast | null;
  /** Correct letter once revealed for the current question. */
  correct: Choice | null;
  /** "By the way…" standings under every scoring algorithm — set at analysis (§S5.1). */
  counterfactual: CounterfactualPayload | null;
  /** Agents' one-liners for the most recently revealed question, host-released at
   *  reveal (§S5.3). Newest wins; the view gates it to the current revealed idx. */
  agentQuips: AgentQuips | null;
  /** Every agent's per-question turn record, host-released at reveal (§S6.6). The
   *  end-of-quiz conversation viewer groups these by agent. */
  agentTranscripts: AgentTranscript[];
};

/** Upsert a transcript by (slug, idx) — a live message replaces an earlier copy. */
export function upsertTranscript(list: AgentTranscript[], t: AgentTranscript): AgentTranscript[] {
  const i = list.findIndex((x) => x.slug === t.slug && x.idx === t.idx);
  if (i === -1) return [...list, t];
  const next = list.slice();
  next[i] = t;
  return next;
}

/** Read-only quiz view for /screen and /play: control broadcasts drive the
 *  question + reveal; LiveObjects drives phase/tallies/scoreboard (+ recovery). */
export function useQuizState(conn: Connection | null, quizId: string): QuizView {
  const [live, setLive] = useState<LiveQuizState>(INITIAL_STATE);
  const [question, setQuestion] = useState<QuestionBroadcast | null>(null);
  const [correct, setCorrect] = useState<Choice | null>(null);
  const [counterfactual, setCounterfactual] = useState<CounterfactualPayload | null>(null);
  const [agentQuips, setAgentQuips] = useState<AgentQuips | null>(null);
  const [agentTranscripts, setAgentTranscripts] = useState<AgentTranscript[]>([]);

  useEffect(() => {
    if (!conn) return;
    const channel = getMainChannel(conn.client, quizId, { write: false });
    let unsub = () => {};
    // Once a live control lands, it's fresher than any history seed — so a late
    // history reconstruction must not clobber it (§B3 S3.5 player recovery).
    let liveSeen = false;

    void channel.subscribe('control', (msg) => {
      const m = parseControlMessage(msg.data);
      if (!m) return;
      liveSeen = true;
      if (m.type === 'question') {
        setQuestion({
          idx: m.idx,
          prompt: m.prompt,
          options: m.options,
          limitMs: m.limitMs,
          startedAt: msg.timestamp ?? Date.now(),
        });
        setCorrect(null);
      } else if (m.type === 'reveal') {
        setCorrect(m.correct);
      }
    });

    // The "by the way…" counterfactual is a one-shot the host publishes at
    // analysis; catch it live, and re-derive from history for a screen/player
    // that joins or reloads after it landed (§S5.1).
    void channel.subscribe(COUNTERFACTUAL_EVENT, (msg) => {
      const payload = parseCounterfactual(msg.data);
      if (payload) setCounterfactual(payload);
    });
    void loadCounterfactual(channel).then((payload) => {
      if (payload) setCounterfactual((cur) => cur ?? payload);
    });

    // Agent quips are released by the host at each reveal (§S5.3); catch them live,
    // and re-derive the latest from history so a /screen that joins or reloads
    // mid-reveal still shows the current question's takes. Newest wins.
    void channel.subscribe(AGENT_QUIPS_EVENT, (msg) => {
      const payload = parseAgentQuips(msg.data);
      if (payload) setAgentQuips(payload);
    });
    void loadAgentQuips(channel).then((payload) => {
      if (payload) setAgentQuips((cur) => cur ?? payload);
    });

    // Agent transcripts are host-released at each reveal (§S6.6); catch them live
    // and re-derive from history so a screen/player that joins at the podium still
    // gets every agent's conversation. A live copy replaces an older history one.
    void channel.subscribe(AGENT_TRANSCRIPT_EVENT, (msg) => {
      const t = parseAgentTranscript(msg.data);
      if (t) setAgentTranscripts((cur) => upsertTranscript(cur, t));
    });
    void loadAgentTranscripts(channel).then((list) => {
      if (!list.length) return;
      setAgentTranscripts((cur) => {
        let next = cur;
        for (const t of list) {
          if (!next.some((x) => x.slug === t.slug && x.idx === t.idx)) next = [...next, t];
        }
        return next;
      });
    });

    void subscribeQuizState(channel, setLive).then((u) => {
      unsub = u;
    });

    // Recovery: a player/screen that joins mid-question missed the live question
    // broadcast, so re-derive the in-flight question (+ its reveal) from control
    // history. Skipped if a live control already arrived (that's authoritative).
    void loadControlHistory(channel).then((hist) => {
      if (liveSeen) return;
      let q: QuestionBroadcast | null = null;
      let c: Choice | null = null;
      for (const { msg, serverTs } of hist) {
        if (msg.type === 'question') {
          q = {
            idx: msg.idx,
            prompt: msg.prompt,
            options: msg.options,
            limitMs: msg.limitMs,
            startedAt: serverTs,
          };
          c = null;
        } else if (msg.type === 'reveal' && q && msg.idx === q.idx) {
          c = msg.correct;
        }
      }
      if (liveSeen || !q) return;
      setQuestion(q);
      setCorrect(c);
    });

    return () => {
      channel.unsubscribe();
      unsub();
    };
  }, [conn, quizId]);

  return { ...live, question, correct, counterfactual, agentQuips, agentTranscripts };
}
