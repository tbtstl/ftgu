import { useMemo } from 'react';
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
import { ALBATROSS, HANDYSIZE, KESTREL, PETREL, RHO_FRESH, RHO_SEA, VESSEL_CLASSES, VLCC, type VesselClass, type VesselKind } from '../../../model/shipping/vessels';
import { PASSAGES, allowedDraft, checkPassages, designShip, fuelPerKiloTonneMile, type Design, type PassageCheck } from '../../../engines/shipping/design';
import { HULL_FILL, HULL_STROKE, SEA_FILL, SEA_LINE } from '../shared/ShipSide';
import { XYChart } from '../shared/XYChart';

const t = (x: number) => `${fmt(x)} t`;
const m = (x: number, d = 2) => `${fmt(x, d)} m`;

const KIND_LABEL: Record<VesselKind, string> = { bulk: 'Bulk carrier', tanker: 'Tanker', container: 'Container ship' };
const UNIT_LABEL: Record<Design['capacityUnit'], string> = { t: 'tonnes of cargo', bbl: 'barrels of crude', TEU: 'containers, TEU' };

export interface DesignerState {
  kind: VesselKind;
  loa: number;
  beam: number;
  draft: number;
}

/** The starting design: Kestrel's dimensions. */
export const DESIGNER_DEFAULTS: DesignerState = { kind: 'bulk', loa: KESTREL.loa, beam: KESTREL.beam, draft: KESTREL.designDraft };

const SLIDER = {
  loa: { min: 150, max: 400, step: 0.1 },
  beam: { min: 20, max: 65, step: 0.01 },
  draft: { min: 8, max: 23, step: 0.01 },
};

/** The deepest draft on the slider's 0.01 m grid that a ship of this beam can carry through the Neopanamax locks fully laden. */
function deepestNeopanamaxDraft(): number {
  const neo = PASSAGES.find((p) => p.id === 'neopanamax')!;
  let best = SLIDER.draft.min;
  for (let k = 0; k <= Math.round((SLIDER.draft.max - SLIDER.draft.min) / SLIDER.draft.step); k++) {
    const d = Math.round((SLIDER.draft.min + k * SLIDER.draft.step) * 100) / 100;
    if ((d * RHO_SEA) / neo.rho <= neo.maxDraft + 1e-9) best = d;
  }
  return best;
}

/**
 * The challenge's answer: dead weight grows with length, beam and draft alike, so the biggest bulk
 * carrier that passes the Neopanamax locks fully laden sits at their length and beam limits and the
 * deepest draft whose fresh-water draft is within 15.24 m.
 */
export const NEO_BEST = (() => {
  const neo = PASSAGES.find((p) => p.id === 'neopanamax')!;
  const draft = deepestNeopanamaxDraft();
  const d = designShip({ kind: 'bulk', loa: neo.maxLoa, beam: neo.maxBeam, draft });
  return { loa: neo.maxLoa, beam: neo.maxBeam, draft, dwt: d.dwt };
})();

/** True for a bulk carrier that passes the Neopanamax locks fully laden with the most deadweight the sliders allow. */
export function neopanamaxSolved(s: DesignerState): boolean {
  if (s.kind !== 'bulk') return false;
  const d = designShip(s);
  const neo = checkPassages(d).find((c) => c.passage.id === 'neopanamax')!;
  return neo.laden && d.dwt >= NEO_BEST.dwt - 10;
}

function resultText(c: PassageCheck, d: Design): string {
  if (!c.fits) return d.loa > c.passage.maxLoa + 1e-9 ? 'too long' : 'too wide';
  if (c.laden) return 'fully laden';
  if (c.cargoThrough <= 0) return 'only empty';
  return `part-laden ${pct(c.cargoThrough / d.cargoTonnes)}`;
}

function limitText(p: (typeof PASSAGES)[number], beam: number): string {
  const size = p.maxLoa < 400 ? `${fmt(p.maxLoa, 0)} × ${fmt(p.maxBeam, 1)}, ` : '';
  const water = p.rho === RHO_FRESH ? ' fresh' : '';
  return `${size}${fmt(allowedDraft(p, beam), 1)}${water}`;
}

/** Plan-view hull outline, stern at x, bow at x + len. */
function planHull(x: number, cy: number, len: number, half: number, fine: boolean): string {
  const shoulder = fine ? 0.62 : 0.8;
  return [
    `M${x} ${cy - 0.85 * half}`,
    `L${x + 0.08 * len} ${cy - half}`,
    `L${x + shoulder * len} ${cy - half}`,
    `C${x + 0.95 * len} ${cy - half} ${x + len} ${cy - 0.45 * half} ${x + len} ${cy}`,
    `C${x + len} ${cy + 0.45 * half} ${x + 0.95 * len} ${cy + half} ${x + shoulder * len} ${cy + half}`,
    `L${x + 0.08 * len} ${cy + half}`,
    `L${x} ${cy + 0.85 * half}`,
    'Z',
  ].join(' ');
}

/** Spread labels at least `gap` apart vertically, keeping their order. */
function spread<T extends { y: number }>(items: T[], gap = 12): T[] {
  const out = [...items].sort((a, b) => a.y - b.y).map((i) => ({ ...i }));
  for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < gap) out[i].y = out[i - 1].y + gap;
  return out;
}

// Plan view: true scale, 0.95 px per meter.
const PS = 0.95;
const PX = 22;
const ROWS = [
  { id: 'panama' as const, chamber: [304.8, 33.53], cy: 50, label: 'Original Panama locks, 1914' },
  { id: 'neopanamax' as const, chamber: [427, 54.86], cy: 148, label: 'Neopanamax locks, 2016' },
];
// Section: true scale, 1.8 px per meter, with the passages' draft limits drawn across it.
const SS = 1.8;
const SX = 548;
const SWL = 250;
const LINES_X0 = 300;
const LINES_X1 = 632;

// Demonstration 2: a family of bulk carriers from a Handysize to a 400,000-tonne ore carrier.
const SMALL = { loa: 180, beam: 30, draft: 10.5 };
const ORE = { loa: 362, beam: 65, draft: 23 };
function family(k: number): Design {
  const g = (a: number, b: number) => a * (b / a) ** k;
  return designShip({ kind: 'bulk', loa: g(SMALL.loa, ORE.loa), beam: g(SMALL.beam, ORE.beam), draft: g(SMALL.draft, ORE.draft) });
}
const FAMILY = Array.from({ length: 41 }, (_, i) => family(i / 40));
const ORE_SHIP = designShip({ kind: 'bulk', ...ORE });
/** A real ship as a design, with its own deadweight, cargo intake and engine. */
const asDesign = (v: VesselClass): Design => ({ ...v, kind: 'bulk', cargoTonnes: v.dwt - v.consumables, capacity: v.dwt - v.consumables, capacityUnit: 't' });
const NAMED = [
  { name: 'Petrel', v: PETREL },
  { name: 'Kestrel', v: KESTREL },
  { name: 'Albatross', v: ALBATROSS },
].map((n) => ({ ...n, d: asDesign(n.v) }));

const KESTREL_SKETCH = designShip(DESIGNER_DEFAULTS);
const KESTREL_PANAMA = checkPassages(KESTREL_SKETCH).find((c) => c.passage.id === 'panama')!;
const VLCC_SKETCH = designShip({ kind: 'tanker', loa: VLCC.loa, beam: VLCC.beam, draft: VLCC.designDraft });
const VLCC_SUEZ = checkPassages(VLCC_SKETCH).find((c) => c.passage.id === 'suez')!;
const CAPE_NEO = checkPassages(designShip({ kind: 'bulk', loa: ALBATROSS.loa, beam: ALBATROSS.beam, draft: ALBATROSS.designDraft })).find((c) => c.passage.id === 'neopanamax')!;
const F13 = (d: Design) => fuelPerKiloTonneMile(d, 13);
const HANDY13 = F13(asDesign(HANDYSIZE));

export default function Lesson() {
  const ds = useScenario('designer', DESIGNER_DEFAULTS);
  const s = ds.state;
  const d = useMemo(() => designShip(s), [s]);
  const checks = useMemo(() => checkPassages(d), [d]);
  const solved = neopanamaxSolved(s);
  const presets = VESSEL_CLASSES.filter((v) => v.kind === s.kind);
  const preset = presets.find((v) => Math.abs(v.loa - s.loa) < 1e-6 && Math.abs(v.beam - s.beam) < 1e-6 && Math.abs(v.designDraft - s.draft) < 1e-6)?.id ?? '';
  const neo = checks.find((c) => c.passage.id === 'neopanamax')!;
  const capText = d.capacityUnit === 'bbl' ? `${fmt(d.capacity / 1e6, 2)} million` : fmt(d.capacity);

  // Section geometry.
  const half = (s.beam / 2) * SS;
  const keelY = SWL + s.draft * SS;
  const deckY = SWL - (d.depth - s.draft) * SS;
  const limits = spread(
    [
      { id: 'panama', name: 'Panama, original', z: (12.04 * RHO_FRESH) / RHO_SEA },
      { id: 'neopanamax', name: 'Neopanamax', z: (15.24 * RHO_FRESH) / RHO_SEA },
      { id: 'suez', name: 'Suez', z: allowedDraft(PASSAGES[2], s.beam) },
      { id: 'malacca', name: 'Malacca', z: 20.5 },
    ].map((l) => ({ ...l, y: SWL + l.z * SS, lineY: SWL + l.z * SS })),
    11,
  );

  const sc = useScenario('scale', { speed: 13 });
  const curve = useMemo(() => FAMILY.map((f) => fuelPerKiloTonneMile(f, sc.state.speed)), [sc.state.speed]);
  const named = NAMED.map((n) => ({ ...n, f: fuelPerKiloTonneMile(n.d, sc.state.speed) }));
  const oreF = fuelPerKiloTonneMile(ORE_SHIP, sc.state.speed);

  return (
    <LessonPage id="shipping/2.1">
      <P>
        Chapter 1 followed a single ship. Kestrel floated, met the water’s resistance, burned fuel, stayed upright and sailed into the weather, and every one of
        those questions had an answer that depended on her particular length, beam and draft. But Kestrel is one size of ship among many. The world’s merchant
        fleets come in classes, each built around a cargo and around the canals, straits and ports that cargo has to pass.
      </P>
      <P>
        From here on Kestrel has an owner: Northwind Bulk, a small shipping company of our own invention whose fleet we’ll follow to the end of the course. It
        owns two other ships. <i>Albatross</i> is a Capesize, {fmt(ALBATROSS.loa)} meters long and {fmt(ALBATROSS.beam)} meters wide, with a deadweight of{' '}
        {t(ALBATROSS.dwt)} — more than twice Kestrel’s. <i>Petrel</i> is an Ultramax of {t(PETREL.dwt)}, smaller than Kestrel but fitted with four cranes of her
        own, so she can load and discharge at ports with no shore equipment. Why three sizes? What sets how big a ship is built, and what does size buy?
      </P>
      <P>
        Part of the answer is in the names. Many class names record a limit: the largest ship that fits a lock, a canal or a berth. The next demonstration
        sketches a ship from three numbers — its overall length, its <K tone="blue">beam</K> and its summer <K tone="blue">draft</K> — using proportions taken
        from real ships of each kind: a block coefficient, a depth in proportion to the draft, and an empty weight in proportion to the hull’s volume. On the left
        the design is drawn from above, to scale, inside the lock chambers of the Panama Canal; on the right is its midship section with the draft each passage
        allows. Choose a kind of ship and one of its classes, or drag the dimensions yourself:
      </P>

      <Figure name="Vessel Designer" scenario={ds}>
        <Segmented
          label="Kind of ship"
          value={s.kind}
          onChange={(kind) => {
            const v = VESSEL_CLASSES.find((c) => c.kind === kind && (kind !== 'bulk' || c.id === KESTREL.id))!;
            ds.set({ kind, loa: v.loa, beam: v.beam, draft: v.designDraft });
          }}
          options={(['bulk', 'tanker', 'container'] as VesselKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        />
        <Segmented
          label="Class"
          value={preset}
          onChange={(id) => {
            const v = VESSEL_CLASSES.find((c) => c.id === id)!;
            ds.set({ loa: v.loa, beam: v.beam, draft: v.designDraft });
          }}
          options={presets.map((v) => ({ value: v.id, label: v.name.replace(' container ship', '').replace('Ultra-large', 'ULCV') }))}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 318"
          role="img"
          aria-label={`A ${KIND_LABEL[s.kind].toLowerCase()} ${m(s.loa, 1)} long, ${m(s.beam)} wide, drawing ${m(s.draft)}: ${t(d.dwt)} deadweight. ${checks.map((c) => `${c.passage.name}: ${resultText(c, d)}`).join('; ')}.`}
        >
          {ROWS.map((r) => {
            const p = PASSAGES.find((x) => x.id === r.id)!;
            const c = checks.find((x) => x.passage.id === r.id)!;
            const [cl, cw] = r.chamber;
            const ok = c.fits;
            const color = !ok ? TEXT.red : c.laden ? TEXT.green : TEXT.orange;
            return (
              <g key={r.id}>
                <text x={PX} y={r.cy - 34} className="ax">
                  {r.label}
                </text>
                <text x={PX + 427 * PS} y={r.cy - 34} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: color }}>
                  {resultText(c, d)}
                </text>
                <rect x={PX} y={r.cy - (cw * PS) / 2} width={cl * PS} height={cw * PS} fill={SEA_FILL} stroke="#8a8a8a" strokeWidth={1.2} />
                <rect
                  x={PX + 2}
                  y={r.cy - (p.maxBeam * PS) / 2}
                  width={p.maxLoa * PS}
                  height={p.maxBeam * PS}
                  fill="none"
                  stroke="#8a8a8a"
                  strokeDasharray="4 3"
                />
                <path
                  d={planHull(PX + 2, r.cy, s.loa * PS, (s.beam / 2) * PS, s.kind === 'container')}
                  fill={ok ? HULL_FILL : tint(GRAPHIC.red, 0.35)}
                  stroke={ok ? HULL_STROKE : GRAPHIC.red}
                  strokeWidth={1.4}
                  opacity={0.92}
                />
              </g>
            );
          })}
          <line x1={PX} x2={PX + 100 * PS} y1={204} y2={204} stroke="#5f5f5f" strokeWidth={1.5} />
          <text x={PX + 50 * PS} y={198} textAnchor="middle" className="ax">
            100 m
          </text>
          <text x={PX + 110 * PS} y={208} className="ax">
            Dashed: the largest ship each lock takes
          </text>
          {/* midship section and draft limits */}
          <text x={LINES_X0 - 4} y={240} textAnchor="end" className="ax">
            Midship section · draft limits as sea-water drafts
          </text>
          <rect x={LINES_X0} y={SWL} width={LINES_X1 - LINES_X0} height={316 - SWL} fill={SEA_FILL} opacity={0.7} />
          <path
            d={`M${SX - half} ${deckY} L${SX - half} ${keelY - 0.12 * half} Q${SX - half} ${keelY} ${SX - 0.88 * half} ${keelY} L${SX + 0.88 * half} ${keelY} Q${SX + half} ${keelY} ${SX + half} ${keelY - 0.12 * half} L${SX + half} ${deckY} Z`}
            fill={HULL_FILL}
            stroke={HULL_STROKE}
            strokeWidth={1.4}
            opacity={0.9}
          />
          <line x1={LINES_X0} x2={LINES_X1} y1={SWL} y2={SWL} stroke={SEA_LINE} strokeWidth={1.5} />
          {limits.map((l) => (
            <g key={l.id}>
              <line x1={LINES_X0} x2={LINES_X1} y1={l.lineY} y2={l.lineY} stroke="#5f5f5f" strokeDasharray="3 3" />
              <text x={LINES_X0 - 4} y={l.y + 4} textAnchor="end" className="ax">
                {l.name} {fmt(l.z, 1)} m
              </text>
            </g>
          ))}
          <text x={SX + half + 6} y={keelY + 4} style={{ fontSize: 12, fontWeight: 600, fill: TEXT.blue }}>
            {m(s.draft, 1)}
          </text>
        </svg>
        <Readouts
          items={[
            { label: 'deadweight', value: t(d.dwt), tone: 'orange' },
            { label: UNIT_LABEL[d.capacityUnit], value: capText, tone: 'orange' },
            { label: 'draft in the Panama locks’ fresh water', value: m((s.draft * RHO_SEA) / RHO_FRESH), tone: 'blue' },
          ]}
        />
        <Slider label="Length overall" tone="blue" value={s.loa} min={SLIDER.loa.min} max={SLIDER.loa.max} step={SLIDER.loa.step} onChange={(v) => ds.set({ loa: v })} display={m(s.loa, 1)} />
        <Slider label="Beam" tone="blue" value={s.beam} min={SLIDER.beam.min} max={SLIDER.beam.max} step={SLIDER.beam.step} onChange={(v) => ds.set({ beam: v })} display={m(s.beam)} />
        <Slider label="Summer draft" tone="blue" value={s.draft} min={SLIDER.draft.min} max={SLIDER.draft.max} step={SLIDER.draft.step} onChange={(v) => ds.set({ draft: v })} display={m(s.draft)} />
        <DataTable
          caption="Whether the design can pass each canal and strait, and how much of a full cargo it could carry through"
          rows={checks}
          rowKey={(c) => c.passage.id}
          columns={[
            { label: 'Passage', cell: (c) => c.passage.name.replace('Panama Canal, ', 'Panama, ') },
            { label: 'Limits, m: length × beam, draft', cell: (c) => limitText(c.passage, s.beam), align: 'left' },
            { label: 'This design', cell: (c) => resultText(c, d), align: 'right' },
          ]}
        />
      </Figure>

      <P>
        The designer starts with Kestrel’s dimensions. It estimates her deadweight at {t(KESTREL_SKETCH.dwt)}, within {pct(Math.abs(KESTREL_SKETCH.dwt / KESTREL.dwt - 1), 0)}{' '}
        of her real {t(KESTREL.dwt)}: close enough to compare designs, though no substitute for a naval architect. She is {fmt(KESTREL.beam, 2)} meters wide, a
        few centimeters inside the {m(32.31)} that the original Panama Canal locks allow, and at {fmt(KESTREL.loa)} meters she is far shorter than their limit of{' '}
        {m(294.13)}. Ships built to that beam were called <b>Panamax</b>, and for decades the number shaped ships in trade after trade.
      </P>
      <P>
        Length and beam aren’t the whole test. The locks lift ships 26 meters up to Gatun Lake and lower them again, and they are filled with the lake’s fresh
        water. As <a href={lessonHref('shipping/1.1')}>Lesson 1.1</a> showed, a ship floats deeper in fresh water, so the limit of 12.04 meters is measured there. In
        our model the draft in fresh water is the sea draft times 1.025: Kestrel, down to her summer marks at {m(KESTREL.designDraft)}, would draw{' '}
        {m(KESTREL.designDraft * RHO_SEA)} in the locks. She can still go through, but only part-laden, with about {pct(KESTREL_PANAMA.cargoThrough / KESTREL_SKETCH.cargoTonnes)} of a
        full cargo. Her class takes its name from a different limit: 229 meters is the longest ship the bauxite port of Kamsar, in Guinea, could take, so a
        Kamsarmax is a Panamax stretched to fit it.
      </P>

      <H2>Ships named for their limits</H2>
      <P>
        In 2016 Panama opened a second, larger set of locks, whose limits — {m(366, 0)} long, {m(51.25)} wide and {m(15.24)} of draft in fresh water — define the{' '}
        <b>Neopanamax</b>. Choose Albatross’s class, the Capesize: she now fits by length and beam, but her {m(ALBATROSS.designDraft, 1)} draft is far too deep, so
        she could carry only {pct(CAPE_NEO.cargoThrough / designShip({ kind: 'bulk', loa: ALBATROSS.loa, beam: ALBATROSS.beam, draft: ALBATROSS.designDraft }).cargoTonnes)} of a
        full cargo through. Capesizes are named for the route they were built to take: too big for the Panama Canal and, when the name stuck, for a laden transit of
        Suez, they sailed round the Cape of Good Hope or Cape Horn. Suez has since been deepened, and the designer lets a laden Capesize through, but the great
        Capesize trade, iron ore from Brazil to China, still rounds the Cape of Good Hope because that is the shorter way.
      </P>
      <P>
        Switch to tankers. The <b>Suezmax</b> is the largest tanker that can transit the Suez Canal fully laden. The canal has no locks, so its limit is the depth
        of its channel: 20.1 meters (66 feet) of draft for ships up to 50 meters wide, and less for wider ships. (The real rules give a table of beams and drafts; our
        model simplifies it to a straight line down to 12 meters at the canal’s maximum beam of 77.5 meters.) A <b>VLCC</b>, a very large crude carrier, holds
        about {fmt(VLCC_SKETCH.capacity / 1e6, 1)} million barrels and draws {m(VLCC.designDraft, 1)} laden. At {m(VLCC.beam, 0)} wide it may draw only{' '}
        {m(allowedDraft(PASSAGES[2], VLCC.beam), 1)} in the canal, so it can take just {pct(VLCC_SUEZ.cargoThrough / VLCC_SKETCH.cargoTonnes)} of its cargo through. The
        Strait of Malacca, the shortest sea route from the Indian Ocean to the Pacific, admits ships up to about 20.5 meters of draft, a size sometimes called
        Malaccamax. Container ships, finally, are measured not in tonnes but in <b>TEU</b>, twenty-foot equivalent units: the number of standard
        twenty-foot boxes they can stack.
      </P>
      <P>
        Each kind of ship is built to the limits of the trades it serves. A bulk carrier that could pass the new Panama locks fully laden could carry grain from
        the US Gulf to Asia by the shortest route, so it’s worth asking how big that ship could be.
      </P>

      <Challenge
        id="a"
        figure="Vessel Designer"
        question="Design the bulk carrier with the most deadweight that can pass through the Neopanamax locks fully laden."
        solved={solved}
        status={
          s.kind !== 'bulk'
            ? 'Switch the kind of ship to a bulk carrier first.'
            : !neo.fits
              ? `At ${m(s.loa, 1)} by ${m(s.beam)}, the design doesn’t fit the Neopanamax locks.`
              : !neo.laden
                ? `It fits, but at ${m(s.draft)} it would draw ${m((s.draft * RHO_SEA) / RHO_FRESH)} in the locks’ fresh water, over the 15.24 m limit.`
                : `It passes fully laden with ${t(d.dwt)} of deadweight. Can it carry more?`
        }
        success={`Solved. Deadweight grows with length, beam and draft alike, so the answer sits on every limit at once: ${m(NEO_BEST.loa, 0)} long, ${m(NEO_BEST.beam)} wide and a summer draft of ${m(NEO_BEST.draft)}, which becomes ${m(NEO_BEST.draft * RHO_SEA)} in the locks’ fresh water. One centimeter deeper and she would be over. She would carry ${t(NEO_BEST.dwt)} of deadweight, more than Albatross. Notice that the lock’s fresh water costs her ${fmt((15.24 - NEO_BEST.draft) * 100)} centimeters: at sea she floats well short of 15.24 m.`}
      />

      <H2>What size buys</H2>
      <P>
        Why build ships so big that they press against every limit? Mostly because a big ship moves each tonne of cargo for less fuel. The water drags on a hull’s
        wetted surface, which grows with the square of its size, while the cargo it carries grows with the cube. In the next demonstration the curve is the
        designer’s family of bulk carriers, from a Handysize of {fmt(SMALL.loa)} meters to an ore carrier {fmt(ORE.loa)} meters long, {fmt(ORE.beam)} wide and
        drawing {fmt(ORE.draft)} meters — about the size of the 400,000-tonne ore carriers built for the Brazilian miner Vale, the largest bulk carriers afloat.
        The dots are Northwind’s three ships. The height is the fuel each burns, laden, to carry one tonne of cargo a thousand nautical miles. Change the speed:
      </P>

      <Figure name="Vessel Designer · economies of scale" scenario={sc}>
        <XYChart
          ariaLabel={`Fuel per tonne of cargo per thousand nautical miles against deadweight at ${fmt(sc.state.speed, 1)} knots: Petrel ${fmt(named[0].f, 2)} kg, Kestrel ${fmt(named[1].f, 2)} kg, Albatross ${fmt(named[2].f, 2)} kg, the 400,000-tonne ore carrier ${fmt(oreF, 2)} kg.`}
          series={[{ xs: FAMILY.map((f) => f.dwt), ys: curve, color: GRAPHIC.gold, width: 2.5 }]}
          xMin={0}
          xMax={420_000}
          yMin={0}
          yMax={2.5}
          yTicks={[0, 0.5, 1, 1.5, 2, 2.5]}
          xTicks={[0, 100_000, 200_000, 300_000, 400_000]}
          xFormat={(x) => (x === 0 ? '0' : `${fmt(x / 1000)}k`)}
          yFormat={(y) => fmt(y, 1)}
          xLabel="Deadweight, tonnes"
          yLabel="Fuel, kg per tonne of cargo per 1,000 nautical miles"
          markers={[
            ...named.map((n, i) => ({ x: n.v.dwt, y: n.f, color: TEXT.gold, label: n.name, anchor: i === 0 ? ('end' as const) : ('start' as const), labelDy: -10 })),
            { x: ORE_SHIP.dwt, y: oreF, color: TEXT.gray, label: 'ore carrier', anchor: 'end' as const, labelDy: -12 },
          ]}
          height={240}
        />
        <Readouts
          items={[
            { label: 'Petrel, kg per 1,000 tonne-miles', value: fmt(named[0].f, 2), tone: 'gold' },
            { label: 'Kestrel', value: fmt(named[1].f, 2), tone: 'gold' },
            { label: 'Albatross', value: fmt(named[2].f, 2), tone: 'gold' },
          ]}
        />
        <Slider label="Speed" tone="teal" value={sc.state.speed} min={10} max={15} step={0.5} onChange={(v) => sc.set({ speed: v })} display={`${fmt(sc.state.speed, 1)} kn`} />
        <Caption>
          At {fmt(sc.state.speed, 1)} knots Albatross burns {pct(1 - named[2].f / named[1].f)} less fuel per tonne-mile than Kestrel, and the ore carrier{' '}
          {pct(1 - oreF / named[1].f)} less.
        </Caption>
      </Figure>

      <P>
        At 13 knots Kestrel burns {fmt(F13(NAMED[1].d), 2)} kilograms of fuel to move a tonne of cargo a thousand miles, Albatross {fmt(F13(NAMED[2].d), 2)} and the
        ore carrier {fmt(F13(ORE_SHIP), 2)}. A real Handysize of {t(HANDYSIZE.dwt)} needs {fmt(HANDY13, 2)}, {fmt(HANDY13 / F13(NAMED[2].d), 1)} times as much as
        Albatross. Speed matters in the same way it did for Kestrel alone: every ship’s fuel per tonne-mile rises steeply as it goes faster, but the big ones stay
        cheaper at every speed. The other costs of a ship scale down too. A Capesize sails with roughly the same crew as a Handysize, about twenty people, and a
        bigger hull costs less to build per tonne it carries; we’ll put prices on a ship’s day in <a href={lessonHref('shipping/2.4')}>Lesson 2.4</a>.
      </P>
      <P>
        So why doesn’t everything sail in ore carriers? Because size also takes things away. Go back to <FigRef to="Vessel Designer">the first
        demonstration</FigRef> and make the ship bigger: one passage after another closes. The same happens at ports, where a berth’s depth, the reach of its
        loaders and the length of its quay limit what can come alongside, and a draft of 23 meters rules out all but a handful of terminals in the world. A big
        ship also needs a big cargo, all in one place at one time: a Capesize load is the output of a large mine or the intake of a large steel mill, while a
        Handysize can take a few thousand tonnes of fertilizer to a river port with no cranes. Each class therefore works its own set of trades — ore and coal for
        Capesizes; grain, coal and minor bulks for Kamsarmaxes and Ultramaxes — and, as Chapter 4 will show, each has a freight market and a price of its own.
      </P>
      <P>
        A ship earns nothing while she sits in port, though, and how quickly a cargo goes in and comes out depends on the terminal, the ship’s own equipment and
        the order in which her holds are filled. In <a href={lessonHref('shipping/2.2')}>the next lesson</a> we’ll load Kestrel against the clock.
      </P>
    </LessonPage>
  );
}
