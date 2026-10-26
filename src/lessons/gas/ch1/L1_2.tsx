import { useMemo, useRef, useState } from 'react';
import {
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
  TEXT,
  clamp,
  fmt,
  lessonHref,
  mix,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { piston, scfPerCubicFoot, zFactor } from '../../../engines/gas/eos';
import { COMPONENT, PIPELINE_GAS, R_PSIA, SCF_PER_LBMOL, STD_PSIA, gasProperties, psia, rankine } from '../../../engines/gas/properties';
import { rng } from '../../../model/random';
import { XYChart } from '../shared/XYChart';

// ---------------------------------------------------------------------------
// The cylinder: 1,000 standard cubic feet of the region's pipeline gas.

export const CHARGE_SCF = 1000;
const MOLES = CHARGE_SCF / SCF_PER_LBMOL;
const GAS = gasProperties(PIPELINE_GAS);
export const V_MIN = 4;
export const V_MAX = 50;
export const V_STEP = 0.1;
export const T_MIN = 0;
export const T_MAX = 160;
export const PISTON_DEFAULTS = { volume: 50, temp: 60 };
/** Northline's maximum allowable operating pressure, psig. */
export const MAOP_PSIG = 1440;
export const CHALLENGE_TEMP = 60;

const roundV = (v: number) => Math.round(v * 10) / 10;
const gauge = (pAbs: number) => pAbs - 14.696;

/**
 * The challenge: at 60 °F, the smallest volume on the slider's 0.1 ft³ grid that keeps the gas at or
 * under Northline's 1,440 psig. With the engine's numbers that is 8.0 ft³ (1,435 psig); 7.9 ft³ gives 1,451.
 */
export function maopSolved(volume: number, temp: number): boolean {
  if (temp !== CHALLENGE_TEMP) return false;
  const v = roundV(volume);
  const limit = psia(MAOP_PSIG);
  if (v - V_STEP < V_MIN - 1e-9) return false;
  return piston(CHARGE_SCF, v, temp).pressure <= limit && piston(CHARGE_SCF, roundV(v - V_STEP), temp).pressure > limit;
}

/** The lowest compressibility factor at a temperature, and the pressure (psia) where it occurs. */
export function zMinimum(tempF: number): { z: number; p: number } {
  let best = { z: Infinity, p: 0 };
  for (let p = 100; p <= 4200; p += 10) {
    const z = zFactor(p, tempF);
    if (z < best.z) best = { z, p };
  }
  return best;
}

// Numbers quoted in the prose, all from the engine.
const AT50 = piston(CHARGE_SCF, 50, 60);
const AT25 = piston(CHARGE_SCF, 25, 60);
const AT125 = piston(CHARGE_SCF, 12.5, 60);
const AT12 = piston(CHARGE_SCF, 12, 60);
const Z_STD = zFactor(14.73, 60);
const SCF_1000 = scfPerCubicFoot(1000, 60);
const SCF_1000_IDEAL = (1000 * SCF_PER_LBMOL) / (R_PSIA * rankine(60));
const RHO_1000 = (SCF_1000 * GAS.mw) / SCF_PER_LBMOL;
const SCF_CNG = scfPerCubicFoot(psia(3600), 60);
/** CNG's packing, to the nearest 50 scf: the model's Z runs a few percent low at these pressures, so the prose stays round. */
export const SCF_CNG_ROUNDED = Math.round(SCF_CNG / 50) * 50;
const ZMIN_60 = zMinimum(60);
const ZMIN_0 = zMinimum(0);
/** Root-mean-square molecular speed at 60 °F, m/s: √(3RT/M). */
const V_RMS = Math.sqrt((3 * 8.314462 * (rankine(60) / 1.8)) / (GAS.mw / 1000));
// The heating example: 11.0 ft³, from 40 °F to 100 °F.
export const HEAT = { volume: 11, cold: 40, warm: 100 };
const HEAT_COLD = piston(CHARGE_SCF, HEAT.volume, HEAT.cold);
const HEAT_WARM = piston(CHARGE_SCF, HEAT.volume, HEAT.warm);
const HEAT_IDEAL = (HEAT_COLD.pressure * rankine(HEAT.warm)) / rankine(HEAT.cold);
/** Where an ideal gas would reach the MAOP at 60 °F: Boyle's law from 1,000 cubic feet at 14.73 psia, about 10.1 ft³. */
export const IDEAL_MAOP_VOLUME = (CHARGE_SCF * STD_PSIA) / psia(MAOP_PSIG);
/** The challenge's answer: the smallest volume on the slider's grid that keeps the real gas at or under the MAOP. */
export const MAOP_VOLUME = (() => {
  for (let i = V_MIN * 10; i <= V_MAX * 10; i++) if (maopSolved(i / 10, CHALLENGE_TEMP)) return i / 10;
  return NaN;
})();
const AT_MAOP = piston(CHARGE_SCF, MAOP_VOLUME, CHALLENGE_TEMP);
const PAST_MAOP = piston(CHARGE_SCF, roundV(MAOP_VOLUME - V_STEP), CHALLENGE_TEMP);

// ---------------------------------------------------------------------------
// The animated cylinder.

const N_MOL = 64;
const DOT = 3.2;
const X0 = 150;
const TOP = 92;
const BOT = 212;
const W_MAX = 400;
const GAUGE_MAX = 5000;
const COLD = '#d9e8f5';
const WARM = '#f7d6bf';

const widthOf = (v: number) => (v / V_MAX) * W_MAX;

interface Molecule {
  x: number;
  y: number;
  /** Velocity at 60 °F, px/s; scaled by √(T/T60) as the gas warms. */
  vx: number;
  vy: number;
}

function molecules(): Molecule[] {
  const r = rng(12);
  return Array.from({ length: N_MOL }, () => {
    const a = r() * 2 * Math.PI;
    const s = 70 + 90 * r();
    return { x: r(), y: r(), vx: s * Math.cos(a), vy: s * Math.sin(a) };
  });
}

/** Reflect a normalized coordinate back into [0, 1]; returns the new position and whether it hit the far wall. */
function bounce(p: number): { p: number; flipped: boolean; far: boolean } {
  let q = p;
  let flipped = false;
  let far = false;
  for (let i = 0; i < 8 && (q < 0 || q > 1); i++) {
    if (q > 1) {
      q = 2 - q;
      far = true;
    } else q = -q;
    flipped = !flipped;
  }
  return { p: clamp(q, 0, 1), flipped, far };
}

/** A pressure gauge reading psig, 0–5,000, with a dashed needle for the ideal gas. */
function Gauge({ real, ideal }: { real: number; ideal: number }) {
  const cx = 64;
  const cy = 132;
  const r = 50;
  const ang = (pg: number) => ((-135 + (270 * clamp(pg, 0, GAUGE_MAX)) / GAUGE_MAX) * Math.PI) / 180;
  const at = (pg: number, rr: number) => [cx + rr * Math.sin(ang(pg)), cy - rr * Math.cos(ang(pg))] as const;
  const [rx, ry] = at(real, r - 8);
  const [ix, iy] = at(ideal, r - 8);
  return (
    <g>
      <line x1={cx + r} y1={cy} x2={X0} y2={cy} stroke="#9a9a9a" strokeWidth={6} />
      <circle cx={cx} cy={cy} r={r} fill="#fcfcfb" stroke="#555" strokeWidth={2} />
      {[0, 1000, 2000, 3000, 4000, 5000].map((t) => {
        const [ax, ay] = at(t, r - 2);
        const [bx, by] = at(t, r - 7);
        const [lx, ly] = at(t, r - 15);
        return (
          <g key={t}>
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#555" strokeWidth={1.5} />
            <text x={lx} y={ly + 3.5} textAnchor="middle" style={{ fontSize: 9.5, fill: '#5f5f5f' }}>
              {t / 1000}
            </text>
          </g>
        );
      })}
      <line x1={cx} y1={cy} x2={ix} y2={iy} stroke="#8a8a8a" strokeWidth={2} strokeDasharray="4 3" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={rx} y2={ry} stroke={GRAPHIC.blue} strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4} fill="#444" />
      <text x={cx} y={cy + 32} textAnchor="middle" style={{ fontSize: 9, fill: '#5f5f5f' }}>
        ×1,000 psig
      </text>
      <text x={cx} y={cy + r + 22} textAnchor="middle" style={{ fontSize: 15, fontWeight: 500, fill: TEXT.blue }}>
        {fmt(real)} psig
      </text>
      <text x={cx} y={cy + r + 38} textAnchor="middle" className="ax">
        ideal gas: {fmt(ideal)} psig
      </text>
    </g>
  );
}

function Cylinder({ volume, temp, playing, ariaLabel }: { volume: number; temp: number; playing: boolean; ariaLabel: string }) {
  const mols = useRef<Molecule[] | null>(null);
  if (!mols.current) mols.current = molecules();
  const hits = useRef<Array<{ y: number; age: number }>>([]);
  const [, setTick] = useState(0);
  const w = widthOf(volume);
  const innerW = Math.max(2, w - 2 * DOT);
  const innerH = BOT - TOP - 2 * DOT;
  const speed = Math.sqrt(rankine(temp) / rankine(60));
  const state = piston(CHARGE_SCF, volume, temp);

  useAnimationFrame((dt) => {
    for (const m of mols.current!) {
      const bx = bounce(m.x + (m.vx * speed * dt) / innerW);
      m.x = bx.p;
      if (bx.flipped) m.vx = -m.vx;
      if (bx.far) hits.current.push({ y: m.y, age: 0 });
      const by = bounce(m.y + (m.vy * speed * dt) / innerH);
      m.y = by.p;
      if (by.flipped) m.vy = -m.vy;
    }
    hits.current = hits.current.map((h) => ({ y: h.y, age: h.age + dt })).filter((h) => h.age < 0.3);
    if (hits.current.length > 200) hits.current = hits.current.slice(-200);
    setTick((t) => (t + 1) % 1e6);
  }, playing);

  const fill = mix(COLD, WARM, (temp - T_MIN) / (T_MAX - T_MIN));
  const face = X0 + w;
  return (
    <svg className="diagram" viewBox="0 0 600 252" role="img" aria-label={ariaLabel}>
      <text className="ax" x={X0} y={70}>
        {fmt(CHARGE_SCF)} standard cubic feet of pipeline gas
      </text>
      <text x={X0 + W_MAX} y={70} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: TEXT.teal }}>
        gas at {fmt(temp)} °F
      </text>
      <rect x={X0} y={TOP} width={w} height={BOT - TOP} fill={fill} />
      <line x1={X0} y1={TOP - 2} x2={X0 + W_MAX + 16} y2={TOP - 2} stroke="#9a9a9a" strokeWidth={4} />
      <line x1={X0} y1={BOT + 2} x2={X0 + W_MAX + 16} y2={BOT + 2} stroke="#9a9a9a" strokeWidth={4} />
      <line x1={X0 - 2} y1={TOP - 4} x2={X0 - 2} y2={BOT + 4} stroke="#9a9a9a" strokeWidth={4} />
      {mols.current!.map((m, i) => (
        <circle key={i} cx={X0 + DOT + m.x * innerW} cy={TOP + DOT + m.y * innerH} r={DOT} fill="#4a4a4a" opacity={0.8} />
      ))}
      {hits.current.map((h, i) => (
        <line
          key={i}
          x1={face - 7}
          x2={face}
          y1={TOP + DOT + h.y * innerH}
          y2={TOP + DOT + h.y * innerH}
          stroke={GRAPHIC.blue}
          strokeWidth={2}
          opacity={1 - h.age / 0.3}
        />
      ))}
      <rect x={face} y={TOP} width={12} height={BOT - TOP} fill="#bdbdbd" stroke="#666" strokeWidth={1.5} />
      <line x1={face + 12} y1={(TOP + BOT) / 2} x2={face + 34} y2={(TOP + BOT) / 2} stroke="#888" strokeWidth={6} />
      <rect x={face + 34} y={(TOP + BOT) / 2 - 22} width={8} height={44} rx={2} fill="#888" />
      <Gauge real={gauge(state.pressure)} ideal={gauge(state.idealPressure)} />
      <line x1={X0} x2={face} y1={228} y2={228} stroke="#777" strokeWidth={1} />
      <line x1={X0} x2={X0} y1={222} y2={234} stroke="#777" strokeWidth={1} />
      <line x1={face} x2={face} y1={222} y2={234} stroke="#777" strokeWidth={1} />
      <text x={X0 + Math.max(w, 70) / 2} y={248} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: '#333' }}>
        {volume.toFixed(1)} ft³
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Z against pressure.

const CURVE_TEMPS = [0, 40, 80, 120, 160];
const PRESSURES = Array.from({ length: 105 }, (_, i) => 20 + i * 40);
const P_MAX = 4200;

function zCurve(tempF: number): number[] {
  return PRESSURES.map((p) => zFactor(p, tempF));
}

export default function Lesson() {
  const play = usePlay(true);
  const s = useScenario('piston', PISTON_DEFAULTS);
  const { volume, temp } = s.state;
  const st = piston(CHARGE_SCF, volume, temp);
  const scfPerCf = CHARGE_SCF / volume;
  const solved = maopSolved(volume, temp);
  const overLimit = st.pressure > psia(MAOP_PSIG);

  const fixed = useMemo(() => CURVE_TEMPS.map((t) => ({ t, zs: zCurve(t) })), []);
  const current = useMemo(() => zCurve(temp), [temp]);
  const zmin = useMemo(() => zMinimum(temp), [temp]);

  const sliders = (
    <>
      <Slider label="Volume" value={volume} min={V_MIN} max={V_MAX} step={V_STEP} onChange={(v) => s.set({ volume: v })} display={`${volume.toFixed(1)} ft³`} />
      <Slider label="Temperature" tone="teal" value={temp} min={T_MIN} max={T_MAX} onChange={(v) => s.set({ temp: v })} display={`${temp} °F`} />
    </>
  );

  return (
    <LessonPage id="gas/1.2">
      <P>
        <a href={lessonHref('gas/1.1')}>Lesson 1.1</a> counted gas in standard cubic feet. A standard cubic foot is an amount of gas, not a space: it’s the gas that
        would fill one cubic foot at 60 °F and 14.73 pounds per square inch. Real gas is almost never kept at those conditions. Northline, the pipeline that
        carries gas from Calder Hub to Metro, is allowed to run at up to 1,440 pounds per square inch, and storage fields hold gas in porous rock or salt caverns deep underground, also at high pressure. So
        the number that decides how much energy a pipe or a storage field can hold is how many standard cubic feet fit into one actual cubic foot. The answer
        depends on two things: the gas’s <K tone="blue">pressure</K> and its <K tone="teal">temperature</K>.
      </P>
      <P>
        A gas is a crowd of molecules flying about and colliding. At 60 °F the molecules of the region’s pipeline gas move at a typical {fmt(V_RMS)} meters per second
        — roughly {fmt(Math.round((V_RMS * 2.23694) / 10) * 10)} miles an hour — and every time one strikes a wall it gives the wall a small push. Pressure
        is the total of those pushes on each unit of area, measured in pounds per square inch, psi. Squeeze the same gas into less space and more molecules strike
        each square inch every second, so the pressure rises. Warm it and the molecules move faster, striking harder and more often.
      </P>
      <P>
        In the next demonstration, a cylinder holds 1,000 standard cubic feet of the region’s pipeline gas, weighing {(MOLES * GAS.mw).toFixed(1)} pounds. The gas
        laws count gas by its molecules, in <b>pound-moles</b>: a pound-mole is a fixed number of molecules, as many as there are in {fmt(COMPONENT.methane.mw)} pounds of
        methane or {fmt(COMPONENT.nitrogen.mw)} of nitrogen. Equal volumes hold equal numbers of molecules, so a pound-mole of any gas fills{' '}
        {fmt(SCF_PER_LBMOL, 1)} standard cubic feet, and our cylinder holds 1,000 ÷ {fmt(SCF_PER_LBMOL, 1)} = {MOLES.toFixed(2)} pound-moles. At standard
        conditions the gas would fill 1,000 cubic feet; the piston has already squeezed it into 50. The blue ticks
        on the piston mark molecules hitting it. The gauge’s blue needle is the gas’s pressure, and its dashed needle is what an ideal gas — one whose molecules
        neither attract each other nor take up any room — would show. Push the piston in, and change the temperature:
      </P>

      <Figure name="Gas Piston" scenario={s} play={play}>
        <Cylinder
          volume={volume}
          temp={temp}
          playing={play.playing}
          ariaLabel={`A cylinder holding 1,000 standard cubic feet of pipeline gas in ${volume.toFixed(1)} cubic feet at ${temp} °F. The gauge reads ${fmt(gauge(st.pressure))} psig; an ideal gas would read ${fmt(gauge(st.idealPressure))} psig.`}
        />
        <Readouts
          items={[
            { label: 'absolute pressure', value: `${fmt(st.pressure)} psia`, tone: 'blue' },
            { label: 'ideal gas', value: `${fmt(st.idealPressure)} psia` },
            { label: 'density', value: `${st.density.toFixed(2)} lb/ft³` },
            { label: 'scf per ft³', value: fmt(scfPerCf, 1) },
          ]}
        />
        {sliders}
        <Eq label={`Pressure times volume equals Z times n R T: ${fmt(st.pressure)} psia times ${volume.toFixed(1)} cubic feet equals ${st.z.toFixed(3)} times ${MOLES.toFixed(2)} pound-moles times 10.73 times ${fmt(rankine(temp), 1)} degrees Rankine`}>
          <K tone="blue">{fmt(st.pressure)} psia</K>
          <Op>×</Op>
          <span>{volume.toFixed(1)} ft³</span>
          <Op>=</Op>
          <span>{st.z.toFixed(3)}</span>
          <Op>×</Op>
          <span>{MOLES.toFixed(2)}</span>
          <Op>×</Op>
          <span>10.73</span>
          <Op>×</Op>
          <K tone="teal">{fmt(rankine(temp), 1)} °R</K>
        </Eq>
      </Figure>

      <P>
        At the start the gas pushes with {fmt(AT50.pressure)} psia. Halve the volume to 25 cubic feet and the pressure almost doubles, to {fmt(AT25.pressure)}; halve it
        again, to 12.5, and it reaches {fmt(AT125.pressure)}. Pressure rises in inverse proportion to volume — Boyle’s law — but only roughly: each halving gives a
        little less than double, and the gap between the two needles widens as the piston goes in.
      </P>
      <P>
        The gauge and the readout disagree by 14.7, and that’s deliberate. A gauge measures pressure above the atmosphere around it, in psig (“g” for gauge),
        while the gas laws need absolute pressure, psia, measured from a vacuum. At sea level the atmosphere adds 14.7 psi, so Northline’s limit of 1,440 psig is{' '}
        {fmt(psia(MAOP_PSIG), 1)} psia. Temperature also has to be measured from absolute zero, in degrees Rankine: °F plus 459.67, so 60 °F is{' '}
        {fmt(rankine(60), 2)} °R.
      </P>
      <P>
        For an ideal gas, pressure × volume = n R T, where n is the amount of gas in pound-moles, R is the gas constant (10.73 in these units) and T is the absolute
        temperature. That is the dashed needle. Real molecules break the rule in two ways. At moderate pressures they attract one another slightly, which softens
        their blows on the walls, so the gas pushes less than the ideal law says. Squeezed hard enough, the molecules’ own size starts to matter: they get in each
        other’s way, and that pushes the pressure back up. Engineers fold both effects into one number, the <b>compressibility factor</b> Z, written into the law as
        P V = Z n R T. For an ideal gas Z = 1. Our gas has Z = {Z_STD.toFixed(3)} at standard conditions, close enough to ideal for most purposes, but at 12 cubic
        feet the ideal law predicts {fmt(AT12.idealPressure)} psia while the real gas pushes only {fmt(AT12.pressure)}: Z = {AT12.z.toFixed(3)}. Our model
        calculates Z with the Peng–Robinson equation of state, a standard engineering tool; gas companies measuring gas for payment use standardized
        equations of their own, in North America the American Gas Association’s Report No. 8.
      </P>

      <Challenge
        id="a"
        question={`Northline may never run above ${fmt(MAOP_PSIG)} psig, its maximum allowable operating pressure — ${fmt(psia(MAOP_PSIG), 1)} psia. At 60 °F, Boyle’s law puts an ideal gas at that limit in ${fmt(CHARGE_SCF)} × ${STD_PSIA} ÷ ${fmt(psia(MAOP_PSIG), 1)} ≈ ${fmt(IDEAL_MAOP_VOLUME, 1)} cubic feet. Predict first: will the real gas, at the same 60 °F, need more room than that, or less? Then find the smallest volume, to a tenth of a cubic foot, that keeps the gauge at or under the limit.`}
        solved={solved}
        status={
          temp !== CHALLENGE_TEMP
            ? `Set the temperature to 60 °F first; right now the gas is at ${temp} °F.`
            : `At ${volume.toFixed(1)} cubic feet the gauge reads ${fmt(gauge(st.pressure))} psig${overLimit ? ', over the limit' : ''}.`
        }
        success={`Solved: less room, not more. At ${MAOP_VOLUME.toFixed(1)} cubic feet the gauge reads ${fmt(gauge(AT_MAOP.pressure))} psig, and ${roundV(MAOP_VOLUME - V_STEP).toFixed(1)} would take it to ${fmt(gauge(PAST_MAOP.pressure))}. The real gas’s molecules pull on one another and push less than an ideal gas’s, so it fits into less space: Z is ${AT_MAOP.z.toFixed(3)} here, and ${fmt(IDEAL_MAOP_VOLUME, 1)} × ${AT_MAOP.z.toFixed(3)} ≈ ${fmt(IDEAL_MAOP_VOLUME * AT_MAOP.z, 1)} cubic feet. The same space holds ${fmt((1 / AT_MAOP.z - 1) * 100)}% more of the real gas than of an ideal one: ${fmt(CHARGE_SCF / MAOP_VOLUME)} standard cubic feet in every cubic foot.`}
      />

      <H2>How much gas fits</H2>
      <P>
        Fitting more gas into the same space is why compressibility matters commercially. At 1,000 psia and 60 °F, each cubic foot of pipe holds {fmt(SCF_1000, 1)} standard cubic feet of
        our gas, where the ideal law would allow {fmt(SCF_1000_IDEAL, 1)}; the gas inside weighs {RHO_1000.toFixed(2)} pounds per cubic foot, against{' '}
        {GAS.density.toFixed(4)} at standard conditions. A pipeline is therefore also a container, and the gas packed into it — its linepack — is something
        operators draw on and refill every day (<a href={lessonHref('gas/3.3')}>Lesson 3.3</a>). Compressed natural gas for vehicles is stored at up to about 3,600
        psi, where a cubic foot holds roughly {fmt(SCF_CNG_ROUNDED)} standard cubic feet.
      </P>
      <P>
        How far a gas strays from ideal depends on its pressure and its temperature together. The next demonstration plots Z against pressure for several
        temperatures, with the cylinder’s state as a dot on the curve for its current temperature. Push the piston and change the temperature:
      </P>

      <Figure name="Gas Piston · compressibility" scenario={s}>
        <XYChart
          xDomain={[0, P_MAX]}
          yDomain={[0.6, 1.05]}
          xTicks={[0, 1000, 2000, 3000, 4000]}
          yTicks={[0.6, 0.7, 0.8, 0.9, 1]}
          xFormat={(v) => fmt(v)}
          yFormat={(v) => v.toFixed(1)}
          yLabel="Compressibility factor Z"
          xLabel="absolute pressure, psia"
          height={270}
          ariaLabel={`Compressibility factor Z against pressure for pipeline gas at 0, 40, 80, 120 and 160 °F, and at the cylinder’s ${temp} °F. The cylinder is at ${fmt(st.pressure)} psia with Z = ${st.z.toFixed(3)}; at ${temp} °F, Z is lowest, ${zmin.z.toFixed(3)}, near ${fmt(zmin.p)} psia.`}
          hLines={[{ at: 1, color: '#777', dash: '5 4', label: 'ideal gas, Z = 1', labelAt: 'start' }]}
          vLines={[{ at: psia(MAOP_PSIG), color: GRAPHIC.blue, dash: '3 4', label: 'Northline’s limit', labelAt: 'end', width: 1.2 }]}
          series={[
            ...fixed
              .filter((c) => c.t !== temp)
              .map((c) => ({ xs: PRESSURES, ys: c.zs, color: '#c4c4c4', width: 1.5 })),
            { xs: PRESSURES, ys: current, color: GRAPHIC.teal, width: 3 },
          ]}
          markers={[{ x: Math.min(st.pressure, P_MAX), y: st.z, color: GRAPHIC.blue, r: 6, label: 'the cylinder', labelPos: st.pressure > 3000 ? 'left' : 'below' }]}
        >
          {(x, y) => (
            <g>
              {/* Only the coldest and hottest gray curves are labeled, and only when the reader's curve is well clear of them. */}
              {fixed
                .filter((c) => (c.t === T_MIN || c.t === T_MAX) && Math.abs(c.t - temp) >= 40)
                .map((c) => (
                  <text
                    key={c.t}
                    className="ax ax-e"
                    x={x(PRESSURES[PRESSURES.length - 1]) - 4}
                    y={y(c.zs[c.zs.length - 1]) + (c.t === T_MIN ? 16 : -7)}
                    style={{ paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}
                  >
                    {c.t} °F
                  </text>
                ))}
              <text
                className="ax ax-e"
                x={x(PRESSURES[PRESSURES.length - 1]) - 4}
                y={y(current[current.length - 1]) - 7}
                style={{ fill: TEXT.teal, fontWeight: 500, paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}
              >
                {temp} °F
              </text>
            </g>
          )}
        </XYChart>
        <Legend
          items={[
            { label: `At ${temp} °F`, color: GRAPHIC.teal, kind: 'line' },
            { label: 'Other temperatures', color: '#c4c4c4', kind: 'line' },
            { label: 'Ideal gas', color: '#777', kind: 'line', dashed: true },
          ]}
        />
        <Readouts items={[{ label: 'Z in the cylinder', value: st.z.toFixed(3) }]} />
        {sliders}
      </Figure>

      <P>
        At 60 °F, Z falls steadily through the pressures pipelines use, bottoms out at {ZMIN_60.z.toFixed(2)} near {fmt(Math.round(ZMIN_60.p / 100) * 100)} psia,
        and climbs again as the molecules start to crowd each other. Colder gas strays further: at 0 °F the dip reaches {ZMIN_0.z.toFixed(2)}, near{' '}
        {fmt(Math.round(ZMIN_0.p / 100) * 100)} psia, because slower molecules spend longer near one another and their attraction counts for more. Hotter gas
        behaves more nearly ideally. Over the range where Z is falling, each extra psi of pressure buys a little more than its share of extra gas — a bonus for
        anyone who stores gas under pressure.
      </P>

      <H2>Heating a closed space</H2>
      <P>
        Temperature works on a closed volume too. Go back to <FigRef to="Gas Piston">the first demonstration</FigRef>, set the volume to {HEAT.volume.toFixed(1)}{' '}
        cubic feet and the temperature to {HEAT.cold} °F: the gauge reads {fmt(gauge(HEAT_COLD.pressure))} psig. Now warm the gas to {HEAT.warm} °F without moving
        the piston. The pressure climbs to {fmt(gauge(HEAT_WARM.pressure))} psig, a rise of {fmt(HEAT_WARM.pressure - HEAT_COLD.pressure)} psi. The ideal law
        scales absolute pressure with absolute temperature — {fmt(rankine(HEAT.warm), 2)} ÷ {fmt(rankine(HEAT.cold), 2)}, about{' '}
        {fmt((rankine(HEAT.warm) / rankine(HEAT.cold) - 1) * 100)}% more — and would predict only {fmt(gauge(HEAT_IDEAL))} psig. The real gas rises faster because
        warming also weakens the attraction that held its pressure down: Z goes from {HEAT_COLD.z.toFixed(2)} to {HEAT_WARM.z.toFixed(2)}.
      </P>
      <P>
        The same thing happens to a stretch of above-ground pipe closed off between two valves on a summer afternoon: the gas trapped inside can’t expand, so its
        pressure climbs with the sun, which is one reason pipelines carry relief valves. Buried pipe is spared most of this. The ground a few feet down changes
        temperature slowly, and gas flowing through a buried line settles close to it, so the flow calculations in the next lessons take the gas to be at 60 °F.
      </P>
      <P>
        Pressure has one more job, and it is the one that matters most for moving gas. Gas flows from high pressure toward low, so the pressure difference between
        the two ends of a pipeline is what pushes the gas through it. In the <a href={lessonHref('gas/1.3')}>next lesson</a> we’ll see how much gas a pipe can carry,
        and why a pipe twice as wide carries about six times as much.
      </P>
    </LessonPage>
  );
}
