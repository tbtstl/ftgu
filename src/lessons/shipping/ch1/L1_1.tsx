import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  GRAPHIC,
  TEXT,
  Tn,
  fmt,
  lessonHref,
  useScenario,
} from '../../../framework';
import { KESTREL, RHO_FRESH, RHO_SEA } from '../../../model/shipping/vessels';
import {
  deadweight,
  displacementAt,
  draftFor,
  draftSurvey,
  freshWaterAllowanceMm,
  loadLines,
  maxCargo,
  summerDisplacement,
  tpc,
} from '../../../engines/shipping/hydrostatics';
import { LoadLineMarks, ShipSide } from '../shared/ShipSide';
import { XYChart } from '../shared/XYChart';

const K_ = KESTREL;
const CONSUMABLES = K_.consumables;
const MAX_CARGO = maxCargo(K_, CONSUMABLES);
const SUMMER = summerDisplacement(K_);
const DWT = deadweight(K_);
const TPC = tpc(K_);
const FWA_MM = freshWaterAllowanceMm(K_);
const MARKS = loadLines(K_);
/** Ballast arrival condition for the draft survey. */
const ARRIVAL_BALLAST = K_.ballast;
const ARRIVAL_DISP = K_.lightship + CONSUMABLES + ARRIVAL_BALLAST;
/** Stowage used only to draw how full the holds look (a coal-like 1.2 m³/t). */
const DRAW_STOWAGE = 1.2;

const t = (x: number) => `${fmt(x)} t`;
const m2 = (x: number) => `${fmt(x, 2)} m`;

/** Kestrel's state for a load, hull fullness and water density. */
export function floating(cargo: number, cb: number, rho: number) {
  const hull = { ...K_, cb };
  const displacement = K_.lightship + CONSUMABLES + cargo;
  const draft = draftFor(hull, displacement, rho);
  const seaDraft = draftFor(hull, displacement, RHO_SEA);
  return { hull, displacement, draft, seaDraft, freeboard: K_.depth - draft, summerDisp: displacementAt(hull, K_.designDraft, RHO_SEA) };
}

/**
 * The challenge: loading in fresh water, take on as much cargo as the summer mark allows once the
 * ship reaches the sea — within one 100-tonne slider step of the limit, and never over it.
 */
export function freshLoadSolved(cargo: number, cb: number, rho: number) {
  if (rho > RHO_FRESH + 1e-9 || Math.abs(cb - K_.cb) > 1e-9) return false;
  const f = floating(cargo, cb, rho);
  return f.seaDraft <= K_.designDraft + 1e-9 && cargo > MAX_CARGO - 100;
}

/** Drafts are read to the nearest centimeter. */
const readDraft = (d: number) => Math.round(d * 100) / 100;

export function surveyResult(cargo: number, ballastLeft: number, dockRho: number, assumeSea: boolean) {
  const before = { draft: readDraft(draftFor(K_, ARRIVAL_DISP, dockRho)), ballast: ARRIVAL_BALLAST, consumables: CONSUMABLES };
  const afterDisp = K_.lightship + CONSUMABLES + ballastLeft + cargo;
  const after = { draft: readDraft(draftFor(K_, afterDisp, dockRho)), ballast: ballastLeft, consumables: CONSUMABLES };
  const s = draftSurvey(K_, before, after, assumeSea ? RHO_SEA : dockRho);
  return { before, after, ...s, error: s.cargo - cargo };
}

export default function Lesson() {
  const sim = useScenario('floating', { cargo: 40_000, cb: K_.cb, rho: RHO_SEA });
  const { cargo, cb, rho } = sim.state;
  const f = floating(cargo, cb, rho);
  const overSummer = f.seaDraft > K_.designDraft + 1e-9;
  const solved = freshLoadSolved(cargo, cb, rho);
  const fill = Math.min(1, (cargo * DRAW_STOWAGE) / (K_.holdVolume ?? 1));
  const water = rho <= 1.0005 ? 'fresh water' : rho >= 1.0245 ? 'sea water' : 'brackish water';

  const ds = useScenario('draft-survey', { cargo: 72_000, ballastLeft: 0, dockRho: 1.012, surveyor: 'dock' as 'dock' | 'sea' });
  const sv = surveyResult(ds.state.cargo, ds.state.ballastLeft, ds.state.dockRho, ds.state.surveyor === 'sea');
  const surveyRho = ds.state.surveyor === 'sea' ? RHO_SEA : ds.state.dockRho;
  const curve = useMemo(() => ({ xs: Array.from({ length: 21 }, (_, i) => 6 + i * 0.5) }), []);

  // Side-view geometry.
  const KEEL = 214;
  const sideX = 14;
  const sideW = 430;
  const sz = (sideW / K_.loa) * 2.6;
  const wlY = KEEL - f.draft * sz;
  const deckY = KEEL - K_.depth * sz;
  const dimX = sideX + sideW * 0.5;

  const fwaExample = freshWaterAllowanceMm(K_);

  return (
    <LessonPage id="shipping/1.1">
      <P>
        A ship is transportation capacity that moves, slowly. Most of what the world trades in bulk — iron ore, coal, grain, crude oil — crosses an ocean in a hull
        like the one we’ll follow through this course, and what it costs to send a tonne of cargo from Brazil to China depends on how many such hulls happen to be
        in the right place at the right time. Before we can price that capacity we need to know where it comes from. So we’ll start with a single ship and the
        oldest question in naval architecture: how much can it carry?
      </P>
      <P>
        Our ship is <i>Kestrel</i>, a bulk carrier of a size the industry calls a Kamsarmax: 229 meters long, 32.25 meters wide and 20 meters deep from her keel
        to her main deck. Empty, with no fuel, water or cargo aboard, her steel and machinery weigh {t(K_.lightship)}. Steel is nearly eight times as dense as
        water, yet she floats — and loaded, she carries close to seven times her own weight in cargo.
      </P>
      <P>
        The reason is Archimedes’ principle: a floating body sinks until it has pushed aside its own weight of water. The weight of a ship and everything in it is
        called its <K tone="orange">displacement</K>, because it equals the weight of the water it displaces. The depth of the keel below the water’s surface is
        the <K tone="blue">draft</K>, and the height of the deck above the water is the <b>freeboard</b>. In the next demonstration, load cargo into Kestrel and
        watch her settle. The side view stretches heights 2.6 times so that a meter of draft is visible; the panel on the right shows the marks painted on her
        side at true scale. You can also change how full her hull is and what kind of water she floats in:
      </P>

      <Figure name="Floating Ship Simulator" scenario={sim}>
        <svg
          className="diagram"
          viewBox="0 0 640 262"
          role="img"
          aria-label={`Kestrel with ${t(cargo)} of cargo in ${water} of density ${rho.toFixed(3)}: displacement ${t(f.displacement)}, draft ${m2(f.draft)}, freeboard ${m2(f.freeboard)}.${overSummer ? ' Her summer load line is under water.' : ''}`}
        >
          <ShipSide v={K_} draft={f.draft} x={sideX} width={sideW} keelY={KEEL} holds={Array(7).fill(fill)} cargoColor="#b9a58b" />
          {/* draft and freeboard dimensions */}
          <line x1={dimX} x2={dimX} y1={KEEL} y2={wlY} stroke={TEXT.blue} strokeWidth={1.5} />
          <line x1={dimX - 5} x2={dimX + 5} y1={KEEL} y2={KEEL} stroke={TEXT.blue} strokeWidth={1.5} />
          <text x={dimX + 6} y={(KEEL + wlY) / 2 + 4} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.blue }}>
            draft {m2(f.draft)}
          </text>
          {f.freeboard > 0 && (
            <g>
              <line x1={dimX - 40} x2={dimX - 40} y1={wlY} y2={deckY} stroke="#5f5f5f" strokeWidth={1.2} />
              <text x={dimX - 46} y={(wlY + deckY) / 2 + 4} textAnchor="end" className="ax">
                freeboard {m2(f.freeboard)}
              </text>
            </g>
          )}
          <text x={470} y={14} className="ax">
            Load-line marks, true scale
          </text>
          <LoadLineMarks
            marks={(['TF', 'F', 'T', 'S', 'W'] as const).map((id) => ({ id, draft: MARKS[id] }))}
            draft={f.draft}
            depth={K_.depth}
            x={470}
            y={22}
            width={154}
            height={200}
            span={1.6}
            center={K_.designDraft + 0.2}
          />
          <text x={470} y={240} className="ax">
            S summer · T tropical · W winter
          </text>
          <text x={470} y={255} className="ax">
            F fresh · TF tropical fresh
          </text>
        </svg>
        <Readouts
          items={[
            { label: 'displacement', value: t(f.displacement), tone: 'orange' },
            { label: `draft in ${water}`, value: m2(f.draft), tone: 'blue' },
            {
              label: overSummer ? 'over the summer limit, at sea' : 'more she could load before the summer mark, at sea',
              value: t(Math.abs(f.summerDisp - f.displacement)),
              tone: overSummer ? 'red' : undefined,
            },
          ]}
        />
        <Slider label="Cargo" tone="orange" value={cargo} min={0} max={90_000} step={100} onChange={(v) => sim.set({ cargo: v })} display={t(cargo)} />
        <Slider label="Hull fullness, block coefficient" tone="blue" value={cb} min={0.6} max={0.9} step={0.01} onChange={(v) => sim.set({ cb: v })} display={cb.toFixed(2)} />
        <Slider label="Water density" tone="blue" value={rho} min={1.0} max={1.03} step={0.001} onChange={(v) => sim.set({ rho: v })} display={`${rho.toFixed(3)} t/m³`} />
        <Eq label={`Draft equals displacement divided by density times block coefficient times length times beam: ${fmt(f.draft, 2)} meters`}>
          <K tone="blue">T</K>
          <Op>=</Op>
          <Frac top={<K tone="orange">Δ</K>} bottom={<span>ρ × C<sub>b</sub> × L × B</span>} />
          <Op>=</Op>
          <Frac
            top={<Tn tone="orange">{fmt(f.displacement)} t</Tn>}
            bottom={
              <span>
                {rho.toFixed(3)} × {cb.toFixed(2)} × 225 × 32.25
              </span>
            }
          />
          <Op>=</Op>
          <K tone="blue">{m2(f.draft)}</K>
        </Eq>
      </Figure>

      <P>
        The equation is Archimedes’ principle with the hull’s shape written out. Underwater, Kestrel is close to a long box 225 meters between her bow and stern
        and 32.25 meters wide, filled to the depth of her draft. The <K tone="blue">block coefficient</K>, C<sub>b</sub>, is the fraction of that box her hull
        actually fills once the rounded bilges and the tapering bow and stern are taken out: 0.87 for Kestrel. Multiply the volume by the water’s density ρ, in
        tonnes per cubic meter, and you have the weight of water displaced. Real hulls are finer near the keel than at the waterline, so their block coefficient
        changes a little with draft; our model keeps it fixed, which makes the draft rise in exact proportion to the weight aboard.
      </P>
      <P>
        Empty except for her fuel and stores, Kestrel floats at just {m2(draftFor(K_, K_.lightship + CONSUMABLES))} — too shallow for her propeller to bite
        properly, which is why ships sailing without cargo take on seawater ballast, as we’ll see in <a href={lessonHref('shipping/1.4')}>Lesson 1.4</a>. Each
        tonne loaded after that pushes her deeper by the same amount: {fmt(TPC, 1)} tonnes sink her one centimeter. That number, the <b>tonnes per centimeter
        immersion</b>, is the area of her waterline times the density of the water.
      </P>
      <P>
        Now drag the block coefficient down to 0.60, the fineness of a fast container ship. At the same draft the hull displaces about a third less water, so the
        same load sinks it deeper. A full, boxy hull carries the most cargo for its length, beam and draft; a fine one is easier to push through the water, as
        the next lesson will show. Bulk carriers and tankers, which carry low-value cargo slowly, are built full; container ships, which carry expensive goods
        on tight schedules, are built fine.
      </P>

      <H2>Deadweight</H2>
      <P>
        How deep may Kestrel go? Her owners can’t simply load until the deck is awash: a ship needs freeboard to keep green water off her deck in a seaway and
        reserve buoyancy to survive damage. The limit is set by an international treaty, the Load Lines Convention of 1966, and for Kestrel it puts her summer
        draft in sea water at {m2(K_.designDraft)}, leaving {m2(K_.depth - K_.designDraft)} of freeboard. At that draft she displaces {t(SUMMER)}.
      </P>
      <P>
        Subtract her empty weight and what remains is her <K tone="orange">deadweight</K>: {t(DWT)}, everything she can carry, in tonnes. This is the number
        ships are classed and sold by — an “82,000-tonne Kamsarmax” means 82,000 tonnes deadweight. Not all of it is cargo. On a typical voyage she also carries
        about {t(CONSUMABLES)} of fuel, fresh water, stores and spare parts, so her cargo intake is closer to {t(MAX_CARGO)}. Every tonne of extra fuel she takes
        on is a tonne of cargo she can’t, which is one reason ships bunker no more than they need for the next leg.
      </P>

      <H2>Fresh water and the load line</H2>
      <P>
        The painted marks in the demonstration are the ship’s <b>load lines</b>. They are often called the Plimsoll mark, after Samuel Plimsoll, the British member
        of Parliament whose campaign against dangerously overloaded “coffin ships” led to the Merchant Shipping Act of 1876. The disc and its bar mark the summer
        draft. The ladder beside it adjusts the limit for the season and the sea: ships may load deeper in the calm tropics (T) and must load shallower in winter
        (W), by a forty-eighth of the summer draft — {fmt((K_.designDraft / 48) * 100, 1)} centimeters for Kestrel.
      </P>
      <P>
        The fresh-water marks exist because of the density term in the equation. River water is lighter than sea water — about 1.000 tonne per cubic meter
        against 1.025 — so the same ship floats deeper in it. Set the density to 1.000 in{' '}
        <FigRef to="Floating Ship Simulator">the first demonstration</FigRef> at full load and Kestrel settles {fmt(FWA_MM)} millimeters lower than in
        the sea. That difference is her <K tone="blue">fresh water allowance</K>, and it has a tidy formula: displacement divided by four times the tonnes per
        centimeter, Δ ÷ (4 × TPC), in millimeters. A ship loading at a river berth may submerge her summer mark by exactly that much, because she’ll rise back to
        it as she reaches salt water.
      </P>

      <Challenge
        id="a"
        question="Kestrel is loading at a river berth in fresh water and will sail straight out to sea. With her hull fullness at 0.87, load as much cargo as you can without her summer mark being under water once she reaches the sea."
        solved={solved}
        status={
          Math.abs(cb - K_.cb) > 1e-9
            ? `Set the hull fullness back to Kestrel’s 0.87 first.`
            : rho > RHO_FRESH + 1e-9
              ? `The berth is in fresh water: set the density to 1.000. Right now it is ${rho.toFixed(3)}.`
              : overSummer
                ? `At sea, ${t(cargo)} would put her ${fmt((f.seaDraft - K_.designDraft) * 100, 1)} cm past the summer mark.`
                : `At sea, ${t(cargo)} would leave her ${fmt((K_.designDraft - f.seaDraft) * 100, 1)} cm short of the summer mark: room for ${t(f.summerDisp - f.displacement)} more.`
        }
        success={`Solved. With ${t(cargo)} aboard, she floats at ${m2(f.draft)} in the river — ${fmt((f.draft - K_.designDraft) * 1000)} mm past her summer mark, almost exactly her ${fmt(fwaExample)} mm fresh water allowance, so the F mark sits at the surface. In the sea the same weight floats ${fmt(((f.draft - f.seaDraft) * 1000))} mm higher, right at the summer mark. Loading by the summer mark in the river would have left about ${t(f.summerDisp - displacementAt(K_, K_.designDraft, RHO_FRESH))} of paying cargo on the quay.`}
      />

      <H2>Weighing a cargo with the sea</H2>
      <P>
        Archimedes also hands the shipping business its scale. A bulk cargo pours aboard as a stream, not in countable pieces, so its quantity — the number on
        the bill of lading that the buyer pays for and the freight is charged on — is often settled, or checked, by a <b>draft survey</b>. A surveyor reads
        the draft marks at the bow, the middle and the stern, on both sides, before and after loading. Each set of readings gives a displacement; the difference,
        less any change in the ballast water and fuel aboard, is the cargo.
      </P>
      <P>
        In the next demonstration, Kestrel arrives at a loading terminal in ballast, carrying {t(ARRIVAL_BALLAST)} of seawater ballast, and pumps it out as she
        loads. The chart draws the first demonstration’s equation as a line — displacement rising in proportion to draft — for the water density the surveyor uses, and
        the two dots are the surveyor’s readings, rounded to the nearest centimeter, as draft marks are read. Set how much cargo really went aboard, the ballast left in her tanks and the density of the dock
        water — then see what happens if the surveyor skips measuring the dock water and assumes it’s sea water:
      </P>

      <Figure name="Floating Ship Simulator · draft survey" scenario={ds}>
        <Segmented
          label="Density the surveyor uses"
          value={ds.state.surveyor}
          onChange={(v) => ds.set({ surveyor: v })}
          options={[
            { value: 'dock', label: 'Measured dock water' },
            { value: 'sea', label: 'Assumes sea water' },
          ]}
        />
        <XYChart
          ariaLabel={`Kestrel’s displacement against draft at ${surveyRho.toFixed(3)} t/m³. Before loading she reads ${m2(sv.before.draft)}, ${t(sv.dispBefore)}; after, ${m2(sv.after.draft)}, ${t(sv.dispAfter)}. The survey finds ${t(sv.cargo)} of cargo against ${t(ds.state.cargo)} loaded.`}
          series={[{ xs: curve.xs, ys: curve.xs.map((d) => displacementAt(K_, d, surveyRho)), color: GRAPHIC.orange, width: 2 }]}
          xMin={6}
          xMax={16}
          yMin={30_000}
          yMax={110_000}
          yTicks={[40_000, 60_000, 80_000, 100_000]}
          xTicks={[6, 8, 10, 12, 14, 16]}
          xFormat={(v) => `${v} m`}
          yFormat={(v) => `${fmt(v / 1000)}k t`}
          xLabel="Mean draft read from the marks"
          yLabel={`Displacement at ${surveyRho.toFixed(3)} t/m³`}
          left={64}
          markers={[
            { x: sv.before.draft, y: sv.dispBefore, color: TEXT.orange, label: `before: ${m2(sv.before.draft)}, ${t(sv.dispBefore)}`, anchor: 'start', labelDy: 18 },
            { x: sv.after.draft, y: sv.dispAfter, color: TEXT.orange, label: `after: ${m2(sv.after.draft)}, ${t(sv.dispAfter)}`, anchor: 'end', labelDy: -12 },
          ]}
          overlay={(x, y) => {
            const yb = y(sv.dispBefore);
            const ya = y(sv.dispAfter);
            const xr = x(15.7);
            return (
              <g>
                <line x1={x(sv.before.draft)} x2={xr} y1={yb} y2={yb} stroke="#9a9a9a" strokeDasharray="3 3" />
                <line x1={x(sv.after.draft)} x2={xr} y1={ya} y2={ya} stroke="#9a9a9a" strokeDasharray="3 3" />
                <line x1={xr} x2={xr} y1={ya} y2={yb} stroke={TEXT.orange} strokeWidth={1.5} />
                <line x1={xr - 4} x2={xr + 4} y1={ya} y2={ya} stroke={TEXT.orange} strokeWidth={1.5} />
                <line x1={xr - 4} x2={xr + 4} y1={yb} y2={yb} stroke={TEXT.orange} strokeWidth={1.5} />
                <text x={xr - 8} y={(ya + yb) / 2 - 2} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: TEXT.orange }}>
                  {t(sv.dispAfter - sv.dispBefore)} more
                </text>
                <text x={xr - 8} y={(ya + yb) / 2 + 13} textAnchor="end" className="ax">
                  = cargo − ballast pumped out
                </text>
              </g>
            );
          }}
          height={240}
        />
        <Readouts
          items={[
            { label: 'cargo by draft survey', value: t(sv.cargo), tone: 'orange' },
            { label: 'cargo actually loaded', value: t(ds.state.cargo) },
            { label: 'survey error', value: `${sv.error >= 0 ? '+' : '−'}${t(Math.abs(sv.error))}`, tone: Math.abs(sv.error) > 200 ? 'red' : undefined },
          ]}
        />
        <Slider label="Cargo actually loaded" tone="orange" value={ds.state.cargo} min={40_000} max={78_000} step={500} onChange={(v) => ds.set({ cargo: v })} display={t(ds.state.cargo)} />
        <Slider label="Ballast left aboard" value={ds.state.ballastLeft} min={0} max={10_000} step={250} onChange={(v) => ds.set({ ballastLeft: v })} display={t(ds.state.ballastLeft)} />
        <Slider label="Dock water density" tone="blue" value={ds.state.dockRho} min={1.0} max={1.025} step={0.001} onChange={(v) => ds.set({ dockRho: v })} display={`${ds.state.dockRho.toFixed(3)} t/m³`} />
        <Caption>
          The survey multiplies each draft by {surveyRho.toFixed(3)} × {K_.cb} × 225 × 32.25 = {fmt(surveyRho * K_.cb * 225 * 32.25)} tonnes per meter, then subtracts the{' '}
          {t(ARRIVAL_BALLAST - ds.state.ballastLeft)} of ballast pumped out.
        </Caption>
      </Figure>

      <P>
        With the dock water measured, the survey lands within a few dozen tonnes of the truth; what error remains comes from reading the marks to the nearest
        centimeter, and each centimeter of draft is {fmt(TPC, 1)} tonnes. Real surveys also correct for the ship’s trim, for the slight bending of her hull under
        load and for the fuel burned in port, and a careful one is trusted to within about half a percent.
      </P>
      <P>
        Now switch the surveyor to assuming sea water. Every displacement is overstated by the ratio of the two densities, and the error doesn’t cancel between the
        two readings, because the after reading is so much larger than the before. At the starting settings, with the dock at 1.012, the survey credits
        Kestrel with {t(surveyResult(72_000, 0, 1.012, true).cargo)} instead of {t(surveyResult(72_000, 0, 1.012, false).cargo)}, and a buyer
        paying for iron ore would be invoiced for {t(surveyResult(72_000, 0, 1.012, true).cargo - surveyResult(72_000, 0, 1.012, false).cargo)} that never
        left the quay. Ballast matters just as much: water still in the tanks after loading weighs exactly as much as cargo, so the survey must sound every tank. Turn
        the ballast up and watch the dot climb without the cargo changing.
      </P>
      <P>
        So a ship’s carrying capacity is fixed by geometry and the density of water: her length, beam and fullness, and the draft the load-line rules allow. That
        is the first half of what a ship offers the market. The second is how fast, and at what cost, she can move it. In{' '}
        <a href={lessonHref('shipping/1.2')}>the next lesson</a> we’ll push Kestrel through the water and measure what holds her back.
      </P>
    </LessonPage>
  );
}
