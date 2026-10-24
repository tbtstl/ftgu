import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  FUEL,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Slider,
  TEXT,
  lessonHref,
  linePath,
  mw,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { STANDARD_FLEET, fleetById } from '../../model/fleet';
import { standardHistory } from '../../model/history';
import { coOptimize, capacityDemandPrice } from '../../engines/market/ancillary';
import { LARGEST_UNIT, PEAK_HOUR, fleetCapacityAt, missingMoneyPerDay, regionCapacityAuction, serviceUnits } from '../../engines/market/gridServices';

const HISTORY = standardHistory();
const EASTGATE = fleetById('ct');
const NEW_MW = 250 * EASTGATE.availability;
const UNITS = serviceUnits(PEAK_HOUR).filter((u) => u.capacity > 0.5);
const TOTAL = fleetCapacityAt(PEAK_HOUR);
const NAME: Record<string, string> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, g.name]));
const COLOR: Record<string, string> = { ...Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, FUEL[g.fuel]])), new: FUEL.gasCT };
const RESERVE = GRAPHIC.teal;
const REGULATION = GRAPHIC.violet;
const STEP = 10;

function solve(demand: number, reserve: number, regulation: number, shortage: number) {
  return coOptimize(UNITS, demand, reserve, regulation, shortage);
}

export default function Lesson() {
  const s1 = useScenario('services', { demand: 1440, reserve: 200, regulation: 20, shortage: 1000 });
  const s2 = useScenario('capacity', { offer: 100 });
  const { demand, reserve, regulation, shortage } = s1.state;
  const r = solve(demand, reserve, regulation, shortage);
  const next = solve(demand + STEP, reserve, regulation, shortage);
  const ok = r.feasible;
  const short = ok ? r.reserveShort + r.regulationShort : 0;
  const solved1 = ok && reserve >= LARGEST_UNIT.capacity && short < 0.01 && next.feasible && next.reserveShort + next.regulationShort > 0.01;
  const p = (v: number) => (ok && Number.isFinite(v) ? usd(v, 2) : '—');

  let msg: string;
  if (!ok) msg = 'Demand exceeds everything the fleet can produce.';
  else if (short > 0.01) msg = `The fleet can’t cover the requirements: it is ${mw(short, 1)} short. Every missing megawatt is priced at the $${shortage.toLocaleString('en-US')} shortage price, and that price flows into the energy price too.`;
  else if (r.reservePrice > 1.5) msg = `To hold ${mw(reserve)} in reserve, the operator keeps cheaper plants below full output and runs dearer ones for energy instead. The reserve price, ${p(r.reservePrice)}, is what the last megawatt of reserve costs in energy given up.`;
  else msg = reserve > 0 ? 'Spare capacity is plentiful: plants the energy market doesn’t need hold the reserve at their $1 offer.' : 'No reserve is required, so every plant is free to produce energy.';

  // Allocation chart geometry.
  const rowH = 30;
  const top = 26;
  const bx = scale(0, 400, 190, 590);
  const height = top + UNITS.length * rowH + 22;

  // Capacity auction.
  const netCone = useMemo(() => missingMoneyPerDay(EASTGATE, HISTORY), []);
  const { offer } = s2.state;
  const auc = regionCapacityAuction(NEW_MW, offer, netCone);
  const aucNext = regionCapacityAuction(NEW_MW, offer + 1, netCone);
  const yours = auc.awarded.new ?? 0;
  const solved2 = yours >= NEW_MW - 1e-6 && (aucNext.awarded.new ?? 0) < NEW_MW - 1e-6;
  const cx = scale(0, 2300, 60, 610);
  const cy = scale(0, 130, 220, 30);
  const sorted = [...auc.offers].sort((a, b) => a.price - b.price);
  let cum = 0;
  const steps = sorted.map((o) => {
    const s = { ...o, start: cum };
    cum += o.mw;
    return s;
  });
  const curvePts: Array<[number, number]> = [];
  for (let m = 0; m <= 2300; m += 10) curvePts.push([m, capacityDemandPrice(auc.curve, m)]);
  const curve = linePath(
    curvePts.map((c) => cx(c[0])),
    curvePts.map((c) => cy(Math.min(130, c[1]))),
  );

  return (
    <LessonPage id="4.6">
      <P>
        Every market in this chapter has traded the same product: energy, in megawatt-hours, priced in dollars per megawatt-hour ($/MWh) produced. But the grid needs
        more than energy. When a plant trips, frequency falls within seconds. As we saw in <a href={lessonHref('3.2')}>Lesson 3.2</a>, what catches it in those first
        seconds is the inertia of the spinning machines, which slows the fall, and their governors, which open up automatically. Over the following minutes the operator
        has to replace the lost plant outright, as you did in the control room of <a href={lessonHref('3.6')}>Lesson 3.6</a>, so the governors can back off and be
        ready for the next trip. Both steps need plants running below their full output, or ready to start, with capacity held in hand. A grid that schedules every
        megawatt for energy has none of that cushion.
      </P>
      <P>
        Markets treat that cushion as products of their own, called <b>ancillary services</b>: services that keep the grid stable, sold alongside the energy itself.
        The two that matter most are <b>regulation</b>, capacity a plant moves up and down every few seconds on the automatic generation control (AGC) signal you
        watched in <a href={lessonHref('3.6')}>Lesson 3.6</a>, to follow the small, constant wobbles between supply and demand, and <b>operating reserve</b>, capacity held back to replace a plant that
        fails over the following minutes — the spare room the control room’s reserve readout tracked. Our model counts as reserve whatever a plant can add within 30
        minutes of a call, given its ramp rate, the speed at which it can raise its output; Eastgate, for instance, can deliver 100 MW. Operators usually set the{' '}
        <b>reserve requirement</b>, the reserve that must be held at all times, to cover the largest single thing that could go wrong — for our region, losing all{' '}
        {LARGEST_UNIT.capacity} MW of Harbor Point nuclear at once.
      </P>
      <P>
        Holding capacity back isn’t free, even if it costs the plant nothing directly. A megawatt Lakeside keeps in reserve is a megawatt it isn’t selling as energy, so
        someone more expensive has to produce it instead. Modern markets therefore clear energy and reserves together in one optimization, called{' '}
        <b>co-optimization</b>, and price each by what one more megawatt of it costs the system. Energy is still priced per MWh. Reserve and regulation are priced
        per <b>MW-hour</b>: a payment for each megawatt held back for an hour, whether or not it’s called on. Here is the evening peak on the reference day. Each bar is
        a plant’s capacity, divided between energy, regulation and reserve; the last slider is a price the operator puts on falling short, which we’ll come to. Raise
        the reserve requirement until it covers Harbor Point:
      </P>

      <Figure name="Grid Services Auction" scenario={s1}>
        <Legend
          items={[
            { label: 'Energy (plant’s color)', color: '#b9b9b9' },
            { label: 'Regulation', color: REGULATION },
            { label: 'Reserve', color: RESERVE },
            { label: 'Unused', color: '#e6e6e6' },
          ]}
        />
        <svg
          className="diagram"
          viewBox={`0 0 620 ${height}`}
          role="img"
          aria-label={`Each plant’s capacity at ${demand} MW of demand with ${reserve} MW of reserve and ${regulation} MW of regulation required. Energy ${p(r.energyPrice)}, reserve ${p(r.reservePrice)}, regulation ${p(r.regulationPrice)} per MW.`}
        >
          {[0, 100, 200, 300, 400].map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'base' : 'gl'} x1={bx(t)} x2={bx(t)} y1={top - 6} y2={top + UNITS.length * rowH} />
              <text className="ax ax-m" x={bx(t)} y={top - 10}>
                {t === 400 ? '400 MW' : t}
              </text>
            </g>
          ))}
          {UNITS.map((u, i) => {
            const e = ok ? (r.energy[u.id] ?? 0) : 0;
            const g = ok ? (r.regulation[u.id] ?? 0) : 0;
            const rs = ok ? (r.reserve[u.id] ?? 0) : 0;
            const y0 = top + i * rowH + 5;
            const hgt = rowH - 10;
            const seg = (from: number, amount: number, fill: string, ink: string) => {
              const w = bx(from + amount) - bx(from);
              return (
                <g>
                  <rect x={bx(from)} y={y0} width={Math.max(0, w)} height={hgt} fill={fill} />
                  {w >= 26 && (
                    <text x={bx(from) + w / 2} y={y0 + hgt / 2 + 4} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: ink }}>
                      {Math.round(amount)}
                    </text>
                  )}
                </g>
              );
            };
            return (
              <g key={u.id}>
                <text x={182} y={y0 + hgt / 2 + 4} textAnchor="end" style={{ fontSize: 13, fill: '#333' }}>
                  {NAME[u.id]}
                </text>
                <rect x={bx(0)} y={y0} width={bx(u.capacity) - bx(0)} height={hgt} fill="#e6e6e6" />
                {seg(0, e, COLOR[u.id], '#222')}
                {seg(e, g, REGULATION, '#fff')}
                {seg(e + g, rs, RESERVE, '#fff')}
              </g>
            );
          })}
          <text className="ax" x={190} y={height - 4}>
            {`Fleet capacity at ${PEAK_HOUR}:00 · ${mw(TOTAL)} (Ridge wind at what the weather allows)`}
          </text>
        </svg>
        <Slider label="Demand for energy" tone="red" value={demand} min={900} max={1900} step={STEP} onChange={(v) => s1.set({ demand: v })} display={mw(demand)} />
        <Slider label="Reserve requirement" tone="teal" value={reserve} min={0} max={500} step={10} onChange={(v) => s1.set({ reserve: v })} display={mw(reserve)} />
        <Slider label="Regulation requirement" tone="violet" value={regulation} min={0} max={50} step={5} onChange={(v) => s1.set({ regulation: v })} display={mw(regulation)} />
        <Slider
          label="Price of a shortfall"
          tone="green"
          value={shortage}
          min={250}
          max={5000}
          step={250}
          onChange={(v) => s1.set({ shortage: v })}
          display={`$${shortage.toLocaleString('en-US')} per MW short`}
        />
        <Readouts
          items={[
            { label: 'energy price per MWh', value: p(r.energyPrice), tone: 'green' },
            { label: 'reserve price per MW-hour', value: p(r.reservePrice), tone: 'green' },
            { label: 'regulation price per MW-hour', value: p(r.regulationPrice), tone: 'green' },
          ]}
        />
        <Caption>{msg}</Caption>
      </Figure>

      <P>
        With 200 MW of reserve required, the operator barely notices. Eastgate and Old Quay aren’t needed for energy at this hour anyway, so they hold most of the reserve
        at their offer of $1 per MW-hour, and the energy price stays at Mill Creek’s $42 per MWh. Raise the requirement to {LARGEST_UNIT.capacity} MW and the picture
        changes. The idle peakers can’t cover it alone, so Falls hydro, Lakeside and the others must each hold some capacity back, and Eastgate has to start producing
        energy to replace it. The energy price jumps to $88 per MWh, and the reserve price to $69 per MW-hour. Lakeside and Mill Creek would give up less by holding
        back more, but like every plant except Falls hydro they’re already holding back all they can ramp up within 30 minutes, so the last megawatt of reserve comes
        from Falls hydro. Its price is the $88 the system now pays for the replacement energy, less the $20 Falls hydro would have charged to produce it, plus its $1
        offer. That’s the <K c="price">opportunity cost</K> of the last megawatt of reserve, the value of the energy given up to hold it, and every plant holding
        reserve is paid it.
      </P>
      <P>
        Regulation is priced the same way, but fewer plants can provide it: only running plants that can follow the AGC signal second by second — here Ironwood, the
        two combined-cycle plants and Falls hydro, with about 49 MW between them. At the starting settings, 1,440 MW of demand and 200 MW of reserve, the 20 MW of
        regulation required costs $11 per MW-hour, against reserve’s $1. Drag the regulation requirement to 50 MW, and the region falls short at any demand, however
        much else stands idle; then set it back to 20.
      </P>
      <P>
        Now push demand higher. Past a certain point the fleet simply can’t produce the energy and also hold the reserve, and the operator runs short. It doesn’t
        stop dispatching: it accepts the shortfall but prices every missing megawatt at a high <b>shortage price</b>, set by rule rather than by any offer, and because the last megawatt of
        energy now comes out of reserve, the energy price rises above it too. With the region short, drag the price of a shortfall: the reserve price moves with it
        dollar for dollar, and the energy price stays just above it, since nothing but the rule is setting them now. This is <b>scarcity pricing</b>, and it’s where the extreme real-time prices in the last
        lesson came from. ERCOT, which runs most of Texas’s grid, adds a scarcity charge to its energy price that rises as reserves shrink, up to its{' '}
        <b>offer cap</b> — the highest price any seller may offer — of several thousand dollars per megawatt-hour.
      </P>

      <Challenge
        id="a"
        question={`Set the reserve requirement to cover the loss of Harbor Point nuclear. What’s the highest demand the region can then meet without running short? Work it out from the fleet’s capacity, at the foot of the chart, before you drag.`}
        solved={solved1}
        status={
          reserve < LARGEST_UNIT.capacity
            ? `A ${mw(reserve)} requirement wouldn’t cover the loss of Harbor Point’s ${mw(LARGEST_UNIT.capacity)}.`
            : short > 0.01
              ? `At ${mw(demand)}, the region is ${mw(short, 1)} short.`
              : `At ${mw(demand)}, the region still has enough. Can it meet more?`
        }
        success={`Solved. Holding ${mw(reserve)} of reserve and ${mw(regulation)} of regulation, the fleet’s ${mw(TOTAL)} leaves room for at most ${mw(demand)} of energy. ${
          ok && r.reservePrice >= shortage - 1e-6
            ? `Nothing is short yet, but the next megawatt of anything would be — which is why the reserve price already sits at the $${shortage.toLocaleString('en-US')} shortage price.`
            : `Ten more and the region runs short, and the prices jump to the $${shortage.toLocaleString('en-US')} shortage price.`
        }`}
      />

      <H2>The missing money</H2>
      <P>
        Scarcity prices are rare, but they matter enormously to the plants that run in them. Take Eastgate. In the 120 days of history, producing whenever the
        real-time price exceeded its running cost, it would have run for 66 hours and earned $17,562 per megawatt above its running costs — three quarters of it on the two
        days Mill Creek broke down. Its fixed costs over the same 120 days come to $26,301 per megawatt. The energy market leaves a gap of $8,740 per megawatt, or $72.83
        per megawatt per day.
      </P>
      <P>
        That gap is known as the <b>missing money</b> problem. A plant that exists to run only in the tightest hours depends on scarcity prices high enough, and frequent
        enough, to pay for it. Regulators often cap prices below what a real shortage is worth, and investors find revenue that arrives in a few unpredictable hours
        hard to borrow against. The result can be too little capacity built.
      </P>
      <P>
        There are two broad answers. An <b>energy-only</b> market, like ERCOT’s, lets scarcity prices rise high enough to close the gap and leaves investors to bear the
        risk. A <b>capacity market</b>, like the one PJM runs for much of the eastern United States, pays plants separately for being available, through an auction held
        well before the year in question. Its prices are in dollars per <b>MW-day</b>: a payment for each megawatt a plant commits to have available, for each day of
        that year. The operator sets a target — here 2,000 MW, about 15% above the highest peak forecast in our history — and a sloped demand
        curve: it pays a capped price when capacity falls well short of the target, less as capacity approaches and passes it, and nothing once there’s 10% to
        spare. Each plant offers the
        capacity it can be counted on for at the peak, at the price it needs to stay available beyond what it expects to earn from energy. The existing plants, long since
        built, need little, and their offers in the next demonstration are illustrative; your new peaker, a 250 MW plant with Eastgate’s costs, counts as 230 MW because it’s available 92% of the time, and needs $72.83:
      </P>

      <Figure name="Grid Services Auction · capacity" scenario={s2}>
        <svg
          className="chart"
          viewBox="0 0 620 262"
          role="img"
          aria-label={`Capacity auction: ${mw(auc.cleared, 1)} clears at $${auc.price.toFixed(2)} per MW-day. Your plant offers $${offer} and clears ${mw(yours, 1)} of ${mw(NEW_MW, 0)}.`}
        >
          <text className="ax" x={60} y={16}>
            $ per MW-day
          </text>
          <GridY y={cy} ticks={[0, 25, 50, 75, 100, 125]} x0={60} x1={610} format={(v) => '$' + v} baseline={0} />
          {steps.map((s) => {
            const awarded = auc.awarded[s.id] ?? 0;
            const h = Math.max(2, cy(0) - cy(Math.min(130, s.price)));
            return (
              <g key={s.id}>
                <rect x={cx(s.start)} y={cy(0) - h} width={cx(s.start + s.mw) - cx(s.start)} height={h} fill={COLOR[s.id]} opacity={0.3} style={{ transition: 'x .45s ease' }} />
                <rect x={cx(s.start)} y={cy(0) - h} width={cx(s.start + awarded) - cx(s.start)} height={h} fill={COLOR[s.id]} style={{ transition: 'x .45s ease' }} />
                {s.id === 'new' && (
                  <>
                    <rect x={cx(s.start)} y={cy(0) - h} width={cx(s.start + s.mw) - cx(s.start)} height={h} fill="none" stroke="#222" strokeWidth={2} />
                    <text x={(cx(s.start) + cx(s.start + s.mw)) / 2} y={cy(0) - h - 6} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: '#222' }}>
                      You
                    </text>
                  </>
                )}
              </g>
            );
          })}
          <line x1={cx(auc.curve.target)} x2={cx(auc.curve.target)} y1={30} y2={220} stroke="#333" strokeDasharray="4 4" />
          <text className="ax" x={cx(auc.curve.target) + 6} y={42}>
            target
          </text>
          <path d={curve} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
          <line x1={60} x2={cx(auc.cleared)} y1={cy(auc.price)} y2={cy(auc.price)} stroke={TEXT.green} strokeWidth={2} />
          <circle cx={cx(auc.cleared)} cy={cy(auc.price)} r={6} fill={TEXT.green} stroke="#fcfcfb" strokeWidth={2} />
          <text x={66} y={cy(auc.price) + 17} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.green }}>
            ${auc.price.toFixed(2)}
          </text>
          {[0, 500, 1000, 1500, 2000].map((t) => (
            <text key={t} className="ax ax-m" x={cx(t)} y={240}>
              {t === 2000 ? '2,000 MW' : t.toLocaleString('en-US')}
            </text>
          ))}
        </svg>
        <Legend
          items={[
            { label: 'Offers, cheapest first', color: '#b9b9b9' },
            { label: 'Demand curve', color: '#333', kind: 'line' },
            { label: 'Capacity price', color: TEXT.green, kind: 'line' },
          ]}
        />
        <Slider label="Your offer" tone="green" value={offer} min={0} max={150} onChange={(v) => s2.set({ offer: v })} display={`$${offer} per MW-day`} />
        <Readouts
          items={[
            { label: 'your plant clears', value: `${mw(yours, 0)} of ${mw(NEW_MW, 0)}` },
            { label: 'your capacity payments per year', value: usd(yours * auc.price * 365), tone: 'green' },
          ]}
        />
        <Caption>
          {yours <= 0
            ? `At $${offer}, your offer is above anything the demand curve will pay for the last megawatts, so your plant isn’t bought.`
            : yours < NEW_MW - 1e-6
              ? `Your offer is high enough that the curve only buys part of your plant before its price falls to $${offer}.`
              : `All of your plant clears, and like every plant in the auction it’s paid the clearing price, $${auc.price.toFixed(2)} per MW-day — ${auc.price >= netCone ? 'enough' : 'not enough'} to cover the $${netCone.toFixed(2)} it needs.`}
        </Caption>
      </Figure>

      <Challenge
        id="b"
        question="Find the highest whole-dollar offer at which all of your new plant still clears."
        solved={solved2}
        status={`At $${offer}, ${mw(yours, 0)} of your ${mw(NEW_MW, 0)} clears.`}
        success={`Solved. With your plant, the region holds ${mw(auc.cleared, 1)}, where the demand curve pays $${auc.price.toFixed(2)} per MW-day. Any offer up to that clears in full and is paid $${auc.price.toFixed(2)} — the curve sets the price, not your offer. That’s more than the $${netCone.toFixed(2)} your plant needs, so it gets built.`}
      />

      <P>
        Like the energy auction in <a href={lessonHref('4.4')}>Lesson 4.4</a>, the capacity auction pays one price to everyone it accepts, so the best offer is still the
        true need: offer too high and the curve buys someone else. And like reserves, capacity is paid for being there rather than for producing. Between them, energy,
        ancillary services and capacity cover most of what a power plant sells. Power plants aren’t the only sellers, though. As{' '}
        <a href={lessonHref('3.5')}>Lesson 3.5</a> promised, many markets let demand response — customers paid to cut their use when the grid is short — provide
        reserves and capacity alongside the plants; our model leaves it out.
      </P>
      <P>
        This chapter has treated the region as a single point, where a megawatt-hour from Ironwood serves Metro as well as one from Mill Creek. The transmission lines from Chapter 2 don’t always allow that. In <a href={lessonHref('5.1')}>Chapter 5</a> we put the network back, and prices start to depend on
        where you are.
      </P>
    </LessonPage>
  );
}
