// Weather at sea: the extra resistance of wind and waves, the push or drag of currents, and what
// they do to a ship's speed, passage time and fuel.
//
// Added resistance in waves uses Kreitner's estimate for head seas, 0.64 · ρ g H² B² Cb / L, scaled
// by ((1 + cos β) / 2)² for seas from other directions (β = 0 ahead, 180° astern): beam seas add a
// quarter as much, following seas almost nothing. Wind adds air resistance on the ship's own
// apparent wind. A current changes speed over the ground without changing the water's resistance.

import type { Hull } from '../../model/shipping/vessels';
import { G, RHO_SEA_KG, airResistance } from './resistance';
import { powerAndFuel, speedForPower, type PropulsionOptions } from './propulsion';

export interface Weather {
  /** Significant wave height, m. */
  waveHeight: number;
  /** True wind speed, knots. */
  windKn: number;
  /** Direction the wind and waves come from, degrees off the bow (0 = head on, 180 = astern). */
  dirDeg: number;
  /** Current along the ship's track, knots: positive helps, negative hinders. */
  currentKn: number;
}

export const CALM: Weather = { waveHeight: 0, windKn: 0, dirDeg: 0, currentKn: 0 };

/** Heading factor for wave added resistance. */
export function waveHeadingFactor(dirDeg: number): number {
  return ((1 + Math.cos((dirDeg * Math.PI) / 180)) / 2) ** 2;
}

/** Added resistance in waves, kN (Kreitner, head seas, scaled by heading). */
export function waveAddedResistance(h: Hull, waveHeight: number, dirDeg: number): number {
  const head = (0.64 * G * RHO_SEA_KG * waveHeight ** 2 * h.beam ** 2 * h.cb) / h.lbp / 1000;
  return head * waveHeadingFactor(dirDeg);
}

/**
 * Extra air resistance from the true wind, kN: the air resistance on the apparent wind, minus the
 * still-air part that calm-water resistance already counts.
 */
export function windAddedResistance(h: Hull, draft: number, speedKn: number, windKn: number, dirDeg: number): number {
  const apparent = speedKn + windKn * Math.cos((dirDeg * Math.PI) / 180);
  return airResistance(h, draft, apparent) - airResistance(h, draft, speedKn);
}

export function addedResistance(h: Hull, draft: number, speedKn: number, w: Weather): number {
  return waveAddedResistance(h, w.waveHeight, w.dirDeg) + windAddedResistance(h, draft, speedKn, w.windKn, w.dirDeg);
}

export interface WeatherSpeed {
  /** Speed through the water, knots. */
  stw: number;
  /** Speed over the ground, knots. */
  sog: number;
  brakePower: number;
  load: number;
  /** Fuel, t/day, main plus auxiliary. */
  tpd: number;
  /** Added resistance from wind and waves at that speed, kN. */
  added: number;
}

/** The speed a ship makes in weather with its engine at a fixed fraction of MCR. */
export function speedInWeather(h: Hull & { mcr: number }, w: Weather, powerFrac: number, o: PropulsionOptions): WeatherSpeed {
  const p = powerFrac * h.mcr;
  // The wind term depends on speed, so iterate: guess a speed, find the added resistance, re-solve.
  let v = speedForPower(h, p, o);
  for (let i = 0; i < 30; i++) {
    const added = addedResistance(h, o.draft, v, w);
    const next = speedForPower(h, p, { ...o, addedResistance: (o.addedResistance ?? 0) + Math.max(added, -50) });
    if (Math.abs(next - v) < 1e-4) {
      v = next;
      break;
    }
    v = 0.5 * v + 0.5 * next;
  }
  const added = addedResistance(h, o.draft, v, w);
  const pf = powerAndFuel(h, v, { ...o, addedResistance: (o.addedResistance ?? 0) + added });
  return { stw: v, sog: Math.max(0, v + w.currentKn), brakePower: pf.brakePower, load: pf.load, tpd: pf.totalTpd, added };
}

export interface LegResult {
  nm: number;
  days: number;
  fuel: number;
  speed: WeatherSpeed;
}

/** A passage split into legs, each in its own weather, at a fixed engine power. */
export function passageInWeather(
  h: Hull & { mcr: number },
  legs: Array<{ nm: number; weather: Weather }>,
  powerFrac: number,
  o: PropulsionOptions,
): { legs: LegResult[]; nm: number; days: number; fuel: number } {
  const out = legs.map((l) => {
    const speed = speedInWeather(h, l.weather, powerFrac, o);
    const days = speed.sog > 0 ? l.nm / (speed.sog * 24) : Infinity;
    return { nm: l.nm, days, fuel: speed.tpd * days, speed };
  });
  return {
    legs: out,
    nm: out.reduce((s, l) => s + l.nm, 0),
    days: out.reduce((s, l) => s + l.days, 0),
    fuel: out.reduce((s, l) => s + l.fuel, 0),
  };
}

/** Beaufort-style label for a wind speed in knots. */
export function beaufort(windKn: number): { force: number; name: string } {
  const limits = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
  const names = ['calm', 'light air', 'light breeze', 'gentle breeze', 'moderate breeze', 'fresh breeze', 'strong breeze', 'near gale', 'gale', 'strong gale', 'storm', 'violent storm', 'hurricane force'];
  let f = 0;
  while (f < limits.length && windKn >= limits[f]) f++;
  return { force: f, name: names[f] };
}

