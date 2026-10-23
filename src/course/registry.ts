// The course outline: chapters, lessons and the sandbox each lesson introduces.
// Lesson components live at src/lessons/ch<N>/L<N>_<M>.tsx and are loaded on demand.

import type { ComponentType } from 'react';
import type { Tone } from '../framework/tokens';

export interface LessonMeta {
  /** "4.4" */
  id: string;
  chapter: number;
  title: string;
  sandbox: string;
}

export interface ChapterMeta {
  n: number;
  title: string;
  blurb: string;
  tone: Tone;
  lessons: LessonMeta[];
}

function ch(n: number, title: string, blurb: string, tone: Tone, lessons: Array<[string, string]>): ChapterMeta {
  return {
    n,
    title,
    blurb,
    tone,
    lessons: lessons.map(([t, sandbox], i) => ({ id: `${n}.${i + 1}`, chapter: n, title: t, sandbox })),
  };
}

export const CHAPTERS: ChapterMeta[] = [
  ch(1, 'Electricity Fundamentals', 'Charge, fields and wires: the physics every later model is built on.', 'blue', [
    ['Voltage, current, resistance, and power', 'Circuit Builder'],
    ['AC vs. DC and three-phase electricity', 'Waveform Explorer'],
    ['Electromagnetism and generation', 'Generator Simulator'],
    ['Transformers and voltage conversion', 'Transformer Lab'],
    ['Electrical losses and efficiency', 'Transmission Loss Simulator'],
  ]),
  ch(2, 'Building an Electrical Grid', 'From power plant to wall socket, and how power chooses its path.', 'blue', [
    ['Power plants and generators', 'Generation Portfolio Builder'],
    ['Transmission and distribution networks', 'Grid Constructor'],
    ['Substations, transformers, and loads', 'Substation Designer'],
    ['Grid topology and power flow', 'Power Flow Simulator'],
    ['Transmission capacity and congestion', 'Congestion Playground'],
    ['Grid reliability and failure scenarios', 'Grid Failure Simulator'],
  ]),
  ch(3, 'Operating the Grid', 'Matching supply to demand every second, with less and less of the supply under anyone’s control.', 'teal', [
    ['Supply-demand balancing', 'Grid Balancing Game'],
    ['Frequency, inertia, and stability', 'Frequency Simulator'],
    ['Dispatchable vs. intermittent generation', 'Generation Scheduler'],
    ['Batteries and energy storage', 'Battery Simulator'],
    ['Demand response and load shifting', 'Load Shifting Lab'],
    ['Grid operations and control systems', 'Control Room Simulator'],
  ]),
  ch(4, 'Electricity Market Fundamentals', 'Turning a physical balancing problem into an auction.', 'orange', [
    ['Why electricity markets exist', 'Central Planner vs. Market'],
    ['Market participants and grid operators', 'Market Role Simulator'],
    ['Generator bids and merit-order dispatch', 'Bid Stack Builder'],
    ['Marginal pricing and market clearing', 'Market Clearing Simulator'],
    ['Day-ahead vs. real-time markets', 'Two-Settlement Simulator'],
    ['Ancillary services and capacity markets', 'Grid Services Auction'],
  ]),
  ch(5, 'Locational Pricing & Congestion', 'Why the same megawatt-hour costs different amounts in different places.', 'orange', [
    ['Economic dispatch across a network', 'Network Dispatch Optimizer'],
    ['Transmission constraints and congestion', 'Congestion Simulator'],
    ['Locational marginal pricing (LMP)', 'Nodal Price Explorer'],
    ['Congestion rents and transmission rights', 'Congestion Rights Simulator'],
    ['Scarcity pricing and negative prices', 'Extreme Price Laboratory'],
    ['Security-constrained optimal power flow', 'Grid Optimization Challenge'],
  ]),
  ch(6, 'Energy Trading & Market Strategies', 'Making, and losing, money on the gaps between prices.', 'violet', [
    ['Physical vs. financial electricity trading', 'Trading Desk Simulator'],
    ['Day-ahead / real-time price spreads', 'Virtual Trading Backtester'],
    ['Congestion and basis trading', 'Nodal Basis Trader'],
    ['Battery arbitrage and optimal scheduling', 'Battery Trading Optimizer'],
    ['Hedging, forwards, and virtual positions', 'Power Portfolio Simulator'],
    ['Backtesting and risk management', 'Strategy Laboratory'],
  ]),
  ch(7, 'Distributed Energy & Virtual Power Plants', 'Thousands of rooftops and home batteries acting as one power plant.', 'teal', [
    ['Rooftop solar and residential batteries', 'Home Energy Simulator'],
    ['Distributed energy resource aggregation', 'DER Aggregator'],
    ['Virtual power plant architecture', 'VPP Control Center'],
    ['Nodal deployment and congestion relief', 'Battery Siting Optimizer'],
    ['Fleet dispatch and optimization', 'Fleet Scheduling Simulator'],
    ['Wholesale market participation and regulation', 'Market Access Simulator'],
  ]),
  ch(8, 'Capstone: Build & Operate a Power Grid', 'Everything at once: design, run and profit from a grid of your own.', 'ink', [
    ['Design a grid', 'Grid Builder'],
    ['Simulate 24-hour demand', 'Demand Scenario Engine'],
    ['Implement dispatch and nodal pricing', 'Electricity Market Engine'],
    ['Add renewable energy and batteries', 'Energy Transition Simulator'],
    ['Operate a virtual power plant', 'VPP Operator'],
    ['Optimize profitability and reliability', 'Grid Strategy Challenge'],
  ]),
];

export const LESSONS: LessonMeta[] = CHAPTERS.flatMap((c) => c.lessons);

export function getLesson(id: string): LessonMeta | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function getChapter(n: number): ChapterMeta | undefined {
  return CHAPTERS.find((c) => c.n === n);
}

export function neighbors(id: string): { prev?: LessonMeta; next?: LessonMeta } {
  const i = LESSONS.findIndex((l) => l.id === id);
  return { prev: i > 0 ? LESSONS[i - 1] : undefined, next: i >= 0 && i < LESSONS.length - 1 ? LESSONS[i + 1] : undefined };
}

/** Path of a lesson's component module, relative to this file. */
export function lessonModulePath(id: string): string {
  const [c, m] = id.split('.');
  return `../lessons/ch${c}/L${c}_${m}.tsx`;
}

const modules = import.meta.glob<{ default: ComponentType }>('../lessons/ch*/L*_*.tsx');

/** Loader for a lesson's component, or undefined if the lesson hasn't been written. */
export function lessonLoader(id: string): (() => Promise<{ default: ComponentType }>) | undefined {
  return modules[lessonModulePath(id)];
}

export function hasLesson(id: string): boolean {
  return lessonModulePath(id) in modules;
}
