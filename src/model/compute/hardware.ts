// The compute course's hardware: three fictional accelerators, the host CPU they sit beside, and
// the 8-GPU servers they're sold in. The specs are realistic for current data-center parts, but
// the names are generic and every price is simulated for teaching.
//
//   L-class 48 GB   an inference card on a PCIe slot: graphics memory, modest bandwidth, no fast links
//   A-class 80 GB   the workhorse training GPU: stacked high-bandwidth memory (HBM), fast 8-GPU links
//   B-class 192 GB  the newest generation: more than twice the arithmetic and memory bandwidth

export type GpuId = 'L' | 'A' | 'B';

export interface Accelerator {
  id: GpuId;
  /** "A-class 80 GB". */
  name: string;
  /** "A-class". */
  short: string;
  /** Memory capacity, GB. */
  memoryGB: number;
  /** "GDDR6", "HBM3"… */
  memoryKind: string;
  /** Memory bandwidth, TB/s. */
  bandwidthTBs: number;
  /** Dense BF16 tensor throughput, TFLOPS (trillion floating-point operations per second). */
  bf16Tflops: number;
  /** Dense FP8 tensor throughput, TFLOPS. */
  fp8Tflops: number;
  /** Ordinary (non-tensor) FP32 throughput, TFLOPS. */
  fp32Tflops: number;
  /** Streaming multiprocessors: the GPU's cores. */
  sms: number;
  /** Boost clock, GHz. */
  clockGHz: number;
  /** On-chip L2 cache, MB. */
  l2MB: number;
  /** L2 bandwidth, TB/s (approximate, for the memory-hierarchy lessons). */
  l2TBs: number;
  /** Board power limit, W. */
  tdpW: number;
  /** GPU-to-GPU bandwidth inside a server, GB/s in each direction. */
  scaleUpGBs: number;
  /** What carries that traffic. */
  scaleUpKind: 'PCIe' | 'GPU links';
  /** Network bandwidth per GPU for traffic between servers, Gb/s. */
  nicGbps: number;
  /** Order of release: 1 oldest. */
  generation: number;
}

export const ACCELERATORS: Record<GpuId, Accelerator> = {
  L: {
    id: 'L',
    name: 'L-class 48 GB',
    short: 'L-class',
    memoryGB: 48,
    memoryKind: 'GDDR6',
    bandwidthTBs: 0.86,
    bf16Tflops: 362,
    fp8Tflops: 724,
    fp32Tflops: 91.6,
    sms: 142,
    clockGHz: 2.52,
    l2MB: 96,
    l2TBs: 3,
    tdpW: 350,
    scaleUpGBs: 32,
    scaleUpKind: 'PCIe',
    nicGbps: 100,
    generation: 1,
  },
  A: {
    id: 'A',
    name: 'A-class 80 GB',
    short: 'A-class',
    memoryGB: 80,
    memoryKind: 'HBM3',
    bandwidthTBs: 3.35,
    bf16Tflops: 989,
    fp8Tflops: 1979,
    fp32Tflops: 67,
    sms: 132,
    clockGHz: 1.98,
    l2MB: 50,
    l2TBs: 7,
    tdpW: 700,
    scaleUpGBs: 450,
    scaleUpKind: 'GPU links',
    nicGbps: 400,
    generation: 2,
  },
  B: {
    id: 'B',
    name: 'B-class 192 GB',
    short: 'B-class',
    memoryGB: 192,
    memoryKind: 'HBM3e',
    bandwidthTBs: 8,
    bf16Tflops: 2250,
    fp8Tflops: 4500,
    fp32Tflops: 80,
    sms: 148,
    clockGHz: 1.96,
    l2MB: 126,
    l2TBs: 16,
    tdpW: 1000,
    scaleUpGBs: 900,
    scaleUpKind: 'GPU links',
    nicGbps: 400,
    generation: 3,
  },
};

export const GPU_IDS: GpuId[] = ['L', 'A', 'B'];
export const GPU_LIST: Accelerator[] = GPU_IDS.map((id) => ACCELERATORS[id]);

/** Chart colors for the three accelerators; always labeled in figures, never color alone. */
export const GPU_COLOR: Record<GpuId, string> = { L: '#c99a1e', A: '#4590ce', B: '#2a9d90' };

/** Ridge point of the roofline: the arithmetic intensity (FLOP per byte) where memory stops limiting, BF16. */
export function ridgePoint(g: Accelerator, precision: 'bf16' | 'fp8' = 'bf16'): number {
  const tf = precision === 'fp8' ? g.fp8Tflops : g.bf16Tflops;
  return tf / g.bandwidthTBs;
}

// ---------------------------------------------------------------------------
// One streaming multiprocessor (SM) of the A-class, for the execution-model lessons.

export const SM_LIMITS = {
  /** Threads that can be resident on one SM at once. */
  maxThreads: 2048,
  /** Thread blocks that can be resident on one SM at once. */
  maxBlocks: 32,
  /** 32-bit registers per SM. */
  registers: 65536,
  /** Shared memory per SM, KB. */
  sharedKB: 228,
  /** Warp schedulers per SM, each issuing one warp instruction per cycle. */
  schedulers: 4,
  /** Threads in a warp, which execute in lockstep. */
  warpSize: 32,
  /** FP32 lanes per SM. */
  fp32Lanes: 128,
  /** Cycles for a load from HBM to return (approximate). */
  memLatencyCycles: 480,
} as const;

// ---------------------------------------------------------------------------
// The host CPU, for comparing a processor built for one fast thread with one built for many.

export const HOST_CPU = {
  name: 'C-class 64-core CPU',
  cores: 64,
  clockGHz: 3.0,
  /** FP32 operations per cycle per core: two 16-lane fused multiply-add units, two operations each. */
  fp32FlopsPerCycle: 64,
  /** Memory bandwidth, GB/s (12 channels of DDR5). */
  bandwidthGBs: 460,
  /** Rate one core runs serial, dependent code, billion operations per second. */
  serialGops: 10,
  tdpW: 360,
} as const;

/** Peak FP32 throughput of the host CPU, TFLOPS. */
export const HOST_CPU_FP32_TFLOPS = (HOST_CPU.cores * HOST_CPU.clockGHz * HOST_CPU.fp32FlopsPerCycle) / 1000;

/** Rate one GPU thread runs serial, dependent code, billion operations per second (one instruction every ~4 cycles). */
export const GPU_SERIAL_GOPS = 0.5;

// ---------------------------------------------------------------------------
// Servers: eight accelerators, two host CPUs, memory, network cards, fans and power supplies.

export type Cooling = 'air' | 'liquid';

export interface ServerSpec {
  gpu: GpuId;
  gpus: number;
  /** Two host CPUs, W. */
  cpuW: number;
  /** Host memory and local storage, W. */
  memW: number;
  /** Network cards and GPU-link switch chips, W. */
  netW: number;
  /** Fans as a share of the electronics' power: air-cooled vs. direct liquid cooling. */
  fanShare: Record<Cooling, number>;
  /** Power-supply efficiency at load (AC in, DC out). */
  psuEfficiency: number;
  /** Rack units the server occupies. */
  heightU: Record<Cooling, number>;
  /** Simulated purchase price of the whole server, $. */
  capex: number;
}

export const SERVERS: Record<GpuId, ServerSpec> = {
  L: { gpu: 'L', gpus: 8, cpuW: 600, memW: 300, netW: 200, fanShare: { air: 0.12, liquid: 0.03 }, psuEfficiency: 0.94, heightU: { air: 4, liquid: 4 }, capex: 95_000 },
  A: { gpu: 'A', gpus: 8, cpuW: 700, memW: 400, netW: 900, fanShare: { air: 0.15, liquid: 0.03 }, psuEfficiency: 0.94, heightU: { air: 8, liquid: 4 }, capex: 280_000 },
  B: { gpu: 'B', gpus: 8, cpuW: 700, memW: 500, netW: 1100, fanShare: { air: 0.15, liquid: 0.03 }, psuEfficiency: 0.94, heightU: { air: 10, liquid: 4 }, capex: 460_000 },
};

/** A server's power at full load, measured at its plug (the "IT load" a data center counts), W. */
export function serverPowerW(gpu: GpuId, cooling: Cooling = 'air'): number {
  const s = SERVERS[gpu];
  const electronics = s.gpus * ACCELERATORS[gpu].tdpW + s.cpuW + s.memW + s.netW;
  return (electronics * (1 + s.fanShare[cooling])) / s.psuEfficiency;
}
