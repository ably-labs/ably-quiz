import { describe, expect, it } from 'vitest';
import {
  ABLY_LLMS_TXT,
  ABLY_MCP_STUDY_TOPICS,
  CRIB_SENTINEL,
  ablyDocsStudy,
  ablyMcpStudy,
  ablyMcpStudyInstruction,
  parseLlmsTxt,
  stripStudyPreamble,
} from './study';
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

describe('ablyMcpStudy (§S6.3)', () => {
  const noFetch = () => Promise.reject(new Error('should not fetch'));

  it('sends a topic-driven, public-safe instruction to the research hook and wraps the notes', async () => {
    let seen = '';
    const crib = await ablyMcpStudy({
      agent,
      digest: 'D',
      fetchText: noFetch,
      research: (instruction) => {
        seen = instruction;
        return Promise.resolve('## Products\n- Pub/Sub — realtime channels.');
      },
    });
    // The instruction carries the topics + the open-source guardrail + sentinel.
    expect(seen).toContain(ABLY_MCP_STUDY_TOPICS[0]);
    expect(seen).toMatch(/public.*open-source/i);
    expect(seen).toMatch(/do not include anything confidential/i);
    expect(seen).toContain(CRIB_SENTINEL);
    // The crib wraps the researched notes with a header naming the strategy.
    expect(crib).toContain('Matt Opus — crib');
    expect(crib).toContain('ably-mcp');
    expect(crib).toContain('Pub/Sub — realtime channels.');
  });

  it('strips the streamed tool-use narration before the crib (sentinel path)', async () => {
    const crib = await ablyMcpStudy({
      agent,
      digest: '',
      fetchText: noFetch,
      research: () =>
        Promise.resolve(
          `I'll research this. Let me load the context.Now searching…${CRIB_SENTINEL}\n## Products\n- Pub/Sub.`,
        ),
    });
    expect(crib).not.toContain("I'll research this");
    expect(crib).not.toContain('searching…');
    expect(crib).toContain('## Products');
  });

  it('throws (so the CLI skips) when no research hook is wired', async () => {
    await expect(
      ablyMcpStudy({ agent, digest: '', fetchText: noFetch }),
    ).rejects.toThrow(/MCP grounding/i);
  });

  it('throws when research returns empty notes rather than emit a hollow crib', async () => {
    await expect(
      ablyMcpStudy({ agent, digest: '', fetchText: noFetch, research: () => Promise.resolve('   ') }),
    ).rejects.toThrow(/no notes/i);
  });

  it('builds an instruction that lists every study topic', () => {
    const instruction = ablyMcpStudyInstruction(agent);
    for (const topic of ABLY_MCP_STUDY_TOPICS) expect(instruction).toContain(topic);
  });
});

describe('stripStudyPreamble', () => {
  it('takes everything after the last sentinel', () => {
    expect(stripStudyPreamble(`narration blah ${CRIB_SENTINEL}\n## A\n- x`)).toBe('## A\n- x');
  });

  it('falls back to the first Markdown heading when no sentinel is present', () => {
    expect(stripStudyPreamble("Let me research.\n\n## Products\n- Pub/Sub.")).toBe(
      '## Products\n- Pub/Sub.',
    );
  });

  it('returns the trimmed text when there is neither sentinel nor heading', () => {
    expect(stripStudyPreamble('   just prose   ')).toBe('just prose');
  });
});
