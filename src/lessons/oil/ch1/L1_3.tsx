import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, TEXT, GRAPHIC, fmt, lessonHref, pct, useScenario } from '../../../framework';
import { blend, blendViscosity, classify, crude, cumulativeYield, sulfurKgPerBarrel, viscosity, type Crude } from '../../../engines/oil/assay';
import { CRUDE_COLOR, CRUDE_IDS, CRUDE_SPECS, type CrudeId } from '../../../model/oil/crudes';
import { XYChart } from '../shared/charts';

const NAME: Record<CrudeId, string> = Object.fromEntries(CRUDE_SPECS.map((s) => [s.id, s.name])) as Record<CrudeId, string>;
const C: Record<CrudeId, Crude> = Object.fromEntries(CRUDE_IDS.map((id) => [id, crude(id)])) as Record<CrudeId, Crude>;

/** NYMEX light sweet crude (WTI) delivery specification: API 37–42°, sulfur at most 0.42%. */
export const WTI_SPEC = { apiMin: 37, apiMax: 42, sulfurMax: 0.42 };
/** The Coldwater pipeline's limit in this course's world: 350 cSt at 10 °C. */
export const PIPE_LIMIT_CST = 350;
export const PIPE_TEMP_C = 10;

function cst(v: number): string {
  return v < 10 ? `${fmt(v, 1)} cSt` : `${fmt(v)} cSt`;
}

const meetsWti = (b: Crude) => b.api >= WTI_SPEC.apiMin && b.api <= WTI_SPEC.apiMax && b.sulfur <= WTI_SPEC.sulfurMax + 1e-12;

/** Challenge a: the lowest temperature (whole degrees) at which Coldwater Heavy is as thin as Northfield Sour at 0 °C. */
export function heatSolved(temp: number): boolean {
  const target = viscosity(C.northfield, 0);
  return viscosity(C.coldwater, temp) <= target && viscosity(C.coldwater, temp - 1) > target;
}

/** Challenge b: the least Pinyon Light (whole percent) that brings Coldwater Heavy under the pipeline limit at 10 °C. */
export function diluentSolved(base: CrudeId, added: CrudeId, sharePct: number): boolean {
  if (base !== 'coldwater' || added !== 'pinyon') return false;
  const v = (p: number) => blendViscosity([{ crude: C.coldwater, share: 100 - p }, { crude: C.pinyon, share: p }], PIPE_TEMP_C);
  return v(sharePct) <= PIPE_LIMIT_CST && v(sharePct - 1) > PIPE_LIMIT_CST;
}

/** Pinyon Light with p% Northfield Sour by volume. */
const rbNf = (p: number) => blend([{ crude: C.pinyon, share: 100 - p }, { crude: C.northfield, share: p }]);

/** Challenge c: the most Northfield Sour (whole percent) Pinyon Light can take and still meet the WTI specification. */
export function wtiSolved(base: CrudeId, added: CrudeId, sharePct: number): boolean {
  if (base !== 'pinyon' || added !== 'northfield') return false;
  return meetsWti(rbNf(sharePct)) && !meetsWti(rbNf(sharePct + 1));
}

/**
 * Challenge c's back-of-envelope answer: the share of Northfield Sour, by weight, that brings the
 * blend's sulfur to the WTI limit, (0.42 − 0.15) ÷ (1.9 − 0.15).
 */
export const WTI_SULFUR_SHARE_BY_WEIGHT = (WTI_SPEC.sulfurMax - C.pinyon.sulfur) / (C.northfield.sulfur - C.pinyon.sulfur);

/** The most Northfield Sour (whole percent) that keeps the blend at or above 37° API, the other limit. */
export const WTI_API_FLOOR_SHARE = (() => {
  let p = 0;
  while (p < 100 && rbNf(p + 1).api >= WTI_SPEC.apiMin) p++;
  return p;
})();

/** The API–sulfur map, with the usual classes and the WTI delivery specification. */
function GradeMap({ selected, onSelect, extra }: { selected: CrudeId | null; onSelect?: (id: CrudeId) => void; extra?: { api: number; sulfur: number; label: string } }) {
  return (
    <XYChart
      ariaLabel={`Crude grades by API gravity and sulfur: ${CRUDE_IDS.map((id) => `${NAME[id]} ${fmt(C[id].api, 1)}° and ${fmt(C[id].sulfur, 2)}%`).join('; ')}.${extra ? ` ${extra.label}: ${fmt(extra.api, 1)}° and ${fmt(extra.sulfur, 2)}%.` : ''}`}
      height={270}
      x={[15, 50]}
      y={[0.1, 6]}
      logY
      xTicks={[15, 20, 25, 30, 35, 40, 45, 50]}
      yTicks={[0.1, 0.2, 0.5, 1, 2, 5]}
      xFormat={(v) => `${v}°`}
      yFormat={(v) => `${v}%`}
      xLabel="API gravity · lighter →"
      yLabel="Sulfur, % by weight (log scale)"
      bands={[
        { from: 15, to: 22.3, color: 'rgba(107, 90, 78, .08)', label: 'heavy' },
        { from: 22.3, to: 31.1, color: 'rgba(208, 112, 42, .06)', label: 'medium' },
        { from: 31.1, to: 50, color: 'rgba(69, 144, 206, .06)', label: 'light' },
      ]}
      refs={[{ axis: 'y', at: 0.5, color: GRAPHIC.orange, dash: '4 4' }]}
      markers={[
        ...CRUDE_IDS.map((id) => ({
          x: C[id].api,
          y: C[id].sulfur,
          color: CRUDE_COLOR[id],
          r: id === selected ? 8 : 6,
          label: NAME[id],
          labelDx: id === 'seaboard' ? -10 : 10,
          labelAnchor: id === 'seaboard' ? ('end' as const) : ('start' as const),
          labelDy: 4,
        })),
        ...(extra ? [{ x: extra.api, y: extra.sulfur, color: '#333', r: 5, hollow: true, label: extra.label, labelDy: -10 }] : []),
      ]}
    >
      {(sx, sy) => (
        <g>
          <rect
            x={sx(WTI_SPEC.apiMin)}
            y={sy(WTI_SPEC.sulfurMax)}
            width={sx(WTI_SPEC.apiMax) - sx(WTI_SPEC.apiMin)}
            height={sy(0.1) - sy(WTI_SPEC.sulfurMax)}
            fill="none"
            stroke="#333"
            strokeWidth={1.5}
          />
          <text x={sx(WTI_SPEC.apiMax) + 4} y={sy(WTI_SPEC.sulfurMax) + 12} className="ax" style={{ fill: '#333' }}>
            WTI delivery spec
          </text>
          <text x={sx(15) + 6} y={sy(0.5) - 6} className="ax" style={{ fill: TEXT.orange }}>
            sour ↑
          </text>
          <text x={sx(15) + 6} y={sy(0.5) + 14} className="ax" style={{ fill: TEXT.orange }}>
            sweet ↓
          </text>
          {onSelect &&
            CRUDE_IDS.map((id) => (
              <circle
                key={id}
                cx={sx(C[id].api)}
                cy={sy(C[id].sulfur)}
                r={14}
                fill="transparent"
                role="button"
                tabIndex={0}
                aria-label={`Select ${NAME[id]}`}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(id);
                  }
                }}
              />
            ))}
        </g>
      )}
    </XYChart>
  );
}

export default function Lesson() {
  const s1 = useScenario('grades', { crude: 'coldwater' as CrudeId });
  const sel = C[s1.state.crude];
  const cls = classify(sel.api, sel.sulfur);

  const sv = useScenario('viscosity', { temp: 20 });
  const T = sv.state.temp;
  const viscCurves = useMemo(
    () => CRUDE_IDS.map((id) => ({ id, pts: Array.from({ length: 61 }, (_, t) => [t, viscosity(C[id], t)] as [number, number]) })),
    [],
  );
  const nf0 = viscosity(C.northfield, 0);
  const cwT = viscosity(C.coldwater, T);

  const s2 = useScenario('blend', { base: 'coldwater' as CrudeId, added: 'pinyon' as CrudeId, share: 10 });
  const { base, added, share } = s2.state;
  const parts = [
    { crude: C[base], share: 100 - share },
    { crude: C[added], share },
  ];
  const b = blend(parts);
  const bv = blendViscosity(parts, PIPE_TEMP_C);
  const curve = useMemo(
    () =>
      Array.from({ length: 101 }, (_, p) => [p, blendViscosity([{ crude: C[base], share: 100 - p }, { crude: C[added], share: p }], PIPE_TEMP_C)] as [number, number]),
    [base, added],
  );
  const half = blend([{ crude: C.pinyon, share: 50 }, { crude: C.coldwater, share: 50 }]);
  const halfV = blendViscosity([{ crude: C.pinyon, share: 50 }, { crude: C.coldwater, share: 50 }], PIPE_TEMP_C);

  const solvedA = heatSolved(T);
  const solvedB = diluentSolved(base, added, share);
  const solvedC = wtiSolved(base, added, share);

  return (
    <LessonPage id="oil/1.3">
      <P>
        An assay runs to dozens of pages: yields, densities, sulfur and metals for every cut, and much more. Traders don’t quote all of that. They describe a crude with
        a handful of numbers, and two of them do most of the work. <K tone="teal">API gravity</K>, from <a href={lessonHref('oil/1.2')}>the previous lesson</a>, says
        whether a crude is <b>light</b> or <b>heavy</b>. <K tone="orange">Sulfur</K> content says whether it’s <b>sweet</b> or <b>sour</b> — names said to date from the days when
        prospectors judged crude by taste and smell. By the usual convention, a crude with no more than 0.5% sulfur is sweet.
      </P>
      <P>
        In the next demonstration, the four crudes of this course are placed by those two numbers. Click a crude (or choose it with the buttons) to read its profile:
      </P>

      <Figure name="Crude Properties Lab" scenario={s1}>
        <Segmented label="Crude" value={s1.state.crude} onChange={(v) => s1.set({ crude: v })} options={CRUDE_IDS.map((id) => ({ value: id, label: NAME[id] }))} />
        <GradeMap selected={s1.state.crude} onSelect={(id) => s1.set({ crude: id })} />
        <Readouts
          items={[
            { label: 'grade', value: `${cls.gravity}, ${cls.sweetness}` },
            { label: <K tone="teal">API gravity</K>, value: `${fmt(sel.api, 1)}°`, tone: 'teal' },
            { label: 'boils below 350 °C', value: pct(cumulativeYield(sel, 350)) },
            { label: <K tone="orange">sulfur per barrel</K>, value: `${fmt(sulfurKgPerBarrel(sel), 2)} kg`, tone: 'orange' },
          ]}
        />
      </Figure>

      <P>
        Pinyon Light and Seaboard Blend are light and sweet, Northfield Sour medium and sour, Coldwater Heavy heavy and sour. The box marks a real specification: the
        crude that can be delivered against the New York Mercantile Exchange’s light sweet crude futures contract — the contract behind the WTI price, West Texas
        Intermediate — must be between 37° and 42° API with at most 0.42% sulfur. The other great benchmark, Brent, is also a light sweet crude, from fields in the
        North Sea. Notice that Pinyon Light falls just outside the box: at {fmt(C.pinyon.api, 1)}°, it’s slightly too light. Many shale crudes are.
      </P>
      <P>
        Why should light, sweet crude be worth more than heavy, sour crude? The readouts give the physical reasons. A barrel of Pinyon Light has{' '}
        {pct(cumulativeYield(C.pinyon, 350))} of its volume boiling in the ranges that become gasoline, jet fuel and diesel, against{' '}
        {pct(cumulativeYield(C.coldwater, 350))} for Coldwater Heavy. To make fuels from the rest, a refinery needs expensive equipment that breaks big molecules into
        small ones. And each barrel of Coldwater Heavy brings {fmt(sulfurKgPerBarrel(C.coldwater), 1)} kilograms of sulfur that has to be removed, against{' '}
        {fmt(sulfurKgPerBarrel(C.pinyon), 2)} kg for Pinyon Light, along with the metals that poison the catalysts doing that work. So heavy, sour crudes
        generally sell at a discount to light, sweet ones. How large the discount should be depends on what each refinery can do with them, which is the subject of
        Chapter 3.
      </P>

      <H2>Viscosity</H2>
      <P>
        Density and sulfur don’t say how easily the oil flows. <K tone="violet">Viscosity</K> is a fluid’s resistance to flowing, and the kinematic viscosity used for oil
        is measured in centistokes (cSt). Water is about 1 cSt at 20 °C. <a href={lessonHref('oil/2.2')}>Lesson 2.2</a> uses the dynamic viscosity instead, measured in
        centipoise (cP): divide it by the fluid’s density in grams per cubic centimeter and you get the kinematic viscosity in centistokes, so for water the two numbers
        are almost the same. In the next demonstration, set the temperature with the slider or by dragging across the chart:
      </P>

      <Figure name="Crude Properties Lab · viscosity" scenario={sv}>
        <Legend items={CRUDE_IDS.map((id) => ({ label: NAME[id], color: CRUDE_COLOR[id], kind: 'line' as const }))} />
        <XYChart
          ariaLabel={`Viscosity against temperature for the four crudes, on a logarithmic scale, with a dashed line at Northfield Sour’s ${cst(nf0)} at 0 °C. At ${T} °C: ${CRUDE_IDS.map((id) => `${NAME[id]} ${cst(viscosity(C[id], T))}`).join(', ')}.`}
          height={240}
          x={[0, 60]}
          y={[1, 10000]}
          logY
          yTicks={[1, 10, 100, 1000, 10000]}
          yFormat={(v) => fmt(v)}
          xTicks={[0, 10, 20, 30, 40, 50, 60]}
          xFormat={(v) => `${v} °C`}
          yLabel="Viscosity, centistokes (log scale)"
          series={viscCurves.map(({ id, pts }) => ({ points: pts, color: CRUDE_COLOR[id], width: 2.5 }))}
          refs={[
            { axis: 'y', at: nf0, color: '#777', dash: '3 4' },
            { axis: 'x', at: T, cursor: true },
          ]}
          markers={CRUDE_IDS.map((id) => ({ x: T, y: viscosity(C[id], T), color: CRUDE_COLOR[id], r: 5 }))}
          onScrub={(v) => sv.set({ temp: Math.round(v) })}
          scrubValue={T}
          scrubStep={1}
          scrubLabel="Temperature"
        >
          {(sx, sy) => (
            <text className="ax" x={sx(0) + 6} y={sy(nf0) - 6}>
              Northfield Sour at 0 °C
            </text>
          )}
        </XYChart>
        <Readouts items={CRUDE_IDS.map((id) => ({ label: NAME[id], value: cst(viscosity(C[id], T)), tone: 'violet' as const }))} />
        <Slider label="Temperature" tone="red" value={T} min={0} max={60} onChange={(v) => sv.set({ temp: v })} display={`${T} °C`} />
      </Figure>

      <P>
        At 20 °C, Pinyon Light, at {cst(viscosity(C.pinyon, 20))}, pours almost as easily as water; Coldwater Heavy, at {cst(viscosity(C.coldwater, 20))}, is closer to
        syrup. Viscosity also falls steeply as oil warms, and the heavier the oil, the steeper the fall: drag the temperature from 20 °C to 50 °C and Coldwater Heavy thins
        to {cst(viscosity(C.coldwater, 50))}. The curves come from the relation the industry standardizes for extrapolating oil viscosity with temperature, fitted to each
        crude’s density. These are viscosities of oil in a tank; oil deep underground is warmer and holds gas dissolved in it, so it is usually thinner. Viscosity decides
        how much energy a pipeline spends moving a barrel, as we’ll see in <a href={lessonHref('oil/4.1')}>Lesson 4.1</a>.
      </P>

      <Challenge
        id="a"
        question={`Northfield Sour flows at ${cst(nf0)} at 0 °C, the level of the dashed line. Estimate from the chart where Coldwater Heavy’s curve comes down to that line, then set the temperature to the lowest whole degree at which Coldwater Heavy flows as easily.`}
        solved={solvedA}
        status={`At ${T} °C, Coldwater Heavy is at ${cst(cwT)}.`}
        success={`Solved: ${T} °C, where Coldwater Heavy is down to ${cst(cwT)}. It takes ${T} degrees of heating to make it flow the way Northfield Sour does at freezing. Heat is one way to move heavy oil, and some pipelines and storage tanks are heated for exactly this reason. It’s expensive, though, over hundreds of miles.`}
      />

      <H2>Blending</H2>
      <P>
        The other way to make heavy oil flow is to thin it with something lighter. Blending is everyday work in the oil business — to move crude, to meet a buyer’s
        specification, or to make a cheap crude acceptable to a refinery — and the three properties blend in three different ways. Volumes and densities simply average.
        Sulfur averages by weight, so the denser crude counts for a little more. Viscosity doesn’t average at all: it blends on a doubly logarithmic scale, so a small
        amount of thin oil thins a thick one dramatically. In the next demonstration, choose a base crude and a crude to add, and set the share of the second; its
        viscosities are at {PIPE_TEMP_C} °C, a winter ground temperature:
      </P>

      <Figure name="Crude Properties Lab · blending" scenario={s2}>
        <Segmented label="Base crude" value={base} onChange={(v) => s2.set({ base: v })} options={CRUDE_IDS.map((id) => ({ value: id, label: NAME[id] }))} />
        <Segmented label="Added crude" value={added} onChange={(v) => s2.set({ added: v })} options={CRUDE_IDS.map((id) => ({ value: id, label: `+ ${NAME[id]}` }))} />
        <XYChart
          ariaLabel={`Viscosity at ${PIPE_TEMP_C} °C of ${NAME[base]} blended with ${NAME[added]}, against the share added. At ${share}%, the blend is ${cst(bv)}; the pipeline limit is ${PIPE_LIMIT_CST} cSt.`}
          height={220}
          x={[0, 100]}
          y={[1, 10000]}
          logY
          yTicks={[1, 10, 100, 1000, 10000]}
          yFormat={(v) => fmt(v)}
          xTicks={[0, 20, 40, 60, 80, 100]}
          xFormat={(v) => `${v}%`}
          xLabel={`share of ${NAME[added]} in the blend`}
          yLabel={`Viscosity at ${PIPE_TEMP_C} °C, cSt (log scale)`}
          series={[{ points: curve, color: GRAPHIC.violet, width: 3 }]}
          refs={[
            { axis: 'y', at: PIPE_LIMIT_CST, color: '#c4382f', label: `Coldwater pipeline limit, ${PIPE_LIMIT_CST} cSt` },
            { axis: 'x', at: share, cursor: true },
          ]}
          markers={[{ x: share, y: bv, color: TEXT.violet, r: 6 }]}
          onScrub={(v) => s2.set({ share: Math.round(v) })}
          scrubValue={share}
          scrubStep={1}
          scrubLabel="Share of the added crude"
        />
        <Readouts
          items={[
            { label: <K tone="teal">API gravity</K>, value: `${fmt(b.api, 1)}°`, tone: 'teal' },
            { label: 'density', value: `${fmt(b.sg * 999)} kg/m³` },
            { label: <K tone="orange">sulfur</K>, value: `${fmt(b.sulfur, 3)}%`, tone: 'orange' },
            { label: <K tone="violet">{`viscosity at ${PIPE_TEMP_C} °C`}</K>, value: cst(bv), tone: 'violet' },
          ]}
        />
        <Slider label={`Share of ${NAME[added]}`} value={share} min={0} max={100} onChange={(v) => s2.set({ share: v })} display={`${share}%`} />
        {base === added && <Caption>The two crudes are the same, so the blend is too.</Caption>}
      </Figure>

      <P>
        Mix Pinyon Light and Coldwater Heavy half and half and the density averages exactly, to {fmt(half.sg * 999)} kg/m³. The API gravity, though, comes out at{' '}
        {fmt(half.api, 1)}°, not the {fmt((C.pinyon.api + C.coldwater.api) / 2, 1)}° average of the two, because API gravity runs inversely to density. The viscosity
        is {cst(halfV)}: about a third of the way from the thin crude to the thick one on the chart’s logarithmic scale, which is a tiny fraction of the way in
        centistokes.
      </P>
      <P>
        Coldwater Heavy reaches the Kessler hub, where the course’s pipelines meet, through a pipeline that accepts crude only if it is thinner than{' '}
        {PIPE_LIMIT_CST} cSt at {PIPE_TEMP_C} °C, the ground temperature in winter. Real heavy-oil pipelines have limits like it: those carrying diluted bitumen from
        Canada’s oil sands generally take crude no thicker than about 350 cSt and no denser than 940 kg/m³. Coldwater Heavy alone is{' '}
        {cst(viscosity(C.coldwater, PIPE_TEMP_C))} at {PIPE_TEMP_C} °C. Every barrel of light crude used to thin it is a barrel of valuable crude riding along, so producers
        use as little as they can.
      </P>

      <Challenge
        id="b"
        question={`Thin Coldwater Heavy with Pinyon Light so that it meets the pipeline’s limit of ${PIPE_LIMIT_CST} cSt at ${PIPE_TEMP_C} °C, using the smallest share of Pinyon Light you can, to the nearest percent.`}
        solved={solvedB}
        status={
          base !== 'coldwater' || added !== 'pinyon'
            ? 'Choose Coldwater Heavy as the base crude and Pinyon Light as the added crude.'
            : `With ${share}% Pinyon Light, the blend is ${cst(bv)} at ${PIPE_TEMP_C} °C.`
        }
        success={`Solved: ${share}% Pinyon Light brings the blend to ${cst(bv)} at ${PIPE_TEMP_C} °C. A fifth of the barrel cuts the viscosity by a factor of about six. Seaboard Blend, which is thicker than Pinyon Light, would take more.`}
      />

      <Challenge
        id="c"
        question={`Pinyon Light, at ${fmt(C.pinyon.api, 1)}° API and ${fmt(C.pinyon.sulfur, 2)}% sulfur, is slightly too light for the WTI specification of 37–42° API and at most ${WTI_SPEC.sulfurMax}% sulfur. Blending in Northfield Sour, at ${fmt(C.northfield.api, 1)}° and ${fmt(C.northfield.sulfur, 1)}%, fixes the gravity but adds sulfur. Predict first which limit stops you, and at about what share, from how each property blends; then find the most Northfield Sour, to the nearest percent, that the blend can contain and still meet the specification.`}
        solved={solvedC}
        status={
          base !== 'pinyon' || added !== 'northfield'
            ? 'Choose Pinyon Light as the base crude and Northfield Sour as the added crude.'
            : `With ${share}% Northfield Sour: ${fmt(b.api, 1)}° API and ${fmt(b.sulfur, 3)}% sulfur.`
        }
        success={`Solved: ${share}%. Sulfur is the binding limit. By weight, (${WTI_SPEC.sulfurMax} − ${fmt(C.pinyon.sulfur, 2)}) ÷ (${fmt(C.northfield.sulfur, 1)} − ${fmt(C.pinyon.sulfur, 2)}) gives about ${pct(WTI_SULFUR_SHARE_BY_WEIGHT)} Northfield Sour; by volume it’s a little less, because Northfield Sour is the denser crude, and at ${share + 1}% the blend would carry more than ${WTI_SPEC.sulfurMax}%. The gravity had room to spare: 1% of Northfield Sour already brings the blend under 42°, and it would take ${WTI_API_FLOOR_SHARE}% to reach 37°.`}
      />

      <P>
        Density, sulfur and viscosity describe crude oil as it sits in a tank. A refinery’s first job is to separate it, and that depends on what happens when the oil is
        heated — when its molecules start to boil, and which ones leave first. That is the subject of the <a href={lessonHref('oil/1.4')}>next lesson</a>, and it’s the
        physics behind the tall columns that make a refinery recognizable from miles away. You can return to{' '}
        <FigRef to="Crude Properties Lab · viscosity">the viscosity demonstration</FigRef> to compare the crudes at any temperature.
      </P>
    </LessonPage>
  );
}
