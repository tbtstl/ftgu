import {
  Caption,
  Challenge,
    Figure,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  Eq,
  Frac,
  P,
  Readouts,
  Segmented,
  Slider,
  fmt,
  lessonHref,
  pct,
  useScenario,
} from '../../../framework';
import { cumulativeYield, makeCrude, tiltYields, type Crude } from '../../../engines/oil/assay';
import { CLASSES, CLASS_COLOR, CLASS_LABEL, CRUDE_SPECS, CUTS, type CrudeId } from '../../../model/oil/crudes';
import { inkOn } from '../shared/charts';

const SPEC: Record<CrudeId, (typeof CRUDE_SPECS)[number]> = Object.fromEntries(CRUDE_SPECS.map((s) => [s.id, s])) as Record<CrudeId, (typeof CRUDE_SPECS)[number]>;

/** Product sulfur limits that apply to each cut, % by weight. */
const LIMITS: Array<{ label: string; value: number } | null> = [
  null,
  { label: 'gasoline 10 ppm', value: 0.001 },
  { label: 'gasoline 10 ppm', value: 0.001 },
  { label: 'jet fuel 0.3%', value: 0.3 },
  { label: 'diesel 15 ppm', value: 0.0015 },
  { label: 'marine fuel 0.5%', value: 0.5 },
  { label: 'marine fuel 0.5%', value: 0.5 },
];

const MARINE_CAP = 0.5;

interface CompositionState {
  preset: CrudeId;
  tilt: number;
  aromaticity: number;
  sulfur: number;
  metals: number;
}

function crudeOf(st: CompositionState): Crude {
  const sp = SPEC[st.preset];
  return makeCrude({ yields: tiltYields(sp.yields, st.tilt), aromaticity: st.aromaticity, sulfur: st.sulfur, metals: st.metals });
}

/** Share of the crude's volume in naphthenes, aromatics, resins and asphaltenes. */
function ringShare(cr: Crude): number {
  return cr.yields.reduce((s, y, i) => s + y * (1 - cr.cutClasses[i].paraffins), 0);
}

/** The first challenge: as dense as Northfield Sour, but with more than 60% boiling below 350 °C. */
export const NORTHFIELD_API = makeCrude(SPEC.northfield).api;
export function sameDensitySolved(cr: Crude): boolean {
  return Math.abs(cr.api - NORTHFIELD_API) <= 0.5 && cumulativeYield(cr, 350) > 0.6;
}

/** The second challenge: the highest whole-crude sulfur (to 0.01%) at which the residue meets the marine-fuel cap. */
export function residueCapSolved(st: CompositionState): boolean {
  if (st.preset !== 'northfield' || st.tilt !== 0 || Math.abs(st.aromaticity - SPEC.northfield.aromaticity) > 1e-9) return false;
  const here = crudeOf(st).cutSulfur[6];
  const more = crudeOf({ ...st, sulfur: Math.round((st.sulfur + 0.01) * 100) / 100 }).cutSulfur[6];
  return here <= MARINE_CAP + 1e-9 && more > MARINE_CAP;
}

/** Columns for the cuts (width = volume), stacked by molecule class. */
function Mosaic({ cr }: { cr: Crude }) {
  const X0 = 44;
  const X1 = 620;
  const Y0 = 36;
  const Y1 = 214;
  let acc = 0;
  const cols = cr.yields.map((y, i) => {
    const x = X0 + acc * (X1 - X0);
    acc += y;
    return { i, x, w: y * (X1 - X0), y };
  });
  return (
    <svg
      className="chart"
      viewBox="0 0 640 262"
      role="img"
      aria-label={`The crude by volume: ${CUTS.map((c, i) => `${c.name.toLowerCase()} ${pct(cr.yields[i])}`).join(', ')}. Paraffins dominate the light cuts; aromatics, resins and asphaltenes grow toward the residue.`}
    >
      <text className="ax" x={X0} y={14}>
        Share of the barrel by volume, in boiling order · each column split by kind of molecule
      </text>
      {cols.map(({ i, x, w }) => {
        let yy = Y1;
        return (
          <g key={i}>
            {CLASSES.map((k) => {
              const h = cr.cutClasses[i][k] * (Y1 - Y0);
              yy -= h;
              return h > 0.01 ? <rect key={k} x={x} y={yy} width={Math.max(0, w - 1.5)} height={h} fill={CLASS_COLOR[k]} /> : null;
            })}
            {w > 34 && (
              <text x={x + w / 2} y={Y0 - 6} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
                {pct(cr.yields[i])}
              </text>
            )}
            {w > 52 && (
              <text x={x + w / 2} y={Y1 - 8} textAnchor="middle" style={{ fontSize: 11, fill: inkOn(CLASS_COLOR.paraffins) }}>
                {CUTS[i].name.replace('Vacuum ', 'vac. ').replace('Gases & LPG', 'LPG').toLowerCase()}
              </text>
            )}
          </g>
        );
      })}
      <line className="base" x1={X0} x2={X1} y1={Y1} y2={Y1} />
      {cols.slice(1).map(({ i, x }) => (
        <text key={'t' + i} className="ax ax-m" x={x} y={Y1 + 15}>
          {CUTS[i].lo}°
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={Y1 + 34}>
        boiling point at each boundary, °C
      </text>
    </svg>
  );
}

/** One row per cut: its sulfur on a log scale, with the product limit that applies to it. */
function SulfurRows({ cr }: { cr: Crude }) {
  const X0 = 124;
  const X1 = 478;
  const lx = (pctWt: number) => X0 + ((Math.log10(Math.max(pctWt, 1e-4)) + 4) / 5) * (X1 - X0); // 1 ppm … 10%
  const rowH = 30;
  const top = 26;
  const ticks = [
    { v: 0.0001, l: '1 ppm' },
    { v: 0.001, l: '10 ppm' },
    { v: 0.01, l: '100 ppm' },
    { v: 0.1, l: '0.1%' },
    { v: 1, l: '1%' },
    { v: 10, l: '10%' },
  ];
  const H = top + rowH * CUTS.length + 30;
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${H}`}
      role="img"
      aria-label={`Sulfur in each cut: ${CUTS.map((c, i) => `${c.name.toLowerCase()} ${fmtS(cr.cutSulfur[i])}`).join(', ')}. Residue nickel and vanadium ${fmt(cr.cutMetals[6])} ppm.`}
    >
      <text className="ax" x={X0} y={14}>
        Sulfur by weight (log scale)
      </text>
      <text className="ax" x={492} y={14}>
        Limit for the product
      </text>
      {ticks.map((t) => (
        <g key={t.l}>
          <line className="gl" x1={lx(t.v)} x2={lx(t.v)} y1={top} y2={top + rowH * CUTS.length} />
          <text className="ax ax-m" x={lx(t.v)} y={top + rowH * CUTS.length + 16}>
            {t.l}
          </text>
        </g>
      ))}
      {CUTS.map((c, i) => {
        const y = top + i * rowH;
        const s = cr.cutSulfur[i];
        const lim = LIMITS[i];
        const over = lim ? s > lim.value : false;
        return (
          <g key={c.id}>
            <text x={X0 - 8} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
              {c.name}
            </text>
            <rect x={X0} y={y + 7} width={Math.max(0, lx(s) - X0)} height={rowH - 14} fill={c.color} />
            <text
              x={lx(s) + 56 > X1 ? lx(s) - 6 : lx(s) + 6}
              y={y + rowH / 2 + 4}
              textAnchor={lx(s) + 56 > X1 ? 'end' : 'start'}
              style={{ fontSize: 12, fontWeight: 600, fill: lx(s) + 56 > X1 ? inkOn(c.color) : over ? '#c4382f' : '#333' }}
            >
              {fmtS(s)}
            </text>
            {lim && (
              <g>
                <line x1={lx(lim.value)} x2={lx(lim.value)} y1={y + 3} y2={y + rowH - 3} stroke="#c4382f" strokeWidth={2} />
                <text x={492} y={y + rowH / 2 + 4} style={{ fontSize: 12, fill: over ? '#c4382f' : '#5f5f5f' }}>
                  {lim.label}
                  {over ? ' · over' : ' · within'}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function round10(x: number): number {
  return Math.round(x / 10) * 10;
}

function fmtS(pctWt: number): string {
  return pctWt < 0.1 ? `${fmt(pctWt * 10000)} ppm` : `${fmt(pctWt, 2)}%`;
}

export default function Lesson() {
  const s = useScenario<CompositionState>('crude', {
    preset: 'northfield',
    tilt: 0,
    aromaticity: SPEC.northfield.aromaticity,
    sulfur: SPEC.northfield.sulfur,
    metals: SPEC.northfield.metals,
  });
  const st = s.state;
  const cr = crudeOf(st);
  const light = cumulativeYield(cr, 350);
  const choose = (id: CrudeId) => s.set({ preset: id, tilt: 0, aromaticity: SPEC[id].aromaticity, sulfur: SPEC[id].sulfur, metals: SPEC[id].metals });
  const presetCrude = makeCrude(SPEC[st.preset]);
  const nf = makeCrude(SPEC.northfield);
  const cw = makeCrude(SPEC.coldwater);
  const rb = makeCrude(SPEC.ridgeback);

  const presets = (
    <Segmented label="Start from" value={st.preset} onChange={choose} options={CRUDE_SPECS.map((sp) => ({ value: sp.id, label: sp.name }))} />
  );

  const solvedA = sameDensitySolved(cr);
  const solvedB = residueCapSolved(st);
  const residueS = cr.cutSulfur[6];
  const ratio = residueS / Math.max(1e-9, st.sulfur);

  return (
    <LessonPage id="oil/1.2">
      <P>
        <a href={lessonHref('oil/1.1')}>The previous lesson</a> sorted hydrocarbon molecules by boiling point, and found that the cuts a refinery separates — naphtha,
        kerosene, diesel and heavier — each hold molecules of several shapes. A real crude oil is all of those cuts at once, in proportions that differ from one oil to the
        next. To find out what’s in one, a laboratory distills a sample, measures how much of it boils in each temperature range, and analyzes each cut. The result is
        called an <b>assay</b>, and it is the first thing a refiner looks at before buying a cargo.
      </P>
      <P>
        This course follows four crudes, each from a different corner of the world it’s set in. <b>Ridgeback Light</b> comes from shale wells in the inland Ridgeback
        Basin. <b>Northfield Sour</b> comes from an old conventional field in the same basin. <b>Coldwater Heavy</b> comes from heavy-oil fields far to the north, and{' '}
        <b>Seaboard Blend</b> from an offshore field, arriving by tanker. They’re fictional, but their assays are realistic, and the course will produce, refine, ship and
        trade them from here to the last chapter.
      </P>
      <P>
        In the next demonstration, each column is one cut, in boiling order from left to right, and its width is the cut’s share of the barrel. Each column is split by
        the kinds of molecule in it: chains (<b>paraffins</b>), rings (<b>naphthenes</b>), <b>aromatics</b>, and the <b>resins and asphaltenes</b> — very large, flat
        molecules built from many fused rings, found only at the heavy end. Pick a crude to start from, then change it:
      </P>

      <Figure name="Crude Composition Explorer" scenario={s}>
        {presets}
        <Legend items={CLASSES.map((k) => ({ label: CLASS_LABEL[k], color: CLASS_COLOR[k] }))} />
        <Mosaic cr={cr} />
        <Readouts
          items={[
            { label: <K tone="teal">API gravity</K>, value: `${fmt(cr.api, 1)}°`, tone: 'teal' },
            { label: 'density', value: `${fmt(cr.sg * 999)} kg/m³` },
            { label: 'boils below 350 °C', value: pct(light) },
            { label: <K tone="gold">sulfur</K>, value: `${fmt(cr.sulfur, 2)}%`, tone: 'gold' },
          ]}
        />
        <Slider
          label="Boiling range"
          tone="orange"
          value={st.tilt}
          min={-0.4}
          max={0.4}
          step={0.05}
          onChange={(v) => s.set({ tilt: Math.round(v * 100) / 100 })}
          display={st.tilt === 0 ? `as produced` : st.tilt < 0 ? `lighter` : `heavier`}
        />
        <Slider
          label="Rings and aromatics"
          tone="violet"
          value={st.aromaticity}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => s.set({ aromaticity: Math.round(v * 100) / 100 })}
          display={`${pct(ringShare(cr))} of the crude`}
        />
        <Caption>
          {st.tilt === 0 && Math.abs(st.aromaticity - SPEC[st.preset].aromaticity) < 1e-9
            ? `${SPEC[st.preset].name} as produced: ${pct(light)} of it boils below 350 °C, the top of the diesel range.`
            : `Changed from ${SPEC[st.preset].name}, which has an API gravity of ${fmt(presetCrude.api, 1)}°.`}
        </Caption>
      </Figure>

      <P>
        Start with Northfield Sour. A little over half of it — {pct(cumulativeYield(nf, 350))} — boils below 350 °C, in the ranges that become LPG, gasoline, jet fuel and
        diesel more or less directly. The rest is <b>vacuum gas oil</b>, which boils from 350 to 550 °C, and <b>vacuum residue</b>, which doesn’t boil at all at any
        temperature a refinery can reach without the molecules breaking apart first. Now switch to Coldwater Heavy: only {pct(cumulativeYield(cw, 350))} of it boils below
        350 °C, and the residue alone is {pct(cw.yields[6])} of the barrel. Ridgeback Light is the opposite case, with {pct(cumulativeYield(rb, 350))} below 350 °C.
      </P>
      <P>
        Look inside the columns too. In every crude, the light cuts are mostly chains and the heavy ones are rich in rings and aromatics. The heaviest molecules — the
        resins and asphaltenes — are where crude oil keeps most of its sulfur, nitrogen and metals.
      </P>

      <H2>API gravity</H2>
      <P>
        The single number most often used to describe a crude is its density, quoted on a scale the American Petroleum Institute introduced, called{' '}
        <K tone="teal">API gravity</K>. It runs backward: the lighter the oil, the higher the number. If SG is the oil’s density relative to water,
      </P>
      <Eq label={`API gravity equals 141.5 divided by the specific gravity, minus 131.5: ${fmt(cr.api, 1)} degrees for a specific gravity of ${fmt(cr.sg, 3)}`}>
        <K tone="teal">API</K>
        <Op>=</Op>
        <Frac top="141.5" bottom={<>SG</>} />
        <Op>−</Op>
        <span>131.5</span>
        <Op>=</Op>
        <Frac top="141.5" bottom={<K tone="teal">{fmt(cr.sg, 3)}</K>} />
        <Op>−</Op>
        <span>131.5</span>
        <Op>=</Op>
        <K tone="teal">{fmt(cr.api, 1)}°</K>
      </Eq>
      <P>
        Water comes out at exactly 10°. Crudes above about 31° are usually called <b>light</b> and those below about 22° <b>heavy</b>, with medium crudes in between;
        the most extreme heavy oils, such as the bitumen from Canada’s oil sands, are denser than water. In our model, a crude’s density is simply the average of its
        cuts’ densities, and each cut’s density is the average of its molecules’. So two things set the API gravity: how much of the crude boils high, and how much of
        it is rings and aromatics, which are denser than chains of the same size. Use the two sliders to try each in turn.
      </P>

      <Challenge
        id="a"
        question={`Make a crude exactly as dense as Northfield Sour — ${fmt(NORTHFIELD_API, 1)}° API, to within half a degree — but with more than 60% of it boiling below 350 °C.`}
        solved={solvedA}
        status={`Right now the crude is ${fmt(cr.api, 1)}° API, and ${pct(light)} of it boils below 350 °C.`}
        success={`Solved: ${fmt(cr.api, 1)}° API with ${pct(light)} boiling below 350 °C, against Northfield Sour’s ${pct(cumulativeYield(nf, 350))}. A lighter boiling range raises the API gravity and more rings and aromatics lower it, so the two can offset each other. Crudes with the same API gravity can yield quite different barrels, which is why refiners buy on the full assay, not on one number.`}
      />

      <H2>Sulfur and metals</H2>
      <P>
        Not every atom in crude oil is carbon or hydrogen. <K tone="gold">Sulfur</K>, bound into the molecules themselves, ranges from under a tenth of a percent by weight
        in the sweetest crudes to around five percent in the most sour. Nitrogen and oxygen come in smaller amounts, and nickel and vanadium, from a few parts per
        million to several hundred or more, sit almost entirely in the asphaltenes. Crude also arrives with some water and salt, which a refinery washes out first.
      </P>
      <P>
        These impurities matter for two reasons. Products have sulfur limits: in the United States, gasoline may average no more than 10 parts per million and road
        diesel no more than 15, jet fuel is limited to 0.3%, and since 2020 the fuel burned by ships has been capped at 0.5% outside special low-emission zones, unless the ship cleans its exhaust. And the
        catalysts a refinery uses to rebuild molecules are poisoned by metals and nitrogen. The next demonstration shows how the crude’s sulfur is spread across its cuts,
        with each cut’s limit marked in red:
      </P>

      <Figure name="Crude Composition Explorer · impurities" scenario={s}>
        {presets}
        <SulfurRows cr={cr} />
        <Slider
          label="Sulfur, whole crude"
          tone="gold"
          value={st.sulfur}
          min={0}
          max={5}
          step={0.01}
          onChange={(v) => s.set({ sulfur: Math.round(v * 100) / 100 })}
          display={`${fmt(st.sulfur, 2)}% by weight`}
        />
        <Slider label="Nickel + vanadium" value={st.metals} min={0} max={500} step={5} onChange={(v) => s.set({ metals: v })} display={`${fmt(st.metals)} ppm`} />
        <Caption>
          The residue carries {fmt(ratio, 1)} times the crude’s average sulfur concentration, and {pct(cr.yields[6] * cr.cutSG[6] * cr.cutMetals[6] / Math.max(1e-9, cr.metals * cr.sg))} of
          its metals.
        </Caption>
      </Figure>

      <P>
        Sulfur piles up at the heavy end. In Northfield Sour, the light naphtha holds about {fmt(round10(nf.cutSulfur[1] * 10000))} ppm while the residue holds{' '}
        {fmt(nf.cutSulfur[6], 1)}%, about twice the crude’s average. Nearly all of the metals end up in the residue. Even the sweetest crude here fails the gasoline and
        diesel limits: straight from the crude, Ridgeback Light’s diesel cut has about {fmt(round10(rb.cutSulfur[4] * 10000))} ppm of sulfur against a 15 ppm limit. Every
        refinery has to remove sulfur; a sour crude just makes it remove much more, from heavier and harder molecules, as we’ll see in{' '}
        <a href={lessonHref('oil/3.3')}>Lesson 3.3</a>.
      </P>

      <Challenge
        id="b"
        question={
          <>
            Some residue is sold as fuel for ships. With Northfield Sour’s boiling range and molecules, find the highest whole-crude sulfur, to the nearest 0.01%, at which
            its residue would still meet the 0.5% marine-fuel cap without any treatment.
          </>
        }
        solved={solvedB}
        status={
          st.preset !== 'northfield' || st.tilt !== 0 || Math.abs(st.aromaticity - SPEC.northfield.aromaticity) > 1e-9
            ? 'Choose Northfield Sour with the buttons, which resets its boiling range and molecules, then lower the sulfur.'
            : `At ${fmt(st.sulfur, 2)}% sulfur, the residue has ${fmtS(residueS)}${residueS > MARINE_CAP ? ', over the cap' : ', within the cap'}.`
        }
        success={`Solved: ${fmt(st.sulfur, 2)}%. The residue concentrates sulfur about ${fmt(ratio, 1)} times, so a crude needs well under half a percent of sulfur for its residue to burn in ships untreated. Northfield Sour’s ${fmt(SPEC.northfield.sulfur, 1)}% is far past that.`}
      />

      <P>
        Asphaltenes, sulfur and metals all point the same way: the heavy end of a crude is the hardest part to turn into valuable fuel. A refinery can treat it, crack it
        or sell it cheaply as fuel oil, but each of those costs something, and buyers know it. That’s why the same few numbers from the assay show up in every price
        quoted for a crude. The <a href={lessonHref('oil/1.3')}>next lesson</a> compares our four crudes on those numbers — density, sulfur, and one we haven’t met yet,
        how easily the oil flows.
      </P>
    </LessonPage>
  );
}
