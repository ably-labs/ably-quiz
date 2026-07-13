// The registry contract (BRIEF §B2.7). One `agents/<slug>/agent.json` per
// contestant, validated here with zod so a malformed agent is rejected at load
// (and reported) rather than crashing the host mid-quiz.

import { z } from 'zod';

/** Provider ids the runner knows how to call. `custom` is for agent.ts overrides. */
export const PROVIDERS = ['anthropic', 'openai', 'xai', 'google', 'custom'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const agentManifestSchema = z.object({
  /** Display name; convention: "<builder first name> <model>", e.g. "Matt Fable". */
  name: z.string().min(1),
  /** Folder name; kebab-case. Must match the directory it's loaded from. */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be kebab-case'),
  emoji: z.string().min(1),
  /** REQUIRED — shown on the chip ("built by …"), so an agent always has an owner. */
  owner: z.string().min(1),
  provider: z.enum(PROVIDERS),
  /** Provider model id, e.g. "claude-fable-5" or "grok-4.20-0309-non-reasoning". */
  model: z.string().min(1),
  tagline: z.string().optional(),
  personality: z.string().optional(),
  /** Optional committed crib file (relative to the agent dir), injected at answer time. */
  crib: z.string().optional(),
  /** Optional named pre-learning strategy run by `agents:study` to (re)generate the
   *  crib (§B2.7). Currently `"ably-docs"` (scrape the public docs index). Custom
   *  code studies via `agent.ts` arrive with the S4.7 dev kit. */
  study: z.string().optional(),
  /** Optional MCP grounding (S6). */
  mcp: z.object({ url: z.string().min(1), auth: z.string().min(1) }).optional(),
});

export type AgentManifest = z.infer<typeof agentManifestSchema>;

/** The question as broadcast to contestants — options already shuffled, NO correct
 *  answer (agents never see it; they answer on the fan-in like everyone else). */
export type Question = {
  idx: number;
  prompt: string;
  options: string[];
  limitMs: number;
  category?: string;
};
