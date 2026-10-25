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
  areaPath,
  fmt,
  linePath,
  scale,
  useScenario,
} from '../../../framework';
import { CO2_TODAY, EXTINCTION, UMOL_PER_J, canopyDay, gramsToBushels, interception, leafAssimilation } from '../../../engines/agriculture/photosynthesis';
import { CROP } from '../../../engines/agriculture/crop';
import type { Crop } from '../../../model/agriculture/region';
import { CROP_LINE, CROP_NAME, CROP_TONE } from '../shared/tones';

const LIGHT_MAX = 2200;
const LX = scale(0, LIGHT_MAX, 64, 612);
const LY = scale(-5, 60, 226, 24);
const SWEEP = Array.from({ length: 111 }, (_, i) => i * 20);

type LeafState = { light: number; co2: number; temp: number; water: number };
const wheatAhead = (s: LeafState) => {
  const w = s.water / 100;
  return leafAssimilation('wheat', s.light, s.co2, s.temp, w).net > leafAssimilation('corn', s.light, s.co2, s.temp, w).net;
};

/**
 * The challenge: in strong light, at today's CO₂ and with the soil at least half full, the warmest whole
 * degree at which the wheat leaf fixes more carbon than the corn leaf (18 °C at any light from 1,500 up).
 */
export function wheatAheadSolved(s: LeafState) {
  if (s.light < 1500 || s.co2 !== CO2_TODAY || s.water < 50) return false;
  return wheatAhead(s) && !wheatAhead({ ...s, temp: s.temp + 1 });
}

/** The reader's estimate: how fast the corn-minus-wheat gap closes from 28 to 24 °C, and where a straight line takes it to zero. */
export function crossingEstimate(light: number, co2: number, water: number): { rate: number; at: number } {
  const gap = (t: number) => leafAssimilation('corn', light, co2, t, water / 100).net - leafAssimilation('wheat', light, co2, t, water / 100).net;
  const rate = (gap(28) - gap(24)) / 4;
  return { rate, at: 24 - gap(24) / rate };
}

const SKY = { clear: 1700, hazy: 1150, overcast: 550 } as const;
type Sky = keyof typeof SKY;
const DAY_LENGTH = 15;
/** A drying soil in the prose: 30% of the plant-available water left. */
const DRY = 0.3;
const DRY_CORN = leafAssimilation('corn', 1500, CO2_TODAY, 28, DRY).net;
const DRY_WHEAT = leafAssimilation('wheat', 1500, CO2_TODAY, 28, DRY).net;
/** Light at which the corn leaf (28 °C) reaches 90% of what it fixes in full sun (2,000 µmol), to the nearest 50. */
export const CORN_NINETY = (() => {
  const full = leafAssimilation('corn', 2000, CO2_TODAY, 28).net;
  let l = 0;
  while (leafAssimilation('corn', l, CO2_TODAY, 28).net < 0.9 * full) l += 10;
  return Math.round(l / 50) * 50;
})();

/** Share of the light reaching a layer of corn leaves that one unit of leaf area lets through. */
const PASS_PER_UNIT = Math.exp(-EXTINCTION.corn);

/** The second challenge: the smallest corn leaf area that intercepts 90% of the light. */
export function ninetySolved(crop: Crop, lai: number) {
  return crop === 'corn' && interception('corn', lai) >= 0.9 && interception('corn', Math.round((lai - 0.1) * 10) / 10) < 0.9;
}

function LightCurves({ light, co2, temp, water }: { light: number; co2: number; temp: number; water: number }) {
  const w = water / 100;
  const curve = (crop: Crop) => SWEEP.map((p) => leafAssimilation(crop, p, co2, temp, w).net);
  const corn = curve('corn');
  const wheat = curve('wheat');
  const cNow = leafAssimilation('corn', light, co2, temp, w).net;
  const wNow = leafAssimilation('wheat', light, co2, temp, w).net;
  const xs = SWEEP.map(LX);
  const clampY = (v: number) => LY(Math.max(-5, Math.min(60, v)));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 256"
      role="img"
      aria-label={`Net CO₂ uptake of a corn leaf and a wheat leaf against light, at ${co2} ppm CO₂, ${temp} °C and ${water}% soil water. At ${fmt(light)} µmol of light the corn leaf fixes ${fmt(cNow, 1)} and the wheat leaf ${fmt(wNow, 1)} µmol of CO₂ per square meter per second.`}
    >
      <text className="ax" x={64} y={12}>
        Net CO₂ uptake, µmol per m² of leaf per second
      </text>
      <GridY y={LY} ticks={[0, 20, 40, 60]} x0={64} x1={612} baseline={0} />
      <line className="cur" x1={LX(light)} x2={LX(light)} y1={24} y2={226} />
      <path d={linePath(xs, wheat.map(clampY))} fill="none" stroke={CROP_LINE.wheat} strokeWidth={2.5} />
      <path d={linePath(xs, corn.map(clampY))} fill="none" stroke={CROP_LINE.corn} strokeWidth={2.5} />
      <circle cx={LX(light)} cy={clampY(cNow)} r={5.5} fill={CROP_LINE.corn} stroke="#fcfcfb" strokeWidth={2} />
      <circle cx={LX(light)} cy={clampY(wNow)} r={5.5} fill={CROP_LINE.wheat} stroke="#fcfcfb" strokeWidth={2} />
      <text className="lab" x={612} y={clampY(corn[corn.length - 1]) - 8} textAnchor="end" style={{ fill: '#8a6500' }}>
        corn
      </text>
      <text className="lab" x={612} y={clampY(wheat[wheat.length - 1]) + (wheat[wheat.length - 1] > corn[corn.length - 1] ? -8 : 16)} textAnchor="end" style={{ fill: '#ad5310' }}>
        wheat
      </text>
      {[0, 500, 1000, 1500, 2000].map((v) => (
        <text key={v} className="ax ax-m" x={LX(v)} y={242}>
          {fmt(v)}
        </text>
      ))}
      <text className="ax ax-e" x={612} y={256}>
        light, µmol photons per m² per second
      </text>
    </svg>
  );
}

function DayCurve({ crop, hourly, light }: { crop: Crop; hourly: number[]; light: number[] }) {
  const x = scale(0, 24, 64, 612);
  const peak = Math.max(90, ...hourly);
  const y = scale(-10, peak, 196, 30);
  const yl = scale(0, 1800, 196, 30);
  const xs = hourly.map((_, h) => x(h + 0.5));
  const area = areaPath(xs, hourly.map(y), hourly.map(() => y(0)));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 230"
      role="img"
      aria-label={`A ${crop} canopy through one day: net CO₂ uptake peaks at ${fmt(Math.max(...hourly), 1)} µmol per square meter of ground per second around noon, and turns slightly negative at night as the plants respire.`}
    >
      <text className="ax" x={64} y={14}>
        Canopy CO₂ uptake, µmol per m² of ground per second
      </text>
      <GridY y={y} ticks={[0, 40, 80]} x0={64} x1={612} baseline={0} />
      <path d={linePath(xs, light.map(yl))} fill="none" stroke={GRAPHIC.violet} strokeWidth={1.5} strokeDasharray="5 4" />
      <path d={area} fill={CROP_LINE[crop]} opacity={0.25} />
      <path d={linePath(xs, hourly.map(y))} fill="none" stroke={CROP_LINE[crop]} strokeWidth={2.5} />
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} className="ax ax-m" x={x(h)} y={214}>
          {String(h).padStart(2, '0')}:00
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('leaf', { light: 1500, co2: CO2_TODAY, temp: 28, water: 100 });
  const { light, co2, temp, water } = s.state;
  const cornNow = leafAssimilation('corn', light, co2, temp, water / 100).net;
  const wheatNow = leafAssimilation('wheat', light, co2, temp, water / 100).net;
  const solved = wheatAheadSolved(s.state);
  const estimate = crossingEstimate(light, co2, water);

  const c = useScenario('canopy', { crop: 'corn' as Crop, sky: 'clear' as Sky, lai: 5, temp: 28 });
  const day = useMemo(() => canopyDay(c.state.crop, c.state.lai, SKY[c.state.sky], DAY_LENGTH, c.state.temp), [c.state]);
  const intercepted = interception(c.state.crop, c.state.lai);
  const solved2 = ninetySolved(c.state.crop, c.state.lai);

  const status = (() => {
    if (light < 1500) return `The light is ${fmt(light)} µmol. Full sun needs at least 1,500.`;
    if (co2 !== CO2_TODAY) return `The CO₂ is ${co2} ppm. Set it back to ${CO2_TODAY}.`;
    if (water < 50) return `The soil has ${water}% of its water left. Keep it at least half full.`;
    if (wheatNow > cornNow) return `The wheat leaf is ahead at ${temp} °C. Is it still ahead a degree warmer?`;
    return `At ${temp} °C the corn leaf fixes more. Where did you estimate the two would cross?`;
  })();

  return (
    <LessonPage id="agriculture/1.1">
      <P>
        A bushel of corn is 56 pounds of grain, and almost all of its dry weight was, a few months before harvest, carbon dioxide in the air and water in the soil.
        Sunlight did the assembling. Every price we’ll meet in this course — the cash bid at a country elevator, a futures contract for December delivery, the premium a
        mill pays for high-protein wheat — rests on how much of that assembling gets done in a season, and how sure anyone can be about it in advance. So we’ll start
        where the grain starts: in a leaf.
      </P>
      <P>
        The course follows corn and wheat through one fictional region, the Crane Valley: five districts along the Crane River, from the dry High Plains in the west
        to the deep, dark soils of the Black Prairie, with country elevators, a river terminal and two export ports. Our first stop is Cedar Bend, a 1,600-acre farm
        on the Black Prairie that grows corn on most of its fields and winter wheat on the rest.
      </P>
      <P>
        Photosynthesis uses the energy of light to split water and to fix carbon dioxide into sugar. The carbon dioxide enters through <b>stomata</b>, tiny pores in
        the leaf’s surface — the same pores through which the leaf loses water vapor. We’ll measure the result as <K tone="teal">net CO₂ uptake</K>: micromoles of
        CO₂ fixed per square meter of leaf per second, after the leaf’s own respiration. And we’ll measure <K tone="violet">light</K> the way plants use it, as a flow
        of photons in the wavelengths photosynthesis can use: full summer sun delivers about 2,000 micromoles of them per square meter per second. In the next
        demonstration, a <K tone="gold">corn</K> leaf and a <K tone="orange">wheat</K> leaf sit side by side. Change the light, the air’s carbon dioxide, the leaf’s
        temperature and the water left in the soil:
      </P>

      <Figure name="Photosynthesis Lab" scenario={s}>
        <LightCurves light={light} co2={co2} temp={temp} water={water} />
        <Legend
          items={[
            { label: 'Corn leaf (C4)', color: CROP_LINE.corn, kind: 'line' },
            { label: 'Wheat leaf (C3)', color: CROP_LINE.wheat, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'corn leaf, µmol CO₂/m²/s', value: fmt(cornNow, 1), tone: 'gold' },
            { label: 'wheat leaf, µmol CO₂/m²/s', value: fmt(wheatNow, 1), tone: 'orange' },
          ]}
        />
        <Slider label="Light" tone="violet" value={light} min={0} max={LIGHT_MAX} step={50} onChange={(v) => s.set({ light: v })} display={`${fmt(light)} µmol/m²/s`} />
        <Slider label="CO₂ in the air" tone="teal" value={co2} min={200} max={1000} step={10} onChange={(v) => s.set({ co2: v })} display={`${co2} ppm`} />
        <Slider label="Leaf temperature" tone="red" value={temp} min={0} max={45} onChange={(v) => s.set({ temp: v })} display={`${temp} °C`} />
        <Slider label="Soil water left" tone="blue" value={water} min={0} max={100} step={5} onChange={(v) => s.set({ water: v })} display={`${water}%`} />
      </Figure>

      <P>
        Start in the dark and raise the light. At first every extra photon counts: the curves rise in a straight line, and their slope — the <b>quantum yield</b> — is
        how many molecules of CO₂ the leaf fixes per photon it absorbs, about one for every 15 or 20. Then the curves bend over. The light is arriving faster than
        the leaf’s enzymes can use it, and uptake levels off at the leaf’s <b>capacity</b>. At the starting 28 °C, the corn leaf reaches 90% of what it fixes in full
        sun at about {fmt(CORN_NINETY)} micromoles of light, and fixes 47.3 at 1,500; the wheat leaf manages 23.5.
      </P>
      <P>
        The difference is chemistry. The enzyme that grabs CO₂ in every plant, Rubisco, sometimes grabs an oxygen molecule by mistake, and cleaning up the mistake
        costs the leaf energy and gives back carbon it had already fixed. This is <b>photorespiration</b>, and it gets worse as the leaf warms. Wheat, like rice and
        soybeans, is a <b>C3</b> plant and simply lives with it. Corn, like sugarcane, is a <b>C4</b> plant: it first captures CO₂ in a different molecule and pumps it
        into a ring of inner cells that hold its Rubisco, where CO₂ is so concentrated that the mistake rarely happens. The pump costs energy, but in warm, bright
        weather it more than pays for itself.
      </P>
      <P>
        Now try the other sliders. More CO₂ helps the wheat leaf a great deal — at 560 ppm it fixes 28.5 instead of 23.5 — and the corn leaf hardly at all, since its
        pump already saturates it. Temperature cuts the other way: wheat does best around 16–26 °C and falls apart in the heat, while corn wants 26 °C or more and
        holds on past 35. And once the soil has given up a little over half its available water, both leaves start closing their stomata to save what’s left. With{' '}
        {fmt(DRY * 100)}% of the water left, corn still fixes {fmt(DRY_CORN, 1)}, because its pump can work on the little CO₂ that gets in; wheat drops to{' '}
        {fmt(DRY_WHEAT, 1)}.
      </P>

      <Challenge
        id="a"
        question="Keep the CO₂ at 420 ppm, close to today’s level, the soil at least half full and the light at 1,500 µmol or more. Estimate first: cool the leaf from 28 °C to 24 °C, note how much the gap between the two readouts closes per degree, and predict where it reaches zero. Then find the warmest whole degree at which the wheat leaf fixes more carbon than the corn leaf."
        solved={solved}
        status={status}
        success={`Solved. At ${temp} °C the wheat leaf fixes ${fmt(wheatNow, 1)} and the corn leaf ${fmt(cornNow, 1)}; a degree warmer, corn is ahead. Between 28 and 24 °C the gap closed by ${fmt(estimate.rate, 1)} a degree, which put the crossing near ${fmt(estimate.at)} °C. Below about ${temp} °C in strong light, photorespiration is mild, so wheat loses little to it, while corn pays for its pump and its enzymes slow in the cold. That’s why wheat is a crop of cool springs and corn a crop of hot summers — and why, as we’ll see, the two are planted and harvested at different times of year.`}
      />

      <H2>From a leaf to a field</H2>
      <P>
        A crop isn’t one leaf in full sun. It’s a canopy of leaves stacked over the ground, measured by its <K tone="teal">leaf area index</K>: square meters of leaf
        per square meter of ground. Sunlight fades as it passes down through the layers — in a corn canopy, each unit of leaf area lets through about{' '}
        {fmt(PASS_PER_UNIT * 100)}% of the light that reaches it — so the top leaves get more than they can use while the lower ones live in shade. In
        the next demonstration, the shaded curve is a canopy’s net CO₂ uptake hour by hour through a midsummer day, fifteen hours long; the dashed line is the{' '}
        <K tone="violet">sunlight</K> above it. The readouts add up the day. The carbon fixed becomes <K tone="teal">dry matter</K>: the plant’s weight with the
        water dried out of it. And over a whole day we count light as energy rather than photons — a megajoule of it is about{' '}
        {fmt(UMOL_PER_J, 1)} moles of photons. Change the canopy, the sky and the temperature:
      </P>

      <Figure name="Photosynthesis Lab · a summer day" scenario={c}>
        <Segmented
          label="Crop"
          value={c.state.crop}
          onChange={(v) => c.set({ crop: v })}
          options={[
            { value: 'corn', label: 'Corn' },
            { value: 'wheat', label: 'Wheat' },
          ]}
        />
        <Segmented
          label="Sky"
          value={c.state.sky}
          onChange={(v) => c.set({ sky: v })}
          options={[
            { value: 'clear', label: 'Clear' },
            { value: 'hazy', label: 'Hazy' },
            { value: 'overcast', label: 'Overcast' },
          ]}
        />
        <DayCurve crop={c.state.crop} hourly={day.hourly} light={day.light} />
        <Legend
          items={[
            { label: `${CROP_NAME[c.state.crop]} canopy`, color: CROP_LINE[c.state.crop], kind: 'line' },
            { label: 'Sunlight above it', color: GRAPHIC.violet, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'light intercepted', value: `${fmt(intercepted * 100, 1)}%`, tone: 'violet' },
            { label: 'dry matter built today', value: `${fmt(day.dryMatter, 1)} g/m²`, tone: 'teal' },
            { label: 'as grain, if half of it', value: `${fmt(gramsToBushels(c.state.crop, day.dryMatter, 0.5), 1)} bu/ac`, tone: CROP_TONE[c.state.crop] },
            { label: 'grams per MJ of light caught', value: fmt(day.rue, 2) },
          ]}
        />
        <Slider label="Leaf area index" tone="teal" value={c.state.lai} min={0.5} max={6} step={0.1} onChange={(v) => c.set({ lai: Math.round(v * 10) / 10 })} display={fmt(c.state.lai, 1)} />
        <Slider label="Daytime temperature" tone="red" value={c.state.temp} min={10} max={42} onChange={(v) => c.set({ temp: v })} display={`${c.state.temp} °C`} />
      </Figure>

      <P>
        At the start, a full corn canopy with a leaf area index of 5 on a clear day catches {fmt(interception('corn', 5) * 100)}% of the light and builds 49.2 grams
        of dry matter on every square meter of ground. If half of it ended up as grain, that would be 4.6 bushels an acre — in one day. Drop the leaf area to 3 and
        the canopy still catches {fmt(interception('corn', 3) * 100, 1)}% of the light and builds 44.8 grams: past a point, extra leaves mostly shade the leaves
        below them.
      </P>
      <P>
        Now look at the last readout, the grams of dry matter built per megajoule of light the canopy catches. For corn it stays close to 4 whatever the leaf area,
        and on a hazy day, with two-thirds of the light, the canopy builds two-thirds as much. That steadiness is the useful surprise. A single leaf saturates, but a
        canopy doesn’t, because most of its leaves are in the shade at most hours. So a whole field turns the light it intercepts into dry matter at a nearly fixed
        rate, the <K tone="teal">radiation use efficiency</K>. Only the deep shade of an overcast day, when the leaves’ respiration takes a bigger share, or
        temperatures outside the crop’s comfortable range pull it down. Switch to wheat and cool the day to 20 °C, and the number settles near 3.3: a C3 canopy is a
        less efficient factory even in weather it likes. Leave it at 28 °C and wheat falls to 2.4.
      </P>

      <Challenge
        id="b"
        question={`A canopy that catches 90% of the sunlight is close to closed. Predict first: if each unit of corn leaf area lets through ${fmt(PASS_PER_UNIT * 100)}% of the light that reaches it, two units let through ${fmt(PASS_PER_UNIT * 100)}% of ${fmt(PASS_PER_UNIT * 100)}%, about ${fmt(PASS_PER_UNIT ** 2 * 100)}%. How many does it take before only a tenth gets through? Then find the smallest corn leaf area index that intercepts at least 90%.`}
        solved={solved2}
        status={
          c.state.crop !== 'corn'
            ? 'Switch the crop to corn.'
            : intercepted >= 0.9
              ? `At a leaf area index of ${fmt(c.state.lai, 1)} the canopy catches at least 90%. Would a little less still do it?`
              : `At a leaf area index of ${fmt(c.state.lai, 1)} the canopy catches less than 90%. How close was your prediction?`
        }
        success={`Solved. At ${fmt(c.state.lai, 1)}, the canopy intercepts ${fmt(intercepted * 100, 1)}%; at ${fmt(c.state.lai - 0.1, 1)} it falls just short. Light fades by the same fraction through each layer of leaves, so the share that gets through falls exponentially: three units let through ${fmt(PASS_PER_UNIT ** 3 * 100)}%, four only ${fmt(PASS_PER_UNIT ** 4 * 100)}%, and the tenth comes a little before four. Corn needs about ${fmt(c.state.lai, 1)} square meters of leaf over every square meter of ground to stop nine-tenths of the light.`}
      />

      <P>
        That is the first link in the chain from weather to price. A field’s <b>growth</b> on any day — the dry matter it adds — is, to a good approximation, the
        light it intercepts times its
        radiation use efficiency — the season model we’ll build in this chapter uses {fmt(CROP.corn.rue, 1)} grams per megajoule for corn and{' '}
        {fmt(CROP.wheat.rue, 1)} for wheat — slowed down whenever it is too cold, too hot or too dry. But a crop doesn’t start the season with a closed canopy. It
        has to build one, leaf by leaf, on a schedule set mostly by temperature, and then switch from building leaves to building grain. In{' '}
        <FigRef to="Photosynthesis Lab · a summer day">the canopy demonstration</FigRef> the leaf area was a slider; in the next lesson, it grows.
      </P>
    </LessonPage>
  );
}
