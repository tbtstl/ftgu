import { useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sub,
  Sup,
  TEXT,
  clamp,
  fmt,
  hour,
  lessonHref,
  mix,
  pct,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { CITY_HOURLY_SHAPE, packLineCapacity, packLineOf, packWindow, runLinepack, type PackHour } from '../../../engines/gas/linepack';
import { COST_RECIPE } from '../../../engines/market/offerCost';
import { MMBTU_PER_MCF } from '../../../engines/gas/properties';
import { PIPELINE } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';

// ---------------------------------------------------------------------------
// The model: Northline as three 80-mile segments, Metro's winter day, an evening power-plant ramp.

const NORTHLINE = PIPELINE['calder-metro'];
const NL = packLineOf(NORTHLINE);
const CAPACITY = packLineCapacity(NL);
const HOURS = 48;
/** The power plants' evening ramp runs from 17:00 to 21:00. */
export const RAMP_HOURS = [17, 18, 19, 20];
export const RAMP_STEP = 25;
export const START_STEP = 5;

export interface PackSettings {
  /** What Metro takes from Northline on average over the day, without the power plants' ramp, MMcf/d. */
  avg: number;
  /** Extra gas the power plants burn from 17:00 to 21:00, MMcf/d. */
  ramp: number;
  /** Receipts at Calder follow the day's average demand. */
  ratable: boolean;
  /** Receipts at Calder when not ratable, MMcf/d. */
  receipts: number;
  /** Linepack at midnight on day 1, MMcf. */
  start: number;
}

export const PACK_DEFAULTS: PackSettings = { avg: 1300, ramp: 0, ratable: true, receipts: 1300, start: 780 };

/** Metro's deliveries asked for in each hour of the day, as MMcf/d rates. */
export function demandDay(avg: number, ramp: number): number[] {
  return CITY_HOURLY_SHAPE.map((x, h) => avg * x + (RAMP_HOURS.includes(h) ? ramp : 0));
}

/** The day's average demand, ramp included. */
export function dayMean(avg: number, ramp: number): number {
  return demandDay(avg, ramp).reduce((a, b) => a + b, 0) / 24;
}

/** Receipts at Calder, MMcf/d. */
export function receiptsOf(s: PackSettings): number {
  return s.ratable ? dayMean(s.avg, s.ramp) : s.receipts;
}

/** Two days hour by hour. */
export function simulate(s: PackSettings): PackHour[] {
  return runLinepack(NL, s.start, [receiptsOf(s)], demandDay(s.avg, s.ramp), HOURS);
}

/** True when nothing was cut: every delivery made and every receipt taken. */
export function clean(run: PackHour[]): boolean {
  return run.every((h) => h.shortfall < 1e-6 && h.refused < 1e-6);
}

/**
 * The window of starting linepack (MMcf) that keeps the line inside its pressure limits in every
 * hour of two days (or `hours`), if deliveries and receipts are all made: in each hour the pack must sit
 * between its least (delivery pressure at the minimum) and its most (stations at MAOP) for that
 * hour's flow. Empty when lo > hi.
 */
export function startRange(avg: number, ramp: number, receipts: number, hours = HOURS): { lo: number; hi: number } {
  const dem = demandDay(avg, ramp);
  let c = 0;
  let lo = -Infinity;
  let hi = Infinity;
  for (let h = 0; h < hours; h++) {
    const d = dem[h % 24];
    c += (receipts - d) / 24;
    const w = packWindow(NL, (receipts + d) / 2);
    if (!(w.swing > 0)) return { lo: Infinity, hi: -Infinity };
    lo = Math.max(lo, w.min - c);
    hi = Math.min(hi, w.max - c);
  }
  return { lo, hi };
}

/** The largest evening ramp (on the slider's grid) the line can carry with ratable receipts, or −1 if not even none. */
export function largestRamp(avg: number, step = RAMP_STEP, max = 1000): number {
  let best = -1;
  for (let ramp = 0; ramp <= max; ramp += step) {
    const r = startRange(avg, ramp, dayMean(avg, ramp));
    if (r.lo <= r.hi) best = ramp;
  }
  return best;
}

export const START_MIN = 650;
export const START_MAX = 950;

/** Northline's average deliveries to Metro in the lesson's ramp and in the challenge, MMcf/d. */
export const CHALLENGE_AVG = 1300;
/** The largest evening ramp the line can carry at that average, with ratable receipts. */
export const ANSWER_RAMP = largestRamp(CHALLENGE_AVG);

/** The challenge: shippers bring 1,250 MMcf/d to Calder while Metro takes 1,300 on average, with no evening ramp. */
export const IMBALANCE = { avg: CHALLENGE_AVG, ramp: 0, receipts: 1250 };
/** The starting linepacks that carry the imbalance through both days (about 816–850 MMcf). */
export const IMBALANCE_WINDOW = startRange(IMBALANCE.avg, IMBALANCE.ramp, IMBALANCE.receipts);

/** True when the settings are the challenge's, whatever the starting linepack. */
export function atImbalance(s: PackSettings): boolean {
  return s.avg === IMBALANCE.avg && s.ramp === IMBALANCE.ramp && !s.ratable && s.receipts === IMBALANCE.receipts;
}

/** Solved when, with receipts 50 MMcf/d short of Metro's demand, the starting linepack carries the line through both days with nothing cut. */
export function imbalanceSolved(s: PackSettings): boolean {
  return atImbalance(s) && clean(simulate(s));
}

/** MW of combined-cycle plants at Lakeside's heat rate that a gas burn of q MMcf/d would fuel. */
export function ccgtMW(q: number): number {
  return (q * 1000 * MMBTU_PER_MCF) / 24 / COST_RECIPE.cc1.heatRate;
}

// Numbers quoted in the prose.
const BASE = simulate(PACK_DEFAULTS);
const BASE_PACKS = BASE.map((h) => h.pack);
const BASE_LOW = Math.min(...BASE_PACKS);
const BASE_HIGH = Math.max(...BASE_PACKS);
const BASE_HIGH_HOUR = BASE.find((h) => h.pack === BASE_HIGH)!.hour;
const BASE_LOW_HOUR = BASE.slice(0, 24).reduce((a, h) => (h.pack < a.pack ? h : a)).hour;
const BASE_MIN_DELIVERY = Math.min(...BASE.map((h) => h.delivery)) - 14.696;
const BASE_WINDOW = startRange(PACK_DEFAULTS.avg, 0, PACK_DEFAULTS.avg);
const SHAPE_MIN = Math.min(...CITY_HOURLY_SHAPE);
const SHAPE_MAX = Math.max(...CITY_HOURLY_SHAPE);
const SHAPE_MORNING = Math.max(...CITY_HOURLY_SHAPE.slice(5, 12));
const PEAK_HOUR = CITY_HOURLY_SHAPE.indexOf(SHAPE_MAX);
const MORNING_HOUR = CITY_HOURLY_SHAPE.indexOf(SHAPE_MORNING);
const LOW_HOUR = CITY_HOURLY_SHAPE.indexOf(SHAPE_MIN);
const PEAK_RATE = PACK_DEFAULTS.avg * SHAPE_MAX;
const LOW_RATE = PACK_DEFAULTS.avg * SHAPE_MIN;
// A ramp that overruns the line at the starting pack.
const OVER_RAMP = ANSWER_RAMP + 4 * RAMP_STEP;
const OVER = simulate({ ...PACK_DEFAULTS, ramp: OVER_RAMP });
const OVER_SHORT = OVER.reduce((a, h) => a + h.shortfall, 0) / 24;
const OVER_FIRST = OVER.find((h) => h.shortfall > 1e-6)?.hour ?? 0;
const ANSWER_WINDOW = startRange(CHALLENGE_AVG, ANSWER_RAMP, dayMean(CHALLENGE_AVG, ANSWER_RAMP));
// Receipts below the day's demand.
/** The challenge's shortfall over the two days, MMcf, and a third day: no starting linepack survives it. */
const IMBALANCE_DRAIN = ((IMBALANCE.avg - IMBALANCE.receipts) * HOURS) / 24;
export const IMBALANCE_THREE_DAYS = startRange(IMBALANCE.avg, IMBALANCE.ramp, IMBALANCE.receipts, 72);
const SHORT_RECEIPTS = 1200;
const DRAIN = simulate({ ...PACK_DEFAULTS, ratable: false, receipts: SHORT_RECEIPTS });
const DRAIN_FIRST = DRAIN.find((h) => h.shortfall > 1e-6)?.hour ?? NaN;
const DRAIN_SHORT = DRAIN.reduce((a, h) => a + h.shortfall, 0) / 24;
/** The latest the first shortfall can be put off by choosing the starting linepack. */
const DRAIN_LATEST = (() => {
  let latest = 0;
  for (let start = START_MIN; start <= START_MAX; start += START_STEP) {
    const r = simulate({ ...PACK_DEFAULTS, ratable: false, receipts: SHORT_RECEIPTS, start });
    latest = Math.max(latest, r.find((h) => h.shortfall > 1e-6)?.hour ?? HOURS);
  }
  return latest;
})();
// Flexibility against throughput.
const W0 = packWindow(NL, 0);
const W1000 = packWindow(NL, 1000);
const W1400 = packWindow(NL, 1400);
const RAMP_AT_1000 = largestRamp(1000);
const LIMIT_AVG = (() => {
  let best = 0;
  for (let q = 0; q <= 1800; q += 5) {
    const r = startRange(q, 0, q);
    if (r.lo <= r.hi) best = q;
  }
  return best;
})();

// Fig 2's sweep: largest ramp by average demand.
const SWEEP_AVGS = Array.from({ length: 46 }, (_, i) => 600 + i * 20);
const SWEEP_RAMPS = SWEEP_AVGS.map((a) => largestRamp(a, 25, 1500));
const FLOWS = Array.from({ length: 91 }, (_, i) => Math.min(CAPACITY, i * 20));
const WINDOWS = FLOWS.map((q) => packWindow(NL, q));

const clock = (h: number) => (h % 24 === 0 ? (h === 0 ? 'day 1' : h === 24 ? 'day 2' : '48 h') : hour(h % 24));
const mmcf = (x: number) => `${fmt(x)} MMcf`;
/** MMcf with a decimal for small amounts, so a sliver of a cut doesn't read as zero. */
const mmcf1 = (x: number) => `${fmt(x, x > 0 && x < 9.95 ? 1 : 0)} MMcf`;

// ---------------------------------------------------------------------------
// The pipe, drawn at one hour: shaded by pressure, with the stations' sawtooth.

const PRESS_LIGHT = '#eef3f9';

function PipeDiagram({ h, run, asked }: { h: PackHour; run: PackHour[]; asked: number }) {
  const x0 = 70;
  const x1 = 560;
  const seg = (x1 - x0) / 3;
  const y = 70;
  const th = 28;
  const shade = (p: number) => mix(PRESS_LIGHT, GRAPHIC.blue, clamp((p - 700) / 800, 0, 1) * 0.85);
  const pd = h.discharge;
  const ps = h.delivery;
  const packs = run.map((x) => x.pack);
  const lo = Math.min(...packs);
  const hi = Math.max(...packs);
  const short = h.shortfall > 1e-6;
  const held = h.refused > 1e-6;
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 138"
      role="img"
      aria-label={`Northline at ${clock(h.hour + 1)}: ${fmt(h.pack)} MMcf in the pipe. Stations discharge at ${fmt(pd - 14.696)} psig and gas reaches Metro at ${fmt(ps - 14.696)} psig. Receipts ${fmt(h.receipts)} MMcf/d, deliveries ${fmt(h.deliveries)} of ${fmt(asked)} MMcf/d asked.`}
    >
      <defs>
        {[0, 1, 2].map((i) => (
          <linearGradient key={i} id={`lp-seg-${i}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={shade(pd)} />
            <stop offset="1" stopColor={shade(ps)} />
          </linearGradient>
        ))}
      </defs>
      <text className="ax" x={x0} y={18}>
        Calder Hub
      </text>
      <text className="ax ax-e" x={x1} y={18}>
        Metro
      </text>
      <text x={(x0 + x1) / 2} y={20} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: TEXT.gold }}>
        {fmt(h.pack)} MMcf in the pipe
      </text>
      <text x={(x0 + x1) / 2} y={38} textAnchor="middle" className="ax">
        two-day range {fmt(lo)}–{fmt(hi)} MMcf
      </text>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={x0 + i * seg} y={y - th / 2} width={seg} height={th} fill={`url(#lp-seg-${i})`} stroke="#6b6b6b" strokeWidth={1.2} />
      ))}
      {[0, 1, 2].map((i) => (
        <g key={'st' + i}>
          <rect x={x0 + i * seg - 6} y={y - th / 2 - 8} width={12} height={th + 16} rx={2} fill={GRAPHIC.red} opacity={0.85} />
          <text x={x0 + i * seg} y={y + th / 2 + 22} textAnchor="middle" className="ax">
            {i === 0 ? 'station 1' : `station ${i + 1}`}
          </text>
        </g>
      ))}
      <path d={`M${x0 + 8} ${y} L${x1 - 4} ${y}`} className="flow-dots" stroke="#fff" strokeWidth={5} style={{ animationDuration: `${(18 / Math.max(1, (h.receipts + h.deliveries) / 40)).toFixed(3)}s` }} />
      <text x={x0 - 8} y={y - 4} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: TEXT.orange }}>
        {fmt(h.receipts)}
      </text>
      <text x={x0 - 8} y={y + 12} textAnchor="end" className="ax">
        in{held ? ', some held' : ''}
      </text>
      <text x={x1 + 8} y={y - 4} style={{ fontSize: 13, fontWeight: 500, fill: short ? TEXT.red : TEXT.orange }}>
        {fmt(h.deliveries)}
      </text>
      <text x={x1 + 8} y={y + 12} className="ax">
        {short ? `of ${fmt(asked)} out` : 'out'}
      </text>
      <text x={x0 - 6} y={y + th / 2 + 42} style={{ fontSize: 12.5, fill: TEXT.blue }}>
        stations: {fmt(pd - 14.696)} psig
      </text>
      <text x={x1 + 6} y={y + th / 2 + 42} textAnchor="end" style={{ fontSize: 12.5, fill: ps - 14.696 < NORTHLINE.minDeliveryPsig + 15 ? TEXT.red : TEXT.blue }}>
        at Metro: {fmt(ps - 14.696)} psig
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s = useScenario('pack', PACK_DEFAULTS);
  const st = s.state;
  const play = usePlay(true);
  const [cursor, setCursor] = useState(0);
  useAnimationFrame((dt) => setCursor((c) => (c + dt * 4) % HOURS), play.playing);
  const scrub = (x: number) => {
    play.setPlaying(false);
    setCursor(clamp(x, 0, HOURS - 0.01));
  };

  const rin = receiptsOf(st);
  const dem = useMemo(() => demandDay(st.avg, st.ramp), [st.avg, st.ramp]);
  const run = useMemo(() => simulate(st), [st]);
  const range = useMemo(() => startRange(st.avg, st.ramp, rin), [st.avg, st.ramp, rin]);
  const workable = range.lo <= range.hi;
  const h = run[Math.floor(cursor)] ?? run[0];
  const askedNow = dem[h.hour % 24];
  const shortTotal = run.reduce((a, x) => a + x.shortfall, 0) / 24;
  const heldTotal = run.reduce((a, x) => a + x.refused, 0) / 24;
  const packs = run.map((x) => x.pack);
  const minDelivery = Math.min(...run.map((x) => x.delivery)) - 14.696;
  const solved = useMemo(() => imbalanceSolved(st), [st]);
  const firstCut = run.find((x) => x.shortfall > 1e-6);
  const firstHeld = run.find((x) => x.refused > 1e-6);
  const when = (x: PackHour) => `${hour((x.hour + 1) % 24)} on day ${x.hour < 24 ? 1 : 2}`;

  // Chart series.
  const hx = Array.from({ length: HOURS + 1 }, (_, i) => i);
  const askedSeries = [...Array.from({ length: HOURS }, (_, i) => dem[i % 24]), dem[(HOURS - 1) % 24]];
  const madeSeries = [...run.map((x) => x.deliveries), run[HOURS - 1].deliveries];
  const inSeries = [...run.map((x) => x.receipts), run[HOURS - 1].receipts];
  const windows = useMemo(() => Array.from({ length: HOURS }, (_, i) => packWindow(NL, (rin + dem[i % 24]) / 2)), [rin, dem]);
  const bandX = Array.from({ length: HOURS }, (_, i) => i + 1);
  const flowTop = Math.ceil((Math.max(...askedSeries, rin) * 1.08) / 200) * 200;
  const packTop = 1000;
  const packBottom = 600;

  const status = (() => {
    if (st.avg !== IMBALANCE.avg) return `Set Northline’s deliveries to Metro back to ${fmt(IMBALANCE.avg)} MMcf/d.`;
    if (st.ramp !== IMBALANCE.ramp) return 'Set the power plants’ evening ramp back to none.';
    if (!atImbalance(st)) return `Uncheck the box and set the receipts at Calder to ${fmt(IMBALANCE.receipts)} MMcf/d.`;
    if (firstCut) return `Starting from ${mmcf(st.start)}, the line hits the bottom of the band at ${when(firstCut)}: Metro is short ${mmcf1(shortTotal)} over the two days.`;
    if (firstHeld) return `Starting from ${mmcf(st.start)}, the line hits the top of the band at ${when(firstHeld)}, and ${mmcf1(heldTotal)} of receipts are held back at Calder.`;
    return '';
  })();
  const caption = !workable
    ? 'No starting linepack keeps every hour of the two days inside the band.'
    : atImbalance(st) && !solved
      ? 'Changing the starting linepack moves the whole trace up or down by the same amount, until it meets the band.'
      : `Any starting linepack from ${fmt(Math.ceil(range.lo))} to ${fmt(Math.floor(range.hi))} MMcf keeps every hour inside the band.`;

  // Figure 2.
  const flowNow = clamp(st.avg, 0, CAPACITY);
  const wNow = packWindow(NL, flowNow);
  const rampNow = useMemo(() => largestRamp(st.avg, 25, 1500), [st.avg]);

  return (
    <LessonPage id="gas/3.3">
      <P>
        The network of <a href={lessonHref('gas/3.2')}>the previous lesson</a> moved gas in daily amounts: so many Bcf a day along each pipeline, so much a day to each
        city. But a day’s average hides its hours. Gas enters Northline at Calder Hub at a steady rate, because shippers buy and schedule it a day at a time. Metro
        doesn’t burn it steadily. On a winter day its demand sags overnight to {pct(SHAPE_MIN)} of its daily average around {hour(LOW_HOUR)}, climbs to{' '}
        {pct(SHAPE_MORNING)} by {hour(MORNING_HOUR)} as homes wake and heat up, eases through the afternoon, and peaks at {pct(SHAPE_MAX)} around {hour(PEAK_HOUR)},
        when heating and the city’s gas-fired power plants run hard together.
      </P>
      <P>
        For hours at a time, then, Metro takes more gas out of Northline than enters it at the other end, and at night less. Something has to cover the difference,
        and it’s the pipe itself. <a href={lessonHref('gas/1.2')}>Lesson 1.2</a> showed that a cubic foot of pipe at pipeline pressure holds about 80 standard cubic
        feet, and <a href={lessonHref('gas/1.3')}>Lesson 1.3</a> found that Northline’s 240 miles hold some 800 MMcf. That gas in the pipe is its{' '}
        <K c="energy">linepack</K>. Raise the pressure and the pipe holds more — operators call that <b>packing</b> the line; let the pressure fall and it holds less,
        <b> drafting</b> it.
      </P>
      <P>
        In the next demonstration, gas flows through Northline for two winter days. The upper chart compares the <K tone="orange">receipts</K> at Calder with Metro’s
        hourly demand on Northline; the lower one traces the linepack, hour by hour, inside the band of what the pipe can hold. Flows are in MMcf/d, millions of cubic feet
        a day: 1,000 MMcf/d is 1 Bcf/d. Press play or drag across a chart to read any hour, and change how much gas Metro takes from Northline, the evening burn of
        its power plants, and how full the pipe is at midnight:
      </P>

      <Figure name="Linepack Simulator" scenario={s} play={play}>
        <PipeDiagram h={h} run={run} asked={askedNow} />
        <XYChart
          xDomain={[0, HOURS]}
          yDomain={[0, flowTop]}
          xTicks={[0, 6, 12, 18, 24, 30, 36, 42, 48]}
          xFormat={clock}
          yFormat={(v) => fmt(v)}
          yLabel="MMcf/d"
          height={132}
          series={[
            { xs: hx, ys: askedSeries, color: tint(GRAPHIC.orange, 0.45), kind: 'area', opacity: 1 },
            { xs: hx, ys: madeSeries, color: GRAPHIC.orange, kind: 'step', width: 2 },
            { xs: hx, ys: inSeries, color: '#333', kind: 'step', width: 2, dash: '6 4' },
          ]}
          cursor={cursor}
          onScrub={scrub}
          scrubLabel="Hour of the two days"
          ariaLabel={`Receipts at Calder, ${fmt(rin)} MMcf/d, against Metro's hourly demand, from ${fmt(Math.min(...dem))} to ${fmt(Math.max(...dem))} MMcf/d.${shortTotal > 0 ? ` ${mmcf(shortTotal)} of deliveries are cut over the two days.` : ''}`}
        />
        <XYChart
          xDomain={[0, HOURS]}
          yDomain={[packBottom, packTop]}
          xTicks={[0, 6, 12, 18, 24, 30, 36, 42, 48]}
          yTicks={[600, 700, 800, 900, 1000]}
          xFormat={clock}
          yFormat={(v) => fmt(v)}
          yLabel="Linepack, MMcf"
          height={152}
          series={[
            { xs: bandX, ys: windows.map((w) => w.max), lows: windows.map((w) => w.min), kind: 'band', color: tint(GRAPHIC.blue, 0.35), opacity: 1 },
            { xs: bandX, ys: windows.map((w) => w.max), color: GRAPHIC.blue, width: 1, dash: '3 3' },
            { xs: bandX, ys: windows.map((w) => w.min), color: GRAPHIC.red, width: 1, dash: '3 3' },
            { xs: [0, ...bandX], ys: [st.start, ...packs], color: TEXT.gold, width: 2.5 },
          ]}
          markers={[{ x: h.hour + 1, y: h.pack, color: TEXT.gold, r: 5 }]}
          cursor={cursor}
          onScrub={scrub}
          scrubLabel="Hour of the two days"
          ariaLabel={`Linepack over two days, between ${fmt(Math.min(...packs))} and ${fmt(Math.max(...packs))} MMcf. The band is what the pipe can hold each hour: its top has the stations at their 1,440 psig limit, its bottom brings gas to Metro at 765 psig.`}
        />
        <Legend
          items={[
            { label: 'Metro asks for', color: tint(GRAPHIC.orange, 0.45) },
            { label: 'Metro gets', color: GRAPHIC.orange, kind: 'line' },
            { label: 'Receipts at Calder', color: '#333', kind: 'line', dashed: true },
            { label: 'Linepack', color: TEXT.gold, kind: 'line' },
            { label: 'Most it can hold', color: GRAPHIC.blue, kind: 'line', dashed: true },
            { label: 'Least it can hold', color: GRAPHIC.red, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'lowest pressure at Metro', value: `${fmt(minDelivery)} psig`, tone: minDelivery < NORTHLINE.minDeliveryPsig + 1 ? 'red' : 'blue' },
            { label: 'deliveries cut over two days', value: mmcf1(shortTotal), tone: shortTotal > 0 ? 'red' : 'ink' },
          ]}
        />
        <Slider label="Northline’s deliveries to Metro" value={st.avg} min={600} max={1600} step={50} onChange={(v) => s.set({ avg: v, receipts: v })} display={`${fmt(st.avg)} MMcf/d`} />
        <Slider
          label="Power plants’ evening ramp"
          tone="red"
          value={st.ramp}
          min={0}
          max={800}
          step={RAMP_STEP}
          onChange={(v) => s.set({ ramp: v })}
          display={st.ramp > 0 ? `+${fmt(st.ramp)} MMcf/d, 17:00–21:00` : 'none'}
        />
        <Slider
          label="Receipts at Calder"
          tone="orange"
          value={st.ratable ? Math.round(rin) : st.receipts}
          min={600}
          max={1800}
          step={10}
          disabled={st.ratable}
          onChange={(v) => s.set({ receipts: v })}
          display={`${fmt(rin)} MMcf/d`}
        />
        <Checkbox label="Receipts follow the day’s average demand" checked={st.ratable} onChange={(v) => s.set({ ratable: v, receipts: Math.round(dayMean(st.avg, st.ramp) / 10) * 10 })} />
        <Slider
          label="Linepack at midnight, day 1"
          tone="gold"
          value={st.start}
          min={START_MIN}
          max={START_MAX}
          step={START_STEP}
          onChange={(v) => s.set({ start: v })}
          display={`${fmt(st.start)} MMcf`}
        />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        At the starting settings Metro takes an average of {fmt(PACK_DEFAULTS.avg)} MMcf/d ({fmt(PACK_DEFAULTS.avg / 1000, 1)} Bcf/d) from Northline, and shippers
        deliver exactly that to Calder, spread evenly over the day. Overnight,
        when the city takes as little as {fmt(LOW_RATE)} MMcf/d, the surplus packs the line: by {hour((BASE_HIGH_HOUR + 1) % 24)} it holds {mmcf(BASE_HIGH)}. The
        morning peak drafts it, the afternoon barely refills it, and the evening peak of {fmt(PEAK_RATE)} MMcf/d takes it down to {mmcf(BASE_LOW)} by{' '}
        {hour((BASE_LOW_HOUR + 1) % 24)}. Over the day {mmcf(BASE_HIGH - BASE_LOW)} goes into the pipe and comes back out, and the next day repeats the first. Nothing
        is stored for long; the pipeline is simply lending the city gas by the hour.
      </P>
      <P>
        The pressure at Metro carries the strain. It falls as the pipe drafts, and at its lowest, during the evening peak, it reaches {fmt(BASE_MIN_DELIVERY)} psig —
        comfortably above the 765 psig Northline promises. Any starting linepack from {fmt(Math.ceil(BASE_WINDOW.lo))} to {fmt(Math.floor(BASE_WINDOW.hi))} MMcf would
        have done.
      </P>

      <H2>Packing and drafting</H2>
      <P>
        The band in the lower chart is the pipe’s room to maneuver. Its top is the most gas the line can hold: every compressor station discharging at the 1,440 psig
        limit. Its bottom is the least it can hold and still deliver: the stations discharging only as hard as they must for gas to reach Metro at 765 psig. Both
        depend on the flow, because a pipe moving more gas needs a steeper pressure gradient, as <a href={lessonHref('gas/1.3')}>Lesson 1.3</a> showed — at each
        segment’s end
      </P>
      <Eq label="Delivery pressure squared equals discharge pressure squared minus K times flow squared">
        <K tone="blue">
          P<Sub>delivery</Sub>
          <Sup>2</Sup>
        </K>
        <Op>=</Op>
        <K tone="blue">
          P<Sub>discharge</Sub>
          <Sup>2</Sup>
        </K>
        <Op>−</Op>
        <span>K</span>
        <Op>×</Op>
        <K tone="orange">
          Q<Sup>2</Sup>
        </K>
      </Eq>
      <P>
        so the harder the line works, the lower the pressure at its far end for the same gas inside, and the narrower the band. That is why the band pinches at
        exactly the hours the city needs the pipe most.
      </P>
      <P>
        Now add the power plants. Many of Metro’s electricity plants burn gas, and they ramp up for the evening peak in electricity demand — the climb we followed in{' '}
        <a href={lessonHref('3.3')}>Lesson 3.3</a> of the electricity course. An extra {fmt(OVER_RAMP)} MMcf/d from 17:00 to 21:00 would fuel about{' '}
        {fmt(Math.round(ccgtMW(OVER_RAMP) / 100) * 100)} MW of combined-cycle plants as efficient as Lakeside, whose heat rate we met in{' '}
        <a href={lessonHref('gas/1.5')}>Lesson 1.5</a>, and it’s too much: even with receipts raised to cover the
        extra gas, the linepack hits the bottom of the band at {clock(OVER_FIRST + 1)} on the first day. Metro’s pressure would fall below 765 psig, so deliveries are
        cut — {mmcf(OVER_SHORT)} over the two days. Raising the starting linepack doesn’t rescue it for long: overnight the line hits the top of the band, and receipts
        it can’t take are held back at Calder.
      </P>
      <P>
        Step the ramp down and watch the caption, which finds the starting linepacks that keep every hour inside the band. It finds none until the ramp is down to{' '}
        {fmt(ANSWER_RAMP)} MMcf/d — about {fmt(Math.round(ccgtMW(ANSWER_RAMP) / 100) * 100)} MW of plants — and even then only {fmt(Math.ceil(ANSWER_WINDOW.lo))} to{' '}
        {fmt(Math.floor(ANSWER_WINDOW.hi))} MMcf: the line must be full enough at midnight to survive the evening and empty enough not to overflow before dawn. A step
        more and the day’s swing no longer fits between the band’s top overnight and its pinched bottom at the evening peak, whatever the start.
      </P>

      <H2>Linepack is not a supply</H2>
      <P>
        Set the ramp back to none, uncheck the box and set the receipts to {fmt(SHORT_RECEIPTS)} MMcf/d, a hundred less than Metro takes. For a while nothing seems
        wrong; the pipe makes up the difference. But the pipe ends every hour a little emptier than the same hour a day earlier, and starting from{' '}
        {mmcf(PACK_DEFAULTS.start)} at midnight it hits the bottom of the band in the hour to {clock(DRAIN_FIRST + 1)} on the {DRAIN_FIRST < 24 ? 'first' : 'second'} day’s
        evening peak: {mmcf(DRAIN_SHORT)} of deliveries are cut before the two days end. No starting linepack avoids it; the best one only puts it off until{' '}
        {clock(DRAIN_LATEST + 1)} on the second day. Linepack shifts gas between the hours of a day. Over a whole day, what goes in at one end has to come out at the
        other.
      </P>

      <Challenge
        id="a"
        figure="Linepack Simulator"
        question={`A smaller imbalance can be carried for a while. Shippers bring ${fmt(IMBALANCE.receipts)} MMcf/d to Calder, ${fmt(IMBALANCE.avg - IMBALANCE.receipts)} less than Metro takes. With balanced receipts any start from ${fmt(Math.ceil(BASE_WINDOW.lo))} to ${fmt(Math.floor(BASE_WINDOW.hi))} MMcf worked. Predict first: how much emptier will the line be by the second evening’s peak, and so roughly what starting linepack carries it through both days with nothing cut? Then set the receipts and the start, and check.`}
        solved={solved}
        status={status}
        success={`Solved: any start from ${fmt(Math.ceil(IMBALANCE_WINDOW.lo))} to ${fmt(Math.floor(IMBALANCE_WINDOW.hi))} MMcf works. Over the two days the line gives up ${mmcf(IMBALANCE_DRAIN)}, so the lowest workable start rises from ${fmt(Math.ceil(BASE_WINDOW.lo))} to ${fmt(Math.ceil(IMBALANCE_WINDOW.lo))}; the highest rises only from ${fmt(Math.floor(BASE_WINDOW.hi))} to ${fmt(Math.floor(IMBALANCE_WINDOW.hi))}, because the line still packs on the first night before the shortfall catches up.${IMBALANCE_THREE_DAYS.lo > IMBALANCE_THREE_DAYS.hi ? ` But that is about the limit: a third day would need the line fuller at midnight than it can be without overflowing before dawn, so no starting linepack lasts three days.` : ''}`}
      />
      <P>
        That’s why pipelines are strict about balance. Shippers schedule their receipts and deliveries a day ahead, pipelines write balancing rules into their
        tariffs, and when linepack runs dangerously high or low they can order shippers to bring their gas back into line. Gas and electricity keep different clocks,
        too: in the United States the gas day runs from 9 a.m. to 9 a.m. Central time, while power markets schedule hours from midnight, so a power plant that’s
        called on late in the evening may need gas it never scheduled. Its pipeline’s linepack is often what supplies it.
      </P>

      <H2>A full pipe has no flexibility</H2>
      <P>
        The band’s width depends on how hard the pipe is working. In the next demonstration, the upper chart plots the most and the least Northline can hold at steady
        flows from zero to its {fmt(CAPACITY)} MMcf/d capacity, and the lower one the largest evening ramp the line can carry for each average delivery to Metro,
        found the way we found {fmt(ANSWER_RAMP)} MMcf/d at {fmt(CHALLENGE_AVG)}. Change Northline’s deliveries to Metro:
      </P>

      <Figure name="Linepack Simulator · flexibility" scenario={s}>
        <XYChart
          xDomain={[0, 1800]}
          yDomain={[500, 1100]}
          xTicks={[0, 300, 600, 900, 1200, 1500, 1800]}
          yTicks={[500, 700, 900, 1100]}
          xFormat={(v) => fmt(v)}
          yFormat={(v) => fmt(v)}
          yLabel="Linepack the pipe can hold, MMcf"
          xLabel="steady flow through Northline, MMcf/d"
          height={190}
          series={[
            { xs: FLOWS, ys: WINDOWS.map((w) => w.max), lows: WINDOWS.map((w) => w.min), kind: 'band', color: tint(GRAPHIC.blue, 0.35), opacity: 1 },
            { xs: FLOWS, ys: WINDOWS.map((w) => w.max), color: GRAPHIC.blue, width: 2 },
            { xs: FLOWS, ys: WINDOWS.map((w) => w.min), color: GRAPHIC.red, width: 2 },
          ]}
          vLines={[{ at: flowNow, color: '#333', dash: '4 4', width: 1 }]}
          markers={[
            { x: flowNow, y: wNow.max, color: GRAPHIC.blue, r: 4 },
            { x: flowNow, y: wNow.min, color: GRAPHIC.red, r: 4, label: `${mmcf(wNow.swing)} of room`, labelPos: flowNow > 1300 ? 'left' : 'right' },
          ]}
          ariaLabel={`The most and least gas Northline can hold at steady flow: ${mmcf(W0.max)} and ${mmcf(W0.min)} with no flow, closing to nothing at ${fmt(CAPACITY)} MMcf/d. At ${fmt(flowNow)} MMcf/d the room is ${mmcf(wNow.swing)}.`}
        />
        <XYChart
          xDomain={[600, 1500]}
          yDomain={[0, 1500]}
          xTicks={[600, 800, 1000, 1200, 1400]}
          yTicks={[0, 500, 1000, 1500]}
          xFormat={(v) => fmt(v)}
          yFormat={(v) => fmt(v)}
          yLabel="Largest evening ramp, MMcf/d"
          xLabel="Northline’s average deliveries to Metro, MMcf/d"
          height={170}
          series={[
            { xs: SWEEP_AVGS, ys: SWEEP_RAMPS.map((r) => Math.max(0, r)), color: GRAPHIC.red, kind: 'area', opacity: 0.18 },
            { xs: SWEEP_AVGS, ys: SWEEP_RAMPS.map((r) => Math.max(0, r)), color: GRAPHIC.red, width: 2.5 },
          ]}
          vLines={[{ at: LIMIT_AVG, color: '#777', dash: '3 4', width: 1, label: `${fmt(LIMIT_AVG)}: none at all`, labelAt: 'start' }]}
          markers={st.avg >= 600 && st.avg <= 1500 ? [{ x: st.avg, y: Math.max(0, rampNow), color: GRAPHIC.red, r: 5, label: rampNow >= 0 ? `${fmt(rampNow)} MMcf/d` : 'not even the city’s own swing', labelPos: st.avg > 1250 ? 'left' : 'right' }] : []}
          ariaLabel={`The largest evening power-plant ramp Northline can carry, falling from ${fmt(SWEEP_RAMPS[0])} MMcf/d when it delivers an average of 600 MMcf/d to Metro to none above ${fmt(LIMIT_AVG)}. At ${fmt(st.avg)} MMcf/d it is ${rampNow >= 0 ? `${fmt(rampNow)} MMcf/d` : 'none: the line can’t even follow the city’s own daily swing'}.`}
        />
        <Readouts
          items={[
            { label: `room in the pipe at ${fmt(flowNow)} MMcf/d`, value: mmcf(wNow.swing), tone: 'gold' },
            { label: 'largest evening ramp', value: rampNow >= 0 ? `${fmt(rampNow)} MMcf/d` : 'none', tone: 'red' },
          ]}
        />
        <Slider label="Northline’s deliveries to Metro" value={st.avg} min={600} max={1600} step={50} onChange={(v) => s.set({ avg: v, receipts: v })} display={`${fmt(st.avg)} MMcf/d`} />
      </Figure>

      <P>
        With no gas flowing, Northline can hold anything from {mmcf(W0.min)} to {mmcf(W0.max)}: {mmcf(W0.swing)} of room. At 1,000 MMcf/d the room is down to{' '}
        {mmcf(W1000.swing)}, at 1,400 to {mmcf(W1400.swing)}, and at the line’s capacity it is gone — a pipeline running flat out has every psi of its pressure spent
        on moving gas, and nothing left to store it. The ramp it can carry falls even faster, because the evening peak arrives exactly when the band is narrowest:{' '}
        {fmt(RAMP_AT_1000)} MMcf/d when Northline delivers an average of 1,000 to Metro, and nothing at all above about {fmt(LIMIT_AVG)} MMcf/d, still well short of
        its capacity. Beyond that the line can’t even follow the city’s own daily swing without help (<FigRef to="Linepack Simulator">the first
        demonstration</FigRef> shows what happens). On the cold winter day of <a href={lessonHref('gas/3.2')}>Lesson 3.2</a>, Northline runs full at{' '}
        {fmt(NORTHLINE.capacityBcfd * 1000)} MMcf/d ({fmt(NORTHLINE.capacityBcfd, 1)} Bcf/d), far past that point, so it has no linepack to lend at all: Metro’s hourly
        swings have to come from somewhere else — in our region, from Hollow Creek beside the city, along with the rest of its shortfall.
      </P>
      <P>
        So the coldest days, when a pipeline runs closest to full, are exactly the days its linepack helps least. A city that wants to ride through its winter peaks
        needs gas stored close by, in quantities no pipe can hold: not hundreds of millions of cubic feet for a few hours, but tens of billions for a whole season.
        That’s the job of underground storage, the subject of <a href={lessonHref('gas/3.4')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
