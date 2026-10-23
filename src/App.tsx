import { Component, lazy, Suspense, useEffect, useMemo, type ComponentType, type ReactNode } from 'react';
import { useRoute } from './course/router';
import { getLesson, lessonLoader } from './course/registry';
import { Home } from './pages/Home';
import { Banner, Footer, titleCase } from './framework/Page';

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
  const key = route.kind === 'lesson' ? route.id : 'home';

  useEffect(() => {
    if (route.kind === 'home' && route.section) {
      document.getElementById(route.section)?.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }, [key, route.kind === 'home' ? route.section : undefined]);

  const Lesson = useMemo(() => (route.kind === 'lesson' ? lessonComponent(route.id) : undefined), [key]);

  if (route.kind === 'home') return <Home />;
  if (!Lesson) return <Missing id={route.id} />;
  return (
    <LessonBoundary key={key} id={route.id}>
      <Suspense fallback={<Loading />}>
        <Lesson />
      </Suspense>
    </LessonBoundary>
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
      <>
        <Banner />
        <main className="art">
          <div className="wrap">
            <div className="meta">Lesson {this.props.id}</div>
            <h1 className="tt">{meta ? titleCase(meta.title) : 'Lesson'}</h1>
            <p className="pp">
              Something went wrong while loading this lesson. <a href={`#/${this.props.id}`} onClick={() => window.location.reload()}>Reload the page</a> or go{' '}
              <a href="#/contents">back to the contents</a>.
            </p>
          </div>
        </main>
        <Footer />
      </>
    );
  }
}

function Loading() {
  return (
    <>
      <Banner />
      <main className="art">
        <div className="wrap">
          <p className="meta">Loading the lesson…</p>
        </div>
      </main>
    </>
  );
}

function Missing({ id }: { id: string }) {
  const meta = getLesson(id);
  return (
    <>
      <Banner />
      <main className="art">
        <div className="wrap">
          <div className="meta">Lesson {id}</div>
          <h1 className="tt">{meta ? titleCase(meta.title) : 'Lesson not found'}</h1>
          <p className="pp">
            {meta ? 'This lesson isn’t available yet.' : 'There’s no lesson at this address.'} <a href="#/contents">Back to the contents</a>
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
