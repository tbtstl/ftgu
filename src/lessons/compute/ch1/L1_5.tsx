import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
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
  Slider,
  Sub,
  Sup,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  mix,
  scale,
  useScenario,
} from '../../../framework';
import {
  CHIP_CAPACITANCE_F,
  CRITICAL_PATH_GATES,
  DIE_THERMAL_RESISTANCE,
  LEAK_DOUBLING_C,
  MAX_JUNCTION_C,
  chipState,
  maxClockGHz,
  parallelPower,
  type ChipState,
} from '../../../engines/compute/chipPower';
import { NFET, gateDelayPs, subthresholdSwingMV } from '../../../engines/compute/transistor';
import { ACCELERATORS, SM_LIMITS, serverPowerW } from '../../../model/compute/hardware';

// ---------------------------------------------------------------------------
// The sliders' grids. The challenge's answer is found by searching exactly these values.

export const CLOCK = { min: 0.5, max: 2.6, step: 0.05 };
export const VOLTS = { min: 0.5, max: 1.1, step: 0.01 };
export const ACTIVITY = { min: 10, max: 100, step: 5 };
export const DEFAULTS = { clock: 2.0, volts: 0.8, activity: 100 };

/** The A-class's board power limit, W: drawn as a reference line on the power bar. */
const BOARD_LIMIT_W = ACCELERATORS.A.tdpW;
/** The challenge's target, TFLOPS. */
export const TARGET_TFLOPS = 900;

function grid(g: { min: number; max: number; step: number }): number[] {
  const n = Math.round((g.max - g.min) / g.step);
  return Array.from({ length: n + 1 }, (_, i) => Math.round((g.min + i * g.step) * 100) / 100);
}

/** A setting the chip can actually sustain: its timing holds and the die stays at or under 90 °C. */
export function sustainable(s: ChipState): boolean {
  return !s.timingFails && !s.overheated;
}

let leastCache: ChipState | null = null;

/**
 * The least power, on the sliders' grids, that sustains at least 900 TFLOPS. For each clock and
 * activity, the lowest voltage whose critical path still settles is the cheapest, since power
 * only grows with voltage.
 */
export function leastPowerFor900(): ChipState {
  if (leastCache) return leastCache;
  const volts = grid(VOLTS).map((v) => ({ v, fmax: maxClockGHz(v) }));
  let best: ChipState | null = null;
  for (const f of grid(CLOCK))
    for (const pct of grid(ACTIVITY)) {
      // The same test chipState uses for timing.
      const v = volts.find((x) => f <= x.fmax + 1e-9)?.v;
      if (v === undefined) continue;
      const s = chipState(v, f, pct / 100);
      if (!sustainable(s) || s.tflops < TARGET_TFLOPS - 1e-9) continue;
      if (!best || s.totalW < best.totalW) best = s;
    }
  leastCache = best!;
  return leastCache;
}

/** The first challenge: at least 900 TFLOPS, sustainably, within half a watt of the least possible. */
export function leastPowerSolved(volts: number, clock: number, activityPct: number): boolean {
  const s = chipState(volts, clock, activityPct / 100);
  return sustainable(s) && s.tflops >= TARGET_TFLOPS - 1e-9 && s.totalW <= leastPowerFor900().totalW + 0.5;
}

// ---------------------------------------------------------------------------
// Going wide: the same 2 GHz of work spread over several copies of the logic.

export const WIDE_TARGET_GHZ = 2;
export const UNITS = [1, 2, 3, 4, 5, 6, 7, 8];
/** The lowest supply the engine allows a copy, V (0.45): eight copies at 0.25 GHz each sit on it. */
export const V_FLOOR = parallelPower(UNITS[UNITS.length - 1], WIDE_TARGET_GHZ).vdd;

/** The number of copies that does the work with the least power. */
export function bestUnits(): number {
  return UNITS.reduce((b, u) => (parallelPower(u, WIDE_TARGET_GHZ).totalW < parallelPower(b, WIDE_TARGET_GHZ).totalW ? u : b), 1);
}

export function bestUnitsSolved(units: number): boolean {
  return units === bestUnits();
}

// ---------------------------------------------------------------------------
// Drawing.

/** Die color by junction temperature: cool gray-blue at the coolant, gold, then red at the limit and beyond. */
function heatColor(tj: number, strong = false): string {
  const t = Math.max(0, Math.min(1, (tj - 40) / (MAX_JUNCTION_C + 5 - 40)));
  const [cool, warm, hot] = strong ? ['#9fb4c9', '#d9a62c', '#c4382f'] : ['#dde6ef', '#f0c75a', '#e75b55'];
  return t < 0.55 ? mix(cool, warm, t / 0.55) : mix(warm, hot, (t - 0.55) / 0.45);
}

/** The 132 blocks of the die in a fixed scattered order, so raising the activity lights more of them. */
const BLOCK_ORDER: number[] = (() => {
  const n = 132;
  const idx = Array.from({ length: n }, (_, i) => i);
  let seed = 7;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const rank = Array<number>(n);
  idx.forEach((b, r) => (rank[b] = r));
  return rank;
})();

const LEAK_COLOR = '#a8403b';
const LEAK_TEXT = '#8c3530';
const P_MAX = 1400;
const PY = scale(0, P_MAX, 236, 46);
const VX = scale(0.5, 1.1, 404, 620);
const FY = scale(0, 4, 236, 46);
const CURVE_V = Array.from({ length: 61 }, (_, i) => 0.5 + i * 0.01);
const CURVE_PATH = linePath(
  CURVE_V.map(VX),
  CURVE_V.map((v) => FY(Math.min(4, maxClockGHz(v)))),
);
const FAIL_AREA = `${CURVE_PATH} L${VX(1.1)} ${FY(4)} L${VX(0.5)} ${FY(4)} Z`;

function ChipFigure({ s }: { s: ChipState }) {
  const runaway = s.runaway;
  const color = runaway ? '#e75b55' : heatColor(s.junctionC);
  const litColor = runaway ? '#a8403b' : heatColor(s.junctionC, true);
  const lit = Math.round(s.activity * 132);
  const cell = 14;
  const gap = 1;
  const x0 = 18;
  const y0 = 54;
  const dynTop = PY(Math.min(P_MAX, s.dynamicW));
  const totTop = PY(Math.min(P_MAX, s.totalW));
  const off = s.totalW > P_MAX;
  const fail = s.timingFails;
  // The dynamic label sits beside its block; the leakage label just above the bar, kept clear of it.
  const dynLabelY = Math.min(PY(0) - 4, (dynTop + PY(0)) / 2 + 4);
  const leakLabelY = Math.max(44, Math.min(totTop - 4, dynLabelY - 15));
  const label = `${fmt(s.vdd, 2)} V, ${fmt(s.clockGHz, 2)} GHz, ${fmt(s.activity * 100)}% activity. ${
    fail ? 'The clock is faster than the critical path allows: timing fails.' : 'Timing holds.'
  } ${runaway ? 'Thermal runaway.' : `Power ${fmt(s.totalW)} W (${fmt(s.dynamicW)} W dynamic, ${fmt(s.leakageW)} W leakage); the die is at ${fmt(s.junctionC, 1)} °C.`}`;
  return (
    <svg className="diagram" viewBox="0 0 640 262" role="img" aria-label={label}>
      {/* The die. */}
      <text className="ax" x={x0} y={30}>
        The die
      </text>
      <text x={x0 + 12 * (cell + gap) - gap} y={30} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: s.overheated ? TEXT.red : TEXT.ink }}>
        {runaway ? 'runaway' : `${fmt(s.junctionC, 1)} °C`}
      </text>
      <rect x={x0 - 6} y={y0 - 6} width={12 * (cell + gap) - gap + 12} height={11 * (cell + gap) - gap + 12} rx={4} fill={color} opacity={0.55} />
      {Array.from({ length: 132 }, (_, i) => {
        const on = BLOCK_ORDER[i] < lit;
        return (
          <rect
            key={i}
            x={x0 + (i % 12) * (cell + gap)}
            y={y0 + Math.floor(i / 12) * (cell + gap)}
            width={cell}
            height={cell}
            rx={1.5}
            fill={on ? litColor : '#f4f4f1'}
            opacity={on ? 0.95 : 0.9}
          />
        );
      })}
      <text className="ax" x={x0} y={y0 + 11 * (cell + gap) + 18}>
        {lit} of 132 SMs switching
      </text>
      {fail && (
        <text x={x0 + (12 * (cell + gap)) / 2} y={y0 + (11 * (cell + gap)) / 2 + 4} textAnchor="middle" style={{ fontSize: 14, fontWeight: 600, fill: TEXT.red }}>
          wrong answers
        </text>
      )}

      {/* The power bar. */}
      <text className="ax" x={246} y={30}>
        Power, W
      </text>
      <line className="base" x1={246} x2={280} y1={PY(0)} y2={PY(0)} />
      <rect x={250} y={dynTop} width={26} height={PY(0) - dynTop} fill={GRAPHIC.red} />
      <rect x={250} y={totTop} width={26} height={Math.max(0, dynTop - totTop)} fill={LEAK_COLOR} />
      {off && <path d={`M250 ${PY(P_MAX) + 8} L263 ${PY(P_MAX) - 4} L276 ${PY(P_MAX) + 8}`} fill="none" stroke="#fcfcfb" strokeWidth={2} />}
      <line x1={246} x2={280} y1={PY(BOARD_LIMIT_W)} y2={PY(BOARD_LIMIT_W)} stroke="#333" strokeWidth={1.2} strokeDasharray="4 3" />
      {[0, 500, 1000].map((w) => (
        <text key={w} className="ax ax-e" x={242} y={PY(w) + 4}>
          {fmt(w)}
        </text>
      ))}
      <text className="ax ax-m" x={263} y={254}>
        dashed: 700 W limit
      </text>
      {runaway ? (
        <text x={282} y={PY(P_MAX) + 10} style={{ fontSize: 12, fontWeight: 500, fill: TEXT.red }}>
          runaway
        </text>
      ) : (
        <>
          <text x={282} y={dynLabelY} style={{ fontSize: 12, fill: TEXT.red }}>
            {fmt(s.dynamicW)} dynamic
          </text>
          <text x={282} y={leakLabelY} style={{ fontSize: 12, fill: LEAK_TEXT }}>
            +{fmt(s.leakageW)} leakage
          </text>
        </>
      )}

      {/* The voltage–frequency chart. */}
      <text className="ax" x={VX(0.5)} y={30}>
        Fastest clock at each voltage
      </text>
      <path d={FAIL_AREA} fill="rgba(231, 91, 85, .08)" />
      <GridY y={FY} ticks={[0, 1, 2, 3, 4]} x0={VX(0.5)} x1={VX(1.1)} format={(v) => `${v} GHz`} baseline={0} />
      <path d={CURVE_PATH} fill="none" stroke={GRAPHIC.teal} strokeWidth={2.5} />
      <text className="ax" x={VX(0.62)} y={FY(3.4)}>
        timing fails
      </text>
      <text className="ax" x={VX(0.98)} y={FY(1.2)}>
        works
      </text>
      <line className="cur" x1={VX(s.vdd)} x2={VX(s.vdd)} y1={FY(0)} y2={FY(Math.min(4, s.clockGHz))} />
      <circle cx={VX(s.vdd)} cy={FY(Math.min(4, s.clockGHz))} r={6.5} fill={fail ? GRAPHIC.red : GRAPHIC.teal} stroke="#fcfcfb" strokeWidth={2} />
      {[0.5, 0.7, 0.9, 1.1].map((v) => (
        <text key={v} className="ax ax-m" x={VX(v)} y={254}>
          {fmt(v, 1)} V
        </text>
      ))}
    </svg>
  );
}

const WY = scale(0, 700, 196, 34);
const WX = (u: number) => 70 + (u - 1) * 70;

function WideChart({ units }: { units: number }) {
  const rows = UNITS.map((u) => parallelPower(u, WIDE_TARGET_GHZ));
  const cur = rows[units - 1];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 248"
      role="img"
      aria-label={`The same work split across 1 to 8 copies of the logic, with bars drawn up to the number chosen. With ${units} ${units === 1 ? 'copy' : 'copies'} at ${fmt(cur.clockGHz, 2)} GHz and ${fmt(cur.vdd, 2)} V, the chip draws ${fmt(cur.totalW)} W: ${fmt(cur.dynamicW)} W dynamic and ${fmt(cur.leakageW)} W leakage.`}
    >
      <text className="ax" x={52} y={14}>
        Power for the same work
      </text>
      <GridY y={WY} ticks={[0, 200, 400, 600]} x0={52} x1={628} format={(v) => `${v} W`} baseline={0} />
      {rows.map((r) => {
        const on = r.units === units;
        // Bars appear only up to the slider, so where the curve turns is found, not shown.
        const drawn = r.units <= units;
        const x = WX(r.units) + 8;
        const dTop = WY(r.dynamicW);
        const tTop = WY(r.totalW);
        return (
          <g key={r.units} opacity={on ? 1 : 0.55}>
            {drawn && (
              <>
                <rect x={x} y={dTop} width={40} height={WY(0) - dTop} fill={GRAPHIC.red} />
                <rect x={x} y={tTop} width={40} height={dTop - tTop} fill={LEAK_COLOR} />
                <text className={on ? 'lab' : 'ax'} x={x + 20} y={tTop - 6} textAnchor="middle">
                  {fmt(r.totalW)} W
                </text>
              </>
            )}
            <text className="ax ax-m" x={x + 20} y={214} style={on ? { fill: '#111', fontWeight: 500 } : undefined}>
              {r.units}
            </text>
            <text className="ax ax-m" x={x + 20} y={230}>
              {fmt(r.clockGHz, 2)}
            </text>
          </g>
        );
      })}
      <text className="ax ax-e" x={50} y={214}>
        copies
      </text>
      <text className="ax ax-e" x={50} y={230}>
        GHz each
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario('chip', DEFAULTS);
  const { clock, volts, activity } = s1.state;
  const s = chipState(volts, clock, activity / 100);
  const least = useMemo(() => leastPowerFor900(), []);
  const solvedA = leastPowerSolved(volts, clock, activity);
  const pathPs = CRITICAL_PATH_GATES * gateDelayPs(volts);
  const tickPs = 1000 / clock;

  const s2 = useScenario('wide', { units: 1 });
  const units = s2.state.units;
  const w = parallelPower(units, WIDE_TARGET_GHZ);
  const one = parallelPower(1, WIDE_TARGET_GHZ);
  const best = bestUnits();
  const solvedB = bestUnitsSolved(units);

  // Numbers quoted in the prose, all from the engine.
  const ref = chipState(0.8, 2.0, 1);
  const fast = chipState(0.86, 2.3, 1);
  const faster = chipState(0.87, 2.4, 1);
  const top = chipState(0.86, 2.35, 1);
  const slow = chipState(0.61, 1.0, 1);
  const lanes = ACCELERATORS.A.sms * SM_LIMITS.fp32Lanes;

  let caption: string;
  if (s.timingFails)
    caption = `At ${fmt(volts, 2)} V the slowest path takes ${fmt(pathPs)} ps to settle, longer than one ${fmt(tickPs)} ps tick of a ${fmt(clock, 2)} GHz clock: registers would capture half-finished answers.`;
  else if (s.runaway) caption = 'Thermal runaway: the hot die leaks more, the leakage heats it further, and the temperature never settles.';
  else if (s.overheated) caption = `The die settles at ${fmt(s.junctionC, 1)} °C, above its ${MAX_JUNCTION_C} °C limit. A real chip would slow its clock to cool off.`;
  else caption = `The slowest path settles in ${fmt(pathPs)} ps, inside the ${fmt(tickPs)} ps tick. The die settles at ${fmt(s.junctionC, 1)} °C.`;

  let statusA: string;
  if (s.timingFails) statusA = 'Timing fails at this voltage, so the chip does no useful arithmetic.';
  else if (s.overheated) statusA = `The die is too hot to sustain this (${s.runaway ? 'runaway' : `${fmt(s.junctionC, 1)} °C`}).`;
  else if (s.tflops < TARGET_TFLOPS - 1e-9) statusA = `Right now the chip delivers ${fmt(s.tflops)} TFLOPS, short of 900.`;
  else statusA = `${fmt(s.tflops)} TFLOPS for ${fmt(s.totalW, 1)} W. Could the same arithmetic cost less?`;

  return (
    <LessonPage id="compute/1.5">
      <P>
        In <a href={lessonHref('compute/1.3')}>Lesson 1.3</a>, a four-bit adder took up to eight gate delays to settle after its inputs changed, and{' '}
        <a href={lessonHref('compute/1.2')}>Lesson 1.2</a> put a gate delay at about 8 picoseconds. A real chip is built from millions of stretches of logic like
        that adder, each feeding the next through a row of registers: small memories, built like the SRAM cells of{' '}
        <a href={lessonHref('compute/1.4')}>Lesson 1.4</a> from inverters in a loop, that capture whatever their inputs hold at one instant. A single signal tells every register when. It’s the <K c="frequency">clock</K>, a square wave that ticks
        billions of times a second, and between two ticks every stretch of logic must finish settling. Tick sooner and a register captures a half-computed answer.
      </P>
      <P>
        So the slowest stretch sets the fastest clock. Our example chip is a fictional die about the size of the A-class 80 GB, the GPU we met in{' '}
        <a href={lessonHref('compute/1.4')}>Lesson 1.4</a>, and its slowest path between registers is {CRITICAL_PATH_GATES} gate delays long. At <K c="voltage">0.8 volts</K> each gate takes{' '}
        {fmt(gateDelayPs(0.8), 1)} ps, so the path settles in {fmt(CRITICAL_PATH_GATES * gateDelayPs(0.8))} ps and the clock can tick at most once every{' '}
        {fmt(CRITICAL_PATH_GATES * gateDelayPs(0.8))} ps: {fmt(maxClockGHz(0.8), 2)} billion times a second, or {fmt(maxClockGHz(0.8), 2)} GHz. Lesson 1.2 found
        that gates get faster as the supply voltage rises, so voltage is one lever on speed. What it costs is the subject of this lesson.
      </P>
      <P>
        Every gate’s output drives a small capacitor: the gates it feeds and the wire that reaches them. How much charge a capacitor takes on for each volt across it
        is its <b>capacitance</b>, C, measured in farads. When the output rises from 0 to 1, the supply pushes a charge of C × V onto that capacitance, and at voltage V that takes C·V² of energy — half of it stored, half lost as heat in the pull-up transistor. When the output
        falls back to 0, the stored half drains to ground as heat as well. So every rise and fall turns C·V² of electrical energy into heat. Multiply by the
        clock frequency <K c="frequency">f</K>, and by the <K tone="ink">activity</K> a — the share of the chip’s capacitance that actually switches in a cycle — and
        you have the chip’s <K c="power">dynamic power</K>:
      </P>
      <Eq label="Dynamic power equals activity times capacitance times voltage squared times frequency">
        <K c="power">
          P<Sub>dyn</Sub>
        </K>
        <Op>=</Op>
        <span>a</span>
        <Op>×</Op>
        <span>C</span>
        <Op>×</Op>
        <K c="voltage">
          V<Sup>2</Sup>
        </K>
        <Op>×</Op>
        <K c="frequency">f</K>
      </Eq>
      <P>
        Across our whole die, the capacitance that can switch adds up to about {fmt(CHIP_CAPACITANCE_F * 1e9)} nanofarads (billionths of a farad). At 0.8 V and 2.0 GHz, with all of it busy,
        that’s {fmt(ref.dynamicW)} watts. On top comes <K c="power">leakage</K>: Lesson 1.2’s off current, a couple of nanoamps per micrometer, multiplied across tens
        of billions of transistors. It adds {fmt(ref.leakageW)} W here, and it rises with voltage and, steeply, with temperature, doubling for every{' '}
        {LEAK_DOUBLING_C} °C in our model. That is gentler than the DRAM cell of <a href={lessonHref('compute/1.4')}>Lesson 1.4</a>, whose leak doubles every 10 °C: its
        charge drains mostly through a p–n junction, a path far more sensitive to heat than the current that slips over an off transistor’s barrier. Every watt becomes heat. The die sits on a liquid-cooled plate fed with 40 °C water, and every 100 W holds it {fmt(100 * DIE_THERMAL_RESISTANCE)} °C
        warmer than that; above a <K c="power">junction temperature</K> of {MAX_JUNCTION_C} °C it has to slow down.
      </P>
      <P>
        In the next demonstration, set the chip’s clock, its supply voltage and its switching activity. The die is drawn as {ACCELERATORS.A.sms} blocks of
        arithmetic, as many as the A-class has; GPU makers call them <b>streaming multiprocessors</b>, or SMs. They’re lit when they’re switching and shaded by the
        die’s temperature. The bar is its power, and the chart is the fastest clock the critical path allows at each voltage, with the chip’s operating point marked. Its
        arithmetic is the BF16 matrix work of <a href={lessonHref('compute/1.4')}>Lesson 1.4</a>, counted in TFLOPS, and at full activity and{' '}
        {fmt(ACCELERATORS.A.clockGHz, 2)} GHz it matches the A-class’s {fmt(ACCELERATORS.A.bf16Tflops)} TFLOPS:
      </P>

      <Figure name="Processor Energy Simulator" scenario={s1}>
        <ChipFigure s={s} />
        <Readouts
          items={[
            { label: 'power', value: s.runaway ? 'runaway' : `${fmt(s.totalW)} W`, tone: 'red' },
            { label: 'arithmetic, TFLOPS', value: fmt(s.tflops) },
            { label: 'energy per operation', value: s.timingFails ? '—' : s.runaway ? 'runaway' : `${fmt(s.pjPerFlop, 2)} pJ`, tone: 'gold' },
          ]}
        />
        <Slider label="Clock" tone="teal" value={clock} min={CLOCK.min} max={CLOCK.max} step={CLOCK.step} onChange={(v) => s1.set({ clock: v })} display={`${fmt(clock, 2)} GHz`} />
        <Slider label="Supply voltage" tone="blue" value={volts} min={VOLTS.min} max={VOLTS.max} step={VOLTS.step} onChange={(v) => s1.set({ volts: v })} display={`${fmt(volts, 2)} V`} />
        <Slider
          label="Switching activity"
          value={activity}
          min={ACTIVITY.min}
          max={ACTIVITY.max}
          step={ACTIVITY.step}
          onChange={(v) => s1.set({ activity: v })}
          display={`${activity}%`}
        />
        <Eq label="Dynamic power at the current settings">
          <K c="power">
            P<Sub>dyn</Sub>
          </K>
          <Op>=</Op>
          <span>{activity}%</span>
          <Op>×</Op>
          <span>{fmt(CHIP_CAPACITANCE_F * 1e9)} nF</span>
          <Op>×</Op>
          <K c="voltage">({fmt(volts, 2)} V)²</K>
          <Op>×</Op>
          <K c="frequency">{fmt(clock, 2)} GHz</K>
          <Op>=</Op>
          <K c="power">{fmt(s.dynamicW)} W</K>
        </Eq>
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Start by raising the clock on its own. Past {fmt(maxClockGHz(0.8), 2)} GHz the operating point crosses the curve: the critical path no longer settles in
        time, so the chip’s results would be wrong and its useful output drops to nothing. To go faster you have to raise the voltage as well, and that is where the
        cost appears. Raising the clock 15%, from 2.0 to 2.3 GHz, needs 0.86 V instead of 0.80, and the power climbs {fmt((fast.totalW / ref.totalW - 1) * 100)}%,
        from {fmt(ref.totalW)} to {fmt(fast.totalW)} W. Voltage enters squared, the clock enters too, and the hotter die leaks more, so near the top of the range
        power rises much faster than speed.
      </P>
      <P>
        Push further and the die runs out of cooling before it runs out of speed. At 2.4 GHz and 0.87 V it draws {fmt(faster.totalW)} W and reaches{' '}
        {fmt(faster.junctionC, 1)} °C, over its limit. At 1.0 V and 2.5 GHz something worse happens: the hotter die leaks more, the extra leakage heats it further, and
        the loop never settles. That is <b>thermal runaway</b>; a real chip would throttle itself long before. The most this die
        can sustain with its 40 °C coolant is about {fmt(Math.round(top.tflops / 10) * 10)} TFLOPS, at 2.35 GHz and 0.86 V, drawing {fmt(top.totalW)} W. Real accelerators add a
        second limit, on power: the A-class’s board is rated for {fmt(BOARD_LIMIT_W)} W, the dashed line, and under a heavy workload it lowers its own clock and
        voltage to stay beneath it.
      </P>
      <P>
        Now go the other way. At 1.0 GHz the critical path settles at just 0.61 V, and each floating-point operation takes {fmt(slow.pjPerFlop, 2)} picojoules of{' '}
        <K c="energy">energy</K>, against {fmt(ref.pjPerFlop, 2)} at 2.0 GHz and 0.8 V — {fmt((1 - slow.pjPerFlop / ref.pjPerFlop) * 100)}% less for the same
        arithmetic. The chip does half as much of it per second, of course. Speed against energy per operation is the trade at the heart of this lesson.
      </P>

      <Challenge
        id="a"
        question="Deliver at least 900 TFLOPS of arithmetic, with timing met and the die at or under 90 °C, while drawing as little power as possible."
        solved={solvedA}
        status={statusA}
        success={`Solved. With every block busy, 900 TFLOPS needs a clock of about 1.8 GHz — and 1.8 GHz falls just short, at ${fmt(chipState(0.77, 1.8, 1).tflops)} TFLOPS, so ${fmt(least.clockGHz, 2)} GHz it is, at ${fmt(least.vdd, 2)} V, the lowest voltage that runs it: ${fmt(least.totalW)} W. Running fewer SMs on a faster clock does the same arithmetic, but the faster clock needs a higher voltage, and voltage costs power on every operation.`}
      />

      <H2>Going wide</H2>
      <P>
        The challenge’s answer points to a strategy. If a lower voltage makes every operation cheaper but every circuit slower, build more circuits and run each one
        slower. In the next demonstration, the chip’s work — 2 GHz of it, at full activity — is shared among several identical copies of its logic. Each copy runs at
        2 GHz divided by the number of copies, at the lowest voltage that clock allows. To compare like with like, the die is held at 60 °C throughout. Change the
        number of copies; each bar appears as you reach it:
      </P>

      <Figure name="Processor Energy Simulator · going wide" scenario={s2}>
        <WideChart units={units} />
        <Legend
          items={[
            { label: 'Dynamic power', color: GRAPHIC.red },
            { label: 'Leakage', color: LEAK_COLOR },
          ]}
        />
        <Readouts
          items={[
            { label: 'supply voltage', value: `${fmt(w.vdd, 2)} V`, tone: 'blue' },
            { label: 'power against one copy', value: units === 1 ? '—' : `${fmt((w.totalW / one.totalW - 1) * 100)}%`, tone: 'red' },
          ]}
        />
        <Slider label="Copies of the logic" value={units} min={1} max={8} onChange={(v) => s2.set({ units: v })} display={units === 1 ? '1 copy' : `${units} copies`} />
      </Figure>

      <P>
        One copy at 2.0 GHz uses {fmt(one.totalW)} W, less than the {fmt(ref.totalW)} W of <FigRef to="Processor Energy Simulator">the first
        demonstration</FigRef>: the die is held at 60 °C rather than {fmt(ref.junctionC)} °C, so it leaks {fmt(one.leakageW)} W instead of{' '}
        {fmt(ref.leakageW)}, and runs at exactly the lowest voltage 2 GHz allows, {fmt(one.vdd, 3)} V. Two copies at 1.0 GHz each need only {fmt(parallelPower(2, 2).vdd, 2)} V, and together they use{' '}
        {fmt(parallelPower(2, 2).totalW)} W — {fmt((1 - parallelPower(2, 2).totalW / one.totalW) * 100)}% less for exactly the same arithmetic. Four copies at 0.5 GHz use{' '}
        {fmt(parallelPower(4, 2).totalW)} W. The saving comes entirely from the voltage. The copies’ clocks add up to the same 2 GHz, and each copy has the same
        capacitance, so the a·C·f part of the dynamic power is unchanged and only V² falls.
      </P>
      <P>
        It can’t go on forever. Every copy is another die’s worth of transistors leaking, and the voltage can’t keep falling either: close to the transistors’{' '}
        {fmt(NFET.vth, 2)}-volt threshold, gates become slow and erratic, so we don’t let the supply drop below {fmt(V_FLOOR, 2)} V.
      </P>

      <Challenge
        id="b"
        question={`Predict first: once the supply sits at its ${fmt(V_FLOOR, 2)} V floor, what does one more copy save, and what does it add? Then find the number of copies that does the same work with the least power.`}
        solved={solvedB}
        status={`Right now ${units === 1 ? 'one copy uses' : `${units} copies use`} ${fmt(w.totalW)} W, at ${fmt(w.vdd, 2)} V.`}
        success={`Solved. ${best} copies, at ${fmt(parallelPower(best, 2).clockGHz, 2)} GHz each, are the first to reach the ${fmt(V_FLOOR, 2)} V floor — ${best - 1} still need ${fmt(parallelPower(best - 1, 2).vdd, 2)} V — and use ${fmt(parallelPower(best, 2).totalW)} W, ${fmt((1 - parallelPower(best, 2).totalW / one.totalW) * 100)}% less than one copy at full speed. Past the floor another copy saves nothing: the clocks still add up to 2 GHz, so a·C·f is unchanged, and V² can’t fall further. It only adds a die’s worth of leakage: seven copies use ${fmt(parallelPower(7, 2).totalW)} W, and eight ${fmt(parallelPower(8, 2).totalW)} W.`}
      />

      <P>
        Copies cost silicon, too. Six copies of a die is six times the area to manufacture and pay for, which is why chips don’t simply sit at the bottom of{' '}
        <FigRef to="Processor Energy Simulator · going wide">this curve</FigRef>: the right number of copies balances the electricity bill against the price of the
        chip. That balance — the cost of the hardware against the cost of running it — will come back in every later chapter.
      </P>

      <H2>Why chips went parallel</H2>
      <P>
        For about three decades, each new generation of transistors was smaller, and designers could lower the supply voltage in step, so a chip with twice as many
        transistors, switching faster, still drew about the same power per square millimeter. That bargain is called Dennard scaling, after the IBM engineer who
        described it in 1974, and it broke down in the mid-2000s. Leakage was the reason. At room temperature, a transistor’s off current can fall at most tenfold for
        every 60 millivolts the gate sits below threshold (ours manages {fmt(subthresholdSwingMV())}), so the threshold, and with it the supply,
        couldn’t keep falling without the chip leaking away its power budget. Processor clocks, which had climbed for decades, leveled off at a few gigahertz, and the
        extra transistors each generation brought went into more cores rather than faster ones.
      </P>
      <P>
        A GPU takes that idea about as far as it goes. The A-class has {ACCELERATORS.A.sms} SMs of {SM_LIMITS.fp32Lanes} arithmetic lanes each —{' '}
        {fmt(lanes)} lanes — ticking at {fmt(ACCELERATORS.A.clockGHz, 2)} GHz, slower than a laptop processor’s top speed, plus matrix units that together
        perform {fmt(ACCELERATORS.A.bf16Tflops)} BF16 TFLOPS. Our die’s {fmt(ref.pjPerFlop, 2)} pJ per operation at 0.8 V
        and 2 GHz is in the same range as a real accelerator of that size, and its {fmt(ref.totalW)} W is close to what one draws.
      </P>
      <P>
        Every one of those watts ends up as heat. Eight such accelerators in a server, with their host processors, memory, network cards and fans, draw about{' '}
        {fmt(serverPowerW('A') / 1000, 1)} kW, and a data hall holds thousands of them. Getting that power in and the heat back out is the subject of{' '}
        <a href={lessonHref('compute/4.1')}>Chapter 4</a>. First, though, we need to see what thousands of slow lanes are good for. Chapter 2 opens by setting a
        processor built for one fast thread of work beside one built for thousands of slow ones, in <a href={lessonHref('compute/2.1')}>Lesson 2.1</a>.
      </P>
    </LessonPage>
  );
}
