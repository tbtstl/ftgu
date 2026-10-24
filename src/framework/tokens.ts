// Color tokens shared by prose, controls and figures.
// A concept keeps one tone across the whole course: voltage is always blue, price always green.

export type Tone = 'blue' | 'orange' | 'violet' | 'red' | 'green' | 'teal' | 'gold' | 'gray' | 'ink';

/** Text-safe colors (≥4.5:1 on the page background). Use for words and numbers. */
export const TEXT: Record<Tone, string> = {
  blue: '#2f6fb3',
  orange: '#ad5310',
  violet: '#8e4fa0',
  red: '#c4382f',
  green: '#3f7a1e',
  teal: '#23776e',
  gold: '#8a6500',
  gray: '#5f5f5f',
  ink: '#333333',
};

/** Graphic colors (≥3:1 on the page background). Use for lines, knobs and marks. */
export const GRAPHIC: Record<Tone, string> = {
  blue: '#4590ce',
  orange: '#d0702a',
  violet: '#ab70b6',
  red: '#e75b55',
  green: '#6d9c37',
  teal: '#2a9d90',
  gold: '#c99a1e',
  gray: '#777777',
  ink: '#333333',
};

/** The course's fixed concept → tone mapping. */
export const CONCEPT = {
  voltage: 'blue',
  current: 'orange',
  resistance: 'violet',
  power: 'red',
  energy: 'gold',
  price: 'green',
  frequency: 'teal',
  phase: 'violet',
  demand: 'ink',
  money: 'green',
  loss: 'red',
} as const satisfies Record<string, Tone>;

/** Fill colors for generation technologies; used for stacked areas and supply stacks. */
export const FUEL: Record<string, string> = {
  nuclear: '#b88dc2',
  wind: '#6cc0b8',
  solar: '#f0c75a',
  hydro: '#6f9fd8',
  coal: '#8d7b6a',
  gasCC: '#eb9b66',
  gasCT: '#e8645e',
  oil: '#a8403b',
  battery: '#5f8f3a',
  imports: '#9a9a9a',
  demandResponse: '#7c6fd0',
};

/** Phase colors for three-phase figures (A, B, C). */
export const PHASE = ['#e75b55', '#d3a832', '#4590ce'] as const;

/** Sequential price scale for shading nodes on a map ($/MWh → fill). Light enough for dark text. */
export function priceFill(p: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [-50, [200, 214, 238]],
    [0, [219, 233, 246]],
    [30, [233, 240, 222]],
    [50, [246, 226, 184]],
    [80, [242, 176, 127]],
    [160, [224, 100, 90]],
    [1000, [190, 60, 60]],
  ];
  if (p <= stops[0][0]) return rgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const k = (p - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return rgb(stops[i - 1][1].map((x, j) => x + (stops[i][1][j] - x) * k) as [number, number, number]);
    }
  }
  return rgb(stops[stops.length - 1][1]);
}

/** Mix a hex color toward the page background; amount 0 = background, 1 = the color. */
export function tint(hex: string, amount = 0.3): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((x) => 252 + (x - 252) * amount) as [number, number, number];
  return rgb(c);
}

/** Linear blend between two hex colors. */
export function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ca = [pa >> 16, (pa >> 8) & 255, pa & 255];
  const cb = [pb >> 16, (pb >> 8) & 255, pb & 255];
  const t = Math.max(0, Math.min(1, k));
  return rgb(ca.map((x, i) => x + (cb[i] - x) * t) as [number, number, number]);
}

function rgb(c: [number, number, number]): string {
  return `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
}
