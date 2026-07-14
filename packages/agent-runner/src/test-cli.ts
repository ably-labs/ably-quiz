// `pnpm agent:test <slug>` — the local dev harness (BRIEF §B3 S4.7). Runs an
// agent against fixture questions (all three bands) with a REAL model call and
// ZERO Ably setup — only the agent's own provider key is needed. Streams the
// thinking live, then prints per-question answer/correct/latency/score and a
// total vs the committed baseline ("the house"). Schema validation ALWAYS runs;
// the model run is skipped (CI-safe) when the provider key is absent — the same
// harness is the CI check for agents/* PRs (S6.4).
//
// `--save-baseline` rewrites the committed baseline from this run.

import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { getAlgo, scoreQuestion } from '@ably-quiz/core';
import { loadRegistry } from './registry';
import { answerQuestion } from './runner';
import type { Provider, Question } from './schema';

const REPO_ROOT = new URL('../../../', import.meta.url);
const AGENTS_DIR = fileURLToPath(new URL('agents/', REPO_ROOT));
const ENV_LOCAL = fileURLToPath(new URL('.env.local', REPO_ROOT));
const DIGEST_PATH = fileURLToPath(new URL('../core/src/ably-digest.md', import.meta.url));
const FIXTURES_PATH = fileURLToPath(new URL('../fixtures/questions.json', import.meta.url));
const BASELINE_PATH = fileURLToPath(new URL('../fixtures/baseline.json', import.meta.url));

const LETTERS = ['A', 'B', 'C', 'D'] as const;
const LIMIT_MS = 20_000;
const ALGO = getAlgo('classic')!;

const PROVIDER_KEY: Partial<Record<Provider, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
};

type Fixture = {
  band: string;
  category?: string;
  prompt: string;
  options: string[];
  correct: number;
};
type Baseline = { agent: string; total: number; correct: number; count: number };

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function main(): Promise<void> {
  loadEnv({ path: ENV_LOCAL });
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      agent: { type: 'string' },
      'save-baseline': { type: 'boolean' },
    },
  });
  const slug = values.agent ?? positionals[0];
  if (!slug) {
    console.error('usage: pnpm agent:test <slug> [--save-baseline]');
    process.exit(1);
  }

  // Schema validation always (this is the CI gate for agents/* PRs, S6.4).
  const registry = await loadRegistry(AGENTS_DIR);
  const invalid = registry.errors.find((e) => e.slug === slug);
  if (invalid) {
    console.error(red(`✗ ${slug}: invalid agent.json — ${invalid.error}`));
    process.exit(1);
  }
  const agent = registry.agents.find((a) => a.manifest.slug === slug);
  if (!agent) {
    console.error(red(`✗ no agent "${slug}" found under agents/`));
    process.exit(1);
  }
  console.log(
    green(`✓ ${slug} manifest valid`) +
      dim(`  (${agent.manifest.model} · ${agent.manifest.provider})`),
  );

  // Model run only when the agent's provider key is present (else CI-safe exit).
  const keyName = PROVIDER_KEY[agent.manifest.provider];
  if (!keyName || !process.env[keyName]) {
    console.log(
      dim(`\n${keyName ?? agent.manifest.provider} not set — schema-validated only (no model run).`),
    );
    process.exit(0);
  }

  const [digest, fixturesRaw] = await Promise.all([
    readFile(DIGEST_PATH, 'utf8').catch(() => undefined),
    readFile(FIXTURES_PATH, 'utf8'),
  ]);
  const fixtures = JSON.parse(fixturesRaw) as Fixture[];

  console.log(bold(`\nRunning ${fixtures.length} fixture questions (classic scoring)…\n`));
  let total = 0;
  let correctCount = 0;
  let streak = 0;
  let totalMs = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!;
    const question: Question = {
      idx: i,
      prompt: f.prompt,
      options: f.options,
      limitMs: LIMIT_MS,
      category: f.category,
    };
    const correctLetter = LETTERS[f.correct]!;

    process.stdout.write(dim(`Q${i + 1} [${f.band}] ${f.prompt}\n  `));
    // A model/key error on one question scores 0 and moves on — never crashes
    // the builder's whole run.
    const outcome = await answerQuestion(agent.manifest, question, {
      digest,
      crib: agent.crib,
      onThinking: (delta) => process.stdout.write(dim(delta)),
    }).catch((e: unknown) => {
      process.stdout.write(red(` (error: ${e instanceof Error ? e.message : String(e)})`));
      return null;
    });
    process.stdout.write('\n');

    const correct = outcome?.choice === correctLetter;
    if (correct) {
      correctCount++;
      streak++;
    } else {
      streak = 0;
    }
    const elapsedMs = outcome?.answerMs ?? LIMIT_MS;
    const pts = scoreQuestion(ALGO, { correct, elapsedMs, limitMs: LIMIT_MS, streak }, false);
    total += pts;
    totalMs += elapsedMs;

    const mark = correct ? green('✓') : red('✗');
    console.log(
      `  → ${outcome?.choice ?? '—'} ${mark} (correct ${correctLetter})  ` +
        `${(elapsedMs / 1000).toFixed(1)}s  ${bold(`+${pts}`)}\n`,
    );
  }

  console.log(bold('─'.repeat(48)));
  console.log(
    bold(
      `${slug}: ${correctCount}/${fixtures.length} correct · ${total} pts · ` +
        `avg ${(totalMs / fixtures.length / 1000).toFixed(1)}s`,
    ),
  );

  if (values['save-baseline']) {
    const b: Baseline = { agent: slug, total, correct: correctCount, count: fixtures.length };
    await writeFile(BASELINE_PATH, `${JSON.stringify(b, null, 2)}\n`);
    console.log(green(`\n✓ saved baseline (${slug}: ${total} pts)`));
    return;
  }
  const baseline = await readFile(BASELINE_PATH, 'utf8')
    .then((r) => JSON.parse(r) as Baseline)
    .catch(() => null);
  if (baseline) {
    const delta = total - baseline.total;
    console.log(
      dim(`vs the house (${baseline.agent}, ${baseline.total} pts): `) +
        (delta >= 0 ? green(`you're ahead by ${delta} 🎉`) : red(`${-delta} behind`)),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
