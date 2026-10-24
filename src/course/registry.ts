// Every course's outline, and lookups across them. Each course's chapters and lessons are listed
// in src/course/outlines/<slug>.ts. Electricity lessons live at src/lessons/ch<N>/L<N>_<M>.tsx;
// every other course's at src/lessons/<slug>/ch<N>/L<N>_<M>.tsx. Lessons are loaded on demand.

import type { ComponentType } from 'react';
import type { ChapterMeta, CourseOutline, LessonMeta } from './outline';
import { ELECTRICITY } from './outlines/electricity';
import { GAS } from './outlines/gas';
import { AGRICULTURE } from './outlines/agriculture';
import { OIL } from './outlines/oil';
import { WEATHER } from './outlines/weather';
import { SHIPPING } from './outlines/shipping';
import { COMPUTE } from './outlines/compute';

export type { ChapterMeta, CourseOutline, LessonMeta } from './outline';

/** The school's courses, in the order the home page lists them. */
export const OUTLINES: CourseOutline[] = [ELECTRICITY, GAS, AGRICULTURE, OIL, WEATHER, SHIPPING, COMPUTE];

/** Every lesson in every course. */
export const ALL_LESSONS: LessonMeta[] = OUTLINES.flatMap((c) => c.chapters.flatMap((ch) => ch.lessons));

/** The electricity course's chapters and lessons. */
export const CHAPTERS: ChapterMeta[] = ELECTRICITY.chapters;
export const LESSONS: LessonMeta[] = CHAPTERS.flatMap((c) => c.lessons);

export function getCourse(slug: string): CourseOutline | undefined {
  return OUTLINES.find((c) => c.slug === slug);
}

export function courseLessons(slug: string): LessonMeta[] {
  return getCourse(slug)?.chapters.flatMap((c) => c.lessons) ?? [];
}

export function getLesson(id: string): LessonMeta | undefined {
  return ALL_LESSONS.find((l) => l.id === id);
}

export function getChapter(n: number, course = 'electricity'): ChapterMeta | undefined {
  return getCourse(course)?.chapters.find((c) => c.n === n);
}

/** The lessons before and after this one in its course. */
export function neighbors(id: string): { prev?: LessonMeta; next?: LessonMeta } {
  const meta = getLesson(id);
  const lessons = meta ? courseLessons(meta.course) : [];
  const i = lessons.findIndex((l) => l.id === id);
  return { prev: i > 0 ? lessons[i - 1] : undefined, next: i >= 0 && i < lessons.length - 1 ? lessons[i + 1] : undefined };
}

/** Path of a lesson's component module, relative to this file: "4.4" or "gas/4.4". */
export function lessonModulePath(id: string): string {
  const slash = id.lastIndexOf('/');
  const dir = slash >= 0 ? `${id.slice(0, slash)}/` : '';
  const [c, m] = id.slice(slash + 1).split('.');
  return `../lessons/${dir}ch${c}/L${c}_${m}.tsx`;
}

const modules = import.meta.glob<{ default: ComponentType }>(['../lessons/ch*/L*_*.tsx', '../lessons/*/ch*/L*_*.tsx']);

/** Loader for a lesson's component, or undefined if the lesson hasn't been written. */
export function lessonLoader(id: string): (() => Promise<{ default: ComponentType }>) | undefined {
  return modules[lessonModulePath(id)];
}

export function hasLesson(id: string): boolean {
  return lessonModulePath(id) in modules;
}
