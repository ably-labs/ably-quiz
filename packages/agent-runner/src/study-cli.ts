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
import { loadRegistry } from './registry';
import { ablyDocsStudy, type StudyContext, type StudyFn } from './study';

const REPO_ROOT = new URL('../../../', import.meta.url);
const AGENTS_DIR = fileURLToPath(new URL('agents/', REPO_ROOT));
const DIGEST_PATH = fileURLToPath(new URL('../../core/src/ably-digest.md', import.meta.url));

/** Named study strategies an agent.json can select via `"study"`. */
const STRATEGIES: Record<string, StudyFn> = {
  'ably-docs': ablyDocsStudy,
};

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { agent: { type: 'string' } } });

  const digest = (await readOptional(DIGEST_PATH)) ?? '';
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
    const ctx: StudyContext = { agent: a.manifest, digest, fetchText };
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
