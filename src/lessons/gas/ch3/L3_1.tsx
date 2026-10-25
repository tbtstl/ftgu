import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
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
  TEXT,
  fmt,
  lessonHref,
  pct,
  useScenario,
} from '../../../framework';
import { COMPRESSION_COST_PER_HP, PIPE_COST_PER_INCH_MILE, PIPE_SIZES, bindingArcs, corridorDesign, solveFlow, type CorridorDesign, type FlowProblem } from '../../../engines/gas/network';
import { MMBTU_PER_MCF } from '../../../engines/gas/properties';
import { BASINS, CORRIDORS, GAS_NODE, GAS_NODES, PIPELINE, PRODUCTION_COST, REFERENCE_DAYS, STORAGE_SPECS, type GasNodeId } from '../../../model/gas/world';
import { GasMap } from '../shared/GasMap';
import { XYChart } from '../shared/XYChart';
import { money } from '../shared/format';

// ---------------------------------------------------------------------------
// The network the reader builds.

export type Day = 'summer' | 'winter' | 'design';

export interface BuildState {
  day: Day;
  /** Metro's new power plant, burning PLANT_BCFD on every reference day (the challenge). */
  plant: boolean;
  /** The corridor whose pipeline is being edited. */
  sel: string;
  /** Nominal pipe size by corridor, inches (0 = nothing built). */
  sizes: Record<string, number>;
  /** Compressor stations by corridor, 1–5. */
  stations: Record<string, number>;
}

/** The region's own six pipelines, and nothing in the two unbuilt corridors. */
export const REGION_SIZES: Record<string, number> = Object.fromEntries(CORRIDORS.map((c) => [c.id, PIPELINE[c.id]?.sizeIn ?? 0]));
export const REGION_STATIONS: Record<string, number> = Object.fromEntries(CORRIDORS.map((c) => [c.id, PIPELINE[c.id]?.stations ?? 1]));

export const BUILD_DEFAULTS: BuildState = { day: 'summer', plant: false, sel: 'calder-metro', sizes: REGION_SIZES, stations: REGION_STATIONS };

/** The new power plant at Metro in the challenge, Bcf/d. */
export const PLANT_BCFD = 0.2;
/** What a day's gas is worth to the people who burn it, $/MMBtu: high enough that the network always serves all it can. */
const DEMAND_VALUE = 50;
/** Storage withdrawals on cold days: each field's deliverability when full, offered above production cost so it's used only when needed. */
const SALT_FLAT_BCFD = STORAGE_SPECS.saltflat.maxWithdrawBcfd;
const HOLLOW_CREEK_BCFD = STORAGE_SPECS.hollowcreek.maxWithdrawBcfd;

const designCache = new Map<string, CorridorDesign>();
/** `corridorDesign`, remembered: a corridor's capacity, compression and cost for a size and station count. */
export function design(id: string, size: number, stations: number): CorridorDesign {
  const k = `${id}|${size}|${stations}`;
  let d = designCache.get(k);
  if (!d) {
    d = corridorDesign(id, size, stations);
    designCache.set(k, d);
  }
  return d;
}

/** The day's routing problem on the reader's network. */
export function buildProblem(st: BuildState): FlowProblem {
  const demand = { ...REFERENCE_DAYS[st.day].demand };
  if (st.plant) demand.metro += PLANT_BCFD;
  const cold = st.day !== 'summer';
  return {
    nodes: GAS_NODES.map((n) => n.id),
    arcs: CORRIDORS.filter((c) => st.sizes[c.id] > 0).map((c) => ({
      id: c.id,
      from: c.from,
      to: c.to,
      cap: design(c.id, st.sizes[c.id], st.stations[c.id]).capacityBcfd,
      cost: PIPELINE[c.id]?.variableCost ?? 0.15,
    })),
    supplies: [
      { id: 'ridgeback', node: 'ridgeback', cap: BASINS[0].productionBcfd, cost: PRODUCTION_COST.ridgeback ?? 1.2 },
      { id: 'sandhill', node: 'sandhill', cap: BASINS[1].productionBcfd, cost: PRODUCTION_COST.sandhill ?? 1.6 },
      ...(cold
        ? [
            { id: 'saltflat', node: 'calder', cap: SALT_FLAT_BCFD, cost: 4 },
            { id: 'hollowcreek', node: 'metro', cap: HOLLOW_CREEK_BCFD, cost: 4.5 },
          ]
        : []),
    ],
    demands: GAS_NODES.map((n) => ({ id: n.id, node: n.id, cap: demand[n.id], value: DEMAND_VALUE })),
  };
}

/** Capital cost of the reader's whole network, $. */
export function networkCost(st: BuildState): number {
  return CORRIDORS.reduce((s, c) => s + (st.sizes[c.id] > 0 ? design(c.id, st.sizes[c.id], st.stations[c.id]).cost : 0), 0);
}

/** True when no built line has been taken out, made smaller, or lost a station. */
export function onlyAdds(st: BuildState): boolean {
  return CORRIDORS.every((c) => {
    const o = REGION_SIZES[c.id];
    if (!o) return true;
    const n = st.sizes[c.id];
    return n > o || (n === o && st.stations[c.id] >= REGION_STATIONS[c.id]);
  });
}

/**
 * New capital spent on top of the region's network, $: added compression on a line kept at its size
 * costs only the extra horsepower; a line of a different size, or one in an empty corridor, is a new pipe.
 */
export function expansionCost(st: BuildState): number {
  let c = 0;
  for (const k of CORRIDORS) {
    const size = st.sizes[k.id];
    const n = st.stations[k.id];
    const o = REGION_SIZES[k.id];
    if (!size || (size === o && n === REGION_STATIONS[k.id])) continue;
    if (size === o) c += Math.max(0, design(k.id, size, n).hp - design(k.id, o, REGION_STATIONS[k.id]).hp) * COMPRESSION_COST_PER_HP;
    else c += design(k.id, size, n).cost;
  }
  return c;
}

function shortfall(st: BuildState): number {
  const s = solveFlow(buildProblem(st));
  return Object.values(s.unserved).reduce((a, b) => a + b, 0);
}

let cheapest: { id: string; size: number; stations: number; cost: number } | null = null;
/** The cheapest single change to the region's network that serves the design day with the new plant. */
export function cheapestExpansion() {
  if (cheapest) return cheapest;
  let best = { id: '', size: 0, stations: 0, cost: Infinity };
  for (const c of CORRIDORS)
    for (const size of PIPE_SIZES)
      for (let n = 1; n <= 5; n++) {
        const st: BuildState = { ...BUILD_DEFAULTS, day: 'design', plant: true, sizes: { ...REGION_SIZES, [c.id]: size }, stations: { ...REGION_STATIONS, [c.id]: n } };
        if (!onlyAdds(st)) continue;
        const cost = expansionCost(st);
        if (cost <= 0 || cost >= best.cost) continue;
        if (shortfall(st) < 1e-6) best = { id: c.id, size, stations: n, cost };
      }
  cheapest = best;
  return best;
}

/**
 * The challenge's answer, found by `cheapestExpansion` (and checked in the tests): a fourth station on
 * the Valley Line. Pairs of changes cost more.
 */
export const CHEAPEST = { id: 'sandhill-metro', size: 24, stations: 4 };
export const CHEAPEST_COST = expansionCost({
  ...BUILD_DEFAULTS,
  sizes: { ...REGION_SIZES, [CHEAPEST.id]: CHEAPEST.size },
  stations: { ...REGION_STATIONS, [CHEAPEST.id]: CHEAPEST.stations },
});

/** The design day with the new plant, served by the challenge's answer: flows and storage withdrawals. */
const ANSWER_DAY = (() => {
  const p = buildProblem({ ...BUILD_DEFAULTS, day: 'design', plant: true, sizes: { ...REGION_SIZES, [CHEAPEST.id]: CHEAPEST.size }, stations: { ...REGION_STATIONS, [CHEAPEST.id]: CHEAPEST.stations } });
  const s = solveFlow(p);
  return { flow: s.flow, hollow: s.supplied[p.supplies.findIndex((x) => x.id === 'hollowcreek')] };
})();

/** The challenge: the design day served, with the new plant, by the cheapest addition to the region's network. */
export function expansionSolved(st: BuildState): boolean {
  if (st.day !== 'design' || !st.plant || !onlyAdds(st)) return false;
  if (shortfall(st) > 1e-6) return false;
  return expansionCost(st) <= CHEAPEST_COST + 1;
}

/** "Northline" or "the Ridgeback–Sandhill corridor". */
export function corridorName(id: string): string {
  const p = PIPELINE[id];
  if (p) return p.name;
  const c = CORRIDORS.find((x) => x.id === id)!;
  return `the ${GAS_NODE[c.from].name}–${GAS_NODE[c.to].name} corridor`;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function listOf(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const DAY_OPTIONS: Array<{ value: Day; label: string }> = [
  { value: 'summer', label: 'Summer day' },
  { value: 'winter', label: 'Cold winter day' },
  { value: 'design', label: 'Design day' },
];

// ---------------------------------------------------------------------------
// Numbers quoted in the prose.

const REGION_STATE = (day: Day, plant = false): BuildState => ({ ...BUILD_DEFAULTS, day, plant });
const solveDay = (day: Day, plant = false) => {
  const p = buildProblem(REGION_STATE(day, plant));
  return { p, s: solveFlow(p) };
};
const SUMMER = solveDay('summer');
const WINTER = solveDay('winter');
const DESIGN = solveDay('design');
const total = (day: Day) => GAS_NODES.reduce((a, n) => a + REFERENCE_DAYS[day].demand[n.id], 0);
const REGION_COST = networkCost(BUILD_DEFAULTS);
const supplyOf = (r: typeof SUMMER, id: string) => r.s.supplied[r.p.supplies.findIndex((x) => x.id === id)] ?? 0;
const PRODUCTION = BASINS[0].productionBcfd + BASINS[1].productionBcfd;
const NL = PIPELINE['calder-metro'];
/** The design day without Hollow Creek: what no pipeline could supply, and what Metro lacks with the region's pipelines. */
const DESIGN_GAP = total('design') - PRODUCTION - SALT_FLAT_BCFD;
const NO_HOLLOW = (() => {
  const p = buildProblem(REGION_STATE('design'));
  return solveFlow({ ...p, supplies: p.supplies.filter((x) => x.id !== 'hollowcreek') });
})();

// Figure 2: Northline's corridor at every size.
const CHARGE_RATE = 0.1;
const CHARGE_YEARS = 30;
/** Share of a pipeline's cost it must earn back each year to repay it, with a 10% return, over 30 years. */
export const CAPITAL_CHARGE = CHARGE_RATE / (1 - Math.pow(1 + CHARGE_RATE, -CHARGE_YEARS));
export const SCALE_DEFAULTS = { size: 36, stations: 3, load: 100 };
/** Capital charge per MMBtu carried, $, for a line of `capacity` Bcf/d used at `load` (0–1) of it. */
export function chargePerMMBtu(cost: number, capacity: number, load: number): number {
  return capacity > 0 && load > 0 ? (cost * CAPITAL_CHARGE) / (capacity * load * 365 * MMBTU_PER_MCF * 1e6) : Infinity;
}
const NL_DESIGN = design(NL.id, NL.sizeIn, NL.stations);
const per = (size: number, n: number) => {
  const d = design(NL.id, size, n);
  return d.cost / d.capacityBcfd;
};

// ---------------------------------------------------------------------------

export default function Lesson() {
  const b = useScenario('build', BUILD_DEFAULTS);
  const st = b.state;
  const problem = useMemo(() => buildProblem(st), [st]);
  const sol = useMemo(() => solveFlow(problem), [problem]);
  const binding = bindingArcs(problem, sol);
  const demand = (id: GasNodeId) => problem.demands.find((d) => d.node === id)?.cap ?? 0;
  const dayTotal = problem.demands.reduce((a, d) => a + d.cap, 0);
  const served = sol.served.reduce((a, x) => a + x, 0);
  const shortPlaces = GAS_NODES.filter((n) => sol.unserved[n.id] > 1e-6);
  const cost = networkCost(st);
  const built = CORRIDORS.filter((c) => st.sizes[c.id] > 0).map((c) => c.id);
  const caps = Object.fromEntries(built.map((id) => [id, design(id, st.sizes[id], st.stations[id]).capacityBcfd]));
  const sizesDrawn = Object.fromEntries(built.map((id) => [id, st.sizes[id]]));
  const sel = st.sel;
  const selCorridor = CORRIDORS.find((c) => c.id === sel)!;
  const selSize = st.sizes[sel];
  const selDesign = selSize ? design(sel, selSize, st.stations[sel]) : null;
  const selFlow = sol.flow[sel] ?? 0;
  const storageFlow = (id: string) => sol.supplied[problem.supplies.findIndex((x) => x.id === id)] ?? 0;
  const solved = expansionSolved(st);
  const best = { ...CHEAPEST, cost: CHEAPEST_COST };
  const extra = onlyAdds(st) ? expansionCost(st) : NaN;

  const setSize = (v: string) => b.set((s) => ({ sizes: { ...s.sizes, [s.sel]: Number(v) } }));
  const setStations = (v: number) => b.set((s) => ({ stations: { ...s.stations, [s.sel]: v } }));

  const selText = selDesign
    ? `${cap(corridorName(sel))}, ${GAS_NODE[selCorridor.from].name} to ${GAS_NODE[selCorridor.to].name}, ${selCorridor.lengthMi} miles: a ${selSize}-inch pipe with ${st.stations[sel]} station${st.stations[sel] > 1 ? 's' : ''} carries up to ${fmt(selDesign.capacityBcfd, 2)} Bcf/d and costs ${money(selDesign.cost)}. Today it carries ${fmt(selFlow, 2)} Bcf/d.`
    : `${cap(corridorName(sel))}, ${GAS_NODE[selCorridor.from].name} to ${GAS_NODE[selCorridor.to].name}, ${selCorridor.lengthMi} miles: nothing built. Choose a size to lay a pipe here.`;

  const status = (() => {
    if (!st.plant || st.day !== 'design') return 'Switch on Metro’s new power plant and choose the design day.';
    if (!onlyAdds(st)) return 'The region’s pipelines are already in the ground: add to them, but don’t remove one, shrink it or take away a station. Reset brings the region’s network back.';
    if (shortPlaces.length) {
      // Name the full lines into the short places: those are the ones holding their gas back.
      const into = binding.filter((id) => shortPlaces.some((n) => CORRIDORS.find((c) => c.id === id)?.to === n.id));
      return `On the design day ${listOf(shortPlaces.map((n) => n.name))} ${shortPlaces.length > 1 ? 'are' : 'is'} ${fmt(shortPlaces.reduce((a, n) => a + sol.unserved[n.id], 0), 2)} Bcf/d short. The full pipelines holding gas back: ${listOf((into.length ? into : binding).map(corridorName)) || 'none — there isn’t enough gas'}.`;
    }
    return `That serves the design day for ${money(extra)} of new capital. Is there a cheaper way?`;
  })();

  // Figure 2.
  const e = useScenario('scale', SCALE_DEFAULTS);
  const es = e.state;
  const eDesign = design(NL.id, es.size, es.stations);
  const charge = eDesign.cost * CAPITAL_CHARGE;
  const perMMBtu = chargePerMMBtu(eDesign.cost, eDesign.capacityBcfd, es.load / 100);
  const curve = PIPE_SIZES.map((s) => per(s, es.stations) / 1e6);
  const yTop = Math.max(4000, Math.ceil(Math.max(...curve) / 500) * 500);

  return (
    <LessonPage id="gas/3.1">
      <P>
        Chapter 2 ended at the wellhead and the processing plant, on the region’s western edge. The people who burn the gas are somewhere else. Metro, the cold city in
        the northeast, heats its homes and runs its power plants on it; Bayport, on the coast, feeds it to petrochemical plants and to an export terminal that turns it
        into liquid for ships. Between them lie hundreds of miles, and the only practical way to move gas that far over land is a pipeline.
      </P>
      <P>
        Chapter 1 worked out what one pipeline can carry: its <K tone="orange">capacity</K> grows with its diameter to the power 2.5, falls with its length, and
        depends on the <K tone="blue">pressures</K> at its ends, which compressor stations restore along the way. Now we have to decide which pipelines to build at
        all, and how big. That decision is made once and lived with for decades, since a pipeline can run for fifty years or more and can’t be moved. Build too little and
        a city runs short on a cold morning; build too much and the steel sits half empty, paid for by somebody.
      </P>
      <P>
        In the next demonstration the region is drawn as it stands, with the six pipelines of <a href={lessonHref('gas/1.1')}>Lesson 1.1</a>’s map and two corridors where a line could run but none has been built. Each place’s
        circle shows its demand that day, in Bcf/d. Each line’s width is its size and its color says how full it is: gray under 80%, orange nearly full, red full; the
        label is its flow over its capacity. Ridgeback produces {fmt(BASINS[0].productionBcfd, 1)} Bcf/d and Sandhill {fmt(BASINS[1].productionBcfd, 1)}, and on cold
        days the two storage fields add their own: Salt Flat at Calder Hub, up to {fmt(SALT_FLAT_BCFD, 1)} Bcf/d, and Hollow Creek beside Metro, up to{' '}
        {fmt(HOLLOW_CREEK_BCFD, 1)}. The network routes the gas the cheapest way it can. Click any line or corridor to change its size and its number of compressor
        stations, and switch between the days:
      </P>

      <Figure name="Pipeline Builder" scenario={b}>
        <Segmented label="Day" value={st.day} onChange={(v) => b.set({ day: v })} options={DAY_OPTIONS} />
        <GasMap
          ariaLabel={`The region’s gas network on ${REFERENCE_DAYS[st.day].name.toLowerCase()}, with ${built.length} pipeline${built.length === 1 ? '' : 's'} costing ${money(cost)}. ${fmt(served, 2)} of ${fmt(dayTotal, 2)} Bcf/d of demand is served${shortPlaces.length ? `; ${shortPlaces.map((n) => `${n.name} is ${fmt(sol.unserved[n.id], 2)} short`).join(', ')}` : ''}. Selected: ${corridorName(sel)}.`}
          flows={sol.flow}
          capacities={caps}
          built={built}
          sizes={sizesDrawn}
          showCorridors
          nodeInfo={(id) => {
            const short = sol.unserved[id];
            return {
              value: fmt(demand(id), 2),
              sub: short > 1e-6 ? `${fmt(short, 2)} short` : 'Bcf/d',
              fill: short > 1e-6 ? '#f6d5d0' : '#fff',
            };
          }}
          storage={(id) => (st.day === 'summer' ? 'not withdrawing' : `withdrawing ${fmt(storageFlow(id), 2)} Bcf/d`)}
          selected={{ kind: 'pipe', id: sel }}
          onPipeClick={(id) => b.set({ sel: id })}
        />
        <Legend
          items={[
            { label: 'Less than 80% full', color: '#c4c4c4', kind: 'line' },
            { label: 'Nearly full', color: '#eda06f', kind: 'line' },
            { label: 'Full', color: '#e75b55', kind: 'line' },
            { label: 'Corridor, nothing built', color: '#cfc9b9', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'capital cost of the network', value: money(cost), tone: 'green' },
            { label: 'demand served that day', value: `${fmt(served, 2)} of ${fmt(dayTotal, 2)} Bcf/d`, tone: 'orange' },
            { label: 'short', value: shortPlaces.length ? listOf(shortPlaces.map((n) => `${n.name} ${fmt(sol.unserved[n.id], 2)}`)) : 'nowhere', tone: shortPlaces.length ? 'red' : 'ink' },
          ]}
        />
        <Caption>{selText}</Caption>
        <Segmented
          label={`Pipe size on ${corridorName(sel)}`}
          value={String(selSize)}
          onChange={setSize}
          options={[{ value: '0', label: 'None' }, ...PIPE_SIZES.map((s) => ({ value: String(s), label: `${s} in` }))]}
        />
        <Slider
          label="Compressor stations"
          value={st.stations[sel]}
          min={1}
          max={5}
          disabled={!selSize}
          onChange={setStations}
          display={selSize ? `${st.stations[sel]}, every ${fmt(selCorridor.lengthMi / st.stations[sel])} miles` : 'no pipe'}
        />
        <Checkbox label={`Metro’s new power plant (${fmt(PLANT_BCFD, 1)} Bcf/d more demand at Metro)`} checked={st.plant} onChange={(v) => b.set({ plant: v })} />
      </Figure>

      <P>
        On the summer day the region burns {fmt(total('summer'), 2)} Bcf/d, and most of the network idles. Northline carries {fmt(SUMMER.s.flow['calder-metro'], 2)} of its{' '}
        {fmt(NL.capacityBcfd, 1)} Bcf/d and Gulfward {fmt(SUMMER.s.flow['calder-bayport'], 2)} of its {fmt(PIPELINE['calder-bayport'].capacityBcfd, 1)}. Gas is
        plentiful — the basins could produce {fmt(PRODUCTION, 1)} Bcf/d — and Sandhill, the dearer field, sends out only {fmt(supplyOf(SUMMER, 'sandhill'), 2)}. (In a real
        summer much of the rest would go into storage, the subject of <a href={lessonHref('gas/3.4')}>Lesson 3.4</a>.) Only the cheapest routes are full: the Coastal Line
        and the Valley Line carry all they can, and the rest of the gas takes longer ways round.
      </P>
      <P>
        On the cold winter day demand rises to {fmt(total('winter'), 2)} Bcf/d, almost all of the increase in Metro, where gas heats homes. Northline fills to its{' '}
        {fmt(NL.capacityBcfd, 1)} Bcf/d, and the storage fields make up the difference: Salt Flat withdraws {fmt(supplyOf(WINTER, 'saltflat'), 2)} Bcf/d at the hub and
        Hollow Creek {fmt(supplyOf(WINTER, 'hollowcreek'), 2)} beside the city. The basins are producing flat out, and still the region needs more gas than they make.
      </P>

      <H2>Built for the coldest day</H2>
      <P>
        Gas utilities plan for a <b>design day</b>: the coldest day they expect to have to serve, colder than almost any day in a long weather record. Choose it. Demand
        is {fmt(total('design'), 2)} Bcf/d, Metro alone {fmt(REFERENCE_DAYS.design.demand.metro, 2)}, and the network serves every bit of it — but only just. Northline and
        the Valley Line are full, and Hollow Creek is withdrawing {fmt(supplyOf(DESIGN, 'hollowcreek'), 2)} of its {fmt(HOLLOW_CREEK_BCFD, 1)} Bcf/d. That is how a gas
        network is sized: the city’s pipelines and storage together must cover its design day, so on an ordinary summer day Northline runs about{' '}
        {pct(SUMMER.s.flow['calder-metro'] / NL.capacityBcfd)} full. The six lines cost {money(REGION_COST)} to build, at our illustrative{' '}
        {money(PIPE_COST_PER_INCH_MILE)} per inch of diameter per mile of pipe and {money(COMPRESSION_COST_PER_HP)} per horsepower of compression.
      </P>
      <P>
        Notice what the storage fields are doing. On the design day the basins produce {fmt(PRODUCTION, 1)} Bcf/d and Salt Flat can add {fmt(SALT_FLAT_BCFD, 1)}, which
        together come to {fmt(PRODUCTION + SALT_FLAT_BCFD, 1)} — less than the {fmt(total('design'), 2)} Bcf/d the region burns. No pipeline, however large, could close
        that {fmt(DESIGN_GAP, 2)} Bcf/d gap, and with the region’s pipelines as they are, Metro alone would be {fmt(NO_HOLLOW.unserved.metro, 2)} Bcf/d short without
        Hollow Creek. On its coldest days the region burns gas it produced
        months earlier and parked underground near the city. Storage near a market does two jobs at once: it supplies gas the basins can’t produce on the day, and it
        delivers it without using any pipeline capacity into the city.
      </P>
      <Challenge
        id="a"
        figure="Pipeline Builder"
        question={`Metro’s utility signs up a new power plant that will burn ${fmt(PLANT_BCFD, 1)} Bcf/d on the design day. Starting from the region’s network (Reset brings it back), what is the cheapest addition that still serves every place on the design day? Pipelines already in the ground stay: you can add stations or lay new pipe, but adding a station to a line costs only the compression, while choosing a different size replaces the line with a new pipe, at a new pipe’s full cost.`}
        solved={solved}
        status={status}
        success={`Solved: a fourth compressor station on the ${corridorName(best.id)}, for ${money(best.cost)}. It lifts the line from ${fmt(PIPELINE[best.id].capacityBcfd, 2)} to ${fmt(ANSWER_DAY.flow[best.id], 2)} Bcf/d, which covers ${fmt(ANSWER_DAY.flow[best.id] - PIPELINE[best.id].capacityBcfd, 2)} of the plant’s ${fmt(PLANT_BCFD, 2)}. Hollow Creek covers the rest by withdrawing ${fmt(ANSWER_DAY.hollow, 2)} Bcf/d instead of ${fmt(supplyOf(DESIGN, 'hollowcreek'), 2)}: all it can give, so on the design day Metro now has nothing left in reserve. A fourth station on Northline would add more — ${fmt(design(NL.id, NL.sizeIn, 4).capacityBcfd - NL.capacityBcfd, 2)} Bcf/d — but cost ${money((design(NL.id, NL.sizeIn, 4).hp - NL_DESIGN.hp) * COMPRESSION_COST_PER_HP)}, and a new 20-inch line up the coast from Bayport ${money(design('bayport-metro', 20, 1).cost)}. The cheapest expansion relieves the constraint that binds, and when compression can do it, compression is far cheaper than steel.`}
      />

      <H2>Bigger is cheaper — if it’s full</H2>
      <P>
        Why does the region have a few big pipelines rather than many small ones? In the next demonstration, choose a pipe for Northline’s 240-mile corridor. The chart
        plots what each size costs per Bcf/d of capacity, with the number of stations you choose; the readouts turn the cost into a charge on every MMBtu the line
        carries. A pipeline must earn back what it cost: repaying it over 30 years with a 10% return takes {pct(CAPITAL_CHARGE, 1)} of the cost every year. Divide that by
        the gas the line actually moves, which depends on how full it runs — its <b>load factor</b>:
      </P>

      <Figure name="Pipeline Builder · economies of scale" scenario={e}>
        <XYChart
          xDomain={[18, 44]}
          yDomain={[0, yTop]}
          xTicks={PIPE_SIZES}
          xFormat={(v) => `${v} in`}
          yFormat={(v) => `$${fmt(v)}M`}
          yLabel="Capital cost per Bcf/d of capacity"
          xLabel="pipe size"
          height={220}
          left={70}
          series={[
            { xs: PIPE_SIZES, ys: curve, color: GRAPHIC.green, width: 2.5 },
            { xs: PIPE_SIZES, ys: curve, color: GRAPHIC.green, kind: 'points', r: 4 },
          ]}
          markers={[{ x: es.size, y: per(es.size, es.stations) / 1e6, color: TEXT.green, r: 7, ring: true, label: `${money(per(es.size, es.stations))} per Bcf/d`, labelPos: 'above' }]}
          ariaLabel={`Capital cost per Bcf/d of capacity on Northline’s 240-mile corridor with ${es.stations} station${es.stations > 1 ? 's' : ''}: ${PIPE_SIZES.map((s, i) => `${s} inches ${money(curve[i] * 1e6)}`).join(', ')}. Selected: ${es.size} inches, ${fmt(eDesign.capacityBcfd, 2)} Bcf/d for ${money(eDesign.cost)}.`}
        />
        <Readouts
          items={[
            { label: 'capacity', value: `${fmt(eDesign.capacityBcfd, 2)} Bcf/d`, tone: 'orange' },
            { label: 'capital cost', value: money(eDesign.cost), tone: 'green' },
            { label: 'capital charge a year', value: money(charge), tone: 'green' },
            { label: `per MMBtu carried at ${es.load}% load`, value: `$${fmt(perMMBtu, 2)}`, tone: 'green' },
          ]}
        />
        <Segmented label="Pipe size" value={String(es.size)} onChange={(v) => e.set({ size: Number(v) })} options={PIPE_SIZES.map((s) => ({ value: String(s), label: `${s} in` }))} />
        <Slider label="Compressor stations" value={es.stations} min={1} max={5} onChange={(v) => e.set({ stations: v })} display={`${es.stations}, every ${fmt(NL.lengthMi / es.stations)} miles`} />
        <Slider label="Load factor" tone="orange" value={es.load} min={20} max={100} step={5} onChange={(v) => e.set({ load: v })} display={`${es.load}% of capacity, on average`} />
        <Eq label={`Capital charge per MMBtu equals ${money(eDesign.cost)} times ${pct(CAPITAL_CHARGE, 1)}, divided by ${fmt(eDesign.capacityBcfd, 2)} Bcf/d times ${es.load}% times 365 days times ${MMBTU_PER_MCF} million MMBtu per Bcf: $${fmt(perMMBtu, 2)}`}>
          <K c="price">charge</K>
          <Op>=</Op>
          <Frac top={<span>{money(eDesign.cost)} × {pct(CAPITAL_CHARGE, 1)}</span>} bottom={<span>{fmt(eDesign.capacityBcfd, 2)} × {es.load}% × 365 × {MMBTU_PER_MCF} million MMBtu</span>} />
          <Op>=</Op>
          <K c="price">${fmt(perMMBtu, 2)}/MMBtu</K>
        </Eq>
      </Figure>

      <P>
        With three stations, a 20-inch pipe carries {fmt(design(NL.id, 20, 3).capacityBcfd, 2)} Bcf/d for {money(design(NL.id, 20, 3).cost)}, or{' '}
        {money(per(20, 3))} per Bcf/d of capacity. A 42-inch pipe carries {fmt(design(NL.id, 42, 3).capacityBcfd, 2)} Bcf/d for {money(design(NL.id, 42, 3).cost)} —{' '}
        {money(per(42, 3))} per Bcf/d, {pct(1 - per(42, 3) / per(20, 3))} less. Capacity grows with the diameter to the power 2.5, as in{' '}
        <a href={lessonHref('gas/1.3')}>Lesson 1.3</a>, but the cost of laying it — steel, trenching, right of way — grows roughly in proportion to the diameter, which is why the industry quotes it per inch-mile. Compression helps
        too, up to a point: on a 36-inch pipe each Bcf/d costs {money(per(36, 1))} with one station and {money(per(36, 3))} with three, but a fourth barely changes
        it ({money(per(36, 4))}) and a fifth raises it to {money(per(36, 5))}, as each extra station adds less capacity than the one before. And the stations burn gas for as long as the line runs (
        <a href={lessonHref('gas/1.4')}>Lesson 1.4</a>), which the capital cost leaves out.
      </P>
      <P>
        Northline as built — 36 inches, three stations, {fmt(NL_DESIGN.capacityBcfd, 1)} Bcf/d for {money(NL_DESIGN.cost)} — must earn{' '}
        {money(NL_DESIGN.cost * CAPITAL_CHARGE)} a year. If it ran full every day, that would be ${fmt(chargePerMMBtu(NL_DESIGN.cost, NL_DESIGN.capacityBcfd, 1), 2)} on
        every MMBtu it carried. But a line built for the design day doesn’t run full every day; at a 60% load factor the same capital costs $
        {fmt(chargePerMMBtu(NL_DESIGN.cost, NL_DESIGN.capacityBcfd, 0.6), 2)} per MMBtu. Big pipes are cheap only if somebody fills them, or pays as if they did. That is
        why pipelines in North America are usually built only after shippers have signed long-term contracts for most of the capacity, paying for their share whether or
        not gas flows on a given day. We’ll see how those contracts work, and what they’re worth, in <a href={lessonHref('gas/4.3')}>Lesson 4.3</a>.
      </P>
      <P>
        The network now exists, with a capacity on every line. In <FigRef to="Pipeline Builder">the first demonstration</FigRef> the gas found its own way through it,
        but we haven’t asked how. The <a href={lessonHref('gas/3.2')}>next lesson</a> routes gas through the network on purpose, takes lines out of service, and finds
        the bottlenecks that leave one place short while another has gas to spare.
      </P>
    </LessonPage>
  );
}
