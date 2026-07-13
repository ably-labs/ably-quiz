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
