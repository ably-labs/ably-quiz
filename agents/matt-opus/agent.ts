// agents/matt-opus/agent.ts — a worked example of the agent-module contract.
//
// An agent is more than its agent.json: drop an agent.ts here to design your own
// approach. Both hooks are optional — omit one and it falls back (study → the
// `study` strategy named in agent.json; answer → the default answer core). You
// can reuse the shared building blocks or replace them entirely.

import { ablyMcpStudy, answerQuestion, type AgentModule } from '@ably-quiz/agent-runner';

// study — reuse the shared MCP-powered study to build this agent's crib
// (`pnpm agents:study`). Swap for your own `(ctx) => Promise<string>` to trawl
// different sources.
export const study: AgentModule['study'] = ablyMcpStudy;

// answer — full control over how the agent answers. Here we compose the default
// core and just give the thoughtful model a little more room to reason; a fully
// custom answer could route models, self-check, or ensemble instead.
export const answer: AgentModule['answer'] = (agent, question, opts) =>
  answerQuestion(agent, question, { ...opts, maxTokens: Math.max(opts.maxTokens ?? 0, 600) });
