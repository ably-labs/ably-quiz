import { describe, expect, it } from 'vitest';
import { agentManifestSchema } from './schema';

const valid = {
  name: 'Matt Fable',
  slug: 'matt-fable',
  emoji: '🟣',
  owner: "Matt O'Riordan <matt@ably.com>",
  provider: 'anthropic',
  model: 'claude-fable-5',
  tagline: 'Tells you a story about why it is right.',
  personality: 'Erudite, playful, quietly competitive.',
};

describe('agentManifestSchema (§B2.7 registry contract)', () => {
  it('accepts a valid manifest', () => {
    expect(agentManifestSchema.safeParse(valid).success).toBe(true);
  });

  it('requires owner — it is displayed on the chip', () => {
    const noOwner: Record<string, unknown> = { ...valid };
    delete noOwner.owner;
    expect(agentManifestSchema.safeParse(noOwner).success).toBe(false);
  });

  it('rejects a non-kebab-case slug', () => {
    expect(agentManifestSchema.safeParse({ ...valid, slug: 'Matt_Fable' }).success).toBe(false);
  });

  it('rejects an unknown provider', () => {
    expect(agentManifestSchema.safeParse({ ...valid, provider: 'llama' }).success).toBe(false);
  });

  it('accepts an optional mcp block but requires both url and auth', () => {
    expect(
      agentManifestSchema.safeParse({
        ...valid,
        mcp: { url: 'https://x', auth: 'service-account' },
      }).success,
    ).toBe(true);
    expect(agentManifestSchema.safeParse({ ...valid, mcp: { url: 'https://x' } }).success).toBe(
      false,
    );
  });
});
