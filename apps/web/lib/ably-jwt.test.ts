import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAblyJwt, splitApiKey } from './ably-jwt';

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('splitApiKey', () => {
  it('splits appId.keyId:secret', () => {
    expect(splitApiKey('abc.def:secretpart')).toEqual({
      keyName: 'abc.def',
      keySecret: 'secretpart',
    });
  });

  it('rejects malformed keys', () => {
    expect(() => splitApiKey('nocolon')).toThrow();
    expect(() => splitApiKey(':leading')).toThrow();
    expect(() => splitApiKey('trailing:')).toThrow();
  });
});

describe('createAblyJwt', () => {
  const params = {
    keyName: 'app.key',
    keySecret: 'shh',
    capability: { 'quiz:q1': ['subscribe'] },
    clientId: 'p:Priya',
    ttlSeconds: 3600,
    nowSeconds: 1000,
  };

  it('produces the Ably JWT header (typ/alg/kid)', () => {
    const parts = createAblyJwt(params).split('.');
    expect(decode(parts[0]!)).toEqual({ typ: 'JWT', alg: 'HS256', kid: 'app.key' });
  });

  it('sets iat/exp in seconds, capability as a JSON string, and the clientId', () => {
    const payload = decode(createAblyJwt(params).split('.')[1]!);
    expect(payload.iat).toBe(1000);
    expect(payload.exp).toBe(4600);
    expect(payload['x-ably-capability']).toBe('{"quiz:q1":["subscribe"]}');
    expect(payload['x-ably-clientId']).toBe('p:Priya');
  });

  it('omits x-ably-clientId when no clientId is given', () => {
    const payload = decode(createAblyJwt({ ...params, clientId: undefined }).split('.')[1]!);
    expect(payload['x-ably-clientId']).toBeUndefined();
  });

  it('is signed HS256 with the key secret (and only that secret verifies)', () => {
    const parts = createAblyJwt(params).split('.');
    const signingInput = `${parts[0]}.${parts[1]}`;
    const good = createHmac('sha256', 'shh').update(signingInput).digest('base64url');
    const bad = createHmac('sha256', 'wrong').update(signingInput).digest('base64url');
    expect(parts[2]).toBe(good);
    expect(parts[2]).not.toBe(bad);
  });
});
