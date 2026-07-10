import { describe, expect, it } from 'vitest';
import { buildCapability, kindFromClientId, resolveClientId } from './auth';

describe('buildCapability (§B2.5 matrix)', () => {
  it('player: read main + LiveObjects, publish answers only, no agent access', () => {
    const cap = buildCapability('player', 'q1');
    expect(cap).toEqual({
      'quiz:q1': ['subscribe', 'presence', 'object-subscribe'],
      'quiz-answers:q1': ['publish'],
    });
    // A player cannot subscribe to the fan-in answers channel.
    expect(cap['quiz-answers:q1']).not.toContain('subscribe');
  });

  it('host: full on all three of the quiz channel groups', () => {
    const cap = buildCapability('host', 'q1');
    expect(cap).toEqual({
      'quiz:q1': ['*'],
      'quiz-answers:q1': ['*'],
      'quiz-agent:q1:*': ['*'],
    });
  });

  it('agent: publish answers + full on its OWN session only', () => {
    const cap = buildCapability('agent', 'q1', 'matt-fable');
    expect(cap).toEqual({
      'quiz:q1': ['subscribe', 'presence'],
      'quiz-answers:q1': ['publish'],
      'quiz-agent:q1:matt-fable': ['*'],
    });
    // Scoped to its own slug — not the wildcard the host gets.
    expect(cap['quiz-agent:q1:*']).toBeUndefined();
  });

  it('agent without a slug is rejected', () => {
    expect(() => buildCapability('agent', 'q1')).toThrow(/slug/);
  });
});

describe('resolveClientId', () => {
  it('forces the role prefix and cannot be spoofed', () => {
    expect(resolveClientId('player', 'Priya')).toBe('p:Priya');
    expect(resolveClientId('agent', 'matt-fable')).toBe('a:matt-fable');
    expect(resolveClientId('host', 'projector')).toBe('h:projector');
    // A player trying to look like an agent gets sanitised to a player id.
    expect(resolveClientId('player', 'a:evil')).toBe('p:aevil');
  });

  it('sanitises unsafe characters and empty input', () => {
    expect(resolveClientId('player', 'na me!$%')).toBe('p:name');
    expect(resolveClientId('player', '')).toBe('p:anon');
  });
});

describe('kindFromClientId', () => {
  it('maps the prefix to species; only a: is an agent', () => {
    expect(kindFromClientId('a:matt-fable')).toBe('agent');
    expect(kindFromClientId('p:Priya')).toBe('human');
    expect(kindFromClientId('h:projector')).toBe('human');
  });
});
