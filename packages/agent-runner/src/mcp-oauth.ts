// Interactive MCP OAuth for the CLI (§S6.3). The app grounds agents with a
// browser OAuth token; the study CLI has no browser, so it runs the SAME flow —
// Dynamic Client Registration + PKCE (S256) authorization-code against the
// Worker — but with a LOOPBACK redirect (RFC 8252): we print the authorize URL,
// the user signs in through Okta in their own browser, and the Worker redirects
// back to a tiny localhost server we spin up to catch the code. No token is ever
// stored on disk or asked for in the terminal; it lives in memory for the run.

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const CLIENT_NAME = 'Carbon vs Silicon — the Ably Quiz (study CLI)';
const CALLBACK_TIMEOUT_MS = 5 * 60_000; // give the human 5 minutes to sign in

export type OAuthResult = {
  accessToken: string;
  expiresIn: number;
  /** Present when the server issues one — lets a caller mint fresh access tokens
   *  (via `refreshMcpToken`) without another interactive sign-in. */
  refreshToken?: string;
  /** The DCR client + token endpoint, needed to refresh later. */
  clientId: string;
  tokenEndpoint: string;
};

/** RFC 7636 base64url (no padding) — matches the web client's `b64url`. */
export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(bytes = 48): string {
  return base64url(randomBytes(bytes));
}
/** PKCE S256 code challenge for a verifier (SHA-256 → base64url). */
export function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export type AuthServer = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
};

/** RFC 8414 discovery with the workers-oauth-provider defaults as a fallback —
 *  same behaviour as the app's /api/mcp/register discover(). */
export async function discoverAuthServer(
  base: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthServer> {
  const fallback: AuthServer = {
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
  };
  try {
    const res = await fetchImpl(`${base}/.well-known/oauth-authorization-server`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return fallback;
    const meta = (await res.json()) as Partial<AuthServer>;
    return {
      authorization_endpoint: meta.authorization_endpoint ?? fallback.authorization_endpoint,
      token_endpoint: meta.token_endpoint ?? fallback.token_endpoint,
      registration_endpoint: meta.registration_endpoint ?? fallback.registration_endpoint,
    };
  } catch {
    return fallback;
  }
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px/1.5 system-ui;max-width:32rem;margin:20vh auto;text-align:center;color:#111"><h2>${title}</h2><p>${body}</p></body>`;

type Loopback = {
  server: Server;
  redirectUri: string;
  waitForCode: () => Promise<{ code: string; state: string }>;
};

/** Bind an ephemeral localhost server that resolves once the OAuth redirect lands. */
function startLoopback(): Promise<Loopback> {
  return new Promise((resolve, reject) => {
    let settle: (v: { code: string; state: string }) => void = () => {};
    let fail: (e: Error) => void = () => {};
    const codePromise = new Promise<{ code: string; state: string }>((res, rej) => {
      settle = res;
      fail = rej;
    });

    const server = createServer((req, httpRes) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        httpRes.writeHead(404).end('not found');
        return;
      }
      const err = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (err || !code || !state) {
        httpRes.writeHead(400, { 'content-type': 'text/html' });
        httpRes.end(PAGE('Authentication failed', err ?? 'No authorization code was returned.'));
        fail(new Error(err ?? 'no authorization code returned'));
        return;
      }
      httpRes.writeHead(200, { 'content-type': 'text/html' });
      httpRes.end(PAGE('You’re signed in ✓', 'Return to the terminal — you can close this tab.'));
      settle({ code, state });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr) {
        reject(new Error('failed to bind loopback server'));
        return;
      }
      resolve({
        server,
        redirectUri: `http://127.0.0.1:${addr.port}/callback`,
        waitForCode: () => {
          const timeout = new Promise<never>((_, rej) => {
            const t = setTimeout(
              () => rej(new Error('timed out waiting for the OAuth callback (5 min)')),
              CALLBACK_TIMEOUT_MS,
            );
            t.unref();
          });
          return Promise.race([codePromise, timeout]);
        },
      });
    });
  });
}

/**
 * Run the full interactive OAuth flow and return an access token.
 * `onAuthorizeUrl` is called with the URL for the user to open — the caller
 * prints it (we deliberately do NOT auto-open a browser).
 */
export async function authorizeMcp(opts: {
  /** OAuth base origin (e.g. https://…workers.dev) — endpoints hang off it. */
  base: string;
  onAuthorizeUrl: (url: string) => void;
  /** Extra query params for the AUTHORIZE url. The Ably MCP reads `mode=full`
   *  here (not on the /mcp request) and bakes it into the token, so it must be
   *  set at sign-in time to get the flattened 140+ tool surface. */
  authorizeParams?: Record<string, string>;
}): Promise<OAuthResult> {
  const loopback = await startLoopback();
  const { redirectUri } = loopback;
  try {
    const endpoints = await discoverAuthServer(opts.base);

    // Dynamic Client Registration — a fresh public (PKCE) client for this run.
    const reg = await fetch(endpoints.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
    });
    const regData = (await reg.json().catch(() => ({}))) as { client_id?: string; error?: string };
    if (!reg.ok || !regData.client_id) {
      throw new Error(regData.error ?? `client registration failed (${reg.status})`);
    }

    const verifier = randomString();
    const state = randomString(24);
    const authUrl = new URL(endpoints.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', regData.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('code_challenge', pkceChallenge(verifier));
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    for (const [k, v] of Object.entries(opts.authorizeParams ?? {})) {
      authUrl.searchParams.set(k, v);
    }
    opts.onAuthorizeUrl(authUrl.toString());

    const { code, state: returnedState } = await loopback.waitForCode();
    if (returnedState !== state) throw new Error('OAuth state mismatch — aborting');

    const tok = await fetch(endpoints.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: regData.client_id,
        redirect_uri: redirectUri,
      }),
    });
    const tokData = (await tok.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tok.ok || !tokData.access_token) {
      throw new Error(
        tokData.error_description ?? tokData.error ?? `token exchange failed (${tok.status})`,
      );
    }
    return {
      accessToken: tokData.access_token,
      expiresIn: tokData.expires_in ?? 3600,
      ...(tokData.refresh_token ? { refreshToken: tokData.refresh_token } : {}),
      clientId: regData.client_id,
      tokenEndpoint: endpoints.token_endpoint,
    };
  } finally {
    loopback.server.close();
  }
}

/**
 * Mint a fresh access token from a stored refresh token — no interactive sign-in.
 * Uses the same public (PKCE) DCR client id from the original authorization.
 * Returns the new token (+ a rotated refresh token if the server issues one).
 */
export async function refreshMcpToken(opts: {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
}): Promise<OAuthResult> {
  const tok = await fetch(opts.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
    }),
  });
  const d = (await tok.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tok.ok || !d.access_token) {
    throw new Error(d.error_description ?? d.error ?? `token refresh failed (${tok.status})`);
  }
  return {
    accessToken: d.access_token,
    expiresIn: d.expires_in ?? 3600,
    // Servers often rotate refresh tokens; keep the new one, else reuse the old.
    refreshToken: d.refresh_token ?? opts.refreshToken,
    clientId: opts.clientId,
    tokenEndpoint: opts.tokenEndpoint,
  };
}
