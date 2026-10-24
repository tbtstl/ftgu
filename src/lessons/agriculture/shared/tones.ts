// The agriculture course's color code. A concept keeps one tone in every lesson:
// corn is gold and wheat orange; water is blue, heat red, light violet, growth teal,
// and money green, as everywhere on the site.

import { GRAPHIC, TEXT, type Tone } from '../../../framework';
import type { Crop } from '../../../model/agriculture/region';

export const CROP_TONE: Record<Crop, Tone> = { corn: 'gold', wheat: 'orange' };
export const CROP_LINE: Record<Crop, string> = { corn: GRAPHIC.gold, wheat: GRAPHIC.orange };
export const CROP_TEXT: Record<Crop, string> = { corn: TEXT.gold, wheat: TEXT.orange };
export const CROP_NAME: Record<Crop, string> = { corn: 'Corn', wheat: 'Wheat' };

export const TONE = {
  water: 'blue',
  heat: 'red',
  light: 'violet',
  growth: 'teal',
  nutrient: 'violet',
  price: 'green',
} as const satisfies Record<string, Tone>;

/** Soft fills for areas: water, growth. */
export const FILL = {
  water: '#cfe2f3',
  waterLine: GRAPHIC.blue,
  growth: '#cde8e3',
  growthLine: GRAPHIC.teal,
  stress: 'rgba(231, 91, 85, .12)',
  band: 'rgba(0, 0, 0, .045)',
};
