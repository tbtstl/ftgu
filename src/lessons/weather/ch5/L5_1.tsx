import { useMemo } from 'react';
import {
  Caption,
  Challenge,
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
  TEXT,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  scale,
  signed,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { INDEX_LABEL, indexValue, payoff, type AnyIndex, type ContractSpec, type PayoffType } from '../../../engines/weather/pricing';
import { farmYears } from '../../../engines/weather/exposure';
import { yieldHistory } from '../../../engines/weather/crops';
import { degreeDays } from '../../../engines/weather/degreeDays';
import { YEARS, expectedTemp, monthDays, tempF } from '../../../model/weather/archive';
import { MONTH_NAMES, STATIONS, type StationId } from '../../../model/weather/region';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: a contract written on any of the course's indices, settled against
// every year of the simulated archive.

/** Dollars per index unit the tick slider offers, from the CME's $20 up to large OTC deals. */
export const TICKS = [20, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000];
/** Caps the cap slider offers; the first is none. */
export const CAPS = [Infinity, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000];

const DEFAULT_TICK: Record<AnyIndex, number> = { HDD: 0, CDD: 0, rain: 11, frost: 7 };
const STRIKE_STEP: Record<AnyIndex, number> = { HDD: 5, CDD: 5, rain: 0.1, frost: 1 };
const UNIT: Record<AnyIndex, string> = { HDD: 'degree day', CDD: 'degree day', rain: 'inch', frost: 'day' };

export interface BuilderState {
  index: AnyIndex;
  station: StationId;
  /** First month, 0–11. */
  start: number;
  /** Months covered, 1–5. */
  length: number;
  type: PayoffType;
  strike: number;
  /** Index into TICKS. */
  tickI: number;
  /** Index into CAPS. */
  capI: number;
}

export const BUILDER_DEFAULTS: BuilderState = { index: 'HDD', station: 'calder', start: 0, length: 1, type: 'future', strike: 1015, tickI: 0, capI: 0 };

/** The months a contract starting in `start` for `length` months covers, as [year offset, month]. */
export function periodMonths(start: number, length: number): Array<[number, number]> {
  return Array.from({ length }, (_, i) => [Math.floor((start + i) / 12), (start + i) % 12] as [number, number]);
}

/** The contract years the archive can settle for a period. */
export function periodYears(start: number, length: number): number[] {
  const last = periodMonths(start, length)[length - 1];
  return Array.from({ length: YEARS - last[0] }, (_, i) => i + 1);
}

const historyCache = new Map<string, number[]>();
/** The index as it settled in every contract year of the archive. */
export function indexHistory(index: AnyIndex, station: StationId, start: number, length: number): number[] {
  const key = `${index}|${station}|${start}|${length}`;
  let v = historyCache.get(key);
  if (!v) {
    const months = periodMonths(start, length);
    v = periodYears(start, length).map((y) => indexValue(index, station, months, y));
    historyCache.set(key, v);
  }
  return v;
}

/** The strike slider's range and step for an index and period: the archive's range, padded. */
export function strikeRange(index: AnyIndex, station: StationId, start: number, length: number): { min: number; max: number; step: number; median: number } {
  const h = [...indexHistory(index, station, start, length)].sort((a, b) => a - b);
  const step = STRIKE_STEP[index];
  const lo = h[0];
  const hi = h[h.length - 1];
  const pad = 0.15 * (hi - lo) + step;
  const snap = (x: number) => Math.round(x / step) * step;
  return { min: Math.max(0, Math.floor((lo - pad) / step) * step), max: Math.ceil((hi + pad) / step) * step, step, median: snap(h[Math.floor(h.length / 2)]) };
}

export function specOf(st: BuilderState): ContractSpec {
  return { kind: 'HDD', months: [], type: st.type, strike: st.strike, tick: TICKS[st.tickI], cap: CAPS[st.capI] };
}

export interface BuilderResult {
  years: number[];
  indices: number[];
  payouts: number[];
  mean: number;
  paid: number;
  largest: number;
  capped: number;
}

export function builderResult(st: BuilderState): BuilderResult {
  const years = periodYears(st.start, st.length);
  const indices = indexHistory(st.index, st.station, st.start, st.length);
  const spec = specOf(st);
  const payouts = indices.map((i) => payoff(spec, i));
  const cap = CAPS[st.capI];
  return {
    years,
    indices,
    payouts,
    mean: payouts.reduce((s, v) => s + v, 0) / payouts.length,
    paid: payouts.filter((p) => p > 1e-9).length,
    largest: Math.max(...payouts),
    capped: Number.isFinite(cap) ? payouts.filter((p) => Math.abs(p) >= cap - 1e-6).length : 0,
  };
}

/** Marlow's June–August rain, the drought index of the challenge. */
export const DROUGHT = { start: 5, length: 3, below: 8, minPay: 100_000, maxYears: 8, maxCap: 250_000 };

/**
 * The challenge: a put on Marlow's June–August rain, capped at no more than $250,000, that pays at
 * least $100,000 in every summer with less than 8 inches and pays in no more than 8 summers.
 */
export function droughtSolved(st: BuilderState): boolean {
  if (st.index !== 'rain' || st.station !== 'marlow' || st.start !== DROUGHT.start || st.length !== DROUGHT.length || st.type !== 'put') return false;
  const cap = CAPS[st.capI];
  if (!Number.isFinite(cap) || cap > DROUGHT.maxCap) return false;
  const r = builderResult(st);
  const dryOk = r.indices.every((x, i) => x >= DROUGHT.below || r.payouts[i] >= DROUGHT.minPay - 1e-6);
  return dryOk && r.paid <= DROUGHT.maxYears;
}

function money(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e6) return `${x < 0 ? '−' : ''}$${fmt(a / 1e6, a >= 1e7 ? 0 : 2)}M`;
  return usd(x);
}

function indexText(index: AnyIndex, x: number): string {
  if (index === 'rain') return `${fmt(x, 1)} in`;
  if (index === 'frost') return `${fmt(x)} days`;
  return `${fmt(x)} ${index}`;
}

function periodText(start: number, length: number): string {
  const end = (start + length - 1) % 12;
  return length === 1 ? MONTH_NAMES[start] : `${MONTH_NAMES[start]}–${MONTH_NAMES[end]}`;
}

const PAY = GRAPHIC.green;
const LOSS = GRAPHIC.red;
const IDX = GRAPHIC.orange;

function BuilderChart({ st, r }: { st: BuilderState; r: BuilderResult }) {
  const range = strikeRange(st.index, st.station, st.start, st.length);
  const x = scale(range.min, range.max, 72, 616);
  const spec = specOf(st);
  const grid = Array.from({ length: 121 }, (_, i) => range.min + ((range.max - range.min) * i) / 120);
  const curve = grid.map((g) => payoff(spec, g));
  const [p0, p1] = niceDomain(Math.min(0, ...curve), Math.max(1, ...curve), 4);
  const y = scale(p0, p1, 168, 28);
  const [b0, b1] = niceDomain(Math.min(0, ...r.payouts), Math.max(1, ...r.payouts), 3);
  const yb = scale(b0, b1, 320, 222);
  const n = r.years.length;
  const bx = scale(0, n, 72, 616);
  const bw = Math.max(2, (bx(1) - bx(0)) * 0.7);
  const cap = CAPS[st.capI];
  const unit = st.index === 'rain' ? 'inches' : st.index === 'frost' ? 'days' : 'degree days';
  return (
    <svg
      className="chart"
      viewBox="0 0 640 352"
      role="img"
      aria-label={`A ${st.type} on ${STATIONS[st.station].name}’s ${INDEX_LABEL[st.index]} over ${periodText(st.start, st.length)}, strike ${indexText(st.index, st.strike)}, ${usd(TICKS[st.tickI])} per ${UNIT[st.index]}${Number.isFinite(cap) ? `, capped at ${money(cap)}` : ''}. Over ${n} simulated years it would have paid on average ${money(r.mean)} a year, paying in ${r.paid} of them, at most ${money(r.largest)}.`}
    >
      <text className="ax" x={72} y={14}>
        Payout, by the index at settlement
      </text>
      <GridY y={y} ticks={niceTicks(p0, p1, 4)} x0={72} x1={616} format={(v) => money(v)} baseline={0} />
      <line className="cur" x1={x(st.strike)} x2={x(st.strike)} y1={28} y2={168} />
      <text className="ax" x={x(st.strike) + 5} y={40}>
        strike
      </text>
      {Number.isFinite(cap) && cap <= p1 && <line x1={72} x2={616} y1={y(cap)} y2={y(cap)} stroke={GRAPHIC.gray} strokeDasharray="4 4" />}
      {Number.isFinite(cap) && -cap >= p0 && <line x1={72} x2={616} y1={y(-cap)} y2={y(-cap)} stroke={GRAPHIC.gray} strokeDasharray="4 4" />}
      <path d={linePath(grid.map(x), curve.map(y))} fill="none" stroke={PAY} strokeWidth={2.5} />
      {r.indices.map((v, i) => (
        <circle key={i} cx={x(v)} cy={y(r.payouts[i])} r={3.6} fill={IDX} stroke="#fcfcfb" strokeWidth={1} opacity={0.9} />
      ))}
      {niceTicks(range.min, range.max, 6).map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={186}>
          {st.index === 'rain' ? fmt(v, v % 1 ? 1 : 0) : fmt(v)}
        </text>
      ))}
      <text className="ax ax-e" x={616} y={200}>
        index at settlement, {unit}
      </text>

      <text className="ax" x={72} y={214}>
        What it would have paid, year by year
      </text>
      <GridY y={yb} ticks={niceTicks(b0, b1, 3)} x0={72} x1={616} format={(v) => money(v)} baseline={0} />
      {r.payouts.map((p, i) => (
        <rect key={i} x={bx(i + 0.5) - bw / 2} y={Math.min(yb(0), yb(p))} width={bw} height={Math.max(0.5, Math.abs(yb(p) - yb(0)))} fill={p >= 0 ? PAY : LOSS} opacity={0.85} />
      ))}
      {[1, 10, 20, 30, 40].filter((yr) => yr <= n).map((yr) => (
        <text key={yr} className="ax ax-m" x={bx(yr - 0.5)} y={338}>
          {yr === 1 ? 'year 1' : yr}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second demonstration: one January's settlement, with a station outage and a sensor fault.

export type FillRule = 'normal' | 'ridge' | 'ridgeAdj' | 'marlow' | 'marlowAdj';

export const FILL_LABEL: Record<FillRule, string> = {
  normal: 'Calder Bay’s normal',
  ridge: 'Hollin Ridge',
  ridgeAdj: 'Hollin Ridge, adjusted',
  marlow: 'Marlow',
  marlowAdj: 'Marlow, adjusted',
};

export interface SettleState {
  year: number;
  /** First day of the outage, 1–31. */
  outStart: number;
  /** Days the station is out, 0–10. */
  outLength: number;
  fill: FillRule;
  /** Calibration drift of the sensor on the days it reports, °F. */
  drift: number;
}

export const SETTLE_DEFAULTS: SettleState = { year: 23, outStart: 17, outLength: 5, fill: 'normal', drift: 0 };
/** The position the settlement figure prices: 1,000 January contracts at $20 a point. */
export const POSITION = { contracts: 1000, tick: 20 };

/** The value a fallback rule puts in for a missing day, °F. */
export function fillValue(rule: FillRule, d: number): number {
  switch (rule) {
    case 'normal':
      return expectedTemp('calder', d);
    case 'ridge':
      return tempF('ridge', d);
    case 'ridgeAdj':
      return tempF('ridge', d) + expectedTemp('calder', d) - expectedTemp('ridge', d);
    case 'marlow':
      return tempF('marlow', d);
    case 'marlowAdj':
      return tempF('marlow', d) + expectedTemp('calder', d) - expectedTemp('marlow', d);
  }
}

export interface Settlement {
  /** What the air was each day, °F. */
  trueT: number[];
  /** What the settlement used, °F. */
  reported: number[];
  missing: boolean[];
  trueIndex: number;
  reportedIndex: number;
  /** Money moved to the long side by the difference, $. */
  moved: number;
}

export function settle(st: SettleState): Settlement {
  const { start, days } = monthDays(st.year, 0);
  const trueT: number[] = [];
  const reported: number[] = [];
  const missing: boolean[] = [];
  for (let i = 0; i < days; i++) {
    const d = start + i;
    const t = tempF('calder', d);
    const out = st.outLength > 0 && i + 1 >= st.outStart && i + 1 < st.outStart + st.outLength;
    trueT.push(t);
    missing.push(out);
    reported.push(out ? fillValue(st.fill, d) : t + st.drift);
  }
  const trueIndex = trueT.reduce((s, t) => s + degreeDays('HDD', t), 0);
  const reportedIndex = reported.reduce((s, t) => s + degreeDays('HDD', t), 0);
  return { trueT, reported, missing, trueIndex, reportedIndex, moved: (reportedIndex - trueIndex) * POSITION.tick * POSITION.contracts };
}

/** The challenge: with the station out for January 17–21 of year 23 and no drift, a fallback within 2 HDD of the truth. */
export function settlementSolved(st: SettleState): boolean {
  if (st.year !== 23 || st.outStart !== 17 || st.outLength !== 5 || st.drift !== 0) return false;
  const s = settle(st);
  return Math.abs(s.reportedIndex - s.trueIndex) <= 2;
}

function SettleChart({ s, st }: { s: Settlement; st: SettleState }) {
  const n = s.trueT.length;
  const x = scale(0.5, n + 0.5, 64, 616);
  const all = [...s.trueT, ...s.reported];
  const [t0, t1] = niceDomain(Math.min(...all) - 2, Math.max(...all) + 2, 4);
  const y = scale(t0, t1, 150, 26);
  const cumT: number[] = [];
  const cumR: number[] = [];
  let a = 0;
  let b = 0;
  s.trueT.forEach((t, i) => {
    a += degreeDays('HDD', t);
    b += degreeDays('HDD', s.reported[i]);
    cumT.push(a);
    cumR.push(b);
  });
  const [c0, c1] = niceDomain(0, Math.max(a, b), 4);
  const yc = scale(c0, c1, 306, 196);
  const xs = s.trueT.map((_, i) => x(i + 1));
  const outA = st.outStart;
  const outB = Math.min(n, st.outStart + st.outLength - 1);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 336"
      role="img"
      aria-label={`January of year ${st.year} at Calder Bay. ${st.outLength > 0 ? `The station is out from January ${outA} to ${outB}, filled from ${FILL_LABEL[st.fill]}.` : 'The station reports every day.'}${st.drift ? ` Its sensor reads ${signed(st.drift, 1)} °F off.` : ''} The true index is ${fmt(s.trueIndex, 1)} HDD; the settlement uses ${fmt(s.reportedIndex, 1)}.`}
    >
      <text className="ax" x={64} y={14}>
        Daily mean temperature, °F
      </text>
      {st.outLength > 0 && <rect x={x(outA - 0.5)} y={22} width={x(outB + 0.5) - x(outA - 0.5)} height={290} fill={tint(GRAPHIC.blue, 0.18)} />}
      {st.outLength > 0 && (
        <text className="ax ax-m" x={(x(outA - 0.5) + x(outB + 0.5)) / 2} y={36} style={{ fill: TEXT.blue }}>
          station out
        </text>
      )}
      <GridY y={y} ticks={niceTicks(t0, t1, 4)} x0={64} x1={616} />
      <path d={linePath(xs, s.trueT.map(y))} fill="none" stroke="#8a8a8a" strokeWidth={2} strokeDasharray="5 4" />
      {s.reported.map((t, i) => (
        <circle key={i} cx={xs[i]} cy={y(t)} r={s.missing[i] ? 4.5 : 3.2} fill={s.missing[i] ? '#fcfcfb' : IDX} stroke={IDX} strokeWidth={1.6} />
      ))}
      <text className="ax" x={64} y={186}>
        Heating degree days so far
      </text>
      <GridY y={yc} ticks={niceTicks(c0, c1, 4)} x0={64} x1={616} baseline={0} />
      <path d={linePath(xs, cumT.map(yc))} fill="none" stroke="#8a8a8a" strokeWidth={2} strokeDasharray="5 4" />
      <path d={linePath(xs, cumR.map(yc))} fill="none" stroke={IDX} strokeWidth={2.5} />
      {[1, 8, 15, 22, 29].map((dd) => (
        <text key={dd} className="ax ax-m" x={x(dd)} y={326}>
          {dd === 1 ? 'Jan 1' : dd}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const b = useScenario('builder', BUILDER_DEFAULTS);
  const st = b.state;
  const r = useMemo(() => builderResult(st), [st]);
  const range = useMemo(() => strikeRange(st.index, st.station, st.start, st.length), [st.index, st.station, st.start, st.length]);
  const solved = droughtSolved(st);
  const cap = CAPS[st.capI];

  const reshape = (patch: Partial<BuilderState>) =>
    b.set((s) => {
      const next = { ...s, ...patch };
      if (next.index === 'rain' && next.station === 'ridge') next.station = 'marlow';
      const rr = strikeRange(next.index, next.station, next.start, next.length);
      if (patch.index !== undefined && patch.index !== s.index) next.tickI = DEFAULT_TICK[next.index];
      return { ...next, strike: rr.median };
    });

  const g = useScenario('settlement', SETTLE_DEFAULTS);
  const sst = g.state;
  const s = useMemo(() => settle(sst), [sst]);
  const solved2 = settlementSolved(sst);

  // Numbers the prose quotes.
  const q = useMemo(() => {
    const jan = builderResult(BUILDER_DEFAULTS);
    const janMean = jan.indices.reduce((x, v) => x + v, 0) / jan.indices.length;
    const rainM = indexHistory('rain', 'marlow', 5, 3);
    const rainC = indexHistory('rain', 'calder', 5, 3);
    const profits = farmYears(0.02).map((f) => f.profit);
    const yh = yieldHistory();
    const dryYears = rainM.map((v, i) => ({ v, year: i + 1 })).filter((x) => x.v < DROUGHT.below);
    const worst = profits.reduce((w, p, i) => (p < profits[w] ? i : w), 0);
    const best = yh.reduce((w, x, i) => (x.bushels > yh[w].bushels ? i : w), 0);
    const corr = (xs: number[], ys: number[]) => {
      const n = xs.length;
      const mx = xs.reduce((a, v) => a + v, 0) / n;
      const my = ys.reduce((a, v) => a + v, 0) / n;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
      }
      return sxy / Math.sqrt(sxx * syy);
    };
    const fills = (Object.keys(FILL_LABEL) as FillRule[]).map((f) => ({ f, s: settle({ ...SETTLE_DEFAULTS, fill: f }) }));
    return {
      janMean,
      janMin: Math.min(...jan.payouts),
      janMax: Math.max(...jan.payouts),
      janAvg: jan.mean,
      dryYears,
      worstYear: worst + 1,
      worstRain: rainM[worst],
      worstHeat: yh[worst].heatDD,
      bestYear: best + 1,
      bestRain: rainM[best],
      bestBushels: yh[best].bushels,
      year8: { rain: rainM[7], bushels: yh[7].bushels, profit: profits[7] },
      rainCorr: corr(rainM, rainC),
      fills: Object.fromEntries(fills.map((x) => [x.f, x.s])) as Record<FillRule, Settlement>,
      drift: settle({ ...SETTLE_DEFAULTS, outLength: 0, drift: 0.5 }),
    };
  }, []);

  const dryList = q.dryYears.map((x) => `year ${x.year}`).join(', ');
  const pay8 = payoff(specOf(st), q.year8.rain);
  const payWorst = payoff(specOf(st), q.worstRain);

  return (
    <LessonPage id="weather/5.1">
      <P>
        <a href={lessonHref('weather/4.5')}>Chapter 4</a> ended with three businesses that lose money when the weather turns against them, and with what any of them
        would need before handing that risk to someone else: an index both sides trust, the number of dollars the business moves per point of it, and an honest
        measure of what the index misses. This chapter asks how weather outcomes are priced, transferred and traded. It starts with the thing that changes hands: the
        contract.
      </P>
      <P>
        A <K tone={WX.index}>weather derivative</K> is a contract whose payout is a formula applied to an index: a number measured at a named weather station over a
        named period. Nobody delivers any weather, and nobody has to prove a loss. When the period ends, the index is computed from the station’s records, and money
        changes hands according to the formula. For a future or a swap the formula is linear: one side pays the other a fixed <K tone={WX.money}>tick</K>, so many
        dollars per index point, times the difference between the index and an agreed level, the <b>strike</b>. A call pays only when the index finishes above its
        strike, a put only when it finishes below, and either can be capped, so the seller knows the most it can lose.
      </P>
      <P>
        The best-known contracts are the CME’s degree-day futures, which began trading in 1999. They are written on the heating and cooling degree days of{' '}
        <a href={lessonHref('weather/4.1')}>Lesson 4.1</a> at named airport stations in US cities — a daily mean of (max + min) ÷ 2 against 65 °F — for single months
        and for seasonal strips of several months, and each index point is worth $20. Other risks are written privately, over the counter, between two parties: rain
        over a growing season, frost days, snowfall, wind. Whatever the index, the contract has to pin down the same things: the station, and what happens if it
        fails; the index’s exact definition; the period; the tick, the strike and any cap; and when it settles.
      </P>
      <P>
        In the next demonstration, write a contract on any of the course’s indices — degree days, rain, or days with a mean below freezing — at any of the region’s
        stations, and settle it against every year of the simulated archive. The upper chart is the payout formula, with each archive year marked where its index
        settled; the lower one is what the contract would have paid, year by year. It starts as a CME-style January HDD future at Calder Bay, struck at the
        archive’s average January:
      </P>

      <Figure name="Weather Contract Builder" scenario={b}>
        <Segmented
          label="Index"
          value={st.index}
          onChange={(v) => reshape({ index: v })}
          options={[
            { value: 'HDD', label: 'HDD' },
            { value: 'CDD', label: 'CDD' },
            { value: 'rain', label: 'Rain' },
            { value: 'frost', label: 'Frost days' },
          ]}
        />
        <Segmented
          label="Station"
          value={st.station}
          onChange={(v) => reshape({ station: v })}
          options={(st.index === 'rain' ? (['calder', 'marlow'] as StationId[]) : (['calder', 'marlow', 'ridge'] as StationId[])).map((id) => ({ value: id, label: STATIONS[id].name }))}
        />
        <Segmented
          label="Payoff"
          value={st.type}
          onChange={(v) => b.set({ type: v })}
          options={[
            { value: 'future', label: 'Future' },
            { value: 'call', label: 'Call' },
            { value: 'put', label: 'Put' },
          ]}
        />
        <BuilderChart st={st} r={r} />
        <Legend
          items={[
            { label: 'Payout formula', color: PAY, kind: 'line' },
            { label: 'A simulated year', color: IDX },
            { label: 'Paid to the holder', color: PAY },
            { label: 'Paid by the holder', color: LOSS },
          ]}
        />
        <Readouts
          items={[
            { label: 'average payout a year', value: money(r.mean), tone: WX.money },
            { label: 'years it paid', value: `${r.paid} of ${r.years.length}`, tone: WX.money },
            { label: 'largest payout', value: money(r.largest), tone: WX.money },
            { label: 'years the cap bound', value: Number.isFinite(cap) ? String(r.capped) : 'no cap' },
          ]}
        />
        <Slider label="First month" value={st.start} min={0} max={11} onChange={(v) => reshape({ start: v })} display={MONTH_NAMES[st.start]} />
        <Slider label="Months covered" value={st.length} min={1} max={5} onChange={(v) => reshape({ length: v })} display={periodText(st.start, st.length)} />
        <Slider
          label="Strike"
          tone={WX.index}
          value={Math.min(range.max, Math.max(range.min, st.strike))}
          min={range.min}
          max={range.max}
          step={range.step}
          onChange={(v) => b.set({ strike: v })}
          display={indexText(st.index, st.strike)}
        />
        <Slider label="Tick" tone={WX.money} value={st.tickI} min={0} max={TICKS.length - 1} onChange={(v) => b.set({ tickI: v })} display={`${usd(TICKS[st.tickI])} per ${UNIT[st.index]}`} />
        <Slider label="Cap" tone={WX.money} value={st.capI} min={0} max={CAPS.length - 1} onChange={(v) => b.set({ capI: v })} display={Number.isFinite(cap) ? money(cap) : 'none'} />
        <Eq label={`Payout equals ${usd(TICKS[st.tickI])} times ${st.type === 'future' ? 'the index minus the strike' : st.type === 'call' ? 'the amount the index exceeds the strike, or zero' : 'the amount the index falls short of the strike, or zero'}${Number.isFinite(cap) ? `, capped at ${money(cap)}` : ''}`}>
          <K tone={WX.money}>payout</K>
          <Op>=</Op>
          <K tone={WX.money}>{usd(TICKS[st.tickI])}</K>
          <Op>×</Op>
          <span>
            {st.type === 'future' ? '(' : 'max(0, '}
            {st.type === 'put' ? (
              <>
                <K tone={WX.index}>{indexText(st.index, st.strike)}</K> − index
              </>
            ) : (
              <>
                index − <K tone={WX.index}>{indexText(st.index, st.strike)}</K>
              </>
            )}
            )
          </span>
          {Number.isFinite(cap) && <span>, at most {money(cap)}</span>}
        </Eq>
      </Figure>

      <P>
        Across the archive’s Januaries, Calder Bay collected {fmt(q.janMean)} heating degree days on average, so a future struck at 1,015 pays out about nothing
        on average — {money(q.janAvg)} a year — but a great deal in any one year: from {money(q.janMin)} to {money(q.janMax)} per contract. Whoever holds it gains{' '}
        $20 for every degree day of extra cold and loses $20 for every degree day of warmth; whoever sold it, the reverse. That is the trade a gas utility worried
        about a mild winter makes, on the selling side. Switch to a call and the losses disappear for the holder, and so do the payouts in mild years: the holder
        gets paid only for cold beyond the strike. A buyer would pay for that right up front; what it is worth is the question of the next lesson.
      </P>
      <P>
        The tick sets the size. The CME’s $20 makes one contract small, so a business hedges with many; private contracts are often written with ticks of thousands
        of dollars per point. Caps matter most for the seller of an option, whose losses are otherwise open-ended, and for anyone writing on rain, where a single
        extreme season can swamp years of premium.
      </P>

      <Challenge
        id="a"
        question={`Write drought protection for the Marlow farm: a put on Marlow’s June–August rain, capped at no more than $250,000, that would have paid at least $100,000 in every summer with less than 8 inches of rain — and paid in no more than 8 summers altogether.`}
        solved={solved}
        status={
          st.index !== 'rain' || st.station !== 'marlow'
            ? 'Start with the index: rain, at Marlow.'
            : st.start !== DROUGHT.start || st.length !== DROUGHT.length
              ? 'Cover June through August: a first month of June and three months.'
              : st.type !== 'put'
                ? 'Drought protection pays when the index falls short: make it a put.'
                : !Number.isFinite(cap) || cap > DROUGHT.maxCap
                  ? 'The seller insists on a cap of $250,000 or less.'
                  : `Right now it pays in ${r.paid} summers; in the driest of them, ${q.dryYears.map((x) => money(payoff(specOf(st), x.v))).join(', ')}.`
        }
        success={`Solved. The four summers under 8 inches — ${dryList} — each pay at least $100,000, and the contract pays in ${r.paid} summers in all. Now look at what it does in the farm’s actual years. Year ${q.worstYear}, the farm’s worst, had ${fmt(q.worstRain, 1)} inches of rain and ${fmt(q.worstHeat)} heat degree days: the heat did the damage, and this put pays ${money(payWorst)}. Year 8 had ${fmt(q.year8.rain, 1)} inches but a cool summer and ${fmt(q.year8.bushels)} bushels an acre; the farm made ${money(q.year8.profit)}, and the put pays ${money(pay8)}.`}
      />

      <P>
        That last point is the one <a href={lessonHref('weather/4.5')}>Lesson 4.5</a> warned about. A contract pays what its index says, not what the farm lost. Marlow’s
        rain gauge measures one cause of a bad season, and in this archive most of the farm’s worst seasons were hot rather than dry. And the gauge has to be the right
        one: switch the station to Calder Bay and the same put pays in a different set of years. In this simulated archive the two gauges’ summer totals are
        unrelated — a correlation of {fmt(q.rainCorr, 2)}, because the archive draws each gauge’s rain separately, which overstates the point — but summer rain is
        patchy, as <a href={lessonHref('weather/2.3')}>Lesson 2.3</a> showed, and a gauge far from a farm can miss its drought entirely.
      </P>

      <H2>Settlement: the index is a measurement</H2>
      <P>
        When the period ends, the index is computed from the station’s official daily records — the (max + min) ÷ 2 of{' '}
        <a href={lessonHref('weather/3.1')}>Lesson 3.1</a>, with all its sensitivity to how the instrument is sited and kept. Real stations miss days: a power cut, a
        failed sensor, a lost transmission. So a contract or the exchange’s rules must say in advance how a missing day is filled — from a backup station, or by
        some estimate — because once the money is at stake, every possible rule favors one side.
      </P>
      <P>
        In the next demonstration it is January of year 23, the coldest January in the archive, and Calder Bay’s station fails for five days during its coldest spell.
        The gray dashed lines are what the air did; the orange marks and line are what the settlement used, open circles for the filled days. The position is 1,000
        January contracts, $20,000 a degree day — the size of a partial hedge for a utility like Calder Gas & Light. Choose the fallback, move the outage, and give
        the sensor a calibration drift:
      </P>

      <Figure name="Weather Contract Builder · settlement" scenario={g}>
        <Segmented
          label="Fill missing days from"
          value={sst.fill}
          onChange={(v) => g.set({ fill: v })}
          options={(Object.keys(FILL_LABEL) as FillRule[]).map((f) => ({ value: f, label: FILL_LABEL[f] }))}
        />
        <SettleChart s={s} st={sst} />
        <Legend
          items={[
            { label: 'What the air did', color: '#8a8a8a', kind: 'line', dashed: true },
            { label: 'What the settlement used', color: IDX, kind: 'line' },
            { label: 'Station out', color: tint(GRAPHIC.blue, 0.35) },
          ]}
        />
        <Readouts
          items={[
            { label: 'true index', value: `${fmt(s.trueIndex, 1)} HDD`, tone: WX.index },
            { label: 'settlement index', value: `${fmt(s.reportedIndex, 1)} HDD`, tone: WX.index },
            { label: 'difference', value: `${signed(s.reportedIndex - s.trueIndex, 1)} HDD`, tone: WX.index },
            { label: 'moved to the long side', value: money(s.moved), tone: WX.money },
          ]}
        />
        <Slider label="Year" value={sst.year} min={1} max={YEARS} onChange={(v) => g.set({ year: v })} display={`year ${sst.year}`} />
        <Slider label="Outage starts" value={sst.outStart} min={1} max={31} onChange={(v) => g.set({ outStart: v })} display={`January ${sst.outStart}`} />
        <Slider label="Days out" value={sst.outLength} min={0} max={10} onChange={(v) => g.set({ outLength: v })} display={sst.outLength === 0 ? 'none' : `${sst.outLength} days`} />
        <Slider label="Sensor drift" tone={WX.temperature} value={sst.drift} min={-2} max={2} step={0.1} onChange={(v) => g.set({ drift: Math.round(v * 10) / 10 })} display={`${signed(sst.drift, 1)} °F`} />
        <Caption>
          {sst.outLength > 0
            ? `The ${sst.outLength} missing days ${s.reportedIndex >= s.trueIndex ? 'add' : 'remove'} ${fmt(Math.abs(s.reportedIndex - s.trueIndex), 1)} degree days, moving ${money(Math.abs(s.moved))} ${s.moved >= 0 ? 'to' : 'from'} whoever is long.`
            : `With every day reported, the settlement ${Math.abs(s.reportedIndex - s.trueIndex) < 0.05 ? 'matches the air exactly' : `is off by ${fmt(Math.abs(s.reportedIndex - s.trueIndex), 1)} degree days, all from the sensor’s drift`}.`}
        </Caption>
      </Figure>

      <P>
        Filling the gap with Calder Bay’s normal for the date is simple and impartial, but it erases the cold snap: the settlement counts{' '}
        {fmt(-(q.fills.normal.reportedIndex - q.fills.normal.trueIndex), 1)} fewer degree days than the air delivered, and {money(-q.fills.normal.moved)} moves from
        the long side to the short. Filling from Hollin Ridge as recorded goes wrong the other way: the ridge is 690 m higher and colder, and it adds{' '}
        {fmt(q.fills.ridge.reportedIndex - q.fills.ridge.trueIndex, 1)} degree days. Marlow, inland, adds {fmt(q.fills.marlow.reportedIndex - q.fills.marlow.trueIndex, 1)}.
        A backup station is useful only if its readings are adjusted for the normal difference between the two places.
      </P>
      <P>
        A sensor drift is quieter and no less real. With every day reported but the thermometer reading half a degree warm, the January index comes out{' '}
        {fmt(-(q.drift.reportedIndex - q.drift.trueIndex), 1)} degree days short — {money(-q.drift.moved)} on this position — and nothing in the record would show
        it. That is why the quality control of <FigRef to="Weather Contract Builder · settlement">this demonstration</FigRef>’s kind matters to anyone who trades on a
        station, and why a contract settles only after its period has ended and the data have been checked.
      </P>

      <Challenge
        id="b"
        question="Keep the outage on January 17–21 of year 23 and the sensor true. Which fallback rule settles the index within 2 degree days of what the air delivered?"
        solved={solved2}
        status={
          sst.year !== 23 || sst.outStart !== 17 || sst.outLength !== 5 || sst.drift !== 0
            ? 'Put the outage back on January 17–21 of year 23, with no drift.'
            : `Filled from ${FILL_LABEL[sst.fill]}, the settlement is off by ${signed(s.reportedIndex - s.trueIndex, 1)} degree days, ${money(Math.abs(s.moved))}.`
        }
        success={`Solved. Hollin Ridge’s readings, shifted by the normal difference between the ridge and the city, put the index ${signed(s.reportedIndex - s.trueIndex, 1)} degree days from the truth. The ridge saw the same cold spell — it was the same air mass — and the adjustment takes out the part that is only height. Marlow’s readings, adjusted the same way, are still ${fmt(Math.abs(q.fills.marlowAdj.reportedIndex - q.fills.marlowAdj.trueIndex), 1)} degree days off: 350 km away, the cold arrived and left on a different schedule.`}
      />

      <P>
        A contract, then, is a precise promise about a measurement. Its payout is fixed by the formula once the index is known, and the index is known only after the
        weather has happened and the data have been checked. Before that, it is a random number, and the contract is a claim on a random payout. So what is it worth
        on the day it is written, or a month into the season, when part of the index is already in and a forecast covers the next two weeks? The next lesson prices
        it, with the forecast distributions of Chapter 3.
      </P>
    </LessonPage>
  );
}
