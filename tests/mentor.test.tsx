// The course mentor: the practice backend's free messages and Payfer charges, and the panel's
// flow from signing in to asking about a highlighted passage to connecting Payfer.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { LessonHeader } from '../src/framework/Page';
import { createMockBackend, MentorDock, MentorProvider, useMentor, type MentorBackend } from '../src/mentor';
import { FREE_MESSAGES, PRICE_CENTS } from '../src/mentor/offer';
import { MentorError } from '../src/mentor/types';

const ask = (backend: MentorBackend, text = 'Why?') =>
  backend.ask({ courseId: 'electricity', lessonId: '4.4', lessonTitle: 'Marginal pricing and market clearing', text, lessonText: '', solved: [] }, () => {});

describe('practice backend', () => {
  it('gives free messages, then needs Payfer, then charges per message', async () => {
    const backend = createMockBackend({ latency: 0, initial: { account: null, history: {} } });
    expect(await backend.account()).toBeNull();
    const a = await backend.signIn('google');
    expect(a.freeLeft).toBe(FREE_MESSAGES);
    expect(a.blocked).toBeNull();

    for (let i = 0; i < FREE_MESSAGES; i++) await ask(backend);
    expect((await backend.account())!.blocked).toBe('connect');
    await expect(ask(backend)).rejects.toEqual(new MentorError('connect'));

    const linked = await backend.connectPayfer(200);
    expect(linked.payfer!.leftCents).toBe(200);
    const res = await ask(backend, 'And now?');
    expect(res.account.payfer!.leftCents).toBe(200 - PRICE_CENTS);
    expect(res.answer.role).toBe('mentor');
    expect((await backend.history('electricity')).length).toBe(2 * (FREE_MESSAGES + 1));

    await backend.clear('electricity');
    expect(await backend.history('electricity')).toEqual([]);
  });

  it('stops at the monthly limit', async () => {
    const resets = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const backend = createMockBackend({
      latency: 0,
      initial: { account: { email: 'a@b.co', via: 'email', freeLeft: 0, priceCents: 1, payfer: { limitCents: 200, leftCents: 0, resets } }, history: {} },
    });
    expect((await backend.account())!.blocked).toBe('limit');
    await expect(ask(backend)).rejects.toEqual(new MentorError('limit'));
  });
});

/** Stands in for the highlight bar, which needs a real selection. */
function Quote({ text }: { text: string }) {
  const m = useMentor();
  return (
    <button type="button" onClick={() => m?.attach(text)}>
      quote it
    </button>
  );
}

function renderMentor(backend: MentorBackend) {
  return render(
    <MentorProvider lessonId="4.4" backend={backend}>
      <LessonHeader id="4.4" />
      <main className="art">
        <p>Every accepted generator is paid the same price.</p>
        <Quote text="every accepted generator is paid the same price" />
      </main>
      <MentorDock />
    </MentorProvider>,
  );
}

describe('mentor panel', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it('signs in, takes a highlighted passage and answers', async () => {
    const view = renderMentor(createMockBackend({ latency: 0, initial: { account: null, history: {} } }));
    fireEvent.click(await view.findByRole('button', { name: 'Mentor' }));
    expect(view.getByText('A mentor for this course')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'Create a free account' }));
    const dialog = within(view.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Continue with Google' }));
    expect(await dialog.findByText('You’re in')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Back to lesson 4.4' }));

    // The header now shows the free messages, and the panel a composer.
    expect(view.getByRole('button', { name: /Account\. 5 free messages left/ })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'quote it' }));
    expect(view.getByText('“every accepted generator is paid the same price”')).toBeTruthy();
    const input = view.getByLabelText('Message the mentor') as HTMLTextAreaElement;
    expect(input.placeholder).toBe('Ask about this passage…');

    fireEvent.change(input, { target: { value: 'So nuclear gets $46?' } });
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
    // The footer changes once the answer has finished streaming in.
    expect(await view.findByText('4 free messages left')).toBeTruthy();
    expect(view.getByText(/This is the practice mentor/)).toBeTruthy();
    expect(view.getByText('So nuclear gets $46?')).toBeTruthy();
    expect(view.getByText('Electricity & Energy Markets · 2 messages')).toBeTruthy();
  });

  it('asks for Payfer once the free messages are gone, then carries on', async () => {
    window.localStorage.setItem('emc.mentor.open.v1', '1');
    const view = renderMentor(
      createMockBackend({ latency: 0, initial: { account: { email: 'a@b.co', via: 'email', freeLeft: 0, priceCents: 1, payfer: null }, history: {} } }),
    );
    expect(await view.findByText('Your free messages are used up')).toBeTruthy();
    expect(view.queryByLabelText('Message the mentor')).toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'Connect Payfer' }));
    const dialog = within(view.getByRole('dialog'));
    fireEvent.click(dialog.getByLabelText(/\$2\.00 a month/));
    expect(dialog.getByText('about 200 messages')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Continue with Payfer' }));
    expect(await dialog.findByText('Payfer connected')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Back to lesson 4.4' }));

    expect(view.getByText('$2.00 left this month')).toBeTruthy();
    expect(view.getByText('1¢ per message, through Payfer')).toBeTruthy();
    await act(async () => {
      fireEvent.change(view.getByLabelText('Message the mentor'), { target: { value: 'What sets the price?' } });
      fireEvent.click(view.getByRole('button', { name: 'Send' }));
    });
    expect(await view.findByText('$1.99 left this month')).toBeTruthy();
  });
});
