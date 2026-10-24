import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Slider, fmt, lessonHref, mix, usd, useScenario } from '../../../framework';
import { NETWORK_DEFAULTS, nodePrices, solveNetwork, type LinkId, type NetworkInputs, type NetworkSolution, type NodeId } from '../../../engines/oil/network';
import { XYChart } from '../shared/charts';

const D = NETWORK_DEFAULTS;

/** The Northport–Kessler spread for a basin production, pipeline and rail capacity, $/bbl. */
export function spreadAt(basin: number, pipeline = D.pipeline, rail = D.rail): number {
  const p = nodePrices({ ...D, basinSupply: basin, pipeline, rail });
  return p.northport - p.kessler;
}

/** Challenge a: with the basin at 700 kb/d, the smallest pipeline (10 kb/d steps) that brings the spread under $5. */
export const CHALLENGE_BASIN = 700;
export const SPREAD_TARGET = 5;
export const PIPE_STEP = 10;
export function pipelineSolved(st: { basin: number; pipeline: number; rail: number }): boolean {
  if (st.basin !== CHALLENGE_BASIN) return false;
  return spreadAt(st.basin, st.pipeline, st.rail) < SPREAD_TARGET && spreadAt(st.basin, st.pipeline - PIPE_STEP, st.rail) >= SPREAD_TARGET;
}

/** Challenge b: the lowest basin production (10 kb/d steps) at which Kessler trades more than $20 under Northport. */
export const TRAPPED_SPREAD = 20;
export const BASIN_STEP = 10;
export function trappedSolved(basin: number): boolean {
  return spreadAt(basin) > TRAPPED_SPREAD && spreadAt(basin - BASIN_STEP) <= TRAPPED_SPREAD;
}

type Regime = 'importing' | 'room' | 'rail' | 'full';
const REGIME_LABEL: Record<Regime, string> = {
  importing: 'Port Calder imports from Northport',
  room: 'Pipeline has room',
  rail: 'Pipeline full: rail carries the rest',
  full: 'Pipeline and rail full: oil held back',
};
const REGIME_COLOR: Record<Regime, string> = {
  importing: 'rgba(69, 144, 206, .10)',
  room: 'rgba(0, 0, 0, 0)',
  rail: 'rgba(208, 112, 42, .12)',
  full: 'rgba(231, 91, 85, .14)',
};
const REGIME_SWATCH: Record<Regime, string> = { importing: '#c7dcef', room: '#ececea', rail: '#f0d2bb', full: '#f6c9c6' };

export function regimeOf(inp: NetworkInputs, s: NetworkSolution): Regime {
  if (s.flows.northportCalder > 0.5) return 'importing';
  const pipeFull = s.flows.kesslerCalderPipe >= inp.pipeline - 1e-6;
  const railFull = s.flows.kesslerCalderRail >= inp.rail - 1e-6;
  if (!pipeFull) return 'room';
  return railFull ? 'full' : 'rail';
}

interface SweepPoint {
  basin: number;
  kessler: number;
  calder: number;
  regime: Regime;
}

let sweepCache: SweepPoint[] | null = null;
/** Prices across basin production with the reference pipeline and rail, computed once. */
function sweep(): SweepPoint[] {
  if (!sweepCache) {
    sweepCache = [];
    for (let b = 300; b <= 1000; b += BASIN_STEP) {
      const inp = { ...D, basinSupply: b };
      const p = nodePrices(inp);
      sweepCache.push({ basin: b, kessler: p.kessler, calder: p.calder, regime: regimeOf(inp, solveNetwork(inp)) });
    }
  }
  return sweepCache;
}

function price2(x: number): string {
  return usd(x, 2);
}

function kbd(x: number): string {
  return `${fmt(x)} kb/d`;
}

// ---------------------------------------------------------------------------
// The map.

const POS: Record<NodeId, [number, number]> = {
  coldwater: [150, 50],
  basin: [64, 162],
  kessler: [222, 168],
  inland: [118, 292],
  calder: [392, 252],
  seaboard: [492, 362],
  northport: [584, 92],
  eastbay: [584, 296],
};
const NAME: Record<NodeId, string> = {
  coldwater: 'Coldwater',
  basin: 'Ridgeback Basin',
  kessler: 'Kessler hub',
  inland: 'Inland refineries',
  calder: 'Port Calder',
  seaboard: 'Seaboard field',
  northport: 'Northport',
  eastbay: 'Eastbay',
};
const LABEL_AT: Record<NodeId, [number, number, 'start' | 'middle' | 'end']> = {
  coldwater: [0, -32, 'middle'],
  basin: [0, 42, 'middle'],
  kessler: [8, -31, 'start'],
  inland: [0, 42, 'middle'],
  calder: [-30, 40, 'end'],
  seaboard: [-30, 5, 'end'],
  northport: [0, 42, 'middle'],
  eastbay: [0, 42, 'middle'],
};

function nodeFill(p: number): string {
  return mix('#f2f6ec', '#93c26b', Math.max(0, Math.min(1, (p - 48) / 34)));
}

const LAND = '#f3efe5';
const SEA = '#eaf2f9';
const PIPE = '#9a9a9a';
const FULL = '#e75b55';
const SHIP = '#4590ce';
const RAIL = '#a5603a';

interface Drawn {
  id: LinkId;
  d: string;
  flow: number;
  label: string;
  lx: number;
  ly: number;
  kind: 'pipe' | 'rail' | 'ship';
  full: boolean;
}

function offset(a: [number, number], b: [number, number], k: number): [[number, number], [number, number]] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  return [
    [a[0] + nx * k, a[1] + ny * k],
    [b[0] + nx * k, b[1] + ny * k],
  ];
}

function line(a: [number, number], b: [number, number]): string {
  return `M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
}

function curve(a: [number, number], c: [number, number], b: [number, number]): string {
  return `M${a[0]} ${a[1]} Q${c[0]} ${c[1]} ${b[0]} ${b[1]}`;
}

function drawLinks(inp: NetworkInputs, s: NetworkSolution): Drawn[] {
  const f = s.flows;
  const P = POS;
  const [pa, pb] = offset(P.kessler, P.calder, -7);
  const [ra, rb] = offset(P.kessler, P.calder, 9);
  const exportsN = f.calderNorthport > 0.5;
  const importsN = f.northportCalder > 0.5;
  const ncFlow = exportsN ? f.calderNorthport : f.northportCalder;
  return [
    { id: 'basinKessler', d: line(P.basin, P.kessler), flow: f.basinKessler, label: kbd(f.basinKessler), lx: 142, ly: 152, kind: 'pipe', full: false },
    { id: 'coldwaterKessler', d: line(P.coldwater, P.kessler), flow: f.coldwaterKessler, label: `${fmt(f.coldwaterKessler)}/${fmt(inp.coldwaterLine)}`, lx: 214, ly: 104, kind: 'pipe', full: f.coldwaterKessler >= inp.coldwaterLine - 1e-6 },
    { id: 'kesslerInland', d: line(P.kessler, P.inland), flow: f.kesslerInland, label: kbd(f.kesslerInland), lx: 150, ly: 236, kind: 'pipe', full: false },
    {
      id: 'kesslerCalderPipe',
      d: line(pa, pb),
      flow: f.kesslerCalderPipe,
      label: `pipeline ${fmt(f.kesslerCalderPipe)}/${fmt(inp.pipeline)}`,
      lx: 322,
      ly: 190,
      kind: 'pipe',
      full: inp.pipeline > 0 && f.kesslerCalderPipe >= inp.pipeline - 1e-6,
    },
    {
      id: 'kesslerCalderRail',
      d: line(ra, rb),
      flow: f.kesslerCalderRail,
      label: `rail ${fmt(f.kesslerCalderRail)}/${fmt(inp.rail)}`,
      lx: 282,
      ly: 240,
      kind: 'rail',
      full: inp.rail > 0 && f.kesslerCalderRail >= inp.rail - 1e-6,
    },
    { id: 'seaboardCalder', d: curve(P.seaboard, [462, 300], P.calder), flow: f.seaboardCalder, label: kbd(f.seaboardCalder), lx: 438, ly: 318, kind: 'ship', full: false },
    { id: 'seaboardNorthport', d: curve(P.seaboard, [560, 230], P.northport), flow: f.seaboardNorthport, label: kbd(f.seaboardNorthport), lx: 556, ly: 196, kind: 'ship', full: false },
    {
      id: importsN ? 'northportCalder' : 'calderNorthport',
      d: importsN ? curve(P.northport, [470, 128], P.calder) : curve(P.calder, [470, 128], P.northport),
      flow: ncFlow,
      label: importsN ? `imports ${kbd(ncFlow)}` : `exports ${kbd(ncFlow)}`,
      lx: 470,
      ly: 152,
      kind: 'ship',
      full: false,
    },
    { id: 'calderEastbay', d: curve(P.calder, [490, 292], P.eastbay), flow: f.calderEastbay, label: `exports ${kbd(f.calderEastbay)}`, lx: 506, ly: 282, kind: 'ship', full: false },
  ];
}

function NetworkMap({ inp, s, prices }: { inp: NetworkInputs; s: NetworkSolution; prices: Record<NodeId, number> }) {
  const links = drawLinks(inp, s);
  const held = s.shutIn.basin + s.shutIn.coldwater + s.shutIn.seaboard;
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 400"
      role="img"
      aria-label={`The crude network. Prices: ${(Object.keys(NAME) as NodeId[]).map((n) => `${NAME[n]} ${price2(prices[n])}`).join(', ')}. The Kessler–Calder pipeline carries ${kbd(s.flows.kesslerCalderPipe)} of ${kbd(inp.pipeline)}${s.flows.kesslerCalderRail > 0.5 ? `, rail ${kbd(s.flows.kesslerCalderRail)}` : ''}${held > 0.5 ? `; ${kbd(held)} of production is held back` : ''}.`}
    >
      <rect x={0} y={0} width={640} height={400} fill={SEA} />
      <path d="M0 0 L352 0 C372 110 420 190 408 262 C400 318 430 360 446 400 L0 400 Z" fill={LAND} />
      <text className="ax" x={620} y={22} textAnchor="end" style={{ fill: '#6f8fae' }}>
        ocean
      </text>
      {links.map((l) => {
        const w = l.flow > 0.5 ? Math.min(14, 2 + l.flow / 40) : 1.5;
        const color = l.full ? FULL : l.kind === 'ship' ? SHIP : l.kind === 'rail' ? RAIL : PIPE;
        const speed = l.flow * 0.08;
        return (
          <g key={l.id}>
            <path d={l.d} fill="none" stroke={color} strokeWidth={w} strokeDasharray={l.kind === 'ship' ? '8 6' : l.kind === 'rail' ? '3 4' : undefined} opacity={l.flow > 0.5 ? 0.85 : 0.35} />
            {l.flow > 0.5 && (
              <path d={l.d} className="flow-dots" stroke="#fff" strokeWidth={Math.min(5, 1.5 + w / 3)} style={{ animationDuration: `${(18 / Math.max(2, speed)).toFixed(2)}s` }} />
            )}
          </g>
        );
      })}
      {links
        .filter((l) => l.flow > 0.5 || l.kind !== 'ship')
        .map((l) => (
          <text
            key={'t' + l.id}
            x={l.lx}
            y={l.ly}
            textAnchor="middle"
            style={{ fontSize: 11, fontWeight: 500, fill: l.full ? '#c4382f' : '#333', paintOrder: 'stroke', stroke: l.kind === 'ship' ? SEA : LAND, strokeWidth: 4 }}
          >
            {l.label}
          </text>
        ))}
      {(Object.keys(POS) as NodeId[]).map((n) => {
        const [x, y] = POS[n];
        const [dx, dy, anchor] = LABEL_AT[n];
        const r = n === 'kessler' || n === 'calder' ? 26 : 23;
        return (
          <g key={n}>
            <circle cx={x} cy={y} r={r} fill={nodeFill(prices[n])} stroke="#333" strokeWidth={1} />
            <text x={x} y={y + 4.5} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 600, fill: '#1f3d0c' }}>
              {usd(prices[n], prices[n] % 1 ? 2 : 0)}
            </text>
            <text x={x + dx} y={y + dy} textAnchor={anchor} style={{ fontSize: 12, fontWeight: 500, fill: '#333', paintOrder: 'stroke', stroke: n === 'northport' || n === 'eastbay' || n === 'seaboard' ? SEA : LAND, strokeWidth: 4 }}>
              {NAME[n]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** A sentence saying what sets Kessler's price right now. */
function explain(inp: NetworkInputs, s: NetworkSolution, p: Record<NodeId, number>): string {
  const gap = p.calder - p.kessler;
  const held = s.shutIn.basin + s.shutIn.coldwater + s.shutIn.seaboard;
  if (Math.abs(gap - inp.pipelineTariff) < 0.01) return `The pipeline has room, so Kessler’s price is Port Calder’s less the ${price2(inp.pipelineTariff)} tariff.`;
  if (Math.abs(gap - inp.railCost) < 0.01) return `The pipeline is full. The next barrel out of Kessler goes by rail, so Kessler’s price is Port Calder’s less the ${price2(inp.railCost)} rail freight.`;
  return `Every way out of Kessler is full. ${held > 0.5 ? `${kbd(held)} of production is held back, and ` : ''}Kessler’s price has fallen to what a barrel is worth when it can’t be moved.`;
}

// ---------------------------------------------------------------------------
// The price ladder for the second demonstration.

interface Step {
  from: string;
  to: string;
  why: string;
}

function ladderSteps(inp: NetworkInputs, p: Record<NodeId, number>): Step[] {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const eastbay = inp.northportPrice + inp.eastbayPremium;
  let coast: string;
  if (near(p.calder, inp.northportPrice + inp.freightCalderNorthport)) coast = `imports from Northport: plus ${price2(inp.freightCalderNorthport)} freight`;
  else if (near(p.calder, p.seaboard + inp.freightSeaboardCalder) && near(p.seaboard, inp.northportPrice - inp.freightSeaboardNorthport))
    coast = `Seaboard crude: Northport less ${price2(inp.freightSeaboardNorthport)}, plus ${price2(inp.freightSeaboardCalder)} to Calder`;
  else if (near(p.calder, eastbay - inp.freightCalderEastbay)) coast = `exports to Eastbay: ${price2(eastbay)} less ${price2(inp.freightCalderEastbay)} freight`;
  else if (near(p.calder, inp.northportPrice - inp.freightCalderNorthport)) coast = `exports to Northport: less ${price2(inp.freightCalderNorthport)} freight`;
  else coast = 'set by the next barrel Port Calder buys or sells by sea';
  const gap = p.calder - p.kessler;
  const inland = near(gap, inp.pipelineTariff)
    ? `pipeline has room: less the ${price2(inp.pipelineTariff)} tariff`
    : near(gap, inp.railCost)
      ? `pipeline full, rail is the outlet: less ${price2(inp.railCost)}`
      : 'every outlet full: what held-back oil is worth';
  return [
    { from: 'Northport', to: 'Port Calder', why: coast },
    { from: 'Port Calder', to: 'Kessler', why: inland },
    { from: 'Kessler', to: 'wellhead', why: `less ${price2(inp.gathering)} to gather it` },
  ];
}

function PriceLadder({ inp, p }: { inp: NetworkInputs; p: Record<NodeId, number> }) {
  const rows: Array<{ name: string; price: number }> = [
    { name: 'Northport', price: p.northport },
    { name: 'Port Calder', price: p.calder },
    { name: 'Kessler hub', price: p.kessler },
    { name: 'Ridgeback wellhead', price: p.basin },
  ];
  const steps = ladderSteps(inp, p);
  const X0 = 140;
  const X1 = 520;
  const lo = 40;
  const hi = 85;
  const sx = (v: number) => X0 + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (X1 - X0);
  const rowH = 26;
  const gapH = 22;
  const top = 22;
  const H = top + rows.length * rowH + (rows.length - 1) * gapH + 24;
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${H}`}
      role="img"
      aria-label={`From Northport back to the Ridgeback wellhead: ${rows.map((r) => `${r.name} ${price2(r.price)}`).join(', ')}. ${steps.map((st) => `${st.from} to ${st.to}: ${st.why}`).join('. ')}.`}
    >
      <text className="ax" x={X0} y={12}>
        Crude price at each place, $ per barrel (axis starts at $40)
      </text>
      {[40, 50, 60, 70, 80].map((v) => (
        <g key={v}>
          <line className="gl" x1={sx(v)} x2={sx(v)} y1={top} y2={H - 22} />
          <text className="ax ax-m" x={sx(v)} y={H - 6}>
            ${v}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = top + i * (rowH + gapH);
        return (
          <g key={r.name}>
            <text x={X0 - 8} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333', fontWeight: 500 }}>
              {r.name}
            </text>
            <rect x={X0} y={y + 4} width={sx(r.price) - X0} height={rowH - 8} fill={nodeFill(r.price)} stroke="#6d9c37" strokeWidth={1} />
            <text x={sx(r.price) + 6} y={y + rowH / 2 + 4} style={{ fontSize: 12, fontWeight: 600, fill: '#3f7a1e' }}>
              {price2(r.price)}
            </text>
            {i < steps.length && (
              <text x={X0 + 4} y={y + rowH + gapH / 2 + 4} style={{ fontSize: 11, fill: '#5f5f5f', fontStyle: 'italic' }}>
                ↓ {signed2(rows[i + 1].price - r.price)}: {steps[i].why}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function signed2(x: number): string {
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${usd(Math.abs(x), 2)}`;
}

export default function Lesson() {
  const s1 = useScenario('network', { basin: D.basinSupply, pipeline: D.pipeline, rail: D.rail });
  const st = s1.state;
  const inp: NetworkInputs = useMemo(() => ({ ...D, basinSupply: st.basin, pipeline: st.pipeline, rail: st.rail }), [st.basin, st.pipeline, st.rail]);
  const sol = useMemo(() => solveNetwork(inp), [inp]);
  const prices = useMemo(() => nodePrices(inp), [inp]);
  const spread = prices.northport - prices.kessler;
  const held = sol.shutIn.basin + sol.shutIn.coldwater + sol.shutIn.seaboard;
  const solvedA = pipelineSolved(st);

  const s2 = useScenario('netback', { basin: D.basinSupply });
  const inp2: NetworkInputs = useMemo(() => ({ ...D, basinSupply: s2.state.basin }), [s2.state.basin]);
  const p2 = useMemo(() => nodePrices(inp2), [inp2]);
  const solvedB = trappedSolved(s2.state.basin);
  const pts = sweep();
  const bands = useMemo(() => {
    const out: Array<{ regime: Regime; from: number; to: number }> = [];
    for (const pt of pts) {
      const last = out[out.length - 1];
      if (last && last.regime === pt.regime) last.to = pt.basin + BASIN_STEP / 2;
      else out.push({ regime: pt.regime, from: pt.basin - BASIN_STEP / 2, to: pt.basin + BASIN_STEP / 2 });
    }
    return out;
  }, [pts]);

  // Numbers quoted in the prose (all at the reference network unless noted).
  const base = useMemo(() => nodePrices(D), []);
  const baseSol = useMemo(() => solveNetwork(D), []);
  const firstOf = (r: Regime) => pts.find((p) => p.regime === r)!;
  const lastOf = (r: Regime) => [...pts].reverse().find((p) => p.regime === r)!;
  const importing = firstOf('importing');
  const roomFirst = firstOf('room');
  const roomLast = lastOf('room');
  const railFirst = firstOf('rail');
  const fullFirst = firstOf('full');
  const at = (b: number) => pts.find((p) => p.basin === b)!;
  const eastbayParity = D.northportPrice + D.eastbayPremium - D.freightCalderEastbay;
  const exportFirst = pts.find((p) => Math.abs(p.calder - eastbayParity) < 0.01 && p.regime === 'rail')!;
  const basinHeld = pts.find((p) => Math.abs(p.kessler - (D.floor + D.gathering)) < 0.01)!;
  const bigDrop = Math.max(...pts.slice(1).map((p, i) => pts[i].kessler - p.kessler));
  const challengeAnswer = useMemo(() => {
    for (let pc = 300; pc <= 800; pc += PIPE_STEP) if (pipelineSolved({ basin: CHALLENGE_BASIN, pipeline: pc, rail: D.rail })) return pc;
    return NaN;
  }, []);

  return (
    <LessonPage id="oil/4.4">
      <P>
        The last three lessons followed crude oil one link at a time. <a href={lessonHref('oil/4.1')}>Lesson 4.1</a> pumped it down a pipeline,{' '}
        <a href={lessonHref('oil/4.2')}>Lesson 4.2</a> sailed it across an ocean, and <a href={lessonHref('oil/4.3')}>Lesson 4.3</a> held it in tanks until it was
        worth more. Each link moves oil at a cost, and each can carry only so much. Put the links together and you have a network, and a question the links alone
        can’t answer: what is a barrel worth at each place along it?
      </P>
      <P>
        Our network is the course’s world. The Ridgeback Basin produces {kbd(D.basinSupply)}, gathered into the Kessler hub for {price2(D.gathering)} a barrel;
        Coldwater’s {kbd(D.coldwaterSupply)} arrives at Kessler down the Coldwater line, for {price2(D.coldwaterTariff)}. Refineries near Kessler take{' '}
        {kbd(D.inlandDemand)}. The rest goes to the coast: down the Kessler–Calder line, which can carry {kbd(D.pipeline)} for a {price2(D.pipelineTariff)}{' '}
        tariff, or by rail, up to {kbd(D.rail)} at {price2(D.railCost)} a barrel. The refiners at Port Calder, Calder among them, need {kbd(D.calderDemand)}. Offshore,
        the Seaboard field produces {kbd(D.seaboardSupply)}, which tankers carry to Port Calder for {price2(D.freightSeaboardCalder)} a barrel or across the ocean to
        Northport for {price2(D.freightSeaboardNorthport)}.
      </P>
      <P>
        Northport is the deep, liquid market of our world, a refining center that will buy or sell any amount of crude at its price, {price2(D.northportPrice)}{' '}
        a barrel. Its price behaves like Brent’s, and Kessler’s like WTI’s; both, like every price here, are simulated. Eastbay, farther away, pays{' '}
        {price2(D.eastbayPremium)} more. To keep the picture simple, every barrel in this lesson is the same crude.
      </P>
      <P>
        Crude flows to wherever it is worth most once the cost of getting it there is paid. Finding those flows is another linear program, like the refinery plan of{' '}
        <a href={lessonHref('oil/3.5')}>Lesson 3.5</a>: it maximizes the value of the oil delivered, less every tariff and freight bill, within each link’s capacity.
        And the <K c="price">price</K> at any place is simply the value of one more barrel appearing there. In the next demonstration, each circle shows that price;
        the lines carry the <K tone="orange">flows</K>, red where a link is full. Change how much the basin produces and how much the pipeline and the railroad can
        carry:
      </P>

      <Figure name="Petroleum Network Map" scenario={s1}>
        <NetworkMap inp={inp} s={sol} prices={prices} />
        <Legend
          items={[
            { label: 'Pipeline', color: PIPE, kind: 'line' },
            { label: 'Rail', color: RAIL, kind: 'line', dashed: true },
            { label: 'Tanker route', color: SHIP, kind: 'line', dashed: true },
            { label: 'Full', color: FULL, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: <K c="price">Kessler price</K>, value: price2(prices.kessler), tone: 'green' },
            { label: <K c="price">Port Calder price</K>, value: price2(prices.calder), tone: 'green' },
            { label: 'Northport less Kessler', value: signed2(spread), tone: spread > 5 ? 'red' : 'green' },
            { label: 'production held back', value: kbd(held) },
          ]}
        />
        <Slider label="Ridgeback Basin production" tone="orange" value={st.basin} min={300} max={1000} step={BASIN_STEP} onChange={(v) => s1.set({ basin: v })} display={kbd(st.basin)} />
        <Slider label="Kessler–Calder pipeline" value={st.pipeline} min={300} max={800} step={PIPE_STEP} onChange={(v) => s1.set({ pipeline: v })} display={kbd(st.pipeline)} />
        <Slider label="Rail capacity" value={st.rail} min={0} max={300} step={10} onChange={(v) => s1.set({ rail: v })} display={kbd(st.rail)} />
        <Caption>{explain(inp, sol, prices)}</Caption>
      </Figure>

      <P>
        At the reference settings the pipeline carries {kbd(baseSol.flows.kesslerCalderPipe)} of its {kbd(D.pipeline)}, and Port Calder still needs more:{' '}
        {kbd(baseSol.flows.seaboardCalder)} of Seaboard crude comes in by tanker, while the field’s other {kbd(baseSol.flows.seaboardNorthport)} goes to Northport.
        Follow the prices outward from Northport’s {price2(base.northport)}. Seaboard crude is worth {price2(base.seaboard)} at the field, because that’s what it would
        fetch at Northport after {price2(D.freightSeaboardNorthport)} of freight. Port Calder’s last barrel is that same crude, brought {price2(D.freightSeaboardCalder)}{' '}
        the other way, so Port Calder pays {price2(base.calder)}. Kessler is {price2(D.pipelineTariff)} upstream of that, at {price2(base.kessler)}, and the basin’s
        wellheads another {price2(D.gathering)} upstream, at {price2(base.basin)}. Coldwater crude, with its longer haul, is worth {price2(base.coldwater)} where it’s
        produced. When barrels flow and the links have room, neighboring prices differ by exactly the cost of moving a barrel between them, never more.
      </P>
      <P>
        Now move the basin’s production. At {kbd(importing.basin)}, Port Calder runs short and buys crude from Northport, paying {price2(importing.calder)} —
        Northport’s price plus the freight, called <b>import parity</b> — and Kessler’s price, {price2(importing.kessler)}, sits above Northport’s. From{' '}
        {kbd(roomFirst.basin)} to {kbd(roomLast.basin)}, nothing happens to any price at all. Each extra barrel from the basin pushes a barrel of Seaboard crude out of
        Port Calder and across to Northport instead, and the market barely notices.
      </P>

      <H2>When a link fills</H2>
      <P>
        At {kbd(railFirst.basin)}, the pipeline is full. The next barrel out of Kessler can’t use it; the cheapest way left is the railroad, at {price2(D.railCost)} a
        barrel. A barrel at Kessler is now worth what it fetches at Port Calder less the rail freight, and Kessler’s price drops to {price2(railFirst.kessler)}. Nothing
        changed in the world’s demand for oil. What changed is that Kessler’s barrels became harder to get out. By {kbd(exportFirst.basin)}, the Seaboard crude has all
        been pushed out of Port Calder, and any more crude arriving there has to be sold abroad: Port Calder’s price falls to <b>export parity</b>, what Eastbay
        pays less the freight, {price2(exportFirst.calder)}.
      </P>
      <P>
        At {kbd(fullFirst.basin)} the rail is full too, and there is no way left for another barrel to leave Kessler. Its price falls until someone stops sending oil
        there. The first to stop is Coldwater, which pays {price2(D.coldwaterTariff)} to reach Kessler: Kessler’s price settles at {price2(fullFirst.kessler)}, the{' '}
        {price2(D.floor)} a held-back barrel is worth plus the tariff Coldwater saves by holding it. By {kbd(basinHeld.basin)}, Coldwater has nothing left to hold
        back, the next barrel held back is the basin’s own, and Kessler falls to {price2(basinHeld.kessler)}.
      </P>
      <P>
        Something like this happened to WTI. Priced at the inland hub of Cushing, Oklahoma, WTI generally traded a little above Brent while the United States imported
        crude. Then production from new inland fields outran the pipelines out of Cushing, and WTI fell far below Brent — by more than $20 a barrel at times in 2011.
        Crude went by rail while new pipelines were built and old ones turned around; the Seaway pipeline, which had carried crude north from the Gulf Coast, was
        reversed in 2012 to carry it south from Cushing. As the outlets grew, the gap narrowed.
      </P>

      <Challenge
        id="a"
        question={`With the basin producing ${kbd(CHALLENGE_BASIN)}, find the smallest pipeline capacity, to the nearest 10 kb/d, that brings the Northport–Kessler spread back under ${usd(SPREAD_TARGET)}.`}
        solved={solvedA}
        status={
          st.basin !== CHALLENGE_BASIN
            ? `Set the basin’s production to ${kbd(CHALLENGE_BASIN)} first.`
            : `With a ${kbd(st.pipeline)} pipeline, Kessler trades ${usd(spread, 2)} under Northport.`
        }
        success={`Solved: ${kbd(st.pipeline)}. Kessler and Port Calder need to move ${kbd(CHALLENGE_BASIN)} between them, and a pipeline of exactly that size is full: the next barrel still has to go by rail. Only with room to spare does the spread fall back to the tariff plus the ocean freight, ${usd(spread, 2)}. Prices stay linked only while a link has room.`}
      />

      <H2>Netbacks</H2>
      <P>
        A producer in the Ridgeback Basin never sees Northport’s price. It sees what is left of it after every cost between the well and wherever its marginal barrel
        ends up: the <b>netback</b>. In the next demonstration, the bars trace that chain for the basin’s production, from Northport back to the wellhead, with the
        reason for each step. The chart traces Kessler’s price across every level of production, with the regimes shaded:
      </P>

      <Figure name="Petroleum Network Map · netback" scenario={s2}>
        <PriceLadder inp={inp2} p={p2} />
        <Legend items={(Object.keys(REGIME_LABEL) as Regime[]).map((r) => ({ label: REGIME_LABEL[r], color: REGIME_SWATCH[r] }))} />
        <XYChart
          ariaLabel={`Kessler’s price against Ridgeback Basin production, from 300 to 1,000 kb/d, with Northport at ${price2(D.northportPrice)}. At ${kbd(s2.state.basin)}, Kessler is ${price2(p2.kessler)}, ${usd(p2.northport - p2.kessler, 2)} under Northport.`}
          height={230}
          x={[295, 1005]}
          y={[45, 85]}
          xTicks={[300, 400, 500, 600, 700, 800, 900, 1000]}
          yTicks={[50, 60, 70, 80]}
          xFormat={(v) => fmt(v)}
          yFormat={(v) => `$${v}`}
          xLabel="Ridgeback Basin production, kb/d"
          yLabel="Crude price, $ per barrel"
          bands={bands.map((b) => ({ axis: 'x' as const, from: b.from, to: b.to, color: REGIME_COLOR[b.regime] }))}
          series={[
            { points: pts.map((p) => [p.basin, p.calder] as [number, number]), color: '#6d9c37', width: 1.5, dash: '5 4', label: 'Port Calder', labelAt: [1000, at(1000).calder] },
            { points: pts.map((p) => [p.basin, p.kessler] as [number, number]), color: '#3f7a1e', width: 3, label: 'Kessler', labelAt: [1000, at(1000).kessler] },
          ]}
          refs={[
            { axis: 'y', at: D.northportPrice, color: '#333', dash: '2 3', label: `Northport ${price2(D.northportPrice)}` },
            { axis: 'x', at: s2.state.basin, cursor: true },
          ]}
          markers={[{ x: s2.state.basin, y: p2.kessler, color: '#3f7a1e', r: 6 }]}
          onScrub={(v) => s2.set({ basin: Math.max(300, Math.min(1000, Math.round(v / BASIN_STEP) * BASIN_STEP)) })}
          scrubValue={s2.state.basin}
          scrubStep={BASIN_STEP}
          scrubLabel="Ridgeback Basin production"
        />
        <Slider label="Ridgeback Basin production" tone="orange" value={s2.state.basin} min={300} max={1000} step={BASIN_STEP} onChange={(v) => s2.set({ basin: v })} display={kbd(s2.state.basin)} />
      </Figure>

      <P>
        The chart has the shape of every congested network: flat stretches where the links have room and prices are tied together by transport costs, separated by
        cliffs where a link fills and the upstream price falls to the next outlet. Notice that the cliffs are steep, not gradual. Ten thousand barrels a day more or
        less can move Kessler’s price by as much as {usd(bigDrop, 2)}, because what sets it switches from one outlet to the next. And notice who
        bears the fall: the producers upstream of the full link, whose netbacks drop, while the refiners at Kessler buy cheaper crude. A pipeline that relieves the
        bottleneck is worth the difference to them — which is why, whenever a spread like this opens, new pipelines follow.
      </P>

      <Challenge
        id="b"
        question={`Find the lowest basin production, to the nearest 10 kb/d, at which Kessler trades more than ${usd(TRAPPED_SPREAD)} under Northport.`}
        solved={solvedB}
        status={`At ${kbd(s2.state.basin)}, Kessler trades ${usd(p2.northport - p2.kessler, 2)} under Northport.`}
        success={`Solved: ${kbd(s2.state.basin)}. That is the point where the pipeline and the rail are both full, and Kessler’s price is set not by any route to the sea but by the oil that has nowhere to go. The first challenge had the same cause: at ${kbd(CHALLENGE_BASIN)} of production, the pipeline needed ${kbd(challengeAnswer)} of capacity to bring the spread back.`}
      />

      <P>
        So far every barrel has been the same. Real crudes aren’t: <a href={lessonHref('oil/1.3')}>Chapter 1</a> showed how they differ, and{' '}
        <a href={lessonHref('oil/3.5')}>Lesson 3.5</a> showed that a refinery values each one differently. A barrel’s price at a place depends on its quality as well
        as its location, and traders move cargoes whenever the gap between two places is wider than the cost of closing it. The{' '}
        <a href={lessonHref('oil/4.5')}>next lesson</a> adds quality and freight to the netback, and opens and closes those arbitrage windows. You can return to{' '}
        <FigRef to="Petroleum Network Map">the first demonstration</FigRef> to try other combinations of pipeline and rail.
      </P>
    </LessonPage>
  );
}
