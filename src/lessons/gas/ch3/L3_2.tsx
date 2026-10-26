import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
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
import { useProgress } from '../../../course/progress';
import { compress } from '../../../engines/gas/compression';
import { PIPE_COST_PER_INCH_MILE, COMPRESSION_COST_PER_HP, bindingArcs, corridorDesign, loopedFlow, solveFlow, type FlowProblem } from '../../../engines/gas/network';
import { psia } from '../../../engines/gas/properties';
import { GAS_NODES, GAS_NODE, PIPELINE, PIPELINES, PRODUCTION_COST, REFERENCE_DAYS, STORAGE_FIELDS, type GasNodeId } from '../../../model/gas/world';
import { GasMap } from '../shared/GasMap';
import { XYChart } from '../shared/XYChart';
import { bcfd, money } from '../shared/format';

// ---------------------------------------------------------------------------
// The region's network on one day: supplies, demands and pipelines, routed by the min-cost flow engine.

type DayId = 'summer' | 'winter' | 'design';

export interface SolverState {
  day: DayId;
  /** Demand at Metro and Bayport, Bcf/d. */
  metro: number;
  bayport: number;
  /** Gas the basins can produce today, Bcf/d. */
  ridgeback: number;
  sandhill: number;
  /** Most each storage field can withdraw today, Bcf/d. */
  salt: number;
  hollow: number;
  /** Pipelines out of service. */
  out: string[];
}

const SALT = STORAGE_FIELDS.find((s) => s.id === 'saltflat')!;
const HOLLOW = STORAGE_FIELDS.find((s) => s.id === 'hollowcreek')!;
const RIDGEBACK_OUTPUT = 2.6;
const SANDHILL_OUTPUT = 0.8;

/** Starting each day from the region's reference demand; storage withdraws only in winter. */
export function dayPreset(day: DayId): SolverState {
  const d = REFERENCE_DAYS[day].demand;
  const winter = day !== 'summer';
  return {
    day,
    metro: d.metro,
    bayport: d.bayport,
    ridgeback: RIDGEBACK_OUTPUT,
    sandhill: SANDHILL_OUTPUT,
    salt: winter ? SALT.maxWithdrawBcfd : 0,
    hollow: winter ? HOLLOW.maxWithdrawBcfd : 0,
    out: [],
  };
}

export const SOLVER_DEFAULTS: SolverState = dayPreset('winter');

/**
 * Illustrative costs for routing: gas fresh from the wells at each field's short-run cost, gas
 * from storage dearer (it was bought, moved and injected months ago), so the network draws on
 * storage only when it must. Every customer is worth far more than any supply, so all demand is
 * served whenever the pipes allow.
 */
const STORAGE_COST = { calder: 4.0, metro: 4.5 };
const MUST_SERVE = 50;
const NODES = GAS_NODES.map((n) => n.id);

/** The day as a flow problem: pipelines out of service are left out. */
export function networkProblem(s: SolverState): FlowProblem {
  const local = REFERENCE_DAYS[s.day].demand;
  return {
    nodes: NODES,
    arcs: PIPELINES.filter((p) => !s.out.includes(p.id)).map((p) => ({ id: p.id, from: p.from, to: p.to, cap: p.capacityBcfd, cost: p.variableCost })),
    supplies: [
      { id: 'ridgeback', node: 'ridgeback', cap: s.ridgeback, cost: PRODUCTION_COST.ridgeback ?? 1.2 },
      { id: 'sandhill', node: 'sandhill', cap: s.sandhill, cost: PRODUCTION_COST.sandhill ?? 1.6 },
      { id: 'saltflat', node: 'calder', cap: s.salt, cost: STORAGE_COST.calder },
      { id: 'hollowcreek', node: 'metro', cap: s.hollow, cost: STORAGE_COST.metro },
    ],
    demands: [
      { node: 'sandhill', cap: local.sandhill, value: MUST_SERVE },
      { node: 'ridgeback', cap: local.ridgeback, value: MUST_SERVE },
      { node: 'calder', cap: local.calder, value: MUST_SERVE },
      { node: 'metro', cap: s.metro, value: MUST_SERVE },
      { node: 'bayport', cap: s.bayport, value: MUST_SERVE },
    ],
  };
}

export interface NetworkDay {
  flow: Record<string, number>;
  /** Supply used: Ridgeback, Sandhill, Salt Flat, Hollow Creek. */
  ridgeback: number;
  sandhill: number;
  salt: number;
  hollow: number;
  /** Demand served and unserved by place. */
  served: Record<GasNodeId, number>;
  unserved: Record<GasNodeId, number>;
  totalUnserved: number;
  /** Supply available but not used, Bcf/d. */
  spare: number;
  /** Full pipelines that hold the network back. */
  binding: string[];
  /** Total supply available minus total demand: negative when the region is short of gas outright. */
  balance: number;
}

/** Routes the day's gas through the network. */
export function solveDay(s: SolverState): NetworkDay {
  const p = networkProblem(s);
  const sol = solveFlow(p);
  const served = Object.fromEntries(NODES.map((n) => [n, 0])) as Record<GasNodeId, number>;
  p.demands.forEach((d, i) => (served[d.node as GasNodeId] += sol.served[i]));
  const unserved = sol.unserved as Record<GasNodeId, number>;
  const totalUnserved = Object.values(unserved).reduce((a, b) => a + b, 0);
  const supplyCap = p.supplies.reduce((a, x) => a + x.cap, 0);
  const demandTotal = p.demands.reduce((a, x) => a + x.cap, 0);
  const used = sol.supplied.reduce((a, b) => a + b, 0);
  return {
    flow: sol.flow,
    ridgeback: sol.supplied[0],
    sandhill: sol.supplied[1],
    salt: sol.supplied[2],
    hollow: sol.supplied[3],
    served,
    unserved,
    totalUnserved,
    spare: supplyCap - used,
    binding: bindingArcs(p, sol),
    balance: supplyCap - demandTotal,
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** True when everything but Metro's demand is as the design day starts. */
function designDayButMetro(s: SolverState): boolean {
  const d = dayPreset('design');
  return s.day === 'design' && near(s.bayport, d.bayport) && near(s.ridgeback, d.ridgeback) && near(s.sandhill, d.sandhill) && near(s.salt, d.salt) && near(s.hollow, d.hollow) && s.out.length === 0;
}

/**
 * The challenge: on the design day, the most Metro can burn (on the slider's 0.05 grid) with every
 * customer still served and nothing else changed. The cut around Metro decides it: Northline and the
 * Valley Line, full at 2.25 Bcf/d, plus Hollow Creek's 1.0 inside the cut, 3.25 in all.
 */
export function peakSolved(s: SolverState): boolean {
  if (!designDayButMetro(s)) return false;
  return solveDay(s).totalUnserved < 1e-6 && solveDay({ ...s, metro: s.metro + 0.05 }).totalUnserved > 1e-6;
}

// Numbers the prose quotes, all from the engine.
const WINTER = solveDay(SOLVER_DEFAULTS);
const NL_OUT = solveDay({ ...SOLVER_DEFAULTS, out: ['calder-metro'] });
const SUMMER_GLUT_STATE: SolverState = { ...dayPreset('summer'), ridgeback: 3.4 };
const SUMMER_GLUT = solveDay(SUMMER_GLUT_STATE);
const DESIGN = dayPreset('design');
const NL = PIPELINE['calder-metro'];
const VL = PIPELINE['sandhill-metro'];
const RE = PIPELINE['ridgeback-calder'];
const CL = PIPELINE['ridgeback-bayport'];
const INTO_METRO = NL.capacityBcfd + VL.capacityBcfd;
/** The challenge's answer: the capacity of the cut around Metro on the design day, storage inside it included. */
export const METRO_PEAK = INTO_METRO + HOLLOW.maxWithdrawBcfd;
const PAST_PEAK = solveDay({ ...DESIGN, metro: METRO_PEAK + 0.05 });
const RIDGEBACK_OUTLETS = RE.capacityBcfd + CL.capacityBcfd + REFERENCE_DAYS.summer.demand.ridgeback;
/** Northline with a fourth station: the capacity it could sell (as in Lesson 3.1), and what the extra compression costs. */
const NL_FOUR = corridorDesign(NL.id, NL.sizeIn, 4);
const NL_FOUR_STATIONS = NL_FOUR.capacityBcfd;
const NL_FOUR_COST = (NL_FOUR.hp - corridorDesign(NL.id, NL.sizeIn, NL.stations).hp) * COMPRESSION_COST_PER_HP;
/** Gas the region can supply without Hollow Creek (both basins flat out, Salt Flat at full rate), and what it burns. */
const SUPPLY_NO_HOLLOW = RIDGEBACK_OUTPUT + SANDHILL_OUTPUT + SALT.maxWithdrawBcfd;
const dayTotal = (d: DayId) => Object.values(REFERENCE_DAYS[d].demand).reduce((a, b) => a + b, 0);
/** On the design day the region is short of gas itself without Hollow Creek, whatever the pipes. */
const DESIGN_GAP = dayTotal('design') - SUPPLY_NO_HOLLOW;

const DAY_LABEL: Record<DayId, string> = { summer: 'Summer day', winter: 'Cold winter day', design: 'Design day' };
const SHORT_FILL = '#f4cfc9';
const LAND = '#f2f0e9';

/** A dashed line drawn around Metro when it's short: what crosses it caps what the city can burn. */
function MetroCut() {
  const { x, y } = GAS_NODE.metro;
  return (
    <g aria-hidden="true">
      <circle cx={x} cy={y} r={58} fill="none" stroke={GRAPHIC.red} strokeWidth={1.6} strokeDasharray="6 5" />
      <text x={588} y={y + 80} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: TEXT.red, paintOrder: 'stroke', stroke: LAND, strokeWidth: 4 }}>
        the line around Metro
      </text>
    </g>
  );
}
const UNSOLD_FILL = '#f3e3b5';
const names = (ids: string[]) => {
  const n = ids.map((id) => PIPELINE[id]?.name ?? id);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

// ---------------------------------------------------------------------------
// Looping Northline: a second pipe beside part of each 80-mile stretch between stations.

const SEGMENT = { diameterIn: NL.diameterIn, lengthMi: NL.lengthMi / NL.stations, roughnessIn: 0.0007 };
const P_IN = psia(NL.maopPsig);
const P_OUT = psia(NL.minDeliveryPsig);
const LOOP_SIZES = [24, 30, 36] as const;
type LoopSize = (typeof LOOP_SIZES)[number];
const LOOP_ID: Record<LoopSize, number> = { 24: 23.25, 30: 29.25, 36: 35 };
export const LOOP_DEFAULTS = { size: '36' as `${LoopSize}`, share: 0 };
/**
 * Northline would need this much to serve the cold winter day without Hollow Creek, with the Valley
 * Line alone beside it, MMcf/d. (That day the region has exactly enough gas without the field; on the
 * design day it hasn't, so no pipeline could stand in for it.)
 */
export const LOOP_TARGET = Math.round((SOLVER_DEFAULTS.metro - VL.capacityBcfd) * 1000);

/** Northline's capacity (MMcf/d) with `share` (0–1) of every segment looped with a pipe of `size` inches. */
export function loopedCapacity(size: LoopSize, share: number) {
  return loopedFlow(SEGMENT, LOOP_ID[size], share, P_IN, P_OUT);
}

/** Total horsepower of Northline's three stations, each squeezing `q` MMcf/d from 765 to 1,440 psig. */
function stationHp(q: number) {
  return NL.stations * compress(q, P_OUT, P_IN).hp;
}

/** The challenge: the smallest share (in 5% steps) of each segment looped with 36-inch pipe that carries the target. */
export function loopSolved(st: typeof LOOP_DEFAULTS): boolean {
  if (st.size !== '36') return false;
  const share = Math.round(st.share);
  return loopedCapacity(36, share / 100).total >= LOOP_TARGET - 1e-9 && (share === 0 || loopedCapacity(36, (share - 5) / 100).total < LOOP_TARGET - 1e-9);
}

/**
 * While the looping challenge is open, Northline's capacity with a 36-inch loop over part of each
 * segment, short of half, stays hidden: the reader estimates the share from the unlooped, half-looped
 * and fully looped capacities the lesson quotes, then checks it. Everything from half looped up stays
 * on show, as do the other sizes.
 */
export function loopCapacityHidden(st: typeof LOOP_DEFAULTS, done: boolean): boolean {
  return !done && st.size === '36' && st.share > 0 && st.share < 50;
}

const BASE_CAP = loopedCapacity(36, 0).total;
const HALF36 = loopedCapacity(36, 0.5);
const FULL36 = loopedCapacity(36, 1).total;
/** The share a straight line from unlooped to half-looped would need for the target, percent: the reader's first estimate. */
export const LOOP_LINEAR_SHARE = ((LOOP_TARGET - BASE_CAP) / (HALF36.total - BASE_CAP)) * 50;
const HALF24 = loopedCapacity(24, 0.5);
const SHARES = Array.from({ length: 21 }, (_, i) => i * 5);
const minShare = (size: LoopSize) => SHARES.find((x) => loopedCapacity(size, x / 100).total >= LOOP_TARGET - 1e-9);
const ANSWER_SHARE = minShare(36) ?? 100;
const ANSWER_CAP = loopedCapacity(36, ANSWER_SHARE / 100).total;
const ANSWER_PREV_CAP = loopedCapacity(36, (ANSWER_SHARE - 5) / 100).total;
const ANSWER_MILES = (ANSWER_SHARE / 100) * NL.lengthMi;
const ANSWER_PIPE_COST = 36 * ANSWER_MILES * PIPE_COST_PER_INCH_MILE;
const ANSWER_HP = stationHp(ANSWER_CAP) - stationHp(BASE_CAP);
const ANSWER_COST = ANSWER_PIPE_COST + ANSWER_HP * COMPRESSION_COST_PER_HP;

/** One segment with its loop, drawn to scale along its 80 miles. */
function LoopDiagram({ size, share, flow, hidden }: { size: LoopSize; share: number; flow: { total: number; inLoop: number; inMain: number }; hidden: boolean }) {
  const x0 = 70;
  const x1 = 570;
  const xl = x0 + (x1 - x0) * share;
  const main = 14;
  const loopW = (LOOP_ID[size] / 35) * 14;
  const yMain = 110;
  const yLoop = 62;
  const speed = (q: number) => (q > 1 ? { animationDuration: `${(18 / (q * 0.05)).toFixed(3)}s` } : { animationPlayState: 'paused' as const });
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 180"
      role="img"
      aria-label={`One 80-mile segment of Northline with ${pct(share)} of its length looped by a ${size}-inch pipe. ${hidden ? 'What it carries stays hidden until the challenge is solved.' : `It carries ${fmt(flow.total)} MMcf/d${share > 0 ? `, of which ${fmt(flow.inLoop)} goes through the loop where the pipes run side by side` : ''}.`}`}
    >
      <rect x={14} y={yMain - 22} width={42} height={44} rx={4} fill="#ecebe6" stroke="#555" strokeWidth={1.5} />
      <text x={35} y={yMain + 4} textAnchor="middle" style={{ fontSize: 11, fill: '#333' }}>
        station
      </text>
      <line x1={x0 - 14} x2={x1} y1={yMain} y2={yMain} stroke="#9a9a9a" strokeWidth={main} strokeLinecap="butt" />
      <path d={`M${x0 - 10} ${yMain} L${x1 - 4} ${yMain}`} className="flow-dots" stroke="#fff" strokeWidth={4} style={speed(flow.total)} />
      {share > 0 && (
        <g>
          <path d={`M${x0} ${yMain} L${x0} ${yLoop} L${xl} ${yLoop} L${xl} ${yMain}`} fill="none" stroke={GRAPHIC.orange} strokeWidth={loopW} strokeLinejoin="round" opacity={0.85} />
          <path d={`M${x0} ${yLoop} L${xl} ${yLoop}`} className="flow-dots" stroke="#fff" strokeWidth={3.5} style={speed(flow.inLoop)} />
          <text x={(x0 + xl) / 2} y={yLoop - 14} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: TEXT.orange }}>
            {hidden ? 'loop' : `loop · ${fmt(flow.inLoop)}`}
          </text>
          <text x={(x0 + xl) / 2} y={yMain + 30} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: '#555' }}>
            {hidden ? 'main' : `main · ${fmt(flow.inMain)}`}
          </text>
        </g>
      )}
      <text x={share < 0.85 ? (xl + x1) / 2 : x1 - 4} y={share < 0.85 ? yMain + 30 : yMain - 16} textAnchor={share < 0.85 ? 'middle' : 'end'} style={{ fontSize: 13, fontWeight: 500, fill: TEXT.orange }}>
        {hidden ? '?' : fmt(flow.total)} MMcf/d
      </text>
      {[0, 20, 40, 60, 80].map((m) => (
        <text key={m} className="ax ax-m" x={x0 + ((x1 - x0) * m) / 80} y={168}>
          {m === 80 ? '80 mi' : m}
        </text>
      ))}
      <text className="ax ax-e" x={x1} y={30}>
        {fmt(P_IN - 14.696)} psig → {fmt(P_OUT - 14.696)} psig
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('network', SOLVER_DEFAULTS);
  const st = s.state;
  const day = useMemo(() => solveDay(st), [st]);
  const solved = peakSolved(st);
  const toggle = (id: string) => s.set((x) => ({ out: x.out.includes(id) ? x.out.filter((o) => o !== id) : [...x.out, id] }));
  const capacities = Object.fromEntries(PIPELINES.map((p) => [p.id, st.out.includes(p.id) ? 0 : p.capacityBcfd]));
  const short = (Object.keys(day.unserved) as GasNodeId[]).filter((n) => day.unserved[n] > 1e-6);
  const unsoldRidgeback = st.ridgeback - day.ridgeback;
  const unsoldSandhill = st.sandhill - day.sandhill;

  let caption: string;
  if (day.totalUnserved > 1e-6 && day.balance < -1e-6)
    caption = `The region is short of gas outright: supply falls ${bcfd(-day.balance)} short of demand, so no routing can serve everyone.`;
  else if (day.totalUnserved > 1e-6)
    caption = `${short.map((n) => GAS_NODE[n].name).join(' and ')} ${short.length > 1 ? 'are' : 'is'} short ${bcfd(day.totalUnserved)} while ${bcfd(day.spare)} of supply sits unused elsewhere.${day.binding.length ? ` Full and holding the network back: ${names(day.binding)}.` : ''}`;
  else
    caption = `Every customer is served.${day.binding.length ? ` Full and holding the network back: ${names(day.binding)}.` : ' No pipeline is full.'}`;

  const status = !designDayButMetro(st)
    ? 'Choose “Design day” to start from it, then move only the Metro demand slider.'
    : day.totalUnserved > 1e-6
      ? `With Metro burning ${bcfd(st.metro)}, it is short ${bcfd(day.unserved.metro)}.`
      : `With Metro burning ${bcfd(st.metro)}, every customer is served. Could it burn more?`;

  // Figure 2.
  const l = useScenario('loop', LOOP_DEFAULTS);
  const size = Number(l.state.size) as LoopSize;
  const share = l.state.share / 100;
  const flow = loopedCapacity(size, share);
  const curves = useMemo(() => LOOP_SIZES.map((d) => ({ d, ys: SHARES.map((x) => loopedCapacity(d, x / 100).total / 1000) })), []);
  const extraMiles = share * NL.lengthMi;
  const pipeCost = size * extraMiles * PIPE_COST_PER_INCH_MILE;
  const hpCost = (stationHp(flow.total) - stationHp(BASE_CAP)) * COMPRESSION_COST_PER_HP;
  const solvedLoop = loopSolved(l.state);
  const progress = useProgress();
  const loopDone = solvedLoop || (progress['gas/3.2']?.includes('b') ?? false);
  const capHidden = loopCapacityHidden(l.state, loopDone);
  const loopStatus =
    l.state.size !== '36'
      ? 'Choose the 36-inch loop first.'
      : l.state.share === 0
        ? `Unlooped, Northline carries ${bcfd(BASE_CAP / 1000)}. Make your estimate, then set it.`
        : capHidden
          ? `Looping ${l.state.share}% of each segment: ${fmt(extraMiles)} miles of new pipe. Under half looped, Northline’s capacity stays hidden until you find the smallest share that carries ${bcfd(LOOP_TARGET / 1000)}.`
          : flow.total < LOOP_TARGET - 1e-9
            ? `Looping ${l.state.share}% of each segment lifts Northline to ${bcfd(flow.total / 1000)}, short of ${bcfd(LOOP_TARGET / 1000)}.`
            : `Looping ${l.state.share}% of each segment lifts Northline to ${bcfd(flow.total / 1000)}. Could less do it?`;

  return (
    <LessonPage id="gas/3.2">
      <P>
        <a href={lessonHref('gas/3.1')}>Lesson 3.1</a> built the region’s pipelines for the design day, the coldest day they must ever serve. Once the steel is in the
        ground, the question changes. Nobody steers individual molecules: shippers tell the pipelines how much gas they will put in at one place and take out at another,
        and the pipelines’ controllers set compressors and valves so that the gas goes where it has been scheduled. Across a whole network, that adds up to a routing
        problem. Which paths does the gas take, and what stops more of it from getting where it’s wanted?
      </P>
      <P>
        We’ll let the network answer for itself. Each field offers gas at its short-run cost — Ridgeback’s at ${fmt(PRODUCTION_COST.ridgeback ?? 0, 2)} per MMBtu,
        Sandhill’s at ${fmt(PRODUCTION_COST.sandhill ?? 0, 2)}, both illustrative — and each storage field offers what it can withdraw, at a higher cost, since that gas
        was bought, moved and injected months ago. Each pipeline has the capacity of Lesson 3.1 and a small charge for every MMBtu it moves. Every customer must be
        served if the pipes allow it. We’ll assume the gas follows the cheapest <K tone="orange">flows</K> that do the job; Chapter 4 shows how trading pushes it
        there.
      </P>
      <P>
        In the next demonstration, the region is on a cold winter day. The numbers in the circles are what each place receives or produces, in Bcf/d, and each pipeline
        is labeled with its flow and its capacity; a line turns red when it is full. Choose a day to start from, change Metro’s demand or Ridgeback’s production, and
        click any pipeline (or tab to it and press Enter) to take it out of service:
      </P>

      <Figure name="Gas Network Solver" scenario={s}>
        <Segmented
          label="Day"
          value={st.day}
          onChange={(d) => s.set(dayPreset(d))}
          options={(['summer', 'winter', 'design'] as DayId[]).map((d) => ({ value: d, label: DAY_LABEL[d] }))}
        />
        <GasMap
          ariaLabel={`The region’s network on a ${DAY_LABEL[st.day].toLowerCase()}. Metro receives ${fmt(day.served.metro, 2)} of ${fmt(st.metro, 2)} Bcf/d and Bayport ${fmt(day.served.bayport, 2)} of ${fmt(st.bayport, 2)}. ${
            st.out.length ? `Out of service: ${names(st.out)}. ` : ''
          }${day.binding.length ? `Full and binding: ${names(day.binding)}.` : 'No pipeline is binding.'}`}
          flows={day.flow}
          capacities={capacities}
          pipeLabel={(id) => (st.out.includes(id) ? 'out of service' : undefined)}
          onPipeClick={toggle}
          nodeInfo={(id) => {
            if (id === 'calder') return undefined;
            if (id === 'ridgeback' || id === 'sandhill') {
              const unsold = id === 'ridgeback' ? unsoldRidgeback : unsoldSandhill;
              return { value: fmt(id === 'ridgeback' ? day.ridgeback : day.sandhill, 2), sub: unsold > 0.005 ? `${fmt(unsold, 2)} unsold` : 'Bcf/d out', fill: unsold > 0.005 ? UNSOLD_FILL : undefined };
            }
            const u = day.unserved[id];
            return { value: fmt(day.served[id], 2), sub: u > 1e-6 ? `short ${fmt(u, 2)}` : 'Bcf/d in', fill: u > 1e-6 ? SHORT_FILL : undefined };
          }}
          storage={(id) => {
            const cap = id === 'saltflat' ? st.salt : st.hollow;
            const used = id === 'saltflat' ? day.salt : day.hollow;
            return cap <= 0 ? 'not withdrawing' : `drawing ${fmt(used, 2)} of ${fmt(cap, 2)} Bcf/d`;
          }}
        >
          {day.unserved.metro > 1e-6 && <MetroCut />}
        </GasMap>
        <Legend
          items={[
            { label: 'Pipeline with room', color: '#c4c4c4', kind: 'line' },
            { label: 'Nearly full', color: '#eda06f', kind: 'line' },
            { label: 'Full', color: '#e75b55', kind: 'line' },
            { label: 'Customers left short', color: SHORT_FILL },
            { label: 'Gas left unsold', color: UNSOLD_FILL },
          ]}
        />
        <Readouts items={[{ label: 'Metro receives', value: `${fmt(day.served.metro, 2)} of ${bcfd(st.metro)}`, tone: 'orange' }]} />
        <Slider label="Metro demand" value={st.metro} min={0.8} max={3.4} step={0.05} onChange={(v) => s.set({ metro: v })} display={bcfd(st.metro)} />
        <Slider label="Ridgeback production" tone="orange" value={st.ridgeback} min={1} max={3.6} step={0.05} onChange={(v) => s.set({ ridgeback: v })} display={bcfd(st.ridgeback)} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Start with the cold day. Metro needs {bcfd(SOLVER_DEFAULTS.metro, 1)}. The cheapest gas reaches it two ways: down Northline from Calder Hub, which runs full at{' '}
        {bcfd(WINTER.flow['calder-metro'], 1)}, and along the Valley Line from Sandhill, full at {bcfd(WINTER.flow['sandhill-metro'])}. Together they bring{' '}
        {bcfd(INTO_METRO)}, so Hollow Creek, next to the city, makes up the last {bcfd(WINTER.hollow)}. Meanwhile Salt Flat, at the hub, is drawing{' '}
        {bcfd(WINTER.salt)} of the {bcfd(SALT.maxWithdrawBcfd, 1)} it could give. Its gas could serve Metro just as well, but it can’t get there: Northline has
        no room. And Ridgeback Express, the region’s biggest pipeline, carries only {bcfd(WINTER.flow['ridgeback-calder'])} of its {bcfd(RE.capacityBcfd, 1)} — not
        because the pipe is full, but because Ridgeback has no more gas to send it.
      </P>
      <P>
        Notice, too, that the Coastal Line is full on all three days, even in summer. It’s the cheapest way from Ridgeback to Bayport, so the network fills it first and
        sends the rest of Bayport’s gas the long way round, through Calder Hub and Gulfward.
      </P>

      <H2>The bottleneck</H2>
      <P>
        Now click Northline to take it out of service, as if a compressor station had failed. Metro receives just {bcfd(NL_OUT.served.metro)} — the Valley Line’s{' '}
        {bcfd(VL.capacityBcfd)} and everything Hollow Creek can give — and {bcfd(NL_OUT.unserved.metro)} of its demand goes unserved. At the same moment,{' '}
        {bcfd(SOLVER_DEFAULTS.ridgeback - NL_OUT.ridgeback)} of Ridgeback’s gas finds no buyer and Salt Flat sits idle with {bcfd(SOLVER_DEFAULTS.salt - NL_OUT.salt, 1)}{' '}
        ready to go. The region as a whole has gas to spare. Metro is short of it anyway.
      </P>
      <P>
        Whenever Metro is short, the map draws a line around it. Count what can cross that line: with Northline out, only the Valley Line and the link to Hollow
        Creek, {bcfd(VL.capacityBcfd + HOLLOW.maxWithdrawBcfd)} in all. However much gas there is outside, the city can burn no more than that. Every place has such a boundary, and the tightest boundary between supply and a
        customer sets the most that customer can get. That is the max-flow min-cut theorem, proved in the 1950s: the greatest flow through a network
        equals the smallest total capacity of any <b>cut</b> separating its sources from its sinks. In a gas network, the cut is where scarcity lives.
      </P>
      <P>
        It works in the other direction too. Choose the summer day and raise Ridgeback’s production to {bcfd(SUMMER_GLUT_STATE.ridgeback, 1)}. Its only outlets, Ridgeback
        Express and the Coastal Line, together with the basin’s own use, can take {bcfd(RIDGEBACK_OUTLETS)}; both pipes fill, and{' '}
        {bcfd(SUMMER_GLUT_STATE.ridgeback - SUMMER_GLUT.ridgeback)} of gas that someone drilled for is left with nowhere to go. Scarcity in one place and a glut in another
        are the same thing seen from opposite sides of a full pipe. A full pipe is also where prices come apart: gas on its far side becomes worth more than gas on
        its near side by more than the cost of the trip — what the caption means by a pipeline “holding the network back” — and{' '}
        <a href={lessonHref('gas/4.2')}>Lesson 4.2</a> turns that gap into the price difference between places.
      </P>

      <Challenge
        id="a"
        figure="Gas Network Solver"
        question={`Choose the design day. A day colder than the utility planned for would push Metro’s demand past the design day’s ${bcfd(DESIGN.metro, 1)}. Changing nothing else, what’s the most Metro can burn, to the nearest 0.05 Bcf/d, with every customer in the region still served? Predict it first by adding up what can cross the line around Metro, then check.`}
        solved={solved}
        status={status}
        success={`Solved: ${bcfd(METRO_PEAK)}. That is the cut around Metro: Northline and the Valley Line, full at ${bcfd(INTO_METRO)}, plus the ${bcfd(HOLLOW.maxWithdrawBcfd, 1)} Hollow Creek can send across it. Nothing outside it can help. Ask for ${bcfd(METRO_PEAK + 0.05)} and Metro goes short while Salt Flat, at the hub, still has ${bcfd(SALT.maxWithdrawBcfd - PAST_PEAK.salt)} it can’t get to the city.`}
      />

      <H2>Where the limits come from</H2>
      <P>
        Each of those capacities is a pressure limit in disguise. Chapter 1 showed that Northline’s {bcfd(NL.capacityBcfd, 1)} comes from pushing gas from{' '}
        {fmt(NL.maopPsig)} psig at each of its three compressor stations down to the {fmt(NL.minDeliveryPsig)} psig it promises Metro (
        <a href={lessonHref('gas/1.4')}>Lesson 1.4</a>). A pipeline’s capacity isn’t a property of the steel alone; it’s the flow at which friction uses up the whole
        pressure window. Widen the window and the capacity grows: a fourth station would lift Northline’s capacity to {bcfd(NL_FOUR_STATIONS)}, as{' '}
        <a href={lessonHref('gas/3.1')}>Lesson 3.1</a>’s challenge found.
      </P>
      <P>
        Without compressors, a network of pipes would split gas among its paths by itself, according to each path’s resistance, much as power divides among the lines of
        an electric grid (<a href={lessonHref('2.4')}>Lesson 2.4</a> of the electricity course). Compressor stations change that: by raising the pressure at the start of a
        line they choose how much goes down it, so long as every pressure stays inside its window. That’s why we could treat the region’s network in{' '}
        <FigRef to="Gas Network Solver">the first demonstration</FigRef> as pipes with capacities that operators fill as they see fit. Where gas does still divide by itself is between pipes laid side by side, a common way to expand a line. A
        second pipe along part of a route is called a <b>loop</b>.
      </P>
      <P>
        In the next demonstration, one of Northline’s three 80-mile segments has a loop beside part of its length; the same loop is laid in every segment. The
        diagram counts the gas in MMcf/d, millions of cubic feet a day, so Northline’s {bcfd(NL.capacityBcfd, 1)} is {fmt(NL.capacityBcfd * 1000)} MMcf/d. Choose the
        loop’s size and how much of each segment it covers. The chart shows Northline’s capacity for every share, with one curve for each size:
      </P>

      <Figure name="Gas Network Solver · looping" scenario={l}>
        <Segmented
          label="Loop size"
          value={l.state.size}
          onChange={(v) => l.set({ size: v })}
          options={LOOP_SIZES.map((d) => ({ value: `${d}` as `${LoopSize}`, label: `${d}-inch loop` }))}
        />
        <LoopDiagram size={size} share={share} flow={flow} hidden={capHidden} />
        <XYChart
          xDomain={[0, 100]}
          yDomain={[1.5, 3.75]}
          xTicks={[0, 25, 50, 75, 100]}
          yTicks={[1.5, 2, 2.5, 3, 3.5]}
          xFormat={(v) => `${v}%`}
          yFormat={(v) => fmt(v, 1)}
          yLabel="Northline’s capacity, Bcf/d"
          xLabel="share of each segment looped"
          height={220}
          series={curves.map((c) => ({
            xs: SHARES,
            ys: c.ys,
            color: c.d === size ? GRAPHIC.orange : '#c4c4c4',
            width: c.d === size ? 3 : 1.5,
            label: `${c.d}-inch`,
            labelColor: c.d === size ? TEXT.orange : TEXT.gray,
          }))}
          hLines={loopDone ? [{ at: LOOP_TARGET / 1000, color: '#777', dash: '5 4', label: `cold day without Hollow Creek, ${bcfd(LOOP_TARGET / 1000)}`, labelAt: 'start' }] : []}
          markers={[{ x: l.state.share, y: flow.total / 1000, color: GRAPHIC.orange, r: 6 }]}
          ariaLabel={`Northline’s capacity against the share of each segment looped, for 24-, 30- and 36-inch loops. With ${l.state.share}% looped by ${size}-inch pipe it is ${capHidden ? 'hidden until the challenge is solved' : `${fmt(flow.total / 1000, 2)} Bcf/d`}.`}
        />
        <Readouts
          items={[
            { label: capHidden ? 'Northline’s capacity (hidden until the challenge is solved)' : 'Northline’s capacity', value: capHidden ? '?' : bcfd(flow.total / 1000), tone: 'orange' },
            { label: 'through the loop, where there is one', value: share > 0 ? (capHidden ? pct(flow.inLoop / flow.total) : `${fmt(flow.inLoop)} MMcf/d · ${pct(flow.inLoop / flow.total)}`) : '—', tone: 'orange' },
            { label: 'new pipe and compression', value: share > 0 ? money(pipeCost + hpCost) : '$0', tone: 'green' },
          ]}
        />
        <Slider label="Share of each segment looped" value={l.state.share} min={0} max={100} step={5} onChange={(v) => l.set({ share: v })} display={`${l.state.share}% · ${fmt(extraMiles)} miles`} />
      </Figure>

      <P>
        Loop half of each segment with another 36-inch pipe and Northline’s capacity rises from {bcfd(BASE_CAP / 1000)} to {bcfd(HALF36.total / 1000)}, not to double.
        Where the two pipes run side by side they share the pressure drop, and since they are the same size each carries half, {fmt(HALF36.inLoop)} MMcf/d; but the
        unlooped half of the segment still carries the whole flow alone, and its friction now uses up most of the pressure window. Only a loop along the whole length
        doubles the line, to {bcfd(FULL36 / 1000)}. A smaller loop takes a smaller share — a 24-inch pipe beside the 36-inch one carries{' '}
        {pct(HALF24.inLoop / HALF24.total)} of the flow where they run together. Two pipes sharing the same pressure drop each carry a flow that grows with the 2.5
        power of its diameter, as in <a href={lessonHref('gas/1.3')}>Lesson 1.3</a>, so the wider pipe takes the larger share.
      </P>

      <Challenge
        id="b"
        figure="Gas Network Solver · looping"
        question={`On the cold winter day the region has just enough gas without Hollow Creek: its basins and Salt Flat can supply ${bcfd(SUPPLY_NO_HOLLOW, 1)}, exactly what it burns. A bigger Northline could stand in for the storage field if it carried ${bcfd(LOOP_TARGET / 1000)} — Metro’s ${bcfd(SOLVER_DEFAULTS.metro, 1)} less the Valley Line’s ${bcfd(VL.capacityBcfd)}. With 36-inch loops, what’s the smallest share of each segment, to the nearest 5%, that must be looped? Estimate first from the numbers just given: looping the first half of each segment adds ${bcfd((HALF36.total - BASE_CAP) / 1000)}, the second half ${bcfd((FULL36 - HALF36.total) / 1000)} more. What share would a straight line from unlooped to half-looped need — and should the answer be more than that, or less? Then set it to check: under half looped, Northline’s capacity stays hidden until you find it.`}
        solved={solvedLoop}
        status={loopStatus}
        success={`Solved: ${ANSWER_SHARE}%, or ${fmt(ANSWER_MILES)} miles of new 36-inch pipe, lifting Northline to ${bcfd(ANSWER_CAP / 1000)}; at ${ANSWER_SHARE - 5}% it would carry only ${bcfd(ANSWER_PREV_CAP / 1000)}. A straight line from unlooped to half-looped says about ${fmt(LOOP_LINEAR_SHARE)}%, but the curve sags under that line — a short loop still leaves most of each segment carrying the whole flow alone — so the share needed can only be more, and ${ANSWER_SHARE}% is the first step that makes it. At the course’s illustrative costs the pipe comes to about ${money(ANSWER_PIPE_COST)}, and the stations need about ${fmt(Math.round(ANSWER_HP / 1000) * 1000)} more horsepower to push the extra gas: about ${money(ANSWER_COST)} in all. A fourth compressor station would do it for less, ${money(NL_FOUR_COST)} for ${bcfd(NL_FOUR_STATIONS)}. Either way it’s hundreds of millions of dollars to replace the ${bcfd(WINTER.hollow)} Hollow Creek gives on a cold day — and on the design day no pipeline could replace it at all, since without it the region is ${bcfd(DESIGN_GAP)} short of gas itself (Lesson 3.1). That’s one reason cities keep storage close by.`}
      />

      <P>
        Every number in this lesson has been a daily rate, and a day has been treated as one smooth block of flow. Real demand isn’t smooth: Metro’s furnaces and
        power plants pull hardest in the morning and the evening, far faster than gas sent from Calder Hub hours earlier can follow. What bridges the gap is the gas
        already inside the pipe — the subject of <a href={lessonHref('gas/3.3')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
