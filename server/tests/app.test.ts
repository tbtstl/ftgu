// @vitest-environment node
// The mentor server's API with stand-ins for Privy, Payfer and Claude: free messages first, then
// Payfer charges, refunds when no answer comes back, and the course conversation.

import { describe, expect, it } from 'vitest';
import { PayferError, type Allowance, type Payment } from 'payfer/server';
import { FREE_MESSAGES } from '../../src/mentor/offer';
import type { Message } from '../../src/mentor/types';
import { createApp } from '../src/app';
import { HttpError, readerFromLinked } from '../src/auth';
import { historyParams, type Answer } from '../src/model';
import type { Payments } from '../src/payments';
import { openStore } from '../src/store';

const AUTH = { authorization: 'Bearer token-1' };

/** A response's JSON body, loosely typed for assertions. */
const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();

function fakePayments() {
  const state = {
    remaining: '5.00',
    status: 'active' as Allowance['status'],
    fail: null as PayferError['code'] | null,
    charges: [] as Array<{ amount: string; idempotencyKey: string }>,
    refunds: [] as string[],
  };
  const payments: Payments = {
    async verifyConnection(c) {
      return { paymentUserId: c.paymentUserId };
    },
    async getAllowance({ paymentUserId }) {
      return {
        paymentUserId,
        status: state.status,
        amount: '5.00',
        spent: '0',
        reserved: '0',
        remaining: state.remaining,
        period: 'month',
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-11-01T00:00:00.000Z',
        version: 1,
      };
    },
    async charge(p) {
      if (state.fail) throw new PayferError(state.fail, state.fail, 402);
      state.charges.push({ amount: p.amount, idempotencyKey: p.idempotencyKey });
      return { id: `pay-${state.charges.length}` } as Payment;
    },
    async refund(p) {
      state.refunds.push(p.paymentId);
      return {};
    },
  };
  return { state, payments };
}

function setup(answer: (onText: (d: string) => void) => Promise<Answer> = async (onText) => {
  onText('Hello ');
  onText('there.');
  return { text: 'Hello there.', refused: false };
}) {
  const store = openStore(':memory:');
  const pay = fakePayments();
  const asked: Array<{ history: Message[] }> = [];
  const app = createApp({
    store,
    verify: async (token) => {
      if (token !== 'token-1') throw new HttpError(401, 'unauthenticated');
      return { id: 'did:privy:1', email: 'reader@example.com', via: 'email' };
    },
    payments: pay.payments,
    payferPublishableKey: 'pk_test_example',
    model: async ({ history }, onText) => {
      asked.push({ history });
      return answer(onText);
    },
    origins: ['http://localhost:5173'],
  });
  const ask = (text = 'Why?') =>
    app.request('/api/courses/electricity/ask', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId: '4.4', lessonTitle: 'Marginal pricing and market clearing', text, quote: 'every plant that runs is paid that one price', lessonText: 'Lesson text.', solved: ['4.3'] }),
    });
  const lines = async (res: Response) =>
    (await res.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
  const account = async () => (await json(app.request('/api/account', { headers: AUTH }))).account;
  return { app, store, pay, asked, ask, lines, account };
}

describe('mentor server', () => {
  it('turns away requests without a Privy token, except for the site config', async () => {
    const { app } = setup();
    expect(await json(app.request('/api/config'))).toEqual({ payferPublishableKey: 'pk_test_example' });
    expect((await app.request('/api/account')).status).toBe(401);
    expect((await app.request('/api/account', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('streams an answer, spends a free message and keeps the conversation', async () => {
    const { ask, lines, account, app, asked } = setup();
    expect((await account()).freeLeft).toBe(FREE_MESSAGES);

    const events = await lines(await ask());
    expect(events.filter((e) => e.type === 'delta').map((e) => e.text)).toEqual(['Hello ', 'there.']);
    const done = events.at(-1);
    expect(done.type).toBe('done');
    expect(done.question).toMatchObject({ role: 'you', text: 'Why?', quote: 'every plant that runs is paid that one price', lessonId: '4.4' });
    expect(done.answer).toMatchObject({ role: 'mentor', text: 'Hello there.' });
    expect(done.account.freeLeft).toBe(FREE_MESSAGES - 1);

    // The next question carries the conversation so far.
    await ask('And then?');
    expect(asked[1].history.map((m) => m.role)).toEqual(['you', 'mentor']);
    const { messages } = await json(app.request('/api/courses/electricity/messages', { headers: AUTH }));
    expect(messages).toHaveLength(4);

    expect((await app.request('/api/courses/electricity/messages', { method: 'DELETE', headers: AUTH })).status).toBe(204);
    expect((await json(app.request('/api/courses/electricity/messages', { headers: AUTH }))).messages).toEqual([]);
  });

  it('asks for Payfer once the free messages are gone, then charges 1¢ a message', async () => {
    const { ask, lines, account, app, pay, store } = setup();
    await account();
    for (let i = 0; i < FREE_MESSAGES; i++) store.takeFree('did:privy:1');
    expect((await account()).blocked).toBe('connect');
    const refused = await ask();
    expect(refused.status).toBe(402);
    expect(await refused.json()).toEqual({ error: 'connect' });

    const linked = await app.request('/api/payfer/connect', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ paymentUserId: 'pu_1', connectionProof: 'proof' }),
    });
    const { account: after } = await json(linked);
    expect(after).toMatchObject({ blocked: null, payfer: { limitCents: 500, leftCents: 500, resets: '2026-11-01' } });

    const events = await lines(await ask());
    expect(events.at(-1).type).toBe('done');
    expect(pay.state.charges).toHaveLength(1);
    expect(pay.state.charges[0].amount).toBe('0.01');
    expect(pay.state.charges[0].idempotencyKey).toMatch(/^ask-/);
  });

  it('passes on Payfer’s reasons for refusing a charge', async () => {
    const { ask, account, app, pay, store } = setup();
    await account();
    for (let i = 0; i < FREE_MESSAGES; i++) store.takeFree('did:privy:1');
    store.linkPayfer('did:privy:1', 'pu_1');

    pay.state.fail = 'allowance_exceeded';
    expect(await (await ask()).json()).toEqual({ error: 'limit' });

    // An empty balance doesn't show in the allowance, so it's remembered until the reader fixes it.
    pay.state.fail = 'funding_required';
    expect(await (await ask()).json()).toEqual({ error: 'funding' });
    expect((await account()).blocked).toBe('funding');
    pay.state.fail = null;
    const { account: refreshed } = await json(app.request('/api/payfer/refresh', { method: 'POST', headers: AUTH }));
    expect(refreshed.blocked).toBeNull();

    pay.state.status = 'revoked';
    expect((await account()).blocked).toBe('revoked');
    pay.state.status = 'active';
    pay.state.remaining = '0.00';
    expect((await account()).blocked).toBe('limit');
  });

  it('undoes the question and the charge when no answer comes back', async () => {
    let mode: 'refuse' | 'fail' = 'refuse';
    const { ask, lines, account, pay, store, app } = setup(async (onText) => {
      if (mode === 'fail') throw new Error('overloaded');
      onText('Partial');
      return { text: 'Partial', refused: true };
    });
    await account();

    // A free message comes back.
    expect((await lines(await ask())).at(-1)).toEqual({ type: 'error', code: 'refused' });
    expect((await account()).freeLeft).toBe(FREE_MESSAGES);

    // A paid one is refunded.
    for (let i = 0; i < FREE_MESSAGES; i++) store.takeFree('did:privy:1');
    store.linkPayfer('did:privy:1', 'pu_1');
    mode = 'fail';
    expect((await lines(await ask())).at(-1)).toEqual({ type: 'error', code: 'failed' });
    expect(pay.state.refunds).toEqual(['pay-1']);
    expect((await json(app.request('/api/courses/electricity/messages', { headers: AUTH }))).messages).toEqual([]);
  });

  it('rejects unknown courses, lessons from another course and empty questions', async () => {
    const { app, lines } = setup();
    const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { ...AUTH, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/api/courses/cheese/ask', { lessonId: '1.1', text: 'Hi' })).status).toBe(404);
    expect((await post('/api/courses/electricity/ask', { lessonId: '1.1', text: '  ' })).status).toBe(400);
    expect((await post('/api/courses/gas/ask', { lessonId: '1.1', text: 'Hi' })).status).toBe(400);
    expect((await post('/api/courses/electricity/ask', { lessonId: 'gas/1.1', text: 'Hi' })).status).toBe(400);
    // Each course keeps its own conversation.
    expect((await lines(await post('/api/courses/gas/ask', { lessonId: 'gas/1.1', text: 'Hi' }))).at(-1).type).toBe('done');
    expect((await json(app.request('/api/courses/gas/messages', { headers: AUTH }))).messages).toHaveLength(2);
    expect((await json(app.request('/api/courses/electricity/messages', { headers: AUTH }))).messages).toHaveLength(0);
  });
});

describe('prompt and identity', () => {
  const msg = (i: number): Message => ({ id: String(i), role: i % 2 ? 'mentor' : 'you', text: `m${i}`, lessonId: '4.4', at: '' });

  it('sends recent history in steps, always starting with the reader', () => {
    expect(historyParams([msg(1), msg(2), msg(3)]).map((m) => m.role)).toEqual(['user', 'assistant']);
    const long = Array.from({ length: 45 }, (_, i) => msg(i));
    const sent = historyParams(long);
    expect(sent).toHaveLength(35);
    expect(sent[0].role).toBe('user');
    // One more message doesn't move the start, so the cached prefix still matches.
    expect(historyParams([...long, msg(45)])[0]).toEqual(sent[0]);
  });

  it('reads the email and sign-in method from Privy’s linked accounts', () => {
    expect(readerFromLinked('did:1', [{ type: 'email', address: 'A@B.co', verified_at: 1 }])).toEqual({ id: 'did:1', email: 'a@b.co', via: 'email' });
    expect(readerFromLinked('did:2', [{ type: 'google_oauth', email: 'g@x.co' }])).toEqual({ id: 'did:2', email: 'g@x.co', via: 'google' });
    expect(readerFromLinked('did:3', [{ type: 'passkey' }])).toEqual({ id: 'did:3', email: null, via: 'passkey' });
  });
});
