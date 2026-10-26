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
  Slider,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  scale,
  signed,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import {
  DESK_CONTRACTS,
  DESK_LABEL,
  bestHedgeForP5,
  blotterRow,
  bookOutcome,
  novemberFirst,
  type BlotterRow,
  type BookOutcome,
  type DeskBook,
  type DeskBusiness,
} from '../../../engines/weather/desk';
import { regress, utilityWinters } from '../../../engines/weather/exposure';
import { MARKET, expectedIndex, type MarketModel } from '../../../engines/weather/market';
import { SEASON_STRIP } from '../../../engines/weather/portfolio';
import { CME_TICK, quantile, settledIndex } from '../../../engines/weather/pricing';
import { dayInfo, ninoAt, type WorldKnobs } from '../../../model/weather/archive';
import { MONTH_NAMES } from '../../../model/weather/region';
import {
  DESK_DEFAULTS,
  DESK_RANGE,
  REGION_DEFAULTS,
  confirmResetPart,
  isFenwick,
  regionKnobs,
  updateCapstone,
  useWeatherCapstone,
  type DeskSettings,
  type RegionSettings,
} from '../shared/capstone';
import { CapstoneStrip } from '../shared/CapstoneStrip';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// Settings and challenge checks (exported for the tests).

/** The winter the desk opens on: November of year 23 to March of year 24, a strong La Niña. */
export const DESK_WINTER = 23;
/** The date the blotter opens on: November 20, 19 days after November 1. */
export const DESK_OFFSET = 19;
export const OFFSET_MIN = -60;
export const OFFSET_MAX = 119;
export const WINTER_MIN = 2;
export const WINTER_MAX = 40;
/** Strips are chosen in hundreds, up to 6,000, as in Lessons 6.3 and 6.5. */
export const STRIP_STEP = DESK_RANGE.strips.step;
export const STRIP_GRID = Array.from({ length: DESK_RANGE.strips.max / STRIP_STEP + 1 }, (_, i) => i * STRIP_STEP);

export interface DeskView {
  winter: number;
  /** Days after November 1 of the winter (negative: before it). */
  offset: number;
  /** The Pacific's pull on the winter, °F per °C of Niño-3.4. */
  ensoF: number;
  /** How stale the market's forecasts are, days. */
  lag: number;
  usesEnso: boolean;
  reveal: boolean;
}

export function viewDefaults(region: RegionSettings): DeskView {
  return { winter: DESK_WINTER, offset: DESK_OFFSET, ensoF: region.ensoF, lag: MARKET.infoDelay, usesEnso: false, reveal: false };
}

export function marketOf(v: Pick<DeskView, 'lag' | 'usesEnso'>): MarketModel {
  return { ...MARKET, infoDelay: v.lag, usesEnso: v.usesEnso };
}

export function knobsOf(region: RegionSettings, ensoF: number): WorldKnobs {
  return { ...regionKnobs(region), ensoF };
}

/** The blotter: the strip and the three monthly futures at the end of the view's day. */
export function blotter(region: RegionSettings, v: DeskView, threshold: number): BlotterRow[] {
  const day = novemberFirst(v.winter) + v.offset;
  return DESK_CONTRACTS.map((id) => blotterRow(id, v.winter, day, marketOf(v), knobsOf(region, v.ensoF), threshold));
}

/**
 * The first challenge: on November 20 of the starting winter, with the market still blind to
 * ENSO, change the physics and the market's forecasts until no open contract's gap beats the
 * spread. (It takes no pull from the Pacific and fresh forecasts.)
 */
export function vanishSolved(region: RegionSettings, v: DeskView): boolean {
  if (v.winter !== DESK_WINTER || v.offset !== DESK_OFFSET || v.usesEnso) return false;
  return blotter(region, v, 0).every((r) => r.status === 'settled' || r.edge <= 1e-9);
}

export function deskBook(d: DeskSettings): DeskBook {
  return { hedgeStrips: d.hedgeStrips, months: d.months, lead: d.lead, threshold: d.threshold, size: d.size };
}

const bestCache = new Map<string, { strips: number; p5: number }>();
/** The strips (in hundreds) that give the winter's book its best 1-in-20 result, other settings held. */
export function bestStrips(winter: number, d: DeskSettings, business: DeskBusiness, scaleBy: number, m: MarketModel, knobs: WorldKnobs): { strips: number; p5: number } {
  const key = JSON.stringify([winter, d.months, d.lead, d.threshold, d.size, business, scaleBy, m, knobs]);
  let v = bestCache.get(key);
  if (!v) {
    v = bestHedgeForP5(winter, deskBook(d), business, scaleBy, m, knobs, STRIP_GRID);
    if (bestCache.size > 30) bestCache.clear();
    bestCache.set(key, v);
  }
  return v;
}

/**
 * The second challenge: for the gas utility, with the desk still trading, the number of strips
 * that gives the winter's book its best 1-in-20 result.
 */
export function hedgeSolved(region: RegionSettings, v: DeskView, d: DeskSettings, business: DeskBusiness, scaleBy: number): boolean {
  if (business !== 'utility' || d.size <= 0 || d.months.length === 0) return false;
  return d.hedgeStrips === bestStrips(v.winter, d, business, scaleBy, marketOf(v), knobsOf(region, v.ensoF)).strips;
}

/** The utility's minimum-variance hedge in a world, at a size: its dollars per degree day across the archive's winters, divided by the strip's $20. */
export function minVarianceStrips(knobs: WorldKnobs, scaleBy: number): number {
  const ws = utilityWinters(knobs);
  const slope = regress(
    ws.map((w) => w.hdd),
    ws.map((w) => w.margin),
  ).slope;
  return (slope * scaleBy) / CME_TICK;
}

/**
 * The second challenge's success message, from the reader's own answer: the best strips, their
 * 1-in-20 result, the minimum-variance hedge, the strip's bid on October 31 and our expected index
 * that day. It has to stay true in any region, at any size, against either market.
 */
export function hedgeSuccessText(strips: number, p5: number, minVar: number, bid: number, fair: number): string {
  const head = `Solved: ${fmt(strips)} strips, a 1-in-20 result of ${mShort(p5, 2)}.`;
  const cheap = fair - bid > 1;
  if (strips === 0) {
    return `${head} In this winter the best hedge is none at all: ${
      cheap ? `the strips go at the market’s bid of ${fmt(bid)} on October 31, when our forecast expected ${fmt(fair)}, so ` : ''
    }each strip sold gives away more expected margin than it saves in the worst twentieth${
      p5 >= 0 ? ' — without them, even the 1-in-20 result is a gain' : ''
    }. The minimum-variance hedge of about ${fmt(minVar)} strips would narrow the spread, at a price this book doesn’t need to pay.`;
  }
  const diff = strips - minVar;
  const where =
    Math.abs(diff) <= STRIP_STEP / 2
      ? 'right at'
      : Math.abs(diff) <= 4 * STRIP_STEP
        ? `close to, and a little ${diff < 0 ? 'below' : 'above'},`
        : `well ${diff < 0 ? 'below' : 'above'}`;
  return `${head} That is ${where} the minimum-variance hedge of about ${fmt(minVar)} strips — the utility’s dollars per degree day divided by $20${
    diff < -STRIP_STEP / 2 && cheap ? '. The market sold the strip cheap, so each extra strip trims a little spread but gives away expected margin at the market’s price' : ''
  }.`;
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes: Fenwick Bay's own region, the starting desk.

interface ProseNumbers {
  /** The standard deviation of the utility's winter margin across the archive's winters 1–40 (Lesson 6.1's figure), $. */
  archiveSd: number;
  nino20: number;
  rows20: BlotterRow[];
  sep2: BlotterRow;
  sep2Nino: number;
  book0: BookOutcome;
  book2800: BookOutcome;
  bestN: number;
  bestBook: BookOutcome;
  slope: number;
  fairOct31: number;
  hedgeBid: number;
  ensoMarket: BookOutcome;
  settledSeason: number;
}

let prose: ProseNumbers | null = null;
function proseNumbers(): ProseNumbers {
  if (prose) return prose;
  const region = REGION_DEFAULTS;
  const v = viewDefaults(region);
  const knobs = knobsOf(region, v.ensoF);
  const m = marketOf(v);
  const nov1 = novemberFirst(DESK_WINTER);
  const rows20 = blotter(region, v, DESK_DEFAULTS.threshold);
  const sep2 = blotterRow('strip', DESK_WINTER, nov1 - 60, m, knobs, DESK_DEFAULTS.threshold);
  const ws = utilityWinters(knobs);
  const slope = regress(
    ws.map((w) => w.hdd),
    ws.map((w) => w.margin),
  ).slope;
  const best = bestStrips(DESK_WINTER, DESK_DEFAULTS, 'utility', 1, m, knobs);
  const margins = ws.map((w) => w.margin);
  const meanMargin = margins.reduce((a, b) => a + b, 0) / margins.length;
  prose = {
    archiveSd: Math.sqrt(margins.reduce((a, b) => a + (b - meanMargin) ** 2, 0) / margins.length),
    nino20: ninoAt(nov1 + DESK_OFFSET),
    rows20,
    sep2,
    sep2Nino: ninoAt(nov1 - 60),
    book0: bookOutcome(DESK_WINTER, deskBook(DESK_DEFAULTS), 'utility', 1, m, knobs),
    book2800: bookOutcome(DESK_WINTER, { ...deskBook(DESK_DEFAULTS), hedgeStrips: 2800 }, 'utility', 1, m, knobs),
    bestN: best.strips,
    bestBook: bookOutcome(DESK_WINTER, { ...deskBook(DESK_DEFAULTS), hedgeStrips: best.strips }, 'utility', 1, m, knobs),
    slope,
    fairOct31: expectedIndex(SEASON_STRIP, DESK_WINTER, nov1 - 1, { knobs }),
    hedgeBid: bookOutcome(DESK_WINTER, deskBook(DESK_DEFAULTS), 'utility', 1, m, knobs).hedgePrice,
    ensoMarket: bookOutcome(DESK_WINTER, { ...deskBook(DESK_DEFAULTS), hedgeStrips: 2800 }, 'utility', 1, { ...m, usesEnso: true }, knobs),
    settledSeason: settledIndex(SEASON_STRIP, DESK_WINTER, knobs),
  };
  return prose;
}

// ---------------------------------------------------------------------------
// Formatting.

function dateLabel(day: number): string {
  const i = dayInfo(day);
  return `${MONTH_NAMES[i.month]} ${i.dom}`;
}

/** $ in millions: "$11.0 million". */
function millions(x: number, digits = 1): string {
  return `${x < 0 ? '−' : ''}$${fmt(Math.abs(x) / 1e6, digits)} million`;
}

function mShort(x: number, digits = 1): string {
  return `${x < 0 ? '−' : ''}$${fmt(Math.abs(x) / 1e6, digits)}M`;
}

const ENSO_COLOR = GRAPHIC.violet;
const LAG_COLOR = GRAPHIC.blue;

// ---------------------------------------------------------------------------
// Figure 1: the gaps, split by source.

function GapChart({ rows, halfSpread }: { rows: BlotterRow[]; halfSpread: number }) {
  const open = rows.filter((r) => r.status !== 'settled');
  const big = Math.max(20, halfSpread * 2, ...open.flatMap((r) => [Math.abs(r.gap), Math.abs(r.ensoPart), Math.abs(r.lagPart)]));
  const [d0, d1] = niceDomain(-big, big, 4);
  const lim = Math.max(Math.abs(d0), Math.abs(d1));
  const x = scale(-lim, lim, 150, 610);
  const rowY = (i: number) => 34 + i * 42;
  const ticks = niceTicks(-lim, lim, 4);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 214"
      role="img"
      aria-label={`Gap between our expected index and the market's mid for each contract, split into the part from the Pacific and the part from the market's stale forecasts: ${rows
        .map((r) => (r.status === 'settled' ? `${DESK_LABEL[r.id]} settled at ${fmt(r.settled)}` : `${DESK_LABEL[r.id]} ${signed(r.gap)} points (Pacific ${signed(r.ensoPart)}, forecasts ${signed(r.lagPart)})`))
        .join('; ')}. The spread is ±${halfSpread} points.`}
    >
      <text className="ax" x={150} y={12}>
        Our expected index minus the market’s mid, degree days
      </text>
      <rect x={x(-halfSpread)} y={20} width={x(halfSpread) - x(-halfSpread)} height={170} fill="#e9e7e1" />
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={x(t)} x2={x(t)} y1={20} y2={190} />
          <text className="ax ax-m" x={x(t)} y={206}>
            {signed(t)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = rowY(i);
        return (
          <g key={r.id}>
            <text x={8} y={y + 4} className="lab">
              {DESK_LABEL[r.id]}
            </text>
            <text x={8} y={y + 19} className="ax">
              {r.status === 'open' ? 'not started' : r.status === 'running' ? 'running' : `settled at ${fmt(r.settled)}`}
            </text>
            {r.status !== 'settled' && (
              <g>
                <rect x={Math.min(x(0), x(r.ensoPart))} y={y - 8} width={Math.abs(x(r.ensoPart) - x(0))} height={9} fill={ENSO_COLOR} opacity={0.85} />
                <rect x={Math.min(x(0), x(r.lagPart))} y={y + 3} width={Math.abs(x(r.lagPart) - x(0))} height={9} fill={LAG_COLOR} opacity={0.85} />
                <circle cx={x(r.gap)} cy={y + 2} r={5} fill="#333" stroke="#fcfcfb" strokeWidth={1.5} />
                <text
                  x={r.gap >= 0 ? Math.min(600, x(r.gap) + 9) : Math.max(160, x(r.gap) - 9)}
                  y={y + 6}
                  textAnchor={r.gap >= 0 ? 'start' : 'end'}
                  style={{ fontSize: 12, fontWeight: 600, fill: '#333' }}
                >
                  {signed(r.gap)}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: the book's outcomes.

function BookChart({ book, reveal }: { book: BookOutcome; reveal: boolean }) {
  const totals = book.totals;
  const biz = book.business;
  // A fixed range for the winter — the business alone, and the book — so a hedge visibly narrows it.
  const lo = Math.min(totals[0], biz[0], reveal ? book.actual : Infinity);
  const hi = Math.max(totals[totals.length - 1], biz[biz.length - 1], reveal ? book.actual : -Infinity);
  const [d0, d1] = niceDomain(lo / 1e6, Math.max(hi / 1e6, lo / 1e6 + 1), 5);
  const x = scale(d0, d1, 40, 620);
  const bins = 40;
  const w = (d1 - d0) / bins;
  const hist = (xs: Float64Array) => {
    const c = new Array(bins).fill(0);
    for (const t of xs) c[Math.max(0, Math.min(bins - 1, Math.floor((t / 1e6 - d0) / w)))]++;
    return c;
  };
  const counts = hist(totals);
  const bizCounts = hist(biz);
  const maxC = Math.max(...counts, ...bizCounts, 1);
  const y = scale(0, maxC, 160, 26);
  const ticks = niceTicks(d0, d1, 5);
  let outline = `M${x(d0).toFixed(1)} 160`;
  bizCounts.forEach((c, i) => {
    outline += ` L${x(d0 + i * w).toFixed(1)} ${y(c).toFixed(1)} L${x(d0 + (i + 1) * w).toFixed(1)} ${y(c).toFixed(1)}`;
  });
  outline += ` L${x(d1).toFixed(1)} 160`;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 196"
      role="img"
      aria-label={`The book's result for the winter against the business's average year, over ${totals.length} simulated paths seen from ${dateLabel(book.viewDay)}: expected ${mShort(book.mean)}, standard deviation ${mShort(book.sd, 2)}, 1-in-20 result ${mShort(book.p5)}.${reveal ? ` It turned out ${mShort(book.actual)}.` : ''}`}
    >
      <text className="ax" x={40} y={12}>
        The winter’s result against an average year, simulated paths
      </text>
      {counts.map((c, i) =>
        c > 0 ? <rect key={i} x={x(d0 + i * w) + 0.5} y={y(c)} width={Math.max(1, x(d0 + w) - x(d0) - 1)} height={160 - y(c)} fill={tint(GRAPHIC.green, 0.6)} /> : null,
      )}
      <path d={outline} fill="none" stroke="#8a8a8a" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={x(quantile(biz, 0.5) / 1e6)} y={y(Math.max(...bizCounts)) - 6} textAnchor="middle" className="ax">
        business alone
      </text>
      <line className="base" x1={40} x2={620} y1={160} y2={160} />
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'cur' : 'gl'} x1={x(t)} x2={x(t)} y1={24} y2={160} />
          <text className="ax ax-m" x={x(t)} y={176}>
            {t === 0 ? '$0' : `${t < 0 ? '−' : ''}$${fmt(Math.abs(t), Math.abs(t) < 1 && t !== 0 ? 1 : 0)}M`}
          </text>
        </g>
      ))}
      <line x1={x(book.p5 / 1e6)} x2={x(book.p5 / 1e6)} y1={24} y2={160} stroke={GRAPHIC.red} strokeWidth={2} strokeDasharray="5 4" />
      <text x={x(book.p5 / 1e6) - 4} y={36} textAnchor="end" style={{ fontSize: 12, fill: TEXT.red, fontWeight: 600 }}>
        1 in 20
      </text>
      <line x1={x(book.mean / 1e6)} x2={x(book.mean / 1e6)} y1={24} y2={160} stroke={TEXT.green} strokeWidth={2} />
      <text x={x(book.mean / 1e6) + 4} y={36} style={{ fontSize: 12, fill: TEXT.green, fontWeight: 600 }}>
        expected
      </text>
      {reveal && (
        <g>
          <line x1={x(book.actual / 1e6)} x2={x(book.actual / 1e6)} y1={24} y2={160} stroke={GRAPHIC.orange} strokeWidth={2.5} strokeDasharray="2 3" />
          <text x={x(book.actual / 1e6) + 4} y={54} style={{ fontSize: 12, fill: TEXT.orange, fontWeight: 600 }}>
            what happened
          </text>
        </g>
      )}
      <text className="ax ax-e" x={620} y={192}>
        $ million
      </text>
    </svg>
  );
}

const BUSINESS_NAME: Record<DeskBusiness, string> = {
  utility: 'Fenwick Gas & Light',
  wind: 'the Hollin Ridge wind farm',
  farm: 'the Marlow corn farm',
};

export default function Lesson() {
  const cap = useWeatherCapstone();
  const region = cap.region;
  const desk = cap.desk;
  const s = useScenario('desk-view', viewDefaults(region));
  const v = s.state;
  const dv = useDeferredValue(v);
  const m = marketOf(v);
  const day = novemberFirst(v.winter) + v.offset;
  const rows = useMemo(() => blotter(region, v, desk.threshold), [region, v, desk.threshold]);
  const solved = vanishSolved(region, v);

  // Figure 2.
  const dKnobs = useMemo(() => knobsOf(region, dv.ensoF), [region, dv.ensoF]);
  const dDesk = useDeferredValue(desk);
  const business = cap.business.kind;
  const book = useMemo(
    () => bookOutcome(dv.winter, deskBook(dDesk), business, cap.business.scale, marketOf(dv), dKnobs),
    [dv, dDesk, business, cap.business.scale, dKnobs],
  );
  const solved2 = useMemo(() => hedgeSolved(region, dv, dDesk, business, cap.business.scale), [region, dv, dDesk, business, cap.business.scale]);
  // For the second challenge's message: the reader's own minimum-variance hedge, and our expected index for the season when the strips were sold.
  const yourMinVar = useMemo(() => minVarianceStrips(dKnobs, cap.business.scale), [dKnobs, cap.business.scale]);
  const yourFair = useMemo(() => expectedIndex(SEASON_STRIP, dv.winter, novemberFirst(dv.winter) - 1, { knobs: dKnobs }), [dv.winter, dKnobs]);
  const n = useMemo(() => proseNumbers(), []);
  const r20 = (id: string) => n.rows20.find((r) => r.id === id)!;
  const setDesk = (patch: Partial<DeskSettings>) => updateCapstone('desk', patch);
  const toggleMonth = (mo: number, on: boolean) => setDesk({ months: on ? [...desk.months.filter((x) => x !== mo), mo].sort((a, b) => ((a + 2) % 12) - ((b + 2) % 12)) : desk.months.filter((x) => x !== mo) });
  const trades = book.trades;
  const tradeLine = trades.length
    ? trades
        .map((t) =>
          t.side === 0
            ? `${DESK_LABEL[t.id]}: no trade on ${dateLabel(t.day)}`
            : `${t.side > 0 ? 'buy' : 'sell'} ${desk.size} ${DESK_LABEL[t.id]} at ${fmt(t.price)} on ${dateLabel(t.day)} (we expected ${fmt(t.fair)})`,
        )
        .join('; ')
    : 'no months traded';
  const minVar = Math.round(n.slope / CME_TICK);
  const fenwick = isFenwick(region);

  return (
    <LessonPage id="weather/6.4">
      <CapstoneStrip parts={['region', 'business', 'desk']} />
      <P>
        The capstone so far has built a region (<a href={lessonHref('weather/6.1')}>Lesson 6.1</a>), a forecaster for it (
        <a href={lessonHref('weather/6.2')}>Lesson 6.2</a>) and a business whose cash moves with its winters (<a href={lessonHref('weather/6.3')}>Lesson 6.3</a>). This
        lesson opens the trading desk. On any day, the market quotes contracts on the region’s heating degree days; our forecaster has its own view of where they
        will settle. The desk’s job is to decide what to hedge and what to trade — and, as <a href={lessonHref('weather/5.3')}>Lesson 5.3</a> insisted, to be able to
        name the physical reason for every position it takes.
      </P>
      <P>
        Four contracts sit on the desk’s <K tone={WX.money}>blotter</K>, its table of what the market quotes and what we make of each quote: the November–March
        seasonal strip and the December, January and February monthly futures, all at $20 a degree day, as in{' '}
        <a href={lessonHref('weather/5.1')}>Lesson 5.1</a>. A future is linear, so its fair value is simply the expected index (
        <a href={lessonHref('weather/5.2')}>Lesson 5.2</a>), and ours comes from the calibrated forecaster of Lesson 6.2: the days already settled, the forecast
        issued that day for the next fortnight, and the climate tilted by the Pacific beyond it. The quotes come from the course’s simulated market, which knows the
        climate and its trend but trades on forecasts two days old, ignores ENSO, and charges a <K tone={WX.money}>spread</K> of 5 points either side of its mid.
        None of it is real money or investment advice.
      </P>
      <P>
        In the next demonstration, the chart splits each contract’s gap — our expected index minus the market’s mid — into the part that comes from our reading of
        the Pacific, in violet, and the part from the market’s older forecasts, in blue; the gray band is the spread, which any trade has to cross. The table
        prices the gaps per contract. Choose the winter and the date, and change the physics and the market next to them:
      </P>

      <Figure name="Weather Trading Desk" scenario={s}>
        <GapChart rows={rows} halfSpread={m.halfSpread} />
        <Legend
          items={[
            { label: 'From the Pacific (ENSO)', color: ENSO_COLOR },
            { label: 'From the market’s stale forecasts', color: LAG_COLOR },
            { label: 'Whole gap', color: '#333' },
            { label: 'Spread', color: '#e9e7e1' },
          ]}
        />
        <DataTable
          caption="The blotter: each contract's bid and ask, our expected index, the gap after the spread in dollars per contract, and the desk's side at its threshold"
          rows={rows}
          rowKey={(r) => r.id}
          rowClass={(r) => (r.status === 'settled' ? 'dim' : r.side ? 'hl' : '')}
          columns={[
            { label: 'Contract', cell: (r) => DESK_LABEL[r.id] },
            { label: 'Bid–ask', cell: (r) => (r.status === 'settled' ? '—' : `${fmt(r.bid)}–${fmt(r.ask)}`), align: 'right' },
            { label: 'Ours', cell: (r) => (r.status === 'settled' ? fmt(r.settled) : fmt(r.fair)), align: 'right' },
            { label: 'After spread', cell: (r) => (r.status === 'settled' || r.edge <= 0 ? '—' : usd(r.edge * CME_TICK)), align: 'right' },
            { label: 'Desk', cell: (r) => (r.side > 0 ? 'buy' : r.side < 0 ? 'sell' : '—') },
          ]}
        />
        <Readouts items={[{ label: `Niño-3.4 on ${dateLabel(day)}, year ${dayInfo(day).year}`, value: `${signed(ninoAt(day), 1)} °C`, tone: WX.temperature }]} />
        <Slider label="Winter" value={v.winter} min={WINTER_MIN} max={WINTER_MAX} onChange={(x) => s.set({ winter: x })} display={`year ${v.winter}–${v.winter + 1}`} />
        <Slider label="Date" value={v.offset} min={OFFSET_MIN} max={OFFSET_MAX} onChange={(x) => s.set({ offset: x })} display={dateLabel(day)} />
        <Slider
          label="Pacific’s pull on the winter"
          tone={WX.temperature}
          value={v.ensoF}
          min={0}
          max={3}
          step={0.1}
          onChange={(x) => s.set({ ensoF: Math.round(x * 10) / 10 })}
          display={`${fmt(v.ensoF, 1)} °F per °C`}
        />
        <Slider label="Market’s forecasts are" tone={WX.probability} value={v.lag} min={0} max={5} onChange={(x) => s.set({ lag: x })} display={v.lag === 0 ? 'fresh' : `${v.lag} day${v.lag > 1 ? 's' : ''} stale`} />
        <Checkbox label="The market prices ENSO" checked={v.usesEnso} onChange={(x) => s.set({ usesEnso: x })} />
        <Caption>
          {fenwick
            ? 'Region: Fenwick Bay, as the course built it.'
            : `Region: your own from Lesson 6.1, at ${fmt(region.latitude, 1)}° north. The prose quotes Fenwick Bay’s numbers.`}{' '}
          The desk trades when a gap beats the spread by its threshold of {fmt(desk.threshold)} points, set in the next demonstration.
        </Caption>
      </Figure>

      <P>
        It opens on November 20 of year {DESK_WINTER}, with the region left as Fenwick Bay’s. Niño-3.4 stands at {signed(n.nino20, 1)} °C, a strong La Niña, and as{' '}
        <a href={lessonHref('weather/2.4')}>Lesson 2.4</a> showed, La Niña tilts the city’s winters cold. Every contract is cheap. We expect the strip to settle at{' '}
        {fmt(r20('strip').fair)} degree days against a mid of {fmt(r20('strip').mid)}, a gap of {fmt(r20('strip').gap)} points: {fmt(r20('strip').ensoPart)} from the
        Pacific and {fmt(r20('strip').lagPart)} from the market’s two-day-old forecasts of the next fortnight. After the spread that is {usd(r20('strip').edge * CME_TICK)}{' '}
        a contract. December is {fmt(r20('dec').gap)} points cheap, January {fmt(r20('jan').gap)} and February {fmt(r20('feb').gap)}, worth{' '}
        {usd(r20('dec').edge * CME_TICK)}, {usd(r20('jan').edge * CME_TICK)} and {usd(r20('feb').edge * CME_TICK)} a contract. The strip’s gap is the largest
        simply because it is the longest: the Pacific tilts every one of its 151 days.
      </P>
      <P>
        Move the date and watch the two sources trade places. Sixty days before November, on September 2, the strip’s gap is {fmt(n.sep2.gap)} points and all of it
        is the Pacific: no forecast reaches that far, and the market prices the climate. From mid-October the forecasts of{' '}
        <a href={lessonHref('weather/3.5')}>Lesson 3.5</a> reach into the season and blue bars appear wherever the market’s view of the coming fortnight is older than
        ours. They come and go, and change sign from day to day as the forecasts are revised; the violet ones are larger and steadier, and last until the months
        settle.
      </P>

      <Challenge
        id="a"
        question={`Go back to November 20 of year ${DESK_WINTER}. Leave the market blind to ENSO, and change the physics and the market’s forecasts until no contract on the blotter is worth crossing the spread.`}
        solved={solved}
        status={
          v.winter !== DESK_WINTER || v.offset !== DESK_OFFSET
            ? `Set the winter to year ${DESK_WINTER}–${DESK_WINTER + 1} and the date to November 20.`
            : v.usesEnso
              ? 'That tells the market about the Pacific. Leave it blind, and change the world instead.'
              : `${rows.filter((r) => r.status !== 'settled' && r.edge > 0).length} of the contracts still beat the spread.`
        }
        success="Solved. With no pull from the Pacific, ENSO carries no news about the winter, so a market that ignores it misses nothing; with fresh forecasts, it knows what we know about the next fortnight. Each source was physical or informational, and each could be switched off. A desk whose edge survives neither change has no edge."
      />

      <H2>The book</H2>
      <P>
        A desk doesn’t trade contracts in isolation; it runs a <K tone={WX.money}>book</K> — every position it holds, together with the business it serves, judged
        as one result. <a href={lessonHref('weather/5.5')}>Lesson 5.5</a> worked out the hedge: in Fenwick Bay, Fenwick Gas &amp; Light at × 1 earns about{' '}
        {usd(n.slope)} for each heating degree day of its winter, so selling the strip at $20 a point offsets it at about {fmt(minVar)} strips. A position that size would be arranged mostly as an over-the-counter swap on the same index, while the monthly trades stay within the
        market’s depth of <a href={lessonHref('weather/5.4')}>Lesson 5.4</a>.
      </P>
      <P>
        In the next demonstration, set the desk: how many strips to sell on October 31 at the market’s bid, which months to trade, how many days before each month
        to decide, the threshold a gap must beat, and the size of each trade. These settings are saved and replayed over every winter in the next lesson. The chart
        shows the winter’s result for {BUSINESS_NAME[business]} from <a href={lessonHref('weather/6.3')}>Lesson 6.3</a>, plus the hedge and the trades, measured
        against the business’s <b>average year</b> in the archive — the yardstick of Lesson 6.1, not the plan of Lesson 6.3. It is drawn as simulated paths seen
        from the day the last position went on: every position is priced with what was known on its own day, and the paths carry everything still unknown. That
        view knows more than the October 31 hedge did — with the desk deciding {fmt(DESK_DEFAULTS.lead)} days ahead, it is {dateLabel(n.book0.viewDay)}, with
        November settled — so treat the hedge it favors as a judgment on this one winter; the next lesson tests a fixed hedge on every winter:
      </P>

      <Figure name="Weather Trading Desk · the book" onReset={() => confirmResetPart('desk')}>
        <BookChart book={book} reveal={v.reveal} />
        <Legend
          items={[
            { label: 'Simulated winters, the whole book', color: tint(GRAPHIC.green, 0.6) },
            { label: 'The business alone', color: '#8a8a8a', kind: 'line', dashed: true },
            { label: 'Expected result', color: TEXT.green, kind: 'line' },
            { label: '1-in-20 result', color: GRAPHIC.red, kind: 'line', dashed: true },
            ...(v.reveal ? [{ label: 'What happened', color: GRAPHIC.orange, kind: 'line' as const, dashed: true }] : []),
          ]}
        />
        <Readouts
          items={[
            { label: 'seen from', value: dateLabel(book.viewDay) },
            { label: 'expected result', value: mShort(book.mean), tone: WX.money },
            { label: 'spread of results', value: mShort(book.sd, 2), tone: WX.money },
            { label: '1-in-20 result', value: mShort(book.p5), tone: book.p5 < 0 ? 'red' : WX.money },
          ]}
        />
        <Caption>
          Strips sold at {fmt(book.hedgePrice)} on October 31. Desk: {tradeLine}.
        </Caption>
        <Slider
          label="Strips sold to hedge"
          tone={WX.index}
          value={desk.hedgeStrips}
          min={0}
          max={DESK_RANGE.strips.max}
          step={STRIP_STEP}
          onChange={(x) => setDesk({ hedgeStrips: x })}
          display={fmt(desk.hedgeStrips)}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '2px 0 6px' }} role="group" aria-label="Months the desk trades">
          {[11, 0, 1].map((mo) => (
            <Checkbox key={mo} label={`Trade ${MONTH_NAMES[mo]}`} checked={desk.months.includes(mo)} onChange={(on) => toggleMonth(mo, on)} />
          ))}
        </div>
        <Slider label="Decide, days before each month" value={desk.lead} min={0} max={DESK_RANGE.lead.max} step={DESK_RANGE.lead.step} onChange={(x) => setDesk({ lead: x })} display={`${fmt(desk.lead)} days`} />
        <Slider label="Threshold beyond the spread" value={desk.threshold} min={0} max={DESK_RANGE.threshold.max} step={DESK_RANGE.threshold.step} onChange={(x) => setDesk({ threshold: x })} display={`${fmt(desk.threshold)} points`} />
        <Slider label="Contracts per trade" tone={WX.money} value={desk.size} min={0} max={DESK_RANGE.size.max} step={DESK_RANGE.size.step} onChange={(x) => setDesk({ size: x })} display={fmt(desk.size)} />
        <Slider label="Winter" value={v.winter} min={WINTER_MIN} max={WINTER_MAX} onChange={(x) => s.set({ winter: x })} display={`year ${v.winter}–${v.winter + 1}`} />
        <Slider
          label="Pacific’s pull on the winter"
          tone={WX.temperature}
          value={v.ensoF}
          min={0}
          max={3}
          step={0.1}
          onChange={(x) => s.set({ ensoF: Math.round(x * 10) / 10 })}
          display={`${fmt(v.ensoF, 1)} °F per °C`}
        />
        <Checkbox label="The market prices ENSO" checked={v.usesEnso} onChange={(x) => s.set({ usesEnso: x })} />
        <Checkbox label="Show how the winter turned out" checked={v.reveal} onChange={(x) => s.set({ reveal: x })} />
      </Figure>

      <P>
        With no hedge, the starting desk buys {DESK_DEFAULTS.size} contracts of each month, every one of them cheap for the Pacific’s reason: December at{' '}
        {fmt(n.book0.trades[0].price)} when we expected {fmt(n.book0.trades[0].fair)}, January at {fmt(n.book0.trades[1].price)} against{' '}
        {fmt(n.book0.trades[1].fair)}, February at {fmt(n.book0.trades[2].price)} against {fmt(n.book0.trades[2].fair)}. The book is seen from{' '}
        {dateLabel(n.book0.viewDay)}, when February’s trade goes on. A La Niña winter promises the utility more gas sold than in an average year, so the expected result
        is {millions(n.book0.mean)} — but the spread is {millions(n.book0.sd)}, and one winter in 20 still comes in {millions(-n.book0.p5)} short of an average
        year. That spread is narrower than the {millions(n.archiveSd)} by which the utility’s winters vary across the archive (
        <a href={lessonHref('weather/6.1')}>Lesson 6.1</a>), because this is one winter seen from {dateLabel(n.book0.viewDay)}: the warming trend and the La Niña
        are already in the forecast, and November has settled.
      </P>
      <P>
        Now sell {fmt(2800)} strips. The spread collapses to {millions(n.book2800.sd, 2)}, and so does the expected result, to {millions(n.book2800.mean, 2)}. The
        strips were sold at the market’s bid of {fmt(n.hedgeBid)} on October 31, when our own forecast already expected the season to bring {fmt(n.fairOct31)}: a
        market blind to the Pacific bought the utility’s La Niña windfall cheaply. Let the market price ENSO and the same hedge sells at {fmt(n.ensoMarket.hedgePrice)},
        and the hedged winter is expected to come in {millions(n.ensoMarket.mean)} ahead. A hedge is only as good as the price it’s placed at, and the physics that
        made the trades worth taking also made the hedge expensive.
      </P>

      <Challenge
        id="b"
        figure="Weather Trading Desk · the book"
        question={`Predict first. For ${business === 'utility' ? `the gas utility at × ${fmt(cap.business.scale, 2)}${fenwick ? '' : ' in your region'}` : 'the gas utility'}, the minimum-variance hedge is about ${fmt(yourMinVar)} strips, but on October 31 of year ${dv.winter} the market bid ${fmt(book.hedgePrice)} for the strip when our forecast expected ${fmt(yourFair)}. With the desk still trading (any months, at least one contract a trade), will the hedge that gives the winter its best 1-in-20 result sit above ${fmt(yourMinVar)} strips, or below? Then find it, to the nearest hundred.`}
        solved={solved2}
        status={
          business !== 'utility'
            ? 'This challenge is about the gas utility; choose it as your business in Lesson 6.3.'
            : desk.size <= 0 || desk.months.length === 0
              ? 'Keep the desk trading: at least one month, and at least one contract a trade.'
              : `With ${fmt(desk.hedgeStrips)} strips, the 1-in-20 result is ${mShort(book.p5, 2)}.`
        }
        success={hedgeSuccessText(dDesk.hedgeStrips, book.p5, yourMinVar, book.hedgePrice, yourFair)}
      />

      <P>
        In Fenwick Bay’s own winter {DESK_WINTER}–{DESK_WINTER + 1} that is {fmt(n.bestN)} strips, a 1-in-20 result of {millions(n.bestBook.p5, 2)} against{' '}
        {millions(n.book0.p5)} unhedged. Tick “Show how the winter turned out”: the season settled at {fmt(n.settledSeason)} degree days, almost exactly what the
        forecast expected by December, and the unhedged book made {millions(n.book0.actual)} while the hedged one made {millions(n.bestBook.actual, 2)}. That is
        one winter, one draw from the distribution — <FigRef to="Weather Trading Desk">the blotter</FigRef> said it would probably be cold, and it was, but a
        desk is judged on every winter, not on the one it remembers.
      </P>
      <P>
        Which is the subject of the last lesson. The settings you leave here — the hedge, the months, the lead, the threshold and the size — will be replayed over
        every winter in the archive, each decision made only with what was known on its date, in <a href={lessonHref('weather/6.5')}>Lesson 6.5</a>. There we’ll
        find out whether the book holds up, and what happens to it when the physics behind its trades is taken away.
      </P>
    </LessonPage>
  );
}
