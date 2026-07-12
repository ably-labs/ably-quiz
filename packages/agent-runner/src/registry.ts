// Registry loader (BRIEF §B2.7). Scans `agents/<slug>/`, validates each
// agent.json with the zod contract, and loads its crib. Invalid agents are
// collected as errors (never thrown) so one bad PR can't stop the whole
// registry from booting — the host runs every valid agent and reports the rest.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { agentManifestSchema, type AgentManifest } from './schema';

export type LoadedAgent = {
  manifest: AgentManifest;
  /** Absolute path to the agent's folder. */
  dir: string;
  /** Contents of the crib file, if `manifest.crib` is set and readable. */
  crib?: string;
};

export type RegistryError = { slug: string; dir: string; error: string };
export type Registry = { agents: LoadedAgent[]; errors: RegistryError[] };

export async function loadRegistry(agentsDir: string): Promise<Registry> {
  const agents: LoadedAgent[] = [];
  const errors: RegistryError[] = [];

  let entries: string[];
  try {
    entries = await readdir(agentsDir);
  } catch (err) {
    return { agents, errors: [{ slug: '*', dir: agentsDir, error: `cannot read: ${msg(err)}` }] };
  }

  for (const name of [...entries].sort()) {
    const dir = join(agentsDir, name);
    if (!(await isDirectory(dir))) continue; // skip README.md etc.

    const manifest = await readManifest(join(dir, 'agent.json'));
    if (manifest.missing) continue; // a dir without agent.json isn't an agent
    if (manifest.error !== undefined) {
      errors.push({ slug: name, dir, error: `agent.json: ${manifest.error}` });
      continue;
    }

    const parsed = agentManifestSchema.safeParse(manifest.raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      errors.push({ slug: name, dir, error: `invalid agent.json — ${detail}` });
      continue;
    }
    if (parsed.data.slug !== name) {
      errors.push({
        slug: name,
        dir,
        error: `slug "${parsed.data.slug}" must match folder "${name}"`,
      });
      continue;
    }

    const loaded: LoadedAgent = { manifest: parsed.data, dir };
    if (parsed.data.crib) {
      try {
        loaded.crib = await readFile(join(dir, parsed.data.crib), 'utf8');
      } catch (err) {
        errors.push({ slug: name, dir, error: `crib "${parsed.data.crib}": ${msg(err)}` });
        continue;
      }
    }
    agents.push(loaded);
  }

  return { agents, errors };
}

type ManifestRead = { raw?: unknown; missing?: boolean; error?: string };

async function readManifest(path: string): Promise<ManifestRead> {
  let txt: string;
  try {
    txt = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { missing: true };
    return { error: msg(err) };
  }
  try {
    return { raw: JSON.parse(txt) };
  } catch (err) {
    return { error: `not valid JSON: ${msg(err)}` };
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
