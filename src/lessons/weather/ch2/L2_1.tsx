import {
  Caption,
  Challenge,
  Eq,
  FigRef,
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
  Slider,
  Sub,
  Sup,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import { EARTH_RADIUS_M, OMEGA, angularMomentumWind, circulation, surfaceSpeed, type Circulation } from '../../../engines/weather/dynamics';
import { latitudeBalance } from '../../../engines/weather/radiation';
import { LATITUDE } from '../../../model/weather/region';
import { WX } from '../shared/tones';

/** Potential temperature the equator-to-pole contrast is measured against, K (as in Held and Hou). */
export const THETA0_K = 300;
/** The first demonstration's starting contrast, K: a third of 300 K. */
export const CONTRAST_DEFAULT_K = 100;
export const ROTATION_STEP = 0.05;
/** The tropopause height the Held–Hou reach uses, km (the dynamics engine's default). */
export const TROPOPAUSE_KM = 15;

/** The circulation for a rotation rate (× Earth's) and a contrast in kelvins. */
export function circulationFor(rotation: number, contrastK: number): Circulation {
  return circulation(rotation, contrastK / THETA0_K);
}

/**
 * The first challenge: with the starting contrast, the fastest spin (on the slider's steps) at
 * which the Hadley cell still reaches Fenwick Bay's 41°, putting the city in the trade winds.
 */
export function tradesSolved(rotation: number, contrastK: number): boolean {
  if (contrastK !== CONTRAST_DEFAULT_K) return false;
  const here = circulationFor(rotation, contrastK).hadleyEdge;
  const faster = circulationFor(Math.round((rotation + ROTATION_STEP) * 100) / 100, contrastK).hadleyEdge;
  return here >= LATITUDE && faster < LATITUDE;
}

/** The ring of air's eastward wind relative to the ground when eddies drain a share `loss` of its excess spin, m/s. */
export function ringWind(latDeg: number, loss: number): number {
  return (1 - loss) * angularMomentumWind(latDeg);
}

export const JET_TARGET = 40;
/** The second challenge: the share of the excess spin drained by eddies that leaves 40 m/s (± 2) at 30°. */
export function jetSolved(loss: number): boolean {
  return Math.abs(ringWind(30, loss) - JET_TARGET) <= 2;
}

const rad = (d: number) => (d * Math.PI) / 180;

// ---------------------------------------------------------------------------
// The first demonstration: one hemisphere, its surface winds on the globe's face and its cells
// drawn along the right-hand edge, with the atmosphere's height greatly exaggerated.

const GX = 250;
const GY = 312;
const GR = 210;
const ATM = 64;

function pt(lat: number, r: number): [number, number] {
  return [GX + r * Math.cos(rad(lat)), GY - r * Math.sin(rad(lat))];
}

/** A cell's loop between two latitudes, in the direction its air flows. */
function cellPath(from: number, to: number, direct: boolean): string {
  const m = Math.min(1.5, (to - from) / 6);
  const a = from + m;
  const b = to - m;
  const ri = GR + 5;
  const ro = GR + ATM - 5;
  const p = (lat: number, r: number) => pt(lat, r).map((v) => v.toFixed(1)).join(' ');
  // Direct cells rise at their equatorward end; indirect cells at their poleward end.
  return direct
    ? `M${p(a, ri)} L${p(a, ro)} A${ro} ${ro} 0 0 0 ${p(b, ro)} L${p(b, ri)} A${ri} ${ri} 0 0 1 ${p(a, ri)} Z`
    : `M${p(b, ri)} L${p(b, ro)} A${ro} ${ro} 0 0 1 ${p(a, ro)} L${p(a, ri)} A${ri} ${ri} 0 0 0 ${p(b, ri)} Z`;
}

const CELL_COLOR: Record<string, string> = { Hadley: GRAPHIC.red, Ferrel: GRAPHIC.gray, Polar: GRAPHIC.blue };
const EASTERLY = tint(GRAPHIC.violet, 0.16);
const WESTERLY = tint(GRAPHIC.teal, 0.2);

function bandPath(from: number, to: number): string {
  // The globe's face between two latitudes: straight lines of latitude, joined along the limb.
  const [x1, y1] = pt(from, GR);
  const [x2, y2] = pt(to, GR);
  const l1 = 2 * GX - x1;
  const l2 = 2 * GX - x2;
  return `M${l1.toFixed(1)} ${y1.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} A${GR} ${GR} 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)} L${l2.toFixed(1)} ${y2.toFixed(1)} A${GR} ${GR} 0 0 0 ${l1.toFixed(1)} ${y1.toFixed(1)} Z`;
}

function Arrow({ x, y, dx, dy, color }: { x: number; y: number; dx: number; dy: number; color: string }) {
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const tx = x + dx / 2;
  const ty = y + dy / 2;
  const bx = tx - ux * 7;
  const by = ty - uy * 7;
  return (
    <g>
      <line x1={x - dx / 2} y1={y - dy / 2} x2={bx} y2={by} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <polygon points={`${tx},${ty} ${bx - uy * 4},${by + ux * 4} ${bx + uy * 4},${by - ux * 4}`} fill={color} />
    </g>
  );
}

function GlobeCells({ circ, rotation }: { circ: Circulation; rotation: number }) {
  const one = circ.cells.length === 1;
  const fenwick = pt(LATITUDE, GR);
  const fenwickX = GX + (fenwick[0] - GX) * 0.1;
  const beltAt = circ.belts.find((b) => LATITUDE >= b.from && LATITUDE < b.to) ?? circ.belts[0];
  const speed = 1.4 / Math.max(0.25, Math.min(4, rotation));
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 330"
      role="img"
      aria-label={`One hemisphere of a planet turning ${fmt(rotation, 2)} times as fast as Earth. ${
        one
          ? 'A single Hadley cell reaches from the equator to the pole, with easterly winds at the surface.'
          : `The Hadley cell reaches ${fmt(circ.hadleyEdge)}°, the Ferrel cell from there to 60° and the polar cell beyond. The surface winds are trade winds from the east up to ${fmt(circ.hadleyEdge)}°, westerlies to 60° and polar easterlies beyond.`
      } Fenwick Bay, at 41°, lies in the ${beltAt.name.toLowerCase()}.`}
    >
      {/* The globe's face, with its wind belts. */}
      <path d={`M${GX - GR} ${GY} A${GR} ${GR} 0 0 1 ${GX + GR} ${GY} Z`} fill="#f2f0e9" stroke="#bdb7a8" strokeWidth={1.2} />
      {circ.belts.map((b) => (
        <path key={b.name} d={bandPath(b.from, b.to)} fill={b.fromThe === 'east' ? EASTERLY : WESTERLY} />
      ))}
      {circ.belts.map((b) => {
        const mid = b.from + (b.to - b.from) * (b.to === 90 ? 0.32 : 0.5);
        const [xe, y] = pt(mid, GR);
        const half = xe - GX;
        const east = b.fromThe === 'west';
        // Arrows point where the wind blows to: equatorward-and-west under easterlies, poleward-and-east under westerlies.
        const dx = east ? 26 : -26;
        const dy = east ? -7 : 7;
        const xs = half > 120 ? [-0.62, -0.05, 0.5] : half > 60 ? [-0.4, 0.35] : [0];
        const tall = (Math.sin(rad(b.to)) - Math.sin(rad(b.from))) * GR;
        return (
          <g key={b.name}>
            {tall > 14 && xs.map((f) => <Arrow key={f} x={GX + f * half} y={y} dx={dx} dy={dy} color={GRAPHIC.violet} />)}
            {tall > 22 && (
              <text x={GX - half * 0.62} y={y - 12} textAnchor="middle" className="ax" style={{ fill: TEXT.violet }}>
                {b.name.toLowerCase()}
              </text>
            )}
          </g>
        );
      })}
      {/* Cell boundaries as lines of latitude. */}
      {circ.cells.slice(1).map((c) => {
        const [x, y] = pt(c.from, GR);
        return (
          <g key={c.name}>
            <line x1={2 * GX - x} x2={x} y1={y} y2={y} stroke="#9a9a9a" strokeDasharray="4 4" />
            <text x={2 * GX - x - 6} y={y + 4} textAnchor="end" className="ax">
              {fmt(c.from)}°
            </text>
          </g>
        );
      })}
      <text x={GX - GR - 6} y={GY + 4} textAnchor="end" className="ax">
        0°
      </text>
      {/* Fenwick Bay. */}
      <circle cx={fenwickX} cy={fenwick[1]} r={4.5} fill="#333" stroke="#fcfcfb" strokeWidth={1.5} />
      <text x={fenwickX + 8} y={fenwick[1] + 4} className="lab">
        Fenwick Bay
      </text>

      {/* The cells, along the limb. */}
      <path d={`M${GX + GR + ATM} ${GY} A${GR + ATM} ${GR + ATM} 0 0 0 ${GX} ${GY - GR - ATM}`} fill="none" stroke="#d9d9d5" strokeDasharray="3 4" />
      {circ.cells.map((c) => {
        const d = cellPath(c.from, c.to, c.direct);
        const span = rad(c.to - c.from) * (GR + ATM / 2);
        const [lx, ly] = pt((c.from + c.to) / 2, GR + ATM / 2);
        return (
          <g key={c.name}>
            <path d={d} fill={tint(CELL_COLOR[c.name], 0.12)} stroke={CELL_COLOR[c.name]} strokeWidth={1.2} strokeOpacity={0.6} />
            <path d={d} className="flow-dots" stroke={CELL_COLOR[c.name]} strokeWidth={5} style={{ animationDuration: `${speed.toFixed(2)}s` }} />
            {span > 60 && (
              <text x={lx} y={ly + 4} textAnchor="middle" className="lab" style={{ fontSize: 11 }}>
                {c.name}
              </text>
            )}
          </g>
        );
      })}
      {/* Rising air at the equator rains; sinking air at the Hadley cell's edge is dry. */}
      <text x={GX + GR - 6} y={GY - 8} textAnchor="end" className="ax" style={{ fill: TEXT.teal }}>
        rain belt
      </text>
      {!one && (
        <text x={pt(circ.hadleyEdge, GR - 8)[0]} y={pt(circ.hadleyEdge, GR - 8)[1] + 14} textAnchor="end" className="ax" style={{ fill: TEXT.orange }}>
          deserts
        </text>
      )}
      {/* The subtropical jet, at the top of the Hadley cell's poleward edge. */}
      {!one && (
        <g>
          <circle cx={pt(circ.jetLat, GR + ATM + 8)[0]} cy={pt(circ.jetLat, GR + ATM + 8)[1]} r={6} fill={GRAPHIC.violet} stroke="#fcfcfb" strokeWidth={1.5} />
          <text x={pt(circ.jetLat, GR + ATM + 8)[0] + 10} y={pt(circ.jetLat, GR + ATM + 8)[1] - 4} className="ax" style={{ fill: TEXT.violet }}>
            subtropical jet
          </text>
        </g>
      )}
      <text x={634} y={GY + 4} textAnchor="end" className="ax">
        height not to scale
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second demonstration: a ring of air leaving the equator.

const RX = scale(0, 60, 300, 616);
const RY = scale(0, 300, 262, 30);
const RING_LATS = Array.from({ length: 121 }, (_, i) => i * 0.5);

function RingFigure({ lat, loss }: { lat: number; loss: number }) {
  const cx = 140;
  const cy = 160;
  const R = 112;
  const y = cy - R * Math.sin(rad(lat));
  const rx = R * Math.cos(rad(lat));
  const u = ringWind(lat, loss);
  const ideal = RING_LATS.map((l) => Math.min(320, angularMomentumWind(l)));
  const kept = RING_LATS.map((l) => Math.min(320, ringWind(l, loss)));
  const clip = 'ring-clip';
  return (
    <svg
      className="chart"
      viewBox="0 0 640 296"
      role="img"
      aria-label={`A ring of air that left the equator at rest, now at ${fmt(lat)}°. The ground there moves east at ${fmt(surfaceSpeed(lat))} m/s. Keeping all its angular momentum, the ring would blow east at ${fmt(angularMomentumWind(lat))} m/s relative to the ground; with eddies draining ${fmt(loss * 100)}% of that, it blows at ${fmt(u)} m/s. At 30° the ring's wind is ${fmt(ringWind(30, loss))} m/s.`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={300} y={30} width={316} height={232} />
        </clipPath>
      </defs>
      {/* The globe and the ring. */}
      <circle cx={cx} cy={cy} r={R} fill="#f2f0e9" stroke="#bdb7a8" strokeWidth={1.2} />
      <ellipse cx={cx} cy={cy} rx={R} ry={R * 0.16} fill="none" stroke="#c9c3b4" strokeDasharray="3 4" />
      <text x={cx + R + 6} y={cy + 4} className="ax">
        equator
      </text>
      <ellipse cx={cx} cy={y} rx={rx} ry={Math.max(2, rx * 0.16)} fill="none" stroke={GRAPHIC.violet} strokeWidth={3} />
      <path
        d={`M${cx - rx * 0.5} ${y + rx * 0.16 * 0.87} L${cx + rx * 0.5} ${y + rx * 0.16 * 0.87}`}
        className="flow-dots"
        stroke={GRAPHIC.violet}
        strokeWidth={6}
        style={u > 0.5 ? { animationDuration: `${Math.max(0.15, 18 / Math.min(400, u)).toFixed(2)}s` } : { animationPlayState: 'paused' }}
      />
      <text x={cx} y={y - Math.max(6, rx * 0.16) - 6} textAnchor="middle" className="lab" style={{ fill: TEXT.violet }}>
        {fmt(lat)}°
      </text>
      <text x={cx} y={cy + R + 22} textAnchor="middle" className="ax">
        the ring’s wind, relative to the ground
      </text>

      {/* Its wind against latitude. */}
      <text className="ax" x={300} y={18}>
        Eastward wind relative to the ground, m/s
      </text>
      <GridY y={RY} ticks={[0, 100, 200, 300]} x0={300} x1={616} baseline={0} />
      <g clipPath={`url(#${clip})`}>
        <line x1={300} x2={616} y1={RY(JET_TARGET)} y2={RY(JET_TARGET)} stroke={GRAPHIC.gray} strokeDasharray="2 3" />
        <path d={linePath(RING_LATS.map(RX), ideal.map(RY))} fill="none" stroke="#9a9a9a" strokeWidth={1.8} strokeDasharray="6 4" />
        <path d={linePath(RING_LATS.map(RX), kept.map(RY))} fill="none" stroke={GRAPHIC.violet} strokeWidth={3} />
      </g>
      <text x={612} y={RY(JET_TARGET) - 5} textAnchor="end" className="ax">
        40 m/s
      </text>
      <line className="cur" x1={RX(lat)} x2={RX(lat)} y1={30} y2={262} />
      {u <= 300 && <circle cx={RX(lat)} cy={RY(u)} r={6} fill={GRAPHIC.violet} stroke="#fcfcfb" strokeWidth={2} />}
      {[0, 10, 20, 30, 40, 50, 60].map((l) => (
        <text key={l} className="ax ax-m" x={RX(l)} y={280}>
          {l}°
        </text>
      ))}
      <text className="ax ax-e" x={616} y={294}>
        latitude
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('circulation', { rotation: 1, contrastK: CONTRAST_DEFAULT_K });
  const { rotation, contrastK } = s.state;
  const circ = circulationFor(rotation, contrastK);
  const one = circ.cells.length === 1;
  const belt = circ.belts.find((b) => LATITUDE >= b.from && LATITUDE < b.to) ?? circ.belts[0];
  const solved = tradesSolved(rotation, contrastK);

  const r = useScenario('ring', { lat: 30, loss: 0 });
  const { lat, loss } = r.state;
  const solved2 = jetSolved(loss);

  // Numbers the prose quotes.
  const earth = circulationFor(1, CONTRAST_DEFAULT_K);
  const omegaA = OMEGA * EARTH_RADIUS_M;
  const noTransport = latitudeBalance(0);
  const contrast11 = noTransport.equatorC - noTransport.poleC;
  // Air at rest over 30° reaching 10°, keeping its angular momentum: its wind relative to the ground.
  const m30 = omegaA * EARTH_RADIUS_M * Math.cos(rad(30)) ** 2;
  const trade10 = m30 / (EARTH_RADIUS_M * Math.cos(rad(10))) - omegaA * Math.cos(rad(10));

  return (
    <LessonPage id="weather/2.1">
      <P>
        Chapter 1 took the weather apart, ending with winds that circle the highs and lows instead of filling them (
        <a href={lessonHref('weather/1.5')}>Lesson 1.5</a>). This chapter puts the pieces back together, at larger and larger scales, until we arrive at the
        weather of one city on one coast. We’ll start with the largest scale of all: the circulation of the whole planet.
      </P>
      <P>
        The first explanation was George Hadley’s, in 1735, for the steady winds sailors met in the tropics. Air heated at the equator rises and flows toward the
        pole high up, and cooler air flows in along the surface to replace it: one great loop in each hemisphere, carrying the tropical surplus of{' '}
        <a href={lessonHref('weather/1.1')}>Lesson 1.1</a> poleward. Hadley saw that Earth’s turning matters too. The ground at the equator moves east faster
        than the ground on either side of it, so air flowing in toward the equator lags behind the ground beneath it and blows from the east. What his picture
        missed is that the turning also limits how far the loop can reach. On a planet that turns as fast as ours, it closes long before the pole, and the
        circulation breaks into several pieces.
      </P>
      <P>
        In the next demonstration, the half-disk is one hemisphere seen from the side, with the equator along the bottom and the pole at the top. Its face shows the
        winds at the surface, shaded violet where they blow from the east and teal where they blow from the west. Along its edge is the atmosphere, its height
        exaggerated many times, with its <b>circulation cells</b>; the moving dots follow the air around each one, and the violet dot high above the Hadley cell’s
        edge marks a fast wind, the subtropical jet, that the second half of this lesson explains. Change how fast the planet turns and the{' '}
        <K tone={WX.temperature}>temperature contrast</K> between equator and pole that sunlight would impose if no air moved. It starts at{' '}
        {fmt(CONTRAST_DEFAULT_K)} °C, a standard value for Earth; the cruder model of <a href={lessonHref('weather/1.1')}>Lesson 1.1</a>, without transport, put
        it at about {fmt(contrast11)} °C:
      </P>

      <Figure name="Global Circulation Simulator" scenario={s}>
        <GlobeCells circ={circ} rotation={rotation} />
        <Legend
          items={[
            { label: 'Hadley cell', color: GRAPHIC.red },
            { label: 'Ferrel cell', color: GRAPHIC.gray },
            { label: 'Polar cell', color: GRAPHIC.blue },
            { label: 'Surface wind', color: GRAPHIC.violet, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'jet, if no spin were lost', value: one ? '—' : `${fmt(circ.jetSpeedIdeal)} m/s`, tone: WX.wind },
            { label: 'the ground’s speed at the equator', value: `${fmt(surfaceSpeed(0, rotation))} m/s` },
          ]}
        />
        <Slider
          label="How fast the planet turns"
          value={rotation}
          min={0.25}
          max={4}
          step={ROTATION_STEP}
          onChange={(v) => s.set({ rotation: v })}
          display={`${fmt(rotation, 2)} × Earth’s`}
        />
        <Slider
          label="Equator-to-pole contrast"
          tone={WX.temperature}
          value={contrastK}
          min={30}
          max={150}
          step={5}
          onChange={(v) => s.set({ contrastK: v })}
          display={`${fmt(contrastK)} °C`}
        />
        <Eq label={`The Hadley cell's reach: the square root of 5 g H times the contrast over 3 Omega squared a squared, which here is ${fmt(circ.hadleyEdge)} degrees`}>
          <span>
            φ<Sub>H</Sub>
          </span>
          <Op>=</Op>
          <span>√</span>
          <Frac
            top={
              <>
                5 g H · <K tone={WX.temperature}>Δθ</K> / θ<Sub>0</Sub>
              </>
            }
            bottom={
              <>
                3 Ω<Sup>2</Sup> a<Sup>2</Sup>
              </>
            }
          />
          <Op>=</Op>
          <span>{one ? '90° (capped)' : `${fmt(circ.hadleyEdge)}°`}</span>
        </Eq>
        <Caption>
          {one
            ? 'Turning this slowly, the planet has one Hadley cell in each hemisphere, reaching from the equator to the pole.'
            : `Fenwick Bay, at 41°, lies in the ${belt.name.toLowerCase()}${belt.fromThe === 'west' ? ': its weather arrives from the west.' : '.'} Only the Hadley cell’s edge is computed; the Ferrel and polar cells meet at 60°, where they do on Earth, whatever the settings.`}
        </Caption>
      </Figure>

      <P>
        At Earth’s rate of turning, the model’s Hadley cell reaches {fmt(earth.hadleyEdge)}°; the real one reaches about 30°, shifting with the seasons. Where its air
        rises, near the equator, it cools and its vapor condenses, as in <a href={lessonHref('weather/1.3')}>Lesson 1.3</a>: this is the rainiest belt on Earth,
        the intertropical convergence zone. Where it sinks, at the cell’s edge, the air is compressed and warmed (<a href={lessonHref('weather/1.2')}>Lesson
        1.2</a>), and having rained out its water on the way up, it arrives dry. That’s why the great hot deserts — the Sahara, the Arabian, the Kalahari, the
        Australian interior — lie in the subtropics.
      </P>
      <P>
        The reach is set by a balance worked out by Isaac Held and Arthur Hou in 1980, and the equation in the demonstration is their result. φ<Sub>H</Sub> is the
        latitude the cell reaches, in radians, and g is gravity’s pull, 9.81 m/s². H is the height of the <b>tropopause</b>, the top of the lowest layer of the
        atmosphere, in which the temperature falls with height and nearly all the weather happens; this model puts it at {fmt(TROPOPAUSE_KM)} km, roughly its height
        over the tropics. Δθ is the contrast, measured against a reference temperature θ<Sub>0</Sub> of {fmt(THETA0_K)} K; Ω is how fast the planet turns, and a is
        its radius, {fmt(EARTH_RADIUS_M / 1000)} km. The starting contrast is a third of θ<Sub>0</Sub>, the value commonly used with this theory; at the{' '}
        {fmt(contrast11)} °C of <a href={lessonHref('weather/1.1')}>Lesson 1.1</a> the cell would reach {fmt(circulationFor(1, contrast11).hadleyEdge)}°.
      </P>
      <P>
        Read the equation for its shape. The reach grows with the square root of the contrast and is inversely proportional to the spin: at twice Earth’s rate the
        cell reaches only {fmt(circulationFor(2, CONTRAST_DEFAULT_K).hadleyEdge, 1)}°, half as far. Turn the planet slowly enough and a single cell spans the whole
        hemisphere, much as Hadley imagined. Venus, which takes 243 Earth days to turn once, is thought to have Hadley cells reaching most of the way to its poles.
        Fast-spinning Jupiter goes the other way: its clouds are striped with many alternating bands of wind, more than our three-cell picture draws. Why the
        turning holds the cell back is the subject of the second half of this lesson.
      </P>
      <P>
        The cells set the winds at the surface. Air returning to the equator along the bottom of the Hadley cell moves toward latitudes where the ground travels east
        faster: {fmt(surfaceSpeed(0))} m/s at the equator against {fmt(surfaceSpeed(30))} at 30°. It lags behind the ground, and the deflection of{' '}
        <a href={lessonHref('weather/1.5')}>Lesson 1.5</a> turns it westward. Friction with the sea holds these <b>trade winds</b> to a steady 5 to 8 m/s or so,
        blowing from the north-east in the Northern Hemisphere. Poleward of the Hadley cell the surface air moves poleward, gets ahead of the slower ground and
        becomes the <b>westerlies</b>. The two are linked. Easterly winds drag on the ground and take eastward spin
        from the solid Earth; westerlies give it back. Earth’s spin doesn’t change from year to year, so the trades on their own can’t be the whole story: somewhere
        there must be westerlies to return what they take.
      </P>
      <P>
        Fenwick Bay, at 41°, lies in the westerlies. Weather there arrives from the west: the storms and fronts that cross it have been crossing the continent for
        days. When Chapter 3 asks how far ahead its weather can be forecast, that’s where the forecaster will look.
      </P>

      <Challenge
        id="a"
        question={`Predict first: at Earth’s rate the cell reaches ${fmt(earth.hadleyEdge, 1)}°, and the reach is inversely proportional to the spin. How fast could the planet turn, as a multiple of Earth’s rate, and still have its Hadley cell reach Fenwick Bay’s ${LATITUDE}°, putting the city in the trade winds? Work it out, then set the spin to your answer, rounded down to the slider’s steps of 0.05, with the contrast at ${fmt(CONTRAST_DEFAULT_K)} °C.`}
        solved={solved}
        status={
          contrastK !== CONTRAST_DEFAULT_K
            ? `First set the contrast back to ${fmt(CONTRAST_DEFAULT_K)} °C.`
            : Math.abs(rotation - 1) < 1e-9
              ? `At Earth’s rate the cell reaches ${fmt(earth.hadleyEdge, 1)}°. What spin does the inverse proportion give for ${LATITUDE}°?`
              : circ.hadleyEdge >= LATITUDE
                ? `At ${fmt(rotation, 2)} × Earth’s spin the Hadley cell reaches ${one ? 'the pole' : `${fmt(circ.hadleyEdge, 1)}°`}. Could the planet turn faster and still reach ${LATITUDE}°?`
                : `At ${fmt(rotation, 2)} × Earth’s spin the Hadley cell reaches only ${fmt(circ.hadleyEdge, 1)}°.`
        }
        success={`Solved. ${fmt(earth.hadleyEdge, 1)} ÷ ${LATITUDE} = ${fmt(earth.hadleyEdge / LATITUDE, 2)}, so at ${fmt(rotation, 2)} times Earth’s rate — a day of about ${fmt(24 / rotation)} hours — the cell reaches ${fmt(circ.hadleyEdge, 1)}°, and the city has trade winds from the north-east and a desert climate’s sinking air nearby. A planet turning about ${fmt((1 - earth.hadleyEdge / LATITUDE) * 100)}% slower than ours would move Fenwick Bay out of the westerlies.`}
      />

      <H2>A ring of air</H2>
      <P>
        The Hadley cell’s air keeps its spin because of the conservation of <b>angular momentum</b>. Think of a ring of air circling the planet along the equator, at rest
        relative to the ground beneath it. It is still moving east at {fmt(omegaA)} m/s, carried round with the planet. Now move the whole ring poleward. The ring
        shrinks, since a line of latitude is shorter than the equator, and like a figure skater pulling in her arms it spins faster. But the ground under it is
        moving more slowly than at the equator. The difference is a west wind.
      </P>
      <P>
        In the next demonstration, choose how far poleward the ring travels. The dashed curve is its wind relative to the ground if it keeps all its angular
        momentum, and the violet curve the wind it’s left with if something drains away a share of its excess spin. In the real atmosphere that something is the
        swirling <b>eddies</b> of the middle latitudes, which the end of this lesson describes. The share starts at zero:
      </P>

      <Figure name="Global Circulation Simulator · a ring of air" scenario={r}>
        <RingFigure lat={lat} loss={loss} />
        <Legend
          items={[
            { label: 'Keeping all its angular momentum', color: '#9a9a9a', kind: 'line', dashed: true },
            { label: 'After eddies drain their share', color: GRAPHIC.violet, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'the ground’s eastward speed', value: `${fmt(surfaceSpeed(lat))} m/s` },
            { label: 'the ring’s wind over the ground', value: `${fmt(ringWind(lat, loss))} m/s`, tone: WX.wind },
          ]}
        />
        <Slider label="Latitude reached" value={lat} min={0} max={60} onChange={(v) => r.set({ lat: v })} display={`${fmt(lat)}°`} />
        <Slider
          label="Excess spin drained by eddies"
          tone={WX.wind}
          value={loss}
          min={0}
          max={0.95}
          step={0.05}
          onChange={(v) => r.set({ loss: v })}
          display={`${fmt(loss * 100)}%`}
        />
        <Eq label="The wind of a ring that keeps its angular momentum: Omega a times sine squared of the latitude over its cosine">
          <K tone={WX.wind}>u</K>
          <Op>=</Op>
          <Frac
            top={
              <>
                Ω a sin<Sup>2</Sup>φ
              </>
            }
            bottom="cos φ"
          />
          <Op>=</Op>
          <K tone={WX.wind}>{fmt(angularMomentumWind(lat))} m/s</K>
          <span>at {fmt(lat)}°</span>
        </Eq>
      </Figure>

      <P>
        Kept whole, the ring’s spin makes absurd winds: {fmt(angularMomentumWind(30))} m/s at 30° and {fmt(angularMomentumWind(LATITUDE))} m/s at 41°. At{' '}
        {fmt(earth.hadleyEdge)}°, the edge of the model’s Hadley cell, it would be {fmt(earth.jetSpeedIdeal)} m/s, the speed in the readout of{' '}
        <FigRef to="Global Circulation Simulator">the first demonstration</FigRef>. That is why the cell stops there: in Held and Hou’s balance, it closes
        where the wind its spin would make is faster than its temperature contrast can support. The same bookkeeping, run the other way, makes the trade winds. Air
        that left 30° at rest and kept all its spin would reach 10° blowing from the east at about {fmt(Math.round(-trade10 / 10) * 10)} m/s, far more than
        friction lets the real ones keep.
      </P>
      <P>
        The air at the top of the Hadley cell really does spin up this way, and that’s where the <K tone={WX.wind}>subtropical jet stream</K> comes from: a river
        of fast westerly wind near the tropopause, around 12 km up, at the cell’s poleward edge. But in a Northern Hemisphere winter, averaged around the globe, it
        blows at about {JET_TARGET} m/s, not {fmt(angularMomentumWind(30))}.
      </P>
      <P>
        What drains the rest is the subject of the next few lessons. The smooth loops of <FigRef to="Global Circulation Simulator">the first demonstration</FigRef>{' '}
        are averages. In the middle latitudes the real air moves in eddies — the lows and highs of <a href={lessonHref('weather/1.5')}>Lesson 1.5</a>, the storms
        on a weather map — that carry heat poleward and spin away from the jets. The Ferrel cell, in particular, isn’t a conveyor at all: it is what those eddies look like when their
        motion is averaged around a latitude circle, which is why it turns the “wrong” way, rising in the cold and sinking in the warm.
      </P>

      <Challenge
        id="b"
        question={`Predict first: whatever share of the excess spin the eddies drain, the ring keeps the rest of its ${fmt(angularMomentumWind(30))} m/s at 30°. What share must they drain to leave a realistic ${JET_TARGET} m/s? Work it out, then set the slider to your answer, to the nearest 5%, and check it at 30°.`}
        solved={solved2}
        status={
          loss === 0
            ? `Nothing drained yet: the ring blows at ${fmt(angularMomentumWind(30))} m/s at 30°. What share leaves ${JET_TARGET}?`
            : `With ${fmt(loss * 100)}% drained, the ring blows at ${fmt(ringWind(30, loss), 1)} m/s at 30°.`
        }
        success={`Solved. 1 − ${JET_TARGET}/${fmt(angularMomentumWind(30))} = ${fmt(1 - JET_TARGET / angularMomentumWind(30), 2)}: with ${fmt(loss * 100)}% of the excess spin drained, the ring blows at ${fmt(ringWind(30, loss), 1)} m/s at 30°. The eddies must take most of what the Hadley cell builds up, handing it on to the westerly winds further poleward and, through them, by friction, back to the ground.`}
      />

      <P>
        Jets form wherever temperature changes sharply with latitude, because the wind aloft strengthens with height in proportion to that contrast. The middle
        latitudes have a second jet, the <b>polar-front jet</b>, which wanders north and south above the boundary where cold polar air meets warm subtropical air.
        That boundary — the polar front — runs right across the latitudes of Fenwick Bay, and it’s where the eddies are born. The next lesson zooms in on it: on air
        masses, and the fronts where they meet.
      </P>
    </LessonPage>
  );
}
