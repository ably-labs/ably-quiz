// Mint an "Ably JWT" (verified against ably.com/docs/auth/token/jwt): a JWT
// signed HS256 with the API key SECRET, used directly by the client as its Ably
// token. The key secret never leaves the server. No JWT library — HMAC-SHA256
// via node:crypto is a few lines and keeps the dependency surface minimal.

import { createHmac } from 'node:crypto';

export type AblyJwtParams = {
  /** Full API key name — appId.keyId (the part before the ':' in the key). */
  keyName: string;
  keySecret: string;
  /** Ably capability: resource → operations. Serialised into x-ably-capability. */
  capability: Record<string, string[]>;
  clientId?: string;
  ttlSeconds: number;
  /** Issued-at in Unix seconds; injectable for tests. Defaults to now. */
  nowSeconds?: number;
};

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export function createAblyJwt(params: AblyJwtParams): string {
  const iat = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'HS256', kid: params.keyName };
  const payload: Record<string, unknown> = {
    iat,
    exp: iat + params.ttlSeconds,
    'x-ably-capability': JSON.stringify(params.capability),
  };
  if (params.clientId) payload['x-ably-clientId'] = params.clientId;

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', params.keySecret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

/** Split an Ably API key `appId.keyId:secret` into its name and secret. */
export function splitApiKey(apiKey: string): { keyName: string; keySecret: string } {
  const idx = apiKey.indexOf(':');
  if (idx <= 0 || idx === apiKey.length - 1) {
    throw new Error('Invalid Ably API key (expected "appId.keyId:secret")');
  }
  return { keyName: apiKey.slice(0, idx), keySecret: apiKey.slice(idx + 1) };
}
