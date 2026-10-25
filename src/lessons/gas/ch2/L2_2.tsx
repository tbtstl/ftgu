import { useMemo, useRef, useState } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
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
  TEXT,
  clamp,
  fmt,
  lessonHref,
  mix,
  niceDomain,
  niceTicks,
  pct,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { zFactor } from '../../../engines/gas/eos';
import { pOverZ, simulateTank, wellCoefficient, wellRate, type TankResult, type TankWell } from '../../../engines/gas/reservoir';
import { gaussian, rng } from '../../../model/random';
import { SANDHILL_PI, SANDHILL_ROCK } from '../../../model/gas/production';
import { XYChart } from '../shared/XYChart';

// ---------------------------------------------------------------------------
// The well: a vertical well in Sandhill's sandstone (Lesson 2.1's rock), draining a closed tank.

/** Permeabilities the slider steps through, md. */
export const K_STEPS = [0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 7, 10, 15, 20, 30];
export const WELL_DEFAULTS = { k: 3, area: 640, pwf: 600, cap: 8 };
type WellState = typeof WELL_DEFAULTS;
const YEARS = 30;
const MONTHS = YEARS * 12;
/** How long the first challenge's contract wants the rate held steady: four years. */
export const STEADY_MONTHS = 48;
const CAP_STEP = 0.5;

/** The tank well the first demonstration's controls describe. */
export function wellOf(s: WellState): TankWell {
  return {
    rock: { ...SANDHILL_ROCK, permMd: s.k, areaAcres: s.area },
    piPsia: SANDHILL_PI,
    pwfPsia: s.pwf,
    rateCapMMcfd: s.cap,
    abandonMMcfd: 0.1,
  };
}

const simCache = new Map<string, TankResult>();
/** The well's 30-year life, cached by its settings. */
export function runWell(s: WellState): TankResult {
  const key = `${s.k}|${s.area}|${s.pwf}|${s.cap}`;
  let r = simCache.get(key);
  if (!r) {
    r = simulateTank(wellOf(s), MONTHS);
    if (simCache.size > 300) simCache.clear();
    simCache.set(key, r);
  }
  return r;
}

const atDefaults = (s: WellState) => s.k === WELL_DEFAULTS.k && s.area === WELL_DEFAULTS.area && s.pwf === WELL_DEFAULTS.pwf;

/**
 * The lowest reservoir pressure (psia, on a 10-psi grid) at which the rock can still deliver the
 * well's rate cap: the plateau ends when the pressure falls past it. Null if the rock can't deliver
 * the cap even at discovery.
 */
export function capPressure(s: WellState): number | null {
  const rock = wellOf(s).rock;
  if (wellRate(rock, SANDHILL_PI, s.pwf) < s.cap) return null;
  for (let p = SANDHILL_PI - 10; p > s.pwf; p -= 10) if (wellRate(rock, p, s.pwf) < s.cap) return p + 10;
  return s.pwf;
}

/**
 * The first challenge: with the starting rock, spacing and flowing pressure, the highest rate cap
 * (on the slider's half-MMcf/d grid) that holds the well at its cap for at least four years.
 */
export function steadySolved(s: WellState): boolean {
  if (!atDefaults(s)) return false;
  return runWell(s).plateauMonths >= STEADY_MONTHS && runWell({ ...s, cap: s.cap + CAP_STEP }).plateauMonths < STEADY_MONTHS;
}

// ---------------------------------------------------------------------------
// The fault block: the same rock, an unknown size, and eight pressure surveys.

/** The block's true drainage area, acres. Hidden from the reader until the challenge is solved. */
export const BLOCK_ACRES = 440;
const BLOCK_WELL: TankWell = { ...wellOf(WELL_DEFAULTS), rock: { ...SANDHILL_ROCK, areaAcres: BLOCK_ACRES } };
const BLOCK = simulateTank(BLOCK_WELL, 60);
export const BLOCK_GIP = BLOCK.gipBcf;
const T = SANDHILL_ROCK.tempF;
const PZI = pOverZ(SANDHILL_PI, T);
/** Months after first production at which the well is shut in for a pressure survey. */
export const SURVEY_MONTHS = [6, 12, 18, 24, 30, 36, 42, 48];
/** Measured average reservoir pressure is uncertain by about 1.5%. */
const SURVEY_NOISE = 0.015;

export interface Survey {
  month: number;
  /** Gas produced by then, Bcf (metered, so known precisely). */
  cumBcf: number;
  /** Measured pressure, psia, and the P/Z worked out from it. */
  pressure: number;
  pz: number;
}

export const SURVEYS: Survey[] = (() => {
  const r = rng(11);
  return SURVEY_MONTHS.map((mo) => {
    const m = BLOCK.months[mo - 1];
    const pressure = m.pressure * (1 + SURVEY_NOISE * gaussian(r));
    return { month: mo, cumBcf: m.cumBcf, pressure, pz: pOverZ(pressure, T) };
  });
})();

/** The least-squares straight line through (0, Pi/Zi) and the first n surveys: where it reaches P/Z = 0, Bcf. */
export function lineEstimate(n: number): number {
  let a = 0;
  let b = 0;
  for (const s of SURVEYS.slice(0, n)) {
    a += s.cumBcf * (PZI - s.pz);
    b += s.cumBcf * s.cumBcf;
  }
  return PZI / (a / b);
}

export const PZ_DEFAULTS = { surveys: 2, estimate: 30 };
export const PZ_TOLERANCE = 0.05;

/** The second challenge: an estimate within 5% of the block's true gas in place. */
export function blockSolved(estimate: number): boolean {
  return Math.abs(estimate - BLOCK_GIP) <= PZ_TOLERANCE * BLOCK_GIP;
}

/** Gas recoverable, by the reader's line, if the block is abandoned at this reservoir pressure (psia). */
const ABANDON_PSIA = 700;
const PZ_ABANDON = pOverZ(ABANDON_PSIA, T);

// ---------------------------------------------------------------------------
// Numbers quoted in the prose.

const BASE = runWell(WELL_DEFAULTS);
const at = (r: TankResult, month: number) => r.months[Math.min(month, r.months.length) - 1];
const POTENTIAL_0 = wellRate(wellOf(WELL_DEFAULTS).rock, SANDHILL_PI, WELL_DEFAULTS.pwf);
/** Reservoir pressure at which the well's potential falls to its cap, psia (to the nearest 10). */
const CAP_PRESSURE = capPressure(WELL_DEFAULTS) ?? NaN;
const PZ_PER_BCF = PZI / BASE.gipBcf;
const PWF_LOW = runWell({ ...WELL_DEFAULTS, pwf: 200 });
const PWF_HIGH = runWell({ ...WELL_DEFAULTS, pwf: 1000 });
const CAP_HIGH = runWell({ ...WELL_DEFAULTS, cap: 12 });
const CAP_LOW = runWell({ ...WELL_DEFAULTS, cap: 4 });
const K_HIGH = runWell({ ...WELL_DEFAULTS, k: 30 });
const K_LOW = runWell({ ...WELL_DEFAULTS, k: 0.3 });
const SMALL = runWell({ ...WELL_DEFAULTS, area: 160 });
/** The first challenge's answer: the highest cap held for four years at the starting settings, MMcf/d. */
export function steadyCap(): number {
  let best = 0;
  for (let c = 2; c <= 20; c += CAP_STEP) if (runWell({ ...WELL_DEFAULTS, cap: c }).plateauMonths >= STEADY_MONTHS) best = c;
  return best;
}
/**
 * The first challenge estimated by hand at its answer: the pressure where the rock can deliver only
 * the cap, P/Z there, the gas produced by then (from material balance) and the months that takes.
 */
export const STEADY_ESTIMATE = (() => {
  const cap = steadyCap();
  const p = capPressure({ ...WELL_DEFAULTS, cap }) ?? NaN;
  const pz = pOverZ(p, T);
  const gp = (PZI - pz) / PZ_PER_BCF;
  return { cap, p, pz, gp, months: (gp * 1000) / cap / (365.25 / 12) };
})();
const EST_1 = lineEstimate(1);
const EST_8 = lineEstimate(SURVEYS.length);
/** Pressure lost per Bcf in the first month, psi: faster than P/Z, because Z is falling too. */
export const P_DROP_FIRST = (SANDHILL_PI - BASE.months[0].pressure) / BASE.months[0].cumBcf;
/** Z at discovery, and its lowest value on the way down (with the pressure where it occurs, on a 10-psi grid). */
export const Z_DISCOVERY = zFactor(SANDHILL_PI, T);
export const Z_LOW = (() => {
  let z = Infinity;
  let p = SANDHILL_PI;
  for (let q = SANDHILL_PI; q >= 200; q -= 10) {
    const zq = zFactor(q, T);
    if (zq < z) {
      z = zq;
      p = q;
    }
  }
  return { z, p };
})();
/** The pressure (psia, on a 10-psi grid) below which the pressure falls more slowly than P/Z: where d(P/Z)/dP reaches 1. */
export const PZ_CROSSOVER = (() => {
  for (let q = SANDHILL_PI; q > 200; q -= 10) if ((pOverZ(q + 1, T) - pOverZ(q - 1, T)) / 2 >= 1) return q;
  return NaN;
})();

// ---------------------------------------------------------------------------
// Drawing.

const RATE = GRAPHIC.orange;
const PRESS = GRAPHIC.blue;
const LIGHT = '#eef3f9';

function dotStyle(rate: number) {
  const speed = rate * 9;
  return speed > 0.3 ? { animationDuration: `${(18 / speed).toFixed(3)}s` } : { animationPlayState: 'paused' as const };
}

/** The well and the tank it drains, with a bar of the gas produced and left. */
function WellDiagram({ rate, pressure, pwf, cum, gip, year, ariaLabel }: { rate: number; pressure: number; pwf: number; cum: number; gip: number; year: number; ariaLabel: string }) {
  const fill = mix(LIGHT, PRESS, clamp(pressure / SANDHILL_PI, 0, 1) * 0.85);
  const barTop = 26;
  const barH = 112;
  const produced = gip > 0 ? clamp(cum / gip, 0, 1) : 0;
  return (
    <svg className="diagram" viewBox="0 0 600 168" role="img" aria-label={ariaLabel}>
      <rect x={20} y={40} width={400} height={58} fill="#f2f0e9" />
      <line x1={20} y1={40} x2={420} y2={40} stroke="#9a9a9a" strokeWidth={1.5} />
      <rect x={20} y={98} width={400} height={40} fill={fill} stroke="#8a8a8a" strokeWidth={1} />
      <text x={300} y={70} textAnchor="middle" className="ax">
        rock above the reservoir
      </text>
      <text x={290} y={123} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: pressure / SANDHILL_PI > 0.55 ? '#fff' : TEXT.blue }}>
        sandstone · {fmt(pressure)} psia
      </text>
      {/* Gas moving through the rock toward the well, and up it. */}
      <path d="M418 118 L128 118" className="flow-dots" stroke="#fff" strokeWidth={3} style={dotStyle(rate)} opacity={0.9} />
      <path d="M22 118 L112 118" className="flow-dots" stroke="#fff" strokeWidth={3} style={dotStyle(rate)} opacity={0.9} />
      <line x1={120} y1={30} x2={120} y2={136} stroke="#777" strokeWidth={8} />
      <path d="M120 134 L120 32" className="flow-dots" stroke={RATE} strokeWidth={4} style={dotStyle(rate)} />
      <rect x={108} y={22} width={24} height={10} rx={2} fill="#666" />
      <text x={140} y={22} style={{ fontSize: 14, fontWeight: 500, fill: TEXT.orange }}>
        {rate > 0.005 ? `${fmt(rate, rate < 1 ? 2 : 1)} MMcf/d` : 'shut in'}
      </text>
      <text x={140} y={36} className="ax">
        year {fmt(year, 1)}
      </text>
      <text x={128} y={156} className="ax">
        flowing pressure at the bottom: <tspan style={{ fill: TEXT.blue, fontWeight: 500 }}>{fmt(pwf)} psia</tspan>
      </text>
      {/* Gas produced and gas left. */}
      <rect x={470} y={barTop} width={34} height={barH} fill={tint(GRAPHIC.gold, 0.55)} stroke="#8a8a8a" strokeWidth={1} />
      <rect x={470} y={barTop} width={34} height={barH * produced} fill="#cfcfcf" />
      <text x={512} y={barTop + 10} className="ax">
        produced
      </text>
      <text x={512} y={barTop + 25} style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
        {fmt(cum, 1)} Bcf
      </text>
      <text x={512} y={barTop + barH - 18} className="ax">
        left
      </text>
      <text x={512} y={barTop + barH - 3} style={{ fontSize: 13, fontWeight: 500, fill: TEXT.gold }}>
        {fmt(gip - cum, 1)} Bcf
      </text>
      <text x={487} y={barTop + barH + 18} textAnchor="middle" className="ax">
        gas in place
      </text>
    </svg>
  );
}

export default function Lesson() {
  // ---- Figure 1: the well through its life.
  const s = useScenario('well', WELL_DEFAULTS);
  const st = s.state;
  const res = useMemo(() => runWell(st), [st]);
  const rock = useMemo(() => wellOf(st).rock, [st]);
  const potential0 = wellRate(rock, SANDHILL_PI, st.pwf);
  const last = res.months.length;
  const play = usePlay(true);
  const [month, setMonth] = useState(0);
  const monthRef = useRef(0);
  monthRef.current = month;
  useAnimationFrame((dt) => {
    const next = monthRef.current + dt * 24;
    if (next >= MONTHS) {
      setMonth(MONTHS);
      play.setPlaying(false);
    } else setMonth(next);
  }, play.playing);
  const playCtl = {
    playing: play.playing,
    toggle: () => {
      if (!play.playing && monthRef.current >= MONTHS - 1e-6) setMonth(0);
      play.toggle();
    },
  };
  const scrub = (years: number) => {
    play.setPlaying(false);
    setMonth(clamp(years * 12, 0, MONTHS));
  };

  // The state at the cursor: discovery at month 0, abandoned after the last simulated month.
  const mi = Math.round(month);
  const abandoned = mi > last;
  const now =
    mi === 0
      ? { rate: Math.min(st.cap, potential0), pressure: SANDHILL_PI, cumBcf: 0 }
      : abandoned
        ? { ...res.months[last - 1], rate: 0 }
        : res.months[mi - 1];
  const year = month / 12;
  const potentialNow = wellRate(rock, now.pressure, st.pwf);
  const coefNow = wellCoefficient(rock, (now.pressure + st.pwf) / 2) * 1000;

  const xs = [0, ...res.months.map((m) => m.month / 12)];
  const rates = [Math.min(st.cap, potential0), ...res.months.map((m) => m.rate)];
  const pressures = [SANDHILL_PI, ...res.months.map((m) => m.pressure)];
  if (last < MONTHS) {
    xs.push(last / 12 + 1e-6, YEARS);
    rates.push(0, 0);
    pressures.push(res.months[last - 1].pressure, res.months[last - 1].pressure);
  }
  const rateTop = niceDomain(0, Math.max(st.cap, ...rates, 1), 4)[1];
  const lastMonth = res.months[last - 1];

  const capP = capPressure(st);
  const steady = steadySolved(st);
  const steadyStatus = !atDefaults(st)
    ? 'Set the permeability back to 3 md, the spacing to 640 acres and the flowing pressure to 600 psia first; change only the rate cap.'
    : capP === null
      ? `The rock can’t deliver ${fmt(st.cap, 1)} MMcf/d even at discovery.`
      : `At ${fmt(st.cap, 1)} MMcf/d the rock can deliver the cap until the reservoir pressure falls to ${fmt(capP)} psia. How long does the well take to get there?`;

  // ---- Figure 2: the fault block's P/Z line.
  const z = useScenario('pz', PZ_DEFAULTS);
  const { surveys, estimate } = z.state;
  const shown = SURVEYS.slice(0, surveys);
  const lineAt = (cum: number) => PZI * (1 - cum / estimate);
  const above = shown.filter((p) => p.pz > lineAt(p.cumBcf)).length;
  const solvedPz = blockSolved(estimate);
  const recoverable = estimate * (1 - PZ_ABANDON / PZI);
  const pzStatus =
    above === shown.length
      ? `Every survey sits above your line: the pressure is falling more slowly than a ${fmt(estimate, 2)} Bcf block would allow.`
      : above === 0
        ? `Every survey sits below your line: the pressure is falling faster than a ${fmt(estimate, 2)} Bcf block would allow.`
        : `Your line says ${fmt(estimate, 2)} Bcf, with ${above} of ${shown.length} surveys above it. Is that a fair fit, and are there enough surveys to trust it?`;

  return (
    <LessonPage id="gas/2.2">
      <P>
        <a href={lessonHref('gas/2.1')}>Lesson 2.1</a> measured a well at a single moment. A vertical well drilled into Sandhill’s sandstone when the field was
        discovered could flow {fmt(POTENTIAL_0, 1)} MMcf/d with its flowing pressure held at {fmt(WELL_DEFAULTS.pwf)} psia. But every cubic foot it produces
        comes out of the rock around it, and the <K tone="blue">pressure</K> that pushes gas toward the well falls as the gas leaves. So the real question about a
        well is not how fast it can flow today but how its <K tone="orange">rate</K> changes over the years, and how much of the gas it will eventually bring up.
      </P>
      <P>
        We’ll follow one well through its life. It drains a square mile — 640 acres — of Sandhill’s sandstone (the acreage each well drains is its{' '}
        <b>spacing</b>), which at discovery held{' '}
        {fmt(BASE.gipBcf, 1)} Bcf at {fmt(SANDHILL_PI)} psia. We’ll treat that rock as a closed tank: the well is the only way out, and the pressure is the same
        everywhere inside it. Two rules run the tank. The first is the flow equation of <a href={lessonHref('gas/2.1')}>Lesson 2.1</a>, in the form engineers use for a single well, q = C × (P̄² −
        P<Sub>wf</Sub>²): the rate depends on the difference between the squares of the reservoir’s average pressure P̄ and the flowing pressure at the bottom of the
        well, P<Sub>wf</Sub>, and the coefficient C gathers up the rock’s permeability and thickness and the gas’s viscosity. (In the demonstration, C is in standard
        cubic feet a day per psi², and q is shown in millions of cubic feet a day.) The second rule is about the tank itself, and we’ll come to it in a
        moment.
      </P>
      <P>
        One more thing limits the well: what the equipment at the surface can handle. Its separator, flow line and the gathering pipe it feeds are sized for{' '}
        {fmt(WELL_DEFAULTS.cap)} MMcf/d, so a choke holds the well to that rate even though the rock could deliver nearly twice as much. In the next demonstration the
        well produces for 30 years in 15 seconds. Press play, or drag across either chart to read any year, and change the rock and the well:
      </P>

      <Figure name="Gas Well Simulator" scenario={s} play={playCtl}>
        <WellDiagram
          rate={now.rate}
          pressure={now.pressure}
          pwf={st.pwf}
          cum={now.cumBcf}
          gip={res.gipBcf}
          year={year}
          ariaLabel={`A vertical well draining ${fmt(st.area)} acres of sandstone. In year ${fmt(year, 1)} it flows ${fmt(now.rate, 2)} MMcf/d, the reservoir pressure is ${fmt(now.pressure)} psia, and ${fmt(now.cumBcf, 1)} of ${fmt(res.gipBcf, 1)} Bcf has been produced.`}
        />
        <XYChart
          xDomain={[0, YEARS]}
          yDomain={[0, rateTop]}
          yTicks={niceTicks(0, rateTop, 3)}
          xTicks={[0, 5, 10, 15, 20, 25, 30]}
          yFormat={(v) => fmt(v)}
          yLabel="Rate, MMcf/d"
          height={150}
          series={[
            { xs, ys: rates, color: RATE, kind: 'area', opacity: 0.18 },
            { xs, ys: rates, color: RATE, width: 2.5 },
          ]}
          hLines={[{ at: st.cap, color: '#8a8a8a', dash: '5 4', label: `rate cap ${fmt(st.cap, 1)} MMcf/d` }]}
          markers={[{ x: year, y: now.rate, color: RATE, r: 5 }]}
          cursor={year}
          onScrub={scrub}
          scrubStep={0.25}
          scrubLabel="Year of the well’s life"
          ariaLabel={`The well’s rate over 30 years: ${fmt(st.cap, 1)} MMcf/d for ${fmt(res.plateauMonths)} months, then declining to ${fmt(lastMonth.rate, 2)} MMcf/d ${last < MONTHS ? `when it is abandoned in month ${last}` : 'after 30 years'}.`}
        />
        <XYChart
          xDomain={[0, YEARS]}
          yDomain={[0, 4000]}
          yTicks={[0, 1000, 2000, 3000, 4000]}
          xTicks={[0, 5, 10, 15, 20, 25, 30]}
          yFormat={(v) => fmt(v)}
          yLabel="Reservoir pressure, psia"
          xLabel="years of production"
          height={160}
          series={[{ xs, ys: pressures, color: PRESS, width: 2.5 }]}
          hLines={[
            { at: st.pwf, color: '#8a8a8a', dash: '5 4', label: `flowing pressure ${fmt(st.pwf)} psia`, labelAt: 'start' },
            ...(capP !== null && capP > st.pwf ? [{ at: capP, color: RATE, dash: '5 4', label: `rock delivers the cap down to ${fmt(capP)} psia` }] : []),
          ]}
          markers={[{ x: year, y: now.pressure, color: PRESS, r: 5 }]}
          cursor={year}
          onScrub={scrub}
          scrubStep={0.25}
          scrubLabel="Year of the well’s life"
          ariaLabel={`Reservoir pressure over 30 years, from ${fmt(SANDHILL_PI)} psia to ${fmt(lastMonth.pressure)} psia. In year ${fmt(year, 1)} it is ${fmt(now.pressure)} psia.${capP !== null && capP > st.pwf ? ` The rock can deliver the ${fmt(st.cap, 1)} MMcf/d cap down to ${fmt(capP)} psia.` : ''}`}
        />
        <Readouts
          items={[
            { label: 'gas in place', value: `${fmt(res.gipBcf, 1)} Bcf`, tone: 'gold' },
            {
              label: last < MONTHS ? `recovered by abandonment, year ${fmt(last / 12, 1)}` : 'recovered in 30 years',
              value: `${fmt(res.eurBcf, 1)} Bcf · ${pct(res.recovery)}`,
              tone: 'gold',
            },
          ]}
        />
        <Slider
          label="Permeability"
          tone="violet"
          value={K_STEPS.indexOf(st.k)}
          min={0}
          max={K_STEPS.length - 1}
          onChange={(i) => s.set({ k: K_STEPS[i] })}
          display={`${fmt(st.k, st.k < 1 ? 1 : 0)} md`}
        />
        <Slider label="Well spacing" value={st.area} min={160} max={1280} step={40} onChange={(v) => s.set({ area: v })} display={`${fmt(st.area)} acres`} />
        <Slider label="Flowing pressure" tone="blue" value={st.pwf} min={200} max={1500} step={50} onChange={(v) => s.set({ pwf: v })} display={`${fmt(st.pwf)} psia`} />
        <Slider label="Rate cap" tone="orange" value={st.cap} min={2} max={20} step={CAP_STEP} onChange={(v) => s.set({ cap: v })} display={`${fmt(st.cap, 1)} MMcf/d`} />
        <Eq
          label={`Deliverability in year ${fmt(year, 1)}: q equals ${fmt(coefNow, 3)} times (${fmt(now.pressure)} squared minus ${fmt(st.pwf)} squared), which is ${fmt(potentialNow, 1)} MMcf/d${potentialNow > st.cap ? `, held to the ${fmt(st.cap, 1)} MMcf/d cap` : ''}`}
        >
          <K tone="orange">q</K>
          <Op>=</Op>
          <span>{fmt(coefNow, 3)}</span>
          <Op>×</Op>
          <span>
            (<K tone="blue">{fmt(now.pressure)}</K>² − <K tone="blue">{fmt(st.pwf)}</K>²)
          </span>
          <Op>=</Op>
          <K tone="orange">{fmt(potentialNow, 1)} MMcf/d</K>
        </Eq>
        <Caption>
          {abandoned
            ? `The well was shut in for good in month ${last}, when its rate fell below 0.1 MMcf/d with ${fmt(lastMonth.pressure)} psia still in the rock.`
            : potentialNow > st.cap + 1e-6
              ? `In year ${fmt(year, 1)} the rock could deliver ${fmt(potentialNow, 1)} MMcf/d; the choke holds the well to ${fmt(st.cap, 1)}.`
              : `In year ${fmt(year, 1)} the rock can deliver only ${fmt(potentialNow, 2)} MMcf/d, less than the cap, so the well flows all it can.`}
        </Caption>
      </Figure>

      <P>
        For its first {fmt(BASE.plateauMonths)} months the well flows at its cap, and the rock could give more all the while. Then, with the reservoir pressure down to
        about {fmt(CAP_PRESSURE)} psia — the dashed orange line on the pressure chart — its potential falls below {fmt(WELL_DEFAULTS.cap)} MMcf/d and the rate starts to drop. By year 5 the well makes{' '}
        {fmt(at(BASE, 60).rate, 1)} MMcf/d, by year 10 {fmt(at(BASE, 120).rate, 1)}, and after 30 years {fmt(at(BASE, 360).rate, 2)}. That shape, a{' '}
        <b>plateau</b> followed by a <b>decline</b>, is the life of most wells in permeable rock. Over the 30 years this one produces {fmt(BASE.eurBcf, 1)} Bcf,{' '}
        {pct(BASE.recovery)} of the gas that was in place.
      </P>
      <P>
        The pressure falls along a particular curve because of the second rule, <b>material balance</b>. A closed tank holds an amount of gas proportional to P/Z, its
        pressure divided by the compressibility factor of <a href={lessonHref('gas/1.2')}>Lesson 1.2</a>. Take gas out and P/Z falls in proportion to what was taken:
      </P>
      <Eq label="P over Z equals P i over Z i times one minus G p over G">
        <Frac top={<K tone="blue">P</K>} bottom="Z" />
        <Op>=</Op>
        <Frac
          top={
            <K tone="blue">
              P<Sub>i</Sub>
            </K>
          }
          bottom={
            <span>
              Z<Sub>i</Sub>
            </span>
          }
        />
        <Op>×</Op>
        <span>(1 −</span>
        <Frac
          top={
            <K c="energy">
              G<Sub>p</Sub>
            </K>
          }
          bottom={<K c="energy">G</K>}
        />
        <span>)</span>
      </Eq>
      <P>
        Here G is the gas initially in place and G<Sub>p</Sub> the gas produced so far. Sandhill’s P/Z starts at {fmt(PZI)} psia and loses{' '}
        {fmt(PZ_PER_BCF)} psia for every Bcf the well brings up. The pressure itself falls a little faster than that at first — {fmt(P_DROP_FIRST)} psi for the first
        Bcf — because Z is falling too, from {fmt(Z_DISCOVERY, 3)} at discovery. Z’s fall slows, and it bottoms out at {fmt(Z_LOW.z, 3)} near{' '}
        {fmt(Math.round(Z_LOW.p / 100) * 100)} psia before climbing back toward 1; below about {fmt(Math.round(PZ_CROSSOVER / 100) * 100)} psia, the pressure falls more
        slowly than P/Z.
      </P>

      <H2>Squeezing out more</H2>
      <P>
        Why does the well leave a fifth of the gas behind? Look at the flow equation again. As the reservoir pressure sinks toward the flowing pressure, P̄² − P
        <Sub>wf</Sub>² shrinks toward nothing, and so does the rate. Lower the <K tone="blue">flowing pressure</K> in <FigRef to="Gas Well Simulator">the first demonstration</FigRef>{' '}
        and the well has more to work with: at 200 psia it
        recovers {pct(PWF_LOW.recovery, 1)} of the gas in 30 years; at 1,000 psia, only {pct(PWF_HIGH.recovery, 1)}. A low flowing pressure isn’t free, though. The gas
        has to leave the wellhead at whatever pressure the gathering pipeline runs at, so pulling the bottom of the well down takes a compressor at the surface, like
        the ones in <a href={lessonHref('gas/1.4')}>Lesson 1.4</a>. How much gas is left in the ground is, in the end, an economic decision.
      </P>

      <H2>Faster or longer</H2>
      <P>
        The <K tone="orange">rate cap</K> trades speed for steadiness. Raise it to 12 MMcf/d and the plateau shrinks to {fmt(CAP_HIGH.plateauMonths)} months; lower it to
        4 and it stretches to {fmt(CAP_LOW.plateauMonths)} months, nearly ten years. Either way the 30-year total hardly moves — {fmt(CAP_HIGH.eurBcf, 1)} against{' '}
        {fmt(CAP_LOW.eurBcf, 1)} Bcf — because the gas in place doesn’t change. What changes is when it arrives, and money that arrives sooner is worth more. Bigger
        surface equipment costs more, too, and a buyer may pay extra for a steady supply.
      </P>

      <Challenge
        id="a"
        figure="Gas Well Simulator"
        question={`Suppose the gas is sold under a contract that pays a premium for a constant rate held for at least four years. With the starting rock, spacing and flowing pressure, what’s the highest rate cap, to the nearest half MMcf/d, that the well can hold that long? Estimate it before you check. The plateau lasts until the reservoir pressure falls to where the rock can deliver only the cap — the dashed orange line on the pressure chart moves with the cap — and P/Z falls ${fmt(PZ_PER_BCF)} psia for every Bcf the well produces on the way there. Then set the cap and read the plateau off the charts.`}
        solved={steady}
        status={steadyStatus}
        success={`Solved: ${fmt(st.cap, 1)} MMcf/d, held for ${fmt(res.plateauMonths)} months; at ${fmt(st.cap + CAP_STEP, 1)} the plateau would end after ${fmt(runWell({ ...st, cap: st.cap + CAP_STEP }).plateauMonths)}. The estimate gets there: the rock can deliver ${fmt(STEADY_ESTIMATE.cap, 1)} MMcf/d down to about ${fmt(STEADY_ESTIMATE.p)} psia, where P/Z is about ${fmt(STEADY_ESTIMATE.pz)}, so the well must first produce (${fmt(PZI)} − ${fmt(STEADY_ESTIMATE.pz)}) ÷ ${fmt(PZ_PER_BCF)} ≈ ${fmt(STEADY_ESTIMATE.gp, 1)} Bcf — ${fmt(STEADY_ESTIMATE.months)} months at its cap. A higher cap ends the plateau sooner twice over: it draws the gas out faster, and it needs more pressure to sustain.`}
      />

      <P>
        <K tone="violet">Permeability</K> sets how fast the rock gives up its gas. At 30 md the well recovers {pct(K_HIGH.recovery, 1)} and is abandoned after{' '}
        {fmt(K_HIGH.lifeMonths / 12, 0)} years; at 0.3 md, after 30 years it has produced only {pct(K_LOW.recovery)}. Closer spacing speeds things up too, by giving
        each well less rock to drain. On 160 acres
        a well drains {fmt(SMALL.gipBcf, 1)} Bcf and recovers {pct(SMALL.recovery)} of it in about {fmt(SMALL.lifeMonths / 12, 0)} years, so four wells on the same
        square mile would bring up its gas in a third of the time — for four times the drilling. How many wells to drill, and when, is the subject of{' '}
        <a href={lessonHref('gas/2.4')}>Lesson 2.4</a>.
      </P>

      <H2>Reading a reservoir’s size</H2>
      <P>
        Material balance also runs backward, and that makes it one of the most useful tools in the business. Suppose Sandhill’s operator drills a well into a fault
        block beside the field: the same rock at the same discovery pressure, but sealed off by faults, and nobody knows how far they reach. Every six months the
        operator shuts the well in for a day or two, lets the pressure around it even out, and measures the reservoir pressure — a <b>pressure survey</b>. The meters
        record exactly how much gas has come out. Each survey gives one point on a chart of P/Z against cumulative production, and material balance says the points
        lie on a straight line from the discovery P/Z that reaches zero at the block’s gas in place.
      </P>
      <P>
        Pressure surveys aren’t perfect: the pressure never quite settles in a day or two, and these readings carry errors of about 1.5%. The same line also gives
        the block’s <b>reserves</b>, the gas that will actually be produced. A well is abandoned once the reservoir pressure is too low to push out gas worth selling —
        here, {fmt(ABANDON_PSIA)} psia, its <b>abandonment pressure</b> — so the reserves are the production at which the line reaches that pressure’s P/Z. In the
        next demonstration, choose how many surveys have been taken, and set your estimate of the block’s gas in place, which draws your line:
      </P>

      <Figure name="Gas Well Simulator · P/Z" scenario={z}>
        <XYChart
          xDomain={[0, 35]}
          yDomain={[0, 4500]}
          xTicks={[0, 5, 10, 15, 20, 25, 30, 35]}
          yTicks={[0, 1000, 2000, 3000, 4000]}
          yFormat={(v) => fmt(v)}
          xFormat={(v) => fmt(v)}
          yLabel="P/Z, psia"
          xLabel="cumulative production, Bcf"
          height={250}
          series={[{ xs: [0, estimate], ys: [PZI, 0], color: GRAPHIC.gold, width: 2.5 }]}
          hLines={[{ at: PZ_ABANDON, color: '#9a9a9a', dash: '4 4', label: `abandonment at ${fmt(ABANDON_PSIA)} psia`, labelAt: 'start' }]}
          markers={[
            { x: 0, y: PZI, color: PRESS, r: 5 },
            ...shown.map((p) => ({ x: p.cumBcf, y: p.pz, color: PRESS, r: 5 })),
            { x: estimate, y: 0, color: GRAPHIC.gold, r: 6, ring: true, label: `${fmt(estimate, 2)} Bcf`, labelPos: 'above' as const },
          ]}
          ariaLabel={`P/Z against cumulative production for the fault-block well: ${shown.length} pressure survey${shown.length > 1 ? 's' : ''}, the last at ${fmt(shown[shown.length - 1].cumBcf, 1)} Bcf and ${fmt(shown[shown.length - 1].pz)} psia. Your line from ${fmt(PZI)} psia reaches zero at ${fmt(estimate, 2)} Bcf.`}
        />
        <Legend
          items={[
            { label: 'Discovery pressure and surveys', color: PRESS },
            { label: 'Your line', color: GRAPHIC.gold, kind: 'line' },
          ]}
        />
        <Readouts items={[{ label: `recoverable by your line, down to ${fmt(ABANDON_PSIA)} psia`, value: `${fmt(recoverable, 1)} Bcf`, tone: 'gold' }]} />
        <Slider label="Surveys taken" value={surveys} min={1} max={SURVEYS.length} onChange={(v) => z.set({ surveys: v })} display={`${surveys} · every 6 months`} />
        <Slider label="Gas in place" tone="gold" value={estimate} min={5} max={35} step={0.25} onChange={(v) => z.set({ estimate: v })} display={`${fmt(estimate, 2)} Bcf`} />
      </Figure>

      <Challenge
        id="b"
        question="Using all the surveys you need, estimate the fault block’s gas in place to within 5%."
        solved={solvedPz}
        status={pzStatus}
        success={`Solved. The block really holds ${fmt(BLOCK_GIP, 2)} Bcf, so your ${fmt(estimate, 2)} Bcf is ${pct(Math.abs(estimate - BLOCK_GIP) / BLOCK_GIP, 1)} off. Down to ${fmt(ABANDON_PSIA)} psia, about ${fmt(BLOCK_GIP * (1 - PZ_ABANDON / PZI), 1)} Bcf of it can be produced: the same straight line, read where it crosses the abandonment pressure instead of zero, gives the reserves.`}
      />

      <P>
        Try it with one survey and then with all eight. The best straight line through the first survey alone reaches zero at {fmt(EST_1, 1)} Bcf; through all eight,
        at {fmt(EST_8, 1)}. Early surveys sit in a short stretch near the start of the line, so a small error in a pressure swings its far end a long way. That’s why
        estimates of a new field’s size keep changing for its first few years, and why the gas in place found by mapping the rock (<a href={lessonHref('gas/2.1')}>Lesson 2.1</a>) and the gas in place
        implied by its pressure are both watched until they agree.
      </P>

      <H2>When the tank picture fails</H2>
      <P>
        Everything here rests on one assumption: that the pressure inside the tank evens out, so the whole drainage area behaves as one. In Sandhill’s sandstone that’s
        a good assumption. A drop in pressure at the well spreads to the edge of a square mile within a few months, and after that the rock drains as a single tank. In
        Ridgeback’s shale, ten thousand times less permeable, the same disturbance creeps outward for years even between the fractures of a horizontal well, a few
        hundred feet apart. For all that time the well is draining a region that keeps growing, and its rate falls along a different curve. Engineers describe such
        wells, and forecast them, with decline curves, the subject of <a href={lessonHref('gas/2.3')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
