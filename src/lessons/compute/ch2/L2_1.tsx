import { useEffect, useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
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
  Slider,
  fmt,
  lessonHref,
  linePath,
  mix,
  scale,
  si,
  useScenario,
} from '../../../framework';
import { CPU, GPU, amdahl, crossoverItems, peakTflops, runTask, type Processor, type RunResult, type Task } from '../../../engines/compute/parallel';
import { ACCELERATORS, GPU_SERIAL_GOPS, HOST_CPU } from '../../../model/compute/hardware';

// ---------------------------------------------------------------------------
// The first demonstration's controls. Work items and concurrency are log sliders; the arithmetic
// per item steps through 1–2–5 values so the challenge's 2,000 FLOPs can be set exactly.

export const ITEMS = { min: 0, max: 9, step: 0.05 };
export const CONCURRENCY = { min: 0, max: 9, step: 0.05 };
export const FLOPS_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
export const SERIAL_PCT = { min: 0, max: 5, step: 0.1 };
/** Bytes copied per item when the data starts in the CPU's memory: 4 in, 4 back out. */
export const BYTES_PER_ITEM = 8;
/** The challenge's arithmetic per item. */
export const CHALLENGE_FLOPS = 2000;

export interface LabState {
  /** log10 of the number of work items. */
  logItems: number;
  /** Index into FLOPS_STEPS. */
  flopsIdx: number;
  /** log10 of the items the program works on at once. */
  logConcurrency: number;
  /** Serial share, percent. */
  serialPct: number;
  /** The data starts in the CPU's memory and must be copied to the GPU and back. */
  copy: boolean;
}

export const LAB_DEFAULTS: LabState = { logItems: 6, flopsIdx: FLOPS_STEPS.indexOf(2000), logConcurrency: 9, serialPct: 0, copy: false };

/** Items for a slider position. */
export function itemsAt(logItems: number): number {
  return Math.max(1, Math.round(10 ** logItems));
}

/** The task a state describes. */
export function taskOf(s: LabState): Task {
  return {
    items: itemsAt(s.logItems),
    flopsPerItem: FLOPS_STEPS[s.flopsIdx],
    serialShare: s.serialPct / 100,
    bytesPerItem: s.copy ? BYTES_PER_ITEM : 0,
    threads: itemsAt(s.logConcurrency),
  };
}

/** The GPU strictly beats the CPU on this state's task. */
export function gpuWins(s: LabState): boolean {
  const t = taskOf(s);
  return runTask(GPU, t).totalS < runTask(CPU, t).totalS;
}

/**
 * The first challenge: with 2,000 FLOPs per item, no serial work, no copy and one item in flight
 * per item (concurrency at least the item count), the GPU wins here but not one slider step lower.
 */
export function crossoverSolved(s: LabState): boolean {
  if (FLOPS_STEPS[s.flopsIdx] !== CHALLENGE_FLOPS || s.serialPct !== 0 || s.copy) return false;
  if (itemsAt(s.logConcurrency) < itemsAt(s.logItems)) return false;
  if (!gpuWins(s)) return false;
  const lower = Math.round((s.logItems - ITEMS.step) * 100) / 100;
  if (lower < ITEMS.min) return true;
  return !gpuWins({ ...s, logItems: lower, logConcurrency: Math.max(s.logConcurrency, lower) });
}

// ---------------------------------------------------------------------------
// Amdahl's law, on a log slider for the serial share.

export const SHARE_LOG = { min: -4, max: -1, step: 0.05 };
export const AMDAHL_DEFAULTS = { logShare: -2 };
/** The second challenge's target speedup on the GPU's lanes. */
export const TARGET_SPEEDUP = 1000;
export const GPU_LANES = GPU.lanes;
export const CPU_LANES = CPU.lanes;

/** The second challenge: the largest serial share on the slider at which 16,896 lanes still reach a 1,000× speedup. */
export function amdahlSolved(logShare: number): boolean {
  const next = Math.round((logShare + SHARE_LOG.step) * 100) / 100;
  return amdahl(10 ** logShare, GPU_LANES) >= TARGET_SPEEDUP && (next > SHARE_LOG.max || amdahl(10 ** next, GPU_LANES) < TARGET_SPEEDUP);
}

/** The reader's prediction for the second challenge: with 1 − s taken as 1, s ≤ 1/1,000 − 1/16,896 (≈ 0.094%). */
export const PREDICTED_SHARE = 1 / TARGET_SPEEDUP - 1 / GPU_LANES;

/** At serial shares this small or smaller, the GPU's speedup is hidden until the second challenge is solved. */
export const HIDE_AT_OR_BELOW = 0.002;

/** Whether the chart hides the GPU's speedup: near the challenge's answer, until it has been solved. */
export function gpuSpeedupHidden(logShare: number, revealed: boolean): boolean {
  return !revealed && 10 ** logShare <= HIDE_AT_OR_BELOW * (1 + 1e-9);
}

// ---------------------------------------------------------------------------
// Drawing.

const dur = (s: number) => si(s, 's', 3);
const IDLE = '#efefec';
const SEG = {
  launch: '#b9b9b4',
  copy: GRAPHIC.violet,
  serial: '#555555',
  parallel: GRAPHIC.orange,
};

/** Share of each tile's lanes kept busy through the parallel part, tiles filled in order. */
export function tileFills(p: Processor, t: Task, r: RunResult, tiles: number): number[] {
  const parallelItems = t.items * (1 - t.serialShare);
  const threads = t.threads && t.threads > 0 ? t.threads : Infinity;
  const active = parallelItems > 0 ? Math.max(1, Math.min(p.lanes, threads, Math.ceil(parallelItems))) : 0;
  const waveShare = r.waves > 0 && active > 0 ? parallelItems / (r.waves * active) : 0;
  const perTile = p.lanes / tiles;
  return Array.from({ length: tiles }, (_, i) => Math.max(0, Math.min(1, active / perTile - i)) * waveShare);
}

function Tiles({ x, y, cols, rows, size, gap, fills }: { x: number; y: number; cols: number; rows: number; size: number; gap: number; fills: number[] }) {
  return (
    <g>
      {fills.slice(0, cols * rows).map((f, i) => (
        <rect
          key={i}
          x={x + (i % cols) * (size + gap)}
          y={y + Math.floor(i / cols) * (size + gap)}
          width={size}
          height={size}
          rx={2}
          fill={f > 0 ? mix(IDLE, GRAPHIC.orange, 0.25 + 0.75 * f) : IDLE}
        />
      ))}
    </g>
  );
}

function TimeBar({ y, label, r, maxS }: { y: number; label: string; r: RunResult; maxS: number }) {
  const x0 = 64;
  const width = 470;
  const k = maxS > 0 ? width / maxS : 0;
  const parts: Array<[keyof typeof SEG, number]> = [
    ['launch', r.overheadS],
    ['copy', r.copyS],
    ['serial', r.serialS],
    ['parallel', r.parallelS],
  ];
  let x = x0;
  return (
    <g>
      <text className="lab" x={x0 - 8} y={y + 13} textAnchor="end">
        {label}
      </text>
      <rect x={x0} y={y} width={width} height={18} fill="none" />
      {parts.map(([key, s]) => {
        const w = s * k;
        const rect = <rect key={key} x={x} y={y} width={Math.max(0, w)} height={18} fill={SEG[key]} />;
        x += w;
        return rect;
      })}
      <text className="lab" x={Math.min(x + 6, x0 + width + 6)} y={y + 13}>
        {dur(r.totalS)}
      </text>
    </g>
  );
}

function LabFigure({ task, cpu, gpu }: { task: Task; cpu: RunResult; gpu: RunResult }) {
  const cpuFills = tileFills(CPU, task, cpu, HOST_CPU.cores);
  const gpuFills = tileFills(GPU, task, gpu, ACCELERATORS.A.sms);
  const maxS = Math.max(cpu.totalS, gpu.totalS);
  const label = `${fmt(task.items)} items of ${fmt(task.flopsPerItem)} FLOPs each. The CPU takes ${dur(cpu.totalS)} with ${fmt(cpu.utilization * 100, 1)}% of its lanes busy; the GPU takes ${dur(gpu.totalS)} with ${fmt(gpu.utilization * 100, 1)}% busy${gpu.copyS > 0 ? `, ${dur(gpu.copyS)} of it copying data` : ''}.`;
  return (
    <svg className="diagram" viewBox="0 0 640 352" role="img" aria-label={label}>
      <text className="lab" x={20} y={18}>
        Host CPU
      </text>
      <text className="ax" x={20} y={34}>
        64 cores × 32 lanes, {fmt(HOST_CPU.clockGHz, 1)} GHz
      </text>
      <Tiles x={20} y={46} cols={8} rows={8} size={23} gap={3} fills={cpuFills} />
      <text className="lab" x={300} y={18}>
        A-class GPU
      </text>
      <text className="ax" x={300} y={34}>
        132 SMs × 128 lanes, {fmt(ACCELERATORS.A.clockGHz, 2)} GHz
      </text>
      <Tiles x={300} y={46} cols={12} rows={11} size={16} gap={2.6} fills={gpuFills} />
      <text className="ax" x={20} y={274}>
        Time to finish
      </text>
      <TimeBar y={282} label="CPU" r={cpu} maxS={maxS} />
      <TimeBar y={310} label="GPU" r={gpu} maxS={maxS} />
    </svg>
  );
}

// Amdahl chart: log–log, lanes 1–100,000 on x, speedup 1–100,000 on y.
const AX = scale(0, 5, 70, 610);
const AY = scale(0, 5, 232, 26);
const LOG_LANES = Array.from({ length: 101 }, (_, i) => i * 0.05);

function AmdahlChart({ share, hideGpu }: { share: number; hideGpu: boolean }) {
  const curve = linePath(
    LOG_LANES.map(AX),
    LOG_LANES.map((l) => AY(Math.log10(amdahl(share, 10 ** l)))),
  );
  const cap = Math.log10(1 / share);
  const marks = [
    { lanes: CPU_LANES, name: 'CPU' },
    { lanes: GPU_LANES, name: 'GPU' },
  ];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 262"
      role="img"
      aria-label={`Speedup against number of lanes with ${fmt(share * 100, share < 0.001 ? 3 : 2)}% of the work serial. ${fmt(CPU_LANES)} lanes give ${fmt(amdahl(share, CPU_LANES))}×; ${
        hideGpu ? `the speedup on ${fmt(GPU_LANES)} lanes is hidden until the challenge is solved` : `${fmt(GPU_LANES)} lanes give ${fmt(amdahl(share, GPU_LANES))}×`
      }; no number of lanes can pass ${fmt(1 / share)}×.`}
    >
      <text className="ax" x={70} y={14}>
        Speedup over one lane
      </text>
      {[0, 1, 2, 3, 4, 5].map((d) => (
        <g key={d}>
          <line className={d === 0 ? 'base' : 'gl'} x1={70} x2={610} y1={AY(d)} y2={AY(d)} />
          <text className="ax ax-e" x={64} y={AY(d) + 4}>
            {fmt(10 ** d)}×
          </text>
          <text className="ax ax-m" x={AX(d)} y={250}>
            {fmt(10 ** d)}
          </text>
        </g>
      ))}
      <text className="ax ax-e" x={610} y={234 - 8}>
        lanes
      </text>
      <path d={linePath([AX(0), AX(5)], [AY(0), AY(5)])} fill="none" stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="5 5" />
      <text className="ax" x={AX(3.55)} y={AY(3.75)} transform={`rotate(-21 ${AX(3.55)} ${AY(3.75)})`}>
        no serial work
      </text>
      {cap <= 5 && (
        <g>
          <line x1={70} x2={610} y1={AY(cap)} y2={AY(cap)} stroke="#333" strokeWidth={1.2} strokeDasharray="3 4" />
          <text className="ax" x={74} y={AY(cap) - 5}>
            limit: {fmt(1 / share)}×
          </text>
        </g>
      )}
      <path d={curve} fill="none" stroke={GRAPHIC.orange} strokeWidth={2.5} strokeLinejoin="round" />
      {marks.map((m) => {
        const x = AX(Math.log10(m.lanes));
        const s = amdahl(share, m.lanes);
        const y = AY(Math.log10(s));
        return (
          <g key={m.name}>
            <line className="cur" x1={x} x2={x} y1={AY(0)} y2={y} />
            <circle cx={x} cy={y} r={5.5} fill={GRAPHIC.orange} stroke="#fcfcfb" strokeWidth={2} />
            <text className="lab" x={x + (m.name === 'GPU' ? 8 : -8)} y={y + 18} textAnchor={m.name === 'GPU' ? 'start' : 'end'}>
              {m.name}: {m.name === 'GPU' && hideGpu ? 'predict it' : `${fmt(s)}×`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

function sharePct(share: number): string {
  const pct = share * 100;
  return `${fmt(pct, pct < 0.1 ? 3 : pct < 1 ? 2 : 1)}%`;
}

export default function Lesson() {
  const s1 = useScenario<LabState>('lab', LAB_DEFAULTS);
  const st = s1.state;
  const task = taskOf(st);
  const cpu = runTask(CPU, task);
  const gpu = runTask(GPU, task);
  const solvedA = crossoverSolved(st);
  const conc = itemsAt(st.logConcurrency);

  const s2 = useScenario('amdahl', AMDAHL_DEFAULTS);
  const share = 10 ** s2.state.logShare;
  const solvedB = amdahlSolved(s2.state.logShare);
  // Once the second challenge is solved, the GPU's speedup stays visible.
  const [revealedB, setRevealedB] = useState(false);
  useEffect(() => {
    if (solvedB) setRevealedB(true);
  }, [solvedB]);
  const hideGpu = gpuSpeedupHidden(s2.state.logShare, revealedB || solvedB);
  const gpuSpeedup = amdahl(share, GPU_LANES);
  const nextShare = 10 ** (Math.round((s2.state.logShare + SHARE_LOG.step) * 100) / 100);

  // Numbers quoted in the prose, all from the engine.
  const q = useMemo(() => {
    const base = { flopsPerItem: 2000, serialShare: 0, bytesPerItem: 0 };
    const run = (t: Task) => ({ c: runTask(CPU, t), g: runTask(GPU, t) });
    const answer = itemsAt(4.6);
    return {
      million: run({ ...base, items: 1e6 }),
      hundredM: run({ ...base, items: 1e8 }),
      hundred: run({ ...base, items: 100 }),
      single: run({ ...base, items: 1e6, threads: 1 }),
      serial: run({ ...base, items: 1e6, serialShare: 0.01 }),
      copied: run({ ...base, items: 1e6, bytesPerItem: BYTES_PER_ITEM }),
      copied20k: run({ ...base, items: 1e6, flopsPerItem: 20000, bytesPerItem: BYTES_PER_ITEM }),
      crossover: crossoverItems(base),
      answer,
      atAnswer: run({ ...base, items: answer }),
      cpuFlopsPerByte: (peakTflops(CPU) * 1e12) / (GPU.copyGBs * 1e9),
    };
  }, []);
  const cpuRounds = Math.ceil(q.crossover / CPU_LANES);
  const gpuRounds = Math.ceil(q.crossover / GPU_LANES);

  // Live caption for the first demonstration.
  const ratio = cpu.totalS / gpu.totalS;
  let caption: string;
  if (gpu.totalS < cpu.totalS) {
    caption = `The GPU finishes ${fmt(ratio, ratio < 10 ? 1 : 0)}× sooner, with ${fmt(gpu.utilization * 100, 1)}% of its lanes busy during the parallel part.`;
  } else {
    const slow = 1 / ratio;
    const biggest = Math.max(gpu.overheadS, gpu.copyS, gpu.serialS, gpu.parallelS);
    const why =
      biggest === gpu.serialS && gpu.serialS > 0
        ? `the serial part alone takes the GPU ${dur(gpu.serialS)} on one thread, against ${dur(cpu.serialS)} on one CPU core`
        : biggest === gpu.copyS && gpu.copyS > 0
          ? `copying the data takes ${dur(gpu.copyS)}, ${gpu.copyS >= cpu.totalS ? 'longer than' : 'most of'} the CPU’s whole job`
          : biggest === gpu.overheadS
            ? `the GPU spends ${dur(gpu.overheadS)} just starting the work, and only ${fmt(gpu.utilization * 100, 2)}% of its lanes are busy`
            : `only ${fmt(Math.min(task.items, conc))} ${Math.min(task.items, conc) === 1 ? 'item is' : 'items are'} in flight at once, so the GPU’s width goes unused and the CPU’s faster clock wins`;
    caption = `The CPU finishes ${fmt(slow, slow < 10 ? 1 : 0)}× sooner: ${why}.`;
  }

  const statusA = (() => {
    if (FLOPS_STEPS[st.flopsIdx] !== CHALLENGE_FLOPS) return `Set the arithmetic to 2,000 FLOPs per item (it’s ${fmt(FLOPS_STEPS[st.flopsIdx])}).`;
    if (st.serialPct !== 0) return 'Set the serial share to 0%.';
    if (st.copy) return 'Start with the data already in the GPU’s memory: untick the copy.';
    if (conc < task.items) return 'Let the program work on every item at once: raise the concurrency to at least the number of items.';
    return gpuWins(st)
      ? `At ${fmt(task.items)} items the GPU wins, ${dur(gpu.totalS)} to ${dur(cpu.totalS)}. Does it still win with fewer?`
      : `At ${fmt(task.items)} items the CPU wins, ${dur(cpu.totalS)} to ${dur(gpu.totalS)}. Try more items.`;
  })();

  return (
    <LessonPage id="compute/2.1">
      <P>
        The previous lesson ended on a trade. A lower voltage makes every operation cheaper and every circuit slower, so the way to more arithmetic for each watt is
        many slow circuits rather than one fast one. Every GPU server in this course holds both kinds of processor, side by side: host CPUs, which run the
        operating system and the program, and beside them eight GPUs. This lesson sets one of each against the other.
      </P>
      <P>
        Our host CPU, a fictional 64-core part, has 64 cores ticking at {fmt(HOST_CPU.clockGHz, 1)} GHz. Each core is built to run one stream of instructions as
        fast as it can: it guesses which way the program will branch, works ahead on later instructions while earlier ones wait, and keeps large caches close by so
        that it rarely waits for memory. Each core also has wide vector units — two of them, each doing 16 multiply-adds at once — so the chip has{' '}
        {fmt(CPU_LANES)} <K tone="orange">lanes</K> of 32-bit floating-point arithmetic, for a peak of {fmt(peakTflops(CPU), 1)} TFLOPS.
      </P>
      <P>
        The A-class 80 GB, the workhorse accelerator we met in <a href={lessonHref('compute/1.4')}>Lessons 1.4</a> and{' '}
        <a href={lessonHref('compute/1.5')}>1.5</a>, spends its transistors the other way. The {ACCELERATORS.A.sms} units of 128 lanes that Lesson 1.5 counted
        are called streaming multiprocessors, or SMs — the GPU’s equivalent of cores — and their {fmt(GPU_LANES)} lanes tick at{' '}
        <K c="frequency">{fmt(ACCELERATORS.A.clockGHz, 2)} GHz</K>, for {fmt(peakTflops(GPU))} TFLOPS. That is {fmt(peakTflops(GPU) / peakTflops(CPU), 1)} times
        the CPU’s peak, from lanes that are each slower. Each thread is slower too. On ordinary serial code — one step after another, with branches to follow — a
        single GPU thread manages about {fmt(GPU_SERIAL_GOPS, 1)} billion operations a second. One CPU core manages about {HOST_CPU.serialGops} billion, because
        its guessing and working ahead keep several independent instructions in progress at once; a GPU thread does neither, and is{' '}
        {fmt(HOST_CPU.serialGops / GPU_SERIAL_GOPS)} times slower. Which design wins depends entirely on the work.
      </P>
      <P>
        In the next demonstration, both processors run the same task: some number of independent work items, each needing the same arithmetic — brightening every
        pixel of an image, say, or scoring every product in a catalog. The tiles are the CPU’s 64 cores and the GPU’s {ACCELERATORS.A.sms} SMs, shaded by how
        busy their lanes are, and the bars are each processor’s time from start to finish. Set the number of items and the arithmetic in each, how many items the
        program works on at once, the share of the work that must run on a single thread, and whether the data starts in the CPU’s memory and has to be copied
        across:
      </P>

      <Figure name="Parallel Computing Lab" scenario={s1}>
        <LabFigure task={task} cpu={cpu} gpu={gpu} />
        <Legend
          items={[
            { label: 'Starting the work', color: SEG.launch },
            { label: 'Copying data', color: SEG.copy },
            { label: 'Serial part', color: SEG.serial },
            { label: 'Parallel part', color: SEG.parallel },
          ]}
        />
        <Readouts
          items={[
            { label: 'CPU lanes busy', value: `${fmt(cpu.utilization * 100, 1)}%`, tone: 'orange' },
            { label: 'GPU lanes busy', value: `${fmt(gpu.utilization * 100, 1)}%`, tone: 'orange' },
          ]}
        />
        <Slider
          label="Work items"
          value={st.logItems}
          min={ITEMS.min}
          max={ITEMS.max}
          step={ITEMS.step}
          onChange={(v) => s1.set({ logItems: Math.round(v * 100) / 100 })}
          display={fmt(task.items)}
        />
        <Slider
          label="Arithmetic per item"
          tone="orange"
          value={st.flopsIdx}
          min={0}
          max={FLOPS_STEPS.length - 1}
          onChange={(v) => s1.set({ flopsIdx: v })}
          display={`${fmt(FLOPS_STEPS[st.flopsIdx])} FLOPs`}
        />
        <Slider
          label="Items in flight at once"
          value={st.logConcurrency}
          min={CONCURRENCY.min}
          max={CONCURRENCY.max}
          step={CONCURRENCY.step}
          onChange={(v) => s1.set({ logConcurrency: Math.round(v * 100) / 100 })}
          display={conc >= task.items ? 'all of them' : fmt(conc)}
        />
        <Slider
          label="Serial share"
          value={st.serialPct}
          min={SERIAL_PCT.min}
          max={SERIAL_PCT.max}
          step={SERIAL_PCT.step}
          onChange={(v) => s1.set({ serialPct: Math.round(v * 10) / 10 })}
          display={`${fmt(st.serialPct, 1)}%`}
        />
        <Checkbox label={`Data starts in the CPU’s memory (${BYTES_PER_ITEM} bytes per item copied over a ${GPU.copyGBs} GB/s link)`} checked={st.copy} onChange={(v) => s1.set({ copy: v })} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        It starts with a million items of 2,000 FLOPs each, the data already in the GPU’s memory. The GPU finishes in {dur(q.million.g.totalS)} and the CPU in{' '}
        {dur(q.million.c.totalS)}: {fmt(q.million.c.totalS / q.million.g.totalS, 1)} times longer. Push the items to 100 million and the gap grows to{' '}
        {fmt(q.hundredM.c.totalS / q.hundredM.g.totalS, 1)} times — the ratio of the two peaks — because a task that big keeps every lane of both chips busy, and
        the fixed costs fade into it.
      </P>
      <P>
        Now shrink the task. With 100 items the CPU wins, {dur(q.hundred.c.totalS)} to {dur(q.hundred.g.totalS)}, for two reasons. The GPU needs about{' '}
        {GPU.launchUs} µs just to start the work and learn that it has finished, which is longer than the CPU’s whole job. And 100 items keep 100 of its{' '}
        {fmt(GPU_LANES)} lanes busy: {fmt(q.hundred.g.utilization * 100, 2)}% of them. However parallel a small job is, a GPU is the wrong tool for it.
      </P>

      <Challenge
        id="a"
        question="With 2,000 FLOPs per item, no serial work, the data already on the GPU and every item in flight at once, find — to the slider’s resolution — the fewest work items for which the GPU finishes first."
        solved={solvedA}
        status={statusA}
        success={`Solved. ${fmt(q.answer)} items is the first setting where the GPU wins, ${dur(q.atAnswer.g.totalS)} to ${dur(q.atAnswer.c.totalS)}. The exact crossover is ${fmt(q.crossover)} items, one past ${cpuRounds - 1} full rounds of the CPU’s ${fmt(CPU_LANES)} lanes: there the CPU needs a ${cpuRounds}th round, while the GPU’s ${fmt(GPU_LANES)} lanes get through every item in ${gpuRounds}. Below it, the GPU’s extra ${GPU.launchUs - CPU.launchUs} µs of start-up outweighs its width.`}
      />

      <H2>Work that won’t spread out</H2>
      <P>
        Width helps only if the work is spread across it. Lower the items in flight to 1 and each processor works through the million items one at a time on a
        single lane. The CPU’s faster clock wins: {dur(q.single.c.totalS)} to {dur(q.single.g.totalS)}. Real programs are rarely written that badly, but many
        have parts that can’t be split up at all and must run on a single thread, one step after another. Give the task a serial share of 1% and the CPU finishes in{' '}
        {dur(q.serial.c.totalS)}, while the GPU takes {dur(q.serial.g.totalS)}, {fmt(q.serial.g.totalS / q.serial.c.totalS)} times longer: its serial thread is{' '}
        {fmt(HOST_CPU.serialGops / GPU_SERIAL_GOPS)} times slower, and that 1% now dominates. In practice, a program runs its serial parts on the CPU and sends only
        the parallel parts to the GPU. That division of labor is why the two sit together in every server.
      </P>
      <P>
        Now set the serial share back to 0% and tick the copy box. Each item’s {BYTES_PER_ITEM} bytes — 4 in, 4 back out — cross the link between the two
        processors at <K tone="violet">{GPU.copyGBs} GB/s</K>, and for a million items that takes {dur(q.copied.g.copyS)}, nearly as long as the CPU’s entire
        job. The GPU now loses, {dur(q.copied.g.totalS)} to {dur(q.copied.c.totalS)}. A rule of thumb says when a copy can pay: in the time the link carries one
        byte, the CPU can do {fmt(q.cpuFlopsPerByte)} FLOPs of arithmetic, so each byte sent to the GPU must bring more arithmetic than that just for the copy to
        take less time than doing the work at home. This task brings {fmt(CHALLENGE_FLOPS)} ÷ {BYTES_PER_ITEM} = {fmt(CHALLENGE_FLOPS / BYTES_PER_ITEM)} FLOPs per
        byte, barely over the line, so the copy alone is a little shorter than the CPU’s job. What tips the result is the GPU’s own time on top of it:{' '}
        {dur(q.copied.g.parallelS)} of arithmetic and {GPU.launchUs} µs to start the work. Raise the arithmetic to 20,000 FLOPs per item, or{' '}
        {fmt(20000 / BYTES_PER_ITEM)} per byte, and the GPU is {fmt(q.copied20k.c.totalS / q.copied20k.g.totalS, 1)} times faster again. Arithmetic per byte moved
        will return in <a href={lessonHref('compute/2.3')}>Lessons 2.3</a> and <a href={lessonHref('compute/2.4')}>2.4</a> as perhaps the most important number
        about any GPU workload.
      </P>

      <H2>Amdahl’s law</H2>
      <P>
        A serial share puts a ceiling on any speedup. If a share s of a job can’t be split, then however many lanes do the rest, the job can never run more than
        1/s times faster than on one lane — with 1% serial, never more than 100 times. This is <b>Amdahl’s law</b>, after the computer architect Gene Amdahl, who
        made the argument in 1967:
      </P>
      <Eq label="Speedup on p lanes equals one over the serial share plus the parallel share divided by p">
        <span>speedup</span>
        <Op>=</Op>
        <Frac top="1" bottom={<span>s + (1 − s) / p</span>} />
      </Eq>
      <P>
        In the next demonstration, the curve is the speedup over a single lane for the serial share you choose, with the CPU’s {fmt(CPU_LANES)} lanes and the GPU’s{' '}
        {fmt(GPU_LANES)} marked. To isolate the effect, every lane here runs at the same speed. Change the serial share:
      </P>

      <Figure name="Parallel Computing Lab · Amdahl’s law" scenario={s2}>
        <AmdahlChart share={share} hideGpu={hideGpu} />
        <Slider
          label="Serial share"
          value={s2.state.logShare}
          min={SHARE_LOG.min}
          max={SHARE_LOG.max}
          step={SHARE_LOG.step}
          onChange={(v) => s2.set({ logShare: Math.round(v * 100) / 100 })}
          display={sharePct(share)}
        />
      </Figure>

      <P>
        At 1%, {fmt(CPU_LANES)} lanes give a speedup of {fmt(amdahl(0.01, CPU_LANES))} and {fmt(GPU_LANES)} lanes give {fmt(amdahl(0.01, GPU_LANES))}: eight times
        the hardware for {fmt((amdahl(0.01, GPU_LANES) / amdahl(0.01, CPU_LANES) - 1) * 100)}% more speed. The curve bends away from the dashed line long before it
        reaches the GPU, and everything past the bend is lanes waiting on the serial part. To make use of a GPU’s width, a program has to be almost perfectly
        parallel, and the equation says just how nearly.
      </P>

      <Challenge
        id="b"
        question={`Predict first: for the GPU’s ${fmt(GPU_LANES)} lanes to reach a speedup of ${fmt(TARGET_SPEEDUP)}, the bottom of the fraction, s + (1 − s)/${fmt(GPU_LANES)}, must be no more than 1/${fmt(TARGET_SPEEDUP)}. Taking 1 − s as 1, what is the largest serial share s that allows? Then set the slider to the largest serial share at which the GPU still reaches ${fmt(TARGET_SPEEDUP)}× — near the answer, the chart hides the GPU’s speedup until you find it.`}
        solved={solvedB}
        status={
          gpuSpeedup >= TARGET_SPEEDUP
            ? `At ${sharePct(share)} serial, the GPU’s lanes clear ${fmt(TARGET_SPEEDUP)}× — and so would a slightly larger serial share.`
            : `At ${sharePct(share)} serial, the GPU’s lanes fall short of ${fmt(TARGET_SPEEDUP)}×.`
        }
        success={`Solved. 1/${fmt(TARGET_SPEEDUP)} − 1/${fmt(GPU_LANES)} ≈ ${fmt(PREDICTED_SHARE * 100, 3)}%, and the largest setting on the slider below that is ${sharePct(share)}, where the GPU’s lanes give ${fmt(gpuSpeedup)}×. At ${sharePct(nextShare)} — exactly one part in a thousand — they give only ${fmt(amdahl(nextShare, GPU_LANES))}×, because the parallel part’s own 1/${fmt(GPU_LANES)} uses up part of the budget. With this many lanes, a serial share of less than one part in a thousand already sets the limit.`}
      />

      <H2>Work that suits a GPU</H2>
      <P>
        A serial share under one part in a thousand is a demanding standard, and most software doesn’t meet it: an operating system, a web server or a database spends much of its time on long,
        branching chains of decisions, and belongs on the CPU. The arithmetic of neural networks does meet it. As Chapter 3 will show, almost all of it is the multiplication
        of large matrices — millions of multiply-adds that don’t depend on one another — and the A-class has dedicated matrix units for exactly that. At the 16-bit
        BF16 precision of <a href={lessonHref('compute/1.4')}>Lesson 1.4</a>, they reach {fmt(ACCELERATORS.A.bf16Tflops)} trillion operations a second, against the{' '}
        {fmt(peakTflops(GPU))} TFLOPS of the ordinary 32-bit lanes we’ve used here.
      </P>
      <P>
        Already the economics follow from the physics. An hour of the GPU is worth a great deal to work that keeps its lanes full and its data close by, and very
        little to work that doesn’t — the same hour, the same chip, and a several-fold difference in what it produces. The three settings that sank the GPU in{' '}
        <FigRef to="Parallel Computing Lab">the first demonstration</FigRef> — too few items, a serial chain, data that had to travel — will each come back at
        larger scale, in how work is batched, how GPUs are linked and where the data sits, and each changes what an hour of compute is worth.
      </P>
      <P>
        Handing the GPU enough items is only the start, though. In the next lesson we look inside it: at how it organizes its {fmt(GPU_LANES)} lanes into threads,
        warps and blocks, and at what keeps them waiting even when the work is perfectly parallel.
      </P>
    </LessonPage>
  );
}
