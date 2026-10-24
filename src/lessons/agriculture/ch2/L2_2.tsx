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
import { YEARS, fieldSeason, irrigationResponse } from '../../../engines/agriculture/farm';
import { nitrogenSeason } from '../../../engines/agriculture/soil';
import { simulatedYear } from '../../../model/agriculture/climate';
import { N_PRICE, PLAN_PRICE, PUMP_PER_ACRE_INCH, perBushelCost } from '../../../model/agriculture/economics';
import { DISTRICT, dayOf } from '../../../model/agriculture/region';
import { HistogramChart } from '../shared/HistogramChart';
import { buAc, perBu } from '../shared/format';
import { plantingStats } from './L2_1';

const PRAIRIE = DISTRICT.prairie;
const N_RATES = Array.from({ length: 14 }, (_, i) => i * 20);
const N_YEARS = YEARS.slice(0, 100);
const ALLOWANCES = Array.from({ length: 11 }, (_, i) => i * 2);
const PLANTERS = [
  { label: '8-row', perDay: 90, cost: 16000 },
  { label: '12-row', perDay: 135, cost: 24000 },
  { label: '16-row', perDay: 180, cost: 32000 },
  { label: '24-row', perDay: 270, cost: 46000 },
];

let nTable: number[][] | null = null;
/**
 * Corn yield in each of 100 seasons at each nitrogen rate (lb N per acre, applied at planting),
 * from the season-by-season nitrogen budget of Lesson 1.3: rain that drains through the root zone
 * carries nitrate away, so wet springs need more.
 */
export function nitrogenTable(): number[][] {
  if (!nTable) {
    nTable = N_YEARS.map((y) => {
      const base = fieldSeason(y, { district: 'prairie', crop: 'corn' });
      const w = simulatedYear(y, 'prairie');
      return N_RATES.map((rate) => {
        const ns = nitrogenSeason(w, base, { rate, timing: 'spring', om: PRAIRIE.om, ph: PRAIRIE.ph, pawIn: PRAIRIE.pawIn });
        return fieldSeason(y, { district: 'prairie', crop: 'corn', nutrient: Math.round(ns.sufficiency * 1000) / 1000 }).yield;
      });
    });
  }
  return nTable;
}

type InputKey = 'nitrogen' | 'water' | 'planter';

export interface InputCurve {
  levels: number[];
  /** Expected yield (or, for the planter, bushels a year) at each level. */
  output: number[];
  /** Expected value of the crop at each level, $ per acre (or per year for the planter). */
  value: number[];
  /** Cost of the input at each level, same units. */
  cost: number[];
  net: number[];
  best: number;
}

/** The response curve, values and costs of one input at these prices. */
export function inputCurve(input: InputKey, cornPrice: number, inputPrice: number): InputCurve {
  const margin = cornPrice - perBushelCost('corn');
  if (input === 'nitrogen') {
    const t = nitrogenTable();
    const output = N_RATES.map((_, j) => t.reduce((s, row) => s + row[j], 0) / t.length);
    const value = output.map((y) => y * margin);
    const cost = N_RATES.map((r) => r * inputPrice);
    return finish(N_RATES, output, value, cost);
  }
  if (input === 'water') {
    const pts = irrigationResponse(ALLOWANCES, cornPrice, inputPrice);
    return finish(
      ALLOWANCES,
      pts.map((p) => p.yield),
      pts.map((p) => p.yield * margin),
      pts.map((p) => p.pumped * inputPrice),
    );
  }
  const lost = PLANTERS.map((pl) => plantingStats(dayOf(4, 25), pl.perDay).meanLost);
  const output = lost.map((l) => -l);
  return finish(
    PLANTERS.map((_, i) => i),
    output,
    output.map((o) => o * margin),
    PLANTERS.map((pl) => pl.cost * inputPrice),
  );
}

function finish(levels: number[], output: number[], value: number[], cost: number[]): InputCurve {
  const net = value.map((v, i) => v - cost[i]);
  const best = net.reduce((a, n, i) => (n > net[a] + 1e-9 ? i : a), 0);
  return { levels, output, value, cost, net, best };
}

/** The challenge: with nitrogen at $1.20 a pound, the rate that maximizes the return to nitrogen. */
export function doubledNitrogenSolved(input: InputKey, level: number, cornPrice: number, nPrice: number): boolean {
  if (input !== 'nitrogen' || Math.abs(nPrice - 1.2) > 1e-6 || Math.abs(cornPrice - PLAN_PRICE.corn) > 1e-6) return false;
  const c = inputCurve('nitrogen', cornPrice, nPrice);
  return level === c.best;
}

const INPUTS: Record<InputKey, { label: string; unit: (l: number) => string; price: { label: string; min: number; max: number; step: number; def: number; show: (v: number) => string } }> = {
  nitrogen: {
    label: 'Nitrogen',
    unit: (l) => `${fmt(N_RATES[l])} lb N/ac`,
    price: { label: 'Nitrogen price', min: 0.3, max: 1.5, step: 0.05, def: N_PRICE, show: (v) => `${usd(v, 2)} per lb` },
  },
  water: {
    label: 'Irrigation water',
    unit: (l) => `${fmt(ALLOWANCES[l])} in allowed`,
    price: { label: 'Pumping cost', min: 5, max: 30, step: 1, def: PUMP_PER_ACRE_INCH, show: (v) => `${usd(v)} per acre-inch` },
  },
  planter: {
    label: 'Planter size',
    unit: (l) => `${PLANTERS[l].label}, ${PLANTERS[l].perDay} ac/day`,
    price: { label: 'Planter cost', min: 0.5, max: 2, step: 0.1, def: 1, show: (v) => `${fmt(v * 100)}% of list` },
  },
};

function levelLabel(input: InputKey, i: number): string {
  if (input === 'nitrogen') return fmt(N_RATES[i]);
  if (input === 'water') return fmt(ALLOWANCES[i]);
  return PLANTERS[i].label;
}

/** Output against the input, and each step's marginal value against its marginal cost. */
function ResponseChart({ input, curve, level }: { input: InputKey; curve: InputCurve; level: number }) {
  const n = curve.levels.length;
  const x = scale(0, n - 1, 80, 600);
  const [o0, o1] = niceDomain(Math.min(...curve.output), Math.max(...curve.output), 4);
  const yo = scale(o0, o1, 150, 30);
  const mv = curve.value.slice(1).map((v, i) => v - curve.value[i]);
  const mc = curve.cost.slice(1).map((c, i) => c - curve.cost[i]);
  const [m0, m1] = niceDomain(Math.min(0, ...mv, ...mc), Math.max(1, ...mv, ...mc), 3);
  const ym = scale(m0, m1, 330, 210);
  const step = (x(1) - x(0)) * 0.6;
  const isPlanter = input === 'planter';
  const outLabel = input === 'planter' ? 'Bushels lost to late planting a year (negative)' : 'Expected corn yield, bu/ac';
  const fmtMoney = (v: number) => (isPlanter ? usd(v) : usd(v, Math.abs(v) < 10 && v !== 0 ? 1 : 0));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 362"
      role="img"
      aria-label={`${INPUTS[input].label}: at ${INPUTS[input].unit(level)} the expected ${isPlanter ? 'bushels lost a year are' : 'yield is'} ${fmt(Math.abs(curve.output[level]), 1)}. The return over the input’s cost is highest at ${INPUTS[input].unit(curve.best)}.`}
    >
      <text className="ax" x={80} y={14}>
        {outLabel}
      </text>
      <GridY y={yo} ticks={niceTicks(o0, o1, 4)} x0={80} x1={600} format={(v) => fmt(v)} baseline={o0} />
      <path d={linePath(curve.levels.map((_, i) => x(i)), curve.output.map(yo))} fill="none" stroke={GRAPHIC.gold} strokeWidth={2.5} />
      {curve.output.map((o, i) => (
        <circle key={i} cx={x(i)} cy={yo(o)} r={i === level ? 6 : 3} fill={i === level ? GRAPHIC.gold : '#fcfcfb'} stroke={GRAPHIC.gold} strokeWidth={2} />
      ))}
      <line x1={x(curve.best)} x2={x(curve.best)} y1={26} y2={330} stroke={TEXT.green} strokeWidth={1.5} strokeDasharray="5 4" />
      <text className="ax" x={x(curve.best) + 5} y={40} style={{ fill: TEXT.green }}>
        best return
      </text>
      <text className="ax" x={80} y={196}>
        Each step: value of the extra bushels (bars) and the extra cost (line), $
      </text>
      <GridY y={ym} ticks={niceTicks(m0, m1, 3)} x0={80} x1={600} format={fmtMoney} baseline={0} />
      {mv.map((v, i) => (
        <rect
          key={i}
          x={(x(i) + x(i + 1)) / 2 - step / 2}
          y={Math.min(ym(0), ym(v))}
          width={step}
          height={Math.abs(ym(v) - ym(0))}
          fill={v >= mc[i] ? GRAPHIC.green : GRAPHIC.red}
          opacity={0.55}
        />
      ))}
      <path
        d={mc.map((c, i) => `M${((x(i) + x(i + 1)) / 2 - step / 2).toFixed(1)} ${ym(c).toFixed(1)} L${((x(i) + x(i + 1)) / 2 + step / 2).toFixed(1)} ${ym(c).toFixed(1)}`).join(' ')}
        stroke="#333"
        strokeWidth={2.5}
      />
      <line className="cur" x1={x(level)} x2={x(level)} y1={26} y2={330} />
      {curve.levels.map((_, i) =>
        n <= 6 || i % 2 === 0 ? (
          <text key={i} className="ax ax-m" x={x(i)} y={348}>
            {levelLabel(input, i)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('inputs', { input: 'nitrogen' as InputKey, level: 6, corn: PLAN_PRICE.corn, nPrice: N_PRICE, pump: PUMP_PER_ACRE_INCH, planterCost: 1 });
  const { input, corn } = s.state;
  const inputPrice = input === 'nitrogen' ? s.state.nPrice : input === 'water' ? s.state.pump : s.state.planterCost;
  const curve = useMemo(() => inputCurve(input, corn, inputPrice), [input, corn, inputPrice]);
  const maxLevel = curve.levels.length - 1;
  const level = Math.min(s.state.level, maxLevel);
  const priceDef = INPUTS[input].price;
  const solved = doubledNitrogenSolved(input, level, corn, s.state.nPrice);
  const perUnit = input === 'planter' ? ' a year' : ' an acre';

  const h = useScenario('hindsight', { corn: PLAN_PRICE.corn, nPrice: N_PRICE });
  const hindsight = useMemo(() => {
    const t = nitrogenTable();
    const margin = h.state.corn - perBushelCost('corn');
    const best = t.map((row) => {
      const net = row.map((y, j) => y * margin - N_RATES[j] * h.state.nPrice);
      return N_RATES[net.reduce((a, v, j) => (v > net[a] + 1e-9 ? j : a), 0)];
    });
    const plan = inputCurve('nitrogen', h.state.corn, h.state.nPrice);
    const planRate = N_RATES[plan.best];
    // What sticking to the plan cost, against perfect hindsight, on average.
    const regret =
      t.reduce((s2, row) => {
        const net = row.map((y, j) => y * margin - N_RATES[j] * h.state.nPrice);
        return s2 + Math.max(...net) - net[plan.best];
      }, 0) / t.length;
    return { best, planRate, regret, within: best.filter((b) => Math.abs(b - planRate) <= 20).length };
  }, [h.state.corn, h.state.nPrice]);

  return (
    <LessonPage id="agriculture/2.2">
      <P>
        <a href={lessonHref('agriculture/2.1')}>The previous lesson</a> decided what to plant and when. Every acre then needs inputs — seed, fertilizer, water where
        there is any, and the machinery to put them on — and each raises a question that runs through all of economics: how much? The crop’s answer is usually
        “more,” up to a point. The farmer’s answer stops sooner.
      </P>
      <P>
        The reason is <K tone="teal">diminishing returns</K>, which <a href={lessonHref('agriculture/1.3')}>Lesson 1.3</a> showed in the soil: the first pounds of
        nitrogen add many bushels, the last ones almost none. So the useful number isn’t the total yield an input brings but the <K tone="green">marginal</K> one —
        what the next step of it adds — and the rule is simple to say: keep adding as long as the extra bushels are worth more than the extra input costs. Where the
        two meet is the economic optimum, and it is always short of the most the crop could use, because the last steps add bushels worth less than they cost.
      </P>
      <P>
        In the next demonstration, choose an input. The upper chart is its expected payoff, averaged over the model’s simulated seasons: Cedar Bend’s corn yield
        against nitrogen applied at planting (from the season-by-season nitrogen budget of Lesson 1.3); corn yield on an irrigated High Plains field against the
        season’s water allowance; and, for machinery, the bushels Cedar Bend loses each year to late planting with each size of planter (from{' '}
        <a href={lessonHref('agriculture/2.1')}>Lesson 2.1</a>). The lower chart is each step’s marginal value — green while it pays, red once it doesn’t — against
        its marginal cost. Move the level and the prices:
      </P>

      <Figure name="Crop Input Optimizer" scenario={s}>
        <Segmented
          label="Input"
          value={input}
          onChange={(v) => s.set({ input: v, level: v === 'nitrogen' ? 6 : v === 'water' ? 4 : 0 })}
          options={(Object.keys(INPUTS) as InputKey[]).map((k) => ({ value: k, label: INPUTS[k].label }))}
        />
        <ResponseChart input={input} curve={curve} level={level} />
        <Legend
          items={[
            { label: input === 'planter' ? 'Bushels lost a year' : 'Expected yield', color: GRAPHIC.gold, kind: 'line' },
            { label: 'Extra value, when it pays', color: GRAPHIC.green },
            { label: 'Extra value, when it doesn’t', color: GRAPHIC.red },
            { label: 'Extra cost', color: '#333', kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: input === 'planter' ? 'bushels lost a year' : 'expected yield', value: input === 'planter' ? fmt(-curve.output[level]) : buAc(curve.output[level], 1), tone: 'gold' },
            { label: `crop value less input cost,${perUnit}`, value: usd(curve.net[level]), tone: 'green' },
            { label: 'best level at these prices', value: INPUTS[input].unit(curve.best), tone: 'green' },
            { label: `given up at this level,${perUnit}`, value: usd(curve.net[curve.best] - curve.net[level]), tone: curve.best === level ? 'ink' : 'red' },
          ]}
        />
        <Slider label={INPUTS[input].label} tone="teal" value={level} min={0} max={maxLevel} step={1} onChange={(v) => s.set({ level: v })} display={INPUTS[input].unit(level)} />
        <Slider label="Corn price" tone="green" value={corn} min={3} max={7} step={0.1} onChange={(v) => s.set({ corn: Math.round(v * 10) / 10 })} display={perBu(corn)} />
        <Slider
          label={priceDef.label}
          tone="red"
          value={inputPrice}
          min={priceDef.min}
          max={priceDef.max}
          step={priceDef.step}
          onChange={(v) => {
            const r = Math.round(v / priceDef.step) * priceDef.step;
            s.set(input === 'nitrogen' ? { nPrice: Math.round(r * 100) / 100 } : input === 'water' ? { pump: r } : { planterCost: Math.round(r * 10) / 10 });
          }}
          display={priceDef.show(inputPrice)}
        />
      </Figure>

      <P>
        Start with nitrogen, at $4.60 corn and 60 cents a pound. The first 20 pounds add 14 bushels, worth $61; the step from 120 to 140 adds 2.0 bushels, worth
        about $8.70, against $12 of fertilizer. The expected yield keeps creeping up, to about 175.6 bushels by 220 pounds, but the return to nitrogen peaks at 120
        pounds, with 172.0 bushels. Cheaper nitrogen or dearer corn pushes the optimum up; dearer nitrogen or cheaper corn pulls it down — at $3.50 corn it falls to
        100 pounds, and with nitrogen at 30 cents it rises to 140. What matters is the ratio of the two prices.
      </P>
      <P>
        Water on the High Plains behaves the same way. The first two inches allowed lift the expected yield from 78.6 bushels to 109.1, and the gain shrinks with
        every step after; the crop stops asking for more at about 8.6 inches pumped in an average season, whatever the allowance. At $11 an acre-inch, the best
        allowance is 12 inches; at $20 it is 10, and at $30, 8. The planter gives the least comfortable answer. Measured on the average spring, the 8-row is the
        best buy: going up to the 12-row saves about 343 bushels a year, worth $1,500, for $8,000 more in ownership costs. (These planter costs are illustrative.)
        Bigger planters earn their keep in the wet springs <FigRef to="Farm Planner · planting schedule">the planting schedule</FigRef> showed, and in labor this
        model doesn’t count — which is why the average is not the whole story.
      </P>
      <P>
        Seed follows the same arithmetic. Averaged over the 200 seasons, Cedar Bend’s corn yields 172.6 bushels at 28,000 plants an acre, 174.3 at 30,000, 175.8 at
        32,000 and 177.1 at 34,000. Each extra 2,000 seeds costs $7.20. Going from 28,000 to 30,000 adds 1.7 bushels, worth $7.40, and just pays; the next step adds
        1.5, worth $6.60, and doesn’t. The planting rate that maximizes return, about 30,000, is again below the rate that maximizes yield. Agronomists at land-grant
        universities publish nitrogen and seeding-rate recommendations built on exactly this idea: the rate where the last unit just pays for itself, at the
        prices of the day.
      </P>

      <Challenge
        id="a"
        question="Suppose nitrogen doubles in price, to $1.20 a pound, with corn still at $4.60. What nitrogen rate now gives the highest return?"
        solved={solved}
        status={
          input !== 'nitrogen'
            ? 'Choose nitrogen.'
            : Math.abs(s.state.nPrice - 1.2) > 1e-6
              ? `Nitrogen is at ${usd(s.state.nPrice, 2)} a pound. Set it to $1.20.`
              : Math.abs(corn - PLAN_PRICE.corn) > 1e-6
                ? 'Set corn back to $4.60.'
                : `At ${fmt(N_RATES[level])} pounds, crop value less nitrogen is ${usd(curve.net[level])} an acre.`
        }
        success={`Solved: at $1.20 a pound the best rate is ${fmt(N_RATES[level])} pounds, ${fmt(N_RATES[inputCurve('nitrogen', PLAN_PRICE.corn, N_PRICE).best] - N_RATES[level])} less than at 60 cents, and the expected yield gives up ${fmt(inputCurve('nitrogen', PLAN_PRICE.corn, N_PRICE).output[inputCurve('nitrogen', PLAN_PRICE.corn, N_PRICE).best] - curve.output[level], 1)} bushels. When fertilizer prices jump, farmers cut back at the margin, and the valley produces a little less corn: input prices, too, shape how much food a region grows.`}
      />

      <H2>The right rate, in hindsight</H2>
      <P>
        The optimum in <FigRef to="Crop Input Optimizer">the optimizer</FigRef> is an average over seasons, and Cedar Bend never farms an average season. In a wet
        spring, rain drains through the root zone and carries nitrate below the roots, as in Lesson 1.3, and the crop needs more fertilizer to make up; in a dry one
        less is lost, and in a drought the crop can’t use what it has. The farmer has to choose the rate at planting, before any of this is known. In the next
        demonstration, each bar counts the seasons, out of 100, in which a given rate would have earned the most, with perfect hindsight; the line is the single rate
        that does best on average:
      </P>

      <Figure name="Crop Input Optimizer · season by season" scenario={h}>
        <HistogramChart
          values={hindsight.best}
          lo={-10}
          hi={270}
          bins={14}
          color={GRAPHIC.violet}
          xTicks={N_RATES.filter((r) => r % 40 === 0)}
          xFormat={(v) => fmt(v)}
          xLabel="best nitrogen rate in hindsight, lb N per acre"
          yLabel="Seasons, of 100"
          marks={[{ x: hindsight.planRate, label: `best on average, ${hindsight.planRate} lb`, color: TEXT.green }]}
          ariaLabel={`The nitrogen rate that would have been best in each of 100 seasons, at ${perBu(h.state.corn)} corn and ${usd(h.state.nPrice, 2)} nitrogen. The best single rate is ${hindsight.planRate} pounds; ${hindsight.within} seasons’ best rates are within 20 pounds of it.`}
        />
        <Readouts
          items={[
            { label: 'best rate on average', value: `${hindsight.planRate} lb N/ac`, tone: 'violet' },
            { label: 'seasons within 20 lb of it', value: `${hindsight.within} of 100` },
            { label: 'cost of not knowing, per acre', value: usd(hindsight.regret, 2), tone: 'red' },
          ]}
        />
        <Slider label="Corn price" tone="green" value={h.state.corn} min={3} max={7} step={0.1} onChange={(v) => h.set({ corn: Math.round(v * 10) / 10 })} display={perBu(h.state.corn)} />
        <Slider label="Nitrogen price" tone="red" value={h.state.nPrice} min={0.3} max={1.5} step={0.05} onChange={(v) => h.set({ nPrice: Math.round(v * 20) / 20 })} display={`${usd(h.state.nPrice, 2)} per lb`} />
      </Figure>

      <P>
        At the starting prices the best single rate is 120 pounds, and in 73 of the 100 seasons the best rate in hindsight was within 20 pounds of it. Thirteen
        seasons wanted 160 pounds or more; five wanted 60 or less. Sticking to the plan cost Cedar Bend about $7 an acre a year against a farmer who somehow knew the
        weather in advance — the price of not knowing. Farmers chip away at it with the split application of Lesson 1.3, holding back part of the nitrogen until
        June, when the spring’s rain is known. It is the same idea as a forecast, the subject of Chapter 3: information that arrives before a decision is worth
        money.
      </P>

      <P>
        So far every threat to the crop has been physical: cold, drought, a wet spring. The next lesson adds living ones — insects, weeds and disease, which grow and
        spread on their own — and compares the ways a farmer can fight them.
      </P>
    </LessonPage>
  );
}
