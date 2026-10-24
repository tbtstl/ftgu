// The shapes every course outline shares, and a helper for writing one.

import type { Tone } from '../framework/tokens';

export interface LessonMeta {
  /** Unique across the school: "4.4" for electricity, "gas/3.4" for the other courses. */
  id: string;
  /** The course's slug: "electricity", "gas". */
  course: string;
  /** The lesson's number within its course: "4.4". */
  num: string;
  chapter: number;
  title: string;
  sandbox: string;
}

export interface ChapterMeta {
  n: number;
  title: string;
  blurb: string;
  tone: Tone;
  lessons: LessonMeta[];
}

export interface CourseOutline {
  /** Used in addresses (#/gas/3.4) and file paths (src/lessons/gas/ch3/L3_4.tsx). */
  slug: string;
  /** The full title: "Natural Gas: From Molecules to Markets". */
  title: string;
  /** Short name for breadcrumbs and lists: "Natural gas". */
  short: string;
  /** One or two sentences that open the course page. */
  lede: string;
  chapters: ChapterMeta[];
}

/** A chapter of a course; lesson ids are prefixed with the course's slug unless it's electricity. */
export function chapter(
  course: string,
  n: number,
  title: string,
  blurb: string,
  tone: Tone,
  lessons: Array<[string, string]>,
): ChapterMeta {
  return {
    n,
    title,
    blurb,
    tone,
    lessons: lessons.map(([t, sandbox], i) => {
      const num = `${n}.${i + 1}`;
      return { id: course === 'electricity' ? num : `${course}/${num}`, course, num, chapter: n, title: t, sandbox };
    }),
  };
}
