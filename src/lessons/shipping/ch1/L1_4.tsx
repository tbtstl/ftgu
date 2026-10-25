import { useState } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  TEXT,
  Tn,
  fmt,
  lessonHref,
  pct,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { KESTREL } from '../../../model/shipping/vessels';
import { maxCargo, summerDisplacement } from '../../../engines/shipping/hydrostatics';
import { CARGOES, DOUBLE_BOTTOM, LOGS, ballastTanks, deckStack, equilibriumHeel, stabilityOf, type Stability } from '../../../engines/shipping/stability';
import { ShipSection, sectionGeometry } from '../shared/ShipSection';
import { CARGO_COLOR } from '../shared/tones';

const V = KESTREL;
const CONSUMABLES = V.consumables;
const TANKS = ballastTanks(V);
const SUMMER = summerDisplacement(V);
const DEADWEIGHT_CARGO = maxCargo(V, CONSUMABLES);
/** Twice real speed: a 16-second roll plays in 8 seconds. */
const SPEEDUP = 2;
const ROLL_AMPLITUDE = 5;

/** The bulk cargoes, which go only in the holds. */
type BulkId = 'ore' | 'coal' | 'grain';
/** The first demonstration adds logs, which fill the holds and then stack on deck. */
type CargoId = BulkId | 'logs';
const BULK_IDS: BulkId[] = ['ore', 'coal', 'grain'];
const CARGO_IDS: CargoId[] = [...BULK_IDS, 'logs'];
const CARGO_LABEL: Record<CargoId, string> = { ore: 'Iron ore', coal: 'Coal', grain: 'Wheat', logs: 'Logs' };
const LOG_COLOR = '#a8835a';
const colorOf = (id: CargoId) => (id === 'logs' ? LOG_COLOR : CARGO_COLOR[id]);

/** Logs that fill Kestrel’s holds, in 100-tonne steps; any more go on deck. */
export const LOG_HOLDS = Math.floor((V.holdVolume ?? 0) / LOGS.stowage / 100) * 100;
/** The most logs the demonstration stacks on deck, tonnes (a stack a little over seven meters high). */
export const DECK_MAX = 20_000;

/** How a load of logs splits between the holds and the deck. */
export function logSplit(cargo: number): { hold: number; deck: number } {
  const hold = Math.min(cargo, LOG_HOLDS);
  return { hold, deck: Math.max(0, cargo - hold) };
}

/**
 * The most of a cargo Kestrel can load: limited by deadweight or by hold volume, in 100-tonne steps.
 * Logs fill the holds and then a deck stack of up to DECK_MAX tonnes.
 */
export function cargoLimit(id: CargoId): number {
  if (id === 'logs') return LOG_HOLDS + DECK_MAX;
  const byVolume = (V.holdVolume ?? 0) / CARGOES[id].stowage;
  return Math.floor(Math.min(DEADWEIGHT_CARGO, byVolume) / 100) * 100;
}

export function loadedState(id: CargoId, cargo: number, lowerBallast: number, topsideBallast: number): Stability {
  if (id === 'logs') {
    const { hold, deck } = logSplit(cargo);
    return stabilityOf(V, { cargo: hold, cargoType: LOGS, consumables: CONSUMABLES, lowerBallast, topsideBallast, deck: { weight: deck, stowage: LOGS.stowage } });
  }
  return stabilityOf(V, { cargo, cargoType: CARGOES[id], consumables: CONSUMABLES, lowerBallast, topsideBallast });
}

/** The angle a ship with negative GM lolls to (wall-sided: GZ = 0 where tan²θ = −2 GM ÷ BM), degrees; 0 if GM ≥ 0. */
export function lollAngle(s: Stability): number {
  return s.gm >= 0 ? 0 : (Math.atan(Math.sqrt((-2 * s.gm) / s.bm)) * 180) / Math.PI;
}

/** The smallest load of logs, on the slider’s 100-tonne grid, whose GM falls below a value; Infinity if none. */
export function logsWhereGmBelow(gm: number): number {
  for (let c = 0; c <= cargoLimit('logs'); c += 100) if (loadedState('logs', c, 0, 0).gm < gm) return c;
  return Infinity;
}

// ---------------------------------------------------------------------------
// The stiff-ship challenge: swap ore for topside ballast, at her marks, until she rolls every 10 seconds.

/** The roll period the master asks for, seconds. */
export const ORE_ROLL_TARGET = 10;
/** The GM that gives that roll period: T = 2π × 0.4 B ÷ √(g GM). */
export const GM_FOR_TARGET = (2 * Math.PI * 0.4 * V.beam) ** 2 / (9.81 * ORE_ROLL_TARGET ** 2);
/** Tonnes she may float under her summer displacement and still count as down to her marks (about two centimeters). */
const AT_MARKS_TOLERANCE = 150;

/**
 * The challenge: with iron ore and no lower ballast, give up ore for topside ballast while staying
 * down to her marks, until the roll-period readout (to a tenth of a second) reads exactly 10.0 s.
 */
export function oreRollSolved(id: CargoId, cargo: number, lower: number, topside: number): boolean {
  if (id !== 'ore' || lower > 0) return false;
  const st = loadedState(id, cargo, lower, topside);
  const under = SUMMER - st.displacement;
  if (under < -0.5 || under > AT_MARKS_TOLERANCE) return false;
  return Math.round(st.rollPeriod * 10) / 10 === ORE_ROLL_TARGET;
}

/** The least ore, in the topside slider's 50-tonne steps, that must be swapped for topside ballast to roll every 10 seconds. */
export const ORE_SWAP_FOR_TARGET = (() => {
  for (let swap = 0; swap <= TANKS.topside.capacity; swap += 50) {
    if (loadedState('ore', cargoLimit('ore') - swap, 0, swap).rollPeriod >= ORE_ROLL_TARGET) return swap;
  }
  return Infinity;
})();

// ---------------------------------------------------------------------------
// The list: near the end of loading, with ballast still in the topside tanks.

/** Cargo aboard in the list demonstration, and the topside ballast in each tank. */
export const LIST_CARGO = 70_000;
export const LIST_BALLAST_PER_SIDE = 1_500;
/** How far off the centerline the misplaced cargo sits, m. */
export const OFF_CENTER_LEVER = 8;
/** Moment moved by pumping one tonne from one topside tank to the other, t·m. */
export const TRANSFER_MOMENT = 2 * TANKS.topside.lever;

export function listCondition(id: BulkId): Stability {
  return loadedState(id, LIST_CARGO, 0, 2 * LIST_BALLAST_PER_SIDE);
}

/** Net heeling moment to port, t·m: misplaced cargo to port, minus ballast pumped from port to starboard. */
export function listMoment(offCenter: number, transfer: number): number {
  return offCenter * OFF_CENTER_LEVER - transfer * TRANSFER_MOMENT;
}

/** Heel in the list demonstration, degrees: positive to port. */
export function listHeel(id: BulkId, offCenter: number, transfer: number): number {
  return equilibriumHeel(listCondition(id), listMoment(offCenter, transfer));
}

/** The challenge: upright to within a tenth of a degree. */
export function uprightSolved(id: BulkId, offCenter: number, transfer: number): boolean {
  return Math.abs(listHeel(id, offCenter, transfer)) < 0.1;
}

/** Labels on a height scale, nudged apart so they never overlap. */
function spread(items: Array<{ key: string; y: number }>, gap = 15) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].y - sorted[i - 1].y < gap) sorted[i].y = sorted[i - 1].y + gap;
  return Object.fromEntries(sorted.map((s) => [s.key, s.y]));
}

const GEO = sectionGeometry(V);

/** Half-width of the hold at a height above the keel, m. */
function holdHalfWidth(z: number): number {
  if (z <= GEO.hopperTop) return GEO.hopperToe + Math.max(0, z - DOUBLE_BOTTOM) * ((GEO.hb - GEO.hopperToe) / (GEO.hopperTop - DOUBLE_BOTTOM));
  if (z <= GEO.topsideLow) return GEO.hb;
  if (z <= GEO.D) return GEO.hatch + ((GEO.D - z) / (GEO.D - GEO.topsideLow)) * (GEO.hb - GEO.hatch);
  return GEO.hatch;
}

const m2 = (x: number) => `${fmt(x, 2)} m`;
const t = (x: number) => `${fmt(x)} t`;
const sec = (x: number) => (Number.isFinite(x) ? `${fmt(x, 1)} s` : '—');

function sideOf(transfer: number) {
  if (transfer === 0) return 'none';
  return `${t(Math.abs(transfer))} to ${transfer > 0 ? 'starboard' : 'port'}`;
}

function heelText(deg: number) {
  if (Math.abs(deg) < 0.005) return '0.00°';
  return `${fmt(Math.abs(deg), 2)}° to ${deg > 0 ? 'port' : 'starboard'}`;
}

// Reference numbers for the prose.
const FULL = Object.fromEntries(BULK_IDS.map((id) => [id, loadedState(id, cargoLimit(id), 0, 0)])) as Record<BulkId, Stability>;
const ORE_SWAP = loadedState('ore', cargoLimit('ore') - TANKS.topside.capacity, 0, TANKS.topside.capacity);
const WHEAT_TOPSIDE = loadedState('grain', cargoLimit('grain'), 0, TANKS.topside.capacity);
const BALLASTED = loadedState('ore', 0, TANKS.lower.capacity, TANKS.topside.capacity);
/** Empty but for fuel and stores: no cargo, no ballast. */
const EMPTY = loadedState('ore', 0, 0, 0);
const LOGS_IN_HOLDS = loadedState('logs', LOG_HOLDS, 0, 0);
const LOGS_GM_015 = logsWhereGmBelow(0.15);
const LOGS_GM_0 = logsWhereGmBelow(0);
const LOGS_MAX = loadedState('logs', cargoLimit('logs'), 0, 0);
const LIST = Object.fromEntries(BULK_IDS.map((id) => [id, listCondition(id)])) as Record<BulkId, Stability>;
const LIST_600 = Object.fromEntries(BULK_IDS.map((id) => [id, listHeel(id, 600, 0)])) as Record<BulkId, number>;
const TRANSFER_600 = (600 * OFF_CENTER_LEVER) / TRANSFER_MOMENT;
/** The full-ore roll period as the readout shows it, and the GM the period formula predicts from it for a 10-second roll. */
const ORE_ROLL_SHOWN = Math.round(FULL.ore.rollPeriod * 10) / 10;
const ORE_GM_ESTIMATE = FULL.ore.gm * (ORE_ROLL_SHOWN / ORE_ROLL_TARGET) ** 2;

export default function Lesson() {
  // ---- Demonstration 1: G, B and M.
  const st = useScenario('stability', { cargoType: 'coal' as CargoId, cargo: cargoLimit('coal'), lower: 0, topside: 0 });
  const { cargoType, cargo, lower, topside } = st.state;
  const s = loadedState(cargoType, cargo, lower, topside);
  const limit = cargoLimit(cargoType);
  const over = s.displacement - SUMMER;
  const deck = cargoType === 'logs' ? logSplit(cargo).deck : 0;
  const stack = deckStack(V, deck, LOGS.stowage);
  const play = usePlay(true);
  const [phase, setPhase] = useState(0);
  const stable = s.gm > 0;
  useAnimationFrame((dt) => setPhase((p) => (p + (dt * 2 * Math.PI * SPEEDUP) / s.rollPeriod) % (2 * Math.PI)), play.playing && stable);
  const loll = lollAngle(s);
  const roll = stable ? ROLL_AMPLITUDE * Math.sin(phase) : loll;
  const rollSolved = oreRollSolved(cargoType, cargo, lower, topside);
  const oreLeftAshore = cargoLimit('ore') - cargo;

  const SC = 8.5;
  const WL = 172;
  const keelY = WL + SC * s.draft;
  const yAt = (z: number) => keelY - SC * z;
  const scaleX = 424;
  const lab = spread([
    { key: 'km', y: Math.max(14, yAt(s.km)) + 4 },
    { key: 'kg', y: yAt(s.kg) + 4 },
    { key: 'kb', y: yAt(s.kb) + 4 },
  ]);

  // ---- Demonstration 2: a list.
  const ls = useScenario('list', { cargoType: 'coal' as BulkId, offCenter: 600, transfer: 0 });
  const lc = LIST[ls.state.cargoType];
  const moment = listMoment(ls.state.offCenter, ls.state.transfer);
  const heel = listHeel(ls.state.cargoType, ls.state.offCenter, ls.state.transfer);
  const solved = uprightSolved(ls.state.cargoType, ls.state.offCenter, ls.state.transfer);
  const portFill = (LIST_BALLAST_PER_SIDE - ls.state.transfer) / (TANKS.topside.capacity / 2);
  const stbdFill = (LIST_BALLAST_PER_SIDE + ls.state.transfer) / (TANKS.topside.capacity / 2);
  const WL2 = 140;
  const cx2 = 196;
  const pileTop = Math.min(lc.cargoTop + 0.6 + (ls.state.offCenter / 1500) * 2.2, GEO.coaming - 0.1);
  const pileLeft = Math.max(-OFF_CENTER_LEVER - 3.5, -holdHalfWidth(lc.cargoTop) + 0.2);
  const pile = [
    [pileLeft, lc.cargoTop],
    [pileLeft + 3.5, pileTop],
    [pileLeft + 7, lc.cargoTop],
  ].map(([y, z]) => {
    const th = (heel * Math.PI) / 180;
    const dz = z - lc.draft;
    return [cx2 + SC * (y * Math.cos(th) - dz * Math.sin(th)), WL2 - SC * (y * Math.sin(th) + dz * Math.cos(th))];
  });
  const dialX = 486;
  const dialY = 196;
  const dialR = 104;
  const needle = (Math.max(-5, Math.min(5, heel)) * 12 * Math.PI) / 180;

  return (
    <LessonPage id="shipping/1.4">
      <P>
        <a href={lessonHref('shipping/1.1')}>Lesson 1.1</a> found how much Kestrel can carry: {t(DEADWEIGHT_CARGO)} of cargo before her summer mark reaches the
        sea. The two lessons after it pushed that load through the water, and all three quietly assumed that she floats upright. She
        doesn’t have to. A ship can be well within her load line and still capsize, because floating depends only on how much she weighs, while staying upright
        depends on where that weight sits.
      </P>
      <P>
        Two forces act on a floating ship, and they’re equal: her weight, pulling down, and the buoyancy of the water, pushing up. Her weight acts through her
        center of gravity, <K tone="orange">G</K>. The buoyancy acts through the center of the underwater volume, the center of buoyancy,{' '}
        <K tone="blue">B</K>. Upright, B sits directly below G and the two forces cancel. When a wave rolls her over a few degrees, more of her hull goes under
        on the low side, and B moves that way. Now the buoyancy pushes up on one side of G while the weight pulls down through it, and the pair of forces twists
        her — back upright, if B has moved far enough.
      </P>
      <P>
        Whether it has is judged at a third point. Draw the line of the buoyant force through the shifted B: for small rolls it crosses the ship’s centerline at
        the same place whatever the angle. That point is the <K tone="violet">metacenter</K>, M, and all three heights are measured up from the keel, K. If G is
        below M, the ship rights herself. In the next demonstration Kestrel is seen end-on from astern, looking forward, rolling gently at twice real speed. The
        arrows are her weight and buoyancy; the scale beside her gives the three heights. Choose a cargo, load it, and fill her ballast tanks — the double-bottom
        and hopper tanks low in the hull, and the topside tanks high under her deck:
      </P>

      <Figure name="Ship Stability Simulator" scenario={st} play={play}>
        <Segmented
          label="Cargo"
          value={cargoType}
          onChange={(id) => st.set({ cargoType: id, cargo: Math.min(cargo, id === 'logs' ? LOG_HOLDS : cargoLimit(id)) })}
          options={CARGO_IDS.map((id) => ({ value: id, label: CARGO_LABEL[id] }))}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 326"
          role="img"
          aria-label={`Kestrel’s midship section with ${t(cargo)} of ${CARGO_LABEL[cargoType].toLowerCase()}${deck > 0 ? `, ${t(deck)} of it stacked ${m2(stack.height)} high on deck` : ''}, ${t(lower)} of lower ballast and ${t(topside)} of topside ballast. KB ${m2(s.kb)}, KG ${m2(s.kg)}, KM ${m2(s.km)}: GM ${m2(s.gm)}, ${stable ? `roll period ${sec(s.rollPeriod)}` : `G above M, so she lolls to ${fmt(loll, 1)}°`}.`}
        >
          <ShipSection
            v={V}
            draft={s.draft}
            cx={204}
            wlY={WL}
            scale={SC}
            heelDeg={roll}
            cargoTop={s.cargoTop}
            cargoColor={colorOf(cargoType)}
            deckTop={deck > 0 ? stack.top : undefined}
            lowerFill={lower / TANKS.lower.capacity}
            topsideFill={topside / TANKS.topside.capacity}
            points={{ kb: s.kb, kg: s.kg, km: s.km }}
            seaX0={20}
            seaX1={384}
            seaBottom={320}
            idPrefix="st1"
          />
          {/* height scale, upright */}
          <line x1={scaleX} x2={scaleX} y1={Math.max(10, yAt(Math.max(s.km, V.depth)))} y2={keelY} stroke="#9a9a9a" />
          <line x1={scaleX - 5} x2={scaleX + 5} y1={keelY} y2={keelY} stroke="#9a9a9a" />
          <text x={scaleX + 10} y={keelY + 4} className="ax">
            K, the keel: 0 m
          </text>
          {[
            { key: 'km', z: s.km, color: TEXT.violet, text: `KM ${m2(s.km)}` },
            { key: 'kg', z: s.kg, color: TEXT.orange, text: `KG ${m2(s.kg)}` },
            { key: 'kb', z: s.kb, color: TEXT.blue, text: `KB ${m2(s.kb)}` },
          ].map((p) => (
            <g key={p.key}>
              {yAt(p.z) >= 10 && <line x1={scaleX - 6} x2={scaleX + 6} y1={yAt(p.z)} y2={yAt(p.z)} stroke={p.color} strokeWidth={2} />}
              <text x={scaleX + 10} y={lab[p.key]} style={{ fontSize: 13, fontWeight: 600, fill: p.color }}>
                {p.text}
                {yAt(p.z) < 10 ? ' ↑' : ''}
              </text>
            </g>
          ))}
          {/* GM bracket */}
          {stable && yAt(s.km) >= 10 && (
            <g>
              <line x1={scaleX - 14} x2={scaleX - 14} y1={yAt(s.km)} y2={yAt(s.kg)} stroke={GRAPHIC.violet} strokeWidth={3} />
              <text x={scaleX - 20} y={(yAt(s.km) + yAt(s.kg)) / 2 + 4} textAnchor="end" style={{ fontSize: 13, fontWeight: 600, fill: TEXT.violet }}>
                GM
              </text>
            </g>
          )}
          <text x={scaleX + 10} y={16} className="ax">
            Heights above the keel, upright
          </text>
        </svg>
        <Readouts
          items={[
            { label: 'metacentric height, GM', value: m2(s.gm), tone: s.gm < 0.15 ? 'red' : 'violet' },
            { label: 'natural roll period', value: stable ? sec(s.rollPeriod) : `lolls to ${fmt(loll, 1)}°`, tone: 'teal' },
            {
              label: over > 0.5 ? `draft — ${t(over)} over her summer mark` : 'draft',
              value: m2(s.draft),
              tone: over > 0.5 ? 'red' : 'blue',
            },
          ]}
        />
        <Slider
          label={`${CARGO_LABEL[cargoType]} loaded`}
          tone="orange"
          value={cargo}
          min={0}
          max={limit}
          step={100}
          onChange={(v) => st.set({ cargo: v })}
          display={deck > 0 ? `${t(cargo)} · ${t(deck)} on deck` : t(cargo)}
        />
        <Slider label="Lower ballast" tone="blue" value={lower} min={0} max={TANKS.lower.capacity} step={50} onChange={(v) => st.set({ lower: v })} display={t(lower)} />
        <Slider label="Topside ballast" tone="blue" value={topside} min={0} max={TANKS.topside.capacity} step={50} onChange={(v) => st.set({ topside: v })} display={t(topside)} />
        <Eq label={`GM equals KB plus BM minus KG: ${fmt(s.kb, 2)} plus ${fmt(s.bm, 2)} minus ${fmt(s.kg, 2)} equals ${fmt(s.gm, 2)} meters`}>
          <K tone="violet">GM</K>
          <Op>=</Op>
          <K tone="blue">KB</K>
          <Op>+</Op>
          <span>BM</span>
          <Op>−</Op>
          <K tone="orange">KG</K>
          <Op>=</Op>
          <Tn tone="blue">{m2(s.kb)}</Tn>
          <Op>+</Op>
          <span>{m2(s.bm)}</span>
          <Op>−</Op>
          <Tn tone="orange">{m2(s.kg)}</Tn>
          <Op>=</Op>
          <K tone="violet">{m2(s.gm)}</K>
        </Eq>
      </Figure>

      <P>
        Each term comes from something we already know. KB is a little over half the draft, because the underwater part of a full hull is nearly a box. BM, the
        distance from B up to M, measures how far B travels sideways as she rolls; it equals the waterplane’s resistance to tipping — its moment of inertia, which
        grows with the cube of the beam — divided by the underwater volume. So a wide ship has a tall BM, and a deep-floating one a shorter BM. And KG is the
        average height of everything aboard, each item weighted by its tonnes: her steel, her fuel low in the double bottom, her cargo, her ballast.
      </P>
      <P>
        At the start, Kestrel is down to her marks with {t(cargoLimit('coal'))} of coal. Coal stows at {fmt(CARGOES.coal.stowage, 2)} cubic meters to the tonne,
        so it nearly fills her holds, to {m2(FULL.coal.cargoTop)} above the keel, and G sits at {m2(FULL.coal.kg)}. M is at {m2(FULL.coal.km)}, so GM is{' '}
        <K tone="violet">{m2(FULL.coal.gm)}</K>. Now switch to iron ore. It weighs the same, but at {fmt(CARGOES.ore.stowage, 2)} cubic meters to the tonne it takes
        a third of the space, and lies in a layer only {m2(FULL.ore.cargoTop)} above the keel. G drops to {m2(FULL.ore.kg)}, and GM jumps to {m2(FULL.ore.gm)}.
      </P>

      <H2>Stiff and tender</H2>
      <P>
        A bigger GM sounds safer, and against capsizing it is. But watch how she rolls. A ship rolls like a pendulum, and its natural period is set by GM:
      </P>
      <Eq label="Roll period equals two pi times the radius of gyration, divided by the square root of g times GM">
        <K tone="teal">
          T<Sub>roll</Sub>
        </K>
        <Op>≈</Op>
        <Frac top={<span>2π × 0.4 B</span>} bottom={<span>√(g × GM)</span>} />
      </Eq>
      <P>
        Here 0.4 B, about 13 meters for Kestrel, is a typical radius of gyration: how far from her rolling axis her weight is, on average. Full of coal she rolls
        once every {sec(FULL.coal.rollPeriod)}; full of ore, every {sec(FULL.ore.rollPeriod)}. A ship with a large GM is called <b>stiff</b>. She snaps back so
        quickly that the accelerations high in her hull can injure crew and damage machinery and structure. One remedy is to raise G. Some bulk carriers
        strengthened for it load ore in alternate holds, piling it higher in fewer holds; another is ballast in the topside tanks.
      </P>

      <Challenge
        id="b"
        figure="Ship Stability Simulator"
        question={`Full of iron ore, Kestrel rolls every ${sec(FULL.ore.rollPeriod)}, and her master wants a gentler ${ORE_ROLL_TARGET} seconds. Predict first: the period goes as one over the square root of GM, so what GM will she need? Then choose iron ore and give up ore for topside ballast, a tonne of water for every tonne of ore, so that she stays down to her marks, until the roll period reads ${fmt(ORE_ROLL_TARGET, 1)} s.`}
        solved={rollSolved}
        status={
          cargoType !== 'ore'
            ? 'Choose iron ore first.'
            : lower > 0
              ? 'Empty the lower ballast tanks: water low in the hull only makes her stiffer.'
              : over > 0.5
                ? `She is ${t(over)} over her summer marks.`
                : over < -AT_MARKS_TOLERANCE
                  ? `She is ${t(-over)} short of her marks: every tonne of ore left ashore should become a tonne of topside ballast.`
                  : `Down to her marks with ${t(oreLeftAshore)} of ore left ashore and ${t(topside)} of topside ballast.`
        }
        success={`Solved. With ${t(oreLeftAshore)} of ore left ashore and ${t(topside)} of water in her topside tanks, GM is ${m2(s.gm)} and she rolls every ${sec(s.rollPeriod)}. The period formula predicts the GM: (${fmt(ORE_ROLL_SHOWN, 1)} ÷ ${ORE_ROLL_TARGET})² of her ${m2(FULL.ore.gm)} is about ${fmt(ORE_GM_ESTIMATE, 1)} m, and exactly ${ORE_ROLL_TARGET} seconds needs ${m2(GM_FOR_TARGET)}. Getting there costs about ${t(ORE_SWAP_FOR_TARGET)} of ore, ${pct(ORE_SWAP_FOR_TARGET / cargoLimit('ore'))} of her cargo, for a roll less than a second slower.`}
      />

      <P>
        Neither remedy does much. Even a full load of {t(TANKS.topside.capacity)} of topside ballast, swapped for ore, only slows her roll to{' '}
        {sec(ORE_SWAP.rollPeriod)}. Iron ore is simply too dense to sit high.
      </P>
      <P>
        A ship with a small GM is <b>tender</b>: she rolls slowly and comes back reluctantly, and if GM falls to zero nothing brings her back at all. The rules set
        floors. The International Maritime Organization’s intact stability code requires a GM of at least 0.15 meters, and for grain cargoes the International
        Grain Code requires at least 0.30 meters.
      </P>
      <P>
        In ballast, with every tank full and no cargo, Kestrel sits at {m2(BALLASTED.draft)} with a GM of {m2(BALLASTED.gm)} — stiff, as ships in ballast
        usually are. She doesn’t carry that water for stability: with none at all, her GM would be {m2(EMPTY.gm)}. She carries it for draft. Empty but for fuel
        and stores, she would float at {m2(EMPTY.draft)}, with most of her propeller and rudder out of the water; her flat bottom forward would slam on every
        swell, and the wind on {fmt(V.depth - EMPTY.draft)} meters of bare hull would push her about like a sail. Ballast sinks her deep enough to drive and
        steer, usually down by the stern to bury the propeller deeper still.
      </P>
      <P>
        Now empty her ballast tanks and choose wheat in <FigRef to="Ship Stability Simulator">the first demonstration</FigRef>. At {fmt(CARGOES.grain.stowage, 2)} cubic meters to the tonne, it fills her holds after {t(cargoLimit('grain'))}, while she still floats at{' '}
        {m2(FULL.grain.draft)}, {fmt((V.designDraft - FULL.grain.draft) * 100)} centimeters short of her summer mark. She has about{' '}
        {t(Math.round((DEADWEIGHT_CARGO - cargoLimit('grain')) / 100) * 100)} of deadweight to spare and no room to use it: she has <b>cubed out</b>. Light cargoes
        are limited by volume and dense ones by weight, a difference that will matter in Chapter 2. With her holds full to the hatches, G is high and GM is {m2(FULL.grain.gm)}. Fill her topside tanks on top of that and GM falls to {m2(WHEAT_TOPSIDE.gm)}, though she would then be
        nearly {t(Math.round((WHEAT_TOPSIDE.displacement - SUMMER) / 1000) * 1000)} over her marks.
      </P>
      <P>
        Bulk cargoes rarely bring GM near the floors. Logs can. Round trunks leave gaps, so logs stow at about {fmt(LOGS.stowage, 1)} cubic meters to the tonne
        and fill Kestrel’s holds after {t(LOG_HOLDS)}, at a GM of {m2(LOGS_IN_HOLDS.gm)}. Log carriers stack the rest on deck, lashed between steel posts at
        the ship’s sides, higher than any other weight aboard. Choose logs, empty the tanks again and load more: GM falls through 0.15 meters once {t(LOGS_GM_015 - LOG_HOLDS)} are on
        deck and reaches zero at {t(LOGS_GM_0 - LOG_HOLDS)}, with Kestrel still {t(Math.round((DEADWEIGHT_CARGO - LOGS_GM_0) / 100) * 100)} short of her
        marks. A log cargo can run out of stability before it runs out of weight or space.
      </P>
      <P>
        Load past that and she no longer floats upright. With G above M, she heels until B has moved out far enough to sit under G again, and rests there,
        leaning to one side or the other: a <b>loll</b>. With all {t(DECK_MAX)} on deck, in a stack {fmt(deckStack(V, DECK_MAX, LOGS.stowage).height, 1)} meters
        high, she lolls {fmt(lollAngle(LOGS_MAX), 1)}°. The cure is to lower G — fill the lower ballast tanks, or take weight off the deck — and log ships watch
        for a loll at sea, where fuel burned from low tanks and rain soaked up by the deck stack both raise G.
      </P>
      <P>
        Two dangers aren’t in our model. Grain settles in a seaway and can slide toward the low side of a hold, which is why the Grain Code also requires
        that the heel from an assumed shift of the grain be no more than 12°. And a tank that is only partly full lets its liquid run to the low side as she
        rolls. That <b>free-surface effect</b> works as if G were higher than it is, so officers keep tanks either full or empty whenever they can.
      </P>

      <H2>Correcting a list</H2>
      <P>
        So far G has stayed on the centerline. If it moves off, the ship heels until B has moved under it — she takes a <b>list</b>. A weight w moved a distance d
        sideways creates a heeling moment w × d, in tonne-meters, and for small angles the list it causes is
      </P>
      <Eq label="Tangent of the heel angle equals the heeling moment divided by displacement times GM">
        <span>tan θ</span>
        <Op>=</Op>
        <Frac top={<span>heeling moment</span>} bottom={<span>Δ × <K tone="violet">GM</K></span>} />
      </Eq>
      <P>
        In the next demonstration Kestrel is near the end of loading: {t(LIST_CARGO)} of cargo is aboard, and {t(LIST_BALLAST_PER_SIDE)} of ballast is still in each
        topside tank, waiting to be pumped out. The shiploader has heaped some of the cargo against the port side of a hold, {OFF_CENTER_LEVER} meters off the
        centerline. The dial magnifies her heel twelve times. Pump ballast across from one topside tank to the other to bring her upright:
      </P>

      <Figure name="Ship Stability Simulator · list" scenario={ls}>
        <Segmented
          label="Cargo"
          value={ls.state.cargoType}
          onChange={(id) => ls.set({ cargoType: id })}
          options={BULK_IDS.map((id) => ({ value: id, label: CARGO_LABEL[id] }))}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 286"
          role="img"
          aria-label={`Kestrel with ${t(LIST_CARGO)} of ${CARGO_LABEL[ls.state.cargoType].toLowerCase()}, ${t(ls.state.offCenter)} of it heaped ${OFF_CENTER_LEVER} m to port, and ballast moved ${sideOf(ls.state.transfer)}. Net heeling moment ${fmt(moment)} tonne-meters; heel ${heelText(heel)}.`}
        >
          <ShipSection
            v={V}
            draft={lc.draft}
            cx={cx2}
            wlY={WL2}
            scale={SC}
            heelDeg={heel}
            cargoTop={lc.cargoTop}
            cargoColor={CARGO_COLOR[ls.state.cargoType]}
            topsideFill={[portFill, stbdFill]}
            seaX0={20}
            seaX1={384}
            seaBottom={280}
            idPrefix="st2"
          />
          <path d={`M${pile.map((p) => p.map((n) => n.toFixed(1)).join(' ')).join(' L')} Z`} fill={CARGO_COLOR[ls.state.cargoType]} stroke="#6b6257" strokeWidth={1} />
          <text x={20} y={16} className="ax">
            {t(ls.state.offCenter)} heaped {OFF_CENTER_LEVER} m to port
          </text>
          {/* the dial */}
          <path
            d={`M${dialX - dialR * Math.sin(Math.PI / 3)} ${dialY - dialR * Math.cos(Math.PI / 3)} A${dialR} ${dialR} 0 0 1 ${dialX + dialR * Math.sin(Math.PI / 3)} ${dialY - dialR * Math.cos(Math.PI / 3)}`}
            fill="none"
            stroke="#9a9a9a"
            strokeWidth={1.5}
          />
          {Array.from({ length: 11 }, (_, i) => i - 5).map((d) => {
            const a = (d * 12 * Math.PI) / 180;
            const r0 = d % 5 === 0 ? dialR - 12 : dialR - 7;
            return <line key={d} x1={dialX - r0 * Math.sin(a)} y1={dialY - r0 * Math.cos(a)} x2={dialX - dialR * Math.sin(a)} y2={dialY - dialR * Math.cos(a)} stroke="#777" strokeWidth={d === 0 ? 2 : 1} />;
          })}
          <text x={dialX - dialR * Math.sin(Math.PI / 3) - 4} y={dialY - dialR * Math.cos(Math.PI / 3) + 18} textAnchor="middle" className="ax">
            5° port
          </text>
          <text x={dialX + dialR * Math.sin(Math.PI / 3) + 4} y={dialY - dialR * Math.cos(Math.PI / 3) + 18} textAnchor="middle" className="ax">
            5° stbd
          </text>
          <text x={dialX} y={dialY - dialR - 6} textAnchor="middle" className="ax">
            0°
          </text>
          <line x1={dialX} y1={dialY} x2={dialX - (dialR - 16) * Math.sin(needle)} y2={dialY - (dialR - 16) * Math.cos(needle)} stroke={TEXT.violet} strokeWidth={3} strokeLinecap="round" />
          <circle cx={dialX} cy={dialY} r={5} fill={TEXT.violet} />
          <text x={dialX} y={dialY + 26} textAnchor="middle" style={{ fontSize: 15, fontWeight: 600, fill: TEXT.violet }}>
            {Math.abs(heel) > 5 ? `${heelText(heel)} (off the dial)` : heelText(heel)}
          </text>
          <text x={dialX} y={dialY + 44} textAnchor="middle" className="ax">
            heel, magnified 12× on the dial
          </text>
        </svg>
        <Slider label="Cargo heaped to port" tone="orange" value={ls.state.offCenter} min={200} max={1500} step={50} onChange={(v) => ls.set({ offCenter: v })} display={t(ls.state.offCenter)} />
        <Slider label="Ballast pumped across" tone="blue" value={ls.state.transfer} min={-600} max={600} step={5} onChange={(v) => ls.set({ transfer: v })} display={sideOf(ls.state.transfer)} />
        <Eq label={`Tangent of the heel equals ${fmt(moment)} divided by ${fmt(lc.displacement)} times ${fmt(lc.gm, 2)}`}>
          <span>tan θ</span>
          <Op>=</Op>
          <Frac
            top={
              <span>
                <Tn tone="orange">{fmt(ls.state.offCenter)} × {OFF_CENTER_LEVER}</Tn> − <Tn tone="blue">{fmt(ls.state.transfer)} × {fmt(TRANSFER_MOMENT, 1)}</Tn>
              </span>
            }
            bottom={
              <span>
                {fmt(lc.displacement)} × <Tn tone="violet">{fmt(lc.gm, 2)}</Tn>
              </span>
            }
          />
          <Op>→</Op>
          <K tone="violet">θ = {heelText(heel)}</K>
        </Eq>
        <Caption>
          Each tonne pumped from the port topside tank to the starboard one moves {fmt(TRANSFER_MOMENT, 1)} tonne-meters of moment: it leaves a tank{' '}
          {fmt(TANKS.topside.lever, 1)} meters to port and arrives {fmt(TANKS.topside.lever, 1)} meters to starboard.
        </Caption>
      </Figure>

      <P>
        Heaping 600 tonnes 8 meters to port makes a moment of 4,800 tonne-meters. With coal aboard, GM is {m2(LIST.coal.gm)}, and Kestrel lists{' '}
        {fmt(LIST_600.coal, 2)}°. Switch the cargo without touching anything else. With ore, the same moment lists her only {fmt(LIST_600.ore, 2)}°, because her GM is{' '}
        {m2(LIST.ore.gm)}; with wheat, {fmt(LIST_600.grain, 2)}°. A tender ship is pushed over further by the same moment, which is why a small GM is the condition
        officers watch most closely.
      </P>

      <Challenge
        id="a"
        question="Predict first: how many tonnes of ballast must cross from the port topside tank to the starboard one to cancel the heaped cargo’s moment? Then pump that much across and bring Kestrel upright, to within a tenth of a degree."
        solved={solved}
        status={`She is heeled ${heelText(heel)}.`}
        success={`Solved. ${t(ls.state.offCenter)} at ${OFF_CENTER_LEVER} m is ${fmt(ls.state.offCenter * OFF_CENTER_LEVER)} tonne-meters to port, and each tonne pumped across is ${fmt(TRANSFER_MOMENT, 1)} tonne-meters back, so it takes about ${fmt((ls.state.offCenter * OFF_CENTER_LEVER) / TRANSFER_MOMENT)} tonnes. Notice that the answer doesn’t depend on the cargo: GM decides how far a moment heels her, but cancelling the moment is pure arithmetic.`}
      />

      <P>
        For the starting 600 tonnes that is about {fmt(TRANSFER_600)} tonnes of water, whatever the cargo. Try it with ore, coal and wheat in turn: the list you
        start from changes, the cure doesn’t. In practice the chief officer works out a ballast plan in advance and directs the final pours of cargo into whichever
        holds leave her upright and trimmed. Then the last of the ballast goes over the side, and she’s ready for sea.
      </P>
      <P>
        Everything in this chapter has happened in still water. The sea rarely is: wind, waves and currents all work on her. <a href={lessonHref('shipping/1.5')}>The next lesson</a> takes Kestrel out into the weather to see what it
        costs in time and fuel.
      </P>
    </LessonPage>
  );
}
