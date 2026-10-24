import type { KeyboardEvent } from 'react';
import {
  Challenge,
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
  pct,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { capacityAuction, firmCapacityValue, interruptibleValue, type AuctionResult } from '../../../engines/gas/contracts';
import { simulateYear } from '../../../engines/gas/market';
import { COMPRESSION_COST_PER_HP, corridorDesign } from '../../../engines/gas/network';
import { MMBTU_PER_MCF } from '../../../engines/gas/properties';
import { GAS_MONTHS, GAS_MONTH_START, GAS_YEAR_DAYS, WINTER_START, gasDayLabel, monthOfDay, weatherYear } from '../../../model/gas/weather';
import { PIPELINE } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { money } from '../shared/format';

// ---------------------------------------------------------------------------
// The expansion on offer: a fourth compressor station on Northline (Lessons 1.4 and 3.1).

const NL = PIPELINE['calder-metro'];
const NL_NOW = corridorDesign(NL.id, NL.sizeIn, NL.stations);
const NL_FOUR = corridorDesign(NL.id, NL.sizeIn, NL.stations + 1);
/** Capacity the fourth station adds, Bcf/d and MMBtu/d. */
export const EXPANSION_BCFD = NL_FOUR.capacityBcfd - NL_NOW.capacityBcfd;
export const EXPANSION_MMBTU_D = EXPANSION_BCFD * 1e6 * MMBTU_PER_MCF;
/** The station's capital cost: only the added compression, $. */
export const EXPANSION_COST = (NL_FOUR.hp - NL_NOW.hp) * COMPRESSION_COST_PER_HP;
/** Share of the cost that must be earned back each year: a 30-year loan at 10% (as in Lesson 3.1). */
export const CAPACITY_CHARGE_RATE = 0.1 / (1 - Math.pow(1.1, -30));
export const EXPANSION_ANNUAL_COST = EXPANSION_COST * CAPACITY_CHARGE_RATE;
/** What each MMBtu/d of the new capacity must earn a year for the station to pay for itself, $. */
export const EXPANSION_COST_PER_UNIT = EXPANSION_ANNUAL_COST / EXPANSION_MMBTU_D;

// ---------------------------------------------------------------------------
// Twenty simulated winters: the Metro–Calder spread every day, and the days Northline was full.

export const WINTER_COUNT = 20;
/** The rate interruptible shippers pay on every MMBtu they move, $ (illustrative). */
export const IT_RATE = 0.02;

export interface CapacityWinter {
  seed: number;
  /** Metro price minus Calder price, each day of the gas year, $/MMBtu. */
  spreads: number[];
  /** Whether Northline ran at capacity that day. */
  full: boolean[];
  /** What 1 MMBtu/d of firm capacity earned over the year, $. */
  firm: number;
  /** What 1 MMBtu/d of interruptible capacity earned, $. */
  interruptible: number;
  /** Days Northline ran full. */
  fullDays: number;
  /** What firm capacity earned on its three best days, $. */
  topThree: number;
  /** The year's widest spread, its day, Metro's temperature and Metro's price that day. */
  maxSpread: number;
  maxDay: number;
  maxTemp: number;
  maxMetro: number;
}

/** Runs the market through each of the twenty winters (seeds 1–20). */
export function capacityWinters(): CapacityWinter[] {
  return Array.from({ length: WINTER_COUNT }, (_, i) => {
    const y = simulateYear({ weather: weatherYear(i + 1) });
    const spreads = y.map((d) => d.price.metro - d.price.calder);
    const full = y.map((d) => (d.flow[NL.id] ?? 0) >= NL.capacityBcfd - 1e-6);
    const margins = spreads.map((s) => Math.max(0, s - NL.variableCost)).sort((a, b) => b - a);
    const maxSpread = Math.max(...spreads);
    return {
      seed: i + 1,
      spreads,
      full,
      firm: firmCapacityValue(spreads, NL.variableCost),
      interruptible: interruptibleValue(spreads, full, NL.variableCost, IT_RATE),
      fullDays: full.filter(Boolean).length,
      topThree: margins[0] + margins[1] + margins[2],
      maxSpread,
      maxDay: spreads.indexOf(maxSpread),
      maxTemp: y[spreads.indexOf(maxSpread)].tempF,
      maxMetro: y[spreads.indexOf(maxSpread)].price.metro,
    };
  });
}

/** Computed once when the lesson loads: twenty years of the daily market take a fraction of a second. */
export const WINTERS = capacityWinters();
const FIRM_SORTED = WINTERS.map((w) => w.firm).sort((a, b) => a - b);
/** What 1 MMBtu/d of firm capacity earned in an average winter: what a marketer would bid for it, $ a year. */
export const MARKETER_BID = FIRM_SORTED.reduce((a, b) => a + b, 0) / WINTER_COUNT;
const BEST_WINTER = WINTERS.reduce((a, w) => (w.firm > a.firm ? w : a));
const UNDER_A_DOLLAR = WINTERS.filter((w) => w.firm < 1).length;
const NEVER_FULL = WINTERS.filter((w) => w.fullDays === 0).length;
const AVG_FULL_DAYS = WINTERS.reduce((a, w) => a + w.fullDays, 0) / WINTER_COUNT;
const TOP_THREE_SHARE = WINTERS.reduce((a, w) => a + w.topThree, 0) / WINTERS.reduce((a, w) => a + w.firm, 0);
/** Interruptible capacity's earnings over all twenty winters, $ (zero). */
export const IT_TOTAL = WINTERS.reduce((a, w) => a + w.interruptible, 0);
/** The winters whose best day had a real spike (over $1), their temperatures that day, and Metro's highest price. */
const SPIKES = WINTERS.filter((w) => w.maxSpread > 1);
const SPIKE_COLDEST = Math.min(...SPIKES.map((w) => w.maxTemp));
const SPIKE_WARMEST = Math.max(...SPIKES.map((w) => w.maxTemp));
export const SPIKE_METRO_PRICE = Math.max(...WINTERS.map((w) => w.maxMetro));

// ---------------------------------------------------------------------------
// The open season.

/** The most Metro's gas utility would pay for each MMBtu/d of firm capacity, $ a year (illustrative). */
export const METRO_GAS_VALUE = 110;
export const QTY_STEP = 5000;
export const QTY_MAX = 260_000;

export type AuctionRule = 'payAsBid' | 'uniform';

export const CAPACITY_AUCTION_DEFAULTS = { rule: 'payAsBid' as AuctionRule, qty: 100_000, bid: METRO_GAS_VALUE };
export type AuctionState = typeof CAPACITY_AUCTION_DEFAULTS;

export interface ExpansionOutcome {
  result: AuctionResult;
  /** Capacity awarded to Metro Gas and to the marketers, MMBtu/d. */
  metroGas: number;
  marketers: number;
  /** What the pipeline collects a year, $. */
  revenue: number;
  /** Whether that covers the station's annual cost. */
  built: boolean;
  /** What Metro Gas pays a year, $. */
  metroGasPays: number;
}

/** The open season for the expansion: Metro Gas's bid against marketers bidding what the capacity earns in an average winter. */
export function expansionOutcome(st: AuctionState): ExpansionOutcome {
  const bids = [
    { id: 'metroGas', units: st.qty, price: st.bid },
    { id: 'marketers', units: 10 * EXPANSION_MMBTU_D, price: MARKETER_BID },
  ];
  const result = capacityAuction(bids, EXPANSION_MMBTU_D, 0, st.rule);
  const metroGas = result.awards.metroGas;
  const marketers = result.awards.marketers;
  const metroGasPays = metroGas * (st.rule === 'uniform' ? result.clearingPrice : st.bid);
  return { result, metroGas, marketers, revenue: result.revenue, built: result.revenue >= EXPANSION_ANNUAL_COST - 1e-6, metroGasPays };
}

/**
 * The challenge: with each shipper paying its own bid, the smallest contract (on the slider's
 * 5,000 MMBtu/d steps) that gets the station built while Metro Gas bids no more than its $110 value.
 */
export function anchorSolved(st: AuctionState): boolean {
  if (st.rule !== 'payAsBid' || st.bid > METRO_GAS_VALUE + 1e-9) return false;
  if (!expansionOutcome(st).built) return false;
  return !expansionOutcome({ ...st, qty: st.qty - QTY_STEP, bid: METRO_GAS_VALUE }).built;
}

/** The answer: the smallest contract on the slider that pays for the station at $110. */
export const ANCHOR_ANSWER = (() => {
  for (let q = 0; q <= QTY_MAX; q += QTY_STEP) if (expansionOutcome({ rule: 'payAsBid', qty: q, bid: METRO_GAS_VALUE }).built) return q;
  return NaN;
})();

// Numbers quoted in the prose.
const DEFAULT = expansionOutcome(CAPACITY_AUCTION_DEFAULTS);
const DEFAULT_UNIFORM = expansionOutcome({ ...CAPACITY_AUCTION_DEFAULTS, rule: 'uniform' });
const ALL_MARKETERS_BEST = EXPANSION_MMBTU_D * BEST_WINTER.firm;
const ANCHOR = expansionOutcome({ rule: 'payAsBid', qty: ANCHOR_ANSWER, bid: METRO_GAS_VALUE });

// ---------------------------------------------------------------------------
// Figure 1: bids for capacity, highest first, against the expansion and its cost.

const BX = scale(0, 320_000, 64, 616);
const BY = scale(0, 140, 196, 24);
const COLORS = { metroGas: GRAPHIC.orange, marketers: GRAPHIC.violet };

function BidChart({ st, out }: { st: AuctionState; out: ExpansionOutcome }) {
  const blocks = [
    { id: 'metroGas', name: 'Metro Gas', units: st.qty, price: st.bid, won: out.metroGas, color: COLORS.metroGas },
    { id: 'marketers', name: 'Marketers', units: 320_000, price: MARKETER_BID, won: out.marketers, color: COLORS.marketers },
  ].sort((a, b) => b.price - a.price);
  let x0 = 0;
  const placed = blocks.map((b) => {
    const p = { ...b, start: x0 };
    x0 += b.units;
    return p;
  });
  const uniform = st.rule === 'uniform';
  const clear = out.result.clearingPrice;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 236"
      role="img"
      aria-label={`Bids for Northline's expansion of ${fmt(EXPANSION_MMBTU_D)} MMBtu/d, highest first: Metro Gas ${fmt(st.qty)} MMBtu/d at ${usd(st.bid)}, marketers at ${usd(MARKETER_BID, 2)}. Metro Gas wins ${fmt(out.metroGas)} and the marketers ${fmt(out.marketers)}. The pipeline collects ${money(out.revenue)} a year against the ${money(EXPANSION_ANNUAL_COST)} the station costs.`}
    >
      <text className="ax" x={64} y={14}>
        Bid, $ per MMBtu/d of capacity a year
      </text>
      <GridY y={BY} ticks={[0, 40, 80, 120]} x0={64} x1={616} format={(v) => `$${v}`} baseline={0} />
      {placed.map((b) => {
        const left = BX(Math.min(b.start, 320_000));
        const right = BX(Math.min(b.start + b.units, 320_000));
        const wonRight = BX(Math.min(b.start + b.won, 320_000));
        const top = BY(Math.min(b.price, 140));
        return (
          <g key={b.id}>
            <rect x={left} y={top} width={Math.max(0, right - left)} height={BY(0) - top} fill={tint(b.color, 0.3)} />
            <rect x={left} y={top} width={Math.max(0, wonRight - left)} height={BY(0) - top} fill={b.color} opacity={0.85} />
            {right - left > 60 && (
              <text x={left + 6} y={top - 6} style={{ fontSize: 12, fontWeight: 500, fill: b.id === 'metroGas' ? TEXT.orange : TEXT.violet }}>
                {b.name} · {usd(b.price, b.price % 1 ? 2 : 0)}
              </text>
            )}
          </g>
        );
      })}
      {uniform && out.revenue > 0 && (
        <g>
          <line x1={BX(0)} x2={BX(EXPANSION_MMBTU_D)} y1={BY(clear)} y2={BY(clear)} stroke={TEXT.green} strokeWidth={2.5} />
          <text x={BX(EXPANSION_MMBTU_D) - 4} y={BY(clear) - 6} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: TEXT.green, paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}>
            everyone pays {usd(clear, 2)}
          </text>
        </g>
      )}
      <line x1={BX(0)} x2={BX(320_000)} y1={BY(EXPANSION_COST_PER_UNIT)} y2={BY(EXPANSION_COST_PER_UNIT)} stroke={GRAPHIC.red} strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={BX(320_000)} y={BY(EXPANSION_COST_PER_UNIT) - 6} textAnchor="end" style={{ fontSize: 12, fill: TEXT.red, paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}>
        cost to build: {usd(EXPANSION_COST_PER_UNIT, 2)}
      </text>
      <line x1={BX(EXPANSION_MMBTU_D)} x2={BX(EXPANSION_MMBTU_D)} y1={BY(140)} y2={BY(0)} stroke="#333" strokeWidth={1.5} />
      <text x={BX(EXPANSION_MMBTU_D) + 5} y={BY(0) - 22} style={{ fontSize: 12, fill: '#333', paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}>
        expansion
      </text>
      <text x={BX(EXPANSION_MMBTU_D) + 5} y={BY(0) - 8} className="ax" style={{ paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}>
        {fmt(EXPANSION_MMBTU_D)} MMBtu/d
      </text>
      {[0, 100_000, 200_000, 300_000].map((v) => (
        <text key={v} className="ax ax-m" x={BX(v)} y={214}>
          {fmt(v)}
        </text>
      ))}
      <text className="ax ax-e" x={616} y={232}>
        capacity, MMBtu/d
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: twenty winters of firm and interruptible capacity.

const WX = scale(0, WINTER_COUNT, 64, 616);
const WY = scale(0, 100, 176, 24);

function WinterBars({ selected, onSelect }: { selected: number; onSelect: (n: number) => void }) {
  const slot = WX(1) - WX(0);
  const key = (n: number) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(n);
    }
  };
  return (
    <svg
      className="chart"
      viewBox="0 0 640 214"
      role="group"
      aria-label={`What 1 MMBtu/d of firm capacity on Northline earned in each of ${WINTER_COUNT} simulated winters, from ${usd(FIRM_SORTED[0], 2)} to ${usd(FIRM_SORTED[WINTER_COUNT - 1], 2)}, ${usd(MARKETER_BID, 2)} on average; interruptible capacity earned nothing in any of them. The station costs ${usd(EXPANSION_COST_PER_UNIT, 2)} a year per MMBtu/d. Winter ${selected} is selected.`}
    >
      <text className="ax" x={64} y={14}>
        Earned by 1 MMBtu/d of capacity, $ a year
      </text>
      <GridY y={WY} ticks={[0, 25, 50, 75, 100]} x0={64} x1={616} format={(v) => `$${v}`} baseline={0} />
      <line x1={64} x2={616} y1={WY(EXPANSION_COST_PER_UNIT)} y2={WY(EXPANSION_COST_PER_UNIT)} stroke={GRAPHIC.red} strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={616} y={WY(EXPANSION_COST_PER_UNIT) - 6} textAnchor="end" style={{ fontSize: 12, fill: TEXT.red }}>
        what the station needs: {usd(EXPANSION_COST_PER_UNIT, 2)}
      </text>
      <line x1={64} x2={616} y1={WY(MARKETER_BID)} y2={WY(MARKETER_BID)} stroke={GRAPHIC.violet} strokeWidth={1.5} strokeDasharray="3 3" />
      {WINTERS.map((w, i) => {
        const on = w.seed === selected;
        const x = WX(i) + slot * 0.18;
        const h = Math.max(1.5, WY(0) - WY(w.firm));
        return (
          <g key={w.seed} role="button" tabIndex={0} aria-label={`Winter ${w.seed}: firm capacity earned ${usd(w.firm, 2)}, interruptible ${usd(w.interruptible, 2)}`} aria-pressed={on} onClick={() => onSelect(w.seed)} onKeyDown={key(w.seed)} style={{ cursor: 'pointer' }}>
            <rect x={WX(i)} y={24} width={slot} height={WY(0) - 24} fill="transparent" />
            <rect x={x} y={WY(0) - h} width={slot * 0.64} height={h} fill={on ? GRAPHIC.orange : tint(GRAPHIC.orange, 0.55)} stroke={on ? '#333' : 'none'} strokeWidth={1} />
            <text className="ax ax-m" x={WX(i) + slot / 2} y={194} style={on ? { fill: '#111', fontWeight: 600 } : undefined}>
              {w.seed}
            </text>
          </g>
        );
      })}
      <text className="ax ax-e" x={616} y={210}>
        simulated winter
      </text>
    </svg>
  );
}

const SEASON_START = WINTER_START;
const SEASON_DAYS = Array.from({ length: GAS_YEAR_DAYS - SEASON_START }, (_, i) => SEASON_START + i);
const MONTH_TICKS = [7, 8, 9, 10, 11].map((m) => GAS_MONTH_START[m]);

export default function Lesson() {
  const a = useScenario('open-season', CAPACITY_AUCTION_DEFAULTS);
  const st = a.state;
  const out = expansionOutcome(st);
  const solved = anchorSolved(st);
  const avgRate = out.revenue / EXPANSION_MMBTU_D;
  const short = EXPANSION_ANNUAL_COST - out.revenue;

  const w = useScenario('winters', { winter: BEST_WINTER.seed });
  const win = WINTERS[w.state.winter - 1];
  const spreads = SEASON_DAYS.map((d) => win.spreads[d]);
  const fullPts = SEASON_DAYS.filter((d) => win.full[d]);

  const status =
    st.rule !== 'payAsBid'
      ? `Under a uniform price Metro Gas pays only the lowest winning bid, so the pipeline collects ${money(out.revenue)} — set the rule so each shipper pays its own bid.`
      : st.bid > METRO_GAS_VALUE
        ? `Metro Gas can’t justify more than ${usd(METRO_GAS_VALUE)}: lower its bid.`
        : out.built
          ? `At ${fmt(st.qty)} MMBtu/d the pipeline collects ${money(out.revenue)} a year and the station gets built. Could Metro Gas sign up for less?`
          : `At ${fmt(st.qty)} MMBtu/d and ${usd(st.bid)}, the pipeline collects ${money(out.revenue)} a year, ${money(short)} short of what the station costs.`;

  return (
    <LessonPage id="gas/4.3">
      <P>
        <a href={lessonHref('gas/4.2')}>The previous lesson</a> priced every place on the map. While Northline has room, Metro’s gas costs Calder Hub’s price plus the
        ${NL.variableCost.toFixed(2)} it takes to move an MMBtu up the line; when the line fills, Metro’s price breaks away. On those days, whoever holds the right to put
        gas into Northline at Calder and take it out at Metro can buy at one price, sell at the other, and keep the difference. So who holds that right, and how is it
        sold? <a href={lessonHref('gas/3.1')}>Lesson 3.1</a> left a hint: pipelines in North America are built only after shippers sign long-term contracts for their
        capacity.
      </P>
      <P>
        A pipeline company in the United States doesn’t own the gas it carries. Since the early 1990s, when federal regulators separated the two businesses, interstate
        pipelines have sold transportation only. The gas belongs to <b>shippers</b> — utilities, power plants, producers and marketers — who rent space in the pipe. The
        space comes in two kinds. <K tone="orange">Firm capacity</K> is a reservation, measured in MMBtu a day (dekatherms a day, in contracts): the shipper pays a{' '}
        <K c="price">reservation charge</K> for every unit, every day, whether it uses the space or not, plus a small charge for each MMBtu it actually moves, and its gas
        is guaranteed to flow. <K tone="orange">Interruptible capacity</K> costs nothing to hold. The shipper pays only for the gas it moves, but its gas is scheduled
        after every firm shipper’s, and when the pipe is full it is the first to be cut.
      </P>
      <P>
        Firm contracts are what pay for steel. Take the expansion of <a href={lessonHref('gas/1.4')}>Lessons 1.4</a> and{' '}
        <a href={lessonHref('gas/3.1')}>3.1</a>: a fourth compressor station on Northline. It adds{' '}
        {fmt(EXPANSION_BCFD, 2)} Bcf/d, or {fmt(EXPANSION_MMBTU_D)} MMBtu/d, and its {fmt(Math.round((NL_FOUR.hp - NL_NOW.hp) / 100) * 100)} horsepower cost{' '}
        {money(EXPANSION_COST)}. Earning that back over 30 years at a 10% return, the way Lesson 3.1 did, takes {money(EXPANSION_ANNUAL_COST)} a year:{' '}
        {usd(EXPANSION_COST_PER_UNIT, 2)} for each MMBtu/d of the new capacity, about {usd(EXPANSION_COST_PER_UNIT / 12, 2)} a month, or{' '}
        {fmt((EXPANSION_COST_PER_UNIT / 365) * 100)}¢ on every MMBtu if the space were used every day.
      </P>
      <P>
        Before building, the pipeline holds an <b>open season</b>: it offers the new capacity and asks shippers to bid. Two kinds turn up here. Marketers would pay what
        the space earns from the Metro–Calder spread in an average winter, {usd(MARKETER_BID, 2)} per MMBtu/d a year — the second demonstration shows where that number
        comes from. Metro Gas, the city’s utility, has a different reason to bid: it must keep homes warm on the coldest day of the year, and its next-best way of doing
        that, a peaking plant of its own near the city, would cost more than {usd(METRO_GAS_VALUE)} a year for each MMBtu/d (an illustrative figure). You are Metro Gas.
        In the next demonstration, choose how much capacity to sign up for, what to bid, and how the pipeline charges the winners:
      </P>

      <Figure name="Capacity Auction" scenario={a}>
        <Segmented
          label="How winners pay"
          value={st.rule}
          onChange={(v) => a.set({ rule: v })}
          options={[
            { value: 'payAsBid', label: 'Each pays its own bid' },
            { value: 'uniform', label: 'All pay the lowest winning bid' },
          ]}
        />
        <BidChart st={st} out={out} />
        <Legend
          items={[
            { label: 'Metro Gas, capacity won', color: COLORS.metroGas },
            { label: 'Marketers, capacity won', color: COLORS.marketers },
            { label: 'Bid but not won', color: tint(GRAPHIC.gray, 0.4) },
          ]}
        />
        <Readouts
          items={[
            { label: 'Metro Gas wins', value: `${fmt(out.metroGas)} MMBtu/d`, tone: 'orange' },
            { label: 'the pipeline collects a year', value: money(out.revenue), tone: 'green' },
            { label: 'average rate per MMBtu/d', value: usd(avgRate, 2), tone: 'green' },
            { label: 'the station', value: out.built ? 'gets built' : `${money(short)} short`, tone: out.built ? 'green' : 'red' },
          ]}
        />
        <Slider
          label="Metro Gas signs up for"
          tone="orange"
          value={st.qty}
          min={0}
          max={QTY_MAX}
          step={QTY_STEP}
          onChange={(v) => a.set({ qty: v })}
          display={`${fmt(st.qty)} MMBtu/d · ${pct(Math.min(st.qty, EXPANSION_MMBTU_D) / EXPANSION_MMBTU_D)}`}
        />
        <Slider label="Metro Gas bids" tone="green" value={st.bid} min={0} max={150} step={5} onChange={(v) => a.set({ bid: v })} display={`${usd(st.bid)} per MMBtu/d a year`} />
      </Figure>

      <P>
        At the starting settings Metro Gas signs up for {fmt(CAPACITY_AUCTION_DEFAULTS.qty)} MMBtu/d at {usd(METRO_GAS_VALUE)}, and the marketers take the other{' '}
        {fmt(DEFAULT.marketers)} at {usd(MARKETER_BID, 2)}. Each paying its own bid, the pipeline collects {money(DEFAULT.revenue)} a year, well short of the{' '}
        {money(EXPANSION_ANNUAL_COST)} the station costs. Switch the rule so every winner pays the lowest winning bid and it collects only{' '}
        {money(DEFAULT_UNIFORM.revenue)}: Metro Gas now pays the marketers’ {usd(MARKETER_BID, 2)} too, because the last unit of capacity went to a marketer.
      </P>
      <P>
        The marketers’ money comes nowhere near paying for the station. Even if they bid what the capacity earned in the harshest of our twenty simulated winters,{' '}
        {usd(BEST_WINTER.firm, 2)}, and took all of it, they would pay {money(ALL_MARKETERS_BEST)} a year. A spread that opens on a handful of days isn’t worth enough to
        build for. What pays for pipelines is the shippers who need the space for something other than arbitrage.
      </P>

      <Challenge
        id="a"
        question={`With each shipper paying its own bid, and Metro Gas bidding no more than its ${usd(METRO_GAS_VALUE)} value, what’s the smallest contract, to the nearest ${fmt(QTY_STEP)} MMBtu/d, that gets the station built?`}
        solved={solved}
        status={status}
        success={`Solved: ${fmt(ANCHOR_ANSWER)} MMBtu/d, ${pct(ANCHOR_ANSWER / EXPANSION_MMBTU_D)} of the new capacity, at ${usd(METRO_GAS_VALUE)}. The pipeline then collects ${money(ANCHOR.revenue)} a year against a cost of ${money(EXPANSION_ANNUAL_COST)}; the marketers’ ${fmt(ANCHOR.marketers)} MMBtu/d adds only ${money(ANCHOR.marketers * MARKETER_BID)}. The expansion is built on the back of one customer who needs nearly all of it — an anchor shipper.`}
      />

      <H2>Anchor shippers</H2>
      <P>
        That is how most new pipelines in North America get financed. The pipeline company signs <b>precedent agreements</b> with a few large shippers — usually
        utilities, power generators or producers who must get their gas out — committing them to most of the capacity for many years, and only then asks regulators to
        approve construction. For interstate lines in the United States, the Federal Energy Regulatory Commission sets the maximum rates a pipeline may charge, based on
        its cost of service, and the pipeline recovers most of its fixed costs through reservation charges, so its income doesn’t depend on how much gas flows. Shippers
        may also negotiate rates of their own. Either way, each pays its own rate, as in the first rule of{' '}
        <FigRef to="Capacity Auction">the first demonstration</FigRef>, rather than a single clearing price.
      </P>

      <H2>Firm and interruptible</H2>
      <P>
        A buyer who needs reliability pays for it in the reservation charge, every day of the year, to be sure of a few. To see how few, the next demonstration follows
        one MMBtu/d of capacity on today’s Northline through twenty simulated winters of the market from the previous lessons, holding it two ways: firm, earning the
        Metro–Calder spread less the ${NL.variableCost.toFixed(2)} cost of moving gas every day; and interruptible, earning the same but only on the days the pipe has room,
        and paying a further {usd(IT_RATE, 2)} on every MMBtu moved. Choose a winter to see its days:
      </P>

      <Figure name="Capacity Auction · firm and interruptible" scenario={w}>
        <WinterBars selected={w.state.winter} onSelect={(n) => w.set({ winter: n })} />
        <Legend
          items={[
            { label: 'Firm capacity, each winter', color: tint(GRAPHIC.orange, 0.55) },
            { label: `Average of the twenty, ${usd(MARKETER_BID, 2)}`, color: GRAPHIC.violet, kind: 'line', dashed: true },
            { label: `What the station needs, ${usd(EXPANSION_COST_PER_UNIT, 2)}`, color: GRAPHIC.red, kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          xDomain={[SEASON_START, GAS_YEAR_DAYS]}
          yDomain={[0, 12]}
          xTicks={MONTH_TICKS}
          yTicks={[0, 4, 8, 12]}
          xFormat={(v) => GAS_MONTHS[monthOfDay(v)]}
          yFormat={(v) => `$${v}`}
          yLabel={`Metro minus Calder in winter ${win.seed}, $/MMBtu`}
          height={190}
          series={[
            { xs: SEASON_DAYS, ys: spreads, color: GRAPHIC.green, width: 1.8 },
            { xs: fullPts, ys: fullPts.map((d) => win.spreads[d]), color: GRAPHIC.red, kind: 'points', r: 3.5 },
          ]}
          hLines={[{ at: NL.variableCost, color: '#777', dash: '4 4', label: `cost of moving gas, $${NL.variableCost.toFixed(2)}`, labelAt: 'start' }]}
          ariaLabel={`The Metro–Calder spread each day from November to March in winter ${win.seed}. Northline ran full on ${win.fullDays} days; the widest spread was ${usd(win.maxSpread, 2)} on ${gasDayLabel(win.maxDay)}.`}
        />
        <Legend
          items={[
            { label: 'Daily spread', color: GRAPHIC.green, kind: 'line' },
            { label: 'Northline full that day', color: GRAPHIC.red },
          ]}
        />
        <Readouts
          items={[
            { label: `firm capacity earned in winter ${win.seed}`, value: usd(win.firm, 2), tone: 'orange' },
            { label: 'days Northline ran full', value: fmt(win.fullDays) },
            { label: 'earned on its 3 best days', value: win.firm > 0.005 ? pct(win.topThree / win.firm) : '—' },
            { label: 'interruptible capacity earned', value: usd(win.interruptible, 2), tone: 'red' },
          ]}
        />
        <Slider label="Winter" value={w.state.winter} min={1} max={WINTER_COUNT} onChange={(v) => w.set({ winter: v })} display={`${w.state.winter} of ${WINTER_COUNT}`} />
      </Figure>

      <P>
        Firm capacity’s value is lumpy. Averaged over the twenty winters it earned {usd(MARKETER_BID, 2)} a year — the marketers’ bid — but in {UNDER_A_DOLLAR} of them
        it earned less than a dollar, and the best, winter {BEST_WINTER.seed}, brought in {usd(BEST_WINTER.firm, 2)}. Northline ran full on {fmt(AVG_FULL_DAYS, 1)} days
        a winter on average, and in {NEVER_FULL} of them never at all. Across all twenty, {pct(TOP_THREE_SHARE)} of what firm capacity earned came from each winter’s
        three best days. Those are the coldest days, between {fmt(SPIKE_COLDEST)} and {fmt(SPIKE_WARMEST)} °F in these runs, when Metro wants more gas than Northline,
        the Valley Line and Hollow Creek’s wells can deliver together. The interruptible industry has already been cut, and Metro’s price climbs as high
        as {usd(SPIKE_METRO_PRICE, 2)}, the price at which the city’s gas-fired power plants would rather burn oil.
      </P>
      <P>
        Interruptible capacity earned nothing, in every one of the {WINTER_COUNT} winters. It flows only on days the pipe has room, and on
        those days Metro’s price is exactly Calder’s plus the cost of moving the gas, so there is no spread left to earn. The pipeline cuts interruptible gas on exactly
        the days it would be valuable. That is why it is cheap, and why no utility relies on it to keep homes warm.
      </P>
      <P>
        This is the same arithmetic as the transmission rights of the electricity course, where the holder of a right between two nodes is paid the difference
        between their prices (<a href={lessonHref('5.4')}>Lesson 5.4</a> of that course). The difference is who collects. On the grid the operator gathers the
        congestion rent and hands it to the rights’ holders; on a gas pipeline the firm shipper captures it directly, by buying at one end and selling at the other.
      </P>

      <H2>Reselling the space</H2>
      <P>
        Metro Gas now holds capacity it needs on a few days a year and pays for on all of them. Firm shippers don’t have to leave it idle: under the{' '}
        <b>capacity release</b> rules, they can resell their space to other shippers for a day, a month or longer, and recover some of the reservation charge. A
        marketer who expects a cold February can buy released capacity on Northline for that month and bet on the spread. The pipeline, meanwhile, can sell any space
        its firm shippers leave unscheduled on a given day as interruptible service. Between the original contracts, the releases and the interruptible sales, the
        same physical space is bought and sold many times, and what it fetches each time is the price difference it can carry gas across.
      </P>
      <P>
        Capacity rights put a price on the difference between two places. The other great difference in gas is between two seasons: the same molecule is worth less in
        July than in January, and what links the two is storage. That is the subject of <a href={lessonHref('gas/4.4')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
