'use client';

import { agentChannel, parseCommentary } from '@ably-quiz/core';
import type * as Ably from 'ably';
import { useEffect, useState } from 'react';
import type { Connection } from '@/lib/ably';

/** The commentator's live breakdown streamed to /screen (§B2.9). Subscribes to
 *  quiz-agent:{id}:commentator; text grows token-by-token until `done`. */
export function useCommentary(
  conn: Connection | null,
  quizId: string,
): { text: string; done: boolean } {
  const [state, setState] = useState({ text: '', done: false });

  useEffect(() => {
    if (!conn || !quizId) return;
    const channel = conn.client.channels.get(agentChannel(quizId, 'commentator'));
    const handler = (msg: Ably.Message) => {
      const m = parseCommentary(msg.data);
      if (m) setState({ text: m.text, done: m.done });
    };
    void channel.subscribe('commentary', handler);
    return () => channel.unsubscribe('commentary', handler);
  }, [conn, quizId]);

  return state;
}
