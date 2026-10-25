import { useMemo, useState } from 'react';
import {
  Button,
  Caption,
  Challenge,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
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
  niceTicks,
  pct,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import { shipCapacity, shipCost, shipPrice, type CompanyFinance, type CompanyShip, type ShipMode } from '../../../engines/shipping/company';
import { periodHire } from '../../../engines/shipping/tournament';
import { standardHistory } from '../../../model/shipping/history';
import { PLACE } from '../../../model/shipping/geo';
import { OFF_HIRE_DAYS, type ClassId } from '../../../model/shipping/trades';
import {
  EQUITY_BUDGET,
  MAX_SHIPS,
  OPEN_PORTS,
  START_MONTH,
  confirmReset,
  defaultDesign,
  money,
  nextName,
  partChanged,
  resetCompany,
  updateCompany,
  useCompany,
  when,
  type CompanyDesign,
} from '../shared/company';
import { XYChart } from '../shared/XYChart';

const HIST = standardHistory();
const EARN = (365 - OFF_HIRE_DAYS) / 365;
const CLASS_NAME: Record<ClassId, string> = { kmax: 'Kamsarmax', cape: 'Capesize' };
/** The challenge's capacity target, billions of tonne-miles a year. */
export const CAPACITY_TARGET = 20;
export const MIN_SHIPS = 4;

const perDay = (x: number) => `$${fmt(x)}/day`;

/** Market earnings for a class in a month of the history, $/day. */
export function marketAt(cls: ClassId, t: number): number {
  return HIST.cls[cls][t].tce;
}

/** Cash costs of a ship per calendar day: operating costs, loan payments, or hire. */
export function cashCostPerDay(s: CompanyShip, f: CompanyFinance): number {
  const c = shipCost(s, f);
  return c.opex + c.debtService + c.hire;
}

export interface FleetStats {
  ships: number;
  /** Northwind's own money in its owned ships, $. */
  equity: number;
  /** Cash costs per calendar day, $. */
  cashCost: number;
  /** Billions of tonne-miles a year. */
  capacity: number;
  /** What the fleet earns per calendar day at July of Year 9's market, less its cash costs, $. */
  margin: number;
  /** Annual cash flow at July of Year 9's market, $. */
  cashFlow: number;
}

export function fleetStats(d: CompanyDesign): FleetStats {
  let equity = 0;
  let cashCost = 0;
  let capacity = 0;
  let earn = 0;
  for (const s of d.ships) {
    const c = shipCost(s, d.finance);
    equity += c.equity;
    cashCost += c.opex + c.debtService + c.hire;
    capacity += shipCapacity(s.cls);
    earn += marketAt(s.cls, START_MONTH) * EARN;
  }
  return { ships: d.ships.length, equity, cashCost, capacity, margin: earn - cashCost, cashFlow: (earn - cashCost) * 365 };
}

/**
 * The challenge: at least four ships, Northwind's equity within the budget, at least 20 billion
 * tonne-miles a year of capacity, and a fleet that earns its cash costs at the start month's market.
 */
export function fleetSolved(d: CompanyDesign): boolean {
  const s = fleetStats(d);
  return s.ships >= MIN_SHIPS && s.equity <= EQUITY_BUDGET + 1e-6 && s.capacity >= CAPACITY_TARGET - 1e-9 && s.margin >= 0;
}

/** Annual cash flow if each class's market earned `mult` times its start-month level, $. */
export function cashFlowAt(d: CompanyDesign, mult: number): number {
  return d.ships.reduce((a, s) => a + (marketAt(s.cls, START_MONTH) * mult * EARN - cashCostPerDay(s, d.finance)) * 365, 0);
}

/** The market level, as a multiple of the start month's, at which the fleet's cash flow is zero. */
export function breakEvenMultiple(d: CompanyDesign): number {
  const earn = d.ships.reduce((a, s) => a + marketAt(s.cls, START_MONTH) * EARN, 0);
  const cost = d.ships.reduce((a, s) => a + cashCostPerDay(s, d.finance), 0);
  return earn > 0 ? cost / earn : Infinity;
}

export interface YearPoint {
  year: number;
  /** The year's earnings relative to the start month, weighted by the fleet's ships. */
  mult: number;
  cashFlow: number;
}

const YEAR_TCE: Record<ClassId, number[]> = {
  kmax: Array.from({ length: 12 }, (_, y) => HIST.cls.kmax.slice(y * 12, y * 12 + 12).reduce((a, m) => a + m.tce, 0) / 12),
  cape: Array.from({ length: 12 }, (_, y) => HIST.cls.cape.slice(y * 12, y * 12 + 12).reduce((a, m) => a + m.tce, 0) / 12),
};

/** The fleet's cash flow in each year of the history, at that year's average earnings. */
export function historyYears(d: CompanyDesign): YearPoint[] {
  return Array.from({ length: 12 }, (_, y) => {
    let earnY = 0;
    let earnStart = 0;
    let cost = 0;
    for (const s of d.ships) {
      earnY += YEAR_TCE[s.cls][y] * EARN;
      earnStart += marketAt(s.cls, START_MONTH) * EARN;
      cost += cashCostPerDay(s, d.finance);
    }
    return { year: y + 1, mult: earnStart > 0 ? earnY / earnStart : 0, cashFlow: (earnY - cost) * 365 };
  });
}

/**
 * A new ship from the add panel, priced in July of Year 9, when Northwind builds its fleet. (The
 * fleet is this lesson's part of the company; the month it starts trading, set in Lesson 6.2,
 * doesn't reprice it.)
 */
export function newShip(d: CompanyDesign, cls: ClassId, mode: ShipMode, age: number, at: string): CompanyShip {
  const name = nextName(d.ships);
  const t = START_MONTH;
  return {
    id: name.toLowerCase(),
    name,
    cls,
    age: mode === 'owned' ? age : 10,
    mode,
    price: mode === 'owned' ? shipPrice(cls, age, HIST.cls[cls], t) : 0,
    hire: mode === 'chartered' ? periodHire(cls, HIST, t) : 0,
    at,
    openDay: 0,
  };
}

// Numbers for the prose: the starting company in July of Year 9.
const START = defaultDesign();
const START_STATS = fleetStats(START);
const KESTREL0 = START.ships.find((s) => s.id === 'kestrel')!;
const ALBATROSS0 = START.ships.find((s) => s.id === 'albatross')!;
const K_COST = shipCost(KESTREL0, START.finance);
const A_COST = shipCost(ALBATROSS0, START.finance);
const PRIOR12 = (cls: ClassId) => HIST.cls[cls].slice(START_MONTH - 11, START_MONTH + 1).reduce((a, m) => a + m.tce, 0) / 12;
/** The highest price the same ship fetched earlier in the history, and when. */
function earlierPeak(cls: ClassId, age: number) {
  let best = 0;
  let at = 0;
  for (let t = 0; t <= START_MONTH; t++) {
    const p = shipPrice(cls, age, HIST.cls[cls], t);
    if (p > best) {
      best = p;
      at = t;
    }
  }
  return { price: best, at };
}
const K_PEAK = earlierPeak('kmax', KESTREL0.age);
const A_PEAK = earlierPeak('cape', ALBATROSS0.age);
const OLD20 = newShip(START, 'kmax', 'owned', 20, 'QIN');
const OLD20_COST = shipCost(OLD20, START.finance);
const YOUNG5 = newShip(START, 'kmax', 'owned', 5, 'QIN');
const YOUNG5_COST = shipCost(YOUNG5, START.finance);
const HIRE_K = periodHire('kmax', HIST, START_MONTH);
const HIRE_C = periodHire('cape', HIST, START_MONTH);
const CAP_K = shipCapacity('kmax');
const CAP_C = shipCapacity('cape');
const START_BE = breakEvenMultiple(START);
const NO_DEBT = { ...START, finance: { ...START.finance, ltv: 0 } };
/** Shares of the cash cost: running costs for the old ship, loan payments for the young one. */
export const OLD20_OPEX_SHARE = OLD20_COST.opex / (OLD20_COST.opex + OLD20_COST.debtService);
export const YOUNG5_DEBT_SHARE = YOUNG5_COST.debtService / (YOUNG5_COST.opex + YOUNG5_COST.debtService);
/** The market level, as a multiple of the start month's, at which a chartered Kamsarmax's earnings meet her hire. */
export const PIVOT_K = HIRE_K / EARN / marketAt('kmax', START_MONTH);
/** The starting company's break-even with one chartered Kamsarmax added. */
export const BE_PLUS_K = breakEvenMultiple({ ...START, ships: [...START.ships, newShip(START, 'kmax', 'chartered', 10, 'QIN')] });

const SEG = { opex: tint(GRAPHIC.green, 0.45), debt: GRAPHIC.green, hire: GRAPHIC.gold };
/**
 * The fleet table holds its header and four ships; a bigger fleet scrolls inside it, so the figure
 * keeps its height. A soft shadow at the edge shows when ships are out of sight.
 */
const FLEET_TABLE_STYLE = {
  maxHeight: 200,
  overflowY: 'auto',
  background: [
    'linear-gradient(var(--bg) 30%, transparent) top / 100% 24px no-repeat local',
    'linear-gradient(transparent, var(--bg) 70%) bottom / 100% 24px no-repeat local',
    'radial-gradient(farthest-side at 50% 0, rgba(0, 0, 0, 0.14), transparent) top / 100% 10px no-repeat scroll',
    'radial-gradient(farthest-side at 50% 100%, rgba(0, 0, 0, 0.14), transparent) bottom / 100% 10px no-repeat scroll',
  ].join(', '),
} as const;
/** Market levels for the exposure chart, from 0.4× to at least 2.5× (further if a year of the history needs it). */
const multsTo = (xMax: number) => Array.from({ length: Math.round((xMax - 0.4) / 0.05) + 1 }, (_, i) => 0.4 + i * 0.05);

/** The add panel's class and terms, as one choice. */
type PanelPick = 'owned:kmax' | 'owned:cape' | 'chartered:kmax' | 'chartered:cape';
const PICKS: Array<{ value: PanelPick; label: string }> = [
  { value: 'owned:kmax', label: 'Buy Kamsarmax' },
  { value: 'owned:cape', label: 'Buy Capesize' },
  { value: 'chartered:kmax', label: 'Charter in Kamsarmax' },
  { value: 'chartered:cape', label: 'Charter in Capesize' },
];
const PANEL0 = { pick: 'owned:kmax' as PanelPick, age: 10, at: 'QIN' };
const splitPick = (p: PanelPick) => {
  const [mode, cls] = p.split(':') as [ShipMode, ClassId];
  return { mode, cls };
};

/** The fleet with one more ship chartered in for a year, unless it is full. */
export function withCharter(d: CompanyDesign, cls: ClassId): CompanyDesign {
  if (d.ships.length >= MAX_SHIPS) return d;
  return { ...d, ships: [...d.ships, newShip(d, cls, 'chartered', 10, 'QIN')] };
}

/** The fleet without the ship it chartered in last (if it keeps at least one ship). */
export function withoutLastCharter(d: CompanyDesign): CompanyDesign {
  const i = d.ships.map((s) => s.mode).lastIndexOf('chartered');
  if (i < 0 || d.ships.length <= 1) return d;
  return { ...d, ships: d.ships.filter((_, j) => j !== i) };
}

/** A small text button for a table row. */
function RowButton({ onClick, disabled, label, children }: { onClick: () => void; disabled?: boolean; label: string; children: string }) {
  return (
    <button type="button" className="tbtn" style={{ minHeight: 24, fontSize: 13 }} onClick={onClick} disabled={disabled} aria-label={label}>
      {children}
    </button>
  );
}

const lostOrMade = (x: number) => (x < 0 ? `lost ${money(-x)}` : `made ${money(x)}`);

export default function Lesson() {
  const d = useCompany();
  const [panel, setPanel] = useState(PANEL0);
  const { mode, cls } = splitPick(panel.pick);
  const stats = fleetStats(d);
  const solved = fleetSolved(d);
  const t = START_MONTH;
  const candidate = newShip(d, cls, mode, panel.age, panel.at);
  const candidateCost = shipCost(candidate, d.finance);
  const blocked =
    d.ships.length >= MAX_SHIPS
      ? `The fleet is full: ${MAX_SHIPS} ships at most.`
      : stats.equity + candidateCost.equity > EQUITY_BUDGET + 1e-6
        ? `Not enough equity: she needs ${money(candidateCost.equity)} and ${money(Math.max(0, EQUITY_BUDGET - stats.equity))} is left.`
        : null;
  const setFinance = (patch: Partial<CompanyFinance>) => updateCompany((x) => ({ ...x, finance: { ...x.finance, ...patch } }));
  const add = () => {
    if (blocked) return;
    updateCompany((x) => ({ ...x, ships: [...x.ships, newShip(x, cls, mode, panel.age, panel.at)] }));
  };
  const remove = (id: string) => updateCompany((x) => (x.ships.length > 1 ? { ...x, ships: x.ships.filter((s) => s.id !== id) } : x));
  const resetFleet = () => {
    if (!confirmReset('your fleet and its financing', partChanged(d, 'ships'))) return;
    resetCompany('ships');
    setPanel(PANEL0);
  };

  // Demonstration 1's cost bars: $ per earning day, so each bar's top is the ship's cash break-even.
  const rows = d.ships.map((s) => {
    const c = shipCost(s, d.finance);
    return { s, c, market: marketAt(s.cls, t) };
  });
  const yTop = Math.max(30_000, ...rows.map((r) => Math.max(r.c.fullBreakeven, r.market) * 1.08));
  const yt = niceTicks(0, yTop, 4);
  const yMax = yt[yt.length - 1] >= yTop ? yt[yt.length - 1] : yTop;
  const BX0 = 70;
  const BX1 = 624;
  const by = scale(0, yMax, 146, 22);
  const slotW = (BX1 - BX0) / Math.max(rows.length, 4);
  const barW = Math.min(46, slotW * 0.5);

  // Demonstration 2.
  const ex = useScenario('exposure', { mult: 1 });
  const years = useMemo(() => historyYears(d), [d]);
  const xMax = Math.max(2.5, Math.ceil(Math.max(...years.map((y) => y.mult)) * 10 - 1e-9) / 10);
  const MULTS = useMemo(() => multsTo(xMax), [xMax]);
  const curve = useMemo(() => MULTS.map((m) => cashFlowAt(d, m)), [d, MULTS]);
  const noDebt = useMemo(() => MULTS.map((m) => cashFlowAt({ ...d, finance: { ...d.finance, ltv: 0 } }, m)), [d, MULTS]);
  const worst = years.reduce((a, b) => (b.cashFlow < a.cashFlow ? b : a));
  const best = years.reduce((a, b) => (b.cashFlow > a.cashFlow ? b : a));
  const be = breakEvenMultiple(d);
  const atCursor = cashFlowAt(d, ex.state.mult);
  const allLow = Math.min(...curve, ...noDebt, worst.cashFlow);
  const allHigh = Math.max(...curve, ...noDebt, best.cashFlow);
  const ticks = niceTicks(allLow, allHigh, 4);
  const charters = d.ships.filter((s) => s.mode === 'chartered').length;
  const full = d.ships.length >= MAX_SHIPS;

  // The leverage prose, for the fleet as it stands.
  const isStart = !partChanged(d, 'ships');
  const noDebtD: CompanyDesign = { ...d, finance: { ...d.finance, ltv: 0 } };
  const loanPayments = cashFlowAt(noDebtD, 1) - cashFlowAt(d, 1);
  const noDebtEquity = fleetStats(noDebtD).equity;
  const bePlusK = breakEvenMultiple({ ...d, ships: [...d.ships, newShip(d, 'kmax', 'chartered', 10, 'QIN')] });

  const termText = (s: CompanyShip) => (s.mode === 'owned' ? `owned, ${money(s.price, 1)}` : `chartered, ${perDay(s.hire)}`);

  return (
    <LessonPage id="shipping/6.1">
      <P>
        Five chapters have taken shipping apart: a hull that floats and burns fuel, a fleet that grows and shrinks, routes and queues that put ships in the wrong
        places, a market that prices all of it, and the strategies that trade on its swings. In this last chapter we’ll put the pieces back together and run
        Northwind Bulk as a company. Over five lessons you’ll choose its fleet, give it cargoes to chase, schedule its ships, forecast its market and pick a
        strategy. The company is kept in this browser, so each lesson picks up where the last left it, and each also works from the starting company if you’d rather
        skip ahead.
      </P>
      <P>
        The starting company is the one we know: Kestrel, a {KESTREL0.age}-year-old Kamsarmax, and Albatross, an {ALBATROSS0.age}-year-old Capesize, both owned and
        both open in Qingdao. It is {when(START_MONTH)} in the simulated history of <a href={lessonHref('shipping/2.5')}>Lesson 2.5</a>, late in the
        long slump. That month Kamsarmaxes earn {perDay(marketAt('kmax', START_MONTH))} and Capesizes {perDay(marketAt('cape', START_MONTH))}, after a year that
        averaged {perDay(PRIOR12('kmax'))} and {perDay(PRIOR12('cape'))}. With a {pct(START.finance.ltv)} loan on each ship at {pct(START.finance.rate, 0)}, Kestrel needs{' '}
        {perDay(K_COST.cashBreakeven)} to pay her running costs and her bank, and Albatross {perDay(A_COST.cashBreakeven)}. Neither is covering its cash costs. So
        the question for this lesson is what fleet Northwind should run — and on what terms.
      </P>
      <P>
        In the next demonstration, the table is the fleet. Add ships with the panel under it: buy a secondhand ship or charter one in for a year, choose her age if
        you buy her, and where she comes open. Bought ships cost what the market pays for a ship of that age this month; chartered ships cost the year’s hire.
        Northwind can put {money(EQUITY_BUDGET, 0)} of its own money into ships, counting the equity already in Kestrel and Albatross, and the financing sliders
        set the loans on every ship it owns. The bars show each ship’s cash costs per earning day, so the top of each bar is her cash break-even; the solid blue
        line across it is what her class earns this month, and the number over each bar is the gap between the two. On an owned ship, the dashed gray line is her
        full-cost break-even (<a href={lessonHref('shipping/2.4')}>Lesson 2.4</a>): it swaps her loan repayments for depreciation and adds a{' '}
        {pct(START.finance.equityReturn, 0)} return on Northwind’s own money, so it is what she must earn, year in and year out, to be worth owning:
      </P>

      <Figure name="Shipping Company Builder" onReset={resetFleet}>
        <Legend
          items={[
            { label: 'Operating costs', color: SEG.opex },
            { label: 'Loan payments', color: SEG.debt },
            { label: 'Hire', color: SEG.hire },
            { label: 'Full cost', color: '#555', kind: 'line', dashed: true },
            { label: 'Market earnings', color: GRAPHIC.blue, kind: 'line' },
          ]}
        />
        <svg
          className="chart"
          viewBox="0 0 640 180"
          role="img"
          aria-label={`Northwind’s fleet of ${d.ships.length} ships: ${rows.map((r) => `${r.s.name}, ${CLASS_NAME[r.s.cls]}, cash break-even ${perDay(r.c.cashBreakeven)} against a market of ${perDay(r.market)}`).join('; ')}.`}
        >
          <text className="ax" x={BX0} y={12}>
            $ per earning day
          </text>
          <GridY y={by} ticks={niceTicks(0, yMax, 4)} x0={BX0} x1={BX1} format={(v) => `$${fmt(v / 1000)}k`} baseline={0} />
          {rows.map((r, i) => {
            const cx = BX0 + (i + 0.5) * slotW;
            const x0 = cx - barW / 2;
            const segs =
              r.s.mode === 'chartered'
                ? [{ v: r.c.hire / EARN, color: SEG.hire }]
                : [
                    { v: r.c.opex / EARN, color: SEG.opex },
                    { v: r.c.debtService / EARN, color: SEG.debt },
                  ];
            let acc = 0;
            const covered = r.market >= r.c.cashBreakeven;
            return (
              <g key={r.s.id}>
                {segs.map((sg, j) => {
                  const y0 = by(acc);
                  acc += sg.v;
                  return <rect key={j} x={x0} y={by(acc)} width={barW} height={Math.max(0, y0 - by(acc))} fill={sg.color} />;
                })}
                {r.s.mode === 'owned' && (
                  <line x1={x0 - 4} x2={x0 + barW + 4} y1={by(r.c.fullBreakeven)} y2={by(r.c.fullBreakeven)} stroke="#555" strokeWidth={1.5} strokeDasharray="4 3" />
                )}
                <line x1={x0 - 10} x2={x0 + barW + 10} y1={by(r.market)} y2={by(r.market)} stroke={GRAPHIC.blue} strokeWidth={2} />
                <text x={cx} y={by(Math.max(r.c.cashBreakeven, r.market, r.s.mode === 'owned' ? r.c.fullBreakeven : 0)) - 6} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: covered ? TEXT.green : TEXT.red }}>
                  {covered ? '+' : '−'}
                  {fmt(Math.abs(r.market - r.c.cashBreakeven))}
                </text>
                <text className="ax ax-m" x={cx} y={162} style={{ fontWeight: 500 }}>
                  {r.s.name}
                </text>
                <text className="ax ax-m" x={cx} y={176}>
                  {r.s.cls === 'kmax' ? 'Kamsarmax' : 'Capesize'}
                </text>
              </g>
            );
          })}
        </svg>
        <div style={FLEET_TABLE_STYLE}>
          <DataTable
            caption="Northwind’s fleet: each ship’s class, terms and where she comes open"
            rows={d.ships}
            rowKey={(s) => s.id}
            columns={[
              { label: 'Ship', cell: (s) => s.name },
              { label: 'Class, age', cell: (s) => `${CLASS_NAME[s.cls]}${s.mode === 'owned' ? `, ${s.age} yr` : ''}`, align: 'left' },
              { label: 'Terms', cell: (s) => termText(s), align: 'left' },
              { label: 'Open', cell: (s) => PLACE[s.at].name, align: 'left' },
              {
                label: '',
                cell: (s) => (
                  <RowButton onClick={() => remove(s.id)} disabled={d.ships.length <= 1} label={`Remove ${s.name}`}>
                    Remove
                  </RowButton>
                ),
              },
            ]}
          />
        </div>
        <Readouts
          items={[
            { label: `equity in ships, of ${money(EQUITY_BUDGET, 0)}`, value: money(stats.equity, 1), tone: stats.equity > EQUITY_BUDGET + 1e-6 ? 'red' : 'green' },
            { label: 'cash costs, whole fleet', value: perDay(stats.cashCost), tone: 'green' },
            { label: 'capacity, tonne-miles a year', value: `${fmt(stats.capacity, 1)} billion`, tone: 'orange' },
          ]}
        />
        <Segmented label="Ship to add, and on what terms" value={panel.pick} onChange={(v) => setPanel({ ...panel, pick: v })} options={PICKS} />
        <Segmented label="Where she comes open" value={panel.at} onChange={(v) => setPanel({ ...panel, at: v })} options={OPEN_PORTS.map((p) => ({ value: p, label: PLACE[p].name }))} />
        <Slider label="Age, if bought" value={panel.age} min={3} max={20} onChange={(v) => setPanel({ ...panel, age: v })} display={mode === 'owned' ? `${panel.age} years` : '—'} disabled={mode !== 'owned'} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '0 0 4px' }}>
          <Button onClick={add} disabled={!!blocked} primary>
            Add {candidate.name}
          </Button>
          <span style={{ fontSize: 14, color: blocked ? TEXT.red : '#5f5f5f' }}>
            {blocked ??
              (mode === 'owned'
                ? `${money(candidate.price, 1)}, of which ${money(candidateCost.equity)} equity; break-even ${perDay(candidateCost.cashBreakeven)}`
                : `Hire ${perDay(candidate.hire)}; no equity`)}
          </span>
        </div>
        <Slider label="Loan share of price" tone="green" value={d.finance.ltv} min={0} max={0.8} step={0.05} onChange={(v) => setFinance({ ltv: v })} display={pct(d.finance.ltv)} />
        <Slider label="Interest rate" tone="green" value={d.finance.rate} min={0.03} max={0.12} step={0.0025} onChange={(v) => setFinance({ rate: v })} display={pct(d.finance.rate, 2)} />
        <Slider label="Loan repaid over" value={d.finance.tenor} min={5} max={20} onChange={(v) => setFinance({ tenor: v })} display={`${d.finance.tenor} years`} />
        <Caption>
          {stats.margin >= 0
            ? `In ${when(t)} the fleet clears its cash costs by ${perDay(stats.margin)}: ${money(stats.cashFlow)} a year.`
            : `In ${when(t)} the fleet falls ${perDay(-stats.margin)} short of its cash costs: ${money(-stats.cashFlow)} a year.`}
        </Caption>
      </Figure>

      <P>
        A ship’s price is the market’s estimate of what she will earn, less what she costs to run, over the years she has left (
        <a href={lessonHref('shipping/2.5')}>Lesson 2.5</a>). In a slump that estimate is low, so ships are cheap: a {KESTREL0.age}-year-old Kamsarmax like Kestrel is
        worth {money(KESTREL0.price)} this month, against {money(K_PEAK.price)} in {when(K_PEAK.at)}, and an {ALBATROSS0.age}-year-old Capesize {money(ALBATROSS0.price)}{' '}
        against {money(A_PEAK.price)}. Buying now is the asset play: cheap ships with low capital costs, if the market recovers before the money runs out. Older
        ships are cheaper again. A 20-year-old Kamsarmax costs {money(OLD20.price)} and needs {perDay(OLD20_COST.cashBreakeven)} in cash, against{' '}
        {perDay(YOUNG5_COST.cashBreakeven)} for a 5-year-old at {money(YOUNG5.price)}. But {pct(OLD20_OPEX_SHARE)} of the old ship’s cash cost is running cost,
        paid every day until she goes for scrap, while {pct(YOUNG5_DEBT_SHARE)} of the young ship’s is loan payments on a hull that keeps much of its value, with
        two decades left to earn (<a href={lessonHref('shipping/2.4')}>Lesson 2.4</a>).
      </P>
      <P>
        Chartering in is the other way to grow. A Kamsarmax can be had for a year at {perDay(HIRE_K)} and a Capesize at {perDay(HIRE_C)}: the hire the market sets
        from what it expects the coming year to earn (<a href={lessonHref('shipping/5.1')}>Lesson 5.1</a>), which includes the slack months after the harvest.
        Hire is paid on every calendar day, so per earning day it comes to ${fmt(HIRE_K / EARN)} and ${fmt(HIRE_C / EARN)}: below what each class earns this
        month. A charter needs no equity at all, but the hire is owed whatever the market does. A chartered ship is a bet that spot earnings will beat her hire, the bet of{' '}
        <a href={lessonHref('shipping/5.3')}>Lesson 5.3</a>, with the operating details of <a href={lessonHref('shipping/4.2')}>Lesson 4.2</a> left to her owner.
      </P>

      <H2>Size and capacity</H2>
      <P>
        Each class carries a different slice of the world’s trade (<a href={lessonHref('shipping/2.1')}>Lesson 2.1</a>). In our world a Capesize moves about{' '}
        {fmt(CAP_C, 1)} billion tonne-miles of iron ore and coal a year and a Kamsarmax about {fmt(CAP_K, 1)} billion of grain and coal — the work rate of an average
        ship of each class in the market, from the tonne-miles of <a href={lessonHref('shipping/3.5')}>Lesson 3.5</a>. Together the starting company carries{' '}
        {fmt(START_STATS.capacity, 1)} billion tonne-miles a year. However many ships you add, Northwind remains a tiny part of fleets of hundreds; it takes the
        market’s rates as given, like the ships of <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>.
      </P>

      <Challenge
        id="a"
        figure="Shipping Company Builder"
        question={`Build a fleet of at least ${MIN_SHIPS} ships, within the ${money(EQUITY_BUDGET, 0)} of equity, that can carry at least ${CAPACITY_TARGET} billion tonne-miles a year and earns its cash costs at ${when(START_MONTH)}’s rates.`}
        solved={solved}
        status={[
          stats.ships < MIN_SHIPS ? `The fleet has ${stats.ships} ship${stats.ships === 1 ? '' : 's'}.` : null,
          stats.equity > EQUITY_BUDGET + 1e-6 ? `It needs ${money(stats.equity, 1)} of equity.` : null,
          stats.capacity < CAPACITY_TARGET ? `It carries ${fmt(stats.capacity, 1)} billion tonne-miles a year.` : null,
          stats.margin < 0 ? `At this month’s rates it falls ${perDay(-stats.margin)} short of its cash costs.` : `At this month’s rates it clears its cash costs by ${perDay(stats.margin)}.`,
        ]
          .filter(Boolean)
          .join(' ')}
        success={`Solved. ${stats.ships} ships carrying ${fmt(stats.capacity, 1)} billion tonne-miles a year clear their cash costs by ${perDay(stats.margin)} this month, with ${money(stats.equity, 1)} of Northwind’s money in them. There’s more than one way there: smaller loans lower every owned ship’s break-even but use up equity, while chartered ships add capacity without equity — at hires fixed for a year.`}
      />

      <H2>Leverage</H2>
      <P>
        Whether a fleet survives depends less on this month than on the years ahead. In the next demonstration, the solid line is Northwind’s annual cash flow —
        earnings on its ships’ earning days, less operating costs, loan payments and hire — if both markets earned some multiple of their level in{' '}
        {when(START_MONTH)}. The dashed line is the same fleet with no loans at all. The dots are the twelve years of the history, each at its own average
        earnings. The loan share and the charter buttons change the same fleet as <FigRef to="Shipping Company Builder">the first demonstration</FigRef>. Drag
        the market level:
      </P>

      <Figure name="Shipping Company Builder · exposure" scenario={ex}>
        <XYChart
          ariaLabel={`Northwind’s annual cash flow against the market’s level as a multiple of ${when(t)}: it breaks even at ${fmt(be, 2)}×. At ${fmt(ex.state.mult, 2)}× it is ${money(atCursor)} a year; in the history’s worst year, Year ${worst.year}, ${money(worst.cashFlow)}; in the best, Year ${best.year}, ${money(best.cashFlow)}.`}
          series={[
            { xs: MULTS, ys: noDebt, color: '#9a9a9a', width: 1.5, dash: '5 4' },
            { xs: MULTS, ys: curve, color: GRAPHIC.green, width: 2.5 },
          ]}
          xMin={0.4}
          xMax={xMax}
          yMin={ticks[0]}
          yMax={ticks[ticks.length - 1]}
          yTicks={ticks}
          xTicks={[0.5, 1, 1.5, 2, 2.5]}
          xFormat={(v) => `${v}×`}
          yFormat={(v) => money(v, Math.abs(ticks[1] - ticks[0]) < 2e6 ? 1 : 0)}
          xLabel={`Market earnings, multiple of ${when(t)}`}
          yLabel="Annual cash flow"
          refLines={[{ y: 0, color: '#777', dash: '2 3' }]}
          cursor={ex.state.mult}
          markers={years.map((y) => ({
            x: Math.min(xMax, Math.max(0.4, y.mult)),
            y: y.cashFlow,
            color: y === worst ? TEXT.red : y === best ? TEXT.green : '#9a9a9a',
            r: y === worst || y === best ? 5 : 3.5,
            label: y === worst || y === best ? `Year ${y.year}` : undefined,
            anchor: y === best ? ('end' as const) : ('start' as const),
            labelDy: y === best ? -10 : 18,
          }))}
          height={240}
        />
        <Legend
          items={[
            { label: 'Fleet as financed', color: GRAPHIC.green, kind: 'line' },
            { label: 'Same fleet with no loans', color: '#9a9a9a', kind: 'line', dashed: true },
            { label: 'Years of the history', color: '#9a9a9a' },
          ]}
        />
        <Readouts
          items={[
            { label: 'breaks even at', value: Number.isFinite(be) ? `${fmt(be, 2)}× this month` : '—', tone: 'green' },
            { label: `cash flow at ${fmt(ex.state.mult, 2)}×`, value: money(atCursor), tone: atCursor < 0 ? 'red' : 'green' },
            { label: `worst year, Year ${worst.year}`, value: money(worst.cashFlow), tone: worst.cashFlow < 0 ? 'red' : 'green' },
            { label: `best year, Year ${best.year}`, value: money(best.cashFlow), tone: 'green' },
          ]}
        />
        <Slider label="Market level" tone="green" value={ex.state.mult} min={0.4} max={2.5} step={0.05} onChange={(v) => ex.set({ mult: v })} display={`${fmt(ex.state.mult, 2)}×`} />
        <Slider label="Loan share of price" tone="green" value={d.finance.ltv} min={0} max={0.8} step={0.05} onChange={(v) => setFinance({ ltv: v })} display={pct(d.finance.ltv)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0 20px', flexWrap: 'wrap' }}>
          <Button onClick={() => updateCompany((x) => withCharter(x, 'kmax'))} disabled={full}>
            Charter in a Kamsarmax
          </Button>
          <Button onClick={() => updateCompany((x) => withCharter(x, 'cape'))} disabled={full}>
            Charter in a Capesize
          </Button>
          <Button onClick={() => updateCompany(withoutLastCharter)} disabled={!charters || d.ships.length <= 1}>
            Return the last charter
          </Button>
          <span style={{ fontSize: 14, color: '#5f5f5f' }}>
            {d.ships.length} ship{d.ships.length === 1 ? '' : 's'}, {charters} chartered in
          </span>
        </div>
      </Figure>

      <P>
        {isStart ? 'The starting company' : 'Your fleet'} needs both markets at {fmt(be, 2)} times their level in {when(START_MONTH)} just to pay its way
        {isStart ? '' : ` (the starting company needs ${fmt(START_BE, 2)})`}. In the history’s worst year for it, Year {worst.year}, it would have{' '}
        {lostOrMade(worst.cashFlow)}; in its best, Year {best.year}, it would have {lostOrMade(best.cashFlow)}.{' '}
        {loanPayments > 1 ? (
          <>
            Without its loans the line moves up by the loan payments, {money(loanPayments)} a year, and the break-even falls to{' '}
            {fmt(breakEvenMultiple(noDebtD), 2)} times — but Northwind would then need {money(noDebtEquity, 1)} of its own money for the same ships,{' '}
            {noDebtEquity > EQUITY_BUDGET ? `more than its ${money(EQUITY_BUDGET, 0)} budget` : `within its ${money(EQUITY_BUDGET, 0)} budget but with ${money(EQUITY_BUDGET - noDebtEquity, 1)} left for more`}.
          </>
        ) : (
          <>It has no loan payments, so the dashed line lies on the solid one{isStart ? '' : `; the starting company’s loans cost it ${money(cashFlowAt(NO_DEBT, 1) - cashFlowAt(START, 1))} a year`}.</>
        )}{' '}
        That is <K tone="green">leverage</K> (<a href={lessonHref('shipping/2.4')}>Lesson 2.4</a>): borrowed money lets a little equity own a lot of ship, and raises
        the earnings the ship needs to survive.
      </P>
      <P>
        Now charter in a Kamsarmax with this demonstration’s button and watch the line. Each charter makes it steeper, because she earns the market’s swings on
        her days while her hire stays fixed. She adds to Northwind’s cash flow whenever her class earns more than her hire and takes from it when her class earns
        less, so the line pivots where the two are equal: for a Kamsarmax at this month’s hire, at {fmt(PIVOT_K, 2)} times the market of {when(START_MONTH)}. A
        chartered ship raises the fleet’s break-even only if her pivot lies above it. This month’s hires are below spot, so one chartered Kamsarmax lowers the
        starting company’s break-even from {fmt(START_BE, 2)} to {fmt(BE_PLUS_K, 2)} times
        {isStart
          ? ''
          : be > PIVOT_K
            ? ` and yours from ${fmt(be, 2)} to ${fmt(bePlusK, 2)}`
            : `; yours already breaks even below her pivot, so she would raise it, from ${fmt(be, 2)} to ${fmt(bePlusK, 2)}`}
        . Like a loan, a charter-in commits Northwind to paying a fixed sum whatever happens; unlike a ship bought cheap in a slump, it can’t gain in value if the
        market recovers. Owned ships with big loans and chartered ships at fixed hire both add fixed payments, and both magnify the good years and the bad.
      </P>
      <P>
        A fleet is a set of commitments: ships of particular sizes, in particular places, with costs that run every day. What it earns depends on the cargoes it
        can find. In <a href={lessonHref('shipping/6.2')}>the next lesson</a> we’ll give Northwind a market to trade in: the cargoes its brokers hear about,
        week by week, from the trades of Chapter 3.
      </P>
    </LessonPage>
  );
}
