import { useMemo } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  fmt,
  lessonHref,
  scale,
  signed,
  useScenario,
} from '../../../framework';
import { CROP, simulateSeason, type SeasonResult } from '../../../engines/agriculture/crop';
import { describe } from '../../../engines/strategy/distribution';
import { REFERENCE_YEAR, simulatedYear, spliceWeather, withEvents } from '../../../model/agriculture/climate';
import { DISTRICT, dateLabel, dayOf } from '../../../model/agriculture/region';
import { HistogramChart } from '../shared/HistogramChart';
import { buAc } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

const PRAIRIE = DISTRICT.prairie;
const SEASONS = {
  reference: { year: REFERENCE_YEAR, label: 'Reference', name: 'reference season' },
  bumper: { year: 180, label: 'Bumper', name: 'bumper season' },
  hotJuly: { year: 133, label: 'Hot July', name: 'hot July' },
  dryAugust: { year: 111, label: 'Dry August', name: 'dry August' },
  drought: { year: 46, label: 'Drought', name: 'drought' },
} as const;
type SeasonKey = keyof typeof SEASONS;
const MAX_KPB = CROP.corn.minKernelsPerBu;
const N_SEASONS = 200;
/** The dry spell: two weeks with no rain, clear skies and hotter afternoons (climate.ts's drought event). */
const SPELL_DAYS = 14;
type Spell = 'off' | 'on';

/** Corn at Cedar Bend in a simulated year, optionally with a two-week dry spell starting on `spellStart`. */
export function grow(year: number, population: number, spellStart: number | null = null): SeasonResult {
  const w = simulatedYear(year, 'prairie');
  return simulateSeason(spellStart === null ? w : withEvents(w, [{ kind: 'drought', start: spellStart, days: SPELL_DAYS }]), {
    crop: 'corn',
    plantDay: dayOf(5, 1),
    maturityGdd: PRAIRIE.hybridGdd,
    pawIn: PRAIRIE.pawIn,
    startWater: PRAIRIE.springWater,
    population,
  });
}

const kernelLimited = (r: SeasonResult) => r.sink <= r.source + 1e-9;

/** The challenge's thinner stand: about a tenth fewer plants than Cedar Bend's usual 32,000. */
export const THIN = { from: 28000, to: 30000 };

/**
 * The challenge: with a tenth fewer plants and no dry spell, the season whose kernels, not its canopy, now limit the
 * yield. Only the bumper season, whose kernels had the least to spare at 32,000 plants, switches anywhere in 28,000–30,000.
 */
export function thinnerSolved(season: SeasonKey, population: number, spell: Spell = 'off'): boolean {
  if (spell !== 'off' || population < THIN.from || population > THIN.to) return false;
  return kernelLimited(grow(SEASONS[season].year, population));
}

/** Across the 200 simulated seasons at 32,000 plants: how many were kernel-limited, and the median of what the kernels could hold over what the canopy supplied. */
let headroomCache: { kernelLimited: number; median: number } | null = null;
export function kernelHeadroom(): { kernelLimited: number; median: number } {
  if (!headroomCache) {
    const runs = Array.from({ length: N_SEASONS }, (_, i) => grow(i + 1, 32000));
    const ratios = runs.map((r) => r.sink / r.source).sort((a, b) => a - b);
    headroomCache = { kernelLimited: runs.filter(kernelLimited).length, median: (ratios[N_SEASONS / 2 - 1] + ratios[N_SEASONS / 2]) / 2 };
  }
  return headroomCache;
}

/** The reference season with a two-week dry spell starting on each of the dates the prose quotes. */
const REF_RUN = grow(REFERENCE_YEAR, 32000);
export const SPELL_AT = {
  june1: grow(REFERENCE_YEAR, 32000, dayOf(6, 1)),
  july10: grow(REFERENCE_YEAR, 32000, dayOf(7, 10)),
  aug1: grow(REFERENCE_YEAR, 32000, dayOf(8, 1)),
  aug25: grow(REFERENCE_YEAR, 32000, dayOf(8, 25)),
};
/** The reference season's winter wheat at Cedar Bend. */
const WHEAT_REF = simulateSeason(simulatedYear(REFERENCE_YEAR, 'prairie'), { crop: 'wheat', pawIn: PRAIRIE.pawIn, startWater: PRAIRIE.springWater });
/** Each season at Cedar Bend's usual 32,000 plants: what the kernels could hold over what the canopy supplied. */
const SPARE = Object.fromEntries(
  (Object.keys(SEASONS) as SeasonKey[]).map((k) => {
    const r = grow(SEASONS[k].year, 32000);
    return [k, r.sink / r.source - 1];
  }),
) as Record<SeasonKey, number>;

/** A corn ear seen from the side: kernels set from the base, sized by how full they are. */
function Ear({ r }: { r: SeasonResult }) {
  const rows = 8;
  const perRow = 40;
  const setPerRow = Math.round(r.kernelsPerEar / 16);
  const fullness = Math.cbrt(MAX_KPB / Math.max(MAX_KPB, r.kernelsPerBu));
  const x0 = 90;
  const w = 12.2;
  const y0 = 40;
  const h = 13;
  const cells = [];
  for (let i = 0; i < perRow; i++) {
    for (let j = 0; j < rows; j++) {
      const taper = 1 - 0.35 * Math.max(0, (i - perRow * 0.6) / (perRow * 0.4));
      const cy = y0 + 52 + (j - (rows - 1) / 2) * h * taper;
      const cx = x0 + i * w;
      const set = i < setPerRow;
      const s = set ? fullness : 0.32;
      cells.push(<rect key={`${i}-${j}`} x={cx - (w * s) / 2} y={cy - (h * s * taper) / 2} width={w * s * 0.92} height={h * s * 0.9 * taper} rx={2} fill={set ? '#e6bf45' : '#efe6c8'} stroke={set ? '#b48d1d' : '#ddd2ad'} strokeWidth={0.6} />);
    }
  }
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 170"
      role="img"
      aria-label={`An ear with ${fmt(r.kernelsPerEar)} kernels set out of a possible 640; the kernels weigh ${fmt(r.kernelsPerBu)} to the bushel.`}
    >
      <path d={`M${x0 - 20} ${y0 + 52} Q ${x0 - 30} ${y0 - 6} ${x0 + 20} ${y0 - 2} L ${x0 + perRow * w} ${y0 + 30} Q ${x0 + perRow * w + 22} ${y0 + 52} ${x0 + perRow * w} ${y0 + 74} L ${x0 + 20} ${y0 + 106} Q ${x0 - 30} ${y0 + 110} ${x0 - 20} ${y0 + 52} Z`} fill="#f4efe0" stroke="#d8ccaa" />
      {cells}
      <text className="ax" x={x0 - 26} y={y0 + 126}>
        base
      </text>
      <text className="ax ax-e" x={x0 + perRow * w + 20} y={y0 + 126}>
        tip: pale kernels never set
      </text>
    </svg>
  );
}

function SinkSource({ r }: { r: SeasonResult }) {
  const x = scale(0, 300, 210, 620);
  const rows = [
    { label: 'What the kernels could hold', v: r.sink, color: GRAPHIC.gold, limit: kernelLimited(r) },
    { label: 'What the canopy supplied', v: r.source, color: GRAPHIC.teal, limit: !kernelLimited(r) },
  ];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 86"
      role="img"
      aria-label={`The kernels could hold ${fmt(r.sink)} bushels an acre and the canopy supplied ${fmt(r.source)}; the yield is the smaller, ${fmt(r.yield)}.`}
    >
      {rows.map((row, i) => (
        <g key={i}>
          <text className="ax ax-e" x={200} y={24 + i * 34}>
            {row.label}
          </text>
          <rect x={x(0)} y={10 + i * 34} width={x(Math.min(300, row.v)) - x(0)} height={20} fill={row.color} opacity={row.limit ? 0.9 : 0.35} />
          <text className="lab" x={x(Math.min(300, row.v)) + 6} y={25 + i * 34}>
            {fmt(row.v)} bu/ac{row.limit ? ' · the limit' : ''}
          </text>
        </g>
      ))}
      <line className="cur" x1={x(r.yield)} x2={x(r.yield)} y1={4} y2={74} />
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('components', { season: 'reference' as SeasonKey, population: 32000, spell: 'off' as Spell, start: dayOf(6, 1) });
  const year = SEASONS[s.state.season].year;
  const spellOn = s.state.spell === 'on';
  const r = useMemo(() => grow(year, s.state.population, spellOn ? s.state.start : null), [year, s.state.population, spellOn, s.state.start]);
  const noSpell = useMemo(() => (spellOn ? grow(year, s.state.population) : null), [year, s.state.population, spellOn]);
  const solved = useMemo(() => thinnerSolved(s.state.season, s.state.population, s.state.spell), [s.state.season, s.state.population, s.state.spell]);
  const usual = useMemo(() => (solved ? grow(year, 32000) : null), [solved, year]);
  const refThin = useMemo(() => (solved ? grow(REFERENCE_YEAR, s.state.population) : null), [solved, s.state.population]);
  const headroom = useMemo(() => kernelHeadroom(), []);

  const f = useScenario('forecast', { truth: 'reference' as 'reference' | 'drought' | 'bumper', known: dayOf(5, 1) });
  const truthYear = SEASONS[f.state.truth].year;
  const outcomes = useMemo(() => {
    const kw = simulatedYear(truthYear, 'prairie');
    return Array.from({ length: N_SEASONS }, (_, i) =>
      simulateSeason(spliceWeather(kw, simulatedYear(i + 1, 'prairie'), f.state.known), {
        crop: 'corn',
        plantDay: dayOf(5, 1),
        maturityGdd: PRAIRIE.hybridGdd,
        pawIn: PRAIRIE.pawIn,
        startWater: PRAIRIE.springWater,
      }).yield,
    );
  }, [truthYear, f.state.known]);
  const d = describe(outcomes);
  const actual = useMemo(() => grow(truthYear, 32000).yield, [truthYear]);
  const below150 = outcomes.filter((v) => v < 150).length / outcomes.length;

  return (
    <LessonPage id="agriculture/1.5">
      <P>
        Over four lessons we’ve put light, temperature, nutrients and water into the model of Cedar Bend’s corn, and each time a yield came out at the end: 188
        bushels an acre in the reference season, less when something ran short. This lesson opens that number up. Where, physically, does a yield come from, and
        when in the summer is it decided?
      </P>
      <P>
        Every bushel is a count of kernels and a weight per kernel. Agronomists and crop scouts use exactly this to estimate a field’s yield in August, weeks before
        harvest: they count the <K tone="gold">ears</K> in a measured stretch of row, count the rows of kernels and the kernels in each row on a sample of ears,
        and divide by an assumed number of kernels in a bushel, usually somewhere around 90,000:
      </P>
      <Eq label="Yield from its components">
        <span>bushels per acre</span>
        <Op>=</Op>
        <Frac top={<span>ears per acre × kernels per ear</span>} bottom={<span>kernels per bushel</span>} />
      </Eq>
      <P>
        The two halves of that fraction are decided at different times. The number of <K tone="gold">kernels per ear</K> is settled in the few weeks around
        silking. Each kernel needs a silk pollinated and then a steady supply of sugar in its first days, and a plant that is short of water, too hot, or simply
        growing slowly then aborts the kernels it can’t support, starting at the tip of the ear. In our model, kernel set follows how fast each plant grows from about
        a week before silking to two weeks after, and how close that growth comes to what its light allows. The <K tone="teal">weight</K> of each kernel is settled
        later, during grain fill, by how much sugar the canopy makes — plus what the stalks can give back — divided among the kernels that set, up to the most a
        kernel can hold. In the next demonstration, choose a season from the model’s simulated history and a plant population, and leave the dry spell off for now:
      </P>

      <Figure name="Crop Yield Model" scenario={s}>
        <Segmented
          label="Season"
          value={s.state.season}
          onChange={(v) => s.set({ season: v })}
          options={(Object.keys(SEASONS) as SeasonKey[]).map((k) => ({ value: k, label: SEASONS[k].label }))}
        />
        <Ear r={r} />
        <SinkSource r={r} />
        <Eq label="This season's yield from its components">
          <Frac top={<span>{fmt(r.ears)} ears × {fmt(r.kernelsPerEar)} kernels</span>} bottom={<span>{fmt(r.kernelsPerBu)} kernels per bushel</span>} />
          <Op>=</Op>
          <K tone="gold">{buAc(r.yield)}</K>
        </Eq>
        <Readouts
          items={[
            { label: 'silking', value: dateLabel(r.stageDays[4]) },
            { label: 'kernel set', value: `${fmt(r.setIndex * 100)}% of potential`, tone: 'gold' },
            ...(noSpell ? [{ label: 'the dry spell’s effect', value: `${signed(r.yield - noSpell.yield)} bu/ac`, tone: 'red' as const }] : []),
          ]}
        />
        <Slider
          label="Plant population"
          tone="gold"
          value={s.state.population}
          min={16000}
          max={44000}
          step={1000}
          onChange={(v) => s.set({ population: v })}
          display={`${fmt(s.state.population)} plants/ac`}
        />
        <Segmented
          label="Dry spell"
          value={s.state.spell}
          onChange={(v) => s.set({ spell: v })}
          options={[
            { value: 'off', label: 'None' },
            { value: 'on', label: 'Two weeks without rain' },
          ]}
        />
        <Slider
          label="Dry spell starts"
          tone="red"
          value={s.state.start}
          min={dayOf(5, 15)}
          max={dayOf(9, 1)}
          disabled={!spellOn}
          onChange={(v) => s.set({ start: v })}
          display={spellOn ? dateLabel(s.state.start) : 'no dry spell'}
        />
      </Figure>

      <P>
        In the reference season, with Cedar Bend’s usual 32,000 plants an acre, about 31,000 ears carry 538 kernels each, and the kernels fill to 88,800 to the
        bushel: 188 bushels an acre. The kernels could have held 232 bushels if every one had filled completely, so the limit that season was the canopy’s supply of
        sugar in August, not the number of kernels.
      </P>
      <P>
        Now step through the other seasons. The <b>dry August</b> set plenty of kernels, 553 an ear, but couldn’t fill them: they came in light, 120,200 to the
        bushel, and the field made 143. The <b>hot July</b> did the opposite. Heat and dry air around silking left only 460 kernels an ear, but a cool, wet August
        filled those few close to the maximum, 78,500 to the bushel, and the field recovered to 182. A crop can make up for lost kernels with heavier ones, up to a
        point; it can never add kernels after silking. The <b>drought</b> took both: 358 kernels an ear, filled to only 145,500 a bushel, for 76. And the{' '}
        <b>bumper</b> season, mild at silking with a cool, sunny August, set 550 kernels an ear and filled them to 73,300 a bushel, for 233. Silking sets the ceiling;
        grain fill decides how close the crop comes to it.
      </P>
      <P>
        So which matters more? In our model, almost always grain fill. At Cedar Bend’s 32,000 plants an acre, the kernels could hold more than the
        canopy supplied in {headroom.kernelLimited === 0 ? `all ${N_SEASONS}` : `${N_SEASONS - headroom.kernelLimited} of the ${N_SEASONS}`} of the model’s
        simulated seasons — in the typical one, about {fmt(Math.round((headroom.median - 1) * 20) * 5)}% more. So kernels lost around silking are mostly made up by
        heavier ones, as in the hot July, while sugar lost in grain fill comes straight off the yield, as in the dry August. Real cornfields are less forgiving at
        pollination than our model, which averages kernel set over three weeks: a few days of severe drought or heat at exactly the wrong moment can leave ears
        with only scattered kernels. That is one reason everyone who follows corn — farmers, elevators and traders — watches the weather around silking so closely.
      </P>
      <P>
        We can put that to the test with a <K tone="red">dry spell</K>. In this demonstration, choose the reference season, turn on two weeks without rain —
        under clear skies, with hotter afternoons — and move its start. Starting June 1, it costs nothing: the soil is full, and the rains later in June refill
        most of what the crop draws. Starting July 10, a week before silking, it costs {fmt(REF_RUN.yield - SPELL_AT.july10.yield)} bushels; starting August 1,{' '}
        {fmt(REF_RUN.yield - SPELL_AT.aug1.yield)}; and from about August 25, with two-thirds of the grain already in and the canopy fading, nothing at all. Watch
        the kernels as you go. They hardly change, and the spell a week before silking even adds a few dozen to each ear ({fmt(SPELL_AT.july10.kernelsPerEar)}{' '}
        against {fmt(REF_RUN.kernelsPerEar)}), because its first clear, sunny days come while the deep soil still holds plenty of water. Every bushel lost is lost
        as lighter kernels: Cedar Bend’s 11 inches of soil carry the crop through the weeks around silking, and the water the spell took is missed later, in grain
        fill. When a dry spell does the most harm turns out to be a story about the soil, which <a href={lessonHref('agriculture/3.2')}>Lesson 3.2</a> follows
        date by date. What does cut kernel number in our model is stress inside the window itself: heat and dry air at pollination, as in the hot July, or a root
        zone already empty when silking comes, as in the drought.
      </P>

      <Challenge
        id="a"
        question="Cedar Bend could save seed by planting about a tenth fewer plants, 29,000 an acre. Predict first, from the two bars in each season at the usual 32,000: in which season would the thinner stand leave the kernels, rather than the canopy, setting the yield? Then, with no dry spell, lower the population to about 29,000 and leave the figure on that season."
        solved={solved}
        status={
          spellOn
            ? 'Turn the dry spell off.'
            : s.state.population > THIN.to
              ? `${fmt(s.state.population)} plants an acre. Compare each season’s bars and make your prediction, then lower the population to about 29,000.`
              : s.state.population < THIN.from
                ? `${fmt(s.state.population)} plants is more than a tenth fewer. Set about 29,000.`
                : `At ${fmt(s.state.population)} plants, the canopy still sets the yield in the ${SEASONS[s.state.season].name}. Which season had the least to spare?`
        }
        success={`Solved: at 32,000 plants the bumper season’s kernels could hold only ${fmt(SPARE.bumper * 100)}% more than its canopy supplied, the smallest margin of the five, so a tenth fewer plants leaves them the limit: at ${fmt(s.state.population)} they hold ${fmt(r.sink)} bushels while the canopy could have filled ${fmt(r.source)}, and the field makes ${fmt(r.yield)} instead of ${fmt(usual?.yield ?? 0)}. The hot July had ${fmt(SPARE.hotJuly * 100)}% to spare and the reference season ${fmt(SPARE.reference * 100)}%; with fewer plants each ear sets more kernels, so their canopies still set the yield, and the reference season gives up only ${fmt(REF_RUN.yield - (refThin?.yield ?? REF_RUN.yield), 1)} bushels. The extra plants are insurance that pays most in the best years. Where to plant on that trade-off is one of the first decisions in the next chapter.`}
      />

      <P>
        Winter wheat’s yield forms the same way, on its own calendar: heads per acre, kernels per head, and the weight of each kernel. Its kernels are set around
        flowering, which on the Black Prairie comes at the end of May, and they fill through June. A freeze while the heads are forming or flowering kills flowers
        that would have become kernels; heat above about 32 °C weakens pollination at flowering and cuts the kernels’ fill after it. We’ll put the wheat through
        both in <a href={lessonHref('agriculture/3.2')}>Lesson 3.2</a>. In the reference season, Cedar Bend’s wheat made {fmt(WHEAT_REF.yield)} bushels an acre,
        of 60 pounds each.
      </P>

      <H2>A yield is a distribution</H2>
      <P>
        Everything so far has been one season at a time, with the weather known in advance. On May 1, when Cedar Bend plants, nobody knows the weather. What the
        farmer can know is everything the model knows about how the weather <i>might</i> go. So instead of one season, we grow the same field, planted the same way,
        through the summers of all 200 simulated years, and look at the spread of outcomes: a probabilistic estimate of the harvest. And as the summer actually
        unfolds, we can do the same thing again with the weather so far fixed and only the rest of the season unknown. In the next demonstration, choose which
        season is really happening and how far into it we are; each bar counts how many of the 200 possible endings give that yield:
      </P>

      <Figure name="Crop Yield Model · many seasons" scenario={f}>
        <Segmented
          label="The season that is really happening"
          value={f.state.truth}
          onChange={(v) => f.set({ truth: v })}
          options={[
            { value: 'reference', label: 'Reference' },
            { value: 'drought', label: 'Drought' },
            { value: 'bumper', label: 'Bumper' },
          ]}
        />
        <HistogramChart
          values={outcomes}
          lo={40}
          hi={260}
          bins={44}
          color={CROP_LINE.corn}
          xTicks={[50, 100, 150, 200, 250]}
          xFormat={(v) => fmt(v)}
          xLabel="final corn yield, bushels per acre"
          yLabel={`Possible endings, of ${N_SEASONS}`}
          marks={[
            { x: d.mean, label: `average ${fmt(d.mean)}`, color: '#333' },
            { x: actual, label: `what actually happens, ${fmt(actual)}`, color: GRAPHIC.red, dash: '4 3', row: 1 },
          ]}
          highlight={(_, b1) => b1 <= 150}
          ariaLabel={`Corn yields at Cedar Bend in ${N_SEASONS} possible endings to the season, knowing the weather up to ${dateLabel(f.state.known, true)}. Average ${fmt(d.mean)} bushels; the middle half lie between ${fmt(d.q25)} and ${fmt(d.q75)}. The season actually ends at ${fmt(actual)}.`}
        />
        <Readouts
          items={[
            { label: 'middle half', value: `${fmt(d.q25)}–${fmt(d.q75)} bu/ac` },
            { label: '1 in 20 worse than', value: buAc(d.q05), tone: 'red' },
            { label: 'chance below 150', value: `${fmt(below150 * 100)}%`, tone: 'red' },
          ]}
        />
        <Slider
          label="Weather known up to"
          value={f.state.known}
          min={dayOf(5, 1)}
          max={dayOf(9, 15)}
          step={1}
          onChange={(v) => f.set({ known: v })}
          display={dateLabel(f.state.known)}
        />
      </Figure>

      <P>
        On May 1 the field’s prospects span every summer the model can throw at it: an average of 176 bushels, the middle half of outcomes between 160 and 195, and
        a 1-in-20 chance of worse than 131. That spread is the risk every farmer carries into the summer. Then, in the reference season, the weather is kind. By
        August 1 the average outcome has risen to 190, and the chance of a poor crop — under 150 bushels — has fallen from 18% to under 1%; by
        mid-September the average is 188, pinned to what actually happened.
      </P>
      <P>
        Switch to the drought. Through May it looks like any other season. By July 1 the average has slipped to 154; by July 15, with silking under way in the heat, it
        is 132; by August 1, 99. Every one of those weeks is news. Somewhere a grain buyer, a feed mill and a futures trader are each reading the same weather and
        redrawing the same distribution, and the price they’re willing to pay for next winter’s corn moves with it. The bumper season moves the other way, from 176 to
        202 by August 1 and 233 in the end.
      </P>
      <P>
        That is the central fact of this course in its first form: a harvest is uncertain right up until it happens, and the uncertainty resolves on a schedule set by
        the plant — slowly in spring, fast from flowering through the first weeks of grain fill, and almost completely by the time the kernels are full. We’ll come back to these distributions in{' '}
        <a href={lessonHref('agriculture/3.5')}>Chapter 3</a>, for the whole valley, and to how they move prices in Chapter 5. First, though, the farm itself. A
        yield is biology, but how many acres get planted, with how much fertilizer, harvested when, is economics — and in{' '}
        <FigRef to="Crop Yield Model">the yield model</FigRef> the population was just a slider. The next chapter turns these levers into decisions.
      </P>
    </LessonPage>
  );
}
