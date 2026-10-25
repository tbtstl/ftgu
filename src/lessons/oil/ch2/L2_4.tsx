import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
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
  areaPath,
  fmt,
  lessonHref,
  pct,
  usd,
  useScenario,
} from '../../../framework';
import {
  NORTHFIELD_MODEL,
  arpsCum,
  arpsRate,
  fieldOutcome,
  flowingPwf,
  logRmsError,
  modifiedCum,
  modifiedRate,
  nominalFromEffective,
  simulateField,
  type Drive,
  type FieldYear,
} from '../../../engines/oil/decline';
import { STANDARD_WELL } from '../../../engines/oil/economics';
import { rockOf, wellProfile } from '../../../engines/oil/wells';
import { gaussian, rng } from '../../../model/random';
import { XYChart } from '../shared/charts';

// ---------------------------------------------------------------------------
// Figure 1: the standard Pinyon well, as a field engineer would see it.

const WELL = wellProfile(STANDARD_WELL, rockOf('pinyon'), 360);
/** The model well's 30-year cumulative production, bbl. */
export const TRUE_EUR30 = WELL.cum[359];
/** Months of "observed" data the reader fits. */
export const DATA_MONTHS = 24;
/** Monthly averages with about 3% of seeded measurement noise; t in years. */
export const DATA: Array<{ t: number; q: number }> = (() => {
  const r = rng(24);
  return WELL.rate.slice(0, DATA_MONTHS).map((q, i) => ({ t: WELL.days[i] / 365.25, q: q * Math.exp(0.03 * gaussian(r)) }));
})();

/** Terminal decline used by the modified hyperbolic, per year. */
export const TERMINAL = 0.08;
/** The challenge's fit tolerance: log RMS error of 7%. */
export const FIT_TOLERANCE = 0.07;
/** The best fit on the sliders' grid (qi step 50, decline step 1%, b step 0.05). */
export const BEST_FIT = { qi: 2350, de: 0.92, b: 1.1 };

export interface FitState {
  qi: number;
  /** Effective first-year decline, 0–1. */
  de: number;
  b: number;
}

export function fitError(s: FitState): number {
  const di = nominalFromEffective(s.de, s.b);
  return logRmsError(DATA, (t) => arpsRate(s.qi, di, s.b, t));
}

/** Challenge a: the curve fits the two years of data to within 7% (log RMS). */
export function fitSolved(s: FitState): boolean {
  return fitError(s) <= FIT_TOLERANCE;
}

const FIT_DEFAULTS: FitState & { view: 'two' | 'thirty' } = { qi: 1600, de: 0.6, b: 0, view: 'two' };

// ---------------------------------------------------------------------------
// Figure 2: Northfield as a whole field.

export const WELLS = 25;
export const DEFAULT_PRICE = 70;

const fieldCache = new Map<string, FieldYear[]>();
function runField(drive: Drive, floodYear: number, price: number): FieldYear[] {
  const key = `${drive}|${drive === 'waterflood' ? floodYear : 0}|${price}`;
  let rows = fieldCache.get(key);
  if (!rows) {
    rows = simulateField({ drive, floodYear, wells: WELLS, oilPrice: price, years: 50 });
    if (fieldCache.size > 300) fieldCache.clear();
    fieldCache.set(key, rows);
  }
  return rows;
}

export function floodRecovery(floodYear: number, price = DEFAULT_PRICE): number {
  return fieldOutcome(runField('waterflood', floodYear, price)).recovery;
}

/** Challenge b: the latest waterflood start (whole years of production first) that still recovers more than 40% at $70. */
export function floodTimingSolved(drive: Drive, floodYear: number, price: number): boolean {
  if (drive !== 'waterflood' || price !== DEFAULT_PRICE) return false;
  return floodRecovery(floodYear) > 0.4 && floodRecovery(floodYear + 1) < 0.4;
}

/** The latest whole-year flood start (0–20) that recovers more than 40% at a price, or −1 if none does. */
export function latestFloodStart(price: number): number {
  let last = -1;
  for (let y = 0; y <= 20; y++) if (floodRecovery(y, price) > 0.4) last = y;
  return last;
}

/** The most any flood start from 0 to 20 years recovers at a price. */
export function bestFloodRecovery(price: number): number {
  let best = 0;
  for (let y = 0; y <= 20; y++) best = Math.max(best, floodRecovery(y, price));
  return best;
}

/** How many years the field produces on pumps alone, with no flood, at a price. */
export function pumpsLife(price: number): number {
  return fieldOutcome(runField('pumps', 0, price)).life;
}

/** 13 → "13th". */
export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

function startText(price: number): string {
  const y = latestFloodStart(price);
  return y < 0
    ? `at ${usd(price)} no start reaches 40% (the best recovers ${pct(bestFloodRecovery(price), 1)})`
    : `at ${usd(price)} the field lasts ${pumpsLife(price)} years on pumps, and the last start that does comes after ${y} year${y === 1 ? '' : 's'}`;
}

/** Challenge b's closing sentence: how the latest start moves with the price. */
export function floodPriceNote(low = 40, high = 100): string {
  const s = `${startText(low)}; ${startText(high)}.`;
  return s[0].toUpperCase() + s.slice(1);
}

/** Every fit within the tolerance on the sliders' grid has b in this range. */
export const GOOD_B: [number, number] = [0.9, 1.25];

const DRIVE_LABEL: Record<Drive, string> ={ flowing: 'Natural flow', pumps: 'Pumps', waterflood: 'Waterflood' };
const OIL = '#d0702a';
const WATER = '#8a9bb0';
const PRESSURE = '#4590ce';

function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}

function bpd(x: number): string {
  return `${fmt(x)} b/d`;
}

function bbl(x: number): string {
  return `${fmt(roundTo(x, 1000))} bbl`;
}

export default function Lesson() {
  // ---- Figure 1.
  const s1 = useScenario('decline', FIT_DEFAULTS);
  const { qi, de, b, view } = s1.state;
  const di = nominalFromEffective(de, b);
  const err = fitError(s1.state);
  const eur30 = arpsCum(qi, di, b, 30);
  const eurTerminal = modifiedCum(qi, di, b, TERMINAL, 30);
  const thirty = view === 'thirty';
  const fitCurve = useMemo(() => {
    const months = thirty ? 360 : DATA_MONTHS;
    const n = thirty ? 360 : 96;
    return Array.from({ length: n + 1 }, (_, i) => {
      const m = (i / n) * months;
      return [m, arpsRate(qi, di, b, m / 12)] as [number, number];
    });
  }, [qi, di, b, thirty]);
  const terminalCurve = useMemo(
    () => (thirty ? Array.from({ length: 361 }, (_, m) => [m, modifiedRate(qi, di, b, TERMINAL, m / 12)] as [number, number]) : []),
    [qi, di, b, thirty],
  );
  const trueCurve = useMemo(() => WELL.rate.map((q, i) => [WELL.days[i] / (365.25 / 12), q] as [number, number]), []);
  const solvedA = err <= FIT_TOLERANCE;

  const bestDi = nominalFromEffective(BEST_FIT.de, BEST_FIT.b);
  const best30 = arpsCum(BEST_FIT.qi, bestDi, BEST_FIT.b, 30);
  const best100 = arpsCum(BEST_FIT.qi, bestDi, BEST_FIT.b, 100);
  const bestTerminal = modifiedCum(BEST_FIT.qi, bestDi, BEST_FIT.b, TERMINAL, 30);

  // ---- Figure 2.
  const s2 = useScenario('field', { drive: 'flowing' as Drive, floodYear: 3, price: DEFAULT_PRICE });
  const { drive, floodYear, price } = s2.state;
  const rows = runField(drive, floodYear, price);
  const out = fieldOutcome(rows);
  const lastRow = rows[Math.max(0, out.life - 1)];
  const flooding = drive === 'waterflood';
  const solvedB = floodTimingSolved(drive, floodYear, price);

  const flowing = fieldOutcome(runField('flowing', 0, DEFAULT_PRICE));
  const pumps = fieldOutcome(runField('pumps', 0, DEFAULT_PRICE));
  const flood3 = fieldOutcome(runField('waterflood', 3, DEFAULT_PRICE));
  const flood3Rows = runField('waterflood', 3, DEFAULT_PRICE);
  const flood3Last = flood3Rows[flood3.life - 1];
  const flood40 = fieldOutcome(runField('waterflood', 3, 40));
  const flood100 = fieldOutcome(runField('waterflood', 3, 100));
  const ooipM = NORTHFIELD_MODEL.ooip / 1e6;
  const m = NORTHFIELD_MODEL;
  // What lifting and handling water costs per barrel of oil at a 95% water cut.
  const cut = 0.95;
  const perOilBbl = m.liftPerBbl / (1 - cut) + (m.waterPerBbl * cut) / (1 - cut);

  const yearsShown = 40;
  const xs = rows.slice(0, yearsShown).map((r) => r.year + 0.5);

  return (
    <LessonPage id="oil/2.4">
      <P>
        <a href={lessonHref('oil/2.3')}>Lesson 2.3</a> designed the standard Pinyon well: a 10,000-foot lateral with 50 fracture stages, producing about{' '}
        {bpd(roundTo(WELL.rate[0], 100))} in its first month. It doesn’t hold that rate. By its twelfth month it makes about {bpd(roundTo(WELL.rate[11], 10))}, and
        after thirty years about {bpd(Math.round(WELL.rate[359]))}. Every well declines, for the reasons the last two lessons laid out: as oil leaves the rock, the
        pressure that pushes the rest toward the well falls, and the disturbance spreading from the well reaches rock that’s farther away and slower to give up its oil.
      </P>
      <P>
        How fast a well declines matters as much as how fast it starts. The oil a well will produce over its whole life — its <b>estimated ultimate recovery</b>, or
        EUR — is what a company books as reserves, borrows against and sells. And nobody can wait thirty years to measure it. So engineers fit a curve to the first
        months of production and extend it. The curves almost everyone uses were published in 1945 by J. J. Arps. A well that starts at an initial rate{' '}
        <K tone="orange">
          q<Sub>i</Sub>
        </K>{' '}
        and an initial decline D<Sub>i</Sub> produces, t years later,
      </P>
      <Eq label="Arps hyperbolic decline: q of t equals q i divided by the quantity 1 plus b times D i times t, raised to the power 1 over b">
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
              (1 + b·D<Sub>i</Sub>·t)<Sup>1/b</Sup>
            </span>
          }
        />
      </Eq>
      <P>
        The exponent b sets the shape. At b = 0 the curve is <b>exponential</b>: the well loses the same share of its rate every year. At b = 1 it is called{' '}
        <b>harmonic</b>, and in between <b>hyperbolic</b>. The larger b is, the faster the decline itself slows down. Declines are usually quoted as an <b>effective</b>{' '}
        annual rate — the share of the rate lost over the first year — rather than the instantaneous, or nominal, rate D<Sub>i</Sub> in the formula. They differ a lot
        when declines are steep: an exponential well that loses 65% of its rate in a year has a nominal decline of {fmt(nominalFromEffective(0.65, 0), 2)} per year.
      </P>
      <P>
        In the next demonstration, the dots are the first two years of the standard Pinyon well as a field engineer would see them: monthly averages, with a few
        percent of measurement noise. Fit a curve to them:
      </P>

      <Figure name="Production Decline Lab" scenario={s1}>
        <Segmented
          label="Time shown"
          value={view}
          onChange={(v) => s1.set({ view: v })}
          options={[
            { value: 'two', label: 'First two years' },
            { value: 'thirty', label: 'Thirty years' },
          ]}
        />
        <Legend
          items={[
            { label: 'Observed monthly rate', color: '#333' },
            { label: 'Fitted Arps curve', color: OIL, kind: 'line' },
            ...(thirty
              ? [
                  { label: `With ${pct(TERMINAL)} terminal decline`, color: '#8e4fa0', kind: 'line' as const, dashed: true },
                  { label: 'What the model well really does', color: '#9a9a9a', kind: 'line' as const },
                ]
              : []),
          ]}
        />
        <XYChart
          ariaLabel={`Monthly oil rate of the standard Pinyon well, log scale, with an Arps curve: initial rate ${fmt(qi)} barrels a day, first-year decline ${pct(de)}, b ${fmt(b, 2)}. Fit error ${pct(err, 1)}. ${thirty ? `Over thirty years the curve forecasts ${bbl(eur30)}; the model well produces ${bbl(TRUE_EUR30)}.` : ''}`}
          height={260}
          x={[0, thirty ? 360 : DATA_MONTHS]}
          y={thirty ? [1, 5000] : [60, 5000]}
          logY
          xTicks={thirty ? [0, 60, 120, 180, 240, 300, 360] : [0, 6, 12, 18, 24]}
          xFormat={(v) => (thirty ? `${v / 12}` : `${v}`)}
          yTicks={thirty ? [1, 10, 100, 1000] : [100, 300, 1000, 3000]}
          yFormat={(v) => fmt(v)}
          xLabel={thirty ? 'years on production' : 'months on production'}
          yLabel="Oil rate, barrels per day (log scale)"
          series={[
            ...(thirty ? [{ points: trueCurve, color: '#9a9a9a', width: 2 }] : []),
            ...(thirty ? [{ points: terminalCurve, color: '#8e4fa0', width: 2, dash: '6 4' }] : []),
            { points: fitCurve, color: OIL, width: 2.5 },
          ]}
          markers={DATA.map((d) => ({ x: d.t * 12, y: d.q, color: '#333', r: thirty ? 2.5 : 4 }))}
        />
        <Readouts
          items={[
            { label: 'fit error', value: pct(err, 1), tone: err <= FIT_TOLERANCE ? 'green' : 'red' },
            { label: <K tone="orange">forecast, 30 years</K>, value: bbl(eur30), tone: 'orange' },
            { label: `with ${pct(TERMINAL)} terminal decline`, value: bbl(eurTerminal) },
            { label: 'model well, 30 years', value: bbl(TRUE_EUR30) },
          ]}
        />
        <Slider label="Initial rate" tone="orange" value={qi} min={500} max={4000} step={50} onChange={(v) => s1.set({ qi: v })} display={bpd(qi)} />
        <Slider
          label="First-year decline"
          value={Math.round(de * 100)}
          min={30}
          max={95}
          onChange={(v) => s1.set({ de: v / 100 })}
          display={`${Math.round(de * 100)}% (nominal ${fmt(di, 2)}/yr)`}
        />
        <Slider label="Exponent b" tone="violet" value={b} min={0} max={2} step={0.05} onChange={(v) => s1.set({ b: Math.round(v * 100) / 100 })} display={fmt(b, 2)} />
        <Caption>
          The fit error is the typical gap between the curve and the dots, measured as a percentage of the rate. Under {pct(FIT_TOLERANCE)} the curve passes
          through the noise.
        </Caption>
      </Figure>

      <P>
        Start with an exponential curve, b = 0, and you’ll find that no setting fits. Make the first months right and the curve falls far too fast in the second
        year; make the second year right and it misses the first months badly. The shale well’s decline is itself declining: it loses most of its rate early and
        then flattens out. That takes a hyperbola, and a strongly curved one.
      </P>

      <Challenge
        id="a"
        question={`Fit the curve to the two years of data: get the fit error to ${pct(FIT_TOLERANCE)} or less.`}
        solved={solvedA}
        status={`The fit error is ${pct(err, 1)}.${b < 0.5 ? ' Try a larger b.' : ''}`}
        success={`Solved: an initial rate of ${bpd(qi)}, a first-year decline of ${Math.round(de * 100)}% and b = ${fmt(b, 2)} fit within ${pct(err, 1)}. Every curve that fits has b near or above 1: on these sliders, between ${fmt(GOOD_B[0], 2)} and ${fmt(GOOD_B[1], 2)}.`}
      />

      <H2>From a fit to a forecast</H2>
      <P>
        The best fit the sliders allow — an initial rate of {bpd(BEST_FIT.qi)}, a first-year decline of {pct(BEST_FIT.de)} and b = {fmt(BEST_FIT.b, 1)} — has b above
        1, and that is typical of shale wells. Its initial rate is far above the first-month average of about {bpd(roundTo(WELL.rate[0], 100))}, because q
        <Sub>i</Sub> is the rate at the instant the well opens, and a steep decline takes the rate well below it within the first month. Arps’s curves were empirical,
        and for wells draining a bounded area b usually falls between 0 and 1. A fractured shale well spends its first months in <b>linear flow</b>: oil crosses the
        rock along parallel paths straight into the flat fracture faces, as in <a href={lessonHref('oil/2.3')}>Lesson 2.3</a>, instead of converging on a wellbore.
        Pure linear flow behaves like b = 2. The early data carry that signature.
      </P>
      <P>
        Now switch the demonstration to thirty years. The fitted curve forecasts {bbl(best30)} over thirty years, and it never stops: with b above 1, the cumulative
        production of an Arps curve grows without limit, reaching {bbl(best100)} after a century. The well can’t do that. Once the pressure disturbances spreading
        from neighboring fractures meet — after about {fmt(WELL.transientEnd)} days in our model — each fracture is draining rock its neighbors also drain, and the
        decline stops easing so quickly. The gray line is what the model well actually does: {bbl(TRUE_EUR30)} in thirty years. So engineers rarely extend b above 1
        forever. A common practice is a <b>terminal decline</b>: once the curve’s decline rate has eased to a floor, often somewhere around 5–10% a year, the forecast
        switches to an exponential at that rate. With an 8% floor, the best fit forecasts {bbl(bestTerminal)}. Even that overshoots the model well by{' '}
        {pct(bestTerminal / TRUE_EUR30 - 1)}. Two years of data constrain the first two years well and the next twenty-eight poorly, and that uncertainty is built
        into every reserve estimate made from a young well.
      </P>

      <H2>A whole field</H2>
      <P>
        A field is many wells sharing one reservoir, and there the pressure story takes over. Northfield holds {fmt(ooipM)} million barrels in place, the trap of{' '}
        <a href={lessonHref('oil/2.1')}>Lesson 2.1</a> filled to its 8,000-foot contact. In the next demonstration, its {WELLS} wells produce for up to fifty years from
        a single shared pressure, with a water cut — the share of the produced liquid that’s water — that rises as oil is replaced by water. Choose how the field is
        produced, and the oil price:
      </P>

      <Figure name="Production Decline Lab · water" scenario={s2}>
        <Segmented
          label="How the field is produced"
          value={drive}
          onChange={(v) => s2.set({ drive: v })}
          options={(['flowing', 'pumps', 'waterflood'] as Drive[]).map((d) => ({ value: d, label: DRIVE_LABEL[d] }))}
        />
        <Legend
          items={[
            { label: 'Oil', color: OIL },
            { label: 'Water', color: WATER },
            { label: 'Reservoir pressure', color: PRESSURE, kind: 'line' },
          ]}
        />
        <XYChart
          ariaLabel={`Northfield’s production by year, ${DRIVE_LABEL[drive].toLowerCase()}${flooding ? ` from year ${floodYear}` : ''}, at ${usd(price)} oil: it produces for ${out.life} years, peaks at ${bpd(out.peakOil)} of oil and recovers ${pct(out.recovery, 1)} of the oil in place; the last year’s water cut is ${pct(lastRow.waterCut)}.`}
          height={210}
          x={[0, yearsShown]}
          y={[0, 70]}
          xTicks={[0, 10, 20, 30, 40]}
          yTicks={[0, 20, 40, 60]}
          yLabel="Liquid produced, thousand barrels a day"
          margin={[60, 16, 28, 26]}
          refs={flooding ? [{ axis: 'x', at: floodYear, color: PRESSURE, dash: '4 4', label: 'flood starts' }] : []}
        >
          {(sx, sy) => {
            const oil = rows.slice(0, yearsShown).map((r) => sy(r.oil / 1000));
            const total = rows.slice(0, yearsShown).map((r) => sy((r.oil + r.water) / 1000));
            const zero = xs.map(() => sy(0));
            const px = xs.map(sx);
            return (
              <g>
                <path d={areaPath(px, total, oil)} fill={WATER} opacity={0.55} />
                <path d={areaPath(px, oil, zero)} fill={OIL} opacity={0.75} />
              </g>
            );
          }}
        </XYChart>
        <XYChart
          ariaLabel={`Reservoir pressure by year: ${fmt(rows[0].pressure)} psi in the first year, ${fmt(rows[Math.min(yearsShown - 1, 10)].pressure)} psi in year 11.`}
          height={150}
          x={[0, yearsShown]}
          y={[0, 4000]}
          xTicks={[0, 10, 20, 30, 40]}
          yTicks={[0, 2000, 4000]}
          yFormat={(v) => `${fmt(v)}`}
          xLabel="years of production"
          yLabel="Reservoir pressure, psi"
          series={[{ points: rows.slice(0, yearsShown).map((r) => [r.year + 0.5, r.pressure] as [number, number]), color: PRESSURE, width: 2.5 }]}
          refs={[{ axis: 'y', at: flowingPwf(0), color: '#777', dash: '4 4', label: 'needed for natural flow' }]}
        />
        <Readouts
          items={[
            { label: 'field life', value: `${out.life} years` },
            { label: <K tone="orange">peak oil rate</K>, value: bpd(roundTo(out.peakOil, 100)), tone: 'orange' },
            { label: 'recovered', value: `${pct(out.recovery, 1)} of ${fmt(ooipM)}M bbl` },
            { label: 'water cut at the end', value: pct(lastRow.waterCut) },
          ]}
        />
        <Slider
          label="Waterflood starts after"
          tone="blue"
          value={floodYear}
          min={0}
          max={20}
          disabled={!flooding}
          onChange={(v) => s2.set({ floodYear: v })}
          display={`${floodYear} year${floodYear === 1 ? '' : 's'}`}
        />
        <Slider label="Oil price" tone="green" value={price} min={30} max={120} onChange={(v) => s2.set({ price: v })} display={`${usd(price)} per barrel`} />
      </Figure>

      <P>
        Start with natural flow. Northfield’s wells flow on their own only while the reservoir can push a column of fluid to the surface — the threshold of{' '}
        <a href={lessonHref('oil/2.1')}>Lesson 2.1</a>, about {fmt(roundTo(flowingPwf(0), 10))} psi at the bottom of a well full of oil. The first year averages{' '}
        {bpd(roundTo(runField('flowing', 0, DEFAULT_PRICE)[0].oil, 100))}, but Northfield’s oil is <b>undersaturated</b>: it holds less gas than it could dissolve at
        its pressure, so no gas has yet come out of it to expand and push. Liquid oil and rock barely expand as the pressure falls, so the pressure drops quickly as
        oil is taken out, and within {flowing.life} years the wells stop: only {pct(flowing.recovery, 1)} of the oil has come out. Water makes it worse. Brine is heavier than oil, so a well whose fluid is 30% water needs
        about {fmt(roundTo(flowingPwf(0.3), 10))} psi to flow.
      </P>
      <P>
        Pumps — <b>artificial lift</b> — lift the fluid so the reservoir doesn’t have to, letting each well draw its bottom pressure far below what natural flow
        needs. Run from the start, they make the first year average {bpd(roundTo(runField('pumps', 0, DEFAULT_PRICE)[0].oil, 100))} instead of{' '}
        {bpd(roundTo(runField('flowing', 0, DEFAULT_PRICE)[0].oil, 100))}, and the field produces for {pumps.life} years and recovers{' '}
        {pct(pumps.recovery, 1)}, about what this kind of reservoir yields from its own energy. Most of the oil stays in the rock. A <b>waterflood</b> changes that:
        injection wells pump water into the reservoir, holding up the pressure and pushing oil toward the producers. Started after three years, it lifts recovery to{' '}
        {pct(flood3.recovery, 1)} over {flood3.life} years. But the water arrives at the producers too. The water cut climbs, and by the final year{' '}
        {pct(flood3Last.waterCut)} of what the pumps lift is water.
      </P>
      <P>
        That’s what ends the field. At a {pct(cut)} water cut, every barrel of oil comes with {fmt(cut / (1 - cut))} barrels of water, and lifting and disposing of them
        costs about {usd(perOilBbl)} per barrel of oil before the wells’ fixed costs. When a month’s oil no longer pays for that, the field shuts in: its{' '}
        <b>economic limit</b>. Price moves the limit. With the waterflood started after three years, the field recovers {pct(flood40.recovery, 1)} at $40 and{' '}
        {pct(flood100.recovery, 1)} at $100, and lives {flood40.life} or {flood100.life} years. The rock is the same; what counts as recoverable depends on the price.
      </P>

      <Challenge
        id="b"
        question={`At ${usd(DEFAULT_PRICE)} oil, what is the latest a waterflood can start — after how many whole years of production — and still recover more than 40% of Northfield’s oil? Predict it first: on pumps alone, the field reaches its economic limit during its ${ordinal(pumps.life)} year. Then choose the waterflood and check.`}
        solved={solvedB}
        status={
          drive !== 'waterflood' || price !== DEFAULT_PRICE
            ? `Choose the waterflood, at ${usd(DEFAULT_PRICE)} oil.`
            : `Starting after ${floodYear} years, the field recovers ${pct(floodRecovery(floodYear), 1)}.`
        }
        success={`Solved: ${floodYear} years. On pumps alone the field shuts in during its ${ordinal(pumps.life)} year, so a flood that waits ${pumps.life} years finds it already closed, while one that starts after ${pumps.life - 1} catches it still running. Any earlier start recovers about the same oil — the flood sweeps the same rock — only sooner. ${floodPriceNote()}`}
      />

      <P>
        Even the waterflood leaves more than half of Northfield’s oil in place: oil trapped in pores the water bypassed, and oil held in the pores it swept. Enhanced
        recovery methods go after some of that — injecting carbon dioxide or chemicals that free trapped oil, or steam that thins heavy oil — at a higher cost per
        barrel. Whether any of them is worth doing, like whether the flood was, depends on what the extra barrels earn. The{' '}
        <a href={lessonHref('oil/2.5')}>next lesson</a> turns production profiles like the ones in{' '}
        <FigRef to="Production Decline Lab">the first demonstration</FigRef> into cash flows, and asks which wells and projects are worth their capital at a given
        price.
      </P>
    </LessonPage>
  );
}
