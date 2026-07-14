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

// MCP-grounded study wiring (§S6.3). Runs locally under Matt's MCP token; the
// connector is an Anthropic-Messages feature (like answer-time grounding), so it
// goes direct to Anthropic, not the gateway. A strong model is worth it — study
// runs rarely and offline. Read-only connector tools; the catalog is pre-injected.
const MCP_STUDY_MODEL = 'claude-opus-4-8';
const MCP_STUDY_SYSTEM =
  'You are a meticulous researcher assembling a quiz crib about Ably. Ground every claim in the read-only Ably knowledge tools you can call; never invent facts.';
const MCP_CONNECTOR_TOOLS = ['callTool', 'getContext'] as const;
const DEFAULT_MCP_URL = 'https://your-mcp-server.example.com/mcp';

/** Build the `research` hook when MCP creds are present; else undefined so the
 *  `ably-mcp` strategy is skipped gracefully (never a hard failure). */
function makeResearch(): StudyContext['research'] {
  const token = process.env.ABLY_MCP_AUTH;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!token || !anthropicKey) return undefined;
  const url = process.env.ABLY_MCP_URL || DEFAULT_MCP_URL;
  return async (instruction: string) => {
    const res = await streamAnswer({
      provider: 'anthropic',
      model: MCP_STUDY_MODEL,
      system: MCP_STUDY_SYSTEM,
      user: instruction,
      maxTokens: 2000,
      mcp: { url, authorizationToken: token, allowedTools: MCP_CONNECTOR_TOOLS },
    });
    return res.text;
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { agent: { type: 'string' } } });

  loadEnv({ path: ENV_LOCAL });
  const digest = (await readOptional(DIGEST_PATH)) ?? '';
  const research = makeResearch();
  const { agents, errors } = await loadRegistry(AGENTS_DIR);
  for (const e of errors) console.warn(`skip ${e.slug}: ${e.error}`);

  const chosen = values.agent ? agents.filter((a) => a.manifest.slug === values.agent) : agents;
  if (chosen.length === 0) {
    console.error(values.agent ? `no valid agent "${values.agent}"` : 'no valid agents found');
    process.exit(1);
  }

  let wrote = 0;
  for (const a of chosen) {
    const name = a.manifest.study;
    if (!name) {
      console.log(`${a.manifest.slug}: no study strategy — skipped`);
      continue;
    }
    const study = STRATEGIES[name];
    if (!study) {
      console.warn(`${a.manifest.slug}: unknown study strategy "${name}" — skipped`);
      continue;
    }
    // MCP study needs credentials; without them, skip (keeping the existing crib)
    // rather than fail — matches the "missing key → skip gracefully" rule.
    if (name === 'ably-mcp' && !research) {
      console.log(
        `${a.manifest.slug}: ably-mcp study skipped — no MCP creds (set ABLY_MCP_AUTH + ANTHROPIC_API_KEY)`,
      );
      continue;
    }
    const ctx: StudyContext = { agent: a.manifest, digest, fetchText, research };
    try {
      const crib = await study(ctx);
      await writeFile(join(a.dir, 'crib.md'), crib.endsWith('\n') ? crib : `${crib}\n`, 'utf8');
      console.log(`${a.manifest.slug}: wrote crib.md via "${name}" (${crib.length} chars)`);
      wrote += 1;
    } catch (err) {
      console.error(
        `${a.manifest.slug}: study failed — ${err instanceof Error ? err.message : err}`,
      );
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
