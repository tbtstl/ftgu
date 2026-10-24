import {
  Caption,
  Challenge,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  pct,
  tint,
  useScenario,
} from '../../../framework';
import {
  COOLING_LIMIT_KW,
  FLOOR_M2_PER_RACK,
  RACK_OVERHEAD_U,
  RACK_UNITS,
  clusterLayout,
  rackConfig,
  rackLimits,
  serverUnits,
  type ClusterLayout,
  type RackLimit,
  type RackResult,
} from '../../../engines/compute/rack';
import { ACCELERATORS, GPU_COLOR, GPU_IDS, SERVERS, serverPowerW, type Cooling, type GpuId } from '../../../model/compute/hardware';
import { HOME_LOAD_KW, energy } from '../../../model/profiles';

// ---------------------------------------------------------------------------
// The rack and its limits.

/** Power feeds a rack position might be given, kW: from an older hall's to a purpose-built AI hall's. */
export const FEEDS = [10, 17, 30, 40, 60, 100, 140] as const;
export type Feed = (typeof FEEDS)[number];

export const COOLINGS: Cooling[] = ['air', 'liquid'];
const COOLING_LABEL: Record<Cooling, string> = { air: 'Air', liquid: 'Liquid' };

/** The first demonstration starts with two air-cooled A-class servers on a 40 kW feed. */
export const RACK_DEFAULTS = { gpu: 'A' as GpuId, cooling: 'air' as Cooling, feed: 40 as Feed, servers: 2 };
/** The second starts with 1,024 A-class GPUs, air-cooled, on 40 kW feeds. */
export const HALL_DEFAULTS = { gpu: 'A' as GpuId, cooling: 'air' as Cooling, feed: 40 as Feed, gpus: 1024 };

/** Most servers the rack's space allows: the slider's top. */
export function spaceLimit(gpu: GpuId, cooling: Cooling): number {
  return rackLimits(gpu, cooling, FEEDS[FEEDS.length - 1]).space;
}

/** The rack as built, with the requested servers clamped to what physically fits in its 40 usable units. */
export function rackState(s: { gpu: GpuId; cooling: Cooling; feed: number; servers: number }): RackResult {
  const servers = Math.max(0, Math.min(s.servers, spaceLimit(s.gpu, s.cooling)));
  return rackConfig({ gpu: s.gpu, cooling: s.cooling, servers, feedKW: s.feed });
}

/** Every limit that stops the rack at its most servers (several can tie). */
export function bindingLimits(s: { gpu: GpuId; cooling: Cooling; feed: number }): RackLimit[] {
  const lim = rackLimits(s.gpu, s.cooling, s.feed);
  const most = Math.min(lim.space, lim['power feed'], lim.cooling);
  return (['space', 'power feed', 'cooling'] as RackLimit[]).filter((l) => lim[l] === most);
}

/** The limits that one more server would break (space included). */
export function nextBlockers(s: { gpu: GpuId; cooling: Cooling; feed: number; servers: number }): RackLimit[] {
  const r = rackState(s);
  const lim = rackLimits(s.gpu, s.cooling, s.feed);
  return (['space', 'power feed', 'cooling'] as RackLimit[]).filter((l) => r.servers + 1 > lim[l]);
}

export interface PowerPart {
  id: string;
  label: string;
  kw: number;
  color: string;
}

/** Where one server's power goes, kW: the parts' own draw, the fans that cool them, and the power supplies' conversion loss. */
export function serverBreakdown(gpu: GpuId, cooling: Cooling): PowerPart[] {
  const s = SERVERS[gpu];
  const g = ACCELERATORS[gpu];
  const gpusW = s.gpus * g.tdpW;
  const electronics = gpusW + s.cpuW + s.memW + s.netW;
  const fans = electronics * s.fanShare[cooling];
  const total = serverPowerW(gpu, cooling);
  return [
    { id: 'gpu', label: `Eight ${g.short} GPUs`, kw: gpusW / 1000, color: GPU_COLOR[gpu] },
    { id: 'cpu', label: 'Two host CPUs', kw: s.cpuW / 1000, color: '#8c8c8c' },
    { id: 'mem', label: 'Memory and storage', kw: s.memW / 1000, color: '#b5b5b5' },
    { id: 'net', label: 'Network cards and link switches', kw: s.netW / 1000, color: GRAPHIC.blue },
    { id: 'fans', label: 'Fans', kw: fans / 1000, color: '#d4d4d4' },
    { id: 'psu', label: 'Power-supply losses', kw: (total - electronics - fans) / 1000, color: GRAPHIC.red },
  ];
}

/** Challenge a: at least 64 B-class GPUs in one rack, every limit respected. */
export const RACK_TARGET = 64;
export function rackSolved(s: { gpu: GpuId; cooling: Cooling; feed: number; servers: number }): boolean {
  const r = rackState(s);
  return s.gpu === 'B' && r.gpus >= RACK_TARGET && r.violations.length === 0;
}

/** Challenge b: 1,024 A-class GPUs (or more) in no more than 20 racks. */
export const HALL_TARGET = { gpus: 1024, racks: 20 };
export function hallSolved(s: { gpu: GpuId; cooling: Cooling; feed: number; gpus: number }): boolean {
  if (s.gpu !== 'A' || s.gpus < HALL_TARGET.gpus) return false;
  return clusterLayout(s.gpu, s.cooling, s.feed, s.gpus).racks <= HALL_TARGET.racks;
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes, all from the engines.

const A = ACCELERATORS.A;
const B = ACCELERATORS.B;
const L = ACCELERATORS.L;
const A_AIR = serverBreakdown('A', 'air');
const A_LIQ = serverBreakdown('A', 'liquid');
const part = (parts: PowerPart[], id: string) => parts.find((p) => p.id === id)!.kw;
/** Average draw of a home in the electricity course's model, kW. */
const HOME_KW = energy(HOME_LOAD_KW) / 24;

export const NUMBERS = {
  aAirKW: serverPowerW('A', 'air') / 1000,
  aLiquidKW: serverPowerW('A', 'liquid') / 1000,
  aGpusKW: part(A_AIR, 'gpu'),
  aGpuShare: part(A_AIR, 'gpu') / (serverPowerW('A', 'air') / 1000),
  aFansAir: part(A_AIR, 'fans'),
  aFansLiquid: part(A_LIQ, 'fans'),
  aPsuLoss: part(A_AIR, 'psu'),
  aNet: part(A_AIR, 'net'),
  fullAir: rackConfig({ gpu: 'A', cooling: 'air', servers: 4, feedKW: 40 }),
  fifthAir: rackConfig({ gpu: 'A', cooling: 'air', servers: 5, feedKW: 40 }),
  oldHall: rackConfig({ gpu: 'A', cooling: 'air', servers: 1, feedKW: 17 }),
  aLiquid100: rackConfig({ gpu: 'A', cooling: 'liquid', servers: 10, feedKW: 100 }),
  bAir40: rackConfig({ gpu: 'B', cooling: 'air', servers: 3, feedKW: 40 }),
  bLiquid140: rackConfig({ gpu: 'B', cooling: 'liquid', servers: 10, feedKW: 140 }),
  homes: rackConfig({ gpu: 'A', cooling: 'air', servers: 4, feedKW: 40 }).rackKW / HOME_KW,
  hallAirA: clusterLayout('A', 'air', 40, 1024),
  hallLiquidA: clusterLayout('A', 'liquid', 100, 1024),
  hallLiquidA60: clusterLayout('A', 'liquid', 60, 1024),
  hallLiquidB: clusterLayout('B', 'liquid', 140, 1024),
};

const kw1 = (v: number) => `${fmt(v, 1)} kW`;
const kw2 = (v: number) => `${fmt(v, 2)} kW`;
const mw2 = (v: number) => `${fmt(v, 2)} MW`;
const LIMIT_TEXT: Record<RackLimit, string> = { space: 'space', 'power feed': 'power feed', cooling: 'cooling' };

function listText(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

// ---------------------------------------------------------------------------
// The rack drawing.

const RX0 = 64;
const RX1 = 262;
const TOP = 20;
const UH = 10.5;
const BOTTOM = TOP + RACK_UNITS * UH;
const PX0 = 304;
const PX1 = 604;
const RED = GRAPHIC.red;
const COOL = GRAPHIC.teal;

function RackDrawing({ gpu, cooling, feed, r }: { gpu: GpuId; cooling: Cooling; feed: number; r: RackResult }) {
  const g = ACCELERATORS[gpu];
  const h = serverUnits(gpu, cooling);
  const lim = rackLimits(gpu, cooling, feed);
  const coolLimit = COOLING_LIMIT_KW[cooling];
  const parts = serverBreakdown(gpu, cooling);
  const serverKW = serverPowerW(gpu, cooling) / 1000;
  // Power bar: 0–150 kW.
  const kx = (v: number) => PX0 + (Math.min(150, Math.max(0, v)) / 150) * (PX1 - PX0);
  const okKW = Math.min(r.rackKW, Math.min(feed, coolLimit));
  // Server breakdown bar: 0–15 kW.
  const sx = (v: number) => PX0 + (v / 15) * (PX1 - PX0);
  let acc = 0;
  const segs = parts.map((p) => {
    const x0 = sx(acc);
    acc += p.kw;
    return { ...p, x0, x1: sx(acc) };
  });
  const ux = (u: number) => PX0 + (u / RACK_UNITS) * (PX1 - PX0);
  const violations = r.violations.length ? ` One or more servers break the ${listText(r.violations.map((v) => LIMIT_TEXT[v]))} limit.` : '';
  const sameMarker = Math.abs(feed - coolLimit) < 1;

  return (
    <svg
      className="diagram"
      viewBox="0 0 620 476"
      role="img"
      aria-label={`A ${RACK_UNITS}-unit rack holding ${r.servers} ${cooling}-cooled ${g.short} servers, ${r.gpus} GPUs, drawing ${kw1(r.rackKW)} from a ${feed} kW feed; ${cooling} cooling can remove ${coolLimit} kW. ${r.unitsUsed} of ${RACK_UNITS} units used.${violations}`}
    >
      {/* Frame and unit lines. */}
      <rect x={RX0 - 10} y={TOP - 8} width={RX1 - RX0 + 20} height={BOTTOM - TOP + 16} rx={3} fill="#f7f7f5" stroke="#a6a6a6" strokeWidth={2} />
      {Array.from({ length: RACK_UNITS + 1 }, (_, u) => (
        <line key={u} className="gl" x1={RX0} x2={RX1} y1={BOTTOM - u * UH} y2={BOTTOM - u * UH} />
      ))}
      {[1, 10, 20, 30, 40].map((u) => (
        <text key={u} className="ax ax-e" x={RX0 - 14} y={BOTTOM - (u - 0.5) * UH + 4}>
          {u}
        </text>
      ))}
      <text className="ax ax-e" x={RX0 - 14} y={TOP + 4}>
        U
      </text>
      {/* The switch at the top. */}
      <rect x={RX0} y={TOP} width={RX1 - RX0} height={RACK_OVERHEAD_U * UH - 1} fill={tint(GRAPHIC.blue, 0.25)} stroke={GRAPHIC.blue} />
      <text x={(RX0 + RX1) / 2} y={TOP + RACK_OVERHEAD_U * UH - 6} textAnchor="middle" style={{ fontSize: 11, fill: TEXT.blue }}>
        network switch and cables
      </text>
      {/* Servers, from the bottom up. */}
      {Array.from({ length: r.servers }, (_, i) => {
        const k = i + 1;
        const overFeed = k > lim['power feed'];
        const overCool = k > lim.cooling;
        const bad = overFeed || overCool;
        const y1 = BOTTOM - i * h * UH;
        const y0 = y1 - h * UH + 1.5;
        const why = overFeed && overCool ? 'over feed and cooling' : overFeed ? 'over the power feed' : 'too much heat';
        return (
          <g key={k}>
            <rect
              x={RX0 + 1}
              y={y0}
              width={RX1 - RX0 - 2}
              height={y1 - y0 - 1}
              rx={2}
              fill={bad ? tint(RED, 0.2) : tint(GPU_COLOR[gpu], 0.28)}
              stroke={bad ? RED : GPU_COLOR[gpu]}
              strokeWidth={1.5}
              strokeDasharray={bad ? '5 3' : undefined}
            />
            <rect x={RX0 + 1} y={y0} width={6} height={y1 - y0 - 1} fill={bad ? RED : GPU_COLOR[gpu]} />
            <text x={RX0 + 14} y={(y0 + y1) / 2 + 4} style={{ fontSize: 11.5, fontWeight: 500, fill: bad ? TEXT.red : '#333' }}>
              {bad ? `Server ${k}: ${why}` : `Server ${k} · 8 × ${g.short}`}
            </text>
            {!bad && (
              <text x={RX1 - 6} y={(y0 + y1) / 2 + 4} textAnchor="end" style={{ fontSize: 11.5, fill: '#555' }}>
                {kw1(serverKW)}
              </text>
            )}
          </g>
        );
      })}
      {r.servers === 0 && (
        <text x={(RX0 + RX1) / 2} y={(TOP + BOTTOM) / 2} textAnchor="middle" className="ax">
          an empty rack
        </text>
      )}

      {/* Rack power against the feed and the cooling limit. */}
      <text className="ax" x={PX0} y={12}>
        Rack power
      </text>
      <text className="ax ax-e" x={PX1} y={12} style={{ fill: TEXT.red }}>
        {kw1(r.rackKW)}
      </text>
      <rect x={PX0} y={42} width={PX1 - PX0} height={20} fill="#f0f0ed" />
      <rect x={PX0} y={42} width={kx(okKW) - PX0} height={20} fill={tint(RED, 0.55)} />
      {r.rackKW > okKW + 1e-9 && <rect x={kx(okKW)} y={42} width={kx(r.rackKW) - kx(okKW)} height={20} fill={RED} />}
      <line x1={kx(feed)} x2={kx(feed)} y1={36} y2={68} stroke="#333" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={kx(feed)} y={33} textAnchor={kx(feed) > 540 ? 'end' : 'middle'} style={{ fontSize: 11, fill: '#333' }}>
        feed {feed} kW
      </text>
      <line x1={kx(coolLimit)} x2={kx(coolLimit)} y1={sameMarker ? 36 : 40} y2={72} stroke={COOL} strokeWidth={1.5} strokeDasharray="2 3" />
      <text x={kx(coolLimit)} y={84} textAnchor={kx(coolLimit) > 540 ? 'end' : 'middle'} style={{ fontSize: 11, fill: TEXT.teal }}>
        {cooling} removes {coolLimit} kW
      </text>
      {[0, 50, 100, 150].map((v) => (
        <text key={v} className={v === 150 ? 'ax ax-e' : v === 0 ? 'ax' : 'ax ax-m'} x={kx(v)} y={106}>
          {v} kW
        </text>
      ))}

      {/* Rack units used. */}
      <text className="ax" x={PX0} y={138}>
        Rack units
      </text>
      <text className="ax ax-e" x={PX1} y={138}>
        {r.unitsUsed} of {RACK_UNITS} used
      </text>
      <rect x={PX0} y={146} width={PX1 - PX0} height={14} fill="#f0f0ed" />
      <rect x={PX0} y={146} width={ux(Math.min(RACK_UNITS, r.unitsUsed)) - PX0} height={14} fill="#a9a9a9" />

      {/* One server's power. */}
      <text className="ax" x={PX0} y={188}>
        One server’s {kw2(serverKW)}
      </text>
      {segs.map((s) => (
        <rect key={s.id} x={s.x0} y={196} width={Math.max(0, s.x1 - s.x0 - 1)} height={20} fill={s.color} />
      ))}
      {segs.map((s, i) => (
        <g key={s.id}>
          <rect x={PX0} y={234 + i * 22} width={10} height={10} rx={2} fill={s.color} />
          <text x={PX0 + 18} y={243 + i * 22} style={{ fontSize: 12, fill: '#333' }}>
            {s.label}
          </text>
          <text x={PX1} y={243 + i * 22} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
            {kw2(s.kw)}
          </text>
        </g>
      ))}
      <text className="ax" x={PX0} y={384}>
        {g.short} server, {cooling}-cooled: {h} units tall
      </text>
      <text className="ax" x={PX0} y={402}>
        GPUs’ share of the server’s power: {pct(parts[0].kw / serverKW)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The hall floor.

function HallFloor({ gpu, cooling, feed, gpus, layout }: { gpu: GpuId; cooling: Cooling; feed: number; gpus: number; layout: ClusterLayout }) {
  const g = ACCELERATORS[gpu];
  if (!Number.isFinite(layout.racks)) {
    return (
      <svg className="diagram" viewBox="0 0 620 90" role="img" aria-label={`Not even one ${cooling}-cooled ${g.short} server fits on a ${feed} kW feed.`}>
        <rect x={24} y={14} width={572} height={62} rx={4} fill={tint(RED, 0.12)} stroke={RED} strokeDasharray="5 3" />
        <text x={310} y={50} textAnchor="middle" style={{ fontSize: 13, fill: TEXT.red }}>
          Not even one {cooling}-cooled {g.short} server ({kw1(serverPowerW(gpu, cooling) / 1000)}) fits on a {feed} kW feed.
        </text>
      </svg>
    );
  }
  const n = layout.racks;
  const perRow = Math.max(24, Math.ceil(n / 10));
  const cell = 572 / perRow;
  const tile = cell * 0.8;
  const aisle = cell * 0.7;
  const rows = Math.ceil(n / perRow);
  const yOf = (row: number) => 30 + row * cell + Math.floor(row / 2) * aisle;
  const height = Math.ceil(yOf(rows - 1) + cell + 34);
  const rackKW = (layout.itMW * 1000) / n;
  const opacity = 0.35 + 0.65 * Math.min(1, rackKW / 120);
  return (
    <svg
      className="diagram"
      viewBox={`0 0 620 ${height}`}
      role="img"
      aria-label={`${fmt(gpus)} ${cooling}-cooled ${g.short} GPUs on ${feed} kW feeds: ${fmt(n)} racks of up to ${layout.gpusPerRack} GPUs, ${mw2(layout.itMW)} of IT power, ${fmt(layout.floorM2)} square meters of floor.`}
    >
      <text className="ax" x={24} y={16}>
        Data-hall floor: each tile is one rack, {FLOOR_M2_PER_RACK} m² with its share of the aisles
      </text>
      {Array.from({ length: n }, (_, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        return <rect key={i} x={24 + col * cell + (cell - tile) / 2} y={yOf(row) + (cell - tile) / 2} width={tile} height={tile} rx={1.5} fill={GPU_COLOR[gpu]} opacity={opacity} />;
      })}
      <text x={24} y={height - 10} style={{ fontSize: 12.5, fontWeight: 500, fill: '#333' }}>
        {fmt(n)} racks · {fmt(layout.floorM2)} m² · {mw2(layout.itMW)} · about {kw1(rackKW)} per rack
      </text>
    </svg>
  );
}

interface ConfigRow {
  key: string;
  gpu: GpuId;
  cooling: Cooling;
  layout: ClusterLayout;
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario('rack', RACK_DEFAULTS);
  const st = s1.state;
  const space = spaceLimit(st.gpu, st.cooling);
  const r = rackState(st);
  const blockers = nextBlockers(st);
  const coolLimit = COOLING_LIMIT_KW[st.cooling];
  let caption: string;
  if (r.servers === 0) caption = 'An empty rack. Add servers.';
  else if (r.violations.length) {
    const parts: string[] = [];
    if (r.violations.includes('power feed')) parts.push(`more than its ${st.feed} kW feed can deliver`);
    if (r.violations.includes('cooling')) parts.push(`more heat than ${st.cooling} cooling can carry out of one rack (${coolLimit} kW)`);
    caption = `${r.servers} servers draw ${kw1(r.rackKW)}: ${listText(parts)}. Only ${r.maxServers} fit.`;
  } else if (blockers.length) {
    caption = `Full at ${r.servers} servers and ${r.gpus} GPUs: one more would break the ${listText(blockers.map((b) => LIMIT_TEXT[b]))} limit${blockers.length > 1 ? 's' : ''}.`;
  } else {
    const bind = bindingLimits(st).map((b) => LIMIT_TEXT[b]);
    caption = `${r.servers} servers, ${r.gpus} GPUs, ${kw1(r.rackKW)}. There is room for ${r.maxServers - r.servers} more before the ${listText(bind)} ${bind.length > 1 ? 'run' : 'runs'} out.`;
  }
  const solvedA = rackSolved(st);
  let statusA: string;
  if (st.gpu !== 'B') statusA = 'Choose the B-class first.';
  else if (r.violations.length) statusA = `${r.gpus} B-class GPUs, but the rack breaks its ${listText(r.violations.map((v) => LIMIT_TEXT[v]))} limit.`;
  else statusA = `${r.gpus} B-class GPUs fit so far; the ${listText(bindingLimits(st).map((b) => LIMIT_TEXT[b]))} ${bindingLimits(st).length > 1 ? 'stop' : 'stops'} this rack at ${r.maxServers * 8}.`;

  const s2 = useScenario('hall', HALL_DEFAULTS);
  const h = s2.state;
  const layout = clusterLayout(h.gpu, h.cooling, h.feed, h.gpus);
  const solvedB = hallSolved(h);
  const g2 = ACCELERATORS[h.gpu];
  const rows: ConfigRow[] = GPU_IDS.flatMap((g) => COOLINGS.map((c) => ({ key: `${g}-${c}`, gpu: g, cooling: c, layout: clusterLayout(g, c, h.feed, h.gpus) })));
  const statusB =
    h.gpu !== 'A'
      ? 'Choose the A-class first.'
      : h.gpus < HALL_TARGET.gpus
        ? `Set the GPUs to at least ${fmt(HALL_TARGET.gpus)}.`
        : Number.isFinite(layout.racks)
          ? `${fmt(h.gpus)} A-class GPUs take ${fmt(layout.racks)} racks of ${layout.gpusPerRack}.`
          : `Not even one server fits a ${h.feed} kW feed.`;

  const N = NUMBERS;

  return (
    <LessonPage id="compute/4.1">
      <P>
        The previous lesson matched six workloads to a fleet of GPUs that simply existed: 64 of one kind, 336 of another, 24 of a third. This chapter asks where
        such a fleet comes from, and what limits how much of it there can be. A GPU computes nothing until it sits in a server, the server sits in a rack, and the
        rack is fed with electricity and kept cool. Each of those steps has limits of its own, and they, more than the supply of chips, often decide how much usable
        compute a building can hold.
      </P>
      <P>
        Start with the server. Training GPUs typically come eight to a server, on one board joined by the GPU links of{' '}
        <a href={lessonHref('compute/2.5')}>Lesson 2.5</a>. Beside them sit two host CPUs, which run the operating system and feed the GPUs their work (
        <a href={lessonHref('compute/2.1')}>Lesson 2.1</a>), with their memory and local storage; a network card for every GPU, and the switch chips for the GPU
        links; fans; and power supplies that turn the building’s alternating current into the direct current the electronics use. Every part draws{' '}
        <K c="power">power</K>, and all of it ends up as heat. An air-cooled server of eight {A.name} GPUs draws {kw2(N.aAirKW)} at full load, of which the GPUs
        themselves account for {kw1(N.aGpusKW)}: {pct(N.aGpuShare)}.
      </P>
      <P>
        Servers go into racks: steel cabinets built to a standard 19-inch width, whose height is counted in <b>rack units</b> of 1.75 inches. Ours have {RACK_UNITS} units, two of
        them taken by a network switch and its cabling. Each rack position in a data hall is wired with a <K c="power">power feed</K> of fixed size, and whatever
        the rack draws it turns into heat that must be carried away. In our model, air blown through the servers can carry away at most about{' '}
        {COOLING_LIMIT_KW.air} kW from one rack; water piped to cold plates on the chips can carry {COOLING_LIMIT_KW.liquid} kW. In the next demonstration, choose an
        accelerator, a way of cooling and the size of the feed, then add servers to the rack. The bars beside it compare the rack’s power with the feed and with
        what its cooling can remove, count its units, and break one server’s power into its parts:
      </P>

      <Figure name="GPU Rack Builder" scenario={s1}>
        <Segmented label="Accelerator" value={st.gpu} onChange={(v) => s1.set({ gpu: v })} options={GPU_IDS.map((g) => ({ value: g, label: ACCELERATORS[g].name }))} />
        <Segmented label="Cooling" value={st.cooling} onChange={(v) => s1.set({ cooling: v })} options={COOLINGS.map((c) => ({ value: c, label: `${COOLING_LABEL[c]}-cooled` }))} />
        <Segmented label="Power feed" value={String(st.feed)} onChange={(v) => s1.set({ feed: Number(v) as Feed })} options={FEEDS.map((f) => ({ value: String(f), label: `${f} kW feed` }))} />
        <RackDrawing gpu={st.gpu} cooling={st.cooling} feed={st.feed} r={r} />
        <Slider
          label="Servers in the rack"
          tone="red"
          value={r.servers}
          min={0}
          max={space}
          onChange={(v) => s1.set({ servers: v })}
          display={`${r.servers} of ${space} that fit`}
        />
        <Readouts
          items={[
            { label: 'GPUs in the rack', value: fmt(r.gpus) },
            { label: `rack power, feed ${st.feed} kW`, value: kw1(r.rackKW), tone: 'red' },
            { label: 'rack units used', value: `${r.unitsUsed} of ${RACK_UNITS}` },
            { label: 'GPUs’ share of the power', value: r.servers ? pct(r.gpuShare) : '—' },
          ]}
        />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        The starting rack holds two {A.short} servers. Add two more and it is full: four servers, {N.fullAir.gpus} GPUs, {kw1(N.fullAir.rackKW)} — about as much as{' '}
        {fmt(N.homes)} homes in the electricity course’s model draw on average. Yet only {N.fullAir.unitsUsed} of its {RACK_UNITS} units are used. A fifth server
        would fit in the space but take the rack to {kw1(N.fifthAir.rackKW)}, past both the 40 kW feed and what air can carry away. The
        rack runs out of power and of cooling long before it runs out of room. On the 17 kW feed of a hall built for ordinary servers, it runs out sooner still: a
        single {A.short} server, {N.oldHall.gpus} GPUs, is all that fits.
      </P>
      <P>
        The breakdown shows where a server’s power goes. Besides the GPUs’ {kw1(N.aGpusKW)}, the network cards and link switches take {kw2(N.aNet)}, the power
        supplies lose {kw2(N.aPsuLoss)} converting current, and the fans need {kw2(N.aFansAir)} to push enough air through the server. Switch to liquid cooling and
        the fans shrink to {kw2(N.aFansLiquid)}, the server to {kw2(N.aLiquidKW)}, and its height from {serverUnits('A', 'air')} units to{' '}
        {serverUnits('A', 'liquid')}: without large heat sinks and fans it is mostly circuit boards. On a 100 kW feed, a liquid-cooled rack takes{' '}
        {N.aLiquid100.servers} {A.short} servers, {N.aLiquid100.gpus} GPUs, at {kw1(N.aLiquid100.rackKW)}, and now space is what stops it.
      </P>
      <P>
        The {B.name} makes the squeeze tighter. Each of its GPUs draws {fmt(B.tdpW)} W, so an air-cooled {B.short} server needs{' '}
        {kw1(serverPowerW('B', 'air') / 1000)} and {serverUnits('B', 'air')} units, and an air-cooled rack holds just {N.bAir40.servers} of them:{' '}
        {N.bAir40.gpus} GPUs. The {L.name} goes the other way: at {fmt(L.tdpW)} W a card, eight air-cooled {L.short} servers fit in the same 40 kW.
      </P>

      <Challenge
        id="a"
        question={`Fit at least ${RACK_TARGET} B-class GPUs into one rack without breaking any of its limits.`}
        solved={solvedA}
        status={statusA}
        success={`Solved. Eight liquid-cooled B-class servers draw ${kw1(rackConfig({ gpu: 'B', cooling: 'liquid', servers: 8, feedKW: 100 }).rackKW)}: too much heat for air, which tops out at ${COOLING_LIMIT_KW.air} kW, and more than any feed under 100 kW can supply. With a ${FEEDS[FEEDS.length - 1]} kW feed the rack can take ${N.bLiquid140.servers} servers, ${N.bLiquid140.gpus} GPUs at ${kw1(N.bLiquid140.rackKW)}, and then space is the limit.`}
      />

      <H2>From racks to a hall</H2>
      <P>
        A training run of the kind <a href={lessonHref('compute/3.3')}>Lesson 3.3</a> sized needs a thousand GPUs or more, so the question becomes how many racks,
        how much floor and how much power a whole cluster takes. In the next demonstration, choose the accelerator, its cooling, the feed every rack is given and
        the number of GPUs; each rack is filled as far as its limits allow, and the floor plan draws one tile per rack. The table compares every accelerator and way
        of cooling at the same feed:
      </P>

      <Figure name="GPU Rack Builder · cluster" scenario={s2}>
        <Segmented label="Accelerator" value={h.gpu} onChange={(v) => s2.set({ gpu: v })} options={GPU_IDS.map((g) => ({ value: g, label: ACCELERATORS[g].name }))} />
        <Segmented label="Cooling" value={h.cooling} onChange={(v) => s2.set({ cooling: v })} options={COOLINGS.map((c) => ({ value: c, label: `${COOLING_LABEL[c]}-cooled` }))} />
        <Segmented label="Power feed" value={String(h.feed)} onChange={(v) => s2.set({ feed: Number(v) as Feed })} options={FEEDS.map((f) => ({ value: String(f), label: `${f} kW feed` }))} />
        <HallFloor gpu={h.gpu} cooling={h.cooling} feed={h.feed} gpus={h.gpus} layout={layout} />
        <Slider label="GPUs in the cluster" value={h.gpus} min={256} max={4096} step={256} onChange={(v) => s2.set({ gpus: v })} display={fmt(h.gpus)} />
        <Readouts
          items={[
            { label: 'racks', value: Number.isFinite(layout.racks) ? fmt(layout.racks) : '—' },
            { label: 'IT power', value: Number.isFinite(layout.itMW) ? mw2(layout.itMW) : '—', tone: 'red' },
            { label: 'floor', value: Number.isFinite(layout.floorM2) ? `${fmt(layout.floorM2)} m²` : '—' },
            { label: 'power per m² of floor', value: Number.isFinite(layout.racks) ? kw1(layout.densityKWm2) : '—', tone: 'red' },
          ]}
        />
        <DataTable
          caption={`${fmt(h.gpus)} GPUs on ${h.feed} kW feeds, by accelerator and cooling`}
          rows={rows}
          rowKey={(x) => x.key}
          rowClass={(x) => (x.gpu === h.gpu && x.cooling === h.cooling ? 'hl' : !Number.isFinite(x.layout.racks) ? 'dim' : '')}
          columns={[
            { label: 'Accelerator, cooling', cell: (x) => `${ACCELERATORS[x.gpu].short}, ${x.cooling}` },
            { label: 'GPUs per rack', cell: (x) => (Number.isFinite(x.layout.racks) ? fmt(x.layout.gpusPerRack) : '—'), align: 'right' },
            { label: 'Racks', cell: (x) => (Number.isFinite(x.layout.racks) ? fmt(x.layout.racks) : 'none fit'), align: 'right' },
            { label: 'IT power', cell: (x) => (Number.isFinite(x.layout.itMW) ? mw2(x.layout.itMW) : '—'), align: 'right' },
            { label: 'Floor', cell: (x) => (Number.isFinite(x.layout.floorM2) ? `${fmt(x.layout.floorM2)} m²` : '—'), align: 'right' },
            { label: 'kW per m²', cell: (x) => (Number.isFinite(x.layout.racks) ? fmt(x.layout.densityKWm2, 1) : '—'), align: 'right' },
          ]}
        />
        <Caption>
          {Number.isFinite(layout.racks)
            ? `${fmt(h.gpus)} ${g2.short} GPUs, ${h.cooling}-cooled on ${h.feed} kW feeds: ${fmt(layout.racks)} racks of up to ${layout.gpusPerRack}, ${mw2(layout.itMW)} before cooling and losses.`
            : `On a ${h.feed} kW feed, not even one ${h.cooling}-cooled ${g2.short} server fits.`}
        </Caption>
      </Figure>

      <P>
        Take {fmt(1024)} {A.short} GPUs. Air-cooled on 40 kW feeds, they fill {fmt(N.hallAirA.racks)} racks and {fmt(N.hallAirA.floorM2)} m² of floor, and
        draw {mw2(N.hallAirA.itMW)}. Cooled with liquid on 100 kW feeds, the same GPUs fit in {fmt(N.hallLiquidA.racks)} racks and {fmt(N.hallLiquidA.floorM2)} m²,
        and draw slightly less, {mw2(N.hallLiquidA.itMW)}, because their fans have shrunk. The power doesn’t go away; it is packed tighter. The hall’s{' '}
        <K c="power">power density</K> rises from {kw1(N.hallAirA.densityKWm2)} per square meter to {kw1(N.hallLiquidA.densityKWm2)}, and with{' '}
        {B.short} GPUs on {FEEDS[FEEDS.length - 1]} kW feeds to {kw1(N.hallLiquidB.densityKWm2)}. Floor space turns out to be the easy part; the hard part is bringing that
        much power to each rack and carrying that much heat away from it.
      </P>

      <Challenge
        id="b"
        figure="GPU Rack Builder · cluster"
        question={`A data hall has room for only ${HALL_TARGET.racks} more racks. Fit at least ${fmt(HALL_TARGET.gpus)} A-class GPUs into them.`}
        solved={solvedB}
        status={statusB}
        success={`Solved. Air cooling caps an A-class rack at four servers, 32 GPUs, whatever the feed, so ${fmt(HALL_TARGET.gpus)} GPUs need ${fmt(N.hallAirA.racks)} racks. With liquid cooling, a 60 kW feed takes seven servers, 56 GPUs, and ${fmt(N.hallLiquidA60.racks)} racks are enough; a 100 kW feed fills each rack to its ten-server space limit, and ${fmt(N.hallLiquidA.racks)} racks do it.`}
      />

      <H2>Density</H2>
      <P>
        That is why GPUs can’t simply be moved into whatever data centers already exist. Many existing halls were built for racks of general-purpose servers, which
        typically draw well under 20 kW each, with power distribution and air handling sized to match. In such a hall, every rack position offers perhaps one{' '}
        {A.short} server, and the{' '}
        <FigRef to="GPU Rack Builder">first demonstration</FigRef> shows what that does: on a 17 kW feed, a rack built to hold {N.fullAir.gpus} GPUs or more holds{' '}
        {N.oldHall.gpus}, and the rest of the space sits empty. Housing GPUs at full density means new electrical gear for every row, and for the newest accelerators,
        water piped to every rack — work that takes months or years, not days.
      </P>
      <P>
        The same numbers set the size of a whole building. Every {fmt(1024)} air-cooled {A.short} GPUs need {mw2(N.hallAirA.itMW)} at their racks, before a single
        watt has gone to cooling them or been lost between the grid and the racks; a building’s count of GPUs is, roughly, its megawatts divided by that. A hall can
        be built bigger, and racks can be rewired, but the power has to come from somewhere, and as the next two lessons show, every megawatt delivered to the racks
        takes more than a megawatt from the grid.
      </P>
      <P>
        So the physical supply of usable compute isn’t counted in chips alone. A GPU that is waiting for a rack with enough power and cooling is not yet capacity
        anyone can use, and a GPU in the wrong rack — starved of power, or crammed into a hall that can’t take its heat — delivers less than its specifications
        promise. The largest of those limits is the one we’ve so far taken for granted: the megawatts themselves. In the next lesson we follow that power from the
        grid to the chips, and count what is lost on the way.
      </P>
    </LessonPage>
  );
}
