// Role authorization for /api/ably-auth (§B2.5). Pure and server-side: decides
// role, clientId, and capability from a request + the HOST_KEY env. Kept
// separate from the route handler so it is unit-testable without Next.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  buildCapability,
  kindFromClientId,
  resolveClientId,
  type Capability,
  type Kind,
  type Role,
} from '@ably-quiz/core';

export type AuthRequestBody = {
  quizId?: unknown;
  role?: unknown;
  clientId?: unknown;
  slug?: unknown;
  hostKey?: unknown;
};

export type AuthDecision =
  | { ok: true; role: Role; clientId: string; kind: Kind; capability: Capability }
  | { ok: false; status: number; error: string };

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Player is open (honour system, §A1). Host and agent are privileged and gated
 * by HOST_KEY — agents are booted only by the trusted agent host, which holds
 * the key. The role dictates the clientId prefix, so no client can self-elevate.
 */
export function authorize(body: AuthRequestBody, hostKey: string | undefined): AuthDecision {
  const quizId = typeof body.quizId === 'string' ? body.quizId.trim() : '';
  if (!ID.test(quizId)) return { ok: false, status: 400, error: 'invalid or missing quizId' };

  const role = body.role;
  if (role !== 'player' && role !== 'host' && role !== 'agent') {
    return { ok: false, status: 400, error: 'invalid role' };
  }

  if (role === 'host' || role === 'agent') {
    if (!hostKey) return { ok: false, status: 500, error: 'HOST_KEY not configured' };
    const provided = typeof body.hostKey === 'string' ? body.hostKey : '';
    if (!constantTimeEquals(provided, hostKey)) {
      return { ok: false, status: 403, error: 'forbidden' };
    }
  }

  let base: string;
  let slug: string | undefined;
  if (role === 'agent') {
    slug = typeof body.slug === 'string' ? body.slug : '';
    if (!ID.test(slug)) return { ok: false, status: 400, error: 'invalid or missing agent slug' };
    base = slug;
  } else {
    base =
      typeof body.clientId === 'string' && body.clientId.length > 0
        ? body.clientId
        : randomBytes(6).toString('base64url');
  }

  const clientId = resolveClientId(role, base);
  return {
    ok: true,
    role,
    clientId,
    kind: kindFromClientId(clientId),
    capability: buildCapability(role, quizId, slug),
  };
}
