// `pnpm agents:debug-grounding ["a question"]` — the MCP grounding debugger.
//
// Runs grounded Anthropic turns against the MCP server and dumps everything: the
// tools the connector exposes, whether the model calls them, the raw tool_use /
// tool_result blocks, and — the point of this tool — the PER-TOOL latency of each
// call. Uses the SAME connector shape as a live quiz turn.
//
// Two conveniences so it's iterable:
//   • Token cache — authenticate ONCE; the token is cached (gitignored) and reused
//     until it expires, so repeat runs skip the browser sign-in.
//   • Endpoint — targets the NATIVE MCP surface (`/mcp?mode=full`, Streamable
//     HTTP), which exposes the real tools directly. Override with DEBUG_GROUNDING_URL.
//
// Modes: `<question>` runs connector probes; `--tools` dumps the tool inventory
// the model sees; `--direct` hits the server with raw JSON-RPC (no Anthropic
// connector) to measure true per-tool latency + the authoritative tools/list.

import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { config as loadEnv } from 'dotenv';
import { authorizeMcp, refreshMcpToken, type OAuthResult } from './mcp-oauth';

const REPO_ROOT = new URL('../../../', import.meta.url);
const ENV_LOCAL = fileURLToPath(new URL('.env.local', REPO_ROOT));
const CACHE_FILE = fileURLToPath(new URL('.mcp-token-cache.json', REPO_ROOT));
const ANTHROPIC_MCP_BETA = 'mcp-client-2025-04-04';
const MODEL = process.env.DEBUG_GROUNDING_MODEL ?? 'claude-sonnet-5';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function allowedTools(): string[] {
  return (process.env.ABLY_MCP_TOOLS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Native MCP endpoint (mode=full) — real tools, no discovery proxy. Streamable
 *  HTTP (`/mcp`), not SSE — the SSE transport looked like it was adding latency. */
function connectorUrl(rawUrl: string): string {
  if (process.env.DEBUG_GROUNDING_URL) return process.env.DEBUG_GROUNDING_URL;
  const u = new URL('/mcp', new URL(rawUrl).origin);
  u.searchParams.set('mode', 'full');
  return u.toString();
}

// --- token cache (gitignored; read-only MCP token + refresh material) --------
// Access tokens are short (~1h), so we also store the refresh token and mint a
// fresh access token silently — "auth once, test for hours".
type TokenCache = {
  base: string;
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  clientId?: string;
  tokenEndpoint?: string;
};
function readCache(): TokenCache | null {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as TokenCache;
  } catch {
    return null;
  }
}
function writeCache(c: TokenCache): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(c), { mode: 0o600 });
    chmodSync(CACHE_FILE, 0o600);
  } catch (err) {
    console.warn(dim(`(could not cache token: ${err instanceof Error ? err.message : err})`));
  }
}
function cacheFrom(base: string, r: OAuthResult): TokenCache {
  return {
    base,
    accessToken: r.accessToken,
    expiresAt: Date.now() + r.expiresIn * 1000,
    ...(r.refreshToken ? { refreshToken: r.refreshToken } : {}),
    clientId: r.clientId,
    tokenEndpoint: r.tokenEndpoint,
  };
}

type Block = {
  type?: string;
  id?: string;
  tool_use_id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
  text?: string;
};

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((c) => (c as { text?: string })?.text ?? '').join('');
  return JSON.stringify(content ?? '');
}

async function runProbe(
  client: Anthropic,
  url: string,
  token: string,
  tools: string[],
  label: string,
  system: string,
  user: string,
  maxTokens = 1024,
): Promise<void> {
  console.log(`\n${bold('══ ' + label + ' ══')}`);
  console.log(dim(`user: ${user}`));
  if (tools.length) console.log(dim(`allowed_tools: ${tools.join(', ')}`));
  const t0 = Date.now();
  // Per-tool latency: remember when each tool_use started, measure to its result.
  const started = new Map<string, { name: string; ms: number }>();
  const latencies: { name: string; ms: number; error: boolean }[] = [];
  try {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        betas: [ANTHROPIC_MCP_BETA],
        mcp_servers: [
          {
            type: 'url',
            name: 'knowledge',
            url,
            authorization_token: token,
            ...(tools.length ? { tool_configuration: { allowed_tools: tools } } : {}),
          },
        ],
      },
      { timeout: 600_000 },
    );
    stream.on('streamEvent', (e) => {
      if (e.type !== 'content_block_start') return;
      const cb = e.content_block as unknown as Block;
      if (cb.type === 'mcp_tool_use' && cb.id && cb.name) {
        started.set(cb.id, { name: cb.name, ms: Date.now() });
        console.log(
          `    ${dim(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`)} → ${green(cb.name)}`,
        );
      } else if (cb.type === 'mcp_tool_result' && cb.tool_use_id) {
        const s = started.get(cb.tool_use_id);
        if (s) {
          const took = (Date.now() - s.ms) / 1000;
          const err = Boolean(cb.is_error);
          latencies.push({ name: s.name, ms: Date.now() - s.ms, error: err });
          console.log(
            `      ${dim('←')} ${s.name} ${(err ? red : dim)(`returned in ${took.toFixed(1)}s${err ? ' (ERROR)' : ''}`)}`,
          );
        }
      }
    });
    const msg = await stream.finalMessage();
    const totalS = ((Date.now() - t0) / 1000).toFixed(1);
    const content = msg.content as Block[];
    const uses = content.filter((b) => b.type === 'mcp_tool_use').length;
    console.log(
      `  ${dim(`total ${totalS}s · stop_reason=${msg.stop_reason} · `)}${bold(`${uses} tool call(s)`)}`,
    );
    if (latencies.length) {
      console.log(dim('  per-tool latency:'));
      for (const l of latencies) {
        console.log(
          `    ${l.error ? red('✗') : green('✓')} ${l.name.padEnd(28)} ${(l.ms / 1000).toFixed(1)}s`,
        );
      }
    }
    // Show a peek at the last tool result + the final text.
    const lastResult = content.filter((b) => b.type === 'mcp_tool_result').at(-1);
    if (lastResult)
      console.log(dim(`  last result: ${resultText(lastResult.content).slice(0, 200)}`));
    const text = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (text) console.log(`  ${dim('answer:')} ${text.slice(0, 8000)}`);
  } catch (err) {
    console.log(`  ${red('request failed:')} ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- direct MCP client (raw JSON-RPC, no Anthropic connector in the path) -----
// Times the SERVER's real tool latency in isolation. If this is low-seconds but
// the connector path is slow, the overhead is the Anthropic↔worker transport,
// not the tools. tools/list is also the AUTHORITATIVE tool surface (no model).
function parseJsonRpc(text: string, ct: string, id: number): { result?: unknown; error?: unknown } {
  if (ct.includes('text/event-stream')) {
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

type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };

/** Minimal Streamable-HTTP MCP client — the reusable core behind `--direct` and the
 *  `--loop` client-side tool loop. Handles the session id, JSON/SSE responses, and
 *  per-call timing. This is the client the real answer path would use. */
function makeMcpClient(mcpUrl: string, token: string) {
  let sessionId: string | undefined;
  let id = 0;
  const rpc = async (method: string, params: unknown, notify = false) => {
    const reqId = notify ? 0 : ++id;
    const t = Date.now();
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: reqId }), method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    const ms = Date.now() - t;
    if (notify) return { ms, status: res.status, result: undefined, error: undefined };
    const text = await res.text();
    const parsed = parseJsonRpc(text, res.headers.get('content-type') ?? '', reqId);
    return { ms, status: res.status, result: parsed.result, error: parsed.error };
  };
  return {
    async initialize() {
      const t = Date.now();
      const r = await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'ably-quiz-debug', version: '0.0.0' },
      });
      if (!r.error && r.status < 400) await rpc('notifications/initialized', {}, true);
      return { ms: Date.now() - t, status: r.status, error: r.error };
    },
    async listTools() {
      const r = await rpc('tools/list', {});
      return { ms: r.ms, tools: (r.result as { tools?: McpTool[] })?.tools ?? [] };
    },
    callTool(name: string, args: unknown) {
      return rpc('tools/call', { name, arguments: args });
    },
  };
}

async function directProbe(mcpUrl: string, token: string): Promise<void> {
  console.log(`\n${bold('══ Direct MCP · raw JSON-RPC (no Anthropic connector) ══')}`);
  console.log(dim(`endpoint: ${mcpUrl}`));
  const mcp = makeMcpClient(mcpUrl, token);
  try {
    const init = await mcp.initialize();
    console.log(
      `  initialize   ${bold(String(init.ms) + 'ms').padEnd(8)} status=${init.status} ${init.error ? red(JSON.stringify(init.error).slice(0, 160)) : green('ok')}`,
    );
    if (init.error || init.status >= 400) return console.log(red('  cannot continue.'));
    const list = await mcp.listTools();
    const toolz = list.tools.map((t) => t.name);
    console.log(
      `  tools/list   ${bold(String(list.ms) + 'ms').padEnd(8)} → ${bold(String(toolz.length) + ' tools')}`,
    );
    console.log(
      dim('  ' + (toolz.slice(0, 90).join(', ') || '(none)') + (toolz.length > 90 ? ' …' : '')),
    );
    // Real backend reads (Jira/Confluence/Gong/HubSpot/GitHub) timed directly, with
    // a peek at the RESULT so we can tell real data from a fast empty/error return.
    const calls: { label: string; name: string; args: Record<string, unknown> }[] = [
      { label: 'getToolCategories', name: 'getToolCategories', args: {} },
      {
        label: 'Confluence search',
        name: 'callAblyTool',
        args: { toolName: 'confluenceSearchPages', params: { search_term: 'AI Transport' } },
      },
      {
        label: 'Jira search',
        name: 'callAblyTool',
        args: { toolName: 'jiraSearchIssues', params: { text: 'AI Transport', limit: 3 } },
      },
      {
        label: 'Gong (find tool)',
        name: 'searchAblyTools',
        args: { query: 'gong calls transcripts' },
      },
      {
        label: 'HubSpot (find tool)',
        name: 'searchAblyTools',
        args: { query: 'hubspot deals companies' },
      },
      {
        label: 'GitHub search',
        name: 'callAblyTool',
        args: { toolName: 'githubSearchAblyRepositories', params: { query: 'ably-core-mcp' } },
      },
    ];
    console.log(dim('  backend read latency (direct) + result peek:'));
    for (const c of calls) {
      if (!toolz.includes(c.name)) {
        console.log(dim(`    · ${c.name} not exposed`));
        continue;
      }
      const r = await mcp.callTool(c.name, c.args);
      const txt = resultText((r.result as { content?: unknown })?.content)
        .replace(/\s+/g, ' ')
        .trim();
      console.log(
        `    ${r.error ? red('✗') : green('✓')} ${c.label.padEnd(20)} ${bold((r.ms / 1000).toFixed(1) + 's')}`,
      );
      console.log(dim('       ' + (txt.slice(0, 200) || '(empty)')));
    }
  } catch (err) {
    console.log(red(`  direct probe failed: ${err instanceof Error ? err.message : err}`));
  }
}

// --- client-side MCP tool loop (approach A) ----------------------------------
// The proposed answer-time design: open a direct MCP client, hand the tools to the
// model as ordinary tools, and execute each tool_use OURSELVES (fast, direct) — no
// Anthropic connector. Measures the real end-to-end grounded-turn latency.
async function loopProbe(
  mcpUrl: string,
  token: string,
  question: string,
  allow: string[],
): Promise<void> {
  console.log(`\n${bold('══ Client-side MCP tool loop (approach A) ══')}`);
  console.log(dim(`question: ${question}`));
  const mcp = makeMcpClient(mcpUrl, token);
  const init = await mcp.initialize();
  console.log(
    `  initialize   ${bold(String(init.ms) + 'ms')} ${init.error ? red('ERR') : green('ok')}`,
  );
  if (init.error || init.status >= 400) return;
  const { ms: listMs, tools } = await mcp.listTools();
  const usable = allow.length ? tools.filter((t) => allow.includes(t.name)) : tools;
  console.log(
    `  tools/list   ${bold(String(listMs) + 'ms')} → ${tools.length} tools${allow.length ? ` (using ${usable.length}: ${allow.join(', ')})` : ''}`,
  );
  const anthropicTools = usable.map((t) => ({
    name: t.name,
    description: (t.description ?? '').slice(0, 800),
    input_schema: (t.inputSchema ?? { type: 'object' }) as Anthropic.Tool.InputSchema,
  }));

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system =
    'You are a contestant answering a company quiz question, on a tight timer. Use your knowledge tools to look up the answer before responding — this server is a dispatcher: getAutomaticContext then getContextDetail give a fast primer, or searchAblyTools then callAblyTool to run a specific tool. Keep it to one or two quick lookups, then answer concisely.';
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  const t0 = Date.now();
  let turn = 0;
  while (turn++ < 6) {
    const m0 = Date.now();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
      tools: anthropicTools,
    });
    console.log(
      `  ${dim(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`)} model turn ${turn}: ${bold(((Date.now() - m0) / 1000).toFixed(1) + 's')} ${dim('stop=' + res.stop_reason)}`,
    );
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason !== 'tool_use') {
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      console.log(green(`  ✓ answered in ${((Date.now() - t0) / 1000).toFixed(1)}s`));
      console.log(dim('  answer: ' + text.slice(0, 500)));
      break;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== 'tool_use') continue;
      const r = await mcp.callTool(b.name, b.input);
      const txt = resultText((r.result as { content?: unknown })?.content);
      console.log(
        `      ${green(b.name)} ${dim(JSON.stringify(b.input).slice(0, 80))} → ${bold((r.ms / 1000).toFixed(1) + 's')} ${r.error ? red('ERR') : ''}`,
      );
      results.push({
        type: 'tool_result',
        tool_use_id: b.id,
        content: txt.slice(0, 4000),
        is_error: Boolean(r.error),
      });
    }
    messages.push({ role: 'user', content: results });
  }
  console.log(
    bold(`  ── total: ${((Date.now() - t0) / 1000).toFixed(1)}s over ${turn} model turn(s) ──`),
  );
}

async function main(): Promise<void> {
  loadEnv({ path: ENV_LOCAL });
  const rawUrl = process.env.ABLY_MCP_URL;
  if (!rawUrl) {
    console.error(red('ABLY_MCP_URL is not set — nothing to debug.'));
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(red('ANTHROPIC_API_KEY is not set (the MCP connector needs it).'));
    process.exit(1);
  }
  const tools = allowedTools();
  const arg = process.argv[2];
  const listOnly = arg === '--tools';
  const directOnly = arg === '--direct';
  const loopMode = arg === '--loop';
  const question =
    listOnly || directOnly || loopMode
      ? (process.argv[3] ?? 'What is Ably PSDR22 about?')
      : (arg ?? 'What is Ably PSDR22 about?');
  const oauthBase = new URL(rawUrl).origin;
  const connUrl = connectorUrl(rawUrl);

  console.log(bold('\nMCP grounding debug'));
  console.log(`  model:      ${MODEL}   ${dim('(override with DEBUG_GROUNDING_MODEL)')}`);
  console.log(
    `  connector:  ${connUrl}   ${dim('(native tools; override with DEBUG_GROUNDING_URL)')}`,
  );
  console.log(
    `  allowlist:  ${tools.length ? tools.join(', ') : dim('(none — all native tools exposed)')}`,
  );

  let token = process.env.ABLY_MCP_AUTH ?? null;
  if (token) {
    console.log(green('  auth:       ABLY_MCP_AUTH (preset)'));
  } else {
    const cached = readCache();
    if (cached?.base === oauthBase && cached.expiresAt > Date.now() + 60_000) {
      token = cached.accessToken;
      const mins = Math.round((cached.expiresAt - Date.now()) / 60_000);
      console.log(green(`  auth:       cached token (valid ~${mins} more min) — sign-in skipped`));
    } else if (
      cached?.base === oauthBase &&
      cached.refreshToken &&
      cached.clientId &&
      cached.tokenEndpoint
    ) {
      // Access token expired — mint a fresh one silently from the refresh token.
      try {
        const r = await refreshMcpToken({
          tokenEndpoint: cached.tokenEndpoint,
          clientId: cached.clientId,
          refreshToken: cached.refreshToken,
        });
        token = r.accessToken;
        writeCache(cacheFrom(oauthBase, r));
        console.log(
          green(
            `  auth:       refreshed token silently (valid ~${Math.round(r.expiresIn / 60)} min)`,
          ),
        );
      } catch (err) {
        console.log(
          dim(
            `  auth:       refresh failed (${err instanceof Error ? err.message : err}) — need sign-in`,
          ),
        );
      }
    }
  }
  if (!token) {
    console.log(bold('\n🔐 Sign in once — the token (and its refresh token) are cached:'));
    const r = await authorizeMcp({
      base: oauthBase,
      onAuthorizeUrl: (u) => {
        console.log('\n   Open this in your browser and sign in:\n');
        console.log(`   ${u}\n`);
        console.log('   Waiting for you to finish… (Ctrl-C to cancel)');
      },
    });
    token = r.accessToken;
    writeCache(cacheFrom(oauthBase, r));
    console.log(
      green(
        `✓ authenticated — cached; ${r.refreshToken ? 'refresh token saved (silent re-auth for hours)' : 'no refresh token issued (≈1h only)'}\n`,
      ),
    );
  }

  // `--direct` — measure the SERVER's real latency with no Anthropic connector,
  // and get the authoritative tool surface via tools/list.
  if (directOnly) {
    await directProbe(connUrl, token);
    console.log(
      yellow('\n(direct probe — server latency with NO Anthropic connector in the path)'),
    );
    return;
  }

  // `--loop` — the proposed answer-time design: a client-side tool loop that runs
  // the tools directly. `total` is the real grounded-turn latency to expect.
  if (loopMode) {
    await loopProbe(connUrl, token, question, tools);
    console.log(
      yellow('\n(client-side tool loop = approach A; `total` is the grounded-turn latency)'),
    );
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // `--tools` — dump the FULL exposed tool surface (does mode=full expose native
  // tools, or only the search/dispatch proxy?). One cheap call, no slow lookups.
  if (listOnly) {
    await runProbe(
      client,
      connUrl,
      token,
      tools,
      'Full tool inventory',
      'List EVERY tool you can call. Output ONLY a numbered list of their exact names — no descriptions, no prose. Be exhaustive: include ALL of them, however many. Do NOT call any tool.',
      'List every tool available to you by exact name, one per line. Do not omit any.',
      4096,
    );
    console.log(
      yellow('\n(inventory only — pass a question instead of --tools to run latency probes)'),
    );
    return;
  }

  // Probe 1 — the native tool surface the model sees up front (no discovery).
  await runProbe(
    client,
    connUrl,
    token,
    tools,
    'Probe 1 · tool inventory',
    'List the tools you can call. Give each exact name and a one-line description. Do not call any tool — just enumerate what is available to you.',
    'What tools do you have available to you right now? List every one by its exact name.',
  );

  // Probe 2 — a real lookup, with per-tool latency so we see which reads are slow.
  await runProbe(
    client,
    connUrl,
    token,
    tools,
    'Probe 2 · real lookup (per-tool latency)',
    'You are answering a question about the user’s company. Use your read-only knowledge tools to look it up before answering — do not guess. Prefer a direct search/get over anything heavier.',
    question,
  );

  console.log(bold('\n── read of the above ──'));
  console.log(dim('• Probe 1: the native tools exposed up front — no searchAblyTools round-trip.'));
  console.log(dim('• Probe 2: per-tool latency. A tool ≫ a few seconds can’t run in a live quiz'));
  console.log(dim('  turn (~18s) — that read belongs at STUDY time (crib), not answer time.'));
  console.log(yellow('\nRe-run freely — the token is cached until it expires.'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
