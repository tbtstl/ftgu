import { useId, useState, type ReactNode } from 'react';
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
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  Sup,
  TEXT,
  clamp,
  fmt,
  lessonHref,
  mix,
  niceDomain,
  niceTicks,
  pct,
  useScenario,
} from '../../../framework';
import { ROUGHNESS, pipeFlow, pipeInventory, pressureProfile, velocity, type PipeFlow } from '../../../engines/gas/hydraulics';
import { MMBTU_PER_MCF, PIPELINE_GAS, STD_PSIA, gasProperties, psia, rankine } from '../../../engines/gas/properties';
import { XYChart } from '../shared/XYChart';

type Roughness = keyof typeof ROUGHNESS;

const ROUGH_OPTIONS: Array<{ value: Roughness; label: string }> = [
  { value: 'coated', label: 'Coated inside' },
  { value: 'newSteel', label: 'New steel' },
  { value: 'oldSteel', label: 'Old steel' },
];

/** Northline with no compressor stations along the way: 35-inch inside diameter, 240 miles, from its 1,440 psig limit down to 765 psig. */
export const FLOW_DEFAULTS = { diameter: 35, length: 240, inlet: 1440, outlet: 765, rough: 'newSteel' as Roughness };

/** Flow through a pipe between two gauge pressures (psig). */
export function flowAt(diameter: number, length: number, inletPsig: number, outletPsig: number, rough: Roughness = 'newSteel'): PipeFlow {
  return pipeFlow({ diameterIn: diameter, lengthMi: length, roughnessIn: ROUGHNESS[rough] }, psia(inletPsig), psia(outletPsig));
}

/** Hours a parcel of gas takes to travel the length of a pipe, integrating 1/velocity along the pressure profile. */
export function transitHours(diameter: number, length: number, inletPsig: number, outletPsig: number, rough: Roughness = 'newSteel', steps = 400): number {
  const f = flowAt(diameter, length, inletPsig, outletPsig, rough);
  if (f.qMMcfd <= 0) return Infinity;
  const prof = pressureProfile(psia(inletPsig), psia(outletPsig), steps);
  let seconds = 0;
  for (let i = 0; i < steps; i++) {
    const v = velocity(f.qMMcfd * 1e6, (prof[i] + prof[i + 1]) / 2, 60, diameter);
    seconds += ((length / steps) * 5280) / v;
  }
  return seconds / 3600;
}

/** Pressure (psig) a fraction x of the way along a pipe whose ends are at the given gauge pressures. */
function psigAlong(inletPsig: number, outletPsig: number, x: number): number {
  const a = psia(inletPsig);
  const b = psia(outletPsig);
  return Math.sqrt(Math.max(0, a * a - (a * a - b * b) * x)) - (psia(0));
}

// Numbers the prose quotes, all from the engine.
const D = FLOW_DEFAULTS;
const BASE = flowAt(D.diameter, D.length, D.inlet, D.outlet);
const ROUGH_Q = Object.fromEntries(ROUGH_OPTIONS.map((o) => [o.value, flowAt(D.diameter, D.length, D.inlet, D.outlet, o.value).qMMcfd])) as Record<Roughness, number>;
const DROPS = [
  [400, 100],
  [1000, 700],
  [1300, 1000],
].map(([a, b]) => ({ inlet: a, outlet: b, q: flowAt(D.diameter, D.length, a, b).qMMcfd }));
const SMALL = flowAt(18, D.length, D.inlet, D.outlet).qMMcfd;
const DOUBLE = flowAt(36, D.length, D.inlet, D.outlet).qMMcfd;
const HALF_LENGTH = flowAt(D.diameter, D.length / 2, D.inlet, D.outlet).qMMcfd;
const LOW_OUTLET = flowAt(D.diameter, D.length, D.inlet, 100);
const MID_PSIG = psigAlong(D.inlet, D.outlet, 0.5);
const Q3_PSIG = psigAlong(D.inlet, D.outlet, 0.75);
const TRANSIT = transitHours(D.diameter, D.length, D.inlet, D.outlet);
const LINEPACK_MMCF = pipeInventory({ diameterIn: D.diameter, lengthMi: D.length, roughnessIn: ROUGHNESS.newSteel }, psia(D.inlet), psia(D.outlet)) / 1e6;
const G = gasProperties(PIPELINE_GAS).sg;
const TB_PB = rankine(60) / STD_PSIA;

/** Northline's throughput, MMcf/d: the challenge asks for a pipe that carries it without stations. */
export const TARGET_MMCFD = 1800;

/** The challenge: Northline's ends and wall, and the smallest whole-inch diameter that carries 1,800 MMcf/d. */
export function northlineSolved(s: typeof FLOW_DEFAULTS): boolean {
  const onNorthline = s.length === D.length && s.inlet === D.inlet && s.outlet === D.outlet && s.rough === 'newSteel';
  if (!onNorthline) return false;
  return flowAt(s.diameter, s.length, s.inlet, s.outlet).qMMcfd >= TARGET_MMCFD && flowAt(s.diameter - 1, s.length, s.inlet, s.outlet).qMMcfd < TARGET_MMCFD;
}

const ANSWER_D = (() => {
  let d = 6;
  while (flowAt(d, D.length, D.inlet, D.outlet).qMMcfd < TARGET_MMCFD) d++;
  return d;
})();
const ANSWER_Q = flowAt(ANSWER_D, D.length, D.inlet, D.outlet).qMMcfd;
const BELOW_Q = flowAt(ANSWER_D - 1, D.length, D.inlet, D.outlet).qMMcfd;
const RATIO = TARGET_MMCFD / BASE.qMMcfd;
const ESTIMATE = D.diameter * Math.pow(RATIO, 0.4);

const q0 = (x: number) => fmt(x);
const fps = (x: number) => (x < 100 ? fmt(x, 1) : fmt(x)) + ' ft/s';
const mph = (ftPerS: number) => (ftPerS * 3600) / 5280;

/** Readable Reynolds number: "2.9 × 10⁷". */
function sci(x: number): string {
  if (!(x > 0)) return '0';
  const e = Math.floor(Math.log10(x));
  const sup = String(e)
    .split('')
    .map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)])
    .join('');
  return `${fmt(x / 10 ** e, 1)} × 10${sup}`;
}

const PRESSURE_LIGHT = '#eef3f9';

/** The pipe: drawn thickness grows with diameter, shaded by pressure, with moving dots for the gas. */
function PipeDiagram({ s, r }: { s: typeof FLOW_DEFAULTS; r: PipeFlow }) {
  const grad = 'pipe' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const x0 = 70;
  const x1 = 510;
  const cy = 112;
  const th = 10 + s.diameter * 1.5;
  const top = cy - th / 2;
  const bot = cy + th / 2;
  const flowing = r.qMMcfd > 0;
  const prof = pressureProfile(psia(s.inlet), psia(s.outlet), 10);
  const vAvg = (r.vIn + r.vOut) / 2;
  const speed = Math.min(320, vAvg * 2.4);
  const dotStyle = flowing && speed > 0.5 ? { animationDuration: `${(18 / speed).toFixed(3)}s` } : { animationPlayState: 'paused' as const };
  const dot = Math.max(3, Math.min(8, th * 0.28));
  return (
    <svg
      className="diagram"
      viewBox="0 0 600 226"
      role="img"
      aria-label={
        flowing
          ? `A ${s.diameter}-inch pipe ${s.length} miles long. Gas enters at ${fmt(s.inlet)} psig and leaves at ${fmt(s.outlet)} psig, flowing ${q0(r.qMMcfd)} MMcf/d at ${fps(r.vIn)} at the inlet and ${fps(r.vOut)} at the outlet.`
          : `A ${s.diameter}-inch pipe ${s.length} miles long with ${fmt(s.inlet)} psig at the inlet and ${fmt(s.outlet)} psig at the outlet. No gas flows.`
      }
    >
      <defs>
        <linearGradient id={grad} x1="0" x2="1" y1="0" y2="0">
          {prof.map((p, i) => (
            <stop key={i} offset={i / 10} stopColor={mix(PRESSURE_LIGHT, GRAPHIC.blue, clamp((p - psia(0)) / 1500, 0, 1) * 0.75)} />
          ))}
        </linearGradient>
      </defs>
      <text className="ax" x={x0} y={top - 34}>
        inlet
      </text>
      <text x={x0} y={top - 14} style={{ fontSize: 15, fontWeight: 500, fill: TEXT.blue }}>
        {fmt(s.inlet)} psig
      </text>
      <text className="ax ax-e" x={x1} y={top - 34}>
        outlet
      </text>
      <text x={x1} y={top - 14} textAnchor="end" style={{ fontSize: 15, fontWeight: 500, fill: TEXT.blue }}>
        {fmt(s.outlet)} psig
      </text>
      <text x={(x0 + x1) / 2} y={top - 14} textAnchor="middle" style={{ fontSize: 15, fontWeight: 500, fill: TEXT.orange }}>
        {flowing ? `${q0(r.qMMcfd)} MMcf/d →` : 'no flow'}
      </text>
      <rect x={x0} y={top} width={x1 - x0} height={th} fill={`url(#${grad})`} stroke="#6b6b6b" strokeWidth={1.5} />
      <rect x={x0 - 6} y={top - 4} width={6} height={th + 8} fill="#9a9a9a" />
      <rect x={x1} y={top - 4} width={6} height={th + 8} fill="#9a9a9a" />
      <path d={`M${x0 + 8} ${cy} L${x1 - 8} ${cy}`} className="flow-dots" stroke="#fff" strokeWidth={dot} style={dotStyle} />
      <text x={x0} y={bot + 22} style={{ fontSize: 13, fontWeight: 500, fill: TEXT.orange }}>
        {flowing ? fps(r.vIn) : '0 ft/s'}
      </text>
      <text x={x1} y={bot + 22} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: TEXT.orange }}>
        {flowing ? fps(r.vOut) : '0 ft/s'}
      </text>
      <line x1={x0} x2={x1} y1={bot + 40} y2={bot + 40} stroke="#9a9a9a" strokeWidth={1} />
      <line x1={x0} x2={x0} y1={bot + 34} y2={bot + 46} stroke="#9a9a9a" strokeWidth={1} />
      <line x1={x1} x2={x1} y1={bot + 34} y2={bot + 46} stroke="#9a9a9a" strokeWidth={1} />
      <text className="ax ax-m" x={(x0 + x1) / 2} y={bot + 36} style={{ paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 6 }}>
        {fmt(s.length)} miles
      </text>
      <line x1={x1 + 20} x2={x1 + 20} y1={top} y2={bot} stroke="#9a9a9a" strokeWidth={1} />
      <line x1={x1 + 14} x2={x1 + 26} y1={top} y2={top} stroke="#9a9a9a" strokeWidth={1} />
      <line x1={x1 + 14} x2={x1 + 26} y1={bot} y2={bot} stroke="#9a9a9a" strokeWidth={1} />
      <text className="ax" x={x1 + 30} y={cy + 4}>
        {s.diameter} in
      </text>
    </svg>
  );
}

export default function Lesson() {
  const sc = useScenario('pipe', FLOW_DEFAULTS);
  const s = sc.state;
  const r = flowAt(s.diameter, s.length, s.inlet, s.outlet, s.rough);
  const flowing = r.qMMcfd > 0;
  const solved = northlineSolved(s);
  const onNorthline = s.length === D.length && s.inlet === D.inlet && s.outlet === D.outlet && s.rough === 'newSteel';

  // Figure 2: the profile along the pipe, read at a mile the reader drags to.
  const [mileRaw, setMile] = useState(D.length / 2);
  const mile = clamp(mileRaw, 0, s.length);
  const N = 60;
  const xs = Array.from({ length: N + 1 }, (_, i) => (i / N) * s.length);
  const pressures = xs.map((m) => psigAlong(s.inlet, s.outlet, m / s.length));
  const speeds = xs.map((_, i) => (flowing ? velocity(r.qMMcfd * 1e6, pressures[i] + psia(0), 60, s.diameter) : 0));
  const pAt = psigAlong(s.inlet, s.outlet, mile / s.length);
  const vAt = flowing ? velocity(r.qMMcfd * 1e6, pAt + psia(0), 60, s.diameter) : 0;
  const dropUsed = s.inlet > s.outlet ? (s.inlet - pAt) / (s.inlet - s.outlet) : 0;
  const [, vMax] = niceDomain(0, Math.max(10, ...speeds), 4);
  const pTop = Math.max(1500, niceDomain(0, Math.max(s.inlet, s.outlet), 3)[1]);
  const mileTicks = niceTicks(0, s.length, 6);
  const scrubStep = Math.max(1, Math.round(s.length / 40));

  const status = !onNorthline
    ? 'Set the first demonstration back to Northline’s ends and wall — 240 miles, 1,440 psig in, 765 psig out, new steel — with Reset, then change only the diameter.'
    : r.qMMcfd < TARGET_MMCFD
      ? `At ${s.diameter} inches the pipe carries ${q0(r.qMMcfd)} MMcf/d, short of 1,800.`
      : `At ${s.diameter} inches it carries ${q0(r.qMMcfd)} MMcf/d — enough. Would a smaller pipe do?`;

  return (
    <LessonPage id="gas/1.3">
      <P>
        In <a href={lessonHref('gas/1.2')}>the previous lesson</a> we squeezed gas into a closed cylinder and watched its pressure climb. Open that cylinder into a pipe and
        the pressure becomes a push: gas flows from where the <K tone="blue">pressure</K> is high to where it’s low, and the bigger the difference, the more of it moves. A
        gas pipeline is that idea stretched over hundreds of miles. Gas enters at one end at high pressure and leaves at the other at a lower one, and friction — the gas
        rubbing against the pipe’s wall and churning against itself — uses up the difference along the way.
      </P>
      <P>
        Our running example is Northline, the pipeline that carries gas from Calder Hub, the region’s trading hub, north to the city of Metro. It’s a 36-inch pipe — 35
        inches across inside its steel wall — and 240 miles long. How much gas can it carry? The answer depends on the pressures at its two ends, its diameter, its length
        and how rough its inside wall is.
      </P>
      <P>
        In the next demonstration, the pipe starts out as Northline would be with nothing to help it along the way: gas enters at 1,440 psig, the most the line is allowed
        to hold, and must reach Metro at no less than 765 psig. The moving dots show how fast the gas travels, and the pipe’s shading darkens with its pressure. Change the
        pipe and the pressures at its ends:
      </P>

      <Figure name="Gas Flow Lab" scenario={sc}>
        <PipeDiagram s={s} r={r} />
        <Readouts
          items={[
            { label: 'throughput', value: flowing ? `${q0(r.qMMcfd)} MMcf/d` : '0', tone: 'orange' },
            { label: 'energy carried', value: flowing ? `${fmt((r.qMMcfd * 1000 * MMBTU_PER_MCF) / 1e6, 2)} million MMBtu/d` : '0', tone: 'gold' },
            { label: 'friction factor', value: flowing ? fmt(r.f, 4) : '—', tone: 'violet' },
            { label: 'Reynolds number', value: flowing ? sci(r.re) : '—' },
          ]}
        />
        <Segmented label="Inside wall" value={s.rough} onChange={(v) => sc.set({ rough: v })} options={ROUGH_OPTIONS} />
        <Slider label="Inside diameter" value={s.diameter} min={6} max={48} onChange={(v) => sc.set({ diameter: v })} display={`${s.diameter} in`} />
        <Slider label="Length" value={s.length} min={10} max={400} step={10} onChange={(v) => sc.set({ length: v })} display={`${fmt(s.length)} mi`} />
        <Slider label="Inlet pressure" tone="blue" value={s.inlet} min={100} max={1500} step={5} onChange={(v) => sc.set({ inlet: v })} display={`${fmt(s.inlet)} psig`} />
        <Slider label="Outlet pressure" tone="blue" value={s.outlet} min={0} max={1490} step={5} onChange={(v) => sc.set({ outlet: v })} display={`${fmt(s.outlet)} psig`} />
        <Eq
          label={`Throughput equals 77.54 times ${fmt(TB_PB, 2)} times the square root of (${fmt(r.p1, 1)} squared minus ${fmt(r.p2, 1)} squared) over (${fmt(G, 3)} times 519.7 times ${s.length} times ${fmt(r.zAvg, 3)} times ${fmt(r.f, 4)}), times ${s.diameter} to the 2.5, equals ${q0(r.qMMcfd)} MMcf/d`}
        >
          <K tone="orange">Q</K>
          <Op>=</Op>
          <span>77.54 × {fmt(TB_PB, 2)}</span>
          <Op>×</Op>
          <span>√</span>
          <Frac
            top={
              <span>
                <K tone="blue">{fmt(r.p1, 1)}</K>
                <Sup>2</Sup> − <K tone="blue">{fmt(r.p2, 1)}</K>
                <Sup>2</Sup>
              </span>
            }
            bottom={
              <span>
                {fmt(G, 3)} × <Tt>519.7</Tt> × {s.length} × {fmt(r.zAvg, 3)} × <K tone="violet">{fmt(r.f, 4)}</K>
              </span>
            }
          />
          <Op>×</Op>
          <span>
            {s.diameter}
            <Sup>2.5</Sup>
          </span>
          <Op>=</Op>
          <K tone="orange">{q0(r.qMMcfd)} MMcf/d</K>
        </Eq>
        <Caption>
          {flowing
            ? `Gas speeds up from ${fps(r.vIn)} at the inlet to ${fps(r.vOut)} at the outlet as it expands.`
            : 'With the outlet pressure at or above the inlet’s, nothing flows: there is no difference to push the gas.'}
        </Caption>
      </Figure>

      <P>
        At the starting settings the pipe carries {q0(BASE.qMMcfd)} million standard cubic feet a day (MMcf/d), about{' '}
        {fmt((BASE.qMMcfd * 1000 * MMBTU_PER_MCF) / 1e6, 2)} million MMBtu of <K c="energy">energy</K> at the 1,037 Btu per cubic foot of the region’s pipeline gas.
        Engineers size gas pipelines with the <b>general flow equation</b>, which is what the demonstration solves:
      </P>
      <Eq label="Q equals 77.54 times T b over P b times the square root of (P1 squared minus P2 squared) over (G T L Z f), times D to the 2.5">
        <K tone="orange">Q</K>
        <Op>=</Op>
        <span>77.54</span>
        <Op>×</Op>
        <Frac
          top={
            <span>
              T<Sub>b</Sub>
            </span>
          }
          bottom={
            <span>
              P<Sub>b</Sub>
            </span>
          }
        />
        <Op>×</Op>
        <span>√</span>
        <Frac
          top={
            <span>
              <K tone="blue">P</K>
              <Sub>1</Sub>
              <Sup>2</Sup> − <K tone="blue">P</K>
              <Sub>2</Sub>
              <Sup>2</Sup>
            </span>
          }
          bottom={
            <span>
              G · <Tt>T</Tt> · L · Z · <K tone="violet">f</K>
            </span>
          }
        />
        <Op>×</Op>
        <span>
          D<Sup>2.5</Sup>
        </span>
      </Eq>
      <P>
        Q is in standard cubic feet a day. T<Sub>b</Sub> and P<Sub>b</Sub> are the standard temperature and pressure (60 °F, which is 519.67 degrees Rankine, and 14.73
        psia), and 77.54 is a constant that makes the units work. The pressures are absolute, so Northline’s 1,440 psig enters as {fmt(BASE.p1, 1)} psia. G is the gas’s specific gravity, {fmt(G, 3)} for the
        region’s gas; <Tt>T</Tt> its temperature in degrees Rankine, which we hold at 60 °F, close to the ground the pipe is buried in; L the length in miles; Z the
        compressibility factor at the pipe’s average pressure; and D the inside diameter in inches. The equation assumes steady flow at a constant temperature along a level
        pipe.
      </P>
      <P>
        The last ingredient, the <K tone="violet">friction factor</K> f, measures how hard the gas must work to get past the wall. Gas in a big pipeline is turbulent: its
        Reynolds number — the ratio of the gas’s momentum to the viscosity that tries to smooth it — is around {sci(BASE.re)}, far above the roughly 2,000 below which flow is
        smooth and orderly. In flow that turbulent, f depends almost entirely on how rough the wall is compared with the diameter. Switch the wall: the same pipe carries{' '}
        {q0(ROUGH_Q.coated)} MMcf/d if it’s coated inside, {q0(ROUGH_Q.newSteel)} as new steel and {q0(ROUGH_Q.oldSteel)} as old, pitted steel. That’s why some pipelines
        are lined with a smooth internal coating.
      </P>

      <H2>Pressure squared</H2>
      <P>
        The equation’s most surprising feature is under the square root. Flow depends on the difference between the <i>squares</i> of the absolute pressures, not on the
        difference between the pressures. Try a drop of 300 psi at three levels: from {fmt(DROPS[0].inlet)} to {fmt(DROPS[0].outlet)} psig the pipe carries {q0(DROPS[0].q)}{' '}
        MMcf/d, from {fmt(DROPS[1].inlet)} to {fmt(DROPS[1].outlet)} it carries {q0(DROPS[1].q)}, and from {fmt(DROPS[2].inlet)} to {fmt(DROPS[2].outlet)} it carries{' '}
        {q0(DROPS[2].q)}. The same drop moves more than twice as much gas at the top of the range. Gas at high pressure is dense, so the same amount of it moves more
        slowly, and friction grows with the square of the speed.
      </P>
      <P>
        It works the other way at the outlet. Lower the delivery pressure from 765 psig all the way to 100 and the flow rises by only{' '}
        {pct(LOW_OUTLET.qMMcfd / BASE.qMMcfd - 1)}, while the gas leaving the pipe accelerates to {fmt(LOW_OUTLET.vOut)} feet a second. The last few hundred psi buy
        almost nothing — and the customers at the far end need that pressure anyway, to push gas through their own networks. So transmission pipelines run at high
        pressure from end to end.
      </P>

      <H2>Bigger pipes</H2>
      <P>
        The other strong term is the diameter, raised to the power 2.5. With Northline’s ends, an 18-inch pipe carries {q0(SMALL)} MMcf/d; double it to 36 inches and it
        carries {q0(DOUBLE)}, {fmt(DOUBLE / SMALL, 1)} times as much. That’s a little more than 2<Sup>2.5</Sup> ≈ 5.7, because a wider pipe’s wall is smoother relative to
        its size, so its friction factor is lower. Length, by contrast, sits under the square root: halve the pipe to 120 miles and it carries only{' '}
        {pct(HALF_LENGTH / BASE.qMMcfd - 1)} more.
      </P>
      <P>
        A pipeline’s cost grows much more slowly than its capacity, since much of it — the right of way, the trench, the crews, the permits — barely depends on the pipe’s
        size. That economy of scale is why gas travels long distances through a few very large pipelines rather than many small ones.
      </P>

      <Challenge
        id="a"
        figure="Gas Flow Lab"
        question={
          <>
            Northline actually carries 1.8 Bcf/d — 1,800 MMcf/d. Suppose it had to do that with nothing along the way to help: gas enters at 1,440 psig and must reach Metro,
            240 miles away, at no less than 765 psig, through new steel. What’s the smallest inside diameter, in whole inches, that would do it? Estimate it from the
            2.5 power first, then check in <FigRef to="Gas Flow Lab">the first demonstration</FigRef>.
          </>
        }
        solved={solved}
        status={status}
        success={`Solved. ${ANSWER_D} inches carries ${q0(ANSWER_Q)} MMcf/d; ${ANSWER_D - 1} inches carries only ${q0(BELOW_Q)}. The 2.5 power gets you close: the pipe must carry ${fmt(RATIO, 2)} times what the 35-inch pipe does, and ${fmt(RATIO, 2)} to the power 1/2.5 is ${fmt(Math.pow(RATIO, 0.4), 2)}, so 35 × ${fmt(Math.pow(RATIO, 0.4), 2)} ≈ ${fmt(ESTIMATE, 1)} inches. That pipe needs ${pct((ANSWER_D / D.diameter) ** 2 - 1)} more cross-section than Northline’s.`}
      />

      <H2>Along the pipe</H2>
      <P>
        The pressure doesn’t fall evenly between the two ends. In the next demonstration, the upper chart traces the pressure along the pipe from{' '}
        <FigRef to="Gas Flow Lab">the first demonstration</FigRef>, with a dashed line for comparison showing how it would fall if it fell evenly, and the lower chart
        traces the gas’s speed. Drag across either chart to read any mile, and change the pressures at the ends:
      </P>

      <Figure name="Gas Flow Lab · along the pipe" scenario={sc}>
        <Legend
          items={[
            { label: 'Pressure', color: GRAPHIC.blue, kind: 'line' },
            { label: 'If it fell evenly', color: '#9a9a9a', kind: 'line', dashed: true },
            { label: 'Gas speed', color: GRAPHIC.orange, kind: 'line' },
          ]}
        />
        <XYChart
          xDomain={[0, s.length]}
          yDomain={[0, pTop]}
          yTicks={niceTicks(0, pTop, 3)}
          xTicks={mileTicks}
          xFormat={(v) => fmt(v)}
          yFormat={(v) => fmt(v)}
          yLabel="Pressure, psig"
          height={200}
          series={[
            { xs: [0, s.length], ys: [s.inlet, s.outlet], color: '#9a9a9a', dash: '6 5', width: 1.5 },
            { xs, ys: pressures, color: GRAPHIC.blue, width: 3 },
          ]}
          markers={[{ x: mile, y: pAt, color: GRAPHIC.blue, label: `${fmt(pAt)} psig`, labelPos: mile > s.length * 0.7 ? 'left' : 'right' }]}
          cursor={mile}
          onScrub={setMile}
          scrubStep={scrubStep}
          scrubLabel="Mile along the pipe"
          ariaLabel={`Pressure along a ${s.length}-mile pipe, from ${fmt(s.inlet)} psig at the inlet to ${fmt(s.outlet)} psig at the outlet. At mile ${fmt(mile)} it is ${fmt(pAt)} psig.`}
        />
        <XYChart
          xDomain={[0, s.length]}
          yDomain={[0, vMax]}
          yTicks={niceTicks(0, vMax, 3)}
          xTicks={mileTicks}
          xFormat={(v) => fmt(v)}
          yFormat={(v) => fmt(v)}
          yLabel="Gas speed, ft/s"
          xLabel="miles from the inlet"
          height={170}
          series={[{ xs, ys: speeds, color: GRAPHIC.orange, width: 3 }]}
          markers={flowing ? [{ x: mile, y: vAt, color: GRAPHIC.orange, label: fps(vAt), labelPos: mile > s.length * 0.7 ? 'left' : 'right' }] : []}
          cursor={mile}
          onScrub={setMile}
          scrubStep={scrubStep}
          scrubLabel="Mile along the pipe"
          ariaLabel={`Gas speed along the pipe, from ${fps(r.vIn)} at the inlet to ${fps(r.vOut)} at the outlet. At mile ${fmt(mile)} it is ${fps(vAt)}.`}
        />
        <Readouts
          items={[
            { label: `pressure at mile ${fmt(mile)}`, value: `${fmt(pAt)} psig`, tone: 'blue' },
            { label: 'share of the drop used so far', value: pct(dropUsed), tone: 'blue' },
            { label: 'gas speed there', value: fps(vAt), tone: 'orange' },
          ]}
        />
        <Slider label="Inlet pressure" tone="blue" value={s.inlet} min={100} max={1500} step={5} onChange={(v) => sc.set({ inlet: v })} display={`${fmt(s.inlet)} psig`} />
        <Slider label="Outlet pressure" tone="blue" value={s.outlet} min={0} max={1490} step={5} onChange={(v) => sc.set({ outlet: v })} display={`${fmt(s.outlet)} psig`} />
      </Figure>

      <P>
        With Northline’s ends, halfway along the pressure has fallen only {fmt(D.inlet - MID_PSIG)} psi, to {fmt(MID_PSIG)} psig. The other{' '}
        {fmt(MID_PSIG - D.outlet)} psi go in the second half, {fmt(Q3_PSIG - D.outlet)} of them in the last quarter. The square root in the equation is at work again: the
        squared pressure falls evenly along the pipe, so the pressure itself follows
      </P>
      <Eq label="P of x equals the square root of P1 squared minus (P1 squared minus P2 squared) times x over L">
        <K tone="blue">P</K>(x)
        <Op>=</Op>
        <span>√</span>
        <span>
          <K tone="blue">P</K>
          <Sub>1</Sub>
          <Sup>2</Sup> − (<K tone="blue">P</K>
          <Sub>1</Sub>
          <Sup>2</Sup> − <K tone="blue">P</K>
          <Sub>2</Sub>
          <Sup>2</Sup>) · x / L
        </span>
      </Eq>
      <P>
        As the pressure falls the gas expands, so it must speed up to keep the same amount moving: from {fps(BASE.vIn)} at Calder Hub to {fps(BASE.vOut)} at Metro, roughly{' '}
        {fmt(mph(BASE.vIn))} to {fmt(mph(BASE.vOut))} miles an hour. Faster gas loses more to friction, which is why the drop steepens toward the end. A parcel of gas
        entering at Calder Hub takes about {fmt(TRANSIT)} hours to reach Metro.
      </P>
      <P>
        The pipe is never empty, either. At these pressures, its 240 miles hold about {q0(LINEPACK_MMCF)} MMcf of gas — nearly {fmt((LINEPACK_MMCF / BASE.qMMcfd) * 24)}{' '}
        hours of its own flow. That gas in the pipe, called <b>linepack</b>, is a small store in its own right, and it will matter when demand swings faster than supply in{' '}
        <a href={lessonHref('gas/3.3')}>Lesson 3.3</a>.
      </P>
      <P>
        The real Northline carries 1.8 Bcf/d through a 36-inch pipe, not a {ANSWER_D}-inch one. It manages because it doesn’t ask one push to last 240 miles: three compressor
        stations along its length raise the pressure back up before it has fallen too far. Raising the pressure of a gas takes energy, and the pipeline pays for it by
        burning some of the gas it carries. How much is the subject of the <a href={lessonHref('gas/1.4')}>next lesson</a>.
      </P>
    </LessonPage>
  );
}

/** The temperature term, in the course's temperature color. */
function Tt({ children }: { children: ReactNode }) {
  return <span className="tone-teal">{children}</span>;
}
