// Shared MCP sessions (§S6.9): one handshake per server×token, concurrent
// callers dedupe, failed handshakes evict, invalidation forces a fresh one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMcpSession, invalidateMcpSession } from './mcp-session';

const URL_A = 'https://mcp.example.test/mcp';

/** JSON-RPC-shaped fetch stub: counts initialize calls, answers tools/list. */
function stubServer(opts: { failFirstInit?: boolean } = {}) {
  const counts = { initialize: 0, 'tools/list': 0, 'tools/call': 0 };
  let failNext = opts.failFirstInit ?? false;
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (body.method in counts) counts[body.method as keyof typeof counts]++;
    if (body.method === 'initialize' && failNext) {
      failNext = false;
      return new Response('oops', { status: 500 });
    }
    if (!body.id) return new Response(null, { status: 202 }); // notification
    const result =
      body.method === 'tools/list'
        ? { tools: [{ name: 'jiraSearchIssues' }, { name: 'confluenceSearchPages' }] }
        : {};
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' },
    });
  });
  return { counts, fetchMock };
}

describe('getMcpSession', () => {
  beforeEach(() => {
    // Each test uses a unique token so the module-level cache can't leak between tests.
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('performs the handshake once and shares it across calls and concurrent callers', async () => {
    const { counts, fetchMock } = stubServer();
    vi.stubGlobal('fetch', fetchMock);
    const token = 'tok-share';
    const [a, b] = await Promise.all([getMcpSession(URL_A, token), getMcpSession(URL_A, token)]);
    const c = await getMcpSession(URL_A, token);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(counts.initialize).toBe(1);
    expect(counts['tools/list']).toBe(1);
    expect(a.tools.map((t) => t.name)).toEqual(['jiraSearchIssues', 'confluenceSearchPages']);
  });

  it('keys sessions by token — a different token gets its own handshake', async () => {
    const { counts, fetchMock } = stubServer();
    vi.stubGlobal('fetch', fetchMock);
    const a = await getMcpSession(URL_A, 'tok-one');
    const b = await getMcpSession(URL_A, 'tok-two');
    expect(a).not.toBe(b);
    expect(counts.initialize).toBe(2);
  });

  it('does not cache a failed handshake — the next call retries', async () => {
    const { counts, fetchMock } = stubServer({ failFirstInit: true });
    vi.stubGlobal('fetch', fetchMock);
    const token = 'tok-retry';
    await expect(getMcpSession(URL_A, token)).rejects.toThrow(/initialize failed/);
    const session = await getMcpSession(URL_A, token);
    expect(session.tools).toHaveLength(2);
    expect(counts.initialize).toBe(2);
  });

  it('invalidateMcpSession forces a fresh handshake', async () => {
    const { counts, fetchMock } = stubServer();
    vi.stubGlobal('fetch', fetchMock);
    const token = 'tok-invalidate';
    const a = await getMcpSession(URL_A, token);
    invalidateMcpSession(URL_A, token);
    const b = await getMcpSession(URL_A, token);
    expect(a).not.toBe(b);
    expect(counts.initialize).toBe(2);
  });
});
