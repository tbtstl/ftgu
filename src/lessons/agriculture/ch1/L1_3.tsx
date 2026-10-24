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
  Segmented,
  Slider,
  fmt,
  lessonHref,
  linePath,
  scale,
  useScenario,
} from '../../../framework';
import { simulateSeason } from '../../../engines/agriculture/crop';
import { NUTRIENTS, NUTRIENT_NAME, availability, nitrogenSeason, nitrogenSupply, sufficiency, type NTiming, type Nutrient, type SoilInputs } from '../../../engines/agriculture/soil';
import { REFERENCE_YEAR, simulatedYear } from '../../../model/agriculture/climate';
import { DISTRICT, dayOf, type DistrictId } from '../../../model/agriculture/region';
import { DayChart } from '../shared/DayChart';
import { buAc } from '../shared/format';

type Field = 'home' | 'ridge';
const FIELDS: Record<Field, SoilInputs & { district: DistrictId; label: string }> = {
  home: { district: 'prairie', label: 'Cedar Bend home field', nRate: 150, soilP: 25, soilK: 180, ph: 6.4, om: 4.5 },
  ridge: { district: 'ridge', label: 'Rented Ridge field', nRate: 150, soilP: 18, soilK: 150, ph: 5.3, om: 2.5 },
};
const NCOLOR: Record<Nutrient, string> = { N: GRAPHIC.violet, P: GRAPHIC.orange, K: GRAPHIC.blue };

const seasonCache = new Map<string, number>();
/** Corn yield in the field's district in the reference season, at this nutrient sufficiency. */
function fieldYield(district: DistrictId, factor: number): number {
  const key = `${district}|${factor.toFixed(4)}`;
  let y = seasonCache.get(key);
  if (y === undefined) {
    const d = DISTRICT[district];
    y = simulateSeason(simulatedYear(REFERENCE_YEAR, district), { crop: 'corn', plantDay: dayOf(5, 1), maturityGdd: d.hybridGdd, pawIn: d.pawIn, startWater: d.springWater, nutrient: factor }).yield;
    seasonCache.set(key, y);
  }
  return y;
}

/** The challenge: the rented Ridge field at 98% nutrient sufficiency or better, with no phosphorus added. */
export function ridgeSolved(field: Field, s: SoilInputs): boolean {
  return field === 'ridge' && s.soilP === FIELDS.ridge.soilP && sufficiency('corn', s).factor >= 0.98;
}

/** Liebig's barrel: one stave per nutrient, the level set by the shortest. */
function Barrel({ suff }: { suff: Record<Nutrient, number> & { factor: number; limiting: Nutrient } }) {
  const y = scale(0.5, 1, 220, 40);
  const xs: Record<Nutrient, number> = { N: 120, P: 230, K: 340 };
  const level = Math.max(0.5, suff.factor);
  return (
    <svg
      className="diagram"
      viewBox="0 0 620 250"
      role="img"
      aria-label={`Nutrient sufficiency: nitrogen ${fmt(suff.N * 100, 1)}%, phosphorus ${fmt(suff.P * 100, 1)}%, potassium ${fmt(suff.K * 100, 1)}%. ${NUTRIENT_NAME[suff.limiting]} is limiting, so the crop grows at ${fmt(suff.factor * 100, 1)}%.`}
    >
      <rect x={84} y={y(level)} width={292} height={220 - y(level)} fill="#cfe2f3" />
      <line x1={84} x2={376} y1={y(level)} y2={y(level)} stroke={GRAPHIC.blue} strokeWidth={2} />
      {NUTRIENTS.map((n) => (
        <g key={n}>
          <rect x={xs[n] - 34} y={y(Math.max(0.5, suff[n]))} width={68} height={220 - y(Math.max(0.5, suff[n]))} fill="none" stroke={NCOLOR[n]} strokeWidth={n === suff.limiting ? 3 : 2} />
          <rect x={xs[n] - 34} y={y(Math.max(0.5, suff[n]))} width={68} height={6} fill={NCOLOR[n]} />
          <text className="lab" x={xs[n]} y={238} textAnchor="middle">
            {NUTRIENT_NAME[n]}
          </text>
          <text className="ax" x={xs[n]} y={y(Math.max(0.5, suff[n])) - 6} textAnchor="middle">
            {fmt(suff[n] * 100, 1)}%
          </text>
        </g>
      ))}
      <line className="base" x1={70} x2={390} y1={220} y2={220} />
      {[0.5, 0.75, 1].map((v) => (
        <text key={v} className="ax ax-e" x={74} y={y(v) + 4}>
          {fmt(v * 100)}%
        </text>
      ))}
      <text className="lab" x={410} y={y(level) + 4} style={{ fill: '#2f6fb3' }}>
        the crop grows at {fmt(suff.factor * 100, 1)}%
      </text>
      <text className="ax" x={410} y={y(level) + 22}>
        set by the shortest stave
      </text>
    </svg>
  );
}

/** Availability bands of N, P and K across pH, with the current pH marked. */
function PhChart({ ph }: { ph: number }) {
  const x = scale(4.5, 8.5, 90, 610);
  const pts = Array.from({ length: 81 }, (_, i) => 4.5 + i * 0.05);
  const rows: Record<Nutrient, number> = { N: 30, P: 74, K: 118 };
  const band = (n: Nutrient) => {
    const top = pts.map((p) => rows[n] - 16 * availability(n, p));
    const bot = pts.map((p) => rows[n] + 16 * availability(n, p));
    const xs = pts.map(x);
    return linePath(xs, top) + ' L' + [...xs].reverse().map((xx, i) => `${xx.toFixed(1)} ${bot[bot.length - 1 - i].toFixed(1)}`).join(' L') + ' Z';
  };
  return (
    <svg className="chart" viewBox="0 0 640 160" role="img" aria-label={`How available each nutrient is across soil pH; the soil is at pH ${fmt(ph, 1)}.`}>
      {NUTRIENTS.map((n) => (
        <g key={n}>
          <path d={band(n)} fill={NCOLOR[n]} opacity={0.35} />
          <text className="lab" x={82} y={rows[n] + 4} textAnchor="end">
            {n}
          </text>
        </g>
      ))}
      <line className="cur" x1={x(ph)} x2={x(ph)} y1={8} y2={140} />
      {[4.5, 5.5, 6.5, 7.5, 8.5].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={156}>
          pH {fmt(v, 1)}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('soil', { field: 'home' as Field, nRate: 150, soilP: 25, soilK: 180, ph: 6.4, om: 4.5 });
  const { field } = s.state;
  const inputs: SoilInputs = { nRate: s.state.nRate, soilP: s.state.soilP, soilK: s.state.soilK, ph: s.state.ph, om: s.state.om };
  const suff = sufficiency('corn', inputs);
  const supply = nitrogenSupply(inputs);
  const district = FIELDS[field].district;
  const potential = fieldYield(district, 1);
  const yieldNow = fieldYield(district, suff.factor);
  const solved = ridgeSolved(field, inputs);

  const n = useScenario('nitrogen', { rate: 150, timing: 'spring' as NTiming, spring: 1 });
  const nRun = useMemo(() => {
    const p = DISTRICT.prairie;
    const mult = n.state.spring;
    const w = simulatedYear(REFERENCE_YEAR, 'prairie', { monthRain: [mult, mult, mult, mult, mult, mult, 1, 1, 1, 1, 1, 1] });
    const opts = { crop: 'corn' as const, plantDay: dayOf(5, 1), maturityGdd: p.hybridGdd, pawIn: p.pawIn, startWater: p.springWater };
    const base = simulateSeason(w, opts);
    const run = (rate: number, timing: NTiming) => {
      const ns = nitrogenSeason(w, base, { rate, timing, om: p.om, ph: p.ph, pawIn: p.pawIn });
      return { ns, yield: simulateSeason(w, { ...opts, nutrient: ns.sufficiency }).yield };
    };
    const now = run(n.state.rate, n.state.timing);
    const less = n.state.rate >= 10 ? run(n.state.rate - 10, n.state.timing) : null;
    return { base, now, less, plant: base.start };
  }, [n.state]);
  const ns = nRun.now.ns;
  const wet = Math.abs(n.state.spring - 1.5) < 1e-6;
  const target = 0.99 * nRun.base.yield;
  const solved2 = wet && n.state.timing === 'split' && nRun.now.yield >= target && !!nRun.less && nRun.less.yield < target;

  return (
    <LessonPage id="agriculture/1.3">
      <P>
        In <a href={lessonHref('agriculture/1.2')}>the previous lesson</a> Cedar Bend’s corn built its canopy right on schedule. That took more than warmth and light.
        Leaves are made of protein and chlorophyll, and both are built around nitrogen. The molecules that carry energy around the cell are built around phosphorus.
        Potassium works the valves — among other things, it’s what opens and closes the stomata. Crops need seventeen elements in all, but these three are the ones
        they take from the soil in bulk, and the three that fill most bags of fertilizer.
      </P>
      <P>
        How much of each the crop can actually get depends on three things. The first is supply: what fertilizer adds, what is left from last year, and, for
        nitrogen, what soil microbes release as they slowly digest the soil’s <K tone="teal">organic matter</K> — our model’s rule of thumb is 20 pounds an acre a
        year for every percent of it. The second is <K tone="red">pH</K>, the soil’s acidity, which decides how much of what’s there the roots can reach. The third is
        the strangest: no nutrient can make up for another. In the next demonstration, each nutrient’s <K tone="violet">sufficiency</K> — the share of full growth it
        alone would allow — is a stave of a barrel, and the crop fills it only to the lowest stave. Choose a field and change the soil:
      </P>

      <Figure name="Soil Chemistry Lab" scenario={s}>
        <Segmented
          label="Field"
          value={field}
          onChange={(v) => {
            const f = FIELDS[v];
            s.set({ field: v, nRate: f.nRate, soilP: f.soilP, soilK: f.soilK, ph: f.ph, om: f.om });
          }}
          options={[
            { value: 'home', label: FIELDS.home.label },
            { value: 'ridge', label: FIELDS.ridge.label },
          ]}
        />
        <Barrel suff={suff} />
        <PhChart ph={s.state.ph} />
        <Legend items={NUTRIENTS.map((x) => ({ label: `${NUTRIENT_NAME[x]} available`, color: NCOLOR[x] }))} />
        <Readouts
          items={[
            { label: 'nitrogen supply, lb/ac', value: `${fmt(supply.total)} of ${fmt(suff.nNeed)}`, tone: 'violet' },
            { label: 'limiting nutrient', value: NUTRIENT_NAME[suff.limiting] },
            { label: 'corn yield, reference season', value: buAc(yieldNow), tone: 'gold' },
            { label: 'share of this field’s potential', value: `${fmt((yieldNow / potential) * 100, 1)}%` },
          ]}
        />
        <Slider label="Nitrogen fertilizer" tone="violet" value={s.state.nRate} min={0} max={250} step={10} onChange={(v) => s.set({ nRate: v })} display={`${s.state.nRate} lb N/ac`} />
        <Slider label="Soil-test phosphorus" tone="orange" value={s.state.soilP} min={2} max={50} onChange={(v) => s.set({ soilP: v })} display={`${s.state.soilP} ppm`} />
        <Slider label="Soil-test potassium" tone="blue" value={s.state.soilK} min={40} max={250} step={5} onChange={(v) => s.set({ soilK: v })} display={`${s.state.soilK} ppm`} />
        <Slider label="Soil pH" tone="red" value={s.state.ph} min={4.5} max={8.5} step={0.1} onChange={(v) => s.set({ ph: Math.round(v * 10) / 10 })} display={fmt(s.state.ph, 1)} />
        <Slider label="Organic matter" tone="teal" value={s.state.om} min={1} max={6} step={0.5} onChange={(v) => s.set({ om: v })} display={`${fmt(s.state.om, 1)}%`} />
      </Figure>

      <P>
        Cedar Bend’s home field is in good shape. Its 4.5% organic matter releases about 90 pounds of nitrogen a year; with 30 left from last year and 150 pounds of
        fertilizer, of which the crop recovers about two-thirds, the supply is 218 pounds against the 220 a full crop needs. Take the fertilizer away and nitrogen sufficiency drops to
        79%, and in the reference season the corn yields 144 bushels an acre instead of 188. Each nutrient’s curve flattens as it fills: the
        first 50 pounds of fertilizer add 24 bushels, the step from 100 to 150 adds only 5. That diminishing return is the economics of fertilizer in miniature, and
        we’ll come back to it in Chapter 2.
      </P>
      <P>
        Now slide the pH. Between about 6 and 7, everything is available. Below 5.5, iron and aluminum lock phosphorus into compounds roots can’t dissolve, and the
        microbes that release nitrogen slow down; above 7.5, calcium does the locking. Nothing about the amount of phosphorus in the soil changes. What changes is how
        much of it the crop can reach, and the barrel’s level follows whichever stave is shortest.
      </P>
      <P>
        Farmers learn these numbers from a <b>soil test</b>. Every few years they send cores from each field to a lab, which reports the pH, the organic matter, and
        how much phosphorus and potassium a standard chemical extraction pulls out of the soil, in parts per million. The extraction is a stand-in for what roots can
        reach, and labs calibrate it against field trials, which is why recommendations come as “below this many ppm, apply this much.” Nitrogen is the exception:
        nitrate moves and changes so fast that a spring soil test says little about August, so most farmers budget it instead, as this demonstration does.
      </P>

      <Challenge
        id="a"
        question="Switch to the rented field on the Upland Ridge. Without adding phosphorus — keep its soil test at 18 ppm — bring the crop to 98% nutrient sufficiency or better."
        solved={solved}
        status={
          field !== 'ridge'
            ? 'Switch to the rented Ridge field.'
            : s.state.soilP !== FIELDS.ridge.soilP
              ? `The phosphorus test is ${s.state.soilP} ppm. Set it back to 18: no phosphorus may be added.`
              : `The crop grows at ${fmt(suff.factor * 100, 1)}%, held back by ${NUTRIENT_NAME[suff.limiting].toLowerCase()}.`
        }
        success={`Solved: at pH ${fmt(s.state.ph, 1)} with ${s.state.nRate} pounds of nitrogen, the shortest stave is ${NUTRIENT_NAME[suff.limiting].toLowerCase()} at ${fmt(suff.factor * 100, 1)}%. Two things had to change. Liming the field — spreading ground limestone to raise its pH — unlocked the phosphorus already there, and once phosphorus stopped limiting, the field’s thin organic matter left nitrogen as the short stave, which more fertilizer fixed. At the starting pH, extra nitrogen alone does nothing: at 200 pounds the yield is the same as at 150, because phosphorus is the limit.`}
      />

      <H2>Nitrogen moves with water</H2>
      <P>
        Phosphorus and potassium cling to soil particles and stay where they are put. Nitrogen in its main soil form, <K tone="violet">nitrate</K>, dissolves in water
        and travels with it. Whenever rain soaks the root zone beyond what it can hold, the excess drains away below the roots, often through buried drainage tiles, and
        into streams and groundwater, and takes nitrate with it. The budget in <FigRef to="Soil Chemistry Lab">the first demonstration</FigRef> assumed a typical
        season, in which the crop recovers about two-thirds of the fertilizer. In the next demonstration we track it through the reference season instead. The violet
        line is the nitrate in the root zone; the blue area is what has drained away; the teal lines are what the crop has taken up and what it wanted. Choose when
        Cedar Bend applies its nitrogen — the autumn before, at planting, or half at planting and half six weeks later — and how wet the spring is:
      </P>

      <Figure name="Soil Chemistry Lab · nitrogen through the season" scenario={n}>
        <Segmented
          label="When nitrogen is applied"
          value={n.state.timing}
          onChange={(v) => n.set({ timing: v })}
          options={[
            { value: 'fall', label: 'The autumn before' },
            { value: 'spring', label: 'At planting' },
            { value: 'split', label: 'Split' },
          ]}
        />
        <DayChart
          days={ns.days}
          series={[
            { values: ns.leached, color: GRAPHIC.blue, kind: 'area', opacity: 0.3 },
            { values: ns.demand, color: GRAPHIC.teal, dash: '5 4', width: 1.5 },
            { values: ns.uptake, color: GRAPHIC.teal, width: 2.5 },
            { values: ns.pool, color: GRAPHIC.violet, width: 2.5 },
          ]}
          from={0}
          to={dayOf(10, 1)}
          yMin={0}
          yMax={250}
          yTicks={[0, 50, 100, 150, 200, 250]}
          yLabel="Nitrogen, pounds per acre"
          yFormat={(v) => fmt(v)}
          marks={[
            { day: nRun.plant, label: 'planting' },
            ...(n.state.timing === 'split' ? [{ day: nRun.plant + 42, label: 'second half' }] : []),
          ]}
          height={230}
          ariaLabel={`Soil nitrogen through the reference season with ${n.state.rate} pounds applied ${n.state.timing === 'fall' ? 'the autumn before' : n.state.timing === 'spring' ? 'at planting' : 'half at planting and half six weeks later'}, and ${fmt(n.state.spring * 100)}% of normal spring rain. ${fmt(ns.totalLeached)} pounds drain away; the crop takes up ${fmt(ns.totalUptake)} of the ${fmt(ns.totalDemand)} it wants.`}
        />
        <Legend
          items={[
            { label: 'Nitrate in the root zone', color: GRAPHIC.violet, kind: 'line' },
            { label: 'Drained away', color: GRAPHIC.blue },
            { label: 'Taken up', color: GRAPHIC.teal, kind: 'line' },
            { label: 'Wanted', color: GRAPHIC.teal, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'drained away, lb/ac', value: fmt(ns.totalLeached), tone: 'blue' },
            { label: 'crop’s need met', value: `${fmt((ns.totalUptake / ns.totalDemand) * 100)}%`, tone: 'teal' },
            { label: 'corn yield', value: buAc(nRun.now.yield), tone: 'gold' },
            { label: 'with nitrogen to spare', value: buAc(nRun.base.yield) },
          ]}
        />
        <Slider label="Nitrogen fertilizer" tone="violet" value={n.state.rate} min={0} max={250} step={10} onChange={(v) => n.set({ rate: v })} display={`${n.state.rate} lb N/ac`} />
        <Slider label="Spring rain, January to June" tone="blue" value={n.state.spring} min={0.6} max={1.8} step={0.1} onChange={(v) => n.set({ spring: Math.round(v * 10) / 10 })} display={`${fmt(n.state.spring * 100)}% of normal`} />
      </Figure>

      <P>
        Applied at planting in a normal spring, 150 pounds meets 93% of the crop’s need, 44 pounds drain away over the season, and the crop yields 187 bushels against
        188 with nitrogen to spare, close to what the budget said. Applied the autumn before, the same 150 pounds sits in the soil through the winter and spring
        rains; 74 pounds are lost and the yield falls to 178. Splitting it, so that half goes on when the crop is about to need it most, loses just 32. The split
        isn’t free, though: it means a second trip across every field in June, with equipment and labor that are needed elsewhere at the same time.
      </P>
      <P>
        Now make the spring wet. At 150% of normal rain, the autumn application loses 104 of its pounds and the crop yields 160 bushels, while the split application
        still yields 186. Farmers apply in autumn anyway, sometimes, because fertilizer can be cheaper then and there’s more time to do the work than in the spring rush.
        It is a bet on the weather, placed six months ahead.
      </P>

      <Challenge
        id="b"
        question="Set spring rain to 150% of normal and use the split application. What is the smallest rate, in steps of 10 pounds, that brings the yield within 1% of the yield with nitrogen to spare?"
        solved={solved2}
        status={
          !wet
            ? `Spring rain is at ${fmt(n.state.spring * 100)}% of normal. Set it to 150%.`
            : n.state.timing !== 'split'
              ? 'Choose the split application.'
              : nRun.now.yield < target
                ? `At ${n.state.rate} pounds the crop yields ${fmt(nRun.now.yield, 1)} bushels, short of ${fmt(target, 1)}.`
                : `At ${n.state.rate} pounds the crop yields ${fmt(nRun.now.yield, 1)} bushels. Could it get there with less?`
        }
        success={`Solved: ${n.state.rate} pounds, split, yields ${fmt(nRun.now.yield, 1)} bushels; ${n.state.rate - 10} pounds would yield ${fmt(nRun.less?.yield ?? 0, 1)}. In a normal spring, 150 pounds at planting was enough. A wet spring raises the nitrogen bill twice over: more fertilizer to buy, and more of it washed into the streams.`}
      />

      <P>
        Water, in other words, runs through everything a crop does. It carries nutrients to the roots and, in excess, carries them away; it holds the stomata open;
        and from <a href={lessonHref('agriculture/1.1')}>the first lesson</a> we know that a leaf in drying soil shuts down. In the next lesson we follow the water
        itself: how much a field of corn uses, where it comes from, and what happens when the root zone runs dry in July.
      </P>
    </LessonPage>
  );
}

