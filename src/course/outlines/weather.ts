// The weather derivatives course outline: chapters, lessons and the sandbox each lesson introduces.
// Lesson ids are "weather/<chapter>.<lesson>"; lessons live at src/lessons/weather/ch<N>/L<N>_<M>.tsx.

import { chapter, type ChapterMeta, type CourseOutline } from '../outline';
import type { Tone } from '../../framework/tokens';

const ch = (n: number, title: string, blurb: string, tone: Tone, lessons: Array<[string, string]>) =>
  chapter('weather', n, title, blurb, tone, lessons);

const chapters: ChapterMeta[] = [
  ch(1, 'Atmospheric physics', 'Why does weather happen?', 'blue', [
    ['Earth’s energy balance', 'Planet Energy Model'],
    ['Air temperature, pressure, and density', 'Air Parcel Simulator'],
    ['Water vapor and phase changes', 'Humidity Lab'],
    ['Atmospheric stability and convection', 'Convection Simulator'],
    ['Pressure gradients and rotation', 'Wind Field Explorer'],
  ]),
  ch(2, 'Weather systems & climate', 'How do local physical effects combine into large-scale weather patterns?', 'blue', [
    ['Global atmospheric circulation', 'Global Circulation Simulator'],
    ['Fronts and air masses', 'Weather Front Lab'],
    ['Storms and precipitation', 'Storm Formation Simulator'],
    ['Oceans and climate variability', 'Ocean-Atmosphere Model'],
    ['Seasonal and geographic weather', 'Climate Geography Explorer'],
  ]),
  ch(3, 'Weather measurement & forecasting', 'How can we predict a chaotic physical system?', 'teal', [
    ['Measuring the atmosphere', 'Virtual Weather Station'],
    ['Remote sensing', 'Radar and Satellite Explorer'],
    ['Numerical weather prediction', 'Mini Weather Engine'],
    ['Chaos and forecast uncertainty', 'Initial Condition Laboratory'],
    ['Ensemble forecasting', 'Weather Ensemble Simulator'],
  ]),
  ch(4, 'Weather’s economic consequences', 'Where does weather uncertainty create financial risk or opportunity?', 'orange', [
    ['Heating and cooling demand', 'Degree Day Simulator'],
    ['Gas and electricity prices', 'Weather-Energy Model'],
    ['Agriculture and crop yields', 'Weather-to-Yield Simulator'],
    ['Renewable energy production', 'Wind and Solar Output Lab'],
    ['Commercial weather exposure', 'Weather Risk Calculator'],
  ]),
  ch(5, 'Weather markets & trading strategies', 'How are probabilistic weather outcomes priced, transferred, and traded?', 'violet', [
    ['Weather indices and settlement', 'Weather Contract Builder'],
    ['Futures, swaps, and options', 'Weather Derivative Pricer'],
    ['Market-implied versus forecast probabilities', 'Forecast Edge Explorer'],
    ['Cross-market strategies', 'Weather-Energy Trading Lab'],
    ['Backtesting and hedge effectiveness', 'Weather Strategy Backtester'],
  ]),
  ch(6, 'Capstone: build a weather trading system', 'From a model atmosphere to a priced, tested book of weather contracts.', 'ink', [
    ['Construct a regional weather model', 'Weather World Builder'],
    ['Forecast future conditions', 'Forecasting Competition'],
    ['Translate forecasts into economic outcomes', 'Weather Exposure Engine'],
    ['Price and select contracts', 'Weather Trading Desk'],
    ['Evaluate performance', 'Weather Portfolio Challenge'],
  ]),
];

export const WEATHER: CourseOutline = {
  slug: 'weather',
  title: 'Atmospheric Physics & Weather Derivatives',
  short: 'Weather derivatives',
  lede:
    'A mild winter costs a gas utility the gas it never sells; a cold snap costs anyone caught buying energy at short notice. This course builds the atmosphere from energy balance up, learns to forecast it with honest uncertainty, and prices contracts that pay on what it does.',
  chapters,
};
