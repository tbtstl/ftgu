import { useEffect, useRef, useState, type ReactNode } from 'react';
import { markSolved, saveSolution, useProgress, useSolution } from '../course/progress';
import { useLessonId } from './Page';

/**
 * A goal the reader reaches with a demonstration's controls. `solved` is computed live from
 * that demonstration's state; the first time it becomes true, the lesson's progress records it,
 * and from then on the challenge shows as solved (in green) even when the controls move on.
 * The explanation is kept as it read when solved, so after the controls move on, clicking
 * "Solved" shows it again.
 */
export function Challenge({
  id,
  question,
  solved,
  status,
  success,
  figure,
}: {
  /** Unique within the lesson, e.g. "a". */
  id: string;
  /**
   * Name of the demonstration this challenge is played on, when it isn't the one just before it.
   * In the two-up layout, reaching the challenge brings that demonstration back into view.
   */
  figure?: string;
  question: ReactNode;
  solved: boolean;
  /** Shown while unsolved: a hint about the current state. */
  status: ReactNode;
  /** Shown once solved: why the answer works. */
  success: ReactNode;
}) {
  const lessonId = useLessonId();
  const solvedBefore = !!useProgress()[lessonId]?.includes(id);
  const saved = useSolution(lessonId, id);
  const [reread, setReread] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const done = solved || solvedBefore;
  const canReread = done && !solved && !!saved;
  const showSaved = canReread && reread;

  useEffect(() => {
    if (solved && lessonId) markSolved(lessonId, id);
    if (solved) setReread(false);
  }, [solved, lessonId, id]);

  // The explanation depends on the settings that solved it, so keep the text as it reads now.
  useEffect(() => {
    const text = body.current?.textContent;
    if (solved && lessonId && text) saveSolution(lessonId, id, text);
  });

  const check = (
    <svg width="12" height="12" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 9.5 L7.5 14 L15 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div className={done ? 'chal ok' : 'chal'} data-fig-focus={figure}>
      <div className={done ? 'chal-h ok' : 'chal-h'}>
        <span>Challenge</span>
        {canReread ? (
          <button
            type="button"
            className="chal-st ok chal-tg"
            aria-expanded={showSaved}
            aria-label={showSaved ? 'Solved: hide the solution' : 'Solved: show the solution'}
            onClick={() => setReread((r) => !r)}
          >
            {check}
            Solved
            <svg className="chal-cv" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className={done ? 'chal-st ok' : 'chal-st'}>
            {done && check}
            {done ? 'Solved' : 'Unsolved'}
          </span>
        )}
      </div>
      <p className="chal-q">{question}</p>
      <div ref={body} className={solved || showSaved ? 'chal-s ok' : 'chal-s'} role="status">
        {solved ? success : showSaved ? saved : status}
      </div>
    </div>
  );
}
