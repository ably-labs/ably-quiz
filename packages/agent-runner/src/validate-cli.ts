// `pnpm agent:validate` (§S6.4). The CI gate for PR'd agents: it loads the whole
// registry — validating every agent.json against the zod contract (slug/folder
// match, crib readable, …) — and imports every agent.ts so a broken behaviour
// module fails the build too. Prints each problem as `slug: message` and exits 1
// if anything is wrong; otherwise a one-line OK with the agent count.
//
// No model call and no keys required — this is the CI-safe half of the harness.
// The model-backed `agent:test` needs a provider key and stays a local check.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadAgentModules } from './agent-loader';
import { loadRegistry, type RegistryError } from './registry';

const REPO_ROOT = new URL('../../../', import.meta.url);
const AGENTS_DIR = fileURLToPath(new URL('agents/', REPO_ROOT));

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

async function main(): Promise<void> {
  // Import every agent.ts up front, collecting import failures as errors —
  // loadAgentModules swallows them by design (the live host logs-and-skips so one
  // bad PR can't stop the roster), but the validator MUST fail on a broken module.
  const moduleErrors: RegistryError[] = [];
  const modules = await loadAgentModules(AGENTS_DIR, {
    onError: (slug, error) =>
      moduleErrors.push({ slug, dir: join(AGENTS_DIR, slug), error: `agent.ts: ${error}` }),
  });

  // Validate every agent.json through the same loader the host uses.
  const registry = await loadRegistry(AGENTS_DIR, { modules });
  const errors = [...registry.errors, ...moduleErrors];

  if (errors.length > 0) {
    for (const e of errors) console.error(red(`✗ ${e.slug}: ${e.error}`));
    console.error(red(`\n${errors.length} agent problem(s) — fix before opening a PR.`));
    process.exit(1);
  }

  console.log(green(`✓ ${registry.agents.length} agent(s) valid`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
