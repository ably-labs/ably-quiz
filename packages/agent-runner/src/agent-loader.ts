// Dynamic agent.ts loader for tsx/Node contexts (the CLIs). Imports each
// agents/<slug>/agent.ts and collects its exported behaviour hooks.
//
// NOT re-exported from index.ts on purpose: it uses a dynamic `import()`, and the
// bundled web app must never pull that in (it resolves modules through the
// generated static map — see apps/web/lib/agent-modules.generated.ts). One bad
// agent.ts is logged and skipped, never thrown — a single bad PR can't stop the
// whole roster from loading.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentModule } from './agent-module';

export type LoadAgentModulesOptions = {
  /** Called instead of the default `console.warn` when an agent.ts fails to
   *  import. The validator (`agent:validate`) uses this to turn a broken module
   *  into a hard CI error — the live host, which passes no handler, keeps the
   *  default behaviour of logging-and-skipping so one bad PR can't fell the roster. */
  onError?: (slug: string, error: string) => void;
};

export async function loadAgentModules(
  agentsDir: string,
  opts: LoadAgentModulesOptions = {},
): Promise<Record<string, AgentModule>> {
  const out: Record<string, AgentModule> = {};
  let names: string[];
  try {
    names = await readdir(agentsDir);
  } catch {
    return out;
  }
  for (const name of names) {
    const file = join(agentsDir, name, 'agent.ts');
    try {
      await stat(file);
    } catch {
      continue; // no agent.ts — this agent is JSON-only
    }
    try {
      const mod = (await import(pathToFileURL(file).href)) as Partial<AgentModule>;
      const picked: AgentModule = {};
      if (typeof mod.study === 'function') picked.study = mod.study;
      if (typeof mod.answer === 'function') picked.answer = mod.answer;
      if (picked.study || picked.answer) out[name] = picked;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.onError) opts.onError(name, message);
      else console.warn(`agent.ts for "${name}" failed to load: ${message}`);
    }
  }
  return out;
}
