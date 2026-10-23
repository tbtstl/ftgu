import { useState } from 'react';
import { Banner, Footer } from '../framework/Page';
import { TEXT } from '../framework/tokens';
import { CHAPTERS, LESSONS, hasLesson } from '../course/registry';
import { lessonHref } from '../course/router';
import { useProgress } from '../course/progress';

const LAYERS = [
  { title: 'The wires', text: 'Circuits, alternating current, and how power flows through a network.', chapters: 'Chapters 1–2', color: TEXT.blue },
  { title: 'Running the grid', text: 'Keeping supply matched to demand: dispatch, frequency, storage.', chapters: 'Chapter 3', color: TEXT.teal },
  { title: 'The markets', text: 'Auctions that decide who runs, and prices that differ by place.', chapters: 'Chapters 4–5', color: TEXT.orange },
  { title: 'Trading', text: 'Strategies that profit from price differences, and their risks.', chapters: 'Chapter 6', color: TEXT.violet },
];

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" role="img" aria-label="Challenge solved">
      <path d="M3 9.5 L7.5 14 L15 4.5" fill="none" stroke="#3f6f1b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Home() {
  const progress = useProgress();
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const allOpen = CHAPTERS.every((c) => open[c.n]);
  const first = LESSONS[0];

  return (
    <>
      <Banner home />
      <main className="art">
        <div className="wrap">
          <div className="meta">
            An interactive course · {CHAPTERS.length} chapters · {LESSONS.length} lessons
          </div>
          <h1 className="tt">From a Battery to a Power Market</h1>
          <p className="pp">
            Flip a switch and a lamp turns on instantly. Somewhere, perhaps hundreds of miles away, a generator is now working slightly harder to keep up with you — and a
            market decided, a day or a few minutes earlier, who would be paid to do it.
          </p>
          <p className="pp">
            This course explains both halves of that story: the physics of how the grid works, and the economics of how its power is priced and traded. Every lesson is
            built around simulations you can change, starting with a battery and a single resistor and ending with a grid of your own.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px', paddingTop: '1.1em' }}>
            <a className="cta" href={lessonHref(first.id)}>
              Start the course →
            </a>
            <span style={{ fontSize: 15, color: 'var(--muted)' }}>
              Lesson {first.id} · {first.title.charAt(0).toUpperCase() + first.title.slice(1)}
            </span>
          </div>

          <div className="toc-head" id="contents">
            <h2 className="hd">Contents</h2>
            <button
              type="button"
              className="tbtn"
              aria-expanded={allOpen}
              onClick={() => setOpen(allOpen ? {} : Object.fromEntries(CHAPTERS.map((c) => [c.n, true])))}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
          <ol className="toc">
            {CHAPTERS.map((c) => {
              const isOpen = !!open[c.n];
              const done = c.lessons.filter((l) => (progress[l.id]?.length ?? 0) > 0).length;
              return (
                <li key={c.n}>
                  <h3 className="toc-h">
                    <button
                      type="button"
                      className="toc-row"
                      aria-expanded={isOpen}
                      aria-controls={`chapter-${c.n}`}
                      onClick={() => setOpen((o) => ({ ...o, [c.n]: !o[c.n] }))}
                    >
                      <span className="toc-n" style={{ color: TEXT[c.tone] }}>
                        {c.n}
                      </span>
                      <span className="toc-t">{c.title}</span>
                      <span className="toc-c">
                        {c.lessons.length} lessons{done > 0 ? ` · ${done} solved` : ''}
                      </span>
                      <svg className={isOpen ? 'chev open' : 'chev'} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M6 3.5 L10.5 8 L6 12.5" fill="none" stroke="#6b6b6b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </h3>
                  {isOpen && (
                    <div className="toc-body" id={`chapter-${c.n}`}>
                      <p className="toc-blurb">{c.blurb}</p>
                      <ol className="toc-ls">
                        {c.lessons.map((l) => (
                          <li key={l.id}>
                            <span className="n">{l.id}</span>
                            {hasLesson(l.id) ? (
                              <a className="t" href={lessonHref(l.id)}>
                                {l.title}
                              </a>
                            ) : (
                              <span className="t">{l.title}</span>
                            )}
                            <span className="s">
                              {(progress[l.id]?.length ?? 0) > 0 && <Check />}
                              {l.sandbox}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <h2 className="hd" id="engines" style={{ paddingTop: '2.4em' }}>
            How the simulations fit together
          </h2>
          <p className="pp">
            Every simulation in the course runs on the same imaginary region: nine power plants, six substations, the transmission lines between them, and the homes and
            businesses they serve. Each part of the course adds a layer on top of the one before:
          </p>
          <ol className="layers">
            {LAYERS.map((l, i) => (
              <li key={l.title}>
                <span className="ly-n" style={{ background: l.color }}>
                  {i + 1}
                </span>
                <div>
                  <span className="ly-t">{l.title}</span>
                  <span className="ly-d">{l.text}</span>
                </div>
                <span className="ly-c">{l.chapters}</span>
              </li>
            ))}
          </ol>
          <p className="pp" style={{ paddingTop: '1.1em' }}>
            Because it’s the same region throughout, the gas plant you meet in Chapter 2 has the same costs when it bids into the market in Chapter 4, and the same limits
            when you trade around it in Chapter 6. Chapter 7 brings these layers to rooftop solar and home batteries, and the capstone in Chapter 8 puts all of them to work
            on a grid you design yourself.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
