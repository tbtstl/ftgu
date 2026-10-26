// The oil & petroleum course outline: chapters, lessons and the sandbox each lesson introduces.
// Lesson ids are "oil/<chapter>.<lesson>"; lessons live at src/lessons/oil/ch<N>/L<N>_<M>.tsx.

import { chapter, type ChapterMeta, type CourseOutline } from '../outline';
import type { Tone } from '../../framework/tokens';

const ch = (n: number, title: string, blurb: string, tone: Tone, lessons: Array<[string, string]>) =>
  chapter('oil', n, title, blurb, tone, lessons);

const chapters: ChapterMeta[] = [
  ch(1, 'Hydrocarbon chemistry & physics', 'What is petroleum, and why do different crude oils and fuels have different values?', 'blue', [
    ['Hydrocarbon molecules', 'Molecule Builder'],
    ['Crude oil composition', 'Crude Composition Explorer'],
    ['Density, viscosity, and quality', 'Crude Properties Lab'],
    ['Boiling and phase separation', 'Phase Equilibrium Explorer'],
    ['Energy content and combustion', 'Fuel Energy Lab'],
  ]),
  ch(2, 'Extraction & oil production', 'How does oil reach the surface, and what determines its production economics?', 'teal', [
    ['Reservoir geology', 'Oil Reservoir Explorer'],
    ['Flow through reservoirs', 'Reservoir Flow Simulator'],
    ['Drilling and completion', 'Well Designer'],
    ['Reservoir depletion', 'Production Decline Lab'],
    ['Oil field economics', 'Oil Field Planner'],
  ]),
  ch(3, 'Petroleum refining', 'How can the same barrel of crude produce several products with different values?', 'teal', [
    ['Fractional distillation', 'Distillation Tower'],
    ['Catalytic cracking and conversion', 'Cracking Simulator'],
    ['Hydrotreating and upgrading', 'Refinery Upgrading Lab'],
    ['Product blending', 'Fuel Blending Optimizer'],
    ['Refinery economics', 'Refinery LP'],
  ]),
  ch(4, 'Transportation, storage & physical arbitrage', 'Why does location matter when oil is relatively easy to store and move?', 'teal', [
    ['Pipelines and pumps', 'Oil Pipeline Simulator'],
    ['Tankers and global routes', 'Tanker Voyage Planner'],
    ['Storage and inventories', 'Oil Storage Terminal'],
    ['Global oil flows', 'Petroleum Network Map'],
    ['Physical price differentials', 'Crude Arbitrage Lab'],
  ]),
  ch(5, 'Oil markets & price formation', 'How do physical supply, inventories, and refinery demand set prices?', 'orange', [
    ['Global oil balances', 'Petroleum Balance Sheet'],
    ['Crude benchmarks and differentials', 'WTI-Brent Price Explorer'],
    ['Refined product markets', 'Product Market Model'],
    ['Futures curves and storage', 'Oil Futures Curve'],
    ['Supply disruptions and price shocks', 'Oil Shock Simulator'],
  ]),
  ch(6, 'Petroleum trading & risk', 'Which financial strategies emerge from oil production, transformation, and storage?', 'violet', [
    ['Calendar spreads and inventories', 'Oil Time-Spread Trader'],
    ['Benchmark and quality spreads', 'Crude Basis Trader'],
    ['Crack spread strategies', 'Refining Spread Trader'],
    ['Physical refining hedges', 'Refinery Hedge Designer'],
    ['Backtesting and portfolio risk', 'Oil Strategy Laboratory'],
  ]),
  ch(7, 'Capstone: operate an integrated petroleum business', 'Produce, refine, move and hedge oil as one business.', 'ink', [
    ['Develop production', 'Oil Production Portfolio'],
    ['Design refinery operations', 'Refinery Builder'],
    ['Construct logistics', 'Petroleum Supply Chain'],
    ['Forecast market fundamentals', 'Oil Forecasting Desk'],
    ['Optimize and hedge', 'Integrated Oil Trader'],
  ]),
];

export const OIL: CourseOutline = {
  slug: 'oil',
  title: 'Oil & Petroleum: From Hydrocarbons to Crack Spreads',
  short: 'Oil & petroleum',
  lede:
    'Almost no one burns crude oil as it is. A refinery splits each barrel into gasoline, diesel, jet fuel and more, each with its own market. This course starts with the molecules and ends with the spreads that tie those markets together, and a business that lives on them.',
  chapters,
};
