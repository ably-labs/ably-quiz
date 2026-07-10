import { describe, expect, it } from 'vitest';
import { authorize } from './authorize';

const HOST_KEY = 'host-secret-123';

describe('authorize (§B2.5 role gating)', () => {
  it('player is open (no hostKey) and gets a p: clientId', () => {
    const d = authorize({ quizId: 'q1', role: 'player', clientId: 'Priya' }, HOST_KEY);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.clientId).toBe('p:Priya');
      expect(d.kind).toBe('human');
      expect(d.capability['quiz-answers:q1']).toEqual(['publish']);
    }
  });

  it('host requires the correct hostKey', () => {
    expect(authorize({ quizId: 'q1', role: 'host' }, HOST_KEY)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(authorize({ quizId: 'q1', role: 'host', hostKey: 'nope' }, HOST_KEY)).toMatchObject({
      ok: false,
      status: 403,
    });
    const d = authorize({ quizId: 'q1', role: 'host', hostKey: HOST_KEY }, HOST_KEY);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.clientId.startsWith('h:')).toBe(true);
  });

  it('agent requires hostKey + slug and is scoped to its own session', () => {
    expect(authorize({ quizId: 'q1', role: 'agent', slug: 'matt-fable' }, HOST_KEY)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(authorize({ quizId: 'q1', role: 'agent', hostKey: HOST_KEY }, HOST_KEY)).toMatchObject({
      ok: false,
      status: 400,
    });
    const d = authorize(
      { quizId: 'q1', role: 'agent', hostKey: HOST_KEY, slug: 'matt-fable' },
      HOST_KEY,
    );
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.clientId).toBe('a:matt-fable');
      expect(d.kind).toBe('agent');
      expect(d.capability['quiz-agent:q1:matt-fable']).toEqual(['*']);
    }
  });

  it('rejects invalid quizId and role', () => {
    expect(authorize({ role: 'player' }, HOST_KEY)).toMatchObject({ ok: false, status: 400 });
    expect(authorize({ quizId: 'bad id!', role: 'player' }, HOST_KEY)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(authorize({ quizId: 'q1', role: 'spectator' }, HOST_KEY)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('fails closed when HOST_KEY is not configured', () => {
    expect(authorize({ quizId: 'q1', role: 'host', hostKey: 'x' }, undefined)).toMatchObject({
      ok: false,
      status: 500,
    });
  });
});
