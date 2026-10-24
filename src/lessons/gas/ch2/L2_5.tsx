import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  pct,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { COMPONENT, COMPONENTS, PIPELINE_SPEC, checkSpec, composition, gasProperties, type Component, type Composition } from '../../../engines/gas/properties';
import {
  DRY_WATER,
  FUEL_BASE,
  WATER_SPEC,
  ethaneBreakeven,
  mmbtuPerGallon,
  plantValue,
  processGas,
  type PlantResult,
  type PlantSettings,
  type ProductPrices,
} from '../../../engines/gas/processing';
import { NGL_PRICES, PLANT_INLET_MMCFD, RAW_WATER, RIDGEBACK_RAW, SANDHILL_RAW } from '../../../model/gas/production';
import { XYChart } from '../shared/XYChart';
import { money } from '../shared/format';

// ---------------------------------------------------------------------------
// The plant: Ridgeback raw gas at 400 MMcf/d, run through whichever units the reader switches on.

const INLET = PLANT_INLET_MMCFD;

/** The first demonstration starts with the plant doing nothing: raw gas straight through. */
export const PLANT_DEFAULTS = { co2: 0, dehydrate: false, ethane: 0, propane: 0, butane: 0 };
type PlantState = typeof PLANT_DEFAULTS;

/** Slider percentages to the engine's settings. */
export function settingsOf(s: PlantState): PlantSettings {
  return { co2Removal: s.co2 / 100, dehydrate: s.dehydrate, ethane: s.ethane / 100, propane: s.propane / 100, butane: s.butane / 100 };
}

export function runPlant(s: PlantState): PlantResult {
  return processGas(RIDGEBACK_RAW, INLET, RAW_WATER, settingsOf(s));
}

/** The first challenge: pipeline-quality gas with every molecule of ethane left in it. */
export function ethaneLeftSolved(s: PlantState): boolean {
  return s.ethane === 0 && runPlant(s).ok;
}

/** How the second demonstration runs the plant's other units: four-fifths of the CO2 out, gas dried, propane and butane recovered almost completely. */
export const STANDARD: Omit<PlantSettings, 'ethane'> = { co2Removal: 0.8, dehydrate: true, propane: 0.98, butane: 1 };
/** The ethane recovery the second demonstration compares with rejection. */
export const DEEP = 0.9;
/** The challenge's gas price, $/MMBtu: the simulated Ridgeback price. */
export const CHALLENGE_GAS = NGL_PRICES.gas;

export const VALUE_DEFAULTS = { gas: NGL_PRICES.gas, ethanePrice: NGL_PRICES.ethane, recovery: 0 };
type ValueState = typeof VALUE_DEFAULTS;

const pricesOf = (gas: number, ethane: number): ProductPrices => ({ ...NGL_PRICES, gas, ethane });

/** A day's output value ($) at the standard settings and a given ethane recovery. */
export function dayValue(recovery: number, gas: number, ethanePrice: number): number {
  return plantValue(processGas(RIDGEBACK_RAW, INLET, RAW_WATER, { ...STANDARD, ethane: recovery }), pricesOf(gas, ethanePrice)).total;
}

/** What recovering 90% of the ethane earns a day over rejecting it, $. */
export function recoveryGain(gas: number, ethanePrice: number): number {
  return dayValue(DEEP, gas, ethanePrice) - dayValue(0, gas, ethanePrice);
}

/** The lowest ethane price, in whole cents, at which recovering 90% of the ethane earns more than rejecting it. */
export function lowestPayingCent(gas: number): number {
  for (let c = 1; c <= 200; c++) if (recoveryGain(gas, c / 100) > 0) return c;
  return Infinity;
}

/** The second challenge: at the challenge's gas price, the ethane price set to that lowest paying cent. */
export function breakevenSolved(s: ValueState): boolean {
  return Math.abs(s.gas - CHALLENGE_GAS) < 1e-9 && Math.round(s.ethanePrice * 100) === lowestPayingCent(CHALLENGE_GAS);
}

// Numbers the prose quotes.
const RAW = gasProperties(RIDGEBACK_RAW);
const FULL = processGas(RIDGEBACK_RAW, INLET, RAW_WATER, { ...STANDARD, ethane: DEEP });
const REJECT = processGas(RIDGEBACK_RAW, INLET, RAW_WATER, { ...STANDARD, ethane: 0 });
const REJECT_ALL_CO2 = processGas(RIDGEBACK_RAW, INLET, RAW_WATER, { ...STANDARD, co2Removal: 1, ethane: 0 });
const V_FULL = plantValue(FULL, NGL_PRICES);
const V_REJECT = plantValue(REJECT, NGL_PRICES);
const BREAKEVEN = ethaneBreakeven(RIDGEBACK_RAW, NGL_PRICES);
const ANSWER_CENT = lowestPayingCent(CHALLENGE_GAS);
const AS_GAS = {
  ethane: mmbtuPerGallon('ethane') * NGL_PRICES.gas,
  propane: mmbtuPerGallon('propane') * NGL_PRICES.gas,
  butane: mmbtuPerGallon('butane') * NGL_PRICES.gas,
};
/** Least propane recovery (whole percent), with all the butane out and the ethane left in, that meets the rules. */
const MIN_PROPANE = (() => {
  for (let p = 0; p <= 99; p++) if (ethaneLeftSolved({ co2: 0, dehydrate: true, ethane: 0, propane: p, butane: 100 })) return p;
  return NaN;
})();
/** Least ethane recovery that meets the rules on its own, with nothing else taken out. */
const MIN_ETHANE_ALONE = (() => {
  for (let e = 0; e <= 95; e++) if (runPlant({ co2: 0, dehydrate: true, ethane: e, propane: 0, butane: 0 }).ok) return e;
  return NaN;
})();
const SAND = gasProperties(SANDHILL_RAW);
const SAND_NO_CO2_COMP = composition({ ...SANDHILL_RAW, co2: 0 });
const SAND_NO_CO2 = gasProperties(SAND_NO_CO2_COMP);
const SAND_NO_CO2_CHECK = checkSpec(SAND_NO_CO2_COMP);
const WATER_REMOVED_LB = (RAW_WATER - DRY_WATER) * INLET;
/** How much the ethane breakeven rises for each $1/MMBtu on the gas price, $/gal. */
const BE_SLOPE = ethaneBreakeven(RIDGEBACK_RAW, { gas: NGL_PRICES.gas + 1, nglFee: NGL_PRICES.nglFee }) - BREAKEVEN;

// ---------------------------------------------------------------------------
// The flow sheet.

const SPECIES_COLOR: Record<Component, string> = {
  methane: '#7fb2dd',
  ethane: '#e9a15b',
  propane: '#d4734f',
  butane: '#a8403b',
  nitrogen: '#b9b9b9',
  co2: '#6f6f6f',
};

const MAIN_Y = 132;
/** Stream width for a gas flow, MMcf/d. */
const wOf = (q: number) => (q > 1e-6 ? 2 + (22 * q) / INLET : 0);
const GAS_COLOR = tint(GRAPHIC.gold, 0.55);

function Unit({ x, w, label, sub, on }: { x: number; w: number; label: string; sub: string; on: boolean }) {
  return (
    <g>
      <rect x={x} y={MAIN_Y - 34} width={w} height={68} rx={6} fill={on ? '#ecebe6' : '#f7f6f2'} stroke={on ? '#555' : '#b5b5b5'} strokeWidth={1.5} strokeDasharray={on ? undefined : '5 4'} />
      <text x={x + w / 2} y={MAIN_Y - 6} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: on ? '#333' : '#8a8a8a' }}>
        {label}
      </text>
      <text x={x + w / 2} y={MAIN_Y + 12} textAnchor="middle" className="ax">
        {on ? sub : 'off'}
      </text>
    </g>
  );
}

function Strip({ y, label, c }: { y: number; label: string; c: Composition }) {
  const x0 = 120;
  const x1 = 620;
  let x = x0;
  return (
    <g>
      <text x={x0 - 8} y={y + 11} textAnchor="end" className="ax">
        {label}
      </text>
      {COMPONENTS.map((k) => {
        const w = (x1 - x0) * c[k];
        const r = <rect key={k} x={x} y={y} width={Math.max(0, w)} height={14} fill={SPECIES_COLOR[k]} />;
        x += w;
        return r;
      })}
    </g>
  );
}

function FlowSheet({ s, r }: { s: PlantState; r: PlantResult }) {
  const afterAmine = INLET - r.co2Removed;
  const nglGas = INLET * (RIDGEBACK_RAW.ethane * (s.ethane / 100) + RIDGEBACK_RAW.propane * (s.propane / 100) + RIDGEBACK_RAW.butane * (s.butane / 100));
  const cryoOn = s.ethane + s.propane + s.butane > 0;
  const dots = { animationDuration: '0.9s' };
  const outTone = r.ok ? TEXT.green : TEXT.red;
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 318"
      role="img"
      aria-label={`A processing plant taking in ${fmt(INLET)} MMcf/d of raw Ridgeback gas. It removes ${fmt(r.co2Removed, 1)} MMcf/d of CO2, ${s.dehydrate ? 'dries the gas' : 'leaves the water in'}, recovers ${fmt(r.nglBarrels)} barrels a day of liquids and burns ${fmt(r.fuelMMcfd, 1)} MMcf/d as fuel, sending ${fmt(r.residueMMcfd)} MMcf/d of ${fmt(r.hhv)} Btu/scf gas to Ridgeback Express, which ${r.ok ? 'meets' : 'fails'} the pipeline’s rules.`}
    >
      {/* Main stream. */}
      <path d={`M16 ${MAIN_Y} L100 ${MAIN_Y}`} stroke={GAS_COLOR} strokeWidth={wOf(INLET)} fill="none" />
      <path d={`M190 ${MAIN_Y} L234 ${MAIN_Y}`} stroke={GAS_COLOR} strokeWidth={wOf(afterAmine)} fill="none" />
      <path d={`M324 ${MAIN_Y} L368 ${MAIN_Y}`} stroke={GAS_COLOR} strokeWidth={wOf(afterAmine)} fill="none" />
      <path d={`M472 ${MAIN_Y} L624 ${MAIN_Y}`} stroke={GAS_COLOR} strokeWidth={wOf(r.residueMMcfd)} fill="none" />
      <path d={`M16 ${MAIN_Y} L100 ${MAIN_Y}`} className="flow-dots" stroke="#fff" strokeWidth={4} style={dots} />
      <path d={`M472 ${MAIN_Y} L624 ${MAIN_Y}`} className="flow-dots" stroke="#fff" strokeWidth={4} style={dots} />
      <text x={16} y={MAIN_Y - 22} className="ax">
        raw gas
      </text>
      <text x={16} y={MAIN_Y + 30} style={{ fontSize: 13, fontWeight: 500, fill: TEXT.orange }}>
        {fmt(INLET)} MMcf/d
      </text>
      <text x={16} y={MAIN_Y + 46} style={{ fontSize: 12, fill: TEXT.gold }}>
        {fmt(RAW.hhv)} Btu/scf
      </text>

      {/* Side streams. */}
      {r.co2Removed > 0 && (
        <g>
          <path d={`M145 ${MAIN_Y - 34} L145 44`} stroke="#9a9a9a" strokeWidth={Math.max(1.5, wOf(r.co2Removed))} fill="none" />
          <text x={152} y={40} className="ax">
            CO₂ out · {fmt(r.co2Removed, 1)} MMcf/d
          </text>
        </g>
      )}
      {s.dehydrate && (
        <g>
          <path d={`M279 ${MAIN_Y + 34} L279 214`} stroke={GRAPHIC.blue} strokeWidth={2} fill="none" />
          <text x={286} y={212} className="ax">
            water · {fmt(WATER_REMOVED_LB)} lb/day
          </text>
        </g>
      )}
      {cryoOn && (
        <g>
          <path d={`M420 ${MAIN_Y + 34} L420 214`} stroke={GRAPHIC.orange} strokeWidth={Math.max(2, wOf(nglGas))} fill="none" />
          <text x={428} y={200} style={{ fontSize: 12, fontWeight: 500, fill: TEXT.orange }}>
            NGLs · {fmt(r.nglBarrels)} bbl/d
          </text>
          <text x={428} y={214} className="ax">
            to a fractionator
          </text>
        </g>
      )}
      <path d={`M500 ${MAIN_Y - 10} L500 58`} stroke={GRAPHIC.red} strokeWidth={Math.max(1.5, wOf(r.fuelMMcfd))} fill="none" />
      <text x={507} y={54} style={{ fontSize: 12, fill: TEXT.red }}>
        plant fuel · {fmt(r.fuelMMcfd, 1)} MMcf/d
      </text>

      <Unit x={100} w={90} label="Amine unit" sub={`${pct(s.co2 / 100)} of CO₂`} on={s.co2 > 0} />
      <Unit x={234} w={90} label="Dehydrator" sub="glycol" on={s.dehydrate} />
      <Unit x={368} w={104} label="Cryogenic plant" sub={cryoOn ? 'NGLs out' : ''} on={cryoOn} />

      <text x={624} y={MAIN_Y - 40} textAnchor="end" className="ax">
        to Ridgeback Express
      </text>
      <text x={624} y={MAIN_Y - 22} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: TEXT.orange }}>
        {fmt(r.residueMMcfd)} MMcf/d
      </text>
      <text x={624} y={MAIN_Y + 30} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: outTone }}>
        {r.ok ? '✓ pipeline quality' : '✗ off spec'}
      </text>
      <text x={624} y={MAIN_Y + 46} textAnchor="end" style={{ fontSize: 12, fill: TEXT.gold }}>
        {fmt(r.hhv)} Btu/scf
      </text>
      <Strip y={258} label="raw gas" c={RIDGEBACK_RAW} />
      <Strip y={284} label="residue gas" c={r.residue} />
    </svg>
  );
}

const RULE_NAME = { hhv: 'Heating value', wobbe: 'Wobbe index', co2: 'Carbon dioxide', inerts: 'Inerts (N₂ + CO₂)', water: 'Water' } as const;
const RULE_IN_TEXT = { hhv: 'heating value', wobbe: 'Wobbe index', co2: 'carbon dioxide', inerts: 'inert gases', water: 'water' } as const;
type Rule = PlantResult['checks'][number];

function ruleValue(r: Rule): string {
  if (r.id === 'hhv' || r.id === 'wobbe') return fmt(r.value);
  if (r.id === 'water') return `${fmt(r.value)} lb/MMscf`;
  return pct(r.value, 1);
}

function ruleLimit(r: Rule): string {
  if (r.min !== undefined) return `${fmt(r.min)}–${fmt(r.max)} Btu/scf`;
  if (r.id === 'water') return `at most ${fmt(r.max)} lb/MMscf`;
  return `at most ${pct(r.max)}`;
}

// ---------------------------------------------------------------------------

const RECOVERIES = Array.from({ length: 20 }, (_, i) => i * 5);

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
/** "$40k", "−$40k", "$0". */
const k$ = (v: number) => (Math.abs(v) < 0.5 ? '$0' : `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`);
const signedUsd = (v: number) => `${v >= 0.5 ? '+' : v <= -0.5 ? '−' : ''}${usd(Math.abs(v))}`;

export default function Lesson() {
  const p = useScenario('plant', PLANT_DEFAULTS);
  const s = p.state;
  const r = runPlant(s);
  const failing = r.checks.filter((c) => !c.ok).map((c) => RULE_IN_TEXT[c.id]);
  const solvedA = ethaneLeftSolved(s);

  const v = useScenario('ethane', VALUE_DEFAULTS);
  const vs = v.state;
  // Each recovery level's value a day, relative to rejecting the ethane.
  const sweep = useMemo(() => {
    const base = dayValue(0, vs.gas, vs.ethanePrice);
    return RECOVERIES.map((e) => dayValue(e / 100, vs.gas, vs.ethanePrice) - base);
  }, [vs.gas, vs.ethanePrice]);
  const cur = processGas(RIDGEBACK_RAW, INLET, RAW_WATER, { ...STANDARD, ethane: vs.recovery / 100 });
  const curValue = plantValue(cur, pricesOf(vs.gas, vs.ethanePrice));
  const gain = recoveryGain(vs.gas, vs.ethanePrice);
  const be = ethaneBreakeven(RIDGEBACK_RAW, { gas: vs.gas, nglFee: NGL_PRICES.nglFee });
  const [y0, y1] = niceDomain(Math.min(-10000, ...sweep), Math.max(10000, ...sweep), 4);
  const curGain = curValue.total - dayValue(0, vs.gas, vs.ethanePrice);
  const solvedB = breakevenSolved(vs);
  const cents = Math.round(vs.ethanePrice * 100);

  return (
    <LessonPage id="gas/2.5">
      <P>
        <a href={lessonHref('gas/2.4')}>The previous lesson</a> kept a Ridgeback field producing about 400 MMcf/d by drilling, year after year. That gas can’t go
        straight into a pipeline. Back in <a href={lessonHref('gas/1.1')}>Lesson 1.1</a>, raw Ridgeback gas failed the pipeline’s quality rule: at{' '}
        {fmt(RAW.hhv)} Btu per standard cubic foot it carries too much heat for the burners at the far end, because it’s rich in ethane, propane and butane. It
        also comes out of the ground saturated with water, and it carries some carbon dioxide. Before any of it can enter Ridgeback Express, it goes through a{' '}
        <b>processing plant</b>.
      </P>
      <P>
        A plant like Ridgeback’s does three jobs in turn. An <b>amine unit</b> washes the gas with a solution that absorbs carbon dioxide (and hydrogen sulfide,
        where there is any). A <b>dehydrator</b> passes it through a glycol that soaks up water vapor. Then a <b>cryogenic plant</b> expands the gas through a
        turbine until it’s colder than −100 °F, cold enough for ethane, propane and butane to condense into <b>natural gas liquids</b>, or NGLs, while methane stays
        a gas. What leaves for the pipeline is <b>residue gas</b>, mostly methane. Running all this takes energy, and the plant burns some of its own gas whatever it
        does — about {pct(FUEL_BASE)} of the inlet’s heat, mostly to drive compressors — and more when it recovers ethane deeply.
      </P>
      <P>
        In the next demonstration, {fmt(INLET)} MMcf/d of raw Ridgeback gas arrives at a plant with every unit switched off. The width of each stream shows its
        volume, and the two strips at the bottom show what the gas is made of before and after. Switch the units on and set how much of each component they take
        out:
      </P>

      <Figure name="Gas Processing Plant" scenario={p}>
        <FlowSheet s={s} r={r} />
        <Legend items={COMPONENTS.map((k) => ({ label: COMPONENT[k].name, color: SPECIES_COLOR[k] }))} />
        <Readouts
          items={[
            { label: 'residue gas to the pipeline', value: `${fmt(r.residueMMcfd)} MMcf/d`, tone: 'orange' },
            { label: 'its heating value', value: `${fmt(r.hhv)} Btu/scf`, tone: 'gold' },
            { label: 'shrink', value: pct(r.shrink, 1) },
            { label: 'natural gas liquids', value: `${fmt(r.nglBarrels)} bbl/d`, tone: 'orange' },
          ]}
        />
        <Slider label="CO₂ removed" value={s.co2} min={0} max={100} step={5} onChange={(x) => p.set({ co2: x })} display={`${s.co2}%`} />
        <Checkbox label="Run the dehydrator" checked={s.dehydrate} onChange={(x) => p.set({ dehydrate: x })} />
        <Slider label="Ethane recovered" tone="orange" value={s.ethane} min={0} max={95} onChange={(x) => p.set({ ethane: x })} display={`${s.ethane}%`} />
        <Slider label="Propane recovered" tone="orange" value={s.propane} min={0} max={99} onChange={(x) => p.set({ propane: x })} display={`${s.propane}%`} />
        <Slider label="Butane recovered" tone="orange" value={s.butane} min={0} max={100} onChange={(x) => p.set({ butane: x })} display={`${s.butane}%`} />
        <DataTable
          caption="The pipeline's rules and how the residue gas measures up"
          rows={r.checks}
          rowKey={(c) => c.id}
          columns={[
            { label: 'Pipeline rule', cell: (c) => RULE_NAME[c.id] },
            { label: 'Limit', cell: (c) => ruleLimit(c), align: 'right' },
            { label: 'Residue gas', cell: (c) => ruleValue(c), align: 'right' },
            {
              label: <span className="sr-only">Result</span>,
              cell: (c) => <span style={{ color: c.ok ? TEXT.green : TEXT.red, fontWeight: 500 }}>{c.ok ? '✓ meets' : '✗ fails'}</span>,
              align: 'right',
            },
          ]}
        />
        <Caption>
          {r.ok
            ? `Ridgeback Express will take this gas: ${fmt(r.residueMMcfd)} MMcf/d at ${fmt(r.hhv)} Btu/scf.`
            : `Ridgeback Express would turn this gas away: it fails on ${listOf(failing)}.`}
        </Caption>
      </Figure>

      <P>
        With everything off, the gas fails on three counts: its heating value, its Wobbe index of {fmt(RAW.wobbe)} — just over the 1,400 limit — and its water. The
        water is the easiest to fix and the most dangerous to leave. Raw gas carries about {fmt(RAW_WATER)} pounds of water vapor per million cubic feet; as it cools
        and its pressure changes along a pipeline, that water condenses, and in cold, high-pressure gas it can freeze together with the gas into <b>hydrates</b>,
        ice-like solids that block pipes and valves. Mixed with carbon dioxide, it also makes an acid that corrodes steel. The dehydrator takes the gas down to{' '}
        {fmt(DRY_WATER)} pounds, under the pipeline’s limit of {fmt(WATER_SPEC)} — about {fmt(WATER_REMOVED_LB)} pounds of water a day from this plant.
      </P>
      <P>
        Now take out most of the liquids: {pct(DEEP)} of the ethane, {pct(STANDARD.propane)} of the propane and {pct(STANDARD.butane)} of the butane, with
        four-fifths of the carbon dioxide too. The residue gas is {fmt(FULL.hhv)} Btu per cubic foot, comfortably inside the rule, and the plant sends {fmt(FULL.nglBarrels)} barrels of liquids a day to
        a fractionator, which splits them into separate products. But the gas has shrunk: only {fmt(FULL.residueMMcfd)} of the {fmt(INLET)} MMcf/d leaves for the
        pipeline, {pct(FULL.shrink, 1)} less. The liquids took the heaviest molecules, and the fuel took {fmt(FULL.fuelMMcfd, 1)} MMcf/d more.
      </P>

      <Challenge
        id="a"
        question="Make gas that Ridgeback Express will accept while leaving every molecule of ethane in it."
        solved={solvedA}
        status={
          s.ethane > 0
            ? `The cryogenic plant is recovering ${s.ethane}% of the ethane. Set ethane recovery to 0 and work with the other units.`
            : r.ok
              ? 'The gas meets every rule.'
              : `With the ethane left in, the gas fails on ${listOf(failing)}.`
        }
        success={`Solved. The ethane can stay because propane and butane carry far more heat per cubic foot: with all the butane out, taking ${MIN_PROPANE}% of the propane or more brings the gas under the 1,100 cap. Ethane alone would have to go almost entirely — ${MIN_ETHANE_ALONE}% of it — to do the same job. Leaving the ethane in the gas has a name, ethane rejection, and whether it pays is the subject of the next section.`}
      />

      <H2>Ethane: liquid or gas?</H2>
      <P>
        Every molecule the cryogenic plant takes out in <FigRef to="Gas Processing Plant">the first demonstration</FigRef> stops being sold as gas and starts
        being sold as a liquid, so each NGL has two prices: what it fetches as a liquid, and
        what its heat would fetch left in the gas. A gallon of propane holds {fmt(mmbtuPerGallon('propane'), 4)} MMBtu, worth {usd(AS_GAS.propane, 2)} as gas at a
        simulated <K c="price">gas price</K> of {usd(NGL_PRICES.gas, 2)} per MMBtu, but it sells for {usd(NGL_PRICES.propane, 2)} a gallon as a liquid, for heating
        and petrochemicals. Butane, much of which is blended into gasoline, does even better. Plants recover nearly all of both. Ethane is different: its main buyers are
        petrochemical plants that crack it into ethylene, and in our simulated market it sells for only {usd(NGL_PRICES.ethane, 2)} a gallon against{' '}
        {usd(AS_GAS.ethane, 2)} of heat. Recovering it also costs {usd(NGL_PRICES.nglFee, 2)} a gallon to ship and fractionate, plus the extra plant fuel.
      </P>
      <P>
        In the next demonstration, the plant runs its other units as an operator would — gas dried, four-fifths of the carbon dioxide and nearly all the propane and
        butane out. The chart shows what a day’s output, residue gas and liquids together, earns at each level of ethane recovery compared with leaving all
        the ethane in the gas. Set the prices and the recovery:
      </P>

      <Figure name="Gas Processing Plant · ethane" scenario={v}>
        <XYChart
          xDomain={[0, 95]}
          yDomain={[y0, y1]}
          xTicks={[0, 15, 30, 45, 60, 75, 90]}
          yTicks={niceTicks(y0, y1, 4)}
          xFormat={(x) => `${x}%`}
          yFormat={k$}
          yLabel="A day’s output, compared with rejecting the ethane"
          xLabel="ethane recovered"
          height={230}
          left={64}
          series={[{ xs: RECOVERIES, ys: sweep, color: GRAPHIC.green, width: 2.5 }]}
          hLines={[{ at: 0, color: '#777', dash: '5 4', label: 'rejecting the ethane' }]}
          markers={[{ x: vs.recovery, y: curGain, color: curGain < -0.5 ? GRAPHIC.red : GRAPHIC.green, r: 6, label: `${signedUsd(curGain)} a day`, labelPos: vs.recovery > 70 ? 'left' : curGain >= 0 ? 'below' : 'above' }]}
          ariaLabel={`What a day’s output earns at each level of ethane recovery compared with rejecting the ethane, with gas at ${usd(vs.gas, 2)} per MMBtu and ethane at ${usd(vs.ethanePrice, 2)} a gallon. Recovering 90% earns ${signedUsd(gain)} a day; at ${vs.recovery}% recovery, ${signedUsd(curGain)}.`}
        />
        <Readouts
          items={[
            { label: `a day’s output at ${vs.recovery}% ethane recovery`, value: money(curValue.total), tone: 'green' },
            { label: `recovering ${pct(DEEP)} instead of rejecting`, value: `${signedUsd(gain)} a day`, tone: gain >= 0 ? 'green' : 'red' },
            { label: 'ethane breakeven price', value: `${usd(be, 3)}/gal`, tone: 'green' },
          ]}
        />
        <Slider label="Ethane recovered" tone="orange" value={vs.recovery} min={0} max={95} step={5} onChange={(x) => v.set({ recovery: x })} display={`${vs.recovery}%`} />
        <Slider label="Gas price" tone="green" value={vs.gas} min={1.5} max={6} step={0.05} onChange={(x) => v.set({ gas: x })} display={`${usd(vs.gas, 2)}/MMBtu`} />
        <Slider label="Ethane price" tone="green" value={vs.ethanePrice} min={0.1} max={0.6} step={0.01} onChange={(x) => v.set({ ethanePrice: x })} display={`${usd(vs.ethanePrice, 2)}/gal`} />
        <Caption>
          {gain > 0
            ? `At these prices every gallon of ethane is worth more as a liquid: the plant should recover all it can.`
            : `At these prices ethane is worth more left in the gas: the plant should reject it.`}
        </Caption>
      </Figure>

      <P>
        At the starting prices the line slopes down. Rejecting the ethane earns {money(V_REJECT.total)} a day, recovering {pct(DEEP)} of it {money(V_FULL.total)}:{' '}
        {usd(Math.round((V_REJECT.total - V_FULL.total) / 100) * 100)} a day less. So the plant leaves its ethane in the gas, which then leaves at{' '}
        {fmt(REJECT.hhv)} Btu per cubic foot — so close to the cap that taking out the last of the carbon dioxide, which concentrates everything else, would push it to{' '}
        {fmt(REJECT_ALL_CO2.hhv, 1)} and off spec. Raise the ethane price and the line tips over. The <K c="price">breakeven</K> is{' '}
        {usd(BREAKEVEN, 3)} a gallon: the ethane’s heat at the gas price, plus the fee, plus the extra fuel.
      </P>

      <Challenge
        id="b"
        question={`With gas at ${usd(CHALLENGE_GAS, 2)} per MMBtu, what’s the lowest ethane price, to the cent, at which recovering ${pct(DEEP)} of the ethane earns more than rejecting it?`}
        solved={solvedB}
        status={
          Math.abs(vs.gas - CHALLENGE_GAS) > 1e-9
            ? `Set the gas price back to ${usd(CHALLENGE_GAS, 2)} first.`
            : gain > 0
              ? `At ${cents}¢ a gallon, recovering earns ${usd(gain)} a day more. Is there a lower price at which it still pays?`
              : `At ${cents}¢ a gallon, recovering earns ${usd(-gain)} a day less than rejecting.`
        }
        success={`Solved: ${ANSWER_CENT}¢. At ${ANSWER_CENT - 1}¢ rejecting still wins, and at ${ANSWER_CENT}¢ recovering earns ${usd(recoveryGain(CHALLENGE_GAS, ANSWER_CENT / 100))} a day more. The breakeven moves with the gas price, by about ${fmt(BE_SLOPE * 100, 1)}¢ a gallon for every dollar per MMBtu, because every gallon of ethane recovered is ${fmt(mmbtuPerGallon('ethane'), 4)} MMBtu of heat not sold as gas, and the extra fuel it takes is gas too. When gas is dear, ethane stays in the gas; when gas is cheap or ethane is dear, the plants pull it out.`}
      />

      <P>
        Plants across North America make that calculation continually, and a plant can swing between ethane recovery and rejection as prices move — which
        means the heat content, and the volume, of the gas a rich basin sends down its pipelines moves with the price of a petrochemical feedstock. For a producer, the
        liquids are often what makes rich gas worth drilling: at the starting prices, this plant’s propane and butane alone bring in{' '}
        {money(V_REJECT.propane + V_REJECT.butane)} a day.
      </P>

      <H2>The other field</H2>
      <P>
        Sandhill’s raw gas has the opposite problem. It’s lean, at {fmt(SAND.hhv)} Btu per cubic foot, and it fails all four of the pipeline’s gas rules:{' '}
        {pct(SANDHILL_RAW.co2, 1)} of it is carbon dioxide and {pct(SANDHILL_RAW.nitrogen, 1)} nitrogen. An amine unit that removed all the carbon dioxide would lift
        its heating value to {fmt(SAND_NO_CO2.hhv)} Btu, inside the rule, but its Wobbe index would still be {fmt(SAND_NO_CO2.wobbe)}, under the 1,310 floor, and its
        nitrogen alone would make {pct(SAND_NO_CO2_COMP.nitrogen, 2)} of the gas — {SAND_NO_CO2_CHECK.ok ? 'within' : 'more than'} the {pct(PIPELINE_SPEC.inertMax)} the rule allows for
        inert gases. Gas like that needs some of its nitrogen taken out as well, or blending with richer gas before it reaches the pipeline. Processing works in
        both directions: it’s whatever turns the gas a particular rock produces into the gas a pipeline will carry.
      </P>

      <H2>What limits production</H2>
      <P>
        This chapter asked where gas comes from and what constrains how much of it there is. It starts in rock, and the rock sets the first limits: porosity and
        pressure decide how much gas a square mile holds, and permeability decides how fast it can flow (<a href={lessonHref('gas/2.1')}>Lesson 2.1</a>). A well
        drains its patch of rock and its pressure falls as it does, so every well’s output declines (<a href={lessonHref('gas/2.2')}>Lesson 2.2</a>) — slowly in
        permeable sandstone, steeply in shale (<a href={lessonHref('gas/2.3')}>Lesson 2.3</a>). Holding a shale field’s output steady therefore takes a constant
        stream of capital for new wells (<a href={lessonHref('gas/2.4')}>Lesson 2.4</a>). And the gas still has to be made fit to ship, by plants with capacities of
        their own and economics tied to other markets.
      </P>
      <P>
        All of that happens at the basins, on the region’s western edge. The people who burn the gas are hundreds of miles away: heating homes in Metro, running
        power plants, feeding Bayport’s factories and its LNG terminal. In <a href={lessonHref('gas/3.1')}>Chapter 3</a> we follow the residue gas into the
        pipelines and storage fields that connect them — and find out why gas can be scarce in one place while it’s abundant in another.
      </P>
    </LessonPage>
  );
}
