import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { getChapter, getCourse, getLesson, neighbors, type LessonMeta } from '../course/registry';
import { courseHref, lessonHref } from '../course/router';
import { markVisited } from '../course/progress';
import { MentorHeaderItems, useMentor } from '../mentor';
import { RunnerMark } from './RunnerMark';
import { TwoUpLayout, useWideViewport } from './twoUp';

export const LessonContext = createContext<string>('');

/** The id of the lesson currently rendering ("" outside a lesson). */
export function useLessonId(): string {
  return useContext(LessonContext);
}

export interface Crumb {
  label: string;
  href?: string;
  /** Shown in place of the label, which stays as the link's accessible name. */
  icon?: ReactNode;
}

/** "From The Ground Up / Electricity / 4.4": the last crumb is the current page; a crumb may show an icon in place of its label. */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="crumbs">
        {items.map((c, i) => (
          <li key={c.label} className="crumb">
            {i > 0 && (
              <span className="crumb-sep" aria-hidden="true">
                /
              </span>
            )}
            {c.href ? (
              <a href={c.href} aria-label={c.icon ? c.label : undefined} className={c.icon ? 'crumb-icon' : undefined}>
                {c.icon ?? c.label}
              </a>
            ) : (
              <span aria-current="page">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The thin bar above a lesson: the runner (home), where the lesson sits, the contents, and the mentor. */
export function LessonHeader({ id, wide = false }: { id: string; wide?: boolean }) {
  const meta = getLesson(id);
  const course = getCourse(meta?.course ?? (id.includes('/') ? id.split('/')[0] : 'electricity'));
  const home = courseHref(course?.slug);
  return (
    <header className={wide ? 'sh wide' : 'sh'}>
      <Crumbs
        items={[{ label: 'From The Ground Up', href: '#/', icon: <RunnerMark size={22} /> }, { label: course?.short ?? 'Course', href: home }, { label: meta?.num ?? id }]}
      />
      <div className="sh-r">
        <a className="sh-link" href={home}>
          Contents
        </a>
        <MentorHeaderItems />
      </div>
    </header>
  );
}

/**
 * Wraps a lesson: header, title, the lesson body, and links to the previous and next lessons.
 * Every lesson component's root is <LessonPage id="x.y">. On wide screens the body is laid
 * out two-up: prose on the left, the current demonstration fixed on the right.
 */
export function LessonPage({ id, children, twoUp = true }: { id: string; children: ReactNode; twoUp?: boolean }) {
  const wideViewport = useWideViewport(useMentor()?.reserve ?? 0);
  const wide = twoUp && wideViewport;
  const meta = getLesson(id);
  const chapter = meta ? getChapter(meta.chapter, meta.course) : undefined;
  const { prev, next } = neighbors(id);

  useEffect(() => {
    document.title = meta ? `FTGU | ${meta.num} ${meta.title}` : 'From The Ground Up';
    if (meta) markVisited(meta.id);
  }, [meta]);

  return (
    <LessonContext.Provider value={id}>
      <LessonHeader id={id} wide={wide} />
      <main className="art">
        <TwoUpLayout wide={wide}>
          <h1 className="tt">{meta ? meta.title : id}</h1>
          <p className="dek">
            Lesson {meta?.num ?? id}
            {chapter && ` · ${chapter.title}`}
          </p>
          {children}
          <LessonNav prev={prev} next={next} home={courseHref(meta?.course)} />
        </TwoUpLayout>
      </main>
    </LessonContext.Provider>
  );
}

function LessonNav({ prev, next, home }: { prev?: LessonMeta; next?: LessonMeta; home: string }) {
  return (
    <nav className="lnav" aria-label="Lessons">
      <ul className="rows">
        <li>
          {prev ? (
            <a className="row row-wide" href={lessonHref(prev.id)}>
              <span className="row-n">Previous</span>
              <span className="row-t">{prev.title}</span>
              <span className="row-m">{prev.num}</span>
            </a>
          ) : (
            <a className="row row-wide" href={home}>
              <span className="row-n">Previous</span>
              <span className="row-t">Course contents</span>
              <span className="row-m" />
            </a>
          )}
        </li>
        <li>
          {next ? (
            <a className="row row-wide" href={lessonHref(next.id)}>
              <span className="row-n">Next</span>
              <span className="row-t">{next.title}</span>
              <span className="row-m">{next.num}</span>
            </a>
          ) : (
            <a className="row row-wide" href="#/">
              <span className="row-n">Next</span>
              <span className="row-t">That’s the end of the course</span>
              <span className="row-m" />
            </a>
          )}
        </li>
      </ul>
    </nav>
  );
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs.', 'with']);

/** "AC vs. DC and three-phase electricity" → "AC vs. DC and Three-Phase Electricity". */
export function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w, i) => {
      if (i > 0 && SMALL.has(w.toLowerCase())) return w.toLowerCase();
      return w
        .split('-')
        .map((p) => (p === p.toUpperCase() ? p : p.charAt(0).toUpperCase() + p.slice(1)))
        .join('-');
    })
    .join(' ');
}
