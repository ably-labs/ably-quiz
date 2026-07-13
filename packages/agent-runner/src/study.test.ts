import { describe, expect, it } from 'vitest';
import { ABLY_LLMS_TXT, ablyDocsStudy, parseLlmsTxt } from './study';
import type { AgentManifest } from './schema';

const FIXTURE = `# Ably docs

## Concepts
- [Channel rules](https://ably.com/docs/channels/rules.md): Configure per-namespace channel behaviour.
- [Presence](https://ably.com/docs/presence.md): Be aware of other clients on a channel.
- [Channel history](https://ably.com/docs/history.md): Access past messages on a channel.

## Products
- [Pub/Sub overview](https://ably.com/docs/pub-sub.md?source=llms.txt): Realtime pub/sub messaging with channels and presence.
- [Spaces overview](https://ably.com/docs/spaces.md): Build collaborative multiplayer environments.
- [Pub/Sub pricing](https://ably.com/docs/pub-sub/pricing.md): Understand how operations contribute to your bill.
- [Getting started: React](https://ably.com/docs/getting-started/react.md): Install the SDK and get going.
- [About AI Transport](https://ably.com/docs/ai-transport.md): Durable session infrastructure for AI applications.

Some prose that is not a link line and must be ignored.
`;

const agent: AgentManifest = {
  name: 'Matt Opus',
  slug: 'matt-opus',
  emoji: '🔵',
  owner: 'm',
  provider: 'anthropic',
  model: 'claude-opus-4-8',
};

describe('parseLlmsTxt', () => {
  it('extracts title/url/description from link lines only (all of them, in order)', () => {
    const e = parseLlmsTxt(FIXTURE);
    expect(e.map((x) => x.title)).toEqual([
      'Channel rules',
      'Presence',
      'Channel history',
      'Pub/Sub overview',
      'Spaces overview',
      'Pub/Sub pricing',
      'Getting started: React',
      'About AI Transport',
    ]);
    expect(e.find((x) => x.title === 'Pub/Sub overview')).toMatchObject({
      url: expect.stringContaining('pub-sub.md'),
      description: expect.stringContaining('Realtime pub/sub'),
    });
  });

  it('dedupes by title', () => {
    const e = parseLlmsTxt(`${FIXTURE}\n- [Spaces overview](https://x): a duplicate`);
    expect(e.filter((x) => x.title === 'Spaces overview')).toHaveLength(1);
  });
});

describe('ablyDocsStudy', () => {
  it('keeps product/concept entries and drops noise (pricing, getting-started)', async () => {
    const crib = await ablyDocsStudy({
      agent,
      digest: 'D',
      fetchText: () => Promise.resolve(FIXTURE),
    });
    expect(crib).toContain('Matt Opus — crib');
    expect(crib).toContain('Pub/Sub overview');
    expect(crib).toContain('Spaces overview');
    expect(crib).not.toContain('pricing');
    expect(crib).not.toContain('Getting started');
  });

  it('studies the public llms.txt via the injected fetcher', async () => {
    let seen = '';
    await ablyDocsStudy({
      agent,
      digest: '',
      fetchText: (u) => {
        seen = u;
        return Promise.resolve(FIXTURE);
      },
    });
    expect(seen).toBe(ABLY_LLMS_TXT);
  });

  it('orders products first, so a product listed late in the source still leads', async () => {
    const crib = await ablyDocsStudy({
      agent,
      digest: '',
      fetchText: () => Promise.resolve(FIXTURE),
    });
    // "About AI Transport" is a product but appears after the concept entries in
    // the source; the priority sort must pull it ahead of e.g. "Channel rules".
    expect(crib).toContain('About AI Transport');
    expect(crib.indexOf('About AI Transport')).toBeLessThan(crib.indexOf('Channel rules'));
  });
});
