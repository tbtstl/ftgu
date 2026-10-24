import { useMemo } from 'react';
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
  fmt,
  lessonHref,
  mix,
  niceDomain,
  niceTicks,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import {
  EXPIRY,
  FARM_STORAGE_PER_MONTH,
  INTEREST,
  MARKET_YEARS,
  MONTH_DAYS,
  cashBid,
  cropYear,
  futures,
  harvestCurve,
  storageReturn,
  type Contract,
  type HarvestCurve,
} from '../../../engines/agriculture/market';
import { meanValley } from '../../../engines/agriculture/world';
import { dayOf } from '../../../model/agriculture/region';
import { PriceChart } from '../shared/PriceChart';
import { centsPlain } from '../shared/format';
import { MARKET_LINE } from '../shared/tones';

export interface CurveState {
  /** Everyone else's harvest, whole percent from normal. */
  world: number;
  /** The valley's harvest, million bushels. */
  valley: number;
  carryIn: number;
}

export const CURVE0: CurveState = { world: 0, valley: 506, carryIn: 100 };

export function curveOf(st: CurveState): HarvestCurve {
  return harvestCurve({ valley: st.valley === CURVE0.valley ? meanValley() : st.valley, world: st.world / 100, carryIn: st.carryIn });
}

/** Challenge 1: the smallest shortfall elsewhere (whole percent) at which hedged storage at Cedar Bend until July stops paying. */
export function stopsPayingSolved(st: CurveState): boolean {
  if (st.valley !== CURVE0.valley || st.carryIn !== CURVE0.carryIn) return false;
  const pays = (w: number) => storageReturn(curveOf({ ...st, world: w })) >= 0;
  return !pays(st.world) && pays(st.world + 1);
}

export const HARVEST_SALE = dayOf(10, 15);
export type SaleMonth = 'Mar' | 'May' | 'Jul';

/** What storing a bushel at Cedar Bend from mid-October to a contract's expiry earned in a simulated year, hedged or not, $. */
export function storedReturn(year: number, sell: SaleMonth, hedged: boolean): number {
  const months = (EXPIRY[sell] - HARVEST_SALE) / MONTH_DAYS;
  const c0 = cashBid(year, 'fairview', HARVEST_SALE);
  const c1 = cashBid(year, 'fairview', EXPIRY[sell]);
  const cost = months * FARM_STORAGE_PER_MONTH + (INTEREST / 12) * months * c0;
  const hedge = hedged ? futures(year, sell, HARVEST_SALE) - futures(year, sell, EXPIRY[sell]) : 0;
  return c1 - c0 - cost + hedge;
}

/** Challenge 2: the year in which storing hedged until July lost the most. */
export function worstStorageYear(): number {
  let worst = 1;
  for (let y = 2; y <= MARKET_YEARS; y++) if (storedReturn(y, 'Jul', true) < storedReturn(worst, 'Jul', true)) worst = y;
  return worst;
}

const CONTRACT_LABEL: Record<Contract, string> = { Dec: 'Dec', Mar: 'Mar', May: 'May', Jul: 'Jul' };

function CurveChart({ c }: { c: HarvestCurve }) {
  const ks: Contract[] = ['Dec', 'Mar', 'May', 'Jul'];
  const nextDec = EXPIRY.Dec + 365;
  const full = (k: Contract) => c.futures.Dec + c.carry * ((EXPIRY[k] - EXPIRY.Dec) / MONTH_DAYS);
  const lo = Math.min(c.harvestCash, c.newCrop, ...ks.map((k) => c.futures[k])) - 0.2;
  const hi = Math.max(c.julyCash, ...ks.map(full), c.newCrop) + 0.2;
  return (
    <PriceChart
      from={dayOf(10, 1)}
      to={nextDec + 10}
      domain={niceDomain(lo, hi, 4)}
      series={[
        { days: [EXPIRY.Dec, EXPIRY.Jul], values: [c.futures.Dec, full('Jul')], color: '#8a8a8a', dashed: true, width: 1.5 },
        { days: ks.map((k) => EXPIRY[k]), values: ks.map((k) => c.futures[k]), color: MARKET_LINE.futures, width: 2.5 },
        { days: [EXPIRY.Jul, nextDec], values: [c.futures.Jul, c.newCrop], color: MARKET_LINE.futures, dashed: true },
      ]}
      marks={[
        ...ks.map((k) => ({ day: EXPIRY[k], value: c.futures[k], color: MARKET_LINE.futures, label: CONTRACT_LABEL[k] })),
        { day: nextDec, value: c.newCrop, color: MARKET_LINE.futures, label: 'next Dec', left: true },
        { day: HARVEST_SALE, value: c.harvestCash, color: MARKET_LINE.cash, label: 'Fairview, harvest' },
        { day: EXPIRY.Jul, value: c.julyCash, color: MARKET_LINE.cash },
      ]}
      ariaLabel={`The futures curve after harvest: December ${usd(c.futures.Dec, 2)}, March ${usd(c.futures.Mar, 2)}, May ${usd(c.futures.May, 2)}, July ${usd(c.futures.Jul, 2)}, next December ${usd(c.newCrop, 2)}. Fairview bids ${usd(c.harvestCash, 2)} at harvest and ${usd(c.julyCash, 2)} in July.`}
    />
  );
}

function ReturnBars({ values, year }: { values: number[]; year: number }) {
  const [lo, hi] = niceDomain(Math.min(0, ...values), Math.max(0, ...values), 4);
  const x = scale(0.5, values.length + 0.5, 60, 620);
  const y = scale(lo, hi, 200, 24);
  const w = (x(1) - x(0)) * 0.72;
  return (
    <svg className="chart" viewBox="0 0 640 230" role="img" aria-label={`Storage returns in sixty simulated years, from ${usd(Math.min(...values), 2)} to ${usd(Math.max(...values), 2)} a bushel; year ${year}: ${usd(values[year - 1], 2)}.`}>
      <text className="ax" x={60} y={14}>
        Return from storing, $ a bushel
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={60} x1={620} format={(v) => usd(v, 2)} baseline={0} />
      {values.map((v, i) => (
        <rect
          key={i}
          x={x(i + 1) - w / 2}
          y={Math.min(y(v), y(0))}
          width={w}
          height={Math.abs(y(v) - y(0))}
          fill={i + 1 === year ? (v >= 0 ? GRAPHIC.green : GRAPHIC.red) : mix('#fcfcfb', v >= 0 ? GRAPHIC.green : GRAPHIC.red, 0.5)}
        />
      ))}
      {[1, 10, 20, 30, 40, 50, 60].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={222}>
          {t === 1 ? 'year 1' : t}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('curve', CURVE0);
  const c = useMemo(() => curveOf(s.state), [s.state]);
  const ret = storageReturn(c);
  const spread = c.futures.Jul - c.futures.Dec;
  const fullSpread = c.carry * ((EXPIRY.Jul - EXPIRY.Dec) / MONTH_DAYS);
  const solved1 = useMemo(() => stopsPayingSolved(s.state), [s.state]);

  const h = useScenario('storage', { sell: 'Jul' as SaleMonth, hedged: 'yes' as 'yes' | 'no', year: 46 });
  const values = useMemo(() => Array.from({ length: MARKET_YEARS }, (_, i) => storedReturn(i + 1, h.state.sell, h.state.hedged === 'yes')), [h.state.sell, h.state.hedged]);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const paid = values.filter((v) => v > 0).length;
  const worst = useMemo(() => worstStorageYear(), []);
  const solved2 = h.state.sell === 'Jul' && h.state.hedged === 'yes' && h.state.year === worst;
  const yr = cropYear(h.state.year);

  return (
    <LessonPage id="agriculture/5.2">
      <P>
        The futures market lists a contract for each delivery month, so on any day it quotes not one price for corn but several. On the day of the November crop
        report we can read the price of corn delivered at Port Sable in December, March, May and July — the crop just harvested, the <i>old crop</i> — and the
        next December, the <i>new crop</i> not yet planted. Together they make the <K tone="violet">futures curve</K>, and its shape is the market’s answer to one
        question: what is it worth to hold corn from one month to the next?
      </P>
      <P>
        Holding corn costs storage — 3.5 cents a bushel a month at a commercial elevator, as in <a href={lessonHref('agriculture/4.2')}>Lesson 4.2</a> — and
        interest on the money tied up, {Math.round(INTEREST * 100)}% a year. Together they are the <K tone="gray">full carry</K>. July futures can’t sit more than
        full carry over December for long: if they did, anyone could buy December, take delivery, store the corn and deliver it in July for a profit with no risk.
        Under that ceiling any shape is possible. When later months are worth more, the market is in <K tone="violet">carry</K>; when they are worth less, it is{' '}
        <K tone="red">inverted</K> — what other markets call backwardation. In the next demonstration the violet line is the curve after harvest, the gray dashed
        line full carry from December, and the dashed violet line the step to next year’s crop. The gold dots are Fairview’s bid at harvest and in July. Change the
        year’s physical facts — everyone else’s harvest, the valley’s, and the stocks the world carried in:
      </P>

      <Figure name="Crop-Year Price Model" scenario={s}>
        <CurveChart c={c} />
        <Legend
          items={[
            { label: 'Futures curve', color: MARKET_LINE.futures, kind: 'line' },
            { label: 'Full carry from December', color: '#8a8a8a', kind: 'line', dashed: true },
            { label: 'Fairview’s bid', color: MARKET_LINE.cash },
          ]}
        />
        <Readouts
          items={[
            { label: 'December to July', value: `${spread >= 0 ? '+' : '−'}${centsPlain(Math.abs(spread))}`, tone: 'violet' },
            { label: 'share of full carry', value: `${fmt((spread / fullSpread) * 100)}%` },
            { label: 'world stocks-to-use', value: `${fmt(c.stocksToUse * 100, 1)}%`, tone: 'gold' },
            { label: 'storing hedged pays', value: `${ret >= 0 ? '' : '−'}${centsPlain(Math.abs(ret))} a bushel`, tone: ret >= 0 ? 'green' : 'red' },
          ]}
        />
        <Slider label="Everyone else’s harvest" tone="gold" value={s.state.world} min={-10} max={10} onChange={(v) => s.set({ world: v })} display={`${s.state.world > 0 ? '+' : s.state.world < 0 ? '−' : ''}${Math.abs(s.state.world)}%`} />
        <Slider label="Valley harvest" tone="gold" value={s.state.valley} min={300} max={700} step={2} onChange={(v) => s.set({ valley: v })} display={`${fmt(s.state.valley)} million bu`} />
        <Slider label="World stocks carried in" value={s.state.carryIn} min={60} max={160} step={5} onChange={(v) => s.set({ carryIn: v })} display={`${s.state.carryIn} million t`} />
      </Figure>

      <P>
        In a normal year, December is $5.60 and July $5.95: the market pays 35 cents to hold corn for seven months, three-quarters of the full carry of 47 cents.
        Why not all of it? Because some holders want corn on hand regardless — an ethanol plant that can’t run without it, an elevator with trains to fill — and
        will keep stocks even when the spread doesn’t cover the cost. The economist Holbrook Working showed in the 1940s that the spread between two delivery months
        follows the stocks in store, and that its shape is a <i>supply of storage</i>: plentiful stocks earn full carry; scarce stocks are worth more now than later.
        Shrink everyone else’s harvest by 8% and stocks-to-use falls from 10.9% to 8.3%: the spread vanishes. At 10% the curve inverts, with July at $9.57 under
        December at $9.75, and next December at $6.53. The market expects the next harvest to refill the bins, and nobody is paid to carry this year’s scarce corn
        into it. The real corn curve did exactly that after the American drought of 2012: corn for the next July traded under corn for December, and the next
        year’s crop far under both.
      </P>

      <H2>Harvest pressure, and who is paid to store</H2>
      <P>
        The spread is not the only reward for storing. At harvest, Fairview bids 35 cents under its value to ration its bin space, as in{' '}
        <a href={lessonHref('agriculture/4.3')}>Lesson 4.3</a>; by midwinter the rush is over and it bids only its 8-cent handling cost under. A farmer who keeps corn
        in a bin collects both the carry and that <K tone="teal">harvest pressure</K> unwinding. And by selling July futures at harvest — a{' '}
        <i>storage hedge</i> — the farmer can lock both in. In a normal year Fairview bids $4.30 in mid-October and should bid $5.02 in mid-July; Cedar Bend’s own
        bins cost about 2 cents a bushel a month plus interest, so storing hedged earns 32 cents a bushel.
      </P>

      <Challenge
        id="a"
        question="Keep the valley’s harvest average and 100 million tons carried in. How short must everyone else’s harvest be, to the whole percent, before storing hedged at Cedar Bend until July stops paying?"
        solved={solved1}
        status={
          s.state.valley !== CURVE0.valley || s.state.carryIn !== CURVE0.carryIn
            ? 'Set the valley’s harvest back to 506 million bushels and the stocks to 100 million tons.'
            : ret >= 0
              ? `With everyone else’s harvest at ${s.state.world}%, storing still earns ${centsPlain(ret)} a bushel.`
              : `At ${s.state.world}% storing loses ${centsPlain(-ret)} a bushel. Is this the first whole percent where it does?`
        }
        success={`Solved: with everyone else’s harvest ${Math.abs(s.state.world)}% short, July pays only ${centsPlain(spread)} over December and storing loses ${centsPlain(-ret)} a bushel; a point less short and it still pays. Scarcity shows up as a thin spread: the market stops paying to keep corn when the world needs it now. Farmers who store anyway are betting on the price, not earning a carry.`}
      />

      <P>
        The valley’s own harvest pushes the other way. Make it 650 million bushels and the network of{' '}
        <a href={lessonHref('agriculture/4.4')}>Lesson 4.4</a> fills. December futures fall only to $4.68, because the valley is a small part of the world, but
        corn that can’t all leave the valley this year is worth far less than the port’s price: Fairview widens its harvest spread to 42 cents to keep its bins
        from overflowing and bids $2.60. With stocks plentiful the curve pays nearly full carry, and storing hedged earns 52 cents a bushel. The market is paying
        the valley’s farmers to keep their corn on the farm until there is room to move it.
      </P>
      <P>
        How did storing actually pay in the sixty simulated years? In the next demonstration each bar is one year’s return from storing a bushel at Cedar Bend
        from mid-October to a later contract’s expiry, after the farm’s storage and interest costs. Choose when to sell and whether to hedge:
      </P>

      <Figure name="Crop-Year Price Model · sixty years" scenario={h}>
        <ReturnBars values={values} year={h.state.year} />
        <Readouts
          items={[
            { label: 'average return', value: `${avg >= 0 ? '' : '−'}${centsPlain(Math.abs(avg))}`, tone: avg >= 0 ? 'green' : 'red' },
            { label: 'years it paid', value: `${paid} of ${MARKET_YEARS}` },
            { label: `year ${h.state.year}`, value: `${values[h.state.year - 1] >= 0 ? '' : '−'}${centsPlain(Math.abs(values[h.state.year - 1]))}`, tone: values[h.state.year - 1] >= 0 ? 'green' : 'red' },
            { label: `year ${h.state.year}: carry paid`, value: `${fmt(yr.theta * 100)}% of full`, tone: 'violet' },
          ]}
        />
        <Segmented
          label="Sell in"
          value={h.state.sell}
          onChange={(v) => h.set({ sell: v })}
          options={[
            { value: 'Mar', label: 'March' },
            { value: 'May', label: 'May' },
            { value: 'Jul', label: 'July' },
          ]}
        />
        <Segmented
          label="Hedge"
          value={h.state.hedged}
          onChange={(v) => h.set({ hedged: v })}
          options={[
            { value: 'yes', label: 'Hedged' },
            { value: 'no', label: 'Unhedged' },
          ]}
        />
        <Slider label="Year" value={h.state.year} min={1} max={MARKET_YEARS} onChange={(v) => h.set({ year: v })} display={String(h.state.year)} />
      </Figure>

      <P>
        Stored hedged until July, a bushel earned 29 cents on average and paid in 58 of the sixty years. Stored unhedged it earned more on average, 34 cents,
        because prices in these sixty simulated years happened to rise after harvest more often than not, but it lost money in 17 years, as much as $1.11 a bushel.
        Unhedged storage is two businesses at once: storing corn, and betting on its price. The hedge strips out the bet and leaves the business, which earns
        what the curve and the harvest basis pay. That is why commercial grain firms almost always store hedged, and why a merchant reads the curve, not the price,
        to decide whether to fill a bin.
      </P>

      <Challenge
        id="b"
        question="Store hedged until July. In which simulated year did storing lose the most?"
        solved={solved2}
        status={
          h.state.sell !== 'Jul' || h.state.hedged !== 'yes'
            ? 'Choose July and hedged.'
            : `In year ${h.state.year} storing hedged earned ${values[h.state.year - 1] >= 0 ? '' : '−'}${centsPlain(Math.abs(values[h.state.year - 1]))} a bushel.`
        }
        success={`Solved: in year ${h.state.year} the market was inverted — stocks-to-use fell to ${fmt(yr.world.stocksToUse * 100, 1)}%, and July futures traded under December — so storing hedged lost ${centsPlain(Math.abs(values[h.state.year - 1]))} a bushel. In an inverse the market is paying holders to sell now. The physical reason is the drought of that summer, the valley’s worst of the sixty.`}
      />

      <P>
        The curve prices corn across time at one place, Port Sable. Corn at Fairview, Halsted or Dunmore is worth something different again, by the cost and
        the capacity of getting it to a port — and by the elevator’s harvest rush in <FigRef to="Crop-Year Price Model">the curve</FigRef>’s gold
        dots. That difference, the basis, is the subject of the next lesson.
      </P>
    </LessonPage>
  );
}
