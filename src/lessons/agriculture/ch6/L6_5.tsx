import { useMemo } from 'react';
import {
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
  fmt,
  lessonHref,
  linePath,
  mix,
  niceDomain,
  niceTicks,
  scale,
  usd,
} from '../../../framework';
import {
  NEW_SEASONS,
  deskYear,
  expectedCorn,
  farmYear,
  hedgeResult,
  merchantYear,
  priceExposure,
  reportTrade,
  ELEVATOR_OF,
  type DeskPlan,
  type DeskYear,
  type FarmDesign,
  type MerchantPlan,
} from '../../../engines/agriculture/capstone';
import { CONTRACT_BUSHELS, MARKET_YEARS, cropYear } from '../../../engines/agriculture/market';
import { MARKET_LINE } from '../shared/tones';
import { DEFAULT_DESK, HEDGE_RANGE, resetDesk, resetHedge, setDesk, useCapstone, type DeskRules } from '../shared/capstone';
import { SoFar } from '../shared/SoFar';

const HISTORY = Array.from({ length: MARKET_YEARS }, (_, i) => i + 1);
const ALL = [...HISTORY, ...NEW_SEASONS];
const m$ = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, 2)}M`;
const k$ = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`;

/** The desk's plan: futures only (Lesson 5.5's puts pay in a glut, the seasons this business needs them least), and report trades when they are on. */
export function planOf(r: DeskRules): DeskPlan {
  return { hedgeContracts: r.hedgeContracts, hedgeWith: 'futures', forecastContracts: r.forecastTrading ? r.forecastContracts : 0 };
}

export function stats(xs: number[]): { mean: number; sd: number; worst: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { mean, sd: Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length), worst: Math.min(...xs) };
}

/** Every position on the futures slider, contracts. */
export const POSITIONS = Array.from({ length: (HEDGE_RANGE.max - HEDGE_RANGE.min) / HEDGE_RANGE.step + 1 }, (_, i) => HEDGE_RANGE.min + i * HEDGE_RANGE.step);

/** The business's profit in each season with no futures, and what one contract sold, or bought, earned. */
export interface HedgeParts {
  base: number[];
  sell: number[];
  buy: number[];
}

export function hedgeParts(f: FarmDesign, m: MerchantPlan, reportContracts: number, years: number[]): HedgeParts {
  return {
    base: years.map((y) => deskYear(f, m, { hedgeContracts: 0, hedgeWith: 'futures', forecastContracts: reportContracts }, y).total),
    sell: years.map((y) => hedgeResult({ hedgeContracts: 1, hedgeWith: 'futures' }, y)),
    buy: years.map((y) => hedgeResult({ hedgeContracts: -1, hedgeWith: 'futures' }, y)),
  };
}

/** The business's seasons with a futures position of `c` contracts (negative buys). */
export function withFutures(p: HedgeParts, c: number): { mean: number; sd: number; worst: number } {
  return stats(p.base.map((b, i) => b + (c >= 0 ? c * p.sell[i] : -c * p.buy[i])));
}

/** The futures position, in the slider's steps of contracts, that made the desk least variable over a set of seasons. */
export function steadiestPosition(f: FarmDesign, m: MerchantPlan, reportContracts: number, years: number[]): number {
  return steadiestOf(hedgeParts(f, m, reportContracts, years));
}

function steadiestOf(p: HedgeParts): number {
  let best = 0;
  let bestSd = Infinity;
  for (const c of POSITIONS) {
    const sd = withFutures(p, c).sd;
    if (sd < bestSd - 1e-6) {
      bestSd = sd;
      best = c;
    }
  }
  return best;
}

/** A position solves a "least variable" challenge when its spread reads the same, to the displayed $1,000, as the steadiest one's. */
export function steadySolved(p: HedgeParts, c: number): boolean {
  const k = (x: number) => Math.round(withFutures(p, x).sd / 1000);
  return k(c) === k(steadiestOf(p));
}

/** How a position reads on the slider: "buy 190", "sell 15", "none". */
export function positionLabel(c: number): string {
  return c === 0 ? 'none' : `${c > 0 ? 'sell' : 'buy'} ${fmt(Math.abs(c))}`;
}

/** How a position reads in a sentence: "buying 190 contracts". */
export function positionNoun(c: number): string {
  return c === 0 ? 'holding no futures' : `${c > 0 ? 'selling' : 'buying'} ${fmt(Math.abs(c))} contract${Math.abs(c) === 1 ? '' : 's'}`;
}

const bu = (c: number) => `${fmt(Math.round((Math.abs(c) * CONTRACT_BUSHELS) / 1000) * 1000)} bushels`;
/** Money in prose: "$1.56 million", "$25,000". */
const millions = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, 2)} million`;
const thousands = (v: number) => usd(Math.round(v / 1000) * 1000);
const money = (v: number) => (Math.abs(v) >= 1e6 ? millions(v) : thousands(v));

function DeskBars({ rows }: { rows: DeskYear[] }) {
  const parts = ['farm', 'merchant', 'hedge', 'forecast'] as const;
  const colors = { farm: GRAPHIC.green, merchant: MARKET_LINE.cash, hedge: MARKET_LINE.futures, forecast: GRAPHIC.teal };
  const tops = rows.map((r) => parts.reduce((a, p) => a + Math.max(0, r[p]), 0));
  const bots = rows.map((r) => parts.reduce((a, p) => a + Math.min(0, r[p]), 0));
  const [lo, hi] = niceDomain(Math.min(0, ...bots), Math.max(...tops), 4);
  const x = scale(0.5, rows.length + 0.5, 60, 620);
  const y = scale(lo, hi, 180, 24);
  const vy = scale(200, 700, 262, 210);
  const w = (x(1) - x(0)) * 0.78;
  return (
    <svg className="chart" viewBox="0 0 640 292" role="img" aria-label={`The desk’s profit in each of a hundred seasons, from ${m$(Math.min(...rows.map((r) => r.total)))} to ${m$(Math.max(...rows.map((r) => r.total)))}.`}>
      <text className="ax" x={60} y={14}>
        Profit by season: farm, merchant, hedge and report trades
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={60} x1={620} format={m$} baseline={0} />
      {rows.map((r, i) => {
        let up = 0;
        let down = 0;
        return (
          <g key={r.year}>
            {parts.map((p) => {
              const v = r[p];
              if (Math.abs(v) < 1) return null;
              const from = v >= 0 ? up : down;
              const to = from + v;
              if (v >= 0) up = to;
              else down = to;
              return <rect key={p} x={x(i + 1) - w / 2} y={Math.min(y(from), y(to))} width={w} height={Math.max(0.5, Math.abs(y(to) - y(from)))} fill={mix('#fcfcfb', colors[p], 0.7)} />;
            })}
          </g>
        );
      })}
      <line x1={x(60.5)} x2={x(60.5)} y1={20} y2={262} stroke="#333" strokeDasharray="4 3" />
      <text className="ax" x={x(60.5) + 5} y={30}>
        new seasons
      </text>
      <text className="ax" x={60} y={204}>
        Valley corn harvest, million bushels
      </text>
      {rows.map((r, i) => (
        <circle key={r.year} cx={x(i + 1)} cy={vy(cropYear(r.year).valley)} r={2.3} fill={MARKET_LINE.cash} />
      ))}
      {[1, 20, 40, 60, 80, 100].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={280}>
          {t === 1 ? 'season 1' : t}
        </text>
      ))}
    </svg>
  );
}

function Equity({ rows }: { rows: DeskYear[] }) {
  let run = 0;
  const cum = rows.map((r) => (run += r.total));
  const x = scale(0, rows.length, 70, 620);
  const [lo, hi] = niceDomain(Math.min(0, ...cum), Math.max(...cum), 4);
  const y = scale(lo, hi, 170, 24);
  return (
    <svg className="chart" viewBox="0 0 640 200" role="img" aria-label={`The desk’s profit added up over a hundred seasons: ${m$(cum[59])} after the sixty of the history and ${m$(cum[cum.length - 1])} after all hundred.`}>
      <text className="ax" x={70} y={14}>
        Profit added up, season after season
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={70} x1={620} format={(v) => `$${fmt(v / 1e6)}M`} baseline={0} />
      <path d={linePath([x(0), ...cum.map((_, i) => x(i + 1))], [y(0), ...cum.map(y)])} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} />
      <line x1={x(60)} x2={x(60)} y1={20} y2={170} stroke="#333" strokeDasharray="4 3" />
      <text className="ax" x={x(60) + 5} y={30}>
        new seasons
      </text>
      {[0, 20, 40, 60, 80, 100].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={188}>
          {t}
        </text>
      ))}
    </svg>
  );
}

const tenK = (x: number) => fmt(Math.round(Math.abs(x) / 1e4) * 1e4);

export default function Lesson() {
  const { farm, merchant, desk } = useCapstone();
  const plan = planOf(desk);
  const rows = useMemo(() => ALL.map((y) => deskYear(farm, merchant, planOf(desk), y)), [farm, merchant, desk]);
  const hist = stats(rows.slice(0, MARKET_YEARS).map((r) => r.total));
  const fresh = stats(rows.slice(MARKET_YEARS).map((r) => r.total));
  const worstRow = rows.reduce((a, b) => (b.total < a.total ? b : a));
  const histParts = useMemo(() => hedgeParts(farm, merchant, plan.forecastContracts, HISTORY), [farm, merchant, plan.forecastContracts]);
  const newParts = useMemo(() => hedgeParts(farm, merchant, plan.forecastContracts, NEW_SEASONS), [farm, merchant, plan.forecastContracts]);
  const histBest = useMemo(() => steadiestOf(histParts), [histParts]);
  const newBest = useMemo(() => steadiestOf(newParts), [newParts]);
  const solved1 = steadySolved(histParts, desk.hedgeContracts);
  const solved2 = steadySolved(newParts, desk.hedgeContracts);
  const farmOnly = useMemo(() => ALL.map((y) => farmYear(farm, y).total), [farm]);
  const merchantOnly = useMemo(() => ALL.map((y) => merchantYear(merchant, y, ELEVATOR_OF[farm.district]).total), [merchant, farm.district]);

  // The numbers the prose quotes, for the business as the reader left it.
  const farmMean = stats(farmOnly.slice(0, MARKET_YEARS)).mean;
  const merchantMean = stats(merchantOnly.slice(0, MARKET_YEARS)).mean;
  const unhedged = withFutures(histParts, 0);
  const startHedge = withFutures(histParts, DEFAULT_DESK.hedgeContracts);
  const steadied = withFutures(histParts, histBest);
  const worstSeason = HISTORY[histParts.base.indexOf(unhedged.worst)];
  const shortestCrop = Math.min(...HISTORY.map((y) => cropYear(y).valley)) === cropYear(worstSeason).valley;
  const farmCrop = expectedCorn(farm);
  const exposure = useMemo(() => {
    const f = farmOnly.slice(0, MARKET_YEARS);
    const m = merchantOnly.slice(0, MARKET_YEARS);
    return { farm: priceExposure(f, HISTORY), merchant: priceExposure(m, HISTORY), total: priceExposure(f.map((v, i) => v + m[i]), HISTORY) };
  }, [farmOnly, merchantOnly]);
  const side = (x: number) => (x < 0 ? 'short' : 'long');
  const newUnhedged = withFutures(newParts, 0);
  const newAtHistBest = withFutures(newParts, histBest);
  const sameDirection = Math.sign(histBest) === Math.sign(newBest) && histBest !== 0;
  const report = useMemo(() => {
    const cents = (ys: number[]) => (ys.reduce((a, y) => a + reportTrade(y), 0) / ys.length) * 100;
    return { history: cents(HISTORY), fresh: cents(NEW_SEASONS), wins: NEW_SEASONS.filter((y) => reportTrade(y) > 0).length };
  }, []);

  const lossSeasons = rows.filter((r) => r.total < 0).length;
  const hedgeAvg = rows.slice(0, MARKET_YEARS).reduce((a, r) => a + r.hedge, 0) / MARKET_YEARS;
  const farmSd = stats(farmOnly.slice(0, MARKET_YEARS)).sd;
  const merchantSd = stats(merchantOnly.slice(0, MARKET_YEARS)).sd;
  const hedgeName = histBest < 0 ? 'drought hedge' : 'hedge';
  // Does the steadiest position do more for the worst season than for the spread?
  const worstGain = steadied.worst > unhedged.worst ? (steadied.worst - unhedged.worst) / Math.abs(unhedged.worst) : 0;
  const sdGain = 1 - steadied.sd / unhedged.sd;
  const card = useMemo(() => {
    const parts: Array<{ label: string; values: number[] }> = [];
    parts.push({ label: 'The farm alone', values: farmOnly });
    parts.push({ label: '+ the merchant', values: farmOnly.map((v, i) => v + merchantOnly[i]) });
    parts.push({ label: '+ the hedge', values: rows.map((r) => r.farm + r.merchant + r.hedge) });
    parts.push({ label: '+ report trades', values: rows.map((r) => r.total) });
    return parts.map((p) => ({ label: p.label, hist: stats(p.values.slice(0, MARKET_YEARS)), fresh: stats(p.values.slice(MARKET_YEARS)) }));
  }, [farmOnly, merchantOnly, rows]);

  const hedgeSlider = (
    <Slider
      label="December futures, contracts (− buys)"
      tone="violet"
      value={desk.hedgeContracts}
      min={HEDGE_RANGE.min}
      max={HEDGE_RANGE.max}
      step={HEDGE_RANGE.step}
      onChange={(v) => setDesk({ hedgeContracts: v, hedgeWith: 'futures' })}
      display={positionLabel(desk.hedgeContracts)}
    />
  );

  return (
    <LessonPage id="agriculture/6.5">
      <P>
        The business is built: <a href={lessonHref('agriculture/6.1')}>a farm</a> that grows corn and wheat, and{' '}
        <a href={lessonHref('agriculture/6.4')}>an elevator</a> that buys, stores and ships the district’s corn. The last piece is the desk that decides which of
        the business’s risks to keep. On March 1 it can sell December futures, as Cedar Bend did in <a href={lessonHref('agriculture/5.5')}>Lesson 5.5</a>, or
        buy them, in contracts of {fmt(CONTRACT_BUSHELS)} bushels, and close them in mid-October. And it can trade the September crop report on the crop
        analyst’s forecast of <a href={lessonHref('agriculture/5.4')}>Lesson 5.4</a>. Everything else is settled by the rules of the earlier lessons, which carry
        over as you left them:
      </P>
      <SoFar parts={['farm', 'merchant']} />
      <P>
        A desk starts by asking how the business makes and loses money. In a drought the farm harvests less, though the price rises to soften it; the elevator
        buys less corn and its margin shrinks; and the charter loses when the valley’s crop is too short to fill the river. In a glut the farm’s corn is cheap,
        but the elevator is full and busy and the barges earn. The whole business is exposed to the same weather, and mostly in the same direction — which is
        the opposite of what a short hedge protects against. In the next demonstration each bar is one season’s profit in its four parts, the history on the
        left and the forty new seasons on the right, and the dots are the valley’s harvest. Set the hedge and the report trading:
      </P>

      <Figure name="Commodity Trading Desk" onReset={resetDesk}>
        <DeskBars rows={rows} />
        <Legend
          items={[
            { label: 'Farm', color: mix('#fcfcfb', GRAPHIC.green, 0.7) },
            { label: 'Merchant', color: mix('#fcfcfb', MARKET_LINE.cash, 0.7) },
            { label: 'Hedge', color: mix('#fcfcfb', MARKET_LINE.futures, 0.7) },
            { label: 'Report trades', color: mix('#fcfcfb', GRAPHIC.teal, 0.7) },
          ]}
        />
        <Readouts
          items={[
            { label: 'history: average, spread (std. dev.)', value: `${m$(hist.mean)}, ${k$(hist.sd)}`, tone: 'green' },
            { label: 'new seasons: average, spread', value: `${m$(fresh.mean)}, ${k$(fresh.sd)}`, tone: 'green' },
            { label: `worst season (${worstRow.year})`, value: m$(worstRow.total), tone: worstRow.total >= 0 ? 'green' : 'red' },
          ]}
        />
        {hedgeSlider}
        <Segmented
          label="Trade the September report"
          value={desk.forecastTrading ? 'yes' : 'no'}
          onChange={(v) => setDesk({ forecastTrading: v === 'yes' })}
          options={[
            { value: 'no', label: 'No' },
            { value: 'yes', label: 'Yes' },
          ]}
        />
        <Slider
          label="Contracts on the report"
          tone="teal"
          value={desk.forecastContracts}
          min={0}
          max={200}
          step={10}
          onChange={(v) => setDesk({ forecastContracts: v })}
          display={desk.forecastTrading ? String(desk.forecastContracts) : 'off'}
          disabled={!desk.forecastTrading}
        />
      </Figure>

      <P>
        With your farm and elevator as you left them, the merchant earns about {millions(merchantMean)} in an average season of the history and the farm about{' '}
        {thousands(farmMean)}: the business is mostly the elevator. Its worst season of the history was season {worstSeason}, when the valley grew{' '}
        {fmt(cropYear(worstSeason).valley)} million bushels of corn{shortestCrop ? ', the shortest crop of the sixty' : ''}. The desk starts with Lesson 5.5’s
        hedge: selling {DEFAULT_DESK.hedgeContracts} contracts, {bu(DEFAULT_DESK.hedgeContracts)}
        {farmCrop > 0 ? ` or ${fmt(((DEFAULT_DESK.hedgeContracts * CONTRACT_BUSHELS) / farmCrop) * 100)}% of the farm’s expected corn` : ''}. For the whole business it{' '}
        {startHedge.sd > unhedged.sd ? 'backfires' : 'helps a little'}: it {startHedge.sd > unhedged.sd ? 'widens' : 'narrows'} the spread of the business’s
        seasons over the history — their standard deviation, as in Lesson 5.5 — from {money(unhedged.sd)} with no futures to {money(startHedge.sd)}.{' '}
        {histBest < 0
          ? 'A short hedge loses in exactly the seasons the business does: the droughts, when the price rises. The position that steadies the business is the other way round — buying December futures in March, which pays when a drought lifts the price.'
          : histBest > 0
            ? 'With this farm, the farm’s own crop outweighs the elevator’s drought, and the position that steadies the business is a short one.'
            : 'With this farm, the farm’s own crop and the elevator’s drought nearly cancel.'}{' '}
        How many contracts is a question about the whole business, not about the farm’s {bu(farmCrop / CONTRACT_BUSHELS)}: in Lesson 5.5 the farm was the
        business; here it is the smaller part.
      </P>
      <P>
        This is Lesson 5.5’s <K tone="gold">natural hedge</K>, grown to the size of the business. There the farm’s shrinking crop and rising price offset each
        other, so a full futures hedge fought protection the farm already had. Here the farm’s crop, the elevator’s volume and the barges all ride on the same
        harvest, and the futures position worth holding is the one that offsets what is left over. Agribusinesses reason the same way about their margins: an
        ethanol plant buys corn futures and sells ethanol forward, because the gap between the two is its business. The question is always what moves the
        margin, and which futures position moves the other way.
      </P>

      <Challenge
        id="a"
        question="With your business as it is, what position in December futures, to the nearest 5 contracts, makes the desk’s profit least variable over the sixty seasons of the history?"
        solved={solved1}
        status={`The history’s seasons have a spread of ${k$(hist.sd)} when the desk is ${positionNoun(desk.hedgeContracts)}.`}
        success={`Solved: ${positionNoun(desk.hedgeContracts)} — ${bu(desk.hedgeContracts)}${farmCrop > 0 ? `, ${fmt((Math.abs(desk.hedgeContracts) * CONTRACT_BUSHELS) / farmCrop, 1)} times the farm’s expected corn` : ''} — makes the business’s seasons vary least over the history, with a spread of ${k$(hist.sd)}. That position was chosen by looking at sixty seasons. Is it right for the next forty?`}
      />

      <P>
        The steadiest position has a physical meaning. Over the history, for every dollar December futures rose between March and mid-October, the elevator
        earned about ${tenK(exposure.merchant)} {exposure.merchant < 0 ? 'less' : 'more'} — as if it were {side(exposure.merchant)} {tenK(exposure.merchant)}{' '}
        bushels of corn — while the farm, whose price rises when its crop falls, was {side(exposure.farm)} about {tenK(exposure.farm)}. Together the business
        was {side(exposure.total)} about {tenK(exposure.total)} bushels, {fmt(Math.abs(exposure.total) / CONTRACT_BUSHELS)} contract
        {Math.round(Math.abs(exposure.total) / CONTRACT_BUSHELS) === 1 ? '' : 's'},{' '}
        {histBest === 0 ? (
          'and the steadiest position is no position at all.'
        ) : (
          <>
            and the steadiest position {histBest < 0 ? 'buys' : 'sells'} about that many, {fmt(Math.abs(histBest))} or so. It narrows the spread over the
            history from {money(unhedged.sd)} to {money(steadied.sd)}, by {fmt(sdGain * 100)}%, and {steadied.worst > unhedged.worst ? 'lifts' : 'moves'} the
            worst season from {money(unhedged.worst)} to {money(steadied.worst)}
            {worstGain > sdGain ? ': the hedge’s real work is in the bad seasons.' : '.'}
          </>
        )}
        {histBest < 0 ? ' Lesson 5.5’s puts, which pay when the price falls, would protect this business in the seasons that need it least, so the desk trades futures only.' : ''}
      </P>

      <H2>Seasons the desk has never seen</H2>
      <P>
        Every rule in this chapter was chosen on the sixty seasons of the history. The forty new seasons are the honest test: none of them shaped a forecast, a
        design or a rule. In the next demonstration the table adds the business up piece by piece, on the history and on the new seasons, and the line is its
        profit added up over all hundred. It carries the futures position with it:
      </P>

      <Figure name="Commodity Trading Desk · scorecard" onReset={resetHedge}>
        <DataTable
          columns={[
            { label: 'Business', cell: (r: (typeof card)[number]) => r.label, align: 'left' },
            { label: 'History: average', cell: (r) => m$(r.hist.mean) },
            { label: 'spread', cell: (r) => k$(r.hist.sd) },
            { label: 'worst', cell: (r) => m$(r.hist.worst) },
            { label: 'New: average', cell: (r) => m$(r.fresh.mean) },
            { label: 'spread', cell: (r) => k$(r.fresh.sd) },
            { label: 'worst', cell: (r) => m$(r.fresh.worst) },
          ]}
          rows={card}
          rowKey={(r) => r.label}
        />
        <Equity rows={rows} />
        {hedgeSlider}
      </Figure>

      <P>
        The report trades hold up: the crop analyst’s edge earned {fmt(report.history, 1)} cents a bushel a season over the history and{' '}
        {fmt(report.fresh, 1)} over the new seasons, winning {report.wins} of the 40 — a trading idea that came from how a crop develops, not from a
        price chart, and survived a test it was never fitted to.{' '}
        {!sameDirection
          ? `The ${hedgeName} doesn’t even hold its direction in the new seasons.`
          : newAtHistBest.worst > newUnhedged.worst
            ? `The ${hedgeName} holds up in direction: ${histBest < 0 ? 'buying' : 'selling'} the history’s ${fmt(Math.abs(histBest))} contracts still lifts the new seasons’ worst, from ${money(newUnhedged.worst)} to ${money(newAtHistBest.worst)}.`
            : `The ${hedgeName} holds up in direction: the new seasons, too, are steadiest when the desk is ${histBest < 0 ? 'buying' : 'selling'}.`}{' '}
        Its size is another matter: any hedge sized on the past is an estimate, and the honest report gives the range it might fall in, not a single best
        number.
      </P>
      <P>
        Read the scorecard from the top down and it describes the business’s character. The farm alone earns little and swings widely. The merchant adds most of
        the money, {merchantSd > farmSd ? 'and most of the risk too' : 'though the farm’s own swings are as wide'}, since its volume and its barges ride on the
        valley’s harvest. The hedge earns little on average
        {desk.hedgeContracts === 0 ? ',' : ` — ${thousands(hedgeAvg)} a season over the history at your position —`} because futures are close to fair forecasts,
        and is there for the worst seasons. The report trades
        {plan.forecastContracts > 0 ? ' add' : ', once you turn them on in the first demonstration, add'} a little money with little risk, as long as few others trade
        the same information. The line of profit added up shows the result: it climbs in{' '}
        {lossSeasons === 0 ? 'every one of the hundred seasons' : `all but ${lossSeasons} of the hundred seasons`}, and{' '}
        {fresh.mean > hist.mean * 1.1 ? 'faster' : fresh.mean < hist.mean * 0.9 ? 'more slowly' : 'about as fast'} once the new seasons begin. A trading business is a set of such pieces, each
        understood physically, sized to what the worst season can bear.
      </P>

      <Challenge
        id="b"
        question="On the forty new seasons alone, what position in December futures, to the nearest 5 contracts, would have made the desk least variable?"
        solved={solved2}
        status={`The new seasons have a spread of ${k$(fresh.sd)} when the desk is ${positionNoun(desk.hedgeContracts)}; the history’s steadiest position was ${positionNoun(histBest)}.`}
        success={`Solved: on the new seasons the steadiest position was ${positionNoun(desk.hedgeContracts)}, against ${positionNoun(histBest)} on the history. ${steadySolved(newParts, histBest) ? 'This time the history’s answer held — but it might not have.' : 'The two differ, and neither is “the” answer; together they say the right position is somewhere around them, and the history alone could not have said where.'}`}
      />

      <P>
        That is the course. A corn price, it turns out, is a forecast of a harvest that hasn’t happened yet, and everything in it can be traced to something
        physical: sunlight caught by leaves in Chapter 1, the economics of a farm in Chapter 2, the weather that no one can forecast far ahead in Chapter 3, the
        bins, grades, trains and barges of Chapter 4, and the curve, the basis and the hedges of Chapter 5. <FigRef to="Commodity Trading Desk">The desk</FigRef>{' '}
        put them in one place. Its best ideas came not from the prices themselves but from what lies under them — a crop’s development, the summer’s weather, the
        bins that fill and the routes that run out of room.
      </P>
    </LessonPage>
  );
}
