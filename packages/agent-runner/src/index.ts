// @ably-quiz/agent-runner — the default agent runner and registry loader.
//
// S4.1 (here): registry loader validating agent.json (zod) + the streamed
// think-aloud → strict-JSON answer core, carried over from the proven S0 spike.
// S4.2 layers AIT session presence + streamed thinking + publish on top;
// S4.3 ships the roster + shared digest + study script.

export const AGENT_RUNNER_PACKAGE = '@ably-quiz/agent-runner';

export * from './schema';
export * from './providers';
export * from './registry';
export * from './runner';
