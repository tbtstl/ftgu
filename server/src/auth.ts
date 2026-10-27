// Who's asking: every request carries the reader's Privy access token. The token is checked
// locally; the reader's linked accounts (for their email and how they signed in) come from Privy
// and are kept for a few minutes so a conversation doesn't look them up on every message.

import { PrivyClient } from '@privy-io/node';
import type { SignInMethod } from '../../src/mentor/types';
import { config } from './config';

export interface Reader {
  id: string;
  email: string | null;
  via: SignInMethod;
}

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 402 | 404 | 502 | 503,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

export type VerifyReader = (token: string) => Promise<Reader>;

const KEEP_MS = 5 * 60_000;

/** Turns the Privy user's linked accounts into an email and a sign-in method. */
export function readerFromLinked(id: string, linked: ReadonlyArray<{ type: string; address?: string; email?: string | null; verified_at?: number | null }>): Reader {
  const has = (type: string) => linked.find((a) => a.type === type);
  const emailAccount = has('email');
  const google = has('google_oauth');
  const apple = has('apple_oauth');
  const via: SignInMethod = google ? 'google' : apple ? 'apple' : has('passkey') ? 'passkey' : 'email';
  const email = (emailAccount?.verified_at ? emailAccount.address : null) ?? google?.email ?? apple?.email ?? null;
  return { id, email: email ? email.trim().toLowerCase() : null, via };
}

export function privyVerifier(): VerifyReader {
  let client: PrivyClient | null = null;
  const known = new Map<string, { reader: Reader; until: number }>();
  return async (token) => {
    if (!config.privyAppId || !config.privyAppSecret) throw new HttpError(503, 'auth_not_configured', 'Sign-in isn’t set up on this server.');
    client ??= new PrivyClient({ appId: config.privyAppId, appSecret: config.privyAppSecret });
    let userId: string;
    try {
      userId = (await client.utils().auth().verifyAccessToken(token)).user_id;
    } catch {
      throw new HttpError(401, 'unauthenticated', 'Sign in again.');
    }
    const hit = known.get(userId);
    if (hit && hit.until > Date.now()) return hit.reader;
    const user = await client.users()._get(userId);
    const reader = readerFromLinked(user.id, user.linked_accounts as Parameters<typeof readerFromLinked>[1]);
    known.set(userId, { reader, until: Date.now() + KEEP_MS });
    return reader;
  };
}
