import { useDeferredValue, useMemo } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Checkbox,
  Controls,
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
  niceDomain,
  niceTicks,
  pct,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { MARKET, type MarketModel } from '../../../engines/weather/market';
import type { BookSettings } from '../../../engines/weather/portfolio';
import { scorecard, type Scorecard } from '../../../engines/weather/scorecard';
import { utilityWinters } from '../../../engines/weather/exposure';
import type { WorldKnobs } from '../../../model/weather/archive';
import {
  DESK_RANGE,
  REFERENCE_BOOK,
  REGION_DEFAULTS,
  isFenwick,
  regionKnobs,
  updateCapstone,
  useWeatherCapstone,
  type BusinessKind,
  type BusinessSettings,
  type DeskSettings,
  type RegionSettings,
} from '../shared/capstone';
import { CapstoneStrip, useReference, type StripPart } from '../shared/CapstoneStrip';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The world the book is replayed in: the reader's region (from 6.1), with this lesson's own
// overrides of the physics and the market. The overrides live only here; the stored region is
// left as the reader built it.

export interface WorldOverrides {
  /** Multiplies the region's ENSO teleconnection. */
  pull: number;
  /** Multiplies the region's day-to-day variability. */
  variability: number;
  /** How stale the market's forecasts are, days. */
  lag: number;
  /** Whether the market prices ENSO. */
  usesEnso: boolean;
  /** Half the bid–ask spread, index points. */
  halfSpread: number;
}

export const WORLD_DEFAULTS: WorldOverrides = { pull: 1, variability: 1, lag: MARKET.infoDelay, usesEnso: MARKET.usesEnso, halfSpread: MARKET.halfSpread };

export function knobsFor(region: RegionSettings, w: WorldOverrides): WorldKnobs {
  return { ...regionKnobs(region), ensoF: region.ensoF * w.pull, variability: region.variability * w.variability };
}

export function marketFor(w: WorldOverrides): MarketModel {
  return { ...MARKET, infoDelay: w.lag, usesEnso: w.usesEnso, halfSpread: w.halfSpread };
}

export function bookOf(business: BusinessSettings, desk: DeskSettings): BookSettings {
  return { business: business.kind, scale: business.scale, hedgeStrips: desk.hedgeStrips, months: desk.months, lead: desk.lead, threshold: desk.threshold, size: desk.size };
}

const cache = new Map<string, Scorecard>();

/** The book's scorecard in a world, cached for the session. */
export function bookScore(region: RegionSettings, business: BusinessSettings, desk: DeskSettings, w: WorldOverrides): Scorecard {
  const book = bookOf(business, desk);
  const key = JSON.stringify([region, book, w]);
  let s = cache.get(key);
  if (!s) {
    s = scorecard(book, knobsFor(region, w), marketFor(w));
    if (cache.size > 200) cache.clear();
    cache.set(key, s);
  }
  return s;
}

/** The share of the misses' variance the hedge must still remove in the first challenge. */
export const HEDGE_FLOOR = 0.9;

const deskOpen = (d: DeskSettings) => d.size > 0 && d.months.length > 0;

/** Whether the world's overrides change only what the market knows (whether it prices ENSO, how stale its forecasts are), and change it. */
export function marketOnlyChanged(w: WorldOverrides): boolean {
  const same = (k: keyof WorldOverrides) => w[k] === WORLD_DEFAULTS[k];
  return same('pull') && same('variability') && same('halfSpread') && (w.usesEnso !== WORLD_DEFAULTS.usesEnso || w.lag !== WORLD_DEFAULTS.lag);
}

/**
 * The first challenge: with the Pacific's pull left alone, change only what the market knows until
 * the desk, still open, finds nothing to trade — while the hedge still removes at least 90% of the
 * misses' variance. (Pricing ENSO isn't enough: the market's two-day lag still leaks the previous
 * month's ENSO outlook, so its forecasts have to be fresh, or nearly, as well.)
 */
export function marketCatchesUpSolved(region: RegionSettings, business: BusinessSettings, desk: DeskSettings, w: WorldOverrides): boolean {
  if (!marketOnlyChanged(w) || !deskOpen(desk) || desk.hedgeStrips <= 0) return false;
  const s = bookScore(region, business, desk, w);
  return s.trades === 0 && s.effectiveness >= HEDGE_FLOOR;
}

/** The world with no pull from the Pacific, as the second demonstration's table builds it. */
export const NO_PULL: WorldOverrides = { ...WORLD_DEFAULTS, pull: 0 };

/**
 * The second challenge, on the trading desk: in the world with no pull from the Pacific, where the
 * desk deciding 60 days ahead finds nothing, choose when it decides so that it makes money again.
 * Only the forecasts' freshness is left, so it has to decide within their reach of the month.
 */
export function noPullEdgeSolved(region: RegionSettings, business: BusinessSettings, desk: DeskSettings): boolean {
  if (!deskOpen(desk)) return false;
  const s = bookScore(region, business, desk, NO_PULL);
  return s.trades > 0 && s.tradingTotal > 0;
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes: Fenwick Bay's own climate, and a reference book.

export const REF_DESK: DeskSettings = REFERENCE_BOOK;
export const REF_BUSINESS: BusinessSettings = { kind: 'utility', scale: 1 };

function refScore(desk: Partial<DeskSettings> = {}, w: Partial<WorldOverrides> = {}): Scorecard {
  return bookScore(REGION_DEFAULTS, REF_BUSINESS, { ...REF_DESK, ...desk }, { ...WORLD_DEFAULTS, ...w });
}

/** The standard deviation of the utility's winter margin around its average, winters 1–40: the risk Lesson 6.1 quotes, $. */
export function archiveMarginSd(knobs: WorldKnobs): number {
  const m = utilityWinters(knobs).map((w) => w.margin);
  const mean = m.reduce((a, b) => a + b, 0) / m.length;
  return Math.sqrt(m.reduce((a, b) => a + (b - mean) ** 2, 0) / m.length);
}

/** A share of variance the hedge removes, or "adds risk" when selling strips makes the business's results more variable. */
export function removesText(effectiveness: number): string {
  return effectiveness < 0 ? 'adds risk' : pct(effectiveness);
}

/** How stale the market's forecasts are, in words. */
export function staleText(lag: number): string {
  return lag === 0 ? 'fresh' : `${fmt(lag)} ${lag === 1 ? 'day' : 'days'} stale`;
}

// ---------------------------------------------------------------------------
// Formatting.

/** "$12.5 million", "−$3.9 million". */
function millions(x: number, digits = 1): string {
  return `${x < 0 ? '−' : ''}$${fmt(Math.abs(x) / 1e6, digits)} million`;
}

function shortMoney(v: number): string {
  if (v === 0) return '$0';
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${fmt(a / 1e6, a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `$${fmt(a / 1e3)}k` : `$${fmt(a)}`;
  return (v < 0 ? '−' : '') + s;
}

const MONTH_LABEL: Record<number, string> = { 11: 'December', 0: 'January', 1: 'February' };

const BUSINESS_LABEL: Record<BusinessKind, string> = { utility: 'Fenwick Gas & Light', wind: 'the Hollin Ridge wind farm', farm: 'the Marlow corn farm' };

// ---------------------------------------------------------------------------
// The book's chart: each winter against its plan, and the trading desk's running total.

const X0 = 64;
const X1 = 616;

function BookChart({ sc, label }: { sc: Scorecard; label: string }) {
  const n = sc.winters.length;
  const x = scale(0, n, X0, X1);
  const vals = sc.winters.flatMap((w) => [w.miss, w.total]);
  const [lo, hi] = niceDomain(Math.min(0, ...vals), Math.max(1, ...vals), 4);
  const y = scale(lo, hi, 184, 28);
  const cum: number[] = [];
  let run = 0;
  for (const w of sc.winters) cum.push((run += w.trading));
  const [clo, chi] = niceDomain(Math.min(0, ...cum), Math.max(1, ...cum), 2);
  const yc = scale(clo, chi, 276, 218);
  const bw = (X1 - X0) / n;
  return (
    <svg className="chart" viewBox="0 0 640 306" role="img" aria-label={label}>
      <text className="ax" x={X0} y={14}>
        Each winter against its October plan
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={X0} x1={X1} format={shortMoney} baseline={0} />
      {sc.winters.map((w, i) => {
        const cx = x(i + 0.5);
        const top = (v: number) => Math.min(y(v), y(0));
        const h = (v: number) => Math.abs(y(v) - y(0));
        return (
          <g key={w.winter}>
            <rect x={cx - bw * 0.38} y={top(w.miss)} width={bw * 0.76} height={Math.max(0.5, h(w.miss))} fill="#d9d6cf" />
            <rect x={cx - bw * 0.16} y={top(w.total)} width={bw * 0.32} height={Math.max(0.5, h(w.total))} fill={w.total >= 0 ? GRAPHIC.green : GRAPHIC.red} />
          </g>
        );
      })}
      <text className="ax" x={X0} y={208}>
        Trading desk, running total
      </text>
      <GridY y={yc} ticks={niceTicks(clo, chi, 2)} x0={X0} x1={X1} format={shortMoney} baseline={0} />
      <path d={linePath([x(0), ...cum.map((_, i) => x(i + 1))], [yc(0), ...cum.map(yc)])} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} strokeLinejoin="round" />
      {sc.winters.map((w, i) =>
        w.trades > 0 ? <circle key={w.winter} cx={x(i + 1)} cy={yc(cum[i])} r={2.5} fill={w.trading >= 0 ? GRAPHIC.green : GRAPHIC.red} /> : null,
      )}
      {sc.winters.map((w, i) =>
        w.winter % 5 === 0 ? (
          <text key={w.winter} className="ax ax-m" x={x(i + 0.5)} y={296}>
            {w.winter === 5 ? 'winter 5' : w.winter}
          </text>
        ) : null,
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The comparison across worlds.

interface WorldRow {
  key: string;
  label: string;
  w: WorldOverrides;
}

export const WORLDS: WorldRow[] = [
  { key: 'built', label: 'As built', w: WORLD_DEFAULTS },
  { key: 'noPull', label: 'No pull from the Pacific', w: { ...WORLD_DEFAULTS, pull: 0 } },
  { key: 'mktEnso', label: 'The market prices ENSO', w: { ...WORLD_DEFAULTS, usesEnso: true } },
  { key: 'fresh', label: 'The market’s forecasts are fresh', w: { ...WORLD_DEFAULTS, lag: 0 } },
  { key: 'wild', label: 'Twice the day-to-day variability', w: { ...WORLD_DEFAULTS, variability: 2 } },
  { key: 'wide', label: 'Three times the spread', w: { ...WORLD_DEFAULTS, halfSpread: 3 * WORLD_DEFAULTS.halfSpread } },
];

const STRIP_PARTS: StripPart[] = ['region', 'business', 'desk'];
const REFERENCE = { desk: REFERENCE_BOOK };

export default function Lesson() {
  const cap = useWeatherCapstone();
  const { region, business, desk } = cap;
  const wsc = useScenario('world', WORLD_DEFAULTS);
  const w = wsc.state;
  const refBook = useReference(STRIP_PARTS, REFERENCE);

  const dRegion = useDeferredValue(region);
  const dBusiness = useDeferredValue(business);
  const dDesk = useDeferredValue(desk);
  const dW = useDeferredValue(w);
  const sc = useMemo(() => bookScore(dRegion, dBusiness, dDesk, dW), [dRegion, dBusiness, dDesk, dW]);
  const solved = useMemo(() => marketCatchesUpSolved(dRegion, dBusiness, dDesk, dW), [dRegion, dBusiness, dDesk, dW]);
  const table = useMemo(() => WORLDS.map((row) => ({ ...row, sc: bookScore(dRegion, dBusiness, dDesk, row.w) })), [dRegion, dBusiness, dDesk]);
  const noPull = table.find((r) => r.key === 'noPull')!.sc;
  const solved2 = useMemo(() => noPullEdgeSolved(dRegion, dBusiness, dDesk), [dRegion, dBusiness, dDesk]);
  // For the challenges' messages: pricing ENSO alone, and the no-pull world ten days out.
  const ensoOnly = useMemo(() => (solved ? bookScore(dRegion, dBusiness, dDesk, { ...WORLD_DEFAULTS, usesEnso: true }) : null), [solved, dRegion, dBusiness, dDesk]);
  const at10 = useMemo(() => (solved2 && dDesk.lead < 10 ? bookScore(dRegion, dBusiness, { ...dDesk, lead: 10 }, NO_PULL) : null), [solved2, dRegion, dBusiness, dDesk]);

  // Numbers the prose quotes, in Fenwick Bay's own climate with the reference book.
  const q = useMemo(() => {
    const unhedged = refScore({ hedgeStrips: 0 });
    const ref = refScore();
    return {
      unhedged,
      ref,
      noPull: refScore({}, { pull: 0 }),
      mktEnso: refScore({}, { usesEnso: true }),
      close: refScore({ lead: 5 }),
      closeNoPull: refScore({ lead: 5 }, { pull: 0 }),
      closeNothing: refScore({ lead: 5 }, { pull: 0, lag: 0 }),
      wild: refScore({}, { variability: 2 }),
      wide: refScore({}, { halfSpread: 15 }),
      big: refScore({ size: 100 }),
      archiveSd: archiveMarginSd(regionKnobs(REGION_DEFAULTS)),
    };
  }, []);

  const setDesk = (patch: Partial<DeskSettings>) => updateCapstone('desk', patch);
  const toggleMonth = (m: number, on: boolean) => {
    const months = on ? [...desk.months.filter((x) => x !== m), m] : desk.months.filter((x) => x !== m);
    setDesk({ months: [11, 0, 1, 2, 10].filter((x) => months.includes(x)) });
  };
  const ensoF = region.ensoF * w.pull;
  const regionLine = isFenwick(region)
    ? 'Fenwick Bay’s own climate'
    : `your region from Lesson 6.1: ${fmt(region.latitude)}° north, continentality ${fmt(region.continentality, 2)}, ${fmt(region.elevation)} m`;
  const monthsText = desk.months.length ? desk.months.map((m) => MONTH_LABEL[m] ?? `month ${m + 1}`).join(', ') : 'no months';
  const open = desk.size > 0 && desk.months.length > 0;

  const chartLabel = `${BUSINESS_LABEL[business.kind]} replayed over winters 2–40 in ${regionLine}, selling ${fmt(desk.hedgeStrips)} seasonal strips and trading ${fmt(desk.size)} contracts in ${monthsText}, ${fmt(desk.lead)} days ahead. Unhedged, the misses against plan have a standard deviation of ${millions(sc.missSd)} and the worst is ${millions(sc.worstMiss)}; the whole book's is ${millions(sc.totalSd)}, worst ${millions(sc.worstTotal)}. The desk made ${fmt(sc.trades)} trades for ${usd(sc.tradingTotal)}.`;

  const physicsTouched = w.pull !== WORLD_DEFAULTS.pull || w.variability !== WORLD_DEFAULTS.variability || w.halfSpread !== WORLD_DEFAULTS.halfSpread;
  const status1 = !open || desk.hedgeStrips <= 0
    ? 'Keep the desk open (some contracts, some months) and some strips sold: the point is that the desk finds nothing, not that it is closed.'
    : physicsTouched
      ? 'Put the Pacific’s pull, the variability and the half-spread back as they were (Reset does it): change only what the market knows.'
      : !marketOnlyChanged(w)
        ? 'Change what the market knows: whether it prices ENSO, and how stale its forecasts are.'
        : sc.trades > 0
          ? `The desk still finds ${fmt(sc.trades)} trades. ${
              w.usesEnso ? `The market prices the Pacific now, but its forecasts are ${staleText(w.lag)}.` : `The market’s forecasts are ${staleText(w.lag)}, but it is still blind to the Pacific.`
            }`
          : `The desk is idle, but the hedge removes only ${removesText(sc.effectiveness)} — is the business still the gas utility, with enough strips?`;

  const status2 = !open
    ? 'Open the desk: at least one month, and at least one contract a trade.'
    : noPull.trades === 0
      ? `Deciding ${fmt(desk.lead)} days ahead, the desk finds nothing to trade in that world.`
      : `Deciding ${fmt(desk.lead)} days ahead, it makes ${fmt(noPull.trades)} trades in that world, but ${noPull.tradingTotal < 0 ? 'loses' : 'makes'} ${usd(Math.abs(noPull.tradingTotal))}.`;

  const refButton = refBook.same ? (
    refBook.undo ? <Button onClick={refBook.undo}>Undo the reference book</Button> : null
  ) : (
    <Button onClick={refBook.apply}>Load the reference book</Button>
  );

  return (
    <LessonPage id="weather/6.5">
      <CapstoneStrip parts={STRIP_PARTS} reference={REFERENCE} button="Load the reference book" />
      <P>
        Everything is in place. <a href={lessonHref('weather/6.1')}>Lesson 6.1</a> built a region and its climate; <a href={lessonHref('weather/6.2')}>6.2</a>{' '}
        forecast it, and found the calibrated forecaster worth trusting; <a href={lessonHref('weather/6.3')}>6.3</a> turned the forecasts into a business’s
        exposure; and <a href={lessonHref('weather/6.4')}>6.4</a> set up a trading desk to price and choose contracts against the market. One question is left, the
        one every strategy has to answer before anyone trusts it: what would the whole book have done, winter after winter — and how much of that came from the
        physics, and how much from luck?
      </P>
      <P>
        The answer comes from a replay, built the way <a href={lessonHref('weather/5.5')}>Lesson 5.5</a> insisted on. This site ships no real archived forecasts.
        The course’s archive is simulated: forecasts its model issued on known dates, kept in the order they were issued, each built only from what had been revealed
        by then. Every decision in the replay — the hedge sold each October 31, each trade on the monthly futures — uses only the calibrated model’s forecast and
        the prices of its own date, from the simulated market of <a href={lessonHref('weather/5.3')}>Lesson 5.3</a>. Nothing here is real money or investment
        advice. And the book is judged as 5.5 judged the utility: each winter against its <b>October plan</b>, the margin the winter would bring at the market’s
        expected index on October 31. It is built like the plan of <a href={lessonHref('weather/6.3')}>Lesson 6.3</a> — the climate and its warming trend, blind
        to the Pacific — but made on October 31, when the market’s forecast already reaches into November’s first fortnight.
      </P>
      <P>
        In the next demonstration, each gray bar is one winter’s miss against plan for the business alone, and the narrow bar inside it is the whole book’s: the
        business, the <K tone={WX.index}>hedge</K> and the trading desk together. The lower chart is the desk’s running <K tone={WX.money}>profit</K>. The first
        controls are your book; they change the desk you set up in Lesson 6.4. The rest change the physics and the market, but only in this lesson — your region is
        left as you built it. Replay the book:
      </P>

      <Figure name="Weather Portfolio Challenge" scenario={wsc} actions={refButton}>
        <Segmented
          label="Business"
          value={business.kind}
          onChange={(v) => updateCapstone('business', { kind: v })}
          options={[
            { value: 'utility', label: 'Gas utility' },
            { value: 'wind', label: 'Wind farm' },
            { value: 'farm', label: 'Corn farm' },
          ]}
        />
        <BookChart sc={sc} label={chartLabel} />
        <Legend
          items={[
            { label: 'Business alone', color: '#d9d6cf' },
            { label: 'Whole book', color: GRAPHIC.green },
            { label: 'Desk’s running total', color: GRAPHIC.green, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'business alone (sd)', value: millions(sc.missSd) },
            { label: 'hedge removes', value: removesText(sc.effectiveness), tone: sc.effectiveness < 0 ? 'red' : WX.index },
            { label: 'book’s worst winter', value: millions(sc.worstTotal), tone: sc.worstTotal < 0 ? 'red' : WX.money },
            { label: `desk, ${fmt(sc.trades)} trades`, value: usd(sc.tradingTotal), tone: sc.tradingTotal < 0 ? 'red' : WX.money },
          ]}
        />
        <Controls columns={2}>
          <Slider label="Seasonal strips sold" tone={WX.index} value={desk.hedgeStrips} min={0} max={DESK_RANGE.strips.max} step={DESK_RANGE.strips.step} onChange={(v) => setDesk({ hedgeStrips: v })} display={fmt(desk.hedgeStrips)} />
          <Slider label="Decide, days before each month" value={desk.lead} min={0} max={DESK_RANGE.lead.max} step={DESK_RANGE.lead.step} onChange={(v) => setDesk({ lead: v })} display={`${fmt(desk.lead)} days`} />
          <Slider label="Threshold beyond the spread" value={desk.threshold} min={0} max={DESK_RANGE.threshold.max} step={DESK_RANGE.threshold.step} onChange={(v) => setDesk({ threshold: v })} display={`${fmt(desk.threshold)} points`} />
          <Slider label="Contracts per trade" tone={WX.money} value={desk.size} min={0} max={DESK_RANGE.size.max} step={DESK_RANGE.size.step} onChange={(v) => setDesk({ size: v })} display={fmt(desk.size)} />
          <Slider
            label="Pacific’s pull on the winter"
            tone={WX.temperature}
            value={w.pull}
            min={0}
            max={2}
            step={0.1}
            onChange={(v) => wsc.set({ pull: v })}
            display={`${fmt(ensoF, 1)} °F per °C`}
          />
          <Slider label="Day-to-day variability" tone={WX.temperature} value={w.variability} min={0.5} max={2} step={0.1} onChange={(v) => wsc.set({ variability: v })} display={`× ${fmt(w.variability, 1)}`} />
          <Slider label="Market’s forecasts are" tone={WX.probability} value={w.lag} min={0} max={5} step={1} onChange={(v) => wsc.set({ lag: v })} display={staleText(w.lag)} />
          <Slider label="Market’s half-spread" tone={WX.money} value={w.halfSpread} min={0} max={20} step={1} onChange={(v) => wsc.set({ halfSpread: v })} display={`${fmt(w.halfSpread)} points`} />
        </Controls>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 16px', margin: '4px 0 2px' }}>
          <div role="group" aria-labelledby="ws-trade-months" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 16px' }}>
            <span id="ws-trade-months" className="ctl-l">
              Trade
            </span>
            {[11, 0, 1].map((m) => (
              <Checkbox key={m} label={MONTH_LABEL[m]} checked={desk.months.includes(m)} onChange={(v) => toggleMonth(m, v)} />
            ))}
          </div>
          <Checkbox label="The market prices ENSO" checked={w.usesEnso} onChange={(v) => wsc.set({ usesEnso: v })} />
        </div>
        <Caption>
          Replayed in {regionLine}; {sc.trades ? `the desk’s ${fmt(sc.trades)} trades averaged ${usd(sc.tradingMean)}.` : 'the desk found nothing worth trading.'}
        </Caption>
      </Figure>

      <P>
        Take Fenwick Bay’s own climate and the reference book, which the demonstration’s “Load the reference book” button sets up: Fenwick Gas &amp; Light at its full size, selling{' '}
        {fmt(REF_DESK.hedgeStrips)} strips, and a desk trading {fmt(REF_DESK.size)} contracts in December, January and February, decided {fmt(REF_DESK.lead)}{' '}
        days ahead. Unhedged, Fenwick Gas &amp; Light misses its October plan with a standard deviation of {millions(q.unhedged.missSd)} a winter — a little less
        than the {millions(q.archiveSd)} by which its winters vary around their average in <a href={lessonHref('weather/6.1')}>Lesson 6.1</a>, because the plan
        already follows the warming trend and the market’s forecast of November’s first fortnight — and its worst winter falls {millions(-q.unhedged.worstMiss)}{' '}
        short. The strips — about the utility’s dollars per degree day from <a href={lessonHref('weather/4.5')}>Lesson 4.5</a> divided by the strip’s $20 — remove{' '}
        {pct(q.ref.effectiveness, 1)} of that variance, and the worst winter of the whole book misses by {millions(-q.ref.worstTotal)}. What the hedge can’t reach
        is the wind of Lesson 4.5, which moves the utility’s gas sales without moving a degree day.
      </P>
      <P>
        The desk, meanwhile, made {fmt(q.ref.trades)} trades over 39 winters and {usd(q.ref.tradingTotal)} in all, about {usd(q.ref.tradingMean)} a trade. Next to
        the hedge it is small: the hedge changes how much the book can lose in a bad winter by millions, while the desk adds about {usd(q.ref.tradingTotal / 39)} in an
        average winter. Even at a hundred contracts a trade it made {millions(q.big.tradingTotal)} over 39 winters. A hedge is a transfer of risk that almost always
        works; a trading edge is a small tilt in the odds that shows up only over many winters, as <a href={lessonHref('weather/5.3')}>Lesson 5.3</a> found.
      </P>

      <H2>Break it</H2>
      <P>
        Every part of that result has a physical source, and the controls let you take each one away. Sixty days out no forecast reaches the month, so the
        desk’s only information beyond the climate is the Pacific: the ENSO tilt of <a href={lessonHref('weather/2.4')}>Lesson 2.4</a>, which the simulated market
        ignores. There are two ways to take that edge away: remove the physics, the Pacific’s pull on the winter, or remove the market’s ignorance of it.
      </P>

      <Challenge
        id="a"
        figure="Weather Portfolio Challenge"
        question="Predict first: is telling the market about the Pacific enough? Leave the Pacific’s pull where it is, keep the desk open and the strips sold, and change only what the market knows — whether it prices ENSO, and how stale its forecasts are — until the desk finds nothing at all to trade, while the hedge still removes at least 90% of the misses’ variance."
        solved={solved}
        status={status1}
        success={`Solved: the market ${w.usesEnso ? 'prices the Pacific' : 'still ignores the Pacific'} and its forecasts are ${staleText(w.lag)}, and the desk, still open, finds nothing: there is nothing left for it to know that the market doesn’t.${
          ensoOnly && ensoOnly.trades > 0 ? ` Pricing ENSO alone would have left ${fmt(ensoOnly.trades)} trades: a market even two days behind still lags our view.` : ''
        } The hedge still removes ${removesText(sc.effectiveness)} of the misses’ variance. The edge came from information the market left out; the hedge comes from the link between degree days and gas, which no market can take away.`}
      />

      <P>
        Telling the market about the Pacific isn’t enough on its own. At Fenwick Bay, with the reference book, {fmt(q.mktEnso.trades)} trades remain,{' '}
        {q.mktEnso.tradingTotal < 0 ? 'losing' : 'making'} {usd(Math.abs(q.mktEnso.tradingTotal))} between them. They come from the market’s two-day lag: on the
        dates the desk decides December and January, that lag reaches back into the previous month, so the market still prices the previous month’s ENSO outlook.
        Make its forecasts fresh as well and they vanish. The physical route works too: set the Pacific’s pull to zero and the desk makes {fmt(q.noPull.trades)}{' '}
        trades. The hedge doesn’t care: it removes {pct(q.noPull.effectiveness, 1)} of the variance with no pull and {pct(q.mktEnso.effectiveness, 1)} when the
        market prices ENSO. Notice, too, that when the market prices ENSO the utility’s unhedged misses shrink, to {millions(q.mktEnso.missSd)}: its October plan,
        set at the market’s price, already contains the Pacific’s tilt. A market that knows more lets everyone plan better.
      </P>
      <P>
        With the Pacific’s pull and the market’s two-day lag restored, widen the spread to 15 points and the costs eat most of what the desk made:{' '}
        {fmt(q.wide.trades)} trades for {usd(q.wide.tradingTotal)}. Double the variability and the risk the hedge exists for grows, but doesn’t double: misses of{' '}
        {millions(q.wild.missSd)} a winter, {fmt(q.wild.missSd / q.ref.missSd, 2)} times as much, because — as <a href={lessonHref('weather/6.1')}>Lesson 6.1</a>{' '}
        found — the Pacific’s part of a winter’s spread doesn’t stretch with the days. The strips remove {pct(q.wild.effectiveness, 1)} of it.
      </P>

      <H2>What survives</H2>
      <P>
        In the next demonstration your book is replayed in six worlds at once: as you built it, and with one piece of physics or one piece of the market changed
        at a time. Each row starts again from your region and your desk, whatever the controls in <FigRef to="Weather Portfolio Challenge">the first
        demonstration</FigRef> say. Move the decision date and watch the rows:
      </P>

      <Figure name="Weather Portfolio Challenge · what survives">
        <DataTable
          caption="The book replayed in six worlds: the spread of the business's misses unhedged, the share the hedge removes, the trading desk's trades and profit, and the whole book's worst winter"
          rows={table}
          rowKey={(r) => r.key}
          rowClass={(r) => (r.key === 'built' ? 'hl' : '')}
          columns={[
            { label: 'World', cell: (r) => r.label },
            { label: 'Misses (sd)', cell: (r) => shortMoney(r.sc.missSd), align: 'right' },
            { label: 'Hedge removes', cell: (r) => removesText(r.sc.effectiveness), align: 'right' },
            { label: 'Trades', cell: (r) => fmt(r.sc.trades), align: 'right' },
            { label: 'Desk P&L', cell: (r) => shortMoney(r.sc.tradingTotal), align: 'right' },
            { label: 'Worst winter', cell: (r) => shortMoney(r.sc.worstTotal), align: 'right' },
          ]}
        />
        <Slider label="Decide, days before each month" value={desk.lead} min={0} max={DESK_RANGE.lead.max} step={DESK_RANGE.lead.step} onChange={(v) => setDesk({ lead: v })} display={`${fmt(desk.lead)} days`} />
        <Caption>
          {BUSINESS_LABEL[business.kind]}, {fmt(desk.hedgeStrips)} strips, {fmt(desk.size)} contracts a trade in {monthsText}, in {regionLine}.
        </Caption>
      </Figure>

      <Challenge
        id="b"
        question={`Predict first: in the world with no pull from the Pacific, a desk deciding ${fmt(REF_DESK.lead)} days ahead finds nothing to trade. Should it decide earlier or later to find an edge again — and how close to the month? Set the decision date so that, in that world, the desk makes money again.`}
        solved={solved2}
        status={status2}
        success={`Solved: deciding ${fmt(dDesk.lead)} days ahead, the desk makes ${fmt(noPull.trades)} trades and ${usd(noPull.tradingTotal)} with no pull from the Pacific. With the Pacific gone, its only edge is the freshness of its forecasts against the market’s two-day-old ones, and that edge exists only where the forecast reaches into the month${
          at10 ? `; ten days out it ${at10.trades ? `makes ${fmt(at10.trades)} trades and ${at10.tradingTotal < 0 ? 'loses' : 'makes'} ${usd(Math.abs(at10.tradingTotal))}` : 'finds nothing'}` : ''
        }. Make the market’s forecasts fresh too and this edge is gone as well.`}
      />

      <P>
        In Fenwick Bay, with the reference book, deciding 5 days before each month brings the forecasts of <a href={lessonHref('weather/3.5')}>Lesson 3.5</a> into
        the month, and a second edge joins the first: {fmt(q.close.trades)} trades for {usd(q.close.tradingTotal)} in the world as built. With no pull from the
        Pacific, {fmt(q.closeNoPull.trades)} trades and {usd(q.closeNoPull.tradingTotal)} remain, all of it the freshness of the forecasts; make the market’s
        forecasts fresh too and the desk makes {fmt(q.closeNothing.trades)}.
      </P>
      <P>
        Read the columns separately. With strips sold, the hedge column barely moves from row to row: the strips work because a gas utility’s sales follow the
        degree days at its station (<a href={lessonHref('weather/4.1')}>Lesson 4.1</a>), and no change to the market or to the Pacific breaks that link. The trading
        columns move a great deal. They are only as large as the information the market leaves out, and they vanish in exactly the worlds where it stops leaving it
        out. Switch the business to the wind farm or the corn farm and the hedge column turns against you: a winter degree-day strip doesn’t follow their weather,
        so selling it adds risk instead of removing it. They need indices of their own, the kind written in <a href={lessonHref('weather/5.1')}>Lesson 5.1</a>.
      </P>

      <H2>From sunlight to a tested book</H2>
      <P>
        The course began with sunlight arriving at a spinning planet, more of it at the equator than at the poles (<a href={lessonHref('weather/1.1')}>Lesson
        1.1</a>). Everything since has been the consequence. The atmosphere carries the surplus poleward in fronts and storms; its motion is chaotic, so the weather
        can be forecast in detail for about two weeks, and the slow ocean adds a tilt that can be seen months ahead. Forecasts that say honestly how uncertain they
        are can be turned into degree days, energy prices, harvests and cash; contracts on station indices let the businesses exposed to that weather hand the risk
        to others; and a market that leaves some of the physics out of its prices leaves an edge for whoever puts it back in.
      </P>
      <P>
        That is the capability this course set out to build: to make probabilistic weather forecasts, translate them into economic expectations, and test, on a
        replay that never lets a forecast see the outcome it predicts, whether those expectations create a valuable hedge or a trading opportunity. And to know why.
        Every number in <FigRef to="Weather Portfolio Challenge">the first demonstration</FigRef> can be traced to a piece of physics you can point to, change and
        watch disappear — which is the only kind of edge, or hedge, worth trusting.
      </P>
    </LessonPage>
  );
}
