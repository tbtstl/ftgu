import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { getChapter, getLesson, neighbors } from '../course/registry';
import { lessonHref } from '../course/router';
import { TwoUpLayout, useWideViewport } from './twoUp';

export const LessonContext = createContext<string>('');

/** The id of the lesson currently rendering ("" outside a lesson). */
export function useLessonId(): string {
  return useContext(LessonContext);
}

export function Banner({ home = false, wide = false }: { home?: boolean; wide?: boolean }) {
  return (
    <header className="bn">
      <div className={wide ? 'wrap wide' : 'wrap'}>
        <div className="bn-t">
          <a href="#/">Electricity Grids &amp; Energy Markets</a>
        </div>
        <nav className="bn-nav" aria-label="Site">
          <a href="#/contents">Contents</a>
          <a href="#/engines">How it fits together</a>
          {home && <a href={lessonHref('1.1')}>Start the course</a>}
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return <footer className="ft">Electricity Grids &amp; Energy Markets · an interactive course</footer>;
}

/**
 * Wraps a lesson: banner, chapter line, title, the lesson body, and previous/next links.
 * Every lesson component's root is <LessonPage id="x.y">. On wide screens the body is laid
 * out two-up: prose on the left, the current demonstration fixed on the right.
 */
export function LessonPage({ id, children, twoUp = true }: { id: string; children: ReactNode; twoUp?: boolean }) {
  const wideViewport = useWideViewport();
  const wide = twoUp && wideViewport;
  const meta = getLesson(id);
  const chapter = meta ? getChapter(meta.chapter) : undefined;
  const { prev, next } = neighbors(id);

  useEffect(() => {
    document.title = meta ? `${meta.id} ${capitalize(meta.title)} · Electricity Grids & Energy Markets` : 'Electricity Grids & Energy Markets';
  }, [meta]);

  return (
    <LessonContext.Provider value={id}>
      <Banner wide={wide} />
      <main className="art">
        <TwoUpLayout wide={wide}>
          <div className="meta">
            Chapter {chapter?.n} · {chapter?.title} · Lesson {id}
          </div>
          <h1 className="tt">{meta ? titleCase(meta.title) : id}</h1>
          {children}
          <nav className="pg" aria-label="Lessons">
            {prev ? (
              <a href={lessonHref(prev.id)} title={`${prev.id} ${capitalize(prev.title)}`}>
                ← {prev.id} {capitalize(prev.title)}
              </a>
            ) : (
              <a href="#/">← Introduction</a>
            )}
            <a href="#/contents">Contents</a>
            {next ? (
              <a href={lessonHref(next.id)} title={`${next.id} ${capitalize(next.title)}`}>
                {next.id} {capitalize(next.title)} →
              </a>
            ) : (
              <span>End of the course</span>
            )}
          </nav>
        </TwoUpLayout>
      </main>
      <Footer />
    </LessonContext.Provider>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
