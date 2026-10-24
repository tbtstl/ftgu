import { useMemo } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
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
  Sup,
  TEXT,
  areaPath,
  fmt,
  lessonHref,
  linePath,
  pct,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import {
  RHO_STANDARD,
  RIDGE_MW,
  TURBINE,
  VALLEY_MW,
  airDensity,
  capacityFactor,
  hubSpeed,
  outputUnderUncertainty,
  powerCurve,
  solarDayMWh,
  solarShare,
  weibullPdf,
  weibullScaleFor,
} from '../../../engines/weather/renewables';
import { WIND_PPA, windYears, type WindYear } from '../../../engines/weather/exposure';
import { energyDay } from '../../../engines/weather/energyMarket';
import { DAYS, archive, knownShare } from '../../../model/weather/archive';
import { MONTH_NAMES, MONTH_START, monthOf } from '../../../model/weather/region';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The wind farm's site and its air.

/** Air pressure on Hollin Ridge, 700 m up, hPa. */
export const RIDGE_HPA = 930;
/** The ridge's average air temperature, °C, at which the farm's power curve is quoted. */
export const SITE_MEAN_C = 10;

/** Air density on the ridge at a temperature, kg/m³. */
export function ridgeDensity(tC: number): number {
  return airDensity(tC, RIDGE_HPA);
}

/** The density the power curve sees: the ridge's air relative to its average, on the curve's own scale. */
export function curveDensity(tC: number): number {
  return (ridgeDensity(tC) / ridgeDensity(SITE_MEAN_C)) * RHO_STANDARD;
}

export interface SiteState {
  /** Mean wind speed at hub height over the year, m/s. */
  mean: number;
  /** Weibull shape of the year's hourly speeds. */
  k: number;
  /** Air temperature, °C. */
  tempC: number;
}

export const SITE_DEFAULTS: SiteState = { mean: 7.6, k: 2.2, tempC: SITE_MEAN_C };

export function siteCf(s: SiteState): number {
  return capacityFactor(s.mean, s.k, curveDensity(s.tempC));
}

/** The first challenge: the lowest mean speed, on the slider's 0.1 m/s steps, that gives a 40% capacity factor at the starting shape and temperature. */
export const CF_TARGET = 0.4;
export function cfSolved(s: SiteState): boolean {
  if (Math.abs(s.k - SITE_DEFAULTS.k) > 1e-9 || s.tempC !== SITE_DEFAULTS.tempC) return false;
  const below = Math.round((s.mean - 0.1) * 10) / 10;
  return siteCf(s) >= CF_TARGET && siteCf({ ...s, mean: below }) < CF_TARGET;
}

// ---------------------------------------------------------------------------
// Forecasting the farm's output.

let climSd: number | null = null;
/** Day-to-day standard deviation of the ridge's daily mean wind in the simulated archive, m/s. */
export function windClimateSd(): number {
  if (climSd !== null) return climSd;
  const w = archive().wind;
  let s = 0;
  let s2 = 0;
  for (let d = 0; d < DAYS; d++) {
    s += w[d];
    s2 += w[d] * w[d];
  }
  const m = s / DAYS;
  climSd = Math.sqrt(s2 / DAYS - m * m);
  return climSd;
}

/**
 * A wind forecast's error `lead` days ahead, m/s: the climate's spread times the square root of
 * the share not yet known — assuming wind forecasts lose skill as fast as Lesson 3.5's
 * temperature forecasts.
 */
export function forecastSd(lead: number): number {
  return windClimateSd() * Math.sqrt(1 - knownShare(lead));
}

export interface ForecastState {
  /** Forecast wind speed at hub height for an hour, m/s. */
  speed: number;
  /** Days ahead. */
  lead: number;
}

export const FORECAST_DEFAULTS: ForecastState = { speed: 8, lead: 3 };
/** The second challenge's lead, days. */
export const CHALLENGE_LEAD = 3;
const SPEED_STEP = 0.5;

/** The forecast speed, up to rated and on the slider's steps, at which the output is most uncertain. */
export function mostUncertainSpeed(lead: number): number {
  const sd = forecastSd(lead);
  let best = -1;
  let at = 0;
  for (let v = 0; v <= TURBINE.rated + 1e-9; v += SPEED_STEP) {
    const o = outputUnderUncertainty(v, sd);
    if (o.sd > best + 1e-12) {
      best = o.sd;
      at = v;
    }
  }
  return at;
}

export function uncertaintySolved(s: ForecastState): boolean {
  return s.lead === CHALLENGE_LEAD && Math.abs(s.speed - mostUncertainSpeed(CHALLENGE_LEAD)) < 1e-9;
}

/** How the output is spread across 20 bins of 5% of the rating, when the speed is Normal(mean, sd), truncated at zero. */
export function outputHistogram(mean: number, sd: number, bins = 20): number[] {
  const out = new Array<number>(bins).fill(0);
  if (sd <= 1e-6) {
    out[Math.min(bins - 1, Math.floor(powerCurve(mean) * bins))] = 1;
    return out;
  }
  const n = 400;
  let w = 0;
  for (let i = 0; i < n; i++) {
    const z = -4 + (8 * (i + 0.5)) / n;
    const pdf = Math.exp(-(z * z) / 2);
    const p = powerCurve(Math.max(0, mean + sd * z));
    out[Math.min(bins - 1, Math.floor(p * bins))] += pdf;
    w += pdf;
  }
  return out.map((v) => v / w);
}

let yearsCache: WindYear[] | null = null;
/** Hollin Ridge's output in each of the archive's 41 years, computed once. */
export function ridgeYears(): WindYear[] {
  if (!yearsCache) yearsCache = windYears();
  return yearsCache;
}

// ---------------------------------------------------------------------------
// Drawing.

const WIND = GRAPHIC.violet;
const OUT = GRAPHIC.gold;
const FC = GRAPHIC.blue;
const V_MAX = 28;

function SpeedTicks({ x, y }: { x: (v: number) => number; y: number }) {
  return (
    <g>
      {[0, 5, 10, 15, 20, 25].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={y}>
          {v}
        </text>
      ))}
    </g>
  );
}

function CurveMarks({ x, top, bottom }: { x: (v: number) => number; top: number; bottom: number }) {
  const marks: Array<[number, string]> = [
    [TURBINE.cutIn, 'cut-in'],
    [TURBINE.rated, 'rated'],
    [TURBINE.cutOut, 'cut-out'],
  ];
  return (
    <g>
      {marks.map(([v, label]) => (
        <g key={label}>
          <line x1={x(v)} x2={x(v)} y1={top} y2={bottom} stroke="#cfcfcf" strokeDasharray="3 4" />
          <text className="ax ax-m" x={x(v)} y={top - 4}>
            {label}
          </text>
        </g>
      ))}
    </g>
  );
}

const WX0 = 60;
const WX1 = 616;
const wx = scale(0, V_MAX, WX0, WX1);
const wy = scale(0, 1, 252, 36);
const SPEEDS = Array.from({ length: 4 * V_MAX + 1 }, (_, i) => i / 4);
/** Pixels per unit of probability density; fixed, so the violet area is always the same. */
const PDF_PX = 700;

function SiteChart({ s, cf }: { s: SiteState; cf: number }) {
  const rho = curveDensity(s.tempC);
  const c = weibullScaleFor(s.mean, s.k);
  const pdf = SPEEDS.map((v) => Math.min(200, weibullPdf(v, s.k, c) * PDF_PX));
  const curve = SPEEDS.map((v) => powerCurve(v, rho));
  const energy = SPEEDS.map((_, i) => pdf[i] * curve[i]);
  const xs = SPEEDS.map(wx);
  const base = wy(0);
  const atMean = powerCurve(s.mean, rho);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 290"
      role="img"
      aria-label={`Power curve of Hollin Ridge's turbines with the year's wind speeds at hub height: a mean of ${fmt(s.mean, 1)} m/s with a Weibull shape of ${fmt(s.k, 1)}, in air at ${fmt(s.tempC)} °C. The farm averages ${pct(cf, 1)} of its rating over the year, against ${pct(atMean, 1)} at the mean speed.`}
    >
      <text className="ax" x={WX0} y={14}>
        Output, share of the farm’s {fmt(RIDGE_MW)} MW
      </text>
      <GridY y={wy} ticks={[0, 0.25, 0.5, 0.75, 1]} x0={WX0} x1={WX1} format={(v) => pct(v)} baseline={0} />
      <CurveMarks x={wx} top={46} bottom={base} />
      <path d={areaPath(xs, pdf.map((p) => base - p), xs.map(() => base))} fill={tint(WIND, 0.35)} />
      <path d={areaPath(xs, energy.map((p) => base - p), xs.map(() => base))} fill={tint(OUT, 0.75)} />
      <path d={linePath(xs, pdf.map((p) => base - p))} fill="none" stroke={WIND} strokeWidth={1.5} />
      <path d={linePath(xs, curve.map(wy))} fill="none" stroke={OUT} strokeWidth={3} strokeLinejoin="round" />
      <line x1={wx(s.mean)} x2={wx(s.mean)} y1={wy(atMean)} y2={base} stroke={TEXT.violet} strokeWidth={1.5} strokeDasharray="5 4" />
      <circle cx={wx(s.mean)} cy={wy(atMean)} r={5} fill={OUT} stroke="#fcfcfb" strokeWidth={2} />
      <text className="ax" x={wx(s.mean) + 8} y={wy(atMean) - 8} style={{ fill: TEXT.violet }}>
        mean {fmt(s.mean, 1)} m/s
      </text>
      <line x1={WX0} x2={WX1} y1={wy(cf)} y2={wy(cf)} stroke={TEXT.gold} strokeWidth={1.2} strokeDasharray="2 3" />
      <text className="ax ax-e" x={WX1} y={wy(cf) - 5} style={{ fill: TEXT.gold }}>
        year’s average {pct(cf, 1)}
      </text>
      <SpeedTicks x={wx} y={270} />
      <text className="ax ax-e" x={WX1} y={286}>
        wind speed at hub height, m/s
      </text>
    </svg>
  );
}

const SX = scale(0, 24, 60, 616);
const SY = scale(0, VALLEY_MW, 200, 24);
const HOURS = Array.from({ length: 97 }, (_, i) => i / 4);

function SolarChart({ doy, cloud, airC }: { doy: number; cloud: number; airC: number }) {
  const clear = HOURS.map((h) => solarShare(doy, h, 0, airC) * VALLEY_MW);
  const now = HOURS.map((h) => solarShare(doy, h, cloud, airC) * VALLEY_MW);
  const xs = HOURS.map(SX);
  const mwh = solarDayMWh(doy, cloud, airC);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 236"
      role="img"
      aria-label={`Valley solar's output through ${dateLabel(doy)} with ${pct(cloud)} cloud cover at ${fmt(airC)} °C: ${fmt(mwh)} MWh over the day, peaking at ${fmt(Math.max(...now))} MW against ${fmt(Math.max(...clear))} MW under a clear sky.`}
    >
      <text className="ax" x={60} y={12}>
        Valley solar’s output, MW
      </text>
      <GridY y={SY} ticks={[0, 100, 200, 300, 400]} x0={60} x1={616} baseline={0} />
      <path d={areaPath(xs, now.map(SY), xs.map(() => SY(0)))} fill={tint(OUT, 0.55)} />
      <path d={linePath(xs, now.map(SY))} fill="none" stroke={OUT} strokeWidth={2.5} />
      <path d={linePath(xs, clear.map(SY))} fill="none" stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="5 4" />
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} className="ax ax-m" x={SX(h)} y={218}>
          {String(h).padStart(2, '0')}:00
        </text>
      ))}
      <text className="ax ax-e" x={616} y={234}>
        solar time
      </text>
    </svg>
  );
}

function dateLabel(doy: number): string {
  const m = monthOf(doy);
  return `${MONTH_NAMES[m]} ${doy - MONTH_START[m] + 1}`;
}

const TX = scale(0, V_MAX, 60, 420);
const TY = scale(0, 1, 236, 30);
const BAR_X = 470;
const BAR_W = 140;

function TransferChart({ s, sd }: { s: ForecastState; sd: number }) {
  const o = outputUnderUncertainty(s.speed, sd);
  const hist = outputHistogram(s.speed, sd);
  const maxBin = Math.max(...hist);
  const xs = SPEEDS.map(TX);
  const curve = SPEEDS.map((v) => TY(powerCurve(v)));
  const base = TY(0);
  const peak = sd > 1e-6 ? 1 / (sd * Math.sqrt(2 * Math.PI)) : 1;
  const fpdf = SPEEDS.map((v) => (sd > 1e-6 ? (70 * Math.exp(-(((v - s.speed) / sd) ** 2) / 2) * (1 / (sd * Math.sqrt(2 * Math.PI)))) / peak : 0));
  const atForecast = powerCurve(s.speed);
  const binH = (TY(0) - TY(1)) / hist.length;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 276"
      role="img"
      aria-label={`A forecast of ${fmt(s.speed, 1)} m/s, ${s.lead} days ahead, with an error of ±${fmt(sd, 1)} m/s, pushed through the power curve. Expected output ${pct(o.mean)} of the rating; the curve at the forecast speed says ${pct(atForecast)}; there's a 10% chance of less than ${pct(o.p10)} and a 10% chance of more than ${pct(o.p90)}.`}
    >
      <text className="ax" x={60} y={14}>
        Output, share of {fmt(RIDGE_MW)} MW
      </text>
      <GridY y={TY} ticks={[0, 0.25, 0.5, 0.75, 1]} x0={60} x1={420} format={(v) => pct(v)} baseline={0} />
      <CurveMarks x={TX} top={40} bottom={base} />
      {sd > 1e-6 && (
        <g>
          <rect x={TX(Math.max(0, s.speed - sd))} y={30} width={TX(Math.min(V_MAX, s.speed + sd)) - TX(Math.max(0, s.speed - sd))} height={base - 30} fill={FC} opacity={0.07} />
          <path d={areaPath(xs, fpdf.map((p) => base - p), xs.map(() => base))} fill={tint(FC, 0.3)} />
          <path d={linePath(xs, fpdf.map((p) => base - p))} fill="none" stroke={FC} strokeWidth={1.5} />
        </g>
      )}
      <path d={linePath(xs, curve)} fill="none" stroke={OUT} strokeWidth={3} strokeLinejoin="round" />
      <line x1={TX(s.speed)} x2={TX(s.speed)} y1={TY(atForecast)} y2={base} stroke={TEXT.blue} strokeWidth={1.5} strokeDasharray="5 4" />
      <circle cx={TX(s.speed)} cy={TY(atForecast)} r={5} fill="#fcfcfb" stroke="#555" strokeWidth={1.5} />
      {/* Expected output, across both panels. */}
      <line x1={60} x2={BAR_X + BAR_W} y1={TY(o.mean)} y2={TY(o.mean)} stroke={TEXT.gold} strokeWidth={1.5} strokeDasharray="6 4" />
      <text className="ax ax-e" x={BAR_X + BAR_W} y={TY(o.mean) - 5} style={{ fill: TEXT.gold, fontWeight: 600 }}>
        expected {pct(o.mean)}
      </text>
      {/* The output's distribution, sideways. */}
      <text className="ax" x={BAR_X} y={14}>
        Chance of each output
      </text>
      <line className="base" x1={BAR_X} x2={BAR_X} y1={30} y2={base} />
      {hist.map((p, i) => (
        <rect
          key={i}
          x={BAR_X}
          y={base - (i + 1) * binH + 0.5}
          width={maxBin > 0 ? (BAR_W * p) / maxBin : 0}
          height={binH - 1}
          fill={OUT}
          opacity={p > 0 ? 0.75 : 0}
        />
      ))}
      {hist[0] > 0.02 && (
        <text className="ax" x={BAR_X + 4 + (BAR_W * hist[0]) / maxBin} y={base - 2}>
          {pct(hist[0])}
        </text>
      )}
      {hist[hist.length - 1] > 0.02 && (
        <text className="ax" x={BAR_X + 4 + Math.min(BAR_W - 30, (BAR_W * hist[hist.length - 1]) / maxBin)} y={TY(1) + binH - 2}>
          {pct(hist[hist.length - 1])}
        </text>
      )}
      <SpeedTicks x={TX} y={254} />
      <text className="ax ax-e" x={420} y={270}>
        forecast wind speed, m/s
      </text>
    </svg>
  );
}

const YX = scale(0.5, 41.5, 60, 616);

function YearsChart({ years }: { years: WindYear[] }) {
  const lo = 800_000;
  const hi = 1_200_000;
  const y = scale(lo, hi, 106, 20);
  const mean = years.reduce((s, v) => s + v.mwh, 0) / years.length;
  const w = (YX(2) - YX(1)) * 0.7;
  const min = years.reduce((a, b) => (b.mwh < a.mwh ? b : a));
  const max = years.reduce((a, b) => (b.mwh > a.mwh ? b : a));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 138"
      role="img"
      aria-label={`Hollin Ridge's output in each of the simulated archive's 41 years: an average of ${fmt(mean / 1e6, 2)} million MWh, from ${fmt(min.mwh / 1e6, 2)} million in year ${min.year} to ${fmt(max.mwh / 1e6, 2)} million in year ${max.year}.`}
    >
      <text className="ax" x={60} y={10}>
        Hollin Ridge’s output in each of the archive’s years, MWh
      </text>
      <GridY y={y} ticks={[800_000, 1_000_000, 1_200_000]} x0={60} x1={616} format={(v) => `${fmt(v / 1e6, 1)}M`} />
      {years.map((yr) => (
        <rect key={yr.year} x={YX(yr.year) - w / 2} y={y(yr.mwh)} width={w} height={y(lo) - y(yr.mwh)} fill={yr === min || yr === max ? OUT : tint(OUT, 0.55)} />
      ))}
      <line x1={60} x2={616} y1={y(mean)} y2={y(mean)} stroke={TEXT.gold} strokeDasharray="5 4" />
      {[1, 10, 20, 30, 41].map((yr) => (
        <text key={yr} className="ax ax-m" x={YX(yr)} y={122}>
          {yr === 1 ? 'year 1' : yr}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('site', SITE_DEFAULTS);
  const st = s.state;
  const cf = useMemo(() => siteCf(st), [st]);
  const solved = useMemo(() => cfSolved(st), [st]);
  const rho = ridgeDensity(st.tempC);
  const atMean = powerCurve(st.mean, curveDensity(st.tempC));

  const sol = useScenario('solar', { doy: 171, cloud: 0, airC: 25 });
  const { doy, cloud, airC } = sol.state;
  const solarMWh = solarDayMWh(doy, cloud, airC);
  const noonMW = solarShare(doy, 12, cloud, airC) * VALLEY_MW;

  const f = useScenario('forecast', FORECAST_DEFAULTS);
  const fs = f.state;
  const sd = forecastSd(fs.lead);
  const o = outputUnderUncertainty(fs.speed, sd);
  const solved2 = uncertaintySolved(fs);
  const years = useMemo(() => ridgeYears(), []);

  // Numbers the prose quotes, from the same models the figures run.
  const nums = useMemo(() => {
    const ref = SITE_DEFAULTS;
    const cfRef = siteCf(ref);
    const c = weibullScaleFor(ref.mean, ref.k);
    const mwh = years.map((y) => y.mwh);
    const mean = mwh.reduce((a, b) => a + b, 0) / mwh.length;
    const sdYears = Math.sqrt(mwh.reduce((a, b) => a + (b - mean) ** 2, 0) / mwh.length);
    const min = years.reduce((a, b) => (b.mwh < a.mwh ? b : a));
    const max = years.reduce((a, b) => (b.mwh > a.mwh ? b : a));
    const calm = energyDay({ doy: 20, meanF: 25, windMs: 3, cloud: 0.4 });
    const windy = energyDay({ doy: 20, meanF: 25, windMs: 13, cloud: 0.4 });
    return {
      cfRef,
      mwhRef: cfRef * RIDGE_MW * 8760,
      curveAtMean: powerCurve(ref.mean),
      at5: powerCurve(5),
      at10: powerCurve(10),
      calmShare: 1 - Math.exp(-((TURBINE.cutIn / c) ** ref.k)),
      ratedShare: Math.exp(-((TURBINE.rated / c) ** ref.k)),
      cold: siteCf({ ...ref, tempC: -10 }),
      hot: siteCf({ ...ref, tempC: 30 }),
      calmSite: [capacityFactor(6, 1.6, RHO_STANDARD), capacityFactor(6, 3, RHO_STANDARD)],
      windySite: [capacityFactor(9, 1.6, RHO_STANDARD), capacityFactor(9, 3, RHO_STANDARD)],
      kHere: [siteCf({ ...ref, k: 1.6 }), siteCf({ ...ref, k: 3 })],
      height: hubSpeed(1, 100),
      powerDensity: 0.5 * ridgeDensity(SITE_MEAN_C) * ref.mean ** 3,
      sd1: forecastSd(1),
      sd3: forecastSd(3),
      sd5: forecastSd(5),
      clim: windClimateSd(),
      at8: outputUnderUncertainty(8, forecastSd(3)),
      at14: outputUnderUncertainty(14, forecastSd(3)),
      at4: outputUnderUncertainty(4, forecastSd(3)),
      junDay: solarDayMWh(171, 0, 25),
      decDay: solarDayMWh(354, 0, 0),
      junHalf: solarDayMWh(171, 0.5, 25),
      junOvercast: solarDayMWh(171, 1, 25),
      junCold: solarDayMWh(171, 0, 0),
      junHot: solarDayMWh(171, 0, 35),
      yearsMean: mean,
      yearsSd: sdYears,
      min,
      max,
      calmPrice: calm.avgPrice,
      windyPrice: windy.avgPrice,
    };
  }, [years]);

  return (
    <LessonPage id="weather/4.4">
      <P>
        In <a href={lessonHref('weather/4.2')}>Lesson 4.2</a> the wind and the sun entered the region’s power system as supply that costs nothing to run, pushing
        prices down whenever they were plentiful. In that model, a cold winter day with a strong wind on Hollin Ridge averages {usd(nums.windyPrice)} per MWh
        against {usd(nums.calmPrice)} on a calm one. This lesson looks at the plants themselves: how much the weather lets them produce, and how well anyone can
        know it in advance. For a wind farm or a solar farm, the weather isn’t a source of demand or of cost. It is the fuel.
      </P>
      <P>
        Moving air carries kinetic energy, and the power it carries through each square meter facing it is ½ρv³: proportional to the air’s{' '}
        <K tone={WX.density}>density</K> ρ and to the cube of its <K tone={WX.wind}>speed</K> v. Double the wind and the power in it rises eightfold. A turbine
        captures part of that power along its <K tone={WX.energy}>power curve</K>. Below a <b>cut-in</b> speed of about {TURBINE.cutIn} m/s it doesn’t turn
        usefully at all. From there its output climbs with the cube of the speed until, at the <b>rated</b> speed of {TURBINE.rated} m/s, it reaches its full
        rating, and from then on the blades are turned to spill the excess so the generator isn’t overloaded. Beyond a <b>cut-out</b> speed of {TURBINE.cutOut}{' '}
        m/s the turbine shuts down to protect itself.
      </P>
      <P>
        The wind farm on Hollin Ridge has {fmt(RIDGE_MW)} MW of turbines — the Ridge wind farm of the electricity course, set in the Calder region. In the next
        demonstration, the gold line is the farm’s power curve, and the violet area shows how often the wind blows at each speed at the height of the turbines’
        hubs over a year, an hour at a time. Wind speeds are well described by a <b>Weibull distribution</b>, set by its mean and a shape: a low shape means a wide
        spread of calms and gales, a high one a steadier wind. The darker gold area, the curve times the violet one, shows where the year’s energy comes from.
        Change the wind and the air:
      </P>

      <Figure name="Wind and Solar Output Lab" scenario={s}>
        <SiteChart s={st} cf={cf} />
        <Legend
          items={[
            { label: 'Power curve', color: OUT, kind: 'line' },
            { label: 'How often each speed blows', color: tint(WIND, 0.5) },
            { label: 'Where the energy comes from', color: tint(OUT, 0.75) },
          ]}
        />
        <Readouts
          items={[
            { label: 'capacity factor', value: pct(cf, 1), tone: WX.energy },
            { label: 'a year’s output', value: `${fmt((cf * RIDGE_MW * 8760) / 1e6, 2)} million MWh`, tone: WX.energy },
            { label: 'output at the mean speed', value: pct(atMean, 1), tone: WX.energy },
            { label: 'air density on the ridge', value: `${fmt(rho, 3)} kg/m³`, tone: WX.density },
          ]}
        />
        <Slider label="Mean wind speed" tone={WX.wind} value={st.mean} min={4} max={11} step={0.1} onChange={(v) => s.set({ mean: v })} display={`${fmt(st.mean, 1)} m/s`} />
        <Slider label="Shape of the distribution" value={st.k} min={1.4} max={3.5} step={0.1} onChange={(v) => s.set({ k: v })} display={fmt(st.k, 1)} />
        <Slider label="Air temperature" tone={WX.temperature} value={st.tempC} min={-20} max={35} onChange={(v) => s.set({ tempC: v })} display={`${fmt(st.tempC)} °C`} />
        <Eq label={`Power in the wind at the mean speed: one half times ${fmt(rho, 3)} kilograms per cubic meter times ${fmt(st.mean, 1)} meters per second cubed equals ${fmt(0.5 * rho * st.mean ** 3)} watts per square meter`}>
          <Frac top="P" bottom="A" />
          <Op>=</Op>
          <span>½</span>
          <K tone={WX.density}>{fmt(rho, 3)} kg/m³</K>
          <Op>×</Op>
          <span>
            (<K tone={WX.wind}>{fmt(st.mean, 1)} m/s</K>)<Sup>3</Sup>
          </span>
          <Op>=</Op>
          <K tone={WX.energy}>{fmt(0.5 * rho * st.mean ** 3)} W/m²</K>
        </Eq>
      </Figure>

      <P>
        The starting wind averages {fmt(SITE_DEFAULTS.mean, 1)} m/s, and the farm averages {pct(nums.cfRef, 1)} of its rating over the year — its{' '}
        <K tone={WX.energy}>capacity factor</K> — about {fmt(nums.mwhRef / 1e6, 2)} million MWh. Yet the curve at the mean speed gives only{' '}
        {pct(nums.curveAtMean, 1)}. The mean wind understates the energy because the cube makes the windy hours count for far more than the calm ones: going from
        5 to 10 m/s takes the farm from {pct(nums.at5, 1)} of its rating to {pct(nums.at10)}, nearly ten times as much. For about {pct(nums.calmShare)} of the
        year’s hours the wind is below cut-in and the farm makes nothing; for about {pct(nums.ratedShare)} it is past rated and the farm runs flat out.
      </P>
      <P>
        So the shape of the distribution matters, but not always the same way. At a calm site averaging 6 m/s, a wide spread of speeds is worth having: the farm
        averages {pct(nums.calmSite[0])} with a shape of 1.6 against {pct(nums.calmSite[1])} with a steady 3.0, because only the gusty hours turn the blades hard.
        At a windy site averaging 9 m/s it is the other way round, {pct(nums.windySite[0])} against {pct(nums.windySite[1])}: a wide spread wastes hours above rated
        and below cut-in. Hollin Ridge sits near the crossover, where the shape matters little: from 1.6 to 3.0 its capacity factor moves only from{' '}
        {pct(nums.kHere[0], 1)} to {pct(nums.kHere[1], 1)}.
      </P>
      <P>
        The air matters too. The ridge stands 700 m up, where the pressure is about {fmt(RIDGE_HPA)} hPa, and its air weighs {fmt(ridgeDensity(-10), 3)} kg/m³ at
        −10 °C against {fmt(ridgeDensity(30), 3)} at 30 °C, as the gas law of <a href={lessonHref('weather/1.2')}>Lesson 1.2</a> says it must. Below rated, the
        output is proportional to the density, so the same winds give a capacity factor of {pct(nums.cold, 1)} in −10 °C air and {pct(nums.hot, 1)} in 30 °C air.
        The gain is smaller than the difference in density because hours at rated can’t gain anything. And the wind grows with height: over open land, the speed
        at a 100 m hub is about {fmt(nums.height, 2)} times the speed at the 10 m mast of a weather station (<a href={lessonHref('weather/3.1')}>Lesson 3.1</a>),
        which, cubed, is why turbines are so tall.
      </P>

      <Challenge
        id="a"
        question={`Keep the shape at ${fmt(SITE_DEFAULTS.k, 1)} and the air at ${SITE_DEFAULTS.tempC} °C. What is the lowest mean wind speed, to 0.1 m/s, that gives the farm a capacity factor of 40%?`}
        solved={solved}
        status={
          Math.abs(st.k - SITE_DEFAULTS.k) > 1e-9 || st.tempC !== SITE_DEFAULTS.tempC
            ? `First set the shape back to ${fmt(SITE_DEFAULTS.k, 1)} and the temperature to ${SITE_DEFAULTS.tempC} °C.`
            : `At ${fmt(st.mean, 1)} m/s the capacity factor is ${pct(cf, 1)}.`
        }
        success={`Solved. At ${fmt(st.mean, 1)} m/s the farm averages ${pct(cf, 1)} of its rating, against ${pct(nums.cfRef, 1)} at ${fmt(SITE_DEFAULTS.mean, 1)} m/s: a ${fmt(((st.mean - SITE_DEFAULTS.mean) / SITE_DEFAULTS.mean) * 100)}% windier site makes ${fmt(((cf - nums.cfRef) / nums.cfRef) * 100)}% more energy. That leverage is why developers measure a site’s wind for a year or more before they build on it.`}
      />

      <P>
        Valley solar, the region’s {fmt(VALLEY_MW)} MW solar farm, follows the sun instead. Its output is set by the sun’s height in the sky, by cloud and, less
        obviously, by heat: a silicon panel loses about 0.4% of its output for each degree it runs above 25 °C. In the next demonstration, the gold area is its
        output through one day and the dashed line the same day with a clear sky. Change the date, the cloud cover and the air temperature:
      </P>

      <Figure name="Wind and Solar Output Lab · solar" scenario={sol}>
        <SolarChart doy={doy} cloud={cloud} airC={airC} />
        <Readouts
          items={[
            { label: 'the day’s output', value: `${fmt(solarMWh)} MWh`, tone: WX.energy },
            { label: 'share of the day’s 24 hours at full output', value: pct(solarMWh / (VALLEY_MW * 24), 1), tone: WX.energy },
            { label: 'at noon', value: `${fmt(noonMW)} MW`, tone: WX.energy },
          ]}
        />
        <Slider label="Date" value={doy} min={0} max={364} onChange={(v) => sol.set({ doy: v })} display={dateLabel(doy)} />
        <Slider label="Cloud cover" tone={WX.moisture} value={cloud} min={0} max={1} step={0.05} onChange={(v) => sol.set({ cloud: v })} display={pct(cloud)} />
        <Slider label="Air temperature" tone={WX.temperature} value={airC} min={-10} max={35} onChange={(v) => sol.set({ airC: v })} display={`${fmt(airC)} °C`} />
      </Figure>

      <P>
        A clear June day at 25 °C gives {fmt(nums.junDay)} MWh, a clear day in late December only {fmt(nums.decDay)}: the winter sun is low and up for barely nine
        hours. Cloud works unevenly. In the model, which uses an empirical relation fitted to measurements by Kasten and Czeplak, a sky half covered in cloud costs
        a June day only {pct(1 - nums.junHalf / nums.junDay)}, because scattered cloud lets direct sun through between its gaps, while a fully overcast sky cuts it
        to {fmt(nums.junOvercast)} MWh, less than that clear December day. Heat costs less than either: the same clear June sky gives {fmt(nums.junCold)} MWh in
        0 °C air and {fmt(nums.junHot)} at 35 °C.
      </P>

      <H2>Forecasting tomorrow’s output</H2>
      <P>
        A wind farm sells its power ahead of time, and the grid operator schedules the other plants around it, so everyone needs to know tomorrow’s output, not
        just next year’s. The forecast of the wind has an error, like the temperature forecasts of <a href={lessonHref('weather/3.5')}>Lesson 3.5</a>. The course’s
        simulated archive doesn’t forecast the wind, so this demonstration assumes its forecasts lose skill at the same rate as those temperature forecasts: the
        error is the day-to-day spread of the ridge’s wind, {fmt(nums.clim, 1)} m/s, times the square root of the share not yet known — about{' '}
        {fmt(nums.sd1, 1)} m/s a day ahead, {fmt(nums.sd3, 1)} at three days and {fmt(nums.sd5, 1)} at five.
      </P>
      <P>
        In the next demonstration, the blue bell is the <K tone={WX.probability}>forecast</K> of an hour’s wind speed, and the bars on the right show what it
        becomes once it passes through the power curve: the chance of each level of output. Change the forecast speed and how many days ahead it was made:
      </P>

      <Figure name="Wind and Solar Output Lab · forecast uncertainty" scenario={f}>
        <TransferChart s={fs} sd={sd} />
        <Legend
          items={[
            { label: 'Forecast wind speed', color: tint(FC, 0.5) },
            { label: 'Power curve', color: OUT, kind: 'line' },
            { label: 'Chance of each output', color: tint(OUT, 0.75) },
          ]}
        />
        <Readouts
          items={[
            { label: 'expected output', value: `${fmt(o.mean * RIDGE_MW)} MW`, tone: WX.energy },
            { label: 'the curve at the forecast speed', value: `${fmt(powerCurve(fs.speed) * RIDGE_MW)} MW`, tone: WX.energy },
            { label: '10% to 90% chance range', value: `${fmt(o.p10 * RIDGE_MW)}–${fmt(o.p90 * RIDGE_MW)} MW`, tone: WX.probability },
            { label: 'standard deviation', value: `${fmt(o.sd * RIDGE_MW)} MW`, tone: WX.probability },
          ]}
        />
        <Slider label="Forecast wind speed" tone={WX.wind} value={fs.speed} min={0} max={V_MAX} step={SPEED_STEP} onChange={(v) => f.set({ speed: v })} display={`${fmt(fs.speed, 1)} m/s`} />
        <Slider label="Days ahead" tone={WX.probability} value={fs.lead} min={1} max={10} onChange={(v) => f.set({ lead: v })} display={`${fs.lead} · ±${fmt(sd, 1)} m/s`} />
        <YearsChart years={years} />
      </Figure>

      <P>
        Three days ahead, a forecast of 8 m/s is a forecast of {pct(powerCurve(8))} of the farm’s rating if taken at face value, but the curve bends upward, so
        the windier outcomes gain more than the calmer ones lose and the expected output is higher, {pct(nums.at8.mean)}. The range is wide: a 10% chance of less
        than {pct(nums.at8.p10)} and a 10% chance of more than {pct(nums.at8.p90)}, or {fmt(nums.at8.p10 * RIDGE_MW)} to {fmt(nums.at8.p90 * RIDGE_MW)} MW. Move the
        forecast to 14 m/s and the output is nearly certain, {pct(nums.at14.mean)} expected with a 90% chance of at least {pct(nums.at14.p10)}, because the curve
        is flat past rated and a miss in the wind barely shows. At 4 m/s it is small and certain to stay small. The output is most uncertain where the curve is
        steepest. And at the cut-out speed it is all or nothing: a forecast of 25 m/s means the farm either runs flat out or shuts down.
      </P>

      <Challenge
        id="b"
        question={`Keep the forecast ${CHALLENGE_LEAD} days ahead. At what forecast speed, up to the rated ${TURBINE.rated} m/s, is the farm’s output most uncertain — the widest spread of outcomes?`}
        solved={solved2}
        status={
          fs.lead !== CHALLENGE_LEAD
            ? `First set the forecast back to ${CHALLENGE_LEAD} days ahead.`
            : fs.speed > TURBINE.rated
              ? `Stay at or below the rated ${TURBINE.rated} m/s.`
              : `At ${fmt(fs.speed, 1)} m/s the output’s standard deviation is ${fmt(o.sd * RIDGE_MW)} MW.`
        }
        success={`Solved. At ${fmt(fs.speed, 1)} m/s the standard deviation is ${fmt(o.sd * RIDGE_MW)} MW, the most of any speed up to rated. It sits a little below rated, where the curve is steepest, so that a forecast miss in either direction swings the output by the most. A grid operator facing a forecast like this keeps the most reserve; a trader who sold the output ahead faces the widest range of shortfalls to buy back.`}
      />

      <P>
        The bars in <FigRef to="Wind and Solar Output Lab · forecast uncertainty">this demonstration</FigRef> are the same risk over a longer span. No forecast can
        see next year’s wind (<a href={lessonHref('weather/3.4')}>Lesson 3.4</a>), so the farm’s output from one year to the next is simply weather. In the
        simulated archive, Hollin Ridge averaged {fmt(nums.yearsMean / 1e6, 2)} million MWh a year — close to the {fmt(nums.mwhRef / 1e6, 2)} million of the first
        demonstration’s starting wind — with a standard deviation of {fmt(nums.yearsSd)} MWh, about {pct(nums.yearsSd / nums.yearsMean)}. Its worst year, year{' '}
        {nums.min.year}, made {fmt(nums.min.mwh / 1e6, 2)} million MWh, a capacity factor of {pct(nums.min.cf, 1)}; its best, year {nums.max.year},{' '}
        {fmt(nums.max.mwh / 1e6, 2)} million at {pct(nums.max.cf, 1)}. The farm sells under a long-term contract at {usd(WIND_PPA)} per MWh, so its price is fixed and
        its risk is all in the volume: revenue of {usd(nums.min.revenue / 1e6, 1)} million in the worst year and {usd(nums.max.revenue / 1e6, 1)} million in the
        best, from the same turbines and the same costs.
      </P>
      <P>
        That is weather exposure in its plainest form: a business whose income depends on a physical quantity no one can control or, beyond two weeks, predict.
        The wind farm is not alone in the region. The gas utility sells more in a cold winter, the Marlow farm harvests less in a hot, dry summer, and each has
        bills to pay whatever the weather does. The next lesson puts all three in dollars, side by side.
      </P>
    </LessonPage>
  );
}
