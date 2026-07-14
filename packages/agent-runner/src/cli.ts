// `pnpm agents:start --quiz <id>` (BRIEF §B3 S4.2) — the local runner. Boots the
// registry (agents/*), keeps only the agents that are valid AND whose provider
// key is present, and runs each in a live quiz under its own supervisor: one
// agent failing to start never stops the others (§B2.7 — Fluid gives error
// isolation in prod; here a per-agent try/catch does the same locally).
//
// The same module runs on Vercel behind /api/agent-host in S4.4; this CLI is the
// dev entrypoint. Verify against real Ably per the S4.2 instructions.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { loadRegistry, type LoadedAgent } from './registry';
import { runLiveAgent, type LiveAgent } from './live-agent';

// Paths relative to this file (packages/agent-runner/src/cli.ts).
const REPO_ROOT = new URL('../../../', import.meta.url);
const AGENTS_DIR = fileURLToPath(new URL('agents/', REPO_ROOT));
const ENV_LOCAL = fileURLToPath(new URL('.env.local', REPO_ROOT));
// The shared digest is curated at S4.3; injected when present (§B2.7 step 4).
const DIGEST_PATH = fileURLToPath(new URL('../../core/src/ably-digest.md', import.meta.url));

async function main(): Promise<void> {
  loadEnv({ path: ENV_LOCAL });

  const { values } = parseArgs({
    options: {
      quiz: { type: 'string' },
      agent: { type: 'string' }, // optional: run just one slug
      base: { type: 'string' }, // /api/ably-auth origin
    },
  });

  const quizId = values.quiz;
  if (!quizId) {
    console.error('usage: pnpm agents:start --quiz <id> [--agent <slug>] [--base <url>]');
    process.exit(1);
  }
  // The web dev server is NOT on :3000 (the artefacts project holds it) — pass
  // --base or AUTH_BASE_URL with the port `pnpm dev` printed.
  const authBaseUrl = (values.base ?? process.env.AUTH_BASE_URL ?? 'http://127.0.0.1:3000').replace(
    /\/$/,
    '',
  );

  const digest = await readOptional(DIGEST_PATH);
  const registry = await loadRegistry(AGENTS_DIR);
  for (const e of registry.errors) console.warn(`skip ${e.slug}: ${e.error}`);

  let candidates = registry.agents;
  if (values.agent) candidates = candidates.filter((a) => a.manifest.slug === values.agent);
  if (candidates.length === 0) {
    console.error(values.agent ? `no valid agent "${values.agent}"` : 'no valid agents found');
    process.exit(1);
  }

  // All agents answer through the Vercel AI Gateway (one key, unified billing).
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('AI_GATEWAY_API_KEY not set — agents run through the Vercel AI Gateway.');
    process.exit(1);
  }
  const runnable = candidates;

  console.log(
    `agents:start quiz=${quizId} base=${authBaseUrl} — ${runnable.length} agent(s): ` +
      runnable.map((a) => a.manifest.slug).join(', '),
  );
  if (!digest) console.log('note: no shared digest yet (packages/core/src/ably-digest.md, S4.3)');

  // Start each agent under its own supervisor — one failing to connect must not
  // take down the others (§B2.7 step 3).
  const started = await Promise.all(
    runnable.map((a) => startSupervised(a, { quizId, authBaseUrl, digest })),
  );
  const live = started.filter((a): a is LiveAgent => a !== null);
  if (live.length === 0) {
    console.error('no agents connected');
    process.exit(1);
  }
  console.log(`${live.length}/${runnable.length} agent(s) live — Ctrl-C to stop`);

  await untilSigint();
  console.log('\nstopping agents…');
  await Promise.all(live.map((a) => a.close().catch(() => undefined)));
  process.exit(0);
}

async function startSupervised(
  a: LoadedAgent,
  opts: { quizId: string; authBaseUrl: string; digest?: string },
): Promise<LiveAgent | null> {
  try {
    return await runLiveAgent({
      quizId: opts.quizId,
      agent: a.manifest,
      authBaseUrl: opts.authBaseUrl,
      digest: opts.digest,
      crib: a.crib,
    });
  } catch (err) {
    console.error(
      `agent ${a.manifest.slug} failed to start:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

function untilSigint(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
}

// A stray rejection must not crash the runner and take every co-hosted agent
// down with it (§B2.7 isolation). The per-agent supervisors + close() paths
// handle real failures; this is the backstop — log and keep the others alive.
process.on('unhandledRejection', (reason) => {
  console.error(
    'unhandledRejection (kept alive):',
    reason instanceof Error ? reason.message : reason,
  );
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
