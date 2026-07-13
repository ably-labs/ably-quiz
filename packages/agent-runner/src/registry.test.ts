import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRegistry, type Registry } from './registry';

let root: string;
let reg: Registry;

async function agentDir(name: string, manifest: unknown, files: Record<string, string> = {}) {
  const dir = join(root, name);
  await mkdir(dir);
  if (manifest !== undefined) {
    await writeFile(
      join(dir, 'agent.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    );
  }
  for (const [f, content] of Object.entries(files)) await writeFile(join(dir, f), content);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'agents-'));

  await agentDir(
    'matt-fable',
    {
      name: 'Matt Fable',
      slug: 'matt-fable',
      emoji: '🟣',
      owner: 'Matt',
      provider: 'anthropic',
      model: 'claude-fable-5',
      crib: 'crib.md',
    },
    { 'crib.md': 'STUDIED FACTS' },
  );
  await agentDir('no-crib-yet', {
    name: 'No Crib Yet',
    slug: 'no-crib-yet',
    emoji: 'x',
    owner: 'o',
    provider: 'anthropic',
    model: 'm',
    crib: 'crib.md',
  }); // declares a crib that hasn't been generated yet (pre-`agents:study`)
  await agentDir('bad-owner', {
    name: 'Bad',
    slug: 'bad-owner',
    emoji: 'x',
    provider: 'anthropic',
    model: 'm',
  }); // missing owner
  await agentDir('wrong-slug', {
    name: 'W',
    slug: 'different',
    emoji: 'x',
    owner: 'o',
    provider: 'anthropic',
    model: 'm',
  }); // slug != folder
  await agentDir('broken-json', '{ not valid json');
  await agentDir('not-an-agent', undefined, { 'notes.txt': 'hi' }); // no agent.json
  await writeFile(join(root, 'README.md'), '# registry'); // top-level file

  reg = await loadRegistry(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('loadRegistry', () => {
  it('loads a valid agent and its crib', () => {
    const fable = reg.agents.find((a) => a.manifest.slug === 'matt-fable');
    expect(fable).toBeDefined();
    expect(fable?.crib).toBe('STUDIED FACTS');
    expect(fable?.manifest.model).toBe('claude-fable-5');
  });

  it('loads valid agents and excludes invalid ones', () => {
    expect(reg.agents.map((a) => a.manifest.slug)).toEqual(['matt-fable', 'no-crib-yet']);
  });

  it('loads an agent whose declared crib is not generated yet — without the crib, not as an error', () => {
    const a = reg.agents.find((x) => x.manifest.slug === 'no-crib-yet');
    expect(a).toBeDefined();
    expect(a?.crib).toBeUndefined();
    expect(reg.errors.find((e) => e.slug === 'no-crib-yet')).toBeUndefined();
  });

  it('reports the missing-owner agent as an error', () => {
    expect(reg.errors.find((e) => e.slug === 'bad-owner')?.error).toMatch(/owner/i);
  });

  it('reports a slug that does not match its folder', () => {
    expect(reg.errors.find((e) => e.slug === 'wrong-slug')?.error).toMatch(/must match folder/);
  });

  it('reports malformed agent.json', () => {
    expect(reg.errors.find((e) => e.slug === 'broken-json')?.error).toMatch(/JSON/i);
  });

  it('silently ignores dirs without agent.json and top-level files', () => {
    expect(reg.errors.find((e) => e.slug === 'not-an-agent')).toBeUndefined();
    expect(reg.errors.find((e) => e.slug === 'README.md')).toBeUndefined();
    expect(reg.agents.find((a) => a.manifest.slug === 'not-an-agent')).toBeUndefined();
  });

  it('returns a single error when the agents dir does not exist', async () => {
    const missing = await loadRegistry(join(root, 'nope'));
    expect(missing.agents).toEqual([]);
    expect(missing.errors).toHaveLength(1);
  });
});
