// `pnpm agents:study [--agent <slug>]` (BRIEF §B3 S4.3). Runs each agent's named
// pre-learning strategy and commits the result to `agents/<slug>/crib.md`. An
// agent opts in via `"study": "<strategy>"` in its agent.json; agents without one
// are skipped (default study = none). Run locally before quiz day — the cribs are
// committed so every agent's cram sheet is public. Custom per-agent code studies
// (agent.ts) arrive with the S4.7 dev kit.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { loadAgentModules } from './agent-loader';
import { authorizeMcp } from './mcp-oauth';
import { streamAnswer } from './providers';
import { loadRegistry } from './registry';
import { ablyDocsStudy, ablyMcpStudy, type StudyContext, type StudyFn } from './study';

const REPO_ROOT = new URL('../../../', import.meta.url);
const ENV_LOCAL = fileURLToPath(new URL('.env.local', REPO_ROOT));
const AGENTS_DIR = fileURLToPath(new URL('agents/', REPO_ROOT));
const DIGEST_PATH = fileURLToPath(new URL('../../core/src/ably-digest.md', import.meta.url));

/** Named study strategies an agent.json can select via `"study"`. */
const STRATEGIES: Record<string, StudyFn> = {
  'ably-docs': ablyDocsStudy,
  'ably-mcp': ablyMcpStudy,
};

// MCP-grounded study wiring (§S6.3). Runs locally under your MCP token; the
// connector is an Anthropic-Messages feature (like answer-time grounding), so it
// goes direct to Anthropic, not the gateway. A strong model is worth it — study
// runs rarely and offline.
const MCP_STUDY_MODEL = 'claude-opus-4-8';
const MCP_STUDY_SYSTEM =
  'You are a meticulous researcher assembling a quiz crib. Ground every claim in the read-only knowledge tools you can call; never invent facts.';

/** Read-only tools the study model may call — from ABLY_MCP_TOOLS (comma-separated). */
function mcpStudyTools(): string[] {
  return (process.env.ABLY_MCP_TOOLS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The MCP connector endpoint (the `/mcp` URL) from ABLY_MCP_URL — no default;
 *  unset ⇒ MCP study is unavailable and those agents skip gracefully. */
function mcpEndpoint(): string | undefined {
  return process.env.ABLY_MCP_URL;
}
/** The OAuth base origin (endpoints hang off it), or undefined when unconfigured. */
function mcpOAuthBase(): string | undefined {
  const url = mcpEndpoint();
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** A bound `research` hook — grounds one study call through the MCP connector.
 *  Only built once a token is obtained, which requires ABLY_MCP_URL. */
function makeResearch(token: string): NonNullable<StudyContext['research']> {
  const url = mcpEndpoint();
  if (!url) throw new Error('ABLY_MCP_URL is not set'); // guarded by obtainMcpToken
  return async (instruction: string) => {
    const res = await streamAnswer({
      provider: 'anthropic',
      model: MCP_STUDY_MODEL,
      system: MCP_STUDY_SYSTEM,
      user: instruction,
      // Shared budget for tool-use narration AND the 250–500-word crib — give it
      // headroom so a chatty research turn can't truncate the crib mid-content.
      maxTokens: 3000,
      mcp: { url, authorizationToken: token, allowedTools: mcpStudyTools() },
    });
    return res.text;
  };
}

/**
 * Obtain an MCP access token for the run. Prefers a pre-set `ABLY_MCP_AUTH`
 * (handy for CI); otherwise runs the interactive OAuth flow — prints a link, the
 * user signs in through Okta, we catch the loopback callback. Returns null (so
 * the caller skips MCP study gracefully) when there's no TTY or auth fails.
 */
async function obtainMcpToken(): Promise<string | null> {
  if (!mcpEndpoint()) {
    console.log('  ably-mcp study needs an MCP server — set ABLY_MCP_URL. Skipping.');
    return null;
  }
  const preset = process.env.ABLY_MCP_AUTH;
  if (preset) return preset;
  if (!process.stdin.isTTY) {
    console.log(
      '  MCP study needs interactive OAuth (set ABLY_MCP_AUTH for CI) — no TTY, skipping.',
    );
    return null;
  }
  const base = mcpOAuthBase();
  if (!base) {
    console.log('  ABLY_MCP_URL is not a valid URL — skipping MCP study.');
    return null;
  }
  console.log('\n🔐 Authenticate with your MCP server so agents can study (read-only, ~1h token):');
  try {
    const { accessToken, expiresIn } = await authorizeMcp({
      base,
      onAuthorizeUrl: (url) => {
        console.log('\n   Open this link in your browser and sign in:\n');
        console.log(`   ${url}\n`);
        console.log('   Waiting for you to finish… (Ctrl-C to cancel)');
      },
    });
    console.log(`✓ Authenticated — token valid ~${Math.round(expiresIn / 60)} min.\n`);
    return accessToken;
  } catch (err) {
    console.warn(
      `  OAuth failed — ${err instanceof Error ? err.message : err}. Skipping MCP study.`,
    );
    return null;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { agent: { type: 'string' } } });

  loadEnv({ path: ENV_LOCAL });
  const digest = (await readOptional(DIGEST_PATH)) ?? '';
  const modules = await loadAgentModules(AGENTS_DIR);
  const { agents, errors } = await loadRegistry(AGENTS_DIR, { modules });
  for (const e of errors) console.warn(`skip ${e.slug}: ${e.error}`);

  const chosen = values.agent ? agents.filter((a) => a.manifest.slug === values.agent) : agents;
  if (chosen.length === 0) {
    console.error(values.agent ? `no valid agent "${values.agent}"` : 'no valid agents found');
    process.exit(1);
  }

  // Resolve each agent's study: a custom `study` from its agent.ts wins; else the
  // named strategy in agent.json; else nothing. (agent.ts hooks were attached by
  // loadRegistry via the modules we imported above.)
  const resolved = chosen.map((a) => {
    if (a.study) return { a, study: a.study, source: 'agent.ts' };
    const named = a.manifest.study;
    const strat = named ? STRATEGIES[named] : undefined;
    return { a, study: strat, source: named ?? 'none' };
  });

  // Authenticate ONCE up front, and only if an in-scope agent actually resolves to
  // the MCP study — the whole roster shares one token. Missing ANTHROPIC_API_KEY
  // (the connector) or a declined/failed sign-in ⇒ those agents skip gracefully.
  let research: StudyContext['research'];
  const needsMcp = resolved.some((r) => r.study === ablyMcpStudy);
  if (needsMcp) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log(
        '  ably-mcp study needs ANTHROPIC_API_KEY (the MCP connector) — skipping those agents.',
      );
    } else {
      const token = await obtainMcpToken();
      if (token) research = makeResearch(token);
    }
  }

  let wrote = 0;
  for (const { a, study, source } of resolved) {
    const slug = a.manifest.slug;
    if (!study) {
      const why = a.manifest.study ? `unknown strategy "${a.manifest.study}"` : 'no study strategy';
      console.log(`${slug}: ${why} — skipped`);
      continue;
    }
    // MCP study needs an authenticated session; without one, skip (keeping the
    // existing crib) rather than fail — matches "missing cred → skip gracefully".
    if (study === ablyMcpStudy && !research) {
      console.log(`${slug}: ably-mcp study skipped — not authenticated`);
      continue;
    }
    const ctx: StudyContext = { agent: a.manifest, digest, fetchText, research };
    try {
      const crib = await study(ctx);
      await writeFile(join(a.dir, 'crib.md'), crib.endsWith('\n') ? crib : `${crib}\n`, 'utf8');
      console.log(`${slug}: wrote crib.md via ${source} (${crib.length} chars)`);
      wrote += 1;
    } catch (err) {
      console.error(`${slug}: study failed — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`done — ${wrote}/${chosen.length} crib(s) written`);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
