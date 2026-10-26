import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  Sub,
  Sup,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  pct,
  scale,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { LORENZ, LYAPUNOV, distance, ensembleStarts, lorenzRun, wing, type L3 } from '../../../engines/weather/lorenz';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The attractor: one long run, spun up from (1, 1, 1) so it starts on the butterfly.

const DT = 0.01;
/** Steps of spin-up before the reference run starts (15 time units, as attractorPoint uses). */
const SPIN_STEPS = 1500;
/** The reference run: 40 time units along the attractor. */
const REF_STEPS = 4000;

let refCache: L3[] | null = null;
/** The reference trajectory: ref[i] is the state i·0.01 time units after the spin-up. */
function reference(): L3[] {
  if (!refCache) {
    const spin = lorenzRun({ x: 1, y: 1, z: 1 }, SPIN_STEPS, DT);
    refCache = lorenzRun(spin[spin.length - 1], REF_STEPS, DT);
  }
  return refCache;
}

/** A point on the attractor, `t` time units along the reference run (the same as attractorPoint(t)). */
export function pointAt(t: number): L3 {
  return reference()[Math.max(0, Math.min(REF_STEPS, Math.round(t / DT)))];
}

// ---------------------------------------------------------------------------
// The first demonstration: two runs a hair apart.

/** The two runs start 5 time units along the attractor. */
export const TWIN_START_T = 5;
/** How far apart two states must be before we say the runs have parted. The butterfly is about 40 units across. */
export const PART_DISTANCE = 5;
/** How long the first demonstration follows the runs. */
export const TWIN_T_MAX = 30;
const TWIN_STEPS = TWIN_T_MAX / DT;
/** The slider sets the initial difference as a power of ten. */
export const EXP_MIN = -10;
export const EXP_MAX = -1;
export const EXP_STEP = 0.5;
/** Starting difference: one part in 10,000, about the size of Lorenz's rounding error. */
export const EXP_DEFAULT = -4;

export interface TwinRuns {
  a: L3[];
  b: L3[];
  /** Time the runs first part by more than PART_DISTANCE, or null within TWIN_T_MAX. */
  parted: number | null;
}

const twinCache = new Map<number, TwinRuns>();
/** Two runs from the same point, the second's x larger by 10^exp. */
export function twinRuns(exp: number): TwinRuns {
  let r = twinCache.get(exp);
  if (!r) {
    const p = pointAt(TWIN_START_T);
    const a = lorenzRun(p, TWIN_STEPS, DT);
    const b = lorenzRun({ ...p, x: p.x + 10 ** exp }, TWIN_STEPS, DT);
    let parted: number | null = null;
    for (let i = 1; i < a.length; i++) {
      if (distance(a[i], b[i]) > PART_DISTANCE) {
        parted = i * DT;
        break;
      }
    }
    r = { a, b, parted };
    if (twinCache.size > 40) twinCache.clear();
    twinCache.set(exp, r);
  }
  return r;
}

/** The first challenge: keep the runs together until at least this time. */
export const TOGETHER_UNTIL = 15;
/** Whether runs 10^exp apart stay within PART_DISTANCE until TOGETHER_UNTIL. */
export function staysTogether(exp: number): boolean {
  const p = twinRuns(exp).parted;
  return p === null || p >= TOGETHER_UNTIL - 1e-9;
}
/** Solved at the largest initial difference on the slider's steps that still keeps the runs together: 10⁻⁶. */
export function togetherSolved(exp: number): boolean {
  return staysTogether(exp) && (exp + EXP_STEP > EXP_MAX + 1e-9 || !staysTogether(exp + EXP_STEP));
}

// ---------------------------------------------------------------------------
// The second demonstration: an ensemble around a point on the attractor.

export const MEMBERS = 50;
export const ENS_T_MAX = 6;
const ENS_STEPS = ENS_T_MAX / DT;
export const START_MIN = 0;
export const START_MAX = 20;
export const START_STEP = 0.25;
/** Starting point: passing the junction between the wings, where the flow decides which one to circle next. */
export const START_DEFAULT = 13;
export const SPREAD_DEFAULT = 0.2;
/** Spread at which we say the ensemble has lost its agreement. */
export const LOOSE_SPREAD = 5;

export interface EnsembleRun {
  runs: L3[][];
  /** Root-mean-square distance of the members from their average, at every step. */
  spread: number[];
  /** First time the spread passes LOOSE_SPREAD, or null within ENS_T_MAX. */
  loosened: number | null;
}

const ensCache = new Map<string, EnsembleRun>();
export function ensembleRun(start: number, spread: number): EnsembleRun {
  const key = `${start}|${spread}`;
  let e = ensCache.get(key);
  if (!e) {
    const runs = ensembleStarts(pointAt(start), MEMBERS, spread, 5).map((m) => lorenzRun(m, ENS_STEPS, DT));
    const sp: number[] = [];
    let loosened: number | null = null;
    for (let i = 0; i <= ENS_STEPS; i++) {
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (const r of runs) {
        mx += r[i].x;
        my += r[i].y;
        mz += r[i].z;
      }
      const mean = { x: mx / MEMBERS, y: my / MEMBERS, z: mz / MEMBERS };
      let s2 = 0;
      for (const r of runs) s2 += distance(r[i], mean) ** 2;
      const s = Math.sqrt(s2 / MEMBERS);
      sp.push(s);
      if (loosened === null && s > LOOSE_SPREAD) loosened = i * DT;
    }
    e = { runs, spread: sp, loosened };
    if (ensCache.size > 60) ensCache.clear();
    ensCache.set(key, e);
  }
  return e;
}

/**
 * The second challenge: with the starting scatter, a start before STEADY_BEFORE (so not the junction
 * near 13 that the prose explores) whose ensemble stays tighter than 5 for at least 3 time units.
 * Only 3.25 qualifies: just past the run's other junction crossing, at 3.
 */
export const STEADY_UNTIL = 3;
export const STEADY_BEFORE = 10;
export function steadySolved(start: number, spread: number): boolean {
  if (Math.abs(spread - SPREAD_DEFAULT) > 1e-9 || start >= STEADY_BEFORE) return false;
  const l = ensembleRun(start, spread).loosened;
  return l === null || l >= STEADY_UNTIL - 1e-9;
}

// ---------------------------------------------------------------------------
// Drawing.

const RUN_A = GRAPHIC.blue;
const RUN_B = GRAPHIC.orange;
const BX = scale(-22, 22, 24, 296);
const BZ = scale(0, 52, 312, 26);

let butterflyPath: string | null = null;
function butterfly(): string {
  if (!butterflyPath) {
    const ref = reference();
    const pts = ref.filter((_, i) => i % 2 === 0);
    butterflyPath = linePath(
      pts.map((p) => BX(p.x)),
      pts.map((p) => BZ(p.z)),
    );
  }
  return butterflyPath;
}

function Butterfly({ children }: { children?: ReactNode }) {
  return (
    <g>
      <text className="ax" x={24} y={16}>
        The state: x against z
      </text>
      <path d={butterfly()} fill="none" stroke="#d9d6cf" strokeWidth={1} />
      <text className="ax ax-m" x={BX(-12)} y={326}>
        left wing (x &lt; 0)
      </text>
      <text className="ax ax-m" x={BX(12)} y={326}>
        right wing (x &gt; 0)
      </text>
      {children}
    </g>
  );
}

const TX = scale(0, TWIN_T_MAX, 344, 620);
const TY = scale(-22, 22, 300, 40);
const TAIL = 120;

function TwinFigure({ runs, i, exp }: { runs: TwinRuns; i: number; exp: number }) {
  const { a, b, parted } = runs;
  const from = Math.max(0, i - TAIL);
  const tail = (r: L3[]) =>
    linePath(
      r.slice(from, i + 1).map((p) => BX(p.x)),
      r.slice(from, i + 1).map((p) => BZ(p.z)),
    );
  const series = (r: L3[]) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 0; k <= i; k += 5) {
      xs.push(TX(k * DT));
      ys.push(TY(r[k].x));
    }
    xs.push(TX(i * DT));
    ys.push(TY(r[i].x));
    return linePath(xs, ys);
  };
  const t = i * DT;
  const dist = distance(a[i], b[i]);
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 336"
      role="img"
      aria-label={`Two runs of Lorenz’s system starting ${diffWords(exp)} apart. At time ${fmt(t, 1)} they are ${fmt(dist, dist < 0.01 ? 4 : 2)} apart. ${parted !== null ? `They part, by more than ${PART_DISTANCE}, at time ${fmt(parted, 1)}.` : `They stay within ${PART_DISTANCE} of each other for all ${TWIN_T_MAX} time units.`}`}
    >
      <Butterfly>
        <path d={tail(a)} fill="none" stroke={RUN_A} strokeWidth={2.2} />
        <path d={tail(b)} fill="none" stroke={RUN_B} strokeWidth={2.2} strokeDasharray="5 3" />
        <circle cx={BX(a[i].x)} cy={BZ(a[i].z)} r={5.5} fill={RUN_A} stroke="#fcfcfb" strokeWidth={1.5} />
        <circle cx={BX(b[i].x)} cy={BZ(b[i].z)} r={4.5} fill={RUN_B} stroke="#fcfcfb" strokeWidth={1.5} />
      </Butterfly>
      <text className="ax" x={344} y={16}>
        x over time
      </text>
      {[-20, -10, 0, 10, 20].map((v) => (
        <g key={v}>
          <line className={v === 0 ? 'base' : 'gl'} x1={344} x2={620} y1={TY(v)} y2={TY(v)} />
          <text className="ax ax-e" x={338} y={TY(v) + 4}>
            {v}
          </text>
        </g>
      ))}
      {parted !== null && (
        <g>
          <line x1={TX(parted)} x2={TX(parted)} y1={34} y2={300} stroke={TEXT.ink} strokeWidth={1} strokeDasharray="3 3" />
          <text className="ax" x={Math.min(TX(parted) + 4, 560)} y={34} style={{ fill: TEXT.ink }}>
            part at {fmt(parted, 1)}
          </text>
        </g>
      )}
      <path d={series(a)} fill="none" stroke={RUN_A} strokeWidth={2} />
      <path d={series(b)} fill="none" stroke={RUN_B} strokeWidth={2} strokeDasharray="5 3" />
      {[0, 10, 20, 30].map((v) => (
        <text key={v} className="ax ax-m" x={TX(v)} y={316}>
          {v}
        </text>
      ))}
      <text className="ax ax-e" x={620} y={330}>
        time
      </text>
    </svg>
  );
}

const SX = scale(0, ENS_T_MAX, 344, 620);
const LOG_LO = Math.log10(0.05);
const LOG_HI = Math.log10(50);
const SY = (s: number) => scale(LOG_LO, LOG_HI, 300, 40)(Math.log10(Math.max(0.05, Math.min(50, s))));

function EnsembleFigure({ ens, i, start, spread }: { ens: EnsembleRun; i: number; start: number; spread: number }) {
  const p0 = pointAt(start);
  const right = ens.runs.filter((r) => wing(r[i]) === 'right').length;
  const s0 = ens.spread[0];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k <= i; k += 2) {
    xs.push(SX(k * DT));
    ys.push(SY(ens.spread[k]));
  }
  const avgGrowth = linePath(
    [0, ENS_T_MAX].map(SX),
    [s0, s0 * Math.exp(LYAPUNOV * ENS_T_MAX)].map(SY),
  );
  const t = i * DT;
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 336"
      role="img"
      aria-label={`${MEMBERS} runs started within ${fmt(spread, 2)} of the point ${fmt(start, 2)} along the attractor (x ${fmt(p0.x, 1)}, z ${fmt(p0.z, 1)}). At time ${fmt(t, 1)} their spread is ${fmt(ens.spread[i], 2)} and ${right} of them are on the right wing. ${ens.loosened !== null ? `The spread passes ${LOOSE_SPREAD} at time ${fmt(ens.loosened, 2)}.` : `The spread stays below ${LOOSE_SPREAD} for all ${ENS_T_MAX} time units.`}`}
    >
      <Butterfly>
        <circle cx={BX(p0.x)} cy={BZ(p0.z)} r={9} fill="none" stroke="#555" strokeWidth={1.5} strokeDasharray="2 2" />
        {ens.runs.map((r, k) => (
          <circle key={k} cx={BX(r[i].x)} cy={BZ(r[i].z)} r={3} fill={wing(r[i]) === 'right' ? RUN_B : RUN_A} opacity={0.8} />
        ))}
      </Butterfly>
      <text className="ax" x={344} y={16}>
        Spread of the ensemble (log scale)
      </text>
      {[0.1, 1, 10].map((v) => (
        <g key={v}>
          <line className="gl" x1={344} x2={620} y1={SY(v)} y2={SY(v)} />
          <text className="ax ax-e" x={338} y={SY(v) + 4}>
            {v}
          </text>
        </g>
      ))}
      <line x1={344} x2={620} y1={SY(LOOSE_SPREAD)} y2={SY(LOOSE_SPREAD)} stroke={TEXT.ink} strokeWidth={1} strokeDasharray="3 3" />
      <text className="ax ax-e" x={620} y={SY(LOOSE_SPREAD) - 5} style={{ fill: TEXT.ink }}>
        spread {LOOSE_SPREAD}
      </text>
      <path d={avgGrowth} fill="none" stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="6 4" />
      <path d={linePath(xs, ys)} fill="none" stroke={GRAPHIC.blue} strokeWidth={2.5} />
      <circle cx={SX(t)} cy={SY(ens.spread[i])} r={5} fill={GRAPHIC.blue} stroke="#fcfcfb" strokeWidth={1.5} />
      {[0, 2, 4, 6].map((v) => (
        <text key={v} className="ax ax-m" x={SX(v)} y={316}>
          {v}
        </text>
      ))}
      <text className="ax ax-e" x={620} y={330}>
        time
      </text>
    </svg>
  );
}

/** "one part in 10,000", "10⁻⁶·⁵" style descriptions of an initial difference. */
function diffWords(exp: number): string {
  if (Number.isInteger(exp)) return exp >= -9 ? `1 part in ${fmt(10 ** -exp)}` : `10${superscript(exp)}`;
  return `${fmt(10 ** exp / 10 ** Math.floor(exp), 1)} × 10${superscript(Math.floor(exp))}`;
}

function superscript(n: number): string {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(n)
    .split('')
    .map((c) => map[c] ?? c)
    .join('');
}

/** The initial difference, compactly, for readouts and sliders. */
function diffShort(exp: number): string {
  const m = 10 ** exp / 10 ** Math.floor(exp);
  return Number.isInteger(exp) ? `10${superscript(exp)}` : `${fmt(m, 1)} × 10${superscript(Math.floor(exp))}`;
}

const TWIN_SPEED = 2.5; // time units per second of animation
const ENS_SPEED = 0.75;

export default function Lesson() {
  const s = useScenario('twins', { exp: EXP_DEFAULT });
  const exp = s.state.exp;
  const runs = useMemo(() => twinRuns(exp), [exp]);
  const play = usePlay(true);
  const [t1, setT1] = useState(0);
  useEffect(() => setT1(0), [exp]);
  useAnimationFrame((dt) => setT1((x) => (x >= TWIN_T_MAX + 2 ? 0 : x + dt * TWIN_SPEED)), play.playing);
  const i1 = Math.min(TWIN_STEPS, Math.round(Math.min(t1, TWIN_T_MAX) / DT));
  const solved = togetherSolved(exp);

  const e = useScenario('ensemble', { start: START_DEFAULT, spread: SPREAD_DEFAULT });
  const { start, spread } = e.state;
  const ens = useMemo(() => ensembleRun(start, spread), [start, spread]);
  const play2 = usePlay(true);
  const [t2, setT2] = useState(0);
  useEffect(() => setT2(0), [start, spread]);
  useAnimationFrame((dt) => setT2((x) => (x >= ENS_T_MAX + 1.5 ? 0 : x + dt * ENS_SPEED)), play2.playing);
  const i2 = Math.min(ENS_STEPS, Math.round(Math.min(t2, ENS_T_MAX) / DT));
  const right = ens.runs.filter((r) => wing(r[i2]) === 'right').length;
  const solved2 = steadySolved(start, spread);
  // For the second challenge's success: the start a quarter earlier, crossing between the wings.
  const earlier = solved2 ? (ensembleRun(start - START_STEP, spread).loosened ?? ENS_T_MAX) : 0;

  // Numbers the prose quotes.
  const atDefault = twinRuns(EXP_DEFAULT).parted ?? TWIN_T_MAX;
  const atTenth = twinRuns(-1).parted ?? 0;
  const atBillionth = twinRuns(-9).parted ?? TWIN_T_MAX;
  const plateau = [-3, -3.5, -4].map((x) => twinRuns(x).parted ?? 0);
  const halving = Math.LN2 / LYAPUNOV;
  const hundredfold = Math.log(100) / LYAPUNOV;
  // The first challenge's estimate from the average rate, on the slider's steps.
  const estimateExp = Math.round((EXP_DEFAULT - ((TOGETHER_UNTIL - atDefault) * LYAPUNOV) / Math.LN10) / EXP_STEP) * EXP_STEP;
  const junction = ensembleRun(START_DEFAULT, SPREAD_DEFAULT).loosened ?? ENS_T_MAX;
  const after = ensembleRun(START_DEFAULT + START_STEP, SPREAD_DEFAULT).loosened ?? ENS_T_MAX;
  const p13 = pointAt(START_DEFAULT);

  return (
    <LessonPage id="weather/3.4">
      <P>
        <a href={lessonHref('weather/3.3')}>The previous lesson</a> built a miniature weather model and watched its forecasts drift away from the truth, partly
        because its observations had gaps and partly because the real weather kept developing in ways the model never saw. Better observations and a better model
        should shrink those errors. Perhaps, with perfect physics and good enough measurements, they would shrink away altogether, and the weather could be
        forecast as far ahead as we liked. In 1961 Edward Lorenz found out why it can’t.
      </P>
      <P>
        Lorenz, a meteorologist at the Massachusetts Institute of Technology, was running a small weather model on a computer. Wanting to look at one run again, he
        restarted it partway through, typing in the numbers from a printout. The printout had rounded them to three decimal places — 0.506 where the computer held
        0.506127. The new run followed the old one for a while, then drifted from it, until the two forecasts had nothing in common. Nothing was wrong with the
        computer. The model was so sensitive to its starting point that a difference in the fourth decimal place grew until it took over.
      </P>
      <P>
        In 1963 Lorenz published a stripped-down version with just three variables, standing for convection in a layer of fluid heated from below, like the
        afternoon thermals of <a href={lessonHref('weather/1.4')}>Lesson 1.4</a>: x for how fast the fluid overturns, y and z for how its temperatures depart
        from a steady state. They change according to
      </P>
      <Eq label="The Lorenz equations: dx/dt equals sigma times y minus x; dy/dt equals x times rho minus z, minus y; dz/dt equals x y minus beta z">
        <span>
          dx/dt = {LORENZ.sigma}(y − x),
        </span>
        <span style={{ marginLeft: 14 }}>dy/dt = x({LORENZ.rho} − z) − y,</span>
        <span style={{ marginLeft: 14 }}>dz/dt = xy − (8/3)z.</span>
      </Eq>
      <P>
        There is no randomness anywhere in them. In the next demonstration, two runs of these equations start from the same point, except that the second
        run’s x is larger by a tiny <K tone={WX.probability}>initial error</K>. The left panel draws each run’s state as a point moving in the x–z plane, where it
        traces Lorenz’s famous butterfly; the right one plots x against time for both. From almost any start, a run is soon drawn onto this butterfly-shaped set
        of states, and it circles it forever without ever exactly repeating itself; such a set is called an <b>attractor</b>. Time is in the equations’ own units,
        not hours or days. Set the size of the initial error:
      </P>

      <Figure name="Initial Condition Laboratory" scenario={s} play={play}>
        <TwinFigure runs={runs} i={i1} exp={exp} />
        <Legend
          items={[
            { label: 'Run 1', color: RUN_A, kind: 'line' },
            { label: 'Run 2, nudged', color: RUN_B, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'initial error', value: diffShort(exp), tone: WX.probability },
            { label: 'the runs part at', value: runs.parted !== null ? `t = ${fmt(runs.parted, 1)}` : `after ${TWIN_T_MAX}`, tone: WX.probability },
            { label: 'distance now', value: fmt(distance(runs.a[i1], runs.b[i1]), distance(runs.a[i1], runs.b[i1]) < 0.01 ? 4 : 2) },
          ]}
        />
        <Slider
          label="Initial error in x"
          tone={WX.probability}
          value={exp}
          min={EXP_MIN}
          max={EXP_MAX}
          step={EXP_STEP}
          onChange={(v) => s.set({ exp: v })}
          display={diffShort(exp)}
        />
      </Figure>

      <P>
        At the start the error is 0.0001 in x, which swings between about −20 and +20 — about the size of Lorenz’s rounding. For a long time the two runs are indistinguishable: they circle one wing,
        cross to the other, and come back, in step. Then, at t = {fmt(atDefault, 1)}, they part, and from then on their states are as unrelated as two points
        picked at random on the butterfly. Run either one again from its own start and it does exactly the same thing; the system is perfectly{' '}
        <b>deterministic</b>. It is unpredictable all the same, because no measurement of a starting state is ever exact. This <b>sensitive dependence on
        initial conditions</b> is what is now called chaos, and in 1972 Lorenz gave it its famous image, in a talk titled “Predictability: Does the Flap of a
        Butterfly’s Wings in Brazil Set Off a Tornado in Texas?”
      </P>

      <H2>How fast errors grow</H2>
      <P>
        On average, the distance between the runs grows exponentially. It multiplies by e, about 2.7, every 1/λ time units, where λ is the system’s{' '}
        <K tone={WX.probability}>Lyapunov exponent</K>, about {fmt(LYAPUNOV, 2)} for Lorenz’s equations:
      </P>
      <Eq label={`The error grows as the initial error times e to the power lambda t, with lambda about ${fmt(LYAPUNOV, 2)}`}>
        <K tone={WX.probability}>δ(t)</K>
        <Op>≈</Op>
        <span>
          δ<Sub>0</Sub> · e<Sup>{fmt(LYAPUNOV, 2)} t</Sup>
        </span>
      </Eq>
      <P>
        So a forecast stays useful until δ reaches the largest error we can tolerate, and the time that takes depends on the initial error only through its
        logarithm. That is chaos’s cruel arithmetic. Halving the initial error buys only ln 2 / λ ≈ {fmt(halving, 2)} time units; making it a hundred times smaller
        buys about {fmt(hundredfold, 1)}. Slide the error from a tenth all the way down to a billionth: the runs part at t = {fmt(atTenth, 1)} at first
        and at t = {fmt(atBillionth, 1)} at the end. A measurement a hundred million times better gains fewer than {fmt(Math.ceil(atBillionth - atTenth))} time
        units.
      </P>
      <P>
        Notice, too, that the gains come in jumps. Errors of 10⁻³, about 3 × 10⁻⁴ and 10⁻⁴ all part at almost the same moment — t = {fmt(plateau[0], 1)},{' '}
        {fmt(plateau[1], 1)} and {fmt(plateau[2], 1)}. Some stretches of the flow amplify differences sharply and others barely at all, so runs tend to part at the
        same few moments, wherever the flow happens to be most sensitive.
      </P>

      <Challenge
        id="a"
        question={`What is the largest initial error, on the slider’s steps, that keeps the two runs within ${PART_DISTANCE} of each other until at least t = ${TOGETHER_UNTIL}? Estimate first from λ: at the starting ${diffShort(EXP_DEFAULT)} they part at t = ${fmt(atDefault, 1)}, and on average each hundredfold improvement buys about ${fmt(hundredfold, 1)} time units. Then check.`}
        solved={solved}
        status={
          runs.parted !== null && runs.parted < TOGETHER_UNTIL
            ? `With an error of ${diffShort(exp)} the runs part at t = ${fmt(runs.parted, 1)}.`
            : `With an error of ${diffShort(exp)} the runs stay together past t = ${TOGETHER_UNTIL}. Could a larger error still do it?`
        }
        success={`Solved. It takes an error of ${diffShort(exp)} — a millionth, about a hundred times smaller than Lorenz’s rounding — to keep the runs together until t = ${fmt(runs.parted ?? TWIN_T_MAX, 1)}. The average rate alone pointed to about ${diffShort(estimateExp)}; this stretch of the flow happens to be gentler than average, so a somewhat larger error does. Doubling the time the forecast is good for took a hundredfold better start.`}
      />

      <H2>Predictability depends on the flow</H2>
      <P>
        A forecaster never knows the starting state exactly, only a range it probably lies in. So instead of one run, they make many — an{' '}
        <K tone={WX.probability}>ensemble</K> — each starting from a slightly different state within that range, and watch where they go. In the next
        demonstration, {MEMBERS} runs start scattered around a point on the butterfly, colored by the wing each is on. The chart on the right plots how far the
        members are from their average (on a logarithmic scale, where steady exponential growth is a straight line), with the dashed line showing growth at the
        average rate. Choose where on the attractor the ensemble starts, measured as time along one long run around it, and how widely the members are
        scattered in each of x, y and z (the spread on the chart is their distance from the average in all three at once):
      </P>

      <Figure name="Initial Condition Laboratory · ensemble" scenario={e} play={play2}>
        <EnsembleFigure ens={ens} i={i2} start={start} spread={spread} />
        <Legend
          items={[
            { label: 'Member on the left wing', color: RUN_A },
            { label: 'Member on the right wing', color: RUN_B },
            { label: 'Spread', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Growth at the average rate', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'time', value: fmt(i2 * DT, 1) },
            { label: 'spread now', value: fmt(ens.spread[i2], 2), tone: WX.probability },
            { label: 'on the right wing', value: pct(right / MEMBERS), tone: WX.probability },
            { label: `spread passes ${LOOSE_SPREAD} at`, value: ens.loosened !== null ? `t = ${fmt(ens.loosened, 2)}` : `after ${ENS_T_MAX}`, tone: WX.probability },
          ]}
        />
        <Slider
          label="Starting point, time along the run"
          value={start}
          min={START_MIN}
          max={START_MAX}
          step={START_STEP}
          onChange={(v) => e.set({ start: v })}
          display={fmt(start, 2)}
        />
        <Slider
          label="Initial scatter in each variable"
          tone={WX.probability}
          value={spread}
          min={0.05}
          max={1}
          step={0.05}
          onChange={(v) => e.set({ spread: v })}
          display={fmt(spread, 2)}
        />
      </Figure>

      <P>
        The starting point, at x = {fmt(p13.x, 1)} and z = {fmt(p13.z, 1)}, is the junction between the wings, where the flow decides which wing to circle next.
        The ensemble straddles that decision. Its spread passes {LOOSE_SPREAD} by t = {fmt(junction, 2)}, far sooner than the average rate would suggest, and the
        members head for both wings. Now move the start a quarter of a time unit along the attractor, just past the junction. The same cloud of the same size now
        stays together until t = {fmt(after, 2)}: about {fmt(after / junction)} times as long. Nothing about the model or the measurements has changed. What
        changed is the weather at the start.
      </P>

      <Challenge
        id="b"
        question={`Keep the initial scatter at ${SPREAD_DEFAULT}. The junction near ${START_DEFAULT} isn’t the only place where the flow chooses a wing. Find a starting point before ${STEADY_BEFORE} from which the ensemble stays tighter than ${LOOSE_SPREAD} until at least t = ${STEADY_UNTIL}.`}
        solved={solved2}
        status={
          Math.abs(spread - SPREAD_DEFAULT) > 1e-9
            ? `Set the initial scatter back to ${SPREAD_DEFAULT} first.`
            : start >= STEADY_BEFORE
              ? `Look before ${STEADY_BEFORE} on the slider, away from the junction near ${START_DEFAULT}.`
              : ens.loosened !== null
                ? `From ${fmt(start, 2)}, the spread passes ${LOOSE_SPREAD} at t = ${fmt(ens.loosened, 2)}.`
                : `From ${fmt(start, 2)}, the spread stays below ${LOOSE_SPREAD}.`
        }
        success={`Solved. From ${fmt(start, 2)} the ensemble stays tighter than ${LOOSE_SPREAD} until t = ${fmt(ens.loosened ?? ENS_T_MAX, 2)}. A quarter of a time unit earlier, at ${fmt(start - START_STEP, 2)}, the run is crossing between the wings again, and the same cloud comes apart by t = ${fmt(earlier, 2)}. A forecaster with this ensemble would know today’s forecast deserves more confidence than one issued from the junction — which is the point of running many forecasts instead of one.`}
      />

      <P>
        The real atmosphere behaves the same way, with millions of variables instead of three. Its errors grow fastest in the smallest motions — individual clouds
        and gusts — and spread to larger and larger scales, until the uncertainty reaches the large weather systems themselves, whose errors roughly double every
        day or two. Lorenz showed in 1969 that in a flow with many scales of motion, like the atmosphere, this spreading sets a limit that better observations
        can hardly push back. For day-to-day weather the practical limit of prediction is usually put at about two weeks. Some patterns, like a slow, stubborn
        high-pressure block, can be forecast well for many days; others, like a storm about to form on a sharp front, are at the junction of{' '}
        <FigRef to="Initial Condition Laboratory · ensemble">the second demonstration</FigRef> and can go either way within a day.
      </P>
      <P>
        The course’s simulated archive builds this limit in, as <a href={lessonHref('weather/3.3')}>Lesson 3.3</a> found: what a forecast of Fenwick Bay knows
        about a day’s weather fades with lead time, and beyond fifteen days it knows nothing at all — only the climate of{' '}
        <a href={lessonHref('weather/2.5')}>Lesson 2.5</a> and the slow tilt of ENSO remain.
      </P>
      <P>
        If the future can’t be known exactly, the honest thing a forecast can do is say how uncertain it is: give the whole range of what might happen, and how
        likely each part of it is. That is what an ensemble is for. The next lesson runs ensembles for Fenwick Bay, turns them into probabilities, and asks how to
        tell whether a probability forecast is any good.
      </P>
    </LessonPage>
  );
}
