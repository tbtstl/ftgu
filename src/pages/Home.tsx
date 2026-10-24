import { useEffect } from 'react';
import { COURSES } from '../course/courses';
import { getLesson, LESSONS } from '../course/registry';
import { useLastLesson } from '../course/progress';
import { ResumeCard } from './ResumeCard';
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
        <p className="dek">Understand markets from first principles.</p>
      </header>

      <p className="lede">
        Learn how real-world markets work by exploring the physical systems behind them. Experiment with interactive simulations, discover how constraints shape
        prices, and develop trading strategies from the ground up.
      </p>
      <ResumeCard lesson={lesson} started={!!last} course={COURSES[0].title} />

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
