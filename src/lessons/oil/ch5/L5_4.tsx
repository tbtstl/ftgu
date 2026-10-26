import { useMemo } from 'react';
import { Caption, Challenge, Eq, FigRef, Figure, H2, K, Legend, LessonPage, Op, P, Readouts, Slider, fmt, lessonHref, niceDomain, niceTicks, pct, usd, useScenario } from '../../../framework';
import { CURVE_DEFAULTS, WORLD, convenienceYield, fullCarry, futuresCurve, inventoryPrice } from '../../../engines/oil/market';
import { NETWORK_DEFAULTS, hubPricesFast } from '../../../engines/oil/network';
import { VESSELS } from '../../../model/oil/logistics';
import { XYChart } from '../shared/charts';

const GREEN = '#6d9c37';
const ORANGE = '#d0702a';
const GRAY = '#9a9a9a';

/** Days in a month, for turning a day rate into a cost per barrel-month. */
const DAYS_PER_MONTH = 30.4;
/** The hub fill above which, in the engine, onshore tanks are effectively full. */
export const TANK_TOPS = 0.97;

/**
 * Kessler's spot price, as the course history sets it: from the crude network (Lessons 4.4 and
 * 5.2), with Northport at the reference price and room on the Kessler–Corran line. The hub's fill
 * shapes the curve but doesn't move spot.
 */
export const NETWORK_PRICES = hubPricesFast(NETWORK_DEFAULTS);
export const KESSLER_SPOT = NETWORK_PRICES.kessler;

/**
 * How the course history links Kessler's fill to the world's stocks (src/model/oil/history.ts,
 * `worldFill`): normal fill, plus this many points of fill for each 1 (100%) the world's stocks sit
 * from normal, before congestion and local swings.
 */
export const KESSLER_NORMAL_FILL = 0.55;
export const FILL_PER_WORLD_STOCKS = 7;

/** Where the world's stocks pull Kessler's fill, 0–1, in the course history (before local swings). */
export function fillFromWorld(worldStocks: number): number {
  return KESSLER_NORMAL_FILL + FILL_PER_WORLD_STOCKS * (worldStocks / WORLD.normalStocks - 1);
}

export interface CurveState {
  /** Hub fill, percent. */
  fill: number;
  fee: number;
  /** Financing rate, percent a year. */
  rate: number;
}

export const CURVE_STATE_DEFAULTS: CurveState = { fill: 55, fee: CURVE_DEFAULTS.fee, rate: CURVE_DEFAULTS.rate * 100 };
export const FILL_STEP = 1;
/** Challenge a's dearer storage fee, $/bbl-month (the financing rate stays at its default). */
export const CHALLENGE_FEE = 0.7;

/** The futures curve at Kessler: spot from the network, the spreads from the hub's fill. */
export function curveOf(st: CurveState): number[] {
  return futuresCurve({ fill: st.fill / 100, spot: KESSLER_SPOT, fee: st.fee, rate: st.rate / 100 });
}

/** The front spread, M2 − M1, $/bbl (positive in contango, negative in backwardation). */
export function frontSpread(st: CurveState): number {
  const c = curveOf(st);
  return c[1] - c[0];
}

/** The front spread as displayed, rounded to the cent. */
function frontCents(st: CurveState): number {
  return Math.round(frontSpread(st) * 100) / 100;
}

/**
 * The emptiest hub (on the 1% grid) whose front spread, to the cent as displayed, has not tipped into
 * backwardation (M2 − M1 ≥ $0.00) — the point where backwardation gives way, at a fee and rate.
 */
export function flatFill(fee: number, rate: number = CURVE_STATE_DEFAULTS.rate): number {
  for (let fill = 5; fill <= 100; fill += FILL_STEP) if (frontCents({ fill, fee, rate }) >= 0 && frontCents({ fill: fill - FILL_STEP, fee, rate }) < 0) return fill;
  return NaN;
}

/** Challenge a's setting is in place: the dearer fee, with the financing rate at its default. */
export function turnReady(st: CurveState): boolean {
  return Math.abs(st.fee - CHALLENGE_FEE) < 1e-9 && st.rate === CURVE_STATE_DEFAULTS.rate;
}

/**
 * Challenge a: with storage dearer ($0.70 a barrel-month), the emptiest hub on the 1% grid whose
 * front spread has not tipped into backwardation. The reader predicts the direction (dearer carry
 * needs a larger convenience yield, so emptier tanks) from the prose's flat point at the default fee.
 */
export function turnSolved(st: CurveState): boolean {
  if (!turnReady(st)) return false;
  return frontCents(st) >= 0 && frontCents({ ...st, fill: st.fill - FILL_STEP }) < 0;
}

export interface TankState {
  /** Hub fill, percent (90–100). */
  fill: number;
  /** All-in cost of storing a barrel on a tanker for a month, $. */
  floating: number;
}

export const TANK_DEFAULTS: TankState = { fill: 93, floating: CURVE_DEFAULTS.floatingCost };
export const TANK_FILL_STEP = 0.5;

/** Front spread and the onshore full carry at a fill, with a cost of storage at sea. */
export function tankTops(st: TankState): { spread: number; carry: number; spot: number } {
  const c = futuresCurve({ fill: st.fill / 100, spot: KESSLER_SPOT, floatingCost: st.floating, months: 2 });
  return { spread: c[1] - c[0], carry: fullCarry(c[0]), spot: c[0] };
}

/** A VLCC's all-in cost per day implied by a cost of storage per barrel-month. */
export function impliedDayRate(perBblMonth: number): number {
  return (perBblMonth * VESSELS.vlcc.cargo) / DAYS_PER_MONTH;
}

/** The cost of storing a barrel for a month on a VLCC that costs `perDay` dollars a day, all in. */
export function perBarrelMonth(perDay: number): number {
  return (perDay * DAYS_PER_MONTH) / VESSELS.vlcc.cargo;
}

/** Challenge b's VLCC rate in a rush for floating storage, $ a day, all in. */
export const RUSH_DAY_RATE = 100000;
/** How close the cost-at-sea slider must sit to the converted rate: the nearest 5-cent steps either side. */
export const SEA_COST_TOLERANCE = 0.035;

/**
 * Challenge b: with VLCCs at $100,000 a day, the reader converts that to a cost per barrel-month
 * ($1.52), predicts the front spread with the tanks completely full, and checks it: the cost at sea
 * set to the nearest step ($1.50 or $1.55) with Kessler 100% full.
 */
export function tankTopsSolved(st: TankState): boolean {
  return st.fill >= 100 - 1e-9 && Math.abs(st.floating - perBarrelMonth(RUSH_DAY_RATE)) <= SEA_COST_TOLERANCE;
}

function money(x: number, d = 2): string {
  return usd(x, d);
}

function signedMoney(x: number): string {
  const r = Math.round(x * 100) / 100;
  return r > 0 ? `+${usd(r, 2)}` : r < 0 ? `−${usd(-r, 2)}` : '$0.00';
}

/** A row of the hub's tanks, filled to `fill`, with tankers at anchor once the tanks are topped out. */
function TankRow({ fill, ships = 0 }: { fill: number; ships?: number }) {
  const n = 6;
  const w = 56;
  const h = 64;
  const gap = 14;
  const x0 = 20;
  const y0 = 18;
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 100"
      role="img"
      aria-label={`The Kessler hub’s tanks, ${pct(fill)} full${ships > 0 ? `, with ${ships} tanker${ships > 1 ? 's' : ''} holding oil at sea` : ''}.`}
    >
      {Array.from({ length: n }, (_, i) => {
        const x = x0 + i * (w + gap);
        const level = h * Math.max(0, Math.min(1, fill));
        return (
          <g key={i}>
            <rect x={x} y={y0} width={w} height={h} rx={4} fill="#f4f1ea" stroke="#9a9a9a" strokeWidth={1.5} />
            <rect x={x + 2} y={y0 + h - level} width={w - 4} height={Math.max(0, level - 2)} rx={2} fill={ORANGE} opacity={0.7} />
          </g>
        );
      })}
      <text className="ax" x={x0} y={12}>
        Kessler’s tanks · {pct(fill)} full
      </text>
      {Array.from({ length: ships }, (_, i) => {
        const x = 470 + (i % 3) * 52;
        const y = 34 + Math.floor(i / 3) * 30;
        return (
          <g key={'s' + i}>
            <path d={`M${x} ${y} L${x + 44} ${y} L${x + 38} ${y + 12} L${x + 4} ${y + 12} Z`} fill="#5f5f5f" />
            <rect x={x + 30} y={y - 7} width={8} height={7} fill="#5f5f5f" />
          </g>
        );
      })}
      {ships > 0 && (
        <text className="ax" x={470} y={14}>
          storage at sea
        </text>
      )}
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario<CurveState>('curve', CURVE_STATE_DEFAULTS);
  const st = s1.state;
  const curve = useMemo(() => curveOf(st), [st]);
  const spot = curve[0];
  const carry = fullCarry(spot, st.fee, st.rate / 100);
  const cy = convenienceYield(st.fill / 100);
  const m21 = curve[1] - curve[0];
  const m121 = curve[11] - curve[0];
  const bound = curve.map((_, m) => [m + 1, spot + m * carry] as [number, number]);
  const pts = curve.map((p, m) => [m + 1, p] as [number, number]);
  const [y0, y1] = niceDomain(Math.min(...curve, ...bound.map((b) => b[1])) - 1, Math.max(...curve, ...bound.map((b) => b[1])) + 1, 4);
  const shape = m21 < -0.005 ? (m121 > 0.005 ? 'backwardated at the front, in contango further out' : 'in backwardation') : 'in contango';
  const solvedA = turnSolved(st);

  // Reference points quoted in the prose (default fee and rate).
  const at = (fill: number) => {
    const c = curveOf({ ...CURVE_STATE_DEFAULTS, fill: fill * 100 });
    return { spot: c[0], m21: c[1] - c[0], m121: c[11] - c[0], carry: fullCarry(c[0]), cy: convenienceYield(fill) };
  };
  const normal = at(0.55);
  const ninety = at(0.9);
  const twenty = at(0.2);
  const thirty = at(0.3);
  const flatAt = flatFill(CURVE_STATE_DEFAULTS.fee);
  const flat = at(flatAt / 100);
  // The world's stocks 5% short (Lesson 5.1): Brent, Kessler's network price, and the fill they pull Kessler toward.
  const shortStocks = WORLD.normalStocks * 0.95;
  const shortBrent = inventoryPrice(shortStocks);
  const shortKessler = hubPricesFast({ ...NETWORK_DEFAULTS, northportPrice: shortBrent }).kessler;
  const shortFill = fillFromWorld(shortStocks);
  const shortCurve = futuresCurve({ fill: shortFill, spot: shortKessler, months: 2 });
  const shortFront = shortCurve[1] - shortCurve[0];

  const s2 = useScenario<TankState>('tank-tops', TANK_DEFAULTS);
  const tt = tankTops(s2.state);
  const sweep = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let q = 900; q <= 1000; q += 5) out.push([q / 10, tankTops({ ...s2.state, fill: q / 10 }).spread]);
    return out;
  }, [s2.state]);
  const carryLine = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let q = 900; q <= 1000; q += 5) out.push([q / 10, tankTops({ ...s2.state, fill: q / 10 }).carry]);
    return out;
  }, [s2.state]);
  const ships = s2.state.fill / 100 > TANK_TOPS ? Math.min(6, Math.ceil(((s2.state.fill / 100 - TANK_TOPS) / (1 - TANK_TOPS)) * 6)) : 0;
  const solvedB = tankTopsSolved(s2.state);
  const full = at(1);
  const hireOnly = perBarrelMonth(VESSELS.vlcc.hire);
  const allInDay = Math.round(impliedDayRate(CURVE_DEFAULTS.floatingCost) / 1000) * 1000;

  return (
    <LessonPage id="oil/5.4">
      <P>
        <a href={lessonHref('oil/5.3')}>Lesson 5.3</a> found that the price of a product today follows its stocks: draw them down and the crack spread widens, let them
        pile up and it collapses. Stocks matter for the future too. Back in <a href={lessonHref('oil/4.3')}>Lesson 4.3</a>, the Kessler terminal bought crude, stored
        it and sold it months later at prices agreed in advance — and it paid only when those later prices were high enough to cover the storage fee and the interest.
        The same lesson found that a refinery values a barrel in its tanks most when its tanks are nearly empty. This lesson puts the two ideas together, and they
        explain the shape of one of the most watched charts in the oil business.
      </P>
      <P>
        Prices agreed today for delivery later are traded on exchanges as <b>futures</b>. A futures contract is a standardized promise to buy or sell a fixed quantity
        of a specified oil, delivered at a specified place in a specified month, at a price agreed now — the WTI contract of{' '}
        <a href={lessonHref('oil/5.2')}>Lesson 5.2</a>, delivered at Cushing, is one, and in our world the Kessler hub plays Cushing’s part. Most traders close their
        positions before the delivery month arrives, but anyone still holding one must deliver or take delivery of real oil, and that possibility ties the futures price
        to the physical barrel. Line up the prices for each delivery month and you have the <K c="price">futures curve</K>. In the words of{' '}
        <a href={lessonHref('oil/4.3')}>Lesson 4.3</a>, the curve is in contango when later months are dearer than nearer ones, and in backwardation when they
        are cheaper. We’ll quote the gap between two months as the later minus the
        earlier — month 2 minus month 1 at the front of the curve — so a positive spread means contango and a negative one backwardation. Traders often quote it the
        other way round, nearer minus later, so it pays to check the sign.
      </P>
      <P>
        In the next demonstration, the curve runs over the next 24 delivery months for crude at Kessler. Spot is held where the crude network puts it, with Brent at the
        reference {usd(NETWORK_DEFAULTS.northportPrice)} and room on the line to the coast; the rest of the curve comes from the hub’s own stocks. Set how full the
        hub’s tanks are, and what it costs to store a barrel there. The dashed line adds a full month’s cost of carry for every month; all prices are simulated:
      </P>

      <Figure name="Oil Futures Curve" scenario={s1}>
        <TankRow fill={st.fill / 100} />
        <Legend
          items={[
            { label: 'Futures price by delivery month', color: GREEN, kind: 'line' },
            { label: 'Spot plus full carry each month', color: GRAY, kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`Futures prices for the next 24 months with Kessler ${pct(st.fill / 100)} full: spot ${money(spot)}, month 2 ${money(curve[1])}, month 12 ${money(curve[11])}, month 24 ${money(curve[23])}. The curve is ${shape}.`}
          height={240}
          x={[1, 24]}
          y={[y0, y1]}
          xTicks={[1, 6, 12, 18, 24]}
          yTicks={niceTicks(y0, y1, 4)}
          yFormat={(v) => `$${fmt(v)}`}
          xLabel="delivery month"
          yLabel="Price, $ per barrel"
          series={[
            { points: bound, color: GRAY, width: 1.5, dash: '6 4' },
            { points: pts, color: GREEN, width: 3 },
          ]}
          markers={[
            { x: 1, y: curve[0], color: GREEN, r: 6, label: 'spot', labelDy: -10, labelDx: 6 },
            { x: 12, y: curve[11], color: GREEN, r: 4 },
          ]}
        />
        <Readouts
          items={[
            { label: <K c="price">spot (month 1)</K>, value: money(spot), tone: 'green' },
            { label: 'month 2 − month 1', value: signedMoney(m21), tone: m21 < 0 ? 'red' : 'green' },
            { label: 'month 12 − month 1', value: signedMoney(m121), tone: m121 < 0 ? 'red' : 'green' },
            { label: 'full carry a month', value: money(carry) },
            { label: <K tone="orange">convenience yield</K>, value: money(cy), tone: 'orange' },
          ]}
        />
        <Slider label="Kessler’s tanks" tone="orange" value={st.fill} min={5} max={100} step={FILL_STEP} onChange={(v) => s1.set({ fill: v })} display={`${st.fill}% full`} />
        <Slider
          label="Storage fee"
          tone="green"
          value={st.fee}
          min={0.1}
          max={1}
          step={0.05}
          onChange={(v) => s1.set({ fee: Math.round(v * 100) / 100 })}
          display={`${money(st.fee)} per barrel-month`}
        />
        <Slider label="Financing rate" tone="green" value={st.rate} min={0} max={12} step={0.5} onChange={(v) => s1.set({ rate: v })} display={`${fmt(st.rate, 1)}% a year`} />
        <Caption>The curve is {shape}.</Caption>
      </Figure>

      <P>
        Start with the tanks at their normal level, {pct(0.55)} full. Spot crude is {money(normal.spot)}, the second month {signedMoney(normal.m21)} dearer, and a year out{' '}
        {money(normal.spot + normal.m121)}: a gentle contango. Fill the tanks and the curve steepens, but only so far. At {pct(0.9)} full the second month is{' '}
        {signedMoney(ninety.m21)} over the first, close to the full cost of carrying a barrel for a month, {money(ninety.carry)}. Now drain them. At {pct(0.2)} full,
        the curve tips over: the second month is {money(-twenty.m21)} cheaper than the first, and a year out {money(-twenty.m121)} cheaper.
      </P>
      <P>
        Spot doesn’t move at all. In our model, Kessler’s spot is set not by its own tanks but by the network of <a href={lessonHref('oil/4.4')}>Lessons 4.4</a>{' '}
        and <a href={lessonHref('oil/5.2')}>5.2</a>: Port Corran’s {money(NETWORK_PRICES.corran)} less the {money(NETWORK_DEFAULTS.pipelineTariff)} pipeline
        tariff. If Kessler paid much more than that, shippers would keep crude at home, or bring it in, rather than send it to the coast, and the tanks would refill.
        What the tanks set is the shape of the curve.
      </P>

      <H2>The theory of storage</H2>
      <P>
        Why should the curve behave like that? Start with the limit on contango. If a later month traded higher than spot by more than the cost of storing a barrel until
        then, anyone with tank space could buy spot, store it, sell the later month and pocket the difference — the cash and carry of Lesson 4.3. Their buying would
        lift spot and their selling would push the later month down, until the gap was no more than the <K c="price">full carry</K>:
      </P>
      <Eq label={`Full carry per month equals the storage fee of ${money(st.fee)} plus the financing rate over twelve times the price, ${money(carry)}`}>
        <span>full carry</span>
        <Op>=</Op>
        <span>fee</span>
        <Op>+</Op>
        <span>(rate ⁄ 12) × price</span>
        <Op>=</Op>
        <K c="price">{money(st.fee)}</K>
        <Op>+</Op>
        <span>
          {fmt(st.rate, 1)}% ⁄ 12 × {money(spot)}
        </span>
        <Op>=</Op>
        <K c="price">{money(carry)}</K>
      </Eq>
      <P>
        Nothing similar limits backwardation, because the trade can’t be run backward: nobody can borrow a barrel from next year to sell today. What a barrel in the
        tank earns instead is the <K tone="orange">convenience yield</K> of Lesson 4.3 — the value of having oil on hand when it might run short. When tanks are full,
        one more barrel is worth almost nothing for its own sake; when they are nearly empty, it can keep a refinery running. Economists call this the theory of storage,
        and in our model it sets each month’s spread directly: full carry minus convenience yield. At normal stocks, the convenience yield of {money(normal.cy)} takes a
        bite out of the {money(normal.carry)} of carry, leaving {signedMoney(normal.m21)}. At {pct(0.2)} full, a convenience yield of {money(twenty.cy)} swamps a carry of{' '}
        {money(twenty.carry)}. In between, the two match and the front of the curve goes flat: at {flatAt}% full, where the convenience yield has fallen to{' '}
        {money(flat.cy)}.
      </P>
      <P>
        The curve can also bend. Stocks don’t stay low forever: high prices draw out supply and hold back demand, so traders expect the tanks to refill. At {pct(0.3)}{' '}
        full, the front of the curve is still in backwardation, {signedMoney(thirty.m21)} a month, but a year out it has turned up again, {signedMoney(thirty.m121)}{' '}
        over spot. The curve is a picture of where stocks are now and where the market expects them to go.
      </P>
      <P>
        Where does Kessler’s fill come from? Mostly from the world. The hub’s tanks hold a sliver of the world’s commercial stocks of{' '}
        <a href={lessonHref('oil/5.1')}>Lesson 5.1</a>, and they rise and fall with them: in the course’s simulated history, every 1% the world’s stocks sit below
        normal pulls Kessler about {fmt(FILL_PER_WORLD_STOCKS)} percentage points emptier. Local events add swings of their own — crude backs up in Kessler’s tanks
        when the line to the coast is full or nearby refineries shut for maintenance. So a world 5% short of stocks, at {fmt(shortStocks)} million barrels, does two
        things at once. It lifts Brent to {money(shortBrent)}, as Lesson 5.1 found, and Kessler’s spot with it to {money(shortKessler)}, through the network. And it
        drains Kessler toward {pct(shortFill)} full, where the front of its curve sits {money(-shortFront)} in backwardation. A high spot price and a backwardated
        curve usually arrive together, but by different routes: the level comes from the world through Brent, the shape from the tanks.
      </P>

      <Challenge
        id="a"
        question={`Suppose storage at Kessler gets dearer: set the fee to ${money(CHALLENGE_FEE)} a barrel-month, with financing still at ${fmt(CURVE_STATE_DEFAULTS.rate)}%. Predict first: does the point where the front of the curve goes flat move to fuller tanks or emptier ones? Then find the emptiest the tanks can be, to the nearest percent, without the front (month 2 minus month 1, to the cent) tipping into backwardation.`}
        solved={solvedA}
        status={
          !turnReady(st)
            ? `Set the storage fee to ${money(CHALLENGE_FEE)} and the financing rate to ${fmt(CURVE_STATE_DEFAULTS.rate)}%.`
            : `At ${st.fill}% full, month 2 minus month 1 is ${signedMoney(m21)}.`
        }
        success={`Solved: ${st.fill}% full, emptier than the ${flatAt}% of the starting fee. Dearer storage lifts full carry to ${money(carry)}, so a barrel has to be scarcer before its convenience yield outweighs the cost of keeping it; here the convenience yield of ${money(cy)} falls just short. One percent emptier and holding oil is worth more than storing it costs, so the market pays a premium for prompt barrels: backwardation. Traders watch the front spread as a gauge of how tight stocks are.`}
      />

      <H2>Tank tops</H2>
      <P>
        Full carry limits contango only while there is somewhere to put the oil. As a hub fills, the space left gets harder to use — tank bottoms can’t be pumped out,
        roofs can’t float any higher, different crudes need tanks of their own — and in our model the hub’s tanks are effectively full beyond {pct(TANK_TOPS)}. After
        that, the next barrel has to be stored somewhere dearer, and the dearest common option is a tanker anchored offshore. At the calm-market hire of{' '}
        {usd(VESSELS.vlcc.hire)} a day from <a href={lessonHref('oil/4.2')}>Lesson 4.2</a>, a VLCC’s hire alone comes to {money(hireOnly)} per barrel per month
        ({fmt(DAYS_PER_MONTH, 1)} days’ hire spread over its {fmt(VESSELS.vlcc.cargo / 1e6)} million barrels); with fuel and insurance the model puts the all-in cost at{' '}
        {money(CURVE_DEFAULTS.floatingCost)}, about {usd(allInDay)} a day. In the next demonstration, fill the last few percent of the tanks
        and set the cost of storing at sea:
      </P>

      <Figure name="Oil Futures Curve · tank tops" scenario={s2}>
        <TankRow fill={s2.state.fill / 100} ships={ships} />
        <Legend
          items={[
            { label: 'Front spread (month 2 − month 1)', color: GREEN, kind: 'line' },
            { label: 'Full carry onshore', color: GRAY, kind: 'line', dashed: true },
            { label: 'Cost of storing at sea', color: ORANGE, kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`Front spread against how full Kessler is, from 90% to 100%, with storage at sea costing ${money(s2.state.floating)} a barrel-month. At ${fmt(s2.state.fill, 1)}% full, the front spread is ${signedMoney(tt.spread)} against onshore carry of ${money(tt.carry)}.`}
          height={220}
          x={[90, 100]}
          y={[0, Math.max(1.5, Math.ceil(s2.state.floating * 2 + 0.5) / 2)]}
          xTicks={[90, 92, 94, 96, 98, 100]}
          xFormat={(v) => `${v}%`}
          yFormat={(v) => `$${fmt(v, 2)}`}
          xLabel="how full Kessler’s tanks are"
          yLabel="$ per barrel per month"
          series={[
            { points: carryLine, color: GRAY, width: 1.5, dash: '6 4' },
            { points: [[90, s2.state.floating], [100, s2.state.floating]], color: ORANGE, width: 1.5, dash: '6 4' },
            { points: sweep, color: GREEN, width: 3 },
          ]}
          refs={[{ axis: 'x', at: TANK_TOPS * 100, color: '#777', dash: '2 3', label: 'tanks effectively full' }]}
          markers={[{ x: s2.state.fill, y: tt.spread, color: GREEN, r: 6 }]}
        />
        <Readouts
          items={[
            { label: 'front spread', value: signedMoney(tt.spread), tone: 'green' },
            { label: 'full carry onshore', value: money(tt.carry) },
          ]}
        />
        <Slider
          label="Kessler’s tanks"
          tone="orange"
          value={s2.state.fill}
          min={90}
          max={100}
          step={TANK_FILL_STEP}
          onChange={(v) => s2.set({ fill: v })}
          display={`${fmt(s2.state.fill, 1)}% full`}
        />
        <Slider
          label="Cost of storing at sea"
          tone="orange"
          value={s2.state.floating}
          min={0.5}
          max={3}
          step={0.05}
          onChange={(v) => s2.set({ floating: Math.round(v * 100) / 100 })}
          display={`${money(s2.state.floating)} per barrel-month`}
        />
      </Figure>

      <P>
        Up to {pct(TANK_TOPS)} full, the front spread stays just short of onshore carry. Past it, the spread has to climb toward the cost of storing at sea, because the
        marginal barrel now goes into a ship: with the tanks completely full, the second month trades {signedMoney(full.m21)} over the first, well past the{' '}
        {money(full.carry)} that storing onshore would cost. Traders call a contango that wide a <b>super-contango</b>. Raise the cost of storing at sea — tanker rates
        rise when everyone wants a ship at once — and the spread rises with it.
      </P>
      <P>
        The real market showed how far this can go. In the spring of 2020, as the pandemic shut down travel, demand for oil collapsed far faster than production could be
        cut. Stocks swelled, tanks at Cushing neared their limits, and traders chartered tankers simply to hold oil at sea. On April 20, 2020, the expiring May WTI futures contract
        settled at −$37.63 a barrel. Anyone still holding it had to take delivery of 1,000 barrels at Cushing for each contract, with almost nowhere to put them, and
        sellers paid buyers to take their oil. The next month’s contract, with time for stocks to clear, stayed well above zero.
      </P>

      <Challenge
        id="b"
        question={`Suppose a rush for floating storage drives VLCC rates to ${usd(RUSH_DAY_RATE)} a day, all in. Predict first: what is that per barrel per month, and so what will the front spread be with Kessler’s tanks completely full? Then set the cost of storing at sea, to the nearest 5 cents, fill the tanks, and check.`}
        solved={solvedB}
        status={`At ${fmt(s2.state.fill, 1)}% full, with storage at sea at ${money(s2.state.floating)} a barrel-month, the front spread is ${signedMoney(tt.spread)}.`}
        success={`Solved: ${usd(RUSH_DAY_RATE)} a day for ${fmt(DAYS_PER_MONTH, 1)} days, spread over ${fmt(VESSELS.vlcc.cargo / 1e6)} million barrels, is ${money(perBarrelMonth(RUSH_DAY_RATE))} a barrel-month. With nowhere onshore for the next barrel, the front spread is ${signedMoney(tt.spread)}: the cost at sea, less a sliver of convenience yield. A super-contango is a sign that storage itself has become the scarce thing, and that tanker rates now set the front of the curve.`}
      />

      <P>
        The futures curve, then, is a reading of stocks: backwardation when they’re scarce, contango up to full carry when they’re ample, and past full carry when the tanks
        run out. Return to <FigRef to="Oil Futures Curve">the first demonstration</FigRef> and try any level between. Stocks change slowly most of the time, a few
        million barrels a week. Occasionally they change fast — a war, a hurricane, a pandemic — and prices lurch with them. That is the subject of the{' '}
        <a href={lessonHref('oil/5.5')}>next lesson</a>.
      </P>
    </LessonPage>
  );
}
