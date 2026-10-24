import { useDeferredValue, useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  DataTable,
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
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  pct,
  useScenario,
} from '../../../framework';
import {
  AS_BUILT,
  PASSIVE,
  PRACTICE_SEEDS,
  RIVALS,
  TOURNAMENT_SEEDS,
  portfolioYear,
  systemCost,
  systemKey,
  systemYear,
  winterColder,
  type GasSystem,
  type PortfolioSettings,
  type PortfolioYear,
  type TournamentResult,
} from '../../../engines/gas/capstone';
import { CORRIDORS, GAS_NODE, PIPELINE, STORAGE_SPECS } from '../../../model/gas/world';
import { useGasCapstone } from '../shared/capstone';
import { XYChart } from '../shared/XYChart';
import { bcf, money } from '../shared/format';

// ---------------------------------------------------------------------------
// The tournament: the reader's portfolio and the rival desks over winters no lesson has shown.

export type TournamentWinters = 'unseen' | 'practice';
export type TournamentNetwork = 'yours' | 'built';
export type TournamentPart = 'storage' | 'firm' | 'toll' | 'weather' | 'metro';
export const TOURNAMENT_PARTS: TournamentPart[] = ['storage', 'firm', 'toll', 'weather', 'metro'];

/** Figure 1: which winters, which network, and the rival drawn beside the reader's portfolio. */
export const TOURNAMENT_DEFAULTS = { winters: 'unseen' as TournamentWinters, network: 'yours' as TournamentNetwork, rival: 'storage' };
export type TournamentState = typeof TOURNAMENT_DEFAULTS;
/** Figure 2: the parts of the portfolio kept. */
export const KEEP_DEFAULTS: Record<TournamentPart, boolean> = { storage: true, firm: true, toll: true, weather: true, metro: true };

const PART_COLOR: Record<TournamentPart, string> = {
  storage: GRAPHIC.gold,
  firm: GRAPHIC.orange,
  toll: GRAPHIC.red,
  weather: GRAPHIC.teal,
  metro: GRAPHIC.green,
};

/** A part's name in the reader's portfolio. */
export function tournamentPartName(part: TournamentPart, p: PortfolioSettings): string {
  if (part === 'storage') return p.storageHedged ? 'hedged storage lease' : 'unhedged storage lease';
  if (part === 'firm') return `firm capacity on ${PIPELINE[p.firmLine].name}`;
  if (part === 'toll') return 'Lakeside toll';
  if (part === 'weather') return 'weather trades';
  return 'sale of Metro’s basis';
}

/** "the hedged storage lease": a part's name in a sentence. */
function partPhrase(part: TournamentPart, p: PortfolioSettings): string {
  return `the ${tournamentPartName(part, p)}`;
}

/** A desk's name in a sentence. */
export function deskPhrase(id: string): string {
  const names: Record<string, string> = {
    yours: 'your portfolio',
    storage: 'the hedged storage desk',
    gambler: 'the unhedged storage desk',
    insurer: 'the Metro insurance seller',
    forecaster: 'the weather desk',
    shipper: 'the Northline shipper',
    passive: 'the passive desk',
  };
  return names[id] ?? id;
}

function ordinal(n: number): string {
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
  return words[n - 1] ?? `${fmt(n)}th`;
}

/** The parts the portfolio actually holds. */
export function activeParts(p: PortfolioSettings): TournamentPart[] {
  return TOURNAMENT_PARTS.filter((part) => {
    if (part === 'storage') return p.storageShare > 0;
    if (part === 'firm') return p.firmMMBtuD > 0;
    if (part === 'toll') return p.toll;
    if (part === 'weather') return p.weatherLots > 0 && p.skill > 0;
    return p.metroSellMMBtuD > 0;
  });
}

/** The portfolio with only the `kept` parts. */
export function withParts(p: PortfolioSettings, kept: TournamentPart[]): PortfolioSettings {
  const k = new Set(kept);
  return {
    ...p,
    storageShare: k.has('storage') ? p.storageShare : 0,
    firmMMBtuD: k.has('firm') ? p.firmMMBtuD : 0,
    toll: k.has('toll') ? p.toll : false,
    weatherLots: k.has('weather') ? p.weatherLots : 0,
    metroSellMMBtuD: k.has('metro') ? p.metroSellMMBtuD : 0,
  };
}

export interface TournamentRun {
  seeds: number[];
  years: PortfolioYear[];
  /** Each winter's degree-days colder than normal over November–March (negative = milder). */
  colder: number[];
  result: TournamentResult;
}

const runCache = new Map<string, TournamentRun>();

/** A portfolio over a set of winters on a network (cached), with each winter's severity. */
export function tournamentRun(s: GasSystem, p: PortfolioSettings, which: TournamentWinters): TournamentRun {
  const seeds = which === 'unseen' ? TOURNAMENT_SEEDS : PRACTICE_SEEDS;
  const key = `${systemKey(s)}#${JSON.stringify(p)}#${which}`;
  const hit = runCache.get(key);
  if (hit) return hit;
  const years = seeds.map((seed) => portfolioYear(s, seed, p));
  const totals = years.map((y) => y.total);
  const result: TournamentResult = {
    totals,
    mean: totals.reduce((a, b) => a + b, 0) / totals.length,
    worst: Math.min(...totals),
    best: Math.max(...totals),
    winRate: totals.filter((t) => t > 0).length / totals.length,
    peakCapital: Math.max(...years.map((y) => y.peakCapital)),
  };
  const r: TournamentRun = { seeds, years, colder: seeds.map((seed) => winterColder(systemYear(s, seed).weather)), result };
  if (runCache.size > 400) runCache.clear();
  runCache.set(key, r);
  return r;
}

export interface Desk {
  id: string;
  name: string;
  settings: PortfolioSettings;
  run: TournamentRun;
  /** Average winter ÷ most cash needed (null for a desk that needs none). */
  perCash: number | null;
}

/** The reader's portfolio, the five rival desks and the passive desk over a set of winters on a network. */
export function tournamentDesks(s: GasSystem, p: PortfolioSettings, which: TournamentWinters): Desk[] {
  const list = [{ id: 'yours', name: 'Your portfolio', settings: p }, ...RIVALS, { id: 'passive', name: 'Passive (no positions)', settings: PASSIVE }];
  return list.map((d) => {
    const run = tournamentRun(s, d.settings, which);
    return { ...d, run, perCash: run.result.peakCapital > 0 ? run.result.mean / run.result.peakCapital : null };
  });
}

/** Each part's total over a set of winters, $ (parts are run independently, so they add up to the whole). */
export function partTotals(run: TournamentRun): Record<TournamentPart, number> {
  const out = { storage: 0, firm: 0, toll: 0, weather: 0, metro: 0 } as Record<TournamentPart, number>;
  for (const y of run.years) for (const part of TOURNAMENT_PARTS) out[part] += y[part].total;
  return out;
}

/** The parts the portfolio holds that made money over the eight practice winters. */
export function practiceKeepers(s: GasSystem, p: PortfolioSettings): TournamentPart[] {
  const t = partTotals(tournamentRun(s, p, 'practice'));
  return activeParts(p).filter((part) => t[part] > 0);
}

/** The challenge: keep exactly the held parts that made money over the practice winters. */
export function tournamentSolved(keep: Record<TournamentPart, boolean>, s: GasSystem, p: PortfolioSettings): boolean {
  const want = new Set(practiceKeepers(s, p));
  return activeParts(p).every((part) => keep[part] === want.has(part));
}

/** The reader's network in words: "the network as built" or its changes. */
export function tournamentNetworkWords(s: GasSystem): string {
  const c = systemCost(s);
  if (!c.changed.length) return 'the network as built';
  const parts = c.changed.map((id) => {
    const corridor = CORRIDORS.find((k) => k.id === id)!;
    const name = PIPELINE[id]?.name ?? `a ${GAS_NODE[corridor.from].name}–${GAS_NODE[corridor.to].name} line`;
    return s.sizes[id] ? `${name} at ${s.sizes[id]} inches with ${s.stations[id]} station${s.stations[id] === 1 ? '' : 's'}` : `${name} taken out`;
  });
  return `your network from Lesson 7.1 (${parts.join('; ')}, ${money(c.added)} of capital)`;
}

/** The reader's portfolio in words. */
export function tournamentPortfolioWords(p: PortfolioSettings): string {
  const parts: string[] = [];
  if (p.storageShare > 0) parts.push(`a lease of ${bcf(p.storageShare * STORAGE_SPECS.saltflat.workingBcf, 1)} of Salt Flat, ${p.storageHedged ? 'hedged' : 'unhedged'}`);
  if (p.firmMMBtuD > 0) parts.push(`${fmt(p.firmMMBtuD)} MMBtu a day of firm capacity on ${PIPELINE[p.firmLine].name}`);
  if (p.toll) parts.push('a toll on Lakeside');
  const skill = fmt(p.skill, Math.round(p.skill * 100) % 10 === 0 ? 1 : 2);
  if (p.weatherLots > 0 && p.skill > 0)
    parts.push(`weather trades of ${fmt(p.weatherLots)} lots whenever a forecast with skill ${skill} is more than ${fmt(p.weatherThresholdF, 1)} °F from normal`);
  if (p.metroSellMMBtuD > 0) {
    const skip =
      p.metroSkipColderF === null
        ? ' every winter month'
        : Math.abs(p.metroSkipColderF) < 0.05
          ? ', standing aside whenever the forecast is colder than normal'
          : `, standing aside when the forecast is ${p.metroSkipColderF > 0 ? `more than ${fmt(p.metroSkipColderF, 1)} °F colder than normal` : `less than ${fmt(-p.metroSkipColderF, 1)} °F warmer than normal`}`;
    parts.push(`${fmt(p.metroSellMMBtuD)} MMBtu a day of Metro’s winter basis sold${skip}`);
  }
  if (!parts.length) return 'no positions at all';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]}`;
}

function sameNetwork(a: GasSystem, b: GasSystem): boolean {
  return systemKey(a) === systemKey(b);
}

/** "$1.2M", "−$310k": short money for chart labels. */
function short(x: number): string {
  const a = Math.abs(x);
  if (a < 500) return '$0';
  const s = a >= 1e6 ? `$${fmt(a / 1e6, 1)}M` : `$${fmt(a / 1e3)}k`;
  return x < 0 ? `−${s}` : s;
}

/** "$1.10M", "−$289k", "$0": money for the leaderboard's narrow columns. */
function cell(x: number): string {
  const a = Math.abs(x);
  if (a < 500) return '$0';
  const s = a >= 1e6 ? `$${fmt(a / 1e6, 2)}M` : `$${fmt(a / 1e3)}k`;
  return x < 0 ? `−${s}` : s;
}

/** Degree-days colder (+) or warmer (−) than normal. */
function dd(x: number): string {
  return `${x >= 0.5 ? '+' : x <= -0.5 ? '−' : ''}${fmt(Math.abs(x))}`;
}

function colderWords(x: number): string {
  return `${fmt(Math.abs(x))} degree days ${x >= 0 ? 'colder' : 'warmer'} than normal`;
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function word(n: number): string {
  return WORDS[n] ?? fmt(n);
}

function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Figure 2's chart: each unseen winter's profit, part by part, mildest to coldest.

function PartsChart({ run, p, kept, keptTotals }: { run: TournamentRun; p: PortfolioSettings; kept: TournamentPart[]; keptTotals: number[] }) {
  const parts = activeParts(p);
  const order = run.colder.map((c, i) => ({ c, i })).sort((a, b) => a.c - b.c);
  const W = 640;
  const left = 64;
  const right = W - 12;
  const top = 16;
  const bottom = 214;
  const stacks = run.years.map((y) => {
    let up = 0;
    let down = 0;
    return parts.map((part) => {
      const v = y[part].total;
      const seg = v >= 0 ? { part, from: up, to: up + v } : { part, from: down + v, to: down };
      if (v >= 0) up += v;
      else down += v;
      return seg;
    });
  });
  const lo = Math.min(0, ...stacks.map((st) => Math.min(0, ...st.map((x) => x.from))), ...keptTotals);
  const hi = Math.max(0, ...stacks.map((st) => Math.max(0, ...st.map((x) => x.to))), ...keptTotals);
  const [y0, y1] = niceDomain(lo, hi, 5);
  const y = (v: number) => bottom - ((v - y0) / (y1 - y0)) * (bottom - top);
  const col = (right - left) / order.length;
  const ticks = niceTicks(y0, y1, 5);
  const label = order.map(({ c, i }) => `${colderWords(c)}: ${money(run.years[i].total)} in all, ${money(keptTotals[i])} from the parts kept`).join('; ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} 262`} role="img" aria-label={`Each unseen winter’s profit, part by part, from the mildest to the coldest. ${label}.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={Math.abs(t) < 1e-9 ? '#9a9a9a' : '#e4e1d8'} strokeWidth={1} />
          <text className="ax ax-e" x={left - 6} y={y(t) + 4}>
            {short(t)}
          </text>
        </g>
      ))}
      {order.map(({ c, i }, k) => {
        const cx = left + col * (k + 0.5);
        const bw = col * 0.56;
        return (
          <g key={run.seeds[i]}>
            {stacks[i].map((seg) =>
              Math.abs(seg.to - seg.from) < 1 ? null : (
                <rect
                  key={seg.part}
                  x={cx - bw / 2}
                  y={y(seg.to)}
                  width={bw}
                  height={Math.max(1, y(seg.from) - y(seg.to))}
                  fill={PART_COLOR[seg.part]}
                  opacity={kept.includes(seg.part) ? 1 : 0.28}
                />
              ),
            )}
            <circle cx={cx} cy={y(keptTotals[i])} r={4.5} fill={TEXT.ink} stroke="#fff" strokeWidth={1.5} />
            <text x={cx} y={234} textAnchor="middle" style={{ fontSize: 12, fill: TEXT.teal }}>
              {dd(c)}
            </text>
          </g>
        );
      })}
      <text className="ax ax-e" x={left - 6} y={234} style={{ fill: TEXT.teal }}>
        winter
      </text>
      <text className="ax" x={left} y={254} style={{ fill: TEXT.gray }}>
        degree days colder (+) or warmer (−) than normal, November–March
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const cap = useGasCapstone();
  const yours = cap.system;
  const p = cap.portfolio;
  const changed = !sameNetwork(yours, AS_BUILT);
  const networkWords = tournamentNetworkWords(yours);
  const held = activeParts(p);

  // ---- Figure 1.
  const f = useScenario('tournament', TOURNAMENT_DEFAULTS);
  const fs = useDeferredValue(f.state);
  const net = fs.network === 'built' ? AS_BUILT : yours;
  const desks = useMemo(() => tournamentDesks(net, p, fs.winters), [net, p, fs.winters]);
  const me = desks[0];
  const rival = desks.find((d) => d.id === f.state.rival) ?? desks[1];
  const others = desks.slice(1);
  const allTotals = desks.flatMap((d) => d.run.result.totals);
  const [ylo, yhi] = niceDomain(Math.min(0, ...allTotals) / 1e6, Math.max(0, ...allTotals) / 1e6, 5);
  const rank = 1 + desks.filter((d) => d.id !== 'yours' && d.run.result.mean > me.run.result.mean).length;
  const ranked = [...desks].sort((a, b) => b.run.result.mean - a.run.result.mean);

  // ---- Numbers for the prose: always the reader's network and portfolio, unseen and practice winters.
  const unseen = useMemo(() => tournamentDesks(yours, p, 'unseen'), [yours, p]);
  const practice = useMemo(() => tournamentRun(yours, p, 'practice'), [yours, p]);
  const U = unseen[0].run;
  const uMean = U.result.mean;
  const uRank = 1 + unseen.filter((d) => d.id !== 'yours' && d.run.result.mean > uMean).length;
  const worstI = U.result.totals.indexOf(U.result.worst);
  const bestI = U.result.totals.indexOf(U.result.best);
  const rivalsU = unseen.filter((d) => d.id !== 'yours' && d.id !== 'passive');
  const byId = Object.fromEntries(unseen.map((d) => [d.id, d])) as Record<string, Desk>;
  const storageDesk = byId.storage?.run.result;
  const gambler = byId.gambler?.run.result;
  const insurer = byId.insurer?.run.result;
  const forecaster = byId.forecaster;
  const shipper = byId.shipper?.run.result;
  const bestPerCash = [...unseen.filter((d) => d.perCash !== null)].sort((a, b) => (b.perCash ?? 0) - (a.perCash ?? 0))[0];
  const steadiest = [...rivalsU, unseen[0]].sort((a, b) => b.run.result.worst - a.run.result.worst)[0];
  const n = TOURNAMENT_SEEDS.length;
  const won = (r: TournamentResult) => Math.round(r.winRate * r.totals.length);
  const meanColder = (run: TournamentRun) => run.colder.reduce((a, b) => a + b, 0) / run.colder.length;
  const unseenColder = meanColder(U);
  const practiceColder = meanColder(practice);

  // ---- Figure 2.
  const g = useScenario('tournament-parts', KEEP_DEFAULTS);
  const keep = g.state;
  const kept = held.filter((part) => keep[part]);
  const keptUnseen = useMemo(() => tournamentRun(yours, withParts(p, kept), 'unseen'), [yours, p, kept.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const keptPractice = useMemo(() => tournamentRun(yours, withParts(p, kept), 'practice'), [yours, p, kept.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const keptTotals = keptUnseen.result.totals;
  const partsU = partTotals(U);
  const partsP = partTotals(practice);
  const keepers = practiceKeepers(yours, p);
  const solved = tournamentSolved(keep, yours, p);
  const keepersRun = tournamentRun(yours, withParts(p, keepers), 'unseen');
  const dropped = held.filter((part) => !keepers.includes(part));
  const droppedUnseen = dropped.reduce((a, part) => a + partsU[part], 0);
  // The insurance-like parts: what pays when the winter is cold.
  const coldIdx = U.colder.map((c, i) => ({ c, i })).filter((x) => x.c > 0).map((x) => x.i);
  const mildIdx = U.colder.map((c, i) => ({ c, i })).filter((x) => x.c <= 0).map((x) => x.i);
  const avgOver = (idx: number[], part: TournamentPart) => (idx.length ? idx.reduce((a, i) => a + U.years[i][part].total, 0) / idx.length : 0);
  const practiceColdCount = practice.colder.filter((c) => c > 0).length;
  const unseenColdCount = coldIdx.length;
  const bothWays = held.filter((part) => partsP[part] > 0 && partsU[part] > 0);

  const status = !held.length
    ? 'Your portfolio holds nothing yet: set one up in Lesson 7.4.'
    : `Kept: ${kept.length ? list(kept.map((part) => tournamentPartName(part, p))) : 'nothing'}. Over the practice winters these made ${money(keptPractice.result.totals.reduce((a, b) => a + b, 0))}.`;

  const deskRows = ranked.map((d) => d);

  return (
    <LessonPage id="gas/7.5">
      <P>
        <a href={lessonHref('gas/7.4')}>The previous lesson</a> put a portfolio together on your network and ran it through the eight practice winters, the same
        winters <a href={lessonHref('gas/7.2')}>Lesson 7.2</a> ran your market through. Every choice in it was made by someone who could see those winters. That is
        the trap of <a href={lessonHref('gas/6.5')}>Lesson 6.5</a>: a strategy tuned on the history it is scored on almost always looks good. The only fair
        verdict comes from winters it has never seen. This lesson holds a tournament on {word(n)} of them — Year 9, the same region, the same market that made
        Chapter 6’s history, and weather that no lesson has shown. As everywhere in this course, the prices are simulated.
      </P>
      <P>
        The network running is <a href={lessonHref('gas/7.1')}>{networkWords}</a>, and the portfolio is <a href={lessonHref('gas/7.4')}>yours</a>:{' '}
        {tournamentPortfolioWords(p)}. Five rival desks play the same winters on the same network, each with one of Chapter 6’s strategies alone: a storage desk
        holding a hedged lease of {bcf(RIVALS[0].settings.storageShare * STORAGE_SPECS.saltflat.workingBcf, 1)}, a desk holding the same lease unhedged, a desk
        that sells Metro’s winter <K c="price">basis</K> every month without looking at the forecast, a weather desk, and a shipper with firm capacity on
        Northline. A passive desk holds nothing and makes nothing; any strategy has to beat it after its costs. The rules are Chapter 6’s. A storage lease, firm
        capacity and a toll cost what April 1’s curve said they were worth, so a desk earns only what it adds to the market’s own valuation (
        <a href={lessonHref('gas/6.4')}>Lesson 6.4</a>); futures and swaps pay their fees and tie up margin. If you go back to Lesson 7.4 and change the
        portfolio after seeing these winters, the tournament stops being a test and becomes another backtest.
      </P>
      <P>
        In the next demonstration, each dot is one desk’s profit in one winter, set against how much colder (to the right) or milder (to the left) than normal
        that winter was. Your portfolio is in black and the rival you choose in green; the others are gray. The table ranks the desks by their average winter.
        Switch to the practice winters to see how the same desks did on the winters you could see, and to the network as built to see what your network changed:
      </P>

      <Figure name="Gas Trading Tournament" scenario={f}>
        <Segmented
          label="Winters"
          value={f.state.winters}
          onChange={(v) => f.set({ winters: v })}
          options={[
            { value: 'unseen', label: `${word(n)} unseen winters` },
            { value: 'practice', label: `${word(PRACTICE_SEEDS.length)} practice winters` },
          ]}
        />
        <Segmented
          label="Network"
          value={f.state.network}
          onChange={(v) => f.set({ network: v })}
          options={[
            { value: 'yours', label: changed ? 'Your network' : 'Your network (as built)' },
            { value: 'built', label: 'The network as built' },
          ]}
        />
        <Segmented label="Rival" value={f.state.rival} onChange={(v) => f.set({ rival: v })} options={RIVALS.map((r) => ({ value: r.id, label: r.name }))} />
        <XYChart
          xDomain={[-600, 700]}
          yDomain={[ylo, yhi]}
          xTicks={[-600, -400, -200, 0, 200, 400, 600]}
          yTicks={niceTicks(ylo, yhi, 5)}
          xFormat={(v) => (v > 0 ? `+${fmt(v)}` : fmt(v))}
          yFormat={(v) => (Math.abs(v) < 1e-9 ? '$0' : v < 0 ? `−$${fmt(-v, 1)}M` : `$${fmt(v, 1)}M`)}
          yLabel="Profit in the winter, after fees"
          xLabel="Degree days colder (+) or warmer (−) than normal, November–March"
          height={260}
          hLines={[{ at: 0, color: '#9a9a9a', width: 1 }]}
          vLines={[{ at: 0, color: '#d8d4c8', dash: '3 3', width: 1 }]}
          series={[
            ...others
              .filter((d) => d.id !== rival.id)
              .map((d) => ({ xs: d.run.colder, ys: d.run.result.totals.map((t) => t / 1e6), color: '#b3b0a7', kind: 'points' as const, r: 2.5 })),
            { xs: rival.run.colder, ys: rival.run.result.totals.map((t) => t / 1e6), color: GRAPHIC.green, kind: 'points' as const, r: 4 },
            { xs: me.run.colder, ys: me.run.result.totals.map((t) => t / 1e6), color: TEXT.ink, kind: 'points' as const, r: 5 },
          ]}
          ariaLabel={`Each desk’s profit in each of the ${fs.winters === 'unseen' ? 'unseen' : 'practice'} winters on ${fs.network === 'built' ? 'the network as built' : 'your network'}. Your portfolio averages ${money(me.run.result.mean)}, worst ${money(me.run.result.worst)}; ${rival.name} averages ${money(rival.run.result.mean)}, worst ${money(rival.run.result.worst)}.`}
        />
        <Legend
          items={[
            { label: 'your portfolio', color: TEXT.ink },
            { label: rival.name, color: GRAPHIC.green },
            { label: 'other desks', color: '#b3b0a7' },
          ]}
        />
        <DataTable
          caption={`The desks over the ${fs.winters === 'unseen' ? 'unseen' : 'practice'} winters, ranked by their average winter`}
          columns={[
            { label: 'Desk', cell: (d: Desk) => d.name },
            { label: 'average', cell: (d) => cell(d.run.result.mean), align: 'right' },
            { label: 'worst', cell: (d) => cell(d.run.result.worst), align: 'right' },
            { label: 'in profit', cell: (d) => `${won(d.run.result)}/${d.run.result.totals.length}`, align: 'right' },
            { label: 'cash needed', cell: (d) => cell(d.run.result.peakCapital), align: 'right' },
            { label: 'per $ of cash', cell: (d) => (d.perCash === null ? '—' : pct(d.perCash)), align: 'right' },
          ]}
          rows={deskRows}
          rowKey={(d) => d.id}
          rowClass={(d) => (d.id === 'yours' ? 'hl' : d.id === rival.id ? '' : 'dim')}
        />
        <Readouts
          items={[
            { label: 'your average winter', value: money(me.run.result.mean), tone: 'green' },
            { label: 'your worst winter', value: money(me.run.result.worst), tone: 'green' },
            { label: `your place of ${desks.length}`, value: fmt(rank) },
            { label: 'your winters in profit', value: `${won(me.run.result)} of ${me.run.result.totals.length}` },
          ]}
        />
        <Caption>
          {fs.winters === 'unseen' ? 'The unseen winters' : 'The practice winters'} on {fs.network === 'built' ? 'the network as built' : changed ? 'your network' : 'your network, which is the network as built'}:
          your portfolio averages {money(me.run.result.mean)} a winter and ranks {ordinal(rank)} of {word(desks.length)}; {deskPhrase(rival.id)} averages{' '}
          {money(rival.run.result.mean)}, with its worst winter at {money(rival.run.result.worst)}.
        </Caption>
      </Figure>

      <P>
        Over the {word(n)} unseen winters your portfolio averages {money(uMean)} a winter,{' '}
        {uRank === 1 ? 'the best of all the desks' : `${ordinal(uRank)} of the ${word(unseen.length)} desks`}, and makes money in {word(won(U.result))} of them. Its
        best winter, {colderWords(U.colder[bestI])}, made {money(U.result.best)}; its worst, {colderWords(U.colder[worstI])},{' '}
        {U.result.worst < 0 ? `lost ${money(-U.result.worst)}` : `still made ${money(U.result.worst)}`}. On the practice winters it was built on, the same portfolio
        averaged {money(practice.result.mean)}, so the unseen winters{' '}
        {Math.abs(uMean - practice.result.mean) < 0.1 * Math.abs(practice.result.mean)
          ? 'roughly bore out what the practice had promised'
          : uMean > practice.result.mean
            ? 'paid more than the practice had promised'
            : 'paid less than the practice had promised'}
        .
      </P>
      {storageDesk && gambler && insurer && forecaster && shipper ? (
        <P>
          The rivals tell the chapter’s story again. The hedged storage desk made money in {word(won(storageDesk))} of the {word(n)} winters, averaging{' '}
          {money(storageDesk.mean)}: its hedges lock in what April’s curve offered, and redrawing the schedule each month adds to it, in almost any weather (
          <a href={lessonHref('gas/6.4')}>Lesson 6.4</a>). The same lease unhedged averaged {money(gambler.mean)} and made money in {won(gambler) <= n / 2 ? 'only ' : ''}
          {word(won(gambler))}, with a worst winter of {money(gambler.worst)}: a bet on the winter, as in <a href={lessonHref('gas/6.2')}>Lesson 6.2</a>. The desk
          that sold Metro’s basis without a forecast averaged {money(insurer.mean)}, and the shipper holding firm Northline {money(shipper.mean)} — the two sides of
          one insurance policy against full pipes into the city, priced with the premium the market learned from Chapter 6’s history (
          <a href={lessonHref('gas/6.3')}>Lesson 6.3</a>). The weather desk made {money(forecaster.run.result.mean)} a winter and never needed more than{' '}
          {money(forecaster.run.result.peakCapital)}. Measured against the cash each desk had to keep on hand, the order changes: {deskPhrase(bestPerCash.id)} earned
          the most for each dollar tied up, {pct(bestPerCash.perCash ?? 0)} of it a winter, and {deskPhrase(steadiest.id)} had the best worst winter,{' '}
          {money(steadiest.run.result.worst)}. A large average built on a large lease needs a large balance sheet.
        </P>
      ) : null}

      <H2>What decided it</H2>
      <P>
        A portfolio’s total hides its parts. In the next demonstration, each bar is one unseen winter, from the mildest on the left to the coldest on the right,
        split into what each part of your portfolio made or lost: the storage lease in gold, firm capacity in orange, the Lakeside toll in red, the weather trades
        in teal, and the sale of Metro’s basis in green, with the parts your portfolio doesn’t hold left out. The black dot is the total of the parts you keep.
        Switch parts off to see what the portfolio would have been without them:
      </P>

      <Figure name="Gas Trading Tournament · what decided it" scenario={g}>
        {held.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px' }}>
            {held.map((part) => (
              <Checkbox
                key={part}
                label={
                  <span>
                    <span style={{ display: 'inline-block', width: 10, height: 10, background: PART_COLOR[part], marginRight: 6, borderRadius: 2 }} />
                    keep the {tournamentPartName(part, p)}
                  </span>
                }
                checked={keep[part]}
                onChange={(v) => g.set({ [part]: v } as Partial<Record<TournamentPart, boolean>>)}
              />
            ))}
          </div>
        ) : (
          <Caption>Your portfolio holds no positions yet; set one up in Lesson 7.4.</Caption>
        )}
        <PartsChart run={U} p={p} kept={kept} keptTotals={keptTotals} />
        <DataTable
          caption="Each part's total over the practice winters and the unseen winters"
          columns={[
            { label: 'Part', cell: (part: TournamentPart) => tournamentPartName(part, p).replace(/^./, (c) => c.toUpperCase()) },
            { label: `${word(PRACTICE_SEEDS.length)} practice winters`, cell: (part) => money(partsP[part]), align: 'right' },
            { label: `${word(n)} unseen winters`, cell: (part) => money(partsU[part]), align: 'right' },
          ]}
          rows={held}
          rowKey={(part) => part}
          rowClass={(part) => (keep[part] ? '' : 'dim')}
        />
        <Readouts
          items={[
            { label: 'kept parts, average practice winter', value: money(keptPractice.result.mean), tone: 'green' },
            { label: 'kept parts, average unseen winter', value: money(keptUnseen.result.mean), tone: 'green' },
            { label: 'kept parts, worst unseen winter', value: money(keptUnseen.result.worst), tone: 'green' },
            { label: 'all parts, average unseen winter', value: money(uMean), tone: 'green' },
          ]}
        />
      </Figure>

      <P>
        A fair way to decide what to keep is the walk-forward rule of Lesson 6.5: decide with what you could see, and let the winters you couldn’t see judge the
        decision. Try it:
      </P>

      <Challenge
        id="a"
        figure="Gas Trading Tournament · what decided it"
        question="Keep exactly the parts of your portfolio that made money over the eight practice winters, and switch off the rest."
        solved={solved}
        status={status}
        success={
          keepers.length
            ? `Solved: you kept ${list(keepers.map((part) => partPhrase(part, p)))}${dropped.length ? `, and dropped ${list(dropped.map((part) => partPhrase(part, p)))}, which lost ${money(-dropped.reduce((a, part) => a + partsP[part], 0))} over the practice winters` : ''}. Over the unseen winters the parts you kept average ${money(keepersRun.result.mean)} a winter, against ${money(uMean)} for the whole portfolio${dropped.length ? `: the parts you dropped ${droppedUnseen >= 0 ? `would have made ${money(droppedUnseen)}` : `would have lost ${money(-droppedUnseen)}`} on winters you hadn’t seen` : ''}. That is what a decision made on eight winters is worth on twelve others.`
            : 'Solved: none of your parts made money over the practice winters, so a trader deciding on them alone would hold nothing — and the passive desk makes nothing.'
        }
      />

      <P>
        Whether that decision helped depends on what the practice winters happened to hold.{' '}
        {word(practiceColdCount).replace(/^./, (c) => c.toUpperCase())} of the {word(PRACTICE_SEEDS.length)} practice winters were colder than normal, and the{' '}
        {word(PRACTICE_SEEDS.length)} together averaged {colderWords(practiceColder)}; {word(unseenColdCount)} of the {word(n)} unseen winters were colder than
        normal, and the {word(n)} together averaged {colderWords(unseenColder)}.{' '}
        {held.includes('firm') && p.firmLine === 'calder-metro' && coldIdx.length && mildIdx.length
          ? `Firm capacity into Metro is insurance against a cold winter: on your network it averaged ${money(avgOver(coldIdx, 'firm'))} in the unseen winters colder than normal and ${money(avgOver(mildIdx, 'firm'))} in the milder ones. `
          : ''}
        {held.includes('metro') && coldIdx.length && mildIdx.length
          ? `Selling Metro’s basis is the same insurance written the other way: ${money(avgOver(coldIdx, 'metro'))} a winter in the colder ones, ${money(avgOver(mildIdx, 'metro'))} in the milder. `
          : ''}
        The coldest practice winter was {colderWords(Math.max(...practice.colder))}; the coldest unseen one, {colderWords(Math.max(...U.colder))}. A sample of
        winters flatters whichever side of the policy it favors, and eight winters can hold too few severe ones to show what insurance is worth — the lesson of
        Metro’s fair value in Lesson 6.5, met again on a network of your own.{' '}
        {bothWays.length
          ? `On your network, the ${bothWays.length === 1 ? 'part' : 'parts'} that made money on both sets of winters ${bothWays.length === 1 ? 'was' : 'were'} ${list(bothWays.map((part) => partPhrase(part, p)))}.`
          : 'On your network, no part made money on both sets of winters.'}{' '}
        {bothWays.includes('storage') && p.storageHedged ? 'A hedged lease earns what April’s curve offered whichever winter comes. ' : ''}
        {bothWays.includes('weather') ? (
          <>
            A forecast that trades only the two weeks it can see risks little when it is wrong (<a href={lessonHref('gas/6.1')}>Lesson 6.1</a>).
          </>
        ) : null}
      </P>

      <H2>From the molecule to the trade</H2>
      <P>
        This course began with a claim: natural gas is cheap in one place and dear in another, cheap in July and dear in January, and each of those differences
        has a physical cause. We followed the gas from the molecule, whose heating value is what anyone buys (<a href={lessonHref('gas/1.1')}>Lesson 1.1</a>),
        through the rock and the well that release it and the decline that makes producers keep drilling, through pipes whose capacity is set by pressure,
        friction and compression, and into storage fields that fill all summer and can only empty so fast. Then we let a market price it all, and every price
        difference turned out to be a constraint that binds: a full pipeline between two places, a full storage field between two seasons, a field that can’t
        deliver fast enough on the coldest day. In <FigRef to="Gas Trading Tournament">the tournament</FigRef>, those same constraints decided who made money: the
        desks that owned a constraint’s value and hedged what they couldn’t forecast held up, and the ones that bet on the weather lived or died by it.
      </P>
      <P>
        What you can do now is what the tournament asked of you. Starting from production, pipelines, storage and the weather, you can say where a gas system will
        bind and roughly when; you can tell which price differences that implies, which of them the market already knows and which it might not; you can turn that
        into a hypothesis — a basin about to outgrow its pipes, a winter whose storage is running short, a city one cold week from rationing — and test it honestly,
        with its costs, its margin and winters it has never seen. Real markets are full of people who understand pipes and weather, so the edge there lies in
        understanding them a little better, a little sooner or a little more cheaply than whoever is on the other side of the trade. The physics is where that
        understanding starts. To see it from the beginning again, go back to <a href={lessonHref('gas/1.1')}>the molecule</a>.
      </P>
    </LessonPage>
  );
}
