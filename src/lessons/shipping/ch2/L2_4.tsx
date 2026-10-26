import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  GridY,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  TEXT,
  Tn,
  fmt,
  lessonHref,
  pct,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { KESTREL } from '../../../model/shipping/vessels';
import {
  NEWBUILD_PRICE,
  OPEX,
  OPEX_LABEL,
  SCRAP_PER_LDT,
  SHIP_LIFE,
  annualResult,
  breakeven,
  dailyCost,
  opexTotal,
  scrapValue,
  type DailyCost,
  type Opex,
} from '../../../engines/shipping/economics';
import { ballastDraft, fuelPerDay, ladenDraft } from '../../../engines/shipping/voyage';
import { FUELS } from '../../../engines/shipping/propulsion';

const V = KESTREL;
const BASE_OPEX = OPEX[V.id];
const NEW_PRICE = NEWBUILD_PRICE[V.id];
const SCRAP = scrapValue(V);
/** The return Northwind's owners expect on the money they put into a ship, per year (model assumption). */
export const EQUITY_RETURN = 0.1;

const PRICE_MIN = 15;
const PRICE_MAX = 45;
const PRICE_STEP = 0.5;
/** The challenge's market rate, $/day. */
export const CHALLENGE_TCE = 15_000;

export interface CostState {
  /** Purchase price, $ million. */
  price: number;
  age: number;
  ltv: number;
  rate: number;
  tenor: number;
  offHire: number;
  tce: number;
}

export const DEFAULTS: CostState = { price: NEW_PRICE, age: 0, ltv: 0.6, rate: 0.07, tenor: 15, offHire: 10, tce: CHALLENGE_TCE };

/** Kestrel's daily costs and break-evens for a purchase and its financing. */
export function costsFor(s: CostState, opex: Opex = BASE_OPEX) {
  const c = dailyCost(V, opex, { price: s.price * 1e6, age: s.age, ltv: s.ltv, rate: s.rate, tenor: s.tenor, equityReturn: EQUITY_RETURN });
  const b = breakeven(c, s.offHire);
  const year = annualResult(s.tce, c, s.offHire);
  return { c, b, year };
}

/** True when the loan, its interest rate and the off-hire days are the starting ones (the repayment period doesn't touch full cost). */
export function startingFinancing(s: CostState): boolean {
  return Math.abs(s.ltv - DEFAULTS.ltv) < 1e-9 && Math.abs(s.rate - DEFAULTS.rate) < 1e-9 && s.offHire === DEFAULTS.offHire;
}

/**
 * The challenge: with the market at $15,000 a day, a new ship and the starting financing, the highest
 * price on the slider (in $0.5 million steps) at which Kestrel still covers her full cost — predicted
 * first from the slope of full cost against price.
 */
export function maxPriceSolved(s: CostState): boolean {
  if (s.tce !== CHALLENGE_TCE || s.age !== 0 || !startingFinancing(s)) return false;
  const full = (price: number) => costsFor({ ...s, price }).b.full;
  if (full(s.price) > s.tce + 1e-9) return false;
  const next = Math.round((s.price + PRICE_STEP) * 10) / 10;
  return next > PRICE_MAX + 1e-9 || full(next) > s.tce + 1e-9;
}

/** What $1 million on her price adds to each daily cost at the starting financing: per calendar day, and to full cost per earning day. */
export const PER_MILLION = (() => {
  const a = costsFor(DEFAULTS);
  const b = costsFor({ ...DEFAULTS, price: DEFAULTS.price - 1 });
  return { interest: a.c.interest - b.c.interest, depreciation: a.c.depreciation - b.c.depreciation, equity: a.c.equity - b.c.equity, full: a.b.full - b.b.full };
})();

/** The highest price on the slider grid that covers full cost, or null if none does. */
export function maxPriceFor(s: CostState): number | null {
  let best: number | null = null;
  for (let p = PRICE_MIN; p <= PRICE_MAX + 1e-9; p = Math.round((p + PRICE_STEP) * 10) / 10) if (costsFor({ ...s, price: p }).b.full <= s.tce + 1e-9) best = p;
  return best;
}

// ---------------------------------------------------------------------------
// Ships of three ages. All of these are model assumptions, illustrative in size.

/** Wear-related operating costs (insurance, repairs, stores, drydocking) rise this much a year of age. */
export const OPEX_GROWTH_PER_YEAR = 0.025;
/** An older engine and hull burn this much more fuel per year of age. */
export const FUEL_GROWTH_PER_YEAR = 0.01;
/** Days off hire a year: a new ship’s, plus more as she ages. */
export const OFFHIRE_NEW = 5;
export const OFFHIRE_PER_YEAR = 0.6;
/** Share of earning days spent at sea rather than in port. */
export const AT_SEA_SHARE = 0.8;
/** Service speed for the fuel comparison, knots. */
export const COMPARE_SPEED = 12;

export const AGED: Array<{ age: number; name: string; price: number }> = [
  { age: 0, name: 'New', price: NEW_PRICE },
  { age: 10, name: '10 years old', price: 22 },
  { age: 20, name: '20 years old', price: 9 },
];

export function opexAtAge(age: number): Opex {
  const k = 1 + OPEX_GROWTH_PER_YEAR * age;
  return { ...BASE_OPEX, insurance: BASE_OPEX.insurance * k, repairs: BASE_OPEX.repairs * k, stores: BASE_OPEX.stores * k, drydock: BASE_OPEX.drydock * k };
}

/** Fuel at sea for a modern Kestrel at the comparison speed: the average of a laden and a ballast day, t/day. */
export const SEA_TPD = (fuelPerDay(V, COMPARE_SPEED, ladenDraft(V, 75_000)) + fuelPerDay(V, COMPARE_SPEED, ballastDraft(V))) / 2;

/** A ship of an age, financed 60% at 7%, compared at a bunker price. All per earning day. */
export function agedShip(age: number, price: number, bunker: number) {
  const opex = opexAtAge(age);
  const offHire = OFFHIRE_NEW + OFFHIRE_PER_YEAR * age;
  const earning = (365 - offHire) / 365;
  const c = dailyCost(V, opex, { price: price * 1e6, age, ltv: 0.6, rate: 0.07, tenor: 15, equityReturn: EQUITY_RETURN });
  const fuelFactor = 1 + FUEL_GROWTH_PER_YEAR * age;
  const tpd = SEA_TPD * fuelFactor;
  const extraFuel = (fuelFactor - 1) * SEA_TPD * bunker * AT_SEA_SHARE;
  const operating = c.opex / earning;
  const capital = (c.interest + c.depreciation + c.equity) / earning;
  return { age, price, opex: c.opex, offHire, tpd, extraFuel, operating, capital, runningBreakeven: operating + extraFuel, fullBreakeven: operating + extraFuel + capital };
}

// ---------------------------------------------------------------------------
// Drawing.

const OPEX_KEYS: Array<keyof Opex> = ['crew', 'insurance', 'repairs', 'stores', 'management', 'drydock'];
const OPEX_COLORS = ['#4f8a80', '#6a9e95', '#86b2aa', '#a2c6bf', '#bdd9d3', '#d6eae6'];
const CAP_COLOR = { interest: GRAPHIC.gold, principal: '#e3c87a', depreciation: GRAPHIC.violet, equity: '#d2b0d9', offHire: '#c9c9c9' };

const k$ = (x: number) => `$${fmt(x / 1000)}k`;
const perDay = (x: number) => `${usd(x)}/day`;
/** Prices in $ million, as the whole chapter writes them: $36.0 million. */
const $M = (millions: number) => `${usd(millions, 1)} million`;
const money = (x: number) => (Math.abs(x) >= 1e6 ? $M(x / 1e6) : usd(x));

interface Seg {
  key: string;
  label: string;
  value: number;
  color: string;
}

function stackSegments(c: DailyCost, opex: Opex, earning: number, kind: 'cash' | 'full'): Seg[] {
  const segs: Seg[] = OPEX_KEYS.map((k, i) => ({ key: k, label: OPEX_LABEL[k], value: opex[k], color: OPEX_COLORS[i] }));
  segs.push({ key: 'interest', label: 'Interest', value: c.interest, color: CAP_COLOR.interest });
  if (kind === 'cash') segs.push({ key: 'principal', label: 'Loan repayment', value: c.principal, color: CAP_COLOR.principal });
  else {
    segs.push({ key: 'depreciation', label: 'Depreciation', value: c.depreciation, color: CAP_COLOR.depreciation });
    segs.push({ key: 'equity', label: 'Return on equity', value: c.equity, color: CAP_COLOR.equity });
  }
  const total = segs.reduce((s, x) => s + x.value, 0);
  segs.push({ key: 'offHire', label: 'Off-hire days', value: total / earning - total, color: CAP_COLOR.offHire });
  return segs;
}

const Y_MAX = 40_000;
const Y = scale(0, Y_MAX, 268, 24);

function CostBars({ s, c }: { s: CostState; c: DailyCost }) {
  const earning = (365 - s.offHire) / 365;
  const opex = BASE_OPEX;
  const bars = [
    { name: 'Cash break-even', x: 92, segs: stackSegments(c, opex, earning, 'cash') },
    { name: 'Full-cost break-even', x: 226, segs: stackSegments(c, opex, earning, 'full') },
  ];
  const W = 92;
  const legend: Seg[] = [
    ...OPEX_KEYS.map((k, i) => ({ key: k, label: OPEX_LABEL[k], value: opex[k], color: OPEX_COLORS[i] })),
    { key: 'interest', label: 'Interest', value: c.interest, color: CAP_COLOR.interest },
    { key: 'principal', label: 'Loan repayment (cash)', value: c.principal, color: CAP_COLOR.principal },
    { key: 'depreciation', label: 'Depreciation (full)', value: c.depreciation, color: CAP_COLOR.depreciation },
    { key: 'equity', label: 'Return on equity (full)', value: c.equity, color: CAP_COLOR.equity },
  ];
  const tceY = Y(Math.min(Y_MAX, s.tce));
  const totals = bars.map((b) => b.segs.reduce((t, x) => t + x.value, 0));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Kestrel’s costs per earning day. Cash break-even ${perDay(totals[0])}, full-cost break-even ${perDay(totals[1])}, against a market TCE of ${perDay(s.tce)}. Operating costs ${perDay(opexTotal(opex))}; interest ${perDay(c.interest)}, loan repayment ${perDay(c.principal)}, depreciation ${perDay(c.depreciation)}, return on equity ${perDay(c.equity)}, all per calendar day; off-hire adds the rest.`}
    >
      <text className="ax" x={56} y={12}>
        $ per earning day
      </text>
      <GridY y={Y} ticks={[0, 10_000, 20_000, 30_000, 40_000]} x0={56} x1={352} format={k$} baseline={0} />
      {bars.map((b, bi) => {
        let acc = 0;
        return (
          <g key={b.name}>
            {b.segs.map((sg) => {
              const y0 = Y(Math.min(Y_MAX, acc));
              acc += sg.value;
              const y1 = Y(Math.min(Y_MAX, acc));
              return <rect key={sg.key} x={b.x} y={y1} width={W} height={Math.max(0, y0 - y1)} fill={sg.color} stroke="#fcfcfb" strokeWidth={0.6} />;
            })}
            <text x={b.x + W / 2} y={Math.max(20, Y(Math.min(Y_MAX, totals[bi])) - 6)} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: TEXT.ink }}>
              {usd(totals[bi])}
              {totals[bi] > Y_MAX ? ' ↑' : ''}
            </text>
            <text x={b.x + W / 2} y={286} textAnchor="middle" className="ax">
              {b.name}
            </text>
          </g>
        );
      })}
      <line x1={56} x2={352} y1={tceY} y2={tceY} stroke={TEXT.green} strokeWidth={2} strokeDasharray="6 4" />
      <text x={352} y={tceY - 6} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: TEXT.green }}>
        market TCE {usd(s.tce)}
      </text>
      {legend.map((l, i) => (
        <g key={l.key}>
          <rect x={380} y={30 + i * 21} width={10} height={10} rx={2} fill={l.color} />
          <text x={396} y={39 + i * 21} className="ax">
            {l.label}
          </text>
          <text x={630} y={39 + i * 21} textAnchor="end" className="ax" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {usd(l.value)}
          </text>
        </g>
      ))}
      <rect x={380} y={30 + legend.length * 21} width={10} height={10} rx={2} fill={CAP_COLOR.offHire} />
      <text x={396} y={39 + legend.length * 21} className="ax">
        Spread over {fmt(365 - s.offHire)} earning days
      </text>
      <text x={630} y={30 + (legend.length + 1) * 21 + 8} textAnchor="end" className="ax">
        legend values per calendar day
      </text>
    </svg>
  );
}

const AGE_Y_MAX = 30_000;
const AY = scale(0, AGE_Y_MAX, 236, 26);
const AGE_COLORS = { operating: '#6a9e95', fuel: GRAPHIC.red, capital: GRAPHIC.violet };

function AgeBars({ ships, tce }: { ships: ReturnType<typeof agedShip>[]; tce: number }) {
  const W = 84;
  const xs = [96, 236, 376];
  const tceY = AY(Math.min(AGE_Y_MAX, tce));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 268"
      role="img"
      aria-label={`Break-even TCE for Kamsarmaxes of three ages against a market TCE of ${perDay(tce)}: ${ships
        .map((sh) => `${AGED.find((a) => a.age === sh.age)!.name}, running costs ${perDay(sh.runningBreakeven)} and full cost ${perDay(sh.fullBreakeven)}`)
        .join('; ')}.`}
    >
      <text className="ax" x={56} y={12}>
        Break-even, $ per earning day
      </text>
      <GridY y={AY} ticks={[0, 10_000, 20_000, 30_000]} x0={56} x1={500} format={k$} baseline={0} />
      {ships.map((sh, i) => {
        const parts = [
          { key: 'operating', v: sh.operating, color: AGE_COLORS.operating },
          { key: 'fuel', v: sh.extraFuel, color: AGE_COLORS.fuel },
          { key: 'capital', v: sh.capital, color: AGE_COLORS.capital },
        ];
        let acc = 0;
        const runY = AY(Math.min(AGE_Y_MAX, sh.runningBreakeven));
        const covers = tce >= sh.runningBreakeven;
        return (
          <g key={sh.age}>
            {parts.map((p) => {
              const y0 = AY(Math.min(AGE_Y_MAX, acc));
              acc += p.v;
              const y1 = AY(Math.min(AGE_Y_MAX, acc));
              return <rect key={p.key} x={xs[i]} y={y1} width={W} height={Math.max(0, y0 - y1)} fill={p.color} opacity={p.key === 'capital' ? 0.55 : 0.85} stroke="#fcfcfb" strokeWidth={0.6} />;
            })}
            <line x1={xs[i] - 6} x2={xs[i] + W + 6} y1={runY} y2={runY} stroke="#333" strokeWidth={1.5} />
            <text x={xs[i] + W / 2} y={Math.max(18, AY(Math.min(AGE_Y_MAX, sh.fullBreakeven)) - 6)} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: TEXT.ink }}>
              {usd(sh.fullBreakeven)}
            </text>
            <text x={xs[i] + W / 2} y={252} textAnchor="middle" className="ax">
              {AGED[i].name}
            </text>
            <text x={xs[i] + W / 2} y={266} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: covers ? TEXT.green : TEXT.red }}>
              {covers ? 'covers running costs' : 'loses cash trading'}
            </text>
          </g>
        );
      })}
      <line x1={56} x2={500} y1={tceY} y2={tceY} stroke={TEXT.green} strokeWidth={2} strokeDasharray="6 4" />
      <text x={500} y={tceY - 6} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: TEXT.green }}>
        market TCE {usd(tce)}
      </text>
      {[
        { label: 'Operating costs', color: AGE_COLORS.operating, op: 0.85 },
        { label: 'Extra fuel', color: AGE_COLORS.fuel, op: 0.85 },
        { label: 'Capital costs', color: AGE_COLORS.capital, op: 0.55 },
      ].map((l, i) => (
        <g key={l.label}>
          <rect x={516} y={40 + i * 20} width={10} height={10} rx={2} fill={l.color} opacity={l.op} />
          <text x={532} y={49 + i * 20} className="ax">
            {l.label}
          </text>
        </g>
      ))}
      <line x1={512} x2={528} y1={109} y2={109} stroke="#333" strokeWidth={1.5} />
      <text x={532} y={113} className="ax">
        Running-cost
      </text>
      <text x={532} y={127} className="ax">
        break-even
      </text>
    </svg>
  );
}

export default function Lesson() {
  const sim = useScenario('costs', DEFAULTS);
  // The calculator prices a new ship; ships of other ages are the second demonstration's job (a saved scenario's age is ignored).
  const s: CostState = { ...sim.state, age: 0 };
  const { c, b, year } = costsFor(s);
  const solved = maxPriceSolved(s);
  const earning = 365 - s.offHire;

  const ag = useScenario('age', { tce: 12_000, bunker: FUELS.vlsfo.price });
  const ships = useMemo(() => AGED.map((a) => agedShip(a.age, a.price, ag.state.bunker)), [ag.state.bunker]);

  // Numbers quoted in the prose, all at the starting settings unless noted.
  const d0 = costsFor(DEFAULTS);
  const ltv80 = costsFor({ ...DEFAULTS, ltv: 0.8 });
  const ltv0 = costsFor({ ...DEFAULTS, ltv: 0 });
  const ten10 = costsFor({ ...DEFAULTS, tenor: 10 });
  const ten20 = costsFor({ ...DEFAULTS, tenor: 20 });
  const answer = maxPriceFor(DEFAULTS);
  const answerFull = answer === null ? 0 : costsFor({ ...DEFAULTS, price: answer }).b.full;
  const opexSum = opexTotal(BASE_OPEX);
  const offHireAdd = (x: number) => x / ((365 - DEFAULTS.offHire) / 365) - x;
  const ships600 = AGED.map((a) => agedShip(a.age, a.price, FUELS.vlsfo.price));

  return (
    <LessonPage id="shipping/2.4">
      <P>
        <a href={lessonHref('shipping/2.3')}>The previous lesson</a> boiled a voyage down to a single number: the <K tone="green">time-charter equivalent</K>, what a
        day of Kestrel’s time earns once her fuel, port charges and canal tolls are paid. That is one side of Northwind Bulk’s ledger. The other side is what a
        day of Kestrel costs — and most of it is owed whether she is carrying cargo, waiting at anchor for one, or lying in a shipyard. This lesson adds those
        costs up and asks a single question: what TCE does Kestrel need to earn to break even?
      </P>
      <P>
        Shipping economists sort a ship’s costs into three kinds. <b>Voyage costs</b> — fuel, port charges, canal tolls — depend on the voyage, and the TCE has
        already taken them out. <K tone="green">Operating costs</K> are the price of keeping a ship ready to trade: her crew, her insurance, repairs and
        maintenance, stores and lubricating oil, the manager who runs her, and a reserve for the drydockings in which her hull is inspected and repainted. They are
        paid by the day, cargo or no cargo. For Kestrel they come to {usd(opexSum)} a day in our model, {pct(BASE_OPEX.crew / opexSum)} of it for her crew. And
        then there are <K tone="green">capital costs</K>: the ship itself, paid for with a bank loan and the owners’ own money. All the money in this course is
        illustrative — realistic in size, not a quotation for any real ship.
      </P>
      <P>
        In the next demonstration, Northwind buys Kestrel and borrows part of her price. The left bar stacks up what a day costs in cash; the right bar what it costs
        once the ship’s wear and the owners’ return are counted. Both are spread over the days she actually earns, and the dashed line is what the market pays her.
        Change the price, the financing, the days she spends off hire and the market rate:
      </P>

      <Figure name="Ship Economics Calculator" scenario={sim}>
        <CostBars s={s} c={c} />
        <Readouts
          items={[
            { label: 'cash flow a year, after the loan', value: money(year.cashFlow), tone: year.cashFlow < 0 ? 'red' : undefined },
            { label: 'profit a year, after depreciation', value: money(year.profit), tone: year.profit < 0 ? 'red' : undefined },
          ]}
        />
        <Slider label="Purchase price" tone="green" value={s.price} min={PRICE_MIN} max={PRICE_MAX} step={PRICE_STEP} onChange={(v) => sim.set({ price: v })} display={$M(s.price)} />
        <Slider label="Loan, share of price" value={s.ltv} min={0} max={0.8} step={0.05} onChange={(v) => sim.set({ ltv: v })} display={pct(s.ltv)} />
        <Slider label="Interest rate" value={s.rate} min={0.03} max={0.12} step={0.0025} onChange={(v) => sim.set({ rate: v })} display={pct(s.rate, 2)} />
        <Slider label="Loan repaid over" value={s.tenor} min={5} max={20} onChange={(v) => sim.set({ tenor: v })} display={`${s.tenor} years`} />
        <Slider label="Days off hire a year" tone="teal" value={s.offHire} min={0} max={30} onChange={(v) => sim.set({ offHire: v })} display={`${s.offHire} days`} />
        <Slider label="Market TCE" tone="green" value={s.tce} min={5_000} max={35_000} step={250} onChange={(v) => sim.set({ tce: v })} display={perDay(s.tce)} />
        <Eq label={`Full-cost break-even equals operating costs plus interest plus depreciation plus return on equity, divided by the share of days earning: ${usd(b.full)} a day`}>
          <span>full break-even</span>
          <Op>=</Op>
          <Frac
            top={
              <span>
                <Tn tone="green">{usd(c.opex)}</Tn> + {usd(c.interest)} + {usd(c.depreciation)} + {usd(c.equity)}
              </span>
            }
            bottom={<span>{fmt(earning)} ÷ 365</span>}
          />
          <Op>=</Op>
          <K tone="green">{perDay(b.full)}</K>
        </Eq>
        <Caption>
          {s.tce >= b.full
            ? `At ${perDay(s.tce)} Kestrel pays her running costs, her bank and her owners’ ${pct(EQUITY_RETURN)} return.`
            : s.tce >= b.cash
              ? `At ${perDay(s.tce)} Kestrel pays her running costs and her bank, but her owners earn less than the ${pct(EQUITY_RETURN)} they want.`
              : `At ${perDay(s.tce)} Kestrel can’t meet her bills from her earnings: her owners must put in cash to keep her trading.`}
        </Caption>
      </Figure>

      <P>
        Start with the purchase as it stands: Kestrel new, at an illustrative {$M(NEW_PRICE)}, with {pct(DEFAULTS.ltv)} of the price borrowed at{' '}
        {pct(DEFAULTS.rate)} and repaid over {DEFAULTS.tenor} years. In her first year the loan costs {perDay(d0.c.interest)} in interest and{' '}
        {perDay(d0.c.principal)} in repayments. Add her operating costs and spread the total over the {fmt(365 - DEFAULTS.offHire)} days she isn’t off hire, and
        she needs {perDay(d0.b.cash)} to pay her bills: that is her <K tone="green">cash break-even</K>. At the market’s {perDay(DEFAULTS.tce)} she clears it,
        with {money(d0.year.cashFlow)} left over in the year.
      </P>

      <H2>Cash and full cost</H2>
      <P>
        The right bar asks a harder question: is owning Kestrel worth it? It swaps the loan repayment for two other costs. Repaying a loan isn’t really a cost — each
        installment buys back a piece of the ship from the bank — but the ship does wear out. In our model she lasts {SHIP_LIFE} years and ends as{' '}
        {fmt(V.lightship)} tonnes of steel sold for scrap at an illustrative {usd(SCRAP_PER_LDT)} a tonne, {money(SCRAP)}. The rest of her price, spread over her
        life, is her <b>depreciation</b>: {perDay(d0.c.depreciation)}. And the {pct(1 - DEFAULTS.ltv)} of the price the owners paid themselves must earn them
        something, or they would have put the money elsewhere; at the {pct(EQUITY_RETURN)} a year our owners ask, that is {perDay(d0.c.equity)}. Together they
        make her <K tone="green">full-cost break-even</K> {perDay(d0.b.full)}. At {perDay(DEFAULTS.tce)} Kestrel pays her crew and her bank, and shows an
        accounting profit of {money(d0.year.profit)} a year, but her owners earn less than they wanted.
      </P>
      <P>
        Now drag the loan. Borrowing more means the owners put in less of their own money, and at {pct(DEFAULTS.rate)} interest the bank is cheaper than the{' '}
        {pct(EQUITY_RETURN)} they ask, so the full cost edges down, to {perDay(ltv80.b.full)} at an {pct(0.8)} loan. (Raise the interest rate to the owners’
        own {pct(EQUITY_RETURN)} and the loan’s size stops mattering to the full cost; above it, borrowing more raises it.) But the loan must be repaid, so the cash
        break-even climbs to {perDay(ltv80.b.cash)}. Bought outright, Kestrel’s cash break-even is just her operating costs spread over her{' '}
        {fmt(365 - DEFAULTS.offHire)} earning days, {perDay(ltv0.b.cash)} — she can survive almost any market — while her full cost rises to {perDay(ltv0.b.full)}. Leverage doesn’t change what the ship earns; it changes who takes the
        risk when earnings fall. The repayment period works on the cash bar alone: repaid over 10 years, the loan puts the cash break-even at{' '}
        {perDay(ten10.b.cash)}; over 20, at {perDay(ten20.b.cash)}.
      </P>
      <P>
        Off-hire days are the quiet multiplier. A ship earns nothing while she is in drydock or under repair, but her crew, her insurance and her loan go on
        costing money, so every cost is spread over fewer earning days. At the starting {DEFAULTS.offHire} days a year, that adds{' '}
        {perDay(offHireAdd(d0.c.opex + d0.c.interest + d0.c.depreciation + d0.c.equity))} to the full-cost break-even — the gray cap on each bar.
      </P>
      <P>
        The price works through three of the four costs in the equation. With the starting financing, each $1 million on Kestrel’s price adds{' '}
        {usd(PER_MILLION.interest)} a day of interest, {usd(PER_MILLION.depreciation)} of depreciation and {usd(PER_MILLION.equity)} of the owners’ return,
        all per calendar day; spread over her {fmt(365 - DEFAULTS.offHire)} earning days, that is {usd(PER_MILLION.full)} a day on her full-cost break-even.
      </P>

      <Challenge
        id="a"
        figure="Ship Economics Calculator"
        question={`Suppose the market is expected to pay ${perDay(CHALLENGE_TCE)} for the whole of Kestrel’s life. With the starting financing, what is the most Northwind should pay for her and still cover her full cost? Predict it first: at ${$M(NEW_PRICE)} her full cost is ${perDay(d0.b.full)}, and each $1 million off the price takes about ${usd(PER_MILLION.full)} a day off it. Then set the price to your estimate, to the nearest half million, and check.`}
        solved={solved}
        status={
          s.tce !== CHALLENGE_TCE
            ? `Set the market TCE back to ${perDay(CHALLENGE_TCE)}; it is ${perDay(s.tce)}.`
            : !startingFinancing(s)
              ? `Put the loan back to ${pct(DEFAULTS.ltv)} at ${pct(DEFAULTS.rate)} and the days off hire back to ${DEFAULTS.offHire} — Reset restores all three — so that the prediction applies.`
              : s.price === NEW_PRICE
                ? 'Make your prediction, then set the price to it.'
                : b.full > s.tce
                  ? `At ${$M(s.price)} her full cost is ${perDay(b.full)}, more than the market pays.`
                  : `At ${$M(s.price)} her full cost is ${perDay(b.full)}, ${usd(s.tce - b.full)} a day inside the market rate. Could Northwind pay more?`
        }
        success={`Solved: ${$M(s.price)}, where her full cost is ${perDay(b.full)}; half a million more would push it past ${usd(CHALLENGE_TCE)}. The slope gets there in one step: ${usd(d0.b.full - CHALLENGE_TCE)} a day to shed at ${usd(PER_MILLION.full)} per million is ${$M((d0.b.full - CHALLENGE_TCE) / PER_MILLION.full)} off the price. Price is the only cost a buyer still controls, so expected earnings set what a ship is worth: at ${perDay(CHALLENGE_TCE)}, a new Kestrel is worth well under the ${$M(NEW_PRICE)} a shipyard asks for her.`}
      />

      <P>
        With the starting financing, the answer is {answer === null ? 'below the slider’s range' : $M(answer)}, where her full cost is{' '}
        {perDay(answerFull)}. Treat it as a rule of thumb: the calculator charges her first year’s interest in every year of her life, though the interest
        falls as the loan is repaid. Turn the argument around and it explains how ships are priced. A buyer pays what the ship can earn, so when the market pays
        less than a new ship costs to build and run, secondhand ships trade below the price of a newbuilding — and when it pays more, buyers queue for ships that
        can start earning now. We’ll watch prices and earnings move together in the next lesson.
      </P>

      <H2>Old ships and new</H2>
      <P>
        Kestrel is new. Most of the fleet isn’t, and age changes the balance of costs. An older ship is cheaper to buy, so her capital costs are low. But she costs
        more to keep running: her steel needs more repair, her insurers charge more, she spends longer in drydock, and her older engine and fouled, worn hull
        burn more fuel for the same speed. In the next demonstration, three Kamsarmaxes are compared on the same financing, a {pct(0.6)} loan at {pct(0.07)}. The
        assumptions are the model’s, illustrative but in the right direction: prices of {AGED.map((a) => $M(a.price)).join(', ')}; wear-related
        operating costs rising {pct(OPEX_GROWTH_PER_YEAR, 1)} a year of age; fuel consumption {pct(FUEL_GROWTH_PER_YEAR)} more per year; and {OFFHIRE_NEW} days
        off hire when new, rising {fmt(OFFHIRE_PER_YEAR, 1)} a year. Because the market’s TCE is what a modern ship earns, an old ship’s extra fuel is a cost she
        must cover on top — shown in red, at {pct(AT_SEA_SHARE)} of her days at sea and {fmt(COMPARE_SPEED)} knots. Change the market and the price of fuel:
      </P>

      <Figure name="Ship Economics Calculator · age" scenario={ag}>
        <AgeBars ships={ships} tce={ag.state.tce} />
        <DataTable
          caption="Three Kamsarmaxes compared, per earning day"
          rows={ships}
          rowKey={(r) => r.age}
          columns={[
            { label: 'Ship', cell: (r) => AGED.find((a) => a.age === r.age)!.name },
            { label: 'Price', cell: (r) => $M(r.price), align: 'right' },
            { label: 'Operating costs', cell: (r) => perDay(r.opex), align: 'right' },
            { label: 'Off hire', cell: (r) => `${fmt(r.offHire)} days`, align: 'right' },
            { label: `Fuel at ${COMPARE_SPEED} kn`, cell: (r) => `${fmt(r.tpd, 1)} t/day`, align: 'right' },
            { label: 'Running break-even', cell: (r) => usd(r.runningBreakeven), align: 'right' },
          ]}
        />
        <Slider label="Market TCE" tone="green" value={ag.state.tce} min={5_000} max={25_000} step={250} onChange={(v) => ag.set({ tce: v })} display={perDay(ag.state.tce)} />
        <Slider label="Bunker price" tone="green" value={ag.state.bunker} min={400} max={900} step={10} onChange={(v) => ag.set({ bunker: v })} display={`${usd(ag.state.bunker)}/t`} />
      </Figure>

      <P>
        At an illustrative {usd(FUELS.vlsfo.price)} a tonne for fuel, the full-cost break-evens run {ships600.map((sh) => usd(sh.fullBreakeven)).join(', ')} from
        newest to oldest. (The new ship’s {usd(ships600[0].fullBreakeven)} is a little below the {usd(d0.b.full)} of{' '}
        <FigRef to="Ship Economics Calculator">the first demonstration</FigRef> only because a new ship here spends {OFFHIRE_NEW} days a year off hire rather
        than {DEFAULTS.offHire}.) The old ship has the lowest full cost, because she was cheap to buy and most of her price comes back when she is scrapped. The
        black ticks tell a different story. Once a ship is bought, her capital is spent whatever she does, and the question each day is only whether trading beats not trading.
        That takes her <b>running-cost break-even</b>: operating costs and extra fuel per earning day — {ships600.map((sh) => usd(sh.runningBreakeven)).join(', ')}.
        The oldest ship needs {pct(ships600[2].runningBreakeven / ships600[0].runningBreakeven - 1)} more than the new one just to pay her way.
      </P>
      <P>
        Drag the market down. Below {usd(ships600[2].runningBreakeven)} a day the 20-year-old ship loses cash on every day she trades, while the new one, which
        has a far higher full cost, still pays her running costs. Raise the price of fuel and the gap widens, because the older ship burns more of it. A
        loss-making old ship has one last asset: her {fmt(V.lightship)} tonnes of steel, worth {money(SCRAP)} to a breaking yard. So in a weak market the oldest,
        thirstiest ships are the first to stop paying their way and the first to be sold for scrap — and in a strong one, they keep trading long past the age at
        which they would otherwise go.
      </P>
      <P>
        A single owner can decide when to buy, sell or scrap one ship. The fleet as a whole changes more slowly: new ships are ordered years before they are
        delivered, and old ones leave only when the market pushes them out. In <a href={lessonHref('shipping/2.5')}>the next lesson</a> we’ll order ships, wait
        for them and scrap them, and see why the fleet so often arrives just as it is least needed. The running-cost break-evens of{' '}
        <FigRef to="Ship Economics Calculator · age">this comparison</FigRef> are why the oldest ships go first: in that lesson’s model, ships of 18 and older
        go for scrap in numbers once earnings have stayed, for months, below roughly what an old ship needs to cover her running costs.
      </P>
    </LessonPage>
  );
}
