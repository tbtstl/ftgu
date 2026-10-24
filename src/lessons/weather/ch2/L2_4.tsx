import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  clamp,
  fmt,
  lessonHref,
  linePath,
  mix,
  niceDomain,
  niceTicks,
  scale,
  signed,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { ENSO_DEFAULTS, ensoHistory, ensoPeriod, ensoPhase, type EnsoParams } from '../../../engines/weather/enso';
import { expectedTemp, monthDays, ninoForecast, ninoMonth, tempF } from '../../../model/weather/archive';
import { MONTH_NAMES, STATIONS } from '../../../model/weather/region';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: the recharge oscillator, run for 40 years.

/** Months shown: 40 years. The run carries a year more so the last winter is complete. */
export const ENSO_MONTHS = 480;
/** The archive's seed: at the default settings the demonstration replays the archive's own Pacific. */
const SEED = 1997;
export const COUPLING_STEP = 0.005;

export interface PacificState {
  /** Net growth rate of an SST anomaly from the ocean–atmosphere feedback, per month. */
  coupling: number;
  /** Size of the random monthly weather kicks, °C. */
  noise: number;
  /** Multiplies how fast a warm east drains the equator's stored heat (and a cold one refills it). */
  recharge: number;
}

export const PACIFIC_DEFAULTS: PacificState = { coupling: ENSO_DEFAULTS.coupling, noise: ENSO_DEFAULTS.noise, recharge: 1 };

export function paramsOf(s: PacificState): EnsoParams {
  return { ...ENSO_DEFAULTS, coupling: s.coupling, noise: s.noise, alpha: ENSO_DEFAULTS.alpha * s.recharge };
}

/** The dominant eigenvalue's modulus of the linearized monthly map: above 1, a disturbance grows. */
export function growthPerMonth(p: EnsoParams): number {
  const a = 1 + p.coupling;
  const d = 1 - p.r;
  const tr = a + d;
  const det = a * d + p.gamma * p.alpha;
  const disc = (tr * tr) / 4 - det;
  if (disc < 0) return Math.sqrt(det);
  return Math.max(Math.abs(tr / 2 + Math.sqrt(disc)), Math.abs(tr / 2 - Math.sqrt(disc)));
}

export interface PacificRun {
  /** Niño-3.4 index, month by month, °C. */
  t: number[];
  /** Equatorial heat content (thermocline) anomaly, month by month. */
  h: number[];
  /** Winter (December–February) mean index for each of the 40 winters, °C. */
  winters: number[];
  sd: number;
  elNino: number;
  laNina: number;
}

export function pacificRun(s: PacificState): PacificRun {
  const hist = ensoHistory(ENSO_MONTHS + 12, paramsOf(s), SEED);
  const t = hist.map((x) => x.t);
  const h = hist.map((x) => x.h);
  const winters: number[] = [];
  for (let y = 1; y <= 40; y++) winters.push((t[(y - 1) * 12 + 11] + t[y * 12] + t[y * 12 + 1]) / 3);
  const shown = t.slice(0, ENSO_MONTHS);
  const mean = shown.reduce((a, b) => a + b, 0) / shown.length;
  const sd = Math.sqrt(shown.reduce((a, b) => a + (b - mean) ** 2, 0) / shown.length);
  return { t, h, winters, sd, elNino: winters.filter((w) => w >= 0.5).length, laNina: winters.filter((w) => w <= -0.5).length };
}

/**
 * The first challenge: with the recharge at its starting speed, the weakest coupling (on the
 * slider's steps) at which a disturbance grows instead of dying away. The threshold is 0.0217 per
 * month, so the answer is +0.025.
 */
export function thresholdSolved(s: PacificState): boolean {
  if (Math.abs(s.recharge - 1) > 1e-9) return false;
  const grows = (c: number) => growthPerMonth({ ...paramsOf(s), coupling: c }) > 1;
  return grows(s.coupling) && !grows(s.coupling - COUPLING_STEP);
}

// ---------------------------------------------------------------------------
// The second demonstration: 40 simulated winters at Calder Bay.

export interface Winter {
  /** The winter that starts in December of this year. */
  year: number;
  /** December–February mean Niño-3.4, as it turned out, °C. */
  nino: number;
  /** The same, as forecast at the end of October, °C. */
  forecast: number;
  /** Calder Bay's December–February temperature anomaly with no ENSO influence (the weather alone), °F. */
  weather: number;
  /** The anomaly added per °F/°C of teleconnection strength (the winter's mean Niño-3.4, weighted by month). */
  ensoUnit: number;
}

let wintersCache: Winter[] | null = null;

/** The archive's 40 winters at Calder Bay, split into the weather's part and ENSO's. */
export function calderWinters(): Winter[] {
  if (wintersCache) return wintersCache;
  const out: Winter[] = [];
  for (let y = 1; y <= 40; y++) {
    let weather = 0;
    let unit = 0;
    let n = 0;
    for (const [yy, mm] of [
      [y, 11],
      [y + 1, 0],
      [y + 1, 1],
    ]) {
      const { start, days } = monthDays(yy, mm);
      for (let i = 0; i < days; i++) {
        const t0 = tempF('calder', start + i, { ensoF: 0 });
        weather += t0 - expectedTemp('calder', start + i);
        unit += tempF('calder', start + i, { ensoF: 1 }) - t0;
        n++;
      }
    }
    out.push({
      year: y,
      nino: (ninoMonth(y, 11) + ninoMonth(y + 1, 0) + ninoMonth(y + 1, 1)) / 3,
      forecast: (ninoForecast(y, 9, 2) + ninoForecast(y, 9, 3) + ninoForecast(y, 9, 4)) / 3,
      weather: weather / n,
      ensoUnit: unit / n,
    });
  }
  wintersCache = out;
  return out;
}

/** A winter's temperature anomaly at a given teleconnection strength, °F. */
export function anomaly(w: Winter, ensoF: number): number {
  return w.weather + ensoF * w.ensoUnit;
}

export interface Teleconnection {
  slope: number;
  r: number;
  elNinoMean: number;
  laNinaMean: number;
  warmestLaNina: number;
  coldestElNino: number;
  elNinoMild: number;
  laNinaCold: number;
  elNinoCount: number;
  laNinaCount: number;
}

/** Regression of the winters' anomalies on Niño-3.4 (as it turned out, or as forecast), and the phases' averages. */
export function teleconnection(ensoF: number, useForecast = false): Teleconnection {
  const ws = calderWinters();
  const xs = ws.map((w) => (useForecast ? w.forecast : w.nino));
  const ys = ws.map((w) => anomaly(w, ensoF));
  const n = ws.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const en = ws.map((w, i) => ({ w, y: ys[i] })).filter((p) => p.w.nino >= 0.5);
  const ln = ws.map((w, i) => ({ w, y: ys[i] })).filter((p) => p.w.nino <= -0.5);
  const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  return {
    slope: sxy / sxx,
    r: sxy / Math.sqrt(sxx * syy),
    elNinoMean: avg(en.map((p) => p.y)),
    laNinaMean: avg(ln.map((p) => p.y)),
    warmestLaNina: Math.max(...ln.map((p) => p.y)),
    coldestElNino: Math.min(...en.map((p) => p.y)),
    elNinoMild: en.filter((p) => p.y > 0).length,
    laNinaCold: ln.filter((p) => p.y < 0).length,
    elNinoCount: en.length,
    laNinaCount: ln.length,
  };
}

export const ENSO_F_STEP = 0.1;
/**
 * The second challenge: the weakest teleconnection (on the slider's 0.1 steps) at which every
 * La Niña winter in the archive comes out colder than normal. It's 1.8 °F per °C.
 */
export function laNinaSolved(ensoF: number): boolean {
  const f = Math.round(ensoF * 10) / 10;
  return teleconnection(f).warmestLaNina < 0 && teleconnection(Math.round((f - ENSO_F_STEP) * 10) / 10).warmestLaNina >= 0;
}

// ---------------------------------------------------------------------------
// Drawing: the equatorial Pacific in cross-section.

const BX0 = 44;
const BX1 = 600;
const SURF = 86;
const PX_PER_M = 0.75;
/** Niño-3.4 spans 170°W–120°W of a basin drawn from 120°E to 80°W. */
const NINO_BOX = [0.4375, 0.75];

/** Thermocline depths (m) drawn from the model's two numbers: the heat content sets the mean, the SST anomaly the tilt. */
export function thermocline(t: number, h: number): { west: number; east: number; trades: number } {
  const mean = 100 + 25 * h;
  const tilt = clamp(100 - 45 * t, -20, 200);
  return { west: clamp(mean + tilt / 2, 40, 230), east: clamp(mean - tilt / 2, 8, 200), trades: clamp(1 - 0.45 * t, -0.5, 1.9) };
}

function PacificSection({ t, h, label }: { t: number; h: number; label: string }) {
  const th = thermocline(t, h);
  const depthAt = (f: number) => th.west + (th.east - th.west) * (3 * f * f - 2 * f * f * f);
  const xs = Array.from({ length: 41 }, (_, i) => i / 40);
  const yLine = xs.map((f) => SURF + depthAt(f) * PX_PER_M);
  const xPix = xs.map((f) => BX0 + f * (BX1 - BX0));
  const warmPath = `M${BX0} ${SURF} L${BX1} ${SURF} ` + xs.map((_, i) => `L${xPix[40 - i].toFixed(1)} ${yLine[40 - i].toFixed(1)}`).join(' ') + ' Z';
  const eastColor = mix('#7fb1d8', '#e2725f', clamp(0.45 + 0.25 * t, 0, 1));
  const cloudF = clamp(0.12 + 0.2 * t, 0.06, 0.72);
  const cx = BX0 + cloudF * (BX1 - BX0);
  const arrows = [0.2, 0.42, 0.64, 0.86];
  const len = 46 * Math.abs(th.trades);
  const westward = th.trades >= 0;
  const gradId = 'pac-warm';
  return (
    <svg className="diagram" viewBox="0 0 640 270" role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#e2725f" />
          <stop offset="0.45" stopColor={mix('#e2725f', eastColor, 0.4)} />
          <stop offset="1" stopColor={eastColor} />
        </linearGradient>
      </defs>
      {/* Deep cold water, then the warm layer above the thermocline. */}
      <rect x={BX0} y={SURF} width={BX1 - BX0} height={250 - SURF} fill={tint('#4b7bb0', 0.35)} />
      <path d={warmPath} fill={`url(#${gradId})`} opacity={0.55} />
      <path d={linePath(xPix, yLine)} fill="none" stroke="#3d5f86" strokeWidth={2} />
      <text x={BX0 + 0.55 * (BX1 - BX0)} y={yLine[22] + 16} className="ax" style={{ fill: '#3d5f86' }}>
        thermocline
      </text>
      <line x1={BX0} x2={BX1} y1={SURF} y2={SURF} stroke="#5d7f9c" strokeWidth={1.5} />
      {/* The Niño-3.4 region. */}
      <rect
        x={BX0 + NINO_BOX[0] * (BX1 - BX0)}
        y={SURF - 2}
        width={(NINO_BOX[1] - NINO_BOX[0]) * (BX1 - BX0)}
        height={18}
        fill="none"
        stroke="#333"
        strokeDasharray="4 3"
      />
      <text x={BX0 + ((NINO_BOX[0] + NINO_BOX[1]) / 2) * (BX1 - BX0)} y={SURF + 30} textAnchor="middle" className="ax" style={{ fill: '#333' }}>
        Niño-3.4 · {signed(t, 1)} °C
      </text>
      {/* Rising air and rain clouds over the warmest water. */}
      <g aria-hidden="true">
        {[-14, 0, 14, -6, 8].map((dx, i) => (
          <circle key={i} cx={cx + dx} cy={i < 3 ? 26 : 16} r={i < 3 ? 12 : 10} fill="#e9ecef" stroke="#cfd4da" />
        ))}
        {[-10, 0, 10].map((dx) => (
          <line key={dx} x1={cx + dx} x2={cx + dx - 4} y1={42} y2={SURF - 8} stroke={GRAPHIC.teal} strokeWidth={1.2} strokeDasharray="3 4" />
        ))}
      </g>
      {/* Surface winds along the equator. */}
      {arrows.map((f) => {
        const x = BX0 + f * (BX1 - BX0);
        if (len < 4) return <circle key={f} cx={x} cy={62} r={2} fill={GRAPHIC.violet} />;
        const x2 = westward ? x - len / 2 : x + len / 2;
        const x1 = westward ? x + len / 2 : x - len / 2;
        const dir = westward ? -1 : 1;
        return (
          <g key={f}>
            <line x1={x1} x2={x2 - dir * 6} y1={62} y2={62} stroke={GRAPHIC.violet} strokeWidth={2.5} strokeLinecap="round" />
            <polygon points={`${x2},62 ${x2 - dir * 9},57 ${x2 - dir * 9},67`} fill={GRAPHIC.violet} />
          </g>
        );
      })}
      <text x={BX1} y={50} textAnchor="end" className="ax" style={{ fill: TEXT.violet }}>
        {westward ? `trade winds · ${fmt(th.trades * 100)}% of normal` : 'winds from the west'}
      </text>
      <text x={BX0} y={264} className="ax">
        Asia and Australia
      </text>
      <text x={BX1} y={264} textAnchor="end" className="ax">
        South America
      </text>
      {[0, 100, 200].map((m) => (
        <text key={m} x={BX1 + 6} y={SURF + m * PX_PER_M + 4} className="ax">
          {m} m
        </text>
      ))}
    </svg>
  );
}

// The Niño-3.4 time series.
const TX0 = 52;
const TX1 = 620;
const TX = scale(0, ENSO_MONTHS, TX0, TX1);

function IndexChart({ run, month, onScrub }: { run: PacificRun; month: number; onScrub: (m: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const shown = run.t.slice(0, ENSO_MONTHS);
  const [lo, hi] = niceDomain(Math.min(-2.5, ...shown), Math.max(2.5, ...shown), 4);
  const y = scale(lo, hi, 150, 18);
  const xs = shown.map((_, i) => TX(i + 0.5));
  const at = (e: PointerEvent<SVGSVGElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const vx = ((e.clientX - box.left) / box.width) * 640;
    onScrub(clamp(Math.floor(((vx - TX0) / (TX1 - TX0)) * ENSO_MONTHS), 0, ENSO_MONTHS - 1));
  };
  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'PageUp' ? 12 : e.key === 'PageDown' ? -12 : 0;
    if (step) {
      e.preventDefault();
      onScrub(clamp(month + step, 0, ENSO_MONTHS - 1));
    }
  };
  const cur = shown[month];
  return (
    <svg
      ref={ref}
      className="chart"
      viewBox="0 0 640 176"
      role="slider"
      tabIndex={0}
      aria-label="Niño-3.4 index over 40 simulated years; choose a month"
      aria-valuemin={1}
      aria-valuemax={ENSO_MONTHS}
      aria-valuenow={month + 1}
      aria-valuetext={`Year ${Math.floor(month / 12) + 1}, ${MONTH_NAMES[month % 12]}: Niño-3.4 ${signed(cur, 1)} °C, ${ensoPhase(cur)}. Over the 40 years the index's standard deviation is ${fmt(run.sd, 2)} °C, with ${run.elNino} El Niño and ${run.laNina} La Niña winters.`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        at(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons) at(e);
      }}
      onKeyDown={key}
      style={{ cursor: 'pointer', touchAction: 'none' }}
    >
      <text className="ax" x={TX0} y={10}>
        Niño-3.4 index, °C
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={TX0} x1={TX1} format={(v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0')} baseline={0} />
      {shown.map((v, i) =>
        v >= 0.5 ? (
          <rect key={i} x={TX(i)} y={y(v)} width={TX(1) - TX(0) + 0.3} height={y(0.5) - y(v)} fill={GRAPHIC.red} opacity={0.35} />
        ) : v <= -0.5 ? (
          <rect key={i} x={TX(i)} y={y(-0.5)} width={TX(1) - TX(0) + 0.3} height={y(v) - y(-0.5)} fill={GRAPHIC.blue} opacity={0.35} />
        ) : null,
      )}
      {[0.5, -0.5].map((v) => (
        <line key={v} x1={TX0} x2={TX1} y1={y(v)} y2={y(v)} stroke="#9a9a9a" strokeDasharray="4 4" />
      ))}
      <path d={linePath(xs, shown.map(y))} fill="none" stroke="#333" strokeWidth={1.5} strokeLinejoin="round" />
      <line className="cur" x1={TX(month + 0.5)} x2={TX(month + 0.5)} y1={18} y2={150} />
      <circle cx={TX(month + 0.5)} cy={y(cur)} r={4.5} fill={cur >= 0.5 ? GRAPHIC.red : cur <= -0.5 ? GRAPHIC.blue : '#333'} stroke="#fcfcfb" strokeWidth={1.5} />
      {[0, 5, 10, 15, 20, 25, 30, 35, 40].map((yr) => (
        <text key={yr} className="ax ax-m" x={TX(yr * 12)} y={168}>
          {yr === 0 ? 'year 1' : yr}
        </text>
      ))}
    </svg>
  );
}

// The teleconnection scatter.
const SX = scale(-2.5, 2.5, 64, 616);
const SY = scale(-8, 8, 262, 22);

function WinterScatter({ ensoF, useForecast, stats }: { ensoF: number; useForecast: boolean; stats: Teleconnection }) {
  const ws = calderWinters();
  const ys = ws.map((w) => anomaly(w, ensoF));
  const xs = ws.map((w) => (useForecast ? w.forecast : w.nino));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const line = (x: number) => my + stats.slope * (x - mx);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Forty simulated winters at Calder Bay: December–February temperature anomaly against Niño-3.4 ${useForecast ? 'as forecast at the end of October' : 'as it turned out'}, with a teleconnection of ${fmt(ensoF, 1)} °F per °C. The fitted slope is ${fmt(stats.slope, 2)} °F per °C and the correlation ${fmt(stats.r, 2)}. El Niño winters average ${signed(stats.elNinoMean, 1)} °F, La Niña winters ${signed(stats.laNinaMean, 1)} °F.`}
    >
      <text className="ax" x={64} y={12}>
        Calder Bay’s winter, °F from normal
      </text>
      <rect x={SX(0.5)} y={22} width={SX(2.5) - SX(0.5)} height={240} fill={GRAPHIC.red} opacity={0.06} />
      <rect x={SX(-2.5)} y={22} width={SX(-0.5) - SX(-2.5)} height={240} fill={GRAPHIC.blue} opacity={0.07} />
      <GridY y={SY} ticks={[-8, -4, 0, 4, 8]} x0={64} x1={616} format={(v) => (v > 0 ? `+${v}°` : v < 0 ? `−${-v}°` : '0')} baseline={0} />
      <line x1={SX(0)} x2={SX(0)} y1={22} y2={262} className="base" />
      <path d={linePath([SX(-2.5), SX(2.5)], [SY(line(-2.5)), SY(line(2.5))])} fill="none" stroke="#333" strokeWidth={1.8} strokeDasharray="7 5" />
      {ws.map((w, i) => {
        const x = SX(clamp(xs[i], -2.45, 2.45));
        const yv = SY(clamp(ys[i], -7.9, 7.9));
        const ph = ensoPhase(w.nino);
        if (ph === 'El Niño') return <circle key={w.year} cx={x} cy={yv} r={5.5} fill={GRAPHIC.red} stroke="#fcfcfb" strokeWidth={1.2} />;
        if (ph === 'La Niña') return <rect key={w.year} x={x - 5} y={yv - 5} width={10} height={10} fill={GRAPHIC.blue} stroke="#fcfcfb" strokeWidth={1.2} />;
        return <circle key={w.year} cx={x} cy={yv} r={4} fill="none" stroke="#8a8a8a" strokeWidth={1.5} />;
      })}
      {[-2, -1, 0, 1, 2].map((v) => (
        <text key={v} className="ax ax-m" x={SX(v)} y={280}>
          {v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'}
        </text>
      ))}
      <text className="ax ax-e" x={616} y={296}>
        winter Niño-3.4, °C · {useForecast ? 'as forecast on November 1' : 'as it turned out'}
      </text>
      <text className="ax" x={SX(0.5) + 6} y={36} style={{ fill: TEXT.red }}>
        El Niño
      </text>
      <text className="ax ax-e" x={SX(-0.5) - 6} y={36} style={{ fill: TEXT.blue }}>
        La Niña
      </text>
    </svg>
  );
}

const MONTHS_PER_SECOND = 8;

export default function Lesson() {
  const s = useScenario('pacific', PACIFIC_DEFAULTS);
  const st = s.state;
  const run = useMemo(() => pacificRun(st), [st]);
  const params = paramsOf(st);
  const per = ensoPeriod(params);
  const growth = growthPerMonth(params);
  const solved = thresholdSolved(st);

  const play = usePlay(true);
  const [month, setMonth] = useState(0);
  useAnimationFrame((dt) => setMonth((m) => (m + dt * MONTHS_PER_SECOND) % ENSO_MONTHS), play.playing);
  const m = Math.floor(month);
  const tNow = run.t[m];
  const hNow = run.h[m];
  const th = thermocline(tNow, hNow);
  const scrub = (v: number) => {
    play.setPlaying(false);
    setMonth(v);
  };

  const g = useScenario('teleconnection', { ensoF: STATIONS.calder.ensoF ?? 1, view: 'actual' as 'actual' | 'forecast' });
  const ensoF = Math.round(g.state.ensoF * 10) / 10;
  const useForecast = g.state.view === 'forecast';
  const stats = useMemo(() => teleconnection(ensoF, useForecast), [ensoF, useForecast]);
  const actual = useMemo(() => teleconnection(ensoF), [ensoF]);
  const solved2 = laNinaSolved(ensoF);

  // Numbers the prose quotes, from the same models.
  const base = useMemo(() => pacificRun(PACIFIC_DEFAULTS), []);
  const basePer = ensoPeriod(ENSO_DEFAULTS);
  const calder = useMemo(() => teleconnection(1), []);
  const none = useMemo(() => teleconnection(0), []);
  const fromOctober = useMemo(() => teleconnection(1, true), []);
  const ws = calderWinters();
  const fcSkill = useMemo(() => {
    const a = ws.map((w) => w.nino);
    const f = ws.map((w) => w.forecast);
    const ma = a.reduce((p, q) => p + q, 0) / a.length;
    const mf = f.reduce((p, q) => p + q, 0) / f.length;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    a.forEach((v, i) => {
      sxy += (v - ma) * (f[i] - mf);
      sxx += (f[i] - mf) ** 2;
      syy += (v - ma) ** 2;
    });
    const ph = (x: number) => (x >= 0.5 ? 1 : x <= -0.5 ? -1 : 0);
    return { r: sxy / Math.sqrt(sxx * syy), hits: a.filter((v, i) => ph(v) === ph(f[i])).length };
  }, [ws]);
  const thresholdC = growthAtThreshold();

  const growthText =
    growth > 1
      ? `grows, doubling every ${fmt(doublingYears(growth), doublingYears(growth) < 10 ? 1 : 0)} years`
      : `dies out, shrinking by a factor of e every ${fmt(-1 / Math.log(growth) / 12, 1)} years`;

  return (
    <LessonPage id="weather/2.4">
      <P>
        The fronts and storms of <a href={lessonHref('weather/2.2')}>Lessons 2.2</a> and <a href={lessonHref('weather/2.3')}>2.3</a> come and go in hours or
        days. Some of what makes one winter differ from the next works far more slowly, and most of it comes from the ocean. Water stores heat far better than
        air: the top few meters of the sea can hold as much heat as the whole atmosphere above them. So a patch of unusually warm ocean doesn’t vanish in a week. It
        lingers for months, warming the air that passes over it, and the atmosphere responds to it the whole time. The ocean is the climate system’s memory.
      </P>
      <P>
        The most important example is in the equatorial Pacific. The trade winds of <a href={lessonHref('weather/2.1')}>Lesson 2.1</a> blow from east to west
        along the equator and drag the sun-warmed surface water with them, piling it up in a deep pool off Asia and Australia. Underneath, the boundary between the
        warm surface layer and the cold water below — the <b>thermocline</b> — tilts: it lies well over 100 meters down in the west but only a few tens of
        meters down in the east, where cold water wells up to the surface near South America. Over the warm west the air rises, the pressure is low and the rain is
        heavy; over the cool east the air sinks and the pressure is higher. That pressure difference along the equator helps drive the trade winds in the first
        place.
      </P>
      <P>
        That loop can run away. If the eastern Pacific warms a little, the east–west contrast weakens, so the trade winds weaken, so less cold water wells up and the
        warm pool sloshes east, so the east warms further. This positive feedback is named for Jacob Bjerknes, who described it in 1969. Something else turns it
        around. While the east is warm, heat drains away from the equatorial band toward higher latitudes, the thermocline rises everywhere along the equator, and
        eventually colder water reaches the surface: the warm phase sets up its own end, and the cold phase that follows refills the store. Fei-Fei Jin called this
        a <b>recharge oscillator</b> in 1997. The warm phase is <K tone={WX.temperature}>El Niño</K>, the cold phase La Niña, and the whole cycle, with its swings
        in the atmosphere’s pressure, is the El Niño–Southern Oscillation, or ENSO.
      </P>
      <P>
        Its pulse is measured by the <b>Niño-3.4 index</b>: the sea-surface temperature’s departure from normal in a box straddling the equator in the east-central
        Pacific. The next demonstration runs a recharge oscillator for 40 years, one month at a time. It tracks just two numbers, the index and the heat stored along
        the equator, and the cross-section draws the Pacific from them. Random weather — bursts of wind that no ocean model can foresee — kicks the index every
        month. Change how strongly the ocean and atmosphere feed back on each other, how big the kicks are, and how fast the heat drains and recharges, and scrub
        the timeline with the pointer or the arrow keys:
      </P>

      <Figure name="Ocean-Atmosphere Model" scenario={s} play={play}>
        <PacificSection
          t={tNow}
          h={hNow}
          label={`The equatorial Pacific in year ${Math.floor(m / 12) + 1}, ${MONTH_NAMES[m % 12]}: Niño-3.4 at ${signed(tNow, 1)} °C, ${ensoPhase(tNow)}. The thermocline lies about ${fmt(th.west)} m deep in the west and ${fmt(th.east)} m in the east, and the trade winds blow at ${fmt(th.trades * 100)}% of their normal strength.`}
        />
        <IndexChart run={run} month={m} onScrub={scrub} />
        <Legend
          items={[
            { label: 'El Niño, +0.5 °C or more', color: tint(GRAPHIC.red, 0.5) },
            { label: 'La Niña, −0.5 °C or less', color: tint(GRAPHIC.blue, 0.5) },
            { label: 'Trade winds', color: GRAPHIC.violet, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: `year ${Math.floor(m / 12) + 1}, ${MONTH_NAMES[m % 12]}`, value: `${signed(tNow, 1)} °C`, tone: WX.temperature },
            { label: 'natural period', value: per.periodMonths !== null ? `${fmt(per.periodMonths / 12, 1)} years` : 'none' },
            {
              label: growth > 1 ? `a disturbance doubles every ${fmt(doublingYears(growth), doublingYears(growth) < 10 ? 1 : 0)} years` : `a disturbance shrinks by e every ${fmt(-1 / Math.log(growth) / 12, 1)} years`,
              value: growth > 1 ? 'grows' : 'fades',
              tone: growth > 1 ? 'red' : 'ink',
            },
            { label: 'spread of the index', value: `±${fmt(run.sd, 2)} °C` },
            { label: 'El Niño / La Niña winters of 40', value: `${run.elNino} / ${run.laNina}` },
          ]}
        />
        <Slider
          label="Ocean–atmosphere coupling"
          tone={WX.temperature}
          value={st.coupling}
          min={-0.1}
          max={0.08}
          step={COUPLING_STEP}
          onChange={(v) => s.set({ coupling: Math.round(v * 1000) / 1000 })}
          display={`${signed(st.coupling, 3)} per month`}
        />
        <Slider label="Weather kicks" tone={WX.wind} value={st.noise} min={0.02} max={0.5} step={0.02} onChange={(v) => s.set({ noise: Math.round(v * 100) / 100 })} display={`${fmt(st.noise, 2)} °C a month`} />
        <Slider label="Speed of recharge and drain" value={st.recharge} min={0.5} max={2} step={0.1} onChange={(v) => s.set({ recharge: Math.round(v * 10) / 10 })} display={`× ${fmt(st.recharge, 1)}`} />
      </Figure>

      <P>
        At the starting settings the coupling is negative: the feedback is weaker than the damping, so on its own any disturbance would die away, shrinking by a
        factor of e every {fmt((basePer.decayMonths ?? 0) / 12, 1)} years while swinging with a natural period of {fmt((basePer.periodMonths ?? 0) / 12, 1)} years.
        It keeps going only because the weather keeps kicking it. That is why the record looks irregular rather than like a clean wave: over 40 years it holds{' '}
        {base.elNino} El Niño winters and {base.laNina} La Niña winters, some strong, some barely over the line, and the index swings with a standard deviation of{' '}
        {fmt(base.sd, 2)} °C. The real index behaves much the same way. El Niños recur every two to seven years, never on a schedule, and the strongest on record
        have pushed the index past +2 °C. NOAA calls an episode El Niño once the index, averaged over three months, stays at +0.5 °C or more for several seasons in
        a row; we’ll simply call a winter El Niño or La Niña when its December–February average crosses ±0.5 °C. (The simulated Pacific in this demonstration is the
        one behind the course’s weather archive. Like every number in the archive, it is simulated, not observed.)
      </P>
      <P>
        Watch the cross-section as the timeline plays. As an El Niño builds, the trade winds slacken, the thermocline flattens and the rain clouds drift east
        with the warm water. Turn the kicks down and the index fades, because the oscillation is damped. Speed up the recharge and drain, and the cycle quickens:
        the period depends on how fast the heat store responds.
      </P>

      <Challenge
        id="a"
        question="Keep the recharge at × 1.0. What’s the weakest coupling at which a disturbance grows instead of dying out, so the Pacific would keep oscillating even without the weather’s kicks?"
        solved={solved}
        status={
          Math.abs(st.recharge - 1) > 1e-9
            ? 'Set the speed of recharge and drain back to × 1.0 first.'
            : `At ${signed(st.coupling, 3)} per month, a disturbance ${growthText}.`
        }
        success={`Solved. Between +0.020 and +0.025 per month (at +${fmt(thresholdC, 4)}), the feedback starts to outrun the damping. Just past the line the growth is glacial — at +0.025 a disturbance doubles only every ${fmt(Math.log(2) / Math.log(growthPerMonth({ ...ENSO_DEFAULTS, coupling: 0.025 })) / 12)} years — and further out the cubic damping in the model caps the swings, so the oscillation becomes bigger and more regular. Researchers still debate which side of this line the real Pacific sits on.`}
      />

      <H2>Teleconnections</H2>
      <P>
        ENSO matters far from the Pacific because the rain moves. The towering clouds over the warmest water heat the atmosphere above them with the latent heat of{' '}
        <a href={lessonHref('weather/1.3')}>Lesson 1.3</a>. When El Niño shifts them east, it shifts where the tropics heat the upper atmosphere, and that bends
        the jet streams and storm tracks thousands of kilometers away. Links like this are called <b>teleconnections</b>. Across the northern United States,
        El Niño winters tend to run milder than normal, and La Niña winters colder.
      </P>
      <P>
        Our region is built to behave the same way: each degree of Niño-3.4 adds {fmt(STATIONS.calder.ensoF ?? 1, 1)} °F to Calder Bay’s winter. From here on we’ll
        quote the region’s station temperatures in degrees Fahrenheit, as the weather contracts later in the course count them; a degree Fahrenheit is 5/9 of a
        degree Celsius, so 1 °F is about 0.56 °C. The next demonstration plots the archive’s 40 winters at Calder Bay: each point is one December–February, placed
        by its Niño-3.4 index and by how much warmer or colder than normal the city was. El Niño winters are red circles and La Niña winters blue squares. Change the
        strength of the teleconnection — the same 40 winters of weather, reshaped by a stronger or weaker link:
      </P>

      <Figure name="Ocean-Atmosphere Model · teleconnection" scenario={g}>
        <Segmented
          label="Which Niño-3.4"
          value={g.state.view}
          onChange={(v) => g.set({ view: v })}
          options={[
            { value: 'actual', label: 'As it turned out' },
            { value: 'forecast', label: 'As forecast on November 1' },
          ]}
        />
        <WinterScatter ensoF={ensoF} useForecast={useForecast} stats={stats} />
        <Legend
          items={[
            { label: 'El Niño winter', color: GRAPHIC.red },
            { label: 'La Niña winter', color: GRAPHIC.blue },
            { label: 'Fitted line', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'slope of the fitted line', value: `${fmt(stats.slope, 2)} °F per °C`, tone: WX.temperature },
            { label: 'correlation', value: fmt(stats.r, 2) },
            { label: 'average El Niño winter', value: `${signed(actual.elNinoMean, 1)} °F`, tone: 'red' },
            { label: 'average La Niña winter', value: `${signed(actual.laNinaMean, 1)} °F`, tone: 'blue' },
          ]}
        />
        <Slider
          label="Teleconnection strength"
          tone={WX.temperature}
          value={ensoF}
          min={0}
          max={3}
          step={ENSO_F_STEP}
          onChange={(v) => g.set({ ensoF: Math.round(v * 10) / 10 })}
          display={`${fmt(ensoF, 1)} °F per °C`}
        />
      </Figure>

      <P>
        At Calder Bay’s own strength, El Niño winters average {signed(calder.elNinoMean, 1)} °F and La Niña winters {signed(calder.laNinaMean, 1)} °F — a gap of
        about {fmt(calder.elNinoMean - calder.laNinaMean, 1)} °F, or {fmt(((calder.elNinoMean - calder.laNinaMean) * 5) / 9, 1)} °C, over a whole season. The
        correlation is {fmt(calder.r, 2)}. But the scatter is wide. {calder.elNinoMild} of the {calder.elNinoCount} El Niño winters were milder than normal and{' '}
        {calder.laNinaCold} of the {calder.laNinaCount} La Niña winters colder; the coldest El Niño winter came in {fmt(-calder.coldestElNino, 1)} °F below normal,
        and the warmest La Niña winter {fmt(calder.warmestLaNina, 1)} °F above. The fronts and storms of the last two lessons still decide most of a winter. ENSO
        tilts the odds.
      </P>
      <P>
        Notice, too, that the fitted slope, {fmt(calder.slope, 2)} °F per °C, is steeper than the {fmt(STATIONS.calder.ensoF ?? 1, 1)} °F per °C that the model
        actually adds. Slide the strength to zero: with no link at all, these same 40 winters still show a slope of {fmt(none.slope, 2)} and a correlation of{' '}
        {fmt(none.r, 2)}, because by chance a few of the La Niña winters also had cold weather. Forty winters is not many. Any estimate of a teleconnection, or of
        anything else about a whole season, carries that kind of sampling error, and we’ll meet it again when we start pricing contracts on seasons.
      </P>

      <Challenge
        id="b"
        question="How strong would the teleconnection have to be for every La Niña winter in the archive to come out colder than normal?"
        solved={solved2}
        status={`At ${fmt(ensoF, 1)} °F per °C, the warmest La Niña winter is ${actual.warmestLaNina >= 0 ? `${fmt(actual.warmestLaNina, 2)} °F above` : `${fmt(-actual.warmestLaNina, 2)} °F below`} normal.${actual.warmestLaNina < 0 ? ' Could a weaker link do it?' : ''}`}
        success={`Solved. It takes ${fmt(ensoF, 1)} °F per °C, almost twice Calder Bay’s own ${fmt(STATIONS.calder.ensoF ?? 1, 1)} — and even then the warmest La Niña winter is only ${fmt(-actual.warmestLaNina, 2)} °F below normal. For ENSO to decide the sign of every season, the link has to be strong enough to beat the winter’s own weather, which in this archive has a standard deviation of about ${fmt(weatherSd(), 1)} °F from one winter to the next.`}
      />

      <H2>Predictable months ahead</H2>
      <P>
        What makes ENSO valuable is not how strong it is but how early it can be seen. A daily weather forecast, as Chapter 3 will show, knows almost nothing about
        the weather more than two weeks away. But the Pacific’s heat content moves slowly, so by autumn the coming winter’s ENSO state is largely set. Switch{' '}
        <FigRef to="Ocean-Atmosphere Model · teleconnection">the scatter</FigRef> to the forecast made on November 1 — the oscillator’s own projection from the
        state at the end of October, with no knowledge of the kicks still to come. Its forecasts of the winter index correlate {fmt(fcSkill.r, 2)} with what
        happened, and they put {fcSkill.hits} of the 40 winters in the right phase. Calder Bay’s winters correlate {fmt(fromOctober.r, 2)} with the forecast,
        almost as well as the {fmt(calder.r, 2)} with the index as it turned out.
      </P>
      <P>
        That makes ENSO the largest single source of skill in seasonal forecasting. A forecaster who reads it in October knows which way the coming winter’s odds
        lean, months before any weather model can say anything about a particular cold snap. Anyone who prices a winter as if every winter were alike is ignoring
        that information — and in Chapter 5 we’ll ask whether a market for winter weather does, and what it would be worth to someone who doesn’t.
      </P>
      <P>
        ENSO is one reason a place’s weather differs from one year to the next. The next lesson turns to the differences that stay put: why Calder Bay on the coast,
        Marlow on the plains and Hollin Ridge in the hills have different climates, and how a station’s weather varies with the season.
      </P>
    </LessonPage>
  );
}

/** Years for a growing disturbance to double. */
function doublingYears(growthPerMonthValue: number): number {
  return Math.log(2) / Math.log(growthPerMonthValue) / 12;
}

/** The coupling at which the starting oscillator turns from damped to growing, per month. */
function growthAtThreshold(): number {
  let lo = -0.1;
  let hi = 0.1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (growthPerMonth({ ...ENSO_DEFAULTS, coupling: mid }) > 1) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Standard deviation of Calder Bay's winter anomaly from the weather alone, °F. */
function weatherSd(): number {
  const ws = calderWinters();
  const m = ws.reduce((a, w) => a + w.weather, 0) / ws.length;
  return Math.sqrt(ws.reduce((a, w) => a + (w.weather - m) ** 2, 0) / ws.length);
}
