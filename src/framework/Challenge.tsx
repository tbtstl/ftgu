import { useEffect, type ReactNode } from 'react';
import { markSolved } from '../course/progress';
import { useLessonId } from './Page';

/**
 * A goal the reader reaches with a demonstration's controls. `solved` is computed live from
 * that demonstration's state; the first time it becomes true, the lesson's progress records it.
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
  useEffect(() => {
    if (solved && lessonId) markSolved(lessonId, id);
  }, [solved, lessonId, id]);

  return (
    <div className="chal" data-fig-focus={figure}>
      <div className="chal-h">
        <span>Challenge</span>
        <span className={solved ? 'chal-st ok' : 'chal-st'}>
          {solved && (
            <svg width="12" height="12" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M3 9.5 L7.5 14 L15 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {solved ? 'Solved' : 'Unsolved'}
        </span>
      </div>
      <p className="chal-q">{question}</p>
      <div className={solved ? 'chal-s ok' : 'chal-s'} role="status">
        {solved ? success : status}
      </div>
    </div>
  );
}
