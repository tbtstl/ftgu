// The oil course's world: one petroleum system the whole course returns to.
//
//   Ridgeback Basin (inland)  — Ridgeback shale wells (Ridgeback Light) and the old Northfield
//                                conventional field (Northfield Sour).
//   Coldwater (far north)     — heavy-oil fields (Coldwater Heavy), piped south to Kessler.
//   Kessler hub (inland)      — tank farms where the basin's pipelines meet.
//   The Kessler–Calder line   — a 500-mile crude pipeline to the coast.
//   Port Calder (coast)       — the Calder refinery and an export terminal.
//   Overseas                  — Northport, a refining center across the ocean, and Eastbay, a
//                                distant importing region, both reached by tanker.
//
// Every price here is simulated for teaching. WTI and Brent are real benchmarks; the course's
// "WTI" and "Brent" are model prices that behave like them, not market data.

/** Reference prices, $ per barrel unless noted: simulated, a calm month in the model. */
export const REF_PRICES = {
  /** Benchmark crudes. */
  wti: 75,
  brent: 79,
  /** Products at Port Calder. */
  lpg: 36,
  naphtha: 68,
  gasoline: 96,
  jet: 102,
  diesel: 106,
  /** High-sulfur (3.5%) fuel oil and very-low-sulfur (0.5%) fuel oil. */
  hsfo: 62,
  vlsfo: 80,
  ethanol: 84,
  /** Petroleum coke, $ per tonne. */
  coke: 70,
};

export const GALLONS_PER_BARREL = 42;

/** $ per barrel → $ per gallon. */
export function perGallon(usdPerBarrel: number): number {
  return usdPerBarrel / GALLONS_PER_BARREL;
}
