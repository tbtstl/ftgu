import { useMemo } from 'react';
import {
  Challenge,
  FigRef,
  Figure,
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
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { CONTRACT_BUSHELS, EXPIRY, HARVEST_START, MARKET_YEARS, cashBid, decFutures, portSpot } from '../../../engines/agriculture/market';
import { fieldSeason } from '../../../engines/agriculture/farm';
import { BASE_PRICE } from '../../../engines/agriculture/world';
import { REFERENCE_YEAR } from '../../../model/agriculture/climate';
import { PLAN_PRICE } from '../../../model/agriculture/economics';
import { CEDAR_BEND, dayOf } from '../../../model/agriculture/region';
import { PriceChart, daysBetween } from '../shared/PriceChart';
import { centsPlain } from '../shared/format';
import { MARKET_LINE } from '../shared/tones';

/** What it costs to deliver on a contract: the load-out fee and paperwork, $ a bushel (simulated). */
export const DELIVERY_COST = 0.03;

/** Cash corn at Port Sable on December futures' last trading day in the reference season, quoted to the cent as the lesson shows it. */
export function expiryCash(): number {
  return Math.round(portSpot(REFERENCE_YEAR, EXPIRY.Dec) * 100) / 100;
}

/** What a short (`side` 1) or a long (`side` −1) gains per bushel by delivering at a last-day futures price in whole cents; exact to the cent. */
export function deliveryGain(cents: number, side: 1 | -1): number {
  return (side * (cents - Math.round(expiryCash() * 100)) - Math.round(DELIVERY_COST * 100)) / 100;
}

/** Challenge 1: the highest futures price, in whole cents, at which no short gains by delivering. */
export function deliverySolved(cents: number): boolean {
  return deliveryGain(cents, 1) <= 0 && deliveryGain(cents + 1, 1) > 0;
}

export type HedgeDate = 'mar' | 'jul' | 'sep';
export const HEDGE_DAY: Record<HedgeDate, number> = { mar: dayOf(3, 1), jul: dayOf(7, 1), sep: dayOf(9, 1) };
const HEDGE_LABEL: Record<HedgeDate, string> = { mar: 'March 1', jul: 'July 1', sep: 'September 1' };
/** Cedar Bend sells its corn, and buys its futures back, in mid-October. */
export const SELL_DAY = dayOf(10, 15);
/** 35 contracts: about what Cedar Bend's 1,000 acres of corn grow in an average season. */
export const CONTRACTS_SOLD = 35;
export const HEDGED = CONTRACTS_SOLD * CONTRACT_BUSHELS;

export interface HedgeYear {
  entry: number;
  exit: number;
  /** Fairview's cash bid when Cedar Bend sells. */
  cash: number;
  /** The futures gain (or loss) per bushel hedged. */
  gain: number;
  /** Cash plus the futures gain: the price on the hedged bushels. */
  hedged: number;
  /** Cedar Bend's corn that season, bushels. */
  crop: number;
  /** The most the margin account was down at any point: margin paid in, $. */
  maxMargin: number;
  path: Array<{ day: number; futures: number; margin: number }>;
}

const hedgeCache = new Map<string, HedgeYear>();
export function hedgeYear(year: number, date: HedgeDate): HedgeYear {
  const k = `${year}|${date}`;
  let h = hedgeCache.get(k);
  if (!h) {
    const start = HEDGE_DAY[date];
    const entry = decFutures(year, start);
    let worst = 0;
    const path: HedgeYear['path'] = [];
    for (let t = start; t <= SELL_DAY; t = t + 3 > SELL_DAY && t < SELL_DAY ? SELL_DAY : t + 3) {
      const f = decFutures(year, t);
      const margin = (entry - f) * HEDGED;
      worst = Math.min(worst, margin);
      path.push({ day: t, futures: f, margin });
    }
    const exit = decFutures(year, SELL_DAY);
    const cash = cashBid(year, 'fairview', SELL_DAY);
    const crop = fieldSeason(year, { district: CEDAR_BEND.district, crop: 'corn' }).yield * CEDAR_BEND.cornAcres;
    h = { entry, exit, cash, gain: entry - exit, hedged: cash + entry - exit, crop, maxMargin: -worst, path };
    hedgeCache.set(k, h);
  }
  return h;
}

/** Dollars to the nearest thousand, for prose. */
const roundK = (x: number) => Math.round(x / 1000) * 1000;

/** Challenge 2: the year whose March hedge needed the most margin money. */
let worstCache = 0;
export function worstMarginYear(): number {
  if (worstCache) return worstCache;
  let best = 1;
  for (let y = 2; y <= MARKET_YEARS; y++) if (hedgeYear(y, 'mar').maxMargin > hedgeYear(best, 'mar').maxMargin) best = y;
  worstCache = best;
  return best;
}

/** Challenge 2: the reader has chosen a March 1 hedge in the year that needed the most margin money. */
export function marginSolved(st: { year: number; date: HedgeDate }): boolean {
  return st.date === 'mar' && st.year === worstMarginYear();
}

/** The spread (standard deviation) and average of the hedged and unhedged prices over the sixty years. */
export function hedgeRecord(date: HedgeDate): { hedgedMean: number; hedgedSd: number; cashMean: number; cashSd: number } {
  const hs = Array.from({ length: MARKET_YEARS }, (_, i) => hedgeYear(i + 1, date));
  const stat = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return [m, Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)];
  };
  const [hedgedMean, hedgedSd] = stat(hs.map((h) => h.hedged));
  const [cashMean, cashSd] = stat(hs.map((h) => h.cash));
  return { hedgedMean, hedgedSd, cashMean, cashSd };
}

function DeliveryChart({ futures }: { futures: number }) {
  const data = useMemo(() => {
    const days = daysBetween(HARVEST_START, EXPIRY.Dec, 2);
    return { days, f: days.map((d) => decFutures(REFERENCE_YEAR, d)), s: days.map((d) => portSpot(REFERENCE_YEAR, d)) };
  }, []);
  const s = expiryCash();
  return (
    <PriceChart
      from={HARVEST_START}
      to={EXPIRY.Dec + 4}
      domain={[4.5, 5.6]}
      series={[
        { days: data.days, values: data.f, color: MARKET_LINE.futures },
        { days: data.days, values: data.s, color: MARKET_LINE.cash },
      ]}
      band={{ from: EXPIRY.Dec - 3, to: EXPIRY.Dec + 3, lo: s - DELIVERY_COST, hi: s + DELIVERY_COST, color: mix('#fcfcfb', MARKET_LINE.basis, 0.35) }}
      marks={[{ day: EXPIRY.Dec, value: futures, color: MARKET_LINE.futures, label: 'your futures price', left: true }]}
      ariaLabel={`December futures and cash corn at Port Sable from October 1 to December 14 of the reference season, converging to ${usd(s, 2)}; the futures price you set for the last day is ${usd(futures, 2)}.`}
    />
  );
}

function HedgeChart({ h, date }: { h: HedgeYear; date: HedgeDate }) {
  const lo = Math.min(...h.path.map((p) => p.futures), h.cash) - 0.2;
  const hi = Math.max(...h.path.map((p) => p.futures), h.cash) + 0.2;
  return (
    <PriceChart
      from={dayOf(3, 1)}
      to={SELL_DAY + 6}
      height={220}
      domain={[Math.floor(lo * 2) / 2, Math.ceil(hi * 2) / 2]}
      series={[{ days: h.path.map((p) => p.day), values: h.path.map((p) => p.futures), color: MARKET_LINE.futures }]}
      marks={[
        { day: HEDGE_DAY[date], value: h.entry, color: MARKET_LINE.futures, label: `sold at ${usd(h.entry, 2)}` },
        { day: SELL_DAY, value: h.cash, color: MARKET_LINE.cash, label: `cash ${usd(h.cash, 2)}`, left: true },
      ]}
      ariaLabel={`December futures from ${HEDGE_LABEL[date]} to October 15: Cedar Bend sold at ${usd(h.entry, 2)} and bought back at ${usd(h.exit, 2)}.`}
    />
  );
}

/** Cedar Bend's margin account under the price chart: money paid in rises over the line, money received falls under it. */
function MarginStrip({ h }: { h: HedgeYear }) {
  const x = scale(dayOf(3, 1), SELL_DAY + 6, 60, 620);
  const worst = Math.max(1e5, ...h.path.map((p) => Math.abs(p.margin)));
  const y = scale(-worst, worst, 18, 102);
  const area = (f: (m: number) => number) =>
    `M${x(h.path[0].day)},${y(0)} L${h.path.map((p) => `${x(p.day)},${y(f(p.margin))}`).join(' L')} L${x(h.path[h.path.length - 1].day)},${y(0)} Z`;
  return (
    <svg className="chart" viewBox="0 0 640 112" role="img" aria-label={`Cedar Bend’s margin account: as much as ${usd(h.maxMargin)} paid in.`}>
      <text className="ax" x={60} y={12}>
        Margin account: paid in (up) or received (down)
      </text>
      <path d={area((m) => Math.min(0, m))} fill={mix('#fcfcfb', MARKET_LINE.margin, 0.5)} />
      <path d={area((m) => Math.max(0, m))} fill={mix('#fcfcfb', MARKET_LINE.world, 0.45)} />
      <line x1={60} x2={620} y1={y(0)} y2={y(0)} stroke="#999" />
      <text className="ax ax-e" x={618} y={y(-worst) + 10}>
        paid {usd(worst / 1e3)}k
      </text>
      <text className="ax ax-e" x={618} y={y(worst) - 2}>
        received {usd(worst / 1e3)}k
      </text>
    </svg>
  );
}

/** Fixed price range for the sixty-year strip, so the hedge dates can be compared by eye. */
export const SIXTY_DOMAIN: [number, number] = [2, 9];

/** Every year at once: the harvest cash price at Fairview (gold) and the price on hedged corn (violet), joined by the futures gain or loss. */
function SixtyYears({ date, year }: { date: HedgeDate; year: number }) {
  const hs = useMemo(() => Array.from({ length: MARKET_YEARS }, (_, i) => hedgeYear(i + 1, date)), [date]);
  const x = scale(0.5, MARKET_YEARS + 0.5, 60, 620);
  const y = scale(SIXTY_DOMAIN[0], SIXTY_DOMAIN[1], 160, 24);
  const sel = hs[year - 1];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 182"
      role="img"
      aria-label={`All sixty years, hedged on ${HEDGE_LABEL[date]}: the harvest cash price ran from ${usd(Math.min(...hs.map((h) => h.cash)), 2)} to ${usd(Math.max(...hs.map((h) => h.cash)), 2)}, the price on hedged corn from ${usd(Math.min(...hs.map((h) => h.hedged)), 2)} to ${usd(Math.max(...hs.map((h) => h.hedged)), 2)}. Year ${year}: cash ${usd(sel.cash, 2)}, hedged ${usd(sel.hedged, 2)}.`}
    >
      <text className="ax" x={60} y={14}>
        Every year, $ a bushel: cash at harvest and the price on hedged corn
      </text>
      <GridY y={y} ticks={[2, 4, 6, 8]} x0={60} x1={620} format={(v) => usd(v)} />
      {hs.map((h, i) => {
        const on = i + 1 === year;
        return (
          <g key={i}>
            <line x1={x(i + 1)} x2={x(i + 1)} y1={y(h.cash)} y2={y(h.hedged)} stroke={on ? '#333' : '#c8c8c8'} strokeWidth={on ? 1.5 : 1} />
            <circle cx={x(i + 1)} cy={y(h.cash)} r={on ? 4.5 : 2.4} fill={MARKET_LINE.cash} stroke={on ? '#333' : 'none'} />
            <circle cx={x(i + 1)} cy={y(h.hedged)} r={on ? 4.5 : 2.6} fill={MARKET_LINE.futures} stroke={on ? '#333' : 'none'} />
          </g>
        );
      })}
      {[1, 10, 20, 30, 40, 50, 60].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={178}>
          {t === 1 ? 'year 1' : t}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const d = useScenario('delivery', { cents: 530 });
  const s = expiryCash();
  const f = d.state.cents / 100;
  const shortGain = deliveryGain(d.state.cents, 1);
  const longGain = deliveryGain(d.state.cents, -1);
  const solved1 = deliverySolved(d.state.cents);

  const hs = useScenario('hedge', { year: REFERENCE_YEAR, date: 'mar' as HedgeDate });
  const h = hedgeYear(hs.state.year, hs.state.date);
  const solved2 = useMemo(() => marginSolved(hs.state), [hs.state]);
  const rec = useMemo(() => ({ mar: hedgeRecord('mar'), jul: hedgeRecord('jul'), sep: hedgeRecord('sep') }), []);
  const now = rec[hs.state.date];

  return (
    <LessonPage id="agriculture/5.1">
      <P>
        Every price in the last chapter came from somewhere. Fairview bid “35 under the terminal”; Port Sable paid what the world paid. In a real grain market almost
        every such price is quoted against one benchmark — a futures price — and this chapter is about those prices: how they are made, how they move, and how to
        trade them. It starts with the contract itself.
      </P>
      <P>
        A <K tone="violet">futures contract</K> is a promise to deliver a fixed amount of a fixed grade of grain at a fixed place in a fixed month, at a price agreed
        today. Because every contract is the same, they can be traded on an exchange like shares. The corn contract of CME Group, the world’s main corn futures
        market, calls for 5,000 bushels of No. 2 yellow corn, delivered by shipping certificate at approved facilities along the Illinois River, in March, May,
        July, September or December. Our valley’s contract is the same size and grade, though it trades only four months — December, March, May and July. It
        is delivered onto ships at Port Sable, as Europe’s main wheat contract is delivered at the French port of Rouen, so its price is the world’s price for
        corn. The buyer is <i>long</i>, the seller{' '}
        <i>short</i>, and they never deal with each other directly: a clearinghouse becomes the buyer to every seller and the seller to every buyer. Each side posts
        a deposit, called <K tone="red">margin</K>, and every evening each position is marked to market — whoever lost money that day pays it in cash, and whoever
        gained receives it.
      </P>
      <P>
        Only a small share of contracts ever end in delivery; most are closed out by an offsetting trade. But the possibility of delivery is what gives the futures
        price its meaning, because it ties the price of a contract to the price of real corn. In the next demonstration the lines are December futures and the
        cash price of corn in store at Port Sable through the autumn of the reference season, Cedar Bend’s season since Chapter 1. Its prices, like every price
        in this course, are simulated. On the last trading day, December 14, cash corn at Port Sable is {usd(s, 2)}. Choose a futures price for that day and
        see who would deliver:
      </P>

      <Figure name="Commodity Market Clearing" scenario={d}>
        <DeliveryChart futures={f} />
        <Legend
          items={[
            { label: 'December futures', color: MARKET_LINE.futures, kind: 'line' },
            { label: 'Cash corn at Port Sable', color: MARKET_LINE.cash, kind: 'line' },
            { label: 'Cash ± the cost of delivery', color: mix('#fcfcfb', MARKET_LINE.basis, 0.35) },
          ]}
        />
        <Readouts
          items={[
            { label: 'cash corn, Dec 14', value: usd(s, 2), tone: 'gold' },
            { label: 'who gains by delivery', value: shortGain > 0 ? 'shorts deliver' : longGain > 0 ? 'longs take delivery' : 'nobody' },
            { label: 'gain per contract', value: usd(Math.max(0, shortGain, longGain) * CONTRACT_BUSHELS), tone: 'green' },
          ]}
        />
        <Slider label="December futures on the last day" tone="violet" value={d.state.cents} min={455} max={560} onChange={(v) => d.set({ cents: v })} display={usd(f, 2)} />
      </Figure>

      <P>
        Delivery costs something — in our market about {centsPlain(DELIVERY_COST)} a bushel for the load-out fee and the paperwork — so the shaded band around the
        cash price is where nobody gains by delivering. Over it, every short would rather buy cash corn at Port Sable and deliver it at the futures price than
        buy the contract back; shorts sell futures and buy cash corn until the two meet. Under it, every long would rather take delivery than buy corn for cash. Either
        way, trading closes the gap: on the last day, futures and cash <K tone="violet">converge</K>. Before then, futures sit over cash by about the cost of carrying
        corn to December — 11 cents in mid-October of the reference season, 6 cents on November 10 and a cent on December 8. Traders call that difference, cash
        less futures, the <K tone="teal">basis</K>, and they quote cash prices by it: in mid-October, corn at Port Sable was “11 under December.”
      </P>

      <Challenge
        id="a"
        question="Predict it first from the cash price and the cost of delivery, then set it to check: what is the highest December futures price on the last trading day, to the cent, at which no short gains anything by delivering?"
        solved={solved1}
        status={shortGain > 0 ? `At ${usd(f, 2)} a short earns ${usd(shortGain * CONTRACT_BUSHELS)} a contract by delivering.` : `At ${usd(f, 2)} no short gains by delivering. Could the price be higher?`}
        success={`Solved: at ${usd(f, 2)}, a short who bought cash corn at ${usd(s, 2)} and paid ${centsPlain(DELIVERY_COST)} to deliver it would just break even; a cent higher and every short would deliver. The cost of delivery sets how far apart futures and cash can be when a contract expires — which is why a futures price can stand for the price of real corn.`}
      />

      <P>
        The valley grows winter wheat as well as corn, but our market lists only the corn contract. Real wheat has futures of its own — soft red winter wheat in
        Chicago, hard red winter wheat in Kansas City, milling wheat in Paris — each following its own harvests. To keep to one market, we price the valley’s
        wheat off corn: at the {usd(PLAN_PRICE.wheat, 2)} a bushel of <a href={lessonHref('agriculture/2.1')}>Lesson 2.1</a> when December corn futures stand at their
        normal {usd(BASE_PRICE, 2)}, and up or down in proportion to them on July 15, when the wheat is sold. That is a simplification, though not a wild one. The
        two grains compete for the same feed troughs — when corn is dear, livestock feeders buy more wheat — so their prices tend to rise and fall together,
        even if wheat’s own harvests can pull them apart for a season. Every price in this chapter is for corn.
      </P>

      <H2>Hedging, and paying for it as you go</H2>
      <P>
        Cedar Bend expects about 175,000 bushels of corn from its 1,000 acres in an average season. On March 1, before a seed is planted, it can sell{' '}
        {CONTRACTS_SOLD} December contracts. Whatever the price does, at harvest it sells its corn for cash at Fairview and buys the contracts back. If prices fell,
        the futures gain makes up for the lower cash price; if they rose, the futures loss takes away the higher one. What is left is the futures price on the day of
        the <K tone="violet">hedge</K> plus Fairview’s basis at harvest. The catch is the margin. A futures loss is paid as it happens, in cash, months before the
        corn is sold. In the next demonstration the line is December futures through one simulated season, and the strip under it is Cedar Bend’s margin account:
        red over its line for money paid in, green under it for money received. The dots at the bottom are all sixty years at once — the harvest cash price at
        Fairview and the price Cedar Bend got on its hedged corn — joined by each year’s futures gain or loss. Choose the year and when Cedar Bend hedged:
      </P>

      <Figure name="Commodity Market Clearing · a hedge" scenario={hs}>
        <HedgeChart h={h} date={hs.state.date} />
        <MarginStrip h={h} />
        <SixtyYears date={hs.state.date} year={hs.state.year} />
        <Legend
          items={[
            { label: 'Cash at Fairview, mid-October', color: MARKET_LINE.cash },
            { label: 'Price on hedged corn', color: MARKET_LINE.futures },
          ]}
        />
        <Readouts
          items={[
            { label: `year ${hs.state.year}: price on hedged corn`, value: usd(h.hedged, 2), tone: 'violet' },
            { label: `year ${hs.state.year}: most margin paid in`, value: usd(h.maxMargin), tone: 'red' },
            { label: 'hedged, 60 years: average ± SD', value: `${usd(now.hedgedMean, 2)} ± ${usd(now.hedgedSd, 2)}`, tone: 'violet' },
            { label: 'cash, 60 years: average ± SD', value: `${usd(now.cashMean, 2)} ± ${usd(now.cashSd, 2)}`, tone: 'gold' },
          ]}
        />
        <Segmented
          label="Hedged on"
          value={hs.state.date}
          onChange={(v) => hs.set({ date: v })}
          options={(['mar', 'jul', 'sep'] as HedgeDate[]).map((k) => ({ value: k, label: HEDGE_LABEL[k] }))}
        />
        <Slider label="Year" value={hs.state.year} min={1} max={MARKET_YEARS} onChange={(v) => hs.set({ year: v })} display={String(hs.state.year)} />
      </Figure>

      <P>
        With a March hedge the violet dots hardly move from year to year, while the gold ones swing. Over the sixty simulated years the hedged price varies by{' '}
        {fmt(rec.mar.hedgedSd * 100)} cents (one standard deviation, the measure of spread of <a href={lessonHref('agriculture/3.5')}>Lesson 3.5</a>) and the
        harvest cash price by {usd(rec.mar.cashSd, 2)}. The hedge doesn’t raise the average price: futures in March are the market’s best estimate of December’s
        price, too high as often as too low. In these sixty years the hedged price averaged {usd(rec.mar.hedgedMean, 2)} and the cash price{' '}
        {usd(rec.mar.cashMean, 2)}, a difference well within what chance produces over sixty seasons. What the hedge does is trade <i>price</i> risk, which is large, for{' '}
        <i>basis</i> risk — how far under futures Fairview bids at harvest — which is smaller, though not small: in the years when the valley’s own harvest fills
        its railroad and river, as in <a href={lessonHref('agriculture/4.4')}>Lesson 4.4</a>, Fairview’s bid falls far under the port’s price, hedge or no hedge. A later hedge locks in less, because the summer’s news is already
        in the price: hedged on July 1 the price varies by {fmt(rec.jul.hedgedSd * 100)} cents, and hedged on September 1 by {fmt(rec.sep.hedgedSd * 100)}, nearly
        as much as not hedging at all — the violet dots spread out to meet the gold. <a href={lessonHref('agriculture/5.4')}>Lesson 5.4</a> follows that news as it
        arrives.
      </P>
      <P>
        Now look at the red area in a dry year. When the price rises the hedge loses, and the loss has to be paid in cash as it happens, while the corn that will
        make it up is still in the field. In the spring of 2008, when grain prices soared, some country elevators — short futures against grain they had agreed
        to buy from farmers later — ran so short of cash for margin calls that they stopped offering farmers forward contracts at all. Most farmers hedge through
        just such a forward contract with their elevator, which then carries the futures position and its margin.
      </P>

      <Challenge
        id="b"
        question={
          <>
            Predict first, from the sixty years of <a href={lessonHref('agriculture/4.5')}>Lesson 4.5</a>: in which year did a March 1 hedge need the most money
            paid into Cedar Bend’s margin account? Then choose that year to check.
          </>
        }
        solved={solved2}
        status={
          hs.state.date !== 'mar'
            ? 'Choose the March 1 hedge.'
            : h.maxMargin < 1
              ? `In year ${hs.state.year} December futures never rose over the March price, so the margin account only received money. Which year’s price climbed furthest after March, and why?`
              : `Year ${hs.state.year} needed as much as ${usd(h.maxMargin)} of margin. Which year’s price climbed furthest after March, and why?`
        }
        success={`Solved: in year ${hs.state.year} December futures climbed from ${usd(h.entry, 2)} to ${usd(h.exit, 2)} by mid-October, and Cedar Bend paid in as much as ${usd(h.maxMargin)} before its corn was sold. On each bushel it had, the hedge did its job: those bushels fetched ${usd(h.hedged, 2)}. But the farm grew only ${fmt(h.crop / 1000)},000 bushels that year against ${fmt(HEDGED / 1000)},000 hedged — the drought that raised the price took the crop too. Its corn sold for ${usd(roundK(h.crop * h.cash))}, the futures lost ${usd(roundK(-h.gain * HEDGED))}, and the farm was left with ${usd(roundK(h.crop * h.cash + h.gain * HEDGED))}. How much of a crop to hedge is a question for Lesson 5.5.`}
      />

      <P>
        A hedge is made of two prices: the futures price, tied to real corn by delivery as in <FigRef to="Commodity Market Clearing">the delivery demonstration</FigRef>, and the basis. The futures price itself is not one number but a curve, one price for each delivery month,
        and its shape — whether later months pay more than earlier ones — decides whether storing corn pays. That is the next lesson. The basis gets{' '}
        <a href={lessonHref('agriculture/5.3')}>Lesson 5.3</a>.
      </P>
    </LessonPage>
  );
}
