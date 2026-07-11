'use client';

import type * as Ably from 'ably';
import { kindFromClientId, type Kind } from '@ably-quiz/core';
import { useEffect, useRef, useState } from 'react';
import { connect, type ConnectParams, type Connection } from '@/lib/ably';
import { getMainChannel } from '@/lib/quiz-live';

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'failed';

/** Open (and clean up) a single Ably connection for the given params. */
export function useAbly(params: ConnectParams | null): {
  conn: Connection | null;
  status: ConnStatus;
  error: string | null;
} {
  const [conn, setConn] = useState<Connection | null>(null);
  const [status, setStatus] = useState<ConnStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Depend on primitive fields, not object identity, to avoid reconnect churn.
  const key = params
    ? `${params.quizId}|${params.role}|${params.clientId ?? ''}|${params.slug ?? ''}`
    : null;

  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    let client: Ably.Realtime | null = null;
    setStatus('connecting');
    setError(null);

    connect(params)
      .then((c) => {
        if (cancelled) {
          c.client.close();
          return;
        }
        client = c.client;
        c.client.connection.on('connected', () => setStatus('connected'));
        c.client.connection.on('failed', () => setStatus('failed'));
        c.client.connection.on('suspended', () => setStatus('connecting'));
        setConn(c);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('failed');
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      client?.close();
      setConn(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { conn, status, error };
}

export type Member = { clientId: string; kind: Kind; name: string };

/** Subscribe to the lobby presence set on the main channel; optionally enter it. */
export function usePresence(
  conn: Connection | null,
  quizId: string,
  self: { name: string; enter: boolean },
): Member[] {
  const [members, setMembers] = useState<Member[]>([]);
  const enteredRef = useRef(false);

  useEffect(() => {
    if (!conn) return;
    const channel = getMainChannel(conn.client, quizId, { write: false });
    let mounted = true;

    const toMember = (m: Ably.PresenceMessage): Member => ({
      clientId: m.clientId ?? '?',
      kind: kindFromClientId(m.clientId ?? ''),
      name: (m.data as { name?: string } | undefined)?.name ?? m.clientId ?? 'anon',
    });

    const refresh = async () => {
      const present = await channel.presence.get();
      if (mounted) setMembers(present.map(toMember));
    };

    void channel.presence.subscribe(refresh);
    if (self.enter && !enteredRef.current) {
      enteredRef.current = true;
      void channel.presence.enter({ name: self.name });
    }
    void refresh();

    return () => {
      mounted = false;
      channel.presence.unsubscribe();
      if (enteredRef.current) {
        enteredRef.current = false;
        void channel.presence.leave().catch(() => undefined);
      }
    };
  }, [conn, quizId, self.name, self.enter]);

  return members;
}
