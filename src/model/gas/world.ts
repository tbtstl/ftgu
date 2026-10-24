// The natural gas course's fictional region, used from Chapter 1 to the capstone. Two producing
// basins in the west, a trading hub in the middle, a cold northern city and a coastal port with
// an LNG export terminal, joined by six pipelines, with a salt-cavern storage field at the hub
// and a depleted-reservoir field near the city. Sizes and costs are illustrative, chosen to be in
// a realistic range rather than to match any real system.

import { psia } from '../../engines/gas/properties';

export type GasNodeId = 'ridgeback' | 'sandhill' | 'calder' | 'metro' | 'bayport';

export interface GasNode {
  id: GasNodeId;
  name: string;
  /** What the place is, in a few words. */
  kind: string;
  /** Position on the course's 600 × 400 map. */
  x: number;
  y: number;
  labelPos: 'above' | 'below' | 'left' | 'right';
}

export const GAS_NODES: GasNode[] = [
  { id: 'sandhill', name: 'Sandhill', kind: 'conventional gas field', x: 110, y: 96, labelPos: 'above' },
  { id: 'ridgeback', name: 'Ridgeback', kind: 'shale basin', x: 96, y: 292, labelPos: 'below' },
  { id: 'calder', name: 'Calder Hub', kind: 'trading hub', x: 300, y: 206, labelPos: 'below' },
  { id: 'metro', name: 'Metro', kind: 'city', x: 512, y: 92, labelPos: 'above' },
  { id: 'bayport', name: 'Bayport', kind: 'port and LNG terminal', x: 504, y: 326, labelPos: 'below' },
];

export const GAS_NODE: Record<GasNodeId, GasNode> = Object.fromEntries(GAS_NODES.map((n) => [n.id, n])) as Record<GasNodeId, GasNode>;

export interface Pipeline {
  id: string;
  name: string;
  from: GasNodeId;
  to: GasNodeId;
  /** Nominal outside diameter, inches. */
  sizeIn: number;
  /** Inside diameter, inches. */
  diameterIn: number;
  lengthMi: number;
  /** Maximum allowable operating pressure, psig. */
  maopPsig: number;
  /** Lowest pressure the pipeline promises at its delivery end, psig. */
  minDeliveryPsig: number;
  /** Compressor stations, evenly spaced from the receipt end. */
  stations: number;
  /** Certificated capacity, Bcf/d: what the pipeline sells, a little under its hydraulic limit. */
  capacityBcfd: number;
  /** Variable cost of moving gas: the commodity charge plus fuel at a typical price, $/MMBtu. */
  variableCost: number;
}

/** New steel's internal roughness, inches; all the region's lines use it. */
export const PIPE_ROUGHNESS_IN = 0.0007;

export const PIPELINES: Pipeline[] = [
  { id: 'ridgeback-calder', name: 'Ridgeback Express', from: 'ridgeback', to: 'calder', sizeIn: 42, diameterIn: 41, lengthMi: 220, maopPsig: 1440, minDeliveryPsig: 900, stations: 2, capacityBcfd: 2.1, variableCost: 0.12 },
  { id: 'ridgeback-bayport', name: 'Coastal Line', from: 'ridgeback', to: 'bayport', sizeIn: 30, diameterIn: 29.25, lengthMi: 260, maopPsig: 1200, minDeliveryPsig: 700, stations: 3, capacityBcfd: 0.85, variableCost: 0.16 },
  { id: 'sandhill-calder', name: 'Sandhill Lateral', from: 'sandhill', to: 'calder', sizeIn: 24, diameterIn: 23.25, lengthMi: 140, maopPsig: 1200, minDeliveryPsig: 700, stations: 3, capacityBcfd: 0.6, variableCost: 0.1 },
  { id: 'sandhill-metro', name: 'Valley Line', from: 'sandhill', to: 'metro', sizeIn: 24, diameterIn: 23.25, lengthMi: 300, maopPsig: 1200, minDeliveryPsig: 600, stations: 3, capacityBcfd: 0.45, variableCost: 0.18 },
  { id: 'calder-metro', name: 'Northline', from: 'calder', to: 'metro', sizeIn: 36, diameterIn: 35, lengthMi: 240, maopPsig: 1440, minDeliveryPsig: 765, stations: 3, capacityBcfd: 1.8, variableCost: 0.15 },
  { id: 'calder-bayport', name: 'Gulfward', from: 'calder', to: 'bayport', sizeIn: 36, diameterIn: 35, lengthMi: 170, maopPsig: 1200, minDeliveryPsig: 800, stations: 3, capacityBcfd: 1.5, variableCost: 0.1 },
];

export const PIPELINE: Record<string, Pipeline> = Object.fromEntries(PIPELINES.map((p) => [p.id, p]));

/** The pipeline's physical description for the hydraulics engine. */
export function stationLineOf(p: Pipeline) {
  return {
    pipe: { diameterIn: p.diameterIn, lengthMi: p.lengthMi, roughnessIn: PIPE_ROUGHNESS_IN },
    stations: p.stations,
    receiptPsia: psia(p.minDeliveryPsig),
    maopPsia: psia(p.maopPsig),
  };
}

export interface StorageField {
  id: string;
  name: string;
  node: GasNodeId;
  kind: 'salt' | 'reservoir';
  /** Working gas capacity, Bcf: what can be put in and taken out. */
  workingBcf: number;
  /** Base (cushion) gas that stays in to keep the pressure up, Bcf. */
  baseBcf: number;
  /** Peak withdrawal rate when full, Bcf/d. */
  maxWithdrawBcfd: number;
  /** Peak injection rate when empty, Bcf/d. */
  maxInjectBcfd: number;
  x: number;
  y: number;
}

export const STORAGE_FIELDS: StorageField[] = [
  { id: 'saltflat', name: 'Salt Flat', node: 'calder', kind: 'salt', workingBcf: 30, baseBcf: 12, maxWithdrawBcfd: 1.2, maxInjectBcfd: 0.6, x: 336, y: 262 },
  { id: 'hollowcreek', name: 'Hollow Creek', node: 'metro', kind: 'reservoir', workingBcf: 120, baseBcf: 110, maxWithdrawBcfd: 1.0, maxInjectBcfd: 0.6, x: 430, y: 52 },
];

export interface Basin {
  id: GasNodeId;
  name: string;
  kind: 'shale' | 'conventional';
  /** Production at the start of the course's history, Bcf/d. */
  productionBcfd: number;
}

export const BASINS: Basin[] = [
  { id: 'ridgeback', name: 'Ridgeback Basin', kind: 'shale', productionBcfd: 2.6 },
  { id: 'sandhill', name: 'Sandhill Field', kind: 'conventional', productionBcfd: 0.8 },
];

/** The LNG export terminal at Bayport: how much gas it can take in to liquefy, Bcf/d. */
export const BAYPORT_LNG_FEEDGAS_BCFD = 1.2;
