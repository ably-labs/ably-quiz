import { describe, expect, it } from 'vitest';
import { CORE_PACKAGE } from './index';

// Smoke test proving the Vitest harness runs; real engine tests land in S2.
describe('@ably-quiz/core', () => {
  it('exposes its package identity', () => {
    expect(CORE_PACKAGE).toBe('@ably-quiz/core');
  });
});
