import {
  Caption,
  Challenge,
  Checkbox,
  DataTable,
  Eq,
  FUEL,
  Figure,
  H2,
  K,
  LessonPage,
  NetworkView,
  Op,
  P,
  Readouts,
  Slider,
  Sub,
  Swatch,
  Tn,
  fmt,
  lessonHref,
  mw,
  pct,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { dcopf } from '../../engines/market/opf';
import {
  boundarySegment,
  checkDispatch,
  dispatchPlane,
  feasiblePolygon,
  fleetOffers,
  meritOrderDispatch,
  nearestVertex,
  nodalLoads,
  satisfies,
  vertexWalk,
  violated,
  type Pt,
} from '../../engines/market/networkDispatch';
import { STANDARD_FLEET, fleetById } from '../../model/fleet';
import { REGION, REGION_LOAD_SHARE, nodeName } from '../../model/networks';
import { SYSTEM_DEMAND } from '../../model/profiles';

// A windy evening at the 19:00 peak, with line North–East out for maintenance.
const DEMAND = SYSTEM_DEMAND[19];
const OUT = 'north-east';
const GENS = fleetOffers(STANDARD_FLEET, { windCF: 1, solarCF: 0 });
const LOADS = nodalLoads(DEMAND, REGION_LOAD_SHARE);
const OPT = dcopf(REGION, GENS, LOADS, { outages: [OUT], lmp: false });
const MERIT = meritOrderDispatch(GENS, DEMAND);
const MERIT_CHECK = checkDispatch(REGION, GENS, MERIT, LOADS, { outages: [OUT] });
const FIXED = { nuc: 400, wind: 350, solar: 0 };
const BALANCE = 'cc1';
const LAKESIDE_MAX = fleetById('cc1').capacity;

type HandId = 'coal' | 'hydro' | 'cc2' | 'ct' | 'oil';
const HAND: Array<{ id: HandId; short: string; min: number }> = [
  { id: 'coal', short: 'Ironwood coal', min: 120 },
  { id: 'hydro', short: 'Falls hydro', min: 0 },
  { id: 'cc2', short: 'Mill Creek', min: 0 },
  { id: 'ct', short: 'Eastgate peaker', min: 0 },
  { id: 'oil', short: 'Old Quay oil', min: 0 },
];

function lineName(id: string) {
  const l = REGION.lines.find((x) => x.id === id)!;
  return `${nodeName(REGION, l.from)}–${nodeName(REGION, l.to)}`;
}

function handDispatch(s: Record<HandId, number>): Record<string, number> {
  const rest = HAND.reduce((t, h) => t + s[h.id], 0);
  return { ...FIXED, ...s, [BALANCE]: DEMAND - FIXED.nuc - FIXED.wind - rest };
}

/** Short plant labels drawn next to each substation. */
const PLANT_TEXT: Record<string, { x: number; y: number; anchor: 'start' | 'middle' | 'end'; ids: string[] }> = {
  north: { x: 22, y: 116, anchor: 'start', ids: ['hydro', 'wind'] },
  east: { x: 492, y: 116, anchor: 'start', ids: ['ct', 'solar'] },
  center: { x: 340, y: 160, anchor: 'start', ids: ['cc1'] },
  harbor: { x: 22, y: 304, anchor: 'start', ids: ['nuc'] },
  west: { x: 190, y: 346, anchor: 'end', ids: ['coal'] },
  city: { x: 510, y: 336, anchor: 'middle', ids: ['cc2', 'oil'] },
};
const SHORT: Record<string, string> = {
  nuc: 'Harbor Point',
  coal: 'Ironwood',
  cc1: 'Lakeside',
  cc2: 'Mill Creek',
  ct: 'Eastgate',
  oil: 'Old Quay',
  hydro: 'Falls hydro',
  wind: 'Ridge wind',
  solar: 'Valley solar',
};

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

function RegionDispatchMap({ dispatch, flows, ariaLabel }: { dispatch: Record<string, number>; flows: Record<string, number>; ariaLabel: string }) {
  return (
    <NetworkView
      ariaLabel={ariaLabel}
      width={600}
      height={408}
      nodes={REGION.nodes.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        r: 30,
        label: n.name,
        labelPos: n.id === 'west' ? 'below' : n.id === 'city' ? 'right' : 'above',
        value: fmt(LOADS[n.id] ?? 0),
        sub: 'MW load',
        fill: '#fff',
      }))}
      lines={REGION.lines.map((l) => {
        const out = l.id === OUT;
        const [dx, dy] = LABEL_OFFSET[l.id] ?? [0, -10];
        return {
          id: l.id,
          from: l.from,
          to: l.to,
          flow: out ? 0 : flows[l.id],
          limit: l.limit,
          out,
          label: out ? 'out for maintenance' : `${fmt(Math.abs(flows[l.id]))} / ${fmt(l.limit)}`,
          labelDx: dx,
          labelDy: dy,
        };
      })}
    >
      {Object.values(PLANT_TEXT).map((t) =>
        t.ids.map((id, i) => {
          const v = dispatch[id] ?? 0;
          const bad = id === BALANCE && (v < -1e-6 || v > LAKESIDE_MAX + 1e-6);
          return (
            <text key={id} x={t.x} y={t.y + i * 16} textAnchor={t.anchor} style={{ fontSize: 12, fill: bad ? '#c4382f' : '#444' }}>
              <tspan style={{ fontWeight: 500 }}>{SHORT[id]}</tspan> {fmt(v)} MW
            </text>
          );
        }),
      )}
    </NetworkView>
  );
}

// ---------------------------------------------------------------------------
// The solver's view: Ironwood vs. Mill Creek, Lakeside balancing, everything else as optimized.

const PLANE = dispatchPlane(REGION, GENS, LOADS, OPT.dispatch, 'coal', 'cc2', BALANCE, { outages: [OUT] });
const POLY = feasiblePolygon(PLANE.box, PLANE.constraints);
const planeCost = (p: Pt) => PLANE.cost.c0 + PLANE.cost.cx * p[0] + PLANE.cost.cy * p[1];
const BEST = POLY.reduce((b, p) => (planeCost(p) < planeCost(b) ? p : b), POLY[0]);
const PX = scale(PLANE.box[0], PLANE.box[1], 80, 560);
const PY = scale(PLANE.box[2], PLANE.box[3], 372, 42);
const CONSTRAINT_LABEL: Record<string, string> = {
  'center-city:max': 'Central–Metro full',
  'west-city:max': 'West–Metro full',
  'balance:min': 'Lakeside at 0 MW',
  'balance:max': 'Lakeside at 400 MW',
};
/** Constraints that form an edge of the feasible polygon (both ends of the edge on the line). */
const EDGES = PLANE.constraints.filter((h) =>
  POLY.some((p, i) => {
    const q = POLY[(i + 1) % POLY.length];
    const on = (r: Pt) => Math.abs(h.a * r[0] + h.b * r[1] - h.c) < 1e-6 * (1 + Math.abs(h.c));
    return on(p) && on(q);
  }),
);
/** Where to put each edge's label: fraction along the drawn segment, pixel offset, anchor. */
const LABEL_AT: Record<string, { t: number; dx: number; dy: number; anchor: 'start' | 'end' }> = {
  'center-city:max': { t: 0.2, dx: 4, dy: -10, anchor: 'start' },
  'west-city:max': { t: 0.3, dx: -10, dy: -6, anchor: 'end' },
  'balance:min': { t: 0, dx: -8, dy: 18, anchor: 'end' },
  'balance:max': { t: 0.5, dx: 6, dy: -8, anchor: 'start' },
};

function SolverView({ coal, cc2, showPath }: { coal: number; cc2: number; showPath: boolean }) {
  const p: Pt = [coal, cc2];
  const ok = satisfies(p, PLANE.constraints);
  const path = showPath && POLY.length ? vertexWalk(POLY, planeCost, nearestVertex(POLY, p)) : [];
  const drawn = EDGES.map((h) => ({ h, seg: boundarySegment(h, PLANE.box) })).filter(
    (d): d is { h: (typeof PLANE.constraints)[number]; seg: [Pt, Pt] } => !!d.seg && !!CONSTRAINT_LABEL[d.h.id],
  );
  const isoCosts = [23500, 24000, 24500, 25000, 25500, 26000, 26500];
  const iso = (k: number) => boundarySegment({ a: PLANE.cost.cx, b: PLANE.cost.cy, c: k - PLANE.cost.c0, id: 'iso' }, PLANE.box);
  const bestIso = iso(planeCost(BEST));
  const labelAt = (seg: [Pt, Pt], t: number): Pt => [seg[0][0] + t * (seg[1][0] - seg[0][0]), seg[0][1] + t * (seg[1][1] - seg[0][1])];
  const xTicks = [120, 150, 180, 210, 240, 270, 300];
  const yTicks = [0, 50, 100, 150, 200, 250];
  return (
    <svg
      className="chart"
      viewBox="0 0 600 420"
      role="img"
      aria-label={`Dispatch plane: Ironwood coal ${coal} MW on the horizontal axis, Mill Creek ${cc2} MW on the vertical. This dispatch is ${ok ? 'feasible' : 'not feasible'}. The cheapest feasible corner is Ironwood ${fmt(BEST[0])} MW and Mill Creek ${fmt(BEST[1])} MW.`}
    >
      <defs>
        <clipPath id="l51-box">
          <rect x={PX(PLANE.box[0])} y={PY(PLANE.box[3])} width={PX(PLANE.box[1]) - PX(PLANE.box[0])} height={PY(PLANE.box[2]) - PY(PLANE.box[3])} />
        </clipPath>
        <marker id="l51-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#2f6fb3" />
        </marker>
      </defs>
      <rect x={PX(PLANE.box[0])} y={PY(PLANE.box[3])} width={PX(PLANE.box[1]) - PX(PLANE.box[0])} height={PY(PLANE.box[2]) - PY(PLANE.box[3])} fill="#f3dfdc" />
      {POLY.length > 0 && <path d={'M' + POLY.map((q) => `${PX(q[0])} ${PY(q[1])}`).join(' L') + ' Z'} fill="#fbfbf7" stroke="#6d9c37" strokeWidth={2} />}
      <g clipPath="url(#l51-box)">
        {isoCosts.map((k) => {
          const s = iso(k);
          return s ? <line key={k} x1={PX(s[0][0])} y1={PY(s[0][1])} x2={PX(s[1][0])} y2={PY(s[1][1])} stroke="#9a9a9a" strokeWidth={1} strokeDasharray="3 5" /> : null;
        })}
        {bestIso && <line x1={PX(bestIso[0][0])} y1={PY(bestIso[0][1])} x2={PX(bestIso[1][0])} y2={PY(bestIso[1][1])} stroke="#3f7a1e" strokeWidth={1.5} strokeDasharray="6 4" />}
        {drawn.map(({ h, seg }) => (
          <line key={h.id} x1={PX(seg[0][0])} y1={PY(seg[0][1])} x2={PX(seg[1][0])} y2={PY(seg[1][1])} stroke="#b8302a" strokeWidth={1.5} opacity={0.7} />
        ))}
      </g>
      {drawn.map(({ h, seg }) => {
        const at = LABEL_AT[h.id] ?? { t: 0.5, dx: 6, dy: -8, anchor: 'start' };
        // Draw from the end of the segment that lies higher on the chart for consistent placement.
        const s2: [Pt, Pt] = seg[0][1] >= seg[1][1] ? seg : [seg[1], seg[0]];
        const q = labelAt(s2, at.t);
        return (
          <text
            key={h.id}
            className="lab"
            x={PX(q[0]) + at.dx}
            y={PY(q[1]) + at.dy}
            textAnchor={at.anchor}
            style={{ fill: '#a8403b', paintOrder: 'stroke', stroke: '#fbfbf7', strokeWidth: 4 }}
          >
            {CONSTRAINT_LABEL[h.id]}
          </text>
        );
      })}
      {yTicks.map((t) => (
        <g key={t}>
          <line className="gl" x1={PX(PLANE.box[0]) - 4} x2={PX(PLANE.box[0])} y1={PY(t)} y2={PY(t)} />
          <text className="ax ax-e" x={PX(PLANE.box[0]) - 8} y={PY(t) + 4}>
            {t}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={t} className="ax ax-m" x={PX(t)} y={392}>
          {t}
        </text>
      ))}
      <text className="ax" x={PX(PLANE.box[0])} y={26}>
        Mill Creek, MW
      </text>
      <text className="ax ax-e" x={PX(PLANE.box[1])} y={412}>
        Ironwood coal, MW
      </text>
      <text x={PX(PLANE.box[1])} y={26} textAnchor="end" className="ax">
        dashed lines join dispatches of equal cost
      </text>
      {path.slice(1).map((q, i) => {
        const a = path[i];
        const x1 = PX(a[0]);
        const y1 = PY(a[1]);
        const x2 = PX(q[0]);
        const y2 = PY(q[1]);
        const len = Math.hypot(x2 - x1, y2 - y1);
        const k = len > 24 ? (len - 12) / len : 1;
        return (
          <line key={i} x1={x1} y1={y1} x2={x1 + (x2 - x1) * k} y2={y1 + (y2 - y1) * k} stroke="#2f6fb3" strokeWidth={2.5} markerEnd="url(#l51-arrow)" />
        );
      })}
      {path.map((q, i) => (
        <circle key={i} cx={PX(q[0])} cy={PY(q[1])} r={4} fill="#2f6fb3" />
      ))}
      {BEST && (
        <g>
          <circle cx={PX(BEST[0])} cy={PY(BEST[1])} r={8} fill="#6d9c37" stroke="#f8f8f8" strokeWidth={2} />
          <text x={PX(BEST[0]) - 14} y={PY(BEST[1]) - 14} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: '#3f7a1e', paintOrder: 'stroke', stroke: '#fbfbf7', strokeWidth: 4 }}>
            cheapest: {usd(planeCost(BEST))} an hour
          </text>
        </g>
      )}
      <circle cx={PX(coal)} cy={PY(cc2)} r={7} fill={ok ? '#d0702a' : '#f8f8f8'} stroke="#d0702a" strokeWidth={3} />
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('hand-dispatch', { coal: MERIT.coal, hydro: MERIT.hydro, cc2: MERIT.cc2, ct: MERIT.ct, oil: MERIT.oil, compare: false });
  const hand = { coal: s.state.coal, hydro: s.state.hydro, cc2: s.state.cc2, ct: s.state.ct, oil: s.state.oil };
  const dispatch = handDispatch(hand);
  const lakeside = dispatch[BALANCE];
  const lakesideOk = lakeside >= -1e-6 && lakeside <= LAKESIDE_MAX + 1e-6;
  const chk = checkDispatch(REGION, GENS, dispatch, LOADS, { outages: [OUT] });
  const over = chk.overloads;
  const gap = chk.cost / OPT.cost - 1;
  const solved = lakesideOk && over.length === 0 && gap <= 0.01;

  let caption: string;
  if (!lakesideOk) caption = `Lakeside would have to produce ${mw(lakeside)} to balance supply and demand, outside its 0–${LAKESIDE_MAX} MW range.`;
  else if (over.length)
    caption =
      over.map((o) => `${lineName(o.id)} carries ${fmt(Math.abs(o.flow))} MW against a limit of ${fmt(o.limit)}`).join('; ') +
      '. The operator can’t run the grid like this.';
  else caption = `No line is overloaded. This dispatch costs ${usd(chk.cost)} an hour, ${pct(Math.max(0, gap), 1)} more than the cheapest one that the wires can carry.`;

  const t = useScenario('solver-view', { coal: MERIT.coal, cc2: MERIT.cc2, path: false });
  const p2: Pt = [t.state.coal, t.state.cc2];
  const ok2 = satisfies(p2, PLANE.constraints);
  const bad2 = violated(p2, PLANE.constraints);
  const lakeside2 = PLANE.balance.b0 - t.state.coal - t.state.cc2;

  const rows = [...GENS].filter((g) => g.capacity > 0).sort((a, b) => a.offer - b.offer);

  return (
    <LessonPage id="5.1">
      <P>
        In Chapter 4, the grid operator ran an auction: sort the offers, accept the cheapest until demand is met, and pay everyone the price of the last one accepted. That
        auction never asked where anything was. It treated the grid as a single point, where any plant could serve any customer.
      </P>
      <P>
        Chapter 2 showed why that can’t always work. Power can’t be sent down a wire of our choosing: it divides across every available path, and each line can carry only
        so much before it overheats. The cheapest dispatch on paper may be one that the wires can’t deliver. So the operator’s real job has two halves — meet demand at the
        lowest cost, and keep every line within its limit — and the second half changes the first.
      </P>
      <P>
        Here is our region at the 19:00 peak on a windy evening. Demand is {mw(DEMAND)}, more than half of it in Metro, and Ridge wind is producing its full 350 MW. Line
        North–East is out for maintenance. The sliders start at the merit order from Chapter 4: wind, nuclear, hydro and coal flat out, and the Lakeside combined-cycle plant
        making up the rest. Lakeside follows your changes automatically, so supply always equals demand. Lines are drawn orange as they near their limits and red past
        them. Try to find a dispatch that overloads nothing:
      </P>

      <Figure name="Network Dispatch Optimizer" scenario={s}>
        <RegionDispatchMap
          dispatch={dispatch}
          flows={chk.flows}
          ariaLabel={`The region with line North–East out. ${over.length ? `Overloaded: ${over.map((o) => lineName(o.id)).join(', ')}.` : 'No line is overloaded.'} Lakeside produces ${fmt(lakeside)} MW.`}
        />
        <Readouts
          items={[
            { label: 'your dispatch, per hour', value: usd(chk.cost), tone: 'green' },
            { label: 'Lakeside makes up', value: mw(lakeside), tone: lakesideOk ? undefined : 'red' },
            { label: 'lines overloaded', value: String(over.length), tone: over.length ? 'red' : undefined },
            { label: 'cheapest possible', value: usd(OPT.cost) },
          ]}
        />
        {HAND.map((h) => {
          const g = GENS.find((x) => x.id === h.id)!;
          return (
            <Slider
              key={h.id}
              label={
                <>
                  <Swatch color={FUEL[fleetById(h.id).fuel]} />
                  {h.short} · ${g.offer}
                </>
              }
              value={s.state[h.id]}
              min={h.min}
              max={g.capacity}
              step={5}
              onChange={(v) => s.set({ [h.id]: v } as Partial<typeof s.state>)}
              display={mw(s.state[h.id])}
            />
          );
        })}
        <Caption>{caption}</Caption>
        <Checkbox label="Compare with the optimizer’s dispatch" checked={s.state.compare} onChange={(v) => s.set({ compare: v })} />
        {s.state.compare && (
          <DataTable
            caption="Your dispatch and the optimizer’s"
            rows={rows}
            rowKey={(g) => g.id}
            rowClass={(g) => (Math.abs((dispatch[g.id] ?? 0) - (OPT.dispatch[g.id] ?? 0)) > 0.5 ? 'hl' : '')}
            columns={[
              {
                label: 'Plant',
                cell: (g) => (
                  <>
                    <Swatch color={FUEL[fleetById(g.id).fuel]} />
                    {fleetById(g.id).name}
                  </>
                ),
              },
              { label: 'Offer', cell: (g) => usd(g.offer) },
              { label: 'Yours', cell: (g) => mw(dispatch[g.id] ?? 0) },
              { label: 'Optimizer', cell: (g) => mw(OPT.dispatch[g.id] ?? 0) },
            ]}
            footer={['Cost per hour', '', usd(chk.cost), usd(OPT.cost)]}
          />
        )}
      </Figure>

      <P>
        The merit order costs {usd(MERIT_CHECK.cost)} an hour, but it can’t be delivered. With North–East out, everything North produces has to pass through Central, and
        from there the region’s cheap power heads for Metro along two routes that are both too small: Central–Metro would carry{' '}
        {fmt(Math.abs(MERIT_CHECK.flows['center-city']))} MW against its limit of 600, and West–Metro {fmt(Math.abs(MERIT_CHECK.flows['west-city']))} MW against 300.
      </P>
      <P>
        Turning a single plant down doesn’t help much, because every plant’s output appears on every line at once, in the fixed proportions we met in Lesson 2.4. Lower
        Ironwood and Lakeside rises to replace it, sending even more power down Central–Metro. What does help is producing power on the far side of the bottleneck. Mill
        Creek and Old Quay sit in Metro itself, and Eastgate reaches Metro along its own line, so each megawatt they produce is a megawatt that never has to cross the full
        lines. They cost more, though, and each relieves the lines by a different amount for a different price.
      </P>

      <Challenge
        id="a"
        question="Using the sliders in the first demonstration, find a dispatch that overloads no line and costs no more than 1% above the cheapest possible."
        solved={solved}
        status={caption}
        success={`Solved. ${usd(chk.cost)} an hour is within ${pct(Math.max(0, gap), 1)} of the optimum. The trick is to replace Lakeside, not Ironwood: Mill Creek costs only $6 more per MWh than Lakeside, and every megawatt it adds in Metro takes load off both full lines.`}
      />

      <H2>Dispatch as an optimization problem</H2>
      <P>
        What you’ve been doing by hand is called economic dispatch with network constraints, or in its usual form, <b>DC optimal power flow</b>. Written out, it’s an
        optimization problem. Choose each plant’s output <i>g</i> to minimize the total cost
      </P>
      <Eq label="Total cost is the sum of each offer times each output">
        <span>cost</span>
        <Op>=</Op>
        <K c="price">
          offer<Sub>1</Sub>
        </K>
        <Op>×</Op>
        <K c="power">
          g<Sub>1</Sub>
        </K>
        <Op>+</Op>
        <K c="price">
          offer<Sub>2</Sub>
        </K>
        <Op>×</Op>
        <K c="power">
          g<Sub>2</Sub>
        </K>
        <Op>+ … +</Op>
        <K c="price">
          offer<Sub>9</Sub>
        </K>
        <Op>×</Op>
        <K c="power">
          g<Sub>9</Sub>
        </K>
      </Eq>
      <P>
        while keeping the total output equal to demand, each plant between its floor and its capacity, and the flow on every line — itself a weighted sum of the outputs —
        within that line’s limit. The thing to notice is that every one of these relationships is linear. Costs add up in proportion to output, and in the DC power flow
        model that market software uses, so do flows. Linear constraints have flat boundaries, so the set of dispatches that satisfy all of them is a polygon, or in more
        dimensions, its many-sided generalization, a polytope.
      </P>
      <P>
        Five sliders make a five-dimensional problem, which we can’t draw. But we can draw a two-dimensional slice of it. In the next demonstration, every plant except Ironwood and Mill
        Creek is held where the optimizer put it, and Lakeside still makes up the difference. Each point in the plot is a dispatch. Points in the white region overload
        nothing; points in the red one overload at least one line or ask Lakeside for an output it can’t produce. Drag the two sliders to move the orange point:
      </P>

      <Figure name="Network Dispatch Optimizer · the solver’s view" scenario={t}>
        <SolverView coal={t.state.coal} cc2={t.state.cc2} showPath={t.state.path} />
        <Readouts
          items={[
            { label: 'cost per hour', value: usd(planeCost(p2)), tone: 'green' },
            { label: 'Lakeside makes up', value: mw(lakeside2) },
            { label: 'this dispatch', value: ok2 ? 'feasible' : 'infeasible', tone: ok2 ? 'green' : 'red' },
          ]}
        />
        <Slider label="Ironwood coal · $28" tone="orange" value={t.state.coal} min={120} max={300} step={5} onChange={(v) => t.set({ coal: v })} display={mw(t.state.coal)} />
        <Slider label="Mill Creek · $42" tone="orange" value={t.state.cc2} min={0} max={250} step={5} onChange={(v) => t.set({ cc2: v })} display={mw(t.state.cc2)} />
        <Checkbox label="Show the simplex method’s path from the nearest corner" checked={t.state.path} onChange={(v) => t.set({ path: v })} />
        <Caption>
          {ok2
            ? `Feasible: every line is within its limit. ${planeCost(p2) - planeCost(BEST) < 1 ? 'This is the cheapest corner.' : `It costs ${usd(planeCost(p2) - planeCost(BEST))} an hour more than the cheapest corner.`}`
            : `Infeasible: ${bad2.map((h) => CONSTRAINT_LABEL[h.id]?.replace(' full', ' over its limit').replace('at 0 MW', 'below 0 MW').replace('at 400 MW', 'above 400 MW') ?? h.id).join(', ')}.`}
        </Caption>
      </Figure>

      <P>
        Each straight edge of the white region is one constraint at its limit. Along the lower left, Central–Metro is full; along the bottom right, West–Metro is; at the top
        right, Lakeside would have to go below zero. Notice that the merit order — Ironwood at 300 MW and Mill Creek at nothing, the lower-right corner — sits just outside.
      </P>
      <P>
        The dashed lines join dispatches of equal cost. More Ironwood saves {usd(-PLANE.cost.cx)} for every megawatt it takes from Lakeside, and more Mill Creek costs{' '}
        {usd(PLANE.cost.cy)}, so cost falls toward the lower right. Imagine sliding a dashed line in that direction until it’s about to leave the white region for good. The
        last point it touches is the cheapest feasible dispatch, and it’s a corner: Ironwood flat out, Mill Creek at {fmt(BEST[1])} MW, West–Metro exactly full. For a
        linear cost over a region with flat sides, the answer is always at a corner, or along a whole edge in the rare case that the edge runs exactly parallel to the
        dashed lines.
      </P>
      <P>
        That observation is the basis of the <b>simplex method</b>, developed by George Dantzig in 1947 and still at the heart of the solvers grid operators use. Start at any
        corner. Look at the neighboring corners, one edge away, and move to a cheaper one. Stop when no neighbor is cheaper. Because the region has no dents and the cost is
        a flat slope, a corner with no cheaper neighbor is the cheapest point anywhere in the region. Tick the box to watch the path from the corner nearest your dispatch.
        In a problem with thousands of variables, a corner is a point where enough constraints are exactly tight to pin down every variable, and the method moves between
        corners in the same way. Many solvers also use interior-point methods, which cut through the middle of the region instead of walking around its edges.
      </P>
      <P>
        Real dispatch software solves this problem for networks with thousands of nodes and hundreds of generators, and the real-time markets in the United States re-solve
        it every five minutes. For our evening, the optimizer keeps Ironwood flat out and swaps about {fmt(OPT.dispatch.cc2)} MW of Lakeside for Mill Creek. That costs{' '}
        <Tn tone="green">{usd(OPT.cost)}</Tn> an hour — {usd(OPT.cost - MERIT_CHECK.cost)}, or {pct(OPT.cost / MERIT_CHECK.cost - 1)}, more than the merit order the wires
        couldn’t carry. That difference is what the network costs us. In the <a href={lessonHref('5.2')}>next lesson</a>, we’ll squeeze a line and watch it grow.
      </P>
    </LessonPage>
  );
}
