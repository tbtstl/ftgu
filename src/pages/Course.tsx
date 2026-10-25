import { useEffect, useState } from 'react';
import { CHAPTERS, getLesson, hasLesson, LESSONS } from '../course/registry';
import { lessonHref } from '../course/router';
import { lessonProgress, useLastLesson, useProgress } from '../course/progress';
import { Crumbs } from '../framework/Page';
import { RunnerMark } from '../framework/RunnerMark';
import { ResumeCard } from './ResumeCard';
import { SiteFooter } from './SiteFooter';

/** The electricity course: a short introduction, then the contents, chapter by chapter. */
export function Course() {
  const progress = useProgress();
  const last = useLastLesson();
  const current = (last && getLesson(last)) || undefined;
  const [open, setOpen] = useState<Record<number, boolean>>(() => ({ [current?.chapter ?? 1]: true }));
  const resume = current ?? LESSONS[0];

  useEffect(() => {
    document.title = 'FTGU | Electricity & Energy';
  }, []);

  return (
    <main className="col page">
      <Crumbs items={[{ label: 'From The Ground Up', href: '#/', icon: <RunnerMark size={22} /> }, { label: 'Electricity' }]} />

      <header className="hdr">
        <h1 className="name">Electricity &amp; Energy Markets</h1>
        <p className="dek">
          {CHAPTERS.length} chapters · {LESSONS.length} lessons
        </p>
      </header>

      <p className="lede">
        Flip a switch and a lamp turns on. Somewhere, a generator works a little harder to keep up — and a market decided, minutes earlier, who would be paid to
        do it. This course explains both halves, from a single battery to a grid of your own.
      </p>
      <ResumeCard lesson={resume} started={!!current} />

      <section className="sec" aria-labelledby="contents">
        <h2 className="label" id="contents">
          Contents
        </h2>
        <ol className="rows">
          {CHAPTERS.map((c) => {
            const isOpen = !!open[c.n];
            const done = c.lessons.filter((l) => lessonProgress(progress, l.id).done).length;
            const complete = done === c.lessons.length;
            const status = complete ? 'Done' : done > 0 ? `${done} of ${c.lessons.length}` : `${c.lessons.length} lessons`;
            return (
              <li key={c.n}>
                <h3 className="row-h">
                  <button
                    type="button"
                    className="row"
                    aria-expanded={isOpen}
                    aria-controls={`chapter-${c.n}`}
                    onClick={() => setOpen((o) => ({ ...o, [c.n]: !o[c.n] }))}
                  >
                    <span className="row-n">{c.n}</span>
                    <span className="row-t">{c.title}</span>
                    <span className={complete ? 'row-m ok' : 'row-m'}>{status}</span>
                  </button>
                </h3>
                <div className={isOpen ? 'fold open' : 'fold'} id={`chapter-${c.n}`} inert={!isOpen}>
                  <div className="fold-in">
                    <ol className="rows rows-in">
                      {c.lessons.map((l) => {
                        const lp = lessonProgress(progress, l.id);
                        const isCurrent = l.id === current?.id;
                        const cls = 'row' + (lp.done ? ' done' : '') + (isCurrent ? ' now' : '');
                        return (
                          <li key={l.id}>
                            {hasLesson(l.id) ? (
                              <a className={cls} href={lessonHref(l.id)} aria-current={isCurrent ? 'step' : undefined}>
                                <span className="row-n">{l.id}</span>
                                <span className="row-t">{l.title}</span>
                                <span className={lp.done ? 'row-m ok' : 'row-m'} aria-label={`${lp.solved} of ${lp.total} challenges solved`}>
                                  {lp.solved}/{lp.total}
                                </span>
                              </a>
                            ) : (
                              <div className={cls + ' done'}>
                                <span className="row-n">{l.id}</span>
                                <span className="row-t">{l.title}</span>
                                <span className="row-m">Soon</span>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <SiteFooter />
    </main>
  );
}
