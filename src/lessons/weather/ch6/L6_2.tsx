import { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import {
  Button,
  Caption,
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
  isCalder,
  regionKnobs,
  resetCapstone,
  updateCapstone,
  useWeatherCapstone,
  type ForecasterSettings,
  type RegionSettings,
} from '../shared/capstone';
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

/** First challenge: on January of year 20, five days ahead, your forecaster beats the calibrated model over the month. */
export function beatModelSolved(view: { year: number; month: MonthKey; lead: number }, yours: YourForecaster, region: RegionSettings = REGION_DEFAULTS): boolean {
  if (view.year !== CHALLENGE_MONTH.year || view.month !== CHALLENGE_MONTH.month || view.lead !== CHALLENGE_MONTH.lead) return false;
  const s = scoreMonth(view.year, MONTH_OF[view.month], view.lead, regionKnobs(region), yours);
  return s.crps.yours < s.crps.model - 1e-9;
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
  const y = scale(t0, t1, 168, 24);
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
  const rowY = (i: number) => 214 + i * 22;
  const sorted = [...IDS].sort((a, b) => cumCrps[a] - cumCrps[b]);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 346"
      role="img"
      aria-label={`${monthName} ${today.dom}, forecast ${lead} days ahead: it came in at ${fmt(today.outcome, 1)} °F. Your forecaster said ${fmt(today.f.yours.mean, 1)} ± ${fmt(today.f.yours.sd, 1)} °F, the calibrated model ${fmt(today.f.model.mean, 1)} ± ${fmt(today.f.model.sd, 1)}, the climate ${fmt(today.f.climate.mean, 1)} ± ${fmt(today.f.climate.sd, 1)}. Over days 1–${day}, the best average score is ${FORECASTER_LABEL[sorted[0]].toLowerCase()}’s, ${fmt(cumCrps[sorted[0]], 2)} °F; yours is ${fmt(cumCrps.yours, 2)} °F.`}
    >
      <text className="ax" x={MX0} y={12}>
        Daily mean temperature, °F · forecasts issued {lead} days ahead
      </text>
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
      <line className="cur" x1={x(day)} x2={x(day)} y1={24} y2={168} />
      {days.slice(0, day).map((d, i) => (
        <circle key={i} cx={x(i + 1)} cy={y(d.outcome)} r={i === day - 1 ? 5.5 : 3.2} fill="#222" stroke="#fcfcfb" strokeWidth={i === day - 1 ? 2 : 1} />
      ))}
      {[1, 5, 10, 15, 20, 25, n].map((dd) => (
        <text key={dd} className="ax ax-m" x={x(dd)} y={184}>
          {dd}
        </text>
      ))}
      <text className="ax" x={MX0} y={204}>
        {monthName} {today.dom}: each forecaster’s ±1 and ±2 standard deviations
      </text>
      <line x1={rx(today.outcome)} x2={rx(today.outcome)} y1={206} y2={rowY(IDS.length - 1) + 8} stroke="#222" strokeWidth={1.5} />
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
      <text x={620} y={204} textAnchor="end" className="ax">
        score today
      </text>
      <text className="ax ax-m" x={rx(today.outcome)} y={rowY(IDS.length - 1) + 22}>
        {fmt(today.outcome, 1)} °F
      </text>
      {niceTicks(r0, r1, 4).map((t) => (
        <text key={t} className="ax ax-m" x={rx(t)} y={rowY(IDS.length - 1) + 36} style={{ opacity: Math.abs(rx(t) - rx(today.outcome)) < 26 ? 0 : 1 }}>
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

function SeasonChart({ scores, lead, hist, monthName }: { scores: LeadScore[]; lead: number; hist: number[]; monthName: string }) {
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
      <line x1={SX0} x2={SX1} y1={y(SKILL_TARGET)} y2={y(SKILL_TARGET)} stroke="#9a9a9a" strokeDasharray="3 4" />
      <text className="ax ax-e" x={SX1} y={y(SKILL_TARGET) - 4}>
        15%
      </text>
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
      <Slider label="Your bias" tone={WX.probability} value={fc.bias} min={-6} max={6} step={0.5} onChange={(v) => updateCapstone('forecaster', { bias: v })} display={`${signed(fc.bias, 1)} °F`} />
    </>
  );
}

const MONTH_OPTIONS = [
  { value: 'dec' as MonthKey, label: 'December' },
  { value: 'jan' as MonthKey, label: 'January' },
  { value: 'feb' as MonthKey, label: 'February' },
];

function regionLabel(r: RegionSettings): string {
  return isCalder(r) ? 'Calder Bay' : `your region (${fmt(r.latitude, 1)}° N, continentality ${fmt(r.continentality, 2)}, ${fmt(r.elevation)} m)`;
}

// Numbers the prose quotes: Calder Bay, the starting region.
function calderNumbers() {
  const knobs = regionKnobs(REGION_DEFAULTS);
  const month = scoreMonth(20, 0, 5, knobs, FORECASTER_DEFAULTS);
  const biased = scoreMonth(20, 0, 5, knobs, { ...FORECASTER_DEFAULTS, bias: 2 });
  const tooFar = scoreMonth(20, 0, 5, knobs, { ...FORECASTER_DEFAULTS, bias: 4 });
  const err = month.days.reduce((s, d) => s + d.outcome - d.forecasts.model.mean, 0) / month.days.length;
  const jan30 = month.days[29];
  const season = seasonScores(REGION_DEFAULTS, 0, FORECASTER_DEFAULTS);
  const seasonBiased = seasonScores(REGION_DEFAULTS, 0, { ...FORECASTER_DEFAULTS, bias: 2 });
  const noEnso = modelSkill({ ...REGION_DEFAULTS, ensoF: 0 }, 0, 15);
  const biasPit = yourPit(REGION_DEFAULTS, 0, 5, { ...FORECASTER_DEFAULTS, bias: 2 });
  const fairPit = yourPit(REGION_DEFAULTS, 0, 5, FORECASTER_DEFAULTS);
  let longest = 1;
  for (let l = 1; l <= MAX_LEAD; l++) if (season[l - 1].skill.model >= SKILL_TARGET) longest = l;
  return { month, biased, tooFar, err, jan30, season, seasonBiased, noEnso, biasPit, fairPit, longest };
}

export default function Lesson() {
  const cap = useWeatherCapstone();
  const region = cap.region;
  const fc = cap.forecaster;
  const rkey = regionKey(region);
  const knobs = useMemo(() => regionKnobs(region), [rkey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Figure 1: one month, day by day.
  const raw1 = useScenario('month', { year: CHALLENGE_MONTH.year, month: CHALLENGE_MONTH.month, lead: CHALLENGE_MONTH.lead, day: 31 });
  const s1 = { ...raw1, reset: () => (raw1.reset(), resetCapstone('forecaster')) };
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
  const s2 = { ...raw2, reset: () => (raw2.reset(), resetCapstone('forecaster')) };
  const sm = MONTH_OF[raw2.state.month];
  const dfc = useDeferredValue(fc);
  const scores = useMemo(() => seasonScores(region, sm, dfc), [rkey, sm, dfc]); // eslint-disable-line react-hooks/exhaustive-deps
  const hist = useMemo(() => yourPit(region, sm, raw2.state.lead, dfc), [rkey, sm, raw2.state.lead, dfc]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = scores[raw2.state.lead - 1];
  const solved2 = skillLeadSolved(raw2.state.month, raw2.state.lead, region);
  const tails = hist[0] + hist[9];

  const n = useMemo(() => calderNumbers(), []);
  const sk = (l: number, id: ForecasterId = 'model') => n.season[l - 1].skill[id];

  return (
    <LessonPage id="weather/6.2">
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
        <K tone={WX.probability}>yours</K>: a blend of the model and the climate, with a spread and a bias you choose. Your settings are saved with your region and
        carried through the rest of the capstone. Each forecaster states a whole distribution, and each is scored with the continuous ranked probability score of
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
        <Legend
          items={[
            { label: 'Climate ±1 sd', color: '#c8c8c8' },
            { label: 'Yours ±1 sd', color: '#bcd6ee' },
            { label: 'Calibrated model', color: COLOR.model, kind: 'line', dashed: true },
            { label: 'What happened', color: '#222' },
          ]}
        />
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
        <Caption>
          After {day} {day === 1 ? 'day' : 'days'} your forecaster ranks {ranked.indexOf('yours') + 1} of 5, at {fmt(cum.yours, 2)} °F against the calibrated
          model’s {fmt(cum.model, 2)}.
        </Caption>
      </Figure>

      <P>
        For Calder Bay, the region every earlier lesson used, the demonstration opens on January of year 20 forecast five days ahead — the month whose warm finish
        the forecasts of <a href={lessonHref('weather/5.2')}>Lesson 5.2</a> missed. Over the whole month the climate averages {fmt(n.month.crps.climate, 2)} °F,
        persistence {fmt(n.month.crps.persistence, 2)}, the raw model {fmt(n.month.crps.raw, 2)} and the calibrated model {fmt(n.month.crps.model, 2)}. (If you
        built a different region in Lesson 6.1, the demonstrations use yours; the numbers in this text stay Calder Bay’s.) Persistence barely beats the climate:
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
        question="On January of year 20, five days ahead, adjust your forecaster until it beats the calibrated model over the whole month."
        solved={solved}
        status={
          !onChallengeMonth
            ? 'Set the demonstration to January of year 20, five days ahead, first.'
            : `Over the month your forecaster scores ${fmt(full.crps.yours, 2)} °F against the calibrated model’s ${fmt(full.crps.model, 2)}.`
        }
        success={`Solved: ${fmt(full.crps.yours, 2)} °F against the model’s ${fmt(full.crps.model, 2)}. In Calder Bay’s January of year 20, a +2 °F bias scores ${fmt(n.biased.crps.yours, 2)}; push it to +4 and it loses again, at ${fmt(n.tooFar.crps.yours, 2)}. But you have tuned a forecaster on one month whose outcome you could see — exactly the in-sample tuning that Lesson 5.5 warned about. The next demonstration asks whether it holds up.`}
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
        <SeasonChart scores={scores} lead={raw2.state.lead} hist={hist} monthName={MONTH_NAMES[sm]} />
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
        Over Calder Bay’s Januaries the calibrated model has {pct(sk(1))} skill a day ahead, {pct(sk(5))} at five days, {pct(sk(7))} at seven and {pct(sk(10))}{' '}
        at ten. That fade is the limit of <a href={lessonHref('weather/3.4')}>Lesson 3.4</a> in a forecaster’s report card: small errors grow until the model knows
        little more than the climate. Persistence starts at {pct(sk(1, 'persistence'))} and is worth under {pct(0.01)} by five days. The raw model tracks the
        calibrated one at short leads, but past ten days it falls below zero — {pct(sk(11, 'raw'), 1)} at eleven and {pct(sk(15, 'raw'), 1)} at fifteen. An
        overconfident forecast that knows almost nothing is worse than admitting it knows nothing. Set your spread to 0.6, with full weight on the model and no bias, and your blue line becomes the raw model’s, point for point.
      </P>
      <P>
        Even fifteen days out the calibrated model keeps {pct(sk(15), 1)} skill. Most of that isn’t the weather model: it is the Pacific. The model carries ENSO’s
        tilt of <a href={lessonHref('weather/2.4')}>Lesson 2.4</a>, which the climate forecaster ignores. Set the region’s pull from the Pacific to zero in Lesson
        6.1 and the fifteen-day skill falls to {pct(n.noEnso, 1)}.
      </P>
      <P>
        Now judge the forecaster you tuned. A +2 °F bias that won January of year 20 scores {fmt(n.seasonBiased[4].crps.yours, 2)} °F over all of Calder Bay’s
        Januaries at five days, against {fmt(n.season[4].crps.model, 2)} for the calibrated model, and the calibration check gives it away: {pct(n.biasPit[0] + n.biasPit[1])}{' '}
        of outcomes land in the two coldest tenths of its forecasts, against {pct(n.fairPit[0] + n.fairPit[1])} for the honest forecaster. The month you tuned on
        was warm. The winters weren’t.
      </P>

      <Challenge
        id="b"
        question={`In the month you’ve chosen and in your region, what’s the longest lead at which the calibrated model still has at least ${pct(SKILL_TARGET)} skill over every winter?`}
        solved={solved2}
        status={`At ${raw2.state.lead} ${raw2.state.lead === 1 ? 'day' : 'days'} the calibrated model has ${pct(at.skill.model, 1)} skill.${at.skill.model >= SKILL_TARGET ? ' Can it see farther?' : ''}`}
        success={`Solved: ${raw2.state.lead} days, at ${pct(at.skill.model, 1)} skill${raw2.state.lead < MAX_LEAD ? `; a day more and it drops to ${pct(scores[raw2.state.lead].skill.model, 1)}` : ''}. In Calder Bay’s Januaries the answer is ${n.longest} days. Beyond that the forecast is still useful, but most of what it adds to the climate is ENSO’s tilt — information that, as Lesson 5.3 showed, a market can miss.`}
      />

      <P>
        Leave your forecaster where you think it belongs — most likely, back at the calibrated model’s settings. A forecast is worth paying for when it is both
        sharp and honest, and the competition in <FigRef to="Forecasting Competition">the first demonstration</FigRef> can reward a forecaster that is neither,
        for a month. What a business needs from it is the next step: in <a href={lessonHref('weather/6.3')}>the next lesson</a>, these distributions of
        temperature become distributions of gas sent out, megawatt-hours produced and money made or lost.
      </P>
    </LessonPage>
  );
}
