import { useMemo, useState } from 'react';
import { Banner, Footer } from '../framework/Page';
import { Figure } from '../framework/Figure';
import { Caption, Legend, Readouts, Slider } from '../framework/controls';
import { TimeChart } from '../framework/charts/TimeChart';
import { FUEL, TEXT } from '../framework/tokens';
import { hour as fmtHour, mw } from '../framework/format';
import { CHAPTERS, LESSONS, hasLesson } from '../course/registry';
import { lessonHref } from '../course/router';
import { useProgress } from '../course/progress';
import { dispatchDay, type DispatchUnit } from '../engines/ops/dispatch';

// A small illustrative grid for the introduction: one inflexible nuclear plant, wind, solar,
// a combined-cycle gas plant and a peaker.
const DEMAND = [560, 530, 510, 500, 505, 540, 610, 690, 740, 760, 770, 775, 770, 765, 770, 785, 820, 880, 940, 960, 920, 840, 730, 630];
const SOLAR = [0, 0, 0, 0, 0, 0, 10, 70, 160, 255, 330, 380, 400, 400, 370, 290, 195, 95, 25, 0, 0, 0, 0, 0];
const WIND = [180, 190, 195, 195, 195, 185, 170, 150, 130, 115, 105, 100, 95, 95, 100, 110, 120, 135, 150, 160, 170, 175, 180, 180];
const UNITS: DispatchUnit[] = [
  { id: 'nuclear', capacity: 300, minOutput: 300, cost: 12 },
  { id: 'wind', capacity: 200, cost: 0, available: WIND },
  { id: 'solar', capacity: 400, cost: 0, available: SOLAR },
  { id: 'gasCC', capacity: 400, cost: 38 },
  { id: 'gasCT', capacity: 250, cost: 95 },
];

function DayOnTheGrid() {
  const [h, setH] = useState(19);
  const day = useMemo(() => dispatchDay(UNITS, DEMAND, { ramp: false }), []);
  const r = day[h];
  const base = Math.round(r.output.nuclear + r.output.wind + r.output.solar);
  const gas = Math.round(r.output.gasCC + r.output.gasCT);
  const t = fmtHour(h);
  let story: string;
  if (r.output.gasCT > 0)
    story = `At ${t}, demand is ${DEMAND[h]} MW. Nuclear, wind and solar supply ${base} MW, and gas plants make up the remaining ${gas} MW. The last plant switched on is a gas peaker, so every megawatt-hour in this hour sells for $${r.price}.`;
  else if (r.output.gasCC > 0)
    story = `At ${t}, demand is ${DEMAND[h]} MW. Nuclear, wind and solar supply ${base} MW, and gas plants make up the remaining ${gas} MW. The last plant switched on is a combined-cycle gas plant, so every megawatt-hour in this hour sells for $${r.price}.`;
  else
    story = `At ${t}, demand is ${DEMAND[h]} MW, and nuclear, wind and solar can cover all of it, with ${300 + WIND[h] + SOLAR[h]} MW available. No gas plant is needed, and the price falls to $${r.price}.`;

  const series = (id: string) => day.map((d) => d.output[id]);
  return (
    <Figure name="A day on the grid" onReset={() => setH(19)}>
      <Legend
        items={[
          { label: 'Nuclear', color: FUEL.nuclear },
          { label: 'Wind', color: FUEL.wind },
          { label: 'Solar', color: FUEL.solar },
          { label: 'Gas combined-cycle', color: FUEL.gasCC },
          { label: 'Gas peaker', color: FUEL.gasCT },
          { label: 'Demand', color: '#333', kind: 'line' },
        ]}
      />
      <TimeChart
        ariaLabel="Electricity generation by source over a simulated day, stacked to meet demand"
        yLabel="Generation, MW"
        yMin={0}
        yMax={1000}
        height={250}
        stack={[
          { values: series('nuclear'), color: FUEL.nuclear },
          { values: series('wind'), color: FUEL.wind },
          { values: series('solar'), color: FUEL.solar },
          { values: series('gasCC'), color: FUEL.gasCC },
          { values: series('gasCT'), color: FUEL.gasCT },
        ]}
        series={[{ values: DEMAND, color: '#333', width: 2 }]}
        cursor={h}
        onScrub={setH}
      />
      <TimeChart
        ariaLabel="Hourly electricity price over the same day"
        yLabel="Price, $ per MWh"
        yMin={0}
        yMax={100}
        height={140}
        series={[{ values: day.map((d) => d.price), color: '#4e8a26', kind: 'step', width: 2.5 }]}
        yFormat={(v) => '$' + v}
        cursor={h}
        onScrub={setH}
      />
      <Slider label="Hour of the day" value={h} min={0} max={23} onChange={setH} display={t} />
      <Readouts
        items={[
          { label: 'demand', value: mw(DEMAND[h]) },
          { label: 'price per MWh', value: '$' + r.price, tone: 'green' },
        ]}
      />
      <Caption>{story}</Caption>
    </Figure>
  );
}

export function Home() {
  const progress = useProgress();
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
            Flip a switch and a lamp turns on instantly. Somewhere, perhaps hundreds of miles away, a generator is now working slightly harder to keep up with you. For
            the most part, nobody stored that energy in advance: the grid produced it the moment you asked for it, and a market decided — a day, an hour or five
            minutes earlier — who would be paid to do so.
          </p>
          <p className="pp">
            This course explains both halves of that story. The first half is physics: how electricity is generated, moved across a continent-sized machine and kept in
            balance every second. The second half is economics: how that machine is scheduled, priced and traded. We’ll begin with a battery and a single resistor, and
            end by designing, operating and trading on a grid of our own.
          </p>
          <p className="pp">
            Every idea is introduced with a simulation you can manipulate. The one below shows a simulated day on a small grid. Drag the slider, or across the chart, to
            move through the hours and watch which power plants are running and what each megawatt-hour of energy costs:
          </p>

          <DayOnTheGrid />

          <p className="pp">
            The price doesn’t simply follow demand. At noon, demand is above its daily average, yet energy is free — there’s more wind and sun available than the grid
            can use. At 19:00, demand is only a quarter higher, yet each megawatt-hour costs $95. By the end of Chapter 4 you’ll know exactly why. By the end of Chapter
            5 you’ll see why the same megawatt-hour can cost something different two towns over.
          </p>

          <h2 className="hd" id="contents">
            The course
          </h2>
          <p className="pp">
            The lessons build on one another and are best read in order. Each introduces one new idea, and each sandbox reuses the models from the lessons before it, so by
            the capstone every piece you’ve experimented with is part of a single working grid.
          </p>

          {CHAPTERS.map((c) => (
            <section className="ch" key={c.n}>
              <div className="ch-h">
                <span className="ch-n" style={{ color: TEXT[c.tone] }}>
                  {c.n}
                </span>
                <div>
                  <h3 className="ch-t">{c.title}</h3>
                  <div className="ch-d">{c.blurb}</div>
                </div>
              </div>
              <ol className="ls">
                {c.lessons.map((l) => {
                  const done = (progress[l.id]?.length ?? 0) > 0;
                  return (
                    <li key={l.id}>
                      <span className="ls-n">{l.id}</span>
                      {hasLesson(l.id) ? (
                        <a className="ls-t" href={lessonHref(l.id)}>
                          {l.title}
                        </a>
                      ) : (
                        <span className="ls-t">{l.title}</span>
                      )}
                      <span className="ls-s">
                        {done && (
                          <svg width="14" height="14" viewBox="0 0 18 18" role="img" aria-label="Challenge solved">
                            <path d="M3 9.5 L7.5 14 L15 4.5" fill="none" stroke="#3f6f1b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                        {l.sandbox}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          <h2 className="hd" id="engines">
            One grid, four engines
          </h2>
          <p className="pp">
            Rather than dozens of separate toys, every sandbox runs on a small set of simulation engines that share one model of the grid. A generator you place in
            Chapter 2 keeps the same costs when it bids into a market in Chapter 4, and the same ramp limits when you trade around it in Chapter 6.
          </p>
          <div className="eng">
            <div className="eng-bar">
              <div className="eng-name">Interactive course framework</div>
              <div className="eng-sub">Explanations · Parameter controls · Charts · Challenges · Saved scenarios</div>
            </div>
            <div className="eng-row">
              <div className="eng-box">
                <div className="eng-name" style={{ color: TEXT.blue }}>
                  Electrical physics
                </div>
                <div className="eng-sub">Circuits, AC, power flow</div>
                <div className="eng-ch">Chapters 1–2</div>
              </div>
              <div className="eng-box">
                <div className="eng-name" style={{ color: TEXT.teal }}>
                  Grid operations
                </div>
                <div className="eng-sub">Dispatch, stability, storage</div>
                <div className="eng-ch">Chapters 2–3 and 7</div>
              </div>
              <div className="eng-box">
                <div className="eng-name" style={{ color: TEXT.orange }}>
                  Market engine
                </div>
                <div className="eng-sub">Bids, clearing, LMP</div>
                <div className="eng-ch">Chapters 4–5 and 8</div>
              </div>
              <div className="eng-box">
                <div className="eng-name" style={{ color: TEXT.violet }}>
                  Strategy engine
                </div>
                <div className="eng-sub">Trading, optimization, risk</div>
                <div className="eng-ch">Chapters 6–8</div>
              </div>
            </div>
            <div className="eng-bar">
              <div className="eng-name">Shared grid model</div>
              <div className="chips">
                {['Nodes', 'Lines', 'Generators', 'Loads', 'Batteries', 'Time series', 'Market participants'].map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            </div>
          </div>
          <p className="pp">
            The model gains fidelity only when a lesson needs it. Chapter 1 starts with circuit equations on a single loop; Chapter 2 grows them into power flow across a
            meshed network; Chapter 5 wraps that same network in an optimizer to produce a price at every node. Nothing you learn early is thrown away later — only
            refined.
          </p>
          <p className="pp">
            The result is an electricity-system textbook you can run: every concept has a model you can manipulate, and every model feeds into the final grid-and-market
            simulator.
          </p>
          <a className="go" href={lessonHref('1.1')}>
            Begin with Lesson 1.1: Voltage, current, resistance, and power →
          </a>
        </div>
      </main>
      <Footer />
    </>
  );
}
