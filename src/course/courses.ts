// The school's courses, in the order the home page lists them. A course with no lessons
// written yet is listed as coming soon.

import { courseHref } from './router';
import { courseLessons, hasLesson, OUTLINES } from './registry';

export interface CourseMeta {
  /** "01" */
  n: string;
  /** Short name for lists: "Natural gas". */
  name: string;
  /** Full title: "Electricity & Energy Markets". */
  title: string;
  /** Where the course lives, once it has lessons. */
  href?: string;
  lessons?: number;
}

export const COURSES: CourseMeta[] = OUTLINES.map((c, i) => {
  const written = courseLessons(c.slug).filter((l) => hasLesson(l.id)).length;
  return {
    n: String(i + 1).padStart(2, '0'),
    name: c.short,
    title: c.title,
    ...(written > 0 ? { href: courseHref(c.slug), lessons: written } : {}),
  };
});
