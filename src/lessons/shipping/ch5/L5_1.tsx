import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  pct,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import { forecastError, forecastPath, sharesAt, type ForecastAssumptions, type ForecastMonth } from '../../../engines/shipping/forecast';
import { equilibrium } from '../../../engines/shipping/market';
import { whatIf, type Drivers } from '../../../engines/shipping/strategies';
import { eventAt, monthLabel, standardHistory } from '../../../model/shipping/history';
import type { ClassId } from '../../../model/shipping/trades';
import { XYChart } from '../shared/XYChart';

const HIST = standardHistory();
const CLASS_NAME: Record<ClassId, string> = { kmax: 'Kamsarmax', cape: 'Capesize' };
/** Latest forecast date that still leaves a year of history to check it against. */
export const LAST_DATE = 131;
const MIN_BUNKER = 150;

const perDay = (x: number) => `$${fmt(x)}/day`;
const usdT = (x: number) => `$${fmt(x)} a tonne`;
const signedUsd = (x: number) => `${x >= 0 ? '+' : '−'}$${fmt(Math.abs(x))}`;
const hundreds = (x: number) => Math.round(x / 100) * 100;
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

export interface ForecastState {
  cls: ClassId;
  /** Month of the history the forecast is made in. */
  month: number;
  horizon: number;
  growth: number;
  fade: number;
  scrap: number;
  deliveries: boolean;
  /** Extra waiting days per call at Qingdao. */
  qin: number;
  /** Bunker price assumed, as a change from the price on the forecast date, $/t. */
  bunkerDelta: number;
}

export const DEFAULT_STATE: ForecastState = { cls: 'kmax', month: 48, horizon: 12, growth: 0.025, fade: 0.94, scrap: 0.002, deliveries: true, qin: 0, bunkerDelta: 0 };

export function assumptionsOf(s: ForecastState): ForecastAssumptions {
  const today = HIST.cls[s.cls][s.month].bunker;
  return {
    growth: s.growth,
    shockFade: s.fade,
    scrapping: s.scrap,
    deliveries: s.deliveries,
    congestion: s.qin > 0 ? { QIN: s.qin } : undefined,
    bunker: Math.max(MIN_BUNKER, today + s.bunkerDelta),
  };
}

export interface ForecastRun {
  path: ForecastMonth[];
  /** The same forecast with the orderbook's deliveries left out. */
  noDeliveries: ForecastMonth[];
  error: number;
  errorNoDeliveries: number;
  /** Average forecast and average outcome over the months the history covers, $/day. */
  forecastAvg: number;
  actualAvg: number;
  fleetNow: number;
  fleetEnd: number;
  actualFleetEnd?: number;
}

/** The forecast a state describes, checked against what the history did. */
export function forecastRun(s: ForecastState): ForecastRun {
  const hist = HIST.cls[s.cls];
  const a = assumptionsOf(s);
  const path = forecastPath(s.cls, hist, s.month, s.horizon, a);
  const noDeliveries = forecastPath(s.cls, hist, s.month, s.horizon, { ...a, deliveries: false });
  const known = path.filter((p) => p.actual !== undefined);
  const last = path[path.length - 1];
  return {
    path,
    noDeliveries,
    error: forecastError(path),
    errorNoDeliveries: forecastError(noDeliveries),
    forecastAvg: avg(known.map((p) => p.tce)),
    actualAvg: avg(known.map((p) => p.actual as number)),
    fleetNow: hist[s.month].fleet,
    fleetEnd: last.fleet,
    actualFleetEnd: hist[last.t]?.fleet,
  };
}

/**
 * The challenge: from January of Year 5, with cargo growth at the history's true 2.5% a year and
 * the supply side (orderbook, scrapping) left as it is, change one other assumption and bring the
 * average monthly miss under 15%. Only the fuel price does it.
 */
export const CHALLENGE = { cls: 'kmax' as ClassId, month: 48, horizon: 12, target: 0.15 };

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
/** The assumptions the challenge lets the reader change, one at a time. */
export const OTHER_ASSUMPTIONS = ['fade', 'qin', 'bunkerDelta'] as const;

/** Which of the challenge's free assumptions differ from the defaults. */
export function changedAssumptions(s: ForecastState): Array<(typeof OTHER_ASSUMPTIONS)[number]> {
  return OTHER_ASSUMPTIONS.filter((k) => !same(s[k], DEFAULT_STATE[k]));
}

/** Whether the challenge's fixed parts — the date, horizon, true cargo growth and the supply side — are as it asks. */
export function challengeFrame(s: ForecastState): 'date' | 'growth' | 'supply' | null {
  if (s.cls !== CHALLENGE.cls || s.month !== CHALLENGE.month || s.horizon !== CHALLENGE.horizon) return 'date';
  if (!same(s.growth, DEFAULT_STATE.growth)) return 'growth';
  if (!s.deliveries || !same(s.scrap, DEFAULT_STATE.scrap)) return 'supply';
  return null;
}

export function forecastSolved(s: ForecastState): boolean {
  if (challengeFrame(s) !== null || changedAssumptions(s).length !== 1) return false;
  return forecastRun(s).error < CHALLENGE.target;
}

// ---------------------------------------------------------------------------
// Errors over every forecast date, with and without the orderbook (computed once, about 80 ms).

let ERRORS: Record<ClassId, { m12: number; m12no: number; m24: number; m24no: number }> | null = null;

export function allDateErrors() {
  if (ERRORS) return ERRORS;
  const run = (cls: ClassId, horizon: number, deliveries: boolean) => {
    const hist = HIST.cls[cls];
    const errs: number[] = [];
    for (let t = 0; t + horizon < hist.length; t++) errs.push(forecastError(forecastPath(cls, hist, t, horizon, { ...assumptionsOf({ ...DEFAULT_STATE, cls, month: t }), deliveries })));
    return avg(errs);
  };
  ERRORS = {
    kmax: { m12: run('kmax', 12, true), m12no: run('kmax', 12, false), m24: run('kmax', 24, true), m24no: run('kmax', 24, false) },
    cape: { m12: run('cape', 12, true), m12no: run('cape', 12, false), m24: run('cape', 24, true), m24no: run('cape', 24, false) },
  };
  return ERRORS;
}

// ---------------------------------------------------------------------------
// Sensitivity: the next twelve months as they actually came, with one physical driver changed.

export interface SensitivityRow {
  key: string;
  label: string;
  /** Change in the twelve-month average for the driver pushed each way (one-sided drivers have only `up`). */
  up: { name: string; change: number };
  down?: { name: string; change: number };
}

export interface Sensitivity {
  base: number;
  speed: number;
  idleMax: number;
  /** Months with ships laid up, where earnings sit on the lay-up floor. */
  floorMonths: number;
  rows: SensitivityRow[];
  biggest: { name: string; change: number };
}

const SENS_CACHE = new Map<string, Sensitivity>();

export function sensitivity(cls: ClassId, t: number): Sensitivity {
  const key = `${cls}|${t}`;
  const hit = SENS_CACHE.get(key);
  if (hit) return hit;
  const hist = HIST.cls[cls];
  const months = hist.slice(t + 1, t + 13);
  const base = avg(months.map((m) => m.tce));
  const effect = (d: (m: (typeof months)[number]) => Drivers) => avg(months.map((m) => whatIf(cls, m, d(m), eventAt(m.t)))) / base - 1;
  const rows: SensitivityRow[] = [
    { key: 'cargo', label: 'Cargo volumes', up: { name: 'cargo +5%', change: effect(() => ({ demand: 1.05 })) }, down: { name: 'cargo −5%', change: effect(() => ({ demand: 0.95 })) } },
    { key: 'fleet', label: 'Fleet size', up: { name: 'fleet −5%', change: effect(() => ({ fleet: 0.95 })) }, down: { name: 'fleet +5%', change: effect(() => ({ fleet: 1.05 })) } },
    {
      key: 'bunker',
      label: 'Bunker price',
      up: { name: 'bunkers +$200/t', change: effect((m) => ({ bunker: m.bunker + 200 })) },
      down: { name: 'bunkers −$200/t', change: effect((m) => ({ bunker: Math.max(MIN_BUNKER, m.bunker - 200) })) },
    },
    // whatIf adds the dial's days to any queue the month already had.
    { key: 'qin', label: 'Qingdao congestion', up: { name: 'Qingdao +2 days a call', change: effect(() => ({ congestion: { QIN: 2 } })) } },
    { key: 'panama', label: 'Panama Canal', up: { name: 'Panama Canal closed', change: effect(() => ({ closed: ['panama'] })) } },
  ];
  const all = rows.flatMap((r) => [r.up, ...(r.down ? [r.down] : [])]);
  const biggest = all.reduce((a, b) => (Math.abs(b.change) > Math.abs(a.change) ? b : a));
  const out = {
    base,
    speed: avg(months.map((m) => m.ladenSpeed)),
    idleMax: Math.max(...months.map((m) => m.idle)),
    floorMonths: months.filter((m) => m.idle > 0.5).length,
    rows,
    biggest,
  };
  SENS_CACHE.set(key, out);
  return out;
}

// Numbers the prose quotes.
const RUN0 = forecastRun(DEFAULT_STATE);
const K48 = HIST.cls.kmax[48];
const LAST0 = RUN0.path[RUN0.path.length - 1];
const DEMAND_MISS = HIST.cls.kmax[LAST0.t].demand / LAST0.demand - 1;

/**
 * The Year 5 forecast's last month split into its causes: the month re-solved as the forecaster
 * set it up, then with the cargo that actually came, the fuel price that actually came, or both.
 */
export const MISS = (() => {
  const then = HIST.cls.kmax[LAST0.t];
  const assumed = assumptionsOf(DEFAULT_STATE).bunker as number;
  const base = { demand: LAST0.demand, month: LAST0.t % 12, fleet: LAST0.fleet, bunker: assumed, cohortShares: sharesAt(K48) };
  const at = (c: { demand?: number; bunker?: number }) => equilibrium('kmax', { ...base, ...c }).tce;
  return {
    forecast: at({}),
    cargo: at({ demand: then.demand }),
    fuel: at({ bunker: then.bunker }),
    both: at({ demand: then.demand, bunker: then.bunker }),
    actual: then.tce,
    bunkerAssumed: assumed,
    bunkerActual: then.bunker,
  };
})();
/** Bunkers over the twelve months the Year 5 forecast covers, as they actually came: their average, $/t. */
export const BUNKER_YEAR_AVG = avg(HIST.cls.kmax.slice(K48.t + 1, K48.t + 13).map((m) => m.bunker));
/** The challenge's best result with fuel alone, over the bunker slider's steps: what fuel can't explain. */
export const FUEL_ONLY_BEST = Math.min(...Array.from({ length: 25 }, (_, i) => forecastRun({ ...DEFAULT_STATE, bunkerDelta: -300 + 25 * i }).error));
/** The challenge's best result with the cargo surprise's fade alone, over the fade slider's steps. */
export const FADE_ONLY_BEST = Math.min(...Array.from({ length: 51 }, (_, i) => forecastRun({ ...DEFAULT_STATE, fade: 0.5 + 0.01 * i }).error));
const BOOM = { cls: 'cape' as ClassId, month: 30 };
const SLUMP = { cls: 'cape' as ClassId, month: 60 };

function Tornado({ s, cls, month }: { s: Sensitivity; cls: ClassId; month: number }) {
  const W = 640;
  const rowH = 38;
  const top = 30;
  const H = top + s.rows.length * rowH + 22;
  const maxAbs = Math.max(0.2, ...s.rows.flatMap((r) => [Math.abs(r.up.change), Math.abs(r.down?.change ?? 0)]));
  const lim = Math.ceil(maxAbs * 10) / 10;
  const x = scale(-lim, lim, 210, 620);
  const ticks = niceTicks(-lim, lim, 4);
  const bar = (c: number, y: number, name: string) => {
    const x0 = x(0);
    const x1 = x(c);
    const pos = c >= 0;
    // Each label sits across the zero line from its bar, where its own line is free.
    return (
      <g>
        <rect x={Math.min(x0, x1)} y={y} width={Math.max(1, Math.abs(x1 - x0))} height={13} fill={pos ? GRAPHIC.green : GRAPHIC.red} opacity={0.85} />
        <text x={pos ? x0 - 6 : x0 + 6} y={y + 10} textAnchor={pos ? 'end' : 'start'} style={{ fontSize: 11, fill: pos ? TEXT.green : TEXT.red }}>
          {`${c >= 0 ? '+' : '−'}${fmt(Math.abs(c) * 100)}% · ${name}`}
        </text>
      </g>
    );
  };
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`How the ${CLASS_NAME[cls]} market's average earnings over the twelve months after ${monthLabel(month)}, ${perDay(s.base)}, would have changed: ${s.rows
        .flatMap((r) => [r.up, ...(r.down ? [r.down] : [])])
        .map((d) => `${d.name} ${d.change >= 0 ? '+' : '−'}${fmt(Math.abs(d.change) * 100)}%`)
        .join(', ')}.`}
    >
      <text className="ax" x={210} y={14}>
        Change in the next twelve months’ average earnings
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 20} />
          <text className="ax ax-m" x={x(t)} y={H - 6}>
            {t === 0 ? '0' : `${t > 0 ? '+' : '−'}${fmt(Math.abs(t) * 100)}%`}
          </text>
        </g>
      ))}
      {s.rows.map((r, i) => {
        const y = top + i * rowH;
        return (
          <g key={r.key}>
            <text x={0} y={y + 16} style={{ fontSize: 13, fill: '#333' }}>
              {r.label}
            </text>
            {bar(r.up.change, y, r.up.name)}
            {r.down && bar(r.down.change, y + 15, r.down.name)}
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const fc = useScenario('forecast', DEFAULT_STATE);
  const st = fc.state;
  const hist = HIST.cls[st.cls];
  const run = useMemo(() => forecastRun(st), [st]);
  const solved = forecastSolved(st);
  const today = hist[st.month];
  const bunker = Math.max(MIN_BUNKER, today.bunker + st.bunkerDelta);
  const errors = useMemo(() => allDateErrors(), []);

  // The chart window: two years either side of the forecast date.
  const w0 = Math.max(0, st.month - 24);
  const w1 = Math.min(hist.length - 1, st.month + 24);
  const winMonths = hist.slice(w0, w1 + 1);
  const fcXs = [st.month, ...run.path.map((p) => p.t)];
  const fcYs = [today.tce, ...run.path.map((p) => p.tce)];
  const [, tceHi] = niceDomain(0, Math.max(...winMonths.map((m) => m.tce), ...fcYs), 4);
  const yearTicks = Array.from({ length: 13 }, (_, i) => i * 12).filter((v) => v >= w0 && v <= w1);
  const fleetVals = [...winMonths.map((m) => m.fleet), ...run.path.map((p) => p.fleet), ...run.noDeliveries.map((p) => p.fleet)];
  const [fLo, fHi] = niceDomain(Math.min(...fleetVals), Math.max(...fleetVals), 3);
  const yearFmt = (v: number) => `Year ${v / 12 + 1}`;
  const knownMonths = run.path.filter((p) => p.actual !== undefined).length;

  const sv = useScenario('sensitivity', { cls: SLUMP.cls, month: SLUMP.month });
  const sens = useMemo(() => sensitivity(sv.state.cls, sv.state.month), [sv.state.cls, sv.state.month]);
  const slump = useMemo(() => sensitivity(SLUMP.cls, SLUMP.month), []);
  const boom = useMemo(() => sensitivity(BOOM.cls, BOOM.month), []);
  const kmaxSlump = useMemo(() => sensitivity('kmax', SLUMP.month), []);
  const ch = (s: Sensitivity, key: string, side: 'up' | 'down') => {
    const r = s.rows.find((x) => x.key === key)!;
    return Math.abs((side === 'up' ? r.up : r.down!).change);
  };
  /** A driver's effect on the twelve months' average earnings, $/day (signed). */
  const dollars = (s: Sensitivity, key: string, side: 'up' | 'down') => {
    const r = s.rows.find((x) => x.key === key)!;
    return (side === 'up' ? r.up : r.down!).change * s.base;
  };

  return (
    <LessonPage id="shipping/5.1">
      <P>
        Chapter 4 built a market out of ships and cargoes: a rate that clears where the fleet’s supply curve meets the trades’ demand, contracts by the voyage and
        by the day, indices that publish the rate and forward agreements that trade it. This chapter asks how an operator or a trader can make money from the
        constraints underneath — by chartering ships in and out, moving them between oceans, and trading the differences and futures of rates. Every one of those
        strategies begins with a view on where rates are going.
      </P>
      <P>
        One way to form that view is from the physical <b>fundamentals</b>, and this course has built every link of the chain. Supply is the fleet: the ships
        afloat, the ones on order that <a href={lessonHref('shipping/2.5')}>Lesson 2.5</a> showed arriving years later, less those scrapped, sailing at the speeds the
        slow-steaming rule of <a href={lessonHref('shipping/2.3')}>Lesson 2.3</a> picks. Demand is tonnes times distance, plus the ballast voyages those cargoes
        force, as <a href={lessonHref('shipping/3.4')}>Lessons 3.4</a> and <a href={lessonHref('shipping/3.5')}>3.5</a> measured, plus the days ships spend in port,
        longer when ports are congested (<a href={lessonHref('shipping/3.2')}>Lesson 3.2</a>). The equilibrium of <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a> turns the
        two into a rate. So the question is simple to state: project the fleet and the cargo, clear the market month by month — how close does that come?
      </P>
      <P>
        In the next demonstration a forecaster stands at a month of the course’s simulated history and looks ahead, using only what was known that month: the fleet,
        the orderbook of <a href={lessonHref('shipping/2.5')}>Lesson 2.5</a> with its delivery dates, and today’s cargo volumes. Everything else is an assumption you
        set: how fast cargo grows, how quickly today’s surprise — cargo above or below its trend — fades away, how many ships go for scrap, how congested Qingdao will
        be and what bunkers will cost. The forecaster has one advantage no real analyst has: it uses the very equilibrium that generated the history, so every miss
        comes from an assumption — something it couldn’t know, or guessed wrong. The solid line is what happened; the dashed line is the forecast:
      </P>

      <Figure name="Freight Fundamentals Model" scenario={fc}>
        <Segmented label="Size class" value={st.cls} onChange={(cls) => fc.set({ cls })} options={(['kmax', 'cape'] as ClassId[]).map((c) => ({ value: c, label: CLASS_NAME[c] }))} />
        <Legend
          items={[
            { label: 'What happened', color: GRAPHIC.green, kind: 'line' },
            { label: 'Forecast', color: TEXT.green, kind: 'line', dashed: true },
            { label: 'Fleet with the orderbook', color: GRAPHIC.teal, kind: 'line', dashed: true },
            { label: 'Fleet without it', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`${CLASS_NAME[st.cls]} earnings around ${monthLabel(st.month)}, with a ${st.horizon}-month forecast averaging ${perDay(run.forecastAvg)} against ${perDay(run.actualAvg)} that happened: an average monthly miss of ${pct(run.error, 1)}.`}
          series={[
            { xs: winMonths.map((m) => m.t), ys: winMonths.map((m) => m.tce), color: GRAPHIC.green, width: 2 },
            { xs: fcXs, ys: fcYs, color: TEXT.green, width: 2.5, dash: '7 4' },
          ]}
          xMin={w0}
          xMax={w1}
          yMin={0}
          yMax={tceHi}
          xTicks={yearTicks}
          xFormat={yearFmt}
          yFormat={(v) => `$${fmt(v / 1000)}k`.replace('$−', '−$')}
          yLabel="Earnings, $ per day (TCE)"
          height={180}
          cursor={st.month}
          bands={[{ from: st.month, to: Math.min(w1, st.month + st.horizon), color: tint(GRAPHIC.gray, 0.14), label: 'forecast' }]}
        />
        <XYChart
          ariaLabel={`The ${CLASS_NAME[st.cls]} fleet: ${fmt(run.fleetNow)} ships in ${monthLabel(st.month)}, forecast at ${fmt(run.fleetEnd)} after ${st.horizon} months${run.actualFleetEnd !== undefined ? ` against ${fmt(run.actualFleetEnd)} in the history` : ''}; ${fmt(run.noDeliveries[run.noDeliveries.length - 1].fleet)} if the orderbook is ignored.`}
          series={[
            { xs: winMonths.map((m) => m.t), ys: winMonths.map((m) => m.fleet), color: GRAPHIC.teal, width: 2 },
            { xs: [st.month, ...run.path.map((p) => p.t)], ys: [run.fleetNow, ...run.path.map((p) => p.fleet)], color: GRAPHIC.teal, width: 2, dash: '6 4' },
            { xs: [st.month, ...run.noDeliveries.map((p) => p.t)], ys: [run.fleetNow, ...run.noDeliveries.map((p) => p.fleet)], color: '#9a9a9a', width: 2, dash: '2 4' },
          ]}
          xMin={w0}
          xMax={w1}
          yMin={fLo}
          yMax={fHi}
          yTicks={niceTicks(fLo, fHi, 3)}
          xTicks={yearTicks}
          xFormat={yearFmt}
          yFormat={(v) => fmt(v)}
          yLabel="Ships in the fleet"
          height={130}
          cursor={st.month}
        />
        <Readouts
          items={[
            { label: `forecast, ${knownMonths} months`, value: perDay(run.forecastAvg), tone: 'green' },
            { label: 'what happened', value: perDay(run.actualAvg), tone: 'green' },
            { label: 'average miss', value: pct(run.error, 1), tone: run.error < CHALLENGE.target ? 'green' : undefined },
            { label: 'fleet growth forecast', value: pct(run.fleetEnd / run.fleetNow - 1, 1), tone: 'teal' },
          ]}
        />
        <Slider label="Forecast made in" tone="teal" value={st.month} min={0} max={LAST_DATE} onChange={(v) => fc.set({ month: v })} display={monthLabel(st.month)} />
        <Slider label="Months ahead" tone="teal" value={st.horizon} min={6} max={24} onChange={(v) => fc.set({ horizon: v })} display={`${st.horizon} months`} />
        <Slider label="Cargo growth assumed" tone="orange" value={st.growth} min={0} max={0.06} step={0.005} onChange={(v) => fc.set({ growth: v })} display={`${fmt(st.growth * 100, 1)}% a year`} />
        <Slider label="Surprise kept a month" tone="orange" value={st.fade} min={0.5} max={1} step={0.01} onChange={(v) => fc.set({ fade: v })} display={pct(st.fade)} />
        <Slider label="Ships scrapped" tone="teal" value={st.scrap} min={0} max={0.01} step={0.0005} onChange={(v) => fc.set({ scrap: v })} display={`${fmt(st.scrap * 100, 2)}% a month`} />
        <Slider label="Extra wait at Qingdao" tone="teal" value={st.qin} min={0} max={6} step={0.5} onChange={(v) => fc.set({ qin: v })} display={`${fmt(st.qin, 1)} days a call`} />
        <Slider
          label="Bunker price assumed"
          tone="red"
          value={st.bunkerDelta}
          min={-300}
          max={300}
          step={25}
          onChange={(v) => fc.set({ bunkerDelta: v })}
          display={`$${fmt(bunker)}/t${st.bunkerDelta === 0 ? ' (today’s)' : ''}`}
        />
        <Checkbox label="Count the orderbook’s deliveries" checked={st.deliveries} onChange={(v) => fc.set({ deliveries: v })} />
        <Caption>
          {`In ${monthLabel(st.month)}, ${st.cls === 'kmax' ? 'Kamsarmaxes' : 'Capesizes'} earn ${perDay(today.tce)}; ${fmt(today.orderbook)} are on order, ${fmt(today.bookByYear[0])} due within a year. Without the orderbook the forecast would miss by ${pct(run.errorNoDeliveries, 1)} a month.`}
        </Caption>
      </Figure>

      <P>
        Start in January of Year 5, as the first boom fades. Kamsarmaxes earn {perDay(K48.tce)}, and the forecast for the next twelve months, with the default
        assumptions, averages {perDay(RUN0.forecastAvg)}. The history delivered {perDay(RUN0.actualAvg)}: the forecast misses by {pct(RUN0.error, 1)} in an average
        month. It gets the shape right — the spring peak as Brazil’s soybeans ship, then the slide — but expects the slide to stop sooner. By January of Year 6 it
        expects {perDay(LAST0.tce)}; the market pays {perDay(LAST0.actual as number)}.
      </P>

      <H2>Supply is the easy half</H2>
      <P>
        Look at the lower chart. In January of Year 5 the orderbook holds {fmt(K48.orderbook)} Kamsarmaxes, {fmt(K48.bookByYear[0])} of them due within twelve months,
        and the forecast that counts them puts the fleet at {fmt(LAST0.fleet)} ships a year later. The history had {fmt(RUN0.actualFleetEnd as number)}. Ships take
        years to build, so the supply of the next year or two is already decided, and anyone can read it off the shipyards’ order books. Untick the orderbook and the
        same forecast misses by {pct(RUN0.errorNoDeliveries, 1)} a month instead of {pct(RUN0.error, 1)}.
      </P>
      <P>
        Over every forecast date in the history, a twelve-month Kamsarmax forecast that counts the orderbook misses by {pct(errors.kmax.m12, 1)} a month on average,
        against {pct(errors.kmax.m12no, 1)} without it; for Capesizes, {pct(errors.cape.m12, 1)} against {pct(errors.cape.m12no, 1)}. Look two years ahead and the
        orderbook matters more, because by then more of it has been delivered: {pct(errors.kmax.m24, 1)} against {pct(errors.kmax.m24no, 1)} for Kamsarmaxes, and{' '}
        {pct(errors.cape.m24, 1)} against {pct(errors.cape.m24no, 1)} for Capesizes.
      </P>
      <P>
        What’s left of the miss is everything else, and the hardest part of it is demand. In the Year 5 forecast two things went wrong. By January of Year 6 the
        trades are carrying {pct(Math.abs(DEMAND_MISS), 1)} less cargo than the forecaster expected, and bunkers, which the forecast held at January of Year 5’s{' '}
        {usdT(MISS.bunkerAssumed)}, have fallen to {usdT(MISS.bunkerActual)}. The cargo trend itself was right: the history’s Kamsarmax cargo grows{' '}
        {pct(DEFAULT_STATE.growth, 1)} a year, the default. What a forecaster can still choose is how much of today’s cargo surprise to carry forward, how
        congested Qingdao will be and what fuel will cost.
      </P>

      <Challenge
        id="a"
        figure="Freight Fundamentals Model"
        question={`From January of Year 5, keep cargo growth at the true ${pct(DEFAULT_STATE.growth, 1)} a year and leave the supply side — the orderbook and the scrapping rate — as it is. Predict which one of the other assumptions the forecaster got wrong, then change only that one and bring the average miss under ${pct(CHALLENGE.target)}.`}
        solved={solved}
        status={(() => {
          const frame = challengeFrame(st);
          const changed = changedAssumptions(st);
          if (frame === 'date') return `Set the class to Kamsarmax, the forecast date to ${monthLabel(CHALLENGE.month)} and the horizon to 12 months.`;
          if (frame === 'growth') return `Put cargo growth back to ${pct(DEFAULT_STATE.growth, 1)} a year: the trend was right.`;
          if (frame === 'supply')
            return `Count the orderbook and put scrapping back to ${fmt(DEFAULT_STATE.scrap * 100, 2)}% a month: supply was right, and the forecast fleet of ${fmt(RUN0.fleetEnd)} sits within ${fmt(Math.abs((RUN0.actualFleetEnd as number) - RUN0.fleetEnd))} ships of the history’s.`;
          if (changed.length > 1) return 'Change only one assumption: put the others back to where they started.';
          return `The forecast misses by ${pct(run.error, 1)} a month on average.`;
        })()}
        success={`Solved: ${pct(run.error, 1)}. Fuel was the guess that went wrong. The forecast held bunkers at ${usdT(MISS.bunkerAssumed)} all year; they averaged ${usdT(BUNKER_YEAR_AVG)} and ended at ${usdT(MISS.bunkerActual)}, and with every ship at work, cheaper fuel means a lower rate. No other single assumption gets there: carrying more or less of today’s cargo surprise forward never gets the miss below ${pct(FADE_ONLY_BEST)}, and a longer queue at Qingdao only raises the forecast. Even the best fuel price leaves a miss of about ${pct(FUEL_ONLY_BEST)}. That remainder is the cargo shortfall — a fresh surprise that nothing in January of Year 5 could show, and no honest assumption can fit.`}
      />

      <H2>Why small errors become large ones</H2>
      <P>
        Re-solve January of Year 6 with the actual cargo alone and the forecast falls from {perDay(MISS.forecast)} to {perDay(MISS.cargo)}; with the actual fuel
        price alone, to {perDay(MISS.fuel)}; with both, to {perDay(MISS.both)}, close to the {perDay(MISS.actual)} the market paid. So a{' '}
        {pct(Math.abs(DEMAND_MISS), 1)} surprise in cargo became a {pct(1 - MISS.cargo / MISS.forecast)} surprise in earnings, and fuel{' '}
        {usdT(MISS.bunkerAssumed - MISS.bunkerActual)} cheaper a {pct(1 - MISS.fuel / MISS.forecast)} one. That is the supply curve of{' '}
        <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a> at work: with every ship employed, the only way to carry more is to sail faster, and the rate must rise
        until the extra fuel is worth burning — so it rises and falls with the price of that fuel, too. The curve is steep, so a forecast is only as good as its
        weakest input, multiplied. The next demonstration measures the multiplier. Choose a class and a month; it takes the twelve
        months that followed, as they actually came, and asks how their average earnings would have changed had one physical driver been different:
      </P>

      <Figure name="Freight Fundamentals Model · sensitivity" scenario={sv}>
        <Segmented label="Size class" value={sv.state.cls} onChange={(cls) => sv.set({ cls })} options={(['kmax', 'cape'] as ClassId[]).map((c) => ({ value: c, label: CLASS_NAME[c] }))} />
        <Tornado s={sens} cls={sv.state.cls} month={sv.state.month} />
        <Readouts
          items={[
            { label: 'next twelve months averaged', value: perDay(sens.base), tone: 'green' },
            { label: 'average laden speed', value: `${fmt(sens.speed, 1)} kn`, tone: 'teal' },
            { label: 'most ships laid up in a month', value: fmt(sens.idleMax) },
            { label: 'biggest effect', value: `${sens.biggest.name}, ${sens.biggest.change >= 0 ? '+' : '−'}${fmt(Math.abs(sens.biggest.change) * 100)}%` },
          ]}
        />
        <Slider label="From" tone="teal" value={sv.state.month} min={0} max={LAST_DATE} onChange={(v) => sv.set({ month: v })} display={monthLabel(sv.state.month)} />
      </Figure>

      <P>
        The demonstration starts on the Capesize market from January of Year 6, the slump in which Brazil’s ore mines were disrupted and up to{' '}
        {fmt(slump.idleMax)} ships lay idle. The responses are lopsided. Five percent more cargo would have raised the year’s earnings by {pct(ch(slump, 'cargo', 'up'))},
        but five percent less would have cut them by only {pct(ch(slump, 'cargo', 'down'))}: with ships already idle, earnings sit near the lay-up floor of{' '}
        <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>, and there is little further to fall. Bunker prices matter about half as much as in the boom we’ll
        visit next — ±{pct(Math.max(ch(slump, 'bunker', 'up'), ch(slump, 'bunker', 'down')))} for $200 a tonne — because in {fmt(slump.floorMonths)} of the 12
        months ships are laid up and earnings sit on the floor, where a ship waiting for cargo isn’t racing anyone; the effect comes from the other{' '}
        {fmt(12 - slump.floorMonths)}.
      </P>
      <P>
        Now move to July of Year 3, the Capesize boom. Every ship is at work, sailing laden at {fmt(boom.speed, 1)} knots on average against{' '}
        {fmt(slump.speed, 1)} in the slump, and the responses are symmetric and, in dollars, large: 5% more or less cargo moves the year by about{' '}
        {`$${fmt(hundreds((dollars(boom, 'cargo', 'up') - dollars(boom, 'cargo', 'down')) / 2))}`} a day either way, against {signedUsd(hundreds(dollars(slump, 'cargo', 'up')))}{' '}
        and {signedUsd(hundreds(dollars(slump, 'cargo', 'down')))} in the slump, and $200 a tonne on bunkers moves it by{' '}
        {pct(Math.min(ch(boom, 'bunker', 'up'), ch(boom, 'bunker', 'down')))} or more, because when every ship is needed the market has to pay for the fuel that
        the required speed burns — the property of our model’s speed rule that <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a> pointed out. Panama
        doesn’t register at all for Capesizes, whose trades don’t use it; switch to Kamsarmaxes, whose US Gulf grain goes through the canal, move back to January of
        Year 6, and closing it would have raised the year from there by {pct(kmaxSlump.rows.find((r) => r.key === 'panama')!.up.change)}.
      </P>
      <P>
        So which fundamental to watch depends on where the market sits on its supply curve, and that is itself a forecast. In a slump, watch for the cargo that would
        bring idle ships back; in a boom, the orderbook and anything — congestion, a closed canal, a longer haul — that takes ships out of service. Real forecasters
        add what our model leaves out: sentiment, how quickly owners actually slow down, cargoes switching between size classes. Which brings us to the differences
        between rates. A forecast of the level of freight is hard; often what an operator or trader cares about is how one rate moves against another — one route
        against another, one size of ship against the next. <a href={lessonHref('shipping/5.2')}>The next lesson</a> trades those spreads, using{' '}
        <FigRef to="Freight Fundamentals Model · sensitivity">this demonstration</FigRef>’s lesson: each spread is a bet on a physical driver.
      </P>
    </LessonPage>
  );
}
