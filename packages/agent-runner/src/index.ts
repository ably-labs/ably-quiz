// @ably-quiz/agent-runner — the default agent runner and registry loader.
//
// S4.1: registry loader validating agent.json (zod) + the streamed think-aloud →
// strict-JSON answer core, carried over from the proven S0 spike.
// S4.2: AIT session presence + streamed thinking + fan-in answer + deadline
// supervisor. The live Ably/AIT wiring lives in ./live-agent (+ ./cli), which is
// deliberately NOT re-exported here: apps/web transpiles this package (S4.5 UI)
// and must not pull the server-side `@ably/ai-transport/vercel` + `ably` runtime
// into its bundle. The pure delta→chunk mapper (type-only `ai` import) is safe.

export const AGENT_RUNNER_PACKAGE = '@ably-quiz/agent-runner';

export * from './schema';
export * from './providers';
export * from './registry';
export * from './runner';
export * from './think-stream';
