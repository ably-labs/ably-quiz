// `pnpm agent:new <slug>` — scaffold a new agent (BRIEF §B3 S4.7). Writes a
// VALID agents/<slug>/agent.json (+ a commented agent.ts stub for the advanced
// study()/answer() hooks) and points the builder at `pnpm agent:test <slug>`.
// Goal: a new agent answering fixtures in minutes.
//
// Interactive in a terminal; also fully scriptable via flags (and CI-safe):
//   pnpm agent:new jane-opus --name "Jane Opus" --owner "Jane <jane@x.com>" \
//     --provider anthropic --model claude-opus-4-8

import { access, mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { agentManifestSchema, PROVIDERS } from './schema';

const AGENTS_DIR = fileURLToPath(new URL('../../../agents/', import.meta.url));

const AGENT_TS_STUB = `// Optional custom hooks for this agent (advanced). The default provider path
// (packages/agent-runner/src/runner.ts) already answers from your agent.json —
// you only need this file to override behaviour.
//
//   export async function study(ctx) { /* build a crib.md from your own sources */ }
//   export async function answer(ctx) { /* full control over the answer */ }
export {};
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      emoji: { type: 'string' },
      owner: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      personality: { type: 'string' },
      tagline: { type: 'string' },
    },
  });
  const slug = positionals[0];
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error('usage: pnpm agent:new <slug>   (slug: kebab-case, e.g. "jane-opus")');
    process.exit(1);
  }
  const dir = `${AGENTS_DIR}${slug}`;
  const exists = await access(`${dir}/agent.json`)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    console.error(`agents/${slug}/agent.json already exists — pick another slug.`);
    process.exit(1);
  }

  // Interactive only when a terminal is attached; otherwise flags must supply it.
  const interactive = Boolean(process.stdin.isTTY);
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  if (interactive) console.log(`\nScaffolding a new agent: ${slug}\n`);

  const resolve = async (
    flag: string | undefined,
    prompt: string,
    def?: string,
  ): Promise<string> => {
    if (flag !== undefined) return flag;
    if (!rl) return def ?? '';
    const a = (await rl.question(def ? `${prompt} [${def}] ` : `${prompt} `)).trim();
    return a || def || '';
  };

  const name = await resolve(values.name, 'Display name (e.g. "Jane Opus"):', slug);
  const emoji = await resolve(values.emoji, 'Emoji:', '🤖');
  const owner = await resolve(values.owner, 'Owner (name <email>):');
  let provider = await resolve(values.provider, `Provider (${PROVIDERS.join(' / ')}):`, 'anthropic');
  while (rl && !(PROVIDERS as readonly string[]).includes(provider)) {
    provider = await resolve(undefined, `Provider (${PROVIDERS.join(' / ')}):`, 'anthropic');
  }
  const model = await resolve(values.model, 'Model id (e.g. "claude-opus-4-8"):');
  const personality = await resolve(values.personality, 'Personality — one line, optional:');
  const tagline = await resolve(values.tagline, 'Tagline — optional:');
  rl?.close();

  const manifest: Record<string, unknown> = { name, slug, emoji, owner, provider, model };
  if (tagline) manifest.tagline = tagline;
  if (personality) manifest.personality = personality;

  const parsed = agentManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    console.error(
      '\n✗ invalid: ' +
        parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') +
        (interactive ? '' : '\n(non-interactive: supply the missing fields as --flags)'),
    );
    process.exit(1);
  }

  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/agent.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(`${dir}/agent.ts`, AGENT_TS_STUB);

  console.log(`\n✓ wrote agents/${slug}/agent.json`);
  console.log(`  Set your ${provider.toUpperCase()}_API_KEY, then:  pnpm agent:test ${slug}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
