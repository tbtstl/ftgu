import { useEffect, type ReactNode } from 'react';
import { markSolved, useProgress } from '../course/progress';
import { useLessonId } from './Page';

/**
 * A goal the reader reaches with a demonstration's controls. `solved` is computed live from
 * that demonstration's state; the first time it becomes true, the lesson's progress records it,
 * and from then on the challenge shows as solved (in green) even when the controls move on.
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
  const done = solved || solvedBefore;
  useEffect(() => {
    if (solved && lessonId) markSolved(lessonId, id);
  }, [solved, lessonId, id]);

  return (
    <div className="chal" data-fig-focus={figure}>
      <div className={done ? 'chal-h ok' : 'chal-h'}>
        <span>Challenge</span>
        <span className={done ? 'chal-st ok' : 'chal-st'}>
          {done && (
            <svg width="12" height="12" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M3 9.5 L7.5 14 L15 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {done ? 'Solved' : 'Unsolved'}
        </span>
      </div>
      <p className="chal-q">{question}</p>
      <div className={solved ? 'chal-s ok' : 'chal-s'} role="status">
        {solved ? success : status}
      </div>
    </div>
  );
}
