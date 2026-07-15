// `pnpm agents:debug-grounding ["a question"]` — the MCP grounding debugger.
//
// Authenticates to your MCP server ONCE, then runs two grounded Anthropic turns
// and dumps EVERYTHING: what tools the connector actually exposes to the model,
// whether the model calls any of them, the raw tool_use/tool_result blocks, the
// stop reason, and timing. This is the answer to "are the agents actually using
// MCP?" — no quiz UI, no full run. Uses the SAME connector shape as a live turn
// (streamAnthropicGrounded), so what you see here is what the quiz does.
//
// Probe 1 ("What tools do you have?") reveals the server's tool surface — e.g. a
// `callTool` dispatcher vs. individual tools. Probe 2 runs a real question and
// tells the model to look it up, so you can see if it CAN and DOES.

import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { authorizeMcp } from './mcp-oauth';

const REPO_ROOT = new URL('../../../', import.meta.url);
const ENV_LOCAL = fileURLToPath(new URL('.env.local', REPO_ROOT));
const ANTHROPIC_MCP_BETA = 'mcp-client-2025-04-04';
const MODEL = process.env.DEBUG_GROUNDING_MODEL ?? 'claude-sonnet-5';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function allowedTools(): string[] {
  return (process.env.ABLY_MCP_TOOLS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
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

function summarizeToolCalls(content: Block[]): void {
  const uses = content.filter((b) => b.type === 'mcp_tool_use');
  const results = new Map(
    content.filter((b) => b.type === 'mcp_tool_result').map((b) => [b.tool_use_id, b]),
  );
  console.log(`  content blocks: ${content.map((b) => b.type).join(', ') || '(none)'}`);
  console.log(
    `  ${bold('tool calls made: ' + (uses.length === 0 ? red('0') : green(String(uses.length))))}`,
  );
  for (const u of uses) {
    console.log(`    → ${green(u.name ?? '?')}  ${dim(JSON.stringify(u.input).slice(0, 200))}`);
    const r = u.id ? results.get(u.id) : undefined;
    if (r) {
      const text = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
      console.log(`      result${r.is_error ? red(' (ERROR)') : ''}: ${dim(text.slice(0, 300))}`);
    }
  }
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
  try {
    // Stream with a long timeout: a real dispatcher call (search → execute
    // against live backends) can take far longer than a plain completion, and a
    // non-streaming request just times out before we see the tool calls. Print
    // each tool call the moment it lands, with how long it took — that latency
    // is the whole question (does grounding fit the quiz's ~18s deadline?).
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
      { timeout: 240_000 },
    );
    stream.on('streamEvent', (e) => {
      if (e.type === 'content_block_start' && e.content_block.type === 'mcp_tool_use') {
        console.log(
          `    ${dim(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`)} calling ${green(e.content_block.name)}…`,
        );
      }
    });
    const msg = await stream.finalMessage();
    const ms = Date.now() - t0;
    console.log(`  ${dim(`took ${(ms / 1000).toFixed(1)}s · stop_reason=${msg.stop_reason}`)}`);
    summarizeToolCalls(msg.content as Block[]);
    const text = (msg.content as Block[])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (text.trim()) console.log(`  ${dim('text:')} ${text.trim().slice(0, 500)}`);
  } catch (err) {
    console.log(`  ${red('request failed:')} ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  loadEnv({ path: ENV_LOCAL });
  const url = process.env.ABLY_MCP_URL;
  if (!url) {
    console.error(red('ABLY_MCP_URL is not set — nothing to debug.'));
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(red('ANTHROPIC_API_KEY is not set (the MCP connector needs it).'));
    process.exit(1);
  }
  const tools = allowedTools();
  const question = process.argv[2] ?? 'What is Ably PSDR22 about?';

  console.log(bold('\nMCP grounding debug'));
  console.log(`  model:           ${MODEL}   ${dim('(override with DEBUG_GROUNDING_MODEL)')}`);
  console.log(`  ABLY_MCP_URL:    ${url}`);
  console.log(
    `  ABLY_MCP_TOOLS:  ${tools.length ? `${tools.length} tools → tool_configuration.allowed_tools` : dim('(unset → tool_configuration omitted; all server tools)')}`,
  );

  let token = process.env.ABLY_MCP_AUTH;
  if (!token) {
    const base = new URL(url).origin;
    console.log(bold('\n🔐 Sign in so the debug turns can use your MCP server (read-only, ~1h):'));
    const { accessToken } = await authorizeMcp({
      base,
      onAuthorizeUrl: (u) => {
        console.log('\n   Open this in your browser and sign in:\n');
        console.log(`   ${u}\n`);
        console.log('   Waiting for you to finish… (Ctrl-C to cancel)');
      },
    });
    token = accessToken;
    console.log(green('✓ authenticated\n'));
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Probe 1 — what does the connector actually expose to the model?
  await runProbe(
    client,
    url,
    token,
    tools,
    'Probe 1 · tool inventory',
    'List the tools you can call. For each, give its exact name and a one-line description. Do not call any tool — just enumerate what is available to you.',
    'What tools do you have available to you right now? List every one by its exact name.',
  );

  // Probe 2 — a real question, told firmly to look it up. Measures how long the
  // full dispatcher path (search → execute against live backends) actually takes.
  await runProbe(
    client,
    url,
    token,
    tools,
    'Probe 2 · forced lookup (full dispatcher)',
    'You are answering a question about the user’s company. You have read-only knowledge-lookup tools available over MCP. You almost certainly do NOT know this from memory, so you MUST call a tool to look it up before answering — do not guess. If your only tool is a dispatcher (e.g. `callAblyTool` / `searchAblyTools`), use it with the appropriate underlying tool name and query.',
    question,
  );

  // Probe 3 — force ONLY the fast, curated context-pack tools (no slow live-system
  // dispatcher), to see whether deadline-friendly grounding is viable for the quiz.
  await runProbe(
    client,
    url,
    token,
    ['getAutomaticContext', 'getContextDetail'],
    'Probe 3 · fast context packs only (no slow dispatcher)',
    'You have two fast tools: `getAutomaticContext` (returns a ranked list of relevant context-pack ids) and `getContextDetail` (loads one pack’s full content by id). Call getAutomaticContext, then getContextDetail on the most relevant pack, then answer. Do not use any other tool.',
    question,
  );

  console.log(bold('\n── read of the above ──'));
  console.log(dim('• Probe 1: the server’s real tool surface (it’s a search+dispatch pattern).'));
  console.log(dim('• Probe 2: how long a full lookup takes. If it’s ≫18s, it can’t run live in a'));
  console.log(
    dim('  quiz turn — deep MCP research belongs at STUDY time (crib), not answer time.'),
  );
  console.log(
    dim('• Probe 3: whether the fast `getContext` primer fits a live deadline (a few s).'),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
