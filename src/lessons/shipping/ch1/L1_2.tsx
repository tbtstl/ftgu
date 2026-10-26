import { useMemo } from 'react';
import {
  Caption,
  Challenge,
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
  Slider,
  Sub,
  TEXT,
  Tn,
  fmt,
  lessonHref,
  pct,
  tint,
  useScenario,
} from '../../../framework';
import { KESTREL } from '../../../model/shipping/vessels';
import { displacementAt, draftFor } from '../../../engines/shipping/hydrostatics';
import { G, KNOT, calmResistance, type Resistance } from '../../../engines/shipping/resistance';
import { HULL_FILL, HULL_STROKE, SEA_FILL, SEA_LINE } from '../shared/ShipSide';
import { XYChart } from '../shared/XYChart';
import { useRevealed } from './reveal';

const K_ = KESTREL;
const LADEN = K_.designDraft;
const BALLAST = draftFor(K_, K_.lightship + K_.consumables + K_.ballast);
/** Kelvin's wedge: half-angle asin(1/3), the same at every speed in deep water. */
const KELVIN_DEG = (Math.asin(1 / 3) * 180) / Math.PI;
const KELVIN_TAN = Math.tan((KELVIN_DEG * Math.PI) / 180);

const kN = (x: number) => `${fmt(x)} kN`;
const kW = (x: number) => `${fmt(x)} kW`;
const kn = (x: number) => `${fmt(x, 1)} kn`;

/** Kestrel's calm-water resistance at a speed, draft, fullness and fouling. */
export function drag(speedKn: number, draft = LADEN, cb = K_.cb, fouling = 0): Resistance {
  return calmResistance({ ...K_, cb }, speedKn, draft, fouling);
}

/** Wavelength of the transverse waves that keep pace with the ship, m: 2πV²/g. */
export function shipWavelength(speedKn: number): number {
  const v = speedKn * KNOT;
  return (2 * Math.PI * v * v) / G;
}

/** The challenge's power budget: the clean, laden hull at 14 knots. */
export const CLEAN_14_KW = drag(14).effectivePower;

/** Fouled-hull effective power at a speed (laden, Kestrel's own hull). */
const fouledPower = (speedKn: number, fouling: number) => drag(speedKn, LADEN, K_.cb, fouling).effectivePower;

/** The highest speed on the slider's 0.1-knot grid at which the fully fouled hull needs no more than the clean hull did at 14 knots. */
export const FOULED_TOP_SPEED = (() => {
  let best = 0;
  for (let i = 60; i <= 180; i++) if (fouledPower(i / 10, 1) <= CLEAN_14_KW + 1e-9) best = i / 10;
  return best;
})();

/** The cube-law estimate the challenge asks for: 14 knots divided by the cube root of fouling's extra power at 14 knots. */
export const FOULED_CUBE_ESTIMATE = 14 / Math.cbrt(fouledPower(14, 1) / CLEAN_14_KW);

/**
 * The challenge: with the hull fully fouled, a speed within two tenths of a knot below the highest
 * one the clean hull's 14-knot power can hold, read where the fouled curve crosses the dashed line.
 * The power readout is hidden until then, so the reader predicts with the cube law and checks on the chart.
 */
export function foulingSolved(speedKn: number, fouling: number): boolean {
  if (fouling < 1 - 1e-9) return false;
  const s = Math.round(speedKn * 10) / 10;
  return s <= FOULED_TOP_SPEED + 1e-9 && s >= FOULED_TOP_SPEED - 0.2 - 1e-9;
}

// Numbers the prose quotes, all from the model.
const R14 = drag(14);
const R12 = drag(12);
const R10 = drag(10);
const R6 = drag(6);
const R18 = drag(18);
const B14 = drag(14, BALLAST);
const FINE14 = drag(14, LADEN, 0.6);
const FINE18 = drag(18, LADEN, 0.6);
const FOUL14 = drag(14, LADEN, K_.cb, 1);
const viscous = (r: Resistance) => r.friction + r.form + r.roughness;
const DISP_FULL = displacementAt(K_, LADEN);
const DISP_FINE = displacementAt({ ...K_, cb: 0.6 }, LADEN);
/** Speed above which the fine hull is cheaper to push per tonne of displacement, to the nearest knot. */
const CROSSOVER = (() => {
  for (let v = 10; v <= 20; v += 0.05) if (drag(v, LADEN, 0.6).total / DISP_FINE < drag(v).total / DISP_FULL) return Math.round(v);
  return 20;
})();
const ANSWER = FOULED_TOP_SPEED;

const PART_COLORS = {
  friction: GRAPHIC.violet,
  form: tint(GRAPHIC.violet, 0.55),
  roughness: '#8b8199',
  wave: GRAPHIC.blue,
  air: '#c4c4c4',
};
const PARTS: Array<{ key: keyof typeof PART_COLORS; name: string }> = [
  { key: 'friction', name: 'Friction' },
  { key: 'form', name: 'Form' },
  { key: 'roughness', name: 'Roughness' },
  { key: 'wave', name: 'Waves' },
  { key: 'air', name: 'Air' },
];

// Plan-view geometry.
const PX_PER_M = 0.75;
const BOW_X = 470;
const CY = 112;
const PANEL_H = 224;
const SHIP_PX = K_.loa * PX_PER_M;
const STERN_X = BOW_X - SHIP_PX;
const HB = (K_.beam / 2) * PX_PER_M;

const HULL_PLAN = [
  `M${STERN_X} ${CY - 0.78 * HB}`,
  `L${STERN_X + 0.12 * SHIP_PX} ${CY - HB}`,
  `L${STERN_X + 0.8 * SHIP_PX} ${CY - HB}`,
  `C${STERN_X + 0.94 * SHIP_PX} ${CY - HB} ${BOW_X} ${CY - 0.55 * HB} ${BOW_X} ${CY}`,
  `C${BOW_X} ${CY + 0.55 * HB} ${STERN_X + 0.94 * SHIP_PX} ${CY + HB} ${STERN_X + 0.8 * SHIP_PX} ${CY + HB}`,
  `L${STERN_X + 0.12 * SHIP_PX} ${CY + HB}`,
  `L${STERN_X} ${CY + 0.78 * HB}`,
  'Z',
].join(' ');

/** Kelvin wave crests behind the bow: x = −C cos θ (1 + sin²θ), y = C cos²θ sin θ, for C = nλ. */
function kelvinCrests(speedKn: number): Array<{ d: string; c: number }> {
  const lam = shipWavelength(speedKn) * PX_PER_M;
  const out: Array<{ d: string; c: number }> = [];
  const cMax = 500;
  for (let n = 1; n * lam <= cMax; n++) {
    const c = n * lam;
    let d = '';
    for (let i = 0; i <= 28; i++) {
      const th = ((-84 + (168 * i) / 28) * Math.PI) / 180;
      const s = Math.sin(th);
      const co = Math.cos(th);
      const x = BOW_X - c * co * (1 + s * s);
      const y = CY + c * co * co * s;
      d += `${i ? ' L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    out.push({ d, c });
  }
  return out;
}

const flowStyle = (speedKn: number) => ({ animationDuration: `${(18 / (3.5 * speedKn)).toFixed(3)}s` });

export default function Lesson() {
  const lab = useScenario('drag', { speed: 14, load: 1, cb: K_.cb });
  const { speed, load, cb } = lab.state;
  const draft = BALLAST + load * (LADEN - BALLAST);
  const r = drag(speed, draft, cb);
  const v = speed * KNOT;
  const crests = useMemo(() => kelvinCrests(speed), [speed]);
  const intensity = Math.min(1, Math.max(0.08, ((r.froude - 0.05) / 0.15) ** 1.5));
  const lambda = shipWavelength(speed);
  const loadName = load <= 1e-9 ? ' · ballast' : load >= 1 - 1e-9 ? ' · laden' : '';

  // The resistance bar: 0–1,500 kN.
  const BX0 = 60;
  const BX1 = 600;
  const bx = (f: number) => BX0 + (f / 1500) * (BX1 - BX0);
  let acc = 0;
  const segments = PARTS.map((p) => {
    const w = r[p.key];
    const seg = { ...p, x: bx(acc), w: bx(acc + w) - bx(acc), value: w };
    acc += w;
    return seg;
  });

  // Demonstration 2: the speed curve.
  const sc = useScenario('speed-curve', { speed: 14, fouling: 0 });
  const curve = useMemo(() => {
    const xs = Array.from({ length: 121 }, (_, i) => 6 + i * 0.1);
    return { xs, clean: xs.map((s) => drag(s).effectivePower) };
  }, []);
  const fouledCurve = useMemo(() => curve.xs.map((s) => fouledPower(s, sc.state.fouling)), [curve, sc.state.fouling]);
  const cube = curve.xs.map((s) => R14.effectivePower * (s / 14) ** 3);
  const pNow = fouledPower(sc.state.speed, sc.state.fouling);
  const pClean = drag(sc.state.speed).effectivePower;
  const solved = foulingSolved(sc.state.speed, sc.state.fouling);
  const revealed = useRevealed('shipping/1.2', 'a', solved);
  const foulName = sc.state.fouling <= 1e-9 ? 'clean' : sc.state.fouling >= 1 - 1e-9 ? 'heavily fouled' : 'partly fouled';

  return (
    <LessonPage id="shipping/1.2">
      <P>
        In <a href={lessonHref('shipping/1.1')}>the previous lesson</a>, Kestrel took on about 79,500 tonnes of cargo and settled to her summer draft of{' '}
        {fmt(LADEN, 2)} meters. Floating cost her nothing. The sea holds her up for free, and a loaded ship lying at anchor needs no power at all to stay where
        she is. Moving is another matter. To travel she has to shove the water ahead of her out of the way and drag a skin of water along her sides, and the water
        pushes back. That push is her <K tone="violet">resistance</K>, and almost everything a ship costs to run — the size of her engine, the fuel she burns,
        much of the freight her owners must charge — follows from how big it is and how fast it grows with speed.
      </P>
      <P>
        Naval architects split resistance into parts that behave differently. The largest, for a ship like Kestrel, is <b>friction</b>. Water right against the
        hull is carried along with it, and shearing that thin layer of moving water against the still water outside it takes force. Friction is proportional to
        the hull’s wetted surface — {fmt(R14.wetted)} square meters of steel for Kestrel laden — and to the square of her speed, times a friction coefficient
        that falls slowly as speed rises; the standard estimate of that coefficient is the ITTC-1957 line, agreed by the International Towing Tank Conference. A
        full hull disturbs the flow more than a flat plate of the same area would, which adds <b>form drag</b>, and paint, welds and marine growth add a{' '}
        <b>roughness</b> allowance. Then there are the <b>waves</b> the ship makes, and a little <b>air</b> resistance on her hull and superstructure.
      </P>
      <P>
        Ships measure speed in <K tone="teal">knots</K>. A knot is one <K tone="blue">nautical mile</K> an hour, and a nautical mile, 1,852 meters, is close to one
        minute of latitude along a meridian, so 14 knots is about {fmt(14 * KNOT * 3.6)} kilometers an hour. In the next demonstration Kestrel steams to the right through still, deep water, seen from
        above. The bar under the picture splits her resistance into those five parts. Change her speed, her draft between the light ballast condition and full
        load, and the fullness of her hull:
      </P>

      <Figure name="Hull Drag Lab" scenario={lab}>
        <svg
          className="diagram"
          viewBox="0 0 640 300"
          role="img"
          aria-label={`Kestrel seen from above at ${kn(speed)} and ${fmt(draft, 2)} m draft, block coefficient ${cb.toFixed(2)}, trailing a Kelvin wake. Resistance ${kN(r.total)}: friction ${kN(r.friction)}, form ${kN(r.form)}, roughness ${kN(r.roughness)}, waves ${kN(r.wave)}, air ${kN(r.air)}.`}
        >
          <defs>
            <clipPath id="l12-water">
              <rect x={0} y={0} width={640} height={PANEL_H} />
            </clipPath>
          </defs>
          <rect x={0} y={0} width={640} height={PANEL_H} fill={SEA_FILL} opacity={0.75} />
          <g clipPath="url(#l12-water)">
            {crests.map((c, i) => (
              <path
                key={i}
                d={c.d}
                fill="none"
                stroke={SEA_LINE}
                strokeWidth={0.8 + 1.6 * intensity}
                strokeLinejoin="round"
                opacity={intensity * Math.max(0.15, 1 - c.c / 520)}
              />
            ))}
            {[-1, 1].map((sgn) => (
              <line key={sgn} x1={BOW_X} y1={CY} x2={BOW_X - 520} y2={CY + sgn * 520 * KELVIN_TAN} stroke="#5f5f5f" strokeWidth={1} strokeDasharray="5 4" />
            ))}
            {[-1, 1].map((sgn) => (
              <path
                key={'f' + sgn}
                d={`M${BOW_X + 150} ${CY + sgn * (HB + 9)} L${STERN_X - 10} ${CY + sgn * (HB + 9)}`}
                className="flow-dots"
                stroke="#ffffff"
                strokeWidth={3}
                style={flowStyle(speed)}
              />
            ))}
          </g>
          <path d={HULL_PLAN} fill={HULL_FILL} stroke={HULL_STROKE} strokeWidth={1.5} strokeLinejoin="round" />
          {Array.from({ length: 7 }, (_, i) => (
            <rect key={i} x={STERN_X + (0.21 + i * 0.095) * SHIP_PX} y={CY - 0.62 * HB} width={0.075 * SHIP_PX} height={1.24 * HB} fill="#e2ded6" stroke={HULL_STROKE} strokeWidth={0.8} />
          ))}
          <rect x={STERN_X + 0.03 * SHIP_PX} y={CY - 0.85 * HB} width={0.08 * SHIP_PX} height={1.7 * HB} fill="#fbfaf7" stroke={HULL_STROKE} strokeWidth={1} />
          <text x={BOW_X - 150} y={CY - 150 * KELVIN_TAN - 8} className="ax">
            {fmt(KELVIN_DEG, 1)}° from the track
          </text>
          <text x={BOW_X + 14} y={CY + 5} style={{ fontSize: 14, fontWeight: 600, fill: TEXT.teal }}>
            → {kn(speed)}
          </text>
          <text x={12} y={PANEL_H - 10} className="ax">
            Transverse waves {fmt(lambda, 1)} m apart · Froude number {r.froude.toFixed(3)}
          </text>
          <line x1={520} x2={520 + 100 * PX_PER_M} y1={PANEL_H - 14} y2={PANEL_H - 14} stroke="#5f5f5f" strokeWidth={1.5} />
          <text x={520 + 50 * PX_PER_M} y={PANEL_H - 20} textAnchor="middle" className="ax">
            100 m
          </text>
          {/* the resistance bar */}
          <text x={BX0} y={PANEL_H + 20} className="ax">
            Resistance, kN
          </text>
          {segments.map((s) => (
            <rect key={s.key} x={s.x} y={PANEL_H + 28} width={Math.max(0, s.w)} height={22} fill={PART_COLORS[s.key]} stroke="#fcfcfb" strokeWidth={0.5} />
          ))}
          <text x={Math.min(BX1 - 2, bx(r.total) + 6)} y={PANEL_H + 44} textAnchor={bx(r.total) + 60 > BX1 ? 'end' : 'start'} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.violet }}>
            {kN(r.total)}
          </text>
          {[0, 500, 1000, 1500].map((tk) => (
            <g key={tk}>
              <line x1={bx(tk)} x2={bx(tk)} y1={PANEL_H + 52} y2={PANEL_H + 56} stroke="#9a9a9a" />
              <text x={bx(tk)} y={PANEL_H + 70} className="ax ax-m">
                {fmt(tk)}
              </text>
            </g>
          ))}
        </svg>
        <Legend items={segments.map((s) => ({ label: `${s.name} ${kN(s.value)}`, color: PART_COLORS[s.key] }))} />
        <Slider label="Speed" tone="teal" value={speed} min={6} max={18} step={0.5} onChange={(x) => lab.set({ speed: x })} display={kn(speed)} />
        <Slider label="Draft" tone="blue" value={load} min={0} max={1} step={0.05} onChange={(x) => lab.set({ load: x })} display={`${fmt(draft, 2)} m${loadName}`} />
        <Slider label="Hull fullness, block coefficient" tone="blue" value={cb} min={0.6} max={0.9} step={0.01} onChange={(x) => lab.set({ cb: x })} display={cb.toFixed(2)} />
        <Eq label={`Effective power equals resistance times speed: ${fmt(r.total)} kilonewtons times ${fmt(v, 2)} meters per second equals ${fmt(r.effectivePower)} kilowatts`}>
          <K tone="red">
            P<Sub>E</Sub>
          </K>
          <Op>=</Op>
          <K tone="violet">R</K>
          <Op>×</Op>
          <K tone="teal">V</K>
          <Op>=</Op>
          <Tn tone="violet">{kN(r.total)}</Tn>
          <Op>×</Op>
          <Tn tone="teal">{fmt(v, 2)} m/s</Tn>
          <Op>=</Op>
          <K tone="red">{kW(r.effectivePower)}</K>
        </Eq>
        <Caption>
          Wetted surface {fmt(r.wetted)} m². Friction, form drag and roughness — the water dragging along the hull — make up {pct(viscous(r) / r.total)} of the
          total; waves, {pct(r.wave / r.total)}.
        </Caption>
      </Figure>

      <P>
        At 14 knots, fully laden, Kestrel meets {kN(R14.total)} of resistance — the weight of about {fmt(R14.total / 9.81)} tonnes, pushing back on her all the
        way across an ocean. Friction, form drag and roughness account for {pct(viscous(R14) / R14.total)} of it; waves for {pct(R14.wave / R14.total)}, and air
        for {pct(R14.air / R14.total)}. Overcoming that force at 14 knots, {fmt(14 * KNOT, 2)} meters per second, takes {kW(R14.effectivePower)}. This is the{' '}
        <K tone="red">effective power</K>: the power a tug would need to tow her, the useful work her engine must ultimately deliver.
      </P>
      <P>
        Now watch the wake as you change her speed. A ship heaps up water at her bow and leaves a train of waves behind, and because waves on deep water travel at a
        speed set by their length, the waves that keep pace with her have a definite length: 2πV²/g, {fmt(shipWavelength(14), 1)} meters at 14 knots. Those waves
        fan out in a wedge whose edges stand {fmt(KELVIN_DEG, 1)}° on either side of her track, at every speed — a result Lord Kelvin worked out in 1887. What
        speed changes is the length of the waves, and how much energy they carry away.
      </P>
      <P>
        The yardstick is the <K tone="teal">Froude number</K>: the ship’s speed divided by √(gL), a speed set by her length L and gravity g. Near a Froude number
        of 0.4, the waves she makes grow as long as she is. It is named after
        William Froude, who showed in the 1870s how to predict a full-size ship’s resistance from towing models: friction scales with one rule, waves with
        another, and two hulls of the same shape make the same wave pattern at the same Froude number. Kestrel at 14 knots is at {R14.froude.toFixed(3)}, and her
        waves are only {fmt(shipWavelength(14), 0)} meters long beside her 225-meter hull. They matter little at low speed and a great deal at high speed: waves
        make {pct(R6.wave / R6.total, 1)} of her resistance at 6 knots and {pct(R18.wave / R18.total)} at 18. Between 12 and 14 knots, friction grows{' '}
        {fmt(R14.friction / R12.friction, 2)}-fold, a little less than the square of the speed ratio, {fmt((14 / 12) ** 2, 2)}; wave resistance grows{' '}
        {fmt(R14.wave / R12.wave, 2)}-fold. (Real wave resistance rises in humps and hollows as the waves from the bow and stern reinforce or cancel each other.
        Our model uses a smooth curve that is a fair average for full hulls at Froude numbers below about 0.3.)
      </P>

      <H2>Draft and fullness</H2>
      <P>
        Lighten Kestrel to her ballast draft of {fmt(BALLAST, 2)} meters and her resistance at 14 knots falls to {kN(B14.total)}, {pct(1 - B14.total / R14.total)}{' '}
        less, mostly because {pct(1 - B14.wetted / R14.wetted)} less of her hull is wet. A ship sailing empty to her next cargo is cheaper to push than a loaded
        one, which is why owners often quote different speeds and fuel consumptions laden and in ballast.
      </P>
      <P>
        Now bring her draft back to full and her block coefficient down to 0.60, the fineness of a container ship. At 14 knots the fine hull meets{' '}
        {kN(FINE14.total)} of resistance against Kestrel’s {kN(R14.total)}, and its wave resistance is {kN(FINE14.wave)} rather than {kN(R14.wave)}; at 18 knots
        that gap widens to {kN(FINE18.wave)} against {kN(R18.wave)}. But as <a href={lessonHref('shipping/1.1')}>the previous lesson</a> showed, the fine hull also
        displaces less — {fmt(DISP_FINE)} tonnes instead of {fmt(DISP_FULL)} at the same draft. Per tonne of displacement, in our model, the full hull is the
        cheaper one to push below about {CROSSOVER} knots and the fine one above it. That is why ships that carry cheap, heavy cargo slowly are built full, and ships that carry
        expensive goods on fast schedules are built fine.
      </P>

      <H2>The cost of speed</H2>
      <P>
        Power is resistance times speed, and resistance itself grows a little faster than the square of speed, so power grows roughly with the cube. In the next
        demonstration, the red curve is Kestrel’s effective power, laden, at every speed from 6 to 18 knots. The dotted curve is an exact cube law through her
        14-knot point, for comparison, and the dashed line marks what her clean hull needs at 14 knots. Move the speed, and then let her hull foul:
      </P>

      <Figure name="Hull Drag Lab · speed curve" scenario={sc}>
        <XYChart
          ariaLabel={`Kestrel’s effective power, laden, from 6 to 18 knots with a ${foulName} hull. At ${kn(sc.state.speed)} she needs ${kW(pNow)}, against ${kW(pClean)} with a clean hull.`}
          series={[
            { xs: curve.xs, ys: cube, color: '#9a9a9a', width: 1.5, dash: '2 4', label: '∝ V³', labelColor: TEXT.gray },
            ...(sc.state.fouling > 1e-9 ? [{ xs: curve.xs, ys: curve.clean, color: tint(GRAPHIC.red, 0.5), width: 2, label: 'clean', labelColor: TEXT.red }] : []),
            { xs: curve.xs, ys: fouledCurve, color: GRAPHIC.red, width: 2.5, label: sc.state.fouling > 1e-9 ? foulName : 'clean hull', labelColor: TEXT.red },
          ]}
          xMin={6}
          xMax={18}
          yMin={0}
          yMax={18_000}
          yTicks={[0, 5_000, 10_000, 15_000]}
          xTicks={[6, 8, 10, 12, 14, 16, 18]}
          xFormat={(x) => `${x}`}
          yFormat={(y) => fmt(y)}
          xLabel="Speed, knots"
          yLabel="Effective power, kW"
          refLines={[{ y: CLEAN_14_KW, color: '#777', label: `clean hull at 14 kn: ${kW(CLEAN_14_KW)}` }]}
          cursor={sc.state.speed}
          markers={[{ x: sc.state.speed, y: pNow, color: TEXT.red }]}
          height={250}
        />
        <Readouts
          items={[
            { label: `extra power from fouling, at ${kn(sc.state.speed)}`, value: pct(pNow / pClean - 1), tone: 'violet' },
            ...(revealed ? [{ label: `power at ${kn(sc.state.speed)}, ${foulName}`, value: kW(pNow), tone: 'red' as const }] : []),
          ]}
        />
        <Slider label="Speed" tone="teal" value={sc.state.speed} min={6} max={18} step={0.1} onChange={(x) => sc.set({ speed: x })} display={kn(sc.state.speed)} />
        <Slider
          label="Hull fouling"
          tone="violet"
          value={sc.state.fouling}
          min={0}
          max={1}
          step={0.05}
          onChange={(x) => sc.set({ fouling: x })}
          display={`${fmt(sc.state.fouling * 100)}%${sc.state.fouling <= 1e-9 ? ' · clean' : sc.state.fouling >= 1 - 1e-9 ? ' · heavy' : ''}`}
        />
      </Figure>

      <P>
        From 12 to 14 knots — {pct(14 / 12 - 1)} faster — Kestrel’s power need rises from {kW(R12.effectivePower)} to {kW(R14.effectivePower)},{' '}
        {pct(R14.effectivePower / R12.effectivePower - 1)} more; a pure cube law would predict {pct((14 / 12) ** 3 - 1)}. Slowing from 14 knots to 10 cuts it
        by a factor of {fmt(R14.effectivePower / R10.effectivePower, 1)}. Below about 14 knots the model’s curve hugs the cube law; above it, wave-making bends it
        upward. This steep relation between speed and power is one of the most consequential facts in this course. It is why a ship’s fuel bill depends so much on
        how fast she is asked to go, and in <a href={lessonHref('shipping/2.3')}>Lesson 2.3</a> it will decide how fast her owners choose to sail.
      </P>

      <H2>A dirty hull</H2>
      <P>
        A ship’s bottom is a habitat. A film of slime forms on it within days, and weed, barnacles and tubeworms follow — fastest in warm water, and when a ship
        lies idle. Every layer roughens the hull under the thin layer of water it drags along, and raises friction. Antifouling paints slow the growth, and owners have hulls
        cleaned by divers or robots and repainted in drydock, but fouling is still one of the main reasons a ship’s fuel consumption creeps up between dockings. In
        our model, a heavily fouled hull multiplies Kestrel’s roughness term {fmt(FOUL14.roughness / R14.roughness, 1)} times, from {kN(R14.roughness)} to{' '}
        {kN(FOUL14.roughness)} at 14 knots, and raises her effective power from {kW(R14.effectivePower)} to {kW(FOUL14.effectivePower)},{' '}
        {pct(FOUL14.effectivePower / R14.effectivePower - 1)} more. The extra drag of fouling grows with the square of speed, like friction itself, so the gap between the
        curves in <FigRef to="Hull Drag Lab · speed curve">this demonstration</FigRef> widens as she goes faster.
      </P>

      <Challenge
        id="a"
        figure="Hull Drag Lab · speed curve"
        question={`Kestrel has spent a long spell at anchor in the tropics and her hull is heavily fouled. Her engine can give her hull no more effective power than it needed, clean, at 14 knots. Fouling adds about ${pct(Math.round((FOUL14.effectivePower / R14.effectivePower - 1) * 20) / 20)} to the power she needs at any speed near 14 knots (the readout shows it), and power goes roughly as the cube of speed. Predict first: how fast can she go on that power? Then set the fouling to 100% and put her at the highest speed she can hold, to within two tenths of a knot.`}
        solved={solved}
        status={
          sc.state.fouling < 1 - 1e-9
            ? `Set the hull fouling to 100% first; it is at ${fmt(sc.state.fouling * 100)}%.`
            : `Her hull is fully fouled and she is set to ${kn(sc.state.speed)}. Compare your prediction with where the fouled curve crosses the dashed line.`
        }
        success={`Solved. The fouled curve crosses the dashed line at about ${kn(ANSWER)}: there her fouled hull needs ${kW(fouledPower(ANSWER, 1))}, just under the ${kW(CLEAN_14_KW)} her clean hull needed at 14 knots, and at ${kn(ANSWER + 0.1)} it would need ${kW(fouledPower(ANSWER + 0.1, 1))}. The cube law gets within a tenth of a knot of that: fouling multiplies her power need by ${fmt(FOUL14.effectivePower / R14.effectivePower, 2)}, so to stay on the same power she must slow by its cube root, ${fmt(Math.cbrt(FOUL14.effectivePower / R14.effectivePower), 2)}, and 14 ÷ ${fmt(Math.cbrt(FOUL14.effectivePower / R14.effectivePower), 2)} ≈ ${kn(FOULED_CUBE_ESTIMATE)}. The fouling has cost her ${fmt(14 - ANSWER, 1)} knots — a tenth of her speed — for the same power. Over a long voyage that is days lost, and Chapter 2 will put a price on them.`}
      />

      <P>
        Effective power is what the hull needs, not what the engine makes. Between the two stand a propeller that wastes part of the shaft’s power churning
        water, and an engine that turns only part of its fuel’s energy into shaft power, the rest leaving as heat. In <a href={lessonHref('shipping/1.3')}>the next
        lesson</a> we’ll follow that chain back from Kestrel’s propeller to her fuel tanks, and work out what a voyage burns.
      </P>
    </LessonPage>
  );
}
