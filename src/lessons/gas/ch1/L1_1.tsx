import { Fragment } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
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
  fmt,
  lessonHref,
  pct,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import {
  COMPONENT,
  COMPONENTS,
  METHANE,
  PIPELINE_GAS,
  checkSpec,
  combustionProducts,
  composition,
  gasProperties,
  type Component,
  type Composition,
} from '../../../engines/gas/properties';

// ---------------------------------------------------------------------------
// The mixture: every constituent but methane is a slider, in mole percent; methane is the rest.

type Mix = { ethane: number; propane: number; butane: number; nitrogen: number; co2: number };
type Slid = keyof Mix;

const SLIDERS: Array<{ key: Slid; max: number }> = [
  { key: 'ethane', max: 20 },
  { key: 'propane', max: 8 },
  { key: 'butane', max: 4 },
  { key: 'nitrogen', max: 8 },
  { key: 'co2', max: 8 },
];

const pctOf = (c: Composition, k: Component) => Math.round(c[k] * 1000) / 10;

/** The four starting gases, in mole percent. */
export const PRESETS: Record<'methane' | 'pipeline' | 'ridgeback' | 'sandhill', Mix> = {
  methane: { ethane: 0, propane: 0, butane: 0, nitrogen: 0, co2: 0 },
  pipeline: { ethane: pctOf(PIPELINE_GAS, 'ethane'), propane: pctOf(PIPELINE_GAS, 'propane'), butane: pctOf(PIPELINE_GAS, 'butane'), nitrogen: pctOf(PIPELINE_GAS, 'nitrogen'), co2: pctOf(PIPELINE_GAS, 'co2') },
  ridgeback: { ethane: 12, propane: 4, butane: 1.5, nitrogen: 1, co2: 1.5 },
  sandhill: { ethane: 2, propane: 0.5, butane: 0, nitrogen: 4, co2: 3.5 },
};
type PresetId = keyof typeof PRESETS;

const PRESET_LABEL: Record<PresetId, string> = { methane: 'Pure methane', pipeline: 'Pipeline gas', ridgeback: 'Raw Ridgeback gas', sandhill: 'Raw Sandhill gas' };

export const MIX_DEFAULTS: Mix = PRESETS.pipeline;

/** The composition the sliders describe: methane is whatever the others leave. */
export function mixComposition(m: Mix): Composition {
  const others = m.ethane + m.propane + m.butane + m.nitrogen + m.co2;
  return composition({ methane: Math.max(0, 100 - others), ...m });
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function presetOf(m: Mix): PresetId | 'custom' {
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const p = PRESETS[id];
    if ((Object.keys(p) as Slid[]).every((k) => Math.abs(p[k] - m[k]) < 1e-9)) return id;
  }
  return 'custom';
}

/**
 * The challenge: raw Ridgeback gas with only the ethane changed, keeping as much ethane as the
 * pipeline's rules allow — the gas meets the spec, and 0.1 point more ethane would not.
 */
export function ethaneSolved(m: Mix): boolean {
  const r = PRESETS.ridgeback;
  const sameOthers = (['propane', 'butane', 'nitrogen', 'co2'] as Slid[]).every((k) => Math.abs(m[k] - r[k]) < 1e-9);
  if (!sameOthers) return false;
  const more = { ...m, ethane: round1(m.ethane + 0.1) };
  return checkSpec(mixComposition(m)).ok && !checkSpec(mixComposition(more)).ok;
}

// ---------------------------------------------------------------------------
// The molecule box: 100 molecules on a jittered grid, one per percent of the gas.

const SPECIES_COLOR: Record<Component, string> = {
  methane: '#7fb2dd',
  ethane: '#e9a15b',
  propane: '#d4734f',
  butane: '#a8403b',
  nitrogen: '#b9b9b9',
  co2: '#6f6f6f',
};

/** Deterministic pseudo-random numbers in [0, 1) from an integer. */
function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const COLS = 20;
const ROWS = 5;
const CELLS = Array.from({ length: COLS * ROWS }, (_, i) => ({
  x: 18 + (i % COLS) * 29.5 + (hash(i) - 0.5) * 9,
  y: 26 + Math.floor(i / COLS) * 36 + (hash(i + 500) - 0.5) * 10,
  angle: hash(i + 1000) * 180,
}));
/** The order in which cells are filled: shuffled once, so changing one gas moves only its own molecules. */
const ORDER = CELLS.map((_, i) => i).sort((a, b) => hash(a + 2000) - hash(b + 2000));
/** Rarer species fill first, so their molecules keep their places while methane takes up the rest. */
const FILL: Component[] = ['co2', 'nitrogen', 'butane', 'propane', 'ethane', 'methane'];

/** Whole-molecule counts out of 100 by largest remainder. */
function counts(c: Composition): Record<Component, number> {
  const raw = COMPONENTS.map((k) => ({ k, v: c[k] * 100 }));
  const out = Object.fromEntries(raw.map((r) => [r.k, Math.floor(r.v)])) as Record<Component, number>;
  let left = 100 - raw.reduce((s, r) => s + Math.floor(r.v), 0);
  for (const r of [...raw].sort((a, b) => b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)))) {
    if (left <= 0) break;
    out[r.k] += 1;
    left -= 1;
  }
  return out;
}

const ATOMS: Record<Component, number> = { methane: 1, ethane: 2, propane: 3, butane: 4, nitrogen: 2, co2: 3 };

function Molecule({ k, x, y, angle }: { k: Component; x: number; y: number; angle: number }) {
  const n = ATOMS[k];
  const r = n === 1 ? 6.2 : k === 'nitrogen' ? 4.6 : 5.2;
  const step = k === 'co2' ? 8.4 : k === 'nitrogen' ? 7 : 7.4;
  const atoms = Array.from({ length: n }, (_, i) => ({ dx: (i - (n - 1) / 2) * step, dy: k === 'co2' || k === 'nitrogen' || n === 1 ? 0 : i % 2 ? 2.8 : -2.8 }));
  const col = SPECIES_COLOR[k];
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(0)})`}>
      {n > 1 && <path d={'M' + atoms.map((a) => `${a.dx.toFixed(1)} ${a.dy.toFixed(1)}`).join(' L')} stroke={col} strokeWidth={2.6} fill="none" />}
      {atoms.map((a, i) => (
        <circle key={i} cx={a.dx} cy={a.dy} r={k === 'co2' && i !== 1 ? r * 0.85 : r} fill={k === 'co2' && i === 1 ? '#444' : col} stroke="#fcfcfb" strokeWidth={0.8} />
      ))}
    </g>
  );
}

function MoleculeBox({ c }: { c: Composition }) {
  const n = counts(c);
  const assigned: Array<Component> = [];
  for (const k of FILL) for (let i = 0; i < n[k]; i++) assigned.push(k);
  const label = `A sample of 100 molecules of the gas: ${COMPONENTS.filter((k) => n[k] > 0)
    .map((k) => `${n[k]} ${COMPONENT[k].name.toLowerCase()}`)
    .join(', ')}.`;
  return (
    <svg className="diagram" viewBox="0 0 600 196" role="img" aria-label={label}>
      <rect x={2} y={4} width={596} height={186} rx={6} fill="#f6f5f1" stroke="#dedbd2" />
      {ORDER.map((cell, i) => (assigned[i] ? <Molecule key={cell} k={assigned[i]} {...CELLS[cell]} /> : null))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The combustion chart: heat per cubic foot (net, plus the water's latent heat) and CO2 per MMBtu.

type Fuel = 'methane' | 'ethane' | 'propane' | 'butane' | 'mix';
const FUELS: Fuel[] = ['methane', 'ethane', 'propane', 'butane', 'mix'];
const REACTION: Record<Exclude<Fuel, 'mix'>, Array<[string, string]>> = {
  methane: [['', 'CH₄'], ['2', 'O₂'], ['', 'CO₂'], ['2', 'H₂O']],
  ethane: [['', 'C₂H₆'], ['3½', 'O₂'], ['2', 'CO₂'], ['3', 'H₂O']],
  propane: [['', 'C₃H₈'], ['5', 'O₂'], ['3', 'CO₂'], ['4', 'H₂O']],
  butane: [['', 'C₄H₁₀'], ['6½', 'O₂'], ['4', 'CO₂'], ['5', 'H₂O']],
};

const HX = scale(0, 3400, 112, 372);
const CX = scale(0, 70, 420, 604);

function CombustionChart({ rows, selected }: { rows: Array<{ id: Fuel; name: string; hhv: number; lhv: number; co2: number }>; selected: Fuel }) {
  const sel = rows.find((r) => r.id === selected)!;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 236"
      role="img"
      aria-label={`Heat per standard cubic foot and CO2 per MMBtu for methane, ethane, propane, butane and the mix from the first demonstration. ${sel.name}: ${fmt(sel.hhv)} Btu gross, ${fmt(sel.lhv)} net, ${fmt(sel.co2, 1)} kg of CO2 per MMBtu.`}
    >
      <text className="ax" x={112} y={14}>
        Heat per standard cubic foot, Btu
      </text>
      <text className="ax" x={420} y={14}>
        CO₂ per MMBtu of heat, kg
      </text>
      {[0, 1000, 2000, 3000].map((v) => (
        <g key={v}>
          <line className={v ? 'gl' : 'base'} x1={HX(v)} x2={HX(v)} y1={24} y2={206} />
          <text className="ax ax-m" x={HX(v)} y={222}>
            {fmt(v)}
          </text>
        </g>
      ))}
      {[0, 20, 40, 60].map((v) => (
        <g key={v}>
          <line className={v ? 'gl' : 'base'} x1={CX(v)} x2={CX(v)} y1={24} y2={206} />
          <text className="ax ax-m" x={CX(v)} y={222}>
            {v}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 30 + i * 36;
        const on = r.id === selected;
        return (
          <g key={r.id}>
            {on && <rect x={4} y={y - 4} width={632} height={30} rx={4} fill="#efede6" />}
            <text x={104} y={y + 16} textAnchor="end" style={{ fontSize: 13, fontWeight: on ? 600 : 400, fill: '#333' }}>
              {r.name}
            </text>
            <rect x={HX(0)} y={y + 4} width={HX(r.lhv) - HX(0)} height={16} fill={GRAPHIC.gold} />
            <rect x={HX(r.lhv)} y={y + 4} width={HX(r.hhv) - HX(r.lhv)} height={16} fill={tint(GRAPHIC.gold, 0.35)} />
            <text x={HX(r.hhv) + 5} y={y + 16} style={{ fontSize: 12, fill: TEXT.gold, fontWeight: on ? 600 : 400 }}>
              {fmt(r.hhv)}
            </text>
            <rect x={CX(0)} y={y + 4} width={CX(r.co2) - CX(0)} height={16} fill={on ? '#6f6f6f' : '#a9a9a9'} />
            <text x={CX(r.co2) + 5} y={y + 16} style={{ fontSize: 12, fill: '#333', fontWeight: on ? 600 : 400 }}>
              {fmt(r.co2, 1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

const RULE_NAME = { hhv: 'Heating value', wobbe: 'Wobbe index', co2: 'Carbon dioxide', inerts: 'Inerts (N₂ + CO₂)' } as const;
const RULE_IN_TEXT = { hhv: 'heating value', wobbe: 'Wobbe index', co2: 'carbon dioxide', inerts: 'inert gases' } as const;
const RIDGE = gasProperties(mixComposition(PRESETS.ridgeback));
const SAND_RAW = mixComposition(PRESETS.sandhill);
const SAND = gasProperties(SAND_RAW);
const PIPE = gasProperties(PIPELINE_GAS);
const METH = gasProperties(METHANE);
const PURE = { ethane: gasProperties(composition({ ethane: 1 })), propane: gasProperties(composition({ propane: 1 })), butane: gasProperties(composition({ butane: 1 })) };
const RIDGE_NO_LIQUIDS = gasProperties(mixComposition({ ...PRESETS.ridgeback, propane: 0, butane: 0 }));
const RIDGE_NO_ETHANE = gasProperties(mixComposition({ ...PRESETS.ridgeback, ethane: 0 }));
/** Btu/scf added by each percentage point of ethane in place of methane. */
const ETHANE_STEP = (COMPONENT.ethane.hhv - COMPONENT.methane.hhv) / 100;

export default function Lesson() {
  const s = useScenario('mix', MIX_DEFAULTS);
  const m = s.state;
  const c = mixComposition(m);
  const p = gasProperties(c);
  const spec = checkSpec(c);
  const preset = presetOf(m);
  const failing = spec.rules.filter((r) => !r.ok).map((r) => RULE_IN_TEXT[r.id]);

  const ruleValue = (id: keyof typeof RULE_NAME, v: number) => (id === 'hhv' || id === 'wobbe' ? fmt(v) : pct(v, 1));
  const ruleLimit = (r: (typeof spec.rules)[number]) =>
    r.min !== undefined ? `${fmt(r.min)}–${fmt(r.max)} Btu/scf` : `at most ${pct(r.max, 0)}`;

  const solved = ethaneSolved(m);
  const othersRidge = (['propane', 'butane', 'nitrogen', 'co2'] as Slid[]).every((k) => Math.abs(m[k] - PRESETS.ridgeback[k]) < 1e-9);
  const status = !othersRidge
    ? 'Choose “Raw Ridgeback gas” first, then move only the ethane slider.'
    : spec.ok
      ? `At ${fmt(m.ethane, 1)}% ethane the gas meets every rule, at ${fmt(p.hhv, 1)} Btu/scf. Could it keep more?`
      : `At ${fmt(m.ethane, 1)}% ethane the gas carries ${fmt(p.hhv, 1)} Btu/scf with a Wobbe index of ${fmt(p.wobbe)}; it fails on ${failing.join(' and ')}.`;

  const hydrocarbons = (['methane', 'ethane', 'propane', 'butane'] as Component[]).filter((k) => c[k] > 0);

  // Figure 2.
  const f = useScenario('combustion', { fuel: 'methane' as Fuel });
  const fuel = f.state.fuel;
  const rows = FUELS.map((id) => {
    const g = id === 'mix' ? p : id === 'methane' ? METH : PURE[id];
    return { id, name: id === 'mix' ? 'Your mix' : COMPONENT[id].name, hhv: g.hhv, lhv: g.lhv, co2: g.co2KgPerMMBtu };
  });
  const selComp = fuel === 'mix' ? c : composition({ [fuel]: 1 });
  const selProps = fuel === 'mix' ? p : rows.find((r) => r.id === fuel)!;
  const burn = combustionProducts(selComp);
  const selAir = fuel === 'mix' ? p.airPerVolume : gasProperties(selComp).airPerVolume;

  return (
    <LessonPage id="gas/1.1">
      <P>
        Natural gas is cheap in one place and dear in another, cheap in July and dear in January. Each of those differences has a physical cause: what the gas is made of,
        how far and how fast it can be pushed through a pipe, and where it can be kept until it’s wanted. This course follows gas through a fictional region — from the rock
        that holds it, through processing plants, pipelines and storage fields, to the hub where it’s priced and the desks that trade it — and traces every price
        difference back to one of those causes. We’ll start with the smallest piece of the system: the molecule.
      </P>
      <P>
        What comes out of a gas well is a mixture. Most of it is methane, the simplest hydrocarbon: one carbon atom holding four hydrogen atoms. Mixed in are heavier
        hydrocarbons — ethane, propane and butane, with two, three and four carbons — and gases that don’t burn at all, chiefly nitrogen and carbon dioxide. Nobody who buys
        gas wants the molecules themselves. They want the heat the gas gives off when it burns, so gas is bought and sold by its <K c="energy">energy</K>, and the first
        question is how much energy a cubic foot of it holds.
      </P>
      <P>
        A cubic foot of gas holds more gas the harder it’s squeezed, so the industry counts it in <b>standard cubic feet</b>: the amount that would fill a cubic foot at 60{'\u00a0'}°F
        and 14.73 pounds per square inch, a little above the air’s pressure at sea level. The heat one standard cubic foot gives off when it burns completely is its{' '}
        <K c="energy">heating value</K>, measured in British thermal units (Btu); one Btu warms a pound of water by one degree Fahrenheit. In the next demonstration, each of the
        100 molecules stands for one percent of a gas. Pick one of the starting gases, or set the share of each constituent yourself; methane makes up whatever the others
        leave:
      </P>

      <Figure name="Molecule Lab" scenario={s}>
        <Segmented
          label="Starting gas"
          value={preset}
          onChange={(id) => id !== 'custom' && s.set(PRESETS[id])}
          options={(Object.keys(PRESETS) as PresetId[]).map((id) => ({ value: id, label: PRESET_LABEL[id] }))}
        />
        <MoleculeBox c={c} />
        <Legend items={COMPONENTS.map((k) => ({ label: `${COMPONENT[k].name} ${fmt(c[k] * 100, 1)}%`, color: SPECIES_COLOR[k] }))} />
        <Eq label={`Heating value of the mixture: ${hydrocarbons.map((k) => `${fmt(c[k] * 100, 1)} percent times ${fmt(COMPONENT[k].hhv)}`).join(' plus ')} equals ${fmt(p.hhv)} Btu per standard cubic foot`}>
          <K c="energy">HHV</K>
          <Op>=</Op>
          {hydrocarbons.map((k, i) => (
            <Fragment key={k}>
              {i > 0 && <Op>+</Op>}
              <span>
                {fmt(c[k] * 100, 1)}% <Op>×</Op> {fmt(COMPONENT[k].hhv)}
              </span>
            </Fragment>
          ))}
          <Op>=</Op>
          <K c="energy">{fmt(p.hhv)} Btu/scf</K>
        </Eq>
        {SLIDERS.map(({ key, max }) => (
          <Slider
            key={key}
            label={COMPONENT[key].name}
            value={m[key]}
            min={0}
            max={max}
            step={0.1}
            onChange={(v) => s.set({ [key]: v } as Partial<Mix>)}
            display={`${fmt(m[key], 1)}%`}
          />
        ))}
        <DataTable
          caption="The pipeline's gas-quality rules and how this gas measures up"
          rows={spec.rules}
          rowKey={(r) => r.id}
          columns={[
            { label: 'Pipeline rule', cell: (r) => RULE_NAME[r.id] },
            { label: 'Limit', cell: (r) => ruleLimit(r), align: 'right' },
            { label: 'This gas', cell: (r) => ruleValue(r.id, r.value), align: 'right' },
            {
              label: <span className="sr-only">Result</span>,
              cell: (r) => <span style={{ color: r.ok ? TEXT.green : TEXT.red, fontWeight: 500 }}>{r.ok ? '✓ meets' : '✗ fails'}</span>,
              align: 'right',
            },
          ]}
        />
        <Caption>
          {`Specific gravity ${fmt(p.sg, 3)} (air = 1). `}
          {spec.ok
            ? `This gas meets every rule, so the region’s pipelines would accept it.`
            : `The pipelines would turn this gas away: it fails on ${failing.join(' and ')}.`}
        </Caption>
      </Figure>

      <P>
        Pure methane carries {fmt(METH.hhv)} Btu per standard cubic foot. Ethane carries {fmt(PURE.ethane.hhv)}, propane {fmt(PURE.propane.hhv)} and butane{' '}
        {fmt(PURE.butane.hhv)}. The reason is a law of gases: at the same temperature and pressure, equal volumes of any gas hold the same number of molecules. A cubic foot
        of propane has as many molecules as a cubic foot of methane, but each has three carbon atoms and eight hydrogens to burn instead of one and four. Weigh the gases
        instead of measuring their volume and the order reverses: a pound of methane gives off {fmt(METH.btuPerLb)} Btu and a pound of propane {fmt(PURE.propane.btuPerLb)},
        because propane’s molecules are heavier for the energy they carry.
      </P>
      <P>
        A mixture’s heating value is the average of its constituents’ heating values, weighted by their shares, and nitrogen and carbon dioxide count as zero. The region’s
        pipeline gas is 95% methane with a little ethane, propane and butane, and it carries {fmt(PIPE.hhv)} Btu per standard cubic foot. We’ll meet that number again
        and again: it’s how the rest of the course turns cubic feet into energy.
      </P>

      <H2>What a pipeline will accept</H2>
      <P>
        Neither of the region’s fields produces gas like that. Raw gas from the Ridgeback shale is rich in the heavier hydrocarbons, at {fmt(RIDGE.hhv)} Btu per cubic foot.
        Raw gas from the old Sandhill field is lean, at {fmt(SAND.hhv)}, and {pct(SAND_RAW.nitrogen + SAND_RAW.co2, 1)} of it is nitrogen and carbon dioxide. The pipelines
        won’t take either. Every pipeline publishes a quality rule for the gas it carries, and the table in{' '}
        <FigRef to="Molecule Lab">the first demonstration</FigRef> shows ours, which is in the usual North American range.
      </P>
      <P>
        Why cap the heating value at all, when richer gas carries more energy? Because of what happens at the far end. A stove, a furnace or a power plant’s turbine feeds
        gas through a fixed opening at a fixed pressure, and how much gas squeezes through depends on how heavy it is: the volume that passes is inversely proportional to the square root
        of its specific gravity, its density relative to air. The heat a burner delivers is therefore the heating value divided by that square root. This
        quantity is the <K c="energy">Wobbe index</K> — for methane, {fmt(METH.hhv)} ÷ √{fmt(METH.sg, 3)} = {fmt(METH.wobbe)} — and two gases with the same Wobbe index give the
        same heat through the same burner. Gas with too high an index can overheat a burner and burn incompletely, making carbon monoxide; with too low an index, flames can
        lift off the burner and go out. Equipment is tuned for a narrow band, so pipelines hold the gas to it. The inert gases are limited for a simpler reason: they take
        up room in the pipe and earn nothing, and carbon dioxide mixed with water corrodes steel.
      </P>

      <Challenge
        id="a"
        figure="Molecule Lab"
        question="Choose raw Ridgeback gas, then move only the ethane slider. How much of its ethane can stay in the gas if it has to meet every one of the pipeline’s rules?"
        solved={solved}
        status={status}
        success={
          <>
            Solved: {fmt(m.ethane, 1)}% ethane, and not a tenth of a point more. The propane and butane alone lift the gas to {fmt(RIDGE_NO_ETHANE.hhv, 1)} Btu/scf with no
            ethane at all, and each percentage point of ethane in place of methane adds {fmt(ETHANE_STEP, 1)} more, so the heating-value cap arrives first. Throwing away ten
            points of ethane to keep the propane and butane would be backward, though: those are usually worth more sold as liquids than burned as gas. Take them out
            instead and all 12% of the ethane fits, at {fmt(RIDGE_NO_LIQUIDS.hhv)} Btu/scf. That’s the job of a processing plant, in{' '}
            <a href={lessonHref('gas/2.5')}>Lesson 2.5</a>.
          </>
        }
      />

      <H2>Burning it</H2>
      <P>
        When methane burns, each molecule takes two molecules of oxygen from the air and becomes one molecule of carbon dioxide and two of water. Air is about 21% oxygen, so
        every cubic foot of methane needs about {fmt(METH.airPerVolume, 2)} cubic feet of air. Heavier hydrocarbons need more, and every carbon atom in the fuel leaves as a
        molecule of carbon dioxide. In the next demonstration, choose a fuel — one of the pure hydrocarbons, or the mix you last set in{' '}
        <FigRef to="Molecule Lab">the first demonstration</FigRef> — to see its reaction, its heat and its carbon dioxide:
      </P>

      <Figure name="Molecule Lab · combustion" scenario={f}>
        <Segmented
          label="Fuel"
          value={fuel}
          onChange={(v) => f.set({ fuel: v })}
          options={FUELS.map((id) => ({ value: id, label: id === 'mix' ? 'Your mix' : COMPONENT[id].name }))}
        />
        {fuel === 'mix' ? (
          <Eq label={`One cubic foot of the mix burns with ${fmt(burn.o2, 2)} cubic feet of oxygen into ${fmt(burn.co2, 2)} cubic feet of carbon dioxide and ${fmt(burn.water, 2)} of water vapor`}>
            <span>1 ft³ gas</span>
            <Op>+</Op>
            <span>{fmt(burn.o2, 2)} ft³ O₂</span>
            <Op>→</Op>
            <span>{fmt(burn.co2, 2)} ft³ CO₂</span>
            <Op>+</Op>
            <span>{fmt(burn.water, 2)} ft³ H₂O</span>
          </Eq>
        ) : (
          <Eq label={`Combustion of ${COMPONENT[fuel].name.toLowerCase()}`}>
            {REACTION[fuel].map(([n, sp], i) => (
              <Fragment key={i}>
                {i === 1 || i === 3 ? <Op>+</Op> : i === 2 ? <Op>→</Op> : null}
                <span>
                  {n && <span style={{ marginRight: 4 }}>{n}</span>}
                  {sp}
                </span>
              </Fragment>
            ))}
          </Eq>
        )}
        <CombustionChart rows={rows} selected={fuel} />
        <Legend
          items={[
            { label: 'Net heat (water leaves as vapor)', color: GRAPHIC.gold },
            { label: 'Heat from condensing the water', color: tint(GRAPHIC.gold, 0.35) },
            { label: 'CO₂ per MMBtu', color: '#6f6f6f' },
          ]}
        />
        <Readouts
          items={[
            { label: 'gross heating value, Btu per scf', value: fmt(selProps.hhv), tone: 'gold' },
            { label: 'net heating value, Btu per scf', value: fmt(selProps.lhv), tone: 'gold' },
            { label: 'air needed per cubic foot', value: `${fmt(selAir, 2)} ft³` },
            { label: 'CO₂ per MMBtu', value: `${fmt(fuel === 'mix' ? p.co2KgPerMMBtu : rows.find((r) => r.id === fuel)!.co2, 1)} kg` },
          ]}
        />
      </Figure>

      <P>
        Each bar of heat has two parts. Burning makes water, and the water leaves the flame as vapor. If the exhaust is cooled enough for that vapor to condense, it gives up
        its latent heat as well; the <b>gross</b> or higher heating value counts that heat and the <b>net</b> or lower heating value doesn’t. For methane the net value is{' '}
        {fmt(METH.lhv)} Btu, {pct(METH.lhv / METH.hhv)} of the gross. Most burners send the vapor up the flue, though condensing furnaces and boilers recover some of it.
        Gas in North America is bought and sold on its gross heating value, and every heating value and every MMBtu in this course is gross.
      </P>
      <P>
        The carbon dioxide tells a story of its own. Methane has more hydrogen for each carbon atom than any other hydrocarbon, and much of its heat comes from burning that
        hydrogen to water, so it releases {fmt(METH.co2KgPerMMBtu, 1)} kilograms of carbon dioxide for each MMBtu — a million Btu — of heat, against{' '}
        {fmt(PURE.butane.co2KgPerMMBtu, 1)} for butane. The region’s pipeline gas releases {fmt(PIPE.co2KgPerMMBtu, 1)}, close to the 53.06 kilograms the US Environmental
        Protection Agency uses for typical pipeline gas. The coals burned in power plants release roughly 93 to 97. Carbon dioxide already in the gas passes through the
        flame unchanged and goes up the stack with the rest, which is one more reason Sandhill’s raw gas, at {fmt(SAND.co2KgPerMMBtu, 1)}, has to be cleaned first.
      </P>
      <P>
        A heating value tells us the energy in a standard cubic foot: a cubic foot at one particular temperature and pressure. Inside a pipeline the gas is neither at 60 °F
        nor at 14.73 pounds per square inch, and how much of it fits into a cubic foot of pipe depends on both. Natural gas doesn’t follow the simple gas law exactly when it’s
        squeezed hard, and the difference matters to anyone who stores or ships it. That’s the subject of <a href={lessonHref('gas/1.2')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
