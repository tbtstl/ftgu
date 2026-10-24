import { useDeferredValue, useMemo } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  usd,
  useScenario,
} from '../../../framework';
import {
  HYDROGEN_CAPITAL,
  PLAN_LIMITS,
  SULFUR_CAPITAL,
  UNIT_CAPITAL,
  calderPrices,
  refineryCapital,
  refineryDay,
  refineryMargin,
  type RefineryDay,
} from '../../../engines/oil/business';
import { TERMS } from '../../../engines/oil/economics';
import { shadowPrices } from '../../../engines/oil/refinery';
import { HISTORY_DEFAULTS, oilHistory, type HistoryParams, type HistoryWeek } from '../../../model/oil/history';
import { CALDER, CRUDE_PRICE, PRODUCT_PRICE, UNIT_NAME, type RefineryConfig, type UnitId } from '../../../model/oil/refinery';
import { REF_PRICES } from '../../../model/oil/world';
import { BusinessCard } from '../shared/BusinessCard';
import { resetBusinessPart, updateBusiness, useBusiness } from '../shared/business';
import { XYChart } from '../shared/charts';
import { RefineryFlow } from '../shared/RefineryFlow';

// ---------------------------------------------------------------------------
// Valuing a design: its gain over today's Calder, week by week through the simulated history.

const UNITS: UnitId[] = ['cdu', 'reformer', 'fcc', 'coker', 'dht'];

/** Years an expansion is valued over, and the discount rate (Lesson 2.5's 10%). */
export const YEARS = 20;
export const RATE = TERMS.discount;
/** Present value of $1 a year for YEARS years at RATE. */
export const ANNUITY = (1 - Math.pow(1 + RATE, -YEARS)) / RATE;

/** A configuration with some units changed from today's Calder. */
export function designOf(capacity: Partial<Record<UnitId, number>>, hydrogenPlant = CALDER.hydrogenPlant, sulfurPlant = CALDER.sulfurPlant): RefineryConfig {
  return { capacity: { ...CALDER.capacity, ...capacity }, hydrogenPlant, sulfurPlant };
}

const gainCache = new Map<string, number[]>();
/** Each week's margin of a design less today's Calder's, $ per day, through a simulated history. */
export function weeklyGain(c: RefineryConfig, hp: HistoryParams = {}): number[] {
  const key = JSON.stringify([c, hp]);
  const hit = gainCache.get(key);
  if (hit) return hit;
  const h = oilHistory(hp);
  const d = refineryDay(c);
  const d0 = refineryDay(CALDER);
  const g = h.map((w) => refineryMargin(w, d) - refineryMargin(w, d0));
  if (gainCache.size > 300) gainCache.clear();
  gainCache.set(key, g);
  return g;
}

export interface DesignValue {
  /** Average gain over today's Calder across the five simulated years, $ per day. */
  gain: number;
  capital: number;
  /** The average gain earned every day for YEARS years at RATE, less the capital, $. */
  npv: number;
  /** Years of the average gain needed to repay the capital (Infinity if it never does). */
  payback: number;
}

export function designValue(c: RefineryConfig, hp: HistoryParams = {}): DesignValue {
  const g = weeklyGain(c, hp);
  const gain = g.reduce((a, b) => a + b, 0) / g.length;
  const capital = refineryCapital(c);
  return { gain, capital, npv: gain * 365 * ANNUITY - capital, payback: capital === 0 ? 0 : gain > 0 ? capital / (gain * 365) : Infinity };
}

const spCache = new Map<string, Record<UnitId, number>>();
/** Shadow prices of a design's units at reference prices (Lesson 3.5), $ per day per kb/d. */
export function designShadowPrices(c: RefineryConfig): Record<UnitId, number> {
  const key = JSON.stringify(c);
  let v = spCache.get(key);
  if (!v) {
    v = shadowPrices({ config: c });
    if (spCache.size > 300) spCache.clear();
    spCache.set(key, v);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Challenge a: the most valuable design within a capital budget.

export const BUDGET = 300e6;

let bestCache: { config: RefineryConfig; value: DesignValue } | null = null;
/**
 * The highest-NPV design that costs no more than the budget. Only the crude unit and the
 * hydrotreater are searched: the reformer, cracker, hydrogen and sulfur plants have room to spare
 * at these sizes and add nothing, and a coker expansion loses money on the simulated years. (A
 * search over every unit but the reformer, whose spare capacity is never used, finds the same
 * answer.)
 */
export function bestWithinBudget(): { config: RefineryConfig; value: DesignValue } {
  if (bestCache) return bestCache;
  const [c0, c1, cs] = PLAN_LIMITS.capacity.cdu;
  const [d0, d1, ds] = PLAN_LIMITS.capacity.dht;
  let best: { config: RefineryConfig; value: DesignValue } | null = null;
  for (let cdu = c0; cdu <= c1; cdu += cs)
    for (let dht = d0; dht <= d1; dht += ds) {
      const config = designOf({ cdu, dht });
      if (refineryCapital(config) > BUDGET) continue;
      const value = designValue(config);
      if (!best || value.npv > best.value.npv) best = { config, value };
    }
  bestCache = best!;
  return bestCache;
}

/** Challenge a: a design within the budget whose NPV on the simulated years is the highest available. */
export function budgetSolved(c: RefineryConfig): boolean {
  if (refineryCapital(c) > BUDGET) return false;
  return designValue(c).npv >= bestWithinBudget().value.npv - 1e5;
}

// ---------------------------------------------------------------------------
// The second demonstration: a design against the history's physical drivers.

export type Compare = 'coker' | 'yours';

export interface HistoryState {
  compare: Compare;
  /** A lasting widening of fuel oil's discount after year 2, $/bbl. */
  shift: number;
  seasonality: number;
}

export const HISTORY_STATE_DEFAULTS: HistoryState = { compare: 'coker', shift: 0, seasonality: HISTORY_DEFAULTS.seasonality };

/** The test expansion: 10 kb/d more coker, nothing else. */
export const COKER_TEST = designOf({ coker: CALDER.capacity.coker + 10 });
/** Challenge b: the payback the coker expansion must reach, years. */
export const PAYBACK_TARGET = 6;

export function historyParams(st: Pick<HistoryState, 'shift' | 'seasonality'>): HistoryParams {
  return { fuelOilShock: st.shift > 0 ? { year: 2, size: st.shift } : null, seasonality: st.seasonality };
}

/** The coker expansion's payback with a lasting fuel-oil shift of `shift` (seasons as usual), years. */
export function cokerPayback(shift: number): number {
  return designValue(COKER_TEST, historyParams({ shift, seasonality: HISTORY_DEFAULTS.seasonality })).payback;
}

/** Challenge b: the smallest whole-dollar shift at which the 10 kb/d coker pays back within the target. */
export function shiftSolved(st: HistoryState): boolean {
  if (st.compare !== 'coker' || st.seasonality !== HISTORY_DEFAULTS.seasonality) return false;
  return cokerPayback(st.shift) <= PAYBACK_TARGET && (st.shift === 0 || cokerPayback(st.shift - 1) > PAYBACK_TARGET);
}

/** The answer to challenge b. */
export function smallestShift(): number {
  for (let s = 0; s <= 20; s++) if (cokerPayback(s) <= PAYBACK_TARGET) return s;
  return NaN;
}

// ---------------------------------------------------------------------------
// Reference numbers for the prose, computed once.

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let c = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    c += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return c / Math.sqrt(va * vb);
}

/** Coldwater Heavy's discount to Ridgeback Light at Port Calder in a week, $/bbl. */
export function heavyDiscount(w: HistoryWeek): number {
  const p = calderPrices(w);
  return p.crude.ridgeback - p.crude.coldwater;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The crude unit and hydrotreater sizes the prose uses as its example of complementary units. */
export const EXAMPLE_CDU = 180;
export const EXAMPLE_DHT = 65;

let factsCache: ReturnType<typeof computeFacts> | null = null;
function computeFacts() {
  const h = oilHistory();
  const calder = refineryDay(CALDER);
  const sp = designShadowPrices(CALDER);
  const coker = refineryDay(COKER_TEST);
  const coker40 = refineryDay(designOf({ coker: CALDER.capacity.coker + 15 }));
  const cdu = designOf({ cdu: EXAMPLE_CDU });
  const dht = designOf({ dht: EXAMPLE_DHT });
  const dht60 = refineryDay(designOf({ dht: 60 }));
  const both = designOf({ cdu: EXAMPLE_CDU, dht: EXAMPLE_DHT });
  const shifted = historyParams({ shift: 10, seasonality: HISTORY_DEFAULTS.seasonality });
  const g = weeklyGain(COKER_TEST);
  const year2 = g.slice(52, 104);
  return {
    calder,
    calderHistory: mean(h.map((w) => refineryMargin(w, calder))),
    sp,
    coker,
    cokerRefGain: coker.margin - calder.margin,
    coker40RefGain: coker40.margin - calder.margin,
    coker40Sulfur: coker40.plan.sulfurPlant,
    cokerValue: designValue(COKER_TEST),
    cokerShifted: designValue(COKER_TEST, shifted),
    refDiscount: CRUDE_PRICE.ridgeback - CRUDE_PRICE.coldwater,
    histDiscount: mean(h.map(heavyDiscount)),
    refDieselCrack: PRODUCT_PRICE.diesel - REF_PRICES.brent,
    histDieselCrack: mean(h.map((w) => w.diesel - w.brent)),
    cduRefGain: refineryDay(cdu).margin - calder.margin,
    cduValue: designValue(cdu),
    cduSp: designShadowPrices(cdu),
    dht60Feed: dht60.plan.unitFeed.dht,
    dhtValue: designValue(dht),
    bothValue: designValue(both),
    bothShifted: designValue(both, shifted),
    corrDiscount: corr(g, h.map(heavyDiscount)),
    year2Gain: mean(year2),
    year2Discount: mean(h.slice(52, 104).map(heavyDiscount)),
    worstWeek: Math.min(...g),
  };
}
function facts() {
  return (factsCache ??= computeFacts());
}

// ---------------------------------------------------------------------------
// Formatting.

function money(x: number): string {
  const a = Math.abs(x);
  const s = x < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${fmt(a / 1e9, 2)} billion`;
  if (a >= 1e6) {
    const m = a / 1e6;
    const digits = Math.abs(m - Math.round(m)) < 0.005 || a >= 1e8 ? 0 : a < 1e7 ? 2 : 1;
    return `${s}$${fmt(m, digits)} million`;
  }
  return `${s}${usd(Math.round(a / 100) * 100)}`;
}
const perDay = (x: number) => `${money(x)} a day`;
const perBbl = (x: number) => usd(x / 1000, 2);
const years = (x: number) => (Number.isFinite(x) ? `${fmt(x, 1)} years` : 'never');
const kbd = (x: number) => `${fmt(x, x < 10 ? 1 : 0)} kb/d`;
const yearTick = (v: number) => (v === 0 ? 'start' : `year ${v}`);
const tone = (v: number) => (v > 0 ? ('green' as const) : v < 0 ? ('red' as const) : ('ink' as const));

function fullUnits(d: RefineryDay, c: RefineryConfig): UnitId[] {
  return UNITS.filter((u) => d.plan.unitFeed[u] >= c.capacity[u] - 1e-6);
}

function listOf(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const GAIN_COLOR = GRAPHIC.green;
const DISCOUNT_COLOR = '#6b5a4e';

// ---------------------------------------------------------------------------

export default function Lesson() {
  const f = facts();
  const business = useBusiness();
  const config = business.refinery;
  const day = refineryDay(config);
  const gainRef = day.margin - f.calder.margin;
  const deferred = useDeferredValue(config);
  const value = useMemo(() => designValue(deferred), [deferred]);
  const sp = useMemo(() => designShadowPrices(deferred), [deferred]);
  const capital = refineryCapital(config);
  const full = fullUnits(day, config);
  const solvedA = useMemo(() => budgetSolved(deferred), [deferred]);
  const best = bestWithinBudget();

  const setUnit = (u: UnitId, v: number) => updateBusiness('refinery', { capacity: { ...config.capacity, [u]: v } });
  const unitSlider = (u: UnitId, label: string) => {
    const [min, max, step] = PLAN_LIMITS.capacity[u];
    return (
      <Slider
        key={u}
        label={label}
        tone="orange"
        value={config.capacity[u]}
        min={min}
        max={max}
        step={step}
        onChange={(v) => setUnit(u, v)}
        display={`${fmt(config.capacity[u])} kb/d${config.capacity[u] > CALDER.capacity[u] ? ` (+${fmt(config.capacity[u] - CALDER.capacity[u])})` : ''}`}
      />
    );
  };

  // Second demonstration.
  const s2 = useScenario<HistoryState>('history', HISTORY_STATE_DEFAULTS);
  const st = s2.state;
  const hp = useMemo(() => historyParams(st), [st]);
  const compareConfig = st.compare === 'coker' ? COKER_TEST : deferred;
  const h2 = useMemo(() => oilHistory(hp), [hp]);
  const g2 = useMemo(() => weeklyGain(compareConfig, hp), [compareConfig, hp]);
  const v2 = useMemo(() => designValue(compareConfig, hp), [compareConfig, hp]);
  const gainPts = useMemo(() => g2.map((v, i) => [h2[i].t, v / 1000] as [number, number]), [g2, h2]);
  const discPts = useMemo(() => h2.map((w) => [w.t, heavyDiscount(w)] as [number, number]), [h2]);
  const [gLo, gHi] = niceDomain(Math.min(0, ...gainPts.map((p) => p[1])), Math.max(10, ...gainPts.map((p) => p[1])), 4);
  const [dLo, dHi] = niceDomain(Math.min(...discPts.map((p) => p[1])), Math.max(...discPts.map((p) => p[1])), 3);
  const solvedB = useMemo(() => shiftSolved(st), [st]);
  const answerB = smallestShift();
  const shiftRef = st.shift > 0 ? [{ axis: 'x' as const, at: 2, color: TEXT.gold, dash: '4 4', label: 'shift begins' }] : [];
  const compareName = st.compare === 'coker' ? 'the 10 kb/d coker expansion' : 'your design';

  const crudeText = (d: RefineryDay) =>
    listOf(
      (['ridgeback', 'coldwater', 'northfield', 'seaboard'] as const)
        .filter((k) => d.crude[k] >= 0.5)
        .map((k) => `${kbd(d.crude[k])} of ${{ ridgeback: 'Ridgeback Light', coldwater: 'Coldwater Heavy', northfield: 'Northfield Sour', seaboard: 'Seaboard Blend' }[k]}`),
    );

  return (
    <LessonPage id="oil/7.2">
      <P>
        In <a href={lessonHref('oil/7.1')}>Lesson 7.1</a> the company planned its oil fields. Their crude reaches the market at Kessler, and from there much of
        the basin’s oil travels down to Port Calder, where the company’s other big asset stands: the Calder refinery of Chapter 3. Calder buys{' '}
        {kbd(f.calder.runs)} of crude and turns it into gasoline, jet fuel, diesel and the rest. Run through the five simulated years of Chapter 5, as{' '}
        <a href={lessonHref('oil/6.4')}>Lesson 6.4</a> ran it, it earns an average {perDay(f.calderHistory)}. This lesson asks what the company should
        build there.
      </P>
      <P>
        Every tool for the question is already in hand. The linear program of <a href={lessonHref('oil/3.5')}>Lesson 3.5</a> finds the best way to run any set of
        units at the reference prices — which crudes to buy, where each stream goes — and its <K c="price">shadow prices</K> say what one more barrel a day of
        each unit would add. To value an expansion, we take the plan the program chooses and run it through every week of the simulated history at that week’s
        prices, as Calder’s own plan was run in Lesson 6.4. The difference from today’s Calder is the expansion’s <K c="price">gain</K>. Earned every day for{' '}
        {YEARS} years and discounted at {fmt(RATE * 100)}% a year, the rate of <a href={lessonHref('oil/2.5')}>Lesson 2.5</a>, the average gain less the capital
        is the expansion’s <K c="price">net present value</K>; the capital divided by a year’s gain is its <K c="price">payback</K>. Building costs, per thousand
        barrels a day of new capacity, are illustrative: {money(UNIT_CAPITAL.cdu)} for the crude unit or the hydrotreater, {money(UNIT_CAPITAL.reformer)} for the
        reformer, {money(UNIT_CAPITAL.fcc)} for the cracker and {money(UNIT_CAPITAL.coker)} for the coker, with {money(HYDROGEN_CAPITAL)} per million cubic feet a
        day of hydrogen and {money(SULFUR_CAPITAL)} per tonne a day of sulfur.
      </P>
      <P>
        In the next demonstration, each slider sets one unit’s capacity, starting from Calder as it stands. The diagram is the program’s plan at the reference
        prices. Whatever you build here is kept: the rest of this chapter runs the refinery you design:
      </P>

      <Figure name="Refinery Builder" onReset={() => resetBusinessPart('refinery')}>
        <BusinessCard current="refinery" parts={['refinery', 'production']} />
        <RefineryFlow
          plan={day.plan}
          height={380}
          ariaLabel={`Your refinery’s plan at reference prices: it runs ${crudeText(day)}, and makes ${kbd(day.products.gasoline)} of gasoline, ${kbd(day.products.jet)} of jet fuel, ${kbd(day.products.diesel)} of diesel and ${kbd(day.products.hsfo)} of fuel oil, for a margin of ${perDay(day.margin)}.`}
        />
        <Readouts
          items={[
            { label: <K c="price">margin at reference prices</K>, value: perDay(day.margin), tone: 'green' },
            { label: <K c="price">gain at reference prices</K>, value: perDay(gainRef), tone: tone(gainRef) },
            { label: <K c="price">gain, simulated years</K>, value: perDay(value.gain), tone: tone(value.gain) },
            { label: 'capital', value: money(capital) },
            { label: <K c="price">payback</K>, value: capital === 0 ? '—' : years(value.payback) },
            { label: <K c="price">net present value</K>, value: money(value.npv), tone: tone(value.npv) },
          ]}
        />
        {unitSlider('cdu', 'Crude unit')}
        {unitSlider('reformer', 'Reformer')}
        {unitSlider('fcc', 'Catalytic cracker')}
        {unitSlider('coker', 'Coker')}
        {unitSlider('dht', 'Diesel hydrotreater')}
        <Slider
          label="Hydrogen plant"
          tone="teal"
          value={config.hydrogenPlant}
          min={PLAN_LIMITS.hydrogenPlant[0]}
          max={PLAN_LIMITS.hydrogenPlant[1]}
          step={PLAN_LIMITS.hydrogenPlant[2]}
          onChange={(v) => updateBusiness('refinery', { hydrogenPlant: v })}
          display={`${fmt(config.hydrogenPlant)} MMscf/d`}
        />
        <Slider
          label="Sulfur plant"
          tone="gold"
          value={config.sulfurPlant}
          min={PLAN_LIMITS.sulfurPlant[0]}
          max={PLAN_LIMITS.sulfurPlant[1]}
          step={PLAN_LIMITS.sulfurPlant[2]}
          onChange={(v) => updateBusiness('refinery', { sulfurPlant: v })}
          display={`${fmt(config.sulfurPlant)} t/d`}
        />
        <Caption>
          The plan runs {crudeText(day)}. Full units: {full.length ? listOf(full.map((u) => UNIT_NAME[u].toLowerCase())) : 'none'}
          {full.length ? `; one more barrel a day of capacity would add ${listOf(full.map((u) => `${perBbl(sp[u])} (${UNIT_NAME[u].toLowerCase()})`))}` : ''}. The
          hydrogen plant makes {fmt(day.plan.hydrogen.plant, 1)} of its {fmt(config.hydrogenPlant)} MMscf a day; the sulfur plant takes {fmt(day.plan.sulfurPlant)} of
          its {fmt(config.sulfurPlant)} tonnes.
        </Caption>
      </Figure>

      <P>
        Today three units are full: the crude unit, the coker and the hydrotreater. One more barrel a day of capacity would add {perBbl(f.sp.cdu)} to the daily
        margin in the crude unit, {perBbl(f.sp.coker)} in the coker and {perBbl(f.sp.dht)} in the hydrotreater. The reformer and the cracker have room to spare,
        the hydrogen plant runs at {fmt(f.calder.plan.hydrogen.plant, 1)} of its {fmt(CALDER.hydrogenPlant)} MMscf a day and the sulfur plant at{' '}
        {fmt(f.calder.plan.sulfurPlant)} of its {fmt(CALDER.sulfurPlant)} tonnes, so expanding any of those buys nothing at all.
      </P>
      <P>
        Lesson 3.5 found the coker the best single expansion at the reference prices: {kbd(10)} more adds {perDay(f.cokerRefGain)}. The program
        spends the new capacity on a swap, cutting Ridgeback Light from {kbd(f.calder.crude.ridgeback)} to {kbd(f.coker.crude.ridgeback)} and raising Coldwater Heavy from{' '}
        {kbd(f.calder.crude.coldwater)} to {kbd(f.coker.crude.coldwater)}. But through the simulated years the same expansion gains only{' '}
        {perDay(f.cokerValue.gain)}. It would take {years(f.cokerValue.payback)} to repay its {money(f.cokerValue.capital)}, and its net present value is{' '}
        {money(f.cokerValue.npv)}. The reference month flattered it twice. Coldwater’s discount to Ridgeback Light at Port Calder averaged{' '}
        {usd(f.histDiscount, 2)} over the five years against the reference month’s {usd(f.refDiscount, 2)}, so each barrel swapped saved less; and the swap gives
        up diesel and jet fuel, while diesel’s crack averaged {usd(f.histDieselCrack, 2)} against {usd(f.refDieselCrack, 2)}. Going further doesn’t help: at{' '}
        {kbd(CALDER.capacity.coker + 15)} the gain at reference prices stops at {perDay(f.coker40RefGain)}, because the sulfur plant reaches its{' '}
        {fmt(f.coker40Sulfur)} tonnes a day and becomes the bottleneck.
      </P>

      <H2>Moving the bottleneck</H2>
      <P>
        The crude unit tells the opposite story. Taking it to {kbd(EXAMPLE_CDU)} gains {perDay(f.cduRefGain)} at reference prices but{' '}
        {perDay(f.cduValue.gain)} through the simulated years, when products sold at wider cracks than in the reference month, and it repays its{' '}
        {money(f.cduValue.capital)} in {years(f.cduValue.payback)}. Notice what it does to the other units. At {kbd(EXAMPLE_CDU)} of crude, the hydrotreater’s
        shadow price rises from {perBbl(f.sp.dht)} to {perBbl(f.cduSp.dht)} a barrel: a bigger crude unit makes more diesel, and all of it must be desulfurized.
        On its own, a bigger hydrotreater soon runs out of work — at {kbd(60)} of capacity the program fills only {kbd(f.dht60Feed)} of it, and at{' '}
        {kbd(EXAMPLE_DHT)} the extra capital leaves it worth just {money(f.dhtValue.npv)}. Built together with the bigger crude unit, the two are worth{' '}
        {money(f.bothValue.npv)}, far more than {money(f.cduValue.npv)} and {money(f.dhtValue.npv)} apart. Units are complements: expanding one bottleneck moves
        the bottleneck, and the shadow prices of Lesson 3.5 show where it moved.
      </P>

      <Challenge
        id="a"
        figure="Refinery Builder"
        question={`With ${money(BUDGET)} to spend, find the design with the highest net present value on the simulated years.`}
        solved={solvedA}
        status={
          capital > BUDGET
            ? `Your design costs ${money(capital)}, more than the ${money(BUDGET)} available.`
            : `Your design costs ${money(capital)} and is worth ${money(value.npv)}.`
        }
        success={`Solved: a ${kbd(best.config.capacity.cdu)} crude unit and a ${kbd(best.config.capacity.dht)} hydrotreater, for ${money(best.value.capital)}, worth ${money(best.value.npv)} — a gain of ${perDay(best.value.gain)} that repays the capital in ${years(best.value.payback)}. No other design within the budget is worth more on these five years.`}
      />

      <H2>A bet on the heavy discount</H2>
      <P>
        An expansion’s value is a forecast of prices it will earn on, and the coker’s depends on one price more than any other. In the next demonstration, the upper chart
        is the weekly gain of either the {kbd(10)} coker expansion or your own design over today’s Calder; the lower one is Coldwater Heavy’s discount to Ridgeback
        Light at Port Calder. Next to them are two physical drivers from Chapter 6: a lasting widening of fuel oil’s discount to crude after year 2, like the one
        in <a href={lessonHref('oil/6.2')}>Lesson 6.2</a>, and the seasonal swing in product demand:
      </P>

      <Figure name="Refinery Builder · through the history" scenario={s2}>
        <Segmented
          label="Compare today’s Calder with"
          value={st.compare}
          onChange={(v) => s2.set({ compare: v })}
          options={[
            { value: 'coker', label: 'Coker +10 kb/d' },
            { value: 'yours', label: 'Your design' },
          ]}
        />
        <XYChart
          ariaLabel={`Weekly gain of ${compareName} over today’s Calder through five simulated years: between ${perDay(Math.min(...g2))} and ${perDay(Math.max(...g2))}, averaging ${perDay(v2.gain)}.`}
          height={190}
          x={[0, 5]}
          y={[gLo, gHi]}
          xTicks={[0, 1, 2, 3, 4, 5]}
          xFormat={yearTick}
          yTicks={niceTicks(gLo, gHi, 4)}
          yFormat={(v) => `$${fmt(v)}k`}
          yLabel="Gain over today’s Calder, $ thousand a day"
          series={[
            { points: gainPts, color: GAIN_COLOR, width: 1.5, fillTo: 0, fillOpacity: 0.12 },
          ]}
          refs={[{ axis: 'y', at: v2.gain / 1000, color: TEXT.green, dash: '4 4', label: `average ${money(v2.gain)}` }, ...shiftRef]}
        />
        <XYChart
          ariaLabel={`Coldwater Heavy’s discount to Ridgeback Light at Port Calder, between ${usd(Math.min(...discPts.map((p) => p[1])), 2)} and ${usd(Math.max(...discPts.map((p) => p[1])), 2)} a barrel.`}
          height={130}
          x={[0, 5]}
          y={[dLo, dHi]}
          xTicks={[0, 1, 2, 3, 4, 5]}
          xFormat={yearTick}
          yTicks={niceTicks(dLo, dHi, 3)}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Coldwater Heavy’s discount to Ridgeback Light, $ per barrel"
          series={[{ points: discPts, color: DISCOUNT_COLOR, width: 1.5 }]}
          refs={shiftRef.map((r) => ({ ...r, label: undefined }))}
        />
        <Readouts
          items={[
            { label: <K c="price">average gain</K>, value: perDay(v2.gain), tone: tone(v2.gain) },
            { label: 'capital', value: money(v2.capital) },
            { label: <K c="price">payback</K>, value: v2.capital === 0 ? '—' : years(v2.payback) },
            { label: <K c="price">net present value</K>, value: money(v2.npv), tone: tone(v2.npv) },
          ]}
        />
        <Slider
          label="Fuel oil’s discount, after year 2"
          tone="gold"
          value={st.shift}
          min={0}
          max={20}
          onChange={(v) => s2.set({ shift: v })}
          display={st.shift === 0 ? 'no change' : `$${st.shift} wider`}
        />
        <Slider
          label="Seasonal swing in demand"
          tone="red"
          value={st.seasonality}
          min={0}
          max={2}
          step={0.1}
          onChange={(v) => s2.set({ seasonality: Math.round(v * 10) / 10 })}
          display={`×${fmt(st.seasonality, 1)}${st.seasonality === HISTORY_DEFAULTS.seasonality ? ' (normal)' : ''}`}
        />
        <Caption>
          {st.compare === 'yours' && capital === 0
            ? 'Your design is still today’s Calder, so it gains nothing; build something in the first demonstration to compare it here.'
            : `Over the five years, ${compareName} gains ${perDay(v2.gain)} on average over today’s Calder, against ${money(v2.capital)} of capital.`}
        </Caption>
      </Figure>

      <P>
        The coker’s gain follows the heavy discount week by week: their correlation over the five years is {fmt(f.corrDiscount, 2)}. In year 2, when Coldwater’s
        discount averaged {usd(f.year2Discount, 2)}, the coker gained only {perDay(f.year2Gain)}, and in its worst week it lost {perDay(-f.worstWeek)}. Now widen
        fuel oil’s discount by $10 after year 2. Coldwater’s price follows fuel oil’s, by a little over a third of every dollar (
        <a href={lessonHref('oil/4.5')}>Lesson 4.5</a>), and the coker design runs {kbd(f.coker.crude.coldwater - f.calder.crude.coldwater)} more of it. Its average
        gain rises to {perDay(f.cokerShifted.gain)}, its payback falls to {years(f.cokerShifted.payback)}, and its net present value turns to{' '}
        {money(f.cokerShifted.npv)}. A design built on the crude unit and the hydrotreater hardly notices: the {kbd(EXAMPLE_CDU)} and {kbd(EXAMPLE_DHT)} pair
        gains {perDay(f.bothShifted.gain)} with the shift against {perDay(f.bothValue.gain)} without it. Build your own design in{' '}
        <FigRef to="Refinery Builder">the first demonstration</FigRef> and compare it here to see which prices it depends on. A lasting change like the 2020 limit
        on sulfur in ships’ fuel is exactly the kind of physical fact that decides whether a coker pays.
      </P>

      <Challenge
        id="b"
        figure="Refinery Builder · through the history"
        question={`Compare the 10 kb/d coker expansion with the seasons at normal. What is the smallest lasting widening of fuel oil’s discount, to the nearest dollar, at which it pays back within ${PAYBACK_TARGET} years?`}
        solved={solvedB}
        status={
          st.compare !== 'coker' || st.seasonality !== HISTORY_DEFAULTS.seasonality
            ? 'Choose the coker expansion and set the seasonal swing back to normal.'
            : `With fuel oil’s discount ${st.shift === 0 ? 'unchanged' : `$${st.shift} wider`}, the coker pays back in ${years(v2.payback)}.`
        }
        success={`Solved: $${answerB}. The coker then gains ${perDay(designValue(COKER_TEST, historyParams({ shift: answerB, seasonality: HISTORY_DEFAULTS.seasonality })).gain)} on average and pays back in ${years(cokerPayback(answerB))}; a dollar less and it takes ${years(cokerPayback(answerB - 1))}. Building a coker is a bet that heavy, sour crude stays cheap.`}
      />

      <P>
        Whatever the design, almost every barrel it runs starts inland. The refinery you have built runs {crudeText(day)}. Ridgeback Light and Coldwater Heavy
        both reach Port Calder through Kessler, down the Kessler–Calder line or by rail. When that line fills, as it did in the simulated years, Kessler’s price
        falls away from the coast’s, and the company’s own crude, sold at Kessler, falls with it. <a href={lessonHref('oil/7.3')}>Lesson 7.3</a> builds the logistics that connect the company’s fields to its refinery.
      </P>
    </LessonPage>
  );
}
