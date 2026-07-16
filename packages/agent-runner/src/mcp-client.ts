// Minimal Streamable-HTTP MCP client (§S6.7). JSON-RPC over POST, handling both
// JSON and SSE responses plus the session id. This is the client the grounded
// answer path drives DIRECTLY: Anthropic's `mcp_servers` connector adds ~5s per
// tool call and stalls up to 300s, whereas the server itself answers in
// ~100-300ms — so we run the tool loop ourselves and call tools through here.
// (Measured 2026-07-16 via `pnpm agents:debug-grounding --direct`.)

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpCallResult = { ms: number; status: number; result?: unknown; error?: unknown };

/** Per-call options. A per-call `signal` overrides the client-level one, so a
 *  SHARED session (§S6.9) can serve many turns, each with its own deadline. */
export type McpCallOpts = { signal?: AbortSignal };

export type McpClient = {
  /** Handshake (initialize + notifications/initialized). ~4s on a cold worker. */
  initialize(opts?: McpCallOpts): Promise<{ ms: number; status: number; error?: unknown }>;
  listTools(opts?: McpCallOpts): Promise<{ ms: number; tools: McpTool[] }>;
  callTool(name: string, args: unknown, opts?: McpCallOpts): Promise<McpCallResult>;
};

/** Pull the text out of an MCP tool result's `content` array (or string). */
export function mcpResultText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c as { text?: string })?.text ?? '').join('');
  }
  return '';
}

/** Parse a JSON-RPC response that may be plain JSON or an SSE `data:` stream. */
export function parseJsonRpc(
  text: string,
  contentType: string,
  id: number,
): { result?: unknown; error?: unknown } {
  if (contentType.includes('text/event-stream')) {
    const msgs = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => {
        try {
          return JSON.parse(l.slice(5).trim()) as {
            id?: number;
            result?: unknown;
            error?: unknown;
          };
        } catch {
          return null;
        }
      })
      .filter((m): m is { id?: number; result?: unknown; error?: unknown } => Boolean(m));
    return msgs.find((m) => m.id === id) ?? msgs.at(-1) ?? {};
  }
  try {
    return JSON.parse(text) as { result?: unknown; error?: unknown };
  } catch {
    return {};
  }
}

/** A read-only MCP client over Streamable HTTP. `signal` aborts in-flight calls
 *  (the answer path's deadline). The bearer token is never logged. */
export function makeMcpClient(
  mcpUrl: string,
  token: string,
  opts: { signal?: AbortSignal } = {},
): McpClient {
  let sessionId: string | undefined;
  let id = 0;
  const rpc = async (
    method: string,
    params: unknown,
    notify = false,
    callOpts: McpCallOpts = {},
  ): Promise<McpCallResult> => {
    const reqId = notify ? 0 : ++id;
    const t = Date.now();
    const signal = callOpts.signal ?? opts.signal;
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: reqId }), method, params }),
      ...(signal ? { signal } : {}),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    const ms = Date.now() - t;
    if (notify) return { ms, status: res.status };
    const parsed = parseJsonRpc(await res.text(), res.headers.get('content-type') ?? '', reqId);
    return { ms, status: res.status, result: parsed.result, error: parsed.error };
  };
  return {
    async initialize(callOpts) {
      const t = Date.now();
      const r = await rpc(
        'initialize',
        {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'ably-quiz', version: '0.0.0' },
        },
        false,
        callOpts,
      );
      if (!r.error && r.status < 400) await rpc('notifications/initialized', {}, true, callOpts);
      return { ms: Date.now() - t, status: r.status, error: r.error };
    },
    async listTools(callOpts) {
      const r = await rpc('tools/list', {}, false, callOpts);
      return { ms: r.ms, tools: (r.result as { tools?: McpTool[] })?.tools ?? [] };
    },
    callTool(name, args, callOpts) {
      return rpc('tools/call', { name, arguments: args }, false, callOpts);
    },
  };
}
