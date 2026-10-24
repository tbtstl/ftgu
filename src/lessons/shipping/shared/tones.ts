// The shipping course's concept colors. A concept keeps one tone in every lesson: prose terms
// (<K tone=…>), the slider that controls it, its readout and its mark in the figure.

import type { Tone } from '../../../framework';

export const TONE = {
  /** Drafts, depths, distances and other lengths; water. */
  draft: 'blue',
  distance: 'blue',
  /** Weights: displacement, cargo tonnes, deadweight. */
  weight: 'orange',
  cargo: 'orange',
  /** Forces and stability: resistance, righting moments, GM. */
  resistance: 'violet',
  stability: 'violet',
  /** Power and the fuel burned per day. */
  power: 'red',
  fuel: 'red',
  /** Fuel quantities and energy. */
  energy: 'gold',
  /** Speed and time: knots, days. */
  speed: 'teal',
  time: 'teal',
  /** Money: rates, costs, freight, hire. */
  money: 'green',
  rate: 'green',
} as const satisfies Record<string, Tone>;

/** Colors for cargo in the holds. */
export const CARGO_COLOR: Record<string, string> = {
  ore: '#9c6f5e',
  coal: '#5d5a57',
  grain: '#d9b86c',
};
