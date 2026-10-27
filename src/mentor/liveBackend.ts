// The real backend: Privy signs the reader in with an emailed code (the session stays in this
// browser), Payfer's client links their payment account, and the mentor server (server/) does
// the rest. Loaded only when VITE_MENTOR=live, so the practice build doesn't carry these SDKs.

import Privy, { LocalStorage, PrivyApiError } from '@privy-io/js-sdk-core';
import { createClient, type PayferClient } from 'payfer';
import { MentorError, type Account, type Blocked, type Message, type MentorBackend } from './types';

export interface LiveOptions {
  /** The mentor server's address; empty for the same origin (the dev server proxies /api). */
  api: string;
  privyAppId: string;
  /** Payfer's publishable key; empty to use the one the server pairs with its secret key. */
  payferKey: string;
}

const BLOCKED = new Set<string>(['connect', 'funding', 'limit', 'revoked']);

/** Why Privy turned down a sign-in step, when it's something other than what the reader typed. */
function privyReason(err: unknown): string | null {
  console.error(err);
  if (!(err instanceof PrivyApiError)) return null;
  if ((err.code as string) === 'invalid_origin') return `Sign-in isn’t allowed from ${window.location.origin} yet. Add it to the Privy app’s allowed domains.`;
  if (err.status === 429) return 'Too many tries. Wait a minute, then try again.';
  return null;
}

/**
 * A window for Payfer's page, opened while the click is still being handled (popup blockers
 * allow that, but not a window opened after the request for the page's address comes back).
 */
function payferWindow() {
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  return {
    show(url: string) {
      if (win && !win.closed) win.location.href = url;
      else window.open(url, '_blank', 'noopener');
    },
    close() {
      if (win && !win.closed && win.location.href === 'about:blank') win.close();
    },
  };
}

export function createLiveBackend({ api, privyAppId, payferKey }: LiveOptions): MentorBackend {
  const privy = new Privy({ appId: privyAppId, storage: new LocalStorage() });
  const ready = privy.initialize();
  let payfer: PayferClient | null = null;
  let hosted: ReturnType<typeof payferWindow> | null = null;

  let publishable: Promise<string> | null = null;
  function publishableKey(): Promise<string> {
    publishable ??= payferKey
      ? Promise.resolve(payferKey)
      : fetch(`${api}/api/config`)
          .then((r) => r.json() as Promise<{ payferPublishableKey: string | null }>)
          .then((c) => c.payferPublishableKey ?? '')
          .catch((err) => {
            publishable = null;
            throw err;
          });
    return publishable;
  }

  // One Payfer client per page: it holds the token that lets manage() reopen Payfer.
  async function payferClient(): Promise<PayferClient> {
    if (payfer) return payfer;
    const key = await publishableKey();
    if (!key) throw new MentorError('failed', 'Payments aren’t set up on this site yet.');
    return (payfer ??= createClient({ publishableKey: key, openHostedUrl: (url) => hosted?.show(url) }));
  }

  /** Runs a Payfer flow in a window opened now, closing it if the flow fails before Payfer's page loads. */
  async function inPayferWindow<T>(flow: () => Promise<T>): Promise<T> {
    hosted = payferWindow();
    try {
      return await flow();
    } catch (err) {
      hosted.close();
      throw err;
    }
  }

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    await ready;
    const token = await privy.getAccessToken();
    if (!token) throw new MentorError('failed', 'Sign in first.');
    const res = await fetch(api + path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
    if (res.ok) return res;
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (body.error && BLOCKED.has(body.error)) throw new MentorError(body.error as Blocked);
    throw new MentorError('failed', body.message ?? 'The mentor server didn’t answer.');
  }

  const json = async <T,>(path: string, init?: RequestInit) => (await (await request(path, init)).json()) as T;

  async function connect(limitCents: number): Promise<Account> {
    const c = await (await payferClient()).connect({ allowance: { amount: (limitCents / 100).toFixed(2), period: 'month' } });
    const { account } = await json<{ account: Account }>('/api/payfer/connect', {
      method: 'POST',
      body: JSON.stringify({ paymentUserId: c.paymentUserId, connectionProof: c.connectionProof }),
    });
    return account;
  }

  return {
    signInMethods: ['email'],

    async account() {
      await ready;
      if (!(await privy.getAccessToken())) return null;
      try {
        return (await json<{ account: Account }>('/api/account')).account;
      } catch {
        return null;
      }
    },

    async signIn() {
      throw new MentorError('failed', 'Only email sign-in is set up.');
    },

    async sendCode(email) {
      await ready;
      try {
        await privy.auth.email.sendCode(email.trim());
      } catch (err) {
        throw new MentorError('failed', privyReason(err) ?? 'We couldn’t send a code to that address. Check it and try again.');
      }
    },

    async verifyCode(email, code) {
      await ready;
      try {
        await privy.auth.email.loginWithCode(email.trim(), code);
      } catch (err) {
        throw new MentorError('bad_code', privyReason(err) ?? 'That code didn’t work. Check it, or send a new one.');
      }
      return (await json<{ account: Account }>('/api/account')).account;
    },

    async signOut() {
      await ready;
      await privy.auth.logout();
      payfer = null;
    },

    async history(courseId) {
      return (await json<{ messages: Message[] }>(`/api/courses/${courseId}/messages`)).messages;
    },

    async ask(req, onDelta) {
      const res = await request(`/api/courses/${req.courseId}/ask`, { method: 'POST', body: JSON.stringify(req) });
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const event = JSON.parse(buffer.slice(0, nl)) as
            | { type: 'delta'; text: string }
            | { type: 'done'; question: Message; answer: Message; account: Account }
            | { type: 'error'; code: string };
          buffer = buffer.slice(nl + 1);
          if (event.type === 'delta') onDelta(event.text);
          else if (event.type === 'done') return { question: event.question, answer: event.answer, account: event.account };
          else throw new MentorError(event.code === 'refused' ? 'refused' : 'failed');
        }
      }
      throw new MentorError('failed');
    },

    async clear(courseId) {
      await request(`/api/courses/${courseId}/messages`, { method: 'DELETE' });
    },

    connectPayfer: (limitCents) => inPayferWindow(() => connect(limitCents)),

    managePayfer: () =>
      inPayferWindow(async () => {
        // Payfer's browser token lasts only as long as the page, so after a reload changing the
        // limit means approving it again.
        if (payfer?.paymentUserId) await payfer.manage();
        else await connect((await json<{ account: Account }>('/api/account')).account.payfer?.limitCents ?? 500);
        return (await json<{ account: Account }>('/api/payfer/refresh', { method: 'POST' })).account;
      }),
  };
}
