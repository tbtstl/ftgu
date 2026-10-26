// The mentor's HTTP API. Everything but the health check and the site config needs a signed-in reader.
//
//   GET    /api/config                       the Payfer publishable key for the browser
//   GET    /api/account                      who's signed in and what they can spend
//   POST   /api/payfer/connect               link the Payfer account a reader just approved
//   POST   /api/payfer/refresh               re-read the allowance after the reader changed it
//   GET    /api/courses/:course/messages     the course's conversation
//   DELETE /api/courses/:course/messages     start the course over
//   POST   /api/courses/:course/ask          pay for and stream one answer, as NDJSON lines:
//                                            {type:"delta",text} … then {type:"done",question,answer,account}
//                                            or {type:"error",code}

import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { AGRICULTURE } from '../../src/course/outlines/agriculture';
import { COMPUTE } from '../../src/course/outlines/compute';
import { ELECTRICITY } from '../../src/course/outlines/electricity';
import { GAS } from '../../src/course/outlines/gas';
import { OIL } from '../../src/course/outlines/oil';
import { SHIPPING } from '../../src/course/outlines/shipping';
import { WEATHER } from '../../src/course/outlines/weather';
import { FREE_MESSAGES, PRICE_CENTS } from '../../src/mentor/offer';
import type { Account, AskRequest, Blocked, Message, PayferLink } from '../../src/mentor/types';
import { HttpError, type Reader, type VerifyReader } from './auth';
import type { AskModel } from './model';
import { blockedBy, toAmount, toCents, type Payments } from './payments';
import type { ReaderRow, Store } from './store';

/** Every course has a mentor: course slug → title. */
export const COURSES: Record<string, string> = Object.fromEntries(
  [ELECTRICITY, GAS, AGRICULTURE, OIL, WEATHER, SHIPPING, COMPUTE].map((c) => [c.slug, c.title]),
);

/** "4.4" for electricity, "gas/3.4" for the other courses. */
const LESSON_ID = /^(?:[a-z]+\/)?\d+\.\d+$/;

const LIMITS = { text: 4000, quote: 1000, lessonTitle: 200, lessonText: 20_000 };

export interface Deps {
  store: Store;
  verify: VerifyReader;
  payments: Payments | null;
  /** The publishable key matching the Payfer secret key the server uses. */
  payferPublishableKey: string | null;
  model: AskModel;
  origins: string[];
}

type Env = { Variables: { reader: Reader; row: ReaderRow } };

function line(value: unknown): string {
  return JSON.stringify(value) + '\n';
}

function askRequest(body: unknown, courseId: string): AskRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const text = str(b.text, LIMITS.text).trim();
  const lessonId = str(b.lessonId, 32);
  const inCourse = courseId === 'electricity' ? !lessonId.includes('/') : lessonId.startsWith(`${courseId}/`);
  if (!text || !LESSON_ID.test(lessonId) || !inCourse) throw new HttpError(400, 'bad_request', 'A question and a lesson in this course are required.');
  const quote = str(b.quote, LIMITS.quote).trim();
  return {
    courseId,
    lessonId,
    lessonTitle: str(b.lessonTitle, LIMITS.lessonTitle),
    text,
    ...(quote ? { quote } : {}),
    lessonText: str(b.lessonText, LIMITS.lessonText),
    solved: Array.isArray(b.solved) ? b.solved.filter((s): s is string => typeof s === 'string' && LESSON_ID.test(s)).slice(0, 200) : [],
  };
}

export function createApp(deps: Deps) {
  const { store, payments } = deps;
  const app = new Hono<Env>();

  app.use('/api/*', cors({ origin: deps.origins, allowHeaders: ['authorization', 'content-type'], allowMethods: ['GET', 'POST', 'DELETE'] }));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'failed', message: 'Something went wrong.' }, 500);
  });

  app.get('/health', (c) => c.text('ok'));

  app.get('/api/config', (c) => c.json({ payferPublishableKey: deps.payferPublishableKey }));

  // Every other API route knows its reader; the first request creates them with their free messages.
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'OPTIONS' || c.req.path === '/api/config') return next();
    const token = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in first.');
    const reader = await deps.verify(token);
    c.set('reader', reader);
    c.set('row', store.ensureReader(reader.id, reader.email, FREE_MESSAGES));
    await next();
  });

  async function account(reader: Reader): Promise<Account> {
    const row = store.reader(reader.id)!;
    let link: PayferLink | null = null;
    let revoked = false;
    if (row.paymentUserId && payments) {
      try {
        const a = await payments.getAllowance({ paymentUserId: row.paymentUserId });
        revoked = a.status === 'revoked';
        if (a.status === 'active') link = { limitCents: toCents(a.amount), leftCents: toCents(a.remaining), resets: a.periodEnd.slice(0, 10) };
      } catch (err) {
        if (!blockedBy(err)) throw err;
      }
    }
    let blocked: Blocked | null = null;
    if (row.freeLeft <= 0) {
      if (revoked) blocked = 'revoked';
      else if (!link) blocked = 'connect';
      else if (row.blocked === 'funding') blocked = 'funding';
      else if (link.leftCents < PRICE_CENTS) blocked = 'limit';
    }
    return { email: row.email, via: reader.via, freeLeft: row.freeLeft, priceCents: PRICE_CENTS, payfer: link, blocked };
  }

  function course(c: Context<Env>): { id: string; title: string } {
    const id = c.req.param('course') ?? '';
    const title = COURSES[id];
    if (!title) throw new HttpError(404, 'no_such_course');
    return { id, title };
  }

  app.get('/api/account', async (c) => c.json({ account: await account(c.get('reader')) }));

  app.post('/api/payfer/connect', async (c) => {
    if (!payments) throw new HttpError(503, 'payments_not_configured', 'Payments aren’t set up on this server.');
    const body = (await c.req.json().catch(() => ({}))) as { paymentUserId?: unknown; connectionProof?: unknown };
    if (typeof body.paymentUserId !== 'string' || typeof body.connectionProof !== 'string') throw new HttpError(400, 'bad_request');
    const { paymentUserId } = await payments.verifyConnection({ paymentUserId: body.paymentUserId, connectionProof: body.connectionProof });
    store.linkPayfer(c.get('reader').id, paymentUserId);
    return c.json({ account: await account(c.get('reader')) });
  });

  app.post('/api/payfer/refresh', async (c) => {
    store.setBlocked(c.get('reader').id, null);
    return c.json({ account: await account(c.get('reader')) });
  });

  app.get('/api/courses/:course/messages', (c) => c.json({ messages: store.messages(c.get('reader').id, course(c).id) }));

  app.delete('/api/courses/:course/messages', (c) => {
    store.clear(c.get('reader').id, course(c).id);
    return c.body(null, 204);
  });

  app.post('/api/courses/:course/ask', async (c) => {
    const reader = c.get('reader');
    const { id: courseId, title } = course(c);
    const req = askRequest(await c.req.json().catch(() => null), courseId);
    const id = randomUUID();

    // Pay for the question before asking: a free message first, then Payfer.
    let paymentId: string | null = null;
    if (!store.takeFree(reader.id)) {
      const row = store.reader(reader.id)!;
      if (!row.paymentUserId) return c.json({ error: 'connect' }, 402);
      if (!payments) throw new HttpError(503, 'payments_not_configured', 'Payments aren’t set up on this server.');
      try {
        paymentId = (await payments.charge({ paymentUserId: row.paymentUserId, amount: toAmount(PRICE_CENTS), idempotencyKey: `ask-${id}` })).id;
      } catch (err) {
        const blocked = blockedBy(err);
        if (!blocked) throw err;
        if (blocked === 'funding') store.setBlocked(reader.id, 'funding');
        return c.json({ error: blocked }, 402);
      }
      if (row.blocked) store.setBlocked(reader.id, null);
    }
    const undoPayment = async () => {
      if (paymentId && payments) await payments.refund({ paymentId, idempotencyKey: `refund-${id}` }).catch((e) => console.error('refund failed', e));
      else if (!paymentId) store.giveBackFree(reader.id);
    };

    const history = store.messages(reader.id, courseId);
    const question: Message = { id: `${id}-q`, role: 'you', text: req.text, ...(req.quote ? { quote: req.quote } : {}), lessonId: req.lessonId, at: new Date().toISOString() };
    store.addMessage(reader.id, courseId, question);

    c.header('content-type', 'application/x-ndjson; charset=utf-8');
    c.header('cache-control', 'no-store');
    return stream(c, async (out) => {
      const signal = c.req.raw.signal;
      let text = '';
      try {
        const answer = await deps.model({ courseTitle: title, req, history }, (delta) => {
          text += delta;
          void out.write(line({ type: 'delta', text: delta }));
        }, signal);
        if (answer.refused) {
          store.deleteMessage(question.id);
          await undoPayment();
          await out.write(line({ type: 'error', code: 'refused' }));
          return;
        }
        const reply: Message = { id: `${id}-a`, role: 'mentor', text: answer.text.trim(), lessonId: req.lessonId, at: new Date().toISOString() };
        store.addMessage(reader.id, courseId, reply);
        await out.write(line({ type: 'done', question, answer: reply, account: await account(reader) }));
      } catch (err) {
        // A reader who left mid-answer keeps what arrived; otherwise the question is undone and refunded.
        if (signal.aborted && text.trim()) {
          store.addMessage(reader.id, courseId, { id: `${id}-a`, role: 'mentor', text: text.trim(), lessonId: req.lessonId, at: new Date().toISOString() });
          return;
        }
        console.error(err);
        store.deleteMessage(question.id);
        await undoPayment();
        await out.write(line({ type: 'error', code: 'failed' })).catch(() => {});
      }
    });
  });

  return app;
}
