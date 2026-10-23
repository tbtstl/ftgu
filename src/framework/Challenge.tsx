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
}: {
  /** Unique within the lesson, e.g. "a". */
  id: string;
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
    <div className="chal">
      <div className="chal-h">Challenge</div>
      <p className="chal-q">{question}</p>
      {solved ? (
        <div className="chal-s ok" role="status">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M3 9.5 L7.5 14 L15 4.5" fill="none" stroke="#3f6f1b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{success}</span>
        </div>
      ) : (
        <div className="chal-s" role="status">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" fill="none" stroke="#9a9a9a" strokeWidth="2" />
          </svg>
          <span>{status}</span>
        </div>
      )}
    </div>
  );
}
