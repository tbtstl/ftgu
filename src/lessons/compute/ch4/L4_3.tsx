import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  TEXT,
  clamp,
  fmt,
  lessonHref,
  linePath,
  mix,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import {
  AIR,
  CHIP_RTH,
  CHILLED_WATER_OFFSET_C,
  LIQUID_CAPTURE,
  WATER,
  airflowM3s,
  annualPue,
  chipCooling,
  coolingHour,
  junctionC,
  waterFlowLs,
  type CoolingPlant,
} from '../../../engines/compute/cooling';
import { MAX_JUNCTION_C } from '../../../engines/compute/chipPower';
import { rackConfig } from '../../../engines/compute/rack';
import { POWER_DEFAULTS } from '../../../engines/compute/facilityPower';
import { ACCELERATORS, serverPowerW, type Cooling, type GpuId } from '../../../model/compute/hardware';
import { SITES, SITE_IDS, outdoorTempC, type Site, type SiteId } from '../../../model/compute/sites';

// ---------------------------------------------------------------------------
// Constants of the lesson.

/** The rack whose heat the flow comparison starts with, kW. */
export const RACK_KW = 40;
/** The flow demonstration's range of rack heat, kW: from an older hall's racks to Lesson 4.1's densest. */
export const FLOW_KW = { min: 10, max: 140 };
/** Lesson 4.1's liquid-cooled B-class rack: ten servers on a 140 kW feed, kW (rounded to the slider's 1 kW step). */
export const DENSE_RACK_KW = Math.round(rackConfig({ gpu: 'B', cooling: 'liquid', servers: 10, feedKW: 140 }).rackKW);
/** Temperature rise of the air through the rack, and of the water through the cold plates, °C. */
export const AIR_RISE_C = 15;
export const WATER_RISE_C = 10;
/** The hall of Lesson 4.2, MW of IT. */
export const HALL_MW = 20;
/** The coolant slider in the first demonstration, °C. */
export const COOLANT_MIN = 15;
export const COOLANT_MAX = 50;
/** Supply temperatures in the second demonstration, °C. */
export const AIR_SUPPLY = { min: 18, max: 27 };
export const WATER_SUPPLY = { min: 25, max: 45 };
/** The challenge's PUE target at Marston. */
export const PUE_TARGET = 1.15;

const GPU_OPTIONS: Array<{ value: GpuId; label: string }> = [
  { value: 'L', label: 'L-class 48 GB' },
  { value: 'A', label: 'A-class 80 GB' },
  { value: 'B', label: 'B-class 192 GB' },
];
const COOLING_OPTIONS: Array<{ value: Cooling; label: string }> = [
  { value: 'air', label: 'Air' },
  { value: 'liquid', label: 'Liquid (cold plates)' },
];

/** The chip runs at full speed: its full board power keeps the junction at or under the limit. */
export function fullSpeed(gpu: GpuId, coolantC: number, cooling: Cooling): boolean {
  return junctionC(ACCELERATORS[gpu].tdpW, coolantC, cooling) <= MAX_JUNCTION_C + 1e-9;
}

/** The warmest coolant, on the first demonstration's 1 °C grid, at which a chip still runs at full speed, by either cooling. */
export function warmestFullSpeed(gpu: GpuId): { cooling: Cooling; coolantC: number } {
  let best = { cooling: 'air' as Cooling, coolantC: -Infinity };
  for (const cooling of ['air', 'liquid'] as Cooling[])
    for (let t = COOLANT_MIN; t <= COOLANT_MAX; t++) if (fullSpeed(gpu, t, cooling) && t > best.coolantC) best = { cooling, coolantC: t };
  return best;
}

export const CHIP_DEFAULTS = { gpu: 'A' as GpuId, cooling: 'air' as Cooling, coolant: 24 };
type ChipState = typeof CHIP_DEFAULTS;

const WARMEST_B = warmestFullSpeed('B');

/** Challenge a: the B-class at full speed with the warmest coolant possible. */
export function warmestSolved(s: ChipState): boolean {
  return s.gpu === 'B' && s.cooling === WARMEST_B.cooling && s.coolant === WARMEST_B.coolantC && fullSpeed('B', s.coolant, s.cooling);
}

export const FLOW_DEFAULTS = { rackKW: RACK_KW };

export const BUILDING_DEFAULTS = { site: 'techpark' as SiteId, cooling: 'air' as Cooling, airC: 24, waterC: 35 };
type BuildingState = typeof BUILDING_DEFAULTS;

export function plantOf(s: BuildingState): CoolingPlant {
  return { cooling: s.cooling, supplyC: s.cooling === 'air' ? s.airC : s.waterC };
}

const pueCache = new Map<string, ReturnType<typeof annualPue>>();
/** Annual PUE, memoized: the building demonstration asks for the same few plants over and over. */
export function sitePue(site: SiteId, plant: CoolingPlant) {
  const key = `${site}|${plant.cooling}|${plant.supplyC}`;
  let v = pueCache.get(key);
  if (!v) {
    v = annualPue(SITES[site], plant, POWER_DEFAULTS);
    pueCache.set(key, v);
  }
  return v;
}

/** Challenge b: PUE under 1.15 at Marston, with coolant cool enough that the B-class runs at full speed. */
export function marstonSolved(s: BuildingState): boolean {
  const p = plantOf(s);
  return s.site === 'marston' && sitePue('marston', p).pue < PUE_TARGET && fullSpeed('B', p.supplyC, p.cooling);
}

export interface DayPoint {
  /** Day's mean outdoor temperature, °C. */
  temp: number;
  pue: number;
  /** Share of the day's heat rejected without chillers. */
  free: number;
}

/** Daily averages of outdoor temperature, PUE and free cooling over a year. */
export function dailyPue(site: Site, plant: CoolingPlant, electricalPerKW: number, miscPerKW: number): DayPoint[] {
  const out: DayPoint[] = [];
  for (let d = 0; d < 365; d++) {
    let temp = 0;
    let cool = 0;
    let free = 0;
    for (let h = 0; h < 24; h++) {
      const t = outdoorTempC(site, d * 24 + h);
      const c = coolingHour(plant, t, site.humidity);
      temp += t;
      cool += c.coolingPerKW;
      free += c.freeShare;
    }
    out.push({ temp: temp / 24, pue: 1 + cool / 24 + electricalPerKW + miscPerKW, free: free / 24 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small formatting helpers.

const deg = (t: number) => `${fmt(t)} °C`;
const deg1 = (t: number) => `${fmt(t, Number.isInteger(Math.round(t * 10) / 10) ? 0 : 1)} °C`;
const pct = (x: number) => `${fmt(x * 100)}%`;

/** A heat color: cool blue through to red as a temperature rises from 15 to 90 °C. */
function heatColor(t: number): string {
  return mix('#6f9fd8', '#e75b55', clamp((t - 15) / 75, 0, 1));
}

// ---------------------------------------------------------------------------
// Figure 1: the heat path from the chip, and a thermometer.

function ChipPath({ gpu, cooling, coolant }: ChipState) {
  const g = ACCELERATORS[gpu];
  const cc = chipCooling(gpu, coolant, cooling);
  const tj = cc.junctionC;
  const rise = tj - coolant;
  // Thermometer: 0–100 °C between y = 214 and y = 24.
  const ty = scale(0, 100, 214, 24);
  const outC = cooling === 'air' ? coolant + AIR_RISE_C : coolant + WATER_RISE_C;
  const coolColor = heatColor(coolant);
  const outColor = heatColor(outC);
  const dieColor = heatColor(tj);
  const fins = Array.from({ length: 9 }, (_, i) => 74 + i * 12);
  const flowSpeed = { animationDuration: `${(18 / 30).toFixed(2)}s` };
  const label = `${g.name}, ${cooling === 'air' ? 'air-cooled' : 'liquid-cooled'}, with ${cooling === 'air' ? 'inlet air' : 'cold-plate water'} at ${deg(coolant)}. At ${fmt(cc.chipW)} W the junction reaches ${deg1(tj)} against a ${MAX_JUNCTION_C} °C limit${cc.throttled ? `, so the chip throttles to ${pct(cc.speed)} of its speed` : ''}.`;
  return (
    <svg className="diagram" viewBox="0 0 600 240" role="img" aria-label={label}>
      <defs>
        <linearGradient id="l43-airflow" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={coolColor} />
          <stop offset="1" stopColor={outColor} />
        </linearGradient>
      </defs>
      {/* Package and die. */}
      <rect x={60} y={176} width={140} height={18} rx={2} fill="#d9d9d5" />
      <rect x={100} y={164} width={60} height={14} rx={2} fill={dieColor} stroke="#555" strokeWidth={1} />
      <text className="ax ax-m" x={130} y={212}>
        {g.short} chip · {fmt(cc.chipW)} W
      </text>
      {/* Heat rising from the die. */}
      {[112, 130, 148].map((x) => (
        <path key={x} d={`M${x} 160 L${x} 146`} stroke={GRAPHIC.red} strokeWidth={2.5} opacity={0.85} />
      ))}
      {cooling === 'air' ? (
        <g>
          <rect x={68} y={132} width={124} height={12} fill="#bdbdb8" />
          {fins.map((x) => (
            <rect key={x} x={x} y={46} width={5} height={86} fill="#cfcfca" />
          ))}
          <path d="M20 70 L240 70" stroke="url(#l43-airflow)" strokeWidth={6} opacity={0.35} />
          <path d="M20 104 L240 104" stroke="url(#l43-airflow)" strokeWidth={6} opacity={0.35} />
          <path d="M20 70 L240 70" className="flow-dots" stroke={coolColor} strokeWidth={5} style={flowSpeed} />
          <path d="M20 104 L240 104" className="flow-dots" stroke={outColor} strokeWidth={5} style={flowSpeed} />
          <text className="ax" x={20} y={40}>
            air in · {deg(coolant)}
          </text>
          <text className="ax ax-e" x={250} y={40}>
            out · about {deg(outC)}
          </text>
          <text className="ax ax-m" x={130} y={28}>
            heat sink and fans
          </text>
        </g>
      ) : (
        <g>
          <rect x={80} y={124} width={100} height={22} rx={3} fill="#c9d6e6" stroke="#7d93ad" strokeWidth={1} />
          <path d="M20 112 L96 112 L96 124" fill="none" stroke={coolColor} strokeWidth={7} strokeLinejoin="round" opacity={0.5} />
          <path d="M164 124 L164 112 L240 112" fill="none" stroke={outColor} strokeWidth={7} strokeLinejoin="round" opacity={0.5} />
          <path d="M20 112 L96 112 L96 124" className="flow-dots" fill="none" stroke={coolColor} strokeWidth={4} style={flowSpeed} />
          <path d="M164 124 L164 112 L240 112" className="flow-dots" fill="none" stroke={outColor} strokeWidth={4} style={flowSpeed} />
          <text className="ax" x={20} y={100}>
            water in · {deg(coolant)}
          </text>
          <text className="ax ax-e" x={250} y={100}>
            out · about {deg(outC)}
          </text>
          <text className="ax ax-m" x={130} y={62}>
            cold plate
          </text>
          <text className="ax ax-m" x={130} y={78}>
            {fmt(LIQUID_CAPTURE * 100)}% of the server’s heat leaves in the water
          </text>
        </g>
      )}
      {/* Thermometer. */}
      <text className="ax" x={330} y={14}>
        Temperature
      </text>
      <rect x={380} y={ty(100)} width={18} height={ty(0) - ty(100)} rx={9} fill="#f2f2ef" stroke="#d9d9d5" />
      <rect x={380} y={ty(Math.max(tj, coolant))} width={18} height={ty(coolant) - ty(Math.max(tj, coolant))} fill={tint(GRAPHIC.red, 0.55)} />
      <rect x={380} y={ty(coolant)} width={18} height={ty(0) - ty(coolant)} rx={0} fill={tint('#6f9fd8', 0.6)} />
      {[0, 20, 40, 60, 80, 100].map((t) => (
        <text key={t} className="ax ax-e" x={372} y={ty(t) + 4}>
          {t} °C
        </text>
      ))}
      <line x1={374} x2={470} y1={ty(MAX_JUNCTION_C)} y2={ty(MAX_JUNCTION_C)} stroke={GRAPHIC.red} strokeWidth={1.5} strokeDasharray="5 4" />
      <text x={476} y={ty(MAX_JUNCTION_C) + 4} style={{ fontSize: 12, fill: TEXT.red }}>
        limit {MAX_JUNCTION_C} °C
      </text>
      <line x1={398} x2={420} y1={ty(tj)} y2={ty(tj)} stroke="#333" strokeWidth={2} />
      <text x={426} y={ty(tj) + (Math.abs(tj - MAX_JUNCTION_C) < 5 ? 18 : 4)} className="lab">
        chip {deg1(tj)}
      </text>
      <line x1={398} x2={420} y1={ty(coolant)} y2={ty(coolant)} stroke="#333" strokeWidth={1} />
      <text x={426} y={ty(coolant) + 4} style={{ fontSize: 12, fill: TEXT.teal }}>
        {cooling === 'air' ? 'air' : 'water'} {deg(coolant)}
      </text>
      <text x={426} y={(ty(coolant) + ty(tj)) / 2 + 4} className="ax">
        {rise > 14 ? `+${fmt(rise)} °C` : ''}
      </text>
      {cc.throttled && (
        <text x={300} y={232} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: TEXT.red }}>
          Too hot at full power: the chip cuts to {fmt(cc.chipW)} W and keeps {pct(cc.speed)} of its speed
        </text>
      )}
    </svg>
  );
}

/** The volume of air and of water that carries one rack's heat away each second, as cubes at one scale. */
function FlowCubes({ rackKW }: { rackKW: number }) {
  const air = airflowM3s(rackKW, AIR_RISE_C);
  const water = waterFlowLs(rackKW, WATER_RISE_C) / 1000; // m³/s
  // One scale for every setting: the largest air cube, at the slider's top, just fits.
  const pxPerM = 60;
  const cube = (x: number, base: number, sideM: number, faces: [string, string, string]) => {
    const s = sideM * pxPerM;
    const d = s * 0.4;
    const front = `M${x} ${base} L${x + s} ${base} L${x + s} ${base - s} L${x} ${base - s} Z`;
    const top = `M${x} ${base - s} L${x + d} ${base - s - d} L${x + s + d} ${base - s - d} L${x + s} ${base - s} Z`;
    const side = `M${x + s} ${base} L${x + s + d} ${base - d} L${x + s + d} ${base - s - d} L${x + s} ${base - s} Z`;
    return (
      <g>
        <path d={front} fill={faces[0]} stroke="#666" strokeWidth={1} />
        <path d={top} fill={faces[1]} stroke="#666" strokeWidth={1} />
        <path d={side} fill={faces[2]} stroke="#666" strokeWidth={1} />
      </g>
    );
  };
  const aSide = Math.cbrt(air);
  const wSide = Math.cbrt(water);
  return (
    <svg
      className="diagram"
      viewBox="0 0 600 200"
      role="img"
      aria-label={`To carry ${fmt(rackKW)} kW out of one rack, air warming by ${AIR_RISE_C} °C must flow at ${fmt(air, 2)} cubic meters a second, a cube ${fmt(aSide, 2)} m on a side; water warming by ${WATER_RISE_C} °C needs ${fmt(water * 1000, 2)} liters a second, a cube ${fmt(wSide * 100, 1)} cm on a side.`}
    >
      <text className="ax" x={20} y={14}>
        Carrying {fmt(rackKW)} kW out of one rack: the volume needed every second, to scale
      </text>
      {cube(70, 190, aSide, ['#cddcef', '#e4ecf6', '#adc3de'])}
      <text className="lab" x={250} y={104}>
        Air, warming {AIR_RISE_C} °C
      </text>
      <text className="ax" x={250} y={122}>
        {fmt(air, 2)} m³ a second — a cube {fmt(aSide, 2)} m on a side
      </text>
      {cube(470, 190, wSide, ['#4590ce', '#8fb9e0', '#2f6fb3'])}
      <text className="lab" x={430} y={154}>
        Water, warming {WATER_RISE_C} °C
      </text>
      <text className="ax" x={430} y={170}>
        {fmt(water * 1000, 2)} L a second
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: a year of cooling at a site.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function YearChart({ days, site, label }: { days: DayPoint[]; site: Site; label: string }) {
  const x = scale(0, 365, 60, 620);
  const tY = scale(-15, 35, 78, 26);
  const pY = scale(1, 1.45, 222, 106);
  const xs = days.map((_, i) => x(i + 0.5));
  return (
    <svg className="chart" viewBox="0 0 640 268" role="img" aria-label={label}>
      <text className="ax" x={60} y={14}>
        Outdoor temperature at {site.name}, daily mean
      </text>
      <GridY y={tY} ticks={[-10, 10, 30]} x0={60} x1={620} format={(v) => `${fmt(v)} °C`} />
      <path d={linePath(xs, days.map((d) => tY(d.temp)))} fill="none" stroke={GRAPHIC.teal} strokeWidth={2} />
      <text className="ax" x={60} y={98}>
        PUE, daily average
      </text>
      <GridY y={pY} ticks={[1, 1.1, 1.2, 1.3, 1.4]} x0={60} x1={620} format={(v) => v.toFixed(1)} />
      <path d={linePath(xs, days.map((d) => pY(d.pue)))} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
      {days.map((d, i) => (
        <rect key={i} x={x(i)} y={230} width={x(1) - x(0) + 0.2} height={12} fill={GRAPHIC.blue} opacity={0.08 + 0.82 * d.free} />
      ))}
      <text className="ax ax-e" x={56} y={240}>
        free
      </text>
      {MONTHS.map((m, i) => (
        <text key={m} className="ax ax-m" x={x(MONTH_START[i] + 15)} y={260}>
          {m}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario('chip', CHIP_DEFAULTS);
  const { gpu, cooling, coolant } = s1.state;
  const g = ACCELERATORS[gpu];
  const cc = chipCooling(gpu, coolant, cooling);
  const solvedA = warmestSolved(s1.state);
  const rth = CHIP_RTH[cooling];

  const sf = useScenario('flow', FLOW_DEFAULTS);
  const flowKW = sf.state.rackKW;

  const s2 = useScenario('building', BUILDING_DEFAULTS);
  const site = SITES[s2.state.site];
  const plant = plantOf(s2.state);
  const year = sitePue(s2.state.site, plant);
  const days = useMemo(() => dailyPue(site, { cooling: plant.cooling, supplyC: plant.supplyC }, year.electricalPerKW, year.miscPerKW), [site, plant.cooling, plant.supplyC, year]);
  const bChip = chipCooling('B', plant.supplyC, plant.cooling);
  const solvedB = marstonSolved(s2.state);
  const coolingMWh = year.coolingPerKW * HALL_MW * 8760;
  const rows = SITE_IDS.map((id) => {
    const a = sitePue(id, plant);
    return { id, name: SITES[id].name, mean: SITES[id].meanTempC, pue: a.pue, free: a.freeShare, peak: a.peakPue, itMW: SITES[id].gridMW / a.peakPue };
  });

  // Numbers the prose quotes.
  const N = useMemo(() => {
    const air = airflowM3s(RACK_KW, AIR_RISE_C);
    const water = waterFlowLs(RACK_KW, WATER_RISE_C);
    const pueOf = (id: SiteId, c: Cooling, t: number) => sitePue(id, { cooling: c, supplyC: t });
    return {
      air,
      water,
      ratio: (air * 1000) / water,
      aAir24: junctionC(ACCELERATORS.A.tdpW, 24, 'air'),
      bAir24: junctionC(ACCELERATORS.B.tdpW, 24, 'air'),
      denseAir: airflowM3s(DENSE_RACK_KW, AIR_RISE_C),
      denseWater: waterFlowLs(DENSE_RACK_KW, WATER_RISE_C),
      bAir35: chipCooling('B', 35, 'air'),
      bLiq35: chipCooling('B', 35, 'liquid'),
      bFirstThrottle: Array.from({ length: COOLANT_MAX - COOLANT_MIN + 1 }, (_, i) => COOLANT_MIN + i).find((t) => !fullSpeed('B', t, 'air'))!,
      aServerAir: serverPowerW('A', 'air') / 1000,
      aServerLiquid: serverPowerW('A', 'liquid') / 1000,
      tpAir: pueOf('techpark', 'air', 24),
      bpAir: pueOf('marston', 'air', 24),
      nfAir: pueOf('fernhill', 'air', 24),
      tpLiq: pueOf('techpark', 'liquid', 35),
      bpLiq: pueOf('marston', 'liquid', 35),
      nfLiq: pueOf('fernhill', 'liquid', 35),
      bpLiq40: pueOf('marston', 'liquid', 40),
      bpLiq39: pueOf('marston', 'liquid', 39),
      bpLiq45: pueOf('marston', 'liquid', 45),
    };
  }, []);
  const tpAirMWh = N.tpAir.coolingPerKW * HALL_MW * 8760;
  const tpLiqMWh = N.tpLiq.coolingPerKW * HALL_MW * 8760;

  const statusA = (() => {
    if (gpu !== 'B') return `Right now the ${g.name} is chosen. Switch to the B-class 192 GB.`;
    if (!cc.throttled) return `At ${deg(coolant)} the B-class runs at full speed with its junction at ${deg1(cc.junctionC)}. Could its coolant be warmer?`;
    return `At ${deg(coolant)} the B-class throttles to ${pct(cc.speed)} of its speed.`;
  })();
  const statusB = (() => {
    if (s2.state.site !== 'marston') return `Right now the building is at ${site.name}. Choose Marston.`;
    const speed = bChip.throttled ? `the B-class would throttle to ${pct(bChip.speed)} of its speed` : 'the B-class runs at full speed';
    return `Marston’s PUE is ${year.pue.toFixed(3)}, and ${speed}.`;
  })();

  const captionA = cc.throttled
    ? `At its full ${fmt(g.tdpW)} W the junction would reach ${deg1(junctionC(g.tdpW, coolant, cooling))}, past the ${MAX_JUNCTION_C} °C limit, so the chip cuts its power until the junction sits at the limit.`
    : `The junction sits ${fmt(MAX_JUNCTION_C - cc.junctionC)} °C below the ${MAX_JUNCTION_C} °C limit, so the chip runs at full speed.`;

  return (
    <LessonPage id="compute/4.3">
      <P>
        The previous lesson followed electricity from the grid to the chips, stage by stage, and counted what each stage lost. It stopped at the silicon. But the
        electricity doesn’t stay there. As <a href={lessonHref('compute/1.5')}>Lesson 1.5</a> showed, every bit of energy a chip spends charging and draining its
        transistors ends up as <K c="power">heat</K>, and so does everything lost along the way. A hall drawing {HALL_MW} MW for its IT equipment makes{' '}
        {HALL_MW} MW of heat, around the clock, and all of it has to be carried away. A single {RACK_KW} kW rack gives off as much heat as about {fmt(RACK_KW / 1.5)} household
        space heaters of 1.5 kW each.
      </P>
      <P>
        The heat makes three journeys. It leaves the chip for whatever coolant touches it: air blown through a heat sink, or water pumped through a metal{' '}
        <b>cold plate</b> pressed onto the chip. The coolant carries it out of the server and the rack. And the building’s cooling plant moves it outdoors. Each
        journey has a limit, and each costs something. This lesson takes them in turn.
      </P>
      <P>
        The first limit is the chip’s own. The heat crosses a chain of materials — silicon, the package, a layer of paste, the metal of the sink or plate — and every
        watt that crosses it raises the chip a little above the coolant. In our model the rise is {CHIP_RTH.air} °C per watt above the air at the server’s inlet, and{' '}
        {CHIP_RTH.liquid} °C per watt above the water entering a cold plate. The hottest point on the chip, its <K tone="teal">junction temperature</K>, must stay
        under the {MAX_JUNCTION_C} °C limit of Lesson 1.5; past it, the chip slows itself down. In the next demonstration, choose an accelerator and how it is cooled,
        and set the temperature of the coolant that reaches it:
      </P>

      <Figure name="GPU Cooling Lab" scenario={s1}>
        <Segmented label="Accelerator" value={gpu} onChange={(v) => s1.set({ gpu: v })} options={GPU_OPTIONS} />
        <Segmented label="Cooling" value={cooling} onChange={(v) => s1.set({ cooling: v })} options={COOLING_OPTIONS} />
        <ChipPath gpu={gpu} cooling={cooling} coolant={coolant} />
        <Slider
          label={cooling === 'air' ? 'Inlet air' : 'Cold-plate water'}
          tone="teal"
          value={coolant}
          min={COOLANT_MIN}
          max={COOLANT_MAX}
          onChange={(v) => s1.set({ coolant: v })}
          display={deg(coolant)}
        />
        <Eq label="Junction temperature equals coolant temperature plus power times thermal resistance">
          <K tone="teal">
            T<Sub>junction</Sub>
          </K>
          <Op>=</Op>
          <K tone="teal">{deg(coolant)}</K>
          <Op>+</Op>
          <K c="power">{fmt(cc.chipW)} W</K>
          <Op>×</Op>
          <span>{rth} °C/W</span>
          <Op>=</Op>
          <K tone="teal">{deg1(cc.junctionC)}</K>
        </Eq>
        <Caption>{captionA}</Caption>
      </Figure>

      <P>
        It starts with the A-class 80 GB in {deg(24)} air. Its {fmt(ACCELERATORS.A.tdpW)} W raise the junction {fmt(ACCELERATORS.A.tdpW * CHIP_RTH.air)} °C, to{' '}
        {deg1(N.aAir24)}, with plenty of room. Switch to the B-class 192 GB, whose {fmt(ACCELERATORS.B.tdpW)} W raise it {fmt(ACCELERATORS.B.tdpW * CHIP_RTH.air)} °C,
        to {deg1(N.bAir24)}. Now warm the air. At {deg(N.bFirstThrottle)} the B-class can no longer run flat out, and at {deg(35)} it must cut its power to{' '}
        {fmt(N.bAir35.chipW)} W. It keeps {pct(N.bAir35.speed)} of its speed even so: as Lesson 1.5 found, a chip that lowers its clock and voltage together saves
        power faster than it loses speed. Then switch to liquid. With {deg(35)} water on a cold plate, the B-class runs at full power at {deg1(N.bLiq35.junctionC)}.
      </P>

      <Challenge
        id="a"
        question={`Predict first, from the B-class’s ${fmt(ACCELERATORS.B.tdpW)} W, the ${MAX_JUNCTION_C} °C limit and each cooling’s degrees per watt: how warm can its coolant be? Then run the B-class 192 GB at full speed with the warmest coolant you can.`}
        solved={solvedA}
        status={statusA}
        success={`Solved. Water at ${deg(WARMEST_B.coolantC)} on a cold plate takes the B-class’s ${fmt(ACCELERATORS.B.tdpW)} W to exactly ${MAX_JUNCTION_C} °C: ${fmt(ACCELERATORS.B.tdpW)} W × ${CHIP_RTH.liquid} °C/W = ${fmt(ACCELERATORS.B.tdpW * CHIP_RTH.liquid)} °C above the water. Air must stay at ${deg(N.bFirstThrottle - 1)} or cooler. Warm coolant sounds like a curiosity, but the next section shows why a data center wants it as warm as the chips allow.`}
      />

      <P>
        The second journey is the coolant’s, out of the server and the rack. Carrying heat means warming something: the heat a stream can take is its mass flow
        times its specific heat times how much it warms, Q = ṁ × c × ΔT. Air holds {fmt(AIR.specificHeat)} joules per kilogram per degree and weighs {AIR.density} kg
        per cubic meter; water holds {fmt(WATER.specificHeat)} and weighs {fmt(WATER.density)}. In the next demonstration, set the heat one rack gives off. The
        cubes are the volume of air, warming by {AIR_RISE_C} °C, and of water, warming by {WATER_RISE_C} °C, that must flow through it every second to carry that
        heat away, drawn to one scale:
      </P>

      <Figure name="GPU Cooling Lab · air and water" scenario={sf}>
        <FlowCubes rackKW={flowKW} />
        <Slider
          label="Heat from the rack"
          tone="red"
          value={flowKW}
          min={FLOW_KW.min}
          max={FLOW_KW.max}
          onChange={(v) => sf.set({ rackKW: v })}
          display={`${fmt(flowKW)} kW`}
        />
      </Figure>

      <P>
        At {RACK_KW} kW, air must flow at {fmt(N.air, 2)} cubic meters every second. Water needs {fmt(N.water, 2)} liters a second: about{' '}
        {fmt(Math.round(N.ratio / 100) * 100)} times less volume, through a pipe instead of a wall of fans. Push the rack to {DENSE_RACK_KW} kW, the liquid-cooled
        B-class rack of <a href={lessonHref('compute/4.1')}>Lesson 4.1</a>, and the air would need {fmt(N.denseAir, 1)} cubic meters a second through one cabinet, a
        gale, while the water still needs under {fmt(Math.ceil(N.denseWater))} liters. That is why the densest racks are liquid-cooled, and why liquid cooling
        also saves power inside the servers: an air-cooled A-class server draws {fmt(N.aServerAir, 2)} kW, a liquid-cooled one {fmt(N.aServerLiquid, 2)} kW,
        because its fans have far less to do. The cold plates don’t catch everything, though. In our model they take {fmt(LIQUID_CAPTURE * 100)}% of a server’s
        heat, and the memory, network cards and power supplies still shed the rest into the air.
      </P>

      <H2>From the rack to the outdoors</H2>
      <P>
        Whatever reaches the coolant must finally go outside, and there are two ways to send it. When the outdoor air is cooler than the coolant, the heat can simply
        be blown away: the coolant runs through a radiator, called a dry cooler, and fans push outdoor air across it. This is <b>free cooling</b>, free except for the
        fans and pumps. Ours are evaporative-assisted: on warm days they mist the incoming air, which cools it a few degrees as the water evaporates, so they can cool
        free on days a little warmer than a plain dry cooler could. The mist does most in dry air and little in humid air, which can take up little more water. When the
        outdoors is too warm even so, a chiller must pump the heat uphill, from the cooler coolant to the warmer air, the way a refrigerator does. In
        our model a chiller moves three to nine units of heat for each unit of <K c="energy">electricity</K>, fewer the further uphill it has to push.
      </P>
      <P>
        Here the coolant’s temperature matters a second time. Air cooling needs the air at the server inlet at something like {deg(24)}, and to make that air the
        building circulates chilled water some {deg(CHILLED_WATER_OFFSET_C)} colder still, so free cooling only works on cold days. The water for cold plates can be far warmer, and warm
        water can be cooled by outdoor air on most days. What a building spends on all this shows up in its PUE, the yardstick of{' '}
        <a href={lessonHref('compute/4.2')}>Lesson 4.2</a>: everything the site draws divided by what its IT equipment draws. Besides the cooling, it includes that
        lesson’s electrical losses ({fmt(year.electricalPerKW * 100, 1)}% of the IT load here) and lights and offices ({fmt(year.miscPerKW * 100)}%). In the next demonstration, choose a site and a cooling method, and set the supply temperature; the chart follows a year:
      </P>

      <Figure name="GPU Cooling Lab · the building" scenario={s2}>
        <Segmented label="Site" value={s2.state.site} onChange={(v) => s2.set({ site: v })} options={SITE_IDS.map((id) => ({ value: id, label: SITES[id].name }))} />
        <Segmented label="Cooling" value={s2.state.cooling} onChange={(v) => s2.set({ cooling: v })} options={COOLING_OPTIONS} />
        <YearChart
          days={days}
          site={site}
          label={`A year at ${site.name} with ${plant.cooling === 'air' ? `air cooling, ${deg(plant.supplyC)} supply air` : `liquid cooling, ${deg(plant.supplyC)} water`}: annual PUE ${year.pue.toFixed(3)}, ${pct(year.freeShare)} of the heat removed without chillers, hottest-hour PUE ${year.peakPue.toFixed(2)}.`}
        />
        <Legend
          items={[
            { label: 'Outdoor temperature', color: GRAPHIC.teal, kind: 'line' },
            { label: 'PUE', color: '#333', kind: 'line' },
            { label: 'Share of heat cooled free (darker = more)', color: GRAPHIC.blue },
          ]}
        />
        {s2.state.cooling === 'air' ? (
          <Slider
            label="Supply air"
            tone="teal"
            value={s2.state.airC}
            min={AIR_SUPPLY.min}
            max={AIR_SUPPLY.max}
            onChange={(v) => s2.set({ airC: v })}
            display={deg(s2.state.airC)}
          />
        ) : (
          <Slider
            label="Supply water"
            tone="teal"
            value={s2.state.waterC}
            min={WATER_SUPPLY.min}
            max={WATER_SUPPLY.max}
            onChange={(v) => s2.set({ waterC: v })}
            display={deg(s2.state.waterC)}
          />
        )}
        <Readouts
          items={[
            { label: `cooling for ${HALL_MW} MW of IT, a year`, value: `${fmt(coolingMWh / 1000, 1)} GWh`, tone: 'gold' },
            { label: `at ${site.name}’s simulated $${site.powerPrice}/MWh`, value: `${usd(coolingMWh * site.powerPrice / 1e6, 2)}M`, tone: 'green' },
          ]}
        />
        <Caption>
          {bChip.throttled
            ? `At ${deg(plant.supplyC)} a B-class chip would throttle to ${pct(bChip.speed)} of its speed.`
            : `At ${deg(plant.supplyC)} a B-class chip runs at full speed, its junction at ${deg1(bChip.junctionC)}.`}
        </Caption>
        <DataTable
          caption="The same cooling plant at each of the three sites"
          rows={rows}
          rowKey={(r) => r.id}
          rowClass={(r) => (r.id === s2.state.site ? 'hl' : '')}
          columns={[
            { label: 'Site', cell: (r) => r.name },
            { label: 'Mean temperature', cell: (r) => deg(r.mean), align: 'right' },
            { label: 'Annual PUE', cell: (r) => r.pue.toFixed(3), align: 'right' },
            { label: 'Cooled free', cell: (r) => pct(r.free), align: 'right' },
            { label: 'Hottest hour', cell: (r) => r.peak.toFixed(2), align: 'right' },
            { label: 'IT its grid can carry', cell: (r) => `${fmt(r.itMW, 1)} MW`, align: 'right' },
          ]}
        />
      </Figure>

      <P>
        It starts at Tech Park, air-cooled with {deg(24)} supply air. The PUE is {N.tpAir.pue.toFixed(3)} over the year: for every megawatt the IT equipment draws, the site
        draws another {fmt((N.tpAir.pue - 1) * 1000)} kW, most of it for cooling. Only {pct(N.tpAir.freeShare)} of the heat goes out free, nearly all of it in winter, and on
        summer afternoons the PUE climbs to {N.tpAir.peakPue.toFixed(2)}. For the {HALL_MW} MW hall that is {fmt(tpAirMWh / 1000, 1)} GWh of cooling a year,{' '}
        {usd((tpAirMWh * SITES.techpark.powerPrice) / 1e6, 1)} million at the site’s simulated price. Switch to liquid at {deg(35)} and the PUE falls to{' '}
        {N.tpLiq.pue.toFixed(3)}, with {pct(N.tpLiq.freeShare)} of the heat cooled free and {fmt(tpLiqMWh / 1000, 1)} GWh of cooling a year.
      </P>
      <P>
        Now compare the sites, in the table. Air-cooled, warm, humid Marston never cools free and averages {N.bpAir.pue.toFixed(3)}; cold Fernhill cools{' '}
        {pct(N.nfAir.freeShare)} of its heat free and averages {N.nfAir.pue.toFixed(3)}. Humidity counts against a site as well as heat, because it leaves the coolers’
        mist less to do. With liquid cooling at {deg(35)} the three come to {N.bpLiq.pue.toFixed(3)}, {N.tpLiq.pue.toFixed(3)} and{' '}
        {N.nfLiq.pue.toFixed(3)}. Climate matters most to the coldest coolant.
      </P>

      <Challenge
        id="b"
        figure="GPU Cooling Lab · the building"
        question={`Bring Marston’s annual PUE below ${PUE_TARGET}, with coolant cool enough that a B-class 192 GB still runs at full speed.`}
        solved={solvedB}
        status={statusB}
        success={`Solved. Liquid cooling with ${deg(40)} water gives Marston a PUE of ${N.bpLiq40.pue.toFixed(3)}, and ${deg(40)} is exactly the warmest water the B-class tolerates at full power — the answer of the first challenge. At ${deg(39)} the PUE is ${N.bpLiq39.pue.toFixed(3)}; at ${deg(45)} it would be ${N.bpLiq45.pue.toFixed(3)}, but the chips would throttle. The building wants its water warm and the chips want it cool, and the chips’ limit sets the compromise.`}
      />

      <H2>Heat decides where compute can go</H2>
      <P>
        The last column of the table may matter most. A site’s grid connection, from Lesson 4.2, has to carry the IT load and its cooling at the hottest hour of the
        year, not the average one. Air-cooled, Marston’s {SITES.marston.gridMW} MW connection carries {fmt(SITES.marston.gridMW / N.bpAir.peakPue, 1)} MW of IT on its
        worst afternoon; with liquid at {deg(40)}, {fmt(SITES.marston.gridMW / N.bpLiq40.peakPue, 1)} MW. Where megawatts are the scarce thing, a better cooling plant
        is more GPUs.
      </P>
      <P>
        So heat shapes the supply of compute in several ways at once. It sets how hot a chip may run and, through throttling, how fast; it sets how densely chips can be
        packed, since air runs out long before water does; and it sets how much of a site’s power is left for computing. It pulls in different directions, too.
        Fernhill is the cheapest place to cool and has room and power to spare, but it is {SITES.fernhill.rttMs} ms from the region’s users, against Marston’s{' '}
        {SITES.marston.rttMs} ms, and some of the workloads of <a href={lessonHref('compute/3.5')}>Lesson 3.5</a> can’t tolerate that. Cooling also has costs we
        haven’t modeled. Water is one: many sites reject their heat through evaporative cooling towers, which keep working in warmer weather but consume a great
        deal of it, and even our coolers’ mist uses some on warm days. <FigRef to="GPU Cooling Lab">The first demonstration</FigRef> showed the other side of the bargain: every degree of warmer coolant is a degree less
        headroom for the chip.
      </P>
      <P>
        Power and heat decide how many GPUs a building can hold and how hard they can run. Whether those GPUs can work together as one cluster, though, depends on
        something else: the network that joins their servers. That is the subject of the next lesson.
      </P>
    </LessonPage>
  );
}
