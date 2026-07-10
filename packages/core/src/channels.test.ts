import { describe, expect, it } from 'vitest';
import {
  agentChannel,
  agentChannelPattern,
  answersChannel,
  mainChannel,
  NAMESPACE,
} from './channels';

describe('channel names', () => {
  it('use the distinct namespace prefixes (docs/ABLY-SETUP.md)', () => {
    expect(mainChannel('abc')).toBe('quiz:abc');
    expect(answersChannel('abc')).toBe('quiz-answers:abc');
    expect(agentChannel('abc', 'matt-fable')).toBe('quiz-agent:abc:matt-fable');
    expect(agentChannelPattern('abc')).toBe('quiz-agent:abc:*');
  });

  it('each channel resolves to its own Ably namespace (first colon-segment)', () => {
    const ns = (ch: string) => ch.split(':')[0];
    expect(ns(mainChannel('q'))).toBe(NAMESPACE.main);
    expect(ns(answersChannel('q'))).toBe(NAMESPACE.answers);
    expect(ns(agentChannel('q', 's'))).toBe(NAMESPACE.agent);
    // The three namespaces must differ, or per-namespace rules can't apply.
    expect(new Set([NAMESPACE.main, NAMESPACE.answers, NAMESPACE.agent]).size).toBe(3);
  });
});
