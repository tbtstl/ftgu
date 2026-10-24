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
  useScenario,
} from '../../../framework';
import { CROP, simulateSeason, type SeasonResult } from '../../../engines/agriculture/crop';
import { describe } from '../../../engines/strategy/distribution';
import { REFERENCE_YEAR, simulatedYear, spliceWeather } from '../../../model/agriculture/climate';
import { DISTRICT, dateLabel, dayOf } from '../../../model/agriculture/region';
import { HistogramChart } from '../shared/HistogramChart';
import { buAc } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

const PRAIRIE = DISTRICT.prairie;
const SEASONS = {
  reference: { year: REFERENCE_YEAR, label: 'Reference' },
  bumper: { year: 180, label: 'Bumper' },
  hotJuly: { year: 133, label: 'Hot July' },
  dryAugust: { year: 111, label: 'Dry August' },
  drought: { year: 46, label: 'Drought' },
} as const;
type SeasonKey = keyof typeof SEASONS;
const MAX_KPB = CROP.corn.minKernelsPerBu;
const N_SEASONS = 200;

function grow(year: number, population: number): SeasonResult {
  return simulateSeason(simulatedYear(year, 'prairie'), {
    crop: 'corn',
    plantDay: dayOf(5, 1),
    maturityGdd: PRAIRIE.hybridGdd,
    pawIn: PRAIRIE.pawIn,
    startWater: PRAIRIE.springWater,
    population,
  });
}

const kernelLimited = (r: SeasonResult) => r.sink <= r.source + 1e-9;

/** The challenge: in the bumper season, the highest population (in steps of 1,000) at which the kernels limit the yield. */
export function bumperSolved(season: SeasonKey, population: number): boolean {
  if (season !== 'bumper') return false;
  return kernelLimited(grow(SEASONS.bumper.year, population)) && !kernelLimited(grow(SEASONS.bumper.year, population + 1000));
}

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
  const s = useScenario('components', { season: 'reference' as SeasonKey, population: 32000 });
  const r = useMemo(() => grow(SEASONS[s.state.season].year, s.state.population), [s.state]);
  const solved = useMemo(() => bumperSolved(s.state.season, s.state.population), [s.state]);
  const nextUp = useMemo(() => grow(SEASONS[s.state.season].year, s.state.population + 1000), [s.state]);

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
        bushels an acre in the reference season, less when something ran short. This lesson opens that number up. Where, physically, does a yield come from, and why
        does a dry week in mid-July cost so much more than a dry week in June?
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
        growing slowly then aborts the kernels it can’t support, starting at the tip of the ear. In our model, kernel set follows how fast each plant grows from just
        before silking to three weeks after, and how close that growth comes to what its light allows. The <K tone="teal">weight</K> of each kernel is settled later, during grain fill, by how much
        sugar the canopy makes — plus what the stalks can give back — divided among the kernels that set, up to the most a kernel can hold. In the next
        demonstration, choose a season from the model’s simulated history and a plant population:
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
            { label: 'kernels per bushel', value: fmt(r.kernelsPerBu), tone: 'teal' },
            { label: 'yield', value: buAc(r.yield), tone: 'gold' },
          ]}
        />
        <Slider
          label="Plant population"
          tone="teal"
          value={s.state.population}
          min={16000}
          max={44000}
          step={1000}
          onChange={(v) => s.set({ population: v })}
          display={`${fmt(s.state.population)} plants/ac`}
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
        <b>bumper</b> season, mild at silking with a cool, sunny August, set 550 kernels an ear and filled them to 73,300 a bushel, for 233. That is why everyone who follows corn — farmers,
        elevators and traders — watches the weather around silking so closely. It is the one window that decides the ceiling.
      </P>

      <Challenge
        id="a"
        question="In the bumper season, fewer plants means fewer kernels per acre. Lower the population until the kernels, not the canopy, limit the yield. What is the highest population at which every kernel fills to its maximum?"
        solved={solved}
        status={
          s.state.season !== 'bumper'
            ? 'Choose the bumper season.'
            : kernelLimited(r)
              ? `At ${fmt(s.state.population)} plants the kernels limit the yield, at ${buAc(r.yield)}. Is there a higher population where they still do?`
              : `At ${fmt(s.state.population)} plants the canopy limits the yield: the kernels could hold ${fmt(r.sink)} bushels but it supplies ${fmt(r.source)}.`
        }
        success={`Solved: at ${fmt(s.state.population)} plants the kernels could hold ${fmt(r.sink)} bushels and the canopy supplied ${fmt(r.source)}, so every kernel filled to the maximum; at ${fmt(s.state.population + 1000)}, the canopy (${fmt(nextUp.source)} bushels) runs out first. Below this point, a bumper season is wasted on too few plants. Above it, the extra kernels insure against a hot July. Where to plant on that trade-off is one of the first decisions in the next chapter.`}
      />

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
            { label: 'average outcome', value: buAc(d.mean), tone: 'gold' },
            { label: 'middle half', value: `${fmt(d.q25)}–${fmt(d.q75)}` },
            { label: '1 in 20 worse than', value: buAc(d.q05), tone: 'red' },
            { label: 'chance below 150', value: `${fmt(below150 * 100)}%`, tone: 'red' },
          ]}
        />
        <Slider
          label="Weather known up to"
          tone="blue"
          value={f.state.known}
          min={dayOf(5, 1)}
          max={dayOf(9, 15)}
          step={1}
          onChange={(v) => f.set({ known: v })}
          display={dateLabel(f.state.known)}
        />
      </Figure>

      <P>
        On May 1 the field’s prospects are the whole valley’s climate: an average of 176 bushels, the middle half of outcomes between 160 and 195, and a 1-in-20
        chance of worse than 131. That spread is the risk every farmer carries into the summer. Then, in the reference season, the weather is kind. By August 1 the
        average outcome has risen to 190 and the chance of falling below 150 has nearly vanished; by mid-September it is 188, pinned to what actually happened.
      </P>
      <P>
        Switch to the drought. Through May it looks like any other season. By July 1 the average has slipped to 154; by July 15, with silking under way in the heat, it
        is 132; by August 1, 99. Every one of those weeks is news. Somewhere a grain buyer, a feed mill and a futures trader are each reading the same weather and
        redrawing the same distribution, and the price they’re willing to pay for next winter’s corn moves with it. The bumper season moves the other way, from 176 to
        202 by August 1 and 233 in the end.
      </P>
      <P>
        That is the central fact of this course in its first form: a harvest is uncertain right up until it happens, and the uncertainty resolves on a schedule set by
        the plant — slowly in spring, fast around flowering, and almost completely by the time the kernels are full. We’ll come back to these distributions in{' '}
        <a href={lessonHref('agriculture/3.5')}>Chapter 3</a>, for the whole valley, and to how they move prices in Chapter 5. First, though, the farm itself. A
        yield is biology, but how many acres get planted, with how much fertilizer, harvested when, is economics — and in{' '}
        <FigRef to="Crop Yield Model">the yield model</FigRef> the population was just a slider. The next chapter turns these levers into decisions.
      </P>
    </LessonPage>
  );
}
