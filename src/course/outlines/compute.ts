// The compute capacity course outline: chapters, lessons and the sandbox each lesson introduces.
// Lesson ids are "compute/<chapter>.<lesson>"; lessons live at src/lessons/compute/ch<N>/L<N>_<M>.tsx.

import { chapter, type ChapterMeta, type CourseOutline } from '../outline';
import type { Tone } from '../../framework/tokens';

const ch = (n: number, title: string, blurb: string, tone: Tone, lessons: Array<[string, string]>) =>
  chapter('compute', n, title, blurb, tone, lessons);

const chapters: ChapterMeta[] = [
  ch(1, 'Semiconductor physics & digital computation', 'How does electricity become computation?', 'blue', [
    ['Semiconductor fundamentals', 'Silicon Physics Explorer'],
    ['Transistors and switches', 'Transistor Simulator'],
    ['Digital logic', 'Logic Gate Builder'],
    ['Memory and data representation', 'Memory Cell Lab'],
    ['Clock speed, power, and heat', 'Processor Energy Simulator'],
  ]),
  ch(2, 'GPU architecture & parallel computing', 'What determines how much useful work a GPU can do?', 'blue', [
    ['CPUs versus GPUs', 'Parallel Computing Lab'],
    ['GPU execution model', 'GPU Thread Simulator'],
    ['Matrix operations', 'Matrix Multiplication Lab'],
    ['Memory bandwidth and hierarchy', 'GPU Memory Simulator'],
    ['Multi-GPU interconnects', 'GPU Cluster Topology'],
  ]),
  ch(3, 'AI workloads & performance', 'Why do different AI workloads need different kinds of compute capacity?', 'teal', [
    ['Neural network computation', 'Neural Network Execution Explorer'],
    ['Inference performance', 'Inference Serving Simulator'],
    ['Model training performance', 'Training Workload Simulator'],
    ['Throughput versus latency', 'Inference Scheduling Lab'],
    ['Workload heterogeneity', 'GPU Compatibility Optimizer'],
  ]),
  ch(4, 'Data centers & compute infrastructure', 'What constrains the physical supply of usable computation?', 'teal', [
    ['Server and rack architecture', 'GPU Rack Builder'],
    ['Electricity supply', 'Data Center Power Model'],
    ['Cooling and thermal management', 'GPU Cooling Lab'],
    ['Cluster networking', 'Data Center Network Simulator'],
    ['Infrastructure economics', 'Compute Facility Planner'],
  ]),
  ch(5, 'Compute markets & price formation', 'How does heterogeneous hardware capacity become an economic resource?', 'orange', [
    ['Units of computation', 'Compute Economics Explorer'],
    ['GPU supply and manufacturing', 'Accelerator Supply Chain'],
    ['Compute demand', 'Compute Demand Forecaster'],
    ['On-demand, reserved, and interruptible pricing', 'Compute Pricing Laboratory'],
    ['Geographic and hardware price differences', 'Compute Marketplace Simulator'],
  ]),
  ch(6, 'Compute allocation & market strategies', 'How can operators and buyers make the most of compute capacity?', 'violet', [
    ['GPU fleet utilization', 'Compute Yield Manager'],
    ['Spot versus reserved capacity', 'Capacity Procurement Optimizer'],
    ['Geographic workload arbitrage', 'Multi-Region Scheduler'],
    ['Compute-energy optimization', 'Power-Aware Scheduler'],
    ['Capacity contracts and risk', 'Compute Contract Desk'],
  ]),
  ch(7, 'Capstone: build & operate a GPU cloud', 'Design, price and run a GPU cloud of your own.', 'ink', [
    ['Design a compute fleet', 'GPU Cloud Builder'],
    ['Generate workload demand', 'Compute Demand Simulator'],
    ['Price compute capacity', 'Compute Market Simulator'],
    ['Optimize scheduling and procurement', 'Compute Operations Center'],
    ['Optimize business profitability', 'GPU Cloud Strategy Challenge'],
  ]),
];

export const COMPUTE: CourseOutline = {
  slug: 'compute',
  title: 'Compute Capacity & GPU Markets',
  short: 'Compute capacity',
  lede:
    'An hour on one GPU is not an hour on another. This course goes from the transistor to the data center to explain why compute is so hard to commoditize, and how its buyers and sellers price, schedule and contract it anyway.',
  chapters,
};
