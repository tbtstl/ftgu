import { useMemo, useState } from 'react';
import {
  Button,
  Caption,
  Challenge,
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
  Slider,
  TEXT,
  fmt,
  lessonHref,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import {
  cargoOffers,
  operate,
  planFixture,
  type CargoOffer,
  type CargoWorld,
  type CompanyShip,
  type DispatchRule,
  type Fixture,
  type OpsPolicy,
  type OpsResult,
} from '../../../engines/shipping/company';
import { PLACE } from '../../../model/shipping/geo';
import { eventAt, monthLabel, standardHistory } from '../../../model/shipping/history';
import { STARTING, confirmReset, money, partChanged, resetCompany, updateCompany, useCompany, when, type CompanyDesign } from '../shared/company';
import { CompanySoFar, ViewSwitch, fleetText, policyText, worldText, type CompanyView } from '../shared/CompanyUi';
import { CARGO_COLOR } from '../shared/tones';

const HIST = standardHistory();
const WEEK = 7;
const MONTH = 365 / 12;

const RULES: Array<{ value: DispatchRule; label: string }> = [
  { value: 'bestTce', label: 'Best TCE' },
  { value: 'nearest', label: 'Nearest cargo' },
  { value: 'bestFreight', label: 'Best freight' },
];

const perDay = (x: number) => `${usd(x)}/day`;
/** The period in words: “half-year” for the starting 26 weeks. */
const periodText = (weeks: number) => (weeks === 26 ? 'half-year' : weeks === 52 ? 'year' : `${weeks} weeks`);
const signedMoney = (x: number) => (x >= 0 ? `+${money(x)}` : money(x));
const place = (id: string) => PLACE[id]?.name ?? id;
const routeName = (c: CargoOffer) => `${place(c.route.from)}–${place(c.route.to)}`;

function pickByRule(ok: Fixture[], rule: DispatchRule): Fixture {
  if (rule === 'nearest') return ok.reduce((a, b) => (b.ballastNm < a.ballastNm || (b.ballastNm === a.ballastNm && b.tce > a.tce) ? b : a));
  if (rule === 'bestFreight') return ok.reduce((a, b) => (b.cargo.freight > a.cargo.freight ? b : a));
  return ok.reduce((a, b) => (b.tce > a.tce ? b : a));
}

export interface Decision {
  ship: string;
  day: number;
  at: string;
  /** Every cargo she could still reach in time at that moment. */
  options: Fixture[];
  chosen: Fixture;
}

/**
 * The desk's decisions, replayed step by step as operate() makes them, keeping the cargoes each
 * ship could have taken at the moment she chose. (Same loop as engines/shipping/company.operate.)
 */
export function decisionLog(ships: CompanyShip[], offers: CargoOffer[], p: OpsPolicy, world: CargoWorld): Decision[] {
  const days = world.weeks * WEEK;
  const state = ships.map((s) => ({ ship: s, at: s.at, free: s.openDay }));
  const taken = new Set<string>();
  const out: Decision[] = [];
  let guard = 0;
  while (guard++ < 2000) {
    const next = state.filter((x) => x.free < days).sort((a, b) => a.free - b.free)[0];
    if (!next) break;
    const options: Fixture[] = [];
    for (const c of offers) {
      if (taken.has(c.id) || c.cls !== next.ship.cls || c.to < next.free || c.from > next.free + 45) continue;
      const fx = planFixture(next.ship, next.at, next.free, c, p, HIST, world.start);
      if (fx) options.push(fx);
    }
    const ok = options.filter((o) => o.tce >= p.minTce);
    if (!ok.length) {
      const wait = Math.min(p.waitDays, days - next.free);
      next.free += Math.max(0.5, wait);
      continue;
    }
    const pick = pickByRule(ok, p.rule);
    taken.add(pick.cargo.id);
    out.push({ ship: next.ship.id, day: next.free, at: next.at, options, chosen: pick });
    next.at = pick.cargo.route.to;
    next.free = pick.end;
  }
  return out;
}

/** Run the desk for a whole design. */
export function runDesk(d: CompanyDesign): OpsResult {
  return operate(d.ships, cargoOffers(d.world), d.policy, d.finance, d.world);
}

// ---------------------------------------------------------------------------
// The starting company, for the prose and the challenge.

const START = STARTING;
const START_OFFERS = cargoOffers(START.world);
const runStart = (p: Partial<OpsPolicy>) => operate(START.ships, START_OFFERS, { ...START.policy, ...p }, START.finance, START.world);
const BASE = runStart({});
const NEAREST = runStart({ rule: 'nearest' });
const FREIGHT = runStart({ rule: 'bestFreight' });
const PATIENT8 = runStart({ minTce: 8_000 });
const PATIENT10 = runStart({ minTce: 10_000 });
const PATIENT12 = runStart({ minTce: 12_000 });
const QIN4 = runStart({ congestion: 4 });
const edge = (r: OpsResult) => r.profit - r.benchmark;
const fixturesOf = (r: OpsResult, id: string) => r.runs.find((x) => x.ship.id === id)!.fixtures;
const idleOf = (r: OpsResult, id: string) => r.runs.find((x) => x.ship.id === id)!.idle;
const countFixtures = (r: OpsResult) => r.runs.reduce((a, x) => a + x.fixtures.length, 0);
const LOG = decisionLog(START.ships, START_OFFERS, START.policy, START.world);
const FIRST = LOG[0];
const FIRST_BEST = FIRST.options.reduce((a, b) => (b.tce > a.tce ? b : a));
const FIRST_NEAR = FIRST.options.reduce((a, b) => (b.ballastNm < a.ballastNm || (b.ballastNm === a.ballastNm && b.tce > a.tce) ? b : a));
const ALB_DECISIONS = LOG.filter((d) => d.ship === 'albatross');
const ALB_FIRST = ALB_DECISIONS[0].chosen;
const dearest = (d: Decision) => d.options.reduce((a, b) => (b.cargo.freight > a.cargo.freight ? b : a));
const ALB_DEAR_2 = dearest(ALB_DECISIONS[1]);
// Albatross's second voyage under each rule.
const ALB_TCE_2 = fixturesOf(BASE, 'albatross')[1];
const ALB_FREIGHT_2 = fixturesOf(FREIGHT, 'albatross')[1];
const MARKET = HIST.cls.kmax.slice(START.world.start, START.world.start + Math.ceil((START.world.weeks * WEEK) / MONTH)).map((m) => m.tce);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
const word = (n: number) => WORDS[n] ?? fmt(n);
/** Kestrel's two Samarinda–Qingdao offers at her first decision, dearer first. */
const SAMQ = LOG[0].options.filter((o) => o.cargo.route.id === 'P-SAM-QIN').sort((a, b) => b.cargo.freight - a.cargo.freight);
const SANTOS = LOG[0].options.filter((o) => o.cargo.route.id === 'P-SAN-QIN').sort((a, b) => b.cargo.freight - a.cargo.freight);
const PANAMA_MONTHS = Array.from({ length: 7 }, (_, k) => START.world.start + k).filter((t) => eventAt(t)?.closed?.includes('panama')).length;

// ---------------------------------------------------------------------------
// The challenge: when does the TCE rule stop sending Kestrel to Brazil?

/** The bunker price in the starting company's first month, $/t. */
export const START_BUNKER = HIST.bunker[START.world.start];
/** Fuel per day of the ship's time on a fixture, t/day. */
export const fuelPerVoyageDay = (f: Fixture) => f.fuel / (f.end - f.depart);
/**
 * Kestrel's first decision, on day 0 in Qingdao, with bunkers fixed at a price under the starting
 * policy: every cargo she could reach, and the one with the best TCE (whether or not it clears zero).
 */
export function kestrelFirstAt(bunker: number): Decision {
  const kestrel = START.ships.find((x) => x.id === 'kestrel')!;
  const p = { ...START.policy, bunker };
  const options = START_OFFERS.filter((c) => c.cls === kestrel.cls && c.to >= kestrel.openDay && c.from <= kestrel.openDay + 45)
    .map((c) => planFixture(kestrel, kestrel.at, kestrel.openDay, c, p, HIST, START.world.start))
    .filter((x): x is Fixture => !!x);
  return { ship: kestrel.id, day: kestrel.openDay, at: kestrel.at, options, chosen: pickByRule(options, 'bestTce') };
}
/** Whether, at that price, the TCE rule still sends Kestrel to Brazil on her first voyage. */
export const goesToBrazilAt = (bunker: number) => kestrelFirstAt(bunker).chosen.cargo.route.id === 'P-SAN-QIN';
let crossoverCache: number | null = null;
/** The bunker price, to the dollar, above which Kestrel's first voyage is no longer Brazil's soybeans. */
export function brazilCrossover(): number {
  if (crossoverCache !== null) return crossoverCache;
  let lo = START_BUNKER;
  let hi = 2_000;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (goesToBrazilAt(mid)) lo = mid;
    else hi = mid;
  }
  return (crossoverCache = Math.round((lo + hi) / 2));
}
/** How close an estimate must be, $/t. */
export const ESTIMATE_TOLERANCE = 50;
export const ESTIMATE_DEFAULT = 600;
/** The challenge: a checked estimate within $50 a tonne of the crossover. */
export function estimateSolved(checked: number | null): boolean {
  return checked !== null && Math.abs(checked - brazilCrossover()) <= ESTIMATE_TOLERANCE;
}
/** Kestrel's Brazil voyage and the best coal cargo she could take instead, at the start. */
export const KESTREL_SANTOS = FIRST_BEST;
export const KESTREL_COAL = FIRST.options.filter((o) => o.cargo.route.commodity === 'coal').reduce((a, b) => (b.tce > a.tce ? b : a));

/** The company a figure runs: the starting one (with the reader's desk policy) or the reader's. */
export function companyFor(d: CompanyDesign, view: CompanyView): CompanyDesign {
  return view === 'start' ? { ...STARTING, policy: d.policy } : d;
}

// ---------------------------------------------------------------------------
// Drawing.

function commodityColor(c: CargoOffer): string {
  if (c.route.commodity === 'iron ore') return CARGO_COLOR.ore;
  if (c.route.commodity === 'coal') return CARGO_COLOR.coal;
  return CARGO_COLOR.grain;
}

const GX0 = 104;
const GX1 = 624;

function Gantt({ result, ships, days, start }: { result: OpsResult; ships: CompanyShip[]; days: number; start: number }) {
  // Rows tighten for a big fleet, so eight ships still fit.
  const ROW = ships.length > 4 ? 30 : 36;
  const end = Math.max(days, ...result.runs.map((r) => r.freeDay));
  const xMax = Math.ceil(end / 30) * 30;
  const x = (d: number) => GX0 + (Math.max(0, d) / xMax) * (GX1 - GX0);
  const top = 22;
  const height = top + ships.length * ROW + 34;
  const label = result.runs
    .map((r) => `${r.ship.name}: ${r.fixtures.length ? r.fixtures.map((f) => `${routeName(f.cargo)} from day ${fmt(f.depart)} at ${perDay(f.tce)}`).join('; ') : 'no cargo'}`)
    .join('. ');
  return (
    <svg className="chart" viewBox={`0 0 640 ${height}`} role="img" aria-label={`The operations desk’s schedule from ${monthLabel(start)} over ${fmt(days)} days. ${label}.`}>
      <text className="ax" x={GX0} y={12}>
        Days from {monthLabel(start)}
      </text>
      {Array.from({ length: xMax / 30 + 1 }, (_, i) => i * 30).map((d) => (
        <g key={d}>
          <line className="gl" x1={x(d)} x2={x(d)} y1={top - 4} y2={top + ships.length * ROW} />
          <text className="ax ax-m" x={x(d)} y={top + ships.length * ROW + 14}>
            {d}
          </text>
        </g>
      ))}
      <line x1={x(days)} x2={x(days)} y1={top - 6} y2={top + ships.length * ROW + 2} stroke="#555" strokeDasharray="4 3" />
      <text className="ax ax-e" x={x(days) - 4} y={top + ships.length * ROW + 28}>
        end of the period, day {fmt(days)}
      </text>
      {result.runs.map((r, i) => {
        const y = top + i * ROW;
        return (
          <g key={r.ship.id}>
            <text x={GX0 - 8} y={y + 15} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: TEXT.ink }}>
              {r.ship.name}
            </text>
            <text x={GX0 - 8} y={y + 28} textAnchor="end" className="ax">
              {r.ship.cls === 'cape' ? 'Capesize' : 'Kamsarmax'} · idle {fmt(r.idle)} d
            </text>
            <line className="base" x1={GX0} x2={GX1} y1={y + 30} y2={y + 30} />
            {r.fixtures.map((f) => {
              const bx0 = x(f.depart);
              const bx1 = x(f.arrive);
              const wx1 = x(f.load);
              const vx1 = x(f.end);
              const w = vx1 - wx1;
              const color = commodityColor(f.cargo);
              const dark = f.cargo.route.commodity !== 'soybeans' && f.cargo.route.commodity !== 'grain';
              return (
                <g key={f.cargo.id}>
                  {bx1 - bx0 > 0.5 && <rect x={bx0} y={y + 8} width={bx1 - bx0} height={18} fill="#ffffff" stroke={GRAPHIC.gray} strokeDasharray="3 2" />}
                  {wx1 - bx1 > 0.5 && <rect x={bx1} y={y + 8} width={wx1 - bx1} height={18} fill={tint(GRAPHIC.gray, 0.35)} />}
                  <rect x={wx1} y={y + 6} width={Math.max(1, w)} height={22} fill={color} rx={2} />
                  {w > 30 && (
                    <text x={wx1 + w / 2} y={y + 21} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 600, fill: dark ? '#ffffff' : '#333333' }}>
                      {w > 112 ? `${routeName(f.cargo)} · ${usd(f.tce / 1000, 1)}k` : `${usd(f.tce / 1000, 1)}k`}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** Bars of the options a ship had at one decision, by TCE, with the chosen one marked. */
function OptionBars({ d, minTce }: { d: Decision; minTce: number }) {
  const opts = [...d.options].sort((a, b) => b.tce - a.tce).slice(0, 8);
  const lo = Math.min(0, ...opts.map((o) => o.tce));
  const hi = Math.max(1000, ...opts.map((o) => o.tce));
  const X0 = 250;
  const X1 = 600;
  const x = (v: number) => X0 + ((v - lo) / (hi - lo)) * (X1 - X0);
  const height = 24 + opts.length * 24 + 8;
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${height}`}
      role="img"
      aria-label={`The ${d.options.length} cargoes she could reach on day ${fmt(d.day)} at ${place(d.at)}, by TCE. She took ${routeName(d.chosen.cargo)} at ${perDay(d.chosen.tce)}.`}
    >
      <text className="ax" x={X0} y={12}>
        TCE if she took it, $ per day
      </text>
      {lo < 0 && <line className="base" x1={x(0)} x2={x(0)} y1={18} y2={height - 6} />}
      {opts.map((o, i) => {
        const y = 22 + i * 24;
        const chosen = o.cargo.id === d.chosen.cargo.id;
        const below = o.tce < minTce;
        return (
          <g key={o.cargo.id}>
            <text x={X0 - 8} y={y + 13} textAnchor="end" style={{ fontSize: 11.5, fontWeight: chosen ? 600 : 400, fill: chosen ? TEXT.ink : '#555' }}>
              {routeName(o.cargo)} · ${fmt(o.cargo.freight, 2)}/t · {fmt(o.ballastNm)} nm empty
            </text>
            <rect
              x={Math.min(x(0), x(o.tce))}
              y={y + 2}
              width={Math.max(1, Math.abs(x(o.tce) - x(0)))}
              height={16}
              fill={below ? tint(GRAPHIC.gray, 0.4) : chosen ? GRAPHIC.green : tint(GRAPHIC.green, 0.45)}
              stroke={chosen ? TEXT.ink : 'none'}
              strokeWidth={1.5}
            />
            <text x={Math.max(x(0), x(o.tce)) + 6} y={y + 14} style={{ fontSize: 11, fill: below ? TEXT.gray : TEXT.green, fontWeight: chosen ? 600 : 400 }}>
              {usd(o.tce)}
              {chosen ? ' · taken' : below ? ' · below the minimum' : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const design = useCompany();
  // Which company the desk runs: the starting one, which the text describes, or the reader's.
  const changed = partChanged(design, 'ships') || partChanged(design, 'world');
  const [view, setView] = useState<CompanyView>('start');
  const co = changed ? companyFor(design, view) : design;
  const offers = useMemo(() => cargoOffers(co.world), [co.world]);
  const result = useMemo(() => operate(co.ships, offers, co.policy, co.finance, co.world), [co.ships, offers, co.policy, co.finance, co.world]);
  const log = useMemo(() => decisionLog(co.ships, offers, co.policy, co.world), [co.ships, offers, co.policy, co.world]);
  const days = co.world.weeks * WEEK;
  const p = design.policy;
  const setPolicy = (patch: Partial<OpsPolicy>) => updateCompany((d) => ({ ...d, policy: { ...d.policy, ...patch } }));
  const taken = countFixtures(result);
  const idle = result.runs.reduce((a, r) => a + r.idle, 0);
  const windowEvents = [...new Set(Array.from({ length: Math.ceil(days / MONTH) }, (_, k) => eventAt(co.world.start + k)?.label).filter((x): x is string => !!x))];
  const resetDesk = () => {
    if (!confirmReset('your desk’s policy', partChanged(design, 'policy'))) return;
    resetCompany('policy');
    setView('start');
  };
  const switcher = changed && (
    <ViewSwitch
      value={view}
      onChange={setView}
      labels={['Starting company', 'Your company']}
      note={<>The text describes the starting company. Yours: {fleetText(design)}; {worldText(design)}. Both use your desk’s policy.</>}
    />
  );

  // Demonstration 2: one ship's decisions, and the challenge's estimate.
  const pick = useScenario('one-ship', { ship: 'kestrel', fixture: 0, estimate: ESTIMATE_DEFAULT, checked: null as number | null });
  const shipId = co.ships.some((s) => s.id === pick.state.ship) ? pick.state.ship : co.ships[0]?.id;
  const shipDecisions = log.filter((d) => d.ship === shipId);
  const fixtureIndex = Math.min(pick.state.fixture, Math.max(0, shipDecisions.length - 1));
  const decision = shipDecisions[fixtureIndex];
  const ship = co.ships.find((s) => s.id === shipId);
  const bunkerThen = decision ? (co.policy.bunker ?? HIST.bunker[Math.min(HIST.months - 1, co.world.start + Math.floor(decision.day / MONTH))]) : 0;
  const checked = pick.state.checked;
  const solved = estimateSolved(checked);
  const atCheck = useMemo(() => {
    if (checked === null) return null;
    const d = kestrelFirstAt(checked);
    const tceOf = (id: string) => d.options.find((o) => o.cargo.id === id)!.tce;
    return { santos: tceOf(KESTREL_SANTOS.cargo.id), coal: tceOf(KESTREL_COAL.cargo.id), brazil: d.chosen.cargo.route.id === 'P-SAN-QIN' };
  }, [checked]);
  const santosPerDay = fuelPerVoyageDay(KESTREL_SANTOS);
  const coalPerDay = fuelPerVoyageDay(KESTREL_COAL);

  return (
    <LessonPage id="shipping/6.3">
      <P>
        In <a href={lessonHref('shipping/6.1')}>Lesson 6.1</a> Northwind’s fleet took shape — Kestrel and Albatross, and whatever ships you added — and in{' '}
        <a href={lessonHref('shipping/6.2')}>Lesson 6.2</a> its brokers began bringing it cargoes: soybeans from Santos, ore from Port Hedland and Tubarão, coal
        from Samarinda, each with a loading window and a freight rate. This lesson puts the two together on the operations desk. Every time a ship comes free,
        someone has to decide what she does next: take a cargo she can reach before its window closes, wait for a better one, or sail empty toward one far away.
        How should Northwind’s ships be scheduled?
      </P>
      <CompanySoFar d={design} lesson={3} />
      <P>
        Nothing on the desk is new. Each cargo a ship could take is a voyage estimate from <a href={lessonHref('shipping/2.3')}>Lesson 2.3</a>: the freight less
        commissions, fuel at the month’s bunker price and port costs, divided by the days from the moment she leaves to the moment she discharges — the ballast
        leg, any wait for the loading window to open (<a href={lessonHref('shipping/3.4')}>Lesson 3.4</a>), the days in port with whatever queue the port has (
        <a href={lessonHref('shipping/3.2')}>Lesson 3.2</a>), and the laden passage. That makes every cargo a <K tone="green">time-charter equivalent</K>, and the
        desk follows a rule: take the cargo with the best TCE, the nearest one, or the one paying the most per tonne. If nothing clears a minimum you set, the ship
        waits a few days and looks again.
      </P>
      <P>
        In the next demonstration each row is one of Northwind’s ships over the {periodText(co.world.weeks)} from {when(co.world.start)}. Dashed outlines are
        ballast legs, gray blocks are waits for a loading window, and solid bars are cargo voyages, colored by cargo and labeled with their TCE. The{' '}
        <b>benchmark</b> is what the same ships would have made earning the market rate (<a href={lessonHref('shipping/4.3')}>Lesson 4.3</a>) on every earning
        day, less the same costs; with the bunker price fixed, the market rate pays the same freights with fuel at that price. Change the rule, the speed, the
        minimum and the conditions the ships sail in — the desk’s policy is kept with the rest of your company.
        {changed && ' Since your fleet or cargo window has changed, the switch at the top runs either the starting company, which the text describes, or yours.'}
      </P>

      <Figure name="Fleet Operations Desk" onReset={resetDesk}>
        {switcher}
        <Segmented label="Dispatch rule" value={p.rule} onChange={(v) => setPolicy({ rule: v })} options={RULES} />
        <Legend
          items={[
            { label: 'Ballast leg', color: GRAPHIC.gray, kind: 'line', dashed: true },
            { label: 'Waiting for the window', color: tint(GRAPHIC.gray, 0.35) },
            { label: 'Iron ore', color: CARGO_COLOR.ore },
            { label: 'Coal', color: CARGO_COLOR.coal },
            { label: 'Grain and soybeans', color: CARGO_COLOR.grain },
          ]}
        />
        <Gantt result={result} ships={co.ships} days={days} start={co.world.start} />
        <Readouts
          items={[
            { label: 'voyage results: freight less fuel, ports, commissions', value: money(result.voyageNet), tone: 'green' },
            { label: 'daily costs of the ships', value: money(result.dailyCosts), tone: 'green' },
            { label: 'profit', value: money(result.profit), tone: result.profit < 0 ? 'red' : 'green' },
            { label: 'benchmark: the same ships at the market rate', value: money(result.benchmark) },
            { label: 'desk against the benchmark', value: signedMoney(result.profit - result.benchmark), tone: result.profit >= result.benchmark ? 'green' : 'red' },
            { label: 'cargoes taken, of those offered', value: `${taken} of ${offers.length}` },
            { label: 'days idle, all ships', value: fmt(idle), tone: 'teal' },
          ]}
        />
        <Slider label="Speed, laden and in ballast" tone="teal" value={p.speed} min={9} max={15} step={0.5} onChange={(v) => setPolicy({ speed: v })} display={`${fmt(p.speed, 1)} kn`} />
        <Slider label="Minimum acceptable TCE" tone="green" value={p.minTce} min={0} max={25_000} step={1_000} onChange={(v) => setPolicy({ minTce: v })} display={perDay(p.minTce)} />
        <Slider label="Extra waiting at Qingdao" tone="teal" value={p.congestion ?? 0} min={0} max={6} step={0.5} onChange={(v) => setPolicy({ congestion: v })} display={`${fmt(p.congestion ?? 0, 1)} days a call`} />
        <Segmented
          label="Bunker price"
          value={p.bunker === undefined ? 'history' : 'fixed'}
          onChange={(v) => setPolicy({ bunker: v === 'history' ? undefined : (p.bunker ?? 600) })}
          options={[
            { value: 'history', label: 'Bunkers as in the history' },
            { value: 'fixed', label: 'Bunkers fixed at…' },
          ]}
        />
        <Slider
          label="Fixed bunker price"
          tone="green"
          value={p.bunker ?? 600}
          min={300}
          max={1_200}
          step={10}
          disabled={p.bunker === undefined}
          onChange={(v) => setPolicy({ bunker: v })}
          display={p.bunker === undefined ? `history: $${fmt(HIST.bunker[co.world.start])}/t` : `$${fmt(p.bunker)}/t`}
        />
        <Caption>
          {windowEvents.length
            ? `During this period: ${windowEvents.join('; ').replace(/^./, (c) => c.toLowerCase())}. `
            : 'No disruptions fall in this period. '}
          {result.unfilled.length
            ? `${result.unfilled.length} offers went to other owners’ ships.`
            : 'Northwind took every cargo it was offered.'}
        </Caption>
      </Figure>

      <P>
        With Northwind’s starting company and cargo world, the desk’s first decision is Kestrel’s, on day 0 in Qingdao. She can reach {FIRST.options.length}{' '}
        cargoes in time. The best by TCE is soybeans from Santos at ${fmt(FIRST_BEST.cargo.freight, 2)} a tonne, worth {perDay(FIRST_BEST.tce)} even after{' '}
        {fmt(FIRST_BEST.ballastNm)} miles in ballast; the nearest is coal from Samarinda, {fmt(FIRST_NEAR.ballastNm)} miles away, worth {perDay(FIRST_NEAR.tce)}.
        Kestrel goes to Brazil, and Albatross follows {word(Math.round(ALB_DECISIONS[0].day))} days later for ore from Tubarão at {perDay(ALB_FIRST.tce)}. Over the
        half-year the ships’ voyages net {money(BASE.voyageNet)} and their daily costs come to {money(BASE.dailyCosts)}, so the company loses{' '}
        {money(-BASE.profit)} — in a market that paid Kamsarmaxes between {perDay(Math.min(...MARKET))} and {perDay(Math.max(...MARKET))}. The same ships at the
        market rate would have lost {money(-BASE.benchmark)}, so the desk beat its benchmark by {money(edge(BASE))}. The long ballast legs to the Atlantic that{' '}
        <a href={lessonHref('shipping/5.4')}>Lesson 5.4</a> weighed paid off here.
      </P>

      <H2>Rules and patience</H2>
      <P>
        Switch the rule to the nearest cargo. Kestrel never leaves Asian waters: she shuttles Indonesian coal to China and India on{' '}
        {word(fixturesOf(NEAREST, 'kestrel').length)} short voyages, Albatross runs Port Hedland ore, and between them the ships spend{' '}
        {fmt(idleOf(NEAREST, 'kestrel') + idleOf(NEAREST, 'albatross'))} days idle. The company takes {countFixtures(NEAREST)} cargoes instead of{' '}
        {countFixtures(BASE)} and ends {money(Math.abs(edge(NEAREST)))} {edge(NEAREST) < 0 ? 'behind' : 'ahead of'} the benchmark. Choosing by freight per tonne
        is better, {signedMoney(edge(FREIGHT))}, but still not as good as choosing by TCE, because a rate per tonne says nothing about how far a ship must sail
        empty to earn it or how many days the voyage takes (<a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>). For Albatross’s second voyage it picks coal from
        Richards Bay at ${fmt(ALB_FREIGHT_2.cargo.freight, 2)} a tonne over Port Hedland ore at ${fmt(ALB_TCE_2.cargo.freight, 2)}; the{' '}
        {fmt(ALB_FREIGHT_2.ballastNm)} miles of ballast to Richards Bay leave her earning {perDay(ALB_FREIGHT_2.tce)} instead of {perDay(ALB_TCE_2.tce)}.
      </P>
      <P>
        A minimum TCE is patience: turn down whatever is on offer and hope for better. Set it to {perDay(8_000)} and Kestrel skips her last coal voyage, which paid{' '}
        {perDay(fixturesOf(BASE, 'kestrel').at(-1)!.tce)}. At {perDay(10_000)} she sits idle for {fmt(idleOf(PATIENT10, 'kestrel'))} days after her first cargo, and
        at {perDay(12_000)} she never sails at all, because nothing she could reach paid that much; the company’s loss grows from {money(-PATIENT8.profit)} to{' '}
        {money(-PATIENT12.profit)}. Patience pays only when better cargoes are coming, and in a slack market like this one they mostly weren’t. The conditions
        matter too. Every voyage the starting desk fixes ends in Qingdao, so four extra days of queue there cut the desk’s lead over the benchmark to{' '}
        {money(edge(QIN4))}.
        {PANAMA_MONTHS > 0 && (
          <>
            {' '}
            And the first {word(PANAMA_MONTHS)} months fall in the drought that closes the Panama Canal to bulk carriers (
            <a href={lessonHref('shipping/3.3')}>Lesson 3.3</a>), so any US grain cargo for China has to go the long way round, through Suez.
          </>
        )}
      </P>

      <H2>One ship’s choices</H2>
      <P>
        The desk is greedy: each time a ship comes free it takes the best fixture available then, and never looks further ahead. In the next demonstration, pick a
        ship and one of her fixtures to see what was on offer at that moment — every cargo she could still reach in time, ranked by the TCE it would have earned
        her — and how the one she took breaks down. It runs the same company and policy as{' '}
        <FigRef to="Fleet Operations Desk">the first demonstration</FigRef>:
      </P>

      <Figure name="Fleet Operations Desk · one ship’s choices" scenario={pick}>
        {switcher}
        <Segmented label="Ship" value={shipId ?? ''} onChange={(v) => pick.set({ ship: v, fixture: 0 })} options={co.ships.map((s) => ({ value: s.id, label: s.name }))} />
        {decision ? (
          <>
            <OptionBars d={decision} minTce={co.policy.minTce} />
            <DataTable
              caption="The fixture she took, broken down"
              rows={[
                { k: 'Free at', v: `${place(decision.at)}, day ${fmt(decision.day)}` },
                {
                  k: 'Days',
                  v: `${fmt(decision.chosen.ballastDays, 1)} ballast (${fmt(decision.chosen.ballastNm)} nm) + ${fmt(decision.chosen.load - decision.chosen.arrive, 1)} waiting + ${fmt(decision.chosen.end - decision.chosen.load, 1)} loaded = ${fmt(decision.chosen.end - decision.chosen.depart, 1)}`,
                },
                { k: 'Freight', v: `$${fmt(decision.chosen.cargo.freight, 2)}/t × ${fmt(decision.chosen.cargo.tonnes)} t = ${money(decision.chosen.cargo.freight * decision.chosen.cargo.tonnes)}` },
                { k: 'Fuel', v: `${fmt(decision.chosen.fuel)} t at $${fmt(bunkerThen)}/t = ${money(decision.chosen.fuel * bunkerThen)}` },
                { k: 'Net of commissions, fuel and ports', v: money(decision.chosen.net) },
                { k: 'TCE: net per day of her time', v: perDay(decision.chosen.tce) },
              ]}
              rowKey={(r) => r.k}
              columns={[
                { label: `${ship?.name ?? ''}: ${routeName(decision.chosen.cargo)}`, cell: (r) => r.k, align: 'left' },
                { label: '', cell: (r) => r.v, align: 'right' },
              ]}
            />
          </>
        ) : (
          <Caption>{ship?.name ?? 'This ship'} takes no cargo under this policy.</Caption>
        )}
        <Slider
          label="Fixture"
          tone="teal"
          value={fixtureIndex}
          min={0}
          max={Math.max(1, shipDecisions.length - 1)}
          disabled={shipDecisions.length < 2}
          onChange={(v) => pick.set({ fixture: v })}
          display={decision ? `${fixtureIndex + 1} of ${shipDecisions.length}: day ${fmt(decision.day)}` : 'none'}
        />
        <Slider
          label="Your estimate of the switch"
          tone="green"
          value={pick.state.estimate}
          min={400}
          max={1_400}
          step={10}
          onChange={(v) => pick.set({ estimate: v })}
          display={`$${fmt(pick.state.estimate)}/t`}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button onClick={() => pick.set((st) => ({ checked: st.estimate }))} primary>
            Check my estimate
          </Button>
          <span style={{ fontSize: 14, color: '#5f5f5f' }}>
            {atCheck && checked !== null
              ? `At $${fmt(checked)}/t, Santos soybeans earn ${perDay(atCheck.santos)} and Samarinda coal ${perDay(atCheck.coal)}: she ${atCheck.brazil ? 'still goes to Brazil' : 'takes the coal'}.`
              : 'Starting company and policy, with bunkers fixed at your estimate.'}
          </span>
        </div>
        <Caption>
          Running {view === 'start' || !changed ? 'the starting company' : 'your company'} under your desk’s policy: {policyText(design)}.
        </Caption>
      </Figure>

      <P>
        With the starting company, start with Kestrel’s first fixture. The two Santos soybean cargoes pay ${fmt(SANTOS[0].cargo.freight, 2)} and $
        {fmt(SANTOS[SANTOS.length - 1].cargo.freight, 2)} a tonne for the same voyage, worth {perDay(SANTOS[0].tce)} and {perDay(SANTOS[SANTOS.length - 1].tce)}:
        the cheaper one would have earned her less than the best coal cargo. Two Samarinda–Qingdao coal cargoes pay almost the same, ${fmt(SAMQ[0].cargo.freight, 2)}{' '}
        and ${fmt(SAMQ[1].cargo.freight, 2)} a tonne, yet the dearer one ranks far lower, at {perDay(SAMQ[0].tce)} against {perDay(SAMQ[1].tce)}, because its
        window opens {fmt(SAMQ[0].load - SAMQ[0].arrive, 1)} days after she could arrive. The TCE is a rate per day of the ship’s time, whatever she spends it
        doing, so days at anchor count against a cargo just as days at sea do.
      </P>
      <P>
        Step through Albatross’s fixtures. On her first, the dearest cargo per tonne, ore from Tubarão, is also the best by TCE. On her second, the dearest is{' '}
        {routeName(ALB_DEAR_2.cargo)} at ${fmt(ALB_DEAR_2.cargo.freight, 2)} a tonne — the cargo the best-freight rule took in{' '}
        <FigRef to="Fleet Operations Desk">the first demonstration</FigRef> — and it ranks below {routeName(ALB_DECISIONS[1].chosen.cargo)} by{' '}
        {perDay(ALB_DECISIONS[1].chosen.tce - ALB_DEAR_2.tce)}.
      </P>
      <P>
        Fuel moves the ranking too. At the history’s price for {when(START.world.start)}, ${fmt(START_BUNKER)} a tonne, Kestrel’s Brazil voyage takes {fmt(KESTREL_SANTOS.end - KESTREL_SANTOS.depart)} days and burns {fmt(KESTREL_SANTOS.fuel)} tonnes, {fmt(santosPerDay, 1)}{' '}
        a day, most of it at sea; the best coal cargo, from Samarinda, takes {fmt(KESTREL_COAL.end - KESTREL_COAL.depart)} days and burns{' '}
        {fmt(KESTREL_COAL.fuel)} tonnes, {fmt(coalPerDay, 1)} a day. Every dollar on the bunker price takes more off the long voyage’s TCE than off the short
        one’s, so somewhere the TCE rule stops sending her to Brazil.
      </P>

      <Challenge
        id="a"
        figure="Fleet Operations Desk · one ship’s choices"
        question={`Estimate first, from the two voyages’ TCEs and the fuel each burns a day: with bunkers fixed at what price would the best-TCE desk send the starting company’s Kestrel for the Samarinda coal instead of Brazil’s soybeans? Set your estimate and check it; it scores within $${ESTIMATE_TOLERANCE} a tonne.`}
        solved={solved}
        status={
          checked === null || !atCheck
            ? 'No estimate checked yet.'
            : atCheck.brazil
              ? `Not yet: at $${fmt(checked)} a tonne the soybeans still earn ${perDay(atCheck.santos - atCheck.coal)} more than the coal. How fast is that gap closing per dollar?`
              : `Too far: at $${fmt(checked)} a tonne the coal already earns ${perDay(atCheck.coal - atCheck.santos)} more. Where did the gap close?`
        }
        success={`Solved: $${fmt(checked ?? 0)} a tonne, against the $${fmt(brazilCrossover())} at which she switches. The gap of ${perDay(KESTREL_SANTOS.tce - KESTREL_COAL.tce)} at $${fmt(START_BUNKER)} closes by $${fmt(santosPerDay - coalPerDay, 1)} a day for every dollar on the bunker price, the difference between the two voyages’ fuel per day. Nobody told the TCE rule to prefer short voyages when fuel is dear; ranking cargoes by what they net per day of the ship’s time does it.`}
      />

      <P>
        What the desk can’t see is the future. Kestrel’s first soybean voyage ties her up for {fmt(fixturesOf(BASE, 'kestrel')[0].end)} days, and whatever turns
        up in the Pacific meanwhile goes to other owners. A better desk would weigh each fixture against where it leaves the ship and what the market will pay when
        she gets there — the positional value of <a href={lessonHref('shipping/3.4')}>Lesson 3.4</a> and the forecasts of{' '}
        <a href={lessonHref('shipping/5.1')}>Lesson 5.1</a>. The next lesson takes up the second half: in <a href={lessonHref('shipping/6.4')}>Lesson 6.4</a>, you
        forecast what the market will pay as trade flows, weather and the fleet change around Northwind.
      </P>
    </LessonPage>
  );
}
