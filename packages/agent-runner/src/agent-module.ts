// The agent-as-a-module contract (§B2.7 / S6.4). An agent is more than its
// `agent.json` metadata: a builder can drop an `agents/<slug>/agent.ts` that
// exports behaviour hooks and designs their own approach — reusing the shared
// building blocks (`ablyDocsStudy`, `ablyMcpStudy`, `answerQuestion`) or fully
// replacing them. Both hooks are optional; when absent, study falls back to the
// named JSON strategy and answer falls back to the default core.
//
// Only TYPES live here (safe to re-export). The dynamic-import loader that reads
// agent.ts from disk lives in ./agent-loader and is NOT re-exported from index —
// the bundled web app resolves modules through a generated static map instead.

import type { AnswerOptions, AnswerOutcome } from './runner';
import type { AgentManifest, Question } from './schema';
import type { StudyFn } from './study';

/**
 * Full control over answering. Same shape as the default `answerQuestion`, so a
 * custom answer can wrap and extend it (call the default, then tweak) rather than
 * reimplement the deadline/streaming machinery.
 */
export type AnswerFn = (
  agent: AgentManifest,
  question: Question,
  opts: AnswerOptions,
) => Promise<AnswerOutcome>;

/**
 * An agent's behaviour module — what `agents/<slug>/agent.ts` may export.
 * - `study`  — build the crib your way (`pnpm agents:study`). Reuse a shared
 *   strategy (`export const study = ablyMcpStudy`) or write your own.
 * - `answer` — full control over how the agent answers a question.
 */
export type AgentModule = {
  study?: StudyFn;
  answer?: AnswerFn;
};
