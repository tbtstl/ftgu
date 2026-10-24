import { useMemo, useState } from 'react';
import {
  Button,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { describe } from '../../../engines/strategy/distribution';
import { valleyFrom, valleySeason } from '../../../engines/agriculture/valley';
import { normalYear, simulatedYear, spliceWeather } from '../../../model/agriculture/climate';
import { DISTRICTS, dateLabel, dayOf, type Crop, type DistrictId } from '../../../model/agriculture/region';
import { HistogramChart } from '../shared/HistogramChart';
import { CROP_LINE } from '../shared/tones';

const MAX_SEASONS = 400;
const PER_SECOND = 40;

/** Valley production in season i (1-based), millions of bushels, with the districts sharing one year's weather or drawing their own. */
const prodCache = new Map<string, number>();
export function production(i: number, crop: Crop, independent: boolean): number {
  const k = `${i}|${crop}|${independent}`;
  let v = prodCache.get(k);
  if (v === undefined) {
    if (!independent) v = valleySeason(i)[crop] / 1e6;
    else {
      const yearOf = (d: DistrictId) => ((i * 7 + DISTRICTS.findIndex((x) => x.id === d) * 97) % MAX_SEASONS) + 1;
      v = valleyFrom((d) => simulatedYear(yearOf(d), d))[crop] / 1e6;
    }
    prodCache.set(k, v);
  }
  return v;
}

let normalCache: { corn: number; wheat: number } | null = null;
/** Valley production in a season whose every day has its normal weather, millions of bushels. */
export function normalWeatherProduction(): { corn: number; wheat: number } {
  if (!normalCache) {
    const v = valleyFrom((d) => normalYear(d));
    normalCache = { corn: v.corn / 1e6, wheat: v.wheat / 1e6 };
  }
  return normalCache;
}

/** The 10th percentile of the first n seasons. */
export function tenthPercentile(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(0.1 * (s.length - 1))];
}

/** The challenge: with at least 200 shared-weather corn seasons run, the threshold within 5 million bushels of their 10th percentile. */
export function percentileSolved(n: number, crop: Crop, independent: boolean, threshold: number): boolean {
  if (n < 200 || crop !== 'corn' || independent) return false;
  const vals = Array.from({ length: n }, (_, i) => production(i + 1, 'corn', false));
  return Math.abs(threshold - tenthPercentile(vals)) <= 5;
}

function Runner({ playing, onTick }: { playing: boolean; onTick: (dt: number) => void }) {
  useAnimationFrame(onTick, playing);
  return null;
}

const TRUTHS = { drought: 46, reference: 40, bumper: 180 } as const;
type Truth = keyof typeof TRUTHS;
const CUTS = [dayOf(6, 1), dayOf(7, 1), dayOf(7, 15), dayOf(8, 1), dayOf(8, 15), dayOf(9, 1)];
const condCache = new Map<string, number[]>();
/** Valley corn production in 100 possible endings of a season known up to `cut`, millions of bushels. */
export function endings(truth: number, cut: number): number[] {
  const k = `${truth}|${cut}`;
  let v = condCache.get(k);
  if (!v) {
    v = Array.from({ length: 100 }, (_, i) => valleyFrom((d) => spliceWeather(simulatedYear(truth, d), simulatedYear(i + 201, d), cut)).corn / 1e6);
    condCache.set(k, v);
  }
  return v;
}

export default function Lesson() {
  const s = useScenario('monte-carlo', { crop: 'corn' as Crop, independent: 'shared' as 'shared' | 'independent', threshold: 450 });
  const play = usePlay(false);
  const [n, setN] = useState(0);
  const [acc, setAcc] = useState(0);
  const independent = s.state.independent === 'independent';
  const values = useMemo(() => Array.from({ length: n }, (_, i) => production(i + 1, s.state.crop, independent)), [n, s.state.crop, independent]);
  const d = describe(values);
  const below = values.filter((v) => v < s.state.threshold).length;
  const solved = useMemo(() => percentileSolved(n, s.state.crop, independent, s.state.threshold), [n, s.state.crop, independent, s.state.threshold]);
  const lo = s.state.crop === 'corn' ? 250 : 170;
  const hi = s.state.crop === 'corn' ? 650 : 290;
  const tick = (dt: number) => {
    const next = acc + dt * PER_SECOND;
    const whole = Math.floor(next);
    if (whole > 0) {
      setN((x) => {
        const v = Math.min(MAX_SEASONS, x + whole);
        if (v >= MAX_SEASONS) play.setPlaying(false);
        return v;
      });
    }
    setAcc(next - whole);
  };

  const c = useScenario('endings', { truth: 'drought' as Truth, cut: '0' as '0' | '1' | '2' | '3' | '4' | '5' });
  const cut = CUTS[Number(c.state.cut)];
  const truthYear = TRUTHS[c.state.truth];
  const ends = useMemo(() => endings(truthYear, cut), [truthYear, cut]);
  const ed = describe(ends);
  const actual = valleySeason(truthYear).corn / 1e6;

  return (
    <LessonPage id="agriculture/3.5">
      <P>
        The last four lessons each looked at uncertainty from one side: geography, extremes, satellites, forecasts. This one adds it all up for the whole valley. The
        question a grain buyer actually needs answered isn’t “what will Cedar Bend yield?” but “how much corn will the Crane Valley produce, and how sure can we
        be?” The honest answer is not a number but a <K tone="gold">distribution</K>: every harvest the valley could plausibly bring in, from the disastrous to the
        bountiful, and how likely each is.
      </P>
      <P>
        The way to get one is the oldest trick in simulation, named after a casino: the <b>Monte Carlo</b> method. Run the valley’s five districts through one
        simulated season, add up the corn, write the number down; then do it again with another season’s weather, and again, hundreds of times. In the next
        demonstration each bar counts the seasons whose valley harvest fell in that range. Press play to run them, and move the threshold to see how many fall
        below it:
      </P>

      <Figure
        name="Harvest Monte Carlo"
        scenario={s}
        play={play}
        actions={
          <>
            <Button onClick={() => setN((x) => Math.min(MAX_SEASONS, x + 100))}>+100 seasons</Button>
            <Button
              onClick={() => {
                play.setPlaying(false);
                setN(0);
              }}
            >
              Clear
            </Button>
          </>
        }
      >
        <Runner playing={play.playing && n < MAX_SEASONS} onTick={tick} />
        <Segmented
          label="Crop"
          value={s.state.crop}
          onChange={(v) => s.set({ crop: v, threshold: v === 'corn' ? 450 : 210 })}
          options={[
            { value: 'corn', label: 'Corn' },
            { value: 'wheat', label: 'Wheat' },
          ]}
        />
        <Segmented
          label="Weather across the districts"
          value={s.state.independent}
          onChange={(v) => s.set({ independent: v })}
          options={[
            { value: 'shared', label: 'One valley-wide season' },
            { value: 'independent', label: 'Each district on its own' },
          ]}
        />
        <HistogramChart
          values={values.length ? values : [NaN]}
          lo={lo}
          hi={hi}
          bins={40}
          color={CROP_LINE[s.state.crop]}
          xFormat={(v) => fmt(v)}
          xLabel={`valley ${s.state.crop} production, millions of bushels`}
          yLabel={`Seasons, of ${n}`}
          marks={[
            ...(n ? [{ x: d.mean, label: `average ${fmt(d.mean)}`, color: '#333' }] : []),
            { x: s.state.threshold, label: `threshold ${fmt(s.state.threshold)}`, color: GRAPHIC.red, dash: '4 3', row: 1 },
          ]}
          highlight={(_, b1) => b1 <= s.state.threshold}
          ariaLabel={`Valley ${s.state.crop} production in ${n} simulated seasons${n ? `: average ${fmt(d.mean)} million bushels, ${fmt(d.q05)} to ${fmt(d.q95)} in 9 seasons of 10, and ${below} seasons below ${fmt(s.state.threshold)}` : ''}.`}
        />
        <Readouts
          items={[
            { label: 'seasons run', value: fmt(n) },
            { label: 'average, million bu', value: n ? fmt(d.mean) : '—', tone: s.state.crop === 'corn' ? 'gold' : 'orange' },
            { label: '9 seasons in 10 between', value: n > 20 ? `${fmt(d.q05)}–${fmt(d.q95)}` : '—' },
            { label: 'below the threshold', value: n ? `${fmt((below / n) * 100)}%` : '—', tone: 'red' },
          ]}
        />
        <Slider
          label="Threshold"
          tone="red"
          value={s.state.threshold}
          min={lo}
          max={hi}
          step={5}
          onChange={(v) => s.set({ threshold: v })}
          display={`${fmt(s.state.threshold)} million bu`}
        />
      </Figure>

      <P>
        After 400 seasons the picture is clear. The valley’s corn harvest averages 506 million bushels, and in 9 seasons out of 10 it lands between 390 and 599.
        But the shape matters as much as the middle: the distribution leans. Its long tail is on the left. The worst season, a valley-wide drought, brought in 269
        million bushels, 237 below the average, while the best brought 630, only 124 above it. Good weather can only fill the kernels so full; bad weather can
        empty them. The median, 513, sits above the average for the same reason.
      </P>
      <P>
        It takes a lot of seasons to see that shape. After ten, the average is 521 million bushels and the histogram is a scatter of bars; after 50, 506; after 200,
        507, and the 1-in-20 bad crop has settled near 408. The rare seasons are the slowest to fill in, because they are rare: the worst drought in the history
        doesn’t appear until the forty-sixth season. Real history is the same, only shorter. A grain belt has a few decades of reliable records, which is very few
        draws from a distribution like this one, and that is one reason risk managers lean on simulations like these — and one reason they are sometimes surprised.
      </P>
      <P>
        Two more experiments. A season with the average of every day’s weather — a little rain each day and never a hot spell — would grow {fmt(normalWeatherProduction().corn)} million
        bushels, more than 399 of the 400 seasons. Average weather is not typical weather, and the harvest of average weather is not the average harvest. Then switch
        to each district on its own, drawing its weather from a different season. The average barely moves, but the spread shrinks: the 1-in-20 bad crop rises
        from 390 million bushels to 426, and the worst from 269 to 338. The districts share one sky, and when a drought settles over the valley it settles over most
        of it. That shared weather — <b>correlation</b>, in the statistician’s word — is what makes a region’s harvest so much riskier than its districts’ separate
        risks would suggest. Wheat, grown in spring and spread more evenly across the districts, is steadier: 9 seasons in 10 between 201 and 262 million bushels.
      </P>

      <Challenge
        id="a"
        question="Run at least 200 seasons of corn with one valley-wide season. Then set the threshold to the 1-in-10 bad harvest — the level that only a tenth of the seasons fall below — to within 5 million bushels."
        solved={solved}
        status={
          s.state.crop !== 'corn' || independent
            ? 'Choose corn and one valley-wide season.'
            : n < 200
              ? `${n} seasons run so far. Run at least 200.`
              : `${fmt((below / n) * 100, 1)}% of the ${n} seasons fall below ${fmt(s.state.threshold)} million bushels.`
        }
        success={`Solved: ${fmt((below / n) * 100, 1)}% of the ${n} seasons fall below ${fmt(s.state.threshold)} million bushels. That number — the valley’s 1-in-10 bad crop — is the kind a buyer plans around: a feed mill that needs to be sure of its corn, or an exporter deciding how much to promise abroad, cares less about the average harvest than about how bad a bad one gets.`}
      />

      <H2>The distribution narrows</H2>
      <P>
        Before planting, the histogram is all anyone has. As the summer goes on, part of each season’s weather becomes known, and the distribution shrinks around
        whatever is actually happening, season after season — the same idea as <a href={lessonHref('agriculture/1.5')}>Lesson 1.5</a> on one farm, now for the valley. In the next
        demonstration the weather is known up to the chosen date in one season, and each of 100 other seasons supplies a possible ending:
      </P>

      <Figure name="Harvest Monte Carlo · as the season unfolds" scenario={c}>
        <Segmented
          label="The season that is really happening"
          value={c.state.truth}
          onChange={(v) => c.set({ truth: v })}
          options={[
            { value: 'drought', label: 'Drought' },
            { value: 'reference', label: 'Reference' },
            { value: 'bumper', label: 'Bumper' },
          ]}
        />
        <Segmented label="Weather known up to" value={c.state.cut} onChange={(v) => c.set({ cut: v })} options={CUTS.map((x, i) => ({ value: String(i) as '0', label: dateLabel(x) }))} />
        <HistogramChart
          values={ends}
          lo={250}
          hi={650}
          bins={40}
          color={CROP_LINE.corn}
          xFormat={(v) => fmt(v)}
          xLabel="valley corn production, millions of bushels"
          yLabel="Possible endings, of 100"
          marks={[
            { x: ed.mean, label: `expected ${fmt(ed.mean)}`, color: '#333' },
            { x: actual, label: `actual ${fmt(actual)}`, color: TEXT.red, dash: '4 3', row: 1 },
          ]}
          ariaLabel={`Valley corn production in 100 possible endings of the ${c.state.truth} season, with the weather known up to ${dateLabel(cut, true)}: expected ${fmt(ed.mean)} million bushels, 9 in 10 between ${fmt(ed.q05)} and ${fmt(ed.q95)}. It actually produces ${fmt(actual)}.`}
        />
        <Readouts
          items={[
            { label: 'expected harvest, million bu', value: fmt(ed.mean), tone: 'gold' },
            { label: '9 endings in 10 between', value: `${fmt(ed.q05)}–${fmt(ed.q95)}` },
            { label: 'actual', value: fmt(actual), tone: 'red' },
          ]}
        />
      </Figure>

      <P>
        On June 1 the drought looks like any other season: the expected harvest is 500 million bushels, with nine endings in ten between 375 and 606. By July 1 the
        expectation has slipped to 462. By July 15, with the Prairie’s corn silking in the heat, it is 406; by August 1, 321, and nine endings in ten now lie
        between 281 and 370, none of them anywhere near normal. The crop comes in at 269, the worst in the history. The bumper season climbs the other way, from 507
        on June 1 to 585 by August 1 and 609 by mid-August, and ends at 621; the reference season stays near the middle and ends at 525. Each revision — down 38
        million bushels in June, 56 more in early July, 85 more in the second half of the month — is news, and it is exactly the kind of news that moves the price
        of corn.
      </P>

      <P>
        That is the answer to this chapter’s question. Agricultural supply is uncertain because it is grown outdoors over months, through weather that no one can
        know in advance and that hits whole regions at once; because the crop’s response to that weather is lopsided, with deeper losses than gains; and because
        even good observation sees trouble better than bounty. The uncertainty resolves on the crop’s schedule, slowly and then all at once around flowering. What
        happens to the grain once it is harvested — how it is graded, dried, stored and moved — is the subject of Chapter 4, and the distributions of{' '}
        <FigRef to="Harvest Monte Carlo">the Monte Carlo</FigRef> become prices in Chapter 5.
      </P>
    </LessonPage>
  );
}
