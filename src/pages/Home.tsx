import { useEffect } from 'react';
import { COURSES } from '../course/courses';
import { getLesson, LESSONS } from '../course/registry';
import { lessonHref } from '../course/router';
import { useLastLesson } from '../course/progress';
import { SiteFooter } from './SiteFooter';

export function Home() {
  const last = useLastLesson();
  const lesson = (last && getLesson(last)) || LESSONS[0];

  useEffect(() => {
    document.title = 'Ground Up';
  }, []);

  return (
    <main className="col page">
      <header>
        <h1 className="name">Ground Up</h1>
        <p className="dek">Seven courses in how markets work</p>
      </header>

      <p className="lede">
        Ground Up teaches how the markets for real-world resources work, starting from the physical systems underneath them. You build an understanding of
        supply, price and risk on that foundation, through simulations you can change.
      </p>
      <p className="lede-2">
        {last ? 'Continue where you left off: ' : 'Start with the first lesson: '}
        {COURSES[0].name} —{' '}
        <a href={lessonHref(lesson.id)}>
          {lesson.id} {lesson.title}
        </a>
        .
      </p>

      <section className="sec" aria-labelledby="courses">
        <h2 className="label" id="courses">
          Courses
        </h2>
        <ol className="rows">
          {COURSES.map((c) => (
            <li key={c.n}>
              {c.href ? (
                <a className="row" href={c.href}>
                  <span className="row-n">{c.n}</span>
                  <span className="row-t">{c.name}</span>
                  <span className="row-m">{c.lessons} lessons</span>
                </a>
              ) : (
                <div className="row">
                  <span className="row-n">{c.n}</span>
                  <span className="row-t">{c.name}</span>
                  <span className="row-m">Soon</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <SiteFooter />
    </main>
  );
}
