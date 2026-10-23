import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  Figure,
  H2,
  K,
  Legend,
  LessonPage,
  NetworkView,
  P,
  Readouts,
  Slider,
  fmt,
  lessonHref,
  mw,
  priceFill,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { dcopf } from '../../engines/market/opf';
import { fleetOffers, nodalLoads } from '../../engines/market/networkDispatch';
import { reserveUnitsFromFleet, scarcityClear, scarcityCurve } from '../../engines/market/scarcity';
import { STANDARD_FLEET, fleetById } from '../../model/fleet';
import { REGION, REGION_LOAD_SHARE, nodeName } from '../../model/networks';
import { SOLAR_CF, WIND_CF } from '../../model/profiles';

// ---------------------------------------------------------------------------
// Scarcity: the evening peak in one zone, with energy and reserves cleared together.

const EVENING = 19;
const RESERVE_REQ = fleetById('nuc').capacity; // enough to cover the loss of the largest plant
const VOLL = 5000;
const D_MIN = 1000;
const D_MAX = 2100;

function unitsFor(lakesideOut: boolean) {
  return reserveUnitsFromFleet(STANDARD_FLEET, { windCF: WIND_CF[EVENING], solarCF: SOLAR_CF[EVENING], out: lakesideOut ? ['cc1'] : [] });
}
const UNITS_ALL = unitsFor(false);
const UNITS_OUT = unitsFor(true);
const TOTAL_ALL = UNITS_ALL.reduce((s, u) => s + u.capacity, 0);
const TOTAL_OUT = UNITS_OUT.reduce((s, u) => s + u.capacity, 0);
const PEAK_NORMAL = scarcityClear(UNITS_ALL, 1440, RESERVE_REQ, 1000, VOLL);
const PEAK_TRIPPED = scarcityClear(UNITS_OUT, 1440, RESERVE_REQ, 1000, VOLL);

const curveCache = new Map<string, ReturnType<typeof scarcityCurve>>();
function curve(lakesideOut: boolean, shortage: number) {
  const key = `${lakesideOut}|${shortage}`;
  let c = curveCache.get(key);
  if (!c) {
    c = scarcityCurve(lakesideOut ? UNITS_OUT : UNITS_ALL, RESERVE_REQ, shortage, VOLL, D_MIN, D_MAX);
    curveCache.set(key, c);
  }
  return c;
}

const REGIME_FILL = { normal: 'none', shortage: '#f0c75a', shed: '#e75b55' } as const;
const marginalName = (units: ReturnType<typeof unitsFor>, price: number, shortage: number) => {
  const base = price >= VOLL - 1e-6 ? NaN : price - shortage;
  const u = units.find((x) => Math.abs(x.energyCost - base) < 1e-6) ?? units.find((x) => Math.abs(x.energyCost - price) < 1e-6);
  return u ? fleetById(u.id).name : '';
};

// ---------------------------------------------------------------------------
// Oversupply: a windy night on the region's network.

const NIGHT = 3;

function nightSolve(st: { demand: number; wind: number; offer: number; floors: boolean; out: string }) {
  const gens = fleetOffers(STANDARD_FLEET, { windCF: st.wind / fleetById('wind').capacity, solarCF: SOLAR_CF[NIGHT], mustRun: st.floors, offers: { wind: st.offer } });
  const loads = nodalLoads(st.demand, REGION_LOAD_SHARE);
  return dcopf(REGION, gens, loads, { outages: st.out ? [st.out] : [] });
}

const LABEL_OFFSET: Record<string, [number, number]> = {
  'north-center': [34, -14],
  'north-east': [0, -10],
  'harbor-center': [-6, -10],
  'harbor-west': [40, -14],
  'west-center': [34, 4],
  'center-city': [10, -18],
  'east-city': [44, 0],
  'west-city': [10, 22],
};

function lineName(id: string) {
  const l = REGION.lines.find((x) => x.id === id)!;
  return `${nodeName(REGION, l.from)}–${nodeName(REGION, l.to)}`;
}

export default function Lesson() {
  // ---- Figure 1: scarcity.
  const s = useScenario('scarcity', { demand: 1440, tripped: false, shortage: 1000 });
  const { demand, tripped, shortage } = s.state;
  const units = tripped ? UNITS_OUT : UNITS_ALL;
  const now = scarcityClear(units, demand, RESERVE_REQ, shortage, VOLL);
  const segs = curve(tripped, shortage);
  // At a boundary the price already reflects what the next megawatt would cost, so classify by price too.
  const regime = now.shed > 1e-6 || now.energyPrice >= VOLL - 1e-6 ? 'shed' : now.reserveShort > 1e-6 || now.energyPrice >= shortage ? 'shortage' : 'normal';
  const X = scale(D_MIN, D_MAX, 70, 580);
  const lg = (p: number) => Math.log10(Math.max(10, p));
  const Y = scale(1, 4, 236, 30);
  const yOf = (p: number) => Y(lg(p));
  const shortStart = segs.find((g) => g.regime === 'shortage')?.from;
  const shedStart = segs.find((g) => g.regime === 'shed')?.from;  const marg = marginalName(units, now.energyPrice, shortage);
  const spare = units.reduce((t, u) => t + (u.reserveMax > 0 ? u.capacity - (now.energy[u.id] ?? 0) : 0), 0);
  let caption: string;
  if (regime === 'shed')
    caption =
      now.shed > 0.5
        ? `Even with every reserve megawatt producing energy, supply falls ${mw(now.shed)} short. The operator has to cut customers off, and the price is the value of lost load, ${usd(VOLL)}.`
        : `Every megawatt of capacity is in use. The next megawatt of demand would have to be cut off, so the price is already the value of lost load, ${usd(VOLL)}.`;
  else if (regime === 'shortage')
    caption =
      now.reserveShort > 0.5
        ? `Reserves are ${mw(now.reserveShort)} short of the ${RESERVE_REQ} MW the operator wants. Each extra megawatt of demand comes from ${marg || 'the last plant with room'} and deepens the shortfall, so the price is its cost plus ${usd(shortage)}.`
        : `Reserves are exactly at the ${RESERVE_REQ} MW requirement, so the next megawatt of demand would come out of them: the price already includes the ${usd(shortage)} shortage price.`;  else caption = `${mw(spare)} of spare capacity is available, more than the ${RESERVE_REQ} MW of reserve required. The price is set by ${marg || 'the marginal plant'}, as in Chapter 4.`;

  // ---- Figure 2: too much power.
  const n = useScenario('oversupply', { demand: 750, wind: 175, offer: -25, floors: true, out: '' });
  const r = nightSolve(n.state);
  const prices = REGION.nodes.map((x) => r.lmp[x.id] ?? 0);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const curtailed = Math.max(0, n.state.wind - (r.dispatch.wind ?? 0));
  const mixed = r.feasible && lo < -0.005 && hi > 0.005;
  const toggleLine = (id: string) => n.set((st) => ({ out: st.out === id ? '' : id }));

  // Prose numbers for the windy night at the default demand.
  const nightAt = (wind: number) => nightSolve({ demand: 750, wind, offer: -25, floors: true, out: '' });
  const night = useMemo(() => ({ calm: nightAt(175), windy: nightAt(350), loose: nightSolve({ demand: 750, wind: 350, offer: -25, floors: false, out: '' }) }), []);

  return (
    <LessonPage id="5.5">
      <P>
        Most of the time, electricity prices move in a narrow band, set by the running costs of whichever plant is on the margin: a few tens of dollars per
        megawatt-hour. A few hours a year they leave that band entirely. They can jump to hundreds or thousands of dollars, and they can fall below zero, so that
        generators pay to produce. Neither extreme is a malfunction. Both are the market reporting, accurately, that the grid has run short of something.
      </P>

      <H2>Scarcity</H2>
      <P>
        Recall from Chapter 4 that the operator doesn’t dispatch every last megawatt it has. It holds some capacity back as <K tone="teal">reserve</K>, ready to replace
        a plant that trips without warning. Our region holds {RESERVE_REQ} MW, enough to cover the loss of Harbor Point, its largest plant. In this demonstration, any
        spare capacity at a dispatchable plant counts as reserve. Energy and reserves are cleared together in a single optimization, and the network is ignored so that
        we can watch scarcity on its own. Drag demand up past the evening peak:
      </P>

      <Figure name="Extreme Price Laboratory" scenario={s}>
        <Legend
          items={[
            { label: 'Energy price', color: '#3f7a1e', kind: 'line' },
            { label: 'Reserves short', color: '#f0c75a' },
            { label: 'Customers cut off', color: '#e75b55' },
          ]}
        />
        <svg
          className="chart"
          viewBox="0 0 600 274"
          role="img"
          aria-label={`Energy price against demand on a logarithmic scale. At ${mw(demand)} the price is ${usd(now.energyPrice)} per MWh.`}
        >
          <text className="ax" x={70} y={18}>
            Energy price, $ per MWh (each gridline is ten times the one below)
          </text>
          {segs
            .reduce<Array<{ from: number; to: number; regime: 'normal' | 'shortage' | 'shed' }>>((bands, g) => {
              const last = bands[bands.length - 1];
              if (last && last.regime === g.regime) last.to = g.to;
              else bands.push({ from: g.from, to: g.to, regime: g.regime });
              return bands;
            }, [])
            .filter((g) => g.regime !== 'normal')
            .map((g, i) => (
              <rect key={i} x={X(g.from)} y={30} width={X(g.to) - X(g.from)} height={206} fill={REGIME_FILL[g.regime]} opacity={0.16} />
            ))}
          {[10, 100, 1000, 10000].map((t) => (
            <g key={t}>
              <line className={t === 10 ? 'base' : 'gl'} x1={70} x2={580} y1={yOf(t)} y2={yOf(t)} />
              <text className="ax ax-e" x={64} y={yOf(t) + 4}>
                ${fmt(t)}
              </text>
            </g>
          ))}
          {[1000, 1200, 1400, 1600, 1800, 2000].map((d) => (
            <text key={d} className="ax ax-m" x={X(d)} y={254}>
              {fmt(d)}
            </text>
          ))}
          <text className="ax ax-e" x={580} y={272}>
            Demand, MW
          </text>
          {shortStart !== undefined && (
            <text x={X(shortStart) + 6} y={46} style={{ fontSize: 12, fill: '#8a6500', fontWeight: 500 }}>
              reserves short
            </text>
          )}
          {shedStart !== undefined && (
            <text x={Math.min(X(shedStart) + 6, 500)} y={62} style={{ fontSize: 12, fill: '#c4382f', fontWeight: 500 }}>
              load shed
            </text>
          )}
          <path
            d={segs.map((g, i) => `${i ? 'L' : 'M'}${X(g.from).toFixed(1)} ${yOf(g.price).toFixed(1)} L${X(g.to).toFixed(1)} ${yOf(g.price).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="#3f7a1e"
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <line className="cur" x1={X(demand)} x2={X(demand)} y1={30} y2={236} />
          <circle cx={X(demand)} cy={yOf(now.energyPrice)} r={6} fill="#3f7a1e" stroke="#f8f8f8" strokeWidth={2} />
        </svg>
        <Readouts
          items={[
            { label: 'energy price per MWh', value: usd(now.energyPrice), tone: 'green' },
            { label: `reserve held, of ${RESERVE_REQ} MW`, value: mw(Math.min(now.reserveHeld, RESERVE_REQ)), tone: 'teal' },
            { label: 'customers cut off', value: mw(now.shed), tone: now.shed > 1e-6 ? 'red' : undefined },
          ]}
        />
        <Slider label="Demand" value={demand} min={D_MIN} max={D_MAX} step={10} onChange={(v) => s.set({ demand: v })} display={mw(demand)} />
        <Slider
          label="Price of a reserve shortfall"
          tone="green"
          value={shortage}
          min={300}
          max={3000}
          step={100}
          onChange={(v) => s.set({ shortage: v })}
          display={`${usd(shortage)} per MW`}
        />
        <Checkbox label="Lakeside combined-cycle has tripped (400 MW lost)" checked={tripped} onChange={(v) => s.set({ tripped: v })} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Up to {mw(TOTAL_ALL - RESERVE_REQ)}, nothing unusual happens: the price steps up through the merit order, one plant at a time, and stays below $100. Beyond that
        point, every extra megawatt of demand has to come out of the reserve. The operator would rather run short of reserve than cut customers off, but a shortfall
        isn’t free — it raises the chance that the next trip becomes a blackout — so the market software gives it a price: here, $1,000 for each megawatt missing. The
        energy price becomes the cost of the plant that produces the extra megawatt plus the value of the reserve it can no longer hold. At{' '}
        {mw(TOTAL_ALL - RESERVE_REQ + 40)}, that’s Mill Creek’s $42 plus $1,000. Once the last spare megawatt is producing, at {mw(TOTAL_ALL)}, the only way left to
        balance the grid is to disconnect customers, and the price becomes the <b>value of lost load</b>: an estimate of what an hour without power costs the people
        cut off, here {usd(VOLL)} per megawatt-hour.
      </P>
      <P>
        Scarcity rarely arrives because demand creeps up a few megawatts at a time. It arrives as a shock. Tick the box to trip Lakeside at the {mw(1440)} evening peak:
        the price jumps from {usd(PEAK_NORMAL.energyPrice)} to {usd(PEAK_TRIPPED.energyPrice)}, and the whole curve shifts {mw(TOTAL_ALL - TOTAL_OUT)} to the left. A
        heat wave or a cold snap does the same from the other side, pushing demand far beyond anything forecast a few days earlier. The worst events bring both at once.
        During the February 2021 winter storm in Texas, demand surged while frozen plants dropped off the grid, and the market price sat at its cap, then $9,000 per
        megawatt-hour, for several days while operators cut power to millions of customers.
      </P>
      <P>
        Notice, too, that the reserve shortage price and the value of lost load aren’t anyone’s costs or offers. They’re administrative numbers, chosen by regulators and operators. Slide the shortage price to see how directly they set the price in a crisis. Markets choose very differently. Texas, which pays generators no
        separate capacity payments, now allows prices up to $5,000 per megawatt-hour, while most other US markets require offers above $1,000 to be justified by
        verified costs.
      </P>
      <P>
        Why let prices go that high at all? Because a high price is the signal that tells anyone who can help to help: peaking plants to start, batteries to discharge,
        large customers to cut back in exchange for payment, neighbors to export. And because plants needed only a few hours a year must earn their keep in those hours.
        Eastgate’s fixed costs — its construction, staff and upkeep — come to about {usd(fleetById('ct').fixedCost)} per megawatt each year. If it runs fifty hours a
        year, it has to earn about {usd(fleetById('ct').fixedCost / 50)} per megawatt-hour above its fuel cost in those hours just to break even. Where scarcity prices
        are capped low, that money has to come from somewhere else, which is one reason many markets add the capacity markets of Lesson 4.6.
      </P>

      <H2>Too much power</H2>
      <P>
        The other extreme comes at night, when demand is low and the wind is strong. Some plants can’t simply turn off. Harbor Point, our nuclear plant, can’t run
        below 360 MW without shutting down, and restarting a nuclear plant can take days. Ironwood coal has a minimum stable output of 120 MW. Wind farms, meanwhile, often earn money for
        every megawatt-hour they produce whatever the price — in the United States through a federal production tax credit and the sale of renewable energy
        certificates — so a wind farm can pay to produce and still come out ahead. It offers its output at a negative price, here −$25.
      </P>
      <P>
        Here’s the region at 03:00, with demand at {mw(750)} and Ridge wind at half its capacity. Prices are shaded on the map, with negative prices in blue. Raise the wind and lower the
        demand. You can also click any line to take it out of service, and click it again to restore it:
      </P>

      <Figure name="Extreme Price Laboratory · too much power" scenario={n}>
        <NetworkView
          ariaLabel={`The region at night. Prices from ${usd(lo)} to ${usd(hi)} per MWh. ${n.state.out ? `Line ${lineName(n.state.out)} is out of service.` : 'All lines in service.'} Wind curtailed: ${fmt(curtailed)} MW.`}
          width={600}
          height={408}
          onLineClick={toggleLine}
          nodes={REGION.nodes.map((x) => ({
            id: x.id,
            x: x.x,
            y: x.y,
            r: 32,
            label: x.name,
            labelPos: x.id === 'west' ? 'below' : x.id === 'city' ? 'right' : 'above',
            value: r.feasible ? usd(r.lmp[x.id] ?? 0) : '—',
            sub: 'per MWh',
            fill: priceFill(r.lmp[x.id] ?? 0),
          }))}
          lines={REGION.lines.map((l) => {
            const out = l.id === n.state.out;
            const [dx, dy] = LABEL_OFFSET[l.id] ?? [0, -10];
            return {
              id: l.id,
              from: l.from,
              to: l.to,
              flow: out ? 0 : r.flows[l.id],
              limit: l.limit,
              out,
              label: out ? 'out of service' : `${fmt(Math.abs(r.flows[l.id]))} / ${fmt(l.limit)}`,
              labelDx: dx,
              labelDy: dy,
            };
          })}
        >
          <text x={22} y={124} style={{ fontSize: 12, fill: '#444' }}>
            <tspan style={{ fontWeight: 500 }}>Ridge wind</tspan> {fmt(r.dispatch.wind ?? 0)} of {fmt(n.state.wind)} MW
          </text>
          <text x={22} y={140} style={{ fontSize: 12, fill: '#444' }}>
            <tspan style={{ fontWeight: 500 }}>Falls hydro</tspan> {fmt(r.dispatch.hydro ?? 0)} MW
          </text>
          <text x={22} y={312} style={{ fontSize: 12, fill: '#444' }}>
            <tspan style={{ fontWeight: 500 }}>Harbor Point</tspan> {fmt(r.dispatch.nuc ?? 0)} MW
          </text>
          <text x={190} y={350} textAnchor="end" style={{ fontSize: 12, fill: '#444' }}>
            <tspan style={{ fontWeight: 500 }}>Ironwood</tspan> {fmt(r.dispatch.coal ?? 0)} MW
          </text>
          <text x={340} y={160} style={{ fontSize: 12, fill: '#444' }}>
            <tspan style={{ fontWeight: 500 }}>Lakeside</tspan> {fmt(r.dispatch.cc1 ?? 0)} MW
          </text>
        </NetworkView>
        <Readouts
          items={[
            { label: 'wind curtailed', value: mw(curtailed), tone: curtailed > 0.5 ? 'blue' : undefined },
            { label: 'lowest price', value: usd(lo, 2), tone: 'green' },
            { label: 'highest price', value: usd(hi, 2), tone: 'green' },
          ]}
        />
        <Slider label="Ridge wind output" tone="teal" value={n.state.wind} min={0} max={350} step={5} onChange={(v) => n.set({ wind: v })} display={mw(n.state.wind)} />
        <Slider label="Demand" value={n.state.demand} min={600} max={1100} step={10} onChange={(v) => n.set({ demand: v })} display={mw(n.state.demand)} />
        <Slider
          label="Ridge wind’s offer"
          tone="green"
          value={n.state.offer}
          min={-40}
          max={0}
          step={1}
          onChange={(v) => n.set({ offer: v })}
          display={`${usd(n.state.offer)} per MWh`}
        />
        <Checkbox label="Must-run floors: Harbor Point at least 360 MW, Ironwood at least 120 MW" checked={n.state.floors} onChange={(v) => n.set({ floors: v })} />
      </Figure>

      <P>
        At first, the price is set by Falls hydro at {usd(night.calm.lmp.city ?? 0)}: the dam holds back water whenever there’s cheaper power around. As the wind rises, hydro backs off until it’s
        producing nothing, then Harbor Point turns down toward its floor, and the price falls to its $9 offer. Push the wind further and the floors plus the wind exceed demand: with all 350 MW
        blowing, the price is {usd(night.windy.lmp.city ?? 0)}. Something has to give, and the cheapest thing to give up is wind. The operator curtails it, and the price becomes the wind farm’s own offer: one more megawatt of demand would let it curtail one megawatt less, and
        the wind farm is willing to pay $25 for that. Untick the floors and Ironwood can shut down altogether, leaving room for every megawatt of wind; the price is
        back to {usd(night.loose.lmp.city ?? 0)}.
      </P>

      <Challenge
        id="a"
        question="In the second demonstration, produce a negative price at one substation while another has a positive price."
        solved={mixed}
        status={
          r.feasible
            ? `Prices run from ${usd(lo, 2)} to ${usd(hi, 2)} per megawatt-hour.${n.state.out ? '' : ' Every line is in service.'}`
            : 'There’s no feasible dispatch with these settings.'
        }
        success={`Solved. ${REGION.nodes
          .filter((x) => (r.lmp[x.id] ?? 0) < 0)
          .map((x) => x.name)
          .join(' and ')} ${REGION.nodes.filter((x) => (r.lmp[x.id] ?? 0) < 0).length > 1 ? 'are' : 'is'} trapped behind a full line: the wind there can’t get out, so it’s curtailed and sets a negative price, while the rest of the grid pays a positive one.`}
      />

      <P>
        With every line in service, the region’s network can carry Ridge wind anywhere, so the price is negative everywhere or nowhere. To separate them you need
        congestion: take out a line that wind has to use, and keep demand high enough that the rest of the grid still wants power. Then North’s price is set by
        curtailed wind while everyone else’s is set by a plant that’s burning fuel. In real markets, this is common at the far ends of wind-heavy regions such as West
        Texas, where nodal prices fall below zero on windy nights while prices in the cities stay positive.
      </P>
      <P>
        Negative prices are a signal too. They tell inflexible plants that flexibility would pay, batteries and pumped storage to charge, flexible customers to shift
        their use into those hours, and subsidized generators exactly when to stop. Where they show up persistently in one place, they point to where a new line or a
        battery would be most valuable. Markets put floors under them as well, such as −€500 per megawatt-hour in Europe’s day-ahead auctions and −A$1,000 in
        Australia’s National Electricity Market.
      </P>
      <P>
        Both extremes are what happens when the operator runs out of options: no spare capacity in one case, no flexibility in the other. The{' '}
        <a href={lessonHref('5.6')}>last lesson of this chapter</a> is about the option operators protect most carefully of all — keeping the grid within its limits
        even after a line suddenly fails.
      </P>
    </LessonPage>
  );
}
