// Role authorization for /api/ably-auth (§B2.5, revised). Pure and server-side:
// decides role, clientId, and capability from a request. Kept separate from the
// route handler so it is unit-testable without Next.
//
// No host secret: this is a free-tier demo on an unguessable quiz id, and Ably
// caps the blast radius, so hosting is open (Matt, 2026-07-11 — see PROGRESS
// Deviations). Roles still fix the clientId prefix + capabilities.

import { randomBytes } from 'node:crypto';
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
};

export type AuthDecision =
  | { ok: true; role: Role; clientId: string; kind: Kind; capability: Capability }
  | { ok: false; status: number; error: string };

const ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function authorize(body: AuthRequestBody): AuthDecision {
  const quizId = typeof body.quizId === 'string' ? body.quizId.trim() : '';
  if (!ID.test(quizId)) return { ok: false, status: 400, error: 'invalid or missing quizId' };

  const role = body.role;
  if (role !== 'player' && role !== 'host' && role !== 'agent') {
    return { ok: false, status: 400, error: 'invalid role' };
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
