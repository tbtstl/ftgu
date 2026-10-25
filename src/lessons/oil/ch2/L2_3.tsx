import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, usd, useScenario } from '../../../framework';
import { COST, WELL, fractureArea, fractureSpacing, rockOf, transientEnd, transientRate, wellCost, wellProfile, wellSummary, type WellDesign, type WellType } from '../../../engines/oil/wells';
import { XYChart } from '../shared/charts';

export type Target = 'pinyon' | 'northfield';

const TYPE_LABEL: Record<WellType, string> = { vertical: 'Vertical', horizontal: 'Horizontal', fractured: 'Horizontal + fractures' };
const TARGET_LABEL: Record<Target, string> = { pinyon: 'Pinyon shale', northfield: 'Northfield sandstone' };
const TYPES: WellType[] = ['vertical', 'horizontal', 'fractured'];
const ORANGE = '#d0702a';
const ORANGE_TEXT = '#ad5310';

/** Slider ranges for the lateral and the stages. */
export const LATERAL = { min: 2000, max: 15000, step: 500 };
export const STAGES = { min: 5, max: 80, step: 1 };

/** The first-year production target of the first challenge, barrels. */
export const YEAR_ONE_TARGET = 150000;
/** The first-month rate target of the second challenge, barrels per day. */
export const IP_TARGET = 1000;

const RB = rockOf('pinyon');
const NF = rockOf('northfield');
const rockFor = (t: Target) => (t === 'pinyon' ? RB : NF);

/** First-year production of a design, barrels (only twelve months are simulated). */
export function firstYear(d: WellDesign, target: Target = 'pinyon'): number {
  return wellProfile(d, rockFor(target), 12).cum[11];
}

/** First-month average rate, barrels per day. */
export function firstMonthRate(d: WellDesign, target: Target = 'pinyon'): number {
  return wellProfile(d, rockFor(target), 1).rate[0];
}

let cheapest: { cost: number; design: WellDesign } | null = null;
/** The cheapest fractured Pinyon well on the slider grid producing at least 150,000 barrels in its first year. */
export function cheapestYearOneWell(): { cost: number; design: WellDesign } {
  if (!cheapest) {
    for (let L = LATERAL.min; L <= LATERAL.max; L += LATERAL.step) {
      for (let n = STAGES.min; n <= STAGES.max; n += STAGES.step) {
        const d: WellDesign = { type: 'fractured', lateral: L, stages: n };
        const c = wellCost(d, RB).total;
        if ((!cheapest || c < cheapest.cost) && firstYear(d) >= YEAR_ONE_TARGET) cheapest = { cost: c, design: d };
      }
    }
  }
  return cheapest!;
}

/** How close to the cheapest design challenge a accepts: within 1% of its cost. */
export const CHEAPEST_TOLERANCE = 0.01;

/** Challenge a: a Pinyon well that produces 150,000 barrels in its first year for no more than 1% above the cheapest that does. */
export function cheapestSolved(target: Target, d: WellDesign): boolean {
  if (target !== 'pinyon' || d.type !== 'fractured') return false;
  return firstYear(d) >= YEAR_ONE_TARGET && wellCost(d, RB).total <= cheapestYearOneWell().cost * (1 + CHEAPEST_TOLERANCE);
}

/** The lateral challenge b keeps: the standard well's, ft. */
export const STANDARD_LATERAL = 10000;

/** Challenge b: on the standard 10,000 ft lateral, the fewest stages that give a Pinyon well a first month of at least 1,000 b/d. */
export function fewestStagesSolved(target: Target, d: WellDesign): boolean {
  if (target !== 'pinyon' || d.type !== 'fractured' || d.lateral !== STANDARD_LATERAL) return false;
  if (firstMonthRate(d) < IP_TARGET) return false;
  return d.stages <= STAGES.min || firstMonthRate({ ...d, stages: d.stages - STAGES.step }) < IP_TARGET;
}

/** A Pinyon design's first-month rate per fracture stage, b/d. */
export function perStageRate(d: WellDesign): number {
  return firstMonthRate(d) / Math.max(1, d.stages);
}

/** Rock in contact with the well, ft²: the wellbore wall, or the fracture faces. */
export function contactArea(d: WellDesign, target: Target): number {
  if (d.type === 'fractured') return fractureArea(d);
  const length = d.type === 'vertical' ? rockFor(target).h : d.lateral;
  return 2 * Math.PI * WELL.rw * length;
}

function bpd(q: number): string {
  return q < 10 ? `${fmt(q, 1)} b/d` : `${fmt(q)} b/d`;
}

function bbl(v: number): string {
  return v < 10000 ? `${fmt(v)} bbl` : `${fmt(Math.round(v / 100) * 100)} bbl`;
}

function millions(v: number): string {
  return `$${fmt(v / 1e6, 2)} million`;
}

function perBarrel(v: number): string {
  return v < 10 ? usd(v, 2) : usd(v);
}

function areaText(a: number): string {
  return a >= 1e6 ? `${fmt(a / 1e6, 1)} million ft²` : `${fmt(a)} ft²`;
}

// Reference designs quoted in the prose.
const STANDARD: WellDesign = { type: 'fractured', lateral: STANDARD_LATERAL, stages: 50 };
/** Challenge b's estimate: stages for 1,000 b/d if each did what the standard well's average stage does (about 31). */
export const STAGES_ESTIMATE = IP_TARGET / perStageRate(STANDARD);
/** Days the standard well is held at the surface equipment's limit: its linear-flow rate falls as 1/√t (about 3). */
export const STANDARD_CAP_DAYS = (transientRate(STANDARD, RB, 1) / WELL.maxRate) ** 2;
/** What 500 ft more lateral adds to a well's cost, $ (about $65,000). */
export const LATERAL_500_COST = wellCost({ ...STANDARD, lateral: 9500 }, RB).total - wellCost({ ...STANDARD, lateral: 9000 }, RB).total;
const V = wellSummary({ type: 'vertical', lateral: 0, stages: 0 }, RB);
const H = wellSummary({ type: 'horizontal', lateral: 10000, stages: 0 }, RB);
const F = wellSummary(STANDARD, RB);
const HALF_STAGES = wellSummary({ ...STANDARD, stages: 25 }, RB);
const SHORT = wellSummary({ ...STANDARD, lateral: 5000 }, RB);
const NFV = wellSummary({ type: 'vertical', lateral: 0, stages: 0 }, NF);

// The cross-section: depths and distances on separate scales (layer thicknesses exaggerated).
const DEPTH_MAX = 10500;
const yOf = (ft: number) => 40 + (ft / DEPTH_MAX) * 196;
const xOf = (ft: number) => 72 + (ft / 16000) * 548;
const CURVE_FT = 640;
const BAND: Record<Target, { top: number; px: number; color: string; name: string }> = {
  northfield: { top: 7800, px: 14, color: '#ecc65a', name: 'Northfield sandstone' },
  pinyon: { top: 9500, px: 16, color: '#8d7b6a', name: 'Pinyon shale' },
};

function WellSection({ d, target }: { d: WellDesign; target: Target }) {
  const rock = rockFor(target);
  const band = BAND[target];
  const yT = yOf(band.top) + band.px / 2;
  const x0 = xOf(0);
  const cost = wellCost(d, rock);
  const horizontal = d.type !== 'vertical';
  const kop = yT - 14;
  const xLatStart = xOf(CURVE_FT);
  const xLatEnd = xOf(CURVE_FT + d.lateral);
  const path = horizontal ? `M${x0} 40 L${x0} ${kop} Q${x0} ${yT} ${xLatStart} ${yT} L${xLatEnd} ${yT}` : `M${x0} 40 L${x0} ${yOf(band.top) + band.px + 4}`;
  const fracs = d.type === 'fractured' ? Array.from({ length: d.stages }, (_, i) => xLatStart + ((i + 0.5) / d.stages) * (xLatEnd - xLatStart)) : [];
  const ticks = [0, 2000, 4000, 6000, 8000, 10000];
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 276"
      role="img"
      aria-label={`${TYPE_LABEL[d.type]} well into the ${band.name.toLowerCase()} at ${fmt(band.top)} ft${horizontal ? `, with a ${fmt(d.lateral)} ft lateral` : ''}${d.type === 'fractured' ? ` and ${d.stages} fracture stages` : ''}. Measured depth ${fmt(cost.measuredDepth)} ft; true vertical depth ${fmt(rock.depth)} ft.`}
    >
      <rect x={30} y={40} width={600} height={210} fill="#f3efe6" />
      {[1200, 2600, 4100, 5600, 6900, 8600].map((ft, i) => (
        <line key={ft} x1={30} x2={630} y1={yOf(ft)} y2={yOf(ft) + (i % 2 ? 3 : -2)} stroke="#e1d9c6" strokeWidth={1.2} />
      ))}
      {(Object.keys(BAND) as Target[]).map((t) => {
        const b = BAND[t];
        const on = t === target;
        return (
          <g key={t}>
            <rect x={30} y={yOf(b.top)} width={600} height={b.px} fill={b.color} opacity={on ? 0.9 : 0.35} />
            <text x={626} y={t === 'northfield' ? yOf(b.top) - 5 : yOf(b.top) + b.px + 13} textAnchor="end" style={{ fontSize: 12, fontWeight: on ? 600 : 400, fill: on ? '#333' : '#777' }}>
              {b.name} · {fmt(b.top)} ft
            </text>
          </g>
        );
      })}
      {ticks.map((ft) => (
        <text key={ft} className="ax ax-e" x={26} y={yOf(ft) + 4}>
          {ft === 0 ? 'surface' : `${fmt(ft)} ft`}
        </text>
      ))}
      <line x1={30} x2={630} y1={40} y2={40} stroke="#9a9a9a" strokeWidth={1.5} />
      {fracs.map((x, i) => (
        <ellipse key={i} cx={x} cy={yT} rx={1.6} ry={13} fill={ORANGE} opacity={0.75} />
      ))}
      <path d={path} fill="none" stroke="#333" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      <g stroke="#555" strokeWidth={1.5} fill="none">
        <path d={`M${x0 - 10} 40 L${x0} 12 L${x0 + 10} 40`} />
        <line x1={x0 - 6} x2={x0 + 6} y1={26} y2={26} />
      </g>
      <text className="ax" x={x0 + 16} y={22}>
        rig
      </text>
      <text className="ax ax-e" x={626} y={22}>
        measured depth {fmt(cost.measuredDepth)} ft · true vertical depth {fmt(rock.depth)} ft · layers not to scale
      </text>
    </svg>
  );
}

/** Contact area and first-month rate of the three designs, at the current lateral, stages and target. */
function ContactBars({ lateral, stages, target, type }: { lateral: number; stages: number; target: Target; type: WellType }) {
  const rows = TYPES.map((t) => {
    const d: WellDesign = { type: t, lateral, stages };
    return { t, area: contactArea(d, target), ip: firstMonthRate(d, target) };
  });
  const aX0 = 160;
  const aW = 170;
  const rX0 = 430;
  const rW = 140;
  const la = (a: number) => aX0 + ((Math.log10(Math.max(a, 10)) - 1) / 7) * aW; // 10 ft² … 100 million ft²
  const lr = (q: number) => rX0 + ((Math.log10(Math.max(q, 0.5)) - Math.log10(0.5)) / 4) * rW; // 0.5 … 5,000 b/d
  const rowH = 34;
  const top = 30;
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${top + rowH * 3 + 26}`}
      role="img"
      aria-label={`Rock in contact with each design in the ${TARGET_LABEL[target].toLowerCase()}, and its first-month rate: ${rows.map((r) => `${TYPE_LABEL[r.t].toLowerCase()} ${areaText(r.area)}, ${bpd(r.ip)}`).join('; ')}.`}
    >
      <text className="ax" x={aX0} y={14}>
        Rock in contact with the well (log scale)
      </text>
      <text className="ax" x={rX0} y={14}>
        First-month rate (log scale)
      </text>
      {rows.map((r, i) => {
        const y = top + i * rowH;
        const on = r.t === type;
        return (
          <g key={r.t}>
            <text x={aX0 - 10} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333', fontWeight: on ? 600 : 400 }}>
              {TYPE_LABEL[r.t]}
            </text>
            <rect x={aX0} y={y + 7} width={Math.max(1, la(r.area) - aX0)} height={rowH - 14} fill={on ? '#777' : '#c4c4c4'} />
            <text x={la(r.area) + 6} y={y + rowH / 2 + 4} style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
              {areaText(r.area)}
            </text>
            <rect x={rX0} y={y + 7} width={Math.max(1, lr(r.ip) - rX0)} height={rowH - 14} fill={on ? ORANGE : '#ecc3a3'} />
            <text x={lr(r.ip) + 6} y={y + rowH / 2 + 4} style={{ fontSize: 12, fontWeight: 500, fill: ORANGE_TEXT }}>
              {bpd(r.ip)}
            </text>
          </g>
        );
      })}
      {[10, 1e3, 1e5, 1e7].map((a) => (
        <text key={a} className="ax ax-m" x={la(a)} y={top + rowH * 3 + 16}>
          {a >= 1e6 ? `${a / 1e6}M` : fmt(a)}
        </text>
      ))}
      {[1, 10, 100, 1000].map((q) => (
        <text key={q} className="ax ax-m" x={lr(q)} y={top + rowH * 3 + 16}>
          {fmt(q)}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('well', { type: 'vertical' as WellType, target: 'pinyon' as Target, lateral: 10000, stages: 50 });
  const { type, target, lateral, stages } = s.state;
  const d: WellDesign = { type, lateral, stages };
  const rock = rockFor(target);
  const sum = useMemo(() => wellSummary({ type, lateral, stages }, rockFor(target)), [type, lateral, stages, target]);
  const cost = sum.cost.total;
  const months = sum.profile.rate.slice(0, 36).map((q, i) => [i + 0.5, q] as [number, number]);
  const standardMonths = F.profile.rate.slice(0, 36).map((q, i) => [i + 0.5, q] as [number, number]);
  const isStandard = target === 'pinyon' && type === 'fractured' && lateral === STANDARD.lateral && stages === STANDARD.stages;
  const best = cheapestYearOneWell();
  const solvedA = cheapestSolved(target, d);
  const solvedB = fewestStagesSolved(target, d);
  const capped = sum.ip30 >= WELL.maxRate - 50;

  const controls = (
    <>
      <Segmented label="Well type" value={type} onChange={(v) => s.set({ type: v })} options={TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
      <Segmented label="Target" value={target} onChange={(v) => s.set({ target: v })} options={(['pinyon', 'northfield'] as Target[]).map((t) => ({ value: t, label: TARGET_LABEL[t] }))} />
      <Slider
        label="Lateral length"
        value={lateral}
        min={LATERAL.min}
        max={LATERAL.max}
        step={LATERAL.step}
        disabled={type === 'vertical'}
        onChange={(v) => s.set({ lateral: v })}
        display={type === 'vertical' ? '—' : `${fmt(lateral)} ft`}
      />
      <Slider
        label="Fracture stages"
        tone="orange"
        value={stages}
        min={STAGES.min}
        max={STAGES.max}
        step={STAGES.step}
        disabled={type !== 'fractured'}
        onChange={(v) => s.set({ stages: v })}
        display={type !== 'fractured' ? '—' : `${stages}`}
      />
    </>
  );

  let caption: string;
  if (type === 'vertical') caption = `A vertical well meets the ${TARGET_LABEL[target].toLowerCase()} only across the layer’s ${fmt(rock.h)} ft of thickness.`;
  else if (type === 'horizontal') caption = `The lateral runs ${fmt(lateral)} ft along the layer, with no fractures.`;
  else
    caption = `${stages} stages put fractures every ${fmt(fractureSpacing(d))} ft; ${
      target === 'pinyon' ? `their pressure disturbances meet after ${fmt(transientEnd(d, rock))} days.` : 'in permeable rock they add cost, not oil.'
    }`;
  if (capped) caption += ` The well is held at the ${fmt(WELL.maxRate)} b/d its surface equipment can handle.`;

  return (
    <LessonPage id="oil/2.3">
      <P>
        <a href={lessonHref('oil/2.2')}>The previous lesson</a> ended on a discouraging number. Pinyon’s rock conducts oil so poorly that the pressure disturbance from
        a well takes about three months to spread fifty feet. At Northfield, a well feels the rock a thousand feet away within a few days. At Pinyon, the well has to go to the oil.
        This lesson is about how wells are built, and how a well’s shape decides what it can produce.
      </P>
      <P>
        A drilling rig turns a string of steel pipe with a bit on the end. Drilling fluid, called mud, is pumped down the pipe and back up around it: it cools the bit,
        carries the crushed rock to the surface, and by its weight holds back the pressure of the fluids in the rock. As the hole deepens, the crew lowers steel{' '}
        <b>casing</b> into it and cements it in place, sealing off the rock the well has passed through. A well therefore has two depths. Its <b>true vertical depth</b>{' '}
        is how far down it reaches; its <b>measured depth</b> is the length of hole actually drilled. For a vertical well they are the same.
      </P>
      <P>
        They needn’t be. Tools near the bit let the driller steer it, so the hole can bend from vertical to horizontal over about a thousand feet and then run sideways
        for miles inside a layer only a hundred or so feet thick. This horizontal section is the <b>lateral</b>. In tight rock, the lateral is then cracked open by{' '}
        <b>hydraulic fracturing</b>: fluid that is mostly water, carrying sand, is pumped in at pressures high enough to split the rock. When the pumping stops, the cracks
        close onto the sand grains, which prop them open as paths for the oil. The work is done in <b>stages</b>, one short section of the lateral at a time, dozens of
        stages to a well. In our model each stage opens two fractures that reach {fmt(WELL.halfLength)} ft out on each side of the well and stand {fmt(WELL.fracHeight)}{' '}
        ft tall. Long laterals with many fracture stages are what turned shale into a major source of oil in the United States from around 2010.
      </P>
      <P>
        In the next demonstration, choose a type of well and a target layer, and set the length of the lateral and the number of fracture stages. The costs are
        illustrative model numbers in a realistic range: a rig and crew by the day, steel by the foot, and a price per fracture stage. The chart follows the well’s
        monthly rate through its first three years, on a logarithmic scale, in barrels a day (b/d) — stock-tank barrels, as in{' '}
        <a href={lessonHref('oil/2.1')}>Lesson 2.1</a>:
      </P>

      <Figure name="Well Designer" scenario={s}>
        <WellSection d={d} target={target} />
        {controls}
        <Readouts
          items={[
            { label: <K c="price">well cost</K>, value: millions(cost), tone: 'green' },
            { label: <K tone="orange">first-month rate</K>, value: bpd(sum.ip30), tone: 'orange' },
            { label: <K tone="orange">first-year production</K>, value: bbl(sum.firstYear), tone: 'orange' },
            { label: <K c="price">cost per first-year barrel</K>, value: perBarrel(cost / Math.max(1, sum.firstYear)), tone: 'green' },
          ]}
        />
        {!isStandard && target === 'pinyon' && (
          <Legend
            items={[
              { label: 'This design', color: ORANGE, kind: 'line' },
              { label: 'Standard Pinyon well: 10,000 ft, 50 stages', color: '#9a9a9a', kind: 'line', dashed: true },
            ]}
          />
        )}
        <XYChart
          ariaLabel={`Monthly rate over the first three years: ${bpd(sum.profile.rate[0])} in month 1, ${bpd(sum.profile.rate[11])} in month 12 and ${bpd(sum.profile.rate[35])} in month 36.`}
          height={200}
          x={[0, 36]}
          y={[0.5, 5000]}
          logY
          xTicks={[0, 6, 12, 18, 24, 30, 36]}
          yTicks={[1, 10, 100, 1000]}
          yFormat={(v) => fmt(v)}
          xLabel="months on production"
          yLabel="Oil rate, barrels per day (log scale)"
          series={[
            ...(!isStandard && target === 'pinyon' ? [{ points: standardMonths, color: '#9a9a9a', width: 2, dash: '6 4' }] : []),
            { points: months, color: ORANGE, width: 3 },
          ]}
        />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        Start with the vertical well in Pinyon shale. It costs {millions(V.cost.total)} and produces about {bpd(V.ip30)}: the rock simply can’t deliver more through
        the {fmt(RB.h)} ft of wellbore wall it touches. Turn it into a horizontal well with a {fmt(10000)} ft lateral and the first month averages {bpd(H.ip30)}, for{' '}
        {millions(H.cost.total)}. Now add {STANDARD.stages} fracture stages. This is the course’s standard Pinyon well, and it costs {millions(F.cost.total)} — of which
        the completion, the fracturing and everything that goes with it, is {millions(F.cost.completion)} — and averages {bpd(F.ip30)} in its first month. Fracturing
        nearly doubles the cost of the horizontal well and multiplies its first-month rate {fmt(F.ip30 / H.ip30)} times. Over the first year it produces{' '}
        {bbl(F.firstYear)}, which works out to {perBarrel(F.cost.total / F.firstYear)} of well for every barrel; the unfractured lateral needs{' '}
        {perBarrel(H.cost.total / H.firstYear)}.
      </P>
      <P>
        Then switch the target to Northfield sandstone. A plain vertical well there costs {millions(NFV.cost.total)}, flows {bpd(NFV.ip30)} in its first month and
        produces {bbl(NFV.firstYear)} in its first year: {perBarrel(NFV.cost.total / NFV.firstYear)} per barrel. A horizontal well does better still, until it reaches the{' '}
        {fmt(WELL.maxRate)} barrels a day its surface equipment can handle, and fracturing adds cost and nothing else. Permeable rock delivers oil to any well that reaches
        it. That’s why fields like Northfield were developed decades before anyone could make money from shale.
      </P>

      <H2>It’s the fractures, not the pipe</H2>
      <P>
        Why do fractures matter so much more than the steel? Oil reaches a well through the rock surface the well exposes, and in tight rock it can only travel a short
        distance in any reasonable time. The next demonstration compares that surface for the three designs, at the lateral length, stage count and target you’ve set in{' '}
        <FigRef to="Well Designer">the first demonstration</FigRef>, alongside each design’s first-month rate:
      </P>

      <Figure name="Well Designer · contact" scenario={s}>
        <ContactBars lateral={lateral} stages={stages} target={target} type={type} />
        {controls}
        <Readouts items={[{ label: 'fracture spacing', value: type === 'fractured' ? `${fmt(fractureSpacing(d))} ft` : '—' }]} />
      </Figure>

      <P>
        The wall of a vertical wellbore through Pinyon shale is {areaText(contactArea({ type: 'vertical', lateral: 0, stages: 0 }, 'pinyon'))}. A {fmt(10000)} ft
        lateral exposes {areaText(contactArea({ type: 'horizontal', lateral: 10000, stages: 0 }, 'pinyon'))}. The fracture faces of the standard well add up to{' '}
        {areaText(fractureArea(STANDARD))}, about {fmt(Math.round(fractureArea(STANDARD) / contactArea({ type: 'vertical', lateral: 0, stages: 0 }, 'pinyon') / 1000) * 1000)}{' '}
        times the vertical well’s wall. Early on, each fracture face feeds oil in proportion to its area, because the pressure disturbance moves straight out from it
        into fresh rock. Oil crossing the rock along parallel paths into a flat face like this is in <b>linear flow</b>, unlike the radial flow that converges on a
        vertical well in <a href={lessonHref('oil/2.2')}>Lesson 2.2</a>. Halve the stages to 25 and the first-month rate falls to {bpd(HALF_STAGES.ip30)}, about half.
      </P>

      <Challenge
        id="b"
        question={`The standard well’s ${STANDARD.stages} stages give it ${bpd(F.ip30)} in its first month. Estimate first: if every stage added the same, how many would a first month of ${fmt(IP_TARGET)} barrels a day take? Then, keeping the standard ${fmt(STANDARD_LATERAL)} ft lateral, find the fewest stages that really do it.`}
        solved={solvedB}
        status={
          target !== 'pinyon' || type !== 'fractured'
            ? 'Choose a horizontal well with fractures in Pinyon shale.'
            : lateral !== STANDARD_LATERAL
              ? `Keep the standard ${fmt(STANDARD_LATERAL)} ft lateral.`
              : `${stages} stages: ${bpd(sum.ip30)} in the first month.`
        }
        success={`Solved: ${stages} stages give ${bpd(sum.ip30)}, and one fewer would fall short. The standard well’s average, ${fmt(perStageRate(STANDARD), 1)} b/d a stage, points to about ${fmt(STAGES_ESTIMATE)}; the real answer is a little lower because that well spends its first ${fmt(STANDARD_CAP_DAYS)} days held at the ${fmt(WELL.maxRate)} b/d its surface equipment can handle, which drags its average down. Unheld, with the fractures far enough apart not to interfere in the first month, each stage delivers about ${fmt(perStageRate(d))} b/d: the rate is set by the fracture area.`}
      />

      <P>
        The lateral’s length matters differently. With the number of stages fixed, it sets how far apart the fractures are. Shorten the standard well to {fmt(5000)} ft
        and the {fmt(STANDARD.stages * WELL.fracturesPerStage)} fractures of its {STANDARD.stages} stages sit {fmt(fractureSpacing({ ...STANDARD, lateral: 5000 }))} ft
        apart instead of {fmt(fractureSpacing(STANDARD))}. The first month is almost unchanged, at {bpd(SHORT.ip30)}, but
        after only {fmt(transientEnd({ ...STANDARD, lateral: 5000 }, RB))} days the disturbances from neighboring fractures meet, the fractures start draining the same
        rock, and the first year yields {bbl(SHORT.firstYear)} instead of {bbl(F.firstYear)}. A longer lateral costs more to drill, but it gives each fracture rock of
        its own.
      </P>

      <Challenge
        id="a"
        figure="Well Designer"
        question={`Stages buy early oil; lateral buys the room that keeps it coming. Design the cheapest Pinyon well that produces at least ${fmt(YEAR_ONE_TARGET)} barrels in its first year: get within 1% of the cheapest design the sliders allow.`}
        solved={solvedA}
        status={
          target !== 'pinyon'
            ? 'Set the target to Pinyon shale.'
            : type !== 'fractured'
              ? `This ${TYPE_LABEL[type].toLowerCase()} well produces ${bbl(sum.firstYear)} in its first year. It will need fractures.`
              : sum.firstYear < YEAR_ONE_TARGET
                ? `${fmt(lateral)} ft with ${stages} stages: ${bbl(sum.firstYear)} in the first year, short of the target, for ${millions(cost)}.`
                : `${fmt(lateral)} ft with ${stages} stages makes ${bbl(sum.firstYear)} for ${millions(cost)}. That meets the target, but a design more than 1% cheaper does too.`
        }
        success={`Solved: ${fmt(lateral)} ft with ${stages} stages makes ${bbl(sum.firstYear)} for ${millions(cost)}${
          cost <= best.cost + 1
            ? ', the cheapest design the sliders allow.'
            : `, within 1% of the cheapest design the sliders allow: ${fmt(best.design.lateral)} ft with ${best.design.stages} stages, for ${millions(best.cost)}.`
        } Each 500 ft of lateral costs about ${usd(Math.round(LATERAL_500_COST / 1000) * 1000)} and each stage ${usd(COST.perStage)}, so near the cheapest design, swapping 500 ft of lateral for one more stage costs only about ${usd(Math.round((COST.perStage - LATERAL_500_COST) / 1000) * 1000)}. Fewer stages lose production, and squeezing more stages into less lateral packs the fractures so close that they soon compete for the same rock.`}
      />

      <P>
        Look again at the chart in <FigRef to="Well Designer">the first demonstration</FigRef>. The standard Pinyon well starts at {bpd(F.ip30)} but is down to{' '}
        {bpd(F.profile.rate[11])} a year later, while the Northfield vertical well, after its first year, still makes {bpd(NFV.profile.rate[11])}. No well holds its
        first-month rate. How quickly each one falls, what that means for the oil a well will produce over its life, and how a whole field can be kept going, are the
        subjects of the <a href={lessonHref('oil/2.4')}>next lesson</a>.
      </P>
    </LessonPage>
  );
}
