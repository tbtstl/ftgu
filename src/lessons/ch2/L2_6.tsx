import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Controls,
  DataTable,
  Figure,
  H2,
  K,
  LessonPage,
  NetworkView,
  P,
  Readouts,
  Segmented,
  Slider,
  Tn,
  fmt,
  lessonHref,
  mw,
  pct,
  signed,
  usd,
  useScenario,
} from '../../framework';
import { islandFlows, runCascade, scanContingencies, type GridUnit } from '../../engines/ops/cascade';
import { regionCase } from '../../engines/ops/regionGrid';
import { dcopf } from '../../engines/market/opf';
import { STANDARD_FLEET } from '../../model/fleet';
import { REGION, nodeName } from '../../model/networks';

const lineName = (id: string) => {
  const l = REGION.lines.find((x) => x.id === id)!;
  return `${nodeName(REGION, l.from)}–${nodeName(REGION, l.to)}`;
};
const nodesList = (ids: string[]) => ids.map((id) => nodeName(REGION, id)).join(' and ');
const COST: Record<string, number> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, g.marginalCost]));
const VOLL = 1000;

const LABEL_OFFSET: Record<string, [number, number]> = {
  'north-center': [-40, -4],
  'north-east': [0, -12],
  'harbor-center': [-6, -14],
  'harbor-west': [44, -4],
  'west-center': [44, 6],
  'center-city': [35, -23],
  'east-city': [52, 6],
  'west-city': [10, 24],
};
const LABEL_POS: Record<string, 'above' | 'below' | 'left' | 'right'> = {
  north: 'above',
  east: 'above',
  center: 'right',
  harbor: 'below',
  west: 'below',
  city: 'right',
};

// ---------------------------------------------------------------------------------------------
// Figure 1: the evening peak, some lines out, maybe a plant tripped, and three ways to dispatch.

type Mode = 'merit' | 'redispatch' | 'secure';
type Trip = 'none' | 'nuc' | 'cc1' | 'coal';

export interface SecurityState {
  out: string[];
  trip: Trip;
  mode: Mode;
}

export function securityCase(s: SecurityState) {
  const rc = regionCase({ plantOutages: s.trip === 'none' ? [] : [s.trip] });
  let units: GridUnit[] = rc.units;
  let loads = rc.loads;
  let feasible = true;
  if (s.mode !== 'merit') {
    const inService = REGION.lines.map((l) => l.id).filter((id) => !s.out.includes(id));
    const r = dcopf(
      REGION,
      rc.units.map((u) => ({ id: u.id, node: u.node, capacity: u.capacity, offer: COST[u.id] })),
      rc.loads,
      { outages: s.out, contingencies: s.mode === 'secure' ? inService : undefined, voll: VOLL, lmp: false },
    );
    feasible = r.feasible;
    if (r.feasible) {
      units = rc.units.map((u) => ({ ...u, output: r.dispatch[u.id] }));
      loads = Object.fromEntries(Object.entries(rc.loads).map(([n, v]) => [n, v - (r.shed[n] ?? 0)]));
    }
  }
  const st = islandFlows(REGION, units, loads, s.out);
  const shed = Object.keys(rc.loads).reduce((t, n) => t + (rc.loads[n] - st.served[n]), 0);
  const scan = scanContingencies(REGION, units.map((u) => ({ ...u, output: st.output[u.id] })), st.served, s.out);
  const cost = units.reduce((t, u) => t + st.output[u.id] * COST[u.id], 0);
  return { rc, st, shed: shed < 0.5 ? 0 : shed, scan, cost, feasible };
}

/** Running cost at the evening peak in merit order and with an N-1 secure dispatch, $/h. */
export const MERIT_COST = securityCase({ out: [], trip: 'none', mode: 'merit' }).cost;
export const SECURE_COST = securityCase({ out: [], trip: 'none', mode: 'secure' }).cost;

// ---------------------------------------------------------------------------------------------
// Figure 2: a double outage, a cascade, and the reader's preventive redispatch.

export const STORM = ['east-city', 'west-city'];
export const STORM_RANGE = { cc2: [0, 250], oil: [0, 80], ct: [0, 200] } as const;

export interface CascadeState {
  out: string[];
  cc2: number;
  oil: number;
  ct: number;
  stage: number;
}

export function cascadeCase(s: CascadeState) {
  const rc = regionCase({ fixed: { cc2: s.cc2, oil: s.oil, ct: s.ct } });
  const steps = runCascade(REGION, rc.units, rc.loads, s.out);
  return { rc, steps, final: steps[steps.length - 1] };
}

/** Every customer still supplied after the storm, with no line above its rating. */
export function stormSolved(s: CascadeState): boolean {
  if (s.out.length !== STORM.length || !STORM.every((id) => s.out.includes(id))) return false;
  const { final, steps } = cascadeCase(s);
  return steps.length === 1 && final.shedTotal < 0.5 && Object.values(final.loading).every((u) => u <= 1 + 1e-9);
}

export default function Lesson() {
  const s1 = useScenario<SecurityState>('security', { out: [], trip: 'none', mode: 'merit' });
  const c1 = useMemo(() => securityCase(s1.state), [s1.state]);
  const failing = c1.scan.filter((r) => !r.ok);
  const toggle1 = (id: string) => s1.set((p) => ({ out: p.out.includes(id) ? p.out.filter((x) => x !== id) : [...p.out, id] }));

  const s2 = useScenario<CascadeState>('cascade', { out: [...STORM], cc2: 50, oil: 0, ct: 0, stage: 0 });
  const c2 = useMemo(() => cascadeCase(s2.state), [s2.state]);
  const stage = Math.min(s2.state.stage, c2.steps.length - 1);
  const at = c2.steps[stage];
  const solved = stormSolved(s2.state);
  const lost = c2.final.outages.length - s2.state.out.length;
  const toggle2 = (id: string) => s2.set((p) => ({ out: p.out.includes(id) ? p.out.filter((x) => x !== id) : [...p.out, id], stage: 0 }));
  const isStorm = s2.state.out.length === STORM.length && STORM.every((id) => s2.state.out.includes(id));
  const lakeside = c2.rc.output.cc1 ?? 0;

  let cap2: string;
  if (!s2.state.out.length) cap2 = 'No lines are out. Click lines on the map to take them out of service.';
  else if (at.tripping.length)
    cap2 = `${stage === 0 ? `With ${s2.state.out.map(lineName).join(' and ')} out` : `After stage ${stage}`}, ${at.tripping.map((id) => `${lineName(id)} is at ${pct(at.loading[id])}`).join(' and ')} of its rating — past the 120% at which it trips.${at.shedTotal > 0.5 ? ` ${mw(at.shedTotal)} of demand is already cut off.` : ''}`;
  else if (at.shedTotal > 0.5)
    cap2 = `${c2.steps.length > 1 ? 'The cascade has stopped, but the' : 'The'} network is in ${at.islands.length} pieces, and ${mw(at.shedTotal)} of demand in ${nodesList(Object.keys(at.shed).filter((n) => at.shed[n] > 0.5))} has nothing to supply it.`;
  else {
    const over = Object.entries(at.loading).filter(([, u]) => u > 1 + 1e-9);
    cap2 = over.length
      ? `Nothing trips, but ${over.map(([id, u]) => `${lineName(id)} is at ${pct(u)}`).join(' and ')} of its rating: overloaded, and heating.`
      : 'Every customer is supplied and every line is within its rating.';
  }

  return (
    <LessonPage id="2.6">
      <P>
        Lines are struck by lightning and brushed by trees, transformers fail, and generators trip offline without warning. On a grid with thousands of components,
        something is always broken somewhere. A reliable grid isn’t one where nothing fails; it’s one where failures don’t reach customers.
      </P>
      <P>
        We met the standard yardstick in <a href={lessonHref('2.3')}>Lesson 2.3</a>: the <b>N-1 criterion</b>. Applied to the transmission grid, it says the system must
        survive the loss of any single element — any line, transformer or generator — without overloading anything else and without disconnecting customers. Grid
        operators in North America and Europe plan and operate their systems to versions of this rule. To check it, their control-room software runs a{' '}
        <b>contingency analysis</b> every few minutes: it removes each element in turn from a model of the grid, recomputes the flows, and flags every case that would
        leave something overloaded.
      </P>
      <P>
        Here is the region at the 7 p.m. peak, dispatched in merit order as in the previous lesson. The table runs the contingency analysis: for each line still in
        service, what would happen if it tripped next. Click lines on the map to take them out, trip a power plant, or change how the operator dispatches:
      </P>

      <Figure name="Grid Failure Simulator" scenario={s1}>
        <Segmented
          label="Dispatch"
          value={s1.state.mode}
          onChange={(mode) => s1.set({ mode })}
          options={[
            { value: 'merit', label: 'Merit order' },
            { value: 'redispatch', label: 'Redispatch' },
            { value: 'secure', label: 'N-1 secure' },
          ]}
        />
        <Segmented
          label="Trip a power plant"
          value={s1.state.trip}
          onChange={(trip) => s1.set({ trip })}
          options={[
            { value: 'none', label: 'No trip' },
            { value: 'nuc', label: 'Harbor Point' },
            { value: 'cc1', label: 'Lakeside' },
            { value: 'coal', label: 'Ironwood' },
          ]}
        />
        <NetworkView
          ariaLabel={`The region at the evening peak with ${s1.state.out.length} line${s1.state.out.length === 1 ? '' : 's'} out. ${failing.length} of ${c1.scan.length} single-line outages would overload a line or cut off customers.`}
          width={600}
          height={410}
          flowScale={0.12}
          onLineClick={toggle1}
          nodes={REGION.nodes.map((n) => {
            const v = c1.rc.units.filter((u) => u.node === n.id).reduce((t, u) => t + c1.st.output[u.id], 0) - c1.st.served[n.id];
            const cut = c1.rc.loads[n.id] - c1.st.served[n.id];
            return {
              id: n.id,
              x: n.x,
              y: n.y,
              r: 31,
              label: n.name,
              labelPos: LABEL_POS[n.id],
              value: signed(v),
              sub: cut > 0.5 ? `${fmt(cut)} MW cut` : 'MW net',
              fill: cut > 0.5 ? '#f6d2cf' : '#fff',
            };
          })}
          lines={REGION.lines.map((l) => ({
            id: l.id,
            from: l.from,
            to: l.to,
            flow: c1.st.flows[l.id],
            limit: l.limit,
            out: s1.state.out.includes(l.id),
            label: s1.state.out.includes(l.id) ? 'out' : `${fmt(Math.abs(c1.st.flows[l.id]))} / ${fmt(l.limit)}`,
            labelDx: LABEL_OFFSET[l.id][0],
            labelDy: LABEL_OFFSET[l.id][1],
          }))}
        />
        <Readouts
          items={[
            { label: 'single line outages survived', value: `${c1.scan.length - failing.length} of ${c1.scan.length}`, tone: failing.length ? 'red' : 'green' },
            { label: 'running cost per hour', value: usd(c1.cost), tone: 'green' },
            { label: 'demand cut off', value: mw(c1.shed), tone: c1.shed > 0 ? 'red' : undefined },
          ]}
        />
        <DataTable
          caption="Contingency analysis: the state after each line still in service trips"
          rows={c1.scan}
          rowKey={(r) => r.outage}
          rowClass={(r) => (r.ok ? '' : 'hl')}
          columns={[
            { label: 'If this line trips', cell: (r) => lineName(r.outage) },
            { label: 'Most loaded line afterwards', cell: (r) => (r.worst ? `${lineName(r.worst.line)} · ${pct(r.worst.loading)}` : '—') },
            {
              label: 'Result',
              cell: (r) =>
                r.ok ? (
                  r.separated.length ? (
                    `${nodesList(r.separated)} separated, still supplied`
                  ) : (
                    'secure'
                  )
                ) : (
                  <Tn tone="red">
                    {[
                      r.overloads.length ? `${r.overloads.length} overloaded` : '',
                      r.separated.length ? `${nodesList(r.separated)} separated` : '',
                      r.shed > 0.5 ? `${fmt(r.shed)} MW cut off` : '',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </Tn>
                ),
            },
          ]}
        />
        {!c1.feasible && <Caption>The optimizer found no feasible dispatch; showing the merit order instead.</Caption>}
      </Figure>

      <P>
        With every line in service, the merit-order dispatch passes the base case but fails the N-1 test four times: losing North–East, Harbor–Central or West–Metro
        each overloads one line by a few percent, and losing Central–Metro overloads two badly, as we found in the previous lesson. Tripping a plant is less dramatic
        than you might expect. Lose Lakeside, the region’s largest gas plant, and Mill Creek and Eastgate make up its output; demand is still met. What changes is where
        the power comes from, and so how it flows.
      </P>
      <P>
        Switch the dispatch to <b>Redispatch</b> and the operator uses the optimizer of <a href={lessonHref('5.1')}>Chapter 5</a> to find the cheapest dispatch that keeps
        every line within its rating as the network stands. With every line in service, that’s the merit order itself; with a line out, it moves generation around until
        the overloads disappear. That is <b>corrective</b> action, taken after an outage. <b>N-1 secure</b> goes further: it chooses a dispatch that would leave every
        line within its rating after any one more outage, before that outage happens. At the evening peak this <b>preventive</b> security costs {usd(SECURE_COST)} an hour
        rather than {usd(MERIT_COST)}, a third more, because Ironwood’s cheap coal in the West is replaced by Mill Creek and Eastgate, which sit in and near Metro, where
        their power doesn’t have to cross the lines that might fail.
      </P>
      <P>
        Now take out both lines into the North. North becomes an <b>island</b>: a piece of the grid with no connection to the rest. An island has to balance on its own,
        so Falls and Ridge back down to the North’s 72 MW of demand, while the rest of the region makes up what they had been exporting. Cut all three lines into Metro,
        and Metro becomes an island with only Mill Creek and Old Quay, 330 MW, for 792 MW of demand. The difference has to be <K c="power">shed</K>: customers are
        disconnected, deliberately, so that the rest can stay on. The optimizer treats shed demand as the most expensive “generator” there is, priced at the value of
        lost load — {usd(VOLL)} per megawatt-hour in our model, though real estimates are often far higher — so it sheds only what it must.
      </P>

      <H2>Cascades</H2>
      <P>
        What if an overload isn’t relieved? A line carrying more than its rating doesn’t fail at once: it heats up over minutes, sags, and eventually trips, either when
        protection equipment acts or when it sags into something. Its flow then moves to the remaining lines, which may overload in turn. This is a <b>cascading
        failure</b>, and it is how many of the largest blackouts have unfolded. On August 14, 2003, a cascade that began with overloaded lines sagging into trees in Ohio
        left about 50 million people in the northeastern and midwestern United States and Ontario without power.
      </P>
      <P>
        The next demonstration uses a deliberately simple model of a cascade: any line loaded beyond 120% of its rating trips; the flows are recalculated, islands balance as
        best they can, and the process repeats until nothing more trips. A storm has taken out both 230 kV lines into Metro, East–Metro and West–Metro. Drag the stage
        slider to watch what follows:
      </P>

      <Figure name="Grid Failure Simulator · cascade" scenario={s2}>
        <NetworkView
          ariaLabel={`Cascade, stage ${stage} of ${c2.steps.length - 1}. Lines out: ${at.outages.map(lineName).join(', ') || 'none'}. ${mw(at.shedTotal)} of demand cut off.`}
          width={600}
          height={410}
          flowScale={0.12}
          onLineClick={toggle2}
          nodes={REGION.nodes.map((n) => {
            const v = c2.rc.units.filter((u) => u.node === n.id).reduce((t, u) => t + at.output[u.id], 0) - at.served[n.id];
            const cut = at.shed[n.id];
            return {
              id: n.id,
              x: n.x,
              y: n.y,
              r: 31,
              label: n.name,
              labelPos: LABEL_POS[n.id],
              value: signed(v),
              sub: cut > 0.5 ? `${fmt(cut)} MW cut` : 'MW net',
              fill: cut > 0.5 ? '#f6d2cf' : '#fff',
              dead: cut > 0.5,
            };
          })}
          lines={REGION.lines.map((l) => {
            const isOut = at.outages.includes(l.id);
            const trips = at.tripping.includes(l.id);
            return {
              id: l.id,
              from: l.from,
              to: l.to,
              flow: at.flows[l.id],
              limit: l.limit,
              out: isOut,
              label: isOut ? (s2.state.out.includes(l.id) ? 'out' : 'tripped') : `${fmt(Math.abs(at.flows[l.id]))} / ${fmt(l.limit)}${trips ? ' · trips' : ''}`,
              labelDx: LABEL_OFFSET[l.id][0],
              labelDy: LABEL_OFFSET[l.id][1],
            };
          })}
        />
        <Caption>{cap2}</Caption>
        <Slider
          label="Stage of the cascade"
          value={stage}
          min={0}
          max={Math.max(0, c2.steps.length - 1)}
          onChange={(v) => s2.set({ stage: v })}
          display={c2.steps.length > 1 ? `${stage} of ${c2.steps.length - 1}` : 'nothing trips'}
          disabled={c2.steps.length < 2}
        />
        <Controls columns={2}>
          <Slider
            label="Mill Creek (Metro)"
            tone="red"
            value={s2.state.cc2}
            min={STORM_RANGE.cc2[0]}
            max={STORM_RANGE.cc2[1]}
            step={10}
            onChange={(v) => s2.set({ cc2: v, stage: 0 })}
            display={`${mw(s2.state.cc2)} · $${COST.cc2}/MWh`}
          />
          <Slider
            label="Old Quay oil (Metro)"
            tone="red"
            value={s2.state.oil}
            min={STORM_RANGE.oil[0]}
            max={STORM_RANGE.oil[1]}
            step={10}
            onChange={(v) => s2.set({ oil: v, stage: 0 })}
            display={`${mw(s2.state.oil)} · $${COST.oil}/MWh`}
          />
          <Slider
            label="Eastgate peaker (East)"
            tone="red"
            value={s2.state.ct}
            min={STORM_RANGE.ct[0]}
            max={STORM_RANGE.ct[1]}
            step={10}
            onChange={(v) => s2.set({ ct: v, stage: 0 })}
            display={`${mw(s2.state.ct)} · $${COST.ct}/MWh`}
          />
        </Controls>
        <Readouts
          items={[
            { label: 'lines tripped by the cascade', value: String(lost), tone: lost ? 'red' : undefined },
            { label: 'demand cut off in the end', value: mw(c2.final.shedTotal), tone: c2.final.shedTotal > 0.5 ? 'red' : undefined },
            { label: 'Lakeside follows, at', value: mw(lakeside) },
            { label: 'running cost per hour', value: usd(c2.rc.cost), tone: 'green' },
          ]}
        />
      </Figure>

      <P>
        With the storm’s two lines gone, everything Metro imports — 742 MW — has to come over Central–Metro, rated 600 MW. At 124% of its rating it trips, and Metro is
        an island with just Mill Creek and Old Quay. Even running flat out they produce 330 MW against Metro’s 792, and 462 MW of demand, well over half of Metro’s, is
        cut off. Try clicking the map: Central–Metro on its own sets off a cascade too, tripping West–Metro and North–East and leaving Metro and East together as an island
        406 MW short.
      </P>
      <P>
        The sliders set Metro’s and East’s plants by hand, before the storm arrives; the other plants follow the merit order, with Lakeside taking up the slack. This is
        how operators prepare when they know two lines are at risk together — from a storm, a wildfire, or two circuits sharing the same towers.
      </P>
      <Challenge
        id="a"
        question="Before the storm takes out East–Metro and West–Metro, set the plants so that afterwards every customer is still supplied and no line is above its rating."
        solved={solved}
        status={
          !isStorm
            ? 'Put the storm back: exactly East–Metro and West–Metro out.'
            : c2.final.shedTotal > 0.5
              ? `Right now the storm leads to ${mw(c2.final.shedTotal)} of demand being cut off.`
              : `No one is cut off, but ${Object.entries(c2.final.loading)
                  .filter(([, u]) => u > 1 + 1e-9)
                  .map(([id, u]) => `${lineName(id)} is at ${pct(u)}`)
                  .join(' and ')} of its rating.`
        }
        success={`Solved. With ${mw(s2.state.cc2 + s2.state.oil)} produced inside Metro, Central–Metro carries ${mw(Math.abs(c2.final.flows['center-city']))} after the storm, ${pct(c2.final.loading['center-city'])} of its rating. The running cost is ${usd(c2.rc.cost)} an hour, against ${usd(MERIT_COST)} for the merit order.`}
      />
      <P>
        Eastgate can’t help: once East–Metro is down, the East has no direct road into Metro. What works is generation inside Metro itself. Run Mill Creek at 200 MW
        instead of 50 and Central–Metro has to bring in only 592 MW, just within its rating, for about $900 an hour more than the merit order. That is the general lesson:
        generation inside a load pocket like Metro is insurance against losing the lines into it, which is why grid operators sometimes pay plants in such places to stay
        available even when the market alone wouldn’t keep them running.
      </P>
      <P>
        Our cascade model is crude — real lines trip on timescales from seconds to tens of minutes, and generators trip too when frequency and voltage swing — but the
        logic is the real one. A grid survives failures through redundancy in its lines, spare capacity in its plants, and operators who keep the system in a state from
        which the next failure can be absorbed. Keeping it in that state is a continuous job, second by second and hour by hour. That job — operating the grid — is
        the subject of Chapter 3.
      </P>
    </LessonPage>
  );
}
