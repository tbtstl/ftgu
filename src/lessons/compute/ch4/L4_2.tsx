import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
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
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { POWER_DEFAULTS, generatorPlan, powerChain, upsEfficiency, type PowerChain, type Redundancy, type UpsMode } from '../../../engines/compute/facilityPower';
import { annualPue } from '../../../engines/compute/cooling';
import { clusterLayout, rackConfig } from '../../../engines/compute/rack';
import { ACCELERATORS } from '../../../model/compute/hardware';
import { SITES, SITE_IDS, type SiteId } from '../../../model/compute/sites';

// ---------------------------------------------------------------------------
// The model: the power chain of one data hall, from the grid to the chips.

export interface ChainState {
  /** IT load at the racks, MW. */
  itMW: number;
  redundancy: Redundancy;
  upsMode: UpsMode;
  /** Server power-supply efficiency, percent. */
  psu: number;
}

export const CHAIN_DEFAULTS: ChainState = { itMW: 20, redundancy: 'N+1', upsMode: 'double conversion', psu: 94 };

export function chainOf(s: ChainState): PowerChain {
  return powerChain({ ...POWER_DEFAULTS, itMW: s.itMW, redundancy: s.redundancy, upsMode: s.upsMode, psuEfficiency: s.psu / 100 });
}

/** Tech Park's simulated delivered price, used to put a yearly cost on the losses, $/MWh. */
export const LOSS_PRICE = SITES.techpark.powerPrice;
/** The first challenge: losses before the racks of the 20 MW hall, MW. */
export const LOSS_TARGET_MW = 0.5;
export const HALL_MW = 20;

/** Challenge a: the 20 MW hall, with a spare UPS, losing less than 0.5 MW before its racks. */
export function lossSolved(s: ChainState): boolean {
  return s.itMW === HALL_MW && s.redundancy !== 'N' && chainOf(s).facilityLossMW < LOSS_TARGET_MW;
}

/**
 * Cooling and the rest of the building at each site's hottest hour, per MW of IT load, for an
 * air-cooled hall (Lesson 4.3's model): the hottest hour's PUE less its electrical part and the IT itself.
 */
export const PEAK_COOLING: Record<SiteId, number> = Object.fromEntries(
  SITE_IDS.map((id) => {
    const a = annualPue(SITES[id], { cooling: 'air', supplyC: 24 });
    return [id, a.peakPue - 1 - a.electricalPerKW];
  }),
) as Record<SiteId, number>;

export interface SiteState {
  site: SiteId;
  itMW: number;
  redundancy: Redundancy;
}

export const SITE_DEFAULTS: SiteState = { site: 'techpark', itMW: 20, redundancy: 'N+1' };
export const SITE_IT_MAX = 160;
export const IT_STEP = 0.5;

export interface SiteRun {
  chain: PowerChain;
  /** Cooling and the rest of the building at the hottest hour, MW. */
  coolingMW: number;
  /** What the hall draws from the grid at its hottest hour, MW. */
  peakMW: number;
  gridMW: number;
  over: boolean;
  generators: { units: number; installedMW: number };
}

export function siteRun(s: SiteState): SiteRun {
  const chain = powerChain({ ...POWER_DEFAULTS, itMW: s.itMW, redundancy: s.redundancy });
  const coolingMW = s.itMW * PEAK_COOLING[s.site];
  const peakMW = chain.gridMW + coolingMW;
  return { chain, coolingMW, peakMW, gridMW: SITES[s.site].gridMW, over: peakMW > SITES[s.site].gridMW + 1e-9, generators: generatorPlan(peakMW) };
}

/** Largest IT load, on the slider's half-megawatt grid, whose hottest-hour draw fits the site's grid connection. */
export function largestItFor(site: SiteId, redundancy: Redundancy): number {
  let best = 0;
  for (let it = IT_STEP; it <= 400; it += IT_STEP) if (!siteRun({ site, itMW: it, redundancy }).over) best = it;
  return best;
}

/** Challenge b: the largest IT load Bayport's 20 MW connection carries through its hottest hour, with N+1. */
export function gridSolved(s: SiteState): boolean {
  return s.site === 'bayport' && s.redundancy === 'N+1' && !siteRun(s).over && siteRun({ ...s, itMW: s.itMW + IT_STEP }).over;
}

/** A-class GPUs in air-cooled 40 kW racks (Lesson 4.1) whose IT load fits within `itMW`. */
export function gpusForIt(itMW: number): number {
  let lo = 0;
  let hi = Math.ceil((itMW * 1000) / 8) + 1; // servers; each draws more than 1 kW
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (clusterLayout('A', 'air', 40, mid * 8).itMW <= itMW + 1e-9) lo = mid;
    else hi = mid;
  }
  return lo * 8;
}

// Numbers the prose quotes.
const HALL = chainOf(CHAIN_DEFAULTS);
const HALL_GPUS = gpusForIt(HALL_MW);
const HALL_RACKS = clusterLayout('A', 'air', 40, HALL_GPUS).racks;
const RACK_KW = rackConfig({ gpu: 'A', cooling: 'air', servers: 4, feedKW: 40 }).rackKW;
const PSU97 = chainOf({ ...CHAIN_DEFAULTS, psu: 97 });
const ECO = chainOf({ ...CHAIN_DEFAULTS, upsMode: 'eco' });
const TWO_N = chainOf({ ...CHAIN_DEFAULTS, redundancy: '2N' });
const N_ONLY = chainOf({ ...CHAIN_DEFAULTS, redundancy: 'N' });
const AMPS_AT_CHIP = ACCELERATORS.A.tdpW / 0.8;
const TP_HALL = siteRun(SITE_DEFAULTS);
const BAY_MAX = largestItFor('bayport', 'N+1');
const TP_MAX = largestItFor('techpark', 'N+1');
const NF_MAX = largestItFor('northfield', 'N+1');
export const LESSON_NUMBERS = {
  hallGpus: HALL_GPUS,
  hallRacks: HALL_RACKS,
  rackKW: RACK_KW,
  grid: HALL.gridMW,
  facilityLoss: HALL.facilityLossMW,
  upsLoss: HALL.stages[1].lossMW,
  chip: HALL.chipMW,
  psu97Chip: PSU97.chipMW,
  ecoLoss: ECO.facilityLossMW,
  twoNLoss: TWO_N.facilityLossMW,
  tpPeak: TP_HALL.peakMW,
  tpGenerators: TP_HALL.generators,
  bayMax: BAY_MAX,
  tpMax: TP_MAX,
  nfMax: NF_MAX,
  bayGpus: gpusForIt(BAY_MAX),
  tpGpus: gpusForIt(TP_MAX),
  nfGpus: gpusForIt(NF_MAX),
};

// ---------------------------------------------------------------------------
// Formatting and colors.

function mwText(x: number, digits?: number): string {
  const d = digits ?? (x >= 100 ? 0 : x >= 10 ? 1 : 2);
  return `${fmt(x, d)} MW`;
}

export function roundTo(x: number, unit: number): number {
  return Math.round(x / unit) * unit;
}

function pctText(x: number, digits = 1): string {
  return `${fmt(x * 100, digits)}%`;
}

const FLOW = tint(GRAPHIC.red, 0.28);
const LOSS = GRAPHIC.red;
const COOL = GRAPHIC.teal;

const REDUNDANCY_OPTIONS: Array<{ value: Redundancy; label: string }> = [
  { value: 'N', label: 'N: no spare' },
  { value: 'N+1', label: 'N+1: one spare' },
  { value: '2N', label: '2N: two systems' },
];
const MODE_OPTIONS: Array<{ value: UpsMode; label: string }> = [
  { value: 'double conversion', label: 'Double conversion' },
  { value: 'eco', label: 'Eco mode' },
];
const SITE_OPTIONS: Array<{ value: SiteId; label: string }> = SITE_IDS.map((id) => ({ value: id, label: SITES[id].name }));

// ---------------------------------------------------------------------------
// Figure 1: the chain as a band of power that narrows at every stage.

const X0 = 70;
const X1 = 560;
const STAGE_X = [130, 205, 280, 400, 480];
const IT_X = 335;
const TOP = 64;
const BAND = 100;
const STAGE_LABEL: Array<[string, string]> = [
  ['Substation', 'transformer'],
  ['UPS', ''],
  ['Distribution', 'transformer'],
  ['Server', 'power supply'],
  ['Voltage', 'regulators'],
];

function ChainFigure({ c, s }: { c: PowerChain; s: ChainState }) {
  const grid = c.gridMW;
  const vals = [grid, ...c.stages.map((st) => st.outMW)];
  const h = (mw: number) => (BAND * mw) / grid;
  const xs = [X0, ...STAGE_X];
  const xe = [...STAGE_X, X1];
  const label = `Power chain for a ${mwText(s.itMW)} IT load with ${s.redundancy} redundancy and ${s.upsMode === 'eco' ? 'eco-mode' : 'double-conversion'} UPS: ${mwText(grid)} drawn from the grid, ${mwText(c.facilityLossMW)} lost before the racks, ${mwText(c.serverLossMW)} lost inside the servers, ${mwText(c.chipMW)} reaching the chips.`;
  return (
    <svg className="diagram" viewBox="0 0 640 238" role="img" aria-label={label}>
      {STAGE_LABEL.map(([a, b], i) => (
        <g key={i}>
          <text className="ax ax-m" x={STAGE_X[i]} y={b ? 22 : 36}>
            {a}
          </text>
          {b && (
            <text className="ax ax-m" x={STAGE_X[i]} y={36}>
              {b}
            </text>
          )}
        </g>
      ))}
      {vals.map((v, i) => (
        <rect key={i} x={xs[i]} y={TOP} width={xe[i] - xs[i]} height={h(v)} fill={FLOW} />
      ))}
      {c.stages.map((st, i) => {
        const w = Math.max(2, h(st.lossMW));
        return (
          <g key={st.id}>
            <rect x={STAGE_X[i] + 7} y={TOP + h(st.outMW)} width={w} height={186 - (TOP + h(st.outMW))} fill={LOSS} />
            <rect x={STAGE_X[i] - 6} y={TOP - 5} width={12} height={h(st.inMW) + 10} rx={2} fill="#555" />
            <text x={STAGE_X[i] + 7 + w / 2} y={202} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: TEXT.red }}>
              {mwText(st.lossMW)}
            </text>
            <text className="ax ax-m" x={STAGE_X[i] + 7 + w / 2} y={217}>
              {pctText(st.efficiency)}
            </text>
          </g>
        );
      })}
      <line x1={IT_X} x2={IT_X} y1={44} y2={190} stroke="#111" strokeWidth={1} strokeDasharray="4 3" />
      <text x={IT_X} y={54} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
        IT load {mwText(s.itMW)}
      </text>
      <text x={8} y={TOP + 16} style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
        Grid
      </text>
      <text x={8} y={TOP + 32} style={{ fontSize: 12, fontWeight: 500, fill: TEXT.red }}>
        {mwText(grid)}
      </text>
      <text x={568} y={TOP + 16} style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
        Chips
      </text>
      <text x={568} y={TOP + 32} style={{ fontSize: 12, fontWeight: 500, fill: TEXT.red }}>
        {mwText(c.chipMW)}
      </text>
      <text className="ax ax-m" x={(X0 + IT_X) / 2} y={234}>
        in the building
      </text>
      <text className="ax ax-m" x={(IT_X + X1) / 2} y={234}>
        inside the servers
      </text>
    </svg>
  );
}

function chainCaption(c: PowerChain, s: ChainState): string {
  const ups = c.ups;
  const spare = s.redundancy === 'N' ? 'with no spare' : s.redundancy === 'N+1' ? 'with one spare' : 'as two complete systems';
  const mode =
    s.upsMode === 'eco'
      ? 'In eco mode the UPS lets the grid’s power pass straight through, so it loses far less.'
      : 'Double conversion runs every watt through the UPS’s rectifier and inverter.';
  return `${ups.modules} UPS modules of 2.5 MW, ${spare}, each at ${pctText(ups.loadFraction, 0)} of its rating and ${pctText(c.stages[1].efficiency)} efficient. ${mode} Of every megawatt drawn from the grid, ${pctText(c.chipMW / c.gridMW, 0)} reaches the chips.`;
}

// ---------------------------------------------------------------------------
// Figure 2: what's installed behind the load, and the grid connection it must fit.

const BX0 = 120;
const BX1 = 612;
const EX = scale(0, 1, 110, 612);
const EY = scale(0.85, 1, 296, 196);
const CURVE_X = Array.from({ length: 94 }, (_, i) => 0.07 + (0.93 * i) / 93);
const CURVE_DC = linePath(
  CURVE_X.map(EX),
  CURVE_X.map((x) => EY(upsEfficiency(x, 'double conversion'))),
);
const CURVE_ECO = linePath(
  CURVE_X.map(EX),
  CURVE_X.map((x) => EY(upsEfficiency(x, 'eco'))),
);

function SiteFigure({ r, s }: { r: SiteRun; s: SiteState }) {
  const ups = r.chain.ups;
  const maxMW = Math.max(r.gridMW, r.peakMW, ups.installedMW, r.generators.installedMW) * 1.06;
  const x = scale(0, maxMW, BX0, BX1);
  const site = SITES[s.site];
  const eff = r.chain.stages[1].efficiency;
  const label = `${site.name}, ${mwText(s.itMW)} IT load with ${s.redundancy}: at the hottest hour the hall draws ${mwText(r.peakMW)} from a ${mwText(site.gridMW, 0)} grid connection${r.over ? ', more than it can supply' : ''}. ${ups.modules} UPS modules (${mwText(ups.installedMW)}) each run at ${pctText(ups.loadFraction, 0)} of rating, ${pctText(eff)} efficient; ${r.generators.units} generators (${mwText(r.generators.installedMW)}).`;
  const dividers = (count: number, unit: number, y: number) =>
    count <= 64
      ? Array.from({ length: Math.max(0, count - 1) }, (_, i) => <line key={i} x1={x((i + 1) * unit)} x2={x((i + 1) * unit)} y1={y} y2={y + 22} stroke="#fcfcfb" strokeWidth={1.5} />)
      : null;
  return (
    <svg className="diagram" viewBox="0 0 640 322" role="img" aria-label={label}>
      {/* Row 1: the hottest hour against the grid connection. */}
      <text className="ax ax-e" x={BX0 - 8} y={31}>
        hottest hour
      </text>
      <rect x={x(0)} y={16} width={x(r.chain.gridMW) - x(0)} height={22} fill={FLOW} />
      <rect x={x(r.chain.gridMW)} y={16} width={x(r.peakMW) - x(r.chain.gridMW)} height={22} fill={tint(COOL, 0.6)} />
      <line x1={x(r.gridMW)} x2={x(r.gridMW)} y1={8} y2={44} stroke="#111" strokeWidth={1.5} strokeDasharray="4 3" />
      <text
        x={x(r.gridMW) + (x(r.gridMW) > 430 ? -6 : 6)}
        y={54}
        textAnchor={x(r.gridMW) > 430 ? 'end' : 'start'}
        style={{ fontSize: 12, fontWeight: 500, fill: r.over ? TEXT.red : '#333' }}
      >
        grid connection {mwText(r.gridMW, 0)}
        {r.over ? ': exceeded' : ''}
      </text>

      {/* Row 2: UPS installed against the IT load. */}
      <text className="ax ax-e" x={BX0 - 8} y={81}>
        UPS
      </text>
      <rect x={x(0)} y={66} width={x(ups.installedMW) - x(0)} height={22} fill="#e9e9e5" />
      <rect x={x(0)} y={66} width={x(s.itMW) - x(0)} height={22} fill={FLOW} />
      {dividers(ups.modules, ups.installedMW / ups.modules, 66)}
      <text className="ax" x={x(0)} y={103}>
        {ups.modules} modules of 2.5 MW: {mwText(ups.installedMW)} for an IT load of {mwText(s.itMW)}
      </text>

      {/* Row 3: generators against the hottest hour's draw. */}
      <text className="ax ax-e" x={BX0 - 8} y={131}>
        generators
      </text>
      <rect x={x(0)} y={116} width={x(r.generators.installedMW) - x(0)} height={22} fill="#e9e9e5" />
      <rect x={x(0)} y={116} width={x(r.peakMW) - x(0)} height={22} fill={tint(GRAPHIC.gold, 0.55)} />
      {dividers(r.generators.units, 3, 116)}
      <text className="ax" x={x(0)} y={153}>
        {r.generators.units} generators of 3 MW: {mwText(r.generators.installedMW)} for the hottest hour’s {mwText(r.peakMW)}
      </text>

      {/* The UPS efficiency curve. */}
      <text className="ax" x={110} y={182}>
        UPS efficiency at each share of its rating
      </text>
      <GridY y={EY} ticks={[0.85, 0.9, 0.95, 1]} x0={110} x1={612} format={(v) => `${fmt(v * 100)}%`} />
      <path d={CURVE_ECO} fill="none" stroke="#9a9a9a" strokeWidth={2} strokeDasharray="6 4" />
      <path d={CURVE_DC} fill="none" stroke="#333" strokeWidth={2.5} />
      <text className="ax" x={EX(0.32)} y={EY(upsEfficiency(0.32, 'eco')) - 7}>
        eco mode
      </text>
      <text className="ax" x={EX(0.32)} y={EY(upsEfficiency(0.32, 'double conversion')) + 17}>
        double conversion
      </text>
      <line className="cur" x1={EX(ups.loadFraction)} x2={EX(ups.loadFraction)} y1={190} y2={296} />
      <circle cx={EX(ups.loadFraction)} cy={EY(eff)} r={6} fill={LOSS} stroke="#fcfcfb" strokeWidth={2} />
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <text key={v} className={v === 1 ? 'ax ax-e' : v === 0 ? 'ax' : 'ax ax-m'} x={EX(v)} y={314}>
          {fmt(v * 100)}%{v === 1 ? ' of rating' : ''}
        </text>
      ))}
    </svg>
  );
}

function siteCaption(r: SiteRun, s: SiteState): string {
  const site = SITES[s.site];
  const parts = `${mwText(r.chain.gridMW)} for the IT load and its electrical losses, and ${mwText(r.coolingMW)} for cooling and the rest of the building`;
  if (r.over)
    return `At ${site.name}’s hottest hour the hall would draw ${mwText(r.peakMW)} — ${parts} — but the grid connection supplies only ${mwText(site.gridMW, 0)}.`;
  return `At ${site.name}’s hottest hour the hall draws ${mwText(r.peakMW)} of its ${mwText(site.gridMW, 0)} connection: ${parts}.`;
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const a = useScenario('chain', CHAIN_DEFAULTS);
  const s = a.state;
  const c = useMemo(() => chainOf(s), [s]);
  const solvedA = lossSolved(s);
  const lossCost = c.facilityLossMW * 8760 * LOSS_PRICE;

  const b = useScenario('site', SITE_DEFAULTS);
  const t = b.state;
  const r = useMemo(() => siteRun(t), [t]);
  const supported = useMemo(() => gpusForIt(t.itMW), [t.itMW]);
  const solvedB = gridSolved(t);

  const statusA =
    s.itMW !== HALL_MW
      ? `Set the IT load back to ${HALL_MW} MW: the challenge is about the hall we started with.`
      : s.redundancy === 'N'
        ? `With no spare, losing one UPS module would drop part of the hall. Keep at least one spare.`
        : `Right now ${mwText(c.facilityLossMW)} is lost before the racks, ${mwText(c.stages[1].lossMW)} of it in the UPS.`;

  const statusB =
    t.site !== 'bayport'
      ? 'Choose Bayport first.'
      : t.redundancy !== 'N+1'
        ? 'Keep one spare: choose N+1.'
        : r.over
          ? `At ${mwText(t.itMW)} the hall would draw ${mwText(r.peakMW)} at the hottest hour, more than the 20 MW connection.`
          : `At ${mwText(t.itMW)} the hall draws ${mwText(r.peakMW)} at the hottest hour. Is there room for more?`;

  return (
    <LessonPage id="compute/4.2">
      <P>
        The previous lesson filled racks. Four air-cooled servers of A-class 80 GB GPUs make a rack that draws {fmt(RACK_KW, 1)} kW, and{' '}
        {fmt(HALL_GPUS)} of those GPUs, in {fmt(HALL_RACKS)} racks, draw {HALL_MW} MW between them: a large data hall, using as much power as a small town. Every one of those megawatts has to come from the
        grid, arrive at the right voltage, keep flowing when the grid falters, and be converted, step by step, into the fraction of a volt a chip runs on. This lesson follows
        it along the way.
      </P>
      <P>
        The physics is the electricity course’s. A transformer changes the voltage of alternating current with very little loss (
        <a href={lessonHref('1.4')}>Lesson 1.4</a> of that course), and every conductor turns some power into heat, growing with the square of the current it carries (
        <a href={lessonHref('1.5')}>Lesson 1.5</a>). The utility delivers power at transmission voltage to the site’s own <a href={lessonHref('2.3')}>substation</a>, whose
        transformer steps it down for the site’s network. Next comes the <b>uninterruptible power supply</b>, or UPS. In its usual design, double conversion, it turns the
        incoming AC into DC, which also keeps its batteries charged, and then turns the DC back into clean AC for the load. If the grid fails, the batteries carry the hall through
        the seconds it takes diesel generators to start and take over. Distribution transformers then step the voltage down to the few hundred volts the racks use. That is where the
        building ends and the IT equipment begins.
      </P>
      <P>
        Inside each server, a <b>power supply</b> converts the AC into DC at 12 or 48 volts, and on every board, voltage regulators bring it down to the 0.8 V or so that
        the chips of <a href={lessonHref('compute/1.5')}>Lesson 1.5</a> run at. At 0.8 V, 700 W is {fmt(AMPS_AT_CHIP)} amperes. A current that large would waste a great deal
        in any length of wire, so this last step happens within millimeters of the chip.
      </P>
      <P>
        In the next demonstration, the band is the <K c="power">power</K> flowing from the grid on the left to the chips on the right, its height in proportion to the
        megawatts. Each dark bar is a stage of equipment, and each red strip the power it loses as heat, with its efficiency beneath. The dashed line is where the{' '}
        <b>IT load</b> is measured. Set the IT load, the redundancy of the UPS, its mode, and the efficiency of the servers’ power supplies:
      </P>

      <Figure name="Data Center Power Model" scenario={a}>
        <Segmented label="UPS redundancy" value={s.redundancy} onChange={(v) => a.set({ redundancy: v })} options={REDUNDANCY_OPTIONS} />
        <Segmented label="UPS mode" value={s.upsMode} onChange={(v) => a.set({ upsMode: v })} options={MODE_OPTIONS} />
        <ChainFigure c={c} s={s} />
        <Legend
          items={[
            { label: 'power delivered', color: FLOW },
            { label: 'lost as heat', color: LOSS },
          ]}
        />
        <Readouts
          items={[
            { label: 'drawn from the grid', value: mwText(c.gridMW), tone: 'red' },
            { label: 'lost before the racks', value: mwText(c.facilityLossMW), tone: 'red' },
            { label: 'reaching the chips', value: `${mwText(c.chipMW)} · ${pctText(c.chipMW / c.gridMW, 0)}` },
            { label: `losses before the racks a year, at a simulated $${LOSS_PRICE}/MWh`, value: usd(lossCost, 0), tone: 'green' },
          ]}
        />
        <Slider label="IT load" tone="red" value={s.itMW} min={1} max={60} step={IT_STEP} onChange={(v) => a.set({ itMW: v })} display={mwText(s.itMW, 1)} />
        <Slider label="Server power supplies" value={s.psu} min={90} max={97} step={0.5} onChange={(v) => a.set({ psu: v })} display={`${fmt(s.psu, 1)}% efficient`} />
        <Eq label={`Electrical part of PUE equals grid draw divided by IT load: ${fmt(c.electricalPue, 3)}`}>
          <span>PUE, electrical part</span>
          <Op>=</Op>
          <Frac top={<K c="power">{mwText(c.gridMW)}</K>} bottom={<span>{mwText(s.itMW)} IT</span>} />
          <Op>=</Op>
          <span>{fmt(c.electricalPue, 3)}</span>
        </Eq>
        <Caption>{chainCaption(c, s)}</Caption>
      </Figure>

      <P>
        At the start, the {HALL_MW} MW hall draws {mwText(HALL.gridMW)} from the grid. The facility loses {mwText(HALL.facilityLossMW)} before the racks, almost all of it,{' '}
        {mwText(HALL.stages[1].lossMW)}, in the UPS, which converts every watt twice at {pctText(HALL.stages[1].efficiency)} efficiency; the two transformers lose less than a
        tenth of a megawatt each. More is lost inside the servers: {mwText(HALL.stages[3].lossMW)} in their power supplies and {mwText(HALL.stages[4].lossMW)} in the voltage
        regulators. Only {mwText(HALL.chipMW)} reaches the silicon, {pctText(HALL.chipMW / HALL.gridMW, 0)} of what the grid supplies — and that is before the building has
        spent anything on cooling. At a simulated {usd(LOSS_PRICE)} per megawatt-hour, Tech Park’s price, the losses before the racks alone cost about{' '}
        {usd(roundTo(HALL.facilityLossMW * 8760 * LOSS_PRICE, 1000))} a year.
      </P>
      <P>
        The industry’s yardstick for this overhead is <b>power usage effectiveness</b>, or PUE: everything the facility draws divided by what its IT equipment draws. A
        perfect building would score 1. The electrical chain contributes {fmt(HALL.electricalPue, 3)}; cooling, the subject of the next lesson, adds much more. But notice
        where PUE draws its line. Raise the servers’ power supplies from 94% to 97% efficient, and {mwText(PSU97.chipMW)} reaches the chips instead of{' '}
        {mwText(HALL.chipMW)}: {mwText(PSU97.chipMW - HALL.chipMW)} more computing from the same grid draw. PUE doesn’t move, because the power supplies sit inside the IT
        load. It measures the building, not what the servers do with the power they’re given.
      </P>

      <Challenge
        id="a"
        question={`Keep at least one spare UPS module, and bring the ${HALL_MW} MW hall’s losses before the racks under ${LOSS_TARGET_MW} MW.`}
        solved={solvedA}
        status={statusA}
        success={`Solved: eco mode. With N+1 the hall now loses ${mwText(ECO.facilityLossMW)} before its racks instead of ${mwText(HALL.facilityLossMW)}, saving about ${usd(roundTo((HALL.facilityLossMW - ECO.facilityLossMW) * 8760 * LOSS_PRICE, 1000))} a year at Tech Park’s simulated price. No mix of redundancy does it in double conversion, because its losses are set by converting every watt twice.`}
      />

      <P>
        Eco mode earns its savings by doing less. Instead of rebuilding every watt, the UPS lets the grid’s power pass straight through to the load and keeps its inverter
        ready, switching over within milliseconds when the grid misbehaves. The load is no longer isolated from small disturbances on the grid, and its protection depends on
        that switch-over happening in time. Some operators accept that for the savings; others, especially where a dropped training run would cost far more than the
        electricity, don’t.
      </P>

      <H2>Spares at part load</H2>
      <P>
        Redundancy is described by how much spare equipment stands behind the load. With N, there is just enough: the {HALL_MW} MW hall needs {N_ONLY.ups.modules} UPS modules of
        2.5 MW, each running flat out, and losing one drops part of the hall. N+1 adds one spare module, so all {HALL.ups.modules} share the load at{' '}
        {pctText(HALL.ups.loadFraction, 0)} of their rating. 2N builds two complete systems, each able to carry the whole hall alone, so {TWO_N.ups.modules} modules each run at{' '}
        {pctText(TWO_N.ups.loadFraction, 0)}. The generators follow the same logic, and they must carry the whole site, cooling included.
      </P>
      <P>
        Spares cost twice: once to buy, and again in efficiency, because power equipment loses proportionally more at part load. Some of its losses are fixed — they are paid
        whenever the equipment is switched on — so they weigh more as the load falls. A double-conversion UPS is {pctText(upsEfficiency(1, 'double conversion'))} efficient at
        full load, {pctText(upsEfficiency(0.5, 'double conversion'))} at half, {pctText(upsEfficiency(0.25, 'double conversion'))} at a quarter and{' '}
        {pctText(upsEfficiency(0.1, 'double conversion'))} at a tenth. With 2N, the {HALL_MW} MW hall loses {mwText(TWO_N.facilityLossMW)} before its racks instead of{' '}
        {mwText(HALL.facilityLossMW)}. In the next demonstration, choose a site, the IT load and the redundancy, in double conversion. The bars compare what the hall draws at
        the hottest hour of the year with the site’s grid connection, and show the UPS modules and diesel generators installed behind it; the curve is the UPS’s efficiency
        at each share of its rating, with the hall’s operating point:
      </P>

      <Figure name="Data Center Power Model · redundancy and the grid" scenario={b}>
        <Segmented label="Site" value={t.site} onChange={(v) => b.set({ site: v })} options={SITE_OPTIONS} />
        <Segmented label="UPS redundancy" value={t.redundancy} onChange={(v) => b.set({ redundancy: v })} options={REDUNDANCY_OPTIONS} />
        <SiteFigure r={r} s={t} />
        <Legend
          items={[
            { label: 'IT load and electrical losses', color: FLOW },
            { label: 'cooling and the rest of the building', color: tint(COOL, 0.6) },
            { label: 'generators’ load', color: tint(GRAPHIC.gold, 0.55) },
          ]}
        />
        <Readouts
          items={[
            { label: 'drawn at the hottest hour', value: mwText(r.peakMW), tone: r.over ? 'red' : undefined },
            { label: 'grid connection', value: mwText(r.gridMW, 0) },
            { label: 'UPS installed', value: mwText(r.chain.ups.installedMW) },
            { label: 'generators', value: `${r.generators.units} × 3 MW` },
            { label: 'A-class GPUs in this IT load', value: fmt(supported) },
          ]}
        />
        <Slider label="IT load" tone="red" value={t.itMW} min={1} max={SITE_IT_MAX} step={IT_STEP} onChange={(v) => b.set({ itMW: v })} display={mwText(t.itMW, 1)} />
        <Caption>{siteCaption(r, t)}</Caption>
      </Figure>

      <P>
        It starts with the same {HALL_MW} MW hall at Tech Park. On the hottest afternoon of the year, an air-cooled hall there needs about a third of a megawatt of cooling
        for every megawatt of IT, as the next lesson will work out, so the site draws {mwText(TP_HALL.peakMW)} at its peak, comfortably within Tech Park’s 60 MW connection.
        Backing that up with N+1 takes {TP_HALL.generators.units} generators of 3 MW. Switch to 2N and watch the UPS bar double while the load inside it stays put, and the
        operating point slide down the curve.
      </P>

      <H2>The connection is the limit</H2>
      <P>
        Now move the hall to Bayport, the coastal city beside most of the users. Its grid can offer a new data center only {SITES.bayport.gridMW} MW, and on its hottest hour,
        with the cooling an air-cooled hall needs there, the {HALL_MW} MW hall would draw {mwText(siteRun({ ...SITE_DEFAULTS, site: 'bayport' }).peakMW)}. It doesn’t fit.
      </P>

      <Challenge
        id="b"
        figure="Data Center Power Model · redundancy and the grid"
        question="Find the largest IT load, to the nearest half megawatt, that Bayport’s 20 MW connection can carry through the hottest hour of the year, keeping one spare UPS module (N+1)."
        solved={solvedB}
        status={statusB}
        success={`Solved: ${mwText(BAY_MAX, 1)}. At the hottest hour that draws ${mwText(siteRun({ site: 'bayport', itMW: BAY_MAX, redundancy: 'N+1' }).peakMW)}; another half megawatt would need ${mwText(siteRun({ site: 'bayport', itMW: BAY_MAX + IT_STEP, redundancy: 'N+1' }).peakMW)}. That is room for about ${fmt(roundTo(LESSON_NUMBERS.bayGpus, 100))} A-class GPUs in air-cooled racks.`}
      />

      <P>
        Bayport’s {SITES.bayport.gridMW} MW supports an IT load of {mwText(BAY_MAX, 1)}, about {fmt(roundTo(LESSON_NUMBERS.bayGpus, 100))} A-class GPUs. Tech Park’s 60 MW
        supports {mwText(TP_MAX, 1)}, about {fmt(roundTo(LESSON_NUMBERS.tpGpus, 100))}; Northfield’s 200 MW, {mwText(NF_MAX, 0)}, about{' '}
        {fmt(roundTo(LESSON_NUMBERS.nfGpus, 100))}. Those connections, not the
        price of electricity, decide how much computing each site can ever hold. And in the real world they are slow to get. A connection of tens or hundreds of megawatts
        often needs a new substation, and sometimes new transmission lines — lines that, as the electricity course showed in <a href={lessonHref('2.5')}>Lesson 2.5</a>, may
        already be full — and in many places the wait for power, rather than for chips, decides when a new data center can open.
      </P>
      <P>
        So a GPU-hour in Bayport is scarce for reasons that have nothing to do with the GPU. The same A-class chip, in a hall with spare megawatts, an efficient power chain
        and generators behind it, is a different product from one that can’t be switched on at all, and Chapter 5 will show the difference turning into prices. First,
        though, every one of those megawatts ends up as heat. The cooling that removes it was the slice of the hottest hour we borrowed from the next lesson, and in{' '}
        <a href={lessonHref('compute/4.3')}>Lesson 4.3</a> we work it out from the chips outward.
      </P>
    </LessonPage>
  );
}
