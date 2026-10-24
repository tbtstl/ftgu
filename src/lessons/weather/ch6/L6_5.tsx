import { useDeferredValue, useMemo } from 'react';
import {
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
import type { WorldKnobs } from '../../../model/weather/archive';
import {
  REGION_DEFAULTS,
  isCalder,
  regionKnobs,
  updateCapstone,
  useWeatherCapstone,
  type BusinessKind,
  type BusinessSettings,
  type DeskSettings,
  type RegionSettings,
} from '../shared/capstone';
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

function atDefaults(w: WorldOverrides): boolean {
  return (Object.keys(WORLD_DEFAULTS) as Array<keyof WorldOverrides>).every((k) => w[k] === WORLD_DEFAULTS[k]);
}

/** The first challenge: the worst winter, whole book, less than this share of the worst unhedged miss. */
export const WORST_SHARE = 0.2;

/**
 * The first challenge: in the world as built, a utility book whose worst winter misses its plan by
 * less than a fifth of what the worst winter would have missed unhedged — while the trading desk
 * still makes money.
 */
export function steadyBookSolved(region: RegionSettings, business: BusinessSettings, desk: DeskSettings, w: WorldOverrides): boolean {
  if (business.kind !== 'utility' || !atDefaults(w)) return false;
  const s = bookScore(region, business, desk, w);
  return s.trades > 0 && s.tradingTotal > 0 && s.worstMiss < 0 && s.worstTotal > WORST_SHARE * s.worstMiss;
}

/** The share of the misses' variance the hedge must still remove in the second challenge. */
export const HEDGE_FLOOR = 0.9;

/**
 * The second challenge: take away the physics or the information behind the trading edge — the
 * Pacific's pull, or the market's blindness to it — until the desk, still open, finds nothing to
 * trade, while the hedge still removes at least 90% of the misses' variance.
 */
export function physicsGoneSolved(region: RegionSettings, business: BusinessSettings, desk: DeskSettings, w: WorldOverrides): boolean {
  if (!(w.pull === 0 || w.usesEnso)) return false;
  if (desk.size <= 0 || desk.months.length === 0 || desk.hedgeStrips <= 0) return false;
  const s = bookScore(region, business, desk, w);
  return s.trades === 0 && s.effectiveness >= HEDGE_FLOOR;
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes: Calder Bay's own climate, and a reference book.

export const REF_DESK: DeskSettings = { hedgeStrips: 2800, months: [11, 0, 1], lead: 60, threshold: 5, size: 10 };
export const REF_BUSINESS: BusinessSettings = { kind: 'utility', scale: 1 };

function refScore(desk: Partial<DeskSettings> = {}, w: Partial<WorldOverrides> = {}): Scorecard {
  return bookScore(REGION_DEFAULTS, REF_BUSINESS, { ...REF_DESK, ...desk }, { ...WORLD_DEFAULTS, ...w });
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

const BUSINESS_LABEL: Record<BusinessKind, string> = { utility: 'Calder Gas & Light', wind: 'the Hollin Ridge wind farm', farm: 'the Marlow corn farm' };

// ---------------------------------------------------------------------------
// The book's chart: each winter against its plan, and the trading desk's running total.

const X0 = 64;
const X1 = 616;

function BookChart({ sc, label }: { sc: Scorecard; label: string }) {
  const n = sc.winters.length;
  const x = scale(0, n, X0, X1);
  const vals = sc.winters.flatMap((w) => [w.miss, w.total]);
  const [lo, hi] = niceDomain(Math.min(0, ...vals), Math.max(1, ...vals), 4);
  const y = scale(lo, hi, 196, 28);
  const cum: number[] = [];
  let run = 0;
  for (const w of sc.winters) cum.push((run += w.trading));
  const [clo, chi] = niceDomain(Math.min(0, ...cum), Math.max(1, ...cum), 2);
  const yc = scale(clo, chi, 306, 244);
  const bw = (X1 - X0) / n;
  return (
    <svg className="chart" viewBox="0 0 640 336" role="img" aria-label={label}>
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
      <text className="ax" x={X0} y={234}>
        Trading desk, running total
      </text>
      <GridY y={yc} ticks={niceTicks(clo, chi, 2)} x0={X0} x1={X1} format={shortMoney} baseline={0} />
      <path d={linePath([x(0), ...cum.map((_, i) => x(i + 1))], [yc(0), ...cum.map(yc)])} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} strokeLinejoin="round" />
      {sc.winters.map((w, i) =>
        w.trades > 0 ? <circle key={w.winter} cx={x(i + 1)} cy={yc(cum[i])} r={2.5} fill={w.trading >= 0 ? GRAPHIC.green : GRAPHIC.red} /> : null,
      )}
      {sc.winters.map((w, i) =>
        w.winter % 5 === 0 ? (
          <text key={w.winter} className="ax ax-m" x={x(i + 0.5)} y={326}>
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

export default function Lesson() {
  const cap = useWeatherCapstone();
  const { region, business, desk } = cap;
  const wsc = useScenario('world', WORLD_DEFAULTS);
  const w = wsc.state;

  const dRegion = useDeferredValue(region);
  const dBusiness = useDeferredValue(business);
  const dDesk = useDeferredValue(desk);
  const dW = useDeferredValue(w);
  const sc = useMemo(() => bookScore(dRegion, dBusiness, dDesk, dW), [dRegion, dBusiness, dDesk, dW]);
  const solved = useMemo(() => steadyBookSolved(dRegion, dBusiness, dDesk, dW), [dRegion, dBusiness, dDesk, dW]);
  const solved2 = useMemo(() => physicsGoneSolved(dRegion, dBusiness, dDesk, dW), [dRegion, dBusiness, dDesk, dW]);
  const table = useMemo(() => WORLDS.map((row) => ({ ...row, sc: bookScore(dRegion, dBusiness, dDesk, row.w) })), [dRegion, dBusiness, dDesk]);

  // Numbers the prose quotes, in Calder Bay's own climate with the reference book.
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
    };
  }, []);

  const setDesk = (patch: Partial<DeskSettings>) => updateCapstone('desk', patch);
  const toggleMonth = (m: number, on: boolean) => {
    const months = on ? [...desk.months.filter((x) => x !== m), m] : desk.months.filter((x) => x !== m);
    setDesk({ months: [11, 0, 1, 2, 10].filter((x) => months.includes(x)) });
  };
  const ensoF = region.ensoF * w.pull;
  const regionLine = isCalder(region)
    ? 'Calder Bay’s own climate'
    : `your region from Lesson 6.1: ${fmt(region.latitude)}° north, continentality ${fmt(region.continentality, 2)}, ${fmt(region.elevation)} m`;
  const monthsText = desk.months.length ? desk.months.map((m) => MONTH_LABEL[m] ?? `month ${m + 1}`).join(', ') : 'no months';

  const chartLabel = `${BUSINESS_LABEL[business.kind]} replayed over winters 2–40 in ${regionLine}, selling ${fmt(desk.hedgeStrips)} seasonal strips and trading ${fmt(desk.size)} contracts in ${monthsText}, ${fmt(desk.lead)} days ahead. Unhedged, the misses against plan have a standard deviation of ${millions(sc.missSd)} and the worst is ${millions(sc.worstMiss)}; the whole book's is ${millions(sc.totalSd)}, worst ${millions(sc.worstTotal)}. The desk made ${fmt(sc.trades)} trades for ${usd(sc.tradingTotal)}.`;

  const status1 =
    business.kind !== 'utility'
      ? 'Switch the business back to Calder Gas & Light: a heating-season strip hedges a gas utility, not a farm.'
      : !atDefaults(w)
        ? 'Put the physics and the market back as they were (Reset): the challenge is to build the book in the world you made.'
        : sc.trades === 0
          ? 'The desk isn’t trading. Open it, or — if your region’s winters don’t answer to the Pacific — decide closer to each month, where fresher forecasts are the edge.'
          : sc.tradingTotal <= 0
            ? `The desk made ${fmt(sc.trades)} trades but lost ${usd(-sc.tradingTotal)} in all.`
            : `The worst winter misses its plan by ${millions(-sc.worstTotal)}, ${pct(sc.worstTotal / sc.worstMiss)} of the ${millions(-sc.worstMiss)} it would have missed unhedged.`;

  return (
    <LessonPage id="weather/6.5">
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
        by then. Every decision in the replay — the hedge sold each October 31, each trade on the monthly futures — uses only the forecast and the prices of its own
        date, from the simulated market of <a href={lessonHref('weather/5.3')}>Lesson 5.3</a>. Nothing here is real money or investment advice. And the book is
        judged as 5.5 judged the utility: each winter against the plan made in October, at the market’s expected index for the winter to come.
      </P>
      <P>
        In the next demonstration, each gray bar is one winter’s miss against plan for the business alone, and the narrow bar inside it is the whole book’s: the
        business, the <K tone={WX.index}>hedge</K> and the trading desk together. The lower chart is the desk’s running <K tone={WX.money}>profit</K>. The first
        controls are your book; they change the desk you set up in Lesson 6.4. The rest change the physics and the market, but only in this lesson — your region is
        left as you built it. Replay the book:
      </P>

      <Figure name="Weather Portfolio Challenge" scenario={wsc}>
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
            { label: 'misses unhedged (sd)', value: millions(sc.missSd) },
            { label: 'hedge removes', value: pct(sc.effectiveness), tone: WX.index },
            { label: 'whole book (sd)', value: millions(sc.totalSd), tone: WX.money },
            { label: 'worst winter', value: millions(sc.worstTotal), tone: sc.worstTotal < 0 ? 'red' : WX.money },
            { label: `desk, ${fmt(sc.trades)} trades`, value: usd(sc.tradingTotal), tone: sc.tradingTotal < 0 ? 'red' : WX.money },
          ]}
        />
        <Controls columns={2}>
          <Slider label="Seasonal strips sold" tone={WX.index} value={desk.hedgeStrips} min={0} max={5000} step={100} onChange={(v) => setDesk({ hedgeStrips: v })} display={fmt(desk.hedgeStrips)} />
          <Slider label="Decide, days before each month" value={desk.lead} min={0} max={90} step={5} onChange={(v) => setDesk({ lead: v })} display={`${fmt(desk.lead)} days`} />
          <Slider label="Threshold beyond the spread" value={desk.threshold} min={0} max={40} step={1} onChange={(v) => setDesk({ threshold: v })} display={`${fmt(desk.threshold)} points`} />
          <Slider label="Contracts per trade" tone={WX.money} value={desk.size} min={0} max={100} step={5} onChange={(v) => setDesk({ size: v })} display={fmt(desk.size)} />
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
          <Slider label="Market’s forecasts are" tone={WX.probability} value={w.lag} min={0} max={5} step={1} onChange={(v) => wsc.set({ lag: v })} display={`${fmt(w.lag)} days stale`} />
          <Slider label="Market’s half-spread" tone={WX.money} value={w.halfSpread} min={0} max={20} step={1} onChange={(v) => wsc.set({ halfSpread: v })} display={`${fmt(w.halfSpread)} points`} />
        </Controls>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', margin: '4px 0 2px' }}>
          {[11, 0, 1].map((m) => (
            <Checkbox key={m} label={`Trade ${MONTH_LABEL[m]}`} checked={desk.months.includes(m)} onChange={(v) => toggleMonth(m, v)} />
          ))}
          <Checkbox label="The market prices ENSO" checked={w.usesEnso} onChange={(v) => wsc.set({ usesEnso: v })} />
        </div>
        <Caption>
          Replayed in {regionLine}. The desk trades {monthsText}, deciding {fmt(desk.lead)} days ahead; {sc.trades ? `its ${fmt(sc.trades)} trades averaged ${usd(sc.tradingMean)}.` : 'it found nothing worth trading.'}
        </Caption>
      </Figure>

      <P>
        Take Calder Bay’s own climate, a book that sells {fmt(REF_DESK.hedgeStrips)} strips, and a desk trading {fmt(REF_DESK.size)} contracts in December,
        January and February, decided {fmt(REF_DESK.lead)} days ahead. Unhedged, Calder Gas &amp; Light misses its October plan with a standard deviation of{' '}
        {millions(q.unhedged.missSd)} a winter, and its worst winter falls {millions(-q.unhedged.worstMiss)} short. The strips — about the utility’s dollars per
        degree day from <a href={lessonHref('weather/4.5')}>Lesson 4.5</a> divided by the strip’s $20 — remove {pct(q.ref.effectiveness, 1)} of that variance, and
        the worst winter of the whole book misses by {millions(-q.ref.worstTotal)}. What the hedge can’t reach is the wind of Lesson 4.5, which moves the utility’s
        gas sales without moving a degree day.
      </P>
      <P>
        The desk, meanwhile, made {fmt(q.ref.trades)} trades over 39 winters and {usd(q.ref.tradingTotal)} in all, about {usd(q.ref.tradingMean)} a trade. Next to
        the hedge it is small: the hedge changes how much the book can lose in a bad winter by millions, while the desk adds about {usd(q.ref.tradingTotal / 39)} in an
        average winter. Even at a hundred contracts a trade it made {millions(q.big.tradingTotal)} over 39 winters. A hedge is a transfer of risk that almost always works; a trading edge is a
        small tilt in the odds that shows up only over many winters, as <a href={lessonHref('weather/5.3')}>Lesson 5.3</a> found.
      </P>

      <Challenge
        id="a"
        figure="Weather Portfolio Challenge"
        question="In the world as you built it, run Calder Gas & Light with a book whose worst winter misses its plan by less than a fifth of what that winter would have missed unhedged — while the trading desk still makes money over the 39 winters."
        solved={solved}
        status={status1}
        success={`Solved. Your worst winter misses by ${millions(-sc.worstTotal)} against ${millions(-sc.worstMiss)} unhedged, and the desk made ${usd(sc.tradingTotal)} on ${fmt(sc.trades)} trades. The two parts of the book do different jobs: the strips cut the losses the weather can cause, and the desk earns a little from information the market leaves unpriced.`}
      />

      <H2>Break it</H2>
      <P>
        Every part of that result has a physical source, and the controls let you take each one away. Sixty days out no forecast reaches the month, so the
        desk’s only information beyond the climate is the Pacific: the ENSO tilt of <a href={lessonHref('weather/2.4')}>Lesson 2.4</a>, which the simulated market
        ignores. Set the Pacific’s pull to zero and, at Calder Bay, the desk makes {fmt(q.noPull.trades)} trades. Let the market price ENSO instead and{' '}
        {fmt(q.mktEnso.trades)} trades remain, losing {usd(-q.mktEnso.tradingTotal)} between them — the leftovers of rounding the information into prices, not an
        edge. The hedge doesn’t care: it removes {pct(q.noPull.effectiveness, 1)} of the variance in the first world and {pct(q.mktEnso.effectiveness, 1)} in the
        second. Notice, too, that when the market prices ENSO the utility’s unhedged misses shrink, to {millions(q.mktEnso.missSd)}: its October plan, set at the
        market’s price, already contains the Pacific’s tilt. A market that knows more lets everyone plan better.
      </P>
      <P>
        Now decide 5 days before each month instead. The forecasts of <a href={lessonHref('weather/3.5')}>Lesson 3.5</a> reach into the month, the market’s are two
        days stale, and a second edge joins the first: {fmt(q.close.trades)} trades for {usd(q.close.tradingTotal)}. With no pull from the Pacific,{' '}
        {fmt(q.closeNoPull.trades)} trades and {usd(q.closeNoPull.tradingTotal)} remain, all of it the freshness of the forecasts; make the market’s forecasts fresh
        too and the desk makes {fmt(q.closeNothing.trades)}. Widen the spread to 15 points and the costs eat most of what is left: {fmt(q.wide.trades)} trades
        for {usd(q.wide.tradingTotal)}. Double the variability and the risk the hedge exists for doubles with it — misses of {millions(q.wild.missSd)} a winter,{' '}
        {pct(q.wild.effectiveness, 1)} of them removed by the strips.
      </P>

      <Challenge
        id="b"
        figure="Weather Portfolio Challenge"
        question="Keep the desk open and the strips sold. Take away the physics or the information behind the trading edge — the Pacific’s pull, or the market’s blindness to it — until the desk finds nothing at all to trade, while the hedge still removes at least 90% of the misses’ variance."
        solved={solved2}
        status={
          !(w.pull === 0 || w.usesEnso)
            ? 'The desk’s edge is still there: start with the Pacific — its pull, or whether the market prices it.'
            : desk.size <= 0 || desk.months.length === 0 || desk.hedgeStrips <= 0
              ? 'Keep the desk open (some contracts, some months) and some strips sold: the point is that the desk finds nothing, not that it is closed.'
              : sc.trades > 0
                ? `The desk still finds ${fmt(sc.trades)} trades. ${
                    w.lag > 0 && (w.usesEnso || desk.lead <= 15)
                      ? w.usesEnso && desk.lead > 15
                        ? 'The market prices the Pacific, but from a view that is days old. Make its forecasts fresh too.'
                        : 'Within a fortnight of the month, the market’s stale forecasts are a second edge.'
                      : 'Look at what else the market still misses.'
                  }`
                : `The desk is idle, but the hedge removes only ${pct(sc.effectiveness)} — is the business still the gas utility, with enough strips?`
        }
        success={`Solved. The desk is open and finds nothing: with ${w.pull === 0 ? 'no pull from the Pacific, the market’s blindness costs it nothing' : 'the Pacific priced in, there is nothing left for the desk to know that the market doesn’t'}${w.lag === 0 ? ', and its forecasts are as fresh as ours' : ''}. The hedge still removes ${pct(sc.effectiveness)} of the misses’ variance. The edge came from physics the market left out; the hedge comes from the link between degree days and gas, which no market can take away.`}
      />

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
            { label: 'Hedge removes', cell: (r) => pct(r.sc.effectiveness), align: 'right' },
            { label: 'Trades', cell: (r) => fmt(r.sc.trades), align: 'right' },
            { label: 'Desk P&L', cell: (r) => shortMoney(r.sc.tradingTotal), align: 'right' },
            { label: 'Worst winter', cell: (r) => shortMoney(r.sc.worstTotal), align: 'right' },
          ]}
        />
        <Slider label="Decide, days before each month" value={desk.lead} min={0} max={90} step={5} onChange={(v) => setDesk({ lead: v })} display={`${fmt(desk.lead)} days`} />
        <Caption>
          {BUSINESS_LABEL[business.kind]}, {fmt(desk.hedgeStrips)} strips, {fmt(desk.size)} contracts a trade in {monthsText}, in {regionLine}.
        </Caption>
      </Figure>

      <P>
        Read the columns separately. With strips sold, the hedge column barely moves from row to row: the strips work because a gas utility’s sales follow the degree days at its
        station (<a href={lessonHref('weather/4.1')}>Lesson 4.1</a>), and no change to the market or to the Pacific breaks that link. The trading columns move a
        great deal. They are only as large as the information the market leaves out, and they vanish in exactly the worlds where it stops leaving it out. Switch
        the business to the wind farm or the corn farm and the hedge column turns against you: a winter degree-day strip doesn’t follow their weather, so selling it
        adds risk instead of removing it. They need indices of their own, the kind written in <a href={lessonHref('weather/5.1')}>Lesson 5.1</a>.
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
