import { useMemo } from 'react';
import {
  Button,
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
  Segmented,
  Slider,
  Sub,
  Sup,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  pct,
  tint,
  useScenario,
} from '../../../framework';
import {
  arpsCum,
  arpsEur,
  arpsRate,
  firstYearDecline,
  fitArps,
  noisyHistory,
  ridgebackMonthly,
  ridgebackRate,
  SANDHILL_WELL,
  sandhillMonthly,
  sumBcf,
  switchTime,
  RIDGEBACK_WELL,
  type Arps,
} from '../../../engines/gas/decline';
import { MMBTU_PER_MCF } from '../../../engines/gas/properties';
import { simulateTank } from '../../../engines/gas/reservoir';
import { RIDGEBACK_WELLHEAD_PRICE, ROYALTY, WELL_COST } from '../../../model/gas/production';
import { XYChart } from '../shared/XYChart';
import { money } from '../shared/format';

// ---------------------------------------------------------------------------
// Shared settings.

/** Rate below which the well no longer pays for its upkeep, MMcf/d. */
const ECON_LIMIT = 0.1;
/** The forecast horizon, years. */
const HORIZON = 30;

/** Rates on a logarithmic axis: the chart works in log10 units. */
const LOG_MIN = Math.log10(0.05);
const LOG_MAX = Math.log10(40);
const LOG_TICKS = [0.1, 0.3, 1, 3, 10, 30].map(Math.log10);
/** The first five years need less range: 1 to 20 MMcf/d. */
const ZOOM_MIN = 0;
const ZOOM_MAX = Math.log10(20);
const ZOOM_TICKS = [1, 2, 5, 10, 20].map(Math.log10);
const logRate = (q: number) => Math.log10(Math.max(q, 1e-4));
const rateLabel = (v: number) => {
  const q = 10 ** v;
  return q < 1 ? fmt(q, 1) : fmt(q);
};

/** Rounds to a slider's step, without floating-point dust. */
const r = (x: number, step: number) => Number((Math.round(x / step) * step).toFixed(4));

/** "1.20 per year". */
const perYear = (d: number) => `${fmt(d, 2)} per year`;

// ---------------------------------------------------------------------------
// Figure 1: the Arps curves.

export const CURVE_DEFAULTS = { qi: 15, di: 1.2, b: 0, dMin: 0, axis: 'linear' as 'linear' | 'log' };

const T_GRID = Array.from({ length: 301 }, (_, i) => (i / 300) * HORIZON);

const EXP_DEMO: Arps = { qi: 15, di: 1.2, b: 0 };
const B_DEMO = [0.5, 1, 2].map((b) => ({ b, eur: arpsEur({ qi: 15, di: 1.2, b }) }));
const EXP_EUR = arpsEur(EXP_DEMO);
const B2: Arps = { qi: 15, di: 1.2, b: 2 };
const B2_60 = arpsCum(B2, 60) / 1000;
const B2_100 = arpsCum(B2, 100) / 1000;
const B2_TERMINAL: Arps = { ...B2, dMin: 0.08 };
const B2_TERMINAL_EUR = arpsEur(B2_TERMINAL);
/** Gas produced in the first year, Bcf, with b = 0 and with b = 2. */
export const FIRST_YEAR_EXP = arpsCum(EXP_DEMO, 1) / 1000;
export const FIRST_YEAR_B2 = arpsCum(B2, 1) / 1000;

// ---------------------------------------------------------------------------
// Figure 2: the Ridgeback well's recorded history.

const TRUE_RATES = ridgebackMonthly();
/** What the meters recorded, month by month: the true rates with noise and the odd month of downtime. */
export const HISTORY = noisyHistory(TRUE_RATES, 7);
/** Months of history the forecaster gets to see. */
export const SEEN = 24;
const SEEN_HISTORY = HISTORY.slice(0, SEEN);
/** What the well actually produced in its first 30 years, Bcf. */
export const ACTUAL_BCF = sumBcf(HISTORY);

/**
 * How badly a curve misses a monthly history: the root-mean-square of the logarithmic misses. The
 * lesson shows it as a percentage, the "fit error"; the few months cut short by downtime dominate it.
 */
export function fitError(a: Arps, history: number[]): number {
  let s = 0;
  let n = 0;
  history.forEach((q, i) => {
    if (q <= 0) return;
    s += (Math.log(q) - Math.log(arpsRate(a, (i + 0.5) / 12))) ** 2;
    n++;
  });
  return n ? Math.sqrt(s / n) : 0;
}

/** The best Arps curve through the two years of history, rounded to the sliders' steps. */
export function bestFit(dMin = 0): Arps {
  const f = fitArps(SEEN_HISTORY, { dMin: dMin || undefined });
  return { qi: r(f.qi, 0.1), di: r(f.di, 0.01), b: r(f.b, 0.05), dMin };
}

const BEST = bestFit();
const BEST_ERR = fitError(BEST, SEEN_HISTORY);
const BEST_EUR = arpsEur(BEST).eurBcf;
/** How much worse than the best fit a curve may be and still count as fitting the history. */
export const FIT_TOLERANCE = 0.02;
const FIT_LIMIT = fitError(fitArps(SEEN_HISTORY), SEEN_HISTORY) + FIT_TOLERANCE;
/** The fit limit as the readout shows it, rounded down to a whole percent so every curve the readout shows at or under it passes. */
export const FIT_LIMIT_SHOWN = Math.floor((Math.exp(FIT_LIMIT) - 1) * 100) / 100;
/** The challenge's allowed miss on the 30-year total. */
export const EUR_TOLERANCE = 0.1;

/** A curve that fits the two years of history and forecasts the 30-year total within 10%. */
export function forecastSolved(a: Arps): boolean {
  return fitError(a, SEEN_HISTORY) <= FIT_LIMIT + 1e-12 && Math.abs(arpsEur(a, ECON_LIMIT, HORIZON).eurBcf / ACTUAL_BCF - 1) <= EUR_TOLERANCE;
}

/**
 * The challenge is judged on the forecast the reader locked in before the rest of the history
 * appeared, not on the curve the sliders show afterward.
 */
export function lockedSolved(locked: Arps | null): boolean {
  return locked !== null && forecastSolved(locked);
}

const CAPPED = [0.5, 0.8].map((bMax) => {
  const f = fitArps(SEEN_HISTORY, { bMax });
  return { b: f.b, eur: arpsEur(f).eurBcf, miss: Math.exp(fitError(f, SEEN_HISTORY)) - 1 };
});
const EXP_FIT = fitArps(SEEN_HISTORY, { bMax: 0 });
const EXP_FIT_EUR = arpsEur(EXP_FIT).eurBcf;
const BEST_MISS = Math.exp(BEST_ERR) - 1;
/** Dollars a Bcf earns the producer after royalty, at the simulated wellhead price. */
const NET_PER_BCF = 1e6 * MMBTU_PER_MCF * RIDGEBACK_WELLHEAD_PRICE * (1 - ROYALTY);
const OVERSTATED_BCF = BEST_EUR - ACTUAL_BCF;
/** The best fit with a terminal decline at the top of the usual range, and the least terminal decline (per year, on the slider's grid) that solves the challenge. */
const BEST_D10 = arpsEur({ ...BEST, dMin: 0.1 }).eurBcf;
export const MIN_SOLVING_DMIN = (() => {
  for (let d = 1; d <= 30; d++) if (forecastSolved({ ...BEST, dMin: d / 100 })) return d / 100;
  return NaN;
})();
/** The caps on b (in the slider's 0.05 steps) whose best-fitting curves solve the challenge: the lowest and highest. */
export const SOLVING_B_CAPS = (() => {
  const ok: number[] = [];
  for (let i = 0; i <= 40; i++) if (forecastSolved(fitArps(SEEN_HISTORY, { bMax: i * 0.05 }))) ok.push(r(i * 0.05, 0.05));
  return { lo: Math.min(...ok), hi: Math.max(...ok) };
})();
/** The month the Sandhill well of Lesson 2.2 leaves its plateau, and a fit to its next six years. */
const SANDHILL_OFF = simulateTank(SANDHILL_WELL).plateauMonths + 1;
const SANDHILL_FIT = fitArps(sandhillMonthly().slice(SANDHILL_OFF - 1, SANDHILL_OFF - 1 + 72));

/** `locked` is the forecast the reader commits to; the rest of the history stays hidden until there is one. */
export const FORECAST_DEFAULTS = { qi: r(EXP_FIT.qi, 0.1), di: r(EXP_FIT.di, 0.01), b: 0, dMin: 0, span: 'five' as 'five' | 'all', locked: null as Arps | null };

// ---------------------------------------------------------------------------

function ArpsEq({ a }: { a: Arps }) {
  const exp = a.b <= 1e-9;
  return exp ? (
    <Eq label={`Exponential decline: q of t equals ${fmt(a.qi, 1)} times e to the minus ${fmt(a.di, 2)} t`}>
      <K tone="orange">q(t)</K>
      <Op>=</Op>
      <K tone="orange">{fmt(a.qi, 1)}</K>
      <Op>×</Op>
      <span>
        e<Sup>−{fmt(a.di, 2)} t</Sup>
      </span>
    </Eq>
  ) : (
    <Eq label={`Hyperbolic decline: q of t equals ${fmt(a.qi, 1)} over (1 plus ${fmt(a.b, 2)} times ${fmt(a.di, 2)} t) to the power 1 over ${fmt(a.b, 2)}`}>
      <K tone="orange">q(t)</K>
      <Op>=</Op>
      <Frac
        top={<K tone="orange">{fmt(a.qi, 1)}</K>}
        bottom={
          <span>
            (1 + {fmt(a.b, 2)} × {fmt(a.di, 2)} t)<Sup>1/{fmt(a.b, 2)}</Sup>
          </span>
        }
      />
    </Eq>
  );
}

function CurveSliders({ a, set }: { a: Arps; set: (p: Partial<Arps>) => void }) {
  const dMin = a.dMin ?? 0;
  return (
    <>
      <Slider label="Initial rate qᵢ" tone="orange" value={a.qi} min={1} max={30} step={0.1} onChange={(v) => set({ qi: v })} display={`${fmt(a.qi, 1)} MMcf/d`} />
      <Slider label="Initial decline Dᵢ" value={a.di} min={0.05} max={3} step={0.01} onChange={(v) => set({ di: v })} display={perYear(a.di)} />
      <Slider label="Curvature b" value={a.b} min={0} max={2} step={0.05} onChange={(v) => set({ b: v })} display={fmt(a.b, 2)} />
      <Slider
        label="Terminal decline"
        value={dMin}
        min={0}
        max={0.3}
        step={0.01}
        onChange={(v) => set({ dMin: v })}
        display={dMin > 0 ? perYear(dMin) : 'none'}
      />
    </>
  );
}

export default function Lesson() {
  // ---- Figure 1.
  const c = useScenario('curves', CURVE_DEFAULTS);
  const a: Arps = { qi: c.state.qi, di: c.state.di, b: c.state.b, dMin: c.state.dMin || undefined };
  const log = c.state.axis === 'log';
  const eur = arpsEur(a, ECON_LIMIT, HORIZON);
  const ts = switchTime(a);
  const fyd = firstYearDecline(a);
  const q10 = arpsRate(a, 10);
  const rates = T_GRID.map((t) => arpsRate(a, t));
  const cums = T_GRID.map((t) => arpsCum(a, Math.min(t, eur.years)) / 1000);
  const [, rateTop] = niceDomain(0, Math.max(16, a.qi), 4);
  const [, cumTop] = niceDomain(0, Math.max(5, eur.eurBcf * 1.25), 4);
  const switching = Number.isFinite(ts) && ts > 0 && ts < eur.years;

  // ---- Figure 2.
  const f = useScenario('forecast', FORECAST_DEFAULTS);
  const fa: Arps = { qi: f.state.qi, di: f.state.di, b: f.state.b, dMin: f.state.dMin || undefined };
  const locked = f.state.locked;
  const reveal = locked !== null;
  const xMax = f.state.span === 'five' ? 5 : HORIZON;
  const fEur = arpsEur(fa, ECON_LIMIT, HORIZON);
  const err = fitError(fa, SEEN_HISTORY);
  const fits = err <= FIT_LIMIT + 1e-12;
  const lockedEur = locked ? arpsEur(locked, ECON_LIMIT, HORIZON).eurBcf : NaN;
  const lockedErr = locked ? fitError(locked, SEEN_HISTORY) : NaN;
  const lockedMiss = lockedEur / ACTUAL_BCF - 1;
  const solved = lockedSolved(locked);
  const fGrid = useMemo(() => Array.from({ length: 361 }, (_, i) => (i / 360) * xMax), [xMax]);
  const fRates = fGrid.map((t) => logRate(arpsRate(fa, t)));
  const lockedRates = locked ? fGrid.map((t) => logRate(arpsRate(locked, t))) : [];
  const seenPts = SEEN_HISTORY.map((q, i) => ({ t: (i + 0.5) / 12, q }));
  const laterPts = HISTORY.slice(SEEN)
    .map((q, i) => ({ t: (SEEN + i + 0.5) / 12, q }))
    .filter((p) => p.t <= xMax);

  const status = !locked
    ? !fits
      ? `Your curve’s fit error is ${pct(Math.exp(err) - 1)}, more than the ${pct(FIT_LIMIT_SHOWN)} allowed. Fit the history first — the Best fit button is a good start.`
      : `Your curve fits the history and forecasts ${fmt(fEur.eurBcf, 1)} Bcf. Is that the forecast you’d stake the well on? Lock it in when it is.`
    : lockedErr > FIT_LIMIT + 1e-12
      ? `The curve you locked in doesn’t fit the history: its fit error is ${pct(Math.exp(lockedErr) - 1)}. Hide the rest and forecast again.`
      : `You locked in ${fmt(lockedEur, 1)} Bcf; the well produced ${fmt(ACTUAL_BCF, 1)}, so you were ${pct(Math.abs(lockedMiss))} ${lockedMiss > 0 ? 'high' : 'low'}. Hide the rest and forecast again.`;

  return (
    <LessonPage id="gas/2.3">
      <P>
        The Sandhill well of <a href={lessonHref('gas/2.2')}>the previous lesson</a> drained its rock like a tank. Sandstone that permeable lets the pressure even out
        across the whole drainage area within months, so the well’s <K tone="orange">rate</K> depends only on how much gas is left, and it falls smoothly as the tank
        empties. Ridgeback’s shale doesn’t behave that way. At 300 nanodarcies, a pressure drop at the well’s fractures creeps out into the rock over years, and the
        well keeps reaching gas it hasn’t touched before. Its rate falls steeply at first and then ever more slowly — a different shape altogether.
      </P>
      <P>
        Nobody can simulate every well’s rock in detail; there are too many wells, and too little is known about the rock between them. So engineers do something
        humbler. They record each well’s rate month by month, fit a curve to the record, and extend the curve into the future. The extension answers the question
        that matters most to whoever paid for the well: its <K c="energy">estimated ultimate recovery</K>, or EUR, the total it will produce before it stops paying its
        way. The curves nearly everyone uses were proposed by J. J. Arps in 1945:
      </P>
      <Eq label="Arps decline: q of t equals q i over (1 plus b times D i times t) to the power 1 over b">
        <K tone="orange">q(t)</K>
        <Op>=</Op>
        <Frac
          top={
            <K tone="orange">
              q<Sub>i</Sub>
            </K>
          }
          bottom={
            <span>
              (1 + b · D<Sub>i</Sub> · t)<Sup>1/b</Sup>
            </span>
          }
        />
      </Eq>
      <P>
        Here t is the time since the well started, in years; q<Sub>i</Sub> is its initial rate; and D<Sub>i</Sub> is its initial decline rate, the fraction of its
        rate it is losing per year at the start, measured instantaneously. The exponent b sets the curve’s shape. With b = 0 the formula becomes exponential decline,
        q = q<Sub>i</Sub>e<Sup>−D t</Sup>: the rate falls by the same fraction every year, forever. With b above 0 the decline rate itself declines, which
        gives the curve a long tail. The fourth number, a <b>terminal decline</b>, puts a floor under the decline rate: once the decline has eased to that floor,
        the curve carries on as exponential decline at that rate. In the next demonstration, change the four numbers, leaving the terminal decline at none for now.
        The upper chart is the rate, the lower one the cumulative production, which
        stops when the rate falls below an economic limit of {ECON_LIMIT} MMcf/d or after {HORIZON} years, whichever comes first:
      </P>

      <Figure name="Decline Curve Lab" scenario={c}>
        <Segmented
          label="Rate axis"
          value={c.state.axis}
          onChange={(v) => c.set({ axis: v })}
          options={[
            { value: 'linear', label: 'Linear rate axis' },
            { value: 'log', label: 'Logarithmic rate axis' },
          ]}
        />
        <XYChart
          xDomain={[0, HORIZON]}
          yDomain={log ? [LOG_MIN, LOG_MAX] : [0, rateTop]}
          yTicks={log ? LOG_TICKS : niceTicks(0, rateTop, 4)}
          yFormat={log ? rateLabel : (v) => fmt(v)}
          xTicks={[0, 5, 10, 15, 20, 25, 30]}
          yLabel="Rate, MMcf/d"
          height={210}
          series={[{ xs: T_GRID, ys: log ? rates.map(logRate) : rates, color: GRAPHIC.orange, width: 2.5 }]}
          hLines={[{ at: log ? Math.log10(ECON_LIMIT) : ECON_LIMIT, color: '#9a9a9a', dash: '4 4', label: `economic limit, ${ECON_LIMIT} MMcf/d`, labelAt: 'start' }]}
          vLines={eur.years < HORIZON ? [{ at: eur.years, color: '#777', dash: '3 4', label: `shut in after ${fmt(eur.years, 1)} years`, labelAt: 'start', width: 1 }] : []}
          markers={
            switching
              ? [
                  {
                    x: ts,
                    y: log ? logRate(arpsRate(a, ts)) : arpsRate(a, ts),
                    color: TEXT.ink,
                    r: 4,
                    label: `terminal decline from year ${fmt(ts, 1)}`,
                    labelPos: ts > 18 ? 'left' : 'above',
                  },
                ]
              : []
          }
          ariaLabel={`Arps decline curve with initial rate ${fmt(a.qi, 1)} MMcf/d, initial decline ${fmt(a.di, 2)} per year and b = ${fmt(a.b, 2)}${a.dMin ? `, switching to exponential decline at ${perYear(a.dMin)}` : ''}. The rate after 10 years is ${fmt(q10, 2)} MMcf/d.`}
        />
        <XYChart
          xDomain={[0, HORIZON]}
          yDomain={[0, cumTop]}
          yTicks={niceTicks(0, cumTop, 3)}
          xTicks={[0, 5, 10, 15, 20, 25, 30]}
          xFormat={(v) => `${v}`}
          yLabel="Cumulative production, Bcf"
          xLabel="years since first production"
          height={150}
          series={[
            { xs: T_GRID, ys: cums, color: GRAPHIC.gold, kind: 'area', opacity: 0.25 },
            { xs: T_GRID, ys: cums, color: GRAPHIC.gold, width: 2.5 },
          ]}
          markers={[{ x: eur.years, y: eur.eurBcf, color: TEXT.gold, r: 5, label: `EUR ${fmt(eur.eurBcf, 1)} Bcf`, labelPos: 'above' }]}
          ariaLabel={`Cumulative production rising to an estimated ultimate recovery of ${fmt(eur.eurBcf, 1)} Bcf after ${fmt(eur.years, 1)} years.`}
        />
        <Readouts
          items={[
            { label: 'decline over the first year', value: pct(fyd) },
            { label: 'rate after 10 years', value: eur.years < 10 ? 'shut in' : `${fmt(q10, 2)} MMcf/d`, tone: 'orange' },
          ]}
        />
        <CurveSliders a={a} set={(p) => c.set(p)} />
        <ArpsEq a={a} />
      </Figure>

      <P>
        The curve starts exponential, with a decline rate of 1.2 per year. That sounds like more than the whole rate, but it’s an instantaneous rate: compounded over
        twelve months it removes {pct(firstYearDecline(EXP_DEMO))} of the starting rate. Exponential decline doesn’t let up, so the well falls to the economic limit
        after {fmt(EXP_EUR.years, 1)} years, having produced {fmt(EXP_EUR.eurBcf, 1)} Bcf. Switch to the logarithmic axis and the curve becomes a straight line: on a
        log axis, equal fractions look like equal steps, and a constant percentage decline is a constant slope. Bending away from a straight line on that axis is the
        quickest way to spot a b above zero.
      </P>
      <P>
        Now raise b without touching anything else. At b = 0.5 the same well lasts {fmt(B_DEMO[0].eur.years, 1)} years and recovers {fmt(B_DEMO[0].eur.eurBcf, 1)} Bcf;
        at b = 1, {fmt(B_DEMO[1].eur.eurBcf, 1)} Bcf; at b = 2, {fmt(B_DEMO[2].eur.eurBcf, 1)} Bcf, and it’s still flowing well above the economic limit after 30
        years. The gas produced in the first year changes far less: {fmt(FIRST_YEAR_EXP, 1)} Bcf with b = 0, {fmt(FIRST_YEAR_B2, 1)} with b = 2. What b decides is
        mostly the tail, and the totals spread from {fmt(EXP_EUR.eurBcf, 1)} to {fmt(B_DEMO[2].eur.eurBcf, 1)} Bcf, a factor of{' '}
        {fmt(B_DEMO[2].eur.eurBcf / EXP_EUR.eurBcf, 1)}. With b of 1 or more the cumulative production never levels off: at b = 2 it would reach {fmt(B2_60, 1)} Bcf by year 60 and{' '}
        {fmt(B2_100, 1)} by year 100, without limit. No real well does that, since every well drains a finite amount of rock. That’s what the terminal decline is
        for. Give the b = 2 curve a terminal decline of {perYear(B2_TERMINAL.dMin ?? 0)} and it switches to exponential decline after{' '}
        {fmt(switchTime(B2_TERMINAL), 1)} years, recovering {fmt(B2_TERMINAL_EUR.eurBcf, 1)} Bcf in 30 years instead of {fmt(B_DEMO[2].eur.eurBcf, 1)}.
      </P>
      <P>
        The Sandhill well of <a href={lessonHref('gas/2.2')}>Lesson 2.2</a> fits these curves easily. Once it leaves its plateau in month {SANDHILL_OFF}, its next six years follow a curve with b of about{' '}
        {fmt(SANDHILL_FIT.b, 1)}: a gentle bend, typical of gas draining from a tank, where the falling pressure weakens the push and the decline slowly eases. It’s nothing like what comes next.
      </P>

      <H2>A shale well’s first two years</H2>
      <P>
        A Ridgeback well is different from the start. Each of its fracture stages opens long, thin cracks in the shale, and gas flows to them from the rock on either
        side. In rock this tight, the drained region spreads outward from each fracture slowly, its thickness growing with the square root of time, and the rate
        falls as one over that square root: q ∝ 1/√t. Engineers call this <b>transient linear flow</b>. It is Arps’ curve with b = 2, whose decline rate halves every
        time the well’s age doubles — set b to 2 in <FigRef to="Decline Curve Lab">the first demonstration</FigRef> and, on the logarithmic axis, the curve
        keeps flattening and never settles into a straight line. In our model the well is held at {RIDGEBACK_WELL.qCap} MMcf/d for its first {RIDGEBACK_WELL.capMonths} months and then follows 1/√t,
        which takes it to {fmt(ridgebackRate(12), 1)} MMcf/d by the end of the first year: a first-year decline of {pct(1 - ridgebackRate(12) / RIDGEBACK_WELL.qCap)}.
        Declines of more than half in the first year are normal for shale wells.
      </P>
      <P>
        Linear flow can’t last. Fractures are spaced along the well and wells are drilled side by side, and once the regions drained by neighboring fractures meet —
        here after {RIDGEBACK_WELL.linearEnds / 12} years — there is no fresh rock left to reach. From then on the well behaves like the tank of{' '}
        <a href={lessonHref('gas/2.2')}>Lesson 2.2</a>, and its
        decline speeds up relative to 1/√t. A forecaster who sees only the early years sees none of this coming. In the next demonstration you are that forecaster.
        The dots are the well’s first {SEEN} months as its meter recorded them — with noise, and a few months cut short when the well was shut in for repairs. Fit a
        curve to them, use the <i>Best fit</i> button if you like, and read off the 30-year forecast. When you’re ready, lock it in to reveal the rest of the well’s life:
      </P>

      <Figure
        name="Decline Curve Lab · forecasting a well"
        scenario={f}
        actions={
          <Button onClick={() => f.set(bestFit(f.state.dMin))} label="Fit the curve to the two years of history">
            Best fit
          </Button>
        }
      >
        <Segmented
          label="Time span"
          value={f.state.span}
          onChange={(v) => f.set({ span: v })}
          options={[
            { value: 'five', label: 'First five years' },
            { value: 'all', label: 'All 30 years' },
          ]}
        />
        <XYChart
          xDomain={[0, xMax]}
          yDomain={xMax === 5 ? [ZOOM_MIN, ZOOM_MAX] : [LOG_MIN, LOG_MAX]}
          yTicks={xMax === 5 ? ZOOM_TICKS : LOG_TICKS}
          yFormat={rateLabel}
          xTicks={xMax === 5 ? [0, 1, 2, 3, 4, 5] : [0, 5, 10, 15, 20, 25, 30]}
          yLabel="Rate, MMcf/d (logarithmic)"
          xLabel="years since first production"
          height={250}
          bands={[{ from: 0, to: SEEN / 12, color: 'rgba(0,0,0,.045)', label: 'history' }]}
          series={[
            ...(reveal ? [{ xs: laterPts.map((p) => p.t), ys: laterPts.map((p) => logRate(p.q)), color: tint(GRAPHIC.orange, 0.55), kind: 'points' as const, r: xMax === 5 ? 3 : 1.8 }] : []),
            { xs: seenPts.map((p) => p.t), ys: seenPts.map((p) => logRate(p.q)), color: GRAPHIC.orange, kind: 'points', r: xMax === 5 ? 3.5 : 2.5 },
            ...(locked ? [{ xs: fGrid, ys: lockedRates, color: GRAPHIC.violet, width: 2, dash: '6 4' }] : []),
            { xs: fGrid, ys: fRates, color: '#333', width: 2 },
          ]}
          hLines={xMax === 5 ? [] : [{ at: Math.log10(ECON_LIMIT), color: '#9a9a9a', dash: '4 4', label: 'economic limit', labelAt: 'start' }]}
          ariaLabel={`The Ridgeback well's first ${SEEN} months of recorded production${reveal ? ' and the rest of its first 30 years' : ''}, with your curve: initial rate ${fmt(fa.qi, 1)} MMcf/d, initial decline ${fmt(fa.di, 2)} per year, b = ${fmt(fa.b, 2)}${fa.dMin ? `, terminal decline ${perYear(fa.dMin)}` : ''}. It forecasts ${fmt(fEur.eurBcf, 1)} Bcf over 30 years.${locked ? ` Your locked-in forecast is ${fmt(lockedEur, 1)} Bcf; the well actually produced ${fmt(ACTUAL_BCF, 1)}.` : ''}`}
        />
        <Legend
          items={[
            { label: 'Recorded, first two years', color: GRAPHIC.orange },
            ...(reveal ? [{ label: 'Recorded, later', color: tint(GRAPHIC.orange, 0.55) }] : []),
            { label: 'Your curve', color: '#333', kind: 'line' as const },
            ...(locked ? [{ label: 'Your locked-in forecast', color: GRAPHIC.violet, kind: 'line' as const, dashed: true }] : []),
          ]}
        />
        <Readouts
          items={[
            { label: 'your curve’s 30-year forecast', value: `${fmt(fEur.eurBcf, 1)} Bcf`, tone: 'gold' },
            { label: 'its fit error on the history (RMS)', value: pct(Math.exp(err) - 1), tone: fits ? 'ink' : 'red' },
            { label: 'actually produced in 30 years', value: reveal ? `${fmt(ACTUAL_BCF, 1)} Bcf` : 'hidden', tone: 'gold' },
            {
              label: 'your locked-in forecast',
              value: locked ? `${fmt(lockedEur, 1)} Bcf · ${lockedMiss > 0 ? '+' : ''}${pct(lockedMiss)}` : '—',
              tone: locked ? (Math.abs(lockedMiss) <= EUR_TOLERANCE ? 'green' : 'red') : 'ink',
            },
          ]}
        />
        <CurveSliders a={fa} set={(p) => f.set(p)} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
          {locked ? (
            <Button onClick={() => f.set({ locked: null })}>Hide the rest and forecast again</Button>
          ) : (
            <Button primary onClick={() => f.set({ locked: { qi: fa.qi, di: fa.di, b: fa.b, dMin: fa.dMin } })}>
              Lock in this forecast
            </Button>
          )}
          <span style={{ fontSize: 13, color: TEXT.gray }}>
            {locked
              ? `Locked in: b = ${fmt(locked.b, 2)}, Dᵢ = ${perYear(locked.di)}${locked.dMin ? `, terminal decline ${perYear(locked.dMin)}` : ''}. The sliders still move your curve; the dashed line keeps the forecast.`
              : 'The rest of the well’s history stays hidden until you lock in a forecast.'}
          </span>
        </div>
      </Figure>

      <P>
        The curve starts as the best exponential fit, and it runs through the dots nearly as well as anything can. Its <b>fit error</b>, the root-mean-square of
        the monthly misses, is {pct(Math.exp(fitError(EXP_FIT, SEEN_HISTORY)) - 1)}, against {pct(BEST_MISS)} for the best curve of all. Those figures look large
        beside dots so close to the line because squaring the misses lets the three months cut short by repairs, which no smooth curve follows, dominate them.
        But the curve forecasts only {fmt(EXP_FIT_EUR, 1)} Bcf. Press <i>Best fit</i>: the computer settles on b = {fmt(BEST.b, 2)} and D<Sub>i</Sub> ={' '}
        {fmt(BEST.di, 2)} per year, and the forecast jumps to {fmt(BEST_EUR, 1)} Bcf. Curves that fit the two years almost equally well disagree enormously about the
        next 28. Hold b at {fmt(CAPPED[0].b, 1)} and the best curve forecasts {fmt(CAPPED[0].eur, 1)} Bcf; hold it at {fmt(CAPPED[1].b, 1)} and it forecasts{' '}
        {fmt(CAPPED[1].eur, 1)}. The history alone can’t choose between them.
      </P>

      <Challenge
        id="a"
        question={`Using only the first two years, make the forecast you’d stake the well on: a curve that runs through the history about as well as the best fit does (a fit error of ${pct(FIT_LIMIT_SHOWN)} or less; the best fit’s is ${pct(BEST_MISS)}) and that you predict will get the well’s 30-year production right to within 10%. Think about what two years of linear flow can’t show, then lock your forecast in. Only the forecast you lock in counts, and the rest of the history appears only once you have.`}
        solved={solved}
        status={status}
        success={`Solved: you locked in ${fmt(lockedEur, 1)} Bcf against the ${fmt(ACTUAL_BCF, 1)} the well actually produced. The best fit to two years forecast ${fmt(BEST_EUR, 1)}, because those years are pure linear flow and the curve has no way of knowing when it ends. The usual guard rails weren’t enough here: forecasts that work hold b to between ${fmt(SOLVING_B_CAPS.lo, 2)} and ${fmt(SOLVING_B_CAPS.hi, 2)}, or impose a terminal decline of ${fmt(MIN_SOLVING_DMIN, 2)} per year or more, steeper than the values forecasters commonly use. Building in depletion the history hasn’t shown yet takes judgment the data can’t supply.`}
      />

      <H2>What a forecast is worth</H2>
      <P>
        Lock in a forecast and switch the chart to all 30 years to see the rest of the well’s life. Over those years it actually produced {fmt(ACTUAL_BCF, 1)} Bcf, so the best fit to its first two years was{' '}
        {pct(BEST_EUR / ACTUAL_BCF - 1)} too high. The early data were telling the truth about linear flow; they simply couldn’t say when linear flow would end.
        That’s a systematic error, not bad luck, and the industry has learned to guard against it. Forecasters cap b, impose a terminal decline — values of about
        0.05 to 0.10 per year are common — and lean on analog wells: older wells nearby, in similar rock and completed the same way, whose longer histories show where
        the curve bends. Here even the top of that range isn’t enough: with a terminal decline of 0.10 per year, the best fit still forecasts {fmt(BEST_D10, 1)} Bcf,{' '}
        {pct(BEST_D10 / ACTUAL_BCF - 1)} too high, and it takes {fmt(MIN_SOLVING_DMIN, 2)} or more to come within 10%. None of these guards is exact. A forecast from
        early data is a judgment about rock no one has seen.
      </P>
      <P>
        The judgment carries a price. At the simulated wellhead price of ${RIDGEBACK_WELLHEAD_PRICE.toFixed(2)} per MMBtu and {MMBTU_PER_MCF} MMBtu per Mcf, a Bcf of
        Ridgeback gas earns the producer about {money(NET_PER_BCF)} after a {pct(ROYALTY)} royalty to the mineral owners. The best-fit forecast’s extra{' '}
        {fmt(OVERSTATED_BCF, 1)} Bcf is worth about {money(OVERSTATED_BCF * NET_PER_BCF)} — almost exactly the {money(WELL_COST)} it costs to drill and complete the
        well. A company that books reserves from optimistic curves can believe its wells pay when they barely do, and keep drilling more of them.
      </P>
      <P>
        One well is one curve. A gas field is hundreds of them, started month after month, each falling steeply in its first year. In{' '}
        <a href={lessonHref('gas/2.4')}>the next lesson</a> we’ll stack them up, and see how hard a shale field has to keep drilling just to stand still.
      </P>
    </LessonPage>
  );
}
