'use client';

import { useCallback, useEffect, useState } from 'react';

export type AgentHealth = { slug: string; name: string; ok: boolean; error?: string };
export type HealthStatus = 'checking' | 'ok' | 'issues' | 'unconfigured';
export type HealthState = {
  status: HealthStatus;
  results: AgentHealth[];
  /** ANTHROPIC_API_KEY present — grounded turns need it (else they fall back). */
  groundingKey: boolean;
  error?: string;
  recheck: () => void;
};

/** Preflight the declared roster once on load (and on demand): a tiny gateway
 *  call per agent so a quota/auth/model problem is visible before the quiz. */
export function useAgentHealth(slugs: string[]): HealthState {
  const [status, setStatus] = useState<HealthStatus>('checking');
  const [results, setResults] = useState<AgentHealth[]>([]);
  const [groundingKey, setGroundingKey] = useState(true);
  const [error, setError] = useState<string>();

  const key = slugs.join(',');
  const check = useCallback(() => {
    if (slugs.length === 0) {
      setStatus('ok');
      setResults([]);
      return;
    }
    setStatus('checking');
    setError(undefined);
    void fetch('/api/agent-health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    })
      .then((r) => r.json())
      .then(
        (d: {
          configured?: boolean;
          groundingKey?: boolean;
          results?: AgentHealth[];
          error?: string;
        }) => {
          if (!d.configured) {
            setStatus('unconfigured');
            setError(d.error);
            setResults([]);
            return;
          }
          const res = d.results ?? [];
          setResults(res);
          setGroundingKey(Boolean(d.groundingKey));
          setStatus(res.every((r) => r.ok) ? 'ok' : 'issues');
        },
      )
      .catch((e: unknown) => {
        setStatus('issues');
        setError(e instanceof Error ? e.message : 'health check failed');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    check();
  }, [check]);

  return { status, results, groundingKey, error, recheck: check };
}
