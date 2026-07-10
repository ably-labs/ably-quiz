// S0 — Latency spike (GO/NO-GO). Standalone; NO app code, NO Ably key needed.
//
// Measures end-to-end agent answer latency in the real answer shape
// (streamed think-aloud -> strict JSON, BRIEF §B2.7) across the Anthropic quiz
// roster, in both `bare` and `with-digest` variants, over the 12-question set.
//
// Runs only providers whose API key is present; others are skipped and
// recorded. Writes spikes/latency/RESULTS.md with a table + GO/NO-GO verdict
// (BRIEF §B3 S0.1/S0.2). Re-run as more provider keys arrive.
//
//   pnpm --dir spikes/latency install
//   pnpm --dir spikes/latency spike
//
// Env knobs (all optional): SPIKE_RUNS, SPIKE_CONCURRENCY, SPIKE_TEMPERATURE,
// SPIKE_MAX_TOKENS, SPIKE_TIMEOUT_MS, OPENAI_MODEL, XAI_MODEL.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { ABLY_DIGEST, QUESTIONS, type Band, type Question } from './questions.ts';
import {
  MODELS,
  hasKey,
  keyEnvFor,
  streamAnswer,
  type ModelSpec,
  type ProviderId,
} from './providers.ts';

// Secrets live in the repo-root .env.local (gitignored), not in this package.
// Providers read their keys at call time, after this has run.
loadEnv({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)) });

// --- Config -----------------------------------------------------------------
const RUNS = intEnv('SPIKE_RUNS', 3);
const CONCURRENCY = intEnv('SPIKE_CONCURRENCY', 4);
// Undefined by default: newer Claude models reject `temperature`; set
// SPIKE_TEMPERATURE only for providers that accept it.
const TEMPERATURE = optFloatEnv('SPIKE_TEMPERATURE');
const MAX_TOKENS = intEnv('SPIKE_MAX_TOKENS', 400);
const TIMEOUT_MS = intEnv('SPIKE_TIMEOUT_MS', 60_000);

type Variant = 'bare' | 'digest';
const VARIANTS: Variant[] = ['bare', 'digest'];

type RunRecord = {
  modelKey: string;
  provider: ProviderId;
  band: Band;
  variant: Variant;
  questionId: string;
  run: number;
  ok: boolean;
  error?: string;
  ttftMs: number | null;
  answerMs: number | null;
  totalMs: number | null;
  choice: string | null;
  correct: boolean | null;
  confidence: number | null;
  /** For no-answer records only: a truncated sample of what streamed. */
  sampleText?: string;
};

async function main(): Promise<void> {
  const providersInPlay = uniqueProviders(MODELS);
  const runProviders = providersInPlay.filter(hasKey);
  const skippedProviders = providersInPlay.filter((p) => !hasKey(p));
  const runModels = MODELS.filter((m) => hasKey(m.provider));

  console.log('S0 latency spike');
  console.log(
    `  runs=${RUNS} concurrency=${CONCURRENCY} temp=${TEMPERATURE ?? 'provider-default'} maxTokens=${MAX_TOKENS}`,
  );
  console.log(`  providers with key: ${runProviders.join(', ') || '(none)'}`);
  if (skippedProviders.length) {
    console.log(
      `  skipped (no key): ${skippedProviders.map((p) => `${p} [${keyEnvFor(p)}]`).join(', ')}`,
    );
  }
  console.log(`  models to run: ${runModels.map((m) => m.key).join(', ') || '(none)'}`);
  console.log(`  MCP timing: skipped (no ABLY_MCP_URL/ABLY_MCP_AUTH; optional, S6)\n`);

  if (runModels.length === 0) {
    console.error('No provider keys present — nothing to run. Add ANTHROPIC_API_KEY to .env.local.');
    process.exitCode = 1;
    return;
  }

  // Build the task list: model × variant × question × run.
  const tasks: (() => Promise<RunRecord>)[] = [];
  for (const spec of runModels) {
    for (const variant of VARIANTS) {
      for (const q of QUESTIONS) {
        for (let run = 1; run <= RUNS; run++) {
          tasks.push(() => runOne(spec, variant, q, run));
        }
      }
    }
  }

  console.log(`Running ${tasks.length} calls…  ('.' ok / 'x' no-answer / '!' error)`);
  const records = await runPool(tasks, CONCURRENCY, (r) => {
    process.stdout.write(r.error ? '!' : r.ok ? '.' : 'x');
  });
  process.stdout.write('\n\n');

  const md = renderResults({ records, runProviders, skippedProviders, runModels });
  const outPath = new URL('./RESULTS.md', import.meta.url);
  writeFileSync(outPath, md, 'utf8');

  // Console summary (verdict + overall latency).
  const answered = records.filter((r) => r.ok && r.answerMs !== null).map((r) => r.answerMs as number);
  const verdict = decideVerdict(records);
  console.log(summaryLine('overall time-to-answer', answered));
  console.log(`\nVERDICT: ${verdict.label} — ${verdict.reason}`);
  console.log(`Wrote ${new URL('./RESULTS.md', import.meta.url).pathname}`);
}

async function runOne(spec: ModelSpec, variant: Variant, q: Question, run: number): Promise<RunRecord> {
  const base: RunRecord = {
    modelKey: spec.key,
    provider: spec.provider,
    band: q.band,
    variant,
    questionId: q.id,
    run,
    ok: false,
    ttftMs: null,
    answerMs: null,
    totalMs: null,
    choice: null,
    correct: null,
    confidence: null,
  };
  try {
    const res = await streamAnswer({
      spec,
      system: buildSystem(variant === 'digest'),
      user: buildUser(q),
      maxTokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      timeoutMs: TIMEOUT_MS,
    });
    const choice = res.answer?.choice ?? null;
    return {
      ...base,
      ok: res.answer !== null,
      ttftMs: res.ttftMs,
      answerMs: res.answerMs,
      totalMs: res.totalMs,
      choice,
      correct: choice === null ? null : choice === q.answer,
      confidence: res.answer?.confidence ?? null,
      ...(res.answer === null ? { sampleText: truncate(res.text.trim(), 300) } : {}),
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Prompt shaping ---------------------------------------------------------
function buildSystem(withDigest: boolean): string {
  const base = `You are a contestant in a live, timed multiple-choice quiz. Faster correct answers score more points, so be quick but accurate.

Respond in EXACTLY this format and nothing else:
1) One or two short sentences of visible reasoning (your think-aloud), under ~40 words.
2) Then, on a new line, a single JSON object with NO markdown fences and no extra text:
{"choice":"A","confidence":0.72,"quip":"a short playful one-liner"}

Constraints:
- "choice" must be exactly one of "A", "B", "C", or "D".
- "confidence" is your probability of being correct, between 0 and 1.
- "quip" is at most 80 characters.
- Put the reasoning first, then the JSON. Output nothing after the JSON.`;
  if (!withDigest) return base;
  return `${base}

Reference material you have studied (use it when relevant):
${ABLY_DIGEST}`;
}

function buildUser(q: Question): string {
  const [a, b, c, d] = q.options;
  return `Question: ${q.prompt}\nA) ${a}\nB) ${b}\nC) ${c}\nD) ${d}\nTime limit: ${q.timeLimitS} seconds. Answer now.`;
}

// --- Verdict ----------------------------------------------------------------
type Verdict = {
  go: boolean;
  label: 'GO' | 'STOP';
  reason: string;
  windowS: number | null;
  p95: number;
  successRate: number;
};

function decideVerdict(records: RunRecord[]): Verdict {
  const answered = records.filter((r) => r.ok && r.answerMs !== null).map((r) => r.answerMs as number);
  const attempted = records.length;
  const successRate = attempted === 0 ? 0 : answered.length / attempted;
  const p95 = percentile(sortAsc(answered), 95);

  let go: boolean;
  let windowS: number | null;
  let reason: string;
  if (!Number.isFinite(p95)) {
    go = false;
    windowS = null;
    reason = 'no answers produced; investigate before building. Flag Matt.';
  } else if (p95 <= 10_000) {
    go = true;
    windowS = 20;
    reason = `p95 time-to-answer ${fmtMs(p95)} ≤ 10s. Recommend a 20s question window.`;
  } else if (p95 <= 20_000) {
    go = true;
    windowS = 30;
    reason = `p95 time-to-answer ${fmtMs(p95)} ≤ 20s. Recommend a 30s question window.`;
  } else {
    go = false;
    windowS = null;
    reason = `p95 time-to-answer ${fmtMs(p95)} > 20s. Rethink before building. Flag Matt.`;
  }
  if (go && successRate < 0.95) {
    reason += ` ⚠️ Reliability caveat: only ${(successRate * 100).toFixed(1)}% of calls produced a valid answer.`;
  }
  return { go, label: go ? 'GO' : 'STOP', reason, windowS, p95, successRate };
}

// --- Results markdown -------------------------------------------------------
function renderResults(ctx: {
  records: RunRecord[];
  runProviders: ProviderId[];
  skippedProviders: ProviderId[];
  runModels: ModelSpec[];
}): string {
  const { records, runProviders, skippedProviders, runModels } = ctx;
  const verdict = decideVerdict(records);
  const answered = records.filter((r) => r.ok);
  const now = new Date().toISOString();

  const lines: string[] = [];
  lines.push('# S0 — Latency spike results');
  lines.push('');
  lines.push(`_Generated by \`spike.ts\` on ${now}. Re-run as more provider keys arrive._`);
  lines.push('');

  // Verdict up top.
  lines.push('## Verdict');
  lines.push('');
  lines.push(`> **${verdict.label}** — ${verdict.reason}`);
  lines.push('');
  lines.push('Thresholds (BRIEF §B3 S0.2): p95 time-to-answer ≤10s → GO/20s window · ≤20s → GO/30s window · else STOP.');
  lines.push('');

  // Run metadata.
  lines.push('## Run configuration');
  lines.push('');
  lines.push(`- Runs per (model × variant × question): **${RUNS}**`);
  lines.push(`- Concurrency: ${CONCURRENCY} · temperature: ${TEMPERATURE ?? 'provider default'} · maxTokens: ${MAX_TOKENS} · per-call timeout: ${fmtMs(TIMEOUT_MS)}`);
  lines.push(`- Questions: ${QUESTIONS.length} (${countBands()})`);
  lines.push(`- Providers run: ${runProviders.join(', ') || '(none)'}`);
  lines.push(
    `- Providers skipped (no key): ${
      skippedProviders.length ? skippedProviders.map((p) => `${p} \`${keyEnvFor(p)}\``).join(', ') : '(none)'
    }`,
  );
  lines.push(`- Models run: ${runModels.map((m) => `\`${m.model}\` (${m.key})`).join(', ')}`);
  lines.push('- Single-MCP-call timing: **skipped** — no `ABLY_MCP_URL` / `ABLY_MCP_AUTH` (optional; MCP is S6, never on the quiz-day critical path).');
  lines.push('');

  // Overall latency.
  lines.push('## Overall latency (all answered calls)');
  lines.push('');
  lines.push('| metric | p50 | p95 | p99 | max | n |');
  lines.push('|---|--:|--:|--:|--:|--:|');
  lines.push(latencyRow('TTFT', answered.map((r) => r.ttftMs)));
  lines.push(latencyRow('time-to-answer (valid JSON)', answered.map((r) => r.answerMs)));
  lines.push(latencyRow('total stream time', answered.map((r) => r.totalMs)));
  lines.push('');
  const attempts = records.length;
  const ok = answered.length;
  lines.push(`Valid-answer rate: **${((ok / attempts) * 100).toFixed(1)}%** (${ok}/${attempts}).`);
  const errored = records.filter((r) => r.error);
  if (errored.length) {
    lines.push('');
    lines.push(`Errors: ${errored.length}. Sample: \`${truncate(errored[0]?.error ?? '', 160)}\``);
  }
  const noAnswer = records.filter((r) => !r.ok && !r.error);
  if (noAnswer.length) {
    lines.push('');
    lines.push(`No-answer (stream produced no valid JSON): ${noAnswer.length}. Sample output:`);
    lines.push('');
    lines.push('```');
    lines.push(noAnswer[0]?.sampleText ?? '(empty)');
    lines.push('```');
  }
  lines.push('');

  // Per-model latency (time-to-answer).
  lines.push('## Time-to-answer by model');
  lines.push('');
  lines.push('| model | p50 | p95 | max | valid-answer rate |');
  lines.push('|---|--:|--:|--:|--:|');
  for (const m of runModels) {
    const recs = records.filter((r) => r.modelKey === m.key);
    const ans = recs.filter((r) => r.ok);
    const s = sortAsc(ans.map((r) => r.answerMs as number));
    lines.push(
      `| ${m.key} | ${fmtMs(percentile(s, 50))} | ${fmtMs(percentile(s, 95))} | ${fmtMs(
        percentile(s, 100),
      )} | ${recs.length ? ((ans.length / recs.length) * 100).toFixed(0) : '0'}% |`,
    );
  }
  lines.push('');

  // Latency by band.
  lines.push('## Time-to-answer by question band');
  lines.push('');
  lines.push('| band | p50 | p95 | max |');
  lines.push('|---|--:|--:|--:|');
  for (const band of ['general', 'ably-docs', 'ably-internal'] as Band[]) {
    const s = sortAsc(records.filter((r) => r.ok && r.band === band).map((r) => r.answerMs as number));
    lines.push(`| ${band} | ${fmtMs(percentile(s, 50))} | ${fmtMs(percentile(s, 95))} | ${fmtMs(percentile(s, 100))} |`);
  }
  lines.push('');

  // Accuracy: the real "would an agent even score?" question.
  lines.push('## Accuracy by band × variant');
  lines.push('');
  lines.push('Share of answered calls whose `choice` was correct. `bare` = no grounding; `digest` = shared Ably digest injected.');
  lines.push('');
  lines.push('| band | bare | digest |');
  lines.push('|---|--:|--:|');
  for (const band of ['general', 'ably-docs', 'ably-internal'] as Band[]) {
    lines.push(`| ${band} | ${accuracyCell(records, band, 'bare')} | ${accuracyCell(records, band, 'digest')} |`);
  }
  lines.push(`| **all** | ${accuracyCell(records, null, 'bare')} | ${accuracyCell(records, null, 'digest')} |`);
  lines.push('');

  // Per-model accuracy.
  lines.push('## Accuracy by model (all bands)');
  lines.push('');
  lines.push('| model | bare | digest |');
  lines.push('|---|--:|--:|');
  for (const m of runModels) {
    lines.push(
      `| ${m.key} | ${accuracyCell(records, null, 'bare', m.key)} | ${accuracyCell(records, null, 'digest', m.key)} |`,
    );
  }
  lines.push('');

  // Interpretation.
  lines.push('## Reading this');
  lines.push('');
  lines.push('- **Time-to-answer** is when a valid answer JSON could first be parsed from the stream — the moment the quiz could act on it. This is the number the verdict uses.');
  lines.push('- **TTFT** is when the visible think-aloud starts streaming to the screen.');
  lines.push('- The **general** band is the control (grounding should not matter). Lift on **ably-docs**/**ably-internal** from `bare`→`digest` is the pre-learning meta-game working — an un-grounded model guesses; a briefed one is faster and right (BRIEF §A3).');
  lines.push('- A late/failed answer scores 0 in the real quiz and the quiz never waits (BRIEF §B2.7); the valid-answer rate above is the reliability signal behind the verdict.');
  lines.push('');

  lines.push('## Methodology');
  lines.push('');
  lines.push('One streamed model call per run in the real answer shape (BRIEF §B2.7): a ≤2-sentence visible think-aloud followed by strict answer JSON `{choice,confidence,quip}`, parsed incrementally from the stream. All calls stream so TTFT and time-to-answer are measured from the same stream. Question set and the shared digest are in `questions.ts` (Ably facts verified against `ably.com/llms.txt` on 2026-07-11). Provider adapters and JSON extraction are in `providers.ts`.');
  lines.push('');
  return lines.join('\n');
}

// --- Small helpers ----------------------------------------------------------
function accuracyCell(records: RunRecord[], band: Band | null, variant: Variant, modelKey?: string): string {
  const recs = records.filter(
    (r) =>
      r.ok &&
      r.variant === variant &&
      (band === null || r.band === band) &&
      (modelKey === undefined || r.modelKey === modelKey),
  );
  if (recs.length === 0) return '—';
  const correct = recs.filter((r) => r.correct).length;
  return `${((correct / recs.length) * 100).toFixed(0)}% (${correct}/${recs.length})`;
}

function latencyRow(label: string, valuesRaw: (number | null)[]): string {
  const s = sortAsc(valuesRaw.filter((v): v is number => v !== null));
  return `| ${label} | ${fmtMs(percentile(s, 50))} | ${fmtMs(percentile(s, 95))} | ${fmtMs(
    percentile(s, 99),
  )} | ${fmtMs(percentile(s, 100))} | ${s.length} |`;
}

function summaryLine(label: string, valuesRaw: number[]): string {
  const s = sortAsc(valuesRaw);
  return `${label}: p50=${fmtMs(percentile(s, 50))} p95=${fmtMs(percentile(s, 95))} max=${fmtMs(
    percentile(s, 100),
  )} (n=${s.length})`;
}

function countBands(): string {
  const counts = new Map<Band, number>();
  for (const q of QUESTIONS) counts.set(q.band, (counts.get(q.band) ?? 0) + 1);
  return [...counts.entries()].map(([b, n]) => `${n} ${b}`).join(', ');
}

function uniqueProviders(models: ModelSpec[]): ProviderId[] {
  return [...new Set(models.map((m) => m.provider))];
}

function sortAsc(xs: number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

/** Nearest-rank percentile on an ascending-sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx] ?? NaN;
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return 'n/a';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function intEnv(name: string, dflt: number): number {
  const v = process.env[name];
  const n = v === undefined ? NaN : parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function optFloatEnv(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Run thunks with bounded concurrency, calling onDone as each settles. */
async function runPool<T>(tasks: (() => Promise<T>)[], limit: number, onDone: (r: T) => void): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    while (true) {
      const i = next++;
      const task = tasks[i];
      if (task === undefined) return;
      const r = await task();
      results[i] = r;
      onDone(r);
    }
  });
  await Promise.all(workers);
  return results;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
