// The mentor panel: docked beside the lesson on wide windows, a sheet over the bottom of it on
// narrow ones. Signed out it explains itself; signed in it shows the course's conversation,
// split by the lesson each part happened in, and a composer (or why a message can't be paid for).

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { getLesson } from '../course/registry';
import { lessonHref } from '../course/router';
import { RunnerMark } from '../framework/RunnerMark';
import { COURSE, useMentor, type Mentor } from './MentorContext';
import { FreshDialog, PayferDialog, SignInDialog } from './dialogs';
import { centsLabel, dayLabel, money, resetLabel } from './format';
import { ArrowIcon, ChatIcon, CloseIcon, CoinIcon, EyeIcon, MoreIcon, PenIcon, SendIcon } from './icons';
import { FREE_MESSAGES, PRICE_CENTS } from './offer';
import type { Account, Blocked, Message } from './types';
import './mentor.css';

const SUGGESTIONS = ['Explain the main idea of this lesson.', 'Quiz me on this lesson.', 'How does this connect to the last lesson?'];

/** The panel and its dialogs, on lesson pages. */
export function MentorDock() {
  const m = useMentor();
  if (!m || !m.lessonId) return null;
  return (
    <>
      {m.open && <MentorPanel m={m} />}
      <SignInDialog />
      <PayferDialog />
      <FreshDialog />
    </>
  );
}

/** Opening the panel from a button moves focus into it: to the composer, or else the panel. */
export function focusPanel(m: Mentor) {
  requestAnimationFrame(() => (m.composerRef.current ?? document.getElementById('mentor-panel'))?.focus());
}

/** Closes a popover on a click outside it or on Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [ref, onClose]);
}

function MentorPanel({ m }: { m: Mentor }) {
  const [menu, setMenu] = useState(false);
  const count = m.messages.length;

  const close = () => {
    m.setOpen(false);
    document.getElementById('mentor-toggle')?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !menu && !m.modal) close();
  };

  return (
    <aside id="mentor-panel" className="mt-panel" aria-labelledby="mentor-h" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="mt-hd">
        <RunnerMark size={20} />
        <div className="mt-hd-t">
          <h2 id="mentor-h">Mentor</h2>
          <p>
            {COURSE.title}
            {m.account && ` · ${count === 1 ? '1 message' : `${count} messages`}`}
          </p>
        </div>
        {m.account && (
          <button type="button" className="mt-icb" aria-label="Mentor options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MoreIcon />
          </button>
        )}
        <button type="button" className="mt-icb" aria-label="Close mentor" onClick={close}>
          <CloseIcon />
        </button>
        {menu && m.account && <OptionsMenu m={m} account={m.account} close={() => setMenu(false)} />}
      </div>

      {!m.ready ? (
        <p className="mt-ctx">Loading…</p>
      ) : !m.account ? (
        <Gate m={m} />
      ) : (
        <>
          <p className="mt-ctx">
            <EyeIcon />
            <span>Sees lesson {m.lessonId} and your progress in this course</span>
          </p>
          <Thread m={m} />
          {m.account.blocked ? <BlockedCard m={m} account={m.account} kind={m.account.blocked} /> : <Composer m={m} account={m.account} />}
        </>
      )}
    </aside>
  );
}

function OptionsMenu({ m, account, close }: { m: Mentor; account: Account; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, close);
  return (
    <div className="mt-menu" ref={ref}>
      <button
        type="button"
        onClick={() => {
          close();
          m.setModal('fresh');
        }}
      >
        <span>Start fresh in this course</span>
        <span className="mt-menu-s">Clears this course’s history. Payments aren’t affected.</span>
      </button>
      <button
        type="button"
        onClick={() => {
          close();
          if (account.payfer) void m.managePayfer();
          else m.setModal('payfer');
        }}
      >
        <span>{account.payfer ? 'Change your Payfer limit' : 'Connect Payfer'}</span>
      </button>
    </div>
  );
}

function Thread({ m }: { m: Mentor }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const items: Message[] = m.pending ? [...m.messages, m.pending.question] : m.messages;
  const last = items[items.length - 1];
  const hereNow = !last || last.lessonId !== m.lessonId;

  // Stay at the newest message unless the reader has scrolled back through the history.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items.length, m.pending?.answer, m.error]);

  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const blocks: ReactNode[] = [];
  let lesson = '';
  for (const msg of items) {
    if (msg.lessonId !== lesson) {
      lesson = msg.lessonId;
      blocks.push(<Divider key={`d-${msg.id}`} id={lesson} at={msg.at} current={lesson === m.lessonId} />);
    }
    blocks.push(msg.role === 'you' ? <YouMessage key={msg.id} msg={msg} /> : <MentorMessage key={msg.id} text={msg.text} />);
  }

  return (
    <div className="mt-scroll" ref={ref} onScroll={onScroll}>
      <div role="log" aria-label="Conversation" aria-busy={m.pending ? true : undefined}>
        {blocks}
        {m.lessonId && hereNow && <Divider id={m.lessonId} at={new Date().toISOString()} current />}
        {m.pending && (m.pending.answer ? <MentorMessage text={m.pending.answer} /> : <Thinking />)}
        {m.error && (
          <p className="mt-err" role="alert">
            {m.error}
          </p>
        )}
        {hereNow && !m.pending && (
          <div className="mt-sug">
            <p>Highlight any sentence in the lesson to ask about it, or try</p>
            <ul>
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => void m.send(s)} disabled={!!m.account?.blocked}>
                    <ArrowIcon />
                    {s.replace(/\.$/, '')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Divider({ id, at, current }: { id: string; at: string; current: boolean }) {
  const title = getLesson(id)?.title ?? '';
  return (
    <div className="mt-div">
      <span className="mt-div-n">{id}</span>
      {current ? (
        <span className="mt-div-t">{title}</span>
      ) : (
        <a className="mt-div-t" href={lessonHref(id)}>
          {title}
        </a>
      )}
      <span>{dayLabel(at)}</span>
    </div>
  );
}

function YouMessage({ msg }: { msg: Message }) {
  return (
    <div className="mt-you">
      <div>
        <span className="sr-only">You: </span>
        {msg.quote && (
          <>
            <p className="mt-from">From {msg.lessonId}</p>
            <blockquote className="mt-q">
              <span>“{msg.quote}”</span>
            </blockquote>
          </>
        )}
        <p className="mt-txt">{msg.text}</p>
      </div>
    </div>
  );
}

function MentorMessage({ text }: { text: string }) {
  return (
    <div className="mt-me">
      <span className="sr-only">Mentor: </span>
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function Thinking() {
  return (
    <p className="mt-think" role="status">
      Thinking
      <span aria-hidden="true">.</span>
      <span aria-hidden="true">.</span>
      <span aria-hidden="true">.</span>
    </p>
  );
}

function Composer({ m, account }: { m: Mentor; account: Account }) {
  const canSend = m.draft.trim().length > 0 && !m.pending;
  const submit = () => void m.send(m.draft, m.quote);
  const price = centsLabel(account.priceCents);
  const left = account.payfer?.leftCents ?? 0;
  const low = account.freeLeft === 0 && left < account.priceCents * 10;

  return (
    <form
      className="mt-cmp"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {m.quote && (
        <div className="mt-chip">
          <div className="mt-chip-b">
            <p className="mt-from">From {m.quote.lessonId}</p>
            <p className="mt-chip-q">
              <span>“{m.quote.text}”</span>
            </p>
          </div>
          <button type="button" className="mt-icb" aria-label="Remove quote" onClick={m.clearQuote}>
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      <label htmlFor="mentor-input" className="sr-only">
        Message the mentor
      </label>
      <div className="mt-row">
        <textarea
          id="mentor-input"
          ref={m.composerRef}
          className="mt-input"
          rows={2}
          value={m.draft}
          placeholder={m.quote ? 'Ask about this passage…' : `Ask about lesson ${m.lessonId}…`}
          onChange={(e) => m.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) submit();
            }
          }}
        />
        <button type="submit" className="mt-send" aria-label="Send" disabled={!canSend}>
          <SendIcon />
        </button>
      </div>
      <p className="mt-foot">
        {account.freeLeft > 0 ? (
          <>
            <span>
              {account.freeLeft} free {account.freeLeft === 1 ? 'message' : 'messages'} left
            </span>
            <span>then {price} each</span>
          </>
        ) : (
          <>
            <span>{price} per message, through Payfer</span>
            <span className={low ? 'mt-low' : undefined}>{money(left)} left this month</span>
          </>
        )}
      </p>
    </form>
  );
}

function BlockedCard({ m, account, kind }: { m: Mentor; account: Account; kind: Blocked }) {
  const [busy, setBusy] = useState(false);
  const price = centsLabel(account.priceCents);
  const limit = account.payfer ? money(account.payfer.limitCents) : '';
  const reset = account.payfer ? resetLabel(account.payfer.resets) : '';
  const copy: Record<Blocked, { title: string; body: string; cta: string }> = {
    connect: {
      title: 'Your free messages are used up',
      body: `Connect Payfer to keep asking. Messages are ${price} each, and you choose a monthly limit for this site.`,
      cta: 'Connect Payfer',
    },
    funding: { title: 'Your Payfer balance is empty', body: 'Add funds on Payfer to keep asking. Top-ups start at $5.', cta: 'Add funds on Payfer' },
    limit: {
      title: 'You’ve reached this month’s limit',
      body: `Your ${limit} limit for From The Ground Up resets on ${reset}. You can raise it on Payfer.`,
      cta: 'Raise your limit',
    },
    revoked: { title: 'Payfer is disconnected', body: 'Payments to From The Ground Up were stopped in Payfer. Reconnect to keep asking.', cta: 'Reconnect Payfer' },
  };
  const c = copy[kind];
  const act = async () => {
    if (kind === 'connect' || kind === 'revoked') {
      m.setModal('payfer');
      return;
    }
    setBusy(true);
    try {
      await m.managePayfer();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-block">
      <p className="mt-block-t">{c.title}</p>
      <p className="mt-block-b">{c.body}</p>
      <button type="button" className="mt-btn" onClick={() => void act()} disabled={busy}>
        {busy ? 'Opening Payfer…' : c.cta}
      </button>
      <p className="mt-fine">Your conversation stays where it is, and the lessons stay free.</p>
    </div>
  );
}

function Gate({ m }: { m: Mentor }) {
  return (
    <>
      <div className="mt-scroll mt-gate">
        <p className="mt-gate-h">A mentor for this course</p>
        <p className="mt-gate-p">
          Ask questions without leaving the lesson. Highlight any sentence to bring it into the conversation. One mentor follows you through all of{' '}
          {COURSE.title} and remembers what you’ve asked.
        </p>
        {m.quote && (
          <div className="mt-chip mt-gate-chip">
            <div className="mt-chip-b">
              <p className="mt-from">Waiting for you to sign in · from {m.quote.lessonId}</p>
              <p className="mt-chip-q">
                <span>“{m.quote.text}”</span>
              </p>
            </div>
          </div>
        )}
        <p className="mt-gate-ex">For example</p>
        <div className="mt-you">
          <div>
            <p className="mt-from">From 4.4</p>
            <blockquote className="mt-q">
              <span>“every plant that runs is paid that one price, whatever it offered”</span>
            </blockquote>
            <p className="mt-txt">So Harbor Point gets $42 even though it offered $9?</p>
          </div>
        </div>
        <MentorMessage text="Yes. At 19:00 Mill Creek is the last plant needed, so everyone who runs is paid its $42, Harbor Point included. The gap above Harbor Point’s $9 is what pays back its construction and other fixed costs." />
        <ul className="mt-feats">
          <li>
            <PenIcon />
            <div>
              <p>Highlight to ask</p>
              <p>Select text in any lesson and ask about it, or have it explained.</p>
            </div>
          </li>
          <li>
            <ChatIcon />
            <div>
              <p>One conversation per course</p>
              <p>It picks up where you left off, lesson to lesson. Each new course gets a fresh mentor.</p>
            </div>
          </li>
          <li>
            <CoinIcon />
            <div>
              <p>Pay only for what you ask</p>
              <p>{centsLabel(PRICE_CENTS)} a message through Payfer, with a monthly limit you choose. No subscription.</p>
            </div>
          </li>
        </ul>
      </div>
      <div className="mt-gate-ft">
        <button type="button" className="mt-btn" onClick={() => m.setModal('signin')}>
          Create a free account
        </button>
        <p className="mt-fine">
          Your first {FREE_MESSAGES} messages are free, then {centsLabel(PRICE_CENTS)} each through Payfer.
        </p>
        <p className="mt-fine">
          Already have an account?{' '}
          <button type="button" className="mt-link" onClick={() => m.setModal('signin')}>
            Log in
          </button>
        </p>
        <p className="mt-fine mt-fine-rule">The lessons stay free, with or without an account.</p>
      </div>
    </>
  );
}
