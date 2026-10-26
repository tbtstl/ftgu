import { useMemo } from 'react';
import {
  Challenge,
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
  fmt,
  lessonHref,
  usd,
  useScenario,
} from '../../../framework';
import { fieldSeason } from '../../../engines/agriculture/farm';
import { BLACK_LAYER_MOISTURE, STANDARD_MOISTURE, cornDrydown, cornHarvest, cumulativeFieldLoss, sproutDamage, sproutDiscount } from '../../../engines/agriculture/harvest';
import { REFERENCE_YEAR, simulatedYear } from '../../../model/agriculture/climate';
import { DRYING_PER_POINT, PLAN_PRICE, perBushelCost } from '../../../model/agriculture/economics';
import { dateLabel, dayOf } from '../../../model/agriculture/region';
import { DayChart, type DayBand } from '../shared/DayChart';
import { buAc, perAcre, perBu } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

const WEATHER = simulatedYear(REFERENCE_YEAR, 'prairie');
const CORN = fieldSeason(REFERENCE_YEAR, { district: 'prairie', crop: 'corn' });
const WHEAT = fieldSeason(REFERENCE_YEAR, { district: 'prairie', crop: 'wheat' });
export const MATURE = CORN.maturityDay;
const RIPE = WHEAT.maturityDay;
const LAST_START = dayOf(11, 30);
const CORN_ACRES = 1000;
const WHEAT_ACRES = 600;
export const MOISTURE = cornDrydown(WEATHER, MATURE);
const LOSS = cumulativeFieldLoss(WEATHER, MATURE);
const SPROUT = sproutDamage(WEATHER, RIPE, 31);

interface CornState {
  start: number;
  perDay: number;
  drying: number;
  price: number;
}

export function harvest(st: CornState) {
  return cornHarvest(WEATHER, MATURE, CORN.yield, CORN_ACRES, st.start, st.perDay, st.price, st.drying);
}

/** The best net value per acre over every start date, for these settings. */
export function bestStart(st: Omit<CornState, 'start'>): { day: number; value: number } {
  let best = { day: MATURE, value: -Infinity };
  for (let d = MATURE; d <= LAST_START; d++) {
    const v = harvest({ ...st, start: d }).valuePerAcre;
    if (v > best.value) best = { day: d, value: v };
  }
  return best;
}

/** The start dates whose net value comes within `tol` dollars an acre of the best, for these settings (a single run of days). */
export function nearBest(st: Omit<CornState, 'start'>, tol = 1): { from: number; to: number } {
  const best = bestStart(st);
  let from = best.day;
  let to = best.day;
  while (from > MATURE && harvest({ ...st, start: from - 1 }).valuePerAcre >= best.value - tol) from--;
  while (to < LAST_START && harvest({ ...st, start: to + 1 }).valuePerAcre >= best.value - tol) to++;
  return { from, to };
}

export const BASE = { perDay: 100, drying: DRYING_PER_POINT, price: PLAN_PRICE.corn };
/** The challenge's drying cost, $ per point per bushel: double the starting 3.5¢. */
export const DEAR_DRYING = 0.07;
const CHALLENGE = { ...BASE, drying: DEAR_DRYING };
let challengeBest: { day: number; value: number } | null = null;

/** Whether the figure is at the challenge's settings: drying at 7¢, the starting combine and corn price. */
export function atChallenge(st: CornState): boolean {
  return st.perDay === CHALLENGE.perDay && Math.abs(st.drying - CHALLENGE.drying) < 1e-9 && Math.abs(st.price - CHALLENGE.price) < 1e-9;
}

/** The challenge: with drying at 7¢ a point, a start date within $1 an acre of the best. */
export function harvestSolved(st: CornState): boolean {
  if (!atChallenge(st)) return false;
  challengeBest = challengeBest ?? bestStart(CHALLENGE);
  return harvest(st).valuePerAcre >= challengeBest.value - 1;
}

/** Value of an acre of wheat harvested `delay` days after it ripens, after the sprout discount, $. */
export function wheatValue(delay: number, price = PLAN_PRICE.wheat): { sprouted: number; discount: number; value: number } {
  const sprouted = SPROUT[Math.max(0, Math.min(SPROUT.length - 1, delay))];
  const discount = sproutDiscount(sprouted, price);
  return { sprouted, discount, value: WHEAT.yield * (price - perBushelCost('wheat') - discount) };
}

export default function Lesson() {
  const s = useScenario('corn-harvest', { start: MATURE, perDay: 100, drying: DRYING_PER_POINT, price: PLAN_PRICE.corn });
  const st = s.state;
  const run = useMemo(() => harvest(st), [st]);
  const solved = useMemo(() => harvestSolved(st), [st]);
  const base = useMemo(() => ({ best: bestStart(BASE), near: nearBest(BASE) }), []);
  const dear = useMemo(() => ({ best: bestStart(CHALLENGE), near: nearBest(CHALLENGE) }), []);
  const sweet = useMemo(
    () => ({
      cheap: bestStart({ ...BASE, drying: 0.02 }).day,
      bigCombine: bestStart({ ...BASE, perDay: 160 }).day,
      dearCorn: bestStart({ ...BASE, price: 7 }).day,
      cheapCorn: bestStart({ ...BASE, price: 3 }).day,
    }),
    [],
  );
  const days = MOISTURE.map((_, i) => MATURE + i);
  const harvested: DayBand[] = run.days.map((d) => ({ from: d.day, to: d.day + 1, color: 'rgba(201, 154, 30, .28)' }));

  const w = useScenario('wheat-harvest', { delay: 0 });
  const wv = wheatValue(w.state.delay);
  const wheatDays = Array.from({ length: 36 }, (_, i) => RIPE - 4 + i);
  const lateSeptember = useMemo(() => harvest({ ...BASE, start: dayOf(9, 30) }).valuePerAcre, []);
  const wheatRain = wheatDays.filter((d) => d >= RIPE).map((d) => WEATHER[d].rain);
  const wheatRainDays = wheatRain.filter((r) => r >= 0.01).length;
  const wheatRainMax = Math.max(...wheatRain);

  return (
    <LessonPage id="agriculture/2.4">
      <P>
        <a href={lessonHref('agriculture/2.3')}>The previous lesson</a> fought for the crop through the summer. By mid-September Cedar Bend’s corn has won or lost
        that fight, and on September 16 in the reference season it reaches black layer: as <a href={lessonHref('agriculture/1.2')}>Lesson 1.2</a> showed, the
        kernels now hold all the dry matter they ever will, about 188 bushels an acre. But they are still about a third water — {BLACK_LAYER_MOISTURE}% moisture in
        our model — and a bushel of corn is bought and sold at a standard moisture, {STANDARD_MOISTURE}% here. Wetter grain spoils in storage, so it has to be dried
        first — on the farm, or by a buyer who charges for it.
      </P>
      <P>
        So the farmer faces a trade. Harvest early, and every bushel goes through a dryer that burns propane: in our model it costs{' '}
        {fmt(DRYING_PER_POINT * 100, 1)} cents a bushel for each point of <K tone="blue">moisture</K> removed, so corn at 26% costs nearly 39 cents a bushel to dry. (A farmer without a dryer can deliver wet corn to the elevator, which
        charges a drying fee and deducts a “shrink” for the weight of the water driven off, usually at a higher cost than drying on the farm.)
        Wait, and the crop dries for free in the field — quickly in warm September air, a point a day or more, then more slowly as autumn cools, toward an
        equilibrium set by how dry the air is. But standing corn doesn’t wait patiently. Stalks weaken after a month or so, ears drop, storms knock plants over,
        and these <K tone="red">field losses</K> mount faster the longer the crop stands. The combine adds a little loss of its own, more when the grain is very wet or
        very dry.
      </P>
      <P>
        In the next demonstration, Cedar Bend harvests its 1,000 acres of corn at a fixed number of acres a day, on every day without rain, starting on a date you
        choose. The upper chart is the kernels’ moisture after black layer, and the lower one the share of the standing crop lost in the field; the shaded days are
        the ones the combine runs:
      </P>

      <Figure name="Harvest Timing Lab" scenario={s}>
        <DayChart
          days={days}
          series={[{ values: MOISTURE, color: GRAPHIC.blue, width: 2.5 }]}
          from={MATURE}
          to={dayOf(12, 15)}
          yMin={12}
          yMax={34}
          yTicks={[15, 20, 25, 30]}
          yLabel="Kernel moisture, %"
          yFormat={(v) => `${v}%`}
          bands={harvested}
          refLines={[{ y: STANDARD_MOISTURE, label: 'standard 15%', color: GRAPHIC.blue }]}
          height={170}
          ariaLabel={`Corn kernel moisture after black layer on ${dateLabel(MATURE)}: ${fmt(MOISTURE[0])}% at first, ${fmt(MOISTURE[dayOf(10, 15) - MATURE], 1)}% by October 15. The harvest runs from ${dateLabel(st.start)} to ${run.finished >= 0 ? dateLabel(run.finished) : 'the end of the year'}, at ${fmt(run.meanMoisture, 1)}% moisture on average.`}
        />
        <DayChart
          days={days}
          series={[{ values: LOSS.map((x) => x * 100), color: GRAPHIC.red, width: 2.5 }]}
          from={MATURE}
          to={dayOf(12, 15)}
          yMin={0}
          yMax={10}
          yTicks={[0, 2, 4, 6, 8, 10]}
          yLabel="Crop lost in the field, %"
          yFormat={(v) => `${v}%`}
          bands={harvested}
          height={150}
          ariaLabel={`Share of the standing corn lost in the field since black layer: ${fmt(LOSS[dayOf(11, 1) - MATURE] * 100, 1)}% by November 1, ${fmt(LOSS[dayOf(12, 1) - MATURE] * 100, 1)}% by December 1.`}
        />
        <Legend
          items={[
            { label: 'Kernel moisture', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Lost in the field', color: GRAPHIC.red, kind: 'line' },
            { label: 'Days harvested', color: 'rgba(201, 154, 30, .5)' },
          ]}
        />
        <Readouts
          items={[
            { label: 'harvest finished', value: run.finished >= 0 ? dateLabel(run.finished) : '—' },
            { label: 'average moisture', value: `${fmt(run.meanMoisture, 1)}%`, tone: 'blue' },
            { label: 'drying cost per acre', value: usd(run.dryingPerAcre), tone: 'red' },
            { label: 'crop lost', value: `${fmt(run.lossShare * 100, 1)}%`, tone: 'red' },
            { label: 'net value per acre', value: usd(run.valuePerAcre), tone: 'green' },
          ]}
        />
        <Slider label="Start harvest" tone="gold" value={st.start} min={MATURE} max={LAST_START} onChange={(v) => s.set({ start: v })} display={dateLabel(st.start)} />
        <Slider label="Combine capacity" value={st.perDay} min={60} max={160} step={10} onChange={(v) => s.set({ perDay: v })} display={`${st.perDay} acres a day`} />
        <Slider label="Drying cost" tone="red" value={st.drying} min={0.02} max={0.08} step={0.005} onChange={(v) => s.set({ drying: Math.round(v * 1000) / 1000 })} display={`${fmt(st.drying * 100, 1)}¢ per point per bushel`} />
        <Slider label="Corn price" tone="green" value={st.price} min={3} max={7} step={0.1} onChange={(v) => s.set({ price: Math.round(v * 10) / 10 })} display={perBu(st.price)} />
      </Figure>

      <P>
        Harvesting from the first day, Cedar Bend takes the crop out at an average of 26.2% moisture and spends $72 an acre drying it; the net value is $775 an acre.
        Two weeks of waiting changes everything. By September 30 the kernels are down to 21.5%, and losses so far are about half a percent; starting then, the
        acre nets {usd(lateSeptember)}. Through October the drying slows as the weather cools — the kernels are at {fmt(MOISTURE[dayOf(10, 15) - MATURE], 1)}% in
        mid-October and {fmt(MOISTURE[dayOf(10, 31) - MATURE], 1)}% at the end of the month — while the loss curve begins to bend upward. By November the field is losing
        more each week than the drying saves: start on November 25 and the crop comes in at 16.3% with only $8 an acre of drying, but 7.3% of it is gone, and the
        acre is worth $794. The best start, {dateLabel(base.best.day)}, nets {usd(base.best.value)} — but every start from {dateLabel(base.near.from)} to{' '}
        {dateLabel(base.near.to)} comes within a dollar of it. Around the peak, each day of waiting saves about as much drying as it loses in the field, and that
        flatness is why farmers don’t agonize over the exact day.
      </P>

      <Challenge
        id="a"
        question="Suppose propane prices double, and drying costs 7¢ a point instead of 3.5¢. Predict first: should Cedar Bend start earlier or later than mid-October? Then set drying to 7¢ and find a start date within $1 an acre of the new best, with the combine at 100 acres a day and corn at $4.60."
        solved={solved}
        status={
          !atChallenge(st)
            ? 'Set drying to 7¢, with the combine at 100 acres a day and corn at $4.60.'
            : `Starting ${dateLabel(st.start)}, the crop nets ${usd(run.valuePerAcre)} an acre.`
        }
        success={`Solved: starting ${dateLabel(st.start)} nets ${usd(run.valuePerAcre, 2)} an acre. At 7¢ the best start is ${dateLabel(dear.best.day)}, ${dear.best.day - base.best.day} days later than at 3.5¢, and every start from ${dateLabel(dear.near.from)} to ${dateLabel(dear.near.to)} comes within a dollar of it; the old best, ${dateLabel(base.best.day)}, now falls ${usd(dear.best.value - harvest({ ...st, start: base.best.day }).valuePerAcre)} short. Dearer drying makes every point of moisture the field takes out for free worth more, so it pays to leave the crop standing longer.`}
      />

      <P>
        The sweet spot moves with every cost and price. With propane cheap enough that drying costs 2 cents a point, the best start comes on{' '}
        {dateLabel(sweet.cheap)}. A bigger combine moves it later, because the last acres come off sooner: at 160 acres a day it is {dateLabel(sweet.bigCombine)}.
        The corn price pulls the other way. A bushel lost in the field is worth more when corn is dear, while the drying bill per bushel stays the same, so at $7
        the best start is {dateLabel(sweet.dearCorn)} and at $3, {dateLabel(sweet.cheapCorn)}. And in a real autumn the weather that will decide the losses — the
        storm that flattens weakened stalks in November — isn’t known in October, which is why many farmers start early on their driest fields and own a dryer big
        enough to keep going.
      </P>

      <H2>Rain on ripe wheat</H2>
      <P>
        Wheat poses the problem the other way round. It dries quickly in the July sun, to the 13.5% at which it can be threshed and stored without a dryer, so
        moisture is rarely the issue. Rain is. When a ripe wheat head is soaked again and again, the kernels start to germinate where they stand — <b>sprouting</b>.
        Sprouted kernels carry enzymes that break down starch, which ruins flour for bread, and millers measure it with a test called the falling number. A load with
        much sprouting is discounted heavily, and badly sprouted wheat ends up as animal feed. Quality, in other words, is part of the crop’s value, and we’ll come to
        how grain is graded in <a href={lessonHref('agriculture/4.1')}>Chapter 4</a>.
      </P>
      <P>
        In the next demonstration, Cedar Bend’s 600 acres of wheat ripen on {dateLabel(RIPE, true)} in the reference season. The upper chart is each day’s rain;
        the lower one is the share of kernels sprouted if the crop is still standing. Hold the harvest back by a number of days:
      </P>

      <Figure name="Harvest Timing Lab · wheat in the rain" scenario={w}>
        <DayChart
          days={wheatDays}
          series={[{ values: wheatDays.map((d) => WEATHER[d].rain), color: GRAPHIC.blue, kind: 'bar', opacity: 0.6 }]}
          from={RIPE - 4}
          to={RIPE + 31}
          yMin={0}
          yMax={1}
          yTicks={[0, 0.5, 1]}
          yLabel="Rain, inches a day"
          yFormat={(v) => fmt(v, 1)}
          marks={[
            { day: RIPE, color: CROP_LINE.wheat },
            { day: RIPE + w.state.delay, color: '#333' },
          ]}
          height={110}
          ariaLabel={`Daily rain in the month after the wheat ripens on ${dateLabel(RIPE)}: ${wheatRainDays} days with rain, the heaviest ${fmt(wheatRainMax, 2)} inches.`}
        />
        <DayChart
          days={wheatDays}
          series={[{ values: wheatDays.map((d) => (d < RIPE ? 0 : SPROUT[Math.min(SPROUT.length - 1, d - RIPE)] * 100)), color: CROP_LINE.wheat, width: 2.5 }]}
          from={RIPE - 4}
          to={RIPE + 31}
          yMin={0}
          yMax={15}
          yTicks={[0, 5, 10, 15]}
          yLabel="Kernels sprouted, %"
          yFormat={(v) => `${v}%`}
          marks={[
            { day: RIPE, label: 'ripe', color: CROP_LINE.wheat },
            { day: RIPE + w.state.delay, label: 'harvest', color: '#333', row: 1 },
          ]}
          height={160}
          ariaLabel={`Sprouting after the wheat ripens on ${dateLabel(RIPE)}. Harvested ${w.state.delay} days later, ${fmt(wv.sprouted * 100, 1)}% of the kernels have sprouted and the buyer discounts it ${usd(wv.discount, 2)} a bushel.`}
        />
        <Readouts
          items={[
            { label: 'harvested', value: dateLabel(RIPE + w.state.delay), tone: 'orange' },
            { label: 'kernels sprouted', value: `${fmt(wv.sprouted * 100, 1)}%`, tone: 'red' },
            { label: 'discount', value: `${usd(wv.discount, 2)}/bu`, tone: 'red' },
            { label: 'value per acre', value: perAcre(wv.value), tone: 'green' },
            { label: 'for the 600 acres, against harvesting at once', value: usd((wv.value - wheatValue(0).value) * WHEAT_ACRES), tone: 'red' },
          ]}
        />
        <Slider label="Days after ripening" tone="orange" value={w.state.delay} min={0} max={30} onChange={(v) => w.set({ delay: v })} display={`${w.state.delay} days`} />
      </Figure>

      <P>
        The reference season’s wheat yields {buAc(WHEAT.yield, 1)}. Harvested the day it ripens, or the next, it escapes untouched. The half-inch of rain the next day
        starts the damage, and every later shower adds to it, a little faster each time: after a week 2.7% of the kernels have sprouted and the buyer takes 18 cents
        a bushel off; after three weeks 7.2% and 36 cents; after four, 9.4% and 46 cents. For Cedar Bend’s 600 acres, a four-week delay costs about $19,000. That
        is why wheat harvest is a race, run from the first dry day after the crop ripens.
      </P>
      <P>
        In both crops, then, the harvest decision trades a cost you can see — drying, or a few more hours on the combine — against a loss that depends on weather
        nobody can yet know. In <FigRef to="Harvest Timing Lab">the corn harvest</FigRef> that trade set the best day to within a couple of weeks. The next lesson
        puts every cost and every bushel of the year together, to ask the farm’s bottom-line question: at these prices, does it make money?
      </P>
    </LessonPage>
  );
}
