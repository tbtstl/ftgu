// Standard networks. Coordinates fit a 600 × 400 drawing.

import type { Network } from './types';

/**
 * The smallest grid with locational prices: cheap generation at A, expensive at B,
 * all demand at C, three identical lines. Line A–C is the one that congests.
 */
export const THREE_NODE: Network = {
  nodes: [
    { id: 'A', name: 'A', x: 120, y: 100 },
    { id: 'B', name: 'B', x: 480, y: 100 },
    { id: 'C', name: 'C', x: 300, y: 300 },
  ],
  lines: [
    { id: 'AB', from: 'A', to: 'B', reactance: 1, limit: 1000 },
    { id: 'AC', from: 'A', to: 'C', reactance: 1, limit: 250 },
    { id: 'BC', from: 'B', to: 'C', reactance: 1, limit: 1000 },
  ],
};

/**
 * The course region: six substations joined by eight high-voltage lines.
 * Generation sits mostly in the north and west; most demand is in Metro.
 */
export const REGION: Network = {
  nodes: [
    { id: 'north', name: 'North', x: 130, y: 70 },
    { id: 'east', name: 'East', x: 470, y: 70 },
    { id: 'center', name: 'Central', x: 300, y: 190 },
    { id: 'harbor', name: 'Harbor', x: 80, y: 250 },
    { id: 'west', name: 'West', x: 230, y: 340 },
    { id: 'city', name: 'Metro', x: 510, y: 280 },
  ],
  lines: [
    { id: 'north-center', from: 'north', to: 'center', reactance: 1.0, limit: 500, lengthKm: 140, kV: 345 },
    { id: 'north-east', from: 'north', to: 'east', reactance: 1.2, limit: 300, lengthKm: 170, kV: 230 },
    { id: 'harbor-center', from: 'harbor', to: 'center', reactance: 0.8, limit: 450, lengthKm: 120, kV: 345 },
    { id: 'harbor-west', from: 'harbor', to: 'west', reactance: 0.9, limit: 400, lengthKm: 90, kV: 345 },
    { id: 'west-center', from: 'west', to: 'center', reactance: 1.0, limit: 350, lengthKm: 110, kV: 230 },
    { id: 'center-city', from: 'center', to: 'city', reactance: 0.7, limit: 600, lengthKm: 100, kV: 345 },
    { id: 'east-city', from: 'east', to: 'city', reactance: 1.0, limit: 350, lengthKm: 110, kV: 230 },
    { id: 'west-city', from: 'west', to: 'city', reactance: 1.4, limit: 300, lengthKm: 160, kV: 230 },
  ],
};

/** Share of region demand at each REGION node. */
export const REGION_LOAD_SHARE: Record<string, number> = {
  city: 0.55,
  center: 0.15,
  harbor: 0.1,
  east: 0.1,
  north: 0.05,
  west: 0.05,
};

export function nodeName(net: Network, id: string): string {
  return net.nodes.find((n) => n.id === id)?.name ?? id;
}
