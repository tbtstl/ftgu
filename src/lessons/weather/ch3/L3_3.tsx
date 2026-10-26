import { useMemo, useState } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Eq,
  Figure,
  Frac,
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
  TEXT,
  fmt,
  lessonHref,
  linePath,
  scale,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { FENWICK_I, DX_KM, NX, OCEAN, analysis, observationSites, rmsDiff, runModel, truthField, truthWaves } from '../../../engines/weather/nwp';
import { cellsPerDay, forecastSkill, upstreamIndex, type SkillCurve } from '../../../engines/weather/nwpSkill';
import { knownShare } from '../../../model/weather/archive';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: the model against the truth, both carried east by the wind.

/** How long the first demonstration runs, model hours. */
export const RUN_HOURS = 120;
export const DT_STEP = 0.25;
export const DT_MIN = 0.25;
export const DT_MAX = 4;
export const WIND_MIN = 4;
export const WIND_MAX = 24;
/** The pattern the first demonstration carries: the course's standard truth, with no development. */
const WAVES = truthWaves();
const START = truthField(WAVES, 0, 12, 0);

/** The Courant number: the share of a grid cell the wind crosses in one time step. */
export function courantNumber(windMs: number, dtHours: number): number {
  return (windMs * dtHours * 3600) / 1000 / DX_KM;
}

/** The first challenge's wind, m/s: westerlies a little stronger than the starting 12. */
export const CFL_WIND = 15;
/** The challenge: at 15 m/s, the longest time step on the slider that keeps the scheme stable (C ≤ 1): 1.5 h. */
export function stepSolved(dtHours: number, windMs: number): boolean {
  return windMs === CFL_WIND && courantNumber(windMs, dtHours) <= 1 && courantNumber(windMs, dtHours + DT_STEP) > 1;
}

/** The model hour at which a run from the starting pattern first passes 100 °F, or null if it doesn't within RUN_HOURS. */
export function blowUpHour(windMs: number, dtHours: number): number | null {
  const r = runModel(START, windMs, dtHours, RUN_HOURS);
  const i = r.frames.findIndex((fr) => fr.some((v) => Math.abs(v) >= 100));
  return i < 0 ? null : r.hours[i];
}

// ---------------------------------------------------------------------------
// The second demonstration: forecasting Fenwick Bay from an analysis of the observations.

export interface ForecastSettings {
  /** Observations every this many grid points over land (fixed at 3 in the lesson). */
  land: number;
  /** Observations every this many grid points over the ocean; 0 = none. */
  ocean: number;
  windMs: number;
  /** How fast the weather systems grow, weaken and drift on their own. */
  evolution: number;
}

export const FORECAST_DEFAULTS: ForecastSettings = { land: 3, ocean: 0, windMs: 12, evolution: 0.5 };
export const SKILL_LEAD = 6;

const skillCache = new Map<string, SkillCurve>();
/** The forecast's skill curve for these settings (40 weather situations), cached. */
export function skillOf(s: ForecastSettings): SkillCurve {
  const key = `${s.land}|${s.ocean}|${s.windMs}|${s.evolution}`;
  let c = skillCache.get(key);
  if (!c) {
    c = forecastSkill({ land: s.land, ocean: s.ocean, windMs: s.windMs, evolution: s.evolution, days: 10, step: 0.5, cases: 40 });
    if (skillCache.size > 300) skillCache.clear();
    skillCache.set(key, c);
  }
  return c;
}

function at(c: SkillCurve, lead: number) {
  const i = c.leads.indexOf(lead);
  return { rms: c.rms[i], none: c.none[i] };
}

/** Whether the forecast at a lead beats forecasting no anomaly at all. */
export function beatsNoForecast(s: ForecastSettings, lead: number): boolean {
  const x = at(skillOf(s), lead);
  return x.rms < x.none;
}

/** Last lead (half-day steps) before the forecast first does worse than no forecast; 10 if it never does. */
export function usefulLead(c: SkillCurve): number {
  for (let k = 0; k < c.leads.length; k++) if (c.rms[k] >= c.none[k]) return k === 0 ? 0 : c.leads[k - 1];
  return c.leads[c.leads.length - 1];
}

/**
 * The second challenge: with no ocean observations and the land network, the fastest wind
 * (whole m/s) at which the 6-day forecast still beats no forecast at all. It's 10 m/s at any
 * development setting the slider allows.
 */
export function windSolved(s: ForecastSettings): boolean {
  if (s.ocean !== 0 || s.land !== FORECAST_DEFAULTS.land || s.windMs >= WIND_MAX) return false;
  return beatsNoForecast(s, SKILL_LEAD) && !beatsNoForecast({ ...s, windMs: s.windMs + 1 }, SKILL_LEAD);
}

// ---------------------------------------------------------------------------
// Drawing.

const X0 = 56;
const X1 = 624;
const MODEL = GRAPHIC.red;
const TRUTH = '#8a8a8a';
const OCEAN_FILL = tint('#7fa9cc', 0.28);

/** Days for the air to travel from the ocean's eastern edge to Fenwick Bay. */
export function oceanEdgeDays(windMs: number): number {
  return (FENWICK_I - OCEAN.to) / cellsPerDay(windMs);
}

function km(points: number) {
  return fmt(points * DX_KM, 0);
}

function RingChart({ model, truth, hours, unstable }: { model: Float64Array; truth: Float64Array; hours: number; unstable: boolean }) {
  const x = scale(0, NX - 1, X0, X1);
  const y = scale(-18, 18, 206, 30);
  const xs = Array.from({ length: NX }, (_, i) => x(i));
  const clip = 'mwe-ring';
  const err = rmsDiff(model, truth);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 250"
      role="img"
      aria-label={`Temperature anomalies around the 41st parallel after ${fmt(hours, hours % 1 ? 2 : 0)} model hours. ${unstable ? 'The model has blown up: its values have grown far beyond anything real.' : `The model differs from the truth by ${fmt(err, 2)} °F on average (root mean square).`}`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={X0} y={26} width={X1 - X0} height={184} />
        </clipPath>
      </defs>
      <text className="ax" x={X0} y={14}>
        Temperature anomaly, °F
      </text>
      <rect x={x(OCEAN.from)} y={30} width={x(OCEAN.to) - x(OCEAN.from)} height={176} fill={OCEAN_FILL} />
      <text className="ax ax-m" x={(x(OCEAN.from) + x(OCEAN.to)) / 2} y={44} style={{ fill: '#4f7596' }}>
        ocean
      </text>
      <text className="ax ax-m" x={(x(OCEAN.to) + x(FENWICK_I)) / 2} y={44}>
        continent
      </text>
      <GridY y={y} ticks={[-15, -10, -5, 0, 5, 10, 15]} x0={X0} x1={X1} format={(v) => (v > 0 ? `+${v}` : v === 0 ? '0' : `−${-v}`)} baseline={0} />
      <g clipPath={`url(#${clip})`}>
        <path d={linePath(xs, Array.from(truth, (v) => y(v)))} fill="none" stroke={TRUTH} strokeWidth={1.8} strokeDasharray="6 4" />
        <path d={linePath(xs, Array.from(model, (v) => y(Math.max(-40, Math.min(40, v)))))} fill="none" stroke={MODEL} strokeWidth={2.5} strokeLinejoin="round" />
      </g>
      <line x1={x(FENWICK_I)} x2={x(FENWICK_I)} y1={30} y2={206} stroke="#333" strokeWidth={1} strokeDasharray="2 3" />
      <text className="lab" x={x(FENWICK_I) + 4} y={222}>
        Fenwick Bay
      </text>
      <text className="ax" x={X0} y={222}>
        west
      </text>
      <text className="ax ax-e" x={X1} y={222}>
        east
      </text>
      <text className="ax ax-m" x={(X0 + X1) / 2 - 60} y={240}>
        around the 41st parallel, one grid point per degree ({fmt(DX_KM)} km) · wind →
      </text>
      {unstable && (
        <text x={(X0 + X1) / 2} y={120} textAnchor="middle" style={{ fontSize: 15, fontWeight: 600, fill: TEXT.red }}>
          the model has blown up
        </text>
      )}
    </svg>
  );
}

const UP_FROM = 100;
const UP_TO = 310;

function ForecastChart({ s, curve }: { s: ForecastSettings; curve: SkillCurve }) {
  // Upper panel: one weather situation at the start, and the analysis built from the observations.
  const truth0 = useMemo(() => truthField(truthWaves(1), 0, s.windMs, s.evolution), [s.windMs, s.evolution]);
  const sites = useMemo(() => observationSites(s.land, s.ocean), [s.land, s.ocean]);
  const an = useMemo(() => analysis(truth0, sites), [truth0, sites]);
  const ux = scale(UP_FROM, UP_TO, X0, X1);
  const uy = scale(-18, 18, 150, 34);
  const idx = Array.from({ length: UP_TO - UP_FROM + 1 }, (_, k) => UP_FROM + k);
  const shown = sites.filter((i) => i >= UP_FROM && i <= UP_TO);
  const marks = Array.from({ length: 10 }, (_, k) => ({ day: k + 1, i: upstreamIndex(k + 1, s.windMs) })).filter((m) => m.i >= UP_FROM && m.i <= FENWICK_I);

  // Lower panel: error by lead.
  const lx = scale(0, 10, X0, X1);
  const top = Math.max(10, ...curve.rms, ...curve.none);
  const ly = scale(0, top, 370, 216);
  const edge = oceanEdgeDays(s.windMs);
  const far = (FENWICK_I - OCEAN.from) / cellsPerDay(s.windMs);
  const worse: Array<[number, number]> = [];
  curve.leads.forEach((l, k) => {
    if (curve.rms[k] >= curve.none[k]) worse.push([l, k]);
  });
  const sixth = at(curve, SKILL_LEAD);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 400"
      role="img"
      aria-label={`Forecasting Fenwick Bay with observations every ${s.land} grid points over land and ${s.ocean ? `every ${s.ocean} over the ocean` : 'none over the ocean'}, a ${s.windMs} m/s wind and weather development ×${fmt(s.evolution, 1)}. Averaged over 40 weather situations, the forecast error is ${fmt(at(curve, 2).rms, 1)} °F at 2 days and ${fmt(sixth.rms, 1)} °F at 6 days, against ${fmt(sixth.none, 1)} °F for no forecast at all.`}
    >
      <text className="ax" x={X0} y={14}>
        At the start: one weather situation, upstream of Fenwick Bay
      </text>
      <rect x={ux(Math.max(UP_FROM, OCEAN.from))} y={34} width={ux(OCEAN.to) - ux(Math.max(UP_FROM, OCEAN.from))} height={116} fill={OCEAN_FILL} />
      <text className="ax ax-m" x={(ux(Math.max(UP_FROM, OCEAN.from)) + ux(OCEAN.to)) / 2} y={146} style={{ fill: '#4f7596' }}>
        ocean
      </text>
      <line className="base" x1={X0} x2={X1} y1={uy(0)} y2={uy(0)} />
      <path d={linePath(idx.map(ux), idx.map((i) => uy(truth0[i])))} fill="none" stroke={TRUTH} strokeWidth={1.8} strokeDasharray="6 4" />
      <path d={linePath(idx.map(ux), idx.map((i) => uy(an[i])))} fill="none" stroke={MODEL} strokeWidth={2.2} />
      {shown.map((i) => (
        <circle key={i} cx={ux(i)} cy={uy(an[i])} r={2.6} fill={MODEL} />
      ))}
      <line x1={ux(FENWICK_I)} x2={ux(FENWICK_I)} y1={30} y2={150} stroke="#333" strokeDasharray="2 3" />
      <text className="lab" x={ux(FENWICK_I) + 4} y={164}>
        Fenwick Bay
      </text>
      {marks.map((m) => (
        <g key={m.day}>
          <line x1={ux(m.i)} x2={ux(m.i)} y1={24} y2={34} stroke={GRAPHIC.violet} strokeWidth={1.5} />
          <text x={ux(m.i)} y={20} textAnchor="middle" style={{ fontSize: 11, fill: TEXT.violet }}>
            {m.day}
          </text>
        </g>
      ))}
      <text className="ax" x={X0} y={164} style={{ fill: TEXT.violet }}>
        numbers: where the air reaching Fenwick Bay on each day is now
      </text>

      <text className="ax" x={X0} y={200}>
        Forecast error at Fenwick Bay, °F (40 situations)
      </text>
      {worse.map(([l]) => (
        <rect key={l} x={lx(Math.max(0, l - 0.25))} y={216} width={lx(Math.min(10, l + 0.25)) - lx(Math.max(0, l - 0.25))} height={154} fill={tint(GRAPHIC.red, 0.12)} />
      ))}
      {edge <= 10 && (
        <g>
          <line x1={lx(edge)} x2={lx(edge)} y1={216} y2={370} stroke="#4f7596" strokeDasharray="3 3" />
          <text className="ax" x={lx(edge) + 4} y={228} style={{ fill: '#4f7596' }}>
            air from the ocean
          </text>
        </g>
      )}
      {far <= 10 && (
        <g>
          <line x1={lx(far)} x2={lx(far)} y1={216} y2={370} stroke="#4f7596" strokeDasharray="3 3" />
          <text className="ax" x={lx(far) + 4} y={240} style={{ fill: '#4f7596' }}>
            from beyond it
          </text>
        </g>
      )}
      <GridY y={ly} ticks={top > 12 ? [0, 5, 10, 15] : [0, 2, 4, 6, 8, 10]} x0={X0} x1={X1} baseline={0} />
      <path d={linePath(curve.leads.map(lx), curve.none.map(ly))} fill="none" stroke={TRUTH} strokeWidth={1.8} strokeDasharray="6 4" />
      <path d={linePath(curve.leads.map(lx), curve.rms.map(ly))} fill="none" stroke={GRAPHIC.blue} strokeWidth={2.8} strokeLinejoin="round" />
      <circle cx={lx(SKILL_LEAD)} cy={ly(sixth.rms)} r={4.5} fill={GRAPHIC.blue} stroke="#fcfcfb" strokeWidth={1.5} />
      {[0, 2, 4, 6, 8, 10].map((d) => (
        <text key={d} className="ax ax-m" x={lx(d)} y={388}>
          {d === 0 ? 'now' : `${d} days`}
        </text>
      ))}
    </svg>
  );
}

const MODEL_HOURS_PER_SECOND = 20;

export default function Lesson() {
  // Figure 1.
  const s = useScenario('engine', { dt: 1, wind: 12 });
  const { dt, wind } = s.state;
  const run = useMemo(() => runModel(START, wind, dt, RUN_HOURS), [wind, dt]);
  const play = usePlay(true);
  const [t, setT] = useState(0);
  useAnimationFrame((sec) => setT((x) => (x >= RUN_HOURS + 8 ? 0 : x + sec * MODEL_HOURS_PER_SECOND)), play.playing);
  const change = (patch: Partial<typeof s.state>) => {
    s.set(patch);
    setT(0);
  };
  const frame = Math.min(run.frames.length - 1, Math.floor(Math.min(t, RUN_HOURS) / dt + 1e-9));
  const hoursNow = run.hours[frame];
  const model = run.frames[frame];
  const truth = useMemo(() => truthField(WAVES, hoursNow / 24, wind, 0), [hoursNow, wind]);
  const blownUp = model.some((v) => Math.abs(v) >= 100);
  const err = rmsDiff(model, truth);
  const C = courantNumber(wind, dt);
  const solved = stepSolved(dt, wind);
  const solvedBlowUp = useMemo(() => (solved ? blowUpHour(wind, dt + DT_STEP) : null), [solved, wind, dt]);

  // Figure 2.
  const f = useScenario('forecast', FORECAST_DEFAULTS);
  // The land network is fixed: a station every three degrees.
  const fs = useMemo(() => ({ ...f.state, land: FORECAST_DEFAULTS.land }), [f.state]);
  const curve = useMemo(() => skillOf(fs), [fs]);
  const solved2 = windSolved(fs);
  const useful = usefulLead(curve);
  const six = at(curve, SKILL_LEAD);

  // Numbers the prose quotes.
  const nums = useMemo(() => {
    const diffusion = (step: number) => {
      const r = runModel(START, 12, step, RUN_HOURS);
      const last = r.frames[r.frames.length - 1];
      const tr = truthField(WAVES, RUN_HOURS / 24, 12, 0);
      return { rms: rmsDiff(last, tr), max: Math.max(...last), min: Math.min(...last), tMax: Math.max(...tr), tMin: Math.min(...tr) };
    };
    const base = skillOf(FORECAST_DEFAULTS);
    const ships = skillOf({ ...FORECAST_DEFAULTS, ocean: 4 });
    const perfect = skillOf({ ...FORECAST_DEFAULTS, ocean: 4, evolution: 0 });
    return {
      fieldRms: rmsDiff(START, new Float64Array(NX)),
      hourly: diffusion(1),
      quarter: diffusion(0.25),
      hourlyC: courantNumber(12, 1),
      quarterC: courantNumber(12, 0.25),
      exact: courantNumber(12, 1.75),
      blowUp: blowUpHour(12, 3),
      base: { d4: at(base, 4), d5: at(base, 5), d6: at(base, 6), useful: usefulLead(base) },
      ships: { d6: at(ships, 6), d10: at(ships, 10) },
      perfectMax: Math.max(...perfect.rms),
      edge: oceanEdgeDays(12),
      kmDay: (12 * 86400) / 1000,
    };
  }, []);

  const status = blownUp
    ? `At ${fmt(dt, 2)} h the Courant number is ${fmt(C, 2)}, and the model has blown up.`
    : `At ${fmt(dt, 2)} h the Courant number is ${fmt(C, 2)}${C > 1 ? ' — over 1, so errors are growing even if they don’t show yet' : ''}.`;

  return (
    <LessonPage id="weather/3.3">
      <P>
        Stations, radar and satellites tell us what the atmosphere is doing now. A forecast needs what it will do next. The atmosphere obeys known physical laws —
        the conservation of momentum, mass, energy and water — so in principle the state now determines the state later, and the future can be computed. In 1922
        Lewis Fry Richardson published a forecast worked out that way by hand, for a single six-hour step over two points in Europe. Its answer was wildly wrong,
        and he estimated that keeping pace with the real weather would take a hall of 64,000 people doing arithmetic. The first forecasts made by computer came in
        1950, on ENIAC, and a 24-hour forecast took about as long to compute as the day it forecast.
      </P>
      <P>
        Every weather model since works the same way. It covers the atmosphere with a grid of points, stores the temperature, wind, pressure and moisture at each, and
        applies the physical laws as rules for how each point changes over a short <b>time step</b>, given its neighbors. Then it repeats, step after step, until it
        reaches the time it was asked to forecast. Today’s global models use grid points of the order of 10 km apart and time steps of minutes.
      </P>
      <P>
        Our model keeps one process of the many: transport by the wind. The westerlies of <a href={lessonHref('weather/2.1')}>Lesson 2.1</a> carry the warm and cold
        air around the 41st parallel, which the model divides into 360 points, one per degree of longitude, {fmt(DX_KM)} km apart. Its rule is called{' '}
        <b>upwind</b>: in each step, each point moves part of the way toward the value of its western neighbor, the one the wind is blowing from. The fraction is the{' '}
        <K tone={WX.wind}>Courant number</K>, the share of a grid cell the wind crosses in one step:
      </P>
      <Eq label="The Courant number equals the wind speed times the time step divided by the grid spacing">
        <span>C</span>
        <Op>=</Op>
        <Frac
          top={
            <>
              <K tone={WX.wind}>U</K> · Δt
            </>
          }
          bottom="Δx"
        />
      </Eq>
      <P>
        In the next demonstration, temperatures are drawn as <b>anomalies</b>: departures from the normal temperature for the place and date, so that 0 means
        normal. The gray dashed line is the true pattern of warm and cold air, carried east exactly with the wind, and the red line is the model’s, stepped
        forward from the same starting state. Play it, step it, and change the wind and the model’s time step:
      </P>

      <Figure
        name="Mini Weather Engine"
        scenario={s}
        play={play}
        actions={
          <>
            <Button
              onClick={() => {
                play.setPlaying(false);
                setT(Math.min(RUN_HOURS, hoursNow + dt));
              }}
              disabled={hoursNow >= RUN_HOURS}
            >
              Step
            </Button>
            <Button onClick={() => setT(0)}>Restart</Button>
          </>
        }
      >
        <RingChart model={model} truth={truth} hours={hoursNow} unstable={blownUp} />
        <Legend
          items={[
            { label: 'Truth', color: TRUTH, kind: 'line', dashed: true },
            { label: 'Model', color: MODEL, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'model time', value: `${fmt(hoursNow, hoursNow % 1 ? 2 : 0)} h` },
            { label: 'steps taken', value: fmt(frame) },
            { label: 'model’s error', value: blownUp ? 'blown up' : `${fmt(err, 2)} °F`, tone: WX.temperature },
          ]}
        />
        <Slider label="Wind" tone={WX.wind} value={wind} min={WIND_MIN} max={WIND_MAX} onChange={(v) => change({ wind: v })} display={`${wind} m/s`} />
        <Slider label="Time step" value={dt} min={DT_MIN} max={DT_MAX} step={DT_STEP} onChange={(v) => change({ dt: v })} display={`${fmt(dt, 2)} h`} />
        <Eq label={`Courant number: ${wind} meters per second times ${fmt(dt, 2)} hours divided by ${fmt(DX_KM)} kilometers equals ${fmt(C, 2)}`}>
          <span>C</span>
          <Op>=</Op>
          <Frac
            top={
              <>
                <K tone={WX.wind}>{wind} m/s</K> × {fmt(dt * 3600)} s
              </>
            }
            bottom={`${fmt(DX_KM * 1000)} m`}
          />
          <Op>=</Op>
          <span style={{ color: C > 1 ? TEXT.red : undefined }}>{fmt(C, 2)}</span>
        </Eq>
      </Figure>

      <P>
        At the starting settings, a 12 m/s wind and an hour per step, the Courant number is {fmt(courantNumber(12, 1), 2)}, and the model keeps pace with the truth.
        But watch the peaks: they wear down. After five days the warmest air reads {fmt(nums.hourly.max, 1)} °F above normal instead of {fmt(nums.hourly.tMax, 1)},
        the coldest {fmt(-nums.hourly.min, 1)} below instead of {fmt(-nums.hourly.tMin, 1)}, and the model is off by {fmt(nums.hourly.rms, 2)} °F on average. Each
        step blends every point with its neighbor, and blending smears. This is <b>numerical diffusion</b>: an error that comes from the method, not from the
        physics. Surprisingly, a shorter time step makes it worse: at 15 minutes the error after five days is {fmt(nums.quarter.rms, 2)} °F, because the
        smearing grows with 1 − C, how far each step falls short of carrying the air a whole cell — {fmt(1 - nums.quarterC, 2)} at 15-minute steps against{' '}
        {fmt(1 - nums.hourlyC, 2)} at hourly ones. Only a finer grid, or a cleverer rule, reduces it.
      </P>
      <P>
        Now lengthen the step. As the Courant number approaches 1 the error shrinks, because at exactly 1 the rule copies each value one cell east per step — which is
        precisely what the wind does. Past 1, everything falls apart. At 3 hours per step the Courant number is {fmt(courantNumber(12, 3), 2)}, and within{' '}
        {fmt(nums.blowUp ?? 0)} model hours the values pass 100 °F. In one step the air now travels more than one grid cell, but the rule only looks one cell
        upwind; it is asked to deliver information from a point it can’t see, and instead of smoothing errors it amplifies them, a little more each step, starting
        with the tiniest wiggles left by rounding. The condition C ≤ 1 is the <b>CFL condition</b>, after Richard Courant, Kurt Friedrichs and Hans Lewy, who
        described it in 1928. Many modern models use cleverer schemes that relax it, but none escapes the trade between detail and computing time: halve the grid
        spacing and the same stretch of forecast takes many times the arithmetic.
      </P>

      <Challenge
        id="a"
        question={`Suppose the westerlies strengthen to ${CFL_WIND} m/s. Predict first from the Courant number, with grid points ${fmt(DX_KM)} km apart: what’s the longest time step, to the quarter hour, that keeps the model stable at that wind? Then set the wind and that step, and check.`}
        solved={solved}
        status={wind !== CFL_WIND ? `First set the wind to ${CFL_WIND} m/s.` : status}
        success={`Solved. At ${fmt(dt, 2)} h the wind carries the air ${fmt(C, 2)} of a grid cell per step; a quarter hour longer, ${fmt(courantNumber(CFL_WIND, dt + DT_STEP), 2)} — farther than the rule can see — and the model blows up${solvedBlowUp !== null ? ` within ${fmt(solvedBlowUp)} model hours` : ''}. The faster the wind, the shorter the step must be: the fastest wind sets the pace of the whole computation.`}
      />

      <H2>Where the forecast comes from</H2>
      <P>
        A perfect method is no use without a starting state, and the model can only carry forward what it was given. Forecasters call the starting state the{' '}
        <b>analysis</b>: the observations of Lessons <a href={lessonHref('weather/3.1')}>3.1</a> and <a href={lessonHref('weather/3.2')}>3.2</a>, combined into a
        value at every grid point. Ours is the simplest possible analysis — observations at some points, joined by straight lines — and the model now carries it
        east exactly, so that every error comes from the analysis or from the weather itself.
      </P>
      <P>
        For Fenwick Bay, that tells us where to look. At 12 m/s the air moves about {fmt(nums.kmDay)} km a day, so the air that will reach the city in a week is,
        right now, some {fmt(Math.round((nums.kmDay * 7) / 100) * 100)} km to the west. The forecast for any day is only as good as the analysis of the air that will arrive that day, wherever it is today.
        In the next demonstration, the upper chart is the western half of the circle at the moment the forecast starts, in one weather situation: the truth in gray,
        the analysis in red with its observations as dots, and numbers marking where the air that reaches Fenwick Bay on each of the next ten days is now. The lower
        chart is the forecast’s <K tone={WX.probability}>error</K> at Fenwick Bay by <b>lead time</b>, how many days ahead it looks, averaged over 40
        different situations, against the error of making no forecast at all — always forecasting normal, an anomaly of zero — dashed. It starts with a station every three degrees over land and no reports at all from the ocean:
      </P>

      <Figure name="Mini Weather Engine · forecasting Fenwick Bay" scenario={f}>
        <ForecastChart s={fs} curve={curve} />
        <Legend
          items={[
            { label: 'Truth', color: TRUTH, kind: 'line', dashed: true },
            { label: 'Analysis and observations', color: MODEL, kind: 'line' },
            { label: 'Forecast error', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Error of no forecast', color: TRUTH, kind: 'line', dashed: true },
            { label: 'Worse than no forecast', color: tint(GRAPHIC.red, 0.3) },
          ]}
        />
        <Readouts
          items={[
            { label: 'beats no forecast for', value: useful >= 10 ? 'all 10 days' : `${fmt(useful, useful % 1 ? 1 : 0)} days`, tone: WX.probability },
            { label: 'error at 2 days', value: `${fmt(at(curve, 2).rms, 1)} °F`, tone: WX.probability },
            { label: 'error at 6 days', value: `${fmt(six.rms, 1)} °F`, tone: six.rms >= six.none ? 'red' : WX.probability },
            { label: 'no forecast, 6 days', value: `${fmt(six.none, 1)} °F` },
          ]}
        />
        <Slider
          label="Reports from the ocean"
          value={fs.ocean}
          min={0}
          max={20}
          onChange={(v) => f.set({ ocean: v })}
          display={fs.ocean === 0 ? 'none' : `every ${fs.ocean}° (${km(fs.ocean)} km)`}
        />
        <Slider label="Wind" tone={WX.wind} value={fs.windMs} min={WIND_MIN} max={WIND_MAX} onChange={(v) => f.set({ windMs: v })} display={`${fs.windMs} m/s`} />
        <Slider
          label="Weather development"
          value={fs.evolution}
          min={0}
          max={0.6}
          step={0.1}
          onChange={(v) => f.set({ evolution: v })}
          display={fs.evolution === 0 ? 'none' : `×${fmt(fs.evolution, 1)}`}
        />
        <Caption>
          At {fs.windMs} m/s the air reaching Fenwick Bay {fmt(oceanEdgeDays(fs.windMs), 1)} days from now is at the ocean’s edge today;
          {fs.ocean === 0 ? ' nothing reports from the ocean, so everything beyond that is guesswork.' : ` the ocean reports every ${km(fs.ocean)} km.`}
        </Caption>
      </Figure>

      <P>
        For four days the forecast is good: at day 4 its error is {fmt(nums.base.d4.rms, 1)} °F, against {fmt(nums.base.d4.none, 1)} for no forecast at all. Then it
        collapses. At day 5 the error is {fmt(nums.base.d5.rms, 1)} °F and at day 6 it is {fmt(nums.base.d6.rms, 1)} — worse than the{' '}
        {fmt(nums.base.d6.none, 1)} of simply forecasting normal. The vertical line shows why: at 12 m/s, the air that arrives after {fmt(nums.edge, 1)} days was over
        the ocean when the forecast began, where the analysis had nothing but a straight line. A forecast built on that guess isn’t merely vague; it is
        confidently wrong, and here that is worse than no forecast. Now let the ocean report, every four degrees, as ships and today’s satellites do: the day-6
        error falls to {fmt(nums.ships.d6.rms, 1)} °F.
      </P>
      <P>
        Real analyses don’t bridge a gap with a straight line. They are built in a cycle: every few hours, the previous forecast — itself started from older
        observations — supplies a <b>first guess</b> at every grid point, and the new observations correct it wherever they exist. Over an unobserved ocean the
        first guess carries forward what was seen there earlier, so the analysis is weaker than over land, but rarely as blind as ours.
      </P>

      <Challenge
        id="b"
        figure="Mini Weather Engine · forecasting Fenwick Bay"
        question={`With no reports from the ocean and a station every three degrees over land, what’s the fastest wind at which Fenwick Bay’s ${SKILL_LEAD}-day forecast still beats no forecast at all?`}
        solved={solved2}
        status={
          fs.ocean !== 0
            ? 'First set the ocean reports to none.'
            : `At ${fs.windMs} m/s the ${SKILL_LEAD}-day error is ${fmt(six.rms, 2)} °F, against ${fmt(six.none, 2)} °F for no forecast${six.rms < six.none ? '. Could the wind be faster?' : '.'}`
        }
        success={`Solved. At ${fs.windMs} m/s the air arriving in ${SKILL_LEAD} days started ${fmt(fs.windMs * 86.4 * SKILL_LEAD)} km upstream, only ${fmt(Math.max(0, fs.windMs * 86.4 * SKILL_LEAD - (FENWICK_I - OCEAN.to) * DX_KM))} km out over the ocean, close enough to the last coastal station for the analysis to be roughly right. A meter per second faster and it comes from deeper in the unobserved ocean. The faster the westerlies, the farther upstream every forecast reaches — and the more it depends on observations far away.`}
      />

      <H2>Errors that grow anyway</H2>
      <P>
        Turn the weather’s development to none, so the true weather systems simply drift with the wind, and give the ocean its reports. The forecast is now nearly
        perfect at every lead: its error never exceeds {fmt(nums.perfectMax, 1)} °F. That is the dream of numerical prediction — good observations and a perfect
        model give a nearly perfect forecast. Now put the development back. Real weather systems strengthen, weaken and change course on their own, and our model, which
        only moves air around, knows nothing of it. Even with the ocean observed, the error climbs steadily, to {fmt(nums.ships.d10.rms, 1)} °F at ten days against{' '}
        {fmt(nums.ships.d10.none, 1)} for no forecast. This is <b>model error</b>: the truth doing something the model can’t. Silence the ocean again and turn the
        wind up to its fastest, and notice that the error dips at the longest leads: that air started beyond the ocean, over the well-observed land on its far
        side.
      </P>
      <P>
        Real models include the physics our model leaves out — the convection, fronts and storms of Chapters 1 and 2 — so they simulate the weather’s
        development instead of ignoring it. They still lose skill with lead time. The course’s simulated archive treats forecasts the same way: what can be known
        about a given day is revealed a little at a time. In it, {fmt(knownShare(1) * 100)}% of the variability in a day’s departure from normal can be known a day
        ahead, {fmt(knownShare(5) * 100)}% five days ahead, {fmt(knownShare(10) * 100)}% ten days ahead, and nothing beyond 15 days.
      </P>
      <P>
        Why should a model that does simulate the development, given almost perfect observations, still lose the future? Our model can’t show the answer. It only
        carries air along, and carrying an error along moves it without making it any bigger: with development off, the error from the analysis never exceeded{' '}
        {fmt(nums.perfectMax, 1)} °F in ten days. In the real atmosphere the development itself is the amplifier. The same instabilities that make storms grow
        make tiny errors in the analysis grow too, roughly doubling every couple of days at the scale of weather systems, until they are as large as the weather
        itself. That is chaos, and the next lesson takes a model small enough to watch it happen.
      </P>
    </LessonPage>
  );
}
