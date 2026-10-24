import { useMemo } from 'react';
import {
  Challenge,
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
  TEXT,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { CORN_ON_CORN_EXTRA_N, CORN_ON_CORN_PENALTY, WHEAT_ON_WHEAT_PENALTY, YEARS, cropMix, expectedYieldByPlantDay, isWorkable, plantingRun, type MixResult } from '../../../engines/agriculture/farm';
import { REFERENCE_YEAR, simulatedYear } from '../../../model/agriculture/climate';
import { PLAN_PRICE } from '../../../model/agriculture/economics';
import { dateLabel, dayOf, type DistrictId } from '../../../model/agriculture/region';
import { DayChart, type DayBand } from '../shared/DayChart';
import { buAc, perAcre, perBu } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

const FARM_ACRES = 1600;
const SHARES = Array.from({ length: 21 }, (_, i) => i * 0.05);

type Place = DistrictId | 'plainsIrrigated';
const PLACES: Array<{ value: Place; label: string }> = [
  { value: 'north', label: 'North' },
  { value: 'plains', label: 'Plains' },
  { value: 'plainsIrrigated', label: 'Plains, irrigated' },
  { value: 'prairie', label: 'Prairie' },
  { value: 'ridge', label: 'Ridge' },
  { value: 'bottoms', label: 'Bottoms' },
];
const districtOf = (p: Place): DistrictId => (p === 'plainsIrrigated' ? 'plains' : p);

/** Expected farm return over variable costs for every corn share, 0–100% in 5% steps. */
export function mixCurve(place: Place, prices: { corn: number; wheat: number }): MixResult[] {
  return SHARES.map((s) => cropMix(districtOf(place), FARM_ACRES, s, prices, place === 'plainsIrrigated'));
}

/** The challenge: the lowest corn price (10¢ steps) at which all corn beats a 50–50 rotation on the Black Prairie, wheat at $6. */
export function allCornSolved(place: Place, corn: number, wheat: number): boolean {
  if (place !== 'prairie' || Math.abs(wheat - 6) > 1e-6) return false;
  const beats = (p: number) => cropMix('prairie', FARM_ACRES, 1, { corn: p, wheat }).mean > cropMix('prairie', FARM_ACRES, 0.5, { corn: p, wheat }).mean;
  return beats(corn) && !beats(Math.round((corn - 0.1) * 100) / 100);
}

const PLANTERS = [
  { value: '8', label: '8-row', perDay: 90 },
  { value: '12', label: '12-row', perDay: 135 },
  { value: '16', label: '16-row', perDay: 180 },
  { value: '24', label: '24-row', perDay: 270 },
] as const;
type Planter = (typeof PLANTERS)[number]['value'];
const CORN_ACRES = 1000;
const WET_SPRING = 3;
const DEADLINE = dayOf(6, 20);

/** Planting Cedar Bend's corn from `start` at `perDay` acres per workable day in every simulated spring. */
export function plantingStats(start: number, perDay: number) {
  const ey = expectedYieldByPlantDay('prairie');
  let best = 0;
  for (let d = dayOf(4, 5); d <= DEADLINE; d++) best = Math.max(best, ey(d));
  const finish: number[] = [];
  const lost: number[] = [];
  for (const y of YEARS) {
    const r = plantingRun(simulatedYear(y, 'prairie'), start, CORN_ACRES, perDay, DEADLINE);
    finish.push(r.finished >= 0 ? r.finished : DEADLINE);
    const left = CORN_ACRES - r.cumulative[r.cumulative.length - 1];
    lost.push(r.daily.reduce((s, a, i) => s + a * (best - ey(start + i)), 0) + left * (best - ey(DEADLINE)));
  }
  const fs = [...finish].sort((a, b) => a - b);
  const ls = [...lost].sort((a, b) => a - b);
  return {
    best,
    medianFinish: fs[Math.floor(0.5 * (fs.length - 1))],
    lateFinish: fs[Math.floor(0.9 * (fs.length - 1))],
    meanLost: lost.reduce((s, x) => s + x, 0) / lost.length,
    worstLost: ls[ls.length - 1],
  };
}

function MixChart({ curve, share, place }: { curve: MixResult[]; share: number; place: Place }) {
  const means = curve.map((r) => r.mean / FARM_ACRES);
  const p10s = curve.map((r) => r.p10 / FARM_ACRES);
  const [lo, hi] = niceDomain(Math.min(0, ...p10s), Math.max(...means), 4);
  const x = scale(0, 1, 70, 610);
  const y = scale(lo, hi, 210, 30);
  const i = Math.round(share * 20);
  const bestI = means.reduce((a, m, k) => (m > means[a] ? k : a), 0);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 250"
      role="img"
      aria-label={`Expected return over variable costs for a 1,600-acre farm in ${PLACES.find((p) => p.value === place)!.label}, by share of corn. At ${fmt(share * 100)}% corn it is ${usd(means[i])} an acre on average, and ${usd(p10s[i])} in a 1-in-10 bad season. The best average is at ${fmt(SHARES[bestI] * 100)}% corn.`}
    >
      <text className="ax" x={70} y={14}>
        Return over variable costs, $ per acre
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={70} x1={610} format={(v) => usd(v)} baseline={0} />
      <path d={linePath(SHARES.map(x), p10s.map(y))} fill="none" stroke={GRAPHIC.red} strokeWidth={2} strokeDasharray="6 4" />
      <path d={linePath(SHARES.map(x), means.map(y))} fill="none" stroke={TEXT.green} strokeWidth={2.5} />
      <line className="cur" x1={x(share)} x2={x(share)} y1={26} y2={210} />
      <circle cx={x(share)} cy={y(means[i])} r={5.5} fill={TEXT.green} stroke="#fcfcfb" strokeWidth={2} />
      <circle cx={x(share)} cy={y(p10s[i])} r={4.5} fill={GRAPHIC.red} stroke="#fcfcfb" strokeWidth={2} />
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={228}>
          {fmt(v * 100)}%
        </text>
      ))}
      <text className="ax ax-e" x={610} y={246}>
        share of the farm in corn (the rest in wheat)
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('mix', { place: 'prairie' as Place, share: 0.6, corn: PLAN_PRICE.corn, wheat: PLAN_PRICE.wheat });
  const { place, share, corn, wheat } = s.state;
  const prices = useMemo(() => ({ corn, wheat }), [corn, wheat]);
  const curve = useMemo(() => mixCurve(place, prices), [place, prices]);
  const now = curve[Math.round(share * 20)];
  const solved = useMemo(() => allCornSolved(place, corn, wheat), [place, corn, wheat]);
  const half = curve[10];
  const all = curve[20];

  const p = useScenario('planting', { planter: '16' as Planter, season: 'reference' as 'reference' | 'wet', start: dayOf(4, 25) });
  const perDay = PLANTERS.find((x) => x.value === p.state.planter)!.perDay;
  const year = p.state.season === 'reference' ? REFERENCE_YEAR : WET_SPRING;
  const weather = useMemo(() => simulatedYear(year, 'prairie'), [year]);
  const run = useMemo(() => plantingRun(weather, p.state.start, CORN_ACRES, perDay, DEADLINE), [weather, p.state.start, perDay]);
  const stats = useMemo(() => plantingStats(p.state.start, perDay), [p.state.start, perDay]);
  const ey = expectedYieldByPlantDay('prairie');
  const runDays = run.daily.map((_, i) => p.state.start + i);
  const bands: DayBand[] = [];
  for (let d = dayOf(4, 1); d <= DEADLINE; d++) {
    if (isWorkable(weather, d)) {
      const last = bands[bands.length - 1];
      if (last && last.to === d) last.to = d + 1;
      else bands.push({ from: d, to: d + 1, color: 'rgba(109, 156, 55, .16)' });
    }
  }
  const curveDays = Array.from({ length: DEADLINE - dayOf(4, 1) + 1 }, (_, i) => dayOf(4, 1) + i);

  return (
    <LessonPage id="agriculture/2.1">
      <P>
        Chapter 1 ended with a yield as a distribution: on the day Cedar Bend plants, the harvest it will bring is a spread of possibilities that the summer slowly
        narrows. This chapter asks what a farm — and from there a whole region — does with that knowledge. How much food the Crane Valley produces isn’t only a matter
        of what its soils and weather allow. It’s a matter of what its farmers find worth planting, at the prices they expect to be paid and the costs they expect to
        pay. Those prices are simulated, like everything in this course; for now we’ll take them as given — corn at {perBu(PLAN_PRICE.corn)} at harvest, wheat at{' '}
        {perBu(PLAN_PRICE.wheat)} — and Chapter 5 will show where they come from.
      </P>
      <P>
        The first decision is what to plant where. Some of a farm’s costs are owed whatever it plants: the rent on the land, the machinery in the shed, the people who
        run it. So the comparison between crops is made on the <K tone="green">return over variable costs</K>: revenue, minus the seed, fertilizer, chemicals, fuel,
        insurance and interest that the crop itself needs, minus the hauling and drying that scale with the bushels. Corn costs about $412 an acre to grow on top of
        the land and machinery; wheat about $201. Corn yields about two and a half times as many bushels.
      </P>
      <P>
        One more thing ties the two crops together. A field that grew corn last year carries over the corn’s pests and diseases, and corn planted there again yields
        less — in our model {fmt(CORN_ON_CORN_PENALTY * 100)}% less, and it needs {CORN_ON_CORN_EXTRA_N} more pounds of nitrogen. Wheat after wheat loses{' '}
        {fmt(WHEAT_ON_WHEAT_PENALTY * 100)}% for the same reason. Alternating the two — a <K tone="teal">rotation</K> — avoids both penalties as long as neither crop
        is more than half the farm. In the next demonstration, a 1,600-acre farm splits its land between corn and wheat; the green curve is its expected return over
        variable costs, averaged over the 200 seasons of the model’s history, for every split, and the dashed red curve is a 1-in-10 bad season. Choose a district,
        the split and the prices:
      </P>

      <Figure name="Farm Planner" scenario={s}>
        <Segmented label="District" value={place} onChange={(v) => s.set({ place: v })} options={PLACES} />
        <MixChart curve={curve} share={share} place={place} />
        <Legend
          items={[
            { label: 'Average season', color: TEXT.green, kind: 'line' },
            { label: '1-in-10 bad season', color: GRAPHIC.red, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'farm return, average season', value: usd(now.mean), tone: 'green' },
            { label: 'per acre', value: perAcre(now.mean / FARM_ACRES), tone: 'green' },
            { label: 'per acre, 1-in-10 bad season', value: perAcre(now.p10 / FARM_ACRES), tone: 'red' },
            { label: 'corn, average yield', value: now.cornAcres ? buAc(now.cornYield) : '—', tone: 'gold' },
            { label: 'wheat, average yield', value: now.wheatAcres ? buAc(now.wheatYield) : '—', tone: 'orange' },
          ]}
        />
        <Slider label="Corn share" tone="gold" value={share} min={0} max={1} step={0.05} onChange={(v) => s.set({ share: Math.round(v * 20) / 20 })} display={`${fmt(share * 100)}% · ${fmt(now.cornAcres)} acres`} />
        <Slider label="Corn price" tone="green" value={corn} min={3} max={6.5} step={0.1} onChange={(v) => s.set({ corn: Math.round(v * 10) / 10 })} display={perBu(corn)} />
        <Slider label="Wheat price" tone="green" value={wheat} min={4} max={8} step={0.1} onChange={(v) => s.set({ wheat: Math.round(v * 10) / 10 })} display={perBu(wheat)} />
      </Figure>

      <P>
        On the Black Prairie an acre of corn returns $357 over its variable costs in an average season and an acre of wheat $195. Corn wins easily — but only up to
        half the farm. Beyond that the extra corn goes onto last year’s corn ground, and the rotation penalty makes the curve turn down: a 50–50 split averages $276
        an acre, all corn $256. Cedar Bend’s own split of 1,000 acres of corn and 600 of wheat sits just past the peak, at $271. In the River Bottoms the story is the
        same. In the North Tier and on the Upland Ridge, where corn yields less, an acre of corn and an acre of wheat return almost the same — $189 and $185 in the
        North — and the rotation alone decides the split. On the dry High Plains, unirrigated corn loses $79 an acre on average while wheat returns $134, so the best
        plan is all wheat; with wells, irrigated corn returns $208 and a 50–50 rotation is best again. The valley’s land use follows: mostly wheat on the Plains, its
        corn almost all irrigated, roughly half and half elsewhere, tilting toward corn on the best ground.
      </P>
      <P>
        The dashed curve tells a second story. Corn and wheat grow in different months, so a bad corn summer and a bad wheat spring don’t usually come together —
        across the 200 seasons their yields on the Prairie are only loosely correlated. A farm with both crops has better bad years: on the Prairie, the 1-in-10
        season returns $190 an acre at 50–50 against $103 for all corn.
      </P>

      <Challenge
        id="a"
        question="On the Black Prairie, with wheat at $6.00, raise the corn price. What is the lowest corn price, in 10-cent steps, at which planting all corn earns more on average than a 50–50 rotation?"
        solved={solved}
        status={
          place !== 'prairie'
            ? 'Choose the Black Prairie.'
            : Math.abs(wheat - 6) > 1e-6
              ? `Wheat is at ${perBu(wheat)}. Set it to $6.00.`
              : all.mean > half.mean
                ? `At ${perBu(corn)}, all corn averages ${perAcre(all.mean / FARM_ACRES)} against ${perAcre(half.mean / FARM_ACRES)} for 50–50. Is there a lower price where it still wins?`
                : `At ${perBu(corn)}, all corn averages ${perAcre(all.mean / FARM_ACRES)} against ${perAcre(half.mean / FARM_ACRES)} for 50–50.`
        }
        success={`Solved: at ${perBu(corn)} all corn averages ${perAcre(all.mean / FARM_ACRES)} an acre and a 50–50 rotation ${perAcre(half.mean / FARM_ACRES)}. When corn is dear enough relative to wheat, the rotation penalty is worth paying, and farmers shift acres to corn. That response — more acres of a crop when its price rises — is the beginning of a supply curve, and we’ll meet it again when prices are set in Chapter 5.`}
      />

      <H2>Getting the crop in</H2>
      <P>
        Deciding to plant 1,000 acres of corn is one thing; planting them is another. A planter can only run on days when the soil is dry enough to work and warm
        enough for seed — not in the rain, and not for a day or two after a soaking. And, as <a href={lessonHref('agriculture/1.2')}>Lesson 1.2</a> showed, corn
        planted late runs its grain fill into the cooler, darker weeks of autumn and risks being stopped by the first cold spell. Averaged over the model’s 200
        seasons, the expected Prairie yield is nearly flat for anything planted from mid-April to mid-May, about 176 bushels, then falls: 172.5 for corn planted May
        25, 164.6 on June 4, 148.5 on June 14.
      </P>
      <P>
        In the next demonstration, Cedar Bend plants its 1,000 acres of corn with a choice of planter, starting on a date you choose. The shaded days are the ones the
        planter can run; the gold line is the acres planted so far, and the gray line underneath is the expected yield for each planting date. Try the reference
        season and a wet spring from the history:
      </P>

      <Figure name="Farm Planner · planting schedule" scenario={p}>
        <Segmented label="Planter" value={p.state.planter} onChange={(v) => p.set({ planter: v })} options={PLANTERS.map((x) => ({ value: x.value, label: `${x.label} · ${x.perDay} ac/day` }))} />
        <Segmented
          label="Spring"
          value={p.state.season}
          onChange={(v) => p.set({ season: v })}
          options={[
            { value: 'reference', label: 'Reference season' },
            { value: 'wet', label: 'A wet spring' },
          ]}
        />
        <DayChart
          days={runDays}
          series={[{ values: run.cumulative, color: CROP_LINE.corn, width: 2.5 }]}
          from={dayOf(4, 1)}
          to={DEADLINE}
          yMin={0}
          yMax={1000}
          yTicks={[0, 250, 500, 750, 1000]}
          yLabel="Acres of corn planted"
          yFormat={(v) => fmt(v)}
          bands={bands}
          marks={[{ day: p.state.start, label: 'start' }]}
          height={190}
          ariaLabel={`Planting 1,000 acres of corn at ${perDay} acres a day from ${dateLabel(p.state.start)} in ${p.state.season === 'reference' ? 'the reference season' : 'a wet spring'}: ${run.finished >= 0 ? `finished on ${dateLabel(run.finished)}` : `${fmt(run.cumulative[run.cumulative.length - 1])} acres planted by June 20`}, on ${run.workableDays} workable days.`}
        />
        <DayChart
          days={curveDays}
          series={[{ values: curveDays.map((d) => ey(d)), color: '#777', width: 2 }]}
          from={dayOf(4, 1)}
          to={DEADLINE}
          yMin={140}
          yMax={180}
          yTicks={[140, 150, 160, 170, 180]}
          yLabel="Expected corn yield by planting date, bu/ac"
          yFormat={(v) => fmt(v)}
          height={150}
          ariaLabel="Expected corn yield on the Black Prairie by planting date, averaged over 200 simulated seasons: about 176 bushels through mid-May, falling to 148.5 by mid-June."
        />
        <Legend
          items={[
            { label: 'Days the planter can run', color: 'rgba(109, 156, 55, .35)' },
            { label: 'Acres planted', color: CROP_LINE.corn, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'this spring, finished', value: run.finished >= 0 ? dateLabel(run.finished) : 'not by June 20', tone: 'gold' },
            { label: 'over 200 springs, median finish', value: dateLabel(stats.medianFinish) },
            { label: '1-in-10 latest finish', value: dateLabel(stats.lateFinish), tone: 'red' },
            { label: 'bushels lost to late planting, average', value: fmt(stats.meanLost), tone: 'red' },
            { label: 'worst spring', value: `${fmt(stats.worstLost)} bu`, tone: 'red' },
          ]}
        />
        <Slider label="Start planting" value={p.state.start} min={dayOf(4, 10)} max={dayOf(5, 20)} onChange={(v) => p.set({ start: v })} display={dateLabel(p.state.start)} />
      </Figure>

      <P>
        Starting April 25 with the 16-row planter, Cedar Bend finishes on May 10 in the reference season, after six days of planting. The 8-row planter needs twelve
        workable days and finishes May 21. In the wet spring the field days come in ones and twos between storms: by June 20 the 8-row planter has found only eight
        of them and still has 280 acres to go, and even the 16-row isn’t done until May 30. Averaged over every spring, though, the bigger planter saves surprisingly
        little. Measured against planting everything in the best week, the 8-row loses about 676 bushels a year to late planting and the 24-row about 212 — a
        difference worth about $2,100 at $4.60. The difference lives in the bad springs: in the worst of the 200, the 8-row loses 13,017 bushels and the 24-row
        1,033. Machinery capacity is a kind of insurance, and whether it’s worth its cost is a question of marginal returns, which is where we go next.
      </P>

      <P>
        A region’s output, then, is the sum of thousands of these decisions: which crop on which ground, given its soil, its climate and the prices of both crops; and
        how much machinery to keep for the days the weather allows. In <FigRef to="Farm Planner">the planner</FigRef> every acre got the same seed, fertilizer and
        water. The next lesson asks how much of each to use — and finds that the answer is rarely “as much as the crop can use.”
      </P>
    </LessonPage>
  );
}

