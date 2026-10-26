// The agriculture course outline: chapters, lessons and the sandbox each lesson introduces.
// Lesson ids are "agriculture/<chapter>.<lesson>"; lessons live at src/lessons/agriculture/ch<N>/L<N>_<M>.tsx.

import { chapter, type ChapterMeta, type CourseOutline } from '../outline';
import type { Tone } from '../../framework/tokens';

const ch = (n: number, title: string, blurb: string, tone: Tone, lessons: Array<[string, string]>) =>
  chapter('agriculture', n, title, blurb, tone, lessons);

const chapters: ChapterMeta[] = [
  ch(1, 'Plant biology & crop physics', 'How does a plant turn sunlight, water, and nutrients into a harvestable commodity?', 'teal', [
    ['Photosynthesis', 'Photosynthesis Lab'],
    ['Plant growth', 'Crop Lifecycle'],
    ['Soil and nutrients', 'Soil Chemistry Lab'],
    ['Water and evapotranspiration', 'Water Balance Simulator'],
    ['Yield formation', 'Crop Yield Model'],
  ]),
  ch(2, 'Agricultural production', 'What determines how much food a region can economically produce?', 'teal', [
    ['Planting and land allocation', 'Farm Planner'],
    ['Inputs and cultivation', 'Crop Input Optimizer'],
    ['Pests, disease, and crop losses', 'Crop Risk Simulator'],
    ['Harvesting and quality', 'Harvest Timing Lab'],
    ['Farm economics', 'Farm Profit Simulator'],
  ]),
  ch(3, 'Weather, geography & forecasting', 'Why is agricultural supply inherently uncertain?', 'blue', [
    ['Climate and crop suitability', 'Agricultural Geography Map'],
    ['Extreme weather', 'Drought and Frost Lab'],
    ['Satellite crop observations', 'Vegetation Index Explorer'],
    ['Yield forecasting', 'Crop Forecast Model'],
    ['Uncertainty and harvest distributions', 'Harvest Monte Carlo'],
  ]),
  ch(4, 'Storage, logistics & global trade', 'How do agricultural commodities move through space and time?', 'orange', [
    ['Grain quality and grading', 'Grain Quality Lab'],
    ['Drying and storage', 'Grain Silo'],
    ['Grain elevators', 'Grain Elevator Manager'],
    ['Transportation and exports', 'Grain Logistics Network'],
    ['International supply and demand', 'Global Grain Balance'],
  ]),
  ch(5, 'Agricultural markets & trading strategies', 'How do uncertain harvests and storage constraints become tradable prices?', 'violet', [
    ['Cash and futures markets', 'Commodity Market Clearing'],
    ['Seasonal curves and storage economics', 'Crop-Year Price Model'],
    ['Geographic basis', 'Grain Basis Trader'],
    ['Crop forecasting strategies', 'Harvest Surprise Trader'],
    ['Hedging and backtesting', 'Agricultural Strategy Lab'],
  ]),
  ch(6, 'Capstone: operate an agricultural trading business', 'Grow, forecast, store, ship and hedge a season of corn and wheat.', 'ink', [
    ['Build a production region', 'Farm Region Builder'],
    ['Simulate a growing season', 'Season Simulator'],
    ['Forecast the harvest', 'Yield Prediction Challenge'],
    ['Manage physical grain', 'Grain Merchant'],
    ['Trade and evaluate', 'Commodity Trading Desk'],
  ]),
];

export const AGRICULTURE: CourseOutline = {
  slug: 'agriculture',
  title: 'Agriculture: From Photosynthesis to Commodity Futures',
  short: 'Agriculture',
  lede:
    'A corn price is a forecast of a harvest that hasn’t happened yet. This course follows corn and wheat from the leaf to the elevator to the futures pit, and shows how weather and biology become the shape of a price curve.',
  chapters,
};
