import { useDeferredValue, useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, usd, useScenario } from '../../../framework';
import { crude } from '../../../engines/oil/assay';
import { distill } from '../../../engines/oil/refining';
import { FUEL_OIL_SULFUR, JET_SULFUR, crudeBreakeven, marginPerBarrel, planRefinery, shadowPrices, type RefineryInputs, type RefineryPlan } from '../../../engines/oil/refinery';
import { CRUDE_COLOR, CRUDE_IDS, CRUDE_SPECS, type CrudeId } from '../../../model/oil/crudes';
import { CORRAN, CRUDE_PRICE, PRODUCT_PRICE, UNIT_NAME, type RefineryConfig, type UnitId } from '../../../model/oil/refinery';
import { RefineryFlow } from '../shared/RefineryFlow';
import { bestConversion } from './L3_2';

const NAME: Record<CrudeId, string> = Object.fromEntries(CRUDE_SPECS.map((s) => [s.id, s.name])) as Record<CrudeId, string>;
const UNITS: UnitId[] = ['cdu', 'reformer', 'fcc', 'coker', 'dht'];
const PRICE_STEP = 0.5;
/** The Coldwater price slider's top, and the Northfield slider's bottom. */
const COLDWATER_MAX = 80;
const NORTHFIELD_MIN = 60;

interface PriceState {
  gasoline: number;
  diesel: number;
  coldwater: number;
  northfield: number;
}

const PRICE_DEFAULTS: PriceState = { gasoline: PRODUCT_PRICE.gasoline, diesel: PRODUCT_PRICE.diesel, coldwater: CRUDE_PRICE.coldwater, northfield: CRUDE_PRICE.northfield };

function inputsOf(s: PriceState): RefineryInputs {
  return { productPrice: { gasoline: s.gasoline, diesel: s.diesel }, crudePrice: { coldwater: s.coldwater, northfield: s.northfield } };
}

/** Challenge a: at the reference prices for everything else, the highest Coldwater price (on the slider's 50¢ steps) at which the plan still runs some Coldwater Heavy. */
export function coldwaterLimitSolved(s: PriceState): boolean {
  if (s.gasoline !== PRICE_DEFAULTS.gasoline || s.diesel !== PRICE_DEFAULTS.diesel || s.northfield !== PRICE_DEFAULTS.northfield) return false;
  const runs = (p: number) => planRefinery(inputsOf({ ...s, coldwater: p })).crude.coldwater;
  return runs(s.coldwater) >= 0.5 && runs(s.coldwater + PRICE_STEP) < 0.5;
}

/**
 * Raising Coldwater's price from its reference on the slider's 50¢ steps, other prices at reference:
 * the first price at which the plan runs less Coldwater (and how much it then runs), and the first
 * at which Northfield Sour fills more than half the crude unit.
 */
export function coldwaterSteps(): { cut: number; cutTo: number; switchAt: number } {
  const start = planRefinery().crude.coldwater;
  let cut = NaN;
  let cutTo = NaN;
  for (let p = CRUDE_PRICE.coldwater + PRICE_STEP; p <= COLDWATER_MAX; p += PRICE_STEP) {
    const plan = planRefinery({ crudePrice: { coldwater: p } });
    if (Number.isNaN(cut) && plan.crude.coldwater < start - 0.5) {
      cut = p;
      cutTo = plan.crude.coldwater;
    }
    if (plan.crude.northfield > CORRAN.capacity.cdu / 2) return { cut, cutTo, switchAt: p };
  }
  return { cut, cutTo, switchAt: NaN };
}

/**
 * Lowering Northfield Sour's price from its reference on the slider's 50¢ steps, other prices at
 * reference: the first price at which the plan runs some of it, and the first at which it runs
 * nothing else.
 */
export function northfieldSteps(): { enters: number; only: number } {
  let enters = NaN;
  for (let p = CRUDE_PRICE.northfield - PRICE_STEP; p >= NORTHFIELD_MIN; p -= PRICE_STEP) {
    const plan = planRefinery({ crudePrice: { northfield: p } });
    if (Number.isNaN(enters) && plan.crude.northfield >= 0.5) enters = p;
    if (plan.crude.northfield >= CORRAN.capacity.cdu - 0.5) return { enters, only: p };
  }
  return { enters, only: NaN };
}

/** The product prices the guided tour of the first demonstration's other sliders uses, $/bbl. */
export const GASOLINE_EXAMPLE = 90;
export const DIESEL_EXAMPLE = 70;

/** The coking capacity, kb/d, past which one more kb/d adds nothing to the margin: the coker stops being a bottleneck. */
export function cokerBottleneckEnd(): number {
  const marginAt = (c: number) => planRefinery({ config: { ...CORRAN, capacity: { ...CORRAN.capacity, coker: c } } }).margin;
  let c = CORRAN.capacity.coker;
  let m = marginAt(c);
  for (; c < CORRAN.capacity.coker + 50; c++) {
    const next = marginAt(c + 1);
    if (next - m < 1) return c;
    m = next;
  }
  return c;
}

/** "a, b and c". */
function listOf(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The capacity added in the second demonstration. */
export const EXPANSION = 10;
/** The hydrotreater expansion the prose points to. */
export const DHT_EXAMPLE = 5;

export function expandedConfig(unit: UnitId | 'none', added: number): RefineryConfig {
  if (unit === 'none' || added === 0) return CORRAN;
  return { ...CORRAN, capacity: { ...CORRAN.capacity, [unit]: CORRAN.capacity[unit] + added } };
}

/** Margin gained per day by adding `added` kb/d to a unit, $. */
export function expansionGain(unit: UnitId | 'none', added: number): number {
  return planRefinery({ config: expandedConfig(unit, added) }).margin - planRefinery().margin;
}

/** Challenge b: the unit whose 10 kb/d expansion adds the most margin. */
export function bestExpansionSolved(unit: UnitId | 'none', added: number): boolean {
  if (unit === 'none' || added !== EXPANSION) return false;
  const gains = UNITS.map((u) => expansionGain(u, EXPANSION));
  return expansionGain(unit, EXPANSION) >= Math.max(...gains) - 1;
}

function money(x: number): string {
  const a = Math.abs(x);
  return a >= 1e6 ? `${x < 0 ? '−' : ''}$${fmt(a / 1e6, 2)} million` : usd(x);
}

function kbd(x: number): string {
  return `${fmt(x, x < 10 && x > 0.05 ? 1 : 0)} kb/d`;
}

function slateText(p: RefineryPlan): string {
  const parts = CRUDE_IDS.filter((k) => p.crude[k] >= 0.5).map((k) => `${kbd(p.crude[k])} of ${NAME[k]}`);
  return parts.length ? parts.join(' and ') : 'no crude';
}

/** Bars of each crude's value at the refinery against its delivered price. */
function CrudeValues({ values, prices, runs }: { values: Record<CrudeId, number>; prices: Record<CrudeId, number>; runs: Record<CrudeId, number> }) {
  const X0 = 150;
  const X1 = 610;
  const lo = 50;
  const hi = 90;
  const sx = (v: number) => X0 + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (X1 - X0);
  const rowH = 34;
  const top = 26;
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${top + rowH * 4 + 26}`}
      role="img"
      aria-label={`Each crude’s value at the Corran refinery against its delivered price: ${CRUDE_IDS.map((k) => `${NAME[k]} worth ${usd(values[k], 2)}, priced ${usd(prices[k], 2)}`).join('; ')}.`}
    >
      <text className="ax" x={X0} y={14}>
        Value to the refinery (bar) against the delivered price (tick), $ per barrel
      </text>
      {[50, 60, 70, 80, 90].map((v) => (
        <g key={v}>
          <line className="gl" x1={sx(v)} x2={sx(v)} y1={top} y2={top + rowH * 4} />
          <text className="ax ax-m" x={sx(v)} y={top + rowH * 4 + 16}>
            ${v}
          </text>
        </g>
      ))}
      {CRUDE_IDS.map((k, i) => {
        const y = top + i * rowH;
        const bought = runs[k] >= 0.5;
        return (
          <g key={k}>
            <text x={X0 - 8} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333', fontWeight: bought ? 600 : 400 }}>
              {NAME[k]}
            </text>
            <rect x={sx(lo)} y={y + 8} width={Math.max(0, sx(values[k]) - sx(lo))} height={rowH - 16} fill={CRUDE_COLOR[k]} opacity={bought ? 0.85 : 0.35} />
            <line x1={sx(prices[k])} x2={sx(prices[k])} y1={y + 3} y2={y + rowH - 3} stroke="#333" strokeWidth={2.5} />
            <text x={Math.max(sx(values[k]), sx(prices[k])) + 6} y={y + rowH / 2 + 4} style={{ fontSize: 12, fill: values[k] >= prices[k] ? '#3f7a1e' : '#c4382f', fontWeight: 500 }}>
              {values[k] >= prices[k] ? `${usd(values[k] - prices[k], 2)} more than its price` : `${usd(prices[k] - values[k], 2)} less than its price`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Shadow prices of each unit: what one more kb/d of capacity would add, $ per barrel. */
function ShadowBars({ sp, feed, config }: { sp: Record<UnitId, number>; feed: Record<UnitId, number>; config: RefineryConfig }) {
  const X0 = 170;
  const X1 = 560;
  const max = 30;
  const rowH = 28;
  const top = 24;
  const sx = (v: number) => X0 + (Math.max(0, Math.min(max, v)) / max) * (X1 - X0);
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${top + rowH * UNITS.length + 22}`}
      role="img"
      aria-label={`What one more thousand barrels a day of each unit would add to the margin: ${UNITS.map((u) => `${UNIT_NAME[u]} ${usd(sp[u] / 1000, 2)} per barrel`).join(', ')}.`}
    >
      <text className="ax" x={X0} y={14}>
        Shadow price: margin added by one more barrel a day of capacity, $ per barrel
      </text>
      {[0, 10, 20, 30].map((v) => (
        <g key={v}>
          <line className={v === 0 ? 'base' : 'gl'} x1={sx(v)} x2={sx(v)} y1={top} y2={top + rowH * UNITS.length} />
          <text className="ax ax-m" x={sx(v)} y={top + rowH * UNITS.length + 16}>
            ${v}
          </text>
        </g>
      ))}
      {UNITS.map((u, i) => {
        const y = top + i * rowH;
        const full = feed[u] >= config.capacity[u] - 1e-6;
        return (
          <g key={u}>
            <text x={X0 - 8} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
              {UNIT_NAME[u]} · {fmt(feed[u])}/{fmt(config.capacity[u])}
            </text>
            <rect x={X0} y={y + 6} width={Math.max(0, sx(sp[u] / 1000) - X0)} height={rowH - 12} fill="#6d9c37" />
            <text x={sx(sp[u] / 1000) + 6} y={y + rowH / 2 + 4} style={{ fontSize: 12, fontWeight: 500, fill: '#3f7a1e' }}>
              {usd(sp[u] / 1000, 2)}
              <tspan style={{ fill: '#5f5f5f', fontWeight: 400 }}>{full ? ' · full' : ' · spare capacity'}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario<PriceState>('prices', PRICE_DEFAULTS);
  const st = s1.state;
  const plan = useMemo(() => planRefinery(inputsOf(st)), [st]);
  const mpb = marginPerBarrel(plan);
  const solvedA = useMemo(() => coldwaterLimitSolved(st), [st]);

  const base = useMemo(() => planRefinery(), []);
  const baseSp = useMemo(() => shadowPrices(), []);
  const baseValues = useMemo(() => Object.fromEntries(CRUDE_IDS.map((k) => [k, crudeBreakeven(k)])) as Record<CrudeId, number>, []);
  const steps = useMemo(() => coldwaterSteps(), []);
  // The other three sliders, each moved alone.
  const moves = useMemo(
    () => ({
      gasoline: planRefinery({ productPrice: { gasoline: GASOLINE_EXAMPLE } }),
      diesel: planRefinery({ productPrice: { diesel: DIESEL_EXAMPLE } }),
      northfield: northfieldSteps(),
    }),
    [],
  );
  // How fast the hydrotreater's and the coker's shadow prices fall as they grow, $/bbl.
  const collapse = useMemo(
    () => ({
      dht: [0, 1, 2, 3].map((a) => shadowPrices({ config: expandedConfig('dht', a) }).dht / 1000),
      cokerAfter: shadowPrices({ config: expandedConfig('coker', EXPANSION) }).coker / 1000,
    }),
    [],
  );
  const cokerEnd = useMemo(() => cokerBottleneckEnd(), []);
  const conversion = useMemo(() => {
    const X = bestConversion().X;
    return { X, gain: planRefinery({ fccConversion: X }).margin - base.margin };
  }, [base]);
  // Crude values under the two expansions the last section points to.
  const expanded = useMemo(() => {
    const dht = expandedConfig('dht', DHT_EXAMPLE);
    const coker = expandedConfig('coker', EXPANSION);
    return {
      nfDht: crudeBreakeven('northfield', { config: dht }),
      nfCoker: crudeBreakeven('northfield', { config: coker }),
      cwCoker: crudeBreakeven('coldwater', { config: coker }),
      cwRunsCoker: planRefinery({ config: coker }).crude.coldwater,
    };
  }, []);
  const rbKerosene = distill(crude('pinyon')).kerosene.sulfur;

  const s2 = useScenario('expand', { unit: 'none' as UnitId | 'none', added: EXPANSION });
  const cfg = expandedConfig(s2.state.unit, s2.state.added);
  const dUnit = useDeferredValue(s2.state.unit);
  const dAdded = useDeferredValue(s2.state.added);
  const plan2 = useMemo(() => planRefinery({ config: cfg }), [cfg]);
  const sp2 = useMemo(() => shadowPrices({ config: cfg }), [cfg]);
  const values2 = useMemo(() => {
    const c = expandedConfig(dUnit, dAdded);
    return Object.fromEntries(CRUDE_IDS.map((k) => [k, crudeBreakeven(k, { config: c })])) as Record<CrudeId, number>;
  }, [dUnit, dAdded]);
  const gain = plan2.margin - base.margin;
  const solvedB = bestExpansionSolved(s2.state.unit, s2.state.added);
  const gains = useMemo(() => Object.fromEntries(UNITS.map((u) => [u, expansionGain(u, EXPANSION)])) as Record<UnitId, number>, []);

  const full = UNITS.filter((u) => base.unitFeed[u] >= CORRAN.capacity[u] - 1e-6);

  return (
    <LessonPage id="oil/3.5">
      <P>
        The last four lessons took the Corran refinery apart one unit at a time: the crude unit that splits each barrel by boiling point, the cracker and coker that break
        heavy molecules, the hydrotreater that strips out sulfur, the blender that turns streams into gasoline. Run together, they share everything. The coker’s gas oil
        can feed the cracker or the hydrotreater; the cracker’s light cycle oil competes with straight-run diesel for room in the hydrotreater; the reformer’s hydrogen
        is spent there too. A change anywhere ripples through the rest. And every day the refinery must decide which crudes to buy, at prices that keep moving.
      </P>
      <P>
        Refiners make those decisions with the tool <a href={lessonHref('oil/3.4')}>Lesson 3.4</a> used for blending: a linear program. Refineries were among the first
        businesses to use linear programming, and refiners still plan with it every day. Ours chooses how much of each of the four crudes to run and
        where every stream goes — to which unit, or straight to a product — to maximize the day’s <K c="price">margin</K>: what the products sell for, minus what the
        crude costs and what it costs to run the units. It has to respect each unit’s capacity, keep the hydrotreater supplied with hydrogen, stay within the sulfur
        plant, make gasoline of at least 87 octane, sell as jet fuel only kerosene sweet enough, and keep fuel oil under 3.5% sulfur.
      </P>
      <P>
        In the next demonstration, the bands show the program’s answer: each crude splitting into its cuts, the cuts flowing through the units, and the units filling
        the product tanks, every band as thick as its flow. All the prices are the course’s simulated reference prices. Change the product prices and what two of the
        crudes cost, and watch the plan reorganize:
      </P>

      <Figure name="Refinery LP" scenario={s1}>
        <RefineryFlow
          plan={plan}
          ariaLabel={`The Corran refinery’s optimal plan: it runs ${slateText(plan)}, and makes ${kbd(plan.products.gasoline)} of gasoline, ${kbd(plan.products.jet)} of jet fuel, ${kbd(plan.products.diesel)} of diesel and ${kbd(plan.products.hsfo)} of fuel oil, for a margin of ${money(plan.margin)} a day.`}
        />
        <Readouts
          items={[
            { label: <K c="price">margin per day</K>, value: money(plan.margin), tone: 'green' },
            { label: <K c="price">per barrel of crude</K>, value: usd(mpb, 2), tone: 'green' },
            ...CRUDE_IDS.map((k) => ({ label: NAME[k], value: kbd(plan.crude[k]) })),
          ]}
        />
        <Slider label="Gasoline price" tone="green" value={st.gasoline} min={70} max={130} step={PRICE_STEP} onChange={(v) => s1.set({ gasoline: v })} display={`${usd(st.gasoline, 2)}/bbl`} />
        <Slider label="Diesel price" tone="green" value={st.diesel} min={70} max={140} step={PRICE_STEP} onChange={(v) => s1.set({ diesel: v })} display={`${usd(st.diesel, 2)}/bbl`} />
        <Slider label="Coldwater Heavy, delivered" tone="green" value={st.coldwater} min={50} max={80} step={PRICE_STEP} onChange={(v) => s1.set({ coldwater: v })} display={`${usd(st.coldwater, 2)}/bbl`} />
        <Slider label="Northfield Sour, delivered" tone="green" value={st.northfield} min={NORTHFIELD_MIN} max={85} step={PRICE_STEP} onChange={(v) => s1.set({ northfield: v })} display={`${usd(st.northfield, 2)}/bbl`} />
        <Caption>
          The plan runs {slateText(plan)}. Full units: {listOf(UNITS.filter((u) => plan.unitFeed[u] >= CORRAN.capacity[u] - 1e-6).map((u) => UNIT_NAME[u].toLowerCase())) || 'none'}.
          Fuel oil carries {fmt(plan.fuelOilSulfur, 2)}% sulfur; the hydrogen plant makes {fmt(plan.hydrogen.plant, 1)} MMscf a day.
        </Caption>
      </Figure>

      <P>
        At the reference prices, the program runs {slateText(base)}, filling the crude unit. It buys no Northfield Sour and no Seaboard Blend. That earns{' '}
        {money(base.margin)} a day, {usd(marginPerBarrel(base), 2)} for every barrel of crude. Of the products, {kbd(base.products.gasoline)} is gasoline,{' '}
        {kbd(base.products.diesel)} diesel and {kbd(base.products.jet)} jet fuel, with {kbd(base.products.hsfo)} of fuel oil and {fmt(base.products.coke)} tonnes of coke a
        day.
      </P>
      <P>
        Why that mix? Coldwater Heavy is the cheapest crude by far, at {usd(CRUDE_PRICE.coldwater)} a barrel against Pinyon Light’s {usd(CRUDE_PRICE.pinyon, 2)}, and
        its heavy end is what the coker was built for. But a third of Coldwater is residue (<a href={lessonHref('oil/1.2')}>Lesson 1.2</a>), and the coker can take only{' '}
        {kbd(CORRAN.capacity.coker)}; whatever residue it can’t take must leave as fuel oil, which may carry no more than 3.5% sulfur. So the program buys Coldwater up to
        the point where the coker is full and the fuel oil is at its sulfur limit, and fills the rest of the crude unit with Pinyon Light, whose kerosene, at{' '}
        {fmt(rbKerosene, 2)}% sulfur, is well under jet fuel’s {fmt(JET_SULFUR, 1)}% limit and goes straight to jet without a turn in the crowded hydrotreater. The full
        units are the {listOf(full.map((u) => UNIT_NAME[u].toLowerCase()))}; the cracker and the reformer have room to spare.
      </P>
      <P>
        One choice our program doesn’t make is how hard to crack: it holds the cracker at 75% conversion. <a href={lessonHref('oil/3.2')}>Lesson 3.2</a> found that a
        cracker earns most at about {fmt(conversion.X * 100)}% conversion at its prices, and Corran would also do better there, by about{' '}
        {usd(Math.round(conversion.gain / 1000) * 1000)} a day. Real planning models choose the cracker’s severity along with everything else; ours keeps it fixed, so
        that every barrel of cracker feed splits the same way.
      </P>
      <P>
        Now drag Coldwater’s price up. Nothing changes for a while — the plan is pinned to the same corner of its constraints — and then it jumps. At{' '}
        {usd(steps.cut, 2)} the program cuts Coldwater to {kbd(steps.cutTo)}, and a little higher it switches most of the crude unit to Northfield Sour. Linear programs
        behave this way: the best plan sits at a corner where some constraints bind, and it moves to another corner only when a price crosses a threshold.
      </P>

      <Challenge
        id="a"
        question="Find the highest delivered price for Coldwater Heavy, to the nearest 50 cents, at which the refinery still runs some of it (with the other prices at their reference values)."
        solved={solvedA}
        status={
          st.gasoline !== PRICE_DEFAULTS.gasoline || st.diesel !== PRICE_DEFAULTS.diesel || st.northfield !== PRICE_DEFAULTS.northfield
            ? `Set gasoline, diesel and Northfield Sour back to their reference prices: the challenge is about the reference case. At ${usd(st.coldwater, 2)} the plan now runs ${kbd(plan.crude.coldwater)} of Coldwater.`
            : `At ${usd(st.coldwater, 2)}, the plan runs ${kbd(plan.crude.coldwater)} of Coldwater Heavy.`
        }
        success={`Solved: ${usd(st.coldwater, 2)}. Here the program has already switched most of the crude unit to Northfield Sour, ${kbd(plan.crude.northfield)} of it, and keeps only ${kbd(plan.crude.coldwater)} of Coldwater; fifty cents more and Coldwater drops out. So at its reference price of ${usd(CRUDE_PRICE.coldwater)}, Coldwater Heavy costs about ${usd(baseValues.coldwater - CRUDE_PRICE.coldwater, 2)} less than the most the refinery would pay for it, about ${usd(baseValues.coldwater, 2)}. That gap between a crude’s price and its value to a refinery is what the refinery earns by buying it.`}
      />

      <P>
        The other three prices move the plan in the same jumps. Pinyon Light is bought for its light products: cut gasoline to {usd(GASOLINE_EXAMPLE)} and the
        program runs only {kbd(moves.gasoline.crude.pinyon)} of it, fills the rest with Coldwater, and makes {kbd(moves.gasoline.products.hsfo)} of fuel oil instead
        of {kbd(base.products.hsfo)}. Cut diesel to {usd(DIESEL_EXAMPLE)} and Corran stops making diesel altogether: its diesel cuts go into fuel oil, where their
        sulfur, well under the {fmt(FUEL_OIL_SULFUR, 1)}% limit, makes room for more of Coldwater’s residue, and the program runs {kbd(moves.diesel.crude.coldwater)} of Coldwater. Cut Northfield
        Sour to {usd(moves.northfield.enters, 2)} and it enters the plan; at {usd(moves.northfield.only, 2)} the program runs nothing else.
      </P>

      <H2>What a barrel of capacity is worth</H2>
      <P>
        A linear program answers a second question almost for free: what each constraint costs. Raise a full unit’s capacity by one barrel a day and the margin rises
        by some amount, its <b>shadow price</b>. A unit with spare capacity has a shadow price of zero — more of it would change nothing. At the reference prices, one
        more barrel a day of coker capacity is worth {usd(baseSp.coker / 1000, 2)}, of hydrotreater {usd(baseSp.dht / 1000, 2)}, and of the crude unit{' '}
        {usd(baseSp.cdu / 1000, 2)}, every day. The cracker and the reformer are worth nothing at the margin.
      </P>
      <P>
        Shadow prices are where refinery investment starts. In the next demonstration, add capacity to one unit and watch the margin, the shadow prices and the value
        of each crude respond. The bars at the end compare each crude’s <b>value</b> to the refinery — the delivered price at which the program would just start (or
        just stop) buying it — with what it actually costs:
      </P>

      <Figure name="Refinery LP · shadow prices" scenario={s2}>
        <Segmented
          label="Unit to expand"
          value={s2.state.unit}
          onChange={(v) => s2.set({ unit: v })}
          options={[{ value: 'none' as const, label: 'No expansion' }, ...UNITS.map((u) => ({ value: u, label: UNIT_NAME[u] }))]}
        />
        <Slider
          label="Capacity added"
          tone="orange"
          value={s2.state.added}
          min={0}
          max={20}
          onChange={(v) => s2.set({ added: v })}
          display={`${s2.state.added} kb/d`}
        />
        <Readouts
          items={[
            { label: <K c="price">margin per day</K>, value: money(plan2.margin), tone: 'green' },
            { label: <K c="price">gained by expanding</K>, value: money(gain), tone: gain > 0 ? 'green' : 'ink' },
            { label: 'which is, per year', value: money(gain * 365), tone: gain > 0 ? 'green' : 'ink' },
          ]}
        />
        <ShadowBars sp={sp2} feed={plan2.unitFeed} config={cfg} />
        <CrudeValues values={values2} prices={CRUDE_PRICE} runs={plan2.crude} />
      </Figure>

      <P>
        Expanding a unit with spare capacity gains nothing: add {EXPANSION} kb/d to the cracker or the reformer and the margin doesn’t move. Expanding a full one helps,
        but not forever. Its shadow price falls as it grows, because sooner or later another constraint binds instead: past about {cokerEnd} kb/d of coking capacity, for instance,
        the coker stops being the bottleneck.
      </P>

      <Challenge
        id="b"
        question={`Suppose the refinery can add ${EXPANSION} kb/d of capacity to one unit. With no expansion, the shadow-price bars rank the hydrotreater first. Predict whether it is also the best unit to expand by ${EXPANSION} kb/d, then check: find the expansion that adds the most margin.`}
        solved={solvedB}
        status={
          s2.state.unit === 'none' || s2.state.added !== EXPANSION
            ? `Choose a unit and set the added capacity to ${EXPANSION} kb/d.`
            : `${UNIT_NAME[s2.state.unit]} plus ${EXPANSION} kb/d adds ${money(gain)} a day.`
        }
        success={`Solved: the coker, which adds ${money(gains.coker)} a day, about ${money(gains.coker * 365)} a year — more than the crude unit (${money(gains.cdu)} a day) or the hydrotreater (${money(gains.dht)}), though the hydrotreater’s shadow price was the highest. A shadow price holds only for small changes: the hydrotreater’s falls from ${usd(collapse.dht[0], 2)} a barrel to ${usd(collapse.dht[2], 2)} with 2 kb/d more and to ${collapse.dht[3] < 0.005 ? 'nothing' : usd(collapse.dht[3], 2)} with 3, as other limits take over, while the coker’s is still ${usd(collapse.cokerAfter, 2)} after ${EXPANSION} kb/d more. Set the hydrotreater to +2 and +3 kb/d to watch its bar fall. Every barrel of coking capacity lets the refinery swap a light crude for a cheap heavy one and turn residue into lighter products instead of fuel oil.`}
      />

      <H2>The value of a crude</H2>
      <P>
        The crude bars make the same point from the buyer’s side. At the reference prices, Pinyon Light is worth {usd(baseValues.pinyon, 2)} a barrel to Corran and
        costs {usd(CRUDE_PRICE.pinyon, 2)}; Coldwater Heavy is worth {usd(baseValues.coldwater, 2)} and costs {usd(CRUDE_PRICE.coldwater)}. Both are bought. Seaboard
        Blend is worth {usd(baseValues.seaboard, 2)} and costs {usd(CRUDE_PRICE.seaboard, 2)}, and Northfield Sour is worth {usd(baseValues.northfield, 2)} against its{' '}
        {usd(CRUDE_PRICE.northfield)}: both are left for other buyers. A crude’s value isn’t a property of the crude alone. It depends on the refinery, and on the other
        crudes the refinery could buy instead. Add {DHT_EXAMPLE} kb/d to the hydrotreater in <FigRef to="Refinery LP · shadow prices">this demonstration</FigRef> and
        Northfield Sour’s value rises from {usd(baseValues.northfield, 2)} to {usd(expanded.nfDht, 2)}, because the refinery could treat more of its sour kerosene and
        diesel{expanded.nfDht < CRUDE_PRICE.northfield ? ` — still short of its ${usd(CRUDE_PRICE.northfield)} price` : `, more than its ${usd(CRUDE_PRICE.northfield)} price`}.
        Expand the coker by {EXPANSION} kb/d instead and the program runs {kbd(expanded.cwRunsCoker)} of Coldwater Heavy, while Northfield’s value falls to{' '}
        {usd(expanded.nfCoker, 2)}: more coking makes Coldwater, its rival for the crude unit, the better buy. Coldwater’s own value stays at{' '}
        {usd(expanded.cwCoker, 2)}. That is the price at which the program would stop buying Coldwater altogether, and by then it has switched to Northfield and left
        most of the coker idle, so a bigger coker doesn’t change it.
      </P>
      <P>
        That answers the chapter’s question. The same barrel of crude becomes products with very different prices — gasoline and diesel worth well above the crude, fuel
        oil and coke worth less — and how much of each it becomes depends on the units a refinery has and how it runs them. The refinery’s margin is the spread between
        what its products sell for and what its crude costs. Every refinery is constantly comparing crudes against their value to it, and every refinery’s answer is
        different.
      </P>
      <P>
        Which raises a question about geography. Coldwater Heavy is cheap at Port Corran, but it started far to the north; Seaboard Blend arrives by sea; and Corran’s
        products have to reach their buyers. Chapter 4 follows the barrels on their journeys, starting with the <a href={lessonHref('oil/4.1')}>pipelines</a> that move
        most of them over land.
      </P>
    </LessonPage>
  );
}
