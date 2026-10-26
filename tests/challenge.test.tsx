// A challenge once solved: green, with its explanation kept as it read when solved, so that
// after the controls move on, clicking "Solved" shows it again.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Challenge } from '../src/framework/Challenge';
import { LessonContext } from '../src/framework/Page';

function Harness({ lesson, x }: { lesson: string; x: number }) {
  return (
    <LessonContext.Provider value={lesson}>
      <Challenge id="a" question="Set x to 3." solved={x === 3} status={`x is ${x}.`} success={`Solved: x is ${x}, as the rule says.`} />
    </LessonContext.Provider>
  );
}

afterEach(cleanup);

describe('challenge', () => {
  it('starts unsolved, with a hairline box and a muted hint', () => {
    const { container } = render(<Harness lesson="test/1.1" x={1} />);
    expect(container.querySelector('.chal')!.classList.contains('ok')).toBe(false);
    expect(container.querySelector('.chal-st')!.textContent).toBe('Unsolved');
    expect(container.querySelector('.chal-s')!.classList.contains('ok')).toBe(false);
    expect(container.querySelector('.chal-tg')).toBeNull();
  });

  it('turns green when solved and shows the explanation in green', () => {
    const { container } = render(<Harness lesson="test/1.2" x={3} />);
    expect(container.querySelector('.chal')!.classList.contains('ok')).toBe(true);
    expect(container.querySelector('.chal-s.ok')!.textContent).toBe('Solved: x is 3, as the rule says.');
    expect(container.querySelector('.chal-tg')).toBeNull();
  });

  it('rereads the explanation as solved after the controls move on', () => {
    const { container, rerender } = render(<Harness lesson="test/1.3" x={3} />);
    rerender(<Harness lesson="test/1.3" x={5} />);
    expect(container.querySelector('.chal')!.classList.contains('ok')).toBe(true);
    expect(container.querySelector('.chal-s')!.textContent).toBe('x is 5.');
    expect(container.querySelector('.chal-s')!.classList.contains('ok')).toBe(false);

    const toggle = container.querySelector<HTMLButtonElement>('.chal-tg')!;
    expect(toggle.textContent).toBe('Solved');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.chal-s.ok')!.textContent).toBe('Solved: x is 3, as the rule says.');

    fireEvent.click(toggle);
    expect(container.querySelector('.chal-s')!.textContent).toBe('x is 5.');
  });

  it('keeps the explanation for a later visit', () => {
    render(<Harness lesson="test/1.4" x={3} />);
    cleanup();
    const { container } = render(<Harness lesson="test/1.4" x={0} />);
    fireEvent.click(container.querySelector('.chal-tg')!);
    expect(container.querySelector('.chal-s.ok')!.textContent).toBe('Solved: x is 3, as the rule says.');
  });

  it('shows the live explanation again once re-solved, and closes the reread', () => {
    const { container, rerender } = render(<Harness lesson="test/1.5" x={3} />);
    rerender(<Harness lesson="test/1.5" x={4} />);
    fireEvent.click(container.querySelector('.chal-tg')!);
    rerender(<Harness lesson="test/1.5" x={3} />);
    expect(container.querySelector('.chal-tg')).toBeNull();
    rerender(<Harness lesson="test/1.5" x={4} />);
    expect(container.querySelector('.chal-tg')!.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.chal-s')!.textContent).toBe('x is 4.');
  });
});
