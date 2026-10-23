// 8.6: the reader's grid a few years on — demand up, the oldest fossil plants retired — candidate
// investments placed where that grid needs them, and a scored evaluation of a portfolio across
// three kinds of day. Projects earn energy margins at nodal prices and a capacity payment from a
// sloped-demand capacity market (Lesson 4.6), and pay their annualized capital and fixed costs.

import { capacityDemandPrice, type CapacityDemandCurve } from '../../engines/market/ancillary';
import { lineRents } from '../../engines/market/nodalday';
import { makeGenerator } from '../../model/fleet';
import type { Fuel, Generator } from '../../model/types';
import { CORRIDOR, TECH, type CapstoneDesign, type WeatherId } from './capstone';
import {
  RESERVE_TARGET,
  WEATHER,
  WEATHER_IDS,
  applyAddition,
  argmax,
  availableAt,
  batteryCapex,
  checkSystem,
  firmCapacity,
  lineCapex,
  lineName,
  plantCapex,
  runMarket,
  siteName,
  systemDemand,
  systemOf,
  type Addition,
  type DesignChecks,
  type GridSystem,
  type MarketRun,
} from './system';

/** How often each kind of day occurs in the year we score. */
export const SCENARIO_WEIGHT: Record<WeatherId, number> = { typical: 0.7, hot: 0.15, calm: 0.15 };

/** Demand growth between today and the year we plan for, on top of the reader's own growth. */
export const FUTURE_GROWTH = 0.1;

/** Fuels whose plants retire before the planning year. */
export const RETIRING: Fuel[] = ['coal', 'oil'];

/** Annual charge on capital for lines, storage and programs (about 7% interest over 30 years). */
export const CAPITAL_CHARGE = 0.08;

export const BUDGET = 700e6;

/** The 8.6 challenge: a valid portfolio earning at least this much, $ per year. */
export const PROFIT_TARGET = 30e6;

/** Capacity market demand curve, relative to the hot day's peak (the reliability requirement). */
export const CAPACITY_PRICE = { priceCap: 500, priceAtTarget: 250, lowPoint: 0.97, highPoint: 1.1 };

export type ProjectKind = 'plant' | 'battery' | 'line' | 'dr';

export interface Candidate {
  id: string;
  kind: ProjectKind;
  name: string;
  detail: string;
  /** Overnight capital cost, $. */
  capital: number;
  /** Annualized capital plus fixed operating cost, $ per year. */
  annualCost: number;
  addition: Addition;
}

/** The grid in the planning year: the reader's grid after 8.5, more demand, coal and oil retired. */
export function futureSystem(d: CapstoneDesign, weather: WeatherId): GridSystem {
  const sys = systemOf(d, 'vpp', weather);
  const loads = Object.fromEntries(Object.entries(sys.loads).map(([n, v]) => [n, v.map((x) => x * (1 + FUTURE_GROWTH))]));
  return { ...sys, loads, gens: sys.gens.filter((g) => !RETIRING.includes(g.fuel)) };
}

export function retiredPlants(d: CapstoneDesign): Generator[] {
  return d.gens.filter((g) => RETIRING.includes(g.fuel) && g.capacity > 0);
}

function price(run: MarketRun, node: string): number {
  return run.summary.nodePrice[node] ?? 0;
}

/** Lines ranked by how many hours they limit the dispatch (at their limit, or monitored for an outage). */
export function constrainedLines(run: MarketRun): Array<{ id: string; hours: number }> {
  const count: Record<string, number> = {};
  for (const h of run.hours) {
    const seen = new Set([...h.binding, ...h.bindingContingencies.map((b) => b.line)]);
    seen.forEach((id) => (count[id] = (count[id] ?? 0) + 1));
  }
  return Object.entries(count)
    .map(([id, hours]) => ({ id, hours }))
    .sort((a, b) => b.hours - a.hours || a.id.localeCompare(b.id));
}

const candidateCache = new Map<string, Candidate[]>();

/** Cache key for a design, ignoring the 8.6 choices themselves. */
function planKey(d: CapstoneDesign): string {
  return JSON.stringify({ ...d, investments: [] });
}

/**
 * Candidate projects, placed where the planning-year grid needs them: plants and storage at the
 * most expensive node on the hot day, upgrades on the lines that bind most often, demand response
 * where demand is largest.
 */
export function candidates(d: CapstoneDesign): Candidate[] {
  const ck = planKey(d);
  const hit = candidateCache.get(ck);
  if (hit) return hit;
  const out: Candidate[] = [];
  if (!d.nodes.length) return out;
  const sys = futureSystem(d, 'hot');
  const hot = runMarket(sys);
  const typical = runMarket(futureSystem(d, 'typical'));
  const nodes = [...d.nodes];
  // Where the hot day comes up short (load shed), else where energy is dearest on a typical day.
  const shedAt = (n: string) => hot.hours.reduce((s, h) => s + (h.shed[n] ?? 0), 0);
  const dear = [...nodes].sort((a, b) => shedAt(b) - shedAt(a) || price(typical, b) - price(typical, a) || a.localeCompare(b))[0];
  const peakOf = (n: string) => Math.max(...(sys.loads[n] ?? [0]));
  const biggest = [...nodes].sort((a, b) => peakOf(b) - peakOf(a) || a.localeCompare(b))[0];
  const windy = (['plains', 'north'] as const).find((n) => nodes.includes(n)) ?? [...nodes].sort((a, b) => price(typical, a) - price(typical, b))[0];
  const sunny = (['east', 'west'] as const).find((n) => nodes.includes(n)) ?? dear;
  // Lines that limit the N-1 dispatch at the hot peak come first, then those binding most often on a typical day.
  const hotPeak = argmax(hot.demand);
  const inj: Record<string, number> = {};
  for (const n of sys.net.nodes) inj[n.id] = (sys.loads[n.id]?.[hotPeak] ?? 0) - (hot.netLoads[n.id]?.[hotPeak] ?? 0);
  const n1Lines = [...new Set(checkSystem(sys, inj).n1.binding.map((b) => b.line))];
  const ranked = constrainedLines(typical);
  const hoursOf = (id: string) => ranked.find((r) => r.id === id)?.hours ?? 0;
  const lineOrder = [...new Set([...n1Lines, ...ranked.map((r) => r.id)])].filter((id) => d.lines.some((x) => x.id === id));

  const plant = (id: string, fuel: Fuel, node: string, mw: number, label: string) => {
    const g = makeGenerator({ id: `inv-${id}`, name: `${siteName(node)} ${label} (new)`, fuel, node, capacity: mw, marginalCost: TECH[fuel].marginalCost });
    out.push({
      id,
      kind: 'plant',
      name: `${label[0].toUpperCase() + label.slice(1)}, ${mw} MW at ${siteName(node)}`,
      detail: fuel === 'wind' || fuel === 'solar' ? 'Output follows the weather' : `Runs at $${TECH[fuel].marginalCost}/MWh`,
      capital: plantCapex(g),
      annualCost: g.fixedCost * mw,
      addition: { gens: [g] },
    });
  };
  plant('peaker', 'gasCT', dear, 200, 'gas peaker');
  plant('ccgt', 'gasCC', dear, 300, 'combined-cycle plant');
  plant('wind', 'wind', windy, 400, 'wind farm');
  plant('solar', 'solar', sunny, 300, 'solar farm');

  const bMW = 100;
  const bCap = batteryCapex(bMW, bMW * 4);
  out.push({
    id: 'battery',
    kind: 'battery',
    name: `Battery, ${bMW} MW / ${bMW * 4} MWh at ${siteName(dear)}`,
    detail: 'Four hours of storage',
    capital: bCap,
    annualCost: bCap * CAPITAL_CHARGE,
    addition: { batteries: [{ id: 'inv-battery', node: dear, powerMW: bMW, energyMWh: bMW * 4, efficiency: 0.85, soc0: 0.5, kind: 'grid' }] },
  });

  lineOrder.slice(0, 2).forEach((id, i) => {
    const l = { id, hours: hoursOf(id), n1: n1Lines.includes(id) };
    const added = 300;
    const c = CORRIDOR[l.id];
    const cur = d.lines.find((x) => x.id === l.id)!.limit;
    // Reconductoring: the extra rating, plus a fixed cost per km of work on the line.
    const capital = lineCapex(c.lengthKm, cur + added) - lineCapex(c.lengthKm, cur) + c.lengthKm * 0.2e6;
    out.push({
      id: `upgrade${i + 1}`,
      kind: 'line',
      name: `Upgrade ${lineName(l.id)} by ${added} MW`,
      detail: l.n1 ? 'Limits the dispatch at the hot day’s peak' : `Limits a typical day’s dispatch in ${l.hours} of 24 hours`,
      capital,
      annualCost: capital * CAPITAL_CHARGE,
      addition: { upgrades: { [l.id]: added } },
    });
  });

  const drMW = Math.max(10, Math.round((peakOf(biggest) * 0.08) / 10) * 10);
  const drCap = drMW * 0.25e6;
  out.push({
    id: 'dr',
    kind: 'dr',
    name: `Demand response, ${drMW} MW at ${siteName(biggest)}`,
    detail: 'Called for up to four hours a day; customers are paid $150/MWh',
    capital: drCap,
    annualCost: drCap * CAPITAL_CHARGE + drMW * 8_000,
    addition: { dr: [{ id: 'inv-dr', node: biggest, mw: drMW, hours: 4, incentive: 150 }] },
  });

  candidateCache.set(ck, out);
  if (candidateCache.size > 16) candidateCache.delete(candidateCache.keys().next().value!);
  return out;
}

export interface ScenarioResult {
  weather: WeatherId;
  run: MarketRun;
  checks: DesignChecks;
  unservedMWh: number;
  n1: boolean;
  /** Each project's energy margin on this day, $. */
  margins: Record<string, number>;
}

export interface ProjectResult {
  c: Candidate;
  /** Energy margin, $ per year. */
  energy: number;
  /** Capacity payment, $ per year. */
  capacity: number;
  /** MW the capacity market credits the project with. */
  accredited: number;
  cost: number;
  profit: number;
}

export interface Evaluation {
  chosen: Candidate[];
  capital: number;
  withinBudget: boolean;
  scenarios: ScenarioResult[];
  reliable: boolean;
  valid: boolean;
  /** Capacity market: requirement, credited supply and the price that results ($/MW-day). */
  capacity: { requirement: number; supply: number; price: number };
  projects: ProjectResult[];
  /** Portfolio profit, $ per year. */
  score: number;
  /** Why the portfolio isn't valid, in words. */
  problems: string[];
}

function projectMargin(c: Candidate, run: MarketRun, sys: GridSystem): number {
  if (c.kind === 'plant') return run.summary.units[c.addition.gens![0].id]?.margin ?? 0;
  if (c.kind === 'battery') return run.storage.find((s) => s.id === c.addition.batteries![0].id)?.revenue ?? 0;
  if (c.kind === 'dr') return run.dr.find((r) => r.id === c.addition.dr![0].id)?.margin ?? 0;
  // A line upgrade is paid its share of the congestion rent on the line, as a merchant line would be.
  const [id, added] = Object.entries(c.addition.upgrades!)[0];
  const l = sys.net.lines.find((x) => x.id === id);
  if (!l) return 0;
  const rents = lineRents(sys.net, run.hours)[id] ?? [];
  return rents.reduce((s, r) => s + Math.max(0, r), 0) * (added / l.limit);
}

/** MW a project counts for in the capacity market: what it can deliver at the hot day's peak. */
function accredited(c: Candidate, sys: GridSystem, hour: number): number {
  if (c.kind === 'plant') return availableAt(c.addition.gens![0], sys.weather, hour);
  if (c.kind === 'battery') return c.addition.batteries!.reduce((s, b) => s + Math.min(b.powerMW, b.energyMWh / 4), 0);
  if (c.kind === 'dr') return c.addition.dr!.reduce((s, p) => s + p.mw, 0);
  return 0;
}

const evalCache = new Map<string, Evaluation>();

/** Score a portfolio: run each kind of day with the projects in place, then check and settle. */
export function evaluate(d: CapstoneDesign, ids: string[]): Evaluation {
  const all = candidates(d);
  const chosen = all.filter((c) => ids.includes(c.id));
  const key = JSON.stringify([planKey(d), chosen.map((c) => c.id)]);
  const hit = evalCache.get(key);
  if (hit) return hit;
  const capital = chosen.reduce((s, c) => s + c.capital, 0);
  const systems: Partial<Record<WeatherId, GridSystem>> = {};
  const scenarios: ScenarioResult[] = WEATHER_IDS.map((w) => {
    let sys = futureSystem(d, w);
    for (const c of chosen) sys = applyAddition(sys, c.addition);
    systems[w] = sys;
    const run = runMarket(sys);
    const peak = argmax(run.demand);
    const inj: Record<string, number> = {};
    for (const n of sys.net.nodes) inj[n.id] = (sys.loads[n.id]?.[peak] ?? 0) - (run.netLoads[n.id]?.[peak] ?? 0);
    const checks = checkSystem(sys, inj);
    const margins = Object.fromEntries(chosen.map((c) => [c.id, projectMargin(c, run, sys)]));
    return { weather: w, run, checks, unservedMWh: run.summary.unservedMWh, n1: checks.n1.ok, margins };
  });

  // Capacity market: the requirement is the hot day's peak plus the reserve margin.
  const hot = systems.hot!;
  const hotDemand = systemDemand(hot.loads);
  const hotPeak = argmax(hotDemand);
  const requirement = hotDemand[hotPeak] * (1 + RESERVE_TARGET);
  const supply = firmCapacity(hot, hotPeak);
  const curve: CapacityDemandCurve = { target: requirement, ...CAPACITY_PRICE };
  const capPrice = requirement > 0 ? capacityDemandPrice(curve, supply) : 0;

  const projects = chosen.map((c) => {
    const energy = 365 * scenarios.reduce((s, r) => s + SCENARIO_WEIGHT[r.weather] * r.margins[c.id], 0);
    const mwCredit = accredited(c, hot, hotPeak);
    const capacity = mwCredit * capPrice * 365;
    return { c, energy, capacity, accredited: mwCredit, cost: c.annualCost, profit: energy + capacity - c.annualCost };
  });
  const score = projects.reduce((s, p) => s + p.profit, 0);
  const problems: string[] = [];
  for (const r of scenarios) {
    const label = WEATHER[r.weather].label.toLowerCase();
    if (r.unservedMWh > 0.5) problems.push(`On the ${label}, ${Math.round(r.unservedMWh).toLocaleString('en-US')} MWh of demand goes unserved.`);
    if (!r.n1) {
      if (r.checks.n1.radial.length) problems.push(`On the ${label}, losing ${lineName(r.checks.n1.radial[0].line)} would cut off ${r.checks.n1.radial[0].nodes.map(siteName).join(', ')}.`);
      else if (r.checks.n1.shedMW >= 0.5) problems.push(`At the ${label}’s peak, surviving any single line outage would mean turning away ${Math.round(r.checks.n1.shedMW)} MW.`);
      else problems.push(`At the ${label}’s peak, the grid can’t be dispatched to survive every single line outage.`);
    }
  }
  const withinBudget = capital <= BUDGET + 1;
  if (!withinBudget) problems.push(`The portfolio costs $${Math.round(capital / 1e6)} million, over the $${Math.round(BUDGET / 1e6)} million budget.`);
  const reliable = scenarios.every((r) => r.unservedMWh <= 0.5 && r.n1);
  const ev: Evaluation = {
    chosen,
    capital,
    withinBudget,
    scenarios,
    reliable,
    valid: reliable && withinBudget,
    capacity: { requirement, supply, price: capPrice },
    projects,
    score,
    problems,
  };
  evalCache.set(key, ev);
  if (evalCache.size > 64) evalCache.delete(evalCache.keys().next().value!);
  return ev;
}
