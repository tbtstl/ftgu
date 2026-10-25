import { useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  scale,
  si,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { COPPER_OHM_CM, SI_ATOMS, carriers, currentDensity, diodeCurrent, driftVelocity, type DopantKind } from '../../../engines/compute/semiconductor';
import { builtInPotential, depletionWidthUm } from '../../../engines/compute/junction';
import { rng } from '../../../model/random';
import { useRevealed } from './reveal';

// ---------------------------------------------------------------------------
// Number formatting for quantities that span twenty orders of magnitude.

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

function sup(n: number): string {
  return String(n)
    .split('')
    .map((c) => SUP[c] ?? c)
    .join('');
}

/** "10¹⁶", "6.3 × 10¹⁶". */
export function sci(x: number): string {
  if (!(x > 0)) return '0';
  let e = Math.floor(Math.log10(x) + 1e-9);
  let m = (x / 10 ** e).toFixed(1);
  if (m === '10.0') {
    e += 1;
    m = '1.0';
  }
  m = m.replace(/\.0$/, '');
  return m === '1' ? `10${sup(e)}` : `${m} × 10${sup(e)}`;
}

/** Two significant figures, with commas: 794,328 → "790,000". */
function round2(x: number): number {
  return Number(x.toPrecision(2));
}

/** "1 in 5 million", "1 in 790,000". */
function oneIn(ratio: number): string {
  const words: Array<[number, string]> = [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
  ];
  for (const [u, w] of words) if (ratio >= u) return `1 in ${String(round2(ratio / u))} ${w}`;
  return `1 in ${fmt(round2(ratio))}`;
}

/** Resistivity with three significant figures: "331,000", "0.527", "0.00544". */
function rhoText(rho: number): string {
  const r = Number(rho.toPrecision(3));
  return r >= 1000 ? fmt(r) : String(r);
}

/** "630,000", "1.2 million". */
function times(r: number): string {
  if (r < 10) return fmt(r, 1);
  if (r < 1e6) return fmt(round2(r));
  return `${String(round2(r / 1e6))} million`;
}

/** A current that may be femtoamperes or milliamperes. */
function amps(i: number): string {
  if (i === 0) return '0 A';
  if (Math.abs(i) >= 1e-6) return si(i, 'A');
  return `${i < 0 ? '−' : ''}${sci(Math.abs(i))} A`;
}

// ---------------------------------------------------------------------------
// The challenge.

const PURE = carriers('none', 0);
/** Doping slider: log10 of dopant atoms per cm³. */
const DOPING_MIN = 12;
const DOPING_MAX = 19;
const DOPING_STEP = 0.1;
const DOPING_GRID = Array.from({ length: Math.round((DOPING_MAX - DOPING_MIN) / DOPING_STEP) + 1 }, (_, i) => Math.round((DOPING_MIN + i * DOPING_STEP) * 10) / 10);

/** How many times better than pure silicon a sample conducts. */
export function conductivityGain(kind: DopantKind, logDoping: number): number {
  return carriers(kind, kind === 'none' ? 0 : 10 ** logDoping).sigma / PURE.sigma;
}

/** Holes carry the current, and the sample conducts at least a million times better than pure silicon. */
export function holesMillionSolved(kind: DopantKind, logDoping: number): boolean {
  if (kind !== 'p') return false;
  const c = carriers('p', 10 ** logDoping);
  return c.majority === 'holes' && conductivityGain('p', logDoping) >= 1e6;
}

/** The least doping on the slider's grid that makes a sample of this kind conduct a million times better than pure silicon. */
export function leastDopingForMillion(kind: 'n' | 'p'): number {
  return DOPING_GRID.find((e) => conductivityGain(kind, e) >= 1e6) ?? DOPING_MAX;
}

/** The first demonstration starts with pure silicon, its slider at 10¹⁶ and a field of 100 V/cm. */
export const CRYSTAL_DEFAULTS = { kind: 'none' as DopantKind, logDoping: 16, field: 100 };

/**
 * The challenge: the least boron, on the slider's grid, that makes silicon conduct a million times
 * better than pure silicon. Phosphorus gets there at 2 × 10¹⁶; holes are about a third as mobile
 * as electrons, so boron needs about three times as much.
 */
export function leastBoronSolved(kind: DopantKind, logDoping: number): boolean {
  return holesMillionSolved(kind, logDoping) && Math.abs(logDoping - leastDopingForMillion('p')) < 1e-6;
}

// ---------------------------------------------------------------------------
// The crystal: a 13 × 6 patch of lattice between two plates.

const COLS = 13;
const ROWS = 6;
const LX0 = 60;
const LX1 = 540;
const LY0 = 62;
const DX = (LX1 - LX0) / (COLS - 1);
const DY = 40;
const LATTICE_W = LX1 - LX0;

const ATOMS = Array.from({ length: COLS * ROWS }, (_, k) => ({ x: LX0 + (k % COLS) * DX, y: LY0 + Math.floor(k / COLS) * DY }));

/** A fixed shuffled order of lattice sites, so dopants appear one at a time in the same places. */
const DOPANT_ORDER = (() => {
  const r = rng(7);
  const idx = ATOMS.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
})();

interface Dot {
  x0: number;
  y0: number;
  phase: number;
}

function dots(seed: number, n: number): Dot[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    x0: LX0 + r() * LATTICE_W,
    y0: LY0 + DY / 2 + Math.floor(r() * (ROWS - 1)) * DY + (r() - 0.5) * 10,
    phase: r() * Math.PI * 2,
  }));
}

const MAX_DOTS = 22;
const ELECTRONS = dots(11, MAX_DOTS);
const HOLES = dots(23, MAX_DOTS);

/** Dots drawn for a concentration: two for 10¹⁰ per cm³, and two more for every tenfold increase. */
export function dotCount(perCm3: number): number {
  if (!(perCm3 > 0)) return 0;
  return Math.max(0, Math.min(MAX_DOTS, Math.round(2 * (Math.log10(perCm3) - 9))));
}

/** Drift on screen, px/s, for a real drift velocity in cm/s. */
function screenSpeed(cmPerS: number): number {
  return Math.min(120, cmPerS / 2500);
}

function wrap(x: number): number {
  return LX0 + ((((x - LX0) % LATTICE_W) + LATTICE_W) % LATTICE_W);
}

const ELECTRON = '#ad5310';
const HOLE = GRAPHIC.orange;
const DOPANT_FILL: Record<'n' | 'p', string> = { n: '#dce8f4', p: '#f6e4d6' };

const KIND_LABEL: Record<DopantKind, string> = { none: 'Pure silicon', n: 'Phosphorus (n-type)', p: 'Boron (p-type)' };

// ---------------------------------------------------------------------------
// The junction figure.

const JN_DOPING = 1e16;
const VBI = builtInPotential(JN_DOPING, JN_DOPING);
const BIAS_MIN = -1;
const BIAS_MAX = 0.7;
const JX = scale(BIAS_MIN, BIAS_MAX, 70, 584);
const JY = scale(0, 6, 344, 244);
const IV_CURVE = (() => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= 170; i++) {
    const v = BIAS_MIN + ((BIAS_MAX - BIAS_MIN) * i) / 170;
    xs.push(JX(v));
    ys.push(JY(Math.max(0, diodeCurrent(v)) * 1000));
  }
  return linePath(xs, ys);
})();
const UM_PX = 260;

/** Fixed positions for the majority carriers drawn in each region of the junction. */
const JN_SPOTS = Array.from({ length: 40 }, (_, i) => ({ x: 52 + i * 13, y: 72 + ((i * 37) % 3) * 22 }));

export default function Lesson() {
  const play = usePlay(true);
  const s = useScenario('crystal', CRYSTAL_DEFAULTS);
  const { kind, logDoping, field } = s.state;
  const doping = kind === 'none' ? 0 : 10 ** logDoping;
  const c = carriers(kind, doping);
  const J = currentDensity(c, field);
  const gain = c.sigma / PURE.sigma;
  const vE = driftVelocity(c.mobilityN, field);
  const vH = driftVelocity(c.mobilityP, field);
  const pxE = screenSpeed(vE);
  const pxH = screenSpeed(vH);

  const [anim, setAnim] = useState({ t: 0, dE: 0, dH: 0 });
  useAnimationFrame((dt) => setAnim((a) => ({ t: a.t + dt, dE: a.dE + pxE * dt, dH: a.dH + pxH * dt })), play.playing);

  const nDopants = kind === 'none' ? 0 : dotCount(doping);
  const dopantSites = useMemo(() => new Set(DOPANT_ORDER.slice(0, nDopants)), [nDopants]);
  const nE = dotCount(c.n);
  const nH = dotCount(c.p);
  const solved = leastBoronSolved(kind, logDoping);
  // Boron's gain stays out of the caption until the challenge has been solved.
  const revealed = useRevealed('compute/1.1', 'a', solved);
  const leastP = leastDopingForMillion('p');
  const leastN = leastDopingForMillion('n');

  const majority = c.majority === 'electrons' ? 'electrons' : c.majority === 'holes' ? 'holes' : null;
  const showGain = kind === 'n' || revealed;
  const caption =
    kind === 'none'
      ? `Pure silicon: heat frees one electron, and leaves one hole, for every ${fmt(round2(SI_ATOMS / c.n) / 1e12)} trillion atoms. Resistivity ${rhoText(c.rho)} Ω·cm.`
      : `${kind === 'n' ? 'Phosphorus' : 'Boron'} at ${oneIn(SI_ATOMS / doping)} atoms: ${majority === 'electrons' ? 'free electrons' : 'holes'} outnumber ${majority === 'electrons' ? 'holes' : 'free electrons'} ${sci(Math.max(c.n, c.p) / Math.min(c.n, c.p))} to one${
          showGain ? `, and the crystal conducts ${times(gain)} times better than pure silicon` : ''
        }.`;

  const status =
    kind !== 'p'
      ? kind === 'n'
        ? 'Phosphorus gives free electrons, so electrons carry this current. Which impurity makes holes?'
        : 'Pure silicon carries current on equal numbers of electrons and holes. Add an impurity.'
      : gain < 1e6
        ? `Boron at ${sci(doping)} per cm³ doesn’t reach a millionfold yet.`
        : `Boron at ${sci(doping)} per cm³ reaches a millionfold. Would less still do?`;

  // ---- The junction.
  const jn = useScenario('junction', { bias: 0 });
  const bias = jn.state.bias;
  const I = diodeCurrent(bias);
  const W = depletionWidthUm(JN_DOPING, JN_DOPING, bias);
  const wPx = W * UM_PX;
  const left = 300 - wPx / 2;
  const right = 300 + wPx / 2;
  const barrier = Math.max(0, VBI - bias);
  const flowing = I >= 1e-6;
  const speed = flowing ? Math.min(140, Math.max(6, (Math.log10(I) + 6) * 30)) : 0;
  const jnCaption =
    bias > 0.005
      ? `Forward bias of ${bias.toFixed(2)} V: the barrier is down to ${barrier.toFixed(2)} V and ${amps(I)} flows.`
      : bias < -0.005
        ? `Reverse bias of ${Math.abs(bias).toFixed(2)} V: the barrier rises to ${barrier.toFixed(2)} V, and only ${amps(I).replace('−', '')} leaks back through.`
        : `No bias: the built-in ${VBI.toFixed(2)} V barrier holds the carriers on their own sides, and no current flows.`;

  return (
    <LessonPage id="compute/1.1">
      <P>
        An hour of GPU time is bought and sold like a commodity, at so many dollars per GPU-hour. What the buyer actually gets is arithmetic: trillions of
        multiplications and additions every second, each carried out by switches far smaller than a bacterium, each turning a little electricity into a little heat.
        This course follows that arithmetic outward, from the switches to the chips that pack tens of billions of them, the data centers that power and cool the chips,
        and the markets that sell their time. Along the way we’ll see why an hour on one GPU can be worth several times an hour on another, and why that makes compute
        so much harder to trade than electricity or oil.
      </P>
      <P>
        We’ll start with the material the switches are made of. (If voltage, current and resistance are new to you, the{' '}
        <a href={lessonHref('1.1')}>first lesson of the electricity course</a> covers them; here we need only the idea that a material’s resistance decides how much
        current a given voltage can push through it.) Metals conduct easily and glass hardly at all. Silicon sits in between, and that is exactly what makes it useful:
        add the right impurity and its resistance falls a millionfold, and — as the next lesson shows — a voltage can do much the same thing, billions of times a second.
      </P>
      <P>
        A silicon atom has four outer electrons, and in a crystal it shares each of them with one of its four neighbors. Those shared pairs are the bonds that hold the
        crystal together, drawn as lines in the next demonstration, and an electron locked in a bond can’t carry current. Heat shakes the crystal, though, and now and
        then it shakes an electron loose. The <K c="current">free electron</K> can wander through the crystal, and so can the gap it leaves behind: an electron from a
        neighboring bond can hop into the gap, which moves the gap the other way. That gap, a <K c="current">hole</K>, behaves like a mobile positive charge. Freeing
        an electron takes 1.12 electron-volts of energy — silicon’s <b>band gap</b>, where an electron-volt is the energy one electron gains crossing a voltage of one
        volt — and at room temperature so few electrons get that much that pure silicon holds
        only about {sci(PURE.n)} free electrons per cubic centimeter, and as many holes. A cubic centimeter of silicon contains {sci(SI_ATOMS)} atoms, so that is one free electron for every {fmt(SI_ATOMS / PURE.n / 1e12)} trillion atoms.
      </P>
      <P>
        In the next demonstration, a small patch of the crystal sits between two metal plates. Free electrons are filled dots and holes are open circles. No drawing
        can show one carrier per five trillion atoms, so the dots use a logarithmic scale: two of each kind stand for {sci(PURE.n)} per cubic centimeter, and every two
        more mean ten times as many. Impurity atoms are drawn into the lattice on the same scale, so the drawing exaggerates them too: at {sci(1e19)} per cubic
        centimeter, {dotCount(1e19)} of the {ATOMS.length} atoms drawn are impurities, though in the real crystal only {oneIn(SI_ATOMS / 1e19)} would be. The
        equation under the controls multiplies the two concentrations per cubic centimeter: n of free electrons and p of holes. Choose an impurity to add, set how
        much of it, and apply an <K c="voltage">electric field</K> — the voltage across the plates for every centimeter between them:
      </P>

      <Figure name="Silicon Physics Explorer" scenario={s} play={play}>
        <Segmented
          label="Impurity added"
          value={kind}
          onChange={(v) => s.set({ kind: v })}
          options={[
            { value: 'none', label: 'Pure silicon' },
            { value: 'n', label: 'Phosphorus' },
            { value: 'p', label: 'Boron' },
          ]}
        />
        <svg
          className="diagram"
          viewBox="0 0 600 316"
          role="img"
          aria-label={`${KIND_LABEL[kind]}${kind === 'none' ? '' : ` at ${sci(doping)} atoms per cubic centimeter`}, in a field of ${field} volts per centimeter: ${sci(c.n)} free electrons and ${sci(c.p)} holes per cubic centimeter, resistivity ${rhoText(c.rho)} ohm-centimeters.`}
        >
          {/* Plates */}
          <rect x={20} y={44} width={12} height={238} rx={2} fill="#d9d9d5" />
          <rect x={568} y={44} width={12} height={238} rx={2} fill="#d9d9d5" />
          {field > 0 && (
            <>
              <text x={26} y={36} textAnchor="middle" style={{ fontSize: 16, fontWeight: 500, fill: TEXT.blue }}>
                +
              </text>
              <text x={574} y={36} textAnchor="middle" style={{ fontSize: 16, fontWeight: 500, fill: TEXT.blue }}>
                −
              </text>
            </>
          )}
          <g>
            <line x1={220} x2={372} y1={22} y2={22} stroke={field > 0 ? GRAPHIC.blue : '#cfcfcf'} strokeWidth={2} />
            <path d="M372 16 L382 22 L372 28 Z" fill={field > 0 ? GRAPHIC.blue : '#cfcfcf'} />
            <text x={300} y={14} textAnchor="middle" style={{ fontSize: 12, fill: field > 0 ? TEXT.blue : '#6f6f6f' }}>
              {field > 0 ? `field ${field} V/cm` : 'no field'}
            </text>
          </g>
          {/* Bonds */}
          {ATOMS.map((a, k) => (
            <g key={k}>
              {k % COLS < COLS - 1 && <line x1={a.x} x2={a.x + DX} y1={a.y} y2={a.y} stroke="#e3e3df" strokeWidth={3} />}
              {k + COLS < ATOMS.length && <line x1={a.x} x2={a.x} y1={a.y} y2={a.y + DY} stroke="#e3e3df" strokeWidth={3} />}
            </g>
          ))}
          {/* Atoms */}
          {ATOMS.map((a, k) => {
            const dopant = kind !== 'none' && dopantSites.has(k);
            return (
              <g key={k}>
                <circle cx={a.x} cy={a.y} r={11} fill={dopant ? DOPANT_FILL[kind as 'n' | 'p'] : '#f4f4f1'} stroke={dopant ? '#8a8a86' : '#d6d6d2'} strokeWidth={dopant ? 1.5 : 1} />
                <text x={a.x} y={a.y + 3.5} textAnchor="middle" style={{ fontSize: dopant ? 10 : 8.5, fontWeight: dopant ? 600 : 400, fill: dopant ? '#333' : '#9a9a96' }}>
                  {dopant ? (kind === 'n' ? 'P⁺' : 'B⁻') : 'Si'}
                </text>
              </g>
            );
          })}
          {/* Carriers */}
          {HOLES.slice(0, nH).map((d, i) => {
            const x = wrap(d.x0 + anim.dH) + 2.5 * Math.sin(anim.t * (2.1 + 0.37 * i) + d.phase);
            const y = d.y0 + 2.5 * Math.cos(anim.t * (1.7 + 0.29 * i) + 2 * d.phase);
            return <circle key={`h${i}`} cx={x} cy={y} r={5} fill="#fcfcfb" stroke={HOLE} strokeWidth={2} />;
          })}
          {ELECTRONS.slice(0, nE).map((d, i) => {
            const x = wrap(d.x0 - anim.dE) + 2.5 * Math.sin(anim.t * (2.3 + 0.41 * i) + d.phase);
            const y = d.y0 + 2.5 * Math.cos(anim.t * (1.9 + 0.23 * i) + 2 * d.phase);
            return <circle key={`e${i}`} cx={x} cy={y} r={5} fill={ELECTRON} />;
          })}
          <text x={300} y={308} textAnchor="middle" className="ax">
            {field > 0 ? 'electrons drift toward +, holes toward −; both make current flow →' : 'without a field, carriers wander but go nowhere'}
          </text>
        </svg>
        <Legend
          items={[
            { label: 'free electron', color: ELECTRON },
            { label: 'hole (open circle)', color: HOLE },
          ]}
        />
        <Readouts
          items={[
            { label: 'resistivity', value: `${rhoText(c.rho)} Ω·cm`, tone: 'violet' },
            { label: 'mobility, electrons · holes', value: `${fmt(c.mobilityN)} · ${fmt(c.mobilityP)} cm²/V·s` },
            { label: 'current through each cm²', value: J > 0 ? si(J, 'A') : '0 A', tone: 'orange' },
          ]}
        />
        <Slider
          label="Impurity atoms"
          value={logDoping}
          min={DOPING_MIN}
          max={DOPING_MAX}
          step={DOPING_STEP}
          disabled={kind === 'none'}
          onChange={(v) => s.set({ logDoping: v })}
          display={kind === 'none' ? 'none' : `${sci(doping)} per cm³`}
        />
        <Slider label="Electric field" tone="blue" value={field} min={0} max={200} step={5} onChange={(v) => s.set({ field: v })} display={`${field} V/cm`} />
        <Eq label="The product of the electron and hole concentrations stays fixed">
          <span>n</span>
          <Op>×</Op>
          <span>p</span>
          <Op>=</Op>
          <span>{sci(c.n)}</span>
          <Op>×</Op>
          <span>{sci(c.p)}</span>
          <Op>=</Op>
          <span>
            n<Sub>i</Sub>² = {sci(c.n * c.p)} per cm⁶
          </span>
        </Eq>
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Start with pure silicon. The field drifts the few carriers it has: electrons toward the positive plate, against the field, and holes toward the negative plate,
        with it. Opposite charges moving in opposite directions make current in the same direction, so both kinds add to it. There just aren’t many of them. The{' '}
        <K c="resistance">resistivity</K> of pure silicon — the resistance of a one-centimeter cube of it — is about {rhoText(PURE.rho)} Ω·cm. Copper’s is{' '}
        {sci(COPPER_OHM_CM)} Ω·cm. Double the field and the current through each square centimeter very nearly doubles too: that is Ohm’s law, with resistivity
        playing the part of resistance.
      </P>
      <P>
        Now choose phosphorus. A phosphorus atom has five outer electrons. Four go into bonds with its silicon neighbors, and the fifth is held so loosely that at room
        temperature it is almost always free, leaving a positive phosphorus ion, P⁺, fixed in the crystal. Each phosphorus atom donates one free electron, so silicon
        with {sci(1e16)} of them per cubic centimeter — {oneIn(SI_ATOMS / 1e16)} atoms — has {sci(1e16)} free electrons, a million times as many as pure silicon. Its
        resistivity falls to {String(round2(carriers('n', 1e16).rho))} Ω·cm: it conducts about {times(conductivityGain('n', 16))} times better. Adding impurities on
        purpose is called <b>doping</b>, and silicon whose current is carried by electrons, which are negative, is <b>n-type</b>. Boron has only three outer electrons,
        so wherever a boron atom sits, one of its bonds is an electron short. It takes an electron from a neighboring bond, becoming a negative ion, B⁻, and the
        missing electron moves off as a hole. Silicon doped with boron is <b>p-type</b>.
      </P>
      <P>
        Watch the holes as you add phosphorus. Rather than staying at {sci(PURE.p)}, they all but disappear: with {sci(1e16)} phosphorus atoms per cubic centimeter,
        only {sci(carriers('n', 1e16).p)} holes remain. With so many free electrons about, any hole that heat creates is soon filled, and the balance between heat making
        pairs and electrons filling holes keeps the product of the concentrations fixed at n<Sub>i</Sub>² = {sci(PURE.n * PURE.p)} per cm⁶, whatever the doping. This is the <b>law of mass action</b>. The
        carrier the impurity supplies is the <b>majority carrier</b>; the other, reduced to a trace, is the <b>minority carrier</b> — holes in n-type silicon,
        free electrons in p-type.
      </P>
      <P>
        Doping has a cost. The ions it leaves behind are charged, and they deflect passing carriers, so the more impurity there is, the more slowly carriers drift. A
        carrier’s drift speed per unit of field is its <b>mobility</b>, which the demonstration shows for both carriers. In lightly doped silicon an electron’s is about {fmt(round2(PURE.mobilityN))} cm²/V·s, so a
        field of 100 V/cm moves it at about {(driftVelocity(PURE.mobilityN, 100) / 1e5).toFixed(1)} kilometers per second; at {sci(1e19)} phosphorus atoms per cubic
        centimeter, it falls to {fmt(carriers('n', 1e19).mobilityN)}. Holes are slower than electrons at any doping — about {fmt(round2(PURE.mobilityP))} cm²/V·s in
        lightly doped silicon. A hole’s motion is really a relay of bound electrons, and in silicon that relay behaves like a heavier particle than a free electron. And even heavily doped silicon is a poor conductor next to copper: at{' '}
        {sci(1e19)} per cm³ its resistivity, {String(round2(carriers('n', 1e19).rho))} Ω·cm, is still about {fmt(round2(carriers('n', 1e19).rho / COPPER_OHM_CM))}{' '}
        times copper’s.
      </P>

      <Challenge
        id="a"
        question={`Phosphorus makes silicon conduct a million times better than pure silicon from ${sci(10 ** leastN)} atoms per cm³. Predict first, from the two mobilities: will boron need more or less to do the same, and about how much? Then choose boron and find the least of it, on the slider, that conducts a millionfold better. Boron’s gain stays out of the caption until you do.`}
        solved={solved}
        status={status}
        success={`Solved. Boron needs ${sci(10 ** leastP)} atoms per cm³ — ${oneIn(SI_ATOMS / 10 ** leastP)} — about three times as much as phosphorus, and conducts ${times(conductivityGain('p', leastP))} times better than pure silicon. A hole carries the same charge as a free electron but drifts about a third as fast (${fmt(carriers('p', 10 ** leastP).mobilityP)} against ${fmt(carriers('n', 10 ** leastN).mobilityN)} cm²/V·s at these dopings), so it takes about three times as many holes to carry the same current.`}
      />

      <H2>Two kinds of silicon, joined</H2>
      <P>
        Doping really earns its keep when p-type and n-type silicon meet in the same crystal. Near the boundary, free electrons from the n side wander across and fill
        holes on the p side, and holes wander the other way. That empties a thin strip on both sides of free carriers, leaving only the fixed ions: negative boron ions
        on the p side, positive phosphorus ions on the n side. This <b>depletion region</b> conducts almost nothing, and the ions’ charges set up a built-in{' '}
        <K c="voltage">voltage</K> across it — about {VBI.toFixed(2)} volts when both sides are doped at {sci(JN_DOPING)} per cm³ — that pushes back against any
        further crossing.
      </P>
      <P>
        The next demonstration joins the two kinds of silicon, each doped at {sci(JN_DOPING)} per cubic centimeter, and connects them to a battery through metal
        contacts at either end. The chart traces the current through the junction for every voltage the battery could apply. Drag the <K c="voltage">bias</K> — the
        voltage of the p side relative to the n side — from negative to positive:
      </P>

      <Figure name="Silicon Physics Explorer · p–n junction" scenario={jn}>
        <svg
          className="diagram"
          viewBox="0 0 600 372"
          role="img"
          aria-label={`A p–n junction biased at ${bias.toFixed(2)} volts. The depletion region is ${W.toFixed(2)} micrometers wide and ${amps(I)} flows.`}
        >
          {/* Circuit: the wire runs from the n contact around to the p contact, through the battery. */}
          <path d="M560 96 L586 96 L586 176 L14 176 L14 96 L40 96" fill="none" stroke="#9a9a9a" strokeWidth={3} strokeLinejoin="round" />
          {flowing && (
            <path
              d="M586 96 L586 176 L14 176 L14 96"
              className="flow-dots"
              fill="none"
              stroke={GRAPHIC.orange}
              strokeWidth={6}
              style={{ animationDuration: `${(18 / speed).toFixed(3)}s` }}
            />
          )}
          <rect x={280} y={160} width={40} height={32} fill="#fcfcfb" />
          {/* Battery: the long thin plate is its + terminal, toward the p side when forward biased. */}
          <line x1={bias >= 0 ? 292 : 308} x2={bias >= 0 ? 292 : 308} y1={162} y2={190} stroke="#444" strokeWidth={3} />
          <line x1={bias >= 0 ? 308 : 292} x2={bias >= 0 ? 308 : 292} y1={169} y2={183} stroke="#444" strokeWidth={7} />
          <text x={300} y={208} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: TEXT.blue }}>
            {bias > 0 ? '+' : bias < 0 ? '−' : ''}
            {Math.abs(bias).toFixed(2)} V on the p side
          </text>
          {/* The silicon. */}
          <rect x={40} y={52} width={left - 40} height={88} fill={DOPANT_FILL.p} />
          <rect x={right} y={52} width={560 - right} height={88} fill={DOPANT_FILL.n} />
          <rect x={left} y={52} width={wPx} height={88} fill="#fcfcfb" />
          <rect x={40} y={52} width={520} height={88} fill="none" stroke="#bdbdb8" strokeWidth={1} />
          <line x1={left} x2={left} y1={52} y2={140} stroke="#9a9a9a" strokeDasharray="3 3" />
          <line x1={right} x2={right} y1={52} y2={140} stroke="#9a9a9a" strokeDasharray="3 3" />
          {JN_SPOTS.map((p, i) =>
            p.x < left - 7 ? (
              <circle key={`jh${i}`} cx={p.x} cy={p.y} r={4.5} fill="#fcfcfb" stroke={HOLE} strokeWidth={2} />
            ) : p.x > right + 7 ? (
              <circle key={`je${i}`} cx={p.x} cy={p.y} r={4.5} fill={ELECTRON} />
            ) : null,
          )}
          {Array.from({ length: Math.max(0, Math.floor(wPx / 2 / 14)) }, (_, i) => (
            <g key={`ion${i}`}>
              <text x={300 - 8 - i * 14} y={84} textAnchor="middle" style={{ fontSize: 13, fill: '#6f6f6f' }}>
                −
              </text>
              <text x={300 - 8 - i * 14} y={118} textAnchor="middle" style={{ fontSize: 13, fill: '#6f6f6f' }}>
                −
              </text>
              <text x={300 + 8 + i * 14} y={84} textAnchor="middle" style={{ fontSize: 13, fill: '#6f6f6f' }}>
                +
              </text>
              <text x={300 + 8 + i * 14} y={118} textAnchor="middle" style={{ fontSize: 13, fill: '#6f6f6f' }}>
                +
              </text>
            </g>
          ))}
          <text x={44} y={44} className="lab">
            p-type (boron)
          </text>
          <text x={556} y={44} textAnchor="end" className="lab">
            n-type (phosphorus)
          </text>
          <text x={300} y={44} textAnchor="middle" className="ax">
            depletion region {W.toFixed(2)} µm
          </text>
          {/* The current–voltage chart. */}
          <text className="ax" x={70} y={232}>
            Current through the junction, by bias
          </text>
          <GridY y={JY} ticks={[0, 2, 4, 6]} x0={70} x1={584} format={(v) => `${v} mA`} baseline={0} />
          <line x1={JX(0)} x2={JX(0)} y1={JY(6)} y2={JY(0)} stroke="#d9d9d5" />
          <path d={IV_CURVE} fill="none" stroke={GRAPHIC.orange} strokeWidth={2.5} strokeLinejoin="round" />
          <line className="cur" x1={JX(bias)} x2={JX(bias)} y1={JY(6)} y2={JY(0)} />
          <circle cx={JX(bias)} cy={JY(Math.max(0, Math.min(6, I * 1000)))} r={6} fill={GRAPHIC.orange} stroke="#fcfcfb" strokeWidth={2} />
          {[-1, -0.5, 0, 0.5].map((v) => (
            <text key={v} className="ax ax-m" x={JX(v)} y={362}>
              {v === 0 ? '0 V' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`}
            </text>
          ))}
          <text className="ax ax-e" x={584} y={362}>
            bias
          </text>
        </svg>
        <Readouts items={[{ label: 'barrier left', value: `${barrier.toFixed(2)} V`, tone: 'blue' }]} />
        <Slider
          label="Bias on the p side"
          tone="blue"
          value={bias}
          min={BIAS_MIN}
          max={BIAS_MAX}
          step={0.01}
          onChange={(v) => jn.set({ bias: v })}
          display={`${bias > 0 ? '+' : bias < 0 ? '−' : ''}${Math.abs(bias).toFixed(2)} V`}
        />
        <Caption>{jnCaption}</Caption>
      </Figure>

      <P>
        With the p side positive — <b>forward bias</b> — the battery works against the built-in voltage. The depletion region narrows, from{' '}
        {depletionWidthUm(JN_DOPING, JN_DOPING, 0).toFixed(2)} µm with no bias to {depletionWidthUm(JN_DOPING, JN_DOPING, 0.6).toFixed(2)} µm at +0.6 V, carriers pour
        across, and <K c="current">current</K> flows: {(diodeCurrent(0.6) * 1000).toFixed(2)} mA at 0.6 V and {(diodeCurrent(0.7) * 1000).toFixed(1)} mA at 0.7 V.
        Below about half a volt there is hardly any, and from there on the current grows tenfold for every 60 millivolts more. With the p side negative —{' '}
        <b>reverse bias</b> — the battery adds to the barrier, the depletion region widens, to {depletionWidthUm(JN_DOPING, JN_DOPING, -1).toFixed(2)} µm at −1 V,
        and only about {sci(Math.abs(diodeCurrent(-1)))} amperes leaks back through: a hundredth of a trillionth of an ampere.
      </P>
      <P>
        This is a <b>diode</b>, a one-way valve for current, and junctions like it sit inside every transistor on a chip. On a chip they are tiny. The wafer is
        lightly doped as its crystal is grown, and then each transistor’s own n-type and p-type regions are added by firing ions of the impurity into patterned areas
        tens of nanometers across: narrower than this demonstration’s whole depletion region, which is about {fmt(Math.round(depletionWidthUm(JN_DOPING, JN_DOPING, 0) * 100) * 10)} nanometers wide with no bias.
      </P>
      <P>
        A diode lets current through in one direction only, but whether it conducts depends on the voltage across the diode itself. To compute, we need something
        more: a switch in which one voltage turns the current between two other terminals on and off. That takes a third terminal, and it makes the transistor — the
        subject of the next lesson.
      </P>
    </LessonPage>
  );
}
