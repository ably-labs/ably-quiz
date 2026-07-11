import { describe, expect, it } from 'vitest';
import { authorize } from './authorize';

describe('authorize (§B2.5, no host secret)', () => {
  it('player: open, p: clientId, publish-answers only', () => {
    const d = authorize({ quizId: 'q1', role: 'player', clientId: 'Priya' });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.clientId).toBe('p:Priya');
      expect(d.kind).toBe('human');
      expect(d.capability['quiz-answers:q1']).toEqual(['publish']);
    }
  });

  it('host: allowed with no secret, h: clientId, full caps', () => {
    const d = authorize({ quizId: 'q1', role: 'host' });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.clientId.startsWith('h:')).toBe(true);
      expect(d.capability['quiz:q1']).toEqual(['*']);
    }
  });

  it('agent: allowed with no secret but still needs a slug; scoped to its own session', () => {
    expect(authorize({ quizId: 'q1', role: 'agent' })).toMatchObject({ ok: false, status: 400 });
    const d = authorize({ quizId: 'q1', role: 'agent', slug: 'matt-fable' });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.clientId).toBe('a:matt-fable');
      expect(d.kind).toBe('agent');
      expect(d.capability['quiz-agent:q1:matt-fable']).toEqual(['*']);
    }
  });

  it('rejects invalid quizId and role', () => {
    expect(authorize({ role: 'player' })).toMatchObject({ ok: false, status: 400 });
    expect(authorize({ quizId: 'bad id!', role: 'player' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(authorize({ quizId: 'q1', role: 'spectator' })).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});
