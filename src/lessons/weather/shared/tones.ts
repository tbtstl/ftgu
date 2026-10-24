// The weather course's concept colors. As in the electricity course, a concept keeps one tone from
// the first lesson to the capstone: temperature is always red, money always green. Use them for
// key terms (<K tone={WX.temperature}>), the sliders that set them and the marks that show them.

import type { Tone } from '../../../framework';

export const WX = {
  /** Temperature, and the infrared a warm body emits. */
  temperature: 'red',
  /** Pressure and pressure gradients. */
  pressure: 'blue',
  /** Water vapor, humidity, cloud and precipitation. */
  moisture: 'teal',
  /** Sunlight and energy flows (W/m², joules, J/kg of CAPE); renewable output. */
  energy: 'gold',
  /** Wind and air motion. */
  wind: 'violet',
  /** Air density; later, degree days and other settlement indices. */
  density: 'orange',
  index: 'orange',
  /** Prices, cash flows and P&L. */
  money: 'green',
  /** Forecasts, probabilities and uncertainty. */
  probability: 'blue',
} as const satisfies Record<string, Tone>;
