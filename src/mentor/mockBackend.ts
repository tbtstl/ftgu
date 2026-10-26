// A practice backend that runs in the reader's browser, so the mentor can be built and tried
// before the server exists. It signs anyone in, keeps conversations in local storage, gives
// FREE_MESSAGES free messages, then charges against a pretend Payfer limit. Its answers say
// plainly that they're placeholders.

import { FREE_MESSAGES, PRICE_CENTS } from './offer';
import { MentorError, type Account, type AskRequest, type Message, type MentorBackend, type PayferLink, type SignInMethod } from './types';

const KEY = 'emc.mentor.mock.v1';

interface Stored {
  account: Omit<Account, 'blocked'> | null;
  /** Payfer stopped charging for this site (the reader revoked it) or ran out of funds. */
  revoked?: boolean;
  balanceEmpty?: boolean;
  history: Record<string, Message[]>;
}

export interface MockOptions {
  /** Milliseconds between streamed words, and the pause before sign-in and Payfer finish. */
  latency?: number;
  /** Start from this state instead of local storage (tests). */
  initial?: Stored;
  persist?: boolean;
}

function nextMonth(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

function load(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored;
  } catch {
    // Start empty.
  }
  return { account: null, history: {} };
}

let seq = 0;
function id(): string {
  seq += 1;
  return `${Date.now().toString(36)}-${seq}`;
}

export function createMockBackend({ latency = 30, initial, persist = !initial }: MockOptions = {}): MentorBackend {
  const db: Stored = initial ?? load();
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  function save() {
    if (!persist) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      // The conversation just won't survive a reload.
    }
  }

  function blocked(a: Omit<Account, 'blocked'>): Account['blocked'] {
    if (a.freeLeft > 0) return null;
    if (!a.payfer) return 'connect';
    if (db.revoked) return 'revoked';
    if (db.balanceEmpty) return 'funding';
    if (a.payfer.leftCents < a.priceCents) return 'limit';
    return null;
  }

  function current(): Account | null {
    const a = db.account;
    if (!a) return null;
    // A new month restores the whole limit.
    if (a.payfer && a.payfer.resets <= new Date().toISOString().slice(0, 10)) {
      a.payfer = { ...a.payfer, leftCents: a.payfer.limitCents, resets: nextMonth() };
      save();
    }
    return { ...a, blocked: blocked(a) };
  }

  function start(via: SignInMethod, email: string | null): Account {
    if (!db.account) db.account = { email, via, freeLeft: FREE_MESSAGES, priceCents: PRICE_CENTS, payfer: null };
    else db.account = { ...db.account, email, via };
    save();
    return current()!;
  }

  function reply(req: AskRequest): string {
    const about = req.quote ? `the passage you highlighted in lesson ${req.lessonId}` : `lesson ${req.lessonId}, ${req.lessonTitle.charAt(0).toLowerCase()}${req.lessonTitle.slice(1)}`;
    return (
      `This is the practice mentor, which runs in your browser and can’t really answer yet. ` +
      `With the server connected, your question about ${about} would go to the model along with the lesson and everything you’ve asked in this course.\n\n` +
      `You asked: “${req.text}”`
    );
  }

  return {
    async account() {
      return current();
    },

    async signIn(method) {
      await wait(latency * 4);
      return start(method, 'you@example.com');
    },

    async sendCode(email) {
      await wait(latency * 4);
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new MentorError('failed', 'Enter an email address, like you@example.com.');
    },

    async verifyCode(email, code) {
      await wait(latency * 4);
      if (!/^\d{6}$/.test(code)) throw new MentorError('bad_code', 'The code is 6 digits.');
      return start('email', email.trim());
    },

    async signOut() {
      db.account = null;
      save();
    },

    async history(courseId) {
      return [...(db.history[courseId] ?? [])];
    },

    async ask(req, onDelta) {
      const before = current();
      if (!before) throw new MentorError('failed', 'Sign in first.');
      if (before.blocked) throw new MentorError(before.blocked);
      const a = db.account!;
      if (a.freeLeft > 0) a.freeLeft -= 1;
      else if (a.payfer) a.payfer = { ...a.payfer, leftCents: a.payfer.leftCents - a.priceCents };
      save();

      const now = new Date().toISOString();
      const question: Message = { id: id(), role: 'you', text: req.text, quote: req.quote, lessonId: req.lessonId, at: now };
      const text = reply(req);
      for (const word of text.split(/(?<= )/)) {
        await wait(latency);
        onDelta(word);
      }
      const answer: Message = { id: id(), role: 'mentor', text, lessonId: req.lessonId, at: new Date().toISOString() };
      db.history[req.courseId] = [...(db.history[req.courseId] ?? []), question, answer];
      save();
      return { question, answer, account: current()! };
    },

    async clear(courseId) {
      delete db.history[courseId];
      save();
    },

    async connectPayfer(limitCents) {
      await wait(latency * 20);
      const link: PayferLink = { limitCents, leftCents: limitCents, resets: nextMonth() };
      db.account = { ...db.account!, payfer: link };
      db.revoked = false;
      db.balanceEmpty = false;
      save();
      return current()!;
    },

    async managePayfer() {
      // Stands in for the reader raising their limit by $5 and topping up on Payfer's page.
      await wait(latency * 20);
      const a = db.account!;
      if (a.payfer) a.payfer = { ...a.payfer, limitCents: a.payfer.limitCents + 500, leftCents: a.payfer.leftCents + 500 };
      db.revoked = false;
      db.balanceEmpty = false;
      save();
      return current()!;
    },
  };
}
