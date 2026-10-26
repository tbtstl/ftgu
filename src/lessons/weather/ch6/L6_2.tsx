import { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import {
  Button,
  Challenge,
  DataTable,
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
  Swatch,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  signed,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { FORECASTER_LABEL, PERSISTENCE, dayForecasts, scoreMonth, type ForecasterId, type YourForecaster } from '../../../engines/weather/competition';
import { crpsNormal, pit } from '../../../engines/weather/verify';
import { dayInfo, knownShare, monthDays } from '../../../model/weather/archive';
import { MONTH_DAYS, MONTH_NAMES } from '../../../model/weather/region';
import {
  FORECASTER_DEFAULTS,
  REGION_DEFAULTS,
  confirmResetPart,
  isFenwick,
  regionKnobs,
  updateCapstone,
  useWeatherCapstone,
  type ForecasterSettings,
  type RegionSettings,
} from '../shared/capstone';
import { CapstoneStrip } from '../shared/CapstoneStrip';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The competition's pieces.

type Dist = { mean: number; sd: number };
type BaseId = Exclude<ForecasterId, 'yours'>;
const BASE_IDS: BaseId[] = ['climate', 'persistence', 'raw', 'model'];
export const IDS: ForecasterId[] = [...BASE_IDS, 'yours'];

export type MonthKey = 'dec' | 'jan' | 'feb';
export const MONTH_OF: Record<MonthKey, number> = { dec: 11, jan: 0, feb: 1 };

/** Winters scored in the second demonstration: years 2–40, as in the rest of the capstone. */
export const SEASON_YEARS = Array.from({ length: 39 }, (_, i) => i + 2);
export const MAX_LEAD = 15;
/** The second challenge's skill threshold. */
export const SKILL_TARGET = 0.15;
/** The first challenge's month: January of year 20, five days ahead. */
export const CHALLENGE_MONTH = { year: 20, month: 'jan' as MonthKey, lead: 5 };

const COLOR: Record<ForecasterId, string> = {
  climate: '#9a9a9a',
  persistence: GRAPHIC.orange,
  raw: GRAPHIC.violet,
  model: '#444444',
  yours: GRAPHIC.blue,
};

/**
 * Your forecaster's distribution from the model's and the climate's: the same rule as
 * competition.ts's dayForecasts, so a season can be rescored for new settings without
 * recomputing every forecast.
 */
export function yoursOf(model: Dist, climate: Dist, lead: number, y: YourForecaster): Dist {
  const sd = Math.sqrt(model.sd ** 2 + (1 - y.blend) ** 2 * climate.sd ** 2 * knownShare(lead));
  return { mean: y.blend * model.mean + (1 - y.blend) * climate.mean + y.bias, sd: Math.max(0.1, sd * y.spread) };
}

interface Row extends Record<BaseId, Dist> {
  outcome: number;
}

const rowCache = new Map<string, Row[]>();
const baseCache = new Map<string, Record<BaseId, number>>();

function regionKey(r: RegionSettings): string {
  return JSON.stringify(r);
}

/** Every forecast for one month of the year over every scored winter, at one lead. */
function seasonRows(region: RegionSettings, month: number, lead: number): Row[] {
  const key = `${regionKey(region)}|${month}|${lead}`;
  let rows = rowCache.get(key);
  if (!rows) {
    const knobs = regionKnobs(region);
    rows = [];
    for (const y of SEASON_YEARS) {
      const { start, days } = monthDays(y, month);
      for (let i = 0; i < days; i++) {
        const f = dayForecasts(start + i, lead, knobs, FORECASTER_DEFAULTS);
        rows.push({ outcome: f.outcome, climate: f.forecasts.climate, persistence: f.forecasts.persistence, raw: f.forecasts.raw, model: f.forecasts.model });
      }
    }
    if (rowCache.size > 400) rowCache.clear();
    rowCache.set(key, rows);
  }
  return rows;
}

/** Mean CRPS of the four fixed forecasters over a season, at one lead. */
function baseScores(region: RegionSettings, month: number, lead: number): Record<BaseId, number> {
  const key = `${regionKey(region)}|${month}|${lead}`;
  let s = baseCache.get(key);
  if (!s) {
    const rows = seasonRows(region, month, lead);
    const acc: Record<BaseId, number> = { climate: 0, persistence: 0, raw: 0, model: 0 };
    for (const r of rows) for (const id of BASE_IDS) acc[id] += crpsNormal(r[id].mean, r[id].sd, r.outcome) / rows.length;
    s = acc;
    baseCache.set(key, s);
  }
  return s;
}

export interface LeadScore {
  lead: number;
  crps: Record<ForecasterId, number>;
  skill: Record<ForecasterId, number>;
}

/** Every forecaster's mean CRPS and skill (1 − CRPS ÷ the climate's) at every lead from 1 to 15. */
export function seasonScores(region: RegionSettings, month: number, yours: YourForecaster): LeadScore[] {
  return Array.from({ length: MAX_LEAD }, (_, i) => {
    const lead = i + 1;
    const base = baseScores(region, month, lead);
    let y = 0;
    const rows = seasonRows(region, month, lead);
    for (const r of rows) {
      const d = yoursOf(r.model, r.climate, lead, yours);
      y += crpsNormal(d.mean, d.sd, r.outcome) / rows.length;
    }
    const crps = { ...base, yours: y };
    const skill = Object.fromEntries(IDS.map((id) => [id, 1 - crps[id] / crps.climate])) as Record<ForecasterId, number>;
    return { lead, crps, skill };
  });
}

/** Where outcomes fell in your forecaster's distributions, in tenths (shares summing to 1). */
export function yourPit(region: RegionSettings, month: number, lead: number, yours: YourForecaster): number[] {
  const rows = seasonRows(region, month, lead);
  const h = new Array(10).fill(0);
  for (const r of rows) {
    const d = yoursOf(r.model, r.climate, lead, yours);
    h[Math.min(9, Math.floor(pit(d.mean, d.sd, r.outcome) * 10))] += 1 / rows.length;
  }
  return h;
}

/** The calibrated model's skill at a lead, over the season. */
export function modelSkill(region: RegionSettings, month: number, lead: number): number {
  const b = baseScores(region, month, lead);
  return 1 - b.model / b.climate;
}

/** The bias slider's grid, °F. */
export const BIAS_MIN = -6;
export const BIAS_MAX = 6;
export const BIAS_STEP = 0.5;

export interface ChallengeMonth {
  /** How much warmer the month ran than the calibrated model's forecasts, on average, °F. */
  err: number;
  /** The calibrated model's mean CRPS over the month, °F. */
  model: number;
  /** The bias on the slider's grid that scores best, with full weight on the model and its own spread, and its CRPS. */
  bias: number;
  crps: number;
  /** Your CRPS over the month at each bias on the grid (full weight on the model, its own spread). */
  byBias: Map<number, number>;
}

const challengeCache = new Map<string, ChallengeMonth>();

/** The first challenge's month in a region: January of year 20, five days ahead. */
export function challengeMonth(region: RegionSettings): ChallengeMonth {
  const key = regionKey(region);
  const hit = challengeCache.get(key);
  if (hit) return hit;
  const s = scoreMonth(CHALLENGE_MONTH.year, MONTH_OF[CHALLENGE_MONTH.month], CHALLENGE_MONTH.lead, regionKnobs(region), FORECASTER_DEFAULTS);
  const err = s.days.reduce((a, d) => a + d.outcome - d.forecasts.model.mean, 0) / s.days.length;
  const byBias = new Map<number, number>();
  let best = { bias: 0, crps: Infinity };
  for (let b = BIAS_MIN; b <= BIAS_MAX + 1e-9; b += BIAS_STEP) {
    const bias = Math.round(b / BIAS_STEP) * BIAS_STEP;
    let c = 0;
    for (const d of s.days) c += crpsNormal(d.forecasts.model.mean + bias, d.forecasts.model.sd, d.outcome) / s.days.length;
    byBias.set(bias, c);
    if (c < best.crps - 1e-12) best = { bias, crps: c };
  }
  const out = { err, model: s.crps.model, bias: best.bias, crps: best.crps, byBias };
  if (challengeCache.size > 50) challengeCache.clear();
  challengeCache.set(key, out);
  return out;
}

const atStartingShape = (y: YourForecaster) => Math.abs(y.blend - 1) < 1e-9 && Math.abs(y.spread - 1) < 1e-9;

/**
 * First challenge: on January of year 20, five days ahead, with full weight on the model and its
 * own spread, the bias that beats the calibrated model over the month by the most.
 */
export function beatModelSolved(view: { year: number; month: MonthKey; lead: number }, yours: YourForecaster, region: RegionSettings = REGION_DEFAULTS): boolean {
  if (view.year !== CHALLENGE_MONTH.year || view.month !== CHALLENGE_MONTH.month || view.lead !== CHALLENGE_MONTH.lead) return false;
  if (!atStartingShape(yours)) return false;
  const c = challengeMonth(region);
  return c.crps < c.model - 1e-9 && Math.abs(yours.bias - c.bias) < 1e-9;
}

/** Second challenge: the longest lead at which the calibrated model keeps at least 15% skill over the season. */
export function skillLeadSolved(month: MonthKey, lead: number, region: RegionSettings = REGION_DEFAULTS): boolean {
  const m = MONTH_OF[month];
  if (modelSkill(region, m, lead) < SKILL_TARGET) return false;
  return lead >= MAX_LEAD || modelSkill(region, m, lead + 1) < SKILL_TARGET;
}

// ---------------------------------------------------------------------------
// Drawing.

const MX0 = 56;
const MX1 = 624;

function MonthChart({ days, monthName, day, lead, cumCrps }: { days: Array<{ dom: number; outcome: number; f: Record<ForecasterId, Dist> }>; monthName: string; day: number; lead: number; cumCrps: Record<ForecasterId, number> }) {
  const n = days.length;
  const x = scale(0.5, n + 0.5, MX0, MX1);
  const known = Math.min(n, day + lead);
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of days) {
    lo = Math.min(lo, d.f.climate.mean - d.f.climate.sd, d.f.yours.mean - d.f.yours.sd, d.outcome);
    hi = Math.max(hi, d.f.climate.mean + d.f.climate.sd, d.f.yours.mean + d.f.yours.sd, d.outcome);
  }
  const [t0, t1] = niceDomain(lo, hi, 4);
  const y = scale(t0, t1, 144, 24);
  const band = (from: number, to: number, f: (d: (typeof days)[number]) => Dist) => {
    const xs: number[] = [];
    const up: number[] = [];
    const dn: number[] = [];
    for (let i = from; i < to; i++) {
      const v = f(days[i]);
      xs.push(x(i + 1));
      up.push(y(v.mean + v.sd));
      dn.push(y(v.mean - v.sd));
    }
    if (!xs.length) return '';
    let p = '';
    xs.forEach((xx, i) => (p += (i ? ' L' : 'M') + xx.toFixed(1) + ' ' + up[i].toFixed(1)));
    for (let i = xs.length - 1; i >= 0; i--) p += ' L' + xs[i].toFixed(1) + ' ' + dn[i].toFixed(1);
    return p + ' Z';
  };
  const today = days[Math.max(0, Math.min(n - 1, day - 1))];
  // The day's five distributions, on their own temperature scale.
  let rlo = today.outcome;
  let rhi = today.outcome;
  for (const id of IDS) {
    rlo = Math.min(rlo, today.f[id].mean - 2 * today.f[id].sd);
    rhi = Math.max(rhi, today.f[id].mean + 2 * today.f[id].sd);
  }
  const [r0, r1] = niceDomain(rlo, rhi, 4);
  const rx = scale(r0, r1, 150, 540);
  const rowY = (i: number) => 192 + i * 19;
  const sorted = [...IDS].sort((a, b) => cumCrps[a] - cumCrps[b]);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 298"
      role="img"
      aria-label={`${monthName} ${today.dom}, forecast ${lead} days ahead: it came in at ${fmt(today.outcome, 1)} °F. Your forecaster said ${fmt(today.f.yours.mean, 1)} ± ${fmt(today.f.yours.sd, 1)} °F, the calibrated model ${fmt(today.f.model.mean, 1)} ± ${fmt(today.f.model.sd, 1)}, the climate ${fmt(today.f.climate.mean, 1)} ± ${fmt(today.f.climate.sd, 1)}. Over days 1–${day}, the best average score is ${FORECASTER_LABEL[sorted[0]].toLowerCase()}’s, ${fmt(cumCrps[sorted[0]], 2)} °F; yours is ${fmt(cumCrps.yours, 2)} °F.`}
    >
      <text className="ax" x={MX0} y={12}>
        Daily mean temperature, °F
      </text>
      <g aria-hidden="true">
        <rect x={228} y={3} width={10} height={10} rx={2} fill="#c8c8c8" />
        <text className="ax" x={243} y={12}>
          Climate ±1 sd
        </text>
        <rect x={331} y={3} width={10} height={10} rx={2} fill="#bcd6ee" />
        <text className="ax" x={346} y={12}>
          Yours ±1 sd
        </text>
        <line x1={424} x2={437} y1={8} y2={8} stroke={COLOR.model} strokeWidth={1.5} strokeDasharray="4 3" />
        <text className="ax" x={442} y={12}>
          Calibrated model
        </text>
        <circle cx={554} cy={8} r={3.5} fill="#222" />
        <text className="ax" x={561} y={12}>
          Outcome
        </text>
      </g>
      <GridY y={y} ticks={niceTicks(t0, t1, 4)} x0={MX0} x1={MX1} />
      <path d={band(0, n, (d) => d.f.climate)} fill="#9a9a9a" opacity={0.18} />
      <path d={band(0, known, (d) => d.f.yours)} fill={GRAPHIC.blue} opacity={0.2} />
      <path d={linePath(days.slice(0, known).map((_, i) => x(i + 1)), days.slice(0, known).map((d) => y(d.f.model.mean)))} fill="none" stroke={COLOR.model} strokeWidth={1.5} strokeDasharray="5 4" />
      <path d={linePath(days.slice(0, known).map((_, i) => x(i + 1)), days.slice(0, known).map((d) => y(d.f.yours.mean)))} fill="none" stroke={GRAPHIC.blue} strokeWidth={2.5} />
      {known < n && (
        <text className="ax" x={x(known + 0.6)} y={y(t1) + 12}>
          not yet forecast
        </text>
      )}
      <line className="cur" x1={x(day)} x2={x(day)} y1={24} y2={144} />
      {days.slice(0, day).map((d, i) => (
        <circle key={i} cx={x(i + 1)} cy={y(d.outcome)} r={i === day - 1 ? 5.5 : 3.2} fill="#222" stroke="#fcfcfb" strokeWidth={i === day - 1 ? 2 : 1} />
      ))}
      {[1, 5, 10, 15, 20, 25, n].map((dd) => (
        <text key={dd} className="ax ax-m" x={x(dd)} y={160}>
          {dd}
        </text>
      ))}
      <text className="ax" x={MX0} y={180}>
        {monthName} {today.dom}: each forecaster’s ±1 and ±2 standard deviations
      </text>
      <line x1={rx(today.outcome)} x2={rx(today.outcome)} y1={182} y2={rowY(IDS.length - 1) + 8} stroke="#222" strokeWidth={1.5} />
      {IDS.map((id, i) => {
        const f = today.f[id];
        const yy = rowY(i);
        return (
          <g key={id}>
            <text x={144} y={yy + 4} textAnchor="end" style={{ fontSize: 12, fill: id === 'yours' ? TEXT.blue : '#444', fontWeight: id === 'yours' ? 600 : 400 }}>
              {FORECASTER_LABEL[id]}
            </text>
            <line x1={rx(f.mean - 2 * f.sd)} x2={rx(f.mean + 2 * f.sd)} y1={yy} y2={yy} stroke={COLOR[id]} strokeWidth={2} opacity={0.35} />
            <line x1={rx(f.mean - f.sd)} x2={rx(f.mean + f.sd)} y1={yy} y2={yy} stroke={COLOR[id]} strokeWidth={6} opacity={0.75} strokeLinecap="round" />
            <circle cx={rx(f.mean)} cy={yy} r={4} fill="#fcfcfb" stroke={COLOR[id]} strokeWidth={2} />
            <text x={620} y={yy + 4} textAnchor="end" className="ax">
              {fmt(crpsNormal(f.mean, f.sd, today.outcome), 2)}
            </text>
          </g>
        );
      })}
      <text x={620} y={180} textAnchor="end" className="ax">
        score today
      </text>
      <text className="ax ax-m" x={rx(today.outcome)} y={rowY(IDS.length - 1) + 22}>
        {fmt(today.outcome, 1)} °F
      </text>
      {niceTicks(r0, r1, 4).map((t) => (
        <text key={t} className="ax ax-m" x={rx(t)} y={rowY(IDS.length - 1) + 22} style={{ opacity: Math.abs(rx(t) - rx(today.outcome)) < 38 ? 0 : 1 }}>
          {t}°
        </text>
      ))}
    </svg>
  );
}

const SX0 = 56;
const SX1 = 396;
const PX0 = 452;
const PX1 = 624;

function SeasonChart({ scores, lead, hist, monthName, target }: { scores: LeadScore[]; lead: number; hist: number[]; monthName: string; target: boolean }) {
  const x = scale(1, MAX_LEAD, SX0, SX1);
  const y = scale(-0.1, 0.7, 236, 24);
  const clampY = (v: number) => y(Math.max(-0.1, Math.min(0.7, v)));
  const at = scores[lead - 1];
  const hy = scale(0, 0.2, 236, 40);
  const bw = (PX1 - PX0) / 10;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 272"
      role="img"
      aria-label={`Skill against the climate, by lead, over every ${monthName} from year 2 to year 40. At ${lead} days: calibrated model ${pct(at.skill.model)}, raw model ${pct(at.skill.raw)}, persistence ${pct(at.skill.persistence)}, yours ${pct(at.skill.yours)}. Where outcomes fell in your forecasts, by tenths: ${hist.map((h) => pct(h)).join(', ')}.`}
    >
      <text className="ax" x={SX0} y={12}>
        Skill against the climate
      </text>
      <GridY y={y} ticks={[0, 0.2, 0.4, 0.6]} x0={SX0} x1={SX1} format={(v) => pct(v)} baseline={0} />
      {target && (
        <g>
          <line x1={SX0} x2={SX1} y1={y(SKILL_TARGET)} y2={y(SKILL_TARGET)} stroke="#9a9a9a" strokeDasharray="3 4" />
          <text className="ax ax-e" x={SX1} y={y(SKILL_TARGET) - 4}>
            15%
          </text>
        </g>
      )}
      <text className="ax ax-e" x={SX1} y={y(0) + 14}>
        climate
      </text>
      <line className="cur" x1={x(lead)} x2={x(lead)} y1={24} y2={236} />
      {(['persistence', 'raw', 'model', 'yours'] as ForecasterId[]).map((id) => (
        <path
          key={id}
          d={linePath(
            scores.map((s) => x(s.lead)),
            scores.map((s) => clampY(s.skill[id])),
          )}
          fill="none"
          stroke={COLOR[id]}
          strokeWidth={id === 'yours' ? 3 : 2}
          strokeDasharray={id === 'model' ? '6 4' : undefined}
        />
      ))}
      {(['persistence', 'raw', 'model', 'yours'] as ForecasterId[]).map((id) => (
        <circle key={id} cx={x(lead)} cy={clampY(at.skill[id])} r={id === 'yours' ? 5 : 3.5} fill={COLOR[id]} stroke="#fcfcfb" strokeWidth={1.5} />
      ))}
      {[1, 5, 10, 15].map((l) => (
        <text key={l} className="ax ax-m" x={x(l)} y={254}>
          {l}
        </text>
      ))}
      <text className="ax ax-e" x={SX1} y={268}>
        days ahead
      </text>

      <text className="ax" x={PX0} y={12}>
        Where outcomes fell in your forecasts
      </text>
      <text className="ax" x={PX0} y={26}>
        at {lead} days, by tenths
      </text>
      <line className="base" x1={PX0} x2={PX1} y1={236} y2={236} />
      <line x1={PX0} x2={PX1} y1={hy(0.1)} y2={hy(0.1)} stroke="#777" strokeDasharray="4 4" />
      {hist.map((h, i) => (
        <rect key={i} x={PX0 + i * bw + 1.5} y={hy(Math.min(0.2, h))} width={bw - 3} height={236 - hy(Math.min(0.2, h))} fill={GRAPHIC.blue} opacity={0.6} />
      ))}
      <text className="ax" x={PX0} y={254}>
        colder
      </text>
      <text className="ax ax-e" x={PX1} y={254}>
        warmer
      </text>
      <text className="ax ax-e" x={PX1} y={hy(0.1) - 4}>
        flat: calibrated
      </text>
    </svg>
  );
}

/** The forecaster's three sliders, writing to the capstone. */
function ForecasterControls({ fc }: { fc: ForecasterSettings }) {
  return (
    <>
      <Slider
        label="Your weight on the model"
        tone={WX.probability}
        value={fc.blend}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => updateCapstone('forecaster', { blend: v })}
        display={`${pct(fc.blend)} model, ${pct(1 - fc.blend)} climate`}
      />
      <Slider label="Your spread" tone={WX.probability} value={fc.spread} min={0.5} max={2} step={0.05} onChange={(v) => updateCapstone('forecaster', { spread: v })} display={`× ${fmt(fc.spread, 2)}`} />
      <Slider label="Your bias" tone={WX.probability} value={fc.bias} min={BIAS_MIN} max={BIAS_MAX} step={BIAS_STEP} onChange={(v) => updateCapstone('forecaster', { bias: v })} display={`${signed(fc.bias, 1)} °F`} />
    </>
  );
}

const MONTH_OPTIONS = [
  { value: 'dec' as MonthKey, label: 'December' },
  { value: 'jan' as MonthKey, label: 'January' },
  { value: 'feb' as MonthKey, label: 'February' },
];

function regionLabel(r: RegionSettings): string {
  return isFenwick(r) ? 'Fenwick Bay' : `your region (${fmt(r.latitude, 1)}° N, continentality ${fmt(r.continentality, 2)}, ${fmt(r.elevation)} m)`;
}

// Numbers the prose quotes: Fenwick Bay, the starting region.
function fenwickNumbers() {
  const knobs = regionKnobs(REGION_DEFAULTS);
  const month = scoreMonth(20, 0, 5, knobs, FORECASTER_DEFAULTS);
  const err = month.days.reduce((s, d) => s + d.outcome - d.forecasts.model.mean, 0) / month.days.length;
  const jan30 = month.days[29];
  const season = seasonScores(REGION_DEFAULTS, 0, FORECASTER_DEFAULTS);
  const seasonBiased = seasonScores(REGION_DEFAULTS, 0, { ...FORECASTER_DEFAULTS, bias: 2 });
  const noEnso = modelSkill({ ...REGION_DEFAULTS, ensoF: 0 }, 0, 15);
  const noEnso10 = modelSkill({ ...REGION_DEFAULTS, ensoF: 0 }, 0, 10);
  const biasPit = yourPit(REGION_DEFAULTS, 0, 5, { ...FORECASTER_DEFAULTS, bias: 2 });
  const fairPit = yourPit(REGION_DEFAULTS, 0, 5, FORECASTER_DEFAULTS);
  return { month, err, jan30, season, seasonBiased, noEnso, noEnso10, biasPit, fairPit };
}

/** The share of the calibrated model's skill at a lead that ENSO supplies: what setting the region's pull to zero takes away. */
export function ensoShareOfSkill(region: RegionSettings, month: number, lead: number): number {
  const all = modelSkill(region, month, lead);
  return all > 0 ? 1 - modelSkill({ ...region, ensoF: 0 }, month, lead) / all : 0;
}

/** The first lead from which ENSO supplies most of the calibrated model's skill at every longer lead (MAX_LEAD + 1 if it never does). */
export function ensoMajorityFrom(region: RegionSettings, month: number): number {
  let from = MAX_LEAD + 1;
  for (let l = MAX_LEAD; l >= 1 && ensoShareOfSkill(region, month, l) > 0.5; l--) from = l;
  return from;
}

export default function Lesson() {
  const cap = useWeatherCapstone();
  const region = cap.region;
  const fc = cap.forecaster;
  const rkey = regionKey(region);
  const knobs = useMemo(() => regionKnobs(region), [rkey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Figure 1: one month, day by day.
  const raw1 = useScenario('month', { year: CHALLENGE_MONTH.year, month: CHALLENGE_MONTH.month, lead: CHALLENGE_MONTH.lead, day: 31 });
  // Reset touches this lesson's own part, the forecaster, and asks first if it has been changed.
  const s1 = { ...raw1, reset: () => confirmResetPart('forecaster') && raw1.reset() };
  const { year, month, lead } = raw1.state;
  const m = MONTH_OF[month];
  const nDays = MONTH_DAYS[m];
  const day = Math.max(1, Math.min(nDays, raw1.state.day));
  const monthName = MONTH_NAMES[m];
  const full = useMemo(() => scoreMonth(year, m, lead, knobs, fc), [year, m, lead, knobs, fc]);
  const days = useMemo(() => full.days.map((d) => ({ dom: dayInfo(d.d).dom, outcome: d.outcome, f: d.forecasts })), [full]);
  const cum = useMemo(() => {
    const c = Object.fromEntries(IDS.map((id) => [id, 0])) as Record<ForecasterId, number>;
    for (let i = 0; i < day; i++) for (const id of IDS) c[id] += crpsNormal(days[i].f[id].mean, days[i].f[id].sd, days[i].outcome) / day;
    return c;
  }, [days, day]);
  const ranked = [...IDS].sort((a, b) => cum[a] - cum[b]);
  const solved = beatModelSolved(raw1.state, fc, region);
  const onChallengeMonth = year === CHALLENGE_MONTH.year && month === CHALLENGE_MONTH.month && lead === CHALLENGE_MONTH.lead;
  const cm = useMemo(() => challengeMonth(region), [rkey]); // eslint-disable-line react-hooks/exhaustive-deps
  const shaped = Math.abs(fc.blend - 1) < 1e-9 && Math.abs(fc.spread - 1) < 1e-9;
  const twice = cm.byBias.get(Math.max(BIAS_MIN, Math.min(BIAS_MAX, 2 * cm.bias)));

  const play = usePlay(false);
  const acc = useRef(0);
  useAnimationFrame((dt) => {
    acc.current += dt;
    if (acc.current < 0.6) return;
    acc.current = 0;
    raw1.set((st) => (st.day >= MONTH_DAYS[MONTH_OF[st.month]] ? {} : { day: st.day + 1 }));
  }, play.playing);
  useEffect(() => {
    if (play.playing && day >= nDays) play.setPlaying(false);
  }, [play, day, nDays]);
  const togglePlay = () => {
    if (!play.playing && day >= nDays) raw1.set({ day: 1 });
    play.toggle();
  };

  // ---- Figure 2: every winter.
  const raw2 = useScenario('season', { month: 'jan' as MonthKey, lead: 5 });
  const s2 = { ...raw2, reset: () => confirmResetPart('forecaster') && raw2.reset() };
  const sm = MONTH_OF[raw2.state.month];
  const dfc = useDeferredValue(fc);
  const scores = useMemo(() => seasonScores(region, sm, dfc), [rkey, sm, dfc]); // eslint-disable-line react-hooks/exhaustive-deps
  const hist = useMemo(() => yourPit(region, sm, raw2.state.lead, dfc), [rkey, sm, raw2.state.lead, dfc]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = scores[raw2.state.lead - 1];
  const solved2 = skillLeadSolved(raw2.state.month, raw2.state.lead, region);
  const tails = hist[0] + hist[9];
  // Only once the second challenge is solved: from which lead ENSO supplies most of the skill.
  const ensoFrom = useMemo(() => (solved2 ? ensoMajorityFrom(region, sm) : MAX_LEAD + 1), [solved2, rkey, sm]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = useMemo(() => fenwickNumbers(), []);
  const sk = (l: number, id: ForecasterId = 'model') => n.season[l - 1].skill[id];

  return (
    <LessonPage id="weather/6.2">
      <CapstoneStrip parts={['region']} />
      <P>
        <a href={lessonHref('weather/6.1')}>Lesson 6.1</a> built a region: a settlement city with its own latitude, distance from the sea and height, its own
        variability and its own pull from the Pacific. Before anyone can price a contract on that city’s weather, someone has to forecast it. Chapter 3 built every
        tool this takes — a model that carries the weather in from upstream (<a href={lessonHref('weather/3.3')}>Lesson 3.3</a>), the chaos that limits it (
        <a href={lessonHref('weather/3.4')}>Lesson 3.4</a>), and ensembles whose probabilities can be checked against what happened (
        <a href={lessonHref('weather/3.5')}>Lesson 3.5</a>). This lesson puts those tools in competition, on the region you built.
      </P>
      <P>
        Five forecasters enter. <b>Climate</b> forecasts the normal for the date, trend included, with the climate’s own spread. <b>Persistence</b> assumes
        today’s departure from normal will continue, fading by a factor of {fmt(PERSISTENCE, 2)} for each day of lead. The <b>raw model</b> is the weather model
        whose spread is only 0.6 as wide as its errors — the overconfident ensemble of Lesson 3.5. The <b>calibrated model</b> has the right spread. And the fifth is{' '}
        <K tone={WX.probability}>yours</K>: a blend of the model and the climate, with a spread and a bias you choose. Your settings are saved in your browser, but
        only this lesson uses them: from <a href={lessonHref('weather/6.3')}>Lesson 6.3</a> on, every forecast in the capstone is the calibrated model’s, and this
        competition is where we see whether it has earned that. Each forecaster states a whole distribution, and each is scored with the continuous ranked probability score of
        Lesson 3.5, the CRPS — in degrees, lower is better, with credit for honest uncertainty.
      </P>
      <P>
        Every forecast comes from the course’s simulated archive, issued on a known day from only what had been revealed by then; none of them ever saw the
        outcome. In the next demonstration the region is {regionLabel(region)}. The upper chart is the month, with the climate’s band in gray, your forecaster’s
        band and mean in blue, the calibrated model’s mean dashed, and the outcomes revealed as dots. Forecasts reach only as far as {lead} days past the day just
        revealed. The lower chart is that day: each forecaster’s distribution, the outcome as a black line, and each one’s score for the day. The table keeps the
        running scores. Press play to replay the month a day at a time, or choose another:
      </P>

      <Figure
        name="Forecasting Competition"
        scenario={s1}
        play={{ playing: play.playing, toggle: togglePlay }}
        actions={
          <Button onClick={() => raw1.set({ day: day >= nDays ? 1 : day + 1 })} label="Reveal the next day">
            Next day
          </Button>
        }
      >
        <Segmented label="Month" value={month} onChange={(v) => raw1.set({ month: v, day: Math.min(raw1.state.day, MONTH_DAYS[MONTH_OF[v]]) })} options={MONTH_OPTIONS} />
        <MonthChart days={days} monthName={monthName} day={day} lead={lead} cumCrps={cum} />
        <DataTable
          caption={`Mean CRPS over days 1–${day} of ${monthName} of year ${year}, best first`}
          rows={ranked}
          rowKey={(id) => id}
          rowClass={(id) => (id === 'yours' ? 'hl' : '')}
          columns={[
            {
              label: `Days 1–${day}`,
              cell: (id) => (
                <>
                  <Swatch color={COLOR[id]} />
                  {FORECASTER_LABEL[id]}
                </>
              ),
            },
            { label: 'Mean CRPS', cell: (id) => `${fmt(cum[id], 2)} °F`, align: 'right' },
            { label: 'Skill vs climate', cell: (id) => (id === 'climate' ? '—' : pct(1 - cum[id] / cum.climate)), align: 'right' },
          ]}
        />
        <Slider label="Year" value={year} min={2} max={40} onChange={(v) => raw1.set({ year: v })} display={`year ${year}`} />
        <Slider label="Days ahead" tone={WX.probability} value={lead} min={1} max={10} onChange={(v) => raw1.set({ lead: v })} display={`${lead} ${lead === 1 ? 'day' : 'days'}`} />
        <Slider label="Revealed through" value={day} min={1} max={nDays} onChange={(v) => raw1.set({ day: v })} display={`${monthName} ${day}`} />
        <ForecasterControls fc={fc} />
      </Figure>

      <P>
        For Fenwick Bay, the region every earlier lesson used, the demonstration opens on January of year 20 forecast five days ahead — the month whose warm finish
        the forecasts of <a href={lessonHref('weather/5.2')}>Lesson 5.2</a> missed. Over the whole month the climate averages {fmt(n.month.crps.climate, 2)} °F,
        persistence {fmt(n.month.crps.persistence, 2)}, the raw model {fmt(n.month.crps.raw, 2)} and the calibrated model {fmt(n.month.crps.model, 2)}. (If you
        built a different region in Lesson 6.1, the demonstrations use yours.) Persistence barely beats the climate:
        five days on, only {fmt(PERSISTENCE ** 5, 2)} of today’s departure is left, so it says little more than the calendar. The raw model has exactly the
        calibrated model’s means, and still loses, because the CRPS charges it every time the outcome lands outside the narrow range it claimed. At its starting
        settings your forecaster is the calibrated model, so the two tie.
      </P>
      <P>
        Now watch where the misses fall. That January ran {fmt(n.err, 1)} °F warmer than its five-day forecasts on average, and most of it came at the end: on
        January 30 the forecast said {fmt(n.jan30.forecasts.model.mean, 1)} °F and the day came in at {fmt(n.jan30.outcome, 1)}. Seeing that, it’s tempting to
        lean the forecasts warm.
      </P>

      <Challenge
        id="a"
        question={`On January of year 20, five days ahead${isFenwick(region) ? '' : ' in your region'}, the month ran ${fmt(Math.abs(cm.err), 1)} °F ${cm.err >= 0 ? 'warmer' : 'colder'} than the calibrated model’s forecasts on average. Predict the bias that beats the model by the most over the whole month — with your weight left at 100% model and your spread at × 1 — then set it and check.`}
        solved={solved}
        status={
          !onChallengeMonth
            ? 'Set the demonstration to January of year 20, five days ahead, first.'
            : !shaped
              ? 'Put your weight back to 100% model and your spread to × 1: tune the bias alone.'
              : cm.crps >= cm.model - 1e-9
                ? 'In your region this month, no bias beats the calibrated model. Return to Fenwick Bay at the top of the lesson to play this one.'
                : `With a ${signed(fc.bias, 1)} °F bias your forecaster scores ${fmt(full.crps.yours, 2)} °F over the month, against the calibrated model’s ${fmt(full.crps.model, 2)}.`
        }
        success={`Solved: ${signed(cm.bias, 1)} °F, the nearest the slider comes to the month’s average miss of ${signed(cm.err, 1)}, scores ${fmt(cm.crps, 2)} °F against the model’s ${fmt(cm.model, 2)}, and no other bias does better.${
          twice !== undefined && cm.bias !== 0 ? ` Push it to ${signed(2 * cm.bias, 1)} and it ${twice > cm.model ? 'loses again' : 'wins by less'}, at ${fmt(twice, 2)}.` : ''
        } But you have tuned a forecaster on one month whose outcome you could see — exactly the in-sample tuning that Lesson 5.5 warned about. The next demonstration asks whether it holds up.`}
      />

      <H2>Every winter</H2>
      <P>
        One month is 31 scores, and the luck of one warm spell can decide it. The next demonstration scores every forecaster over every December, January or
        February from year 2 to year 40 — more than a thousand forecasts at each lead — and plots their <K tone={WX.probability}>skill</K>, one minus their average CRPS
        divided by the climate’s, so the climate sits at zero and a perfect forecast at 100%. On the right is the calibration check of Lesson 3.5 for your
        forecaster at the chosen lead: where each outcome fell within its forecast distribution, in tenths. A calibrated forecaster fills every tenth equally. Your
        forecaster’s sliders are repeated here:
      </P>

      <Figure name="Forecasting Competition · every winter" scenario={s2}>
        <Segmented label="Month" value={raw2.state.month} onChange={(v) => raw2.set({ month: v })} options={MONTH_OPTIONS} />
        <SeasonChart scores={scores} lead={raw2.state.lead} hist={hist} monthName={MONTH_NAMES[sm]} target={solved2} />
        <Legend
          items={[
            { label: 'Persistence', color: COLOR.persistence, kind: 'line' },
            { label: 'Raw model', color: COLOR.raw, kind: 'line' },
            { label: 'Calibrated model', color: COLOR.model, kind: 'line', dashed: true },
            { label: 'Yours', color: COLOR.yours, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: `your skill at ${raw2.state.lead} days`, value: pct(at.skill.yours), tone: WX.probability },
            { label: 'calibrated model', value: pct(at.skill.model) },
            { label: 'raw model', value: pct(at.skill.raw) },
            { label: 'outcomes in the outer tenths (20% if calibrated)', value: pct(tails) },
          ]}
        />
        <Slider label="Days ahead" tone={WX.probability} value={raw2.state.lead} min={1} max={MAX_LEAD} onChange={(v) => raw2.set({ lead: v })} display={`${raw2.state.lead} ${raw2.state.lead === 1 ? 'day' : 'days'}`} />
        <ForecasterControls fc={fc} />
      </Figure>

      <P>
        Now judge the forecaster you tuned. A +2 °F bias that won January of year 20 scores {fmt(n.seasonBiased[4].crps.yours, 2)} °F over all of Fenwick Bay’s
        Januaries at five days, against {fmt(n.season[4].crps.model, 2)} for the calibrated model, and the calibration check gives it away: {pct(n.biasPit[0] + n.biasPit[1])}{' '}
        of outcomes land in the two coldest tenths of its forecasts, against {pct(n.fairPit[0] + n.fairPit[1])} for the honest forecaster. The month you tuned on
        was warm. The winters weren’t.
      </P>

      <Challenge
        id="b"
        question={`Estimate first, then check: in the month you’ve chosen and in your region, what’s the longest lead at which the calibrated model still has at least ${pct(SKILL_TARGET)} skill over every winter?`}
        solved={solved2}
        status={`At ${raw2.state.lead} ${raw2.state.lead === 1 ? 'day' : 'days'} the calibrated model has ${pct(at.skill.model, 1)} skill.${at.skill.model >= SKILL_TARGET ? ' Can it see farther?' : ''}`}
        success={`Solved: ${raw2.state.lead} days, at ${pct(at.skill.model, 1)} skill${raw2.state.lead < MAX_LEAD ? `; a day more and it drops to ${pct(scores[raw2.state.lead].skill.model, 1)}` : ''}. Past that the forecast still beats the climate, by less each day, and mostly on the weather model’s own information; ${
          ensoFrom <= MAX_LEAD ? `only from ${ensoFrom} days is most of what it adds ENSO’s tilt` : `even at ${MAX_LEAD} days most of what it adds is the weather model’s, not ENSO’s tilt`
        } — the tilt that, as Lesson 5.3 showed, a market can miss.`}
      />

      <P>
        Over Fenwick Bay’s Januaries the calibrated model has {pct(sk(1))} skill a day ahead, {pct(sk(5))} at five days, {pct(sk(7))} at seven and {pct(sk(10))}{' '}
        at ten. That fade is the limit of <a href={lessonHref('weather/3.4')}>Lesson 3.4</a> in a forecaster’s report card: small errors grow until the model knows
        little more than the climate. Persistence starts at {pct(sk(1, 'persistence'))} and is worth under {pct(0.01)} by five days. The raw model tracks the
        calibrated one at short leads, but past ten days it falls below zero — {pct(sk(11, 'raw'), 1)} at eleven and {pct(sk(15, 'raw'), 1)} at fifteen. An
        overconfident forecast that knows almost nothing is worse than admitting it knows nothing. Set your spread to 0.6, with full weight on the model and no bias, and your blue line becomes the raw model’s, point for point.
      </P>
      <P>
        Even fifteen days out the calibrated model keeps {pct(sk(15), 1)} skill. Most of that isn’t the weather model: it is the Pacific. The model carries ENSO’s
        tilt of <a href={lessonHref('weather/2.4')}>Lesson 2.4</a>, which the climate forecaster ignores. Set the region’s pull from the Pacific to zero in Lesson
        6.1 and the fifteen-day skill falls to {pct(n.noEnso, 1)}. Nearer in, the weather model still carries most of it: at ten days, with no pull, the skill
        only falls from {pct(sk(10), 1)} to {pct(n.noEnso10, 1)}.
      </P>
      <P>
        A forecast is worth paying for when it is both sharp and honest. The competition in <FigRef to="Forecasting Competition">the first demonstration</FigRef>{' '}
        can reward a forecaster that is neither, for a month; over every winter, the calibrated model is the one here that is both, which is why the rest of the
        capstone forecasts with it, wherever you leave your own sliders. What a business needs from it is the next step: in{' '}
        <a href={lessonHref('weather/6.3')}>the next lesson</a>, the calibrated model’s distributions of temperature become distributions of gas sent out
        and of money made or lost.
      </P>
    </LessonPage>
  );
}
