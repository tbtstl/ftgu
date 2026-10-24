import {
  Caption,
  Challenge,
  Checkbox,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  pct,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { DEFAULT_ASSUMPTIONS, forecastPath, sharesAt } from '../../../engines/shipping/forecast';
import { equilibrium } from '../../../engines/shipping/market';
import { whatIf } from '../../../engines/shipping/strategies';
import type { Chokepoint } from '../../../model/shipping/geo';
import { MONTH_SHORT, eventAt, monthLabel, standardHistory } from '../../../model/shipping/history';
import type { ClassId } from '../../../model/shipping/trades';
import { useCompany } from '../shared/company';
import { XYChart } from '../shared/XYChart';

const HIST = standardHistory();
const CLASSES: ClassId[] = ['cape', 'kmax'];
const CLASS_NAME: Record<ClassId, string> = { cape: 'Capesize', kmax: 'Kamsarmax' };
const CLASS_PLURAL: Record<ClassId, string> = { cape: 'Capesizes', kmax: 'Kamsarmaxes' };
const QUARTER_DAYS = (3 * 365) / 12;
const EARN = 355 / 365;

export type ScenarioId = 'cyclone' | 'panama' | 'deliveries' | 'steel' | 'storms';
export interface Pair {
  cape: number;
  kmax: number;
}

interface ScenarioDef {
  id: ScenarioId;
  tab: string;
  title: string;
  /** The forecast date: the last month whose earnings are known. */
  t: number;
  /** How many of the next three months the change lasts. */
  months: number;
  routeScale?: Record<string, number>;
  closed?: Chokepoint[];
  fleet?: number;
  /** Extra share of sea time lost to weather. */
  weather?: number;
  story: string;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'cyclone',
    tab: 'Cyclone',
    title: 'Cyclones at Port Hedland',
    t: 12,
    months: 1,
    routeScale: { 'C-PHE-QIN': 0.75 },
    story: 'Cyclones close Port Hedland’s berths on and off for three weeks, and a quarter of the next month’s ore never sails.',
  },
  {
    id: 'panama',
    tab: 'Panama',
    title: 'Panama restricts transits',
    t: 46,
    months: 3,
    closed: ['panama'],
    story: 'A drought lowers the lake that feeds the Panama Canal’s locks, and for the next three months laden bulk carriers can’t book a transit.',
  },
  {
    id: 'deliveries',
    tab: 'Deliveries',
    title: 'A wave of deliveries',
    t: 52,
    months: 3,
    fleet: 1.06,
    story: 'Shipyards hand over ships faster than their order books showed: both fleets are 6% larger for the next three months.',
  },
  {
    id: 'steel',
    tab: 'Steel cut',
    title: 'China’s steel mills cut output',
    t: 74,
    months: 3,
    routeScale: { 'C-PHE-QIN': 0.85, 'C-TUB-QIN': 0.85, 'C-TUB-ROT': 0.85 },
    story: 'Steel mills cut production, and iron-ore shipments from Australia and Brazil fall by 15% for the next three months.',
  },
  {
    id: 'storms',
    tab: 'Storms',
    title: 'A stormy season',
    t: 128,
    months: 3,
    weather: 0.06,
    story: 'An unusually stormy autumn and early winter: on every ocean, passages take 6% longer than usual for the next three months.',
  },
];

const BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s])) as Record<ScenarioId, ScenarioDef>;

/** A month of the quarter (k = 1, 2, 3) as it happened, with the scenario's change applied. */
export function outcomeMonth(cls: ClassId, sc: ScenarioDef, k: number): number {
  const t = sc.t + k;
  const m = HIST.cls[cls][t];
  if (k > sc.months) return m.tce;
  const ev = eventAt(t);
  if (sc.weather) {
    // Weather isn't one of whatIf's dials: re-solve the month with longer passages, as a ratio.
    const base = { demand: m.demand, month: m.month, fleet: m.fleet, bunker: m.bunker, cohortShares: sharesAt(m), routeScale: ev?.routeScale, closed: ev?.closed, congestion: ev?.congestion };
    const plain = equilibrium(cls, base).tce;
    const stormy = equilibrium(cls, { ...base, weather: sc.weather }).tce;
    return m.tce * (stormy / plain);
  }
  return whatIf(cls, m, { fleet: sc.fleet, closed: sc.closed, routeScale: sc.routeScale }, ev);
}

/**
 * The fundamentals model's forecast of a month (Lesson 5.1), made at the forecast date and told
 * about the change: the projected fleet and cargo, cleared with the change applied.
 */
export function modelMonth(cls: ClassId, sc: ScenarioDef, k: number): number {
  const now = HIST.cls[cls][sc.t];
  const fc = forecastPath(cls, HIST.cls[cls], sc.t, 3, DEFAULT_ASSUMPTIONS)[k - 1];
  const on = k <= sc.months;
  return equilibrium(cls, {
    demand: fc.demand,
    month: (sc.t + k) % 12,
    fleet: fc.fleet * (on ? (sc.fleet ?? 1) : 1),
    bunker: now.bunker,
    cohortShares: sharesAt(now),
    routeScale: on ? sc.routeScale : undefined,
    closed: on ? sc.closed : undefined,
    weather: on ? sc.weather : undefined,
  }).tce;
}

export interface ClassResult {
  /** Last month's earnings: the no-change forecast. */
  naive: number;
  /** The quarter's average earnings, $/day. */
  outcome: number;
  model: number;
  /** What the quarter would have averaged without the change. */
  without: number;
  /** Change in the quarter's earnings caused by the scenario. */
  effect: number;
  outcomes: number[];
  models: number[];
  /** The six months up to the forecast date. */
  before: number[];
}

const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const RESULTS = new Map<ScenarioId, Record<ClassId, ClassResult>>();

export function scenarioResult(id: ScenarioId): Record<ClassId, ClassResult> {
  const hit = RESULTS.get(id);
  if (hit) return hit;
  const sc = BY_ID[id];
  const one = (cls: ClassId): ClassResult => {
    const outcomes = [1, 2, 3].map((k) => outcomeMonth(cls, sc, k));
    const models = [1, 2, 3].map((k) => modelMonth(cls, sc, k));
    const outcome = avg(outcomes);
    const without = avg([1, 2, 3].map((k) => HIST.cls[cls][sc.t + k].tce));
    return {
      naive: HIST.cls[cls][sc.t].tce,
      outcome,
      model: avg(models),
      without,
      effect: outcome / without - 1,
      outcomes,
      models,
      before: [-5, -4, -3, -2, -1, 0].map((k) => HIST.cls[cls][sc.t + k].tce),
    };
  };
  const r = { cape: one('cape'), kmax: one('kmax') };
  RESULTS.set(id, r);
  return r;
}

export const TOLERANCE = 0.15;
export const NEEDED = 3;

/** A forecast scores when, for both classes, it is within 15% and closer than no change. */
export function scenarioScored(id: ScenarioId, f: Pair): boolean {
  const r = scenarioResult(id);
  return CLASSES.every((cls) => {
    const o = r[cls].outcome;
    const miss = Math.abs(f[cls] - o);
    return miss / o <= TOLERANCE + 1e-9 && miss < Math.abs(r[cls].naive - o) - 1e-9;
  });
}

/** The challenge: three of the five scenarios scored with forecasts locked in before revealing. */
export function forecastSolved(committed: Partial<Record<ScenarioId, Pair | null>>): boolean {
  return SCENARIOS.filter((s) => {
    const c = committed[s.id];
    return !!c && scenarioScored(s.id, c);
  }).length >= NEEDED;
}

const perDay = (x: number) => `$${fmt(x)}/day`;
const miss = (f: number, o: number) => `${f >= o ? '+' : '−'}${pct(Math.abs(f / o - 1))}`;
const NAIVE_DEFAULTS = Object.fromEntries(SCENARIOS.map((s) => [s.id, { cape: scenarioResult(s.id).cape.naive, kmax: scenarioResult(s.id).kmax.naive }])) as Record<ScenarioId, Pair>;
const NONE = Object.fromEntries(SCENARIOS.map((s) => [s.id, null])) as Record<ScenarioId, Pair | null>;
const NOT_REVEALED = Object.fromEntries(SCENARIOS.map((s) => [s.id, false])) as Record<ScenarioId, boolean>;

const YOU = GRAPHIC.orange;
const MODEL = GRAPHIC.blue;

/** The six months before the forecast date and the quarter after it, for one class. */
function QuarterChart({ cls, sc, forecast, revealed }: { cls: ClassId; sc: ScenarioDef; forecast: number; revealed: boolean }) {
  const r = scenarioResult(sc.id)[cls];
  const top = Math.max(...r.before, ...r.outcomes, ...r.models, r.naive) * 1.3;
  const yMax = Math.ceil(top / 10_000) * 10_000;
  const xs = [-5, -4, -3, -2, -1, 0];
  const series = [
    { xs, ys: r.before, color: GRAPHIC.green, width: 2.5 },
    { xs: [0, 3.2], ys: [r.naive, r.naive], color: '#9a9a9a', width: 1.5, dash: '2 4' },
    { xs: [0.8, 3.2], ys: [forecast, forecast], color: YOU, width: 3 },
    ...(revealed
      ? [
          { xs: [0, 1, 2, 3], ys: [r.before[5], ...r.models], color: MODEL, width: 2, dash: '6 4' },
          { xs: [0, 1, 2, 3], ys: [r.before[5], ...r.outcomes], color: GRAPHIC.green, width: 2.5 },
        ]
      : []),
  ];
  return (
    <XYChart
      ariaLabel={`${CLASS_NAME[cls]} earnings for the six months to ${monthLabel(sc.t)}, ending at ${perDay(r.naive)}, and your forecast of ${perDay(forecast)} for the next quarter.${revealed ? ` The quarter averaged ${perDay(r.outcome)}; the fundamentals model forecast ${perDay(r.model)}.` : ' The quarter itself is hidden.'}`}
      series={series}
      xMin={-5}
      xMax={3.2}
      yMin={0}
      yMax={yMax}
      yTicks={[0, yMax / 2, yMax]}
      xTicks={[-5, -4, -3, -2, -1, 0, 1, 2, 3]}
      xFormat={(v) => MONTH_SHORT[(sc.t + v + 1200) % 12]}
      yFormat={(v) => `$${fmt(v / 1000)}k`.replace('$−', '−$')}
      yLabel={`${CLASS_NAME[cls]} earnings, $ per day`}
      bands={[{ from: 0.5, to: 3.2, color: tint(GRAPHIC.gray, 0.14), label: revealed ? 'the quarter' : 'the quarter: hidden' }]}
      markers={revealed ? [{ x: 3, y: r.outcomes[2], color: TEXT.green, r: 4 }] : []}
      height={150}
    />
  );
}

export default function Lesson() {
  const design = useCompany();
  const fc = useScenario('forecast-challenge', {
    scenario: 'cyclone' as ScenarioId,
    forecasts: NAIVE_DEFAULTS,
    revealed: NOT_REVEALED,
    committed: NONE,
  });
  const { scenario, forecasts, revealed, committed } = fc.state;
  const sc = BY_ID[scenario];
  const r = scenarioResult(scenario);
  const f = forecasts[scenario];
  const shown = revealed[scenario];
  const locked = committed[scenario];
  const solved = forecastSolved(committed);
  const scoredCount = SCENARIOS.filter((s) => committed[s.id] && scenarioScored(s.id, committed[s.id] as Pair)).length;
  const lockedCount = SCENARIOS.filter((s) => committed[s.id]).length;

  const setForecast = (cls: ClassId, v: number) => fc.set((st) => ({ forecasts: { ...st.forecasts, [st.scenario]: { ...st.forecasts[st.scenario], [cls]: v } } }));
  const setReveal = (v: boolean) =>
    fc.set((st) => ({
      revealed: { ...st.revealed, [st.scenario]: v },
      committed: v && !st.committed[st.scenario] ? { ...st.committed, [st.scenario]: { ...st.forecasts[st.scenario] } } : st.committed,
    }));

  // The company's fleet, for what a miss is worth.
  const ships: Record<ClassId, number> = { cape: design.ships.filter((s) => s.cls === 'cape').length, kmax: design.ships.filter((s) => s.cls === 'kmax').length };
  const missDollars = (pick: (id: ScenarioId, cls: ClassId) => number) =>
    SCENARIOS.reduce((a, s) => {
      if (!committed[s.id]) return a;
      const res = scenarioResult(s.id);
      return a + CLASSES.reduce((b, cls) => b + ships[cls] * Math.abs(pick(s.id, cls) - res[cls].outcome) * QUARTER_DAYS * EARN, 0);
    }, 0);
  const yourMissCost = missDollars((id, cls) => (committed[id] as Pair)[cls]);
  const modelMissCost = missDollars((id, cls) => scenarioResult(id)[cls].model);
  const naiveMissCost = missDollars((id, cls) => scenarioResult(id)[cls].naive);

  // Numbers the prose quotes.
  const cyc = scenarioResult('cyclone');
  const pan = scenarioResult('panama');
  const del = scenarioResult('deliveries');
  const stl = scenarioResult('steel');
  const stm = scenarioResult('storms');

  const rows = SCENARIOS.flatMap((s) =>
    CLASSES.map((cls) => ({ s, cls, key: `${s.id}-${cls}`, res: scenarioResult(s.id)[cls], c: committed[s.id], show: revealed[s.id] || !!committed[s.id] })),
  );

  return (
    <LessonPage id="shipping/6.4">
      <P>
        In <a href={lessonHref('shipping/6.3')}>the previous lesson</a> Northwind’s desk sent its ships after half a year of cargoes, and the result swung with
        the market they happened to trade in. Every commitment a shipping company makes is a bet on that market. A desk fixes ships weeks ahead, an owner
        charters a ship out for a year (<a href={lessonHref('shipping/5.3')}>Lesson 5.3</a>), a trader sells next quarter on paper (
        <a href={lessonHref('shipping/4.5')}>Lesson 4.5</a>). Each starts from a forecast. So before committing anything, Northwind wants a view of the next
        quarter — and the news keeps changing it.
      </P>
      <P>
        This lesson tests the forecasting chain of <a href={lessonHref('shipping/5.1')}>Lesson 5.1</a> against the kind of news that moves freight: a cyclone, a
        canal, a wave of new ships, a cut in steel output, a stormy season. Each of five scenarios starts at a month of the course’s simulated history and changes
        one physical driver over the next three months. Can you see where <K c="price">earnings</K> are going when one thing in the physical world changes?
      </P>
      <P>
        In the next demonstration you see each class’s earnings for the six months up to the forecast date. Set your forecast of the next quarter’s average for
        Capesizes and Kamsarmaxes; the sliders start at the simplest forecast there is, <b>no change</b> from last month. Then reveal the quarter: the history’s
        next three months re-solved with the change, and the forecast the fundamentals model would have made had it been told the news. Revealing locks in your
        forecast for the score, so commit before you look. Choose a scenario:
      </P>

      <Figure name="Freight Market Forecast Challenge" scenario={fc}>
        <Segmented label="Scenario" value={scenario} onChange={(v) => fc.set({ scenario: v })} options={SCENARIOS.map((s) => ({ value: s.id, label: s.tab }))} />
        <p style={{ margin: '4px 0 6px', fontSize: 15, lineHeight: 1.55 }}>
          <b>
            {sc.title}, {monthLabel(sc.t)}.
          </b>{' '}
          {sc.story} Forecast {MONTH_SHORT[(sc.t + 1) % 12]}–{MONTH_SHORT[(sc.t + 3) % 12]}.
        </p>
        <Legend
          items={[
            { label: 'Earnings', color: GRAPHIC.green, kind: 'line' },
            { label: 'Your forecast', color: YOU, kind: 'line' },
            { label: 'No change', color: '#9a9a9a', kind: 'line', dashed: true },
            ...(shown ? [{ label: 'Fundamentals model', color: MODEL, kind: 'line' as const, dashed: true }] : []),
          ]}
        />
        {CLASSES.map((cls) => (
          <QuarterChart key={cls} cls={cls} sc={sc} forecast={f[cls]} revealed={shown} />
        ))}
        <Slider label="Your forecast, Capesizes" tone="green" value={f.cape} min={2_000} max={60_000} step={250} onChange={(v) => setForecast('cape', v)} display={perDay(f.cape)} />
        <Slider label="Your forecast, Kamsarmaxes" tone="green" value={f.kmax} min={2_000} max={60_000} step={250} onChange={(v) => setForecast('kmax', v)} display={perDay(f.kmax)} />
        <Checkbox label={locked ? 'Reveal the quarter (your forecast is locked in)' : 'Reveal the quarter and lock in my forecast'} checked={shown} onChange={setReveal} />
        {shown ? (
          <DataTable
            caption="The quarter's average earnings against each forecast"
            rows={CLASSES}
            rowKey={(cls) => cls}
            columns={[
              { label: 'Next quarter', cell: (cls) => CLASS_NAME[cls] },
              { label: 'You (locked)', cell: (cls) => (locked ? `${perDay(locked[cls])} ${miss(locked[cls], r[cls].outcome)}` : '—'), align: 'right' },
              { label: 'Model', cell: (cls) => `${perDay(r[cls].model)} ${miss(r[cls].model, r[cls].outcome)}`, align: 'right' },
              { label: 'No change', cell: (cls) => `${perDay(r[cls].naive)} ${miss(r[cls].naive, r[cls].outcome)}`, align: 'right' },
              { label: 'Happened', cell: (cls) => perDay(r[cls].outcome), align: 'right' },
            ]}
          />
        ) : (
          <Caption>The quarter is hidden. Last month Capesizes earned {perDay(r.cape.naive)} and Kamsarmaxes {perDay(r.kmax.naive)}.</Caption>
        )}
        {shown && (
          <Caption>
            Without the change, the quarter would have averaged {perDay(r.cape.without)} for Capesizes and {perDay(r.kmax.without)} for Kamsarmaxes: the news moved
            them {miss(r.cape.outcome, r.cape.without)} and {miss(r.kmax.outcome, r.kmax.without)}.
          </Caption>
        )}
      </Figure>

      <P>
        Start with the cyclone, in {monthLabel(SCENARIOS[0].t)}. A quarter of one month’s exports from Port Hedland — the busiest Capesize route in
        our world (<a href={lessonHref('shipping/3.5')}>Lesson 3.5</a>) — is enough to push Capesize earnings down to the lay-up floor in the month it happens,{' '}
        {perDay(cyc.cape.outcomes[0])}, and the quarter averages {pct(Math.abs(cyc.cape.effect))} less than it would have. Kamsarmaxes don’t notice: no Kamsarmax
        trade loads in Western Australia. The Panama scenario is the mirror image. A laden Capesize draws too much water for the canal’s locks (
        <a href={lessonHref('shipping/2.1')}>Lesson 2.1</a>) and no Capesize trade in our world uses it, so their quarter is untouched, while Kamsarmax grain from
        the US Gulf goes the long way round (
        <a href={lessonHref('shipping/3.3')}>Lesson 3.3</a>) and their earnings rise {pct(pan.kmax.effect)}. The first thing a piece of news tells a forecaster is
        which class it hits, as <a href={lessonHref('shipping/5.2')}>Lesson 5.2</a> found: the class that carries the trade.
      </P>
      <P>
        The second is how far. The deliveries scenario adds 6% to both fleets, and earnings fall {pct(Math.abs(del.cape.effect))} for Capesizes and{' '}
        {pct(Math.abs(del.kmax.effect))} for Kamsarmaxes. The stormy season makes every passage 6% longer, which takes the same share of sea time out of the fleet (
        <a href={lessonHref('shipping/1.5')}>Lesson 1.5</a>), and earnings rise {pct(stm.cape.effect)} and {pct(stm.kmax.effect)}. Small physical changes, large
        price changes: that is the steep supply curve of <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>, where every ship is already working and only speed
        and the lay-up floor are left to absorb a shock. The steel cut, 15% off the ore trades, takes {pct(Math.abs(stl.cape.effect))} off Capesize earnings,
        because it lands on Brazil’s long haul as well as Australia’s short one.
      </P>

      <Challenge
        id="a"
        question={`Score in at least ${NEEDED} of the five scenarios: lock in forecasts that, for both classes, land within ${pct(TOLERANCE)} of what happened and closer than no change.`}
        solved={solved}
        status={
          lockedCount === 0
            ? 'No forecasts are locked in yet: set the sliders, then reveal.'
            : `${scoredCount} of ${lockedCount} locked-in scenario${lockedCount > 1 ? 's' : ''} scored. Reset the demonstration to start over.`
        }
        success={`Solved: ${scoredCount} scenarios scored. Each one needed the same two questions — which class carries the trade the news touches, and how steep the supply curve is where the market stands — before any arithmetic.`}
      />

      <H2>What the no-change forecast misses</H2>
      <P>
        No change is a respectable forecast for a market that moves slowly, and a poor one for a market that turns. Look at the deliveries scenario in{' '}
        <FigRef to="Freight Market Forecast Challenge">the first demonstration</FigRef>, made in {monthLabel(SCENARIOS[2].t)}: last month Kamsarmaxes earned {perDay(del.kmax.naive)}, at the height of Brazil’s soybean season, and the next quarter
        averaged {perDay(del.kmax.outcome)}. The no-change forecast misses by {pct(del.kmax.naive / del.kmax.outcome - 1)}, and most of that miss has nothing to do
        with the new ships: the harvest season was ending, as it does every year (<a href={lessonHref('shipping/3.5')}>Lesson 3.5</a>). The fundamentals model,
        which knows the seasons and the orderbook, misses that quarter by {pct(Math.abs(del.kmax.model / del.kmax.outcome - 1), 1)}.
      </P>
      <P>
        The model isn’t a crystal ball either. In the steel scenario it forecasts {perDay(stl.cape.model)} for Capesizes against the {perDay(stl.cape.outcome)}{' '}
        that happened, {miss(stl.cape.model, stl.cape.outcome)}. It was told about the steel cut; what it couldn’t see was the rest of the quarter’s cargo
        surprise, the part of demand nobody announces. That is the lesson of <a href={lessonHref('shipping/5.1')}>Lesson 5.1</a> again: supply is knowable, demand
        isn’t, and near full use of the fleet a small demand error becomes a large rate error.
      </P>

      <H2>The scorecard</H2>
      <P>
        The next demonstration keeps score across all five scenarios, with each scenario’s outcome shown once you’ve revealed it, the change it caused, and the
        three forecasts side by side. Its last line prices your misses: had Northwind’s fleet — {ships.cape} Capesize{ships.cape === 1 ? '' : 's'} and {ships.kmax}{' '}
        Kamsarmax{ships.kmax === 1 ? '' : 'es'}, as you built it in <a href={lessonHref('shipping/6.1')}>Lesson 6.1</a> — been committed at your forecasts, this is
        how far the quarters’ earnings would have been from them, in dollars:
      </P>

      <Figure name="Freight Market Forecast Challenge · scorecard" scenario={fc}>
        <DataTable
          caption="Every scenario's forecasts, outcome and the change it caused"
          rows={rows}
          rowKey={(x) => x.key}
          rowClass={(x) => (x.c && scenarioScored(x.s.id, x.c) ? 'hl' : x.show ? '' : 'dim')}
          columns={[
            { label: 'Scenario', cell: (x) => (x.cls === 'cape' ? x.s.tab : '') },
            { label: 'Class', cell: (x) => CLASS_PLURAL[x.cls] },
            { label: 'Change caused', cell: (x) => (x.show ? miss(x.res.outcome, x.res.without) : 'hidden'), align: 'right' },
            { label: 'You', cell: (x) => (x.c ? miss(x.c[x.cls], x.res.outcome) : '—'), align: 'right' },
            { label: 'Model', cell: (x) => (x.show ? miss(x.res.model, x.res.outcome) : '—'), align: 'right' },
            { label: 'No change', cell: (x) => (x.show ? miss(x.res.naive, x.res.outcome) : '—'), align: 'right' },
            { label: 'Happened', cell: (x) => (x.show ? perDay(x.res.outcome) : '—'), align: 'right' },
          ]}
        />
        <Readouts
          items={[
            { label: 'scenarios scored', value: `${scoredCount} of ${lockedCount} locked in`, tone: solved ? 'green' : undefined },
            { label: 'your misses across the fleet', value: lockedCount ? usd(yourMissCost) : '—', tone: 'green' },
            { label: 'the model’s, same scenarios', value: lockedCount ? usd(modelMissCost) : '—', tone: 'green' },
            { label: 'no change, same scenarios', value: lockedCount ? usd(naiveMissCost) : '—', tone: 'green' },
          ]}
        />
        <Caption>
          Highlighted rows scored. Misses are each quarter’s gap between forecast and outcome, times {fmt(QUARTER_DAYS * EARN)} earning days, times your ships of that
          class; earnings are simulated.
        </Caption>
      </Figure>

      <P>
        Read the “change caused” column down the scorecard and the course’s physical chapters reappear as a list of causes. Ore news moves Capesizes and leaves
        Kamsarmaxes alone; canal news does the opposite; ships and weather move both, and by about three to four times their own size. A forecaster who starts there —
        which trades, which ships, how much slack is left — gets the direction right before touching a number. The
        dollars at the bottom are why it matters to Northwind: a quarter misjudged by a few thousand dollars a day, on a handful of ships, is the difference
        between a good and a bad year, and every strategy in Northwind’s toolkit — chartering out, chartering in, repositioning, selling forward — is a forecast
        with money attached.
      </P>
      <P>
        Which is where the course ends. In <a href={lessonHref('shipping/6.5')}>the last lesson</a> Northwind chooses a strategy for its fleet and runs it through
        twelve years of the simulated market, with the world’s dials — harvests, canals, congestion, new ships — in your hands, to see which strategies survive
        when the physical world changes under them.
      </P>
    </LessonPage>
  );
}
