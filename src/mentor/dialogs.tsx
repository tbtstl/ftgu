// The mentor's dialogs: signing in (Privy), connecting Payfer, and starting a course over.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RunnerMark } from '../framework/RunnerMark';
import { COURSE, useMentor, type Modal } from './MentorContext';
import { centsLabel, money } from './format';
import { ArrowIcon, CheckCircleIcon, CloseIcon, Spinner } from './icons';
import { PRICE_CENTS } from './offer';
import { MentorError } from './types';

/** A modal <dialog>; where showModal isn't available (tests) it's simply shown. */
function Dialog({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="mt-dialog"
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the backdrop lands on the dialog itself.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {open && <div className="mt-dialog-in">{children}</div>}
    </dialog>
  );
}

function useModal(name: Exclude<Modal, null>) {
  const m = useMentor();
  return { m, open: m?.modal === name, close: () => m?.setModal(null) };
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="mt-icb mt-dialog-x" aria-label="Close" onClick={onClick}>
      <CloseIcon />
    </button>
  );
}

const VIA: Record<string, string> = { google: 'Google', apple: 'Apple', passkey: 'a passkey' };

export function SignInDialog() {
  const { m, open, close } = useModal('signin');
  const [step, setStep] = useState<'start' | 'code' | 'done'>('start');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('start');
      setCode('');
      setErr('');
      setResent(false);
    }
  }, [open]);

  if (!m) return null;
  const a = m.account;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try {
      await work();
    } catch (e) {
      setErr(e instanceof MentorError ? e.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const oauth = (method: 'google' | 'apple' | 'passkey') =>
    run(async () => {
      await m.signIn(method);
      setStep('done');
    });

  return (
    <Dialog open={open} onClose={close} labelledBy="signin-h">
      <div className="mt-dialog-top">
        {step === 'code' ? (
          <button type="button" className="mt-tbtn" onClick={() => setStep('start')}>
            <ArrowIcon back />
            Back
          </button>
        ) : (
          <RunnerMark size={28} />
        )}
        <CloseButton onClick={close} />
      </div>

      {step === 'start' && (
        <>
          <h2 id="signin-h">Log in or create an account</h2>
          <p className="mt-sub">An account holds your mentor conversations. The lessons stay free without one.</p>
          <div className="mt-stack">
            <button type="button" className="mt-btn2" disabled={busy} onClick={() => void oauth('google')}>
              Continue with Google
            </button>
            <button type="button" className="mt-btn2" disabled={busy} onClick={() => void oauth('apple')}>
              Continue with Apple
            </button>
          </div>
          <div className="mt-or" aria-hidden="true">
            <span />
            or
            <span />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await m.sendCode(email);
                setStep('code');
              });
            }}
          >
            <label htmlFor="si-email" className="mt-label">
              Email
            </label>
            <input
              id="si-email"
              className="mt-field"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? 'si-err' : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                setErr('');
              }}
            />
            {err && (
              <p id="si-err" className="mt-err" role="alert">
                {err}
              </p>
            )}
            <button type="submit" className="mt-btn mt-gap" disabled={busy}>
              Continue with email
            </button>
          </form>
          <div className="mt-center">
            <button type="button" className="mt-tbtn" disabled={busy} onClick={() => void oauth('passkey')}>
              Use a passkey
            </button>
          </div>
        </>
      )}

      {step === 'code' && (
        <>
          <h2 id="signin-h">Check your email</h2>
          <p className="mt-sub">
            We sent a 6-digit code to <span className="mt-ink">{email.trim()}</span>. Enter it here to finish.
          </p>
          <form
            className="mt-gap"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await m.verifyCode(email, code);
                setStep('done');
              });
            }}
          >
            <label htmlFor="si-code" className="mt-label">
              Code
            </label>
            <input
              id="si-code"
              className="mt-field mt-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? 'si-err' : undefined}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setErr('');
              }}
            />
            {err && (
              <p id="si-err" className="mt-err" role="alert">
                {err}
              </p>
            )}
            <button type="submit" className="mt-btn mt-gap" disabled={busy}>
              Verify
            </button>
          </form>
          <p className="mt-center mt-sub">
            <span>Didn’t get it?</span>{' '}
            <button
              type="button"
              className="mt-link"
              onClick={() =>
                void run(async () => {
                  await m.sendCode(email);
                  setResent(true);
                  setCode('');
                })
              }
            >
              Send a new code
            </button>{' '}
            <span role="status">{resent ? 'Sent.' : ''}</span>
          </p>
        </>
      )}

      {step === 'done' && a && (
        <>
          <CheckCircleIcon />
          <h2 id="signin-h">You’re in</h2>
          <p className="mt-sub">
            {a.payfer
              ? `Your mentor for ${COURSE.title} is ready.`
              : `Your mentor for ${COURSE.title} is ready, and your first ${a.freeLeft} messages are free. After that, you can pay as you go with Payfer.`}
          </p>
          <button
            type="button"
            className="mt-btn mt-gap"
            onClick={() => {
              close();
              m.setOpen(true);
              requestAnimationFrame(() => m.composerRef.current?.focus());
            }}
          >
            {m.quote ? 'Back to your question' : `Back to lesson ${m.lessonId}`}
          </button>
          <p className="mt-center mt-fine">{a.via === 'email' ? `Signed in as ${a.email}` : `Signed in with ${VIA[a.via]}`}</p>
        </>
      )}

      <p className="mt-dialog-ft">
        We keep your email and your mentor conversations. Your reading progress stays in this browser, and payments go through Payfer, so we never see your card or
        balance. Sign-in by Privy.
      </p>
    </Dialog>
  );
}

const LIMITS = [200, 500, 1000];

export function PayferDialog() {
  const { m, open, close } = useModal('payfer');
  const [step, setStep] = useState<'intro' | 'wait' | 'done'>('intro');
  const [limit, setLimit] = useState(500);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) {
      setStep('intro');
      setErr('');
    }
  }, [open]);

  if (!m) return null;
  const priceCents = m.account?.priceCents ?? PRICE_CENTS;
  const price = centsLabel(priceCents);

  const connect = async () => {
    setStep('wait');
    setErr('');
    try {
      await m.connectPayfer(limit);
      setStep('done');
    } catch {
      setStep('intro');
      setErr('Payfer didn’t finish connecting. Try again.');
    }
  };

  return (
    <Dialog open={open} onClose={close} labelledBy="payfer-h">
      {step === 'intro' && (
        <>
          <div className="mt-dialog-top">
            <h2 id="payfer-h">Pay as you go with Payfer</h2>
            <CloseButton onClick={close} />
          </div>
          <p className="mt-sub">
            Messages to your mentor cost <span className="mt-ink">{price}</span> each, paid from your Payfer balance. One balance works with every app that uses Payfer.
          </p>
          <fieldset className="mt-opts">
            <legend className="mt-label">Monthly limit for From The Ground Up</legend>
            {LIMITS.map((c) => (
              <label key={c} className={c === limit ? 'mt-opt on' : 'mt-opt'}>
                <input type="radio" name="mt-limit" value={c} checked={c === limit} onChange={() => setLimit(c)} />
                <span className="mt-opt-t">{money(c)} a month</span>
                <span className="mt-opt-n">about {Math.floor(c / priceCents).toLocaleString('en-US')} messages</span>
              </label>
            ))}
          </fieldset>
          <p className="mt-fine">We can’t charge more than this in a calendar month. You can change it or stop payments any time on Payfer.</p>
          {err && (
            <p className="mt-err" role="alert">
              {err}
            </p>
          )}
          <button type="button" className="mt-btn mt-gap" onClick={() => void connect()}>
            Continue with Payfer
            <ArrowIcon />
          </button>
          <p className="mt-center mt-fine">You’ll approve the limit on Payfer’s page. New to Payfer? You can add funds there, from $5.</p>
        </>
      )}

      {step === 'wait' && (
        <>
          <Spinner />
          <h2 id="payfer-h" role="status">
            Finish on Payfer
          </h2>
          <p className="mt-sub">
            Approve a <span className="mt-ink">{money(limit)}</span> monthly limit for From The Ground Up in the Payfer window. We’ll carry on here once you’re done.
          </p>
          <button type="button" className="mt-tbtn" onClick={close}>
            Cancel
          </button>
        </>
      )}

      {step === 'done' && (
        <>
          <CheckCircleIcon />
          <h2 id="payfer-h">Payfer connected</h2>
          <p className="mt-sub">
            From The Ground Up can charge up to <span className="mt-ink">{money(limit)}</span> a month, {price} per message. Your limit resets on the 1st of each
            month.
          </p>
          <button
            type="button"
            className="mt-btn mt-gap"
            onClick={() => {
              close();
              requestAnimationFrame(() => m.composerRef.current?.focus());
            }}
          >
            Back to lesson {m.lessonId}
          </button>
          <p className="mt-center mt-fine">Change your limit or disconnect any time in Payfer.</p>
        </>
      )}

      <p className="mt-dialog-ft">Payments by Payfer. We get an ID for your Payfer account, never your email or card.</p>
    </Dialog>
  );
}

export function FreshDialog() {
  const { m, open, close } = useModal('fresh');
  const [busy, setBusy] = useState(false);
  if (!m) return null;
  const n = m.messages.length;
  return (
    <Dialog open={open} onClose={close} labelledBy="fresh-h">
      <h2 id="fresh-h">Start fresh in Electricity?</h2>
      <p className="mt-sub">
        This clears {n === 1 ? 'the 1 message' : `all ${n} messages`} with this course’s mentor. Your Payfer limit and your reading progress aren’t affected.
      </p>
      <div className="mt-actions">
        <button type="button" className="mt-tbtn" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="mt-btn mt-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await m.startFresh();
              close();
            } finally {
              setBusy(false);
            }
          }}
        >
          Clear history
        </button>
      </div>
    </Dialog>
  );
}
