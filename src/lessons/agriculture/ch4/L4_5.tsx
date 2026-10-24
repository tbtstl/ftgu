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
  Slider,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  mix,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { BASE_PRICE, BU_PER_TONNE, PIPELINE, REGIONS, clearWorld, priceAtStocksToUse, worldHistory, type Balance, type HistoryYear } from '../../../engines/agriculture/world';
import { CROP_LINE } from '../shared/tones';

export interface WorldState {
  /** Harvest changes, whole percent. */
  us: number;
  southAmerica: number;
  blackSea: number;
  /** Stocks outside China carried in, million tons. */
  carryIn: number;
}

export const WORLD0: WorldState = { us: 0, southAmerica: 0, blackSea: 0, carryIn: 100 };

export function balanceOf(st: WorldState): Balance {
  return clearWorld({ crop: { us: st.us / 100, southAmerica: st.southAmerica / 100, blackSea: st.blackSea / 100 }, carryIn: st.carryIn });
}

const SHORT = -10;
const CAP = 6;

/** Challenge 1: with a 10% U.S. shortfall, the least carry-in (in steps of 5 million tons) that holds the price to $6.00 or less. */
export function bufferSolved(st: WorldState): boolean {
  if (st.us !== SHORT || st.southAmerica !== 0 || st.blackSea !== 0) return false;
  const ok = (c: number) => balanceOf({ ...st, carryIn: c }).price <= CAP;
  return ok(st.carryIn) && !ok(st.carryIn - 5);
}

/** Sixty simulated years of the world market. */
export const YEARS = 60;
let historyCache: HistoryYear[] | null = null;
export function history(): HistoryYear[] {
  if (!historyCache) historyCache = worldHistory(YEARS);
  return historyCache;
}

/** The valley's average corn harvest over the sixty years, million bushels. */
export function valleyAverage(): number {
  const h = history();
  return h.reduce((t, y) => t + y.valleyCorn, 0) / h.length;
}

/** Challenge 2: the year the valley grew more corn than its average and the world price was highest. */
export function dearBigYear(): number {
  const avg = valleyAverage();
  return history()
    .filter((y) => y.valleyCorn > avg)
    .reduce((best, y) => (y.price > best.price ? y : best)).year;
}

const SHORT_NAME: Record<string, string> = {
  us: 'United States',
  southAmerica: 'Brazil & Argentina',
  blackSea: 'Ukraine & Russia',
  china: 'China',
  importers: 'Importing countries',
};

function pct(x: number): string {
  const v = Math.round(x * 100);
  return v === 0 ? '0%' : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`;
}

function BalanceChart({ b }: { b: Balance }) {
  const w = scale(0, 500, 0, 190);
  const X = 128;
  const sx = scale(0.07, 0.15, 476, 628);
  const sy = scale(3, 11, 200, 26);
  const curve = Array.from({ length: 81 }, (_, i) => 0.07 + i * 0.001).map((su) => ({ su, p: priceAtStocksToUse(su) })).filter((c) => Number.isFinite(c.p) && c.p <= 11);
  const px = sx(Math.max(0.07, Math.min(0.15, b.stocksToUse)));
  const py = sy(Math.max(3, Math.min(11, b.price)));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 236"
      role="img"
      aria-label={`The world corn balance: ${b.regions.map((r) => `${SHORT_NAME[r.id]} grows ${fmt(r.production)} and uses ${fmt(r.use)} million tons`).join('; ')}. The price is ${usd(b.price, 2)} a bushel with stocks at ${fmt(b.stocksToUse * 100, 1)}% of a year’s use.`}
    >
      <text className="ax" x={X} y={14}>
        Million tons a year
      </text>
      {b.regions.map((r, i) => {
        const y = 28 + i * 40;
        const surplus = r.net >= 0;
        return (
          <g key={r.id}>
            <text className="lab" x={X - 8} y={y + 15} textAnchor="end" style={{ fontSize: 12.5 }}>
              {SHORT_NAME[r.id]}
            </text>
            <rect x={X} y={y + 2} width={w(r.production)} height={18} fill={mix('#fcfcfb', CROP_LINE.corn, 0.65)} />
            <line x1={X + w(r.use)} x2={X + w(r.use)} y1={y - 3} y2={y + 25} stroke="#333" strokeWidth={2.5} />
            <text className="ax" x={X + 196} y={y + 15} style={{ fill: surplus ? TEXT.green : TEXT.red, fontWeight: 600 }}>
              {surplus ? '+' : '−'}
              {fmt(Math.abs(r.net))}
            </text>
          </g>
        );
      })}
      <text className="ax" x={X + 196} y={226}>
        surplus or shortfall
      </text>
      <text className="ax" x={476} y={14}>
        Price, $ a bushel
      </text>
      <GridY y={sy} ticks={[4, 6, 8, 10]} x0={476} x1={628} format={(v) => `$${v}`} />
      <path d={linePath(curve.map((c) => sx(c.su)), curve.map((c) => sy(c.p)))} fill="none" stroke={GRAPHIC.green} strokeWidth={2} />
      <circle cx={px} cy={py} r={5.5} fill={GRAPHIC.green} stroke="#fcfcfb" strokeWidth={1.5} />
      {[0.08, 0.1, 0.12, 0.14].map((t) => (
        <text key={t} className="ax ax-m" x={sx(t)} y={216}>
          {Math.round(t * 100)}%
        </text>
      ))}
      <text className="ax ax-m" x={552} y={232}>
        stocks-to-use
      </text>
    </svg>
  );
}

function HistoryChart({ h, year, avg }: { h: HistoryYear[]; year: number; avg: number }) {
  const x = scale(0.5, h.length + 0.5, 60, 620);
  const y = scale(4, 10, 150, 22);
  const vy = scale(0, 700, 250, 170);
  const bw = (x(1) - x(0)) * 0.7;
  const sel = h[year - 1];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 276"
      role="img"
      aria-label={`Sixty simulated years. The world price ranges from ${usd(Math.min(...h.map((d) => d.price)), 2)} to ${usd(Math.max(...h.map((d) => d.price)), 2)} a bushel. In year ${year} the Crane Valley grew ${fmt(sel.valleyCorn)} million bushels and the price was ${usd(sel.price, 2)}.`}
    >
      <rect x={x(year) - (x(1) - x(0)) / 2} y={18} width={x(1) - x(0)} height={234} fill="rgba(0,0,0,.06)" />
      <text className="ax" x={60} y={12}>
        World price, $ a bushel
      </text>
      <GridY y={y} ticks={[4, 6, 8, 10]} x0={60} x1={620} format={(v) => `$${v}`} />
      <line x1={60} x2={620} y1={y(BASE_PRICE)} y2={y(BASE_PRICE)} stroke="#333" strokeDasharray="4 4" opacity={0.6} />
      <path d={linePath(h.map((d) => x(d.year)), h.map((d) => y(d.price)))} fill="none" stroke={GRAPHIC.green} strokeWidth={2} />
      {h.map((d) => (
        <circle key={d.year} cx={x(d.year)} cy={y(d.price)} r={d.year === year ? 5 : 2.2} fill={GRAPHIC.green} />
      ))}
      <text className="ax" x={60} y={166}>
        Crane Valley corn, million bushels
      </text>
      {h.map((d) => (
        <rect key={d.year} x={x(d.year) - bw / 2} y={vy(d.valleyCorn)} width={bw} height={vy(0) - vy(d.valleyCorn)} fill={d.year === year ? CROP_LINE.corn : mix('#fcfcfb', CROP_LINE.corn, 0.5)} />
      ))}
      <line x1={60} x2={620} y1={vy(avg)} y2={vy(avg)} stroke="#333" strokeDasharray="4 4" opacity={0.6} />
      <text className="ax ax-e" x={56} y={vy(avg) + 4}>
        avg
      </text>
      {[1, 10, 20, 30, 40, 50, 60].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={268}>
          {t === 1 ? 'year 1' : t}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('world', WORLD0);
  const b = useMemo(() => balanceOf(s.state), [s.state]);
  const solved1 = useMemo(() => bufferSolved(s.state), [s.state]);
  const drawn = b.carryIn - b.carryOut;

  const t = useScenario('history', { year: 1 });
  const h = history();
  const avg = valleyAverage();
  const sel = h[t.state.year - 1];
  const target = dearBigYear();
  const solved2 = t.state.year === target;

  return (
    <LessonPage id="agriculture/4.5">
      <P>
        In <a href={lessonHref('agriculture/4.4')}>the last lesson</a> the two ports’ prices were given: $5.95 a bushel at Westhaven and $5.60 at Port Sable. A
        bushel loaded at Port Sable competes with corn from every other exporting country, for a place in a feed mill in Japan, a poultry farm in Egypt or a
        starch plant in Mexico. The world trades grain in metric tons — a metric ton of corn is 39.4 bushels — and the Crane Valley’s 290 million bushels of exports are
        about 7 million tons, roughly 4% of the world’s corn trade in this lesson’s model. That is too little to move the world price, so the valley takes it as
        given. This lesson is about where it comes from.
      </P>
      <P>
        The world grows a little over 1.2 billion tons of corn a year. The United States grows nearly a third of it and China about a quarter; Brazil, Argentina
        and Ukraine are the other big exporters. Most corn is used — largely fed to animals — in the country that grows it, and only about a sixth crosses a border.
        Each month the U.S. Department of Agriculture publishes a <K tone="gold">balance sheet</K> for every major producer and buyer, and each obeys the same
        identity: stocks at the start of the year, plus production and imports, equal use, plus exports and stocks at the end. Our model has five regions, in round
        numbers simplified from recent years, which balance at $5.60 a bushel ($220 a ton) in a normal year. China’s government holds well over half the world’s
        corn stocks in reserves that rarely reach the world market, so the stocks that matter here are those outside China: about 100 million tons, 11% of a
        year’s use.
      </P>
      <P>
        When the harvest comes up short, two things give. Use falls: livestock feeders switch to wheat or sorghum, or feed fewer animals, and ethanol plants run
        slower — but not by much, between half a percent and 2% for each 10% rise in the price in our regions. And stocks fall, because a high price persuades
        their holders to sell what they would otherwise have carried into the next year. Stocks can’t fall to zero: some grain is always on ships, in rail cars and in
        the bins of mills — about {PIPELINE} million tons, the world’s pipeline. In the next demonstration, the bars are each region’s production and the black
        ticks its use, and the curve is the price at each level of <K tone="green">stocks-to-use</K>, the stocks carried out as a share of a year’s use. Change the
        harvests and the stocks carried in:
      </P>

      <Figure name="Global Grain Balance" scenario={s}>
        <BalanceChart b={b} />
        <Legend
          items={[
            { label: 'Production', color: mix('#fcfcfb', CROP_LINE.corn, 0.65) },
            { label: 'Use', color: '#333', kind: 'line' },
            { label: 'Price and stocks-to-use', color: GRAPHIC.green, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'world price, a bushel', value: usd(b.price, 2), tone: 'green' },
            { label: 'a ton', value: usd(b.price * BU_PER_TONNE) },
            { label: 'stocks carried out', value: `${fmt(b.carryOut)} million t`, tone: 'gold' },
            { label: drawn > 0.5 ? 'drawn from stocks' : drawn < -0.5 ? 'added to stocks' : 'change in stocks', value: `${fmt(Math.abs(drawn))} million t` },
          ]}
        />
        <Slider label="U.S. harvest" tone="gold" value={s.state.us} min={-30} max={15} onChange={(v) => s.set({ us: v })} display={`${s.state.us > 0 ? '+' : s.state.us < 0 ? '−' : ''}${Math.abs(s.state.us)}%`} />
        <Slider label="Brazil & Argentina harvest" tone="gold" value={s.state.southAmerica} min={-30} max={15} onChange={(v) => s.set({ southAmerica: v })} display={`${s.state.southAmerica > 0 ? '+' : s.state.southAmerica < 0 ? '−' : ''}${Math.abs(s.state.southAmerica)}%`} />
        <Slider label="Ukraine & Russia harvest" tone="gold" value={s.state.blackSea} min={-100} max={20} step={5} onChange={(v) => s.set({ blackSea: v })} display={`${s.state.blackSea > 0 ? '+' : s.state.blackSea < 0 ? '−' : ''}${Math.abs(s.state.blackSea)}%`} />
        <Slider label="Stocks carried in" value={s.state.carryIn} min={40} max={160} step={5} onChange={(v) => s.set({ carryIn: v })} display={`${s.state.carryIn} million t`} />
      </Figure>

      <P>
        Take 20% off the U.S. harvest — a drought on the scale of 2012’s, when the U.S. corn yield fell to 123 bushels an acre and corn futures set records above $8
        a bushel. In the model the price rises 39%, to $7.77. The United States no longer has corn to spare, Brazil and Argentina export a little more, and most of
        the gap is closed by use: the importing countries buy 31 million tons less, and 23 million tons come out of stocks. Now look at the curve. It is steep
        where stocks are scarce and flat where they are plentiful, because each ton drawn from stocks brings them closer to the pipeline, where nobody can sell
        more. That is why traders watch stocks-to-use more closely than any other number on a balance sheet: the same shortfall costs much more when the world starts
        the year with less.
      </P>

      <Challenge
        id="a"
        question="Make the U.S. harvest 10% short. With the usual 100 million tons carried in, the price rises to $6.55. How much must the world carry in, to the nearest 5 million tons, to hold the price to $6.00 or less?"
        solved={solved1}
        status={
          s.state.us !== SHORT || s.state.southAmerica !== 0 || s.state.blackSea !== 0
            ? 'Set the U.S. harvest to −10% and the other two to 0%.'
            : b.price > CAP
              ? `With ${s.state.carryIn} million tons carried in, the price is ${usd(b.price, 2)}.`
              : `With ${s.state.carryIn} million tons carried in, the price is ${usd(b.price, 2)}. Would less do?`
        }
        success={`Solved: ${s.state.carryIn} million tons carried in holds the price to ${usd(b.price, 2)} — ${fmt(s.state.carryIn - WORLD0.carryIn)} million tons more than usual, to absorb a shortfall of ${fmt(-REGIONS[0].production * SHORT / 100)} million. Stocks work as the world’s insurance against a bad harvest, and like insurance they cost money to hold; Chapter 5 will show the market paying for them.`}
      />

      <P>
        The same arithmetic works for any region. Wipe out Ukraine and Russia’s corn exports — about 31 million tons, which in the model takes a 65% smaller crop
        there — and the price rises to about $6.37. When Russia’s invasion of Ukraine in 2022 shut Ukraine’s seaports for months, until a deal brokered by the United
        Nations and Turkey reopened them that summer, corn and wheat prices rose by much more than that, because the war hit a market already tightened by a
        drought-damaged Brazilian crop in 2021 and record Chinese imports. Wheat has its own cast — Russia is now its largest exporter, ahead of the European Union,
        Canada, Australia and the United States — but the same balance sheet, and the same steep curve when stocks run low.
      </P>

      <H2>Sixty simulated years</H2>
      <P>
        So far we have changed one harvest at a time. In the next demonstration the world’s weather changes them all at once, for 60 simulated years. Each year draws
        a harvest for every region at random. The U.S. harvest moves partly with the Crane Valley’s own season — the simulated seasons of{' '}
        <a href={lessonHref('agriculture/3.5')}>Lesson 3.5</a> — because weather bad enough to hurt the valley usually reaches well beyond it. And whatever stocks one
        year carries out, the next year carries in. These prices are simulated, like every price in this course; they are the history that the next chapter will
        trade. Step through the years:
      </P>

      <Figure name="Global Grain Balance · sixty simulated years" scenario={t}>
        <HistoryChart h={h} year={t.state.year} avg={avg} />
        <Readouts
          items={[
            { label: `year ${t.state.year}: valley corn`, value: `${fmt(sel.valleyCorn)} million bu`, tone: 'gold' },
            { label: 'U.S. harvest', value: pct(sel.crop.us) },
            { label: 'Brazil & Argentina', value: pct(sel.crop.southAmerica) },
            { label: 'stocks carried in', value: `${fmt(sel.carryIn)} million t` },
            { label: 'world price', value: usd(sel.price, 2), tone: 'green' },
          ]}
        />
        <Slider label="Year" value={t.state.year} min={1} max={YEARS} onChange={(v) => t.set({ year: v })} display={String(t.state.year)} />
      </Figure>

      <P>
        Three things stand out. First, the valley’s harvest and the world price move in opposite directions, but loosely: over 400 simulated years their correlation
        is −0.63, which means the valley’s own crop accounts for only about two-fifths of the price’s swings. Year 46 is the clearest case: the valley’s worst crop of
        the sixty, 269 million bushels, came with a U.S. harvest a quarter short, and the price reached $9.94. Second, a big crop at home can still meet a high
        price, if the rest of the world has a bad year. Third, prices persist. A short harvest draws stocks down, the next year starts tight, and prices tend to stay
        high for more than one season — as real corn prices did from late 2010 into 2013 and again from late 2020 into 2023.
      </P>

      <Challenge
        id="b"
        question="Find the year in which the Crane Valley grew more corn than its sixty-year average, yet the world price was the highest."
        solved={solved2}
        status={
          sel.valleyCorn > avg
            ? `In year ${t.state.year} the valley grew ${fmt(sel.valleyCorn)} million bushels, more than its ${fmt(avg)}-million average, and corn was ${usd(sel.price, 2)}. Is there a dearer year like it?`
            : `In year ${t.state.year} the valley grew ${fmt(sel.valleyCorn)} million bushels, less than its ${fmt(avg)}-million average.`
        }
        success={`Solved: in year ${t.state.year} the valley grew ${fmt(sel.valleyCorn)} million bushels, ${fmt((sel.valleyCorn / avg - 1) * 100)}% more than average, yet corn was ${usd(sel.price, 2)}, because Brazil and Argentina’s harvest was ${fmt(-sel.crop.southAmerica * 100)}% short, Ukraine and Russia’s ${fmt(-sel.crop.blackSea * 100)}%, and the world carried in only ${fmt(sel.carryIn)} million tons. A farmer who forecast the valley’s crop perfectly would still have guessed wrong about the price. A good price forecast needs the world’s balance sheet, not only the view from Cedar Bend.`}
      />

      <P>
        This chapter has moved grain through space — from the field to the elevator, the port and the world — and through time, in bins. Both cost money, and both
        show up in prices: the gap between a farm and a port in <a href={lessonHref('agriculture/4.4')}>the valley’s network</a>, and the gap between this year and
        the next in the stocks the world chooses to carry in <FigRef to="Global Grain Balance">the world’s balance</FigRef>. Chapter 5 turns those gaps into the prices that grain traders actually trade.
      </P>
    </LessonPage>
  );
}
