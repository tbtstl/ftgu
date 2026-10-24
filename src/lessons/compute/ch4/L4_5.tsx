import { useId, useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
  Frac,
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
  TEXT,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { breakEvenUtilization, capitalRecovery, gpuHourCost, FACILITY_CAPEX_PER_KW, IDLE_POWER_SHARE, UPKEEP_SHARE, type FacilityPlan, type GpuHourCost } from '../../../engines/compute/facilityCost';
import { annualPue } from '../../../engines/compute/cooling';
import { fabric } from '../../../engines/compute/dcNetwork';
import { ACCELERATORS, GPU_IDS, SERVERS, type Cooling, type GpuId } from '../../../model/compute/hardware';
import { SITES, SITE_IDS, type SiteId } from '../../../model/compute/sites';
import { gpusForIt, largestItFor } from './L4_2';

// ---------------------------------------------------------------------------
// The plan behind every number: an accelerator at a site, its PUE from Lesson 4.3.

/** Supply temperatures behind each cooling method's PUE (Lesson 4.3's defaults). */
export const SUPPLY_C: Record<Cooling, number> = { air: 24, liquid: 35 };
/** The building and plant are paid off over this many years. */
export const FACILITY_LIFE = 15;

/** Annual PUE for every site and cooling method, computed once. */
export const PUE: Record<SiteId, Record<Cooling, number>> = Object.fromEntries(
  SITE_IDS.map((s) => [s, { air: annualPue(SITES[s], { cooling: 'air', supplyC: SUPPLY_C.air }).pue, liquid: annualPue(SITES[s], { cooling: 'liquid', supplyC: SUPPLY_C.liquid }).pue }]),
) as Record<SiteId, Record<Cooling, number>>;

export interface PlannerState {
  gpu: GpuId;
  site: SiteId;
  cooling: Cooling;
  /** Utilization, percent. */
  util: number;
  /** Server life, years. */
  life: number;
  /** Cost of capital, percent a year. */
  rate: number;
}

export const PLANNER_DEFAULTS: PlannerState = { gpu: 'A', site: 'techpark', cooling: 'air', util: 70, life: 5, rate: 10 };

export function planOf(s: PlannerState): FacilityPlan {
  return {
    gpu: s.gpu,
    cooling: s.cooling,
    site: SITES[s.site],
    pue: PUE[s.site][s.cooling],
    utilization: s.util / 100,
    serverLifeYears: s.life,
    facilityLifeYears: FACILITY_LIFE,
    rate: s.rate / 100,
  };
}

export function costOf(s: PlannerState): GpuHourCost {
  return gpuHourCost(planOf(s));
}

/** The first challenge's target, $ per used hour. */
export const TARGET = 2;

/** The first challenge: an A-class kept 70% busy, its used hour under $2.00. */
export function underTargetSolved(s: PlannerState): boolean {
  return s.gpu === 'A' && Math.round(s.util) === 70 && costOf(s).perUsedHour < TARGET;
}

// ---------------------------------------------------------------------------
// The second demonstration: the A-class at Tech Park, air-cooled, against a rental price.

export interface PriceState {
  /** Utilization, percent. */
  util: number;
  life: number;
  /** Rental price, $ per GPU-hour (simulated). */
  price: number;
}

export const PRICE_DEFAULTS: PriceState = { util: 70, life: 5, price: 2.4 };

function priceState(util: number, life: number): PlannerState {
  return { ...PLANNER_DEFAULTS, util, life };
}

/** Cost of a used A-class hour at Tech Park (air, 10%) at a utilization (percent) and server life. */
export function usedHourCost(util: number, life: number): number {
  return costOf(priceState(util, life)).perUsedHour;
}

/** Utilization (share) at which a used hour costs exactly the price; Infinity if never. */
export function breakEven(life: number, price: number): number {
  const { utilization: _u, ...rest } = planOf(priceState(70, life));
  void _u;
  return breakEvenUtilization(rest, price);
}

/** The second challenge's settings: a four-year life at $2.40 an hour. */
export const CHALLENGE_LIFE = 4;
export const CHALLENGE_PRICE = 2.4;

/** The second challenge: the lowest whole-percent utilization at which a four-year A-class covers $2.40. */
export function breakEvenSolved(s: PriceState): boolean {
  if (s.life !== CHALLENGE_LIFE || Math.abs(s.price - CHALLENGE_PRICE) > 1e-6) return false;
  return usedHourCost(s.util, s.life) <= s.price && usedHourCost(s.util - 1, s.life) > s.price;
}

// ---------------------------------------------------------------------------
// Numbers for the prose.

const BASE = costOf(PLANNER_DEFAULTS);
const BASE_PLAN = planOf(PLANNER_DEFAULTS);
const CRF = capitalRecovery(0.1, 5);
const BAYPORT = costOf({ ...PLANNER_DEFAULTS, site: 'bayport' });
const NORTH = costOf({ ...PLANNER_DEFAULTS, site: 'northfield' });
const POWER_2X = gpuHourCost({ ...BASE_PLAN, powerPrice: 2 * SITES.techpark.powerPrice });
const POWER_FREE = gpuHourCost({ ...BASE_PLAN, powerPrice: 0 });
const IDLE_HOUR = gpuHourCost({ ...BASE_PLAN, utilization: 0 }).perHour;
const BUSY_HOUR = gpuHourCost({ ...BASE_PLAN, utilization: 1 }).perHour;
const B_LIQUID = costOf({ ...PLANNER_DEFAULTS, gpu: 'B', cooling: 'liquid' });
const U80 = costOf({ ...PLANNER_DEFAULTS, util: 80 });
const U60 = costOf({ ...PLANNER_DEFAULTS, util: 60 });
const RATE0 = costOf({ ...PLANNER_DEFAULTS, rate: 0 });
const RATE15 = costOf({ ...PLANNER_DEFAULTS, rate: 15 });
const LIFE3 = costOf({ ...PLANNER_DEFAULTS, life: 3 });
const LIFE7 = costOf({ ...PLANNER_DEFAULTS, life: 7 });
const BE5 = breakEven(5, CHALLENGE_PRICE);
const BE3 = breakEven(3, CHALLENGE_PRICE);
const BE7 = breakEven(7, CHALLENGE_PRICE);
/** Lesson 4.4's non-blocking fabric for 1,024 GPUs, per GPU. */
const FABRIC_PER_GPU = fabric({ gpus: 1024, downPorts: 32 }).costPerGpu;
/**
 * A-class GPUs (air) a site's whole grid connection can feed through its hottest hour, with N+1
 * redundancy — Lesson 4.2's sizing, so the two lessons agree.
 */
export function gpusPerGrid(site: SiteId): number {
  return gpusForIt(largestItFor(site, 'N+1'));
}
const PER_MW_TECHPARK = gpusPerGrid('techpark') / SITES.techpark.gridMW;
const BAYPORT_GPUS = gpusPerGrid('bayport');

export const LESSON_NUMBERS = {
  baseYear: BASE.totalYear,
  basePerHour: BASE.perHour,
  basePerUsed: BASE.perUsedHour,
  baseCapex: BASE.serverCapex + BASE.networkCapex + BASE.facilityCapex,
  serverYear: BASE.serverYear,
  facilityCapex: BASE.facilityCapex,
  powerShare: BASE.powerShare,
  crf: CRF,
  bayport: BAYPORT.perUsedHour,
  bayportShare: BAYPORT.powerShare,
  north: NORTH.perUsedHour,
  northShare: NORTH.powerShare,
  power2x: POWER_2X.perUsedHour,
  powerFree: POWER_FREE.perUsedHour,
  idleHour: IDLE_HOUR,
  busyHour: BUSY_HOUR,
  bLiquid: B_LIQUID.perUsedHour,
  u80: U80.perUsedHour,
  u60: U60.perUsedHour,
  rate0: RATE0.perUsedHour,
  rate15: RATE15.perUsedHour,
  life3: LIFE3.perUsedHour,
  life7: LIFE7.perUsedHour,
  be5: BE5,
  be3: BE3,
  be7: BE7,
  perMwTechpark: PER_MW_TECHPARK,
  bayportGpus: BAYPORT_GPUS,
  fabricPerGpu: FABRIC_PER_GPU,
};

// ---------------------------------------------------------------------------
// Display helpers.

const dollars = (x: number) => usd(x, 2);
/** Round to two significant figures for “about” numbers: 677 → 680, 13,186 → 13,000. */
export const about = (x: number) => {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(x))) - 1);
  return fmt(Math.round(x / step) * step);
};
const share = (x: number) => (Number.isFinite(x) ? `${fmt(x * 100, 1)}%` : 'never');

interface CostPart {
  id: string;
  label: string;
  color: string;
  capex: number | null;
  year: number;
}

const PART_COLOR = {
  servers: '#5f7488',
  network: GRAPHIC.blue,
  facility: '#a9a59a',
  power: GRAPHIC.gold,
  upkeep: '#c79a74',
};

function partsOf(c: GpuHourCost): CostPart[] {
  return [
    { id: 'servers', label: 'Servers', color: PART_COLOR.servers, capex: c.serverCapex, year: c.serverYear },
    { id: 'network', label: 'Network', color: PART_COLOR.network, capex: c.networkCapex, year: c.networkYear },
    { id: 'facility', label: 'Building and plant', color: PART_COLOR.facility, capex: c.facilityCapex, year: c.facilityYear },
    { id: 'power', label: 'Electricity', color: PART_COLOR.power, capex: null, year: c.powerYear },
    { id: 'upkeep', label: 'Upkeep', color: PART_COLOR.upkeep, capex: null, year: c.upkeepYear },
  ];
}

const SITE_LABEL: Record<SiteId, string> = { bayport: 'Bayport', techpark: 'Tech Park', northfield: 'Northfield' };

// ---------------------------------------------------------------------------
// Figure 1: the cost of an hour, and of a used hour.

function CostBars({ c, util, gpu }: { c: GpuHourCost; util: number; gpu: GpuId }) {
  const parts = partsOf(c);
  const u = util / 100;
  const [, max] = niceDomain(0, Math.max(4, c.perUsedHour), 4);
  const x0 = 132;
  const x1 = 612;
  const sx = scale(0, max, x0, x1);
  const rows = [
    { y: 36, title: 'Every hour', sub: 'used or not', per: 8760, total: c.perHour },
    { y: 104, title: 'Every used hour', sub: `${fmt(util)}% of hours`, per: 8760 * u, total: c.perUsedHour },
  ];
  const idle = c.perUsedHour - c.perHour;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 176"
      role="img"
      aria-label={`What one ${ACCELERATORS[gpu].short} GPU costs: ${dollars(c.perHour)} for every hour it exists and ${dollars(c.perUsedHour)} for every hour it is used, at ${fmt(util)}% utilization. Servers ${dollars(c.serverYear / (8760 * u))}, network ${dollars(c.networkYear / (8760 * u))}, building and plant ${dollars(c.facilityYear / (8760 * u))}, electricity ${dollars(c.powerYear / (8760 * u))} and upkeep ${dollars(c.upkeepYear / (8760 * u))} of each used hour.`}
    >
      {niceTicks(0, max, 4).map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={sx(t)} x2={sx(t)} y1={22} y2={150} />
          <text className="ax ax-m" x={sx(t)} y={166}>
            {usd(t)}
          </text>
        </g>
      ))}
      {rows.map((r) => {
        let acc = 0;
        return (
          <g key={r.title}>
            <text className="lab" x={x0 - 10} y={r.y + 13} textAnchor="end">
              {r.title}
            </text>
            <text className="ax ax-e" x={x0 - 10} y={r.y + 28}>
              {r.sub}
            </text>
            {parts.map((p) => {
              const v = p.year / r.per;
              const a = sx(acc);
              acc += v;
              const w = Math.max(0, sx(acc) - a);
              return (
                <g key={p.id}>
                  <rect x={a} y={r.y} width={w} height={30} fill={p.color} />
                  {w > 40 && (
                    <text x={a + w / 2} y={r.y + 19} textAnchor="middle" style={{ fontSize: 11, fontWeight: 500, fill: p.id === 'power' || p.id === 'facility' ? '#222' : '#fff' }}>
                      {usd(v, 2)}
                    </text>
                  )}
                </g>
              );
            })}
            <text x={Math.min(sx(r.total) + 6, x1 - 2)} y={r.y + 20} textAnchor={sx(r.total) + 60 > x1 ? 'end' : 'start'} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.green }}>
              {sx(r.total) + 60 > x1 ? '' : dollars(r.total)}
            </text>
          </g>
        );
      })}
      {idle > 0.005 && (
        <g>
          <line x1={sx(c.perHour)} x2={sx(c.perHour)} y1={68} y2={100} stroke="#777" strokeDasharray="3 3" />
          <line x1={sx(c.perHour)} x2={sx(c.perUsedHour)} y1={96} y2={96} stroke="#777" />
          <text className="ax" x={(sx(c.perHour) + sx(c.perUsedHour)) / 2} y={90} textAnchor="middle">
            idle hours +{dollars(idle)}
          </text>
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: cost per used hour against utilization, with a price.

const LIVES = [3, 4, 5, 6, 7];
const U_MIN = 20;
const UTILS = Array.from({ length: 100 - U_MIN + 1 }, (_, i) => U_MIN + i);

function UtilChart({ s, curves, be }: { s: PriceState; curves: Record<number, number[]>; be: number }) {
  const clip = 'uc' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const x0 = 64;
  const x1 = 604;
  const yTop = 24;
  const yBot = 214;
  const yMax = 6;
  const sx = scale(U_MIN, 100, x0, x1);
  const sy = scale(0, yMax, yBot, yTop);
  const cur = curves[s.life];
  const path = (vals: number[]) => linePath(UTILS.map(sx), vals.map((v) => sy(Math.min(v, yMax * 1.5))));
  const costNow = usedHourCost(s.util, s.life);
  // Shade margin (cost below price) and loss (cost above price) between the curve and the price line.
  const area = (below: boolean) => {
    const pts = UTILS.map((u, i) => [sx(u), sy(below ? Math.min(cur[i], s.price) : Math.max(cur[i], s.price))]);
    const back = UTILS.map((u) => [sx(u), sy(s.price)]).reverse();
    return 'M' + [...pts, ...back].map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L') + ' Z';
  };
  const beShown = Number.isFinite(be) && be * 100 >= U_MIN && be <= 1;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 250"
      role="img"
      aria-label={`Cost of a used A-class hour at Tech Park against utilization, over a ${s.life}-year server life: ${dollars(costNow)} at ${fmt(s.util)}%. Against a simulated price of ${dollars(s.price)}, it breaks even at ${beShown ? share(be) : 'no utilization up to 100%'}.`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={x0} y={yTop - 2} width={x1 - x0} height={yBot - yTop + 2} />
        </clipPath>
      </defs>
      <text className="ax" x={x0} y={12}>
        Cost of one used GPU-hour
      </text>
      <GridY y={sy} ticks={[0, 1, 2, 3, 4, 5, 6]} x0={x0} x1={x1} format={(v) => usd(v)} baseline={0} />
      <g clipPath={`url(#${clip})`}>
        <path d={area(true)} fill={tint(GRAPHIC.green, 0.35)} />
        <path d={area(false)} fill={tint(GRAPHIC.red, 0.3)} />
        {LIVES.filter((l) => l !== s.life).map((l) => (
          <path key={l} d={path(curves[l])} fill="none" stroke="#bdbdb8" strokeWidth={1.5} />
        ))}
        <path d={path(cur)} fill="none" stroke="#333" strokeWidth={2.5} strokeLinejoin="round" />
        <line x1={x0} x2={x1} y1={sy(s.price)} y2={sy(s.price)} stroke={TEXT.green} strokeWidth={1.75} strokeDasharray="6 4" />
      </g>
      {LIVES.filter((l) => l !== s.life && (l === 3 || l === 7)).map((l) => {
        const v = curves[l][curves[l].length - 1];
        return (
          <text key={l} className="ax" x={x1 + 4} y={sy(v) + 4}>
            {l} y
          </text>
        );
      })}
      <text className="ax" x={x1 + 4} y={sy(cur[cur.length - 1]) + 4} style={{ fill: '#333', fontWeight: 500 }}>
        {s.life} y
      </text>
      <text className="ax" x={x0 + 6} y={sy(s.price) - 6} style={{ fill: TEXT.green }}>
        price {dollars(s.price)}
      </text>
      {beShown && (
        <g>
          <line x1={sx(be * 100)} x2={sx(be * 100)} y1={sy(s.price)} y2={yBot} stroke="#555" strokeDasharray="2 3" />
          <text className="ax ax-m" x={sx(be * 100)} y={yBot - 6} style={{ fill: '#333' }}>
            break-even {share(be)}
          </text>
        </g>
      )}
      <line className="cur" x1={sx(s.util)} x2={sx(s.util)} y1={yTop} y2={yBot} />
      {costNow <= yMax && <circle cx={sx(s.util)} cy={sy(costNow)} r={5.5} fill="#333" stroke="#fcfcfb" strokeWidth={2} />}
      {[20, 40, 60, 80, 100].map((u) => (
        <text key={u} className="ax ax-m" x={sx(u)} y={232}>
          {u}%
        </text>
      ))}
      <text className="ax ax-e" x={x1} y={248}>
        utilization: share of hours the GPU is rented and busy
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario('planner', PLANNER_DEFAULTS);
  const st = s1.state;
  const c = useMemo(() => costOf(st), [st]);
  const parts = partsOf(c);
  const u = st.util / 100;
  const solvedA = underTargetSolved(st);
  const shownCost = Math.round(c.perUsedHour * 100) / 100;
  const statusA =
    st.gpu !== 'A'
      ? 'Choose the A-class first.'
      : Math.round(st.util) !== 70
        ? `Keep the utilization at 70%; it’s at ${fmt(st.util)}%.`
        : shownCost <= TARGET
          ? `A used hour costs a fraction of a cent over ${dollars(TARGET)}.`
          : `A used hour costs ${dollars(c.perUsedHour)}: ${dollars(c.perUsedHour - TARGET)} too much.`;

  const s2 = useScenario('utilization', PRICE_DEFAULTS);
  const p = s2.state;
  const curves = useMemo(() => Object.fromEntries(LIVES.map((l) => [l, UTILS.map((x) => usedHourCost(x, l))])) as Record<number, number[]>, []);
  const be = useMemo(() => breakEven(p.life, p.price), [p.life, p.price]);
  const costNow = usedHourCost(p.util, p.life);
  const yearNow = costOf(priceState(p.util, p.life)).totalYear;
  const profit = p.price * 8760 * (p.util / 100) - yearNow;
  const solvedB = breakEvenSolved(p);
  const statusB =
    p.life !== CHALLENGE_LIFE
      ? `Set the server life to ${CHALLENGE_LIFE} years; it’s ${p.life}.`
      : Math.abs(p.price - CHALLENGE_PRICE) > 1e-6
        ? `Set the price back to ${dollars(CHALLENGE_PRICE)}.`
        : costNow > p.price
          ? `At ${fmt(p.util)}%, a used hour costs ${dollars(costNow)}: more than the price.`
          : `At ${fmt(p.util)}% the GPU pays for itself. Would a little less still do?`;

  return (
    <LessonPage id="compute/4.5">
      <P>
        The last four lessons followed a GPU out of its server and into the building: into a rack with a power feed (<a href={lessonHref('compute/4.1')}>Lesson 4.1</a>), along a chain of
        transformers and UPS modules from the grid (<a href={lessonHref('compute/4.2')}>4.2</a>), through a cooling plant (<a href={lessonHref('compute/4.3')}>4.3</a>) and onto a network
        (<a href={lessonHref('compute/4.4')}>4.4</a>). Every step was an engineering problem, and every solution came with a price. This lesson adds the prices up. What does it cost to
        produce one hour of a GPU, and what makes that cost rise or fall?
      </P>
      <P>
        Most of the cost is paid before the GPU computes anything. An 8-GPU A-class server costs {usd(SERVERS.A.capex)} in our simulated prices, {usd(BASE.serverCapex)} per GPU;
        its share of a non-blocking network adds {usd(BASE.networkCapex)}, close to the {usd(FABRIC_PER_GPU)} of Lesson 4.4. The building, with its substation, UPS modules, generators and
        chillers, we price at {usd(FACILITY_CAPEX_PER_KW.air)} for every kilowatt of IT load it can carry, a realistic figure for a new data center. Each A-class GPU’s share of a
        server, at {fmt(BASE.itKW, 2)} kW, therefore ties up {usd(BASE.facilityCapex)} of building. In all, {usd(LESSON_NUMBERS.baseCapex)} of <K c="price">capital</K> per GPU.
      </P>
      <P>
        Capital isn’t free, and hardware wears out. A lender, or the owner’s own shareholders, expect a return on the money, which we call the cost of capital. To repay a sum over
        a fixed life with interest, an owner must set aside a fixed share of it every year: at 10% over 5 years, {fmt(CRF, 4)} of it, a little over a quarter. That turns the server’s{' '}
        {usd(BASE.serverCapex)} into {usd(BASE.serverYear)} a year. The building lasts longer, so we spread it over {FACILITY_LIFE} years. On top come the running costs: the
        electricity, at the IT load times the site’s PUE from Lesson 4.3 and its simulated price per megawatt-hour (an idle GPU still draws {pct(IDLE_POWER_SHARE)} of its full
        power), and upkeep — staff, spares and support contracts — at {pct(UPKEEP_SHARE)} of the hardware’s price each year.
      </P>
      <P>
        In the next demonstration, the bars are the cost of one GPU, divided first over every hour of the year and then over the hours it is actually rented and busy — its{' '}
        <b>utilization</b>. The table lists each part. Choose the accelerator, the site and the cooling, and set the utilization, how many years the servers must pay for
        themselves, and the cost of capital:
      </P>

      <Figure name="Compute Facility Planner" scenario={s1}>
        <Segmented label="Accelerator" value={st.gpu} onChange={(gpu) => s1.set({ gpu })} options={GPU_IDS.map((g) => ({ value: g, label: ACCELERATORS[g].name }))} />
        <Segmented label="Site" value={st.site} onChange={(site) => s1.set({ site })} options={SITE_IDS.map((s) => ({ value: s, label: SITE_LABEL[s] }))} />
        <Segmented
          label="Cooling"
          value={st.cooling}
          onChange={(cooling) => s1.set({ cooling })}
          options={[
            { value: 'air', label: `Air (PUE ${fmt(PUE[st.site].air, 2)})` },
            { value: 'liquid', label: `Liquid (PUE ${fmt(PUE[st.site].liquid, 2)})` },
          ]}
        />
        <CostBars c={c} util={st.util} gpu={st.gpu} />
        <Legend items={parts.map((x) => ({ label: x.label, color: x.color }))} />
        <DataTable
          caption="The cost of one GPU: capital, cost per year and cost per used hour, by part"
          rows={parts}
          rowKey={(r) => r.id}
          columns={[
            { label: 'Per GPU', cell: (r) => r.label },
            { label: 'Capital', cell: (r) => (r.capex === null ? '—' : usd(r.capex)), align: 'right' },
            { label: 'Per year', cell: (r) => usd(r.year), align: 'right' },
            { label: 'Per used hour', cell: (r) => dollars(r.year / (8760 * u)), align: 'right' },
          ]}
          footer={['Total', usd(c.serverCapex + c.networkCapex + c.facilityCapex), usd(c.totalYear), dollars(c.perUsedHour)]}
        />
        <Slider label="Utilization" value={st.util} min={10} max={100} step={5} onChange={(v) => s1.set({ util: v })} display={`${fmt(st.util)}%`} />
        <Slider label="Server life" value={st.life} min={3} max={7} onChange={(v) => s1.set({ life: v })} display={`${st.life} years`} />
        <Slider label="Cost of capital" tone="green" value={st.rate} min={0} max={15} onChange={(v) => s1.set({ rate: v })} display={`${st.rate}% a year`} />
        <Readouts
          items={[
            { label: 'per used GPU-hour', value: dollars(c.perUsedHour), tone: 'green' },
            { label: 'per hour, used or not', value: dollars(c.perHour), tone: 'green' },
            { label: 'electricity’s share', value: pct(c.powerShare, 1), tone: 'gold' },
            { label: 'capital per GPU', value: usd(c.serverCapex + c.networkCapex + c.facilityCapex), tone: 'green' },
          ]}
        />
        <Eq label="Cost per used hour equals the yearly cost divided by the hours used">
          <span>cost per used hour</span>
          <Op>=</Op>
          <Frac top={<K c="price">{usd(c.totalYear)} a year</K>} bottom={<span>8,760 h × {fmt(st.util)}%</span>} />
          <Op>=</Op>
          <K c="price">{dollars(c.perUsedHour)}</K>
        </Eq>
      </Figure>

      <P>
        It starts with an air-cooled A-class at Tech Park, rented {fmt(PLANNER_DEFAULTS.util)}% of the time and paid off over {PLANNER_DEFAULTS.life} years at 10%. It costs{' '}
        {usd(BASE.totalYear)} a year: {dollars(BASE.perHour)} for every hour it exists, and {dollars(BASE.perUsedHour)} for every hour it is used. The servers alone account for{' '}
        {dollars(BASE.serverYear / (8760 * 0.7))} of that used hour. Electricity, the thing a data center is usually thought of as consuming, accounts for{' '}
        {dollars(BASE.powerYear / (8760 * 0.7))}: {pct(BASE.powerShare, 1)} of the total.
      </P>

      <Challenge
        id="a"
        question={`Keeping the A-class 70% busy, bring the cost of one used hour under ${dollars(TARGET)}.`}
        solved={solvedA}
        status={statusA}
        success={`Solved: ${dollars(c.perUsedHour)} a used hour. Moving the GPU barely helps — even Northfield’s cheap power and cold air only bring it to ${dollars(NORTH.perUsedHour)} — because the cost is mostly capital. Paying the servers off over a longer life, or borrowing more cheaply, is what moves it.`}
      />

      <H2>Electricity is cheap; megawatts are not</H2>
      <P>
        Try the three sites. Bayport’s power costs {usd(SITES.bayport.powerPrice)} a megawatt-hour and its warm climate needs more cooling, yet a used A-class hour there costs{' '}
        {dollars(BAYPORT.perUsedHour)}, against {dollars(NORTH.perUsedHour)} at Northfield, where power costs {usd(SITES.northfield.powerPrice)}. Electricity is{' '}
        {pct(BAYPORT.powerShare, 1)} of the cost at Bayport and {pct(NORTH.powerShare, 1)} at Northfield. Double Tech Park’s electricity price and a used hour rises only to{' '}
        {dollars(POWER_2X.perUsedHour)}; make the power free and it falls only to {dollars(POWER_FREE.perUsedHour)}.
      </P>
      <P>
        That doesn’t make power unimportant. It makes the price of power unimportant next to the availability of it. Every megawatt a site can draw from the grid feeds about{' '}
        {about(PER_MW_TECHPARK)} air-cooled A-class GPUs at Tech Park, once their cooling at the hottest hour and their losses are counted, and Bayport’s {fmt(SITES.bayport.gridMW)} MW connection
        (<a href={lessonHref('compute/4.2')}>Lesson 4.2</a>) caps it at about {about(BAYPORT_GPUS)}, whatever it is willing to pay. A GPU cloud chooses its sites for the megawatts
        it can get, and pays the local price for them.
      </P>
      <P>
        The accelerators differ much more than the sites. A liquid-cooled B-class hour at Tech Park costs {dollars(B_LIQUID.perUsedHour)} used, {pct(B_LIQUID.perUsedHour / BASE.perUsedHour - 1)}{' '}
        more than an air-cooled A-class hour — but <a href={lessonHref('compute/3.5')}>Lesson 3.5</a> found the B-class doing the same work with a third to a half as many GPUs. Per
        unit of work, the newer, dearer hour is the cheaper one. Chapter 5 starts from that gap between an hour and what it produces.
      </P>

      <H2>Utilization is everything</H2>
      <P>
        Now slide the utilization. Because almost every cost is fixed, an idle GPU costs nearly as much as a busy one: {dollars(IDLE_HOUR)} an hour against {dollars(BUSY_HOUR)}, the
        difference being only the electricity it doesn’t draw. All of that cost has to be recovered from the hours someone pays for. At 80% utilization a used A-class hour costs{' '}
        {dollars(U80.perUsedHour)}; at 60%, {dollars(U60.perUsedHour)}. The bracket in <FigRef to="Compute Facility Planner">the first demonstration</FigRef> is that price of
        idleness, spread over the busy hours.
      </P>
      <P>
        Whether a GPU pays for itself then depends on what its hours can be rented for. Suppose an A-class hour rents for {dollars(CHALLENGE_PRICE)} — a simulated price for now;
        Chapter 5 explains where such prices come from. In the next demonstration, the curve is the cost of a used hour of the Tech Park A-class at every utilization, for the
        server life you choose, with the other lives in gray. Where the curve is below the price, each used hour earns a margin; where it is above, the GPU loses money. Set the
        utilization, the server life and the price:
      </P>

      <Figure name="Compute Facility Planner · utilization" scenario={s2}>
        <UtilChart s={p} curves={curves} be={be} />
        <Slider label="Utilization" value={p.util} min={U_MIN} max={100} onChange={(v) => s2.set({ util: v })} display={`${fmt(p.util)}%`} />
        <Slider label="Server life" value={p.life} min={3} max={7} onChange={(v) => s2.set({ life: v })} display={`${p.life} years`} />
        <Slider label="Rental price" tone="green" value={p.price} min={1} max={4} step={0.05} onChange={(v) => s2.set({ price: Math.round(v * 100) / 100 })} display={`${dollars(p.price)} per hour`} />
        <Readouts
          items={[
            { label: 'cost per used hour', value: dollars(costNow), tone: 'green' },
            { label: 'break-even utilization', value: Number.isFinite(be) ? share(be) : 'none ≤ 100%' },
            { label: 'margin per used hour', value: dollars(p.price - costNow), tone: p.price - costNow < 0 ? 'red' : 'green' },
            { label: 'profit per GPU per year', value: usd(profit), tone: profit < 0 ? 'red' : 'green' },
          ]}
        />
        <Caption>
          {Number.isFinite(be)
            ? `At ${dollars(p.price)} an hour, a ${p.life}-year A-class covers its costs once it is rented ${share(be)} of the time. At ${fmt(p.util)}% it ${profit >= 0 ? `earns ${usd(profit)}` : `loses ${usd(-profit)}`} a year.`
            : `At ${dollars(p.price)} an hour, a ${p.life}-year A-class never covers its costs, even rented every hour of the year.`}
        </Caption>
      </Figure>

      <P>
        At {dollars(CHALLENGE_PRICE)} an hour and a 5-year life, the A-class breaks even at {share(BE5)} utilization. Below it, every extra idle hour deepens the loss; above it,
        every extra rented hour is nearly pure margin, since the costs are already paid. The curve’s shape — steep at low utilization, flat at high — is why a GPU cloud fights so
        hard to keep its fleet busy, and why <a href={lessonHref('compute/3.4')}>Lesson 3.4</a>’s headroom, kept free so users don’t wait, is a real cost.
      </P>

      <Challenge
        id="b"
        figure="Compute Facility Planner · utilization"
        question={`Suppose newer accelerators mean an A-class can rent for ${dollars(CHALLENGE_PRICE)} an hour for only ${CHALLENGE_LIFE} years. Find the lowest utilization, to the whole percent, at which it still pays for itself.`}
        solved={solvedB}
        status={statusB}
        success={`Solved: ${fmt(p.util)}%. Over ${CHALLENGE_LIFE} years each year must repay more of the server’s price, so the same GPU needs to be busy ${share(breakEven(CHALLENGE_LIFE, CHALLENGE_PRICE))} of the time instead of ${share(BE5)}.`}
      />

      <H2>A bet on the life of a GPU</H2>
      <P>
        The server life is the most uncertain number in the plan, and one of the most powerful. It isn’t how long the hardware keeps working, which is usually longer, but how long
        its hours keep their value. Paid off over 3 years, a used A-class hour at {fmt(PLANNER_DEFAULTS.util)}% costs {dollars(LIFE3.perUsedHour)}, and at{' '}
        {dollars(CHALLENGE_PRICE)} it needs to be rented {share(BE3)} of the time; over 7 years, {dollars(LIFE7.perUsedHour)} and {share(BE7)}. The cost of capital matters almost as
        much: at 0% the used hour would cost {dollars(RATE0.perUsedHour)}, at 15% {dollars(RATE15.perUsedHour)} — a far wider range than the one between free electricity and twice its price.
      </P>
      <P>
        And the life isn’t chosen; it’s discovered. When the B-class arrives with more than twice the arithmetic and memory bandwidth, the price an A-class hour can fetch falls,
        and the GPU’s owner learns how long its hours really held their value. Real operators argue over this number, and a GPU bought on the assumption of six good years can
        turn out to have had four. <a href={lessonHref('compute/6.5')}>Lesson 6.5</a> returns to that risk.
      </P>
      <P>
        So the physical supply of usable computation is constrained at every step of this chapter — by space and heat in the rack, megawatts at the fence, the climate outside, the
        network between racks — and at the end it is all turned into a cost per hour that only utilization can bring down. What an hour sells for is another matter. In the next
        chapter we ask how heterogeneous capacity like this becomes an economic resource with prices, starting in <a href={lessonHref('compute/5.1')}>Lesson 5.1</a> with the
        question of what, exactly, is being sold.
      </P>
    </LessonPage>
  );
}
