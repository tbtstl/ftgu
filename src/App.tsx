import { Component, lazy, Suspense, useEffect, useMemo, type ComponentType, type ReactNode } from 'react';
import { courseHref, useRoute } from './course/router';
import { getLesson, lessonLoader } from './course/registry';
import { Home } from './pages/Home';
import { Course } from './pages/Course';
import { LessonHeader } from './framework/Page';
import { HighlightBar, MENTOR_ENABLED, MentorDock, MentorProvider } from './mentor';

const cache = new Map<string, ComponentType>();

function lessonComponent(id: string): ComponentType | undefined {
  if (cache.has(id)) return cache.get(id);
  const load = lessonLoader(id);
  if (!load) return undefined;
  const C = lazy(load);
  cache.set(id, C);
  return C;
}

export function App() {
  const route = useRoute();
  const key = route.kind === 'lesson' ? route.id : route.kind === 'course' ? `course:${route.course}` : route.kind;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [key]);

  const Lesson = useMemo(() => (route.kind === 'lesson' ? lessonComponent(route.id) : undefined), [key]);

  let page: ReactNode;
  if (route.kind === 'home') page = <Home />;
  else if (route.kind === 'course') page = <Course key={route.course} slug={route.course} />;
  else if (!Lesson) page = <Missing id={route.id} />;
  else
    page = (
      <LessonBoundary key={key} id={route.id}>
        <Suspense fallback={<Loading id={route.id} />}>
          <Lesson />
        </Suspense>
      </LessonBoundary>
    );

  if (!MENTOR_ENABLED) return page;
  // The mentor sits above the router so each course's conversation carries from lesson to lesson.
  const lessonId = route.kind === 'lesson' && Lesson ? route.id : null;
  return (
    <MentorProvider lessonId={lessonId}>
      {page}
      {lessonId && (
        <>
          <MentorDock />
          <HighlightBar />
        </>
      )}
    </MentorProvider>
  );
}

/** Keeps one broken or unloadable lesson from taking the whole site down with it. */
class LessonBoundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const meta = getLesson(this.props.id);
    return (
      <Notice id={this.props.id} title={meta ? meta.title : 'Lesson'}>
        Something went wrong while loading this lesson. <a href={`#/${this.props.id}`} onClick={() => window.location.reload()}>Reload the page</a> or go{' '}
        <a href={courseHref(meta?.course)}>back to the contents</a>.
      </Notice>
    );
  }
}

function Loading({ id }: { id: string }) {
  return (
    <>
      <LessonHeader id={id} />
      <main className="art">
        <div className="wrap">
          <p className="dek">Loading the lesson…</p>
        </div>
      </main>
    </>
  );
}

function Missing({ id }: { id: string }) {
  const meta = getLesson(id);
  return (
    <Notice id={id} title={meta ? meta.title : 'Lesson not found'}>
      {meta ? 'This lesson isn’t available yet.' : 'There’s no lesson at this address.'} <a href={courseHref(meta?.course)}>Back to the contents</a>
    </Notice>
  );
}

function Notice({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <>
      <LessonHeader id={id} />
      <main className="art">
        <div className="wrap">
          <h1 className="tt">{title}</h1>
          <p className="dek">Lesson {getLesson(id)?.num ?? id}</p>
          <p className="pp">{children}</p>
        </div>
      </main>
    </>
  );
}
