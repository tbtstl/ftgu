import { useDeferredValue, useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, usd, useScenario } from '../../../framework';
import { arbitrage, closingFreight, crudeNetback, qualityDifferentials, type ArbInputs, type ArbResult } from '../../../engines/oil/arbitrage';
import { ladenDays, voyage } from '../../../engines/oil/tanker';
import { CRUDE_COLOR, CRUDE_IDS, CRUDE_SPECS, type CrudeId } from '../../../model/oil/crudes';
import { CALDER_DOCK_LIMIT, KESSLER_CALDER, LIGHTERING_COST, ROUTES, VESSELS, type VesselId } from '../../../model/oil/logistics';
import { CALDER, CRUDE_PRICE, PRODUCT_PRICE } from '../../../model/oil/refinery';
import { XYChart } from '../shared/charts';

const NAME: Record<CrudeId, string> = Object.fromEntries(CRUDE_SPECS.map((s) => [s.id, s.name])) as Record<CrudeId, string>;
const VESSEL_IDS: VesselId[] = ['aframax', 'suezmax', 'vlcc'];

// ---------------------------------------------------------------------------
// Figure 1: a cargo from Kessler to Northport.

/** Speed the cargoes sail at, knots. */
export const SPEED = 13;
/** The cost assumptions for a cargo from Kessler, through Port Calder, to Northport. */
export const ARB = {
  pipelineTariff: 2.0,
  terminalFees: 0.4,
  insurance: 0.0005,
  losses: 0.002,
  financingRate: 0.06,
  transitDays: ladenDays('northport', SPEED),
};
export const KESSLER_DEFAULT = 74.5;
export const NORTHPORT_DEFAULT = 79;
export const PRICE_STEP = 0.1;

/** Freight per barrel, Port Calder to Northport, for a vessel at 13 knots (VLCCs pay to top up offshore). */
export function freightFor(v: VesselId): number {
  return voyage({ vessel: v, route: 'northport', speed: SPEED }).perBbl;
}

export function arbInputs(v: VesselId, kessler: number, northport: number): ArbInputs {
  return { ...ARB, originPrice: kessler, destinationPrice: northport, freight: freightFor(v) };
}

export function arbFor(v: VesselId, kessler: number, northport: number): ArbResult {
  return arbitrage(arbInputs(v, kessler, northport));
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Challenge a: with Northport at $79, the highest Kessler price (to 10 cents) at which a cargo
 * makes money in any of the three vessels — and the vessel that does it.
 */
export function arbSolved(v: VesselId, kessler: number, northport: number): boolean {
  if (Math.abs(northport - NORTHPORT_DEFAULT) > 1e-9) return false;
  const next = round1(kessler + PRICE_STEP);
  return arbFor(v, kessler, northport).margin > 0 && VESSEL_IDS.every((w) => arbFor(w, next, northport).margin <= 0);
}

/** The highest Kessler price at which each vessel's arbitrage to Northport ($79) is open. */
export function highestOpen(v: VesselId, northport = NORTHPORT_DEFAULT): number {
  let best = NaN;
  for (let k = 650; k <= 800; k++) if (arbFor(v, k / 10, northport).margin > 0) best = k / 10;
  return best;
}

// ---------------------------------------------------------------------------
// Figure 2: quality.

export const DIESEL_DEFAULT = PRODUCT_PRICE.diesel;
export const FUEL_OIL_DEFAULT = PRODUCT_PRICE.hsfo;
/** What each crude costs delivered to Calder, less Ridgeback Light: the market's differentials (simulated). */
export const MARKET_DIFF: Record<CrudeId, number> = Object.fromEntries(CRUDE_IDS.map((k) => [k, CRUDE_PRICE[k] - CRUDE_PRICE.ridgeback])) as Record<CrudeId, number>;

const diffCache = new Map<string, Record<CrudeId, number>>();
/** Calder's netback differentials (each crude run alone, less Ridgeback) at a fuel-oil and diesel price. */
export function differentialsAt(fuelOil: number, diesel: number): Record<CrudeId, number> {
  const key = `${fuelOil}|${diesel}`;
  let d = diffCache.get(key);
  if (!d) {
    d = qualityDifferentials({ productPrice: { hsfo: fuelOil, diesel } });
    if (diffCache.size > 400) diffCache.clear();
    diffCache.set(key, d);
  }
  return d;
}

/**
 * Challenge b: the fuel-oil price (whole dollars, diesel at its reference price) at which Coldwater
 * Heavy's value gap at Calder comes closest to its $14.50 market discount.
 */
export function qualitySolved(fuelOil: number, diesel: number): boolean {
  if (diesel !== DIESEL_DEFAULT) return false;
  const err = (h: number) => Math.abs(differentialsAt(h, diesel).coldwater - MARKET_DIFF.coldwater);
  return err(fuelOil) <= err(fuelOil - 1) && err(fuelOil) <= err(fuelOil + 1);
}

const SWEEP = Array.from({ length: 13 }, (_, i) => 30 + 5 * i);

function money(x: number): string {
  return usd(x, 2);
}

function signedMoney(x: number): string {
  return `${x > 0.005 ? '+' : x < -0.005 ? '−' : ''}${usd(Math.abs(x), 2)}`;
}

/** The delivered cost of a cargo, step by step, against what it sells for. */
function Waterfall({ r, northport }: { r: ArbResult; northport: number }) {
  const short = ['Kessler price', 'Pipeline', 'Terminals', 'Freight', 'Insurance', 'Financing'];
  const cols = r.parts.length + 2;
  const X0 = 64;
  const X1 = 624;
  const slot = (X1 - X0) / cols;
  const lo = Math.floor(r.parts[0].value - 2);
  const hi = Math.ceil(Math.max(r.delivered, r.revenue, northport) + 1);
  const Y0 = 206;
  const Y1 = 30;
  const sy = (v: number) => Y0 - ((v - lo) / (hi - lo)) * (Y0 - Y1);
  let acc = 0;
  const steps = r.parts.map((p, i) => {
    const from = i === 0 ? lo : acc;
    acc += p.value;
    return { label: short[i] ?? p.label, from, to: acc, value: p.value, first: i === 0 };
  });
  const ticks: number[] = [];
  const step = hi - lo > 12 ? 4 : 2;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const xd = X0 + r.parts.length * slot;
  const xs = X0 + (r.parts.length + 1) * slot;
  const open = r.margin > 0;
  const top = Math.min(sy(r.delivered), sy(r.revenue));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 248"
      role="img"
      aria-label={`A cargo from Kessler to Northport: crude at ${money(r.parts[0].value)}, plus ${r.parts
        .slice(1)
        .map((p) => `${p.label.toLowerCase()} ${money(p.value)}`)
        .join(', ')}, delivers at ${money(r.delivered)} a barrel. It sells for ${money(r.revenue)} after losses, so the arbitrage is ${open ? 'open' : 'closed'} by ${money(Math.abs(r.margin))}.`}
    >
      <text className="ax" x={X0} y={14}>
        $ per barrel (the axis starts at ${lo})
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line className="gl" x1={X0} x2={X1} y1={sy(t)} y2={sy(t)} />
          <text className="ax ax-e" x={X0 - 6} y={sy(t) + 4}>
            ${t}
          </text>
        </g>
      ))}
      <line className="base" x1={X0} x2={X1} y1={Y0} y2={Y0} />
      {steps.map((s, i) => {
        const x = X0 + i * slot + slot * 0.18;
        const w = slot * 0.64;
        const y = sy(s.to);
        const h = Math.max(1.5, sy(s.from) - sy(s.to));
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} fill={s.first ? '#b9b9b9' : '#e6a3a0'} />
            {!s.first && <line x1={x - slot * 0.36} x2={x} y1={sy(s.from)} y2={sy(s.from)} stroke="#9a9a9a" strokeDasharray="2 2" />}
            <text x={x + w / 2} y={y - 5} textAnchor="middle" style={{ fontSize: 11, fill: '#333' }}>
              {s.first ? money(s.value) : `+${money(s.value)}`}
            </text>
            <text className="ax ax-m" x={x + w / 2} y={Y0 + 15}>
              {s.label}
            </text>
          </g>
        );
      })}
      <rect x={xd + slot * 0.18} y={sy(r.delivered)} width={slot * 0.64} height={Y0 - sy(r.delivered)} fill="#c4382f" opacity={0.85} />
      <text x={xd + slot / 2} y={sy(r.delivered) - 5} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: '#c4382f' }}>
        {money(r.delivered)}
      </text>
      <text className="ax ax-m" x={xd + slot / 2} y={Y0 + 15}>
        Delivered
      </text>
      <rect x={xs + slot * 0.18} y={sy(r.revenue)} width={slot * 0.64} height={Y0 - sy(r.revenue)} fill="#6d9c37" opacity={0.9} />
      <text x={xs + slot / 2} y={sy(r.revenue) - 5} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: '#3f7a1e' }}>
        {money(r.revenue)}
      </text>
      <text className="ax ax-m" x={xs + slot / 2} y={Y0 + 15}>
        Sold
      </text>
      <line x1={xd + slot * 0.82} x2={xs + slot * 0.18} y1={sy(r.delivered)} y2={sy(r.delivered)} stroke="#c4382f" strokeDasharray="3 3" />
      <text x={(xd + xs) / 2 + slot / 2} y={top - 22} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: open ? '#3f7a1e' : '#c4382f' }}>
        {open ? `arb open: +${money(r.margin)}` : `arb closed: −${money(-r.margin)}`}
      </text>
      <text className="ax ax-e" x={X1} y={Y0 + 34}>
        sold at Northport’s price, less the barrels lost on the way
      </text>
    </svg>
  );
}

/** Each crude's value gap at Calder (bar) against its market differential (tick), $/bbl. */
function QualityBars({ diffs }: { diffs: Record<CrudeId, number> }) {
  const X0 = 150;
  const X1 = 610;
  const lo = -30;
  const hi = 6;
  const sx = (v: number) => X0 + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (X1 - X0);
  const rowH = 34;
  const top = 26;
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${top + rowH * 4 + 26}`}
      role="img"
      aria-label={`Each crude’s value at Calder relative to Ridgeback Light, against what it costs relative to Ridgeback: ${CRUDE_IDS.map((k) => `${NAME[k]} worth ${signedMoney(diffs[k])}, priced ${signedMoney(MARKET_DIFF[k])}`).join('; ')}.`}
    >
      <text className="ax" x={X0} y={14}>
        Value at Calder relative to Ridgeback Light (bar) and price relative to it (tick), $ per barrel
      </text>
      {[-30, -20, -10, 0].map((v) => (
        <g key={v}>
          <line className={v === 0 ? 'base' : 'gl'} x1={sx(v)} x2={sx(v)} y1={top} y2={top + rowH * 4} />
          <text className="ax ax-m" x={sx(v)} y={top + rowH * 4 + 16}>
            {v === 0 ? '$0' : `−$${-v}`}
          </text>
        </g>
      ))}
      {CRUDE_IDS.map((k, i) => {
        const y = top + i * rowH;
        const d = diffs[k];
        const gap = d - MARKET_DIFF[k];
        const a = Math.min(sx(0), sx(d));
        return (
          <g key={k}>
            <text x={X0 - 8} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
              {NAME[k]}
            </text>
            <rect x={a} y={y + 8} width={Math.max(1, Math.abs(sx(d) - sx(0)))} height={rowH - 16} fill={CRUDE_COLOR[k]} opacity={0.85} />
            <line x1={sx(MARKET_DIFF[k])} x2={sx(MARKET_DIFF[k])} y1={y + 3} y2={y + rowH - 3} stroke="#333" strokeWidth={2.5} />
            {k !== 'ridgeback' && (
              <text x={Math.max(sx(0), sx(d), sx(MARKET_DIFF[k])) + 6} y={y + rowH / 2 + 4} style={{ fontSize: 12, fontWeight: 500, fill: gap >= 0 ? '#3f7a1e' : '#c4382f' }}>
                {gap >= 0 ? `a bargain by ${money(gap)}` : `dear by ${money(-gap)}`}
              </text>
            )}
            {k === 'ridgeback' && (
              <text x={sx(0) + 6} y={y + rowH / 2 + 4} className="ax">
                the reference
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  // ---- Figure 1.
  const s1 = useScenario('arb', { vessel: 'aframax' as VesselId, kessler: KESSLER_DEFAULT, northport: NORTHPORT_DEFAULT });
  const { vessel, kessler, northport } = s1.state;
  const r = arbFor(vessel, kessler, northport);
  const freight = freightFor(vessel);
  const closing = closingFreight(arbInputs(vessel, kessler, northport));
  const solvedA = arbSolved(vessel, kessler, northport);
  const atDefault = useMemo(() => Object.fromEntries(VESSEL_IDS.map((v) => [v, arbFor(v, KESSLER_DEFAULT, NORTHPORT_DEFAULT)])) as Record<VesselId, ArbResult>, []);
  const open = useMemo(() => Object.fromEntries(VESSEL_IDS.map((v) => [v, highestOpen(v)])) as Record<VesselId, number>, []);
  const vlccLightering = (Math.max(0, VESSELS.vlcc.cargo - CALDER_DOCK_LIMIT) * LIGHTERING_COST) / VESSELS.vlcc.cargo;

  // ---- Figure 2.
  const s2 = useScenario('quality', { fuelOil: FUEL_OIL_DEFAULT, diesel: DIESEL_DEFAULT });
  const { fuelOil, diesel } = s2.state;
  const diffs = useMemo(() => differentialsAt(fuelOil, diesel), [fuelOil, diesel]);
  const dDiesel = useDeferredValue(diesel);
  const sweep = useMemo(() => SWEEP.map((h) => ({ h, d: differentialsAt(h, dDiesel) })), [dDiesel]);
  const solvedB = qualitySolved(fuelOil, diesel);
  const ref = useMemo(() => differentialsAt(FUEL_OIL_DEFAULT, DIESEL_DEFAULT), []);
  const netbacks = useMemo(() => Object.fromEntries(CRUDE_IDS.map((k) => [k, crudeNetback(k)])) as Record<CrudeId, number>, []);
  const at = (h: number, d = DIESEL_DEFAULT) => differentialsAt(h, d);
  const noCokerColdwater = useMemo(() => crudeNetback('coldwater', { config: { ...CALDER, capacity: { ...CALDER.capacity, coker: 0 } } }), []);

  return (
    <LessonPage id="oil/4.5">
      <P>
        <a href={lessonHref('oil/4.4')}>Lesson 4.4</a> found that crude has a different price in every place it can be bought, and that the differences follow the
        network: where oil can move freely, prices differ by what it costs to move it; where a link is full, the price on the far side of it drops until the next-best
        outlet takes the barrel. This lesson looks at the people who keep those differences in line — traders who buy where crude is cheap, move it, and sell where it’s
        dear — and at a second kind of difference that has nothing to do with location: quality.
      </P>
      <P>
        Take a cargo of crude bought at the Kessler hub, piped {fmt(KESSLER_CALDER.lengthMiles)} miles to Port Calder and shipped across to Northport, the deep market whose price behaves like
        Brent. Every step costs something. The pipeline charges its tariff. Terminals charge to load the tanker and to unload it. The ship is paid for by the day and
        burns fuel (<a href={lessonHref('oil/4.2')}>Lesson 4.2</a>). The cargo is insured, and the money tied up in it for the {fmt(ARB.transitDays)} days at sea costs
        interest. And not every barrel arrives: a little evaporates or stays behind in the tanks. Add all that to the price paid at Kessler and you have the{' '}
        <K c="price">delivered cost</K>. If Northport pays more than that, there is money to be made moving oil — the <b>arbitrage</b>, which traders shorten to the
        “arb” — and the arb is said to be open.
      </P>
      <P>
        In the next demonstration, the bars build the delivered cost of a barrel step by step and set it against what the barrel sells for at Northport. All the prices
        are simulated. Choose the ship, and set the two prices:
      </P>

      <Figure name="Crude Arbitrage Lab" scenario={s1}>
        <Segmented label="Vessel" value={vessel} onChange={(v) => s1.set({ vessel: v })} options={VESSEL_IDS.map((v) => ({ value: v, label: `${VESSELS[v].name}, ${fmt(VESSELS[v].cargo / 1e6, 1)} million bbl` }))} />
        <Waterfall r={r} northport={northport} />
        <Readouts
          items={[
            { label: <K c="price">delivered cost</K>, value: money(r.delivered), tone: 'green' },
            { label: 'sold at Northport', value: money(r.revenue), tone: 'green' },
            { label: 'margin per barrel', value: signedMoney(r.margin), tone: r.margin > 0 ? 'green' : 'red' },
            { label: 'freight that would just close it', value: money(closing) },
          ]}
        />
        <Slider label="Kessler price" tone="green" value={kessler} min={65} max={80} step={PRICE_STEP} onChange={(v) => s1.set({ kessler: round1(v) })} display={`${money(kessler)}/bbl`} />
        <Slider label="Northport price" tone="green" value={northport} min={70} max={90} step={PRICE_STEP} onChange={(v) => s1.set({ northport: round1(v) })} display={`${money(northport)}/bbl`} />
        <Caption>
          A {VESSELS[vessel].name} carries {fmt(VESSELS[vessel].cargo)} barrels {fmt(ROUTES.northport.nm)} nautical miles at {SPEED} knots, for {money(freight)} a
          barrel{vessel === 'vlcc' ? `, including ${money(vlccLightering)} for topping the cargo up offshore, since Port Calder’s dock can load only ${fmt(CALDER_DOCK_LIMIT / 1e6, 0)} million barrels` : ''}.
          On a cargo, the margin comes to {usd(r.margin * VESSELS[vessel].cargo)}.
        </Caption>
      </Figure>

      <P>
        Start with an Aframax, Kessler at {money(KESSLER_DEFAULT)} and Northport at {money(NORTHPORT_DEFAULT)}. The barrel costs {money(atDefault.aframax.delivered)}{' '}
        delivered and sells for {money(atDefault.aframax.revenue)}, so the arb is closed by {money(-atDefault.aframax.margin)}: a {money(NORTHPORT_DEFAULT - KESSLER_DEFAULT)}{' '}
        difference between the two prices isn’t enough to pay for the journey. A Suezmax narrows the gap to {money(-atDefault.suezmax.margin)}. A VLCC, carrying twice
        as much as a Suezmax for not much more cost a day, gets within {money(-atDefault.vlcc.margin)} — even after paying {money(vlccLightering)} a barrel to top up its
        cargo offshore, because it can’t load fully at Port Calder’s dock.
      </P>
      <P>
        So the two prices can sit about five dollars apart without anyone moving a barrel between them. That’s the general rule. Between any two places there is a
        band, as wide as the cost of moving oil from one to the other, inside which the prices move independently. If the spread grows past the band, traders ship
        cargoes, buying at Kessler and selling at Northport, and their buying and selling push the prices back together. Arbitrage doesn’t make prices equal; it keeps
        them from drifting further apart than it costs to close the gap.
      </P>

      <Challenge
        id="a"
        question={`With Northport at ${money(NORTHPORT_DEFAULT)}, what is the highest Kessler price, to the nearest 10 cents, at which a cargo to Northport still makes money — in whichever ship does best?`}
        solved={solvedA}
        status={
          Math.abs(northport - NORTHPORT_DEFAULT) > 1e-9
            ? `Set Northport back to ${money(NORTHPORT_DEFAULT)}.`
            : `At ${money(kessler)}, a ${VESSELS[vessel].name} cargo ${r.margin > 0 ? 'makes' : 'loses'} ${money(Math.abs(r.margin))} a barrel.`
        }
        success={`Solved: ${money(kessler)} in a VLCC. The VLCC’s arb stays open up to ${money(open.vlcc)}, against ${money(open.suezmax)} for a Suezmax and ${money(open.aframax)} for an Aframax: the bigger ship moves oil about ${money(open.vlcc - open.aframax)} a barrel more cheaply, so it sets how wide the spread can get. That is why long-haul crude moves in the largest ships the ports allow.`}
      />

      <H2>Quality differentials</H2>
      <P>
        Location is one reason crudes sell at different prices. Quality is the other. Each crude is quoted as a <K c="price">differential</K> to a benchmark — so many
        dollars over or under — and what sets the differential is what refiners can make from it. <a href={lessonHref('oil/1.3')}>Lesson 1.3</a> named the physical
        reasons: heavy crude yields less of the light products, sour crude carries sulfur that costs money to remove. <a href={lessonHref('oil/3.5')}>Lesson 3.5</a> put a
        refinery to work on them.
      </P>
      <P>
        One way to compare crudes at a refinery is its <b>netback</b> for each: run the refinery on that crude alone, and divide what the products sell for, less the
        cost of running the units, by the barrels run. At Calder, with the reference prices, Ridgeback Light nets {money(netbacks.ridgeback)} a barrel, Seaboard Blend{' '}
        {money(netbacks.seaboard)}, Northfield Sour {money(netbacks.northfield)} and Coldwater Heavy {money(netbacks.coldwater)}. Measured from Ridgeback, that makes
        Seaboard worth {signedMoney(ref.seaboard)}, Northfield {signedMoney(ref.northfield)} and Coldwater {signedMoney(ref.coldwater)}. The market prices them, delivered
        to Calder, at {signedMoney(MARKET_DIFF.seaboard)}, {signedMoney(MARKET_DIFF.northfield)} and {signedMoney(MARKET_DIFF.coldwater)}. Seaboard costs much more
        than it’s worth to Calder; Coldwater’s discount more than covers its shortcomings. (These are values for running each crude on its own. In the refinery’s actual
        slate, as Lesson 3.5 showed, a crude’s value also depends on what else is running: Northfield, for instance, competes with Coldwater for room in the
        hydrotreater.)
      </P>
      <P>
        Those values move with product prices. In the next demonstration, set the price of high-sulfur fuel oil, the outlet for the heaviest, sourest part of every
        barrel, and the price of diesel; the chart traces the heavy and sour crudes’ value gaps across fuel-oil prices:
      </P>

      <Figure name="Crude Arbitrage Lab · quality" scenario={s2}>
        <QualityBars diffs={diffs} />
        <Legend
          items={[
            { label: 'Coldwater Heavy: value gap at Calder', color: CRUDE_COLOR.coldwater, kind: 'line' },
            { label: 'Northfield Sour', color: CRUDE_COLOR.northfield, kind: 'line' },
            { label: 'Their market differentials', color: '#777', kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`Value gap relative to Ridgeback Light against the fuel-oil price, at diesel ${money(dDiesel)}: Coldwater Heavy ${sweep.map((p) => `${money(p.d.coldwater)} at ${usd(p.h)}`).join(', ')}. The market discounts are ${money(-MARKET_DIFF.coldwater)} and ${money(-MARKET_DIFF.northfield)}.`}
          height={210}
          x={[30, 90]}
          y={[-30, 5]}
          xTicks={[30, 40, 50, 60, 70, 80, 90]}
          yTicks={[-30, -20, -10, 0]}
          xFormat={(v) => `$${v}`}
          yFormat={(v) => (v === 0 ? '$0' : `−$${-v}`)}
          xLabel="fuel-oil price, $ per barrel"
          yLabel="Value relative to Ridgeback Light, $/bbl"
          series={[
            { points: sweep.map((p) => [p.h, p.d.coldwater] as [number, number]), color: CRUDE_COLOR.coldwater, width: 2.5 },
            { points: sweep.map((p) => [p.h, p.d.northfield] as [number, number]), color: CRUDE_COLOR.northfield, width: 2.5 },
          ]}
          refs={[
            { axis: 'y', at: MARKET_DIFF.coldwater, color: CRUDE_COLOR.coldwater, dash: '5 4' },
            { axis: 'y', at: MARKET_DIFF.northfield, color: CRUDE_COLOR.northfield, dash: '5 4' },
            { axis: 'x', at: fuelOil, cursor: true },
          ]}
          markers={[
            { x: fuelOil, y: diffs.coldwater, color: CRUDE_COLOR.coldwater, r: 6 },
            { x: fuelOil, y: diffs.northfield, color: CRUDE_COLOR.northfield, r: 6 },
          ]}
        />
        <Readouts
          items={[
            { label: 'Coldwater’s value gap at Calder', value: signedMoney(diffs.coldwater), tone: 'green' },
            { label: 'its market differential', value: signedMoney(MARKET_DIFF.coldwater), tone: 'green' },
            { label: 'Northfield’s value gap', value: signedMoney(diffs.northfield), tone: 'green' },
          ]}
        />
        <Slider label="High-sulfur fuel oil" tone="green" value={fuelOil} min={30} max={90} onChange={(v) => s2.set({ fuelOil: v })} display={`${usd(fuelOil)}/bbl`} />
        <Slider label="Diesel" tone="green" value={diesel} min={90} max={125} onChange={(v) => s2.set({ diesel: v })} display={`${usd(diesel)}/bbl`} />
      </Figure>

      <P>
        Fuel oil moves the heavy crude’s value most. At a fuel-oil price of {usd(30)}, Coldwater Heavy is worth {money(-at(30).coldwater)} less than Ridgeback Light at
        Calder; at {usd(FUEL_OIL_DEFAULT)}, {money(-ref.coldwater)} less; at {usd(80)}, only {money(-at(80).coldwater)}. A third of Coldwater is residue, and whatever the
        coker can’t take leaves as fuel oil, so its price is written into Coldwater’s. Northfield, with less residue, moves less: from {signedMoney(at(30).northfield)} to{' '}
        {signedMoney(at(80).northfield)} over the same range. Diesel matters too, more gently: at a diesel price of {usd(90)} Coldwater’s gap is{' '}
        {signedMoney(at(FUEL_OIL_DEFAULT, 90).coldwater)}, at {usd(125)} {signedMoney(at(FUEL_OIL_DEFAULT, 125).coldwater)}, since a light crude makes more of the diesel
        whose price has risen.
      </P>
      <P>
        Markets have run this experiment. When the global cap on sulfur in ships’ fuel took effect in 2020 — the limit from <a href={lessonHref('oil/1.2')}>Lesson 1.2</a>{' '}
        — high-sulfur fuel oil fell sharply relative to crude, and the discounts on high-sulfur crudes widened for a time. And the market’s differential isn’t set by
        Calder alone. Refineries differ.{' '}
        {noCokerColdwater === 0
          ? 'A refinery without a coker can’t run Coldwater Heavy on its own at all in our model: however it blends, its fuel oil would carry more than 3.5% sulfur.'
          : `A refinery without a coker would value Coldwater Heavy at only ${money(noCokerColdwater)} a barrel.`}{' '}
        Heavy, sour crude finds its price where the complex refineries that can handle it run out of room to take more.
      </P>

      <Challenge
        id="b"
        question={`With diesel at its reference ${usd(DIESEL_DEFAULT)}, find the fuel-oil price, to the nearest dollar, at which Coldwater Heavy’s value gap at Calder comes closest to its ${money(-MARKET_DIFF.coldwater)} market discount.`}
        solved={solvedB}
        status={
          diesel !== DIESEL_DEFAULT
            ? `Set diesel back to ${usd(DIESEL_DEFAULT)}.`
            : `At ${usd(fuelOil)} fuel oil, Coldwater is worth ${signedMoney(diffs.coldwater)} relative to Ridgeback; the market charges ${signedMoney(MARKET_DIFF.coldwater)}.`
        }
        success={`Solved: ${usd(fuelOil)}. There Coldwater is worth ${signedMoney(diffs.coldwater)} at Calder, almost exactly its market discount. With fuel oil any cheaper, Calder would rather pay the extra for Ridgeback Light — unless the market widened Coldwater’s discount to match, which is what happens when fuel oil falls and every complex refinery is making the same calculation.`}
      />

      <H2>Why location matters</H2>
      <P>
        That answers the chapter’s question. Oil is easy to store and move compared with electricity or natural gas, but moving it is never free and never unlimited.
        Pipelines cost more per barrel the harder they’re pushed and have a ceiling; tankers charge by the day and burn fuel by the mile; tanks cost rent and interest.
        So a barrel’s price depends on where it is, within bands set by the cost of moving it, and when a link fills, by more. Quality adds a second layer: the same
        barrel is worth different amounts to different refineries. Both show up as differentials, and physical traders earn their living closing the ones that grow
        wider than the cost of closing them. You can return to <FigRef to="Crude Arbitrage Lab">the first demonstration</FigRef> to see how much spread each ship needs.
      </P>
      <P>
        Through this chapter the benchmark prices themselves have been given. Where do they come from? Chapter 5 builds them up from the physical balance of the
        world’s oil — what’s produced, refined, consumed and stored — starting with <a href={lessonHref('oil/5.1')}>the balance sheet</a> every analyst keeps.
      </P>
    </LessonPage>
  );
}
