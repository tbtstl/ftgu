// The mentor's part of the lesson header: the Mentor toggle, and either Log in or what the
// reader can spend (free messages, or what's left of their Payfer limit) with the account menu.

import { useCallback, useRef, useState } from 'react';
import { COURSE, useMentor, type Mentor } from './MentorContext';
import { focusPanel, useDismiss } from './MentorPanel';
import { centsLabel, money, resetLabel } from './format';
import { ChatIcon, CoinIcon, PersonIcon } from './icons';
import type { Account } from './types';

const VIA: Record<Account['via'], string> = { google: 'Google', apple: 'Apple', passkey: 'a passkey', email: 'email' };

export function MentorHeaderItems() {
  const m = useMentor();
  if (!m) return null;
  return (
    <>
      <button
        id="mentor-toggle"
        type="button"
        className="mt-toggle"
        aria-pressed={m.open}
        onClick={() => {
          m.setOpen(!m.open);
          if (!m.open) focusPanel(m);
        }}
      >
        <ChatIcon />
        Mentor
      </button>
      {m.ready &&
        (m.account ? (
          <AccountButton m={m} account={m.account} />
        ) : (
          <button type="button" className="mt-toggle mt-login" onClick={() => m.setModal('signin')}>
            Log in
          </button>
        ))}
    </>
  );
}

/** What the header says the reader has left, and whether it's running low. */
export function balance(a: Account): { amount: string; rest: string; low: boolean; label: string } {
  if (a.blocked === 'connect') return { amount: 'Connect Payfer', rest: '', low: false, label: 'Free messages used up. Connect Payfer' };
  if (a.blocked === 'revoked') return { amount: 'Reconnect Payfer', rest: '', low: false, label: 'Payfer disconnected' };
  if (a.freeLeft > 0) return { amount: String(a.freeLeft), rest: ' free left', low: false, label: `${a.freeLeft} free messages left` };
  const left = a.payfer?.leftCents ?? 0;
  return {
    amount: money(left),
    rest: ' left',
    low: a.blocked !== null || left < a.priceCents * 10,
    label: `${money(left)} left of your ${money(a.payfer?.limitCents ?? 0)} monthly limit`,
  };
}

function AccountButton({ m, account }: { m: Mentor; account: Account }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close);
  const b = balance(account);
  return (
    <div className="mt-acct" ref={ref}>
      <button type="button" className="mt-acct-b" aria-expanded={open} aria-label={`Account. ${b.label}`} onClick={() => setOpen(!open)}>
        <span className={b.low ? 'mt-bal mt-low' : 'mt-bal'}>
          <CoinIcon />
          <span>
            <b>{b.amount}</b>
            <span className="mt-bal-r">{b.rest}</span>
          </span>
        </span>
        <span className="mt-avatar">
          <PersonIcon />
        </span>
      </button>
      {open && <AccountMenu m={m} account={account} close={close} />}
    </div>
  );
}

function AccountMenu({ m, account: a, close }: { m: Mentor; account: Account; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const manage = async () => {
    setBusy(true);
    try {
      await m.managePayfer();
    } finally {
      setBusy(false);
    }
  };
  const n = m.messages.length;
  return (
    <div className="mt-menu mt-acct-menu">
      <div className="mt-sec">
        <p>{a.email ?? 'Signed in'}</p>
        <p className="mt-mut">Signed in with {VIA[a.via]}</p>
      </div>
      <div className="mt-sec">
        {a.payfer ? (
          <>
            <p className="mt-mut">Payfer · this month</p>
            <p className="mt-num">
              <span className="mt-big">{money(a.payfer.leftCents)}</span>
              <span className="mt-mut"> left of {money(a.payfer.limitCents)}</span>
            </p>
            <p className="mt-mut">
              {centsLabel(a.priceCents)} per message, in any course · resets {resetLabel(a.payfer.resets)}
            </p>
            <div className="mt-two">
              <button type="button" className="mt-btn2" disabled={busy} onClick={() => void manage()}>
                Change limit
              </button>
              <button type="button" className="mt-btn2" disabled={busy} onClick={() => void manage()}>
                Add funds
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-mut">Free messages</p>
            <p className="mt-num">
              <span className="mt-big">{a.freeLeft}</span>
              <span className="mt-mut"> left</span>
            </p>
            <p className="mt-mut">Then {centsLabel(a.priceCents)} per message, through Payfer.</p>
            <button
              type="button"
              className="mt-btn mt-gap"
              onClick={() => {
                close();
                m.setModal('payfer');
              }}
            >
              Connect Payfer
            </button>
          </>
        )}
      </div>
      <div className="mt-sec">
        <p className="mt-mut">Mentors · one for each course</p>
        <ul className="mt-list">
          <li>
            <span>{COURSE.title}</span>
            <span className="mt-mut">{n === 1 ? '1 message' : `${n} messages`}</span>
          </li>
        </ul>
      </div>
      <div className="mt-items">
        {a.payfer && (
          <a href="https://payfer.me/dashboard" target="_blank" rel="noreferrer">
            Charges on Payfer
          </a>
        )}
        <button
          type="button"
          onClick={() => {
            close();
            void m.signOut();
          }}
        >
          Log out
        </button>
      </div>
    </div>
  );
}
