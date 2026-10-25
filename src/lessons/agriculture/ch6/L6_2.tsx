import { useMemo } from 'react';
import {
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
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
  useAnimationFrame,
  usd,
  useScenario,
  usePlay,
} from '../../../framework';
import { CEDAR_DESIGN, ELEVATOR_OF, HARVEST_DAY, NEW_SEASONS, cornAcreFactor, cornSpec, farmClimatology, farmForecast, type FarmDesign } from '../../../engines/agriculture/capstone';
import { CHECKPOINTS, FINAL_REPORT, cashBid, decFutures, expectedHarvestBasis, marketView } from '../../../engines/agriculture/market';
import { fieldSeason } from '../../../engines/agriculture/farm';
import { CORN_STAGES } from '../../../engines/agriculture/crop';
import { normalYear, simulatedYear } from '../../../model/agriculture/climate';
import { dateLabel, dayOf } from '../../../model/agriculture/region';
import { DayChart } from '../shared/DayChart';
import { inch } from '../shared/format';
import { MARKET_LINE } from '../shared/tones';
import { sameFarm, useCapstone } from '../shared/capstone';
import { SoFar } from '../shared/SoFar';

const START = dayOf(5, 1);
const END = FINAL_REPORT;
const Z80 = 1.2816;

/** The farm's yield forecast on each day of a season, for drawing. */
function forecastPath(d: FarmDesign, year: number): Array<{ day: number; mean: number; sd: number }> {
  const out: Array<{ day: number; mean: number; sd: number }> = [];
  for (let t = START; t <= END; t += 2) out.push({ day: t, ...farmForecast(d, year, t) });
  return out;
}

/** Challenge 1: the season whose August 1 forecast missed the farm's harvest by the most. */
export function worstAugustMiss(d: FarmDesign): number {
  let worst = NEW_SEASONS[0];
  let miss = -1;
  for (const y of NEW_SEASONS) {
    const m = Math.abs(fieldSeason(y, cornSpec(d)).yield - farmForecast(d, y, dayOf(8, 1)).mean);
    if (m > miss) {
      miss = m;
      worst = y;
    }
  }
  return worst;
}

export interface Calibration {
  day: number;
  /** Seasons whose harvest fell inside the forecast's 80% band, and the typical miss, bushels an acre. */
  inside: number;
  mae: number;
  points: Array<{ year: number; mean: number; sd: number; actual: number }>;
}

export function calibration(d: FarmDesign): Calibration[] {
  return CHECKPOINTS.map((day) => {
    const points = NEW_SEASONS.map((year) => ({ year, ...farmForecast(d, year, day), actual: fieldSeason(year, cornSpec(d)).yield }));
    return {
      day,
      points,
      inside: points.filter((p) => Math.abs(p.actual - p.mean) <= Z80 * p.sd).length,
      mae: points.reduce((a, p) => a + Math.abs(p.actual - p.mean), 0) / points.length,
    };
  });
}

const forwardCache = new Map<string, number>();
/** The price a sale ahead on `day` fetches: December futures that day plus the harvest basis expected then, at the farm's elevator, $ a bushel. */
export function forwardPrice(d: FarmDesign, year: number, day: number): number {
  const hub = ELEVATOR_OF[d.district];
  const k = `${hub}|${year}|${day}`;
  let v = forwardCache.get(k);
  if (v === undefined) {
    v = decFutures(year, day) + expectedHarvestBasis(year, day, marketView(year, day), hub);
    forwardCache.set(k, v);
  }
  return v;
}

export interface Sale {
  /** Bushels sold ahead and their price; bushels harvested and the harvest bid; the bushels short, and what buying them back cost beyond the sale price, $. */
  sold: number;
  price: number;
  harvest: number;
  harvestPrice: number;
  short: number;
  cost: number;
}

/**
 * Selling `share` of the forecast crop ahead on `day`. At harvest the farm delivers what it grew,
 * and buys any shortfall back at the elevator's harvest bid.
 */
export function saleAhead(d: FarmDesign, year: number, share: number, day: number): Sale {
  const factor = cornAcreFactor(d);
  const sold = share * farmForecast(d, year, day).mean * factor;
  const harvest = fieldSeason(year, cornSpec(d)).yield * factor;
  const price = forwardPrice(d, year, day);
  const harvestPrice = cashBid(year, ELEVATOR_OF[d.district], HARVEST_DAY);
  const short = Math.max(0, sold - harvest);
  return { sold, price, harvest, harvestPrice, short, cost: short * (harvestPrice - price) };
}

/** A rule — sell `share` of the forecast on `day` — run over the forty new seasons: how often the farm came up short, and its costliest shortfall. */
export function saleRecord(d: FarmDesign, share: number, day: number): { short: number; worstCost: number; worstYear: number } {
  let short = 0;
  let worstCost = 0;
  let worstYear = 0;
  for (const y of NEW_SEASONS) {
    const s = saleAhead(d, y, share, day);
    if (s.short > 0) {
      short++;
      if (s.cost > worstCost) {
        worstCost = s.cost;
        worstYear = y;
      }
    }
  }
  return { short, worstCost, worstYear };
}

/** Shares of the forecast the farm can sell ahead, in tenths. */
export const SHARES = Array.from({ length: 11 }, (_, i) => i / 10);
/** One season in ten: what an honest 80% band leaves below its low end, four of the forty. */
export const SHORT_LIMIT = 4;

/** Challenge 2: the largest share of the forecast, in tenths, sold ahead on `day` that came up short in no more than four of the forty seasons. */
export function largestSafeShare(d: FarmDesign, day: number): number {
  let best = 0;
  for (const x of SHARES) if (saleRecord(d, x, day).short <= SHORT_LIMIT) best = x;
  return best;
}

/** Where the 80% band's low end sat on `day`, as a share of the forecast (none below zero), averaged over the forty seasons. */
export function lowEndShare(d: FarmDesign, day: number): number {
  return NEW_SEASONS.reduce((a, y) => {
    const f = farmForecast(d, y, day);
    return a + (f.mean > 0 ? Math.max(0, f.mean - Z80 * f.sd) / f.mean : 0);
  }, 0) / NEW_SEASONS.length;
}

/** The figure’s starting share of the forecast sold ahead: no design’s answer on any checkpoint (they run from 20% to 90%), so the challenge starts unsolved. */
export const START_SHARE = 0.3;

function Player({ playing, day, onDay, onEnd }: { playing: boolean; day: number; onDay: (d: number) => void; onEnd: () => void }) {
  useAnimationFrame((dt) => {
    const next = Math.min(END, day + dt * 24);
    onDay(Math.round(next * 10) / 10);
    if (next >= END) onEnd();
  }, playing);
  return null;
}

const CHECK_LABEL: Record<number, string> = Object.fromEntries(CHECKPOINTS.map((c) => [c, dateLabel(c)]));

/** The choices that shape the farm's corn and its forecasts (the bins don't). */
const CROP_KEYS = ['district', 'acres', 'cornAcres', 'irrigated', 'hybrid'] as const;
export type Shown = 'yours' | 'cedar';

/** The design a figure shows: the reader's farm, or Cedar Bend's when the reader asks for it and the two differ. */
export function shownDesign(farm: FarmDesign, which: Shown): FarmDesign {
  return which === 'cedar' ? CEDAR_DESIGN : farm;
}

/** How much the 80% band narrows from June 1 to September 1, averaged over the forty seasons: September's width over June's. */
export function bandNarrowing(d: FarmDesign): number {
  const w = (day: number) => NEW_SEASONS.reduce((a, y) => a + farmForecast(d, y, day).sd, 0);
  return w(dayOf(9, 1)) / w(dayOf(6, 1));
}

function DesignSwitch({ value, onChange }: { value: Shown; onChange: (v: Shown) => void }) {
  return (
    <Segmented
      label="Farm"
      value={value}
      onChange={onChange}
      options={[
        { value: 'yours', label: 'Yours' },
        { value: 'cedar', label: 'Cedar Bend’s' },
      ]}
    />
  );
}

function CalibrationChart({ c, clim, share, short }: { c: Calibration; clim: number; share: number; short: number }) {
  const lo = 80;
  const hi = 260;
  const x = scale(lo, hi, 70, 620);
  const y = scale(lo, hi, 250, 24);
  const saleEnd = Math.min(hi, hi * share);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 282"
      role="img"
      aria-label={`Forecasts on ${dateLabel(c.day)} against the harvests that came, in forty seasons: ${c.inside} harvests inside the forecast’s 80% band, and ${short} below a sale ahead of ${fmt(share * 100)}% of the forecast.`}
    >
      <text className="ax" x={70} y={14}>
        Harvest, bushels an acre
      </text>
      <GridY y={y} ticks={[100, 150, 200, 250]} x0={70} x1={620} format={(v) => fmt(v)} />
      <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke="#999" strokeDasharray="4 4" />
      <line x1={x(clim)} x2={x(clim)} y1={24} y2={250} stroke="#bbb" strokeDasharray="2 3" />
      {share > 0 && share * hi > lo && (
        <>
          <line x1={x(Math.max(lo, lo / share))} y1={y(Math.max(lo, share * lo))} x2={x(saleEnd / share)} y2={y(saleEnd)} stroke={GRAPHIC.green} strokeWidth={2} />
          <text className="ax ax-e" x={x(saleEnd / share) - 4} y={y(saleEnd) + 14} style={{ fill: GRAPHIC.green }}>
            sold ahead
          </text>
        </>
      )}
      {c.points.map((p) => {
        const inside = Math.abs(p.actual - p.mean) <= Z80 * p.sd;
        const color = inside ? GRAPHIC.teal : GRAPHIC.red;
        return (
          <g key={p.year}>
            <line x1={x(Math.max(lo, p.mean - Z80 * p.sd))} x2={x(Math.min(hi, p.mean + Z80 * p.sd))} y1={y(p.actual)} y2={y(p.actual)} stroke={mix('#fcfcfb', color, 0.55)} strokeWidth={2} />
            <circle cx={x(p.mean)} cy={y(p.actual)} r={3.4} fill={color} />
          </g>
        );
      })}
      {[100, 150, 200, 250].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={266}>
          {v}
        </text>
      ))}
      <text className="ax ax-e" x={620} y={280}>
        forecast, bushels an acre
      </text>
    </svg>
  );
}

export default function Lesson() {
  const { farm } = useCapstone();
  const differs = !sameFarm(farm, CEDAR_DESIGN, CROP_KEYS);
  const s = useScenario('season', { year: 61, day: dayOf(8, 1), share: 0.8, sellOn: dayOf(7, 1), design: 'yours' as Shown });
  const d1 = differs ? shownDesign(farm, s.state.design) : farm;
  const isCedar1 = !differs || s.state.design === 'cedar';
  const play = usePlay(false);
  const year = s.state.year;
  const day = Math.round(s.state.day);
  const season = useMemo(() => fieldSeason(year, cornSpec(d1)), [year, d1]);
  const path = useMemo(() => forecastPath(d1, year), [year, d1]);
  const clim = farmClimatology(farm);
  const clim1 = farmClimatology(d1);
  const now = farmForecast(d1, year, day);
  const sale = useMemo(() => saleAhead(d1, year, s.state.share, s.state.sellOn), [d1, year, s.state.share, s.state.sellOn]);
  const soldPerAcre = s.state.share * farmForecast(d1, year, s.state.sellOn).mean;
  const weather = useMemo(() => simulatedYear(year, d1.district), [year, d1.district]);
  const normal = useMemo(() => normalYear(d1.district), [d1.district]);
  const narrowing = useMemo(() => bandNarrowing(d1), [d1]);
  let rain = 0;
  let rainN = 0;
  for (let t = START; t < day; t++) {
    rain += weather[t].rain;
    rainN += normal[t].rain;
  }
  const today = season.days.find((x) => x.day === day) ?? season.days[season.days.length - 1];
  const stage = today && today.stage >= 0 ? `${CORN_STAGES[today.stage].code}, ${CORN_STAGES[today.stage].name}` : 'not yet up';
  const shown = path.filter((p) => p.day <= day);
  const waterDays = season.days.filter((x) => x.day >= START && x.day <= day);
  const worst = useMemo(() => worstAugustMiss(d1), [d1]);
  const solved1 = year === worst && day >= FINAL_REPORT;
  const augForecast = farmForecast(d1, year, dayOf(8, 1)).mean;
  const sepForecast = farmForecast(d1, year, dayOf(9, 1)).mean;
  const augMiss = Math.abs(season.yield - augForecast);
  const saleValue = (() => {
    if (s.state.share === 0) return 'nothing';
    if (day < s.state.sellOn) return `${fmt(s.state.share * 100)}% of the forecast, not yet`;
    if (day < FINAL_REPORT) return `${fmt(sale.sold / 1000)}k bu at ${usd(sale.price, 2)}`;
    if (sale.short > 0) return `${fmt(sale.short / 1000)}k bu short, ${sale.cost >= 0 ? 'costing' : 'gaining'} ${usd(Math.abs(sale.cost))}`;
    return `covered, ${fmt((sale.harvest - sale.sold) / 1000)}k bu to spare`;
  })();

  // Season 82 for Cedar Bend's own design: all of the June 1 forecast sold ahead, or only down to the August 1 band's low end.
  const june82 = useMemo(() => saleAhead(CEDAR_DESIGN, 82, 1, dayOf(6, 1)), []);
  const aug82 = useMemo(() => {
    const f = farmForecast(CEDAR_DESIGN, 82, dayOf(8, 1));
    return saleAhead(CEDAR_DESIGN, 82, (f.mean - Z80 * f.sd) / f.mean, dayOf(8, 1));
  }, []);
  const cedarLow = useMemo(() => [dayOf(6, 1), dayOf(9, 1)].map((d) => lowEndShare(CEDAR_DESIGN, d)), []);

  const c = useScenario('calibration', { day: dayOf(8, 1), share: START_SHARE, design: 'yours' as Shown });
  const d2 = differs ? shownDesign(farm, c.state.design) : farm;
  const isCedar2 = !differs || c.state.design === 'cedar';
  const clim2 = farmClimatology(d2);
  const cal = useMemo(() => calibration(d2), [d2]);
  const sel = cal.find((k) => k.day === c.state.day) ?? cal[0];
  const record = useMemo(() => saleRecord(d2, c.state.share, c.state.day), [d2, c.state.share, c.state.day]);
  const low = useMemo(() => lowEndShare(d2, c.state.day), [d2, c.state.day]);
  const safeShare = useMemo(() => largestSafeShare(d2, c.state.day), [d2, c.state.day]);
  const solved2 = Math.abs(c.state.share - safeShare) < 1e-9 && safeShare > 0;
  const overShort = useMemo(() => (safeShare < 1 ? saleRecord(d2, safeShare + 0.1, c.state.day).short : null), [d2, safeShare, c.state.day]);
  const which = (cedar: boolean) => (cedar ? 'Cedar Bend’s design' : 'your farm');
  const outside = sel.points.filter((p) => Math.abs(p.actual - p.mean) > Z80 * p.sd);
  const below = outside.filter((p) => p.actual < p.mean).length;
  const lowNote =
    Math.abs(low - safeShare) <= 0.1 + 1e-9
      ? 'the band said about as much before any of these seasons was played.'
      : low > safeShare
        ? `more than the farm could safely sell: ${below} of the ${outside.length} harvests outside the band fell below it${below > outside.length - below ? ', so this farm’s misses lean low' : ''}.`
        : 'more cautious than these forty seasons turned out to need.';

  return (
    <LessonPage id="agriculture/6.2">
      <P>
        <a href={lessonHref('agriculture/6.1')}>The farm you designed</a> was judged on sixty seasons at once. Now it lives them one at a time. The seasons in this
        lesson are new: simulated years 61 to 100, which the market history of Chapter 5 never included, so nothing in them was used to build the forecasts or to
        choose the design. They are, in effect, the next forty years of the valley’s weather, drawn from the same climate. On May 1 the farmer knows the soil, the hybrid and the long-run odds — an average harvest of {fmt(clim.mean)} bushels an acre where corn
        follows wheat, a tenth less where it follows corn, give or take {fmt(clim.sd)} — and nothing about the summer to come.
      </P>
      <SoFar parts={['farm']} />
      <P>
        Then the season reports in, a little at a time. Rain falls or doesn’t, and the soil’s water rises and falls as in{' '}
        <a href={lessonHref('agriculture/1.4')}>Lesson 1.4</a>. On the first of June, July, August and September, the farm runs the forecast of{' '}
        <a href={lessonHref('agriculture/3.4')}>Lesson 3.4</a> on what can be seen in its district — temperature, rain, satellite NDVI and the crop’s condition —
        refitted for this farm’s own corn on two hundred other seasons. Each forecast is a most likely yield and, as in Lesson 3.4, an 80% band that should hold
        the harvest four times in five. In October the combines report the truth field by field. And at one checkpoint the farm can sell part of its crop ahead,
        a share of that day’s forecast at that day’s price; at harvest it delivers what it grew and buys any shortfall back at the elevator’s harvest bid. In the
        next demonstration the upper chart is the water in the farm’s root zone, the lower one its yield forecast with the band, and the dashed line the
        long-run average.{differs ? ' The demonstration runs your farm; its Farm switch runs Cedar Bend’s design instead.' : ''} Choose a season and the sale, and
        play the season, or drag across the charts to move through it:
      </P>

      <Figure name="Season Simulator" scenario={s} play={{ playing: play.playing, toggle: play.toggle }}>
        <Player playing={play.playing} day={s.state.day} onDay={(v) => s.set({ day: v })} onEnd={() => play.setPlaying(false)} />
        <DayChart
          days={waterDays.map((x) => x.day)}
          series={[
            { values: waterDays.map((x) => x.water * 100), color: GRAPHIC.blue, kind: 'area', opacity: 0.3 },
            { values: waterDays.map((x) => x.water * 100), color: GRAPHIC.blue, width: 2 },
          ]}
          from={START}
          to={END}
          yMin={0}
          yMax={100}
          yTicks={[0, 50, 100]}
          yLabel="Water left in the root zone, %"
          yFormat={(v) => `${v}%`}
          height={140}
          cursor={day}
          onScrub={(v) => s.set({ day: Math.max(START, Math.min(END, v)) })}
          ariaLabel={`Water in the farm’s root zone from May 1 to ${dateLabel(day)} of season ${year}.`}
        />
        <DayChart
          days={shown.map((p) => p.day)}
          series={[
            { values: shown.map((p) => p.mean + Z80 * p.sd), color: mix('#fcfcfb', GRAPHIC.teal, 0.5), width: 1.2 },
            { values: shown.map((p) => Math.max(0, p.mean - Z80 * p.sd)), color: mix('#fcfcfb', GRAPHIC.teal, 0.5), width: 1.2 },
            { values: shown.map((p) => p.mean), color: GRAPHIC.teal, width: 2.5 },
          ]}
          from={START}
          to={END}
          yMin={60}
          yMax={260}
          yTicks={[100, 150, 200, 250]}
          yLabel="Forecast corn yield, bushels an acre"
          yFormat={(v) => fmt(v)}
          height={200}
          cursor={day}
          onScrub={(v) => s.set({ day: Math.max(START, Math.min(END, v)) })}
          refLines={[
            { y: clim1.mean, label: 'long-run average', color: '#888', dash: '4 4' },
            ...(s.state.share > 0 && day >= s.state.sellOn ? [{ y: soldPerAcre, label: 'sold ahead', color: GRAPHIC.green, dash: '2 3' }] : []),
            ...(day >= END ? [{ y: season.yield, label: `harvest ${fmt(season.yield)}`, color: MARKET_LINE.cash }] : []),
          ]}
          marks={CHECKPOINTS.map((cp) => ({ day: cp, label: CHECK_LABEL[cp], color: '#bbb', dash: '2 3' }))}
          ariaLabel={`The farm’s yield forecast through season ${year}: on ${dateLabel(day)}, ${fmt(now.mean)} bushels an acre, with an 80% band from ${fmt(now.mean - Z80 * now.sd)} to ${fmt(now.mean + Z80 * now.sd)}.`}
        />
        <Legend
          items={[
            { label: 'Forecast', color: GRAPHIC.teal, kind: 'line' },
            { label: '80% band', color: mix('#fcfcfb', GRAPHIC.teal, 0.5), kind: 'line' },
            { label: 'Long-run average', color: '#888', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: `${dateLabel(day)}: the corn`, value: stage, tone: 'gold' },
            { label: 'rain since May 1', value: `${inch(rain)} (normal ${inch(rainN)})`, tone: 'blue' },
            { label: 'yield forecast', value: now.sd > 0 ? `${fmt(now.mean)} ± ${fmt(Z80 * now.sd)} bu/ac` : `${fmt(now.mean)} bu/ac, harvested`, tone: 'teal' },
            { label: `sold ahead on ${dateLabel(s.state.sellOn)}`, value: saleValue, tone: day >= FINAL_REPORT && sale.short > 0 && sale.cost > 0 ? 'red' : 'green' },
          ]}
        />
        <Slider label="Season" value={year} min={NEW_SEASONS[0]} max={NEW_SEASONS[NEW_SEASONS.length - 1]} onChange={(v) => s.set({ year: v })} display={String(year)} />
        <Slider label="Sell ahead" tone="green" value={s.state.share * 100} min={0} max={100} step={10} onChange={(v) => s.set({ share: v / 100 })} display={`${fmt(s.state.share * 100)}% of the forecast`} />
        <Segmented label="Sell on" value={String(s.state.sellOn)} onChange={(v) => s.set({ sellOn: Number(v) })} options={CHECKPOINTS.map((cp) => ({ value: String(cp), label: CHECK_LABEL[cp] }))} />
        {differs && <DesignSwitch value={s.state.design} onChange={(v) => s.set({ design: v })} />}
      </Figure>

      <P>
        Play a few seasons and watch what the farmer is up against. In June the forecast stays close to the long-run average: the corn is small and the summer
        that decides it hasn’t happened. July narrows the band a little. By August 1 the forecast knows how pollination went; by September 1 it knows most of
        the story, and for {which(isCedar1)} its band is{' '}
        {narrowing <= 0.6
          ? 'about half as wide as in June'
          : `still ${fmt(narrowing * 100)}% as wide as in June${d1.irrigated ? ': with pivots the summer’s rain no longer decides the crop, so the band starts narrow and has less to learn' : ''}`}
        . Meanwhile the price a sale ahead would fetch moves with December futures, and when the farm’s crop
        goes short the price often rises to meet it. The decisions a farmer makes in July — how much corn to sell ahead, whether to spray, whether to book trucks
        for a big harvest — are made with the July band, not the October harvest.
      </P>
      <P>
        Season 82 shows a drought arriving the way droughts do, a little at a time. For Cedar Bend’s own design, the forecast on June 1 expected 172 bushels an
        acre, a shade under average, though the spring had already been an inch and a third short of rain. After a dry, warm June it expected 161; on August 1,
        with the summer two degrees hotter than normal since June and four and a half inches short of rain since May, 150; and on September 1, with the canopy
        browning early in the satellite images, 125. The farm harvested 117. Nothing on June 1 said “drought”: the dry soil in the upper chart was the first sign,
        the forecast the second, and each month the band slid lower before the truth was known.{' '}
        {differs && !isCedar1 ? 'Switch the demonstration’s Farm to Cedar Bend’s design, set' : 'With Cedar Bend’s design, set'} the sale to all of the June 1
        forecast and play season 82 to the end. The farm promises {fmt(june82.sold / 1000)},000 bushels at {usd(june82.price, 2)}, grows {fmt(june82.harvest / 1000)},000, and has to buy the
        missing {fmt(june82.short / 1000)},000 back at harvest for {usd(june82.harvestPrice, 2)} — {usd(Math.round(june82.cost / 1000) * 1000)} more than it sold
        them for, the double blow of <a href={lessonHref('agriculture/5.5')}>Lesson 5.5</a>. A farmer who waited for the August band, and sold only down to its
        low end, would have come up {fmt(aug82.short / 1000)},000 bushels short, at a cost of {usd(Math.round(aug82.cost / 1000) * 1000)}.
      </P>

      <Challenge
        id="a"
        question="Find the season, of the forty, in which the farm’s August 1 forecast missed its harvest by the most. Play it to the end."
        solved={solved1}
        status={day < FINAL_REPORT ? `Season ${year}: play it to November 9 to see the harvest.` : `In season ${year} the August 1 forecast missed by ${fmt(augMiss)} bushels an acre.`}
        success={`Solved: for ${which(isCedar1)}, in season ${year} the August 1 forecast said ${fmt(augForecast)} bushels an acre and the farm harvested ${fmt(season.yield)}, a miss of ${fmt(augMiss)}. ${
          Math.abs(season.yield - sepForecast) <= augMiss / 2
            ? `By September 1 the forecast had moved to ${fmt(sepForecast)}: most of the miss was August’s weather, still to come when the August forecast was made.`
            : `Even on September 1 it said ${fmt(sepForecast)}: the crop turned out ${season.yield > augForecast ? 'bigger' : 'smaller'} than anything the forecast could observe — temperature, rain, the satellites, the crop’s condition — had shown.`
        } A band exists for seasons like this one.`}
      />

      <H2>What the band is for</H2>
      <P>
        <a href={lessonHref('agriculture/3.4')}>Lesson 3.4</a> judged a forecast’s band by its calibration: an 80% band should hold the harvest about four
        seasons in five, and only a count over many seasons can tell. The farm’s bands can be counted the same way on the forty new seasons, and then put to
        work. In the next demonstration each dot is one of the forty: the forecast across, the harvest up, and the bar the forecast’s 80% band; dots on the dashed
        line were forecast exactly. The green line is a sale ahead of a share of the forecast, and every dot below it is a season in which the farm sold more
        corn than it grew. Choose the checkpoint and the share:
      </P>

      <Figure name="Season Simulator · forty seasons" scenario={c}>
        <CalibrationChart c={sel} clim={clim2.mean} share={c.state.share} short={record.short} />
        <Legend
          items={[
            { label: 'Harvest inside the band', color: GRAPHIC.teal },
            { label: 'Harvest outside it', color: GRAPHIC.red },
            { label: 'Sold ahead', color: GRAPHIC.green, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'inside the 80% band', value: `${sel.inside} of ${NEW_SEASONS.length}`, tone: 'teal' },
            { label: 'the band’s low end, on average', value: `${fmt(low * 100)}% of the forecast`, tone: 'teal' },
            { label: 'seasons short', value: `${record.short} of ${NEW_SEASONS.length}`, tone: record.short > SHORT_LIMIT ? 'red' : 'green' },
            { label: 'costliest shortfall', value: record.short ? `${usd(Math.round(record.worstCost / 1000) * 1000)} (season ${record.worstYear})` : 'none', tone: 'red' },
          ]}
        />
        <Segmented label="Forecast made on" value={String(c.state.day)} onChange={(v) => c.set({ day: Number(v) })} options={CHECKPOINTS.map((cp) => ({ value: String(cp), label: CHECK_LABEL[cp] }))} />
        <Slider label="Sell ahead" tone="green" value={c.state.share * 100} min={0} max={100} step={10} onChange={(v) => c.set({ share: v / 100 })} display={`${fmt(c.state.share * 100)}% of the forecast`} />
        {differs && <DesignSwitch value={c.state.design} onChange={(v) => c.set({ design: v })} />}
      </Figure>

      <P>
        For Cedar Bend’s own design the bands held the harvest in 35, 32, 33 and 34 of the forty seasons, from June to September, and the typical miss fell
        from 21 bushels an acre in June to 10 in September. An honest 80% band would hold 32 on average, but forty seasons can’t tell 32 from 35: by chance
        alone an honest band holds anywhere from about 27 to 37 of them. What the count can say is that none of the four is far off.{' '}
        {!differs
          ? 'Your farm is Cedar Bend’s design, so these are the demonstration’s numbers.'
          : 'Your own design has its own numbers in the demonstration; its Farm switch shows Cedar Bend’s.'}
      </P>
      <P>
        A band that can be trusted is what makes a forecast useful to a business. A lender deciding how much operating credit a farm can carry, an insurer
        pricing a revenue policy, and a merchant deciding how much corn to buy forward all need to know how far wrong the forecast can be, not only what it
        expects. For a farmer selling ahead, the band’s low end matters most: an honest band leaves the harvest below it only one season in ten, so it is about
        the most of the crop the farm can promise and come up short that rarely. For Cedar Bend it sits at {fmt(cedarLow[0] * 100)}% of the forecast in June
        and {fmt(cedarLow[1] * 100)}% by September: the later the forecast, the more of the crop the farm can sell.
      </P>

      <Challenge
        id="b"
        question="Choose a checkpoint, and estimate first from the band’s low end that day. What is the largest share of that day’s forecast, to the nearest 10%, the farm could have sold ahead and come up short in no more than four of the forty seasons — one in ten?"
        solved={solved2}
        status={`Selling ${fmt(c.state.share * 100)}% of the ${dateLabel(c.state.day)} forecast ahead, the farm came up short in ${record.short} of the forty seasons.`}
        success={`Solved: on ${dateLabel(c.state.day)} ${which(isCedar2)} could sell ${fmt(safeShare * 100)}% of its forecast ahead and come up short in ${record.short} of the forty seasons${overShort === null ? '' : `; at ${fmt(safeShare * 100 + 10)}% it would have come up short in ${overShort}`}. The band’s low end that day sat at ${fmt(low * 100)}% of the forecast, on average — ${lowNote}`}
      />

      <P>
        <FigRef to="Season Simulator">The season</FigRef> showed one farm’s view of its own crop. A market cares about the whole valley’s, and pays for knowing it
        before everyone else. The next lesson turns the tables: you make the forecast, for the valley’s harvest, and the scoring is strict.
      </P>
    </LessonPage>
  );
}
