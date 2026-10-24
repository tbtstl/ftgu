// The natural gas course outline: chapters, lessons and the sandbox each lesson introduces.
// Lesson ids are "gas/<chapter>.<lesson>"; lessons live at src/lessons/gas/ch<N>/L<N>_<M>.tsx.

import { chapter, type ChapterMeta, type CourseOutline } from '../outline';
import type { Tone } from '../../framework/tokens';

const ch = (n: number, title: string, blurb: string, tone: Tone, lessons: Array<[string, string]>) =>
  chapter('gas', n, title, blurb, tone, lessons);

const chapters: ChapterMeta[] = [
  ch(1, 'Gas physics & thermodynamics', 'What physically determines how much gas can move, how much energy it contains, and how it can be stored?', 'blue', [
    ['Gas composition and combustion', 'Molecule Lab'],
    ['Pressure, temperature, and compressibility', 'Gas Piston'],
    ['Flow through pipes', 'Gas Flow Lab'],
    ['Compression and energy consumption', 'Compressor Simulator'],
    ['Gas measurement and energy units', 'Gas Measurement Lab'],
  ]),
  ch(2, 'Natural gas production', 'Where does gas originate, and what constrains its production?', 'teal', [
    ['Reservoir geology', 'Reservoir Explorer'],
    ['Wells and production', 'Gas Well Simulator'],
    ['Production decline', 'Decline Curve Lab'],
    ['Field development', 'Gas Field Builder'],
    ['Processing and treatment', 'Gas Processing Plant'],
  ]),
  ch(3, 'Pipelines, storage & transportation', 'Why can gas become scarce in one place while remaining abundant somewhere else?', 'teal', [
    ['Pipeline network design', 'Pipeline Builder'],
    ['Network flow and capacity', 'Gas Network Solver'],
    ['Linepack', 'Linepack Simulator'],
    ['Underground storage', 'Storage Reservoir'],
    ['LNG and international trade', 'LNG Supply Chain'],
  ]),
  ch(4, 'Gas markets & price formation', 'How are physical constraints translated into prices, contracts, and market institutions?', 'orange', [
    ['Supply and demand', 'Gas Balance Model'],
    ['Trading hubs', 'Hub Price Map'],
    ['Pipeline capacity rights', 'Capacity Auction'],
    ['Seasonal pricing and inventories', 'Seasonal Gas Market'],
    ['Spot, futures, and forwards', 'Gas Forward Curve'],
  ]),
  ch(5, 'Gas economics & cross-market interactions', 'Where do economically meaningful price differences originate?', 'orange', [
    ['Geographic basis', 'Regional Basis Simulator'],
    ['Storage economics', 'Storage Optionality Lab'],
    ['Gas-fired electricity generation', 'Gas-to-Power Model'],
    ['LNG arbitrage', 'Global Gas Trader'],
    ['Scarcity events', 'Winter Supply Crisis'],
  ]),
  ch(6, 'Gas trading, forecasting & risk', 'Can an understanding of these physical systems produce a profitable market strategy?', 'violet', [
    ['Supply and demand forecasting', 'Gas Fundamentals Forecaster'],
    ['Calendar spread strategies', 'Gas Spread Trader'],
    ['Basis and transportation trades', 'Basis Trading Desk'],
    ['Storage and spark spread strategies', 'Physical Arbitrage Optimizer'],
    ['Historical backtesting', 'Gas Strategy Lab'],
  ]),
  ch(7, 'Capstone: operate a natural gas portfolio', 'Everything at once: build a gas system, run its market, and trade it.', 'ink', [
    ['Build the network', 'Gas System Constructor'],
    ['Run a market', 'Regional Gas Market'],
    ['Forecast constraints', 'Gas Forecast Challenge'],
    ['Trade and optimize', 'Gas Portfolio Manager'],
    ['Evaluate performance', 'Gas Trading Tournament'],
  ]),
];

export const GAS: CourseOutline = {
  slug: 'gas',
  title: 'Natural Gas: From Molecules to Markets',
  short: 'Natural gas',
  lede:
    'Gas is cheap in one place and dear in another, cheap in July and dear in January. This course traces those differences back to the molecule, the pipe and the storage field, then trades them.',
  chapters,
};
