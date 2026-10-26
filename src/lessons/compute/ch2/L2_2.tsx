import { useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Slider,
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
import { issueUtilization, occupancy, warpTimeline, warpsToHide, waves, type KernelShape, type Occupancy } from '../../../engines/compute/gpuExec';
import { tileFit } from '../../../engines/compute/matmul';
import { ACCELERATORS, SM_LIMITS } from '../../../model/compute/hardware';

// ---------------------------------------------------------------------------
// The first demonstration: one SM's resources, and one of its four schedulers.

/** Cycles a load from HBM takes to return. */
export const LATENCY = SM_LIMITS.memLatencyCycles;
/** Cycles drawn in the scheduler's timeline. */
export const HORIZON = 2000;
/** The challenge: keep the scheduler issuing at least this share of cycles. */
export const BUSY_TARGET = 0.9;

export interface SchedState {
  threads: number;
  regs: number;
  shared: number;
  compute: number;
}

/** 256 threads per block at 64 registers each: a common shape, limited by registers. */
export const SCHED_DEFAULTS: SchedState = { threads: 256, regs: 64, shared: 0, compute: 40 };

export function kernelOf(s: SchedState): KernelShape {
  return { threadsPerBlock: s.threads, regsPerThread: s.regs, sharedKBPerBlock: s.shared };
}

/** Share of cycles a scheduler issues, in steady state (zero if not even one block fits). */
export function schedulerBusy(s: SchedState): number {
  const o = occupancy(kernelOf(s));
  return o.blocksPerSM > 0 ? issueUtilization(o.warpsPerScheduler, s.compute) : 0;
}

/** The challenge: the same 40 cycles of arithmetic per load, with the scheduler at least 90% busy. */
export function busySolved(s: SchedState): boolean {
  return s.compute === SCHED_DEFAULTS.compute && schedulerBusy(s) >= BUSY_TARGET - 1e-9;
}

/** The most registers per thread that still reaches the target with 40 cycles per load (any block size). */
export function mostRegistersForTarget(threads = SCHED_DEFAULTS.threads): number {
  let best = 0;
  for (let r = 16; r <= 255; r++) if (busySolved({ ...SCHED_DEFAULTS, threads, regs: r })) best = r;
  return best;
}

// ---------------------------------------------------------------------------
// The second demonstration: blocks spread over the 132 SMs in waves.

export interface WaveState {
  blocks: number;
  perSM: number;
}

export const WAVE_DEFAULTS: WaveState = { blocks: 133, perSM: 1 };
export const SMS = ACCELERATORS.A.sms;
export const BLOCKS_MAX = 1000;
/** The second challenge: two blocks per SM, more than 500 blocks, and no idle slot in any wave. */
export const NO_IDLE_PER_SM = 2;
export const NO_IDLE_MIN = 500;

export function noIdleSolved(s: WaveState): boolean {
  const w = waves(s.blocks, s.perSM);
  return s.perSM === NO_IDLE_PER_SM && s.blocks > NO_IDLE_MIN && w.lastWave === w.slots;
}

// ---------------------------------------------------------------------------
// Drawing: the SM's resources.

const ORANGE = GRAPHIC.orange;
const VIOLET = GRAPHIC.violet;
const IDLE = '#e4e4e0';
const WAIT = '#d9c4de';

interface ResourceRow {
  key: Occupancy['limit'];
  label: string;
  per: number;
  cap: number;
  show: (v: number) => string;
  memory: boolean;
}

function resourceRows(k: KernelShape): ResourceRow[] {
  return [
    { key: 'threads', label: 'Threads', per: k.threadsPerBlock, cap: SM_LIMITS.maxThreads, show: (v) => fmt(v), memory: false },
    { key: 'registers', label: 'Registers', per: k.threadsPerBlock * k.regsPerThread, cap: SM_LIMITS.registers, show: (v) => fmt(v), memory: true },
    { key: 'shared memory', label: 'Shared memory', per: k.sharedKBPerBlock, cap: SM_LIMITS.sharedKB, show: (v) => `${fmt(v)} KB`, memory: true },
    { key: 'blocks', label: 'Block slots', per: 1, cap: SM_LIMITS.maxBlocks, show: (v) => fmt(v), memory: false },
  ];
}

const RX = scale(0, 1, 126, 500);

function ResourceBars({ k, o }: { k: KernelShape; o: Occupancy }) {
  const rows = resourceRows(k);
  const n = o.blocksPerSM;
  const label = `One SM holds ${n} block${n === 1 ? '' : 's'} of this kernel. ${rows
    .map((r) => `${r.label}: ${r.show(n * r.per)} of ${r.show(r.cap)}`)
    .join('; ')}. The limit is ${o.limit}.`;
  return (
    <svg className="chart" viewBox="0 0 640 138" role="img" aria-label={label}>
      <text className="ax" x={RX(0)} y={12}>
        What {n === 1 ? 'the one block' : `the ${n} resident blocks`} use of one SM, block by block
      </text>
      {rows.map((r, i) => {
        const y = 26 + i * 28;
        const limiting = r.key === o.limit;
        const fill = r.memory ? VIOLET : '#8f8f8f';
        const cellW = RX(r.per / r.cap) - RX(0);
        const used = n * r.per;
        const ghostX = RX(Math.min(1, used / r.cap));
        const ghostW = Math.min(RX(1) + 26, RX((used + r.per) / r.cap)) - ghostX;
        return (
          <g key={r.key}>
            <text x={RX(0) - 8} y={y + 12} textAnchor="end" style={{ fontSize: 12, fontWeight: limiting ? 600 : 400, fill: limiting ? TEXT.ink : '#6f6f6f' }}>
              {r.label}
            </text>
            <rect x={RX(0)} y={y} width={RX(1) - RX(0)} height={16} fill="#f2f2ef" />
            {cellW > 0 &&
              Array.from({ length: n }, (_, b) => (
                <rect
                  key={b}
                  x={RX(0) + b * cellW}
                  y={y}
                  width={cellW}
                  height={16}
                  fill={fill}
                  opacity={limiting ? 0.95 : 0.6}
                  stroke={cellW > 4 ? '#fcfcfb' : 'none'}
                  strokeWidth={1}
                />
              ))}
            {limiting && r.per > 0 && ghostW > 0 && (
              <rect x={ghostX} y={y - 2} width={ghostW} height={20} fill="none" stroke={TEXT.red} strokeWidth={1.2} strokeDasharray="4 3" />
            )}
            <line x1={RX(1)} x2={RX(1)} y1={y - 3} y2={y + 19} stroke="#333" strokeWidth={1} />
            <text className="ax" x={RX(1) + 32} y={y + 12}>
              {r.show(used)} of {r.show(r.cap)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Drawing: one scheduler's warps over time.

const GX = scale(0, HORIZON, 74, 624);
const ROW = 12;

function Gantt({ warps, compute, busy }: { warps: number; compute: number; busy: number }) {
  const tl = useMemo(() => warpTimeline(warps, compute, LATENCY, HORIZON), [warps, compute]);
  const top = 46;
  const height = top + Math.max(1, warps) * ROW + 40;
  const label =
    warps === 0
      ? 'No warps: not even one block of this kernel fits on an SM, so the scheduler has nothing to run.'
      : `One scheduler's ${warps} warp${warps === 1 ? '' : 's'} over ${fmt(HORIZON)} cycles. Each computes for ${compute} cycles, then waits ${LATENCY} cycles for memory. In steady state the scheduler issues on ${pct(busy, 1)} of cycles.`;
  return (
    <svg className="chart" viewBox={`0 0 640 ${height}`} role="img" aria-label={label}>
      <text className="ax" x={GX(0)} y={12}>
        One scheduler, cycle by cycle
      </text>
      <text x={GX(0) - 8} y={32} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: TEXT.ink }}>
        issuing
      </text>
      <rect x={GX(0)} y={22} width={GX(HORIZON) - GX(0)} height={14} fill={IDLE} />
      {tl.segments
        .filter((s) => s.kind === 'compute')
        .map((s, i) => (
          <rect key={i} x={GX(s.start)} y={22} width={Math.max(0.6, GX(s.end) - GX(s.start))} height={14} fill={ORANGE} />
        ))}
      {warps === 0 && (
        <text x={(GX(0) + GX(HORIZON)) / 2} y={top + 10} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: TEXT.red }}>
          no block fits on the SM: nothing to run
        </text>
      )}
      {Array.from({ length: warps }, (_, w) => (
        <g key={w}>
          {(w === 0 || w === warps - 1) && (
            <text className="ax ax-e" x={GX(0) - 8} y={top + w * ROW + 9}>
              warp {w + 1}
            </text>
          )}
          <line x1={GX(0)} x2={GX(HORIZON)} y1={top + w * ROW + 5} y2={top + w * ROW + 5} stroke="#efefec" strokeWidth={1} />
        </g>
      ))}
      {tl.segments.map((s, i) =>
        s.kind === 'compute' ? (
          <rect key={i} x={GX(s.start)} y={top + s.warp * ROW} width={Math.max(0.6, GX(s.end) - GX(s.start))} height={ROW - 2} fill={ORANGE} />
        ) : (
          <rect key={i} x={GX(s.start)} y={top + s.warp * ROW + 3} width={Math.max(0.6, GX(s.end) - GX(s.start))} height={ROW - 8} fill={WAIT} />
        ),
      )}
      {[0, 500, 1000, 1500, 2000].map((c) => (
        <text key={c} className={c === HORIZON ? 'ax ax-e' : 'ax ax-m'} x={GX(c)} y={height - 20}>
          {fmt(c)}
        </text>
      ))}
      <text className="ax ax-e" x={GX(HORIZON)} y={height - 4}>
        cycles · one cycle is about half a nanosecond
      </text>
    </svg>
  );
}

// Drawing: the 132 SMs, wave by wave, and the utilization sawtooth.

const COLS = 12;
const TILE_W = 44;
const TILE_H = 19;
const GAP = 3;
const SM_X0 = (640 - (COLS * (TILE_W + GAP) - GAP)) / 2;
const SM_Y0 = 24;
const SM_ROWS = Math.ceil(SMS / COLS);

function SmGrid({ s, wave, progress }: { s: WaveState; wave: number; progress: number }) {
  const w = waves(s.blocks, s.perSM);
  const inWave = wave < w.waves - 1 ? w.slots : w.lastWave;
  const stripY = SM_Y0 + SM_ROWS * (TILE_H + GAP) + 18;
  const stripX0 = SM_X0;
  const stripW = COLS * (TILE_W + GAP) - GAP;
  const segW = stripW / Math.max(1, w.waves);
  const busySMs = Math.min(SMS, inWave);
  const label = `${fmt(s.blocks)} blocks at ${s.perSM} per SM: ${w.waves} wave${w.waves === 1 ? '' : 's'} of up to ${fmt(w.slots)} blocks. Showing wave ${wave + 1}, which keeps ${busySMs} of the 132 SMs busy with ${fmt(inWave)} blocks. Utilization over the run: ${pct(w.utilization, 1)}.`;
  return (
    <svg className="diagram" viewBox={`0 0 640 ${stripY + 44}`} role="img" aria-label={label}>
      <text className="ax" x={SM_X0} y={14}>
        The A-class’s 132 SMs, each with room for {s.perSM} block{s.perSM === 1 ? '' : 's'}
      </text>
      <text x={SM_X0 + stripW} y={14} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: TEXT.ink }}>
        wave {wave + 1} of {w.waves}
      </text>
      {Array.from({ length: SMS }, (_, sm) => {
        const x = SM_X0 + (sm % COLS) * (TILE_W + GAP);
        const y = SM_Y0 + Math.floor(sm / COLS) * (TILE_H + GAP);
        const slotW = (TILE_W - 2) / s.perSM;
        return (
          <g key={sm}>
            <rect x={x} y={y} width={TILE_W} height={TILE_H} rx={2} fill="#f4f4f1" stroke="#dcdcd7" strokeWidth={1} />
            {Array.from({ length: s.perSM }, (_, slot) => {
              // Blocks are dealt out across the SMs first, then into each SM's next slot.
              const filled = slot * SMS + sm < inWave;
              if (!filled) return null;
              const sx = x + 1 + slot * slotW;
              return (
                <g key={slot}>
                  <rect x={sx + 0.5} y={y + 1} width={Math.max(0.5, slotW - 1)} height={TILE_H - 2} fill={ORANGE} opacity={0.3} />
                  <rect x={sx + 0.5} y={y + 1 + (TILE_H - 2) * (1 - progress)} width={Math.max(0.5, slotW - 1)} height={(TILE_H - 2) * progress} fill={ORANGE} />
                </g>
              );
            })}
          </g>
        );
      })}
      <text className="ax" x={stripX0} y={stripY - 5}>
        Each wave, and how full it is
      </text>
      {Array.from({ length: w.waves }, (_, k) => {
        const n = k < w.waves - 1 ? w.slots : w.lastWave;
        const x = stripX0 + k * segW;
        return (
          <g key={k}>
            <rect x={x + 1} y={stripY} width={Math.max(0.5, segW - 2)} height={14} fill="#f2f2ef" stroke={k === wave ? '#333' : 'none'} strokeWidth={1} />
            <rect x={x + 1} y={stripY} width={Math.max(0.5, (segW - 2) * (n / w.slots))} height={14} fill={ORANGE} opacity={k === wave ? 1 : 0.55} />
          </g>
        );
      })}
      <text className="ax" x={stripX0} y={stripY + 30}>
        {w.waves === 1 ? 'one wave' : `${w.waves} waves; the last holds ${fmt(w.lastWave)} of ${fmt(w.slots)} slots`}
      </text>
    </svg>
  );
}

const UX = scale(1, BLOCKS_MAX, 64, 620);
const UY = scale(0, 1, 118, 22);

function Sawtooth({ s }: { s: WaveState }) {
  const path = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let b = 1; b <= BLOCKS_MAX; b++) {
      xs.push(UX(b));
      ys.push(UY(waves(b, s.perSM).utilization));
    }
    return linePath(xs, ys);
  }, [s.perSM]);
  const u = waves(s.blocks, s.perSM).utilization;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 146"
      role="img"
      aria-label={`Utilization against the number of blocks, at ${s.perSM} block${s.perSM === 1 ? '' : 's'} per SM: it falls each time a new, nearly empty wave starts. At ${fmt(s.blocks)} blocks it is ${pct(u, 1)}.`}
    >
      <text className="ax" x={64} y={12}>
        Utilization over the run, for every grid from 1 to {fmt(BLOCKS_MAX)} blocks
      </text>
      <GridY y={UY} ticks={[0, 0.5, 1]} x0={64} x1={620} format={(v) => pct(v)} baseline={0} />
      <path d={path} fill="none" stroke={ORANGE} strokeWidth={1.6} strokeLinejoin="round" />
      <line className="cur" x1={UX(s.blocks)} x2={UX(s.blocks)} y1={UY(1) - 4} y2={UY(0)} />
      <circle cx={UX(s.blocks)} cy={UY(u)} r={5.5} fill={ORANGE} stroke="#fcfcfb" strokeWidth={2} />
      {[1, 250, 500, 750, 1000].map((b) => (
        <text key={b} className={b === BLOCKS_MAX ? 'ax ax-e' : 'ax ax-m'} x={UX(b)} y={136}>
          {b === BLOCKS_MAX ? `${fmt(b)} blocks` : fmt(b)}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

const DEFAULT_OCC = occupancy(kernelOf(SCHED_DEFAULTS));
const DEFAULT_BUSY = schedulerBusy(SCHED_DEFAULTS);
const HIDE = warpsToHide(SCHED_DEFAULTS.compute);
const MOST_REGS = mostRegistersForTarget();
const AT_MOST_REGS = occupancy(kernelOf({ ...SCHED_DEFAULTS, regs: MOST_REGS }));
const ONE_MORE = occupancy(kernelOf({ ...SCHED_DEFAULTS, regs: MOST_REGS + 1 }));
const AT_32 = occupancy(kernelOf({ ...SCHED_DEFAULTS, regs: 32 }));
const DOUBLE_COMPUTE = issueUtilization(DEFAULT_OCC.warpsPerScheduler, 2 * SCHED_DEFAULTS.compute);
const RESIDENT_THREADS = SMS * SM_LIMITS.maxThreads;
const LANES = SMS * SM_LIMITS.fp32Lanes;
const THREADS_TO_HIDE = HIDE * SM_LIMITS.schedulers * SM_LIMITS.warpSize * SMS;
const LATENCY_NS = (LATENCY / ACCELERATORS.A.clockGHz);
const W133 = waves(133, 1);
/** Warps per scheduler that 90% busy needs at 40 cycles per load: 0.9 × 520 ÷ 40 = 11.7, so 12. */
const WARPS_FOR_TARGET = Math.ceil((BUSY_TARGET * (SCHED_DEFAULTS.compute + LATENCY)) / SCHED_DEFAULTS.compute - 1e-9);
/** Shared memory a block of the next lesson's 128 × 128 matrix tiles needs, KB (64). */
const TILE_SHARED_KB = tileFit(128).sharedKB;
/** At 32 registers, where registers and threads would allow eight blocks, give each block that much shared memory. */
const AT_SHARED = occupancy(kernelOf({ ...SCHED_DEFAULTS, regs: 32, shared: TILE_SHARED_KB }));
const AT_SHARED_REGS_ALLOW = occupancy(kernelOf({ ...SCHED_DEFAULTS, regs: 32 })).blocksPerSM;
/** Blocks of 384 threads at 64 registers: registers for two blocks, and a gap too small for a third. */
const ODD_THREADS = 384;
const AT_ODD = occupancy(kernelOf({ ...SCHED_DEFAULTS, threads: ODD_THREADS }));
const ODD_LEFTOVER = SM_LIMITS.registers - AT_ODD.blocksPerSM * ODD_THREADS * SCHED_DEFAULTS.regs;
/** A grid many waves long: 1,000 blocks at one per SM. */
const W1000 = waves(1000, 1);

export const LESSON_NUMBERS = {
  defaultBlocks: DEFAULT_OCC.blocksPerSM,
  defaultWarps: DEFAULT_OCC.warpsPerSM,
  defaultPerScheduler: DEFAULT_OCC.warpsPerScheduler,
  defaultOccupancy: DEFAULT_OCC.occupancy,
  defaultBusy: DEFAULT_BUSY,
  hide: HIDE,
  mostRegs: MOST_REGS,
  atMostRegsBusy: issueUtilization(AT_MOST_REGS.warpsPerScheduler, SCHED_DEFAULTS.compute),
  oneMoreBusy: issueUtilization(ONE_MORE.warpsPerScheduler, SCHED_DEFAULTS.compute),
  at32Busy: issueUtilization(AT_32.warpsPerScheduler, SCHED_DEFAULTS.compute),
  doubleCompute: DOUBLE_COMPUTE,
  residentThreads: RESIDENT_THREADS,
  lanes: LANES,
  threadsToHide: THREADS_TO_HIDE,
  latencyNs: LATENCY_NS,
  w133: W133.utilization,
  w1000: W1000.utilization,
  w1000Waves: W1000.waves,
  w1000LastWave: W1000.lastWave,
  warpsForTarget: WARPS_FOR_TARGET,
  tileSharedKB: TILE_SHARED_KB,
  sharedBlocks: AT_SHARED.blocksPerSM,
  sharedLimit: AT_SHARED.limit,
  sharedRegsAllow: AT_SHARED_REGS_ALLOW,
  sharedWarps: AT_SHARED.warpsPerSM,
  sharedBusy: issueUtilization(AT_SHARED.warpsPerScheduler, SCHED_DEFAULTS.compute),
  oddBlocks: AT_ODD.blocksPerSM,
  oddWarps: AT_ODD.warpsPerSM,
  oddLeftover: ODD_LEFTOVER,
  oddBusy: issueUtilization(AT_ODD.warpsPerScheduler, SCHED_DEFAULTS.compute),
};

export default function Lesson() {
  const sc = useScenario('scheduler', SCHED_DEFAULTS);
  const st = sc.state;
  const k = kernelOf(st);
  const o = occupancy(k);
  const busy = schedulerBusy(st);
  const warps = o.blocksPerSM > 0 ? Math.round(o.warpsPerScheduler) : 0;
  const regsPerBlock = st.threads * st.regs;
  const solvedA = busySolved(st);

  const limitText: Record<Occupancy['limit'], string> = {
    registers: `each block needs ${fmt(regsPerBlock)} registers, and ${o.blocksPerSM === 1 ? 'only one block fits' : `only ${o.blocksPerSM} blocks fit`} in the SM’s ${fmt(SM_LIMITS.registers)}`,
    'shared memory': `each block needs ${fmt(st.shared)} KB of shared memory, and ${o.blocksPerSM === 1 ? 'only one block fits' : `only ${o.blocksPerSM} blocks fit`} in the SM’s ${SM_LIMITS.sharedKB} KB`,
    threads: `${o.blocksPerSM} blocks of ${fmt(st.threads)} threads fill the SM’s ${fmt(SM_LIMITS.maxThreads)} thread slots`,
    blocks: `the SM holds at most ${SM_LIMITS.maxBlocks} blocks`,
  };
  const caption =
    o.blocksPerSM === 0
      ? `A block of ${fmt(st.threads)} threads at ${st.regs} registers each needs ${fmt(regsPerBlock)} registers, more than one SM has: this kernel can’t run at all.`
      : `${o.blocksPerSM} block${o.blocksPerSM === 1 ? '' : 's'} per SM — ${limitText[o.limit]} — so each scheduler has ${warps} warp${warps === 1 ? '' : 's'} to choose from. ${
          busy >= 1 - 1e-9 ? 'That is enough to cover every wait: the scheduler never idles.' : `It sits idle ${pct(1 - busy, 1)} of the time, with every warp waiting on memory.`
        }`;

  const wv = useScenario('waves', WAVE_DEFAULTS);
  const ws = wv.state;
  const w = waves(ws.blocks, ws.perSM);
  const play = usePlay(true);
  const [t, setT] = useState(0);
  useAnimationFrame((dt) => setT((x) => (x + dt * 0.8 >= w.waves + 0.6 ? 0 : x + dt * 0.8)), play.playing);
  const tt = t % (w.waves + 0.6);
  const wave = Math.min(w.waves - 1, Math.floor(tt));
  const progress = tt >= w.waves ? 1 : tt - Math.floor(tt);
  const solvedB = noIdleSolved(ws);
  const statusB =
    ws.perSM !== NO_IDLE_PER_SM
      ? `Set the SMs to hold ${NO_IDLE_PER_SM} blocks each first; now they hold ${ws.perSM}.`
      : ws.blocks <= NO_IDLE_MIN
        ? `${fmt(ws.blocks)} blocks is too few: the grid needs more than ${NO_IDLE_MIN}.`
        : `${fmt(ws.blocks)} blocks take ${w.waves} waves, and the last fills ${fmt(w.lastWave)} of its ${fmt(w.slots)} slots. The arrow keys move the slider one block at a time.`;

  return (
    <LessonPage id="compute/2.2">
      <P>
        <a href={lessonHref('compute/2.1')}>Lesson 2.1</a> found that the A-class 80 GB only pulls ahead of the CPU when there are tens of thousands of
        independent pieces of work for its {fmt(LANES)} lanes. This lesson looks at how a program actually hands that work over, and at what keeps the lanes
        busy once it has. The answer turns out to need far more threads than there are lanes.
      </P>
      <P>
        A program for a GPU is written as a <b>kernel</b>: one function that every thread runs, each on its own share of the data. Launching it creates a grid
        of thread <b>blocks</b>, every block a group of up to 1,024 threads that can share data with one another. The GPU deals the blocks out to its 132
        streaming multiprocessors (SMs), and an SM keeps a block until all its threads finish. Inside the SM, threads are handled 32 at a time, as a{' '}
        <K tone="orange">warp</K>: the 32 threads of a warp execute the same instruction together, each on its own numbers. Each SM has four schedulers, and
        every cycle each scheduler picks one of its warps and issues that warp’s next instruction to 32 of the SM’s 128 lanes.
      </P>
      <P>
        The trouble is memory. Arithmetic on numbers already in a thread’s <K tone="violet">registers</K> takes a few cycles, but a number fetched from the
        GPU’s main memory takes about {LATENCY} cycles to arrive: about {fmt(LATENCY_NS)} nanoseconds, a long time for a chip that ticks twice a nanosecond.
        This wait is the memory’s <K tone="teal">latency</K>. A CPU core fights latency with large caches and by running ahead to find other instructions that
        don’t depend on the missing number. A GPU’s answer is cruder and very effective: while one warp waits, the scheduler issues instructions from another.
        Switching costs nothing, because every resident warp keeps its own registers on the chip. The catch is that an SM can only hold as many warps as its
        resources allow: 2,048 threads (64 warps), {fmt(SM_LIMITS.registers)} registers, {SM_LIMITS.sharedKB} KB of shared memory and {SM_LIMITS.maxBlocks}{' '}
        blocks. How a kernel is written decides how much of each its blocks need.
      </P>
      <P>
        In the next demonstration, the bars show how one SM’s resources are shared out among the blocks of a kernel, one cell per block, and the timeline
        follows one of the SM’s four schedulers and the warps it can choose from. Each warp does some arithmetic (orange), then loads a number from memory and
        waits {LATENCY} cycles for it (pale violet). The top row shows when the scheduler is issuing an instruction and when it has nothing to issue. Change
        the kernel’s block size, the registers and shared memory each thread and block need, and how much arithmetic a warp does between loads:
      </P>

      <Figure name="GPU Thread Simulator" scenario={sc}>
        <ResourceBars k={k} o={o} />
        <Gantt warps={warps} compute={st.compute} busy={busy} />
        <Legend
          items={[
            { label: 'arithmetic: the warp is issuing', color: ORANGE },
            { label: 'waiting for memory', color: WAIT },
            { label: 'scheduler idle', color: IDLE },
          ]}
        />
        <Readouts
          items={[
            { label: 'occupancy', value: pct(o.occupancy) },
            { label: 'cycles issuing', value: pct(busy, 1), tone: 'orange' },
          ]}
        />
        <Slider label="Threads per block" value={st.threads} min={128} max={1024} step={128} onChange={(v) => sc.set({ threads: v })} display={fmt(st.threads)} />
        <Slider label="Registers per thread" tone="violet" value={st.regs} min={16} max={255} onChange={(v) => sc.set({ regs: v })} display={fmt(st.regs)} />
        <Slider label="Shared memory per block" tone="violet" value={st.shared} min={0} max={228} step={4} onChange={(v) => sc.set({ shared: v })} display={`${st.shared} KB`} />
        <Slider
          label="Arithmetic per load"
          tone="orange"
          value={st.compute}
          min={10}
          max={200}
          step={10}
          onChange={(v) => sc.set({ compute: v })}
          display={`${st.compute} cycles`}
        />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        The kernel starts with 256 threads per block and 64 registers per thread, so each block needs {fmt(SCHED_DEFAULTS.threads * SCHED_DEFAULTS.regs)}{' '}
        registers, and only {DEFAULT_OCC.blocksPerSM} blocks fit in the SM’s {fmt(SM_LIMITS.registers)}, though its thread slots would take twice as many.
        That is {DEFAULT_OCC.warpsPerSM} warps, {DEFAULT_OCC.warpsPerScheduler} per scheduler. The share of the SM’s 64 warp slots in use is called its{' '}
        <b>occupancy</b>, here {pct(DEFAULT_OCC.occupancy)}. Follow the timeline: the scheduler runs warp after warp through 40 cycles of arithmetic, until every
        one of them is waiting on memory, and then it idles until the first load returns. Eight warps supply 320 cycles of arithmetic for every 520-cycle round
        trip, so the scheduler issues on {pct(DEFAULT_BUSY, 1)} of cycles and sits idle for the rest.
      </P>
      <P>
        To cover the wait completely, the scheduler needs enough warps that their arithmetic fills a whole round trip: {fmt(SCHED_DEFAULTS.compute + LATENCY)}{' '}
        cycles ÷ {SCHED_DEFAULTS.compute} cycles = 13 warps. Across the GPU, that is about {fmt(Math.round(THREADS_TO_HIDE / 1000) * 1000)} threads resident at
        once — thirteen times as many as it has lanes. The GPU doesn’t just tolerate a huge number of threads; it needs them.
      </P>

      <Challenge
        id="a"
        question={`Predict first: with ${SCHED_DEFAULTS.compute} cycles of arithmetic in every ${fmt(SCHED_DEFAULTS.compute + LATENCY)}-cycle round trip, how many warps must a scheduler have to issue on ${pct(BUSY_TARGET)} of cycles? Then, keeping ${SCHED_DEFAULTS.compute} cycles of arithmetic per load, change the kernel so it has them.`}
        solved={solvedA}
        status={
          st.compute !== SCHED_DEFAULTS.compute
            ? `Put the arithmetic per load back to 40 cycles: the challenge is to fix the kernel’s resources. Right now the scheduler issues on ${pct(busy, 1)} of cycles.`
            : o.blocksPerSM === 0
              ? 'Not even one block fits on the SM. Lower the registers or the shared memory.'
              : `Right now the scheduler issues on ${pct(busy, 1)} of cycles, with ${warps} warps to choose from.`
        }
        success={`Solved. ${pct(BUSY_TARGET)} of ${fmt(SCHED_DEFAULTS.compute + LATENCY)} cycles is ${fmt(BUSY_TARGET * (SCHED_DEFAULTS.compute + LATENCY))}, or ${fmt((BUSY_TARGET * (SCHED_DEFAULTS.compute + LATENCY)) / SCHED_DEFAULTS.compute, 1)} warps’ worth of ${SCHED_DEFAULTS.compute}-cycle bursts, so it takes ${WARPS_FOR_TARGET} warps per scheduler: ${4 * WARPS_FOR_TARGET} warps per SM. With blocks of 256 threads, that takes no more than ${MOST_REGS} registers per thread: 48 warps × 32 threads × ${MOST_REGS} = ${fmt(48 * 32 * MOST_REGS)} registers still fits in ${fmt(
          SM_LIMITS.registers,
        )}. With ${MOST_REGS + 1}, only ${ONE_MORE.warpsPerScheduler} warps per scheduler fit, and it issues on ${pct(
          issueUtilization(ONE_MORE.warpsPerScheduler, SCHED_DEFAULTS.compute),
          1,
        )} of cycles.`}
      />

      <H2>Occupancy isn’t everything</H2>
      <P>
        Registers are usually what runs out. Each SM’s register file holds {fmt(SM_LIMITS.registers)} registers of 4 bytes — 256 KB, more than its shared
        memory — and every resident thread needs its own. At {MOST_REGS} registers per thread the scheduler still has 12 warps and issues on{' '}
        {pct(LESSON_NUMBERS.atMostRegsBusy, 1)} of cycles; at {MOST_REGS + 1}, a whole block no longer fits, and it drops to{' '}
        {pct(LESSON_NUMBERS.oneMoreBusy, 1)}. At 32 registers the SM is full, with 16 warps per scheduler, and the scheduler never idles. But registers aren’t
        wasted on purpose. A thread that is denied the registers it wants must keep some of its numbers in memory instead and fetch them again, which adds the
        very waits that occupancy was meant to hide. Compilers and programmers trade one against the other.
      </P>
      <P>
        Each resource is handed out a whole block at a time, so shared memory and the size of a block can set the limit too. The matrix kernels of the next
        lesson give each block {TILE_SHARED_KB} KB of shared memory for its tiles. At 32 registers, where the registers would allow {AT_SHARED_REGS_ALLOW} blocks,
        set the shared memory to {TILE_SHARED_KB} KB: only {AT_SHARED.blocksPerSM} blocks fit in the SM’s {SM_LIMITS.sharedKB} KB, and the scheduler drops to{' '}
        {AT_SHARED.warpsPerScheduler} warps, issuing on {pct(LESSON_NUMBERS.sharedBusy, 1)} of cycles. Now set the shared memory back to 0 and the registers to{' '}
        {SCHED_DEFAULTS.regs}, and try blocks of {ODD_THREADS} threads. Two of them take {fmt(AT_ODD.blocksPerSM * ODD_THREADS * SCHED_DEFAULTS.regs)} registers,
        and the {fmt(ODD_LEFTOVER)} left over are too few for a third, so a quarter of the register file sits idle and the SM holds {AT_ODD.warpsPerSM} warps
        instead of {DEFAULT_OCC.warpsPerSM}. Blocks of 128, 256, 512 or 1,024 threads divide the register file evenly; {ODD_THREADS} doesn’t.
      </P>
      <P>
        There is a second way out, which the arithmetic-per-load slider controls: more arithmetic per load. Return to blocks of {SCHED_DEFAULTS.threads} threads and
        double the arithmetic to {2 * SCHED_DEFAULTS.compute} cycles. The same {DEFAULT_OCC.warpsPerScheduler} warps now supply enough work to cover each wait, and the
        scheduler {DOUBLE_COMPUTE >= 1 - 1e-9 ? 'never idles' : `issues on ${pct(DOUBLE_COMPUTE, 1)} of cycles`}. A kernel that does more with every number it fetches needs fewer warps to stay busy. That
        ratio, arithmetic per byte fetched, is about to become the most important number in this chapter.
      </P>
      <P>
        One more way to waste lanes has nothing to do with memory. The 32 threads of a warp share one instruction stream, so if some take one branch of an{' '}
        <i>if</i> and the rest take the other, the warp runs both branches one after the other, with the threads that didn’t take each branch masked off.
        Code in which neighboring threads do the same thing — as they do in the matrix arithmetic of neural networks — avoids this almost entirely.
      </P>

      <H2>Waves</H2>
      <P>
        Keeping each SM busy is half the problem; the other half is keeping all 132 of them busy. The GPU deals blocks out to every SM until each holds as many
        as it can, then hands a new block to each SM as one of its blocks finishes. If all the blocks take about the same time, they run in{' '}
        <b>waves</b>: one round of blocks across the whole GPU, then another. In the next demonstration, set the number of blocks in the grid and how many fit
        on each SM, which in a real kernel comes from the resources of the first demonstration:
      </P>

      <Figure name="GPU Thread Simulator · waves" scenario={wv} play={play}>
        <SmGrid s={ws} wave={wave} progress={progress} />
        <Sawtooth s={ws} />
        <Readouts items={[{ label: 'utilization over the run', value: pct(w.utilization, 1), tone: 'orange' }]} />
        <Slider label="Blocks in the grid" value={ws.blocks} min={1} max={BLOCKS_MAX} onChange={(v) => wv.set({ blocks: v })} display={fmt(ws.blocks)} />
        <Slider label="Blocks per SM" tone="violet" value={ws.perSM} min={1} max={8} onChange={(v) => wv.set({ perSM: v })} display={fmt(ws.perSM)} />
      </Figure>

      <P>
        With one block per SM, 132 blocks make exactly one wave. The grid starts at 133, and that one extra block needs a second wave of its own: for that whole
        wave a single SM works while the other 131 wait, and the run takes twice as long as 132 blocks would. Utilization over the run is{' '}
        {pct(W133.utilization, 1)}. This is the <b>tail effect</b>, and the sawtooth in the lower chart traces it for every grid size: utilization drops each time
        a new, nearly empty wave begins, and climbs back as that wave fills.
      </P>
      <P>
        The teeth shrink as the grid grows. With 1,000 blocks at one per SM, the GPU runs {W1000.waves} waves of up to {fmt(W1000.slots)} blocks, and the last
        wave holds {fmt(W1000.lastWave)}: {pct(W1000.utilization, 1)} utilization. However empty its last wave, a grid of n waves keeps the GPU busy at least
        (n − 1)/n of the time — here at least {W1000.waves - 1}/{W1000.waves}, or {pct((W1000.waves - 1) / W1000.waves, 1)} — because every wave before the last
        is full. So large jobs waste little to the tail, while small ones — a kernel run on a small batch of data, for instance — can lose half the GPU to it. Programmers often size
        their grids, or split work differently, to match the number of SMs.
      </P>

      <Challenge
        id="b"
        question={`Predict first: with ${NO_IDLE_PER_SM} blocks fitting on each of the ${SMS} SMs, how many blocks make one full wave, and which grids of more than ${NO_IDLE_MIN} blocks leave no slot idle in any wave? Then choose one.`}
        solved={solvedB}
        status={statusB}
        success={`Solved. Two blocks on each of 132 SMs make ${fmt(2 * SMS)} slots, so any multiple of ${fmt(2 * SMS)} — ${fmt(4 * SMS)} or ${fmt(
          6 * SMS,
        )} here — fills every wave exactly. ${fmt(ws.blocks)} blocks run in ${w.waves} full waves.`}
      />

      <P>
        Put the two demonstrations together and the same GPU can be kept fully busy, or idle much of the time, by the same work written differently: with{' '}
        {MOST_REGS + 1} registers per thread instead of {MOST_REGS}, or with a grid one block too large. Nothing about the hardware changes. An hour of an
        A-class GPU is the same hour whichever kernel runs on it, so how much useful work that hour holds depends in part on the software — a point that will
        matter when we come to price GPU-hours in Chapter 5.
      </P>
      <P>
        The <FigRef to="GPU Thread Simulator">first demonstration</FigRef> also pointed to the lever that matters most: the warps that keep a GPU busiest
        are those doing the most arithmetic for every number they fetch. No operation does more of that than multiplying matrices. The A-class has special
        units for exactly that, and in <a href={lessonHref('compute/2.3')}>the next lesson</a> we’ll see what it takes to keep them fed.
      </P>
    </LessonPage>
  );
}
