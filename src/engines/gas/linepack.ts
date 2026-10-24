// Linepack: the gas held inside a pipeline, and how it lets deliveries swing within a day while
// receipts stay steady.
//
// The pipeline is a chain of identical segments, each starting at a compressor station. Over an
// hour the gas in the pipe changes by what enters minus what leaves. Given that inventory and the
// average flow, the pressures follow: every station discharges at the same pressure P_d, and each
// segment falls from P_d to P_s by the flow equation, P_d² − P_s² = K·Q². More gas in the pipe
// means a higher P_d; the pipe can pack only until P_d reaches the maximum allowable operating
// pressure, and it can draft only until the delivery pressure P_s falls to the minimum the
// pipeline promises. For speed, K and Z are fixed at their values for a typical operating point
// (they change by a few percent across the range).

import { zFactor } from './eos';
import { averagePressure, pipeFlow, type Pipe } from './hydraulics';
import { R_PSIA, SCF_PER_LBMOL, rankine } from './properties';

export interface PackLine {
  /** One segment, from a station to the next station (or the delivery point). */
  segment: Pipe;
  segments: number;
  /** Maximum allowable operating pressure, psia. */
  maopPsia: number;
  /** Lowest delivery pressure allowed, psia. */
  minDeliveryPsia: number;
}

interface Prepared {
  /** P_d² − P_s² = k·q², q in MMcf/d. */
  k: number;
  /** MMcf of gas in the whole line per psia of average pressure. */
  perPsi: number;
}

const prepCache = new WeakMap<PackLine, Prepared>();

function prep(line: PackLine): Prepared {
  let p = prepCache.get(line);
  if (!p) {
    const mid = (line.maopPsia + line.minDeliveryPsia) / 2;
    const f = pipeFlow(line.segment, line.maopPsia, line.minDeliveryPsia);
    const k = (line.maopPsia ** 2 - line.minDeliveryPsia ** 2) / (f.qMMcfd * f.qMMcfd);
    const tempF = line.segment.tempF ?? 60;
    const z = zFactor(mid, tempF);
    const volume = ((Math.PI * (line.segment.diameterIn / 12) ** 2) / 4) * line.segment.lengthMi * 5280 * line.segments;
    p = { k, perPsi: (volume * SCF_PER_LBMOL) / (z * R_PSIA * rankine(tempF)) / 1e6 };
    prepCache.set(line, p);
  }
  return p;
}

/** Delivery pressure (psia) when stations discharge at pd and the flow is q; NaN if the segment can't carry q. */
export function deliveryPressure(line: PackLine, pd: number, q: number): number {
  const sq = pd * pd - prep(line).k * q * q;
  return sq > 0 ? Math.sqrt(sq) : NaN;
}

/** Gas in the line (MMcf) when every station discharges at pd (psia) and the flow is q (MMcf/d). */
export function lineInventory(line: PackLine, pd: number, q: number): number {
  const ps = deliveryPressure(line, pd, q);
  if (!Number.isFinite(ps)) return NaN;
  return prep(line).perPsi * averagePressure(pd, ps);
}

/** Most the line can carry (MMcf/d) at steady state between MAOP and the minimum delivery pressure. */
export function packLineCapacity(line: PackLine): number {
  return Math.sqrt((line.maopPsia ** 2 - line.minDeliveryPsia ** 2) / prep(line).k);
}

export interface PackState {
  /** Station discharge pressure, psia. */
  discharge: number;
  /** Delivery (and station suction) pressure, psia. */
  delivery: number;
}

/** The pressures that hold `packMMcf` in the line at flow q, or null if the line can't hold that little gas while carrying q. */
export function pressuresFor(line: PackLine, packMMcf: number, q: number): PackState | null {
  const k = prep(line).k;
  const lo0 = Math.sqrt(k) * Math.abs(q) * (1 + 1e-9);
  if (lineInventory(line, lo0, q) > packMMcf) return null;
  let lo = lo0;
  let hi = Math.max(lo0 * 2, line.maopPsia * 3);
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (lineInventory(line, mid, q) < packMMcf) lo = mid;
    else hi = mid;
  }
  const pd = (lo + hi) / 2;
  return { discharge: pd, delivery: deliveryPressure(line, pd, q) };
}

/** Linepack (MMcf) at steady flow q with stations discharging at pd. */
export function steadyPack(line: PackLine, pd: number, q: number): number {
  return lineInventory(line, pd, q);
}

export interface PackHour {
  hour: number;
  /** Receipts into and deliveries out of the line during the hour, as daily rates (MMcf/d). */
  receipts: number;
  deliveries: number;
  /** Deliveries the customers asked for that the line couldn't make, MMcf/d. */
  shortfall: number;
  /** Receipts refused because the line was full (at MAOP), MMcf/d. */
  refused: number;
  /** Linepack at the end of the hour, MMcf. */
  pack: number;
  discharge: number;
  delivery: number;
}

/**
 * An hour-by-hour run: shippers put gas in at `receipts[h]` and customers take `deliveries[h]`
 * (both as MMcf/d rates). Deliveries are cut back if they would pull the delivery pressure below
 * the minimum, and receipts are refused if they would push the discharge above MAOP.
 */
export function runLinepack(line: PackLine, startPack: number, receipts: number[], deliveries: number[], hours = Math.max(receipts.length, deliveries.length)): PackHour[] {
  const out: PackHour[] = [];
  let pack = startPack;
  const within = (p: number, q: number) => {
    const s = pressuresFor(line, p, q);
    return s !== null && s.discharge <= line.maopPsia + 1e-6 && s.delivery >= line.minDeliveryPsia - 1e-6 ? s : null;
  };
  for (let h = 0; h < hours; h++) {
    const rin = receipts[h % receipts.length];
    const want = deliveries[h % deliveries.length];
    let take = want;
    let accept = rin;
    let st = within(pack + (accept - take) / 24, (accept + take) / 2);
    if (!st) {
      // Too little gas to hold the delivery pressure: cut deliveries. Too much: refuse receipts.
      const s0 = pressuresFor(line, pack + (accept - take) / 24, (accept + take) / 2);
      const draft = !s0 || s0.delivery < line.minDeliveryPsia;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const a = draft ? accept : rin * mid;
        const t = draft ? want * mid : take;
        if (within(pack + (a - t) / 24, (a + t) / 2)) lo = mid;
        else hi = mid;
      }
      if (draft) take = want * lo;
      else accept = rin * lo;
      st = pressuresFor(line, pack + (accept - take) / 24, (accept + take) / 2);
    }
    pack += (accept - take) / 24;
    out.push({
      hour: h,
      receipts: accept,
      deliveries: take,
      shortfall: want - take,
      refused: rin - accept,
      pack,
      discharge: st?.discharge ?? NaN,
      delivery: st?.delivery ?? NaN,
    });
  }
  return out;
}

/**
 * The linepack window at steady flow q: the most gas the line can hold (stations at MAOP) and the
 * least it can hold while still delivering at the minimum pressure. Their difference is the
 * flexibility the line offers; it shrinks to nothing as q approaches the line's capacity.
 */
export function packWindow(line: PackLine, q: number): { max: number; min: number; swing: number } {
  const k = prep(line).k;
  const pdMin = Math.sqrt(line.minDeliveryPsia ** 2 + k * q * q);
  if (pdMin > line.maopPsia) return { max: NaN, min: NaN, swing: 0 };
  const max = lineInventory(line, line.maopPsia, q);
  const min = lineInventory(line, pdMin, q);
  return { max, min, swing: max - min };
}

/** A pipeline as a linepack model: its stations split it into equal segments between MAOP and its delivery promise. */
export function packLineOf(p: { diameterIn: number; lengthMi: number; stations: number; maopPsig: number; minDeliveryPsig: number }, roughnessIn = 0.0007): PackLine {
  return {
    segment: { diameterIn: p.diameterIn, lengthMi: p.lengthMi / p.stations, roughnessIn },
    segments: p.stations,
    maopPsia: p.maopPsig + 14.696,
    minDeliveryPsia: p.minDeliveryPsig + 14.696,
  };
}

/**
 * A city's gas demand through a winter day, as a share of its daily average for each hour:
 * low overnight, a morning peak as homes wake and heat up, a dip in the afternoon, and an evening
 * peak when heating and gas-fired power plants both run hard. Averages exactly 1.
 */
export const CITY_HOURLY_SHAPE: number[] = (() => {
  const raw = [0.78, 0.74, 0.72, 0.72, 0.76, 0.88, 1.08, 1.24, 1.22, 1.12, 1.04, 1.0, 0.98, 0.97, 0.98, 1.02, 1.1, 1.2, 1.26, 1.24, 1.16, 1.04, 0.92, 0.84];
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  return raw.map((x) => x / mean);
})();
