// The course mentor's state: whether the panel is open, who's signed in and what they can
// spend, the course's conversation, and the passage waiting to go into the next question.
// It sits above the router so the conversation carries from lesson to lesson.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { getLesson } from '../course/registry';
import { useProgress } from '../course/progress';
import { createMockBackend } from './mockBackend';
import { MentorError, type Account, type Blocked, type Message, type MentorBackend, type SignInMethod } from './types';

// The mentor is switched on per build: VITE_MENTOR=mock runs the practice backend in the
// browser (the default for `npm run dev`); production builds leave it off until the server exists.
export const MENTOR_ENABLED = (import.meta.env.VITE_MENTOR ?? (import.meta.env.DEV ? 'mock' : 'off')) === 'mock';

/** Width of the panel when it's docked beside the lesson. */
export const MENTOR_WIDTH = 380;
/** Narrower than this, the panel is a sheet over the bottom of the lesson instead. */
const DOCK_QUERY = '(min-width: 1024px)';

/** Only electricity is written so far; every course gets its own mentor. */
export const COURSE = { id: 'electricity', title: 'Electricity & Energy Markets' };

const OPEN_KEY = 'emc.mentor.open.v1';

export type Modal = 'signin' | 'payfer' | 'fresh' | null;

export interface Quote {
  text: string;
  lessonId: string;
}

export interface Mentor {
  lessonId: string | null;
  open: boolean;
  /** Docked beside the lesson (wide windows) rather than a sheet over it. */
  docked: boolean;
  /** Width the lesson should leave free for the panel. */
  reserve: number;
  /** The account has been looked up (signed in or not). */
  ready: boolean;
  account: Account | null;
  messages: Message[];
  quote: Quote | null;
  draft: string;
  /** The question in flight and the answer so far. */
  pending: { question: Message; answer: string } | null;
  error: string | null;
  modal: Modal;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  setOpen: (open: boolean) => void;
  setDraft: (draft: string) => void;
  setModal: (modal: Modal) => void;
  /** Bring a lesson passage into the next question and open the panel at the composer. */
  attach: (text: string) => void;
  clearQuote: () => void;
  send: (text: string, quote?: Quote | null) => Promise<void>;
  explain: (text: string) => void;
  signIn: (method: Exclude<SignInMethod, 'email'>) => Promise<Account>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<Account>;
  signOut: () => Promise<void>;
  connectPayfer: (limitCents: number) => Promise<Account>;
  managePayfer: () => Promise<void>;
  startFresh: () => Promise<void>;
}

const MentorContext = createContext<Mentor | null>(null);

/** The mentor, or null where it's switched off (and in lessons rendered on their own). */
export function useMentor(): Mentor | null {
  return useContext(MentorContext);
}

function subscribeDock(cb: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(DOCK_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function dockSnapshot() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DOCK_QUERY).matches;
}

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** The lesson as the reader sees it, trimmed to a size a prompt can carry. */
function lessonText(): string {
  const main = document.querySelector<HTMLElement>('main.art .tu-text') ?? document.querySelector<HTMLElement>('main.art');
  const text = main ? (main.innerText ?? main.textContent ?? '') : '';
  return text.replace(/\n{3,}/g, '\n\n').trim().slice(0, 20_000);
}

let defaultBackend: MentorBackend | null = null;

export function MentorProvider({ lessonId, backend, children }: { lessonId: string | null; backend?: MentorBackend; children: ReactNode }) {
  const api = useMemo(() => backend ?? (defaultBackend ??= createMockBackend()), [backend]);
  const docked = useSyncExternalStore(subscribeDock, dockSnapshot, () => false);
  const progress = useProgress();
  const [open, setOpenState] = useState(readOpen);
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Mentor['pending']>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const lessonRef = useRef(lessonId);
  lessonRef.current = lessonId;

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      // The panel just won't remember being open.
    }
  }, []);

  useEffect(() => {
    let live = true;
    api.account().then((a) => {
      if (!live) return;
      setAccount(a);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [api]);

  // The course's conversation, whenever someone is signed in.
  const signedIn = account !== null;
  useEffect(() => {
    if (!signedIn) {
      setMessages([]);
      return;
    }
    let live = true;
    api.history(COURSE.id).then((m) => live && setMessages(m));
    return () => {
      live = false;
    };
  }, [api, signedIn]);

  // Leave room for the docked panel beside the lesson.
  const reserve = open && docked && lessonId ? MENTOR_WIDTH : 0;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('mt-docked', reserve > 0);
    return () => root.classList.remove('mt-docked');
  }, [reserve]);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  const attach = useCallback(
    (text: string) => {
      if (!lessonRef.current) return;
      setQuote({ text, lessonId: lessonRef.current });
      setOpen(true);
      focusComposer();
    },
    [setOpen, focusComposer],
  );

  const send = useCallback(
    async (text: string, q: Quote | null = null) => {
      const lesson = lessonRef.current;
      const body = text.trim();
      if (!lesson || !body || pending) return;
      if (!account) {
        if (q) setQuote(q);
        setOpen(true);
        return;
      }
      if (account.blocked) return;
      const meta = getLesson(lesson);
      const question: Message = { id: 'pending', role: 'you', text: body, quote: q?.text, lessonId: lesson, at: new Date().toISOString() };
      setPending({ question, answer: '' });
      setDraft('');
      setQuote(null);
      setError(null);
      try {
        const res = await api.ask(
          {
            courseId: COURSE.id,
            lessonId: lesson,
            lessonTitle: meta?.title ?? lesson,
            text: body,
            quote: q?.text,
            lessonText: lessonText(),
            solved: Object.keys(progress).filter((k) => progress[k].length > 0),
          },
          (delta) => setPending((p) => p && { ...p, answer: p.answer + delta }),
        );
        setMessages((m) => [...m, res.question, res.answer]);
        setAccount(res.account);
      } catch (e) {
        // Give the reader their question back so nothing they typed is lost.
        setDraft(body);
        setQuote(q);
        const code = e instanceof MentorError ? e.code : 'failed';
        if (code === 'connect' || code === 'funding' || code === 'limit' || code === 'revoked') {
          setAccount((a) => a && { ...a, blocked: code as Blocked });
        } else {
          setError('The mentor couldn’t answer just now. Try again in a moment.');
        }
      } finally {
        setPending(null);
      }
    },
    [api, account, pending, progress, setOpen],
  );

  const explain = useCallback(
    (text: string) => {
      const lesson = lessonRef.current;
      if (!lesson) return;
      setOpen(true);
      void send('Explain this passage.', { text, lessonId: lesson });
    },
    [send, setOpen],
  );

  const signIn = useCallback(
    async (method: Exclude<SignInMethod, 'email'>) => {
      const a = await api.signIn(method);
      setAccount(a);
      return a;
    },
    [api],
  );

  const verifyCode = useCallback(
    async (email: string, code: string) => {
      const a = await api.verifyCode(email, code);
      setAccount(a);
      return a;
    },
    [api],
  );

  const signOut = useCallback(async () => {
    await api.signOut();
    setAccount(null);
    setQuote(null);
    setDraft('');
  }, [api]);

  const connectPayfer = useCallback(
    async (limitCents: number) => {
      const a = await api.connectPayfer(limitCents);
      setAccount(a);
      return a;
    },
    [api],
  );

  const managePayfer = useCallback(async () => {
    setAccount(await api.managePayfer());
  }, [api]);

  const startFresh = useCallback(async () => {
    await api.clear(COURSE.id);
    setMessages([]);
  }, [api]);

  const value = useMemo<Mentor>(
    () => ({
      lessonId,
      open,
      docked,
      reserve,
      ready,
      account,
      messages,
      quote,
      draft,
      pending,
      error,
      modal,
      composerRef,
      setOpen,
      setDraft,
      setModal,
      attach,
      clearQuote: () => setQuote(null),
      send,
      explain,
      signIn,
      sendCode: (email: string) => api.sendCode(email),
      verifyCode,
      signOut,
      connectPayfer,
      managePayfer,
      startFresh,
    }),
    [lessonId, open, docked, reserve, ready, account, messages, quote, draft, pending, error, modal, setOpen, attach, send, explain, signIn, api, verifyCode, signOut, connectPayfer, managePayfer, startFresh],
  );

  return <MentorContext.Provider value={value}>{children}</MentorContext.Provider>;
}
