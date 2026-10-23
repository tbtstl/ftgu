import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { getChapter, getLesson, neighbors } from '../course/registry';
import { lessonHref } from '../course/router';

export const LessonContext = createContext<string>('');

/** The id of the lesson currently rendering ("" outside a lesson). */
export function useLessonId(): string {
  return useContext(LessonContext);
}

export function Banner({ home = false }: { home?: boolean }) {
  return (
    <header className="bn">
      <div className="wrap">
        <div className="bn-t">
          <a href="#/">Electricity Grids &amp; Energy Markets</a>
        </div>
        <nav className="bn-nav" aria-label="Site">
          <a href="#/contents">Contents</a>
          <a href="#/engines">Simulation engines</a>
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
 * Every lesson component's root is <LessonPage id="x.y">.
 */
export function LessonPage({ id, children }: { id: string; children: ReactNode }) {
  const meta = getLesson(id);
  const chapter = meta ? getChapter(meta.chapter) : undefined;
  const { prev, next } = neighbors(id);

  useEffect(() => {
    document.title = meta ? `${meta.id} ${capitalize(meta.title)} · Electricity Grids & Energy Markets` : 'Electricity Grids & Energy Markets';
  }, [meta]);

  return (
    <LessonContext.Provider value={id}>
      <Banner />
      <main className="art">
        <div className="wrap">
          <div className="meta">
            Chapter {chapter?.n} · {chapter?.title} · Lesson {id}
          </div>
          <h1 className="tt">{meta ? titleCase(meta.title) : id}</h1>
          {children}
          <nav className="pg" aria-label="Lessons">
            {prev ? <a href={lessonHref(prev.id)}>← {prev.id} {capitalize(prev.title)}</a> : <a href="#/">← Introduction</a>}
            <a href="#/contents">Contents</a>
            {next ? <a href={lessonHref(next.id)}>{next.id} {capitalize(next.title)} →</a> : <span>End of the course</span>}
          </nav>
        </div>
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
