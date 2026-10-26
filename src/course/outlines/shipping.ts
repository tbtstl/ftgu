// The shipping & freight course outline: chapters, lessons and the sandbox each lesson introduces.
// Lesson ids are "shipping/<chapter>.<lesson>"; lessons live at src/lessons/shipping/ch<N>/L<N>_<M>.tsx.

import { chapter, type ChapterMeta, type CourseOutline } from '../outline';
import type { Tone } from '../../framework/tokens';

const ch = (n: number, title: string, blurb: string, tone: Tone, lessons: Array<[string, string]>) =>
  chapter('shipping', n, title, blurb, tone, lessons);

const chapters: ChapterMeta[] = [
  ch(1, 'Ship physics & engineering', 'What determines how much cargo a vessel can carry, and at what cost?', 'blue', [
    ['Buoyancy and displacement', 'Floating Ship Simulator'],
    ['Hull resistance and fluid dynamics', 'Hull Drag Lab'],
    ['Engines and fuel consumption', 'Marine Propulsion Simulator'],
    ['Vessel stability and loading', 'Ship Stability Simulator'],
    ['Waves, weather, and navigation', 'Voyage Physics Lab'],
  ]),
  ch(2, 'Ships, fleets & operating economics', 'How do operators turn ships into commercially useful transportation capacity?', 'teal', [
    ['Vessel classes and capacity', 'Vessel Designer'],
    ['Cargo loading and handling', 'Cargo Loading Planner'],
    ['Speed versus fuel economics', 'Slow Steaming Optimizer'],
    ['Vessel operating costs', 'Ship Economics Calculator'],
    ['Fleet lifecycle and supply', 'Fleet Investment Simulator'],
  ]),
  ch(3, 'Global shipping networks', 'Why can freight capacity be scarce in one region while ships sit idle elsewhere?', 'teal', [
    ['Global maritime routes', 'Shipping Network Map'],
    ['Port infrastructure and queues', 'Port Congestion Lab'],
    ['Maritime chokepoints', 'Canal and Strait Simulator'],
    ['Fleet positioning and ballast voyages', 'Fleet Positioning Simulator'],
    ['Tonne-mile demand', 'Global Trade Flow Model'],
  ]),
  ch(4, 'Freight markets & price formation', 'How does a fleet of mobile assets become a market for transportation?', 'orange', [
    ['Spot freight supply and demand', 'Freight Clearing Engine'],
    ['Voyage versus time charters', 'Charter Contract Explorer'],
    ['Freight benchmarks and indices', 'Freight Index Builder'],
    ['Fleet availability and freight cycles', 'Shipping Cycle Model'],
    ['Forward freight agreements', 'FFA Contract Simulator'],
  ]),
  ch(5, 'Shipping strategies & risk', 'How can an operator or trader profit from changing transportation constraints?', 'violet', [
    ['Freight rate forecasting', 'Freight Fundamentals Model'],
    ['Route and vessel-class spreads', 'Freight Spread Trader'],
    ['Chartering strategies', 'Time Charter Arbitrage Lab'],
    ['Repositioning and optionality', 'Fleet Allocation Optimizer'],
    ['Derivatives, hedging, and backtesting', 'Freight Trading Lab'],
  ]),
  ch(6, 'Capstone: operate a shipping company', 'Can the first five chapters run a shipping company? Buy a fleet, find it cargo, schedule it, and hedge what the market might do to it.', 'ink', [
    ['Design a fleet', 'Shipping Company Builder'],
    ['Build a trade network', 'Global Cargo Simulator'],
    ['Schedule voyages', 'Fleet Operations Desk'],
    ['Forecast freight markets', 'Freight Market Forecast Challenge'],
    ['Optimize profits and hedge risks', 'Shipping Strategy Tournament'],
  ]),
];

export const SHIPPING: CourseOutline = {
  slug: 'shipping',
  title: 'Maritime Shipping & Freight Markets',
  short: 'Shipping & freight',
  lede:
    'A ship is capacity that moves, slowly. Freight rates soar where ships are scarce and collapse where they pile up, and repositioning takes weeks. This course goes from hull physics to the charter and forward freight markets built on it, in a simulated world of real ports, canals and trades.',
  chapters,
};
