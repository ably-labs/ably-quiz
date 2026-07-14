import { describe, expect, it } from 'vitest';
import { base64url, discoverAuthServer, pkceChallenge } from './mcp-oauth';

describe('PKCE helpers', () => {
  it('base64url encodes without padding and with URL-safe alphabet', () => {
    // 0xFB 0xFF 0xFE → base64 "+//+", which base64url must render as "-__-".
    expect(base64url(Buffer.from([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(base64url(Buffer.from('a'))).toBe('YQ'); // no "=" padding
  });

  it('derives the S256 challenge that matches the RFC 7636 test vector', () => {
    // Appendix B of RFC 7636 — the canonical verifier→challenge example.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(pkceChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('discoverAuthServer', () => {
  const base = 'https://mcp.example.test';

  it('uses advertised endpoints from RFC 8414 metadata', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          authorization_endpoint: `${base}/oauth/authorize`,
          token_endpoint: `${base}/oauth/token`,
          registration_endpoint: `${base}/oauth/register`,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const eps = await discoverAuthServer(base, fetchImpl);
    expect(eps.authorization_endpoint).toBe(`${base}/oauth/authorize`);
    expect(eps.token_endpoint).toBe(`${base}/oauth/token`);
  });

  it('falls back to the workers-oauth-provider defaults when discovery fails', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const eps = await discoverAuthServer(base, fetchImpl);
    expect(eps).toEqual({
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
    });
  });

  it('falls back when the fetch throws (network error)', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const eps = await discoverAuthServer(base, fetchImpl);
    expect(eps.token_endpoint).toBe(`${base}/token`);
  });
});
