'use client';

// Host-side MCP OAuth (§S6, Option A). Runs DCR + PKCE authorization-code
// against the Worker (via our server proxies for the CORS-sensitive steps), with
// the /authorize step as a browser redirect through Okta. The resulting 1h
// read-only token lives ONLY in this browser (sessionStorage, per quiz) and is
// passed per agent-turn — never persisted server-side.

import { useCallback, useEffect, useRef, useState } from 'react';

const PKCE_KEY = 'mcp_pkce'; // transient, spans the Okta redirect only

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(bytes = 48): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf);
}
async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

type Pkce = {
  verifier: string;
  state: string;
  clientId: string;
  tokenEndpoint: string;
  redirectUri: string;
};

export type McpAuthStatus = 'idle' | 'starting' | 'exchanging' | 'authed' | 'error';
export type McpAuth = {
  status: McpAuthStatus;
  token: string | null;
  error?: string;
  /** Kick off the OAuth redirect (navigates away to Okta, returns to this page). */
  authenticate: () => void;
  /** Drop the token for this quiz (agents fall back to ungrounded). */
  signOut: () => void;
};

export function useMcpAuth(quizId: string | null): McpAuth {
  const [status, setStatus] = useState<McpAuthStatus>('idle');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const tokenKey = quizId ? `mcp_token:${quizId}` : null;

  // Restore a token from a prior redirect/reload (session-scoped, browser-only).
  useEffect(() => {
    if (!tokenKey) return;
    const saved = sessionStorage.getItem(tokenKey);
    if (saved) {
      setToken(saved);
      setStatus('authed');
    }
  }, [tokenKey]);

  // Complete the flow if we've returned from Okta with ?code&state.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || !tokenKey) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return;
    handled.current = true;

    const raw = sessionStorage.getItem(PKCE_KEY);
    sessionStorage.removeItem(PKCE_KEY);
    const cleanUrl = () => {
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      window.history.replaceState({}, '', url.toString());
    };
    if (!raw) return cleanUrl();
    const pkce = JSON.parse(raw) as Pkce;
    if (pkce.state !== state) {
      setStatus('error');
      setError('OAuth state mismatch — please try again.');
      return cleanUrl();
    }

    setStatus('exchanging');
    void (async () => {
      try {
        const res = await fetch('/api/mcp/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tokenEndpoint: pkce.tokenEndpoint,
            code,
            codeVerifier: pkce.verifier,
            clientId: pkce.clientId,
            redirectUri: pkce.redirectUri,
          }),
        });
        const data = (await res.json()) as { accessToken?: string; error?: string };
        if (!res.ok || !data.accessToken) throw new Error(data.error ?? 'token exchange failed');
        sessionStorage.setItem(tokenKey, data.accessToken);
        setToken(data.accessToken);
        setStatus('authed');
        setError(undefined);
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'authentication failed');
      } finally {
        cleanUrl();
      }
    })();
  }, [tokenKey]);

  const authenticate = useCallback(() => {
    void (async () => {
      try {
        setStatus('starting');
        setError(undefined);
        // The redirect target is this page, minus any stale code/state.
        const ru = new URL(window.location.href.split('#')[0] ?? window.location.href);
        ru.searchParams.delete('code');
        ru.searchParams.delete('state');
        const redirectUri = ru.toString();

        const regRes = await fetch('/api/mcp/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ redirectUri }),
        });
        const reg = (await regRes.json()) as {
          clientId?: string;
          authorizationEndpoint?: string;
          tokenEndpoint?: string;
          error?: string;
        };
        if (!regRes.ok || !reg.clientId || !reg.authorizationEndpoint || !reg.tokenEndpoint) {
          throw new Error(reg.error ?? 'client registration failed');
        }

        const verifier = randomString();
        const challenge = await challengeOf(verifier);
        const state = randomString(24);
        sessionStorage.setItem(
          PKCE_KEY,
          JSON.stringify({
            verifier,
            state,
            clientId: reg.clientId,
            tokenEndpoint: reg.tokenEndpoint,
            redirectUri,
          } satisfies Pkce),
        );

        const auth = new URL(reg.authorizationEndpoint);
        auth.searchParams.set('response_type', 'code');
        auth.searchParams.set('client_id', reg.clientId);
        auth.searchParams.set('redirect_uri', redirectUri);
        auth.searchParams.set('code_challenge', challenge);
        auth.searchParams.set('code_challenge_method', 'S256');
        auth.searchParams.set('state', state);
        // FULL mode is baked into the token at AUTHORIZE time (§S6.8): it flattens
        // all native tools into tools/list so the grounded loop can hand the
        // ABLY_MCP_TOOLS subset to the model directly — no dispatcher, real schemas.
        auth.searchParams.set('mode', 'full');
        window.location.href = auth.toString();
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'authentication failed');
      }
    })();
  }, []);

  const signOut = useCallback(() => {
    if (tokenKey) sessionStorage.removeItem(tokenKey);
    setToken(null);
    setStatus('idle');
    setError(undefined);
  }, [tokenKey]);

  return { status, token, error, authenticate, signOut };
}
