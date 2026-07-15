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
//   • Endpoint — targets the NATIVE MCP surface (`/sse?mode=full`), which exposes
//     the real tools directly (no `searchAblyTools` discovery proxy). Override with
//     DEBUG_GROUNDING_URL.

import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { config as loadEnv } from 'dotenv';
import { authorizeMcp } from './mcp-oauth';

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

/** Native MCP endpoint (mode=full) — real tools, no discovery proxy. */
function connectorUrl(rawUrl: string): string {
  if (process.env.DEBUG_GROUNDING_URL) return process.env.DEBUG_GROUNDING_URL;
  const u = new URL('/sse', new URL(rawUrl).origin);
  u.searchParams.set('mode', 'full');
  return u.toString();
}

// --- token cache (gitignored; a read-only MCP token, never logged) -----------
type TokenCache = { base: string; accessToken: string; expiresAt: number };
function loadCachedToken(base: string): { token: string; expiresAt: number } | null {
  try {
    const c = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as TokenCache;
    if (c.base === base && c.expiresAt > Date.now() + 60_000) {
      return { token: c.accessToken, expiresAt: c.expiresAt };
    }
  } catch {
    /* no / invalid / expired cache */
  }
  return null;
}
function saveCachedToken(base: string, accessToken: string, expiresAt: number): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify({ base, accessToken, expiresAt }), { mode: 0o600 });
    chmodSync(CACHE_FILE, 0o600);
  } catch (err) {
    console.warn(dim(`(could not cache token: ${err instanceof Error ? err.message : err})`));
  }
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
        max_tokens: 1024,
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
    if (text) console.log(`  ${dim('answer:')} ${text.slice(0, 400)}`);
  } catch (err) {
    console.log(`  ${red('request failed:')} ${err instanceof Error ? err.message : String(err)}`);
  }
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
  const question = process.argv[2] ?? 'What is Ably PSDR22 about?';
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
    const cached = loadCachedToken(oauthBase);
    if (cached) {
      token = cached.token;
      const mins = Math.round((cached.expiresAt - Date.now()) / 60_000);
      console.log(green(`  auth:       cached token (valid ~${mins} more min) — sign-in skipped`));
    }
  }
  if (!token) {
    console.log(bold('\n🔐 Sign in once — the token is cached so later runs skip this:'));
    const { accessToken, expiresIn } = await authorizeMcp({
      base: oauthBase,
      onAuthorizeUrl: (u) => {
        console.log('\n   Open this in your browser and sign in:\n');
        console.log(`   ${u}\n`);
        console.log('   Waiting for you to finish… (Ctrl-C to cancel)');
      },
    });
    token = accessToken;
    saveCachedToken(oauthBase, accessToken, Date.now() + expiresIn * 1000);
    console.log(green(`✓ authenticated — cached for ~${Math.round(expiresIn / 60)} min\n`));
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
