import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  Sup,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  pct,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { contractSpan, indexDistribution, monthContract, payoff, settledIndex } from '../../../engines/weather/pricing';
import { expectedIndex } from '../../../engines/weather/market';
import { TREND_F_PER_YEAR, tempF } from '../../../model/weather/archive';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The contract: January heating degree days at Fenwick Bay, $20 a point.

export const JAN = monthContract('HDD', 0);
export const TICK = JAN.tick;
/** Valuation dates run from 60 days before January to the close of January 31. */
export const OFFSET_MIN = -60;
export const OFFSET_MAX = 30;
export const PATHS = 600;
export const PRICER_DEFAULTS = { year: 20, offset: OFFSET_MIN, strike: 1050, reveal: false };

export interface PricedDistribution {
  /** Simulated index values, sorted. */
  samples: number[];
  mean: number;
  sd: number;
  realized: number;
  daysRealized: number;
  daysForecast: number;
  daysClimate: number;
}

const distCache = new Map<string, PricedDistribution>();

/**
 * January of `year` as known at the close of day `offset` of the month (negative: days before
 * it). The simulated paths are shifted so their mean matches the exact expected index from the
 * same information (a standard way to take sampling noise out of a simulation's mean); the
 * spread and shape come from the simulation. Cached: every strike is priced from one set.
 */
export function pricerDist(year: number, offset: number): PricedDistribution {
  const key = `${year}|${offset}`;
  const hit = distCache.get(key);
  if (hit) return hit;
  const day = contractSpan(JAN, year).start + offset;
  const d = indexDistribution(JAN, year, day, { paths: PATHS });
  const shift = expectedIndex(JAN, year, day) - d.mean;
  const samples = Array.from(d.samples, (v) => Math.max(d.realized, v + shift));
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
  const out = { samples, mean, sd, realized: d.realized, daysRealized: d.daysRealized, daysForecast: d.daysForecast, daysClimate: d.daysClimate };
  if (distCache.size > 400) distCache.clear();
  distCache.set(key, out);
  return out;
}

/** Fair value of a call or put on the distribution, $. */
export function optionValue(d: PricedDistribution, type: 'call' | 'put', strike: number): number {
  let s = 0;
  for (const v of d.samples) s += payoff({ ...JAN, type, strike }, v);
  return s / d.samples.length;
}

export function probAboveStrike(d: PricedDistribution, strike: number): number {
  return d.samples.filter((v) => v > strike).length / d.samples.length;
}

/** The first challenge: a strike at which the call and the put are worth the same, to within $100. */
export function atTheMoneySolved(st: { year: number; offset: number; strike: number }): boolean {
  const d = pricerDist(st.year, st.offset);
  return Math.abs(optionValue(d, 'call', st.strike) - optionValue(d, 'put', st.strike)) <= 100;
}

/**
 * The first challenge's January and valuation date: year 12, on the eve of the month. There the
 * expected index is hidden until the reader has found it by put–call parity.
 */
export const PARITY = { year: 12, offset: -1 };

export function atParityDate(st: { year: number; offset: number }): boolean {
  return st.year === PARITY.year && st.offset === PARITY.offset;
}

/** The first challenge: on the parity date, a strike where the call and the put agree to within $100 — the expected index, to the slider's 10. */
export function paritySolved(st: { year: number; offset: number; strike: number }): boolean {
  return atParityDate(st) && atTheMoneySolved(st);
}

/** "60 days before January", "the close of January 10". */
export function dateLabel(offset: number): string {
  if (offset < 0) return offset === -1 ? 'the close of December 31' : `${-offset} days before January`;
  return `the close of January ${offset + 1}`;
}

// ---------------------------------------------------------------------------
// Burn analysis: pricing January of year 41 from the Januaries before it.

export const TARGET_YEAR = 41;

let janTemps: number[][] | null = null;
function januaryTemps(): number[][] {
  if (!janTemps) {
    janTemps = Array.from({ length: 41 }, (_, i) => {
      const s = contractSpan(JAN, i + 1).start;
      return Array.from({ length: 31 }, (_, k) => tempF('fenwick', s + k));
    });
  }
  return janTemps;
}

/** January of year y's index, with every day warmed by `shiftF`. */
function januaryHdd(y: number, shiftF: number): number {
  return januaryTemps()[y - 1].reduce((s, t) => s + Math.max(0, 65 - (t + shiftF)), 0);
}

export interface BurnView {
  years: number[];
  indices: number[];
  /** The burn price: the average index. */
  index: number;
}

/** The burn for January of `target` over the `window` Januaries before it, as recorded or detrended to the target year. */
export function burnView(window: number, detrend: boolean, target = TARGET_YEAR): BurnView {
  const years: number[] = [];
  for (let y = target - window; y < target; y++) if (y >= 1) years.push(y);
  const indices = years.map((y) => januaryHdd(y, detrend ? TREND_F_PER_YEAR * (target - y) : 0));
  return { years, indices, index: indices.reduce((a, b) => a + b, 0) / Math.max(1, indices.length) };
}

let janSd: number | null = null;
/** Year-to-year standard deviation of January's index in the archive, detrended to year 21. */
export function januarySd(): number {
  if (janSd === null) {
    const xs = Array.from({ length: 41 }, (_, i) => januaryHdd(i + 1, TREND_F_PER_YEAR * (21 - (i + 1))));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    janSd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  }
  return janSd;
}

/** January's index falls by 31 × the trend each year (every January day is below 65 °F). */
export const TREND_HDD_PER_YEAR = 31 * TREND_F_PER_YEAR;

/**
 * Expected error of a burn price from `window` years: sampling noise σ/√N, plus — without
 * detrending — the bias of averaging Januaries centered (N + 1)/2 years in the past.
 */
export function burnError(window: number, detrend: boolean): { noise: number; bias: number; total: number } {
  const noise = januarySd() / Math.sqrt(window);
  const bias = detrend ? 0 : (TREND_HDD_PER_YEAR * (window + 1)) / 2;
  return { noise, bias, total: Math.sqrt(noise * noise + bias * bias) };
}

export const WINDOW_MIN = 2;
export const WINDOW_MAX = 40;

/** The window with the smallest expected error when the history isn't detrended. */
export function bestRawWindow(): number {
  let best = WINDOW_MIN;
  for (let n = WINDOW_MIN; n <= WINDOW_MAX; n++) if (burnError(n, false).total < burnError(best, false).total) best = n;
  return best;
}

/** The window, as recorded, where the noise and the bias are closest to equal: where the two curves cross. */
export function crossingWindow(): number {
  let best = WINDOW_MIN;
  const gap = (n: number) => Math.abs(burnError(n, false).noise - burnError(n, false).bias);
  for (let n = WINDOW_MIN; n <= WINDOW_MAX; n++) if (gap(n) < gap(best)) best = n;
  return best;
}

/** The second challenge: without detrending, a window within 1% of the smallest expected error. */
export function windowSolved(st: { window: number; detrend: boolean }): boolean {
  if (st.detrend) return false;
  return burnError(st.window, false).total <= 1.01 * burnError(bestRawWindow(), false).total;
}

// ---------------------------------------------------------------------------
// Drawing.

const HX = scale(700, 1300, 56, 620);
const BIN = 10;

function PricerChart({
  d,
  strike,
  settled,
  reveal,
  year,
  offset,
  hideMean,
}: {
  d: PricedDistribution;
  strike: number;
  settled: number;
  reveal: boolean;
  year: number;
  offset: number;
  hideMean: boolean;
}) {
  const bins = new Array(Math.round(600 / BIN)).fill(0);
  for (const v of d.samples) {
    const b = Math.floor((Math.max(700, Math.min(1299.9, v)) - 700) / BIN);
    bins[b]++;
  }
  const shares = bins.map((c) => c / d.samples.length);
  const top = Math.max(0.08, ...shares);
  const y = scale(0, top * 1.1, 212, 30);
  const xs = HX(strike);
  const call = optionValue(d, 'call', strike);
  const put = optionValue(d, 'put', strike);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 250"
      role="img"
      aria-label={`Simulated distribution of January HDD at Fenwick Bay in year ${year}, as known at ${dateLabel(offset)}: ${hideMean ? 'expected index hidden for the challenge' : `expected ${fmt(d.mean)}`}, with a standard deviation of ${fmt(d.sd)}, ${fmt(d.realized)} already settled. At a strike of ${fmt(strike)} the call is worth ${usd(call)} and the put ${usd(put)}.${reveal ? ` It settled at ${fmt(settled)}.` : ''}`}
    >
      <text className="ax" x={56} y={14}>
        Share of simulated Januaries
      </text>
      <rect x={56} y={30} width={Math.max(0, xs - 56)} height={182} fill={tint(GRAPHIC.blue, 0.12)} />
      <rect x={xs} y={30} width={Math.max(0, 620 - xs)} height={182} fill={tint(GRAPHIC.green, 0.14)} />
      <text className="ax ax-e" x={xs - 6} y={44} style={{ fill: TEXT.blue }}>
        ← the put pays
      </text>
      <text className="ax" x={xs + 6} y={44} style={{ fill: TEXT.green }}>
        the call pays →
      </text>
      <GridY y={y} ticks={[0]} x0={56} x1={620} baseline={0} format={() => '0'} />
      {shares.map((s, i) =>
        s > 0 ? <rect key={i} x={HX(700 + i * BIN) + 0.5} y={y(s)} width={HX(700 + BIN) - HX(700) - 1} height={y(0) - y(s)} fill={GRAPHIC.orange} opacity={0.85} /> : null,
      )}
      <line x1={xs} x2={xs} y1={30} y2={212} stroke={GRAPHIC.green} strokeWidth={2} />
      <text className="ax ax-m" x={xs} y={24} style={{ fill: TEXT.green, fontWeight: 600 }}>
        strike {fmt(strike)}
      </text>
      {!hideMean && (
        <g>
          <line x1={HX(d.mean)} x2={HX(d.mean)} y1={52} y2={212} stroke="#333" strokeWidth={1.5} strokeDasharray="5 4" />
          <text className="ax ax-m" x={HX(d.mean)} y={64} style={{ fill: '#333' }}>
            expected
          </text>
        </g>
      )}
      {d.realized > 700 && (
        <g>
          <line x1={HX(d.realized)} x2={HX(d.realized)} y1={150} y2={212} stroke="#777" strokeWidth={1.5} />
          <text className="ax ax-e" x={HX(d.realized) - 4} y={160}>
            settled so far
          </text>
        </g>
      )}
      {reveal && (
        <g>
          <line x1={HX(settled)} x2={HX(settled)} y1={72} y2={212} stroke="#111" strokeWidth={2.5} />
          <text x={HX(settled) + (HX(settled) > 540 ? -6 : 6)} y={84} textAnchor={HX(settled) > 540 ? 'end' : 'start'} style={{ fontSize: 12, fontWeight: 600, fill: '#111' }}>
            settled {fmt(settled)}
          </text>
        </g>
      )}
      {[700, 800, 900, 1000, 1100, 1200, 1300].map((v) => (
        <text key={v} className="ax ax-m" x={HX(v)} y={230}>
          {fmt(v)}
        </text>
      ))}
      <text className="ax ax-e" x={620} y={246}>
        January HDD at Fenwick Bay
      </text>
    </svg>
  );
}

/** The burn chart's plot area ends here; the price lines' labels sit in the margin to its right. */
const BX1 = 544;
const BX = scale(0.5, WINDOW_MAX + 0.5, 64, BX1);
const BY = scale(800, 1260, 150, 26);
const EX = scale(WINDOW_MIN, WINDOW_MAX, 64, BX1);
const EY = scale(0, 70, 290, 196);

function BurnChart({
  window,
  detrend,
  climate,
  model,
  showTotal,
}: {
  window: number;
  detrend: boolean;
  climate: number;
  model: number;
  /** Draw the as-recorded total error (hidden until the window challenge is solved). */
  showTotal: boolean;
}) {
  const bv = burnView(window, detrend);
  const ns = Array.from({ length: WINDOW_MAX - WINDOW_MIN + 1 }, (_, i) => i + WINDOW_MIN);
  const errs = ns.map((n) => burnError(n, false));
  const err = burnError(window, detrend);
  const barW = Math.max(2, BX(1) - BX(0) - 2);
  const hline = (v: number, color: string, label: string, dash?: string, dy = -4) => (
    <g>
      <line x1={64} x2={BX1} y1={BY(v)} y2={BY(v)} stroke={color} strokeWidth={2} strokeDasharray={dash} />
      <text className="ax" x={BX1 + 4} y={BY(v) + dy + 4} style={{ fill: color, fontWeight: 600 }}>
        {label}
      </text>
    </g>
  );
  const dotY = detrend ? EY(err.noise) : showTotal ? EY(err.total) : null;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 310"
      role="img"
      aria-label={`Burn price for January of year ${TARGET_YEAR} from the ${bv.years.length} Januaries before it${detrend ? ', detrended' : ', as recorded'}: ${fmt(bv.index)} HDD, against ${fmt(climate)} expected in that year's climate and ${fmt(model)} from the model with ENSO. At this window the noise is ${fmt(err.noise, 1)} HDD and the bias ${fmt(err.bias, 1)}.`}
    >
      <text className="ax" x={64} y={14}>
        January HDD in the years used, {detrend ? 'detrended to year 41' : 'as recorded'}
      </text>
      <GridY y={BY} ticks={[900, 1000, 1100, 1200]} x0={64} x1={BX1} format={(v) => fmt(v)} />
      {bv.years.map((yy, i) => {
        const v = bv.indices[i];
        const x = BX(WINDOW_MAX - bv.years.length + i + 1) - barW / 2;
        return <rect key={yy} x={x} y={BY(Math.max(800, v))} width={barW} height={BY(800) - BY(Math.max(800, v))} fill={tint(GRAPHIC.orange, 0.55)} />;
      })}
      {hline(bv.index, TEXT.orange, `burn ${fmt(bv.index)}`, undefined, climate > bv.index ? 10 : -4)}
      {hline(climate, '#333', `climate ${fmt(climate)}`, '6 4', climate > bv.index ? -4 : 10)}
      {hline(model, TEXT.blue, `with ENSO ${fmt(model)}`, '2 3', 12)}
      <text className="ax ax-m" x={BX(WINDOW_MAX - bv.years.length + 1)} y={166}>
        year {bv.years[0]}
      </text>
      <text className="ax ax-m" x={BX(WINDOW_MAX)} y={166}>
        year {TARGET_YEAR - 1}
      </text>
      <text className="ax" x={64} y={188}>
        Expected error of a burn price, HDD
      </text>
      <GridY y={EY} ticks={[0, 20, 40, 60]} x0={64} x1={BX1} format={(v) => fmt(v)} baseline={0} />
      <path d={linePath(ns.map(EX), errs.map((e) => EY(e.noise)))} fill="none" stroke="#777" strokeWidth={2} strokeDasharray="5 4" />
      <path d={linePath(ns.map(EX), errs.map((e) => EY(e.bias)))} fill="none" stroke={GRAPHIC.orange} strokeWidth={1.5} strokeDasharray="2 3" />
      {showTotal && <path d={linePath(ns.map(EX), errs.map((e) => EY(e.total)))} fill="none" stroke={GRAPHIC.orange} strokeWidth={2.5} />}
      <text className="ax" x={BX1 + 4} y={EY(errs[errs.length - 1].noise) + 12} style={{ fill: '#555', fontWeight: 600 }}>
        noise
      </text>
      <text className="ax" x={BX1 + 4} y={EY(errs[errs.length - 1].bias) + 4} style={{ fill: TEXT.orange, fontWeight: 600 }}>
        bias
      </text>
      {showTotal && (
        <text className="ax" x={BX1 + 4} y={EY(errs[errs.length - 1].total) - 4} style={{ fill: TEXT.orange, fontWeight: 600 }}>
          total
        </text>
      )}
      <line className="cur" x1={EX(window)} x2={EX(window)} y1={196} y2={290} />
      {dotY !== null && <circle cx={EX(window)} cy={dotY} r={5.5} fill={detrend ? '#777' : GRAPHIC.orange} stroke="#fcfcfb" strokeWidth={2} />}
      {[2, 10, 20, 30, 40].map((n) => (
        <text key={n} className="ax ax-m" x={EX(n)} y={304}>
          {n}
        </text>
      ))}
      <text className="ax" x={BX1 + 4} y={304}>
        years
      </text>
    </svg>
  );
}

/** True from the first time `flag` is true, for the rest of the visit. */
function useLatched(flag: boolean): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (flag) setSeen(true);
  }, [flag]);
  return seen || flag;
}

export default function Lesson() {
  const s = useScenario('pricer', PRICER_DEFAULTS);
  const year = useDeferredValue(s.state.year);
  const offset = useDeferredValue(s.state.offset);
  const { strike, reveal } = s.state;
  const d = useMemo(() => pricerDist(year, offset), [year, offset]);
  const settled = useMemo(() => settledIndex(JAN, year), [year]);
  const call = optionValue(d, 'call', strike);
  const put = optionValue(d, 'put', strike);
  const pAbove = probAboveStrike(d, strike);
  const solved = paritySolved({ year, offset, strike });
  const hideMean = atParityDate({ year, offset }) && !solved;

  const b = useScenario('burn', { window: 10, detrend: false });
  const { window, detrend } = b.state;
  const bv = burnView(window, detrend);
  const err = burnError(window, detrend);
  const solved2 = windowSolved(b.state);
  const showTotal = useLatched(solved2);

  // Numbers the prose quotes, from the same model the figures run.
  const n = useMemo(() => {
    const at = (off: number) => pricerDist(20, off);
    const atm = (dd: PricedDistribution) => optionValue(dd, 'call', Math.round(dd.mean / 10) * 10);
    const before60 = at(-60);
    const before30 = at(-30);
    const eve = at(-1);
    const ten = at(9);
    const twenty = at(19);
    const twentyFive = at(24);
    const start41 = contractSpan(JAN, TARGET_YEAR).start;
    return {
      before60,
      before30,
      eve,
      ten,
      twenty,
      twentyFive,
      settled20: settledIndex(JAN, 20),
      call60: optionValue(before60, 'call', 1050),
      callEve: optionValue(eve, 'call', 1050),
      callTen: optionValue(ten, 'call', 1050),
      callTwenty: optionValue(twenty, 'call', 1050),
      atm60: atm(before60),
      atmEve: atm(eve),
      atmTwenty: atm(twenty),
      climate41: expectedIndex(JAN, TARGET_YEAR, start41 - 60, { ignoreEnso: true }),
      model41: expectedIndex(JAN, TARGET_YEAR, start41 - 60),
      settled41: settledIndex(JAN, TARGET_YEAR),
      burn10: burnView(10, false).index,
      burn10d: burnView(10, true).index,
      burn20: burnView(20, false).index,
      burn20d: burnView(20, true).index,
      best: bestRawWindow(),
      cross: crossingWindow(),
      sd: januarySd(),
    };
  }, []);
  const e3 = burnError(3, false);
  const e10 = burnError(10, false);
  const e40 = burnError(40, false);
  const e40d = burnError(40, true);
  const eBest = burnError(n.best, false);
  const eCross = burnError(n.cross, false);

  return (
    <LessonPage id="weather/5.2">
      <P>
        <a href={lessonHref('weather/5.1')}>The previous lesson</a> wrote contracts: an index at a named station, a period, a tick of dollars per point, a strike.
        A contract is a promise about money that will change hands once the period is over and the index is known. The question for this lesson is what that
        promise is worth today, while the index is still uncertain.
      </P>
      <P>
        The answer comes from Chapter 3. A calibrated forecast doesn’t say what the index will be; it gives its whole distribution, with probabilities that come
        true as often as they say (<a href={lessonHref('weather/3.5')}>Lesson 3.5</a>). The fair value of a contract is its expected payoff over that
        distribution: the average of what it would pay across all the Januaries that could still happen. Price it at that and neither side expects to gain
        at the other’s expense. All the prices in this lesson are simulated, from the course’s simulated archive; we ignore interest, which over a few months
        changes little, and leave the premium a real market charges for taking risk to the next lesson.
      </P>
      <P>
        Some contracts need only the average. A January HDD future, as <a href={lessonHref('weather/5.1')}>Lesson 5.1</a> wrote it, pays the long side $20
        for each point the index settles above its strike and costs it $20 for each point below, so to the long side it is worth $20 × (expected index −
        strike). A new future is fairly struck at the expected index, where it is worth nothing to either side, and the strike at which a market will write new
        futures is what it quotes for them. A swap, the same bargain written privately between two firms, is valued the same way. Both are linear. An{' '}
        <K tone={WX.money}>option</K> is not: a call pays $20 for each point above its strike and nothing below, a put the reverse, so its value depends on how
        much of the distribution lies past the strike — on the distribution’s spread and shape, exactly the thing an average throws away, as the degree days of{' '}
        <a href={lessonHref('weather/4.1')}>Lesson 4.1</a> showed.
      </P>
      <P>
        What we know about a January depends on the date. Every day already past is settled. The next 15 days come from the forecast issued today, built only
        from the information revealed by today. Days further out come from the climate — the normal for the date, the warming trend, and the Pacific’s
        projected tilt from <a href={lessonHref('weather/2.4')}>Lesson 2.4</a>. In the next demonstration, choose a January from the archive and a valuation
        date from 60 days before the month to its last day. The bars are the simulated index, the green line the strike:
      </P>

      <Figure name="Weather Derivative Pricer" scenario={s}>
        <PricerChart d={d} strike={strike} settled={settled} reveal={reveal} year={year} offset={offset} hideMean={hideMean} />
        <Legend
          items={[
            { label: 'Simulated Januaries', color: GRAPHIC.orange },
            { label: 'Expected index', color: '#333', kind: 'line', dashed: true },
            { label: 'Strike', color: GRAPHIC.green, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: hideMean ? 'expected index: hidden for the challenge' : 'expected index', value: `${hideMean ? '?' : fmt(d.mean)} ± ${fmt(d.sd)}`, tone: WX.index },
            { label: `call struck at ${fmt(strike)}`, value: usd(call), tone: WX.money },
            { label: `put struck at ${fmt(strike)}`, value: usd(put), tone: WX.money },
            { label: `chance of finishing above ${fmt(strike)}`, value: pct(pAbove), tone: WX.probability },
          ]}
        />
        <Caption>
          At {dateLabel(offset)}: {d.daysRealized} {d.daysRealized === 1 ? 'day' : 'days'} settled ({fmt(d.realized)} HDD), {d.daysForecast} from the forecast,{' '}
          {d.daysClimate} from the climate.
        </Caption>
        <Slider label="January of year" value={s.state.year} min={2} max={41} onChange={(v) => s.set({ year: v })} display={`year ${s.state.year}`} />
        <Slider label="Valuation date" tone={WX.probability} value={s.state.offset} min={OFFSET_MIN} max={OFFSET_MAX} onChange={(v) => s.set({ offset: v })} display={dateLabel(s.state.offset)} />
        <Slider label="Strike" tone={WX.money} value={strike} min={800} max={1200} step={10} onChange={(v) => s.set({ strike: v })} display={`${fmt(strike)} HDD`} />
        <Checkbox label="Show how it settled" checked={reveal} onChange={(v) => s.set({ reveal: v })} />
        <Eq label={`Put-call parity: the call minus the put, ${usd(call)} minus ${usd(put)}, equals 20 dollars times the expected index${hideMean ? '' : ` ${fmt(d.mean)}`} minus the strike ${fmt(strike)}: ${usd(call - put)}`}>
          <K tone={WX.money}>C</K>
          <Op>−</Op>
          <K tone={WX.money}>P</K>
          <Op>=</Op>
          <span>$20 × (</span>
          <K tone={WX.index}>
            E[I]
          </K>
          <Op>−</Op>
          <span>
            K)
          </span>
          <Op>=</Op>
          <K tone={WX.money}>{usd(call - put)}</K>
        </Eq>
      </Figure>

      <P>
        Start 60 days before January of year 20. Nothing is settled and no forecast reaches the month, so every day comes from the climate: the index is expected
        at {fmt(n.before60.mean)} HDD with a standard deviation of {fmt(n.before60.sd)}, and a call struck at 1,050 is worth {usd(n.call60)}. Slide toward the
        month. By 30 days out the Pacific’s projection has shifted the center to {fmt(n.before30.mean)}; on the evening of December 31 the forecast covers
        the first 15 days, the spread has narrowed to {fmt(n.eve.sd)}, and the expected index is {fmt(n.eve.mean)}. Ten days in, {fmt(n.ten.realized)} HDD are
        settled and the forecast has turned cold: {fmt(n.ten.mean)} ± {fmt(n.ten.sd)}, and the call is back up to {usd(n.callTen)}. Twenty days in it is{' '}
        {fmt(n.twenty.mean)} ± {fmt(n.twenty.sd)}.
      </P>
      <P>
        Then show how it settled: {fmt(n.settled20)}. The last third of the month came in much warmer than the forecasts expected, a miss of about{' '}
        {fmt((n.twenty.mean - n.settled20) / n.twenty.sd, 1)} standard deviations. That is not a flaw in the price. A fair price is an expectation, not a
        prediction, and across all the archive’s Januaries the simulated distributions are calibrated: outcomes land in their tails about as often as the tails
        say they should. A desk that prices honestly will be wrong in particular months; what it mustn’t be is wrong on average.
      </P>
      <P>
        Watch the options as the date moves. An option’s value has two parts: what it would pay if the index settled where it is expected now, and the value of
        the uncertainty still left — its <b>time value</b>. For a call struck at the expected index, all of it is time value, roughly $20 × 0.4 × the standard
        deviation. In year 20 that falls from {usd(n.atm60)} 60 days out to {usd(n.atmEve)} on the eve of the month and {usd(n.atmTwenty)} twenty days in, as
        days settle and the forecast takes over from the climate. On the last day only what the index has already done is left.
      </P>
      <P>
        Calls and puts are tied together. Holding a call and selling a put at the same strike pays $20 × (index − strike) whatever happens: a future. So their
        difference must equal the future’s value, $20 × (expected index − strike), at every strike and on every date. This is <b>put–call parity</b>, and the
        equation in the demonstration checks it live.
      </P>

      <Challenge
        id="a"
        question={`Go to January of year ${PARITY.year}, valued at ${dateLabel(PARITY.offset)}, where the expected index is hidden. Predict the fair strike for a new future from put–call parity alone: at any strike, read the call minus the put in the equation and solve for the expected index. Then set the strike there, to the nearest 10, and check that the call and the put agree to within $100.`}
        solved={solved}
        status={
          !atParityDate({ year, offset })
            ? `Set January of year ${PARITY.year} and a valuation date of ${dateLabel(PARITY.offset)}.`
            : `At a strike of ${fmt(strike)} the call minus the put is ${usd(call - put)}. Parity says that is $20 × (expected index − ${fmt(strike)}): what must the expected index be?`
        }
        success={`Solved. At ${fmt(strike)} the call is worth ${usd(call)} and the put ${usd(put)}. Parity located the hidden expected index, ${fmt(d.mean, 1)}: at any strike K, the expected index is K + (C − P) ÷ $20. That is the fair strike for a new future, and an option struck there is said to be at the money. All of its value is time value, close to the rule of thumb’s $20 × 0.4 × ${fmt(d.sd)} = ${usd(20 * 0.4 * d.sd)}.`}
      />

      <H2>Pricing from history</H2>
      <P>
        The model in <FigRef to="Weather Derivative Pricer">the first demonstration</FigRef> knows the climate, the trend and ENSO. The oldest way to price a
        weather contract needs none of that. <b>Burn analysis</b> asks what the contract would have paid in each of the last N years, and averages. It is
        transparent and hard to argue with, and it has two weaknesses. A short history is noisy: January’s index varies from year to year with a standard
        deviation of about {fmt(n.sd)} HDD, so an average of N Januaries is uncertain by {fmt(n.sd)}/√N. A long history is biased, because the climate has
        warmed: in this archive each January loses {fmt(TREND_HDD_PER_YEAR, 2)} HDD a year to the trend, so Januaries from long ago overstate today’s.
        Desks <b>detrend</b>, warming each past year by the trend to the year being priced, but that needs the trend, and it is itself an estimate.
      </P>
      <P>
        In the next demonstration we price January of year {TARGET_YEAR}, the archive’s last, from the Januaries before it. The bars are the years used, the
        orange line their average — the <b>burn price</b>, the strike burn analysis would set for a new future — and the black dashed line what the index is
        expected to be in year {TARGET_YEAR}’s climate, which in a simulated world we happen to know. The lower chart splits the expected error of a burn price,
        for each window length, into its two parts: the noise, which is all the error left once the history is detrended, and the bias of the history as
        recorded. The equation combines them. Choose the window and whether to detrend:
      </P>

      <Figure name="Weather Derivative Pricer · burn analysis" scenario={b}>
        <Segmented
          label="History"
          value={detrend ? 'detrended' : 'recorded'}
          onChange={(v) => b.set({ detrend: v === 'detrended' })}
          options={[
            { value: 'recorded', label: 'As recorded' },
            { value: 'detrended', label: 'Detrended' },
          ]}
        />
        <BurnChart window={window} detrend={detrend} climate={n.climate41} model={n.model41} showTotal={showTotal} />
        <Legend
          items={[
            { label: 'Burn price', color: TEXT.orange, kind: 'line' },
            { label: 'Climate expectation', color: '#333', kind: 'line', dashed: true },
            { label: 'Model with ENSO', color: TEXT.blue, kind: 'line', dashed: true },
            { label: 'Noise', color: '#777', kind: 'line', dashed: true },
            { label: 'Bias, as recorded', color: GRAPHIC.orange, kind: 'line', dashed: true },
            ...(showTotal ? [{ label: 'Total error, as recorded', color: GRAPHIC.orange, kind: 'line' as const }] : []),
          ]}
        />
        <Readouts
          items={[
            { label: 'burn price against the climate', value: `${bv.index >= n.climate41 ? '+' : '−'}${fmt(Math.abs(bv.index - n.climate41))} HDD`, tone: WX.index },
            { label: 'expected error, in dollars per contract', value: usd(err.total * TICK), tone: WX.money },
          ]}
        />
        <Slider label="Years of history" value={window} min={WINDOW_MIN} max={WINDOW_MAX} onChange={(v) => b.set({ window: v })} display={`${window} years`} />
        <Eq label={`Expected error: the square root of the noise ${fmt(err.noise, 1)} squared plus the bias ${fmt(err.bias, 1)} squared, ${fmt(err.total, 1)} HDD`}>
          <span>error</span>
          <Op>=</Op>
          <span>√(</span>
          <span>
            (σ/√N)<Sub>noise</Sub>
            <Sup>2</Sup>
          </span>
          <Op>+</Op>
          <span>
            bias<Sup>2</Sup>)
          </span>
          <Op>=</Op>
          <span>
            √({fmt(err.noise, 1)}
            <Sup>2</Sup> + {fmt(err.bias, 1)}
            <Sup>2</Sup>)
          </span>
          <Op>=</Op>
          <K tone={WX.probability}>{fmt(err.total, 1)} HDD</K>
        </Eq>
      </Figure>

      <P>
        Ten years as recorded gives {fmt(n.burn10)} HDD for year {TARGET_YEAR}, close to the climate’s {fmt(n.climate41)} this time; detrended, {fmt(n.burn10d)}.
        Twenty years as recorded gives {fmt(n.burn20)}, too cold by {fmt(n.burn20 - n.climate41)}, because it reaches back into a colder climate; detrended,{' '}
        {fmt(n.burn20d)}. One history is a single draw, so the expected error is the better guide: three years carry an expected error of {fmt(e3.total)} HDD, ten
        years {fmt(e10.total)}, and forty years as recorded {fmt(e40.total)} — mostly bias by then — against {fmt(e40d.total)} detrended. At $20 a point, every 10
        HDD of error is $200 on every contract.
      </P>

      <Challenge
        id="b"
        question="Keep the history as recorded. A common guess is that the best window is where the noise and bias curves cross, so that neither error dominates. Predict first whether that is right. Then, reading the total in the equation, find a window whose expected error is within 1% of the smallest any window can achieve."
        solved={solved2}
        status={
          detrend
            ? 'Switch the history back to “As recorded” first.'
            : `At ${window} years the expected error is ${fmt(err.total, 1)} HDD: ${fmt(err.noise, 1)} of noise and ${fmt(err.bias, 1)} of bias. Can a different window do better?`
        }
        success={`Solved: ${fmt(err.total, 1)} HDD at ${window} years, and the total curve is now drawn. Its minimum is at ${n.best} years, not at the crossing: at ${n.cross} years the noise and bias are nearly equal, ${fmt(eCross.noise, 1)} and ${fmt(eCross.bias, 1)} HDD, but the total is ${fmt(eCross.total, 1)}, against ${fmt(eBest.total, 1)} at ${n.best}. The best window is where one more year takes as much off the error through less noise as it adds through more bias — here with ${fmt(eBest.noise, 1)} HDD of noise and ${fmt(eBest.bias, 1)} of bias. The minimum is flat, anything from the low twenties to about thirty years doing nearly as well, which is one reason desks have long argued about window lengths without settling them. Detrending removes the bias and lets every extra year help.`}
      />

      <P>
        Notice the blue line, too. Sixty days before the month, the model with ENSO expects {fmt(n.model41)} HDD for year {TARGET_YEAR}, below every burn
        price, because the Pacific was tilting that winter mild. No average of past Januaries can see that: burn analysis prices the climate, not the
        coming season. (January {TARGET_YEAR} settled at {fmt(n.settled41)}, between the two — one more single draw.) Practitioners describe three ways to
        price weather: burn analysis, modeling the index’s distribution directly, and simulating the daily weather, as{' '}
        <FigRef to="Weather Derivative Pricer">the first demonstration</FigRef> does. They differ most in what information they can use.
      </P>
      <P>
        A fair value is half of a trade. The other half is a market quoting a price, and the two will rarely agree, because the market blends other people’s
        models, their information, and what they will pay to be rid of risk. The next lesson puts our value next to a simulated market’s quotes, asks what
        probabilities those quotes imply, and asks when the gap between them is an opportunity and when it is only a mistake.
      </P>
    </LessonPage>
  );
}
