// Pre-learning — the meta-game (BRIEF §B2.7). `pnpm agents:study` runs each
// agent's `study(ctx)` before quiz day and commits the resulting `crib.md`, so
// everyone can read every agent's cram sheet. Default study is none; an agent
// opts in by exporting `study` from its `agent.ts`.
//
// Matt's roster shares `ablyDocsStudy` below: it scrapes the PUBLIC docs index
// (ably.com/llms.txt) into a focused Ably-facts crib. Richer, MCP-powered study
// (Wiki trawls etc.) lands in S6; this is the simple, dependency-free,
// deterministic version.

import type { AgentManifest } from './schema';

export type StudyContext = {
  agent: AgentManifest;
  /** The shared baseline digest — a study can build on it rather than repeat it. */
  digest: string;
  /** Fetch a public URL as text (injectable so studies are unit-testable). */
  fetchText: (url: string) => Promise<string>;
  /** MCP-grounded research (§S6.3): run a read-only lookup against Ably knowledge
   *  and return synthesized notes. Present only when the study CLI has MCP creds;
   *  the `ably-mcp` strategy skips gracefully without it. Injectable for tests. */
  research?: (instruction: string) => Promise<string>;
};

/** An agent's `agent.ts` may `export` this to pre-learn. Returns the crib markdown. */
export type StudyFn = (ctx: StudyContext) => Promise<string>;

export const ABLY_LLMS_TXT = 'https://ably.com/llms.txt';
const MAX_ENTRIES = 50;

/** Doc-index entry: `- [title](url): description`. */
export type DocEntry = { title: string; url: string; description: string };

/** Parse the `- [title](url): description` lines out of an llms.txt-style file. */
export function parseLlmsTxt(txt: string): DocEntry[] {
  const line = /^\s*-\s*\[([^\]]+)\]\(([^)]+)\):\s*(.+?)\s*$/;
  const out: DocEntry[] = [];
  const seen = new Set<string>();
  for (const raw of txt.split('\n')) {
    const m = line.exec(raw);
    if (!m) continue;
    const title = m[1]!.trim();
    if (seen.has(title)) continue;
    seen.add(title);
    out.push({ title, url: m[2]!.trim(), description: m[3]!.trim() });
  }
  return out;
}

// Keep the entries worth grounding a quiz on (products + core concepts); drop the
// operational noise (pricing, getting-started, SDK-specific pages).
const KEEP =
  /pub\/?sub|chat|spaces|liveobjects|livesync|ai transport|presence|channel|history|realtime|message|token|auth|occupancy|rewind|webhook/i;
const DROP =
  /pricing|getting started|quickstart|install|upgrade|changelog|migrat|sdk setup|examples?/i;

function isGroundingRelevant(e: DocEntry): boolean {
  const hay = `${e.title} ${e.description}`;
  return KEEP.test(hay) && !DROP.test(hay);
}

// The six products (+ "overview"/"about" pages) lead the crib, so the cap never
// crowds out the headline products behind common-keyword pages (channels, auth…).
const PRODUCT = /\b(pub\/?sub|chat|spaces|liveobjects|livesync|ai transport)\b/i;
function priority(e: DocEntry): number {
  if (PRODUCT.test(e.title)) return 0;
  if (/\b(overview|about|introduc|concepts?)\b/i.test(e.title)) return 1;
  if (PRODUCT.test(e.description)) return 2;
  return 3;
}

/**
 * Shared study for Matt's roster: scrape ably.com/llms.txt into a crib of the
 * product/concept doc entries an agent should know. Deterministic (no model
 * call), so re-running only changes the crib when the docs change.
 */
export const ablyDocsStudy: StudyFn = async (ctx) => {
  const txt = await ctx.fetchText(ABLY_LLMS_TXT);
  const entries = parseLlmsTxt(txt);
  const relevant = entries.filter(isGroundingRelevant);
  const pool = relevant.length > 0 ? relevant : entries; // fallback on format drift
  // Stable-sort products/overviews to the front, then cap — so every product is
  // covered regardless of where it sits in the source index.
  const chosen = pool
    .map((e, i) => ({ e, i }))
    .sort((a, b) => priority(a.e) - priority(b.e) || a.i - b.i)
    .slice(0, MAX_ENTRIES)
    .map((x) => x.e);
  return renderCrib(ctx.agent, chosen);
};

function renderCrib(agent: AgentManifest, entries: DocEntry[]): string {
  const lines = [
    `# ${agent.name} — crib`,
    '',
    `Pre-learned by \`agents:study\` from ${ABLY_LLMS_TXT} — the Ably product & concept`,
    'docs this agent studied. Injected into the system prompt alongside the shared digest.',
    '',
    '## Ably docs studied',
    '',
  ];
  for (const e of entries) lines.push(`- **${e.title}** — ${e.description}`);
  lines.push('');
  return lines.join('\n');
}

// --- MCP-powered study (§S6.3) ----------------------------------------------
// The meta-game's richer path: instead of listing doc titles, an agent trawls
// Ably knowledge through the read-only MCP and synthesizes a crib of
// quiz-ready facts. Needs credentials, so it's the study CLI that wires the
// `research` hook (Anthropic MCP connector); here we stay pure + testable.

/** The spine of an MCP-grounded crib — the topics worth cramming for a
 *  Carbon-vs-Silicon company quiz. Public-safe product/technical knowledge only. */
export const ABLY_MCP_STUDY_TOPICS = [
  'Each Ably product (Pub/Sub, Chat, Spaces, LiveObjects, LiveSync, AI Transport): what it is, the problem it solves, and one or two standout capabilities',
  'Core realtime concepts a quiz might probe: channels, presence, history & rewind, connection state recovery, message ordering, token vs API-key auth, capabilities',
  'What makes Ably distinctive: the global edge network, the pillars of dependability (performance, integrity, reliability, availability), and any published guarantees',
  'Concrete, quotable specifics: LiveObjects data types (LiveMap / LiveCounter), what counts as a message, channel rules / namespaces, notable platform limits',
] as const;

// This repo is destined for open source (§S6.4/6.5), so a committed crib must
// never leak internal data — the instruction makes that a hard constraint.
const MCP_STUDY_GUARDRAIL =
  'Only include information safe to publish in a PUBLIC, open-source repository: Ably product and technical knowledge. Do NOT include anything confidential — no revenue, named customers, internal roadmaps, unreleased plans, security specifics, or employee data.';

/** Sentinel the model must emit immediately before the crib, so the tool-use
 *  narration it streams while researching can be stripped deterministically. */
export const CRIB_SENTINEL = '===CRIB===';

/** The research prompt an `ably-mcp` study sends through the grounded model. */
export function ablyMcpStudyInstruction(
  agent: AgentManifest,
  topics: readonly string[] = ABLY_MCP_STUDY_TOPICS,
): string {
  return [
    `You are ${agent.name}, studying Ably so you can win a company quiz. Use the read-only Ably knowledge lookups available to you to research the topics below, then write a crib sheet of crisp, quotable facts to keep at hand.`,
    '',
    'Topics:',
    ...topics.map((t) => `- ${t}`),
    '',
    'Write tight Markdown bullets grouped under short section headings. Prefer specific facts (names, numbers, guarantees) over prose. Ground every claim in what the tools return — do not invent. Aim for 250–500 words.',
    '',
    `Output the crib and nothing else. Do NOT add a top-level title — start with the first section heading (e.g. \`## Products\`). Put the line \`${CRIB_SENTINEL}\` on its own line immediately before the crib, and write nothing after the crib ends.`,
    '',
    MCP_STUDY_GUARDRAIL,
  ].join('\n');
}

/** Keep only the crib from a grounded response: the model streams tool-use
 *  narration before it, so take everything after the sentinel; failing that,
 *  fall back to the first Markdown heading (older responses had no sentinel). */
export function stripStudyPreamble(text: string): string {
  const at = text.lastIndexOf(CRIB_SENTINEL);
  if (at >= 0) return text.slice(at + CRIB_SENTINEL.length).trim();
  const heading = text.search(/^#{1,3}\s/m);
  return (heading >= 0 ? text.slice(heading) : text).trim();
}

/**
 * MCP-powered study for Matt's roster (§S6.3): research Ably knowledge through
 * the read-only MCP and synthesize a facts crib. Requires `ctx.research` (wired
 * by the study CLI when MCP creds are present); without it the strategy throws
 * so the CLI can skip the agent gracefully rather than emit an empty crib.
 */
export const ablyMcpStudy: StudyFn = async (ctx) => {
  if (!ctx.research) {
    throw new Error(
      'ably-mcp study needs MCP grounding — set ANTHROPIC_API_KEY + ABLY_MCP_AUTH (+ optional ABLY_MCP_URL)',
    );
  }
  const notes = stripStudyPreamble(await ctx.research(ablyMcpStudyInstruction(ctx.agent)));
  if (!notes) throw new Error('ably-mcp study returned no notes');
  return renderMcpCrib(ctx.agent, notes);
};

function renderMcpCrib(agent: AgentManifest, notes: string): string {
  return [
    `# ${agent.name} — crib`,
    '',
    'Pre-learned by `agents:study` (strategy `ably-mcp`): Ably knowledge researched',
    'through the read-only MCP and synthesized into quiz-ready notes. Injected',
    'into the system prompt alongside the shared digest. Public-safe knowledge only.',
    '',
    notes,
    '',
  ].join('\n');
}
