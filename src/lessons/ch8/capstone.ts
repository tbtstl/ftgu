// The reader's capstone grid: one design that Chapter 8 builds up lesson by lesson and keeps in
// the browser. 8.1 sets the network, plants and demand; 8.2 the customer mix and the weather;
// 8.4 adds renewables and storage; 8.5 a virtual power plant; 8.6 a portfolio of investments.
// Each lesson owns its own part of the design, so it can be reset alone (resetLesson), and every
// change can be undone for the rest of the visit (undoCapstone).
// Storage can be unavailable (private windows, blocked site data), so every access is guarded.

import { useSyncExternalStore } from 'react';
import { STANDARD_FLEET, makeGenerator, FUEL_LABEL } from '../../model/fleet';
import { REGION } from '../../model/networks';
import type { Fuel, Generator, LoadKind } from '../../model/types';

// ---------------------------------------------------------------------------
// The map: fixed sites where a substation can go, and the corridors a line can follow.

export interface Site {
  id: string;
  name: string;
  x: number;
  y: number;
  labelPos: 'above' | 'below' | 'left' | 'right';
  /** Where the map draws the site's plants. */
  badges: 'above' | 'below' | 'right';
  /** Customer mix used when demand is first added here (shares of the node's load). */
  mix: Record<LoadKind, number>;
}

const REGION_POS = Object.fromEntries(REGION.nodes.map((n) => [n.id, n]));

export const SITES: Site[] = [
  { id: 'north', name: 'North', x: REGION_POS.north.x, y: REGION_POS.north.y, labelPos: 'above', badges: 'below', mix: { residential: 0.6, commercial: 0.2, industrial: 0.2, dataCenter: 0 } },
  { id: 'east', name: 'East', x: REGION_POS.east.x, y: REGION_POS.east.y, labelPos: 'above', badges: 'right', mix: { residential: 0.6, commercial: 0.25, industrial: 0.15, dataCenter: 0 } },
  { id: 'center', name: 'Central', x: REGION_POS.center.x, y: REGION_POS.center.y, labelPos: 'above', badges: 'right', mix: { residential: 0.5, commercial: 0.35, industrial: 0.15, dataCenter: 0 } },
  { id: 'harbor', name: 'Harbor', x: REGION_POS.harbor.x, y: REGION_POS.harbor.y, labelPos: 'above', badges: 'below', mix: { residential: 0.4, commercial: 0.15, industrial: 0.45, dataCenter: 0 } },
  { id: 'west', name: 'West', x: REGION_POS.west.x, y: REGION_POS.west.y, labelPos: 'below', badges: 'above', mix: { residential: 0.35, commercial: 0.1, industrial: 0.55, dataCenter: 0 } },
  { id: 'city', name: 'Metro', x: REGION_POS.city.x, y: REGION_POS.city.y, labelPos: 'above', badges: 'below', mix: { residential: 0.5, commercial: 0.4, industrial: 0, dataCenter: 0.1 } },
  { id: 'plains', name: 'High Plains', x: 44, y: 140, labelPos: 'above', badges: 'below', mix: { residential: 0.5, commercial: 0.1, industrial: 0.4, dataCenter: 0 } },
  { id: 'lake', name: 'Lakeshore', x: 562, y: 172, labelPos: 'below', badges: 'above', mix: { residential: 0.6, commercial: 0.4, industrial: 0, dataCenter: 0 } },
  { id: 'tech', name: 'Tech Park', x: 380, y: 368, labelPos: 'right', badges: 'above', mix: { residential: 0, commercial: 0, industrial: 0, dataCenter: 1 } },
];

export const SITE: Record<string, Site> = Object.fromEntries(SITES.map((s) => [s.id, s]));

export interface Corridor {
  id: string;
  from: string;
  to: string;
  lengthKm: number;
  /** Series reactance (relative units, 1.0 ≈ a 140 km 345 kV line). */
  reactance: number;
  /** Rating when first built, MW. */
  defaultLimit: number;
}

function corridor(from: string, to: string, lengthKm: number, defaultLimit = 400): Corridor {
  return { id: `${from}-${to}`, from, to, lengthKm, reactance: Math.round((lengthKm / 140) * 100) / 100, defaultLimit };
}

export const CORRIDORS: Corridor[] = [
  ...REGION.lines.map((l) => ({ id: l.id, from: l.from, to: l.to, lengthKm: l.lengthKm ?? 100, reactance: l.reactance, defaultLimit: l.limit })),
  corridor('east', 'center', 140),
  corridor('plains', 'north', 75),
  corridor('plains', 'harbor', 67),
  corridor('lake', 'east', 86),
  corridor('lake', 'city', 72),
  corridor('tech', 'west', 95),
  corridor('tech', 'city', 98),
];

export const CORRIDOR: Record<string, Corridor> = Object.fromEntries(CORRIDORS.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------
// Technologies the reader can build, with illustrative costs in a realistic range.

export type BuildFuel = Exclude<Fuel, 'battery' | 'oil' | 'hydro'>;

export const BUILD_TECHS: BuildFuel[] = ['gasCT', 'gasCC', 'wind', 'solar', 'coal', 'nuclear'];

export const TECH: Record<Fuel, { marginalCost: number; defaultMW: number; maxMW: number; capexPerKW: number }> = {
  nuclear: { marginalCost: 9, defaultMW: 600, maxMW: 1200, capexPerKW: 7000 },
  coal: { marginalCost: 30, defaultMW: 300, maxMW: 800, capexPerKW: 3600 },
  gasCC: { marginalCost: 38, defaultMW: 300, maxMW: 800, capexPerKW: 1200 },
  gasCT: { marginalCost: 88, defaultMW: 150, maxMW: 500, capexPerKW: 900 },
  oil: { marginalCost: 165, defaultMW: 80, maxMW: 300, capexPerKW: 800 },
  hydro: { marginalCost: 20, defaultMW: 150, maxMW: 400, capexPerKW: 3500 },
  wind: { marginalCost: 0, defaultMW: 200, maxMW: 1000, capexPerKW: 1600 },
  solar: { marginalCost: 0, defaultMW: 200, maxMW: 1000, capexPerKW: 1200 },
  battery: { marginalCost: 0, defaultMW: 100, maxMW: 500, capexPerKW: 250 },
};

/** Battery capital cost: power electronics per kW plus cells per kWh. */
export const BATTERY_CAPEX = { perKW: 250, perKWh: 260 };
/** Substation capital cost, $. */
export const SUBSTATION_COST = 40e6;
/** Line capital cost per km, $: a fixed part plus a part that grows with the rating. */
export function lineCostPerKm(limitMW: number): number {
  return 0.4e6 + 1500 * limitMW;
}

export const LINE_LIMITS = { min: 100, max: 1000, step: 50 };

let genSeq = 0;
/** A new plant of the given technology at a site, with costs and limits from the fuel's defaults. */
export function newGenerator(fuel: Fuel, node: string, capacity = TECH[fuel].defaultMW, existing: Generator[] = []): Generator {
  let id = '';
  do id = `${fuel}-${node}-${++genSeq}`;
  while (existing.some((g) => g.id === id));
  const name = `${SITE[node]?.name ?? node} ${FUEL_LABEL[fuel].toLowerCase()}`;
  return makeGenerator({ id, name, fuel, node, capacity, marginalCost: TECH[fuel].marginalCost, minOutput: fuel === 'nuclear' ? 0.9 * capacity : 0 });
}

// ---------------------------------------------------------------------------
// The design.

export type WeatherId = 'typical' | 'hot' | 'calm';

export interface Transition {
  windMW: number;
  windNode: string;
  solarMW: number;
  solarNode: string;
  storageMW: number;
  storageHours: number;
  storageNode: string;
}

export interface VppPlan {
  /** Home batteries enrolled at each node, MW. */
  mw: Record<string, number>;
  /** Hours of storage behind each MW. */
  hours: number;
  /** Share of the fleet's power held back for reserve and regulation, 0–1. */
  services: number;
}

export interface CapstoneDesign {
  v: 1;
  /** Sites with a substation. */
  nodes: string[];
  /** Built corridors and their ratings. */
  lines: Array<{ id: string; limit: number }>;
  gens: Generator[];
  /** Peak MW of each customer type at each node. */
  loads: Record<string, Record<LoadKind, number>>;
  /**
   * The loads as 8.1 left them, kept once 8.2 starts editing the customer mix, so that 8.2 can be
   * reset on its own. Absent while 8.2 hasn't changed the mix.
   */
  baseLoads?: Record<string, Record<LoadKind, number>>;
  weather: WeatherId;
  /** Demand growth applied to every customer, 0–1. */
  growth: number;
  transition: Transition;
  vpp: VppPlan;
  /** Ids of the 8.6 investments chosen. */
  investments: string[];
}

export const LOAD_KINDS: LoadKind[] = ['residential', 'commercial', 'industrial', 'dataCenter'];

function mix(residential: number, commercial: number, industrial: number, dataCenter: number): Record<LoadKind, number> {
  return { residential, commercial, industrial, dataCenter };
}

/** The starting design: the course region you’ve met since Chapter 2, its nine plants and today’s customers. */
export function defaultDesign(): CapstoneDesign {
  return {
    v: 1,
    nodes: REGION.nodes.map((n) => n.id),
    lines: REGION.lines.map((l) => ({ id: l.id, limit: l.limit })),
    gens: STANDARD_FLEET.map((g) => ({ ...g })),
    loads: {
      city: mix(460, 330, 0, 80),
      center: mix(120, 90, 40, 0),
      harbor: mix(70, 25, 90, 0),
      east: mix(95, 40, 30, 0),
      north: mix(55, 15, 15, 0),
      west: mix(35, 10, 70, 0),
    },
    weather: 'typical',
    growth: 0,
    transition: { windMW: 300, windNode: 'north', solarMW: 300, solarNode: 'east', storageMW: 150, storageHours: 4, storageNode: 'city' },
    vpp: { mw: { city: 60, center: 20, east: 20 }, hours: 2, services: 0.3 },
    investments: [],
  };
}

const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);

/** Repair a stored design: drop anything that refers to sites, corridors or fields that don't exist. */
export function sanitize(raw: unknown): CapstoneDesign {
  const d = defaultDesign();
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return d;
  const r = raw as Partial<CapstoneDesign>;
  const nodes = Array.isArray(r.nodes) ? [...new Set(r.nodes.filter((n): n is string => typeof n === 'string' && !!SITE[n]))] : d.nodes;
  const built = new Set(nodes);
  const lines = Array.isArray(r.lines)
    ? r.lines
        .filter((l) => l && typeof l.id === 'string' && CORRIDOR[l.id] && built.has(CORRIDOR[l.id].from) && built.has(CORRIDOR[l.id].to))
        .filter((l, i, a) => a.findIndex((m) => m.id === l.id) === i)
        .map((l) => ({ id: l.id, limit: num(l.limit, LINE_LIMITS.min, LINE_LIMITS.max, CORRIDOR[l.id].defaultLimit) }))
    : d.lines;
  const gens = Array.isArray(r.gens)
    ? r.gens
        .filter((g) => g && typeof g.id === 'string' && typeof g.node === 'string' && built.has(g.node) && typeof g.fuel === 'string' && g.fuel in TECH)
        .map((g) => {
          const base = makeGenerator({ id: g.id, name: String(g.name ?? g.id), fuel: g.fuel, node: g.node, capacity: 0, marginalCost: TECH[g.fuel].marginalCost });
          const capacity = num(g.capacity, 0, 2000, 0);
          return { ...base, ...g, capacity, minOutput: num(g.minOutput, 0, capacity, 0), marginalCost: num(g.marginalCost, -100, 1000, base.marginalCost) };
        })
    : d.gens;
  const parseLoads = (raw: unknown): CapstoneDesign['loads'] => {
    const out: CapstoneDesign['loads'] = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [n, m] of Object.entries(raw)) {
      if (!built.has(n) || !m || typeof m !== 'object') continue;
      out[n] = mix(...(LOAD_KINDS.map((k) => num((m as Record<string, unknown>)[k], 0, 3000, 0)) as [number, number, number, number]));
    }
    return out;
  };
  const loads = parseLoads(r.loads);
  const t = { ...d.transition, ...(r.transition ?? {}) };
  const site = (x: unknown, dflt: string) => (typeof x === 'string' && SITE[x] ? x : dflt);
  const vppMw: Record<string, number> = {};
  for (const [n, v] of Object.entries(r.vpp?.mw ?? d.vpp.mw)) if (SITE[n]) vppMw[n] = num(v, 0, 1000, 0);
  const out: CapstoneDesign = {
    v: 1,
    nodes,
    lines,
    gens,
    loads: r.loads ? loads : d.loads,
    weather: r.weather === 'hot' || r.weather === 'calm' || r.weather === 'typical' ? r.weather : d.weather,
    growth: num(r.growth, 0, 1, 0),
    transition: {
      windMW: num(t.windMW, 0, 2000, 0),
      windNode: site(t.windNode, d.transition.windNode),
      solarMW: num(t.solarMW, 0, 2000, 0),
      solarNode: site(t.solarNode, d.transition.solarNode),
      storageMW: num(t.storageMW, 0, 2000, 0),
      storageHours: num(t.storageHours, 1, 8, 4),
      storageNode: site(t.storageNode, d.transition.storageNode),
    },
    vpp: { mw: vppMw, hours: num(r.vpp?.hours, 1, 4, d.vpp.hours), services: num(r.vpp?.services, 0, 1, d.vpp.services) },
    investments: Array.isArray(r.investments) ? r.investments.filter((x): x is string => typeof x === 'string') : [],
  };
  if (r.baseLoads && typeof r.baseLoads === 'object') out.baseLoads = parseLoads(r.baseLoads);
  return out;
}

// ---------------------------------------------------------------------------
// Store.

const KEY = 'emc.capstone.v1';
let cache: CapstoneDesign | null = null;
const listeners = new Set<() => void>();

function read(): CapstoneDesign {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : defaultDesign();
  } catch {
    cache = defaultDesign();
  }
  return cache;
}

function write(d: CapstoneDesign) {
  cache = d;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // The grid lasts for this visit only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let serverDefault: CapstoneDesign | null = null;
function readServer(): CapstoneDesign {
  return (serverDefault ??= defaultDesign());
}

/** The reader's grid, re-rendering whenever any lesson changes it. */
export function useCapstone(): CapstoneDesign {
  return useSyncExternalStore(subscribe, read, readServer);
}

export function getCapstone(): CapstoneDesign {
  return read();
}

// Undo: the designs before each change, for this visit only. A run of changes with the same key
// (a slider being dragged) counts as one step.

/** The lessons that edit the grid, each owning its own part of the design. */
export type EditingLesson = '8.1' | '8.2' | '8.4' | '8.5' | '8.6';

interface Step {
  before: CapstoneDesign;
  /** The lesson that made the change, or 'grid' for a reset of the whole grid. */
  lesson: EditingLesson | 'grid' | undefined;
}

const history: Step[] = [];
let lastKey: string | undefined;
let lastAt = 0;
const MERGE_MS = 1200;

function record(before: CapstoneDesign, lesson: Step['lesson'], key?: string) {
  const now = Date.now();
  const top = history[history.length - 1];
  const merge = !!key && key === lastKey && now - lastAt < MERGE_MS && top?.lesson === lesson;
  if (!merge) {
    history.push({ before, lesson });
    if (history.length > 60) history.shift();
  }
  lastKey = key;
  lastAt = now;
}

/**
 * Apply a change to the reader's grid. `lesson` says which lesson made it (so that lesson can undo
 * it); changes with the same `key` in quick succession, like a slider drag, undo as one step.
 */
export function updateCapstone(fn: (d: CapstoneDesign) => CapstoneDesign, opts: { lesson?: EditingLesson; key?: string } = {}) {
  const before = read();
  const next = fn(before);
  if (next === before) return;
  record(before, opts.lesson, opts.key && `${opts.lesson}:${opts.key}`);
  write(next);
}

export function setCapstone(d: CapstoneDesign) {
  write(sanitize(d));
}

/** “Reset your grid”: back to the starting design (saved attempts in 8.6 are kept). Undoable. */
export function resetCapstone() {
  record(read(), 'grid');
  lastKey = undefined;
  write(defaultDesign());
}

/** Undo the most recent change, if it was made by this lesson (or was a reset of the whole grid). */
export function undoCapstone(lesson: EditingLesson | '8.3') {
  const top = history[history.length - 1];
  if (!top || (top.lesson !== lesson && top.lesson !== 'grid')) return;
  history.pop();
  lastKey = undefined;
  write(top.before);
}

/** What the lesson's Undo button would undo: nothing, its own last change, or a reset of the grid. */
export function undoable(lesson: EditingLesson | '8.3'): 'none' | 'change' | 'reset' {
  const top = history[history.length - 1];
  if (!top) return 'none';
  if (top.lesson === 'grid') return 'reset';
  return top.lesson === lesson ? 'change' : 'none';
}

export function useUndoable(lesson: EditingLesson | '8.3'): 'none' | 'change' | 'reset' {
  return useSyncExternalStore(subscribe, () => undoable(lesson), () => 'none' as const);
}

/** Forget the undo history (for tests). */
export function clearHistory() {
  history.length = 0;
  lastKey = undefined;
}

// ---------------------------------------------------------------------------
// Resetting one lesson's part of the design.

/** What resetting each lesson puts back, for its confirmation. */
export const LESSON_RESET: Record<EditingLesson, string> = {
  '8.1': 'This puts back the starting substations, lines, plants and customer loads.',
  '8.2': 'This puts back the customer mix you had after 8.1, a typical day and no growth.',
  '8.4': 'This puts back the starting plan for wind, solar and storage.',
  '8.5': 'This puts back the starting fleet of home batteries.',
  '8.6': 'This clears the projects you’ve chosen; saved attempts are kept.',
};

function cloneLoads(l: CapstoneDesign['loads']): CapstoneDesign['loads'] {
  return Object.fromEntries(Object.entries(l).map(([n, m]) => [n, { ...m }]));
}

/**
 * The design with one lesson's part back at the start, everything else kept. Resetting 8.1 keeps
 * any change 8.2 made to the customer mix, as a change on top of the starting loads.
 */
export function withLessonReset(d: CapstoneDesign, lesson: EditingLesson): CapstoneDesign {
  const s = defaultDesign();
  switch (lesson) {
    case '8.1': {
      const out: CapstoneDesign = { ...d, nodes: s.nodes, lines: s.lines, gens: s.gens, loads: cloneLoads(s.loads) };
      delete out.baseLoads;
      if (d.baseLoads) {
        for (const n of s.nodes) {
          if (!d.nodes.includes(n)) continue;
          for (const k of LOAD_KINDS) out.loads[n][k] = Math.max(0, s.loads[n][k] + (d.loads[n]?.[k] ?? 0) - (d.baseLoads[n]?.[k] ?? 0));
        }
        out.baseLoads = cloneLoads(s.loads);
      }
      return out;
    }
    case '8.2': {
      const out: CapstoneDesign = { ...d, loads: d.baseLoads ? cloneLoads(d.baseLoads) : d.loads, weather: s.weather, growth: s.growth };
      delete out.baseLoads;
      return out;
    }
    case '8.4':
      return { ...d, transition: s.transition };
    case '8.5':
      return { ...d, vpp: s.vpp };
    case '8.6':
      return { ...d, investments: [] };
  }
}

/** Reset one lesson's part of the reader's grid (undoable). */
export function resetLesson(lesson: EditingLesson) {
  updateCapstone((d) => withLessonReset(d, lesson), { lesson });
}

// ---------------------------------------------------------------------------
// Editing helpers (pure: they return a new design).

export function nodeLoad(d: CapstoneDesign, node: string): number {
  const m = d.loads[node];
  return m ? LOAD_KINDS.reduce((s, k) => s + m[k], 0) : 0;
}

export function buildNode(d: CapstoneDesign, node: string): CapstoneDesign {
  if (d.nodes.includes(node) || !SITE[node]) return d;
  return { ...d, nodes: [...d.nodes, node] };
}

/**
 * Remove a substation and the lines, plants and customers attached to it. Home batteries enrolled
 * there in 8.5 are kept but play no part until the substation is rebuilt.
 */
export function removeNode(d: CapstoneDesign, node: string): CapstoneDesign {
  const loads = { ...d.loads };
  delete loads[node];
  const out: CapstoneDesign = {
    ...d,
    nodes: d.nodes.filter((n) => n !== node),
    lines: d.lines.filter((l) => CORRIDOR[l.id].from !== node && CORRIDOR[l.id].to !== node),
    gens: d.gens.filter((g) => g.node !== node),
    loads,
  };
  if (d.baseLoads) {
    const base = { ...d.baseLoads };
    delete base[node];
    out.baseLoads = base;
  }
  return out;
}

/** Build the corridor if it isn't built, remove it if it is. */
export function toggleLine(d: CapstoneDesign, id: string): CapstoneDesign {
  const c = CORRIDOR[id];
  if (!c || !d.nodes.includes(c.from) || !d.nodes.includes(c.to)) return d;
  if (d.lines.some((l) => l.id === id)) return { ...d, lines: d.lines.filter((l) => l.id !== id) };
  return { ...d, lines: [...d.lines, { id, limit: c.defaultLimit }] };
}

export function setLineLimit(d: CapstoneDesign, id: string, limit: number): CapstoneDesign {
  return { ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, limit } : l)) };
}

function scaledMix(cur: Record<LoadKind, number> | undefined, node: string, total: number): Record<LoadKind, number> {
  const curTotal = cur ? LOAD_KINDS.reduce((s, k) => s + cur[k], 0) : 0;
  const shares = curTotal > 0 && cur ? LOAD_KINDS.map((k) => cur[k] / curTotal) : LOAD_KINDS.map((k) => SITE[node]?.mix[k] ?? 0.25);
  return mix(...(shares.map((s) => Math.round(s * total)) as [number, number, number, number]));
}

/** Set a node's total peak load (8.1), keeping its customer mix (or the site's typical mix if it had none). */
export function setNodeLoad(d: CapstoneDesign, node: string, total: number): CapstoneDesign {
  const out: CapstoneDesign = { ...d, loads: { ...d.loads, [node]: scaledMix(d.loads[node], node, total) } };
  if (d.baseLoads) out.baseLoads = { ...d.baseLoads, [node]: scaledMix(d.baseLoads[node], node, total) };
  return out;
}

/** Set one customer type's peak at a node (8.2's customer mix). */
export function setNodeKind(d: CapstoneDesign, node: string, kind: LoadKind, mw: number): CapstoneDesign {
  const cur = d.loads[node] ?? mix(0, 0, 0, 0);
  return { ...d, baseLoads: d.baseLoads ?? cloneLoads(d.loads), loads: { ...d.loads, [node]: { ...cur, [kind]: mw } } };
}

/**
 * A share of every substation's household demand turned into office and shop demand, the same
 * megawatts at their peaks (8.2's what-if).
 */
export function shiftHomesToOffices(d: CapstoneDesign, share: number): CapstoneDesign {
  if (share <= 0) return d;
  let out = d;
  for (const n of d.nodes) {
    const m = d.loads[n];
    if (!m || m.residential <= 0) continue;
    const moved = m.residential * share;
    out = setNodeKind(out, n, 'residential', m.residential - moved);
    out = setNodeKind(out, n, 'commercial', m.commercial + moved);
  }
  return out;
}

export function addGenerator(d: CapstoneDesign, fuel: Fuel, node: string, capacity?: number): CapstoneDesign {
  return { ...d, gens: [...d.gens, newGenerator(fuel, node, capacity, d.gens)] };
}

export function setGenCapacity(d: CapstoneDesign, id: string, capacity: number): CapstoneDesign {
  return {
    ...d,
    gens: d.gens.map((g) => {
      if (g.id !== id) return g;
      const ratio = g.capacity > 0 ? g.minOutput / g.capacity : g.fuel === 'nuclear' ? 0.9 : 0;
      return { ...g, capacity, minOutput: ratio * capacity };
    }),
  };
}

export function removeGenerator(d: CapstoneDesign, id: string): CapstoneDesign {
  return { ...d, gens: d.gens.filter((g) => g.id !== id) };
}

// ---------------------------------------------------------------------------
// 8.6 leaderboard: the reader's saved attempts.

export interface Attempt {
  id: string;
  name: string;
  at: number;
  /** Portfolio profit, $ per year. */
  score: number;
  capital: number;
  valid: boolean;
  investments: string[];
}

const AKEY = 'emc.capstone.attempts.v1';
let acache: Attempt[] | null = null;
const alisteners = new Set<() => void>();

function aread(): Attempt[] {
  if (acache) return acache;
  try {
    const raw = window.localStorage.getItem(AKEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    acache = Array.isArray(parsed)
      ? parsed.filter((a): a is Attempt => !!a && typeof a === 'object' && typeof (a as Attempt).score === 'number' && Number.isFinite((a as Attempt).score) && Array.isArray((a as Attempt).investments))
      : [];
  } catch {
    acache = [];
  }
  return acache;
}

function awrite(list: Attempt[]) {
  acache = list;
  try {
    window.localStorage.setItem(AKEY, JSON.stringify(list));
  } catch {
    // Attempts last for this visit only.
  }
  alisteners.forEach((l) => l());
}

const NO_ATTEMPTS: Attempt[] = [];

export function useAttempts(): Attempt[] {
  return useSyncExternalStore(
    (l) => {
      alisteners.add(l);
      return () => alisteners.delete(l);
    },
    aread,
    () => NO_ATTEMPTS,
  );
}

export function saveAttempt(a: Omit<Attempt, 'id' | 'name' | 'at'>): Attempt {
  const list = aread();
  const n = list.length ? Math.max(...list.map((x) => Number(/\d+$/.exec(x.name)?.[0] ?? 0))) + 1 : 1;
  const att: Attempt = { ...a, id: `${Date.now()}-${n}`, name: `Attempt ${n}`, at: Date.now() };
  awrite([...list, att].slice(-20));
  return att;
}

export function clearAttempts() {
  awrite([]);
}
