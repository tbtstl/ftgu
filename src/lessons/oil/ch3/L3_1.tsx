import { useId, useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, pct, usd, useScenario } from '../../../framework';
import { crude, cumulativeYield } from '../../../engines/oil/assay';
import { CRACKING_LIMIT, DEFAULT_CUTS, atmosphericEquivalent, distill, pressureForCut } from '../../../engines/oil/refining';
import { CRUDE_IDS, CRUDE_SPECS, CUTS, type CrudeId } from '../../../model/oil/crudes';
import { CALDER, CRUDE_PRICE, PRODUCT_PRICE } from '../../../model/oil/refinery';
import { StackedBar, XYChart } from '../shared/charts';

const NAME: Record<CrudeId, string> = Object.fromEntries(CRUDE_SPECS.map((s) => [s.id, s.name])) as Record<CrudeId, string>;
const CUT_COLOR: Record<string, string> = Object.fromEntries(CUTS.map((c) => [c.id, c.color]));

/** The crude unit's throughput, kb/d. */
export const RUN = CALDER.capacity.cdu;

/** Slider ranges for the three atmospheric cut points, °C. */
export const NK_RANGE = { min: 130, max: 190, step: 5 };
export const KD_RANGE = { min: 220, max: 300, step: 5 };
export const DG_RANGE = { min: 320, max: 380, step: 5 };

/** The model's limits on the cuts (approximate rules, not specifications). */
export const LIMITS = {
  /** Jet fuel's kerosene must start above this, or it ignites too easily (flash point). */
  keroStartMin: 150,
  /** …and end below this, or it freezes too readily at altitude. */
  keroEndMax: 280,
  /** Diesel ends by this. */
  dieselEndMax: 360,
};

export interface TowerState {
  crude: CrudeId;
  /** Naphtha / kerosene, kerosene / diesel and diesel / gas-oil cut points, °C. */
  nk: number;
  kd: number;
  dg: number;
}

export const TOWER_DEFAULTS: TowerState = {
  crude: 'ridgeback',
  nk: DEFAULT_CUTS.naphthaKero,
  kd: DEFAULT_CUTS.keroDiesel,
  dg: DEFAULT_CUTS.dieselGasoil,
};

/** Whether the cut points respect the model's limits on jet fuel and diesel. */
export function withinLimits(st: Pick<TowerState, 'nk' | 'kd' | 'dg'>): boolean {
  return st.nk >= LIMITS.keroStartMin && st.kd <= LIMITS.keroEndMax && st.dg <= LIMITS.dieselEndMax;
}

/** Kerosene (jet fuel) from a full run, kb/d. */
export function jetRate(st: TowerState): number {
  return distill(crude(st.crude), { naphthaKero: st.nk, keroDiesel: st.kd, dieselGasoil: st.dg, vacuumCut: DEFAULT_CUTS.vacuumCut }).kerosene.volume * RUN;
}

/**
 * Challenge a: the most jet fuel Ridgeback Light can give within the limits — the kerosene cut as
 * wide as allowed, 150–280 °C, with diesel still ending by 360 °C.
 */
export function maxJetSolved(st: TowerState): boolean {
  return st.crude === 'ridgeback' && st.nk === LIMITS.keroStartMin && st.kd === LIMITS.keroEndMax && st.dg <= LIMITS.dieselEndMax;
}

/** The vacuum column's target: gas oil boiling up to 550 °C (atmospheric-equivalent). */
export const VACUUM_TARGET = 550;
/** Column pressure slider: log10 of mmHg, 1 (10 mmHg) to 2.9 (atmospheric), in steps of 0.01. */
export const LOG_P_RANGE = { min: 1, max: 2.9, step: 0.01 };

export function pressureOf(logP: number): number {
  return Math.min(760, 10 ** logP);
}

/** Challenge b: at the furnace's 400 °C limit, the highest pressure on the slider that still reaches 550 °C. */
export function vacuumSolved(furnace: number, logP: number): boolean {
  if (furnace !== CRACKING_LIMIT) return false;
  const reaches = (x: number) => atmosphericEquivalent(furnace, pressureOf(x)) >= VACUUM_TARGET;
  return reaches(logP) && !reaches(Math.round((logP + LOG_P_RANGE.step) * 100) / 100);
}

function kbd(v: number): string {
  return `${fmt(v, 1)} kb/d`;
}

function degC(t: number): string {
  return `${fmt(t)} °C`;
}

function mmHg(p: number): string {
  return `${fmt(p, p < 100 ? 1 : 0)} mmHg`;
}

// ---------------------------------------------------------------------------
// The atmospheric column.

const T_MAX = 380;
const Y_TOP = 52;
const Y_BOT = 318;
/** Height in the column at which material boiling at t °C is drawn off. */
const ty = (t: number) => Y_TOP + (Math.max(0, Math.min(T_MAX, t)) / T_MAX) * (Y_BOT - Y_TOP);
const CX0 = 222;
const CX1 = 272;
const BAR_X = 304;
const PX_PER_KB = 1.9;

interface Draw {
  id: string;
  name: string;
  range: string;
  y: number;
  flow: number;
  color: string;
  warn?: string;
}

function Tower({ st, draws }: { st: TowerState; draws: Draw[] }) {
  const gid = 'tw' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const ticks = [
    { t: 30, l: '30' },
    { t: 80, l: '80' },
    { t: st.nk, l: String(st.nk) },
    { t: st.kd, l: String(st.kd) },
    { t: st.dg, l: String(st.dg) },
  ];
  const trays = Array.from({ length: 24 }, (_, i) => 50 + i * 12);
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 392"
      role="img"
      aria-label={`The crude column running ${fmt(RUN)} kb/d of ${NAME[st.crude]}, with cut points at ${st.nk}, ${st.kd} and ${st.dg} °C. Products: ${draws.map((d) => `${d.name.toLowerCase()} ${kbd(d.flow)}`).join(', ')}.`}
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#dce9f5" />
          <stop offset="1" stopColor="#f6cbb4" />
        </linearGradient>
      </defs>
      {/* Desalter and furnace */}
      <text className="ax" x={6} y={318}>
        crude in, {fmt(RUN)} kb/d
      </text>
      <line x1={4} x2={22} y1={340} y2={340} stroke="#777" strokeWidth={3} />
      <rect x={22} y={326} width={40} height={28} rx={4} fill="#eef3f7" stroke="#8a8a8a" />
      <text className="ax ax-m" x={42} y={370}>
        desalter
      </text>
      <line x1={62} x2={86} y1={340} y2={340} stroke="#777" strokeWidth={3} />
      <rect x={86} y={318} width={62} height={44} rx={3} fill="#f3efe6" stroke="#8a8a8a" />
      {[96, 110, 124, 138].map((x) => (
        <path key={x} d={`M${x - 5} 358 Q${x} 340 ${x + 5} 358 Z`} fill="#e48850" />
      ))}
      <text className="ax ax-m" x={117} y={378}>
        furnace
      </text>
      <line x1={148} x2={CX0} y1={330} y2={330} stroke="#c4382f" strokeWidth={3.5} />
      <text className="ax ax-m" x={185} y={322} style={{ fill: '#c4382f' }}>
        hot feed
      </text>
      {/* Column */}
      <rect x={CX0} y={34} width={CX1 - CX0} height={340} rx={24} fill={`url(#${gid})`} stroke="#777" strokeWidth={1.5} />
      {trays.map((y) => (
        <line key={y} x1={CX0 + 6} x2={CX1 - 6} y1={y} y2={y} stroke="#9a9a9a" strokeWidth={1} opacity={0.7} />
      ))}
      <text className="ax ax-m" x={(CX0 + CX1) / 2} y={26}>
        cooler
      </text>
      <text className="ax ax-m" x={(CX0 + CX1) / 2} y={388}>
        hotter
      </text>
      {/* Boiling-point scale along the column */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={CX0 - 6} x2={CX0} y1={ty(t.t)} y2={ty(t.t)} stroke="#c4382f" strokeWidth={1.5} />
          <text x={CX0 - 9} y={ty(t.t) + 4} textAnchor="end" style={{ fontSize: 11.5, fill: '#c4382f' }}>
            {t.l} °C
          </text>
        </g>
      ))}
      <text x={CX0 - 9} y={44} textAnchor="end" className="ax">
        cut points
      </text>
      {/* Draws */}
      {draws.map((d) => (
        <g key={d.id}>
          <line x1={CX1} x2={BAR_X - 4} y1={d.y} y2={d.y} stroke="#777" strokeWidth={2.5} />
          <text x={BAR_X} y={d.y - 8} style={{ fontSize: 12, fontWeight: 500, fill: d.warn ? '#c4382f' : '#333' }}>
            {d.name}
            <tspan style={{ fontWeight: 400, fill: d.warn ? '#c4382f' : '#5f5f5f' }}>
              {' '}
              · {d.range}
              {d.warn ? ` · ${d.warn}` : ''}
            </tspan>
          </text>
          <rect x={BAR_X} y={d.y - 4} width={Math.max(1, d.flow * PX_PER_KB)} height={9} fill={d.color} stroke={d.warn ? '#c4382f' : 'none'} strokeWidth={1.5} />
          <text x={BAR_X + d.flow * PX_PER_KB + 6} y={d.y + 4} style={{ fontSize: 12, fontWeight: 500, fill: '#ad5310' }}>
            {kbd(d.flow)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('tower', TOWER_DEFAULTS);
  const st = s.state;
  const cr = crude(st.crude);
  const d = distill(cr, { naphthaKero: st.nk, keroDiesel: st.kd, dieselGasoil: st.dg, vacuumCut: DEFAULT_CUTS.vacuumCut });
  const atmResidue = 1 - cumulativeYield(cr, st.dg);
  const keroWarn = st.nk < LIMITS.keroStartMin ? 'flash point too low' : st.kd > LIMITS.keroEndMax ? 'would freeze too readily' : undefined;
  const dieselWarn = st.dg > LIMITS.dieselEndMax ? 'too heavy for diesel' : undefined;
  const draws: Draw[] = [
    { id: 'lpg', name: 'Gases & LPG', range: 'below 30 °C', y: 44, flow: d.lpg.volume * RUN, color: CUT_COLOR.lpg },
    { id: 'ln', name: 'Light naphtha', range: '30–80 °C', y: ty(55) + 8, flow: d.lightNaphtha.volume * RUN, color: CUT_COLOR.lightNaphtha },
    { id: 'hn', name: 'Heavy naphtha', range: `80–${st.nk} °C`, y: ty((80 + st.nk) / 2) + 10, flow: d.heavyNaphtha.volume * RUN, color: CUT_COLOR.heavyNaphtha },
    { id: 'kero', name: 'Kerosene', range: `${st.nk}–${st.kd} °C`, y: ty((st.nk + st.kd) / 2) + 6, flow: d.kerosene.volume * RUN, color: CUT_COLOR.kerosene, warn: keroWarn },
    { id: 'diesel', name: 'Diesel', range: `${st.kd}–${st.dg} °C`, y: ty((st.kd + st.dg) / 2), flow: d.diesel.volume * RUN, color: CUT_COLOR.diesel, warn: dieselWarn },
    { id: 'resid', name: 'Atmospheric residue → vacuum column', range: `above ${st.dg} °C`, y: 362, flow: atmResidue * RUN, color: CUT_COLOR.residue },
  ];
  const ok = withinLimits(st);
  const solvedA = maxJetSolved(st);

  // Reference numbers for the prose.
  const rbDefault = distill(crude('ridgeback'));
  const rbMaxJet = distill(crude('ridgeback'), { ...DEFAULT_CUTS, naphthaKero: LIMITS.keroStartMin, keroDiesel: LIMITS.keroEndMax });
  const nfDefault = distill(crude('northfield'));
  const cwAtm = 1 - cumulativeYield(crude('coldwater'), DEFAULT_CUTS.dieselGasoil);

  // ---- Figure 2: the vacuum column.
  const v = useScenario('vacuum', { crude: 'coldwater' as CrudeId, furnace: 380, logP: LOG_P_RANGE.max });
  const vcr = crude(v.state.crude);
  const pres = pressureOf(v.state.logP);
  const cut = atmosphericEquivalent(v.state.furnace, pres);
  const cutEff = Math.max(DEFAULT_CUTS.dieselGasoil, cut);
  const dist = cumulativeYield(vcr, DEFAULT_CUTS.dieselGasoil);
  const vgo = Math.max(0, cumulativeYield(vcr, cutEff) - dist);
  const resid = 1 - dist - vgo;
  const curve = useMemo(() => Array.from({ length: 170 }, (_, i) => -45 + i * 5).map((t) => [t, cumulativeYield(vcr, t) * 100] as [number, number]), [vcr]);
  const cracking = v.state.furnace > CRACKING_LIMIT;
  const solvedB = vacuumSolved(v.state.furnace, v.state.logP);
  const cw = crude('coldwater');
  const deep = atmosphericEquivalent(CRACKING_LIMIT, 25);
  const target = pressureForCut(CRACKING_LIMIT, VACUUM_TARGET);

  return (
    <LessonPage id="oil/3.1">
      <P>
        Chapter 2 ended with our four crudes leaving their fields: Ridgeback Light and Northfield Sour from the inland basin, Coldwater Heavy from the north, Seaboard Blend
        by sea. In this chapter they all go to the same place, the Calder refinery at Port Calder, which can take {fmt(RUN)},000 barrels of crude a day. The chapter’s
        question is how one barrel of crude becomes several products, each with its own value, and the answer starts with the physics of{' '}
        <a href={lessonHref('oil/1.4')}>Lesson 1.4</a>: a mixture boils over a range, and what boils first is richer in its lightest molecules.
      </P>
      <P>
        Crude reaches the refinery carrying some salty water, so it’s first washed in a <b>desalter</b>; left in, the salt would corrode the equipment downstream. Then a
        furnace heats it, typically to about 350–370 °C, and the hot, partly boiling oil enters near the bottom of a tall column. Inside are a few dozen trays. Vapor
        rises through each tray and bubbles through the liquid standing on it, while liquid spills down from tray to tray, so that every tray acts as one of the
        equilibrium stages of Lesson 1.4. The bottom is hot and the top is cool. Light molecules work their way up and heavy ones down, and the column draws off
        products at different heights, each one a band of boiling points: the cuts of <a href={lessonHref('oil/1.2')}>Lesson 1.2</a>.
      </P>
      <P>
        In the next demonstration, the column runs {fmt(RUN)} kb/d — thousand barrels a day — of the crude you choose. The red marks on its side are the{' '}
        <K tone="red">cut points</K>, the boiling temperatures where one product ends and the next begins. Choose a crude and move the cut points:
      </P>

      <Figure name="Distillation Tower" scenario={s}>
        <Segmented label="Crude" value={st.crude} onChange={(c) => s.set({ crude: c })} options={CRUDE_IDS.map((id) => ({ value: id, label: NAME[id] }))} />
        <Tower st={st} draws={draws} />
        <Readouts
          items={[
            { label: <K tone="orange">kerosene for jet fuel</K>, value: kbd(d.kerosene.volume * RUN), tone: 'orange' },
            { label: <K tone="orange">diesel</K>, value: kbd(d.diesel.volume * RUN), tone: 'orange' },
            { label: 'boiled at atmospheric pressure', value: pct(1 - atmResidue) },
          ]}
        />
        <Slider
          label="Naphtha / kerosene cut"
          tone="red"
          value={st.nk}
          min={NK_RANGE.min}
          max={NK_RANGE.max}
          step={NK_RANGE.step}
          onChange={(x) => s.set({ nk: x })}
          display={degC(st.nk)}
        />
        <Slider
          label="Kerosene / diesel cut"
          tone="red"
          value={st.kd}
          min={KD_RANGE.min}
          max={KD_RANGE.max}
          step={KD_RANGE.step}
          onChange={(x) => s.set({ kd: x })}
          display={degC(st.kd)}
        />
        <Slider
          label="Diesel / gas oil cut"
          tone="red"
          value={st.dg}
          min={DG_RANGE.min}
          max={DG_RANGE.max}
          step={DG_RANGE.step}
          onChange={(x) => s.set({ dg: x })}
          display={degC(st.dg)}
        />
        <Caption>
          {ok
            ? `Every cut is within the model’s limits. Kerosene carries ${fmt(d.kerosene.sulfur, 3)}% sulfur and diesel ${fmt(d.diesel.sulfur, 3)}%, straight from the crude.`
            : 'A cut is outside the model’s limits: the product drawn there wouldn’t meet its specification.'}
        </Caption>
      </Figure>

      <P>
        With Ridgeback Light at the standard cut points, the column makes {kbd(rbDefault.kerosene.volume * RUN)} of kerosene and {kbd(rbDefault.diesel.volume * RUN)} of
        diesel, and {pct(cumulativeYield(crude('ridgeback'), DEFAULT_CUTS.dieselGasoil))} of the crude boils off before the residue leaves the bottom. Switch to Coldwater
        Heavy and {pct(cwAtm)} of the barrel goes out of the bottom unboiled. None of these streams is a finished product yet. Northfield Sour’s diesel cut carries{' '}
        {fmt(nfDefault.diesel.sulfur, 2)}% sulfur, against a limit of 15 parts per million for road diesel, and even Ridgeback Light’s carries{' '}
        {fmt(rbDefault.diesel.sulfur, 2)}%; removing it is the subject of <a href={lessonHref('oil/3.3')}>Lesson 3.3</a>. Distillation only sorts. It changes no
        molecules.
      </P>

      <H2>Cut points are a choice</H2>
      <P>
        Nothing in nature says kerosene ends at {DEFAULT_CUTS.keroDiesel} °C. The column’s operators set the cut points by how much they draw off at each height, and they
        move them to suit the market. The boundary between kerosene and diesel is a <b>swing cut</b>: the molecules boiling around it can go into either product, so raising
        the cut point makes more jet fuel and less diesel. Which way to swing depends on prices. In the course’s simulated reference month, jet fuel sells for{' '}
        {usd(PRODUCT_PRICE.jet)} a barrel at Port Calder and diesel for {usd(PRODUCT_PRICE.diesel)}, but in a winter of heavy heating-oil demand, or a summer of heavy air
        travel, the gap can move either way.
      </P>
      <P>
        The cuts can’t move far, because each product has a specification. Jet fuel must not ignite too easily — the common Jet A grade must have a flash point of at least
        38 °C — and it must not freeze in the cold at cruising altitude, where Jet A is required to stay liquid down to −40 °C. Light molecules lower the flash point and
        heavy, waxy ones raise the freezing point, so both ends of the kerosene cut are limited. Our model uses simple rules for this: kerosene for jet fuel starts no lower
        than {LIMITS.keroStartMin} °C and ends no higher than {LIMITS.keroEndMax} °C, and diesel ends by {LIMITS.dieselEndMax} °C. They are approximations, but they’re in the
        right place.
      </P>

      <Challenge
        id="a"
        question="An airline wants all the jet fuel Calder can make. Running Ridgeback Light, set the cut points to make as much kerosene as the model’s limits allow."
        solved={solvedA}
        status={
          st.crude !== 'ridgeback'
            ? 'Choose Ridgeback Light first.'
            : !ok
              ? 'One of the cuts is outside the model’s limits.'
              : `The column makes ${kbd(d.kerosene.volume * RUN)} of kerosene. Can the cut be wider?`
        }
        success={`Solved: kerosene from ${LIMITS.keroStartMin} to ${LIMITS.keroEndMax} °C gives ${kbd(rbMaxJet.kerosene.volume * RUN)}, up from ${kbd(rbDefault.kerosene.volume * RUN)} at the standard cuts. The extra barrels aren’t new: diesel falls from ${kbd(rbDefault.diesel.volume * RUN)} to ${kbd(rbMaxJet.diesel.volume * RUN)}, and heavy naphtha from ${kbd(rbDefault.heavyNaphtha.volume * RUN)} to ${kbd(rbMaxJet.heavyNaphtha.volume * RUN)}. Distillation can only reshuffle what the crude contains.`}
      />

      <H2>The vacuum column</H2>
      <P>
        Everything boiling above about {DEFAULT_CUTS.dieselGasoil} °C leaves the bottom of the column as <b>atmospheric residue</b>. A lot of it is valuable: the gas oils
        boiling from 350 to 550 °C can be cracked into gasoline and diesel, as the next lesson shows. The obvious move is to heat the crude more, but there’s a ceiling. At
        about {CRACKING_LIMIT} °C, heavy oil starts to break apart in the furnace and lay down coke on the inside of its tubes. So the refinery uses the other lever of
        Lesson 1.4: pressure. The residue is reheated and sent to a second column held at a vacuum — a few percent of atmospheric pressure, tens of millimeters of
        mercury — where everything boils at a far lower temperature. Refiners describe what a vacuum column recovers by its <b>atmospheric-equivalent</b> cut point: the
        temperature at which the heaviest molecule it boils would boil at normal pressure.
      </P>
      <P>
        In the next demonstration, the curve is the crude’s boiling curve: the share of the barrel that has boiled at each atmospheric-equivalent temperature. The vacuum
        column’s cut point follows from the furnace temperature and the column pressure, by an approximate form of the relation between vapor pressure and temperature.
        Set both:
      </P>

      <Figure name="Distillation Tower · vacuum" scenario={v}>
        <Segmented label="Crude" value={v.state.crude} onChange={(c) => v.set({ crude: c })} options={CRUDE_IDS.map((id) => ({ value: id, label: NAME[id] }))} />
        <Legend
          items={[
            { label: 'Distillates (atmospheric column)', color: CUT_COLOR.diesel },
            { label: 'Vacuum gas oil', color: CUT_COLOR.vgo },
            { label: 'Vacuum residue', color: CUT_COLOR.residue },
          ]}
        />
        <XYChart
          ariaLabel={`Boiling curve of ${NAME[v.state.crude]}: share boiled against atmospheric-equivalent temperature. The furnace is at ${degC(v.state.furnace)} and the column at ${mmHg(pres)}, so the cut point is ${degC(cut)}: ${pct(dist)} distillates, ${pct(vgo)} vacuum gas oil, ${pct(resid)} vacuum residue.`}
          height={250}
          x={[0, 800]}
          y={[0, 100]}
          xTicks={[0, 200, 400, 600, 800]}
          yTicks={[0, 25, 50, 75, 100]}
          xFormat={(t) => `${t} °C`}
          yFormat={(y) => `${y}%`}
          xLabel="boiling point, atmospheric-equivalent"
          yLabel="Share of the crude boiled"
          bands={[
            { from: 0, to: DEFAULT_CUTS.dieselGasoil, color: 'rgba(217, 127, 62, .08)' },
            { from: DEFAULT_CUTS.dieselGasoil, to: cutEff, color: 'rgba(165, 96, 58, .18)' },
            { from: cutEff, to: 800, color: 'rgba(93, 70, 55, .12)' },
          ]}
          series={[{ points: curve, color: '#333', width: 2.5 }]}
          refs={[
            { axis: 'x', at: DEFAULT_CUTS.dieselGasoil, color: '#777', label: 'atmospheric' },
            { axis: 'x', at: cutEff, color: '#c4382f', dash: '0', label: cutEff - DEFAULT_CUTS.dieselGasoil >= 90 ? `vacuum cut ${fmt(cut)} °C` : undefined },
            { axis: 'x', at: v.state.furnace, cursor: true },
          ]}
          markers={[{ x: cutEff, y: cumulativeYield(vcr, cutEff) * 100, color: '#c4382f', r: 6 }]}
        >
          {(sx, sy) => (
            <text x={sx(v.state.furnace) + 4} y={sy(4)} className="ax">
              furnace {fmt(v.state.furnace)} °C
            </text>
          )}
        </XYChart>
        <StackedBar
          ariaLabel={`The barrel: ${pct(dist)} distillates, ${pct(vgo)} vacuum gas oil, ${pct(resid)} vacuum residue.`}
          height={34}
          segments={[
            { id: 'dist', value: dist, color: CUT_COLOR.diesel, label: 'distillates' },
            { id: 'vgo', value: vgo, color: CUT_COLOR.vgo, label: 'gas oil', textColor: '#fff' },
            { id: 'res', value: resid, color: CUT_COLOR.residue, label: 'residue', textColor: '#fff' },
          ]}
        />
        <Readouts
          items={[
            { label: <K tone="red">vacuum cut point</K>, value: degC(cut), tone: 'red' },
            { label: <K tone="orange">vacuum gas oil</K>, value: kbd(vgo * RUN), tone: 'orange' },
            { label: <K tone="orange">vacuum residue</K>, value: kbd(resid * RUN), tone: 'orange' },
          ]}
        />
        <Slider
          label="Furnace outlet"
          tone="red"
          value={v.state.furnace}
          min={360}
          max={430}
          step={5}
          onChange={(x) => v.set({ furnace: x })}
          display={`${degC(v.state.furnace)}${cracking ? ' · cracking' : ''}`}
        />
        <Slider
          label="Column pressure"
          tone="blue"
          value={v.state.logP}
          min={LOG_P_RANGE.min}
          max={LOG_P_RANGE.max}
          step={LOG_P_RANGE.step}
          onChange={(x) => v.set({ logP: Math.round(x * 100) / 100 })}
          display={mmHg(pres)}
        />
        <Caption>
          {cracking
            ? `Above about ${CRACKING_LIMIT} °C the oil starts to crack in the furnace tubes, fouling them with coke.`
            : pres >= 759.5
              ? 'At atmospheric pressure, the cut point is simply the furnace temperature.'
              : `At ${mmHg(pres)}, a furnace at ${degC(v.state.furnace)} boils everything up to an atmospheric-equivalent ${degC(cut)}.`}
        </Caption>
      </Figure>

      <P>
        At atmospheric pressure the furnace can only boil what boils below its own temperature: {degC(atmosphericEquivalent(CRACKING_LIMIT, 760))} at the cracking limit,
        barely past the atmospheric column’s cut. Lower the pressure to 25 mmHg and the same {CRACKING_LIMIT} °C furnace reaches an atmospheric-equivalent{' '}
        {degC(deep)}. That matters most for heavy crude. Of Coldwater Heavy, {pct(1 - cumulativeYield(cw, DEFAULT_CUTS.dieselGasoil))} boils above{' '}
        {DEFAULT_CUTS.dieselGasoil} °C; a vacuum cut at {VACUUM_TARGET} °C recovers enough gas oil to leave {pct(1 - cumulativeYield(cw, VACUUM_TARGET))} as residue, and a
        cut at {fmt(deep)} °C leaves {pct(1 - cumulativeYield(cw, deep))}. Every barrel moved from residue to gas oil is a barrel the cracker can upgrade.
      </P>

      <Challenge
        id="b"
        question={`With the furnace at its ${CRACKING_LIMIT} °C limit, find the highest column pressure that still recovers gas oil boiling up to ${VACUUM_TARGET} °C.`}
        solved={solvedB}
        status={
          v.state.furnace !== CRACKING_LIMIT
            ? `Set the furnace to ${CRACKING_LIMIT} °C first.`
            : `At ${mmHg(pres)}, the cut point is ${degC(cut)}.`
        }
        success={`Solved: about ${mmHg(pres)}, roughly ${fmt((pres / 760) * 100)}% of atmospheric pressure (the model’s exact answer is ${mmHg(target)}). A better vacuum would cut deeper; a worse one, or a cooler furnace, leaves gas oil in the residue.`}
      />

      <P>
        Distillation has now done all it can. It has split each barrel into cuts, but the cuts are in the proportions the crude came with, and the heaviest of them are worth
        the least: in our simulated reference month, high-sulfur fuel oil fetches {usd(PRODUCT_PRICE.hsfo)} a barrel, {usd(CRUDE_PRICE.ridgeback - PRODUCT_PRICE.hsfo, 2)}{' '}
        less than a barrel of Ridgeback Light costs delivered to Calder. Turning gas oil and residue into gasoline and diesel means changing the molecules themselves. The <a href={lessonHref('oil/3.2')}>next lesson</a> breaks them
        apart. You can return to <FigRef to="Distillation Tower">the first demonstration</FigRef> to compare how the four crudes split.
      </P>
    </LessonPage>
  );
}
