import { useMemo } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  Sub,
  fmt,
  lessonHref,
  useScenario,
} from '../../../framework';
import { BASAL, CROP, TRANSPIRATION_EFFICIENCY, et0, simulateSeason, vpd, waterLimitedGrowth, type SeasonResult } from '../../../engines/agriculture/crop';
import { REFERENCE_YEAR, applyShift, simulatedYear } from '../../../model/agriculture/climate';
import { DISTRICT, DISTRICTS, dayOf, type DistrictId } from '../../../model/agriculture/region';
import { DayChart, type DayBand } from '../shared/DayChart';
import { buAc, inch } from '../shared/format';

const PRAIRIE = DISTRICT.prairie;
const BASE = simulatedYear(REFERENCE_YEAR, 'prairie');
const FROM = dayOf(5, 1);
const TO = dayOf(9, 30);
const STRESS_LINE = 1 - CROP.corn.stressAt;

interface WaterState {
  rain: number;
  temp: number;
  paw: number;
  irrigate: 'off' | 'on';
  trigger: number;
}

function grow(st: WaterState): SeasonResult {
  return simulateSeason(applyShift(BASE, { rain: st.rain, temp: st.temp }), {
    crop: 'corn',
    plantDay: FROM,
    maturityGdd: PRAIRIE.hybridGdd,
    pawIn: st.paw,
    startWater: PRAIRIE.springWater,
    irrigation: st.irrigate === 'on' ? { trigger: st.trigger / 100, amount: 1, interval: 4 } : null,
  });
}

/** The challenge: in a 60%-rain summer, the latest irrigation trigger that keeps yield within 1% of fully watered. */
export function triggerSolved(st: WaterState): boolean {
  if (st.irrigate !== 'on' || Math.abs(st.rain - 0.6) > 1e-6 || st.temp !== 0 || st.paw !== PRAIRIE.pawIn) return false;
  const full = grow({ ...st, trigger: 20 }).yield;
  const ok = (t: number) => grow({ ...st, trigger: t }).yield >= 0.99 * full;
  return ok(st.trigger) && !ok(st.trigger + 5);
}

/** Days when the water stress factor is below 1, merged into bands. */
function stressBands(r: SeasonResult): DayBand[] {
  const out: DayBand[] = [];
  for (const d of r.days) {
    if (d.ks < 0.999 && d.dev < 1) {
      const last = out[out.length - 1];
      if (last && last.to === d.day) last.to = d.day + 1;
      else out.push({ from: d.day, to: d.day + 1, color: 'rgba(231, 91, 85, .16)' });
    }
  }
  return out;
}

export default function Lesson() {
  const s = useScenario('water', { rain: 1, temp: 0, paw: PRAIRIE.pawIn, irrigate: 'off' as 'off' | 'on', trigger: 50 });
  const st = s.state;
  const r = useMemo(() => grow(st), [st]);
  const weather = useMemo(() => applyShift(BASE, { rain: st.rain, temp: st.temp }), [st.rain, st.temp]);
  const days = r.days.map((d) => d.day);
  const solved = useMemo(() => triggerSolved(st), [st]);
  const fullRun = useMemo(() => (st.irrigate === 'on' ? grow({ ...st, trigger: 20 }) : null), [st]);
  const full = fullRun?.yield ?? 0;

  const l = useScenario('limits', { district: 'prairie' as DistrictId });
  const lim = useMemo(() => {
    const dist = DISTRICT[l.state.district];
    const w = simulatedYear(REFERENCE_YEAR, dist.id);
    const res = simulateSeason(w, { crop: 'corn', plantDay: FROM, maturityGdd: dist.hybridGdd, pawIn: dist.pawIn, startWater: dist.springWater });
    const light: number[] = [];
    const water: number[] = [];
    const actual: number[] = [];
    let waterDays = 0;
    let lightDays = 0;
    let vpdSum = 0;
    for (const d of res.days) {
      const ww = w[d.day];
      const growing = d.dev < 1 && d.alive;
      const li = growing ? CROP.corn.rue * 0.48 * ww.srad * d.intercept * d.ft : 0;
      const wa = growing ? waterLimitedGrowth('corn', et0(ww, d.day) * BASAL.corn * d.intercept * d.ks, vpd(ww)) : 0;
      light.push(li);
      water.push(wa);
      actual.push(d.growth);
      if (growing && d.lai >= 0.5) {
        if (wa < li) waterDays++;
        else lightDays++;
        vpdSum += vpd(ww);
      }
    }
    return { res, light, water, actual, waterDays, lightDays, meanVpd: vpdSum / Math.max(1, waterDays + lightDays) };
  }, [l.state.district]);
  const kgPerKg = (lim.meanVpd / TRANSPIRATION_EFFICIENCY.corn) * 1000;

  return (
    <LessonPage id="agriculture/1.4">
      <P>
        <a href={lessonHref('agriculture/1.3')}>The previous lesson</a> ended with nitrogen washing out of the root zone in a wet spring. More often the problem runs the
        other way. A field of corn in July moves more water than any other part of the farm: it pulls it from the soil through its roots, lifts it to the leaves, and
        lets it out through the stomata as vapor. A leaf has to: the open stomata that let carbon dioxide in, as we saw in the{' '}
        <a href={lessonHref('agriculture/1.1')}>Photosynthesis Lab</a>, also let water out. This is <K tone="blue">transpiration</K>. Add the water evaporating from
        the soil between the plants, and you get <K tone="blue">evapotranspiration</K>, or ET — the field’s water bill.
      </P>
      <P>
        How big that bill is depends first on the weather. Agronomists start from a <b>reference evapotranspiration</b>, the water a well-watered grass lawn would use,
        which rises with sunlight, with temperature, and with how dry the air is. (Our model uses the Hargreaves formula, which estimates the air’s dryness from the
        gap between the day’s high and low.) A crop uses a multiple of it, its <b>crop coefficient</b>: about a quarter for bare soil, rising to about 1.1 as the
        canopy closes. In July, Cedar Bend’s corn in the reference season used 0.21 inches a day on average and 0.27 on the thirstiest day:
      </P>
      <Eq label="Crop water use">
        <span>
          ET<Sub>crop</Sub>
        </span>
        <Op>=</Op>
        <span>crop coefficient</span>
        <Op>×</Op>
        <span>reference ET</span>
      </Eq>
      <P>
        The supply comes from rain, from irrigation where there is any, and from the water already stored in the <K tone="blue">root zone</K>. Cedar Bend’s deep
        prairie soil holds about 11 inches of water the roots can extract when it’s full. The crop draws freely until a little over half of it is gone; after that the
        soil holds the rest more tightly than the roots can pull it, the crop can’t keep up with the demand, and it closes its stomata — and slows its growth — in
        proportion. That is <K tone="red">water stress</K>. In the next demonstration, the upper chart is the daily traffic — rain and irrigation in, evapotranspiration
        out — and the lower one is the water left in the root zone, with days of stress shaded. Change the summer and the soil:
      </P>

      <Figure name="Water Balance Simulator" scenario={s}>
        <Segmented
          label="Irrigation"
          value={st.irrigate}
          onChange={(v) => s.set({ irrigate: v })}
          options={[
            { value: 'off', label: 'No irrigation' },
            { value: 'on', label: 'Irrigate: an inch at a time, at most every 4 days' },
          ]}
        />
        <DayChart
          days={days}
          series={[
            { values: r.days.map((d) => Math.min(1.2, weather[d.day].rain)), color: GRAPHIC.blue, kind: 'bar', opacity: 0.7 },
            { values: r.days.map((d) => d.irrigation), color: GRAPHIC.teal, kind: 'bar' },
            { values: r.days.map((d) => d.et), color: GRAPHIC.red, width: 2 },
          ]}
          from={FROM}
          to={TO}
          yMin={0}
          yMax={1.2}
          yTicks={[0, 0.4, 0.8, 1.2]}
          yLabel="Water per day, inches"
          yFormat={(v) => fmt(v, 1)}
          height={170}
          ariaLabel={`Daily rain, irrigation and evapotranspiration at Cedar Bend from May to September: ${inch(r.rainTotal)} of rain, ${inch(r.irrigationTotal)} of irrigation and ${inch(r.etTotal)} used.`}
        />
        <DayChart
          days={days}
          series={[{ values: r.days.map((d) => d.water * 100), color: GRAPHIC.blue, kind: 'area', opacity: 0.35 }, { values: r.days.map((d) => d.water * 100), color: GRAPHIC.blue, width: 2 }]}
          from={FROM}
          to={TO}
          yMin={0}
          yMax={100}
          yTicks={[0, 25, 50, 75, 100]}
          yLabel="Water left in the root zone, % of what it holds"
          yFormat={(v) => `${v}%`}
          height={180}
          bands={stressBands(r)}
          refLines={[{ y: STRESS_LINE * 100, label: 'stress begins', color: GRAPHIC.red }]}
          ariaLabel={`Plant-available water in the root zone through the season. It falls to ${fmt(Math.min(...r.days.map((d) => d.water)) * 100)}% at its lowest, with ${r.stressDays} days of water stress.`}
        />
        <Legend
          items={[
            { label: 'Rain', color: GRAPHIC.blue },
            { label: 'Irrigation', color: GRAPHIC.teal },
            { label: 'Evapotranspiration', color: GRAPHIC.red, kind: 'line' },
            { label: 'Water stress', color: 'rgba(231, 91, 85, .3)' },
          ]}
        />
        <Readouts
          items={[
            { label: 'water used, planting to maturity', value: inch(r.etTotal), tone: 'red' },
            { label: 'rain', value: inch(r.rainTotal), tone: 'blue' },
            { label: 'irrigation', value: inch(r.irrigationTotal), tone: 'teal' },
            { label: 'days of strong stress', value: fmt(r.stressDays), tone: r.stressDays ? 'red' : 'ink' },
            { label: 'corn yield', value: buAc(r.yield), tone: 'gold' },
          ]}
        />
        <Slider label="Summer rain" tone="blue" value={st.rain} min={0.4} max={1.6} step={0.1} onChange={(v) => s.set({ rain: Math.round(v * 10) / 10 })} display={`${fmt(st.rain * 100)}% of the reference season`} />
        <Slider label="Warmer or cooler" tone="red" value={st.temp} min={-3} max={3} step={0.5} onChange={(v) => s.set({ temp: v })} display={`${st.temp > 0 ? '+' : ''}${fmt(st.temp, 1)} °C`} />
        <Slider label="Root zone holds" tone="blue" value={st.paw} min={4} max={12} step={0.5} onChange={(v) => s.set({ paw: v })} display={inch(st.paw)} />
        <Slider
          label="Irrigate when this much is used"
          tone="teal"
          value={st.trigger}
          min={20}
          max={80}
          step={5}
          disabled={st.irrigate === 'off'}
          onChange={(v) => s.set({ trigger: v })}
          display={st.irrigate === 'off' ? 'no irrigation' : `${st.trigger}%`}
        />
      </Figure>

      <P>
        Through May and June the soil does most of the work. The canopy is small, rain arrives faster than the crop uses it, and the excess drains away — 6.1 inches of
        it over the reference season. Then the canopy closes, and July’s 6.4 inches of evapotranspiration meet only 3.1 inches of rain. The difference comes out of
        the root zone, which is down to 38% full by the time the crop matures in mid-September. That season, the deep prairie soil was just enough: some mild stress
        late in grain fill, no strong stress, and 188 bushels an acre.
      </P>
      <P>
        Now cut the rain. At 60% of the reference season’s, the root zone runs low by August 10, the crop spends 37 days under strong stress, and the yield falls to
        161; at 40%, to 134. A thinner soil does much the same thing with normal rain: shrink the root zone to the Upland Ridge’s 7.5 inches and strong stress starts
        on the same August 10, costing 14 bushels; at 6 inches the crop loses 27. Rain and storage are partly interchangeable, which is why a district’s soil
        matters as much as its rainfall.
        Warming the season does something different. At +2 °C the crop barely stresses at all — it develops so fast that it’s done before the August dry spell — but
        it yields 163, because its grain fill, as in <a href={lessonHref('agriculture/1.2')}>the previous lesson</a>, is shorter.
      </P>

      <Challenge
        id="a"
        question="Set the summer to 60% of the reference season’s rain and turn irrigation on. What is the latest trigger — the most of the root zone the crop may use before you irrigate — that keeps the yield within 1% of a crop irrigated whenever it has used just 20%?"
        solved={solved}
        status={
          Math.abs(st.rain - 0.6) > 1e-6
            ? `Summer rain is at ${fmt(st.rain * 100)}%. Set it to 60%.`
            : st.temp !== 0 || st.paw !== PRAIRIE.pawIn
              ? 'Keep the reference temperatures (+0.0 °C) and Cedar Bend’s 11-inch root zone.'
              : st.irrigate !== 'on'
                ? 'Turn irrigation on.'
                : r.yield < 0.99 * full
                  ? `Irrigating at ${st.trigger}% gives ${buAc(r.yield, 1)}, more than 1% short of ${buAc(full, 1)}.`
                  : `Irrigating at ${st.trigger}% gives ${buAc(r.yield, 1)} with ${inch(r.irrigationTotal)} of water. Could the crop wait longer?`
        }
        success={`Solved: irrigating when ${st.trigger}% of the root zone is used yields ${buAc(r.yield, 1)} with ${inch(r.irrigationTotal)} of water; the crop watered at 20% got ${buAc(full, 1)} from ${inch(fullRun?.irrigationTotal ?? 0)}. That trigger sits right at the point where stress begins. Irrigate earlier and the extra water mostly ends the season still in the soil or evaporated from a wet surface; wait longer and the crop pays for it in stress.`}
      />

      <H2>Light or water</H2>
      <P>
        Water stress is the dramatic way water limits a crop, but there’s a quieter one. Every gram of dry matter costs water, because the stomata that let in the
        carbon dioxide let out vapor the whole time they’re open, and the drier the air, the more vapor escapes per gram. The usual measure is the{' '}
        <K tone="blue">vapor pressure deficit</K>, how far the air is from saturation, in kilopascals. In our model a corn canopy builds about{' '}
        {fmt(TRANSPIRATION_EFFICIENCY.corn, 1)} grams of dry matter per kilogram of water transpired when the deficit is 1 kilopascal, and proportionally less in
        drier air; wheat, a C3 plant, builds about half as much per kilogram.
      </P>
      <P>
        So each day the crop’s growth faces two ceilings: what the light it intercepts allows, from the first lesson, and what the water it can transpire that day pays
        for. It grows by the lower one. In the next demonstration, the violet line is the light ceiling and the blue line the water ceiling for the reference season’s
        corn, planted May 1 in each district; the shaded area is the growth that actually happened. Choose a district:
      </P>

      <Figure name="Water Balance Simulator · light or water" scenario={l}>
        <Segmented label="District" value={l.state.district} onChange={(v) => l.set({ district: v })} options={DISTRICTS.map((d) => ({ value: d.id, label: d.name }))} />
        <DayChart
          days={lim.res.days.map((d) => d.day)}
          series={[
            { values: lim.actual, color: GRAPHIC.teal, kind: 'area', opacity: 0.3 },
            { values: lim.light, color: GRAPHIC.violet, width: 1.8 },
            { values: lim.water, color: GRAPHIC.blue, width: 1.8 },
          ]}
          from={FROM}
          to={TO}
          yMin={0}
          yMax={60}
          yTicks={[0, 20, 40, 60]}
          yLabel="Growth, grams of dry matter per m² per day"
          yFormat={(v) => fmt(v)}
          height={220}
          ariaLabel={`Daily corn growth in ${DISTRICT[l.state.district].name} in the reference season, against the ceilings set by light and by water. Water is the lower ceiling on ${lim.waterDays} days and light on ${lim.lightDays}.`}
        />
        <Legend
          items={[
            { label: 'What the light allows', color: GRAPHIC.violet, kind: 'line' },
            { label: 'What the water pays for', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Growth', color: GRAPHIC.teal },
          ]}
        />
        <Readouts
          items={[
            { label: 'days water was the limit', value: fmt(lim.waterDays), tone: 'blue' },
            { label: 'days light was the limit', value: fmt(lim.lightDays), tone: 'violet' },
            { label: 'mean vapor pressure deficit', value: `${fmt(lim.meanVpd, 2)} kPa` },
            { label: 'water per kg of dry matter', value: `${fmt(kgPerKg)} kg` },
            { label: 'corn yield', value: buAc(lim.res.yield), tone: 'gold' },
          ]}
        />
      </Figure>

      <P>
        On the Black Prairie the two ceilings take turns: light sets the pace on 52 days and water on 47, mostly the hot, bright ones. The air there averages a deficit
        of about 1.5 kilopascals, so each kilogram of dry matter costs about 140 kilograms of transpired water. In the High Plains, where most corn is irrigated, this
        unirrigated field tells the story: the air is so dry — 2.35 kilopascals on average — that water is the limit on 75 of 82 days even before the soil runs low,
        and once it does, the crop is starved twice over. It yields 40 bushels. That is why the Plains grow wheat, which does its growing in the cooler, damper spring,
        and why the corn there is pumped from wells.
      </P>
      <P>
        Light, temperature, nutrients and water are now all in the model. Each slows the crop on its own days, and each leaves a mark. What we haven’t done is follow
        those marks into the grain itself. The yield that came out of{' '}
        <FigRef to="Water Balance Simulator">the water balance</FigRef> was a single number; the next lesson takes it apart into ears, kernels and the weight of each
        kernel, and shows why a dry week in mid-July costs so much more than a dry week in June.
      </P>
    </LessonPage>
  );
}
