import type { LessonMeta } from '../course/registry';
import { lessonHref } from '../course/router';

/**
 * The way back into the course: a bordered box, like a lesson's challenge, that's one link from
 * edge to edge. Shows the lesson the reader last opened, or the first lesson if there isn't one.
 */
export function ResumeCard({ lesson, started, course }: { lesson: LessonMeta; started: boolean; course?: string }) {
  return (
    <a className="resume" href={lessonHref(lesson.id)}>
      <span className="resume-h">
        <span>{started ? 'Continue where you left off' : 'Start with the first lesson'}</span>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="resume-t">
        {lesson.id} {lesson.title}
      </span>
      {course && <span className="resume-c">{course}</span>}
    </a>
  );
}
