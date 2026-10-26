import { useMemo } from 'react';
import {
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
  Slider,
  Sub,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  scale,
  useScenario,
} from '../../../framework';
import { BASE_F, CITY_WIND_SHARE, UTILITY, cdd, hdd, indexFromMonthlyMean, monthIndexHistory, sendout } from '../../../engines/weather/degreeDays';
import { winterHdd } from '../../../engines/weather/exposure';
import { YEARS, archive, expectedTemp, monthDays, tempF } from '../../../model/weather/archive';
import { MONTH_NAMES } from '../../../model/weather/region';
import { WX } from '../shared/tones';

const HDD_COLOR = GRAPHIC.orange;
const CDD_COLOR = GRAPHIC.red;

// ---------------------------------------------------------------------------
// The first demonstration: a month at Fenwick Bay from the simulated archive.

export interface MonthChoice {
  year: number;
  month: number;
  /** Every day shifted by this much, °F (a what-if scenario). */
  shift: number;
}

export const MONTH_DEFAULTS: MonthChoice = { year: 20, month: 0, shift: 0 };

export interface MonthRecord {
  temps: number[];
  /** Each day's normal for its date and year, °F. */
  normals: number[];
  hdd: number;
  cdd: number;
  /** Gas the utility sent out over the month, MMBtu. */
  volume: number;
  /** Its margin on that gas, $. */
  margin: number;
}

/** A month at Fenwick Bay with every day shifted by `shift` °F: its degree days, and the utility's gas and margin. */
export function monthRecord(st: MonthChoice): MonthRecord {
  const { start, days } = monthDays(st.year, st.month);
  const wind = archive().wind;
  const temps: number[] = [];
  const normals: number[] = [];
  let h = 0;
  let c = 0;
  let volume = 0;
  for (let i = 0; i < days; i++) {
    const t = tempF('fenwick', start + i) + st.shift;
    temps.push(t);
    normals.push(expectedTemp('fenwick', start + i));
    h += hdd(t);
    c += cdd(t);
    volume += sendout(hdd(t), CITY_WIND_SHARE * wind[start + i]);
  }
  return { temps, normals, hdd: h, cdd: c, volume, margin: UTILITY.margin * volume };
}

export interface MonthNormal {
  /** The archive's average heating and cooling degree days on each day of the month. */
  dailyHdd: number[];
  dailyCdd: number[];
  hdd: number;
  cdd: number;
}

const normalCache = new Map<number, MonthNormal>();
/** The month's normal index: the average over all 41 simulated years, day by day. */
export function monthNormal(month: number): MonthNormal {
  let v = normalCache.get(month);
  if (v) return v;
  const days = monthDays(1, month).days;
  const dailyHdd = new Array(days).fill(0);
  const dailyCdd = new Array(days).fill(0);
  for (let y = 1; y <= YEARS; y++) {
    const { start } = monthDays(y, month);
    for (let i = 0; i < days; i++) {
      const t = tempF('fenwick', start + i);
      dailyHdd[i] += hdd(t) / YEARS;
      dailyCdd[i] += cdd(t) / YEARS;
    }
  }
  v = { dailyHdd, dailyCdd, hdd: dailyHdd.reduce((s, x) => s + x, 0), cdd: dailyCdd.reduce((s, x) => s + x, 0) };
  normalCache.set(month, v);
  return v;
}

export const SHIFT_STEP = 0.5;

/**
 * The first challenge's answer: the shift, on the slider's half-degree steps, that brings the
 * starting January (year 20, a mild one) closest to a normal January. Every January day is below
 * 65 °F, so each degree colder adds one heating degree day to each of its 31 days: the reader
 * predicts it as (normal − actual) ÷ 31 ≈ 2.9 °F, so 3 °F colder.
 */
export const NORMAL_SHIFT = (() => {
  const normal = monthNormal(MONTH_DEFAULTS.month).hdd;
  let best = 0;
  for (let k = -20; k <= 20; k++) {
    const shift = k * SHIFT_STEP;
    const miss = (x: number) => Math.abs(monthRecord({ ...MONTH_DEFAULTS, shift: x }).hdd - normal);
    if (miss(shift) < miss(best)) best = shift;
  }
  return best;
})();

/** The first challenge: January of year 20, shifted to the step that makes it a normal January. */
export function normalShiftSolved(st: MonthChoice): boolean {
  return st.year === MONTH_DEFAULTS.year && st.month === MONTH_DEFAULTS.month && st.shift === NORMAL_SHIFT;
}

function millions(x: number, digits = 1): string {
  return `$${fmt(x / 1e6, digits)} million`;
}

const MX0 = 60;
const MX1 = 620;

function MonthChart({ rec, normal, label }: { rec: MonthRecord; normal: MonthNormal; label: string }) {
  const n = rec.temps.length;
  const X = scale(0, n, MX0, MX1);
  const lo = Math.floor((Math.min(BASE_F, ...rec.temps, ...rec.normals) - 3) / 10) * 10;
  const hi = Math.ceil((Math.max(BASE_F, ...rec.temps, ...rec.normals) + 3) / 10) * 10;
  const Y = scale(lo, hi, 186, 26);
  const bw = (X(1) - X(0)) * 0.62;
  const cumH: number[] = [];
  const cumC: number[] = [];
  const nH: number[] = [];
  const nC: number[] = [];
  rec.temps.forEach((t, i) => {
    cumH.push((cumH[i - 1] ?? 0) + hdd(t));
    cumC.push((cumC[i - 1] ?? 0) + cdd(t));
    nH.push((nH[i - 1] ?? 0) + normal.dailyHdd[i]);
    nC.push((nC[i - 1] ?? 0) + normal.dailyCdd[i]);
  });
  const [, top] = niceDomain(0, Math.max(10, cumH[n - 1], cumC[n - 1], nH[n - 1], nC[n - 1]), 3);
  const Y2 = scale(0, top, 318, 232);
  const xs = [X(0), ...rec.temps.map((_, i) => X(i + 1))];
  const path = (arr: number[]) => linePath(xs, [Y2(0), ...arr.map(Y2)]);
  const showH = cumH[n - 1] > 0.5 || nH[n - 1] > 0.5;
  const showC = cumC[n - 1] > 0.5 || nC[n - 1] > 0.5;
  const endLabel = (v: number, color: string, kind: string, dy: number) => (
    <text x={MX1 - 4} y={Y2(v) + dy} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: color }}>
      {fmt(v)} {kind}
    </text>
  );
  return (
    <svg
      className="chart"
      viewBox="0 0 640 344"
      role="img"
      aria-label={`${label} at Fenwick Bay: daily means from ${fmt(Math.min(...rec.temps), 1)} to ${fmt(Math.max(...rec.temps), 1)} °F. The month collects ${fmt(rec.hdd)} heating and ${fmt(rec.cdd)} cooling degree days, against a normal of ${fmt(normal.hdd)} and ${fmt(normal.cdd)}.`}
    >
      <text className="ax" x={MX0} y={14}>
        Daily mean temperature, °F
      </text>
      <GridY y={Y} ticks={niceTicks(lo, hi, 4)} x0={MX0} x1={MX1} />
      {rec.temps.map((t, i) => {
        const cold = t < BASE_F;
        return (
          <rect
            key={i}
            x={X(i + 0.5) - bw / 2}
            y={Math.min(Y(t), Y(BASE_F))}
            width={bw}
            height={Math.max(0.5, Math.abs(Y(t) - Y(BASE_F)))}
            fill={cold ? HDD_COLOR : CDD_COLOR}
            opacity={0.55}
          />
        );
      })}
      <path d={linePath(rec.normals.map((_, i) => X(i + 0.5)), rec.normals.map(Y))} fill="none" stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="5 4" />
      <line x1={MX0} x2={MX1} y1={Y(BASE_F)} y2={Y(BASE_F)} stroke="#333" strokeWidth={1.5} />
      <text x={MX1} y={Y(BASE_F) - 5} textAnchor="end" className="lab">
        65 °F
      </text>
      {rec.temps.map((t, i) => (
        <circle key={i} cx={X(i + 0.5)} cy={Y(t)} r={3} fill="#333" />
      ))}
      <text className="ax" x={MX0} y={222}>
        Degree days so far this month
      </text>
      <GridY y={Y2} ticks={niceTicks(0, top, 3)} x0={MX0} x1={MX1} baseline={0} />
      {showH && <path d={path(nH)} fill="none" stroke={HDD_COLOR} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.8} />}
      {showC && <path d={path(nC)} fill="none" stroke={CDD_COLOR} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.8} />}
      {showH && <path d={path(cumH)} fill="none" stroke={HDD_COLOR} strokeWidth={3} />}
      {showC && <path d={path(cumC)} fill="none" stroke={CDD_COLOR} strokeWidth={3} />}
      {showH && endLabel(cumH[n - 1], TEXT.orange, 'HDD', cumH[n - 1] >= cumC[n - 1] ? -6 : 14)}
      {showC && endLabel(cumC[n - 1], TEXT.red, 'CDD', cumC[n - 1] > cumH[n - 1] ? -6 : 14)}
      {[1, 8, 15, 22, 29].filter((d) => d <= n).map((d) => (
        <text key={d} className="ax ax-m" x={X(d - 0.5)} y={336}>
          {d}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second demonstration: one month's pattern of warm and cold days, re-centered and stretched.

/** The pattern: Fenwick Bay's May of year 12, its departures from normal scaled to an average of 0 and a standard deviation of 1. */
export const PATTERN = { year: 12, month: 4 };
export const PATTERN_Z: number[] = (() => {
  const { start, days } = monthDays(PATTERN.year, PATTERN.month);
  const an = Array.from({ length: days }, (_, i) => tempF('fenwick', start + i) - expectedTemp('fenwick', start + i));
  const m = an.reduce((s, v) => s + v, 0) / days;
  const sd = Math.sqrt(an.reduce((s, v) => s + (v - m) ** 2, 0) / days);
  return an.map((v) => (v - m) / sd);
})();

export interface SpreadChoice {
  /** The month's average daily mean, °F. */
  mean: number;
  /** Standard deviation of the days around it, °F. */
  swing: number;
}

export const SPREAD_DEFAULTS: SpreadChoice = { mean: 61.5, swing: 5.5 };
export const SWING_STEP = 0.5;

export function spreadDays(st: SpreadChoice): number[] {
  return PATTERN_Z.map((z) => st.mean + st.swing * z);
}

export function spreadIndex(st: SpreadChoice): { hdd: number; cdd: number; shortHdd: number; shortCdd: number } {
  const t = spreadDays(st);
  const n = t.length;
  return {
    hdd: t.reduce((s, v) => s + hdd(v), 0),
    cdd: t.reduce((s, v) => s + cdd(v), 0),
    shortHdd: indexFromMonthlyMean('HDD', st.mean, n),
    shortCdd: indexFromMonthlyMean('CDD', st.mean, n),
  };
}

/** The second challenge's target: 100 heating degree days in a month whose mean is exactly 65 °F. */
export const SWING_TARGET = 100;
/** The swing whose degree days the second challenge gives, so the reader can predict the target's from proportion. */
export const SWING_HINT = 5;
export function swingSolved(st: SpreadChoice): boolean {
  if (st.mean !== BASE_F) return false;
  return spreadIndex(st).hdd >= SWING_TARGET && spreadIndex({ ...st, swing: st.swing - SWING_STEP }).hdd < SWING_TARGET;
}

function SpreadChart({ st }: { st: SpreadChoice }) {
  const t = spreadDays(st);
  const n = t.length;
  const X = scale(0, n, MX0, MX1);
  const Y = scale(28, 110, 214, 22);
  const bw = (X(1) - X(0)) * 0.62;
  const idx = spreadIndex(st);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 240"
      role="img"
      aria-label={`A month of 31 days averaging ${fmt(st.mean, 1)} °F, swinging ${fmt(st.swing, 1)} °F around that. Counted day by day it has ${fmt(idx.hdd)} heating and ${fmt(idx.cdd)} cooling degree days; the monthly mean alone gives ${fmt(idx.shortHdd)} and ${fmt(idx.shortCdd)}.`}
    >
      <text className="ax" x={MX0} y={12}>
        Daily mean temperature, °F
      </text>
      <GridY y={Y} ticks={[40, 60, 80, 100]} x0={MX0} x1={MX1} />
      {t.map((v, i) => (
        <rect key={i} x={X(i + 0.5) - bw / 2} y={Math.min(Y(v), Y(BASE_F))} width={bw} height={Math.max(0.5, Math.abs(Y(v) - Y(BASE_F)))} fill={v < BASE_F ? HDD_COLOR : CDD_COLOR} opacity={0.55} />
      ))}
      <line x1={MX0} x2={MX1} y1={Y(BASE_F)} y2={Y(BASE_F)} stroke="#333" strokeWidth={1.5} />
      <line x1={MX0} x2={MX1} y1={Y(st.mean)} y2={Y(st.mean)} stroke={GRAPHIC.red} strokeWidth={2} strokeDasharray="6 4" />
      <text x={MX1} y={Y(BASE_F) + (st.mean > BASE_F ? 14 : -5)} textAnchor="end" className="lab">
        65 °F
      </text>
      <text x={MX0 + 4} y={Y(st.mean) + (st.mean > BASE_F ? -5 : 14)} style={{ fontSize: 12, fontWeight: 600, fill: TEXT.red }}>
        monthly mean {fmt(st.mean, 1)} °F
      </text>
      {t.map((v, i) => (
        <circle key={i} cx={X(i + 0.5)} cy={Y(v)} r={3} fill="#333" />
      ))}
      {[1, 8, 15, 22, 29].map((d) => (
        <text key={d} className="ax ax-m" x={X(d - 0.5)} y={232}>
          {d}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('month', MONTH_DEFAULTS);
  const st = s.state;
  const rec = useMemo(() => monthRecord(st), [st]);
  const normal = useMemo(() => monthNormal(st.month), [st.month]);
  const label = `${MONTH_NAMES[st.month]} of year ${st.year}`;
  const solved = normalShiftSolved(st);
  const heating = rec.hdd >= rec.cdd;

  const sp = useScenario('spread', SPREAD_DEFAULTS);
  const idx = spreadIndex(sp.state);
  const solved2 = swingSolved(sp.state);

  // Numbers the prose quotes.
  const q = useMemo(() => {
    const jan = monthIndexHistory('HDD', 0);
    const jul = monthIndexHistory('CDD', 6);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
    const start = monthRecord(MONTH_DEFAULTS);
    const colder = monthRecord({ ...MONTH_DEFAULTS, shift: -1 });
    const midJan = expectedTemp('fenwick', monthDays(20, 0).start + 14);
    const winters = Array.from({ length: YEARS - 1 }, (_, i) => winterHdd(i + 1));
    // May across the archive: day by day against the shortcut.
    let mayMean = 0;
    let mayH = 0;
    let mayC = 0;
    let mayShort = 0;
    for (let y = 1; y <= YEARS; y++) {
      const { start: d0, days } = monthDays(y, 4);
      const t = Array.from({ length: days }, (_, i) => tempF('fenwick', d0 + i));
      const m = mean(t);
      mayMean += m / YEARS;
      mayH += t.reduce((a, v) => a + hdd(v), 0) / YEARS;
      mayC += t.reduce((a, v) => a + cdd(v), 0) / YEARS;
      mayShort += indexFromMonthlyMean('HDD', m, days) / YEARS;
    }
    return {
      janMean: mean(jan),
      janSd: sd(jan),
      janMin: Math.min(...jan),
      janMinYear: jan.indexOf(Math.min(...jan)) + 1,
      janMax: Math.max(...jan),
      julMean: mean(jul),
      julSd: sd(jul),
      start,
      colder,
      midJan,
      winter: mean(winters),
      mayMean,
      mayH,
      mayC,
      mayShort,
      flat: spreadIndex({ ...SPREAD_DEFAULTS, swing: 0 }),
      dflt: spreadIndex(SPREAD_DEFAULTS),
      hint: spreadIndex({ mean: BASE_F, swing: SWING_HINT }),
    };
  }, []);
  const midJanHdd = Math.round(hdd(q.midJan));

  return (
    <LessonPage id="weather/4.1">
      <P>
        Chapter 3 ended with forecasts that say honestly how uncertain they are. This chapter asks where that uncertainty costs or earns money, and the most direct
        connection between temperature and spending is the obvious one. A cold day isn’t expensive because it’s cold. It’s expensive because every house, school and
        office in the city burns fuel to stay warm, and a hot day is expensive because they all run their air conditioners. So the first step from weather to money
        is to measure how much heating or cooling a day calls for.
      </P>
      <P>
        A building gains heat from the people in it, its lights and appliances, and the sun through its windows, and it loses heat through its walls and windows
        in proportion to how much colder it is outside than in. On a day averaging about 65 °F, the free gains roughly cover the losses and the furnace stays off.
        Below that, the furnace has to make up the difference, and the difference grows in step with how far the day falls short of 65 °F. That shortfall is the
        day’s <K tone={WX.index}>heating degree days</K>, or HDD, computed from the official daily mean of <a href={lessonHref('weather/3.1')}>Lesson 3.1</a>, the
        average of the day’s maximum and minimum:
      </P>
      <Eq label={`Heating degree days equal the larger of zero and 65 minus the day's mean temperature; on a normal mid-January day at Fenwick Bay, ${fmt(midJanHdd)}`}>
        <K tone={WX.index}>HDD</K>
        <Op>=</Op>
        <span>max(0, 65 °F −</span>
        <K tone={WX.temperature}>
          T<Sub>mean</Sub>
        </K>
        <span>)</span>
        <Op>,</Op>
        <span>
          <K tone={WX.temperature}>
            T<Sub>mean</Sub>
          </K>{' '}
          = (max + min) ÷ 2
        </span>
      </Eq>
      <P>
        A day averaging 40 °F is 25 heating degree days; a day averaging 70 °F is none. In summer the mirror image counts the cooling a day calls for: its{' '}
        <K tone={WX.index}>cooling degree days</K>, or CDD, are how far its mean rises above 65 °F. Add a month’s days together and you get its <b>index</b>. The
        65 °F base is a convention — real buildings differ — but it is the one the US energy industry has long used, and the CME’s degree-day futures for US cities
        count exactly this: a daily mean of (max + min) ÷ 2 against 65 °F, summed over a month or a season.
      </P>
      <P>
        Fenwick Bay’s gas utility, Fenwick Gas &amp; Light, is as simulated as the archive, but it behaves like a real one. It delivers{' '}
        {fmt(UTILITY.baseLoad)} MMBtu of gas a day whatever the weather — for water heaters, stoves and industry — and {fmt(UTILITY.perHdd)} MMBtu more for every
        heating degree day, a little more on windy days, which strip heat from buildings faster. (An MMBtu is a million British thermal units, about the energy in
        a thousand cubic feet of natural gas.) A normal mid-January day, averaging {fmt(q.midJan)} °F, is {fmt(midJanHdd)} heating degree days and needs about{' '}
        {fmt(sendout(midJanHdd))} MMBtu. The utility earns a margin of ${UTILITY.margin} on every MMBtu it delivers.
      </P>
      <P>
        In the next demonstration, choose a month at Fenwick Bay from the simulated archive. Each bar runs from the 65 °F line to the day’s mean: orange below it,
        heating degree days, and red above it, cooling degree days. The dashed gray line is the normal for each date. The lower chart adds the degree days up
        through the month, with the archive’s average month dashed. The third slider shifts every day warmer or colder, as a what-if:
      </P>

      <Figure name="Degree Day Simulator" scenario={s}>
        <MonthChart rec={rec} normal={normal} label={label} />
        <Legend
          items={[
            { label: 'Heating degree days', color: HDD_COLOR },
            { label: 'Cooling degree days', color: CDD_COLOR },
            { label: 'Normal', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: heating ? 'heating degree days' : 'cooling degree days', value: fmt(heating ? rec.hdd : rec.cdd), tone: WX.index },
            { label: 'normal for the month', value: fmt(heating ? normal.hdd : normal.cdd), tone: WX.index },
            { label: 'gas sent out, MMBtu', value: `${fmt(rec.volume / 1e6, 1)} million`, tone: WX.energy },
            { label: 'utility’s margin', value: millions(rec.margin), tone: WX.money },
          ]}
        />
        <Slider label="Year" value={st.year} min={1} max={YEARS} onChange={(v) => s.set({ year: v })} display={`year ${st.year}`} />
        <Slider label="Month" value={st.month} min={0} max={11} onChange={(v) => s.set({ month: v })} display={MONTH_NAMES[st.month]} />
        <Slider
          label="Shift every day"
          tone={WX.temperature}
          value={st.shift}
          min={-10}
          max={10}
          step={0.5}
          onChange={(v) => s.set({ shift: v })}
          display={st.shift === 0 ? 'as it happened' : `${fmt(Math.abs(st.shift), 1)} °F ${st.shift > 0 ? 'warmer' : 'colder'}`}
        />
      </Figure>

      <P>
        The demonstration opens on January of year 20, a mild one: {fmt(q.start.hdd)} heating degree days against a normal of {fmt(q.janMean)}. Fenwick Gas &amp;
        Light sent out {fmt(q.start.volume / 1e6, 1)} million MMBtu and earned {millions(q.start.margin)}. Step through the years and the Januaries differ by a lot:
        across the 41 simulated years they average {fmt(q.janMean)} heating degree days with a standard deviation of {fmt(q.janSd)}, from {fmt(q.janMin)} in year{' '}
        {q.janMinYear} to {fmt(q.janMax)} in the coldest. July’s cooling degree days average {fmt(q.julMean)}, with a standard deviation of {fmt(q.julSd)}: a
        smaller number, but proportionally an even bigger swing.
      </P>
      <P>
        Now shift January of year 20 a degree colder. Every January day is below 65 °F, so each one gains exactly one heating degree day, and the month gains{' '}
        {fmt(q.colder.hdd - q.start.hdd)}. That costs the city about {fmt(Math.round((q.colder.volume - q.start.volume) / 1000) * 1000)} MMBtu of extra gas and
        earns the utility {millions(q.colder.margin - q.start.margin, 2)} more. Over a whole heating season, November through March, Fenwick Bay averages{' '}
        {fmt(Math.round(q.winter / 10) * 10)} heating degree days, so a winter even a few percent warmer than normal takes millions of dollars off the utility’s
        margin. That is a risk it can measure in a single number, and in <a href={lessonHref('weather/4.5')}>Lesson 4.5</a> we’ll measure it.
      </P>

      <Challenge
        id="a"
        question={`January of year ${MONTH_DEFAULTS.year} collected ${fmt(q.start.hdd)} heating degree days, ${fmt(q.janMean - q.start.hdd)} short of a normal January. Predict first, from that rule of one degree day per degree per day: how many degrees colder would every one of its days have had to be to make it a normal January, to the slider’s half degree? Then shift the days to check.`}
        solved={solved}
        status={
          st.year !== MONTH_DEFAULTS.year || st.month !== MONTH_DEFAULTS.month
            ? `Go back to January of year ${MONTH_DEFAULTS.year} first.`
            : st.shift === 0
              ? 'Make your prediction, then shift every day colder.'
              : `With every day ${fmt(Math.abs(st.shift), 1)} °F ${st.shift > 0 ? 'warmer' : 'colder'}, the month collects ${fmt(rec.hdd)} heating degree days against a normal ${fmt(normal.hdd)}: ${fmt(Math.abs(rec.hdd - normal.hdd))} ${rec.hdd < normal.hdd ? 'short' : 'over'}.`
        }
        success={`Solved: ${fmt(Math.abs(NORMAL_SHIFT), 1)} °F colder. The month was ${fmt(q.janMean - q.start.hdd)} heating degree days short, and each degree colder adds one to each of its 31 days, so it needed ${fmt(q.janMean - q.start.hdd)} ÷ 31 = ${fmt((q.janMean - q.start.hdd) / 31, 1)} °F — ${fmt(Math.abs(NORMAL_SHIFT), 1)} on the slider, which gives ${fmt(rec.hdd)} against the normal ${fmt(normal.hdd)}. That is roughly what so mild a January cost Fenwick Gas & Light: about ${millions(rec.margin - q.start.margin)} of margin.`}
      />

      <H2>The averaging trap</H2>
      <P>
        Why add up the days one at a time, instead of taking the month’s average temperature and counting its degree days? Because the two don’t agree. A
        degree day is a hinge: below 65 °F it grows with every degree of cold, above 65 °F it is zero, however warm the day. A warm day doesn’t cancel a cold one; it
        simply adds nothing. So when a month’s days are spread around 65 °F, its cold days collect heating degree days and its warm days cooling degree days, while
        the monthly average, sitting near the hinge, says there were hardly any of either.
      </P>
      <P>
        May at Fenwick Bay shows it. Across the archive, May averages {fmt(q.mayMean, 1)} °F. The shortcut would give it 31 × (65 − the monthly mean), about{' '}
        {fmt(q.mayShort)} heating degree days, and no cooling degree days at all. Counted day by day, the average May has {fmt(q.mayH)} heating degree days and{' '}
        {fmt(q.mayC)} cooling degree days. In the next demonstration, one simulated May’s pattern of warm and cold days is re-centered on any monthly mean and
        stretched to any day-to-day swing (a standard deviation), so the two can be changed separately:
      </P>

      <Figure name="Degree Day Simulator · averaging" scenario={sp}>
        <SpreadChart st={sp.state} />
        <Readouts
          items={[
            { label: 'CDD, day by day', value: fmt(idx.cdd), tone: WX.index },
            { label: 'CDD, from the monthly mean', value: fmt(idx.shortCdd), tone: WX.index },
          ]}
        />
        <Slider label="Monthly mean" tone={WX.temperature} value={sp.state.mean} min={50} max={80} step={0.5} onChange={(v) => sp.set({ mean: v })} display={`${fmt(sp.state.mean, 1)} °F`} />
        <Slider
          label="Day-to-day swing"
          tone={WX.temperature}
          value={sp.state.swing}
          min={0}
          max={12}
          step={SWING_STEP}
          onChange={(v) => sp.set({ swing: v })}
          display={`±${fmt(sp.state.swing, 1)} °F`}
        />
        <Eq label={`Heating degree days counted day by day, ${fmt(idx.hdd)}, are at least 31 times the degree days of the monthly mean, ${fmt(idx.shortHdd)}`}>
          <span>Σ max(0, 65 − T</span>
          <Sub>day</Sub>
          <span>)</span>
          <Op>=</Op>
          <K tone={WX.index}>{fmt(idx.hdd)}</K>
          <Op>≥</Op>
          <span>31 × max(0, 65 − T</span>
          <Sub>month</Sub>
          <span>)</span>
          <Op>=</Op>
          <K tone={WX.index}>{fmt(idx.shortHdd)}</K>
        </Eq>
      </Figure>

      <P>
        At the starting {fmt(SPREAD_DEFAULTS.mean, 1)} °F, with days swinging about ±{fmt(SPREAD_DEFAULTS.swing, 1)} °F as a May’s do, the month collects{' '}
        {fmt(q.dflt.hdd)} heating degree days against the shortcut’s {fmt(q.dflt.shortHdd)}, and {fmt(q.dflt.cdd)} cooling degree days against none. Take the swing
        to zero and every day sits on the mean: then, and only then, do the two methods agree, at {fmt(q.flat.hdd)}. Any variety at all can only add degree days,
        never remove them. Mathematicians know this as Jensen’s inequality: for a function that bends upward, like this hinge, the average of the function is
        never less than the function of the average. Far below 65 °F, as in January, the hinge is rarely touched and the shortcut is nearly right; near the hinge, in spring and
        autumn, it fails badly.
      </P>

      <Challenge
        id="b"
        question={`Set the monthly mean to exactly 65 °F, where the shortcut says there is no heating or cooling to do. With the days swinging ±${SWING_HINT} °F around it, the month collects ${fmt(q.hint.hdd)} heating degree days, and with the mean on the hinge each cold day’s degree days grow in step with the swing. Predict first: what is the smallest swing, on the slider’s half-degree steps, that gives the month at least ${SWING_TARGET}? Then check.`}
        solved={solved2}
        status={
          sp.state.mean !== BASE_F
            ? `Set the monthly mean to 65 °F first; it’s at ${fmt(sp.state.mean, 1)} °F.`
            : idx.hdd < SWING_TARGET
              ? `At ±${fmt(sp.state.swing, 1)} °F the month collects ${fmt(idx.hdd, 1)} heating degree days.`
              : `At ±${fmt(sp.state.swing, 1)} °F it collects ${fmt(idx.hdd, 1)}. Would a smaller swing do?`
        }
        success={`Solved: ±${fmt(sp.state.swing, 1)} °F gives ${fmt(idx.hdd, 1)}. The degree days grow in proportion to the swing, so ${SWING_TARGET} needs ${SWING_HINT} × ${SWING_TARGET} ÷ ${fmt(q.hint.hdd)} ≈ ${fmt((SWING_HINT * SWING_TARGET) / q.hint.hdd, 1)} °F. The month also collects exactly as many cooling degree days, ${fmt(idx.cdd, 1)}, because with the mean on the hinge every degree of cold is matched by a degree of warmth. A forecaster who gets the month’s average exactly right but its variability wrong will still get its degree days wrong.`}
      />

      <P>
        That last point will matter a great deal. A contract that pays on a degree-day index is not a contract on the average temperature: its value depends on how
        the days are spread, not only on where they are centered, and most of all in the shoulder months. When <FigRef to="Degree Day Simulator · averaging">the
        swing</FigRef> grows, the index’s <K tone={WX.probability}>expected value</K> — its average over all the ways the month could turn out, each weighted by
        how likely it is — grows with it, even if the forecast mean doesn’t move. Chapter 5 will price contracts on these indices from
        the forecast distributions of Chapter 3, and it will have to count day by day.
      </P>
      <P>
        Degree days measure how much heating and cooling the weather calls for. They don’t say what that heating and cooling will cost. On a cold day the whole
        region reaches for gas at once — the furnaces of the city, and the power plants that keep its lights on — through a limited number of pipelines. The next
        lesson follows that demand into the gas and electricity markets, and shows why the price of energy can rise far faster than the temperature falls.
      </P>
    </LessonPage>
  );
}
