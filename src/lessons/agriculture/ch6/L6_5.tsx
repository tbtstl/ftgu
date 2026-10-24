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
} from '../../../framework';
import { NEW_SEASONS, deskYear, farmYear, merchantYear, ELEVATOR_OF, type DeskPlan, type DeskYear, type FarmDesign, type MerchantPlan } from '../../../engines/agriculture/capstone';
import { MARKET_YEARS, cropYear } from '../../../engines/agriculture/market';
import { MARKET_LINE } from '../shared/tones';
import { resetDesk, setDesk, useCapstone, type DeskRules } from '../shared/capstone';

const HISTORY = Array.from({ length: MARKET_YEARS }, (_, i) => i + 1);
const ALL = [...HISTORY, ...NEW_SEASONS];
const m$ = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, 2)}M`;
const k$ = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`;

export function planOf(r: DeskRules): DeskPlan {
  return { hedgePct: r.hedgePct, hedgeWith: r.hedgeWith, forecastContracts: r.forecastTrading ? r.forecastContracts : 0 };
}

export function stats(xs: number[]): { mean: number; sd: number; worst: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { mean, sd: Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length), worst: Math.min(...xs) };
}

export const POSITIONS = Array.from({ length: 26 }, (_, i) => -100 + i * 10);

/** The futures position on the farm's crop (in steps of 10%) that made the desk least variable over a set of seasons. */
export function steadiestPosition(f: FarmDesign, m: MerchantPlan, contracts: number, years: number[]): number {
  let best = 0;
  let bestSd = Infinity;
  for (const p of POSITIONS) {
    const sd = stats(years.map((y) => deskYear(f, m, { hedgePct: p, hedgeWith: 'futures', forecastContracts: contracts }, y).total)).sd;
    if (sd < bestSd - 1e-6) {
      bestSd = sd;
      best = p;
    }
  }
  return best;
}

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

export default function Lesson() {
  const { farm, merchant, desk } = useCapstone();
  const plan = planOf(desk);
  const rows = useMemo(() => ALL.map((y) => deskYear(farm, merchant, plan, y)), [farm, merchant, plan]);
  const hist = stats(rows.slice(0, MARKET_YEARS).map((r) => r.total));
  const fresh = stats(rows.slice(MARKET_YEARS).map((r) => r.total));
  const worstRow = rows.reduce((a, b) => (b.total < a.total ? b : a));
  const histBest = useMemo(() => steadiestPosition(farm, merchant, plan.forecastContracts, HISTORY), [farm, merchant, plan.forecastContracts]);
  const newBest = useMemo(() => steadiestPosition(farm, merchant, plan.forecastContracts, NEW_SEASONS), [farm, merchant, plan.forecastContracts]);
  const solved1 = desk.hedgeWith === 'futures' && desk.hedgePct === histBest;
  const solved2 = desk.hedgeWith === 'futures' && desk.hedgePct === newBest;
  const farmOnly = useMemo(() => ALL.map((y) => farmYear(farm, y).total), [farm]);
  const merchantOnly = useMemo(() => ALL.map((y) => merchantYear(merchant, y, ELEVATOR_OF[farm.district]).total), [merchant, farm.district]);

  const card = useMemo(() => {
    const parts: Array<{ label: string; values: number[] }> = [];
    parts.push({ label: 'The farm alone', values: farmOnly });
    parts.push({ label: '+ the merchant', values: farmOnly.map((v, i) => v + merchantOnly[i]) });
    parts.push({ label: '+ the hedge', values: rows.map((r) => r.farm + r.merchant + r.hedge) });
    parts.push({ label: '+ report trades', values: rows.map((r) => r.total) });
    return parts.map((p) => ({ label: p.label, hist: stats(p.values.slice(0, MARKET_YEARS)), fresh: stats(p.values.slice(MARKET_YEARS)) }));
  }, [farmOnly, merchantOnly, rows]);

  return (
    <LessonPage id="agriculture/6.5">
      <P>
        The business is built: <a href={lessonHref('agriculture/6.1')}>a farm</a> that grows corn and wheat, and{' '}
        <a href={lessonHref('agriculture/6.4')}>an elevator</a> that buys, stores and ships the district’s corn. The last piece is the desk that decides which of
        the business’s risks to keep. It can sell December futures against the farm’s expected corn on March 1, or buy puts, as in{' '}
        <a href={lessonHref('agriculture/5.5')}>Lesson 5.5</a> — or buy futures instead. And it can trade the September crop report on the crop analyst’s
        forecast of <a href={lessonHref('agriculture/5.4')}>Lesson 5.4</a>. Everything else is settled by the rules of the earlier lessons, which carry over as you
        left them.
      </P>
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
            { label: 'history: average, spread', value: `${m$(hist.mean)}, ${k$(hist.sd)}`, tone: 'green' },
            { label: 'new seasons: average, spread', value: `${m$(fresh.mean)}, ${k$(fresh.sd)}`, tone: 'green' },
            { label: `worst season (${worstRow.year})`, value: m$(worstRow.total), tone: worstRow.total >= 0 ? 'green' : 'red' },
          ]}
        />
        <Segmented
          label="Hedge with"
          value={desk.hedgeWith}
          onChange={(v) => setDesk({ hedgeWith: v, hedgePct: v === 'puts' ? Math.max(0, desk.hedgePct) : desk.hedgePct })}
          options={[
            { value: 'futures', label: 'Futures' },
            { value: 'puts', label: 'Puts' },
          ]}
        />
        <Slider
          label={desk.hedgeWith === 'futures' ? 'Futures on the farm’s corn (− buys)' : 'Puts on the farm’s corn'}
          tone="violet"
          value={desk.hedgePct}
          min={desk.hedgeWith === 'futures' ? -100 : 0}
          max={150}
          step={10}
          onChange={(v) => setDesk({ hedgePct: v })}
          display={`${desk.hedgePct > 0 ? 'sell ' : desk.hedgePct < 0 ? 'buy ' : ''}${Math.abs(desk.hedgePct)}%`}
        />
        <Segmented
          label="Trade the September report"
          value={desk.forecastTrading ? 'yes' : 'no'}
          onChange={(v) => setDesk({ forecastTrading: v === 'yes' })}
          options={[
            { value: 'no', label: 'No' },
            { value: 'yes', label: 'Yes' },
          ]}
        />
        <Slider label="Contracts on the report" tone="teal" value={desk.forecastContracts} min={0} max={200} step={10} onChange={(v) => setDesk({ forecastContracts: v })} display={String(desk.forecastContracts)} />
      </Figure>

      <P>
        With Cedar Bend and the elevator as Chapter 4 ran it, the merchant earns about $1.56 million in an average season and the farm about $25,000: the
        business is mostly the elevator, and its worst seasons are the droughts. A short hedge on the farm’s corn — the hedge of Lesson 5.5 — makes the whole
        business riskier, because it loses in exactly those seasons. The position that steadies the business is the other way round: buying December futures
        in March, which pays when a drought lifts the price. Buying 40% of the farm’s expected crop narrows the spread of the business’s seasons over the history
        and lifts its worst season from $0.81 million to $1.04 million. Real agribusinesses think the same way: they hedge their <K tone="violet">margins</K>,
        not just a price, and a business whose volume falls when prices rise is, in effect, short a drought.
      </P>
      <P>
        Margin hedging is the everyday work of the grain trade. An ethanol plant buys corn futures and sells ethanol forward to lock in the spread between them;
        a soybean processor trades the “crush,” soybeans against the meal and oil made from them. Each hedges the difference between what it buys and what it sells,
        because that difference is its business. Our desk’s difference is less tidy — a farm’s bushels, an elevator’s volume, a barge’s scarcity — but the
        question is the same: what moves the margin, and which futures position moves the other way.
      </P>

      <Challenge
        id="a"
        question="With futures and your business as it is, what position on the farm’s corn, to the nearest 10% (negative for buying), makes the desk’s profit least variable over the sixty seasons of the history?"
        solved={solved1}
        status={desk.hedgeWith !== 'futures' ? 'Hedge with futures.' : `At ${desk.hedgePct}% the history’s seasons vary by ${k$(hist.sd)}.`}
        success={`Solved: ${desk.hedgePct > 0 ? 'selling' : desk.hedgePct < 0 ? 'buying' : 'not trading'} ${Math.abs(desk.hedgePct)}% of the farm’s expected corn makes the business’s seasons vary least over the history, by ${k$(hist.sd)}. That position was chosen by looking at sixty seasons. Is it right for the next forty?`}
      />

      <H2>Seasons the desk has never seen</H2>
      <P>
        Every rule in this chapter was chosen on the sixty seasons of the history. The forty new seasons are the honest test: none of them shaped a forecast, a
        design or a rule. In the next demonstration the table adds the business up piece by piece, on the history and on the new seasons, and the line is its
        profit added up over all hundred:
      </P>

      <Figure name="Commodity Trading Desk · scorecard" onReset={resetDesk}>
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
        <Slider
          label={desk.hedgeWith === 'futures' ? 'Futures on the farm’s corn (− buys)' : 'Puts on the farm’s corn'}
          tone="violet"
          value={desk.hedgePct}
          min={desk.hedgeWith === 'futures' ? -100 : 0}
          max={150}
          step={10}
          onChange={(v) => setDesk({ hedgePct: v })}
          display={`${desk.hedgePct > 0 ? 'sell ' : desk.hedgePct < 0 ? 'buy ' : ''}${Math.abs(desk.hedgePct)}%`}
        />
      </Figure>

      <P>
        Two things hold up and one doesn’t. The report trades do: the crop analyst’s edge earned 7.1 cents a bushel a season over the history and 7.0 over the
        new seasons, winning 29 of the 40 — a trading idea that came from how a crop develops, not from a price chart, and survived a test it was never fitted
        to. The drought hedge holds up in direction: buying futures still steadies the business in the new seasons. But its size doesn’t: the new seasons, with
        fewer and milder droughts, wanted a smaller long position than the history did. The size of any hedge chosen on the past is an estimate, and the honest
        report gives the range it might fall in, not a single best number.
      </P>
      <P>
        Read the scorecard from the top down and it describes the business’s character. The farm alone earns little and swings widely. The merchant adds most of
        the money, and most of the risk too, since its volume and its barges ride on the valley’s harvest. The hedge earns nothing on average — futures are fair
        forecasts — but trims the worst seasons. The report trades add a little money with little risk, as long as few others trade the same information. A
        trading business is a set of such pieces, each understood physically, sized to what the worst season can bear.
      </P>

      <Challenge
        id="b"
        question="On the forty new seasons alone, what futures position on the farm’s corn, to the nearest 10%, would have made the desk least variable?"
        solved={solved2}
        status={desk.hedgeWith !== 'futures' ? 'Hedge with futures.' : `At ${desk.hedgePct}% the new seasons vary by ${k$(fresh.sd)}; the history’s best was ${histBest}%.`}
        success={`Solved: on the new seasons the steadiest position was ${desk.hedgePct}%, against ${histBest}% on the history. ${desk.hedgePct === histBest ? 'This time the history’s answer held — but it might not have.' : 'The two differ, and neither is “the” answer; together they say the right position is somewhere between them, and the history alone could not have said which.'}`}
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
