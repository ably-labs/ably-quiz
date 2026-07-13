// Auth model (§B2.5). Pure, isomorphic — the capability matrix and clientId
// rules live here so they can be unit-tested without Ably or a server. The JWT
// is signed server-side (apps/web) where the API key secret lives.

import { agentChannel, agentChannelPattern, answersChannel, mainChannel } from './channels';

export type Role = 'player' | 'host' | 'agent';

/** Species shown on the scoreboard — derived from the clientId prefix, which
 *  auth controls, so an agent can't masquerade as a human or vice versa. */
export type Kind = 'human' | 'agent';

/** Ably capability: resource (channel/pattern) → allowed operations. */
export type Capability = Record<string, string[]>;

/** clientId prefix per role. `a:` ⇒ agent; everything else ⇒ human. */
export const CLIENT_ID_PREFIX: Record<Role, string> = {
  player: 'p',
  host: 'h',
  agent: 'a',
};

/**
 * The capability matrix (§B2.5), using the deviation channel names:
 * - player: main subscribe/presence + read LiveObjects + history; publish answers only.
 * - host/quizmaster: full on all three of this quiz's channel groups.
 * - agent: main subscribe/presence + history; publish answers; full on its OWN session.
 *
 * `history` on the main channel lets a refreshed player/agent re-derive the
 * in-flight question (broadcast as control, not held in LiveObjects — §B2.3)
 * so they rejoin mid-question seamlessly (§B3 S3.5). The host reads both
 * channels' history to rebuild the quizmaster on refresh; it has `*`.
 */
export function buildCapability(role: Role, quizId: string, slug?: string): Capability {
  const main = mainChannel(quizId);
  const answers = answersChannel(quizId);

  switch (role) {
    case 'player':
      return {
        [main]: ['subscribe', 'presence', 'object-subscribe', 'history'],
        [answers]: ['publish'],
        // Read the agents' live think-aloud (§S4.5). Subscribe-only: players and
        // /screen watch the on-screen thinking; only the agent turn publishes.
        [agentChannelPattern(quizId)]: ['subscribe', 'history'],
      };
    case 'host':
      return {
        [main]: ['*'],
        [answers]: ['*'],
        [agentChannelPattern(quizId)]: ['*'],
      };
    case 'agent': {
      if (!slug) throw new Error('agent capability requires a slug');
      return {
        [main]: ['subscribe', 'presence', 'history'],
        [answers]: ['publish'],
        [agentChannel(quizId, slug)]: ['*'],
      };
    }
  }
}

const UNSAFE = /[^a-zA-Z0-9_-]/g;

/**
 * Enforce the role's clientId prefix. The prefix is authoritative (from the
 * server-verified role), so a player asking for base `a:evil` becomes
 * `p:aevil`, never an agent id.
 */
export function resolveClientId(role: Role, base: string): string {
  const clean = base.replace(UNSAFE, '').slice(0, 64) || 'anon';
  return `${CLIENT_ID_PREFIX[role]}:${clean}`;
}

export function kindFromClientId(clientId: string): Kind {
  return clientId.startsWith(`${CLIENT_ID_PREFIX.agent}:`) ? 'agent' : 'human';
}
