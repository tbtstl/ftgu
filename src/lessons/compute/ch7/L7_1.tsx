import { useMemo, useState } from 'react';
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
  fmt,
  lessonHref,
  usd,
} from '../../../framework';
import {
  CUSTOMERS_DEFAULT,
  FLEET_DEFAULT,
  evaluateFleet,
  fleetProductivity,
  inReach,
  type Customer,
  type FleetDesign,
  type FleetEval,
} from '../../../engines/compute/cloud';
import { clusterLayout } from '../../../engines/compute/rack';
import { ACCELERATORS, GPU_COLOR, GPU_IDS, type GpuId } from '../../../model/compute/hardware';
import { SITES, SITE_IDS, type SiteId } from '../../../model/compute/sites';
import { WORKLOAD_IDS, type WorkloadId } from '../../../model/compute/workloads';
import type { Redundancy } from '../../../engines/compute/facilityPower';
import { confirmResetPart, updateCloud, useCloud } from '../shared/cloudStore';

// ---------------------------------------------------------------------------
// Controls and helpers. The fleet lives in the shared capstone design (cloudStore); this lesson
// edits only its `fleet` part.

export const FEEDS = [17, 30, 40, 60, 100, 140];
export const GPU_STEP = 64;
export const GPU_MAX: Record<GpuId, number> = { L: 4096, A: 8192, B: 8192 };
export const SUPPLY_MIN = 15;
export const SUPPLY_MAX = 45;
export const PORTS_MIN = 32;
export const PORTS_MAX = 63;
const HOURS_PER_YEAR = 8760;

const evalCache = new Map<string, FleetEval>();
/** evaluateFleet, remembered per design (it loops over a year of weather on new designs). */
export function evalOf(f: FleetDesign): FleetEval {
  const key = JSON.stringify(f);
  let ev = evalCache.get(key);
  if (!ev) {
    if (evalCache.size > 400) evalCache.clear();
    ev = evaluateFleet(f);
    evalCache.set(key, ev);
  }
  return ev;
}

/** Work the whole fleet could do for each workload if it did only that work, A-class equivalents, by accelerator. */
export function capacityByClass(f: FleetDesign): Record<WorkloadId, Record<GpuId, number>> {
  const prod = fleetProductivity(f, evalOf(f));
  const out = {} as Record<WorkloadId, Record<GpuId, number>>;
  for (const w of WORKLOAD_IDS) {
    out[w] = {} as Record<GpuId, number>;
    for (const g of GPU_IDS) out[w][g] = f.gpus[g] * prod[w][g];
  }
  return out;
}

/** Total capacity for each workload, A-class equivalents. */
export function capacityOf(f: FleetDesign): Record<WorkloadId, number> {
  const by = capacityByClass(f);
  const out = {} as Record<WorkloadId, number>;
  for (const w of WORKLOAD_IDS) out[w] = GPU_IDS.reduce((s, g) => s + by[w][g], 0);
  return out;
}

/** Fixed cost of one GPU-hour, averaged over the fleet, whether or not it is used, $. */
export function fixedPerGpuHour(f: FleetDesign): number {
  const ev = evalOf(f);
  return ev.total > 0 ? ev.fixedPerYear / (ev.total * HOURS_PER_YEAR) : 0;
}

/** Racks each accelerator class takes (Infinity if the feed can't power one server). */
export function racksByClass(f: FleetDesign): Record<GpuId, number> {
  const out = {} as Record<GpuId, number>;
  for (const g of GPU_IDS) out[g] = f.gpus[g] > 0 ? clusterLayout(g, f.cooling, f.feedKW, f.gpus[g]).racks : 0;
  return out;
}

/** What customers want for each workload before price: in an average weekday hour (their sizes), or in their busiest hour. */
export function customerDemand(customers: Customer[], basis: 'average' | 'peak'): Record<WorkloadId, number> {
  const out = {} as Record<WorkloadId, number>;
  for (const w of WORKLOAD_IDS) out[w] = 0;
  for (const c of customers) out[c.workload] += basis === 'average' ? c.size : c.size * (1 + c.swing);
  return out;
}

// The challenge: Marston's hall has room for 60 racks; fit 6,000 A-class equivalents of chat capacity into it.
export const MARSTON_RACKS = 60;
export const CHAT_TARGET = 6000;

export function allChecksPass(f: FleetDesign): boolean {
  return evalOf(f).checks.every((c) => c.ok);
}

/** Challenge: at Marston, every check passing, no more than 60 racks, at least 6,000 A-class equivalents of chat capacity. */
export function marstonSolved(f: FleetDesign): boolean {
  return f.site === 'marston' && allChecksPass(f) && evalOf(f).racks <= MARSTON_RACKS && capacityOf(f).chat70 >= CHAT_TARGET - 1e-6;
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes, all from the engines.

const D = FLEET_DEFAULT;
const EV0 = evalOf(D);
const CAP0 = capacityOf(D);
const BY0 = capacityByClass(D);
const BAY0 = evalOf({ ...D, site: 'marston' });
const NF0 = evalOf({ ...D, site: 'fernhill' });
const HOT = evalOf({ ...D, supplyC: 35 });
const BIG = evalOf({ ...D, gpus: { L: 256, A: 2048, B: 256 } });
const BIG_PORTS = evalOf({ ...D, gpus: { L: 256, A: 2048, B: 256 }, downPorts: 40 });
const BIG_48 = evalOf({ ...D, gpus: { L: 256, A: 2048, B: 256 }, downPorts: 48 });
/** A worked answer to the challenge (one of several). */
export const EXAMPLE_ANSWER: FleetDesign = { ...D, site: 'marston', cooling: 'liquid', supplyC: 35, feedKW: 140, gpus: { L: 0, A: 0, B: 2240 }, downPorts: 35 };
const EX = evalOf(EXAMPLE_ANSWER);
const EX_AIR = evalOf({ ...EXAMPLE_ANSWER, cooling: 'air', supplyC: 24, feedKW: 40 });
/** Marston's hall filled to the last rack with liquid-cooled B-class servers on the biggest feeds: still far inside the grid connection. */
export const FULL_HALL: FleetDesign = { ...EXAMPLE_ANSWER, gpus: { L: 0, A: 0, B: MARSTON_RACKS * 80 }, downPorts: PORTS_MAX };
const FULL = evalOf(FULL_HALL);
const RED_N = evalOf({ ...D, redundancy: 'N' });
const RED_2N = evalOf({ ...D, redundancy: '2N' });
const DEMAND_AVG = customerDemand(CUSTOMERS_DEFAULT, 'average');
const DEMAND_PEAK = customerDemand(CUSTOMERS_DEFAULT, 'peak');

export const LESSON_NUMBERS = {
  gpus: D.gpus,
  total: EV0.total,
  racks: EV0.racks,
  itMW: EV0.itMW,
  pue: EV0.pue,
  gridPeak: EV0.gridPeakMW,
  gridMW: EV0.gridMW,
  capex: EV0.capex,
  fixedYear: EV0.fixedPerYear,
  fixedHour: fixedPerGpuHour(D),
  fixedWeek: (EV0.fixedPerYear * 168) / HOURS_PER_YEAR,
  powerHour: EV0.powerPerBusyHour,
  bayPue: BAY0.pue,
  bayFixed: BAY0.fixedPerYear,
  nfPue: NF0.pue,
  nfFixed: NF0.fixedPerYear,
  hotSpeedB: HOT.speed.B,
  bigTotal: BIG.total,
  bigNetworkOk: BIG.checks.find((c) => c.id === 'network')!.ok,
  bigPortsShare: BIG_PORTS.fabric.crossShare,
  bigPortsTraining: BIG_PORTS.trainingNetFactor,
  bigPortsOk: BIG_PORTS.checks.every((c) => c.ok),
  big48Share: BIG_48.fabric.crossShare,
  big48Training: BIG_48.trainingNetFactor,
  capChat: CAP0.chat70,
  capTrain: CAP0.train70,
  capFrontier: CAP0.frontier400,
  capBatch: CAP0.batch8,
  chatByL: BY0.chat70.L,
  chatByB: BY0.chat70.B,
  exRacks: EX.racks,
  exChat: capacityOf(EXAMPLE_ANSWER).chat70,
  exGridPeak: EX.gridPeakMW,
  exOk: EX.checks.every((c) => c.ok),
  exAirRacks: EX_AIR.racks,
  fullHallRacks: FULL.racks,
  fullHallGridPeak: FULL.gridPeakMW,
  pueN: RED_N.pue,
  pue2N: RED_2N.pue,
  fixedN: RED_N.fixedPerYear,
  fixed2N: RED_2N.fixedPerYear,
  demandAvg: DEMAND_AVG,
  demandPeak: DEMAND_PEAK,
  demandAvgTotal: WORKLOAD_IDS.reduce((s, w) => s + DEMAND_AVG[w], 0),
};
const N = LESSON_NUMBERS;

// ---------------------------------------------------------------------------
// Display.

const SHORT: Record<GpuId, string> = { L: 'L-class', A: 'A-class', B: 'B-class' };
const WNAME: Record<WorkloadId, string> = { chat70: 'Chat', code8: 'Code completion', batch8: 'Batch summaries', frontier400: 'Frontier assistant', train70: 'Training', tune8: 'Fine-tuning' };
const CHECK_NAME: Record<string, string> = { racks: 'Racks', grid: 'Grid connection', cooling: 'Cooling', network: 'Network' };
const CHECK_LESSON: Record<string, string> = { racks: 'compute/4.1', grid: 'compute/4.2', cooling: 'compute/4.3', network: 'compute/4.4' };
const mUSD = (x: number) => `$${fmt(x / 1e6, x >= 1e8 ? 0 : 1)}M`;

/** The site's floor: one tile per rack, colored and labeled by accelerator class, beside its grid connection. */
function SiteFloor({ f, ev }: { f: FleetDesign; ev: FleetEval }) {
  const racks = racksByClass(f);
  const finite = GPU_IDS.every((g) => Number.isFinite(racks[g]));
  const total = finite ? GPU_IDS.reduce((s, g) => s + racks[g], 0) : 0;
  const site = SITES[f.site];
  // Floor area: x 0–392, y 30–188. Tiles shrink to fit; past 600 racks each tile stands for several.
  const per = total > 600 ? Math.ceil(total / 600) : 1;
  const tiles = GPU_IDS.flatMap((g) => Array.from({ length: Math.ceil((finite ? racks[g] : 0) / per) }, () => g));
  const n = tiles.length;
  const W = 392;
  const Hh = 158;
  const cols = n > 0 ? Math.max(1, Math.ceil(Math.sqrt((n * W) / Hh))) : 1;
  const size = n > 0 ? Math.min(22, W / cols, Hh / Math.ceil(n / cols)) : 22;
  const gx = 430;
  const gw = 190;
  const gridScale = Math.max(site.gridMW, ev.gridPeakMW);
  const bar = (mw: number) => (gw * mw) / gridScale;
  const over = ev.gridPeakMW > site.gridMW + 1e-9;
  const label = `${site.name}: ${fmt(ev.total)} GPUs in ${finite ? fmt(ev.racks) : 'no'} racks (${GPU_IDS.filter((g) => f.gpus[g] > 0)
    .map((g) => `${SHORT[g]} ${fmt(f.gpus[g])} in ${Number.isFinite(racks[g]) ? fmt(racks[g]) : 'no'} racks`)
    .join(', ')}), ${f.cooling === 'air' ? 'air' : 'liquid'}-cooled on ${f.feedKW} kW feeds. At the hottest hour the site draws ${fmt(ev.gridPeakMW, 1)} MW of a ${site.gridMW} MW grid connection${over ? ': too much' : ''}.`;
  return (
    <svg className="diagram" viewBox="0 0 640 194" role="img" aria-label={label}>
      <text className="ax" x={0} y={14}>
        {site.name}: the hall, {per > 1 ? `each tile ${per} racks` : 'one tile per rack'}
      </text>
      {!finite && (
        <text x={0} y={60} style={{ fontSize: 13, fill: '#c4382f' }}>
          A {f.feedKW} kW feed can’t power even one server of this kind.
        </text>
      )}
      {tiles.map((g, i) => {
        const cx = (i % cols) * size;
        const cy = 30 + Math.floor(i / cols) * size;
        return <rect key={i} x={cx + 0.5} y={cy + 0.5} width={Math.max(1, size - 2)} height={Math.max(1, size - 2)} rx={size > 8 ? 2 : 0.5} fill={GPU_COLOR[g]} opacity={0.85} />;
      })}
      {n === 0 && finite && (
        <text x={0} y={60} className="ax">
          The hall is empty.
        </text>
      )}
      <text className="ax" x={gx} y={14}>
        Grid connection, hottest hour
      </text>
      <rect x={gx} y={30} width={gw} height={22} fill="#f0f0ed" />
      <rect x={gx} y={30} width={bar(Math.min(ev.itMW, gridScale))} height={22} fill={GRAPHIC.red} opacity={0.75} />
      <rect x={gx + bar(ev.itMW)} y={30} width={Math.max(0, bar(ev.gridPeakMW - ev.itMW))} height={22} fill={GRAPHIC.red} opacity={0.35} />
      <line x1={gx + bar(site.gridMW)} x2={gx + bar(site.gridMW)} y1={24} y2={58} stroke="#333" strokeWidth={1.5} />
      <text className="ax" x={gx} y={72}>
        {fmt(ev.gridPeakMW, 1)} MW of {site.gridMW} MW{over ? ' — over' : ''}
      </text>
      <text className="ax" x={gx} y={88}>
        IT {fmt(ev.itMW, 2)} MW · PUE {fmt(ev.pue, 2)}
      </text>
      <text className="ax" x={gx} y={106}>
        {site.rttMs} ms from the users
      </text>
      <text className="ax" x={gx} y={122}>
        power ${site.powerPrice}/MWh · building ×{site.buildCostIndex}
      </text>
      {GPU_IDS.map((g, i) => (
        <g key={g}>
          <rect x={gx} y={138 + i * 20} width={10} height={10} rx={2} fill={GPU_COLOR[g]} />
          <text x={gx + 16} y={147 + i * 20} style={{ fontSize: 12, fill: '#333' }}>
            {SHORT[g]} {fmt(f.gpus[g])} GPUs · {Number.isFinite(racks[g]) ? `${fmt(racks[g])} racks` : 'no racks'}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** The four checks of chapter 4, each with its verdict in words. */
function Checks({ ev }: { ev: FleetEval }) {
  return (
    <div style={{ margin: '6px 0 2px', fontSize: 14, lineHeight: 1.5 }}>
      {ev.checks.map((c) => (
        <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1.4em 8.5em 1fr', columnGap: 6, padding: '2px 0' }}>
          <span aria-hidden="true" style={{ color: c.ok ? '#3f7a1e' : '#c4382f', fontWeight: 600 }}>
            {c.ok ? '✓' : '✗'}
          </span>
          <span style={{ color: '#333' }}>
            <a href={lessonHref(CHECK_LESSON[c.id])}>{CHECK_NAME[c.id]}</a>
            <span className="sr-only">{c.ok ? ': passes.' : ': fails.'}</span>
          </span>
          <span style={{ color: c.ok ? '#5f5f5f' : '#c4382f' }}>{c.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Capacity for each workload, stacked by accelerator class, against what the customers want. */
function CapacityChart({ f, customers, basis }: { f: FleetDesign; customers: Customer[]; basis: 'average' | 'peak' }) {
  const by = capacityByClass(f);
  const want = customerDemand(customers, basis);
  const far = new Set(customers.filter((c) => !inReach(c, f.site)).map((c) => c.workload));
  const caps = WORKLOAD_IDS.map((w) => GPU_IDS.reduce((s, g) => s + by[w][g], 0));
  const top = Math.max(500, ...caps, ...WORKLOAD_IDS.map((w) => want[w]));
  const x0 = 150;
  const x1 = 600;
  const x = (v: number) => x0 + ((x1 - x0) * v) / top;
  const label = WORKLOAD_IDS.map((w, i) => `${WNAME[w]}: capacity ${fmt(caps[i])}, customers want ${fmt(want[w])}${far.has(w) ? ' (out of reach from this site)' : ''}`).join('; ');
  return (
    <svg className="chart" viewBox="0 0 640 260" role="img" aria-label={`Capacity of the fleet for each workload, in A-class equivalents, against the customers’ demand before price in ${basis === 'average' ? 'an average weekday hour' : 'their busiest hour'}. ${label}.`}>
      <text className="ax" x={x0} y={14}>
        A-class equivalents, if the whole fleet did only that work
      </text>
      {WORKLOAD_IDS.map((w, i) => {
        const y = 28 + i * 37;
        let at = x0;
        return (
          <g key={w}>
            <text x={0} y={y + 14} style={{ fontSize: 13, fill: '#222' }}>
              {WNAME[w]}
            </text>
            <text x={0} y={y + 29} className="ax">
              {far.has(w) ? 'too far from its users' : `${fmt(caps[i])} · want ${fmt(want[w])}`}
            </text>
            <rect x={x0} y={y + 2} width={x1 - x0} height={22} fill="#f4f4f1" />
            {GPU_IDS.map((g) => {
              const wpx = x(by[w][g]) - x0;
              const r = <rect key={g} x={at} y={y + 2} width={Math.max(0, wpx)} height={22} fill={GPU_COLOR[g]} opacity={far.has(w) ? 0.25 : 0.85} />;
              at += wpx;
              return r;
            })}
            {want[w] > 0 && <line x1={x(want[w])} x2={x(want[w])} y1={y - 2} y2={y + 28} stroke="#111" strokeWidth={2} />}
          </g>
        );
      })}
      <line className="base" x1={x0} x2={x0} y1={24} y2={252} />
    </svg>
  );
}

export default function Lesson() {
  const design = useCloud();
  const f = design.fleet;
  const ev = evalOf(f);
  const cap = useMemo(() => capacityOf(f), [f]);
  const setFleet = (patch: Partial<FleetDesign>) => updateCloud((d) => ({ ...d, fleet: { ...d.fleet, ...patch } }));
  const setGpus = (g: GpuId, v: number) => updateCloud((d) => ({ ...d, fleet: { ...d.fleet, gpus: { ...d.fleet.gpus, [g]: v } } }));
  const solved = marstonSolved(f);
  const failing = ev.checks.filter((c) => !c.ok).map((c) => CHECK_NAME[c.id].toLowerCase());
  const status =
    f.site !== 'marston'
      ? `The fleet is at ${SITES[f.site].name}. Move it to Marston first.`
      : failing.length
        ? `At Marston the ${failing.join(' and ')} check${failing.length > 1 ? 's fail' : ' fails'}.`
        : ev.racks > MARSTON_RACKS
          ? `Every check passes, but the fleet takes ${fmt(ev.racks)} racks: more than the hall’s ${MARSTON_RACKS}.`
          : `${fmt(ev.racks)} racks, every check passing — but only ${fmt(cap.chat70)} A-class equivalents of chat capacity, short of ${fmt(CHAT_TARGET)}.`;

  return (
    <LessonPage id="compute/7.1">
      <P>
        Six chapters have taken compute apart: the silicon that switches (Chapter 1), the GPU that puts thousands of arithmetic lanes to work at once (Chapter 2), the models that keep
        it busy (Chapter 3), the buildings that power and cool it (Chapter 4), the markets that price its hours (Chapter 5) and the strategies that trade on those prices
        (Chapter 6). In this last chapter we put the pieces back together and run a GPU cloud of our own. Over five lessons you’ll build its fleet and its building, give
        it customers, set its prices, run it for a week, and finally run it for three uncertain years and score the strategy as a whole.
      </P>
      <P>
        The cloud is one design, kept in this browser, and each lesson changes only its own part of it: this lesson the fleet, Lesson 7.2 the customers, 7.3 the prices
        and 7.4 the operating plan, while 7.5 judges the result. Each lesson’s Reset asks first and puts back only its own part. The text of every lesson describes
        the starting design, so you can skip ahead, and each demonstration that uses the other lessons’ parts can show either the starting design or yours. Nothing
        in this chapter is new. Every number comes from an engine an earlier lesson built, and each lesson points back to where.
      </P>
      <P>
        The starting fleet sits at Tech Park, the campus in the electricity course’s region: {fmt(N.gpus.L)} L-class 48 GB, {fmt(N.gpus.A)} A-class 80 GB and{' '}
        {fmt(N.gpus.B)} B-class 192 GB GPUs, air-cooled at 24 °C on 40 kW rack feeds, on a non-blocking network, with one spare UPS module (N+1). Four checks from
        Chapter 4 decide whether it can be built. The racks must hold their servers within their feeds and their cooling (
        <a href={lessonHref('compute/4.1')}>Lesson 4.1</a>). The site must stay inside its grid connection at the hottest hour of the year, cooling included (
        <a href={lessonHref('compute/4.2')}>Lessons 4.2</a> and <a href={lessonHref('compute/4.3')}>4.3</a>). The coolant must be cool enough for every chip to run at
        full speed (Lesson 4.3). And two tiers of switches must reach every GPU (<a href={lessonHref('compute/4.4')}>Lesson 4.4</a>). The money follows{' '}
        <a href={lessonHref('compute/4.5')}>Lesson 4.5</a>’s base case: servers paid off over 5 years and the building over 15, at 10% a year.
      </P>
      <P>
        In the next demonstration, the tiles are the hall’s racks, colored by the GPUs they hold, and the bar is the site’s draw at its hottest hour against its grid
        connection. The last readout is the fleet’s <K tone="orange">capacity</K> for chat: the chat work it could do in an hour if every GPU did nothing else, counted in
        A-class equivalents (A-eq). One A-class equivalent is the work one A-class 80 GB GPU does for that workload, the unit in which{' '}
        <a href={lessonHref('compute/3.5')}>Lesson 3.5</a> measured each accelerator and <a href={lessonHref('compute/6.1')}>Lesson 6.1</a> counted a fleet’s yield.
        Change the site, the GPUs, the cooling and how warm its coolant runs, the rack feeds, the ports each leaf switch gives the GPUs, and the redundancy. Your choices
        are saved as your cloud’s fleet:
      </P>

      <Figure name="GPU Cloud Builder" onReset={() => confirmResetPart('fleet')}>
        <Segmented
          label="Site"
          value={f.site}
          onChange={(site: SiteId) => setFleet({ site })}
          options={SITE_IDS.map((s) => ({ value: s, label: SITES[s].name }))}
        />
        <SiteFloor f={f} ev={ev} />
        <Checks ev={ev} />
        <Readouts
          items={[
            { label: 'capital spent', value: mUSD(ev.capex), tone: 'green' },
            { label: 'fixed cost a year', value: mUSD(ev.fixedPerYear), tone: 'green' },
            { label: 'fixed per GPU-hour', value: usd(fixedPerGpuHour(f), 2), tone: 'green' },
            { label: 'chat capacity, A-eq', value: fmt(cap.chat70), tone: 'orange' },
          ]}
        />
        {GPU_IDS.map((g) => (
          <Slider key={g} label={`${SHORT[g]} GPUs`} value={f.gpus[g]} min={0} max={GPU_MAX[g]} step={GPU_STEP} onChange={(v) => setGpus(g, v)} display={fmt(f.gpus[g])} />
        ))}
        <Slider
          label={f.cooling === 'air' ? 'Inlet air' : 'Supply water'}
          tone="teal"
          value={f.supplyC}
          min={SUPPLY_MIN}
          max={SUPPLY_MAX}
          onChange={(supplyC) => setFleet({ supplyC })}
          display={`${fmt(f.supplyC)} °C`}
        />
        <Slider label="Leaf ports facing GPUs" tone="blue" value={f.downPorts} min={PORTS_MIN} max={PORTS_MAX} onChange={(downPorts) => setFleet({ downPorts })} display={`${f.downPorts} of 64`} />
        <Segmented
          label="Cooling"
          value={f.cooling}
          onChange={(cooling) => setFleet({ cooling })}
          options={[
            { value: 'air', label: 'Air' },
            { value: 'liquid', label: 'Liquid (cold plates)' },
          ]}
        />
        <Segmented
          label="Rack feed"
          value={String(f.feedKW)}
          onChange={(v) => setFleet({ feedKW: Number(v) })}
          options={FEEDS.map((kw, i) => ({ value: String(kw), label: i === 0 ? `${kw} kW feeds` : `${kw} kW` }))}
        />
        <Segmented
          label="UPS redundancy"
          value={f.redundancy}
          onChange={(redundancy: Redundancy) => setFleet({ redundancy })}
          options={[
            { value: 'N', label: 'N' },
            { value: 'N+1', label: 'N+1' },
            { value: '2N', label: '2N' },
          ]}
        />
      </Figure>

      <P>
        The starting fleet passes every check with room to spare. Its {fmt(N.total)} GPUs fill {fmt(N.racks)} racks and draw {fmt(N.itMW, 2)} MW, and with cooling and
        losses the site needs {fmt(N.gridPeak, 1)} MW at its hottest hour, out of Tech Park’s {fmt(N.gridMW)} MW; its PUE over the year is {fmt(N.pue, 2)}. Building it
        costs {mUSD(N.capex)}. Paying that back, with the network and upkeep, is the fleet’s <K c="price">fixed cost</K>: {mUSD(N.fixedYear)} a year, or{' '}
        {usd(N.fixedHour, 2)} for each GPU-hour, whether the GPU works or not. Electricity is extra and small beside it: a busy A-class hour burns {usd(N.powerHour.A, 3)} of it at Tech Park’s simulated price. As in Lesson
        4.5, the business will live or die by how much of each hour it sells.
      </P>
      <P>
        Now try the other sites. At Marston, beside the users, the same fleet runs a PUE of {fmt(N.bayPue, 2)} in the warm, humid air, and the city’s land and labor
        raise its fixed cost to {mUSD(N.bayFixed)} a year. At Fernhill, with cold air and cheap hydro power, the PUE falls to {fmt(N.nfPue, 2)} and the fixed cost to{' '}
        {mUSD(N.nfFixed)} — but Fernhill is {SITES.fernhill.rttMs} ms from the users, and the next demonstration will show what that costs. Warm the inlet air to
        35 °C and the cooling check fails: the B-class can no longer shed its 1,000 W and slows to {Math.round(N.hotSpeedB * 100)}% of full speed (Lesson 4.3).
      </P>
      <P>
        The redundancy control, by contrast, barely moves anything. It models only one of the two costs of spares in{' '}
        <a href={lessonHref('compute/4.2')}>Lesson 4.2</a>, the losses of UPS modules running at part load, and those shift the PUE only from {fmt(N.pueN, 2)} with N to{' '}
        {fmt(N.pue2N, 2)} with 2N. The capital the spare modules cost and the outages they prevent are left out of this model, so the fixed cost stays at{' '}
        {mUSD(N.fixedN)} either way and N looks free. It isn’t: without a spare, losing one module drops part of the hall, which is why real halls pay for N+1 or 2N.
      </P>

      <H2>Where the limits are</H2>
      <P>
        Each check is one of Chapter 4’s limits, and each can be traded against the others. Grow the A-class to {fmt(2048)} and the fleet’s {fmt(N.bigTotal)} GPUs
        outgrow two tiers of switches with half of each leaf facing the GPUs. Give the GPUs 40 of each leaf’s 64 ports and the network check passes again, but each GPU
        now gets {Math.round(N.bigPortsShare * 100)}% of its card’s bandwidth when everyone talks at once. Serving barely notices, since a copy of a model lives inside
        one server, and the 70B training run can still hide its gradient exchange behind its backward pass, as Lesson 4.4 found. At 48 ports, a third of a card each,
        it can’t: training slows to {Math.round(N.big48Training * 100)}% of its speed. Air cooling holds a rack to about 40 kW, so dense
        B-class servers need liquid and a big feed to pack tightly.
      </P>
      <P>
        Where land is dear, the floor can bind before the grid does. Marston’s hall has room for just {MARSTON_RACKS} racks: filled to the last one with B-class
        servers, ten to a liquid-cooled rack on {Math.max(...FEEDS)} kW feeds, it would draw only {fmt(N.fullHallGridPeak, 1)} MW at the hottest hour, well inside the
        city’s {SITES.marston.gridMW} MW connection. Suppose the cloud wants to serve chat from the city itself:
      </P>

      <Challenge
        id="a"
        question={`Move the fleet to Marston and fit at least ${fmt(CHAT_TARGET)} A-class equivalents of chat capacity into no more than ${MARSTON_RACKS} racks, with every check passing.`}
        solved={solved}
        status={status}
        success={`Solved: ${fmt(ev.racks)} racks hold ${fmt(cap.chat70)} A-class equivalents of chat capacity, and every check passes. The B-class does ${fmt(capacityByClass(f).chat70.B > 0 && f.gpus.B > 0 ? capacityByClass(f).chat70.B / f.gpus.B : 0, 2)} A-class hours of chat work each, so it packs the most chat into a rack; air allows three of its servers to a rack, while liquid on a big enough feed allows up to ten. More than ${fmt(2048)} GPUs also need more of each leaf’s ports facing them.`}
      />

      <P>
        There are several answers, and all of them lean on the B-class and on liquid. The leanest is {fmt(EXAMPLE_ANSWER.gpus.B)} B-class GPUs and nothing else,
        cooled by 35 °C water on 140 kW feeds, with {EXAMPLE_ANSWER.downPorts} of each leaf’s ports facing GPUs: {fmt(N.exRacks)} racks and {fmt(N.exChat)} A-class
        equivalents of chat, drawing {fmt(N.exGridPeak, 1)} MW of Marston’s 20 MW at the hottest hour. Cooled by air on 40 kW feeds, the same GPUs would need{' '}
        {fmt(N.exAirRacks)} racks. Whether a fleet like that would pay is a question for the rest of the chapter: keep whichever fleet you like, or press Reset to put
        the starting one back. The next lessons’ text quotes the starting fleet, and their demonstrations show it unless you switch them to yours.
      </P>

      <H2>What the fleet can do</H2>
      <P>
        A fleet’s GPUs are worth what they can do for the customers who can reach them. Chat is only one of the six workloads of <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>, and each accelerator does a
        different share of each one’s work, so the fleet has a capacity for every workload. In the next demonstration, each bar is the work the whole fleet could do if
        it did only that workload, split by the accelerators that do it; the black mark is what the customers of Lesson 7.2 want for that workload before any price is
        asked, in an average weekday hour or in their busiest. The sliders move the same fleet as the first demonstration:
      </P>

      <CapacityFigure />

      <P>
        The starting fleet could do {fmt(N.capChat)} A-class equivalents of chat work, {fmt(N.capTrain)} of training or {fmt(N.capFrontier)} of the frontier
        assistant’s — but it does all of them at once, from the same GPUs, so the bars can’t simply be added. Before price, the customers want{' '}
        {fmt(N.demandAvgTotal)} A-class equivalents in an average weekday hour, in all, and more in the afternoon. The bars also show where each class earns its place. The {fmt(N.gpus.B)} B-class GPUs
        supply {fmt(N.chatByB)} A-class equivalents of chat, two-thirds as much as {fmt(N.gpus.A)} A-class GPUs, four times as many, do; the {fmt(N.gpus.L)} L-class
        cards supply {fmt(N.chatByL)}. Every one of those cards still costs its share of the fixed cost, a question Lessons 7.4 and 7.5 will press. Move the fleet to Fernhill and
        the code-completion bar fades: its users are too far away for any GPU there to serve them.
      </P>
      <P>
        Capacity is only half of the picture. What matters is how much of it the customers want, when, and at what price. In the next lesson we give the cloud its
        customers.
      </P>
    </LessonPage>
  );
}

/** The second demonstration: capacity by workload against the customers' demand, with the fleet's GPU sliders. */
function CapacityFigure() {
  const design = useCloud();
  const f = design.fleet;
  const setGpus = (g: GpuId, v: number) => updateCloud((d) => ({ ...d, fleet: { ...d.fleet, gpus: { ...d.fleet.gpus, [g]: v } } }));
  const s = useBasis();
  return (
    <Figure name="GPU Cloud Builder · what it can do" onReset={s.reset}>
      <Segmented
        label="Customers’ demand"
        value={s.basis}
        onChange={s.set}
        options={[
          { value: 'average', label: 'An average weekday hour' },
          { value: 'peak', label: 'Their busiest hour' },
        ]}
      />
      <CapacityChart f={f} customers={design.customers} basis={s.basis} />
      <Legend items={[...GPU_IDS.map((g) => ({ label: `${ACCELERATORS[g].short}`, color: GPU_COLOR[g] })), { label: 'What the customers want', color: '#111', kind: 'line' as const }]} />
      {GPU_IDS.map((g) => (
        <Slider key={g} label={`${SHORT[g]} GPUs`} value={f.gpus[g]} min={0} max={GPU_MAX[g]} step={GPU_STEP} onChange={(v) => setGpus(g, v)} display={fmt(f.gpus[g])} />
      ))}
      <Caption>
        <FigRef to="GPU Cloud Builder">The first demonstration</FigRef> sets the site, cooling and network; here only the GPU counts change.
      </Caption>
    </Figure>
  );
}

function useBasis() {
  const [basis, setBasis] = useState<'average' | 'peak'>('average');
  return { basis, set: setBasis, reset: () => setBasis('average') };
}
