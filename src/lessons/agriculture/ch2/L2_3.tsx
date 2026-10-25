import { useMemo } from 'react';
import {
  Challenge,
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
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  usd,
  useScenario,
} from '../../../framework';
import { YEARS, blightField, fieldSeason, type BlightStrategy } from '../../../engines/agriculture/farm';
import { REFERENCE_YEAR } from '../../../model/agriculture/climate';
import { FUNGICIDE_PER_ACRE, PLAN_PRICE, RESISTANT_PREMIUM, SCOUTING_PER_ACRE, perBushelCost } from '../../../model/agriculture/economics';
import { dateLabel, dayOf } from '../../../model/agriculture/region';
import { DayChart } from '../shared/DayChart';
import { HistogramChart } from '../shared/HistogramChart';
import { buAc, perAcre, perBu } from '../shared/format';

const SEASONS = { reference: REFERENCE_YEAR, wet: 80, dry: 136 } as const;
type SeasonKey = keyof typeof SEASONS;
const STRATEGIES: Array<{ value: BlightStrategy; label: string }> = [
  { value: 'none', label: 'Do nothing' },
  { value: 'resistant', label: 'Resistant hybrid' },
  { value: 'fungicide', label: 'Spray at silking' },
  { value: 'scout', label: 'Scout, spray if needed' },
];
const THRESHOLDS = Array.from({ length: 12 }, (_, i) => (i + 1) * 0.005);

export interface Outcome {
  yield: number;
  none: number;
  clean: number;
  cost: number;
  sprayed: boolean;
  /** $ per acre gained against doing nothing. */
  gain: number;
}

/** One season of a strategy against the blight on Cedar Bend’s corn. */
export function outcome(year: number, strategy: BlightStrategy, o: { cornOnCorn: boolean; threshold: number; pressure: number; price: number; fungicide: number }): Outcome {
  const r = fieldSeason(year, blightField(strategy, o));
  const none = fieldSeason(year, blightField('none', o)).yield;
  const clean = fieldSeason(year, { district: 'prairie', crop: 'corn' }).yield;
  const sprayed = r.sprayDay >= 0;
  const cost = strategy === 'resistant' ? RESISTANT_PREMIUM : strategy === 'fungicide' ? o.fungicide : strategy === 'scout' ? SCOUTING_PER_ACRE + (sprayed ? o.fungicide : 0) : 0;
  return { yield: r.yield, none, clean, cost, sprayed, gain: (r.yield - none) * (o.price - perBushelCost('corn')) - cost };
}

/** Average gain against doing nothing over all 200 seasons, and how often it pays. */
export function strategyRecord(strategy: BlightStrategy, o: { cornOnCorn: boolean; threshold: number; pressure: number; price: number; fungicide: number }) {
  const gains = YEARS.map((y) => outcome(y, strategy, o).gain);
  return { gains, mean: gains.reduce((s, x) => s + x, 0) / gains.length, pays: gains.filter((g) => g > 0).length };
}

const BASE = { cornOnCorn: false, pressure: 1, price: PLAN_PRICE.corn, fungicide: FUNGICIDE_PER_ACRE };
/** Where both figures start the scouting threshold: well above the best, so the challenge starts unsolved. */
export const START_THRESHOLD = 0.04;
let bestThreshold: number | null = null;
/** The scouting threshold (in half-percent steps) with the highest average gain, under the base conditions. */
export function bestScoutingThreshold(): number {
  if (bestThreshold === null) {
    const means = THRESHOLDS.map((t) => strategyRecord('scout', { ...BASE, threshold: t }).mean);
    bestThreshold = THRESHOLDS[means.reduce((a, m, i) => (m > means[a] ? i : a), 0)];
  }
  return bestThreshold;
}

/** Scouting at a threshold under the base conditions: the average gain and the seasons, of 200, in which it sprays. */
export function scoutingRecord(threshold: number): { mean: number; sprays: number } {
  const o = { ...BASE, threshold };
  return { mean: strategyRecord('scout', o).mean, sprays: YEARS.filter((y) => outcome(y, 'scout', o).sprayed).length };
}

/** The challenge: scout and spray at the threshold that earns the most on average (corn after wheat, base blight, $4.60 corn, $32 spray). */
export function thresholdSolved(s: { strategy: BlightStrategy; cornOnCorn: boolean; threshold: number; pressure: number; price: number; fungicide: number }): boolean {
  return (
    s.strategy === 'scout' &&
    !s.cornOnCorn &&
    Math.abs(s.pressure - 1) < 1e-6 &&
    Math.abs(s.price - BASE.price) < 1e-6 &&
    Math.abs(s.fungicide - BASE.fungicide) < 1e-6 &&
    Math.abs(s.threshold - bestScoutingThreshold()) < 1e-9
  );
}

export default function Lesson() {
  const s = useScenario('blight', { season: 'reference' as SeasonKey, strategy: 'fungicide' as BlightStrategy, rotation: 'wheat' as 'wheat' | 'corn', threshold: START_THRESHOLD });
  const cornOnCorn = s.state.rotation === 'corn';
  const year = SEASONS[s.state.season];
  const opts = { cornOnCorn, threshold: s.state.threshold, pressure: 1, price: PLAN_PRICE.corn, fungicide: FUNGICIDE_PER_ACRE };
  const run = useMemo(() => fieldSeason(year, blightField(s.state.strategy, opts)), [year, s.state.strategy, cornOnCorn, s.state.threshold]);
  const clean = useMemo(() => fieldSeason(year, { district: 'prairie', crop: 'corn' }), [year]);
  const res = outcome(year, s.state.strategy, opts);
  const days = run.days.map((d) => d.day);
  const silking = run.stageDays[4];

  const m = useScenario('many', { strategy: 'fungicide' as BlightStrategy, rotation: 'wheat' as 'wheat' | 'corn', pressure: 1, threshold: START_THRESHOLD, price: PLAN_PRICE.corn, fungicide: FUNGICIDE_PER_ACRE });
  const mOpts = { cornOnCorn: m.state.rotation === 'corn', threshold: m.state.threshold, pressure: m.state.pressure, price: m.state.price, fungicide: m.state.fungicide };
  const records = useMemo(
    () => STRATEGIES.filter((x) => x.value !== 'none').map((x) => ({ ...x, ...strategyRecord(x.value, mOpts) })),
    [m.state.rotation, m.state.threshold, m.state.pressure, m.state.price, m.state.fungicide],
  );
  const chosen = records.find((r) => r.value === m.state.strategy) ?? records[1];
  const solved = useMemo(() => thresholdSolved({ ...m.state, cornOnCorn: m.state.rotation === 'corn' }), [m.state]);
  const startScout = useMemo(() => scoutingRecord(START_THRESHOLD), []);
  const scoutNow = useMemo(() => (m.state.strategy === 'scout' ? scoutingRecord(m.state.threshold) : null), [m.state.strategy, m.state.threshold]);
  const lower = useMemo(() => (solved ? scoutingRecord(m.state.threshold - 0.005) : null), [solved, m.state.threshold]);
  const higher = useMemo(() => (solved ? scoutingRecord(m.state.threshold + 0.005) : null), [solved, m.state.threshold]);

  return (
    <LessonPage id="agriculture/2.3">
      <P>
        <a href={lessonHref('agriculture/2.2')}>The previous lesson</a> treated the crop’s enemies as physical: a wet spring that washes nitrogen away, a dry summer that
        runs the root zone down. Some of a crop’s worst enemies are alive. Weeds compete with it for light and water; insects eat it — the larvae of the corn rootworm,
        for instance, feed on corn roots, which is one reason rotating corn with another crop helps, since the larvae that hatch in a wheat field find nothing to eat.
        And fungi infect its leaves. In wheat, the fungus that causes head scab can also leave a toxin in the grain that buyers test for, a link to the grading we’ll
        meet in <a href={lessonHref('agriculture/4.1')}>Chapter 4</a>.
      </P>
      <P>
        Living enemies differ from weather in one important way: they multiply. We’ll follow a fungal <K tone="red">leaf blight</K> of the valley’s corn, because it
        shows the logic of biological risk most clearly. In our model, a trace of the disease appears in midsummer as spores blow in or splash up from last year’s
        corn residue. On every warm day when the leaves stay wet — from rain, or from humid nights — each infected spot produces spores that start new ones, so the
        diseased share of the canopy grows exponentially until it runs short of healthy leaf to infect. Diseased leaf area catches light but turns none of it into
        sugar, and as <a href={lessonHref('agriculture/1.5')}>Lesson 1.5</a> showed, sugar during grain fill is what fills the kernels.
      </P>
      <P>
        A farmer has three defenses, and our model puts its own numbers on each. A <b>resistant hybrid</b> slows the blight by 40% all season, for $12 an acre more in seed — and, we’ll
        assume, gives up 3% of its yield, because its genetics trail the newest susceptible hybrids. A <b>fungicide</b> sprayed at silking slows the blight by 80% for
        three weeks, for $32 an acre. Or the farmer can <b>scout</b>: walk the fields for $4 an acre at silking and spray that day only if the blight has passed a
        threshold. In the next demonstration, the upper chart is the diseased share of Cedar Bend’s corn leaves through the summer; the lower one is the leaf area that
        is still green, against the same crop with no disease at all. Choose a season, a strategy and the field’s history:
      </P>

      <Figure name="Crop Risk Simulator" scenario={s}>
        <Segmented
          label="Season"
          value={s.state.season}
          onChange={(v) => s.set({ season: v })}
          options={[
            { value: 'reference', label: 'Reference' },
            { value: 'wet', label: 'A wet summer' },
            { value: 'dry', label: 'A dry summer' },
          ]}
        />
        <Segmented label="Strategy" value={s.state.strategy} onChange={(v) => s.set({ strategy: v })} options={STRATEGIES} />
        <Segmented
          label="Last year’s crop"
          value={s.state.rotation}
          onChange={(v) => s.set({ rotation: v })}
          options={[
            { value: 'wheat', label: 'Corn after wheat' },
            { value: 'corn', label: 'Corn after corn' },
          ]}
        />
        <DayChart
          days={days}
          series={[
            { values: run.days.map((d) => d.disease * 100), color: GRAPHIC.red, kind: 'area', opacity: 0.3 },
            { values: run.days.map((d) => d.disease * 100), color: GRAPHIC.red, width: 2 },
          ]}
          from={dayOf(6, 1)}
          to={dayOf(9, 30)}
          yMin={0}
          yMax={100}
          yTicks={[0, 25, 50, 75, 100]}
          yLabel="Leaf area diseased, %"
          yFormat={(v) => `${v}%`}
          height={160}
          marks={[
            { day: silking, label: 'silking', color: GRAPHIC.gold },
            ...(run.sprayDay >= 0 ? [{ day: run.sprayDay, label: 'sprayed', color: GRAPHIC.violet, row: 1 }] : []),
          ]}
          ariaLabel={`Leaf blight through the summer: ${fmt(run.diseaseFinal * 100)}% of the leaf area diseased by the end of the season${run.sprayDay >= 0 ? `, sprayed on ${dateLabel(run.sprayDay)}` : ''}.`}
        />
        <DayChart
          days={days}
          series={[
            { values: clean.days.filter((d) => d.day <= run.end).map((d) => d.lai), days: clean.days.filter((d) => d.day <= run.end).map((d) => d.day), color: GRAPHIC.teal, dash: '6 4', width: 2 },
            { values: run.days.map((d) => d.lai * (1 - d.disease)), color: GRAPHIC.teal, width: 2.5 },
          ]}
          from={dayOf(6, 1)}
          to={dayOf(9, 30)}
          yMin={0}
          yMax={6}
          yTicks={[0, 2, 4, 6]}
          yLabel="Green leaf area index"
          yFormat={(v) => fmt(v)}
          height={150}
          ariaLabel={`Green leaf area through the summer, with and without the blight. Yield ${fmt(res.yield)} bushels an acre against ${fmt(res.clean)} with no disease.`}
        />
        <Legend
          items={[
            { label: 'Diseased', color: GRAPHIC.red },
            { label: 'Green leaf, no disease', color: GRAPHIC.teal, kind: 'line', dashed: true },
            { label: 'Green leaf, with the blight', color: GRAPHIC.teal, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'diseased at season’s end', value: `${fmt(run.diseaseFinal * 100)}%`, tone: 'red' },
            { label: 'yield', value: buAc(res.yield), tone: 'gold' },
            { label: 'with no blight at all', value: buAc(res.clean) },
            { label: 'cost of the strategy', value: perAcre(res.cost) },
            { label: 'gain against doing nothing', value: perAcre(res.gain), tone: res.gain >= 0 ? 'green' : 'red' },
          ]}
        />
        <Slider
          label="Scouting threshold"
          tone="violet"
          value={s.state.threshold}
          min={0.005}
          max={0.06}
          step={0.005}
          disabled={s.state.strategy !== 'scout'}
          onChange={(v) => s.set({ threshold: Math.round(v * 1000) / 1000 })}
          display={s.state.strategy === 'scout' ? `spray above ${fmt(s.state.threshold * 100, 1)}%` : 'not scouting'}
        />
      </Figure>

      <P>
        In the reference season the blight arrives in late June and, left alone, covers 43% of the leaves by the time the kernels are full; the crop yields 175.5
        bushels instead of 188. Sprayed at silking, it slows for three weeks, ends at 19%, and the crop yields 183.5 — eight bushels more, worth about $35 against
        the $32 spray. In the wet summer, with more than a month of warm, wet days, the untreated blight takes 87% of the leaves and a quarter of the crop: 156.5
        bushels instead of 211. There the spray is worth 33 bushels, and the resistant hybrid 39. In the dry summer the blight barely gets going: the spray buys less
        than a bushel, and the resistant hybrid’s yield drag gives it the smallest harvest of all.
      </P>
      <P>
        Now switch to corn after corn. Last year’s infected residue is still on the ground, the blight starts with three times the spores, and three times the start
        is worth about eight favorable days of exponential growth: in the reference season the untreated crop yields 157.3. Notice too how timing matters. Spraying at
        silking protects the leaves that will feed the grain; a spray in June would wear off before the epidemic took hold, and one in late August would protect
        leaves whose work is nearly done.
      </P>

      <H2>The long run</H2>
      <P>
        A farmer chooses a strategy in spring without knowing which summer is coming, so the fair test is all of them. In the next demonstration, each strategy is
        run through the 200 seasons of the model’s history. The table gives each one’s average gain against doing nothing and how many seasons it paid; the histogram
        shows the selected strategy’s gain season by season. Change the conditions:
      </P>

      <Figure name="Crop Risk Simulator · 200 seasons" scenario={m}>
        <Segmented label="Strategy" value={m.state.strategy} onChange={(v) => m.set({ strategy: v })} options={STRATEGIES.filter((x) => x.value !== 'none')} />
        <Segmented
          label="Last year’s crop"
          value={m.state.rotation}
          onChange={(v) => m.set({ rotation: v })}
          options={[
            { value: 'wheat', label: 'Corn after wheat' },
            { value: 'corn', label: 'Corn after corn' },
          ]}
        />
        <HistogramChart
          values={chosen.gains}
          lo={-60}
          hi={200}
          bins={26}
          color={GRAPHIC.green}
          xTicks={[-50, 0, 50, 100, 150, 200]}
          xFormat={(v) => usd(v)}
          xLabel="gain against doing nothing, $ per acre"
          marks={[
            { x: 0, label: 'break even', color: '#777', dash: '3 3' },
            { x: chosen.mean, label: `average ${usd(chosen.mean, 2)}`, color: TEXT.green, row: 1 },
          ]}
          highlight={(b0) => b0 >= 0}
          ariaLabel={`${chosen.label} over 200 seasons: an average gain of ${usd(chosen.mean, 2)} an acre against doing nothing; it paid in ${chosen.pays} seasons.`}
        />
        <DataTable
          caption="Each strategy over 200 seasons"
          columns={[
            { label: 'Strategy', cell: (r: (typeof records)[number]) => r.label },
            { label: 'Average gain per acre', cell: (r) => usd(r.mean, 2), align: 'right' },
            { label: 'Seasons it paid', cell: (r) => `${r.pays} of 200`, align: 'right' },
          ]}
          rows={records}
          rowKey={(r) => r.value}
          rowClass={(r) => (r.value === m.state.strategy ? 'hl' : '')}
        />
        <Slider label="Blight pressure" tone="red" value={m.state.pressure} min={0.25} max={4} step={0.25} onChange={(v) => m.set({ pressure: v })} display={`${fmt(m.state.pressure, 2)}× the usual spores`} />
        <Slider label="Corn price" tone="green" value={m.state.price} min={3} max={7} step={0.1} onChange={(v) => m.set({ price: Math.round(v * 10) / 10 })} display={perBu(m.state.price)} />
        <Slider label="Spray cost" tone="red" value={m.state.fungicide} min={15} max={50} step={1} onChange={(v) => m.set({ fungicide: v })} display={perAcre(m.state.fungicide)} />
        <Slider
          label="Scouting threshold"
          tone="violet"
          value={m.state.threshold}
          min={0.005}
          max={0.06}
          step={0.005}
          onChange={(v) => m.set({ threshold: Math.round(v * 1000) / 1000 })}
          display={`spray above ${fmt(m.state.threshold * 100, 1)}%`}
        />
      </Figure>

      <P>
        With corn after wheat and the usual spores, the blight costs Cedar Bend 6.3% of its yield in an average season and 11.7% in a 1-in-10 bad one. Spraying
        every field at silking gains an average of just 58 cents an acre: it pays in 75 seasons of the 200, handsomely in the wet ones, and loses most of its $32 in
        the rest. The resistant hybrid gains $6.22 on average and pays in 82 seasons. Scouting is the subtle one. At the {fmt(START_THRESHOLD * 100)}% threshold
        where the demonstration starts, it sprays in only {startScout.sprays} of the 200 seasons and loses {usd(-startScout.mean, 2)} an acre on average — most of
        the $4 it pays to look.
      </P>

      <Challenge
        id="a"
        figure="Crop Risk Simulator · 200 seasons"
        question="At 4% the scout almost never acts on what it sees. Predict which way the threshold should move, then find the threshold, in half-percent steps, at which scouting earns the most on average — with corn after wheat, the usual blight pressure, corn at $4.60 and a $32 spray."
        solved={solved}
        status={
          m.state.strategy !== 'scout'
            ? 'Choose the scouting strategy.'
            : m.state.rotation !== 'wheat' || Math.abs(m.state.pressure - 1) > 1e-6 || Math.abs(m.state.price - BASE.price) > 1e-6 || Math.abs(m.state.fungicide - BASE.fungicide) > 1e-6
              ? 'Keep corn after wheat, 1.00× pressure, $4.60 corn and a $32 spray.'
              : `At ${fmt(m.state.threshold * 100, 1)}%, scouting sprays in ${scoutNow?.sprays ?? 0} seasons and ${chosen.mean >= 0 ? 'gains' : 'loses'} ${usd(Math.abs(chosen.mean), 2)} an acre on average.`
        }
        success={`Solved: a ${fmt(m.state.threshold * 100, 1)}% threshold sprays in ${scoutNow?.sprays ?? 0} seasons and gains ${usd(chosen.mean, 2)} an acre on average, spraying only when the blight is already well established by silking. The best is a knife-edge: at ${fmt((m.state.threshold - 0.005) * 100, 1)}% scouting sprays in ${lower?.sprays} seasons and gains only ${usd(lower?.mean ?? 0, 2)}, paying for sprays that weren’t needed, and at ${fmt((m.state.threshold + 0.005) * 100, 1)}% it sprays in ${higher?.sprays} and ${(higher?.mean ?? 0) >= 0 ? `gains ${usd(higher?.mean ?? 0, 2)}` : `loses ${usd(-(higher?.mean ?? 0), 2)}`}, missing seasons that needed a spray. The $4 a farmer pays to look is buying information, and here it is worth more than it costs.`}
      />

      <P>
        At its best, then, scouting beats spraying every field but not the resistant hybrid. None of these is a sure thing; each is a bet on the weather, with its
        own spread of outcomes, and the bet moves with the odds and the stakes: double the blight pressure and spraying every field gains $19.85 an acre on
        average; raise corn to $6 and it gains $11.01; cut the spray to $20 and it gains $12.58. Many farmers spray every year anyway, a strategy that barely breaks
        even on average, to avoid the worst seasons — a trade between the average and the spread that will come back, in another form, when we reach hedging in
        Chapter 5. On corn after corn every defense pays handsomely, because the blight starts so far ahead — the rotation in{' '}
        <FigRef to="Farm Planner">the farm planner</FigRef> earns part of its keep here.
      </P>
      <P>
        Biology, in other words, adds its own uncertainty on top of the weather’s, and most of it is the weather in disguise: the blight is a wet-summer problem, and
        its losses fall hardest in the seasons that are otherwise good for corn. What’s left for this chapter is the end of the season — getting the crop out of the
        field — and the whole year’s accounts. Harvest comes first, and it turns out to be a decision about moisture.
      </P>
    </LessonPage>
  );
}

