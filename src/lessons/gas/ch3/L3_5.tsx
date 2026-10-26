import { useState } from 'react';
import {
  Caption,
  Challenge,
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
  clamp,
  fmt,
  lessonHref,
  mix,
  niceDomain,
  niceTicks,
  pct,
  scale,
  tint,
  usd,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import {
  BOIL_OFF_PER_DAY,
  GAS_M3_PER_LNG_M3,
  LIQUEFACTION_LOSS,
  MMBTU_PER_M3_LNG,
  PORT_DAYS,
  REGAS_LOSS,
  SHIP_LOADED_M3,
  breakevenHub,
  cargoMargin,
  lngCargo,
  netback,
  type LngCargo,
  type LngVoyage,
} from '../../../engines/gas/lng';
import { MMBTU_PER_MCF } from '../../../engines/gas/properties';
import { stationLine } from '../../../engines/gas/compression';
import { BAYPORT_LNG, BAYPORT_LNG_FEEDGAS_BCFD, PIPELINE, REFERENCE_DAYS, stationLineOf } from '../../../model/gas/world';
import { money } from '../shared/format';
import { chargePerMMBtu, design } from './L3_1';

// ---------------------------------------------------------------------------
// The chain's settings. Each demonstration has its own, starting from the same defaults.

export type Dest = 'europe' | 'asia';
const DESTS: Dest[] = ['europe', 'asia'];

/** Calder Hub price $3.00 (simulated), the first destination, the world's charter rate, and a simulated $9.00 overseas. */
export const CHAIN_DEFAULTS = { hub: 3, dest: 'europe' as Dest, charter: BAYPORT_LNG.charterPerDay as number, destPrice: 9 };
export type ChainState = typeof CHAIN_DEFAULTS;

const HUB_STEP = 0.05;

/** The voyage the settings describe. */
export function voyageOf(s: Pick<ChainState, 'hub' | 'dest' | 'charter'>): LngVoyage {
  const d = BAYPORT_LNG.destinations[s.dest];
  return {
    hubPrice: s.hub,
    feedMultiplier: BAYPORT_LNG.feedMultiplier,
    liquefactionFee: BAYPORT_LNG.liquefactionFee,
    ladenDays: d.ladenDays,
    charterPerDay: s.charter,
    voyageFees: d.voyageFees,
    regasFee: BAYPORT_LNG.regasFee,
  };
}

/** The challenge: a cargo to Asia, at the world's charter rate, worth as much at Bayport as one to Europe at a simulated $9.00. */
export const CHALLENGE = { dest: 'asia' as Dest, charter: BAYPORT_LNG.charterPerDay as number, europePrice: 9 };
/** The price slider's step in Figure 2, $/MMBtu. */
export const PRICE_STEP = 0.25;
const PRICE_MIN = 4;
const PRICE_MAX = 16;
/** Europe's netback at $9.00, the challenge's target. */
export const EUROPE_NETBACK = netback(voyageOf(CHAIN_DEFAULTS), CHALLENGE.europePrice);

/** The challenge's answer: the price in Asia, on the slider's 25-cent grid, whose netback is closest to Europe's at $9.00 ($9.75). */
export function challengeAnswer(): number {
  let best = NaN;
  let gap = Infinity;
  for (let p = PRICE_MIN; p <= PRICE_MAX + 1e-9; p += PRICE_STEP) {
    const g = Math.abs(netback(voyageOf({ ...CHAIN_DEFAULTS, dest: CHALLENGE.dest }), p) - EUROPE_NETBACK);
    if (g < gap) {
      gap = g;
      best = Math.round(p * 100) / 100;
    }
  }
  return best;
}
const ANSWER = challengeAnswer();

/** Solved when a cargo to Asia, at the starting charter rate, sells at the price that makes it worth as much at Bayport as Europe at $9.00. */
export function matchSolved(s: ChainState): boolean {
  return s.dest === CHALLENGE.dest && s.charter === CHALLENGE.charter && Math.abs(s.destPrice - ANSWER) < 1e-9;
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose.

const EU = lngCargo(voyageOf(CHAIN_DEFAULTS));
const AS = lngCargo(voyageOf({ ...CHAIN_DEFAULTS, dest: 'asia' }));
const DEAR = 200_000;
const EU_DEAR = lngCargo(voyageOf({ ...CHAIN_DEFAULTS, charter: DEAR }));
const AS_DEAR = lngCargo(voyageOf({ ...CHAIN_DEFAULTS, dest: 'asia', charter: DEAR }));
const NORTHLINE = PIPELINE['calder-metro'];
const NORTHLINE_FUEL = stationLine(stationLineOf(NORTHLINE), NORTHLINE.capacityBcfd * 1000).fuelShare;
/** Bcf of feed gas a cargo takes, and how often Bayport fills a ship. */
const FEED_BCF = EU.feed / (MMBTU_PER_MCF * 1e6);
const DAYS_PER_CARGO = FEED_BCF / BAYPORT_LNG_FEEDGAS_BCFD;
const CARGOES_A_YEAR = 365 / DAYS_PER_CARGO;
const SHIPS_EU = EU.roundTripDays / DAYS_PER_CARGO;
const SHIPS_AS = AS.roundTripDays / DAYS_PER_CARGO;
const EU_NETBACK_9 = netback(voyageOf(CHAIN_DEFAULTS), 9);
const EU_BE_9 = breakevenHub(voyageOf(CHAIN_DEFAULTS), 9);
const EU_MARGIN_9 = cargoMargin(voyageOf(CHAIN_DEFAULTS), 9);
/** A cargo to Asia at the same $9.00. */
const AS_NETBACK_9 = netback(voyageOf({ ...CHAIN_DEFAULTS, dest: 'asia' }), 9);
const AS_BE_9 = breakevenHub(voyageOf({ ...CHAIN_DEFAULTS, dest: 'asia' }), 9);
/** What the LNG chain adds to the hub price on the way to Europe, $/MMBtu. */
export const LNG_ADDER = EU.delivered$ - CHAIN_DEFAULTS.hub;
/** Northline's cost of moving an MMBtu when it runs full: its variable charge plus Lesson 3.1's capital charge. */
const NL_DESIGN = design(NORTHLINE.id, NORTHLINE.sizeIn, NORTHLINE.stations);
export const NORTHLINE_CAPITAL = chargePerMMBtu(NL_DESIGN.cost, NL_DESIGN.capacityBcfd, 1);
export const NORTHLINE_ALL_IN = NORTHLINE.variableCost + NORTHLINE_CAPITAL;

const mm = (x: number) => fmt(x / 1e6, 2) + ' million';

// ---------------------------------------------------------------------------
// Figure 1: one cargo's energy and cost.

const GAS = GRAPHIC.gold;
const LIQUID = mix(GRAPHIC.blue, '#ffffff', 0.35);
const LOSS = GRAPHIC.red;
const COST_COLORS = { feed: GRAPHIC.green, liquefaction: tint(GRAPHIC.green, 0.5), shipping: GRAPHIC.blue, regas: GRAPHIC.violet };
const COST_NAMES = { feed: 'Gas (115% of the hub price)', liquefaction: 'Liquefaction fee', shipping: 'Shipping', regas: 'Regasification' };

/** The energy in one cargo, drawn as a band whose thickness is the energy, with the losses peeling off. */
function ChainDiagram({ c, dest }: { c: LngCargo; dest: Dest }) {
  const k = 64 / c.feed;
  const y0 = 84;
  const th = (x: number) => Math.max(1.5, x * k);
  const lossBranch = (x0: number, xb: number, top: number, amount: number) => {
    const w = th(amount);
    return (
      <g>
        <rect x={x0} y={top} width={xb - x0 + w} height={w} fill={LOSS} />
        <rect x={xb} y={top} width={w} height={196 - top} fill={LOSS} />
      </g>
    );
  };
  const days = BAYPORT_LNG.destinations[dest].ladenDays;
  const lossLabel = (x: number, line1: string, line2: string) => (
    <g>
      <text x={x} y={212} textAnchor="middle" style={{ fontSize: 12, fill: TEXT.red, fontWeight: 500 }}>
        {line1}
      </text>
      <text x={x} y={227} textAnchor="middle" className="ax">
        {line2}
      </text>
    </g>
  );
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 236"
      role="img"
      aria-label={`One cargo from Calder Hub to ${BAYPORT_LNG.destinations[dest].name}: ${mm(c.feed)} MMBtu of gas enters the Bayport plant, which burns ${mm(c.liquefactionFuel)}; ${mm(c.loaded)} is loaded; ${fmt(c.boilOff)} MMBtu boils off in ${days} days at sea; the import terminal burns ${fmt(c.regasFuel)}; ${mm(c.sentOut)} MMBtu is sent out.`}
    >
      {/* Stage names. */}
      {[
        [70, 'Calder Hub', 'gas'],
        [200, 'Bayport plant', 'liquefied at −162 °C'],
        [350, 'At sea', `${days} days, laden`],
        [484, 'Import terminal', 'regasified'],
        [598, 'Sent out', 'as gas'],
      ].map(([x, a, b]) => (
        <g key={a as string}>
          <text x={x as number} y={18} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: '#333' }}>
            {a}
          </text>
          <text x={x as number} y={34} textAnchor="middle" className="ax">
            {b}
          </text>
        </g>
      ))}
      {/* The band of energy. */}
      <rect x={20} y={y0} width={148} height={th(c.feed)} fill={GAS} opacity={0.75} />
      <rect x={232} y={y0} width={16} height={th(c.loaded)} fill={LIQUID} opacity={0.75} />
      <polygon points={`248,${y0} 452,${y0} 452,${y0 + th(c.delivered)} 248,${y0 + th(c.loaded)}`} fill={LIQUID} opacity={0.75} />
      <rect x={516} y={y0} width={104} height={th(c.sentOut)} fill={GAS} opacity={0.75} />
      {/* Losses. */}
      {lossBranch(168, 214, y0 + th(c.loaded), c.liquefactionFuel)}
      {lossBranch(350, 350, y0 + th((c.loaded + c.delivered) / 2), c.boilOff)}
      {lossBranch(452, 498, y0 + th(c.sentOut), c.regasFuel)}
      {/* The plant and the terminal. */}
      <rect x={168} y={66} width={64} height={100} rx={5} fill="#f4f1ec" stroke="#555" strokeWidth={1.4} />
      <rect x={452} y={66} width={64} height={100} rx={5} fill="#f4f1ec" stroke="#555" strokeWidth={1.4} />
      <text x={200} y={124} textAnchor="middle" style={{ fontSize: 11, fill: '#555' }}>
        liquefy
      </text>
      <text x={484} y={124} textAnchor="middle" style={{ fontSize: 11, fill: '#555' }}>
        regasify
      </text>
      {/* Waves under the voyage. */}
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${260 + i * 64} 168 q 8 -6 16 0 q 8 6 16 0`} fill="none" stroke={GRAPHIC.blue} strokeWidth={1.2} opacity={0.6} />
      ))}
      {/* Energy at each stage. */}
      <text x={94} y={y0 - 10} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 500, fill: TEXT.gold }}>
        {mm(c.feed)} MMBtu
      </text>
      <text x={290} y={y0 - 10} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 500, fill: TEXT.gold }}>
        {mm(c.loaded)} loaded
      </text>
      <text x={568} y={y0 - 10} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 500, fill: TEXT.gold }}>
        {mm(c.sentOut)}
      </text>
      {lossLabel(200, `plant fuel ${fmt(c.liquefactionFuel)}`, `${pct(c.liquefactionFuel / c.feed)} of the gas`)}
      {lossLabel(350, `boil-off ${fmt(c.boilOff)}`, 'burned as the ship’s fuel')}
      {lossLabel(498, `${fmt(c.regasFuel)}`, 'burned to regasify')}
    </svg>
  );
}

/** Cost per MMBtu sent out, stacked by step, for both destinations. */
function CostChart({ rows, selected, hub }: { rows: Array<{ dest: Dest; c: LngCargo }>; selected: Dest; hub: number }) {
  const keys = ['feed', 'liquefaction', 'shipping', 'regas'] as const;
  const maxTotal = Math.max(...rows.map((r) => r.c.delivered$));
  const [, xMax] = niceDomain(0, Math.max(10, maxTotal * 1.08), 4);
  const x = scale(0, xMax, 92, 600);
  const ticks = niceTicks(0, xMax, 5);
  const sel = rows.find((r) => r.dest === selected)!;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 128"
      role="img"
      aria-label={`Delivered cost per MMBtu sent out with gas at ${usd(hub, 2)} at Calder Hub: ${rows
        .map((r) => `${BAYPORT_LNG.destinations[r.dest].name} ${usd(r.c.delivered$, 2)}`)
        .join(', ')}. For ${BAYPORT_LNG.destinations[selected].name}: gas ${usd(sel.c.perMMBtu.feed, 2)}, liquefaction ${usd(sel.c.perMMBtu.liquefaction, 2)}, shipping ${usd(sel.c.perMMBtu.shipping, 2)}, regasification ${usd(sel.c.perMMBtu.regas, 2)}.`}
    >
      <text className="ax" x={92} y={12}>
        Cost per MMBtu sent out
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={x(t)} x2={x(t)} y1={20} y2={100} />
          <text className="ax ax-m" x={x(t)} y={116}>
            ${fmt(t)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 28 + i * 36;
        const on = r.dest === selected;
        let acc = 0;
        return (
          <g key={r.dest} opacity={on ? 1 : 0.55}>
            <text x={84} y={y + 15} textAnchor="end" style={{ fontSize: 13, fontWeight: on ? 600 : 400, fill: '#333' }}>
              {BAYPORT_LNG.destinations[r.dest].name}
            </text>
            {keys.map((kk) => {
              const v = r.c.perMMBtu[kk];
              const x0 = x(acc);
              acc += v;
              const w = x(acc) - x0;
              return (
                <g key={kk}>
                  <rect x={x0} y={y} width={Math.max(0, w)} height={22} fill={COST_COLORS[kk]} />
                  {w > 34 && (
                    <text x={x0 + w / 2} y={y + 15} textAnchor="middle" style={{ fontSize: 11, fill: '#fff', fontWeight: 500 }}>
                      {fmt(v, 2)}
                    </text>
                  )}
                </g>
              );
            })}
            <text x={x(acc) + 6} y={y + 15} style={{ fontSize: 12.5, fontWeight: 600, fill: TEXT.green }}>
              {usd(r.c.delivered$, 2)}
            </text>
          </g>
        );
      })}
      <line x1={x(hub)} x2={x(hub)} y1={22} y2={100} stroke="#333" strokeWidth={1.4} strokeDasharray="4 3" />
      <text x={x(hub) + 4} y={98} className="ax">
        Calder price
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: a voyage, and what the cargo earns.

const SEC_PER_DAY = 0.35;
type Pt = [number, number];
const ROUTES: Record<Dest, Pt[]> = {
  europe: [
    [78, 108],
    [180, 70],
    [330, 46],
    [470, 40],
    [574, 44],
  ],
  asia: [
    [78, 118],
    [190, 156],
    [300, 170],
    [420, 170],
    [574, 160],
  ],
};

function along(pts: Pt[], f: number): Pt {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  let d = clamp(f, 0, 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const t = seg[i] > 0 ? Math.min(1, d / seg[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    d -= seg[i];
  }
  return pts[pts.length - 1];
}

/** Where the ship is on day `day` of a round trip, and what it's doing. */
export function voyagePhase(day: number, ladenDays: number): { f: number; phase: 'loading' | 'laden' | 'unloading' | 'ballast'; daysAtSea: number } {
  if (day < PORT_DAYS) return { f: 0, phase: 'loading', daysAtSea: 0 };
  if (day < PORT_DAYS + ladenDays) return { f: (day - PORT_DAYS) / ladenDays, phase: 'laden', daysAtSea: day - PORT_DAYS };
  if (day < 2 * PORT_DAYS + ladenDays) return { f: 1, phase: 'unloading', daysAtSea: ladenDays };
  return { f: 1 - (day - 2 * PORT_DAYS - ladenDays) / ladenDays, phase: 'ballast', daysAtSea: ladenDays };
}

function VoyageMap({ dest, day, c }: { dest: Dest; day: number; c: LngCargo }) {
  const d = BAYPORT_LNG.destinations[dest];
  const ph = voyagePhase(day, d.ladenDays);
  const [sx, sy] = along(ROUTES[dest], ph.f);
  const aboard = ph.phase === 'loading' ? (day / PORT_DAYS) : ph.phase === 'laden' ? Math.pow(1 - BOIL_OFF_PER_DAY, ph.daysAtSea) : ph.phase === 'unloading' ? (1 - (day - PORT_DAYS - d.ladenDays) / PORT_DAYS) * (c.delivered / c.loaded) : 0;
  const status =
    ph.phase === 'loading'
      ? 'loading at Bayport'
      : ph.phase === 'laden'
        ? `laden, ${pct(aboard, 1)} of the cargo still aboard`
        : ph.phase === 'unloading'
          ? `unloading in ${d.name}`
          : 'returning to Bayport in ballast';
  const fillH = 14 * clamp(aboard, 0, 1);
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 210"
      role="img"
      aria-label={`A carrier on its ${c.roundTripDays}-day round trip from Bayport to ${d.name}: day ${Math.floor(day) + 1}, ${status}.`}
    >
      <rect x={0} y={0} width={640} height={210} fill="#d6e5f1" />
      <path d="M0 0 L60 0 C 66 40, 52 80, 66 112 C 74 136, 60 170, 54 210 L0 210 Z" fill="#f2f0e9" stroke="#a9c3d9" strokeWidth={1.5} />
      <path d="M640 0 L592 0 C 584 26, 600 50, 590 70 L640 74 Z" fill="#f2f0e9" stroke="#a9c3d9" strokeWidth={1.5} />
      <path d="M640 130 L594 134 C 586 150, 600 176, 590 210 L640 210 Z" fill="#f2f0e9" stroke="#a9c3d9" strokeWidth={1.5} />
      {/* A narrow canal on the way to Asia. */}
      <rect x={348} y={176} width={22} height={34} fill="#f2f0e9" />
      <rect x={348} y={140} width={22} height={24} fill="#f2f0e9" />
      <text x={376} y={156} className="ax">
        canal
      </text>
      {DESTS.map((k) => (
        <polyline
          key={k}
          points={ROUTES[k].map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke={k === dest ? '#2f6fb3' : '#9fb7cc'}
          strokeWidth={k === dest ? 2 : 1.2}
          strokeDasharray="5 5"
        />
      ))}
      <circle cx={70} cy={112} r={6} fill="#fff" stroke="#111" />
      <text x={16} y={30} style={{ fontSize: 13, fontWeight: 600, fill: '#111' }}>
        Bayport
      </text>
      <text x={630} y={30} textAnchor="end" style={{ fontSize: 13, fontWeight: 600, fill: '#111' }}>
        Europe
      </text>
      <text x={630} y={48} textAnchor="end" className="ax">
        {BAYPORT_LNG.destinations.europe.ladenDays} days
      </text>
      <text x={630} y={196} textAnchor="end" style={{ fontSize: 13, fontWeight: 600, fill: '#111' }}>
        Asia
      </text>
      <text x={630} y={178} textAnchor="end" className="ax">
        {BAYPORT_LNG.destinations.asia.ladenDays} days
      </text>
      {/* The ship: a hull with four tanks, filled to the share of the cargo aboard. */}
      <g transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)})`}>
        <path d="M-30 0 L30 0 L24 10 L-26 10 Z" fill="#555" />
        {[-22, -9, 4, 17].map((tx) => (
          <g key={tx}>
            <rect x={tx} y={-15} width={11} height={15} rx={5} fill="#fff" stroke="#555" strokeWidth={1} />
            <rect x={tx + 1} y={-1 - fillH} width={9} height={fillH} rx={3} fill={LIQUID} />
          </g>
        ))}
      </g>
      <text x={320} y={100} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
        Day {Math.floor(day) + 1} of a {c.roundTripDays}-day round trip
      </text>
      <text x={320} y={116} textAnchor="middle" className="ax">
        {status}
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('chain', CHAIN_DEFAULTS);
  const st = s.state;
  const v = voyageOf(st);
  const c = lngCargo(v);
  const rows = DESTS.map((d) => ({ dest: d, c: lngCargo(voyageOf({ ...st, dest: d })) }));
  const lost = 1 - c.sentOut / c.feed;

  // Figure 2 has its own settings, so the numbers quoted for its starting settings hold whatever was done in Figure 1.
  const w = useScenario('voyage', CHAIN_DEFAULTS);
  const ws = w.state;
  const v2 = voyageOf(ws);
  const c2 = lngCargo(v2);

  const play = usePlay(true);
  const [t, setT] = useState(0);
  useAnimationFrame((dt) => setT((x) => x + dt), play.playing);
  const day = (t / SEC_PER_DAY) % c2.roundTripDays;

  const revenue = ws.destPrice * c2.sentOut;
  const cost = c2.costs.feed + c2.costs.liquefaction + c2.costs.shipping + c2.costs.regas;
  const margin = revenue - cost;
  const nb = netback(v2, ws.destPrice);
  const be = breakevenHub(v2, ws.destPrice);
  const solved = matchSolved(ws);

  type Sc = typeof s;
  const hubSlider = (sc: Sc) => (
    <Slider label="Calder Hub price" tone="green" value={sc.state.hub} min={1} max={8} step={HUB_STEP} onChange={(x) => sc.set({ hub: x })} display={`${usd(sc.state.hub, 2)}/MMBtu`} />
  );
  const destSeg = (sc: Sc) => (
    <Segmented label="Destination" value={sc.state.dest} onChange={(d) => sc.set({ dest: d })} options={DESTS.map((d) => ({ value: d, label: `To ${BAYPORT_LNG.destinations[d].name}` }))} />
  );
  const challengeStatus =
    ws.charter !== CHALLENGE.charter
      ? `This demonstration’s charter rate isn’t the starting ${usd(CHALLENGE.charter)} a day: press Reset.`
      : ws.dest !== CHALLENGE.dest
        ? 'Choose Asia.'
        : `At ${usd(ws.destPrice, 2)} in Asia the netback is ${usd(nb, 2)} per MMBtu loaded, against Europe’s ${usd(EUROPE_NETBACK, 2)} at ${usd(CHALLENGE.europePrice, 2)}.`;

  return (
    <LessonPage id="gas/3.5">
      <P>
        <a href={lessonHref('gas/3.4')}>The previous lesson</a> ended with the region tied together by pipelines and storage. Not all of its gas stays inside it. At
        Bayport, on the coast, {fmt(BAYPORT_LNG_FEEDGAS_BCFD, 1)} Bcf/d leaves the pipelines for good: it’s cooled until it becomes a liquid and loaded onto ships
        bound for other continents. Gas pipelines can run under seas, but none crosses an ocean. To sell gas across one, it has to be carried, and a gas is far too
        bulky to carry as it is. LNG is now one of the main ways gas crosses the world; the United States, which became the largest exporter in 2023, ships it
        from terminals along its Gulf Coast.
      </P>
      <P>
        Cooled to about −162 °C (−260 °F) at atmospheric pressure, methane condenses into a clear liquid, <b>liquefied natural gas</b>, or LNG, that takes up about
        a six-hundredth of the space it filled as a gas. In our model a cubic meter of LNG holds {fmt(MMBTU_PER_M3_LNG, 1)} MMBtu of <K c="energy">energy</K>, the
        gas that would fill about {fmt(GAS_M3_PER_LNG_M3)} cubic meters at standard conditions. A large carrier has insulated tanks for 174,000 cubic meters and
        loads about {fmt(SHIP_LOADED_M3)} of them, {mm(EU.loaded)} MMBtu: the gas from {fmt(FEED_BCF, 1)} Bcf of feed. Bayport’s{' '}
        {fmt(BAYPORT_LNG_FEEDGAS_BCFD, 1)} Bcf/d fills one every {fmt(DAYS_PER_CARGO, 1)} days, about {fmt(CARGOES_A_YEAR)} cargoes a year.
      </P>
      <P>
        Each cargo passes through three steps that a pipeline doesn’t need — liquefaction, a voyage and regasification — and each burns some of the gas and costs
        money. In the next demonstration, follow one cargo from Calder Hub to an import terminal overseas. The band’s thickness is the energy, and the red branches
        are the gas burned along the way; under it, the cost of each step per MMBtu that finally reaches the far side. Prices are simulated. Set the{' '}
        <K c="price">Calder Hub price</K>, the destination and the ship’s charter rate:
      </P>

      <Figure name="LNG Supply Chain" scenario={s}>
        {destSeg(s)}
        <ChainDiagram c={c} dest={st.dest} />
        <Legend
          items={[
            { label: 'Energy as gas', color: GAS },
            { label: 'Energy as LNG', color: LIQUID },
            { label: 'Gas burned along the way', color: LOSS },
          ]}
        />
        <CostChart rows={rows} selected={st.dest} hub={st.hub} />
        <Legend items={(Object.keys(COST_NAMES) as Array<keyof typeof COST_NAMES>).map((kk) => ({ label: COST_NAMES[kk], color: COST_COLORS[kk] }))} />
        <Readouts
          items={[
            { label: 'gas burned along the way', value: pct(lost, 1), tone: 'red' },
            { label: 'the ship’s round trip', value: `${c.roundTripDays} days` },
          ]}
        />
        {hubSlider(s)}
        <Slider label="Charter rate" value={st.charter} min={20_000} max={300_000} step={5_000} onChange={(x) => s.set({ charter: x })} display={`${usd(st.charter)} a day`} />
        <Caption>
          With gas at {usd(st.hub, 2)} at Calder Hub, each MMBtu reaching {BAYPORT_LNG.destinations[st.dest].name} costs {usd(c.delivered$, 2)}:{' '}
          {usd(c.delivered$ - st.hub, 2)} more than it cost at the hub.
        </Caption>
      </Figure>

      <P>
        At the starting settings the cargo goes to Europe. Of the {mm(EU.feed)} MMBtu of gas that enters the Bayport plant, the plant burns{' '}
        {pct(LIQUEFACTION_LOSS)} — {fmt(EU.liquefactionFuel)} MMBtu — to drive the huge refrigeration compressors that do the cooling. At sea the tanks are
        insulated but not perfect, and about {pct(BOIL_OFF_PER_DAY, 1)} of the cargo boils off each day; the ship burns that gas in its engines, {fmt(EU.boilOff)}{' '}
        MMBtu over {BAYPORT_LNG.destinations.europe.ladenDays} days. The import terminal warms the liquid back into gas, often with seawater, and in our model burns{' '}
        {pct(REGAS_LOSS, 1)} of it doing so. In all, {pct(1 - EU.sentOut / EU.feed, 1)} of the gas is gone before the rest reaches a customer. Northline, by
        comparison, burns {pct(NORTHLINE_FUEL, 1)} of its gas to carry it 240 miles.
      </P>
      <P>
        The money tells the same story, more sharply. Bayport’s contracts are written the way many North American export contracts are: for every MMBtu loaded, the
        cargo’s buyer pays {fmt(BAYPORT_LNG.feedMultiplier * 100)}% of the Calder Hub price — the extra 15% is meant to cover the gas the plant burns — plus a fixed{' '}
        {usd(BAYPORT_LNG.liquefactionFee, 2)} fee that pays for the plant itself. Then the buyer pays for the ship: {usd(BAYPORT_LNG.charterPerDay)} a day for a{' '}
        {EU.roundTripDays}-day round trip, {BAYPORT_LNG.destinations.europe.ladenDays} days out laden, {BAYPORT_LNG.destinations.europe.ladenDays} back empty
        and {PORT_DAYS} in each port, which is {money(EU.costs.shipping)}, or {usd(EU.perMMBtu.shipping, 2)} per MMBtu. The import terminal charges{' '}
        {usd(BAYPORT_LNG.regasFee, 2)}. Gas bought for {usd(CHAIN_DEFAULTS.hub, 2)} at Calder Hub arrives in Europe at {usd(EU.delivered$, 2)}, {usd(LNG_ADDER, 2)}{' '}
        more. Moving an MMBtu through Northline costs {usd(NORTHLINE.variableCost, 2)}, plus the {usd(NORTHLINE_CAPITAL, 2)} capital charge that{' '}
        <a href={lessonHref('gas/3.1')}>Lesson 3.1</a> found when the line runs full: {usd(NORTHLINE_ALL_IN, 2)} in all. The LNG chain adds about{' '}
        {fmt(Math.round(LNG_ADDER / NORTHLINE_ALL_IN))} times as much. And of everything added on top of the gas, the biggest piece isn’t the voyage; it’s the fixed
        fee for the liquefaction plant.
      </P>

      <H2>Farther away</H2>
      <P>
        Switch the destination to Asia. The laden voyage takes {BAYPORT_LNG.destinations.asia.ladenDays} days and passes through a canal whose toll adds{' '}
        {money(BAYPORT_LNG.destinations.asia.voyageFees)} to every voyage (an illustrative figure), so the ship is tied up for {AS.roundTripDays} days instead of{' '}
        {EU.roundTripDays}. Shipping rises to {usd(AS.perMMBtu.shipping, 2)} per MMBtu, boil-off to {pct(AS.boilOff / AS.loaded, 1)} of the cargo, and the
        delivered cost to {usd(AS.delivered$, 2)}. Distance costs more here than in a pipeline: the ship is paid by the day, and it has to come back empty.
      </P>
      <P>
        It also takes ships. To keep Bayport’s terminal running, a new carrier has to arrive every {fmt(DAYS_PER_CARGO, 1)} days, so serving Europe takes about{' '}
        {fmt(SHIPS_EU)} ships on the water at once and serving Asia about {fmt(SHIPS_AS)}. The world’s fleet can’t grow overnight, and charter rates for LNG carriers
        have swung several-fold within a single year as the demand for voyages has shifted. Drag the charter rate to {usd(DEAR)} a day: shipping to Europe climbs
        from {usd(EU.perMMBtu.shipping, 2)} to {usd(EU_DEAR.perMMBtu.shipping, 2)} per MMBtu, and to Asia from {usd(AS.perMMBtu.shipping, 2)} to{' '}
        {usd(AS_DEAR.perMMBtu.shipping, 2)}. The longer the voyage, the more the price of ships matters.
      </P>

      <H2>What a cargo earns</H2>
      <P>
        Whether a cargo is worth sending depends on the price at the other end. In the next demonstration, which begins again from the starting settings — ships at{' '}
        {usd(BAYPORT_LNG.charterPerDay)} a day — a carrier sails the route you choose, and the figures under it settle one cargo at a simulated price at the destination. The most useful of them is the <b>netback</b>: the destination price, less the costs of
        shipping and regasifying, per MMBtu loaded at Bayport. It’s the most a buyer could pay at the export terminal and still break even, and it ties a price
        overseas back to a price at Calder Hub:
      </P>

      <Figure name="LNG Supply Chain · a voyage" scenario={w} play={play}>
        {destSeg(w)}
        <VoyageMap dest={ws.dest} day={day} c={c2} />
        <Readouts
          items={[
            { label: 'the cargo sells for', value: money(revenue), tone: 'green' },
            { label: 'it cost, every step included', value: money(cost), tone: 'green' },
            { label: margin >= 0 ? 'profit on the cargo' : 'loss on the cargo', value: money(margin), tone: margin >= 0 ? 'green' : 'red' },
            { label: 'netback per MMBtu loaded', value: usd(nb, 2), tone: 'green' },
          ]}
        />
        <Eq label={`Break-even Calder price equals the netback ${usd(nb, 2)} minus the ${usd(BAYPORT_LNG.liquefactionFee, 2)} fee, divided by 1.15: ${usd(be, 2)}`}>
          <span>break-even hub price</span>
          <Op>=</Op>
          <Frac
            top={
              <span>
                <K c="price">{usd(nb, 2)}</K> − {usd(BAYPORT_LNG.liquefactionFee, 2)}
              </span>
            }
            bottom={fmt(BAYPORT_LNG.feedMultiplier, 2)}
          />
          <Op>=</Op>
          <K c="price">{usd(be, 2)}</K>
        </Eq>
        <Slider
          label={`Price in ${BAYPORT_LNG.destinations[ws.dest].name} (simulated)`}
          tone="green"
          value={ws.destPrice}
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={PRICE_STEP}
          onChange={(x) => w.set({ destPrice: x })}
          display={`${usd(ws.destPrice, 2)}/MMBtu`}
        />
        {hubSlider(w)}
      </Figure>

      <P>
        At the starting settings a cargo to Europe sells for a simulated $9.00 per MMBtu and earns {money(EU_MARGIN_9)}. Its netback is {usd(EU_NETBACK_9, 2)}:
        $9.00 on each of the {mm(EU.sentOut)} MMBtu sent out, less {money(EU.costs.shipping)} for the ship and {money(EU.costs.regas)} for the terminal, divided
        among the {mm(EU.loaded)} MMBtu loaded. Take away the {usd(BAYPORT_LNG.liquefactionFee, 2)} fee and divide by 1.15, and the cargo covers every cost as long
        as gas at Calder Hub costs less than {usd(EU_BE_9, 2)}. Above that, the gas is worth more at home than abroad.
      </P>

      <Challenge
        id="a"
        figure="LNG Supply Chain · a voyage"
        question={`A buyer in Asia wants Bayport’s next cargo. To the nearest 25 cents, what price in Asia makes a cargo there worth as much at Bayport — the same netback — as one to Europe at ${usd(CHALLENGE.europePrice, 2)}? Predict it first from the delivered costs to the two destinations, ${usd(EU.delivered$, 2)} and ${usd(AS.delivered$, 2)}, then check.`}
        solved={solved}
        status={challengeStatus}
        success={`Solved: ${usd(ANSWER, 2)}, about ${usd(ANSWER - CHALLENGE.europePrice, 2)} more than Europe pays, close to the ${usd(AS.delivered$ - EU.delivered$, 2)} more it costs to put an MMBtu ashore in Asia. The netback there is ${usd(nb, 2)}, against Europe’s ${usd(EUROPE_NETBACK, 2)}, and the gas at Calder Hub could cost up to ${usd(be, 2)}, against ${usd(EU_BE_9, 2)}. At the same ${usd(CHALLENGE.europePrice, 2)}, a cargo to Asia would net back only ${usd(AS_NETBACK_9, 2)}, and the most the gas could cost would fall to ${usd(AS_BE_9, 2)}: the same overseas price supports a lower price at home the farther away the buyer is.`}
      />

      <P>
        The netback is how a price on another continent reaches back into the region. While cargoes pay, Bayport takes its {fmt(BAYPORT_LNG_FEEDGAS_BCFD, 1)}{' '}
        Bcf/d day after day — more than Metro uses on a summer day, {fmt(REFERENCE_DAYS.summer.demand.metro, 1)} Bcf/d — competing with the region’s own customers for the gas in Gulfward and the Coastal Line.
        When they stop paying, that demand can vanish. Not every cost in <FigRef to="LNG Supply Chain">the first demonstration</FigRef> disappears when a cargo is
        canceled, though — the plant’s fee is often owed regardless — and which costs are sunk decides whether a cargo sails. We’ll come back to that in{' '}
        <a href={lessonHref('gas/5.4')}>Lesson 5.4</a>.
      </P>

      <H2>Scarce here, plentiful there</H2>
      <P>
        This chapter asked why gas can be scarce in one place while it’s abundant in another. The answer is that gas can only be where the network can carry it, when
        the network can carry it. Every pipeline has a capacity set by the physics of Chapter 1, and new pipe costs hundreds of millions to billions of dollars, so
        networks are sized for the coldest day and no more (<a href={lessonHref('gas/3.1')}>Lesson 3.1</a>). Once the pipelines into a place are full, more gas at a basin does it no good, however
        plentiful (<a href={lessonHref('gas/3.2')}>Lesson 3.2</a>). Within a day, the gas packed into a pipeline covers the morning and evening peaks — but only a few
        hours’ worth, and less the fuller the line (<a href={lessonHref('gas/3.3')}>Lesson 3.3</a>). Across seasons, storage carries summer’s gas into winter, at a
        rate that falls as the field empties (<a href={lessonHref('gas/3.4')}>Lesson 3.4</a>). And LNG links the region to the rest of the world, at a cost of
        several dollars per MMBtu and an eighth of the gas.
      </P>
      <P>
        All of these limits have one thing in common: they make the same gas more valuable in some places and at some times than in others. So far we’ve moved gas
        with engineering. In <a href={lessonHref('gas/4.1')}>Chapter 4</a> we turn to markets — how buyers and sellers who never see a pipeline settle on prices,
        starting with how supply and demand balance across the whole region.
      </P>
    </LessonPage>
  );
}
