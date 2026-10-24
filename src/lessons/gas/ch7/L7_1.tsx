import { useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  pct,
  useScenario,
} from '../../../framework';
import {
  AS_BUILT,
  CAPITAL_CHARGE,
  CAPSTONE_CONDITIONS,
  PRACTICE_SEEDS,
  designDay,
  designMorningOf,
  lineDesign,
  systemCapacity,
  systemCost,
  systemTakeaway,
  type GasSystem,
  type SystemCost,
} from '../../../engines/gas/capstone';
import type { MarketDay } from '../../../engines/gas/market';
import { PIPE_SIZES } from '../../../engines/gas/network';
import { conditionsOf } from '../../../model/gas/history';
import { GAS_MONTH_NAMES, GAS_MONTH_START, monthOfDay } from '../../../model/gas/weather';
import { CORRIDORS, GAS_NODE, GAS_NODES, PIPELINE, type GasNodeId } from '../../../model/gas/world';
import { GasMap } from '../shared/GasMap';
import { resetGasSystem, updateGasSystem, useGasCapstone } from '../shared/capstone';
import { bcf, bcfd, gp, money } from '../shared/format';

// ---------------------------------------------------------------------------
// The reader's network, checked against the two tests of Year 9.

/** The line selected for editing when the lesson opens. */
export const CONSTRUCTOR_DEFAULTS = { sel: 'calder-metro' };

/** "Northline", or "the Ridgeback–Sandhill corridor" where the region never built a line. */
export function constructorLineName(id: string): string {
  const p = PIPELINE[id];
  if (p) return p.name;
  const c = CORRIDORS.find((x) => x.id === id)!;
  return `the ${GAS_NODE[c.from].name}–${GAS_NODE[c.to].name} corridor`;
}

/** The name as it reads in a sentence: "the Coastal Line", "Northline", "the Ridgeback–Sandhill corridor". */
export function constructorLineRef(id: string): string {
  const n = constructorLineName(id);
  return /(Line|Lateral)$/.test(n) ? `the ${n}` : n;
}

/** True when every line already in the ground is kept: no line removed, made smaller, or stripped of a station. */
export function constructorOnlyAdds(s: GasSystem): boolean {
  return CORRIDORS.every((c) => {
    const o = AS_BUILT.sizes[c.id];
    if (!o) return true;
    const n = s.sizes[c.id] ?? 0;
    return n > o || (n === o && (s.stations[c.id] ?? 1) >= AS_BUILT.stations[c.id]);
  });
}

export interface ConstructorChecks {
  /** Ridgeback's production and its takeaway, Bcf/d. */
  production: number;
  takeaway: number;
  /** Production the basin's pipes can't carry out, Bcf/d (0 when none is stranded). */
  stranded: number;
  /** The design morning on the reader's network. */
  day: MarketDay;
  /** Protected demand — homes and the fields' own use — left without gas that morning, by place and in all, Bcf/d. */
  cutAt: Record<GasNodeId, number>;
  homesCut: number;
  cost: SystemCost;
}

/** The two tests on a network: can Ridgeback's gas get out, and can Metro get through its coldest morning? */
export function constructorChecks(s: GasSystem): ConstructorChecks {
  const production = CAPSTONE_CONDITIONS.ridgeback;
  const takeaway = systemTakeaway(s);
  const day = designDay(s);
  const cutAt = Object.fromEntries(GAS_NODES.map((n) => [n.id, 0])) as Record<GasNodeId, number>;
  day.problem.demands.forEach((d, i) => {
    if (d.value >= 100) cutAt[d.node as GasNodeId] += Math.max(0, d.cap - day.solution.served[i]);
  });
  const homesCut = Object.values(cutAt).reduce((a, b) => a + b, 0);
  return { production, takeaway, stranded: Math.max(0, production - takeaway), day, cutAt, homesCut: homesCut > 1e-6 ? homesCut : 0, cost: systemCost(s) };
}

/** No gas stranded behind Ridgeback's pipes: the takeaway exceeds production. */
function clearOfGlut(c: ConstructorChecks): boolean {
  return c.takeaway > c.production + 1e-9;
}

export type ConstructorProblem = 'glut' | 'design';

export interface ConstructorFix {
  id: string;
  size: number;
  stations: number;
  /** Capital the change costs, $, and the line's capacity before and after, Bcf/d. */
  cost: number;
  before: number;
  after: number;
  /** Metro's price on the design morning, and Ridgeback's takeaway, with the change made. */
  metroPrice: number;
  takeaway: number;
}

let fixCache: Record<ConstructorProblem, Array<{ id: string; best: ConstructorFix | null }>> | null = null;

/**
 * For each problem and each corridor, the cheapest single change to the network as built — any
 * pipe size, any number of stations — that solves it (null if none does). Computed once.
 */
export function constructorFixes(): Record<ConstructorProblem, Array<{ id: string; best: ConstructorFix | null }>> {
  if (fixCache) return fixCache;
  const all: Array<ConstructorFix & { glut: boolean; design: boolean }> = [];
  for (const c of CORRIDORS) {
    for (const size of PIPE_SIZES) {
      for (let n = 1; n <= 5; n++) {
        if (size === AS_BUILT.sizes[c.id] && n === AS_BUILT.stations[c.id]) continue;
        const s: GasSystem = { sizes: { ...AS_BUILT.sizes, [c.id]: size }, stations: { ...AS_BUILT.stations, [c.id]: n } };
        if (!constructorOnlyAdds(s)) continue;
        const k = constructorChecks(s);
        all.push({
          id: c.id,
          size,
          stations: n,
          cost: k.cost.added,
          before: systemCapacity(AS_BUILT)[c.id],
          after: lineDesign(c.id, size, n).capacityBcfd,
          metroPrice: k.day.price.metro,
          takeaway: k.takeaway,
          glut: clearOfGlut(k),
          design: k.homesCut === 0,
        });
      }
    }
  }
  const pick = (p: ConstructorProblem) =>
    CORRIDORS.map((c) => {
      const ok = all.filter((f) => f.id === c.id && f[p]).sort((a, b) => a.cost - b.cost);
      return { id: c.id, best: ok[0] ?? null };
    });
  fixCache = { glut: pick('glut'), design: pick('design') };
  return fixCache;
}

/** The cheapest fix for a problem, over every corridor. */
export function cheapestFix(p: ConstructorProblem): ConstructorFix {
  return constructorFixes()[p]
    .map((r) => r.best)
    .filter((f): f is ConstructorFix => !!f)
    .sort((a, b) => a.cost - b.cost)[0];
}

/**
 * The least capital that solves both problems. They lie behind different cuts — Ridgeback's
 * pipes out, and Metro's pipes in — so no single change solves both and the cheapest network is the
 * two cheapest fixes together (checked in the tests against every pair and triple of changes).
 */
export function constructorLeastCapital(): number {
  return cheapestFix('glut').cost + cheapestFix('design').cost;
}

/** The challenge: both problems solved, the region's lines kept, for the least capital. */
export function constructorSolved(s: GasSystem): boolean {
  const k = constructorChecks(s);
  return constructorOnlyAdds(s) && clearOfGlut(k) && k.homesCut === 0 && k.cost.added <= constructorLeastCapital() + 1;
}

const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/** "a fourth station" or "a new 20-inch pipe with one station". */
export function constructorFixText(f: ConstructorFix): string {
  if (f.size === AS_BUILT.sizes[f.id]) return `a ${ORDINAL[f.stations]} station`;
  return `a new ${f.size}-inch pipe with ${f.stations === 1 ? 'one station' : `${fmt(f.stations)} stations`}`;
}

/** Numbers quoted in the prose (computed once). */
export function constructorNumbers() {
  const morning = designMorningOf();
  const k = constructorChecks(AS_BUILT);
  const day = k.day;
  const servedOf = (id: string) => day.solution.served[day.problem.demands.findIndex((d) => d.id === id)] ?? 0;
  const capOf = (id: string) => day.problem.demands.find((d) => d.id === id)?.cap ?? 0;
  const suppliedOf = (id: string) => day.solution.supplied[day.problem.supplies.findIndex((d) => d.id === id)] ?? 0;
  const switchIds = day.problem.demands.filter((d) => d.id?.startsWith('metro-switch')).map((d) => d.id!);
  const powerOff = capOf('metro-power') - servedOf('metro-power') + switchIds.reduce((a, id) => a + capOf(id) - servedOf(id), 0);
  const glut = cheapestFix('glut');
  const design = cheapestFix('design');
  const fixes = constructorFixes();
  const expressFix = fixes.glut.find((r) => r.id === 'ridgeback-calder')!.best!;
  const northFix = fixes.design.find((r) => r.id === 'calder-metro')!.best!;
  const bayMetro = fixes.design.find((r) => r.id === 'bayport-metro')!.best!;
  const valley4: GasSystem = { sizes: { ...AS_BUILT.sizes }, stations: { ...AS_BUILT.stations, 'sandhill-metro': AS_BUILT.stations['sandhill-metro'] + 1 } };
  const v4 = constructorChecks(valley4);
  const both: GasSystem = {
    sizes: { ...AS_BUILT.sizes, [glut.id]: glut.size, [design.id]: design.size },
    stations: { ...AS_BUILT.stations, [glut.id]: glut.stations, [design.id]: design.stations },
  };
  const bothDay = constructorChecks(both).day;
  return {
    morning,
    winter: PRACTICE_SEEDS.indexOf(morning.seed) + 1,
    date: `${GAS_MONTH_NAMES[monthOfDay(morning.day)]} ${morning.day - GAS_MONTH_START[monthOfDay(morning.day)] + 1}`,
    y1: conditionsOf(0),
    k,
    powerOff,
    industryOff: capOf('metro-industry') - servedOf('metro-industry'),
    interruptibleOff: capOf('metro-interruptible') - servedOf('metro-interruptible'),
    homesDemand: capOf('metro-homes'),
    lng: servedOf('bayport-lng'),
    hollowWd: suppliedOf('wd-hollowcreek'),
    saltWd: suppliedOf('wd-saltflat'),
    glut,
    design,
    expressFix,
    northFix,
    bayMetro,
    valley4: { cost: v4.cost.added, cut: v4.homesCut, cap: systemCapacity(valley4)['sandhill-metro'] },
    least: constructorLeastCapital(),
    bothMetro: bothDay.price.metro,
    bothRidgeback: bothDay.price.ridgeback,
  };
}

const PRODUCTION = CAPSTONE_CONDITIONS.ridgeback;
const LEGEND = [
  { label: 'Less than 80% full', color: '#c4c4c4', kind: 'line' as const },
  { label: 'Nearly full', color: '#eda06f', kind: 'line' as const },
  { label: 'Full', color: '#e75b55', kind: 'line' as const },
  { label: 'Corridor, nothing built', color: '#cfc9b9', kind: 'line' as const, dashed: true },
];

function cap1(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function listOf(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Figure 2: the cheapest single fixes, as bars.

export const FIXES_DEFAULTS: { problem: ConstructorProblem } = { problem: 'glut' };

function FixBars({ problem }: { problem: ConstructorProblem }) {
  const rows = constructorFixes()[problem];
  const best = cheapestFix(problem);
  const W = 600;
  const left = 172;
  const right = 20;
  const rowH = 34;
  const top = 26;
  const H = top + rows.length * rowH + 10;
  const max = 800e6;
  const x = (v: number) => left + (Math.min(v, max) / max) * (W - left - right);
  const ticks = [0, 200e6, 400e6, 600e6, 800e6];
  const label = rows
    .map((r) => `${constructorLineName(r.id)}: ${r.best ? `${constructorFixText(r.best)} for ${money(r.best.cost)}` : 'no single change fixes it'}`)
    .join('; ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The cheapest single change on each corridor that ${problem === 'glut' ? 'clears Ridgeback’s stranded gas' : 'keeps every Metro home supplied on the design morning'}. ${label}.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="gl" x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 8} />
          <text className="ax" x={x(t)} y={top - 10} textAnchor="middle">
            {t === 0 ? '$0' : `$${fmt(t / 1e6)}M`}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = top + i * rowH;
        const isBest = r.best && r.best.id === best.id;
        return (
          <g key={r.id}>
            <text className="lab" x={left - 10} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontWeight: isBest ? 600 : 400 }}>
              {cap1(constructorLineName(r.id)).replace('The ', '').replace(' corridor', '')}
            </text>
            {r.best ? (
              <>
                <rect x={left} y={y + 7} width={Math.max(2, x(r.best.cost) - left)} height={rowH - 14} fill={isBest ? GRAPHIC.green : '#b9d8c2'} rx={2} />
                <text x={x(r.best.cost) + 6} y={y + rowH / 2 + 4} style={{ fontSize: 12, fill: isBest ? TEXT.green : TEXT.ink }} textAnchor={x(r.best.cost) > W - 200 ? 'end' : 'start'} dx={x(r.best.cost) > W - 200 ? -12 : 0}>
                  {`${constructorFixText(r.best)}, ${money(r.best.cost)}`}
                </text>
              </>
            ) : (
              <text x={left + 4} y={y + rowH / 2 + 4} style={{ fontSize: 12, fill: '#9a9585', fontStyle: 'italic' }}>
                no single change fixes it
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const { system } = useGasCapstone();
  const [sel, setSel] = useState(CONSTRUCTOR_DEFAULTS.sel);
  const k = useMemo(() => constructorChecks(system), [system]);
  const N = useMemo(() => constructorNumbers(), []);
  const f = useScenario('constructor-fixes', FIXES_DEFAULTS);
  const problem = f.state.problem;
  const best = cheapestFix(problem);

  const caps = systemCapacity(system);
  const built = CORRIDORS.filter((c) => (system.sizes[c.id] ?? 0) > 0).map((c) => c.id);
  const sizesDrawn = Object.fromEntries(built.map((id) => [id, system.sizes[id]]));
  const day = k.day;
  const withdrawal = (id: string) => day.solution.supplied[day.problem.supplies.findIndex((x) => x.id === `wd-${id}`)] ?? 0;
  const selCorridor = CORRIDORS.find((c) => c.id === sel)!;
  const selSize = system.sizes[sel] ?? 0;
  const selStations = system.stations[sel] ?? 1;
  const selFlow = Math.abs(day.flow[sel] ?? 0);
  const selCap = caps[sel];
  const asBuiltCap = systemCapacity(AS_BUILT)[sel];
  const changed = selSize !== AS_BUILT.sizes[sel] || (selSize > 0 && selStations !== AS_BUILT.stations[sel]);
  const glutClear = k.takeaway > k.production + 1e-9;
  const fullLines = built.filter((id) => Math.abs(day.flow[id] ?? 0) >= caps[id] * 0.99 - 1e-9);

  const setSize = (v: string) => updateGasSystem((s) => ({ ...s, sizes: { ...s.sizes, [sel]: Number(v) } }));
  const setStations = (v: number) => updateGasSystem((s) => ({ ...s, stations: { ...s.stations, [sel]: v } }));

  const selText = selSize
    ? `${cap1(constructorLineRef(sel))}, ${GAS_NODE[selCorridor.from].name} to ${GAS_NODE[selCorridor.to].name}, ${selCorridor.lengthMi} miles: a ${selSize}-inch pipe with ${selStations} station${selStations > 1 ? 's' : ''}, ${fmt(selCap, 2)} Bcf/d${changed ? (asBuiltCap > 0 ? ` (as built, ${fmt(asBuiltCap, 2)})` : ' (new)') : ''}. On the design morning it carries ${fmt(selFlow, 2)} Bcf/d${selFlow >= selCap * 0.99 - 1e-9 ? ' — full' : ''}.`
    : `${cap1(constructorLineRef(sel))}, ${GAS_NODE[selCorridor.from].name} to ${GAS_NODE[selCorridor.to].name}, ${selCorridor.lengthMi} miles: nothing built. Choose a size to lay a pipe here.`;

  const status = (() => {
    if (!constructorOnlyAdds(system))
      return 'Keep the lines already in the ground: add stations or lay new pipe, but don’t remove a line, make it smaller or take away a station. Reset brings back the network as built.';
    const parts: string[] = [];
    if (!glutClear) parts.push(`Ridgeback still produces ${bcfd(k.production)} against a takeaway of ${bcfd(k.takeaway)}`);
    if (k.homesCut > 0) parts.push(`on the design morning ${bcfd(k.homesCut)} of homes go without gas`);
    if (parts.length) return cap1(listOf(parts)) + '.';
    return `Both tests passed for ${money(k.cost.added)} of new capital. Is there a cheaper way?`;
  })();

  const mapLabel = `Your network on the design morning, ${N.date}, ${fmt(N.morning.tempF, 1)} °F. Capital added ${money(k.cost.added)}. Prices: ${GAS_NODES.map((n) => `${n.name} ${gp(day.price[n.id])}`).join(', ')}. ${k.homesCut > 0 ? `${fmt(k.homesCut, 2)} Bcf/d of homes without gas.` : 'Every home supplied.'} Ridgeback produces ${fmt(k.production, 2)} Bcf/d against a takeaway of ${fmt(k.takeaway, 2)}. Full lines: ${fullLines.map(constructorLineName).join(', ') || 'none'}. Selected: ${constructorLineRef(sel)}.`;

  return (
    <LessonPage id="gas/7.1">
      <P>
        <a href={lessonHref('gas/6.5')}>Chapter 6</a> took the region as given and traded on what it could see. The capstone hands the region over. It is now Year 9,
        the year after the history ends, and the region has kept changing in the directions it was going. Ridgeback’s{' '}
        <K tone="orange">production</K> has reached {bcfd(PRODUCTION)}, up from {bcfd(N.y1.ridgeback)} in Year 1; Sandhill’s has slipped to{' '}
        {bcfd(CAPSTONE_CONDITIONS.sandhill)}; Bayport’s terminal takes {bcfd(CAPSTONE_CONDITIONS.lngBcfd, 1)} of feed gas; and the region’s own demand is{' '}
        {pct(CAPSTONE_CONDITIONS.demandScale - 1)} above Year 1’s. The network is the one Chapter 6 ended with: the six pipelines, the two storage fields, and Ridgeback
        Express carrying {bcfd(systemCapacity(AS_BUILT)['ridgeback-calder'], 1)} since its expansion in Year 6, which in the pipeline designs of{' '}
        <a href={lessonHref('gas/3.1')}>Lesson 3.1</a> is a third compressor station on its 42-inch pipe.
      </P>
      <P>
        In this chapter the network is yours. You can change it with Lesson 3.1’s tools — any corridor, any pipe size, one to five stations — at Lesson 3.1’s prices:
        added stations on a line kept at its size cost only their horsepower, and a different size or an empty corridor means laying a whole new pipe. Whatever you
        build is kept in this browser, and the rest of the chapter runs on it: its market through a year in Lesson 7.2, its forecasts in 7.3, a trading portfolio in
        7.4 and a tournament in 7.5.
      </P>
      <P>
        Two tests from earlier chapters decide whether the network is fit for Year 9. The first is whether Ridgeback’s gas can get out. The basin’s{' '}
        <b>takeaway</b> is what its pipes can carry away — Ridgeback Express, the Coastal Line and any line to Sandhill — plus the {bcfd(0.1, 1)} burned in the
        field itself, and when production outgrows it the basin’s <K c="price">basis</K> collapses (<a href={lessonHref('gas/5.1')}>Lesson 5.1</a>,{' '}
        <a href={lessonHref('gas/6.3')}>Lesson 6.3</a>). The second is whether Metro gets through its coldest morning, the design day of Lesson 3.1. Ours is the
        coldest morning in the eight practice winters the next lessons run: {N.date} of the {ORDINAL[N.winter] || fmt(N.winter)} winter, a mean of{' '}
        <K tone="teal">{fmt(N.morning.tempF, 1)} °F</K>, with Salt Flat holding {bcf(N.morning.storage.saltflat)} and Hollow Creek{' '}
        {bcf(N.morning.storage.hollowcreek)} as the network as built left them. The day clears as every day of Chapter 4 did, with storage offering its gas at its
        water value.
      </P>
      <P>
        In the next demonstration the map shows your network on that morning. Each circle holds a place’s <K c="price">price</K>; each line’s width is its size and
        its color how full it runs. Click a line or an empty corridor, then change its pipe size and its number of compressor stations:
      </P>

      <Figure name="Gas System Constructor" onReset={resetGasSystem}>
        <GasMap
          ariaLabel={mapLabel}
          flows={day.flow}
          capacities={caps}
          built={built}
          sizes={sizesDrawn}
          showCorridors
          nodeInfo={(id) => {
            const cut = k.cutAt[id];
            return {
              value: gp(day.price[id], day.price[id] >= 99.5 ? 0 : 2),
              sub: cut > 1e-6 ? `${fmt(cut, 2)} cut` : '$/MMBtu',
              fill: cut > 1e-6 ? '#f6d5d0' : '#fff',
            };
          }}
          storage={(id) => `withdrawing ${fmt(withdrawal(id), 2)} Bcf/d`}
          selected={{ kind: 'pipe', id: sel }}
          onPipeClick={setSel}
        />
        <Legend items={LEGEND} />
        <Readouts
          items={[
            { label: 'capital added', value: money(k.cost.added), tone: 'green' },
            { label: 'its charge a year', value: money(k.cost.annual), tone: 'green' },
            { label: 'Ridgeback / takeaway, Bcf/d', value: `${fmt(k.production, 2)} / ${fmt(k.takeaway, 2)}`, tone: glutClear ? 'orange' : 'red' },
            { label: 'homes without gas, design morning', value: k.homesCut > 0 ? bcfd(k.homesCut) : 'none', tone: k.homesCut > 0 ? 'red' : 'ink' },
          ]}
        />
        <Caption>{selText}</Caption>
        <Segmented
          label={`Pipe size on ${constructorLineRef(sel)}`}
          value={String(selSize)}
          onChange={setSize}
          options={[{ value: '0', label: 'None' }, ...PIPE_SIZES.map((s) => ({ value: String(s), label: `${s} in` }))]}
        />
        <Slider
          label="Compressor stations"
          tone="red"
          value={selStations}
          min={1}
          max={5}
          disabled={!selSize}
          onChange={setStations}
          display={selSize ? `${selStations}, every ${fmt(selCorridor.lengthMi / selStations)} miles` : 'no pipe'}
        />
      </Figure>

      <P>
        As built, the network fails both tests. Ridgeback produces {bcfd(N.k.production)} and its pipes and field take {bcfd(N.k.takeaway)}: a sliver of gas too
        much, but a sliver is all it takes. With nowhere to go, the last molecule sells for what it costs to produce, and on the design morning Ridgeback’s price sits at
        its producers’ {gp(N.k.day.price.ridgeback)} while Calder pays {gp(N.k.day.price.calder)}. Lesson 6.3’s Year 5 began the same way, with production a few
        hundredths of a Bcf/d past the takeaway.
      </P>
      <P>
        Metro’s morning is worse. Northline and the Valley Line are full; Hollow Creek, down to {bcf(N.morning.storage.hollowcreek, 0)} of working gas, can withdraw only{' '}
        {bcfd(N.hollowWd)} at its falling pressure (<a href={lessonHref('gas/3.4')}>Lesson 3.4</a>). So Metro’s demand gives way in the order of{' '}
        <a href={lessonHref('gas/4.1')}>Lesson 4.1</a>: its power plants switch {bcfd(N.powerOff)} to coal and oil, its industry shuts down {bcfd(N.industryOff)},
        its interruptible customers lose {bcfd(N.interruptibleOff)} — and still {bcfd(N.k.homesCut)} of the {bcfd(N.homesDemand)} its homes need doesn’t arrive, and
        the price goes to the {gp(N.k.day.price.metro, 0)} that rationing costs (<a href={lessonHref('gas/5.5')}>Lesson 5.5</a>). Meanwhile Bayport loads{' '}
        {bcfd(N.lng, 1)} onto LNG ships, because no pipe runs from Bayport to Metro: the shortage sits behind a cut (<a href={lessonHref('gas/3.2')}>Lesson 3.2</a>),
        and gas on the wrong side of it can’t help.
      </P>

      <H2>Steel or compression</H2>
      <P>
        Lesson 3.1 found that when compression can relieve a constraint, it is far cheaper than steel. In the next demonstration, each bar is the cheapest single
        change on one corridor that passes one of the tests, starting from the network as built; corridors where no change of size or stations will do say so. Choose the
        test:
      </P>

      <Figure name="Gas System Constructor · the cheapest fixes" scenario={f}>
        <Segmented
          label="Test"
          value={problem}
          onChange={(v) => f.set({ problem: v as ConstructorProblem })}
          options={[
            { value: 'glut', label: 'Ridgeback’s gas gets out' },
            { value: 'design', label: 'Metro’s homes keep their gas' },
          ]}
        />
        <FixBars problem={problem} />
        <Readouts
          items={[
            { label: 'cheapest fix', value: `${cap1(constructorFixText(best))} on ${constructorLineRef(best.id)}`, tone: 'ink' },
            { label: 'capital', value: money(best.cost), tone: 'green' },
            { label: 'a year', value: money(best.cost * CAPITAL_CHARGE), tone: 'green' },
            { label: 'line capacity', value: `${fmt(best.before, 2)} → ${fmt(best.after, 2)} Bcf/d`, tone: 'orange' },
          ]}
        />
      </Figure>

      <P>
        Ridgeback needs only a few hundredths of a Bcf/d more takeaway, and the smallest step that provides it wins: a {ORDINAL[N.glut.stations]} station on{' '}
        {constructorLineRef(N.glut.id)}, {money(N.glut.cost)}, lifts the line from {bcfd(N.glut.before)} to {bcfd(N.glut.after)}. A{' '}
        {ORDINAL[N.expressFix.stations]} station on Ridgeback Express would add far more than needed for {money(N.expressFix.cost)}, and a new pipe from Ridgeback to
        Sandhill costs {money(fixesCost('glut', 'ridgeback-sandhill'))}. Metro needs more. A fourth station on the Valley Line — the answer to Lesson 3.1’s challenge —
        costs only {money(N.valley4.cost)} but lifts it to {bcfd(N.valley4.cap)}, which leaves {bcfd(N.valley4.cut)} of homes short; the fifth that finishes the job
        brings the bill to {money(N.design.cost)}, because each station adds less than the one before (<a href={lessonHref('gas/1.4')}>Lesson 1.4</a>). A fourth
        station on Northline costs {money(N.northFix.cost)}, and the cheapest new pipe up the coast from Bayport {money(N.bayMetro.cost)}. Every fix for Metro is a fix
        to the pipes into Metro, and every fix for Ridgeback a fix to the pipes out of Ridgeback: no single change passes both tests.
      </P>
      <P>
        Now build it. Back in <FigRef to="Gas System Constructor">the first demonstration</FigRef>, find the cheapest network that passes both:
      </P>

      <Challenge
        id="a"
        figure="Gas System Constructor"
        question="Keeping every line already in the ground, find the least capital that leaves no Ridgeback gas stranded and keeps every Metro home supplied on the design morning."
        solved={constructorSolved(system)}
        status={status}
        success={`Solved: ${money(N.least)}, or ${money(N.least * CAPITAL_CHARGE)} a year — ${constructorFixText(N.glut)} on ${constructorLineRef(N.glut.id)} for Ridgeback and ${constructorFixText(N.design)} on ${constructorLineRef(N.design.id)} for Metro. On the design morning Metro’s price falls to ${gp(N.bothMetro)}, the value of the industry that still gives way, and Ridgeback’s rises to ${gp(N.bothRidgeback)}. The two tests sit behind different cuts, so the cheapest network is simply the two cheapest fixes together.`}
      />

      <H2>What the network is for</H2>
      <P>
        The cheapest network that passes both tests costs {money(N.least * CAPITAL_CHARGE)} a year, at Lesson 3.1’s {pct(CAPITAL_CHARGE, 1)} capital charge. Whether
        that is a lot depends on what it buys, and one morning can’t say. Passing the design-day test keeps homes supplied on the coldest morning in eight winters, and
        what the extra pipe does on the other days is a question for the market. Clearing the glut lifts Ridgeback’s producers out of the kind of basis that cost them
        dollars per MMBtu through Lesson 6.3’s Year 5. Nor is the cheapest network the only sensible one. A bigger build costs more and leaves fewer full pipes,
        narrower basis and calmer prices, which suits the people who burn gas and earns less for whoever holds capacity on the pipes that used to be full; a smaller
        one does the reverse.
        That is a trade-off between the capital charge and what happens in the market every day of the year — and the next lesson shows what happens.
      </P>
      <P>
        Leave the network as you want it for the rest of the chapter; the reset button brings back the network as built. In{' '}
        <a href={lessonHref('gas/7.2')}>the next lesson</a> it runs through eight practice winters, day by day, with the operators planning their storage around it and
        the market pricing every place on it, and we’ll see who your pipes made richer and who poorer.
      </P>
    </LessonPage>
  );
}

/** The cheapest fix for a problem on one corridor's capital, $ (NaN if none). */
function fixesCost(p: ConstructorProblem, id: string): number {
  return constructorFixes()[p].find((r) => r.id === id)?.best?.cost ?? NaN;
}
