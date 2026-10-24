import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, Sub, fmt, lessonHref, useScenario } from '../../../framework';
import { FAMILY_LABEL, FAMILY_RANGE, boilingSeries, buildMolecule, clampCarbons, type Family, type Molecule, type Rating } from '../../../engines/oil/molecules';
import { CUTS } from '../../../model/oil/crudes';
import { XYChart } from '../shared/charts';

const FAMILIES: Family[] = ['straight', 'branched', 'ring', 'aromatic'];
const cut = (id: string) => CUTS.find((c) => c.id === id)!;
/** The cuts on the boiling-point chart; light and heavy naphtha are shown together. */
const BANDS = [
  { from: -180, to: cut('lpg').hi, label: 'gases & LPG' },
  { from: cut('lightNaphtha').lo, to: cut('heavyNaphtha').hi, label: 'naphtha' },
  { from: cut('kerosene').lo, to: cut('kerosene').hi, label: 'kerosene (jet fuel)' },
  { from: cut('diesel').lo, to: cut('diesel').hi, label: 'diesel' },
];
const FAMILY_COLOR: Record<Family, string> = { straight: '#4590ce', branched: '#2a9d90', ring: '#ab70b6', aromatic: '#d0702a' };

/** "−0.5 °C", "99 °C": one decimal only when the value is under 10 °C in size. */
function degC(t: number): string {
  return `${Math.abs(t) < 10 ? fmt(t, 1) : fmt(t)} °C`;
}

function Formula({ m }: { m: Molecule }) {
  return (
    <span>
      C{m.carbons > 1 && <Sub>{m.carbons}</Sub>}H<Sub>{m.hydrogens}</Sub>
    </span>
  );
}

/** The skeleton and hydrogens of a molecule, scaled to fit. */
function MoleculeDrawing({ m }: { m: Molecule }) {
  const W = 640;
  const H = 230;
  const xs = m.atoms.map((a) => a.x);
  const ys = m.atoms.map((a) => a.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const L = Math.min(58, (W - 60) / Math.max(1, maxX - minX), (H - 60) / Math.max(1, maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const px = (x: number) => W / 2 + (x - cx) * L;
  const py = (y: number) => H / 2 - (y - cy) * L;
  const carbons = m.atoms.slice(0, m.carbons);
  const hs = m.atoms.slice(m.carbons);
  // Each hydrogen is bonded to the nearest carbon.
  const hBonds = hs.map((h) => {
    let best = 0;
    let bd = Infinity;
    carbons.forEach((c, i) => {
      const d = (c.x - h.x) ** 2 + (c.y - h.y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return [carbons[best], h] as const;
  });
  return (
    <svg
      className="diagram"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${m.name}, ${m.formula}: ${m.carbons} carbon atom${m.carbons > 1 ? 's' : ''} (dark) and ${m.hydrogens} hydrogen atoms (light)${m.family === 'aromatic' ? ', with an aromatic ring' : ''}.`}
    >
      {hBonds.map(([c, h], i) => (
        <line key={'hb' + i} x1={px(c.x)} y1={py(c.y)} x2={px(h.x)} y2={py(h.y)} stroke="#b9b9b9" strokeWidth={Math.max(1.5, L * 0.06)} />
      ))}
      {m.bonds.map((b, i) => {
        const a = m.atoms[b.a];
        const c = m.atoms[b.b];
        return <line key={'b' + i} x1={px(a.x)} y1={py(a.y)} x2={px(c.x)} y2={py(c.y)} stroke="#555" strokeWidth={Math.max(2.5, L * 0.1)} strokeLinecap="round" />;
      })}
      {m.rings.map((r, i) => (
        <circle key={'r' + i} cx={px(r.x)} cy={py(r.y)} r={L * 0.55} fill="none" stroke="#d0702a" strokeWidth={Math.max(2, L * 0.07)} />
      ))}
      {hs.map((h, i) => (
        <circle key={'h' + i} cx={px(h.x)} cy={py(h.y)} r={Math.max(3.5, L * 0.15)} fill="#f4f4f2" stroke="#9a9a9a" strokeWidth={1.2} />
      ))}
      {carbons.map((c, i) => (
        <circle key={'c' + i} cx={px(c.x)} cy={py(c.y)} r={Math.max(5, L * 0.24)} fill="#3d3d3d" />
      ))}
    </svg>
  );
}

const RATING_TEXT: Record<Rating, string> = { 'very low': 'very poor', low: 'poor', moderate: 'fair', high: 'good' };

/** The challenge: the eight-carbon molecule with the lowest boiling point, iso-octane. */
export function lowestEightSolved(family: Family, n: number): boolean {
  return clampCarbons(family, n) === 8 && family === 'branched';
}

/** The second challenge: a molecule that boils in the naphtha range and resists knock well. */
export function gasolineSolved(m: Molecule): boolean {
  return m.bp >= 30 && m.bp < 160 && m.knock === 'high';
}

export default function Lesson() {
  const s = useScenario('molecule', { family: 'straight' as Family, n: 8 });
  const { family } = s.state;
  const n = clampCarbons(family, s.state.n);
  const m = buildMolecule(family, n);
  const [lo, hi] = FAMILY_RANGE[family];
  const setFamily = (f: Family) => s.set({ family: f, n: clampCarbons(f, s.state.n) });

  const series = useMemo(() => FAMILIES.map((f) => ({ f, pts: boilingSeries(f) })), []);
  const nOct = buildMolecule('straight', 8);
  const iso = buildMolecule('branched', 8);

  const controls = (
    <>
      <Segmented label="Shape" value={family} onChange={setFamily} options={FAMILIES.map((f) => ({ value: f, label: FAMILY_LABEL[f] }))} />
      <Slider label="Carbon atoms" value={n} min={lo} max={hi} onChange={(v) => s.set({ n: v })} display={`${n}`} />
    </>
  );

  const solvedA = lowestEightSolved(family, n);
  const solvedB = gasolineSolved(m);

  return (
    <LessonPage id="oil/1.1">
      <P>
        Almost no one burns crude oil as it is. What comes out of the ground is a mixture of many thousands of different molecules, and before any of it can fuel a car, a truck or an
        aircraft, a refinery has to sort those molecules, break some of them apart and rebuild others. Every market in this course — for crude, for gasoline and diesel,
        for the spreads between them — rests on what those molecules are and how they behave. So we’ll start with the molecules.
      </P>
      <P>
        Nearly all of them are built from just two elements. By weight, crude oil is typically 83–87% carbon and 10–14% hydrogen, with small amounts of sulfur,
        nitrogen, oxygen and metals making up the rest. Molecules made only of carbon and hydrogen are called <b>hydrocarbons</b>. Each carbon atom forms four bonds and
        each hydrogen atom one, and that single rule allows an enormous variety of shapes. The simplest is methane, one carbon with four hydrogens: the main
        ingredient of natural gas. Join carbons into a chain and fill every spare bond with hydrogen and you get the alkanes, also called <b>paraffins</b>.
      </P>
      <P>
        In the next demonstration, use the slider to lengthen the chain one carbon at a time, and the buttons to change its shape. Dark balls are carbon atoms, light
        ones hydrogen:
      </P>

      <Figure name="Molecule Builder" scenario={s}>
        <MoleculeDrawing m={m} />
        {controls}
        <Readouts
          items={[
            { label: 'molecule', value: <>{m.name}, <Formula m={m} /></> },
            { label: 'molar mass', value: `${fmt(m.molarMass, 1)} g/mol` },
            { label: <K tone="red">boiling point</K>, value: degC(m.bp), tone: 'red' },
            { label: 'at room temperature (25 °C)', value: m.state },
          ]}
        />
        <Caption>
          {m.name} has {fmt(m.hc, 2)} hydrogen atoms per carbon atom{m.density ? ` and a density of ${fmt(m.density, 3)} g/cm³ as a liquid` : ''}. In a refinery it would
          end up in the {m.cut} cut.
        </Caption>
      </Figure>

      <P>
        Start with one carbon and work upward. Methane, ethane, propane and butane are gases at room temperature. Propane and butane are easy to liquefy under modest
        pressure, which is how they’re sold as liquefied petroleum gas, or LPG. From pentane, with five carbons, the chains are liquids, and from octadecane, with
        eighteen, they’re waxy solids; paraffin wax is a mixture of long chains like these. The <K tone="red">boiling point</K> climbs with every carbon: methane boils at
        −162 °C, octane at 126 °C, icosane, with twenty carbons, at 343 °C.
      </P>
      <P>
        The reason is the weak attraction between neighboring molecules. It’s tiny for any one pair of atoms, but a long chain lies alongside its neighbors over its
        whole length, so the bigger the molecule, the more energy it takes to pull it out of the liquid and into the vapor. Notice too that the formula of every chain
        follows the same pattern: <i>n</i> carbons carry 2<i>n</i> + 2 hydrogens, so long chains have very nearly two hydrogens per carbon.
      </P>

      <H2>Branches, rings and aromatics</H2>
      <P>
        The same atoms can be arranged in other ways. A <b>branched</b> paraffin has side chains: iso-octane has the same formula as octane, {iso.formula}, but its eight
        carbons are bunched into a compact shape. Carbon chains can also close into <b>rings</b>, which refiners call naphthenes; a ring has no loose ends, so it carries
        exactly two hydrogens per carbon. And six carbons can form a flat ring in which some of the bonding electrons are shared around the whole ring, drawn here as a
        circle: an <b>aromatic</b> ring, as in benzene and toluene. Aromatics are short of hydrogen — benzene has just one per carbon — and they are dense. A liter of
        toluene weighs 867 grams; a liter of heptane, with the same seven carbons in a chain, weighs 684.
      </P>
      <P>
        Shape changes the boiling point too. A compact molecule touches its neighbors less than a long one, so it escapes the liquid more easily. Switch between the
        shapes with the slider at eight carbons and compare.
      </P>

      <Challenge
        id="a"
        question="Build the eight-carbon molecule with the lowest boiling point."
        solved={solvedA}
        status={`Right now: ${m.name}, ${m.formula}, which boils at ${degC(m.bp)}.`}
        success={`Solved. Iso-octane boils at ${degC(iso.bp)}, against ${degC(nOct.bp)} for straight-chain octane, 132 °C for ethylcyclohexane and 136 °C for ethylbenzene. Its branches make it compact, so it has the least contact with its neighbors to overcome.`}
      />

      <H2>Size sorts molecules by boiling point</H2>
      <P>
        Crude oil contains all four kinds of molecule, in every size from methane to molecules with fifty or more carbons. Refiners don’t sort them by shape, which
        would be impractical, but by boiling point, which is easy: heat the oil, and the light molecules boil off first. The next chart plots the boiling point of
        every molecule the builder can make, with the temperature ranges refiners use to divide crude oil into <b>cuts</b>. The dot is the molecule in the builder:
      </P>

      <Figure name="Molecule Builder · boiling points" scenario={s}>
        <Legend items={FAMILIES.map((f) => ({ label: FAMILY_LABEL[f], color: FAMILY_COLOR[f], kind: 'line' as const }))} />
        <XYChart
          ariaLabel={`Boiling point against number of carbon atoms for straight chains, branched chains, rings and aromatics, with the refinery’s boiling-range cuts shaded. ${m.name}, with ${m.carbons} carbons, boils at ${degC(m.bp)}, in the ${m.cut} cut.`}
          height={320}
          x={[1, 20]}
          y={[-180, 360]}
          xTicks={[1, 4, 8, 12, 16, 20]}
          yTicks={[-100, 0, 100, 200, 300]}
          yFormat={(v) => `${fmt(v)} °C`}
          xLabel="carbon atoms in the molecule"
          yLabel="Boiling point"
          margin={[64, 16, 28, 40]}
          bands={BANDS.map((b, i) => ({ axis: 'y' as const, from: b.from, to: b.to, color: i % 2 ? 'rgba(0,0,0,.04)' : 'rgba(0,0,0,0)', label: b.label, labelSide: 'left' as const }))}
          refs={BANDS.slice(1).map((b) => ({ axis: 'y' as const, at: b.from, color: '#c9c9c4', dash: '2 3' }))}
          series={series.map(({ f, pts }) => ({ points: pts.map((p) => [p.n, p.bp] as [number, number]), color: FAMILY_COLOR[f], width: f === 'straight' ? 2.5 : 2 }))}
          markers={[{ x: m.carbons, y: m.bp, color: FAMILY_COLOR[family], r: 7, label: m.name, labelDx: m.carbons > 15 ? -10 : 10, labelAnchor: m.carbons > 15 ? 'end' : 'start' }]}
        />
        {controls}
      </Figure>

      <P>
        Every cut holds molecules of several shapes. The <b>naphtha</b> range, from 30 to 160 °C, takes straight chains from about five to nine carbons, and branched
        chains, rings and aromatics of similar sizes. That is the raw material for gasoline. <b>Kerosene</b>, from 160 to 250 °C, holds molecules of about ten to
        thirteen carbons and becomes jet fuel. <b>Diesel</b>, from 250 to 350 °C, runs to about twenty carbons. Everything heavier boils above 350 °C, beyond the top of
        this chart: the gas oils and residue we’ll meet in the <a href={lessonHref('oil/1.2')}>next lesson</a>. The cut boundaries are conventions, and every refinery
        sets its own; these are the ones this course uses throughout.
      </P>

      <H2>Shape decides how a fuel burns</H2>
      <P>
        If refineries sort by boiling point, why does shape matter? Because engines care. In a gasoline engine, a spark lights the fuel–air mixture and a flame should
        sweep smoothly across the cylinder. Straight chains tend to ignite on their own ahead of the flame as the mixture is squeezed — the engine <b>knocks</b>, losing
        power and, eventually, damaging itself. Branched chains, small rings and aromatics resist. The <K tone="violet">octane number</K> measures that resistance on a
        scale fixed by two pure compounds: straight-chain heptane is 0 and iso-octane is 100.
      </P>
      <P>
        A diesel engine works the other way round. There’s no spark: fuel is sprayed into air that compression has made hot, and it must ignite by itself, quickly.
        Here long straight chains are best and aromatics worst, and the <b>cetane number</b> measures ignition quality on a scale where hexadecane, a sixteen-carbon chain
        also called cetane, is 100. The builder rates each molecule for both kinds of engine. In the first demonstration, {m.name.toLowerCase()} would be{' '}
        {RATING_TEXT[m.knock]} gasoline and {RATING_TEXT[m.ignition]} diesel.
      </P>

      <Challenge
        id="b"
        figure="Molecule Builder"
        question={
          <>
            In <FigRef to="Molecule Builder">the first demonstration</FigRef>, find a molecule that would make good gasoline: one that boils in the naphtha range, 30–160
            °C, and resists knock well.
          </>
        }
        solved={solvedB}
        status={`${m.name} boils at ${degC(m.bp)} and would be ${RATING_TEXT[m.knock]} gasoline.`}
        success={`Solved: ${m.name}, which boils at ${degC(m.bp)}. Several molecules qualify — iso-octane, cyclopentane, and the aromatics from benzene to propylbenzene — and none of them is a straight chain.`}
      />

      <P>
        So the two engines want opposite molecules from the same barrel. Straight-chain naphtha makes poor gasoline, and aromatic-rich gas oil makes poor diesel. Much of
        what a refinery does after it has sorted crude oil by boiling point is rearranging molecules to fix this: straightening, branching, closing and opening rings,
        and adding hydrogen. Chapter 3 follows those processes, and the prices that make them worth paying for.
      </P>
      <P>
        Before that, we need a better picture of the starting material. Real crude oils differ in how much of each cut they contain, in which shapes of molecule
        dominate, and in the sulfur and metals that come along with them. The <a href={lessonHref('oil/1.2')}>next lesson</a> takes a barrel of crude apart.
      </P>
    </LessonPage>
  );
}
