import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  Figure,
  FUEL,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TimeChart,
  fmt,
  hour,
  mw,
  mwh,
  pct,
  tint,
  usd,
  useScenario,
  type Scenario,
} from '../../framework';
import {
  EV_FLEET,
  FLEX_BLOCKS,
  baseLoad,
  blockCost,
  clampStart,
  evLoad,
  flatten,
  referencePrices,
  systemLoad,
  usualStarts,
  type ChargePolicy,
  type FlexBlock,
  type Starts,
} from '../../engines/ops/loadShift';
import { SYSTEM_DEMAND } from '../../model/profiles';

const BASE = baseLoad();
const BASE_PEAK = Math.max(...BASE);
const PRICES = referencePrices().prices;
const USUAL = usualStarts();
const USUAL_LOAD = systemLoad(BASE, FLEX_BLOCKS, USUAL);
const BEST = flatten(BASE, FLEX_BLOCKS, PRICES);
const BEST_LOAD = systemLoad(BASE, FLEX_BLOCKS, BEST);
const BASE_COLOR = '#d4d4d4';
const COLORS: Record<string, string> = { ev: FUEL.demandResponse, water: GRAPHIC.blue, batch: FUEL.coal, cool: GRAPHIC.teal };
const cost = (st: Starts) => FLEX_BLOCKS.reduce((s, b) => s + blockCost(b, clampStart(b, st[b.id]), PRICES), 0);
const USUAL_COST = cost(USUAL);
const BEST_COST = cost(BEST);
const TOTAL_MWH = FLEX_BLOCKS.reduce((s, b) => s + b.mw * b.hours, 0);
const X0 = 52;
const X1 = 628;
const SLOT = (X1 - X0) / 24;
const ROW = 46;

/** Hour ranges [from, to) within one day for a span that may cross midnight. */
function spans(from: number, len: number): Array<[number, number]> {
  const a = ((from % 24) + 24) % 24;
  if (a + len <= 24) return [[a, a + len]];
  return [
    [a, 24],
    [0, a + len - 24],
  ];
}

function Lanes({ starts, onMove }: { starts: Starts; onMove: (id: string, start: number) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ b: FlexBlock; offset: number } | null>(null);
  const hourAt = (e: PointerEvent<SVGElement>) => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return null;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return (pt.matrixTransform(ctm.inverse()).x - X0) / SLOT;
  };
  const place = (b: FlexBlock, desired: number) => {
    const cands = [desired, desired + 24, desired - 24];
    const lo = b.earliest;
    const hi = b.latest - b.hours;
    const best = cands.reduce((x, c) => {
      const d = (v: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);
      return d(c) < d(x) ? c : x;
    }, cands[0]);
    return clampStart(b, best);
  };
  const key = (b: FlexBlock) => (e: KeyboardEvent) => {
    const s = starts[b.id];
    let n = s;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') n = s - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') n = s + 1;
    else if (e.key === 'Home') n = b.earliest;
    else if (e.key === 'End') n = b.latest - b.hours;
    else return;
    e.preventDefault();
    onMove(b.id, clampStart(b, n));
  };
  return (
    <svg
      ref={svg}
      className="diagram"
      viewBox={`0 0 640 ${FLEX_BLOCKS.length * ROW + 22}`}
      role="group"
      aria-label="Flexible loads. Drag each block within its shaded window, or focus it and use the arrow keys."
      style={{ touchAction: 'none', userSelect: 'none' }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.buttons === 0) return;
        const p = hourAt(e);
        if (p === null) return;
        const n = place(d.b, Math.round(p - d.offset));
        if (n !== starts[d.b.id]) onMove(d.b.id, n);
      }}
      onPointerUp={() => (drag.current = null)}
    >
      {FLEX_BLOCKS.map((b, i) => {
        const y = i * ROW;
        const s = starts[b.id];
        const col = COLORS[b.id];
        return (
          <g key={b.id}>
            <text className="lab" x={X0} y={y + 12}>
              {b.name}
              <tspan className="ax" dx={8}>
                {b.sector} · {b.mw} MW for {b.hours} h · {hour(b.earliest)}–{hour(b.latest)}
              </tspan>
            </text>
            {spans(b.earliest, b.latest - b.earliest).map(([a, z], k) => (
              <rect key={k} x={X0 + a * SLOT} y={y + 18} width={(z - a) * SLOT} height={22} fill={tint(col, 0.22)} />
            ))}
            <g
              tabIndex={0}
              role="slider"
              aria-label={`${b.name}: starts at ${hour(s)}`}
              aria-valuemin={b.earliest}
              aria-valuemax={b.latest - b.hours}
              aria-valuenow={s}
              aria-valuetext={`${hour(s)} to ${hour(s + b.hours)}`}
              onKeyDown={key(b)}
              onPointerDown={(e) => {
                const p = hourAt(e);
                if (p === null) return;
                e.currentTarget.ownerSVGElement?.setPointerCapture?.(e.pointerId);
                const pos = ((s % 24) + 24) % 24;
                let off = p - pos;
                if (off < 0) off += 24;
                drag.current = { b, offset: off };
              }}
              style={{ cursor: 'grab' }}
            >
              {spans(s, b.hours).map(([a, z], k) => (
                <rect key={k} x={X0 + a * SLOT + 1} y={y + 18} width={(z - a) * SLOT - 2} height={22} rx={4} fill={col} />
              ))}
              <text x={X0 + (((s % 24) + 24) % 24) * SLOT + 6} y={y + 33} style={{ fontSize: 12, fontWeight: 500, fill: '#fff', pointerEvents: 'none' }}>
                {hour(s)}
              </text>
            </g>
          </g>
        );
      })}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} className="ax ax-m" x={X0 + h * SLOT} y={FLEX_BLOCKS.length * ROW + 16}>
          {hour(h)}
        </text>
      ))}
    </svg>
  );
}

function ShiftFigure({ starts, onMove, scenario }: { starts: Starts; onMove: (id: string, s: number) => void; scenario: Scenario<Starts> }) {
  const [compare, setCompare] = useState(false);
  const load = systemLoad(BASE, FLEX_BLOCKS, starts);
  const peak = Math.max(...load);
  const peakAt = load.indexOf(peak);
  const bill = cost(starts);
  const stack = [{ values: BASE, color: BASE_COLOR }, ...FLEX_BLOCKS.map((b) => ({ values: systemLoad(Array(24).fill(0), [b], starts), color: COLORS[b.id] }))];
  return (
    <Figure name="Load Shifting Lab" scenario={scenario}>
      <TimeChart
        ariaLabel={`System load with the flexible loads placed as shown below. Peak ${Math.round(peak)} MW at ${hour(peakAt)}.`}
        stack={stack}
        series={[
          { values: USUAL_LOAD, color: '#333', width: 1.5, dash: '6 5' },
          ...(compare ? [{ values: BEST_LOAD, color: GRAPHIC.green, width: 2.5, dash: '2 3' }] : []),
        ]}
        refLines={[{ y: peak, color: '#333', dash: '2 4', label: `peak ${mw(peak)}` }]}
        yMin={0}
        yMax={1600}
        yLabel="System load, MW"
        yFormat={(v) => fmt(v)}
        height={250}
        cursor={peakAt}
      />
      <Legend
        items={[
          { label: 'Inflexible load', color: BASE_COLOR },
          ...FLEX_BLOCKS.map((b) => ({ label: b.name, color: COLORS[b.id] })),
          { label: 'At their usual times', color: '#333', kind: 'line' as const, dashed: true },
          ...(compare ? [{ label: 'Best placement', color: GRAPHIC.green, kind: 'line' as const, dashed: true }] : []),
        ]}
      />
      <Lanes starts={starts} onMove={onMove} />
      <TimeChart
        ariaLabel="Hourly day-ahead prices on the reference day."
        series={[{ values: PRICES, color: GRAPHIC.green, kind: 'step', width: 2.5 }]}
        yMin={0}
        yMax={50}
        yLabel="Price, $ per MWh"
        yFormat={(v) => '$' + v}
        height={120}
        cursor={peakAt}
      />
      <Readouts
        items={[
          { label: `system peak, at ${hour(peakAt)}`, value: mw(peak) },
          { label: 'energy of the flexible loads', value: mwh(TOTAL_MWH), tone: 'gold' },
          { label: 'what it costs at hourly prices', value: usd(bill), tone: 'green' },
          { label: 'saved against the usual times', value: usd(USUAL_COST - bill), tone: 'green' },
        ]}
      />
      <div className="ctl">
        <Checkbox label="Compare with the best placement" checked={compare} onChange={setCompare} />
      </div>
      <Caption>
        {compare
          ? `The best placement holds the peak to ${mw(Math.max(...BEST_LOAD))} and costs ${usd(BEST_COST)}.`
          : peak > BASE_PEAK + 0.5
            ? `${FLEX_BLOCKS.filter((b) => systemLoad(Array(24).fill(0), [b], starts)[peakAt] > 0)
                .map((b) => b.name)
                .join(' and ')} ${FLEX_BLOCKS.filter((b) => systemLoad(Array(24).fill(0), [b], starts)[peakAt] > 0).length > 1 ? 'are' : 'is'} running in the peak hour.`
            : `No flexible load is left in the peak: what remains is the inflexible load’s own peak, ${mw(BASE_PEAK)} at ${hour(BASE.indexOf(BASE_PEAK))}.`}
      </Caption>
    </Figure>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: a fleet of electric cars and three ways to charge it.

const POLICIES: Array<{ value: ChargePolicy; label: string }> = [
  { value: 'arrival', label: 'On arrival' },
  { value: 'timer', label: `Timer at ${hour(EV_FLEET.timerStart)}` },
  { value: 'smart', label: 'Smart' },
];
const EV_COLOR = FUEL.demandResponse;
const REF_PEAK = Math.max(...SYSTEM_DEMAND);
const REBOUND_CARS = ((REF_PEAK - SYSTEM_DEMAND[EV_FLEET.timerStart]) / EV_FLEET.chargerKW) * 1000;

function EvFigure() {
  const sc = useScenario('ev', { cars: 40, policy: 'arrival' as ChargePolicy });
  const { cars, policy } = sc.state;
  const fleet = { ...EV_FLEET, cars: cars * 1000 };
  const ev = evLoad(fleet, policy);
  const total = SYSTEM_DEMAND.map((d, h) => d + ev[h]);
  const peak = Math.max(...total);
  const peakAt = total.indexOf(peak);
  const evPeak = Math.max(...ev);
  return (
    <Figure name="Load Shifting Lab · charging a fleet" scenario={sc}>
      <Segmented label="Charging policy" value={policy} onChange={(v) => sc.set({ policy: v })} options={POLICIES} />
      <TimeChart
        ariaLabel={`Reference demand plus ${cars} thousand electric cars charging ${policy === 'arrival' ? 'on arrival' : policy === 'timer' ? 'on a timer' : 'smartly'}. Peak ${Math.round(peak)} MW at ${hour(peakAt)}.`}
        stack={[
          { values: SYSTEM_DEMAND, color: BASE_COLOR },
          { values: ev, color: EV_COLOR },
        ]}
        refLines={[{ y: REF_PEAK, color: '#333', dash: '6 4', label: `peak without the cars, ${mw(REF_PEAK)}` }]}
        yMin={0}
        yMax={2000}
        yLabel="Demand, MW"
        yFormat={(v) => fmt(v)}
        height={240}
        cursor={peakAt}
      />
      <Legend
        items={[
          { label: 'Reference demand', color: BASE_COLOR },
          { label: 'Electric cars charging', color: EV_COLOR },
        ]}
      />
      <Readouts
        items={[
          { label: 'charging energy each night', value: mwh((fleet.cars * fleet.kWhEach) / 1000), tone: 'gold' },
          { label: 'highest charging load', value: mw(evPeak) },
          { label: `system peak, at ${hour(peakAt)}`, value: mw(peak), tone: peak > REF_PEAK + 0.5 ? 'red' : undefined },
        ]}
      />
      <Slider label="Electric cars" value={cars} min={10} max={150} step={5} onChange={(v) => sc.set({ cars: v })} display={`${fmt(cars * 1000)}`} />
      <Caption>
        {peak > REF_PEAK + 0.5
          ? `The cars raise the system peak by ${mw(peak - REF_PEAK)}, to ${mw(peak)} at ${hour(peakAt)}.`
          : `The cars add ${mwh((fleet.cars * fleet.kWhEach) / 1000)} of demand without raising the peak.`}
      </Caption>
    </Figure>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const sc = useScenario<Starts>('blocks', { ...USUAL });
  const starts = sc.state;
  const load = systemLoad(BASE, FLEX_BLOCKS, starts);
  const peak = Math.max(...load);
  const solved = peak <= BASE_PEAK + 1e-6;
  const usualPeak = Math.max(...USUAL_LOAD);
  const arrival40 = evLoad(EV_FLEET, 'arrival');
  const timer40 = evLoad(EV_FLEET, 'timer');
  const smart40 = evLoad(EV_FLEET, 'smart');
  const evMWh = (EV_FLEET.cars * EV_FLEET.kWhEach) / 1000;
  const lowPrice = Math.min(...PRICES);
  const highPrice = Math.max(...PRICES);
  const saved = USUAL_COST - BEST_COST;

  return (
    <LessonPage id="3.5">
      <P>
        Every tool in this chapter so far has adjusted supply to match demand. Plants ramp up and down, batteries charge and discharge, and demand is treated as something that
        simply happens. But not all of it has to happen when it does. A car that’s plugged in at seven in the evening doesn’t need to charge until morning. A tank of hot water
        stays hot for hours. A factory can sometimes run a batch at night instead of in the afternoon.
      </P>
      <P>
        Moving demand from one hour to another is called <b>load shifting</b>, and it’s one form of <b>demand response</b> — demand that responds to the needs of the grid,
        usually because someone pays it to. Shifting doesn’t reduce how much <K c="energy">energy</K> anyone uses. It only changes when.
      </P>
      <P>
        In the next demonstration, the reference day’s demand is split in two. Most of it is inflexible: lighting, cooking, offices and the rest. Four loads are flexible, and each is shown as a block
        of fixed <K c="power">power</K> and duration — so a fixed energy — inside a shaded window of hours when it’s allowed to run. They start out at the times they usually run,
        and together they add {mw(usualPeak - BASE_PEAK)} to the peak. Drag them to new times:
      </P>

      <ShiftFigure starts={starts} onMove={(id, s) => sc.set({ [id]: s })} scenario={sc} />

      <P>
        The four loads use {mwh(TOTAL_MWH)} between them wherever you put them; the area of each block never changes, only its position. What changes is the shape of the system
        load, and in particular its peak. At their usual times, the electric cars and water heaters come on just as people get home, stacking on top of the evening peak. Moved
        into the night, they fill the trough instead.
      </P>
      <P>
        The windows are what makes each load more or less useful. The cars carry the most energy and can charge any time between the evening and the next morning, so they
        can go almost anywhere. Pre-cooling can only move earlier in the afternoon, because its whole point is to chill a building before the evening, so the cooling can
        coast through the peak. (In a real building some of that coolness leaks away, so pre-cooling uses a little more energy than it saves; our blocks keep the energy
        fixed.) And the batch process can run in any staffed shift but not in the small hours. A narrow window is the price a customer pays for flexibility, and it’s what the
        grid has to work around.
      </P>
      <P>
        The lower chart shows the <K c="price">day-ahead price</K> of each hour on a typical weekday in the region’s history: {usd(lowPrice)} per MWh overnight and around midday,
        when demand is low or solar is plentiful, and up to {usd(highPrice, 2)} in the evening. The price signal points the same way as the grid’s needs. Customers who move their
        flexible loads into cheap hours save money, and the hours they leave behind are the ones that would otherwise need the most expensive plants. The best placement, which you
        can overlay with the checkbox, holds the peak as low as the inflexible load allows and cuts the four loads’ energy bill by {usd(saved)}, or{' '}
        {pct(saved / USUAL_COST)}.
      </P>

      <Challenge
        id="a"
        question={`Move the flexible loads, within their windows, so the system peak is no higher than ${mw(BASE_PEAK)} — the peak of the inflexible load on its own.`}
        solved={solved}
        status={`The system peak is ${mw(peak)} at ${hour(load.indexOf(peak))}.`}
        success="Solved. Nothing flexible runs at 19:00 any more, and nothing you moved created a new peak somewhere else."
      />

      <P>
        Real demand response comes in several forms. Some customers are paid to cut load on request when the grid is short — a factory that idles a process, an office that raises
        its thermostat for an hour. Others face prices that vary by hour, or by time of day, and shift on their own. More and more of it is automatic: a water heater or a car
        charger that a utility or an aggregator can nudge without anyone noticing. And because a megawatt of demand that can be switched off when needed is worth almost as
        much to the grid as a megawatt of generation that can be switched on, many markets let demand response compete with power plants to provide reserves and capacity — a
        topic we’ll return to in Lesson 4.6.
      </P>

      <H2>When everyone shifts at once</H2>
      <P>
        A price signal works because people respond to it. That’s also its danger. Here are {fmt(EV_FLEET.cars)} electric cars, each needing {EV_FLEET.kWhEach} kWh a night —
        about 40 miles of driving — from a {EV_FLEET.chargerKW} kW home charger, on top of the reference day’s demand. Try the three charging policies:
      </P>

      <EvFigure />

      <P>
        Charged as soon as their owners get home, the cars add up to {mw(Math.max(...arrival40))} right at the evening peak. A time-of-use tariff that’s cheaper after{' '}
        {hour(EV_FLEET.timerStart)} fixes that, as long as the owners respond. But if they all set their chargers to start at exactly {hour(EV_FLEET.timerStart)}, every car
        switches on at once and draws full power together: a spike of {mw(Math.max(...timer40))} out of nowhere. With these {fmt(EV_FLEET.cars)} cars the spike still fits under
        the evening peak. Add more cars and it doesn’t: beyond about {fmt(Math.round(REBOUND_CARS / 1000) * 1000)}, the timer creates a new system peak at{' '}
        {hour(EV_FLEET.timerStart)}, worse than the one it was meant to avoid.
      </P>
      <P>
        Smart charging spreads the same {mwh(evMWh)} evenly across the night — {mw(Math.max(...smart40))} at a time — so the cars are full by morning and the grid barely notices.
        That takes coordination: a signal that tells each charger not just that power is cheap, but when its turn is. Coordinating thousands of small devices like this — cars,
        batteries, heat pumps — so that together they act like one controllable plant is the idea behind the virtual power plants of Chapter 7. Before that, the last lesson of
        this chapter steps into the control room, where all of these tools come together.
      </P>
    </LessonPage>
  );
}
