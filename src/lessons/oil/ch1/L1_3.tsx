import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, pct, useScenario } from '../../../framework';
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

/** Challenge b: the least Ridgeback Light (whole percent) that brings Coldwater Heavy under the pipeline limit at 10 °C. */
export function diluentSolved(base: CrudeId, added: CrudeId, sharePct: number): boolean {
  if (base !== 'coldwater' || added !== 'ridgeback') return false;
  const v = (p: number) => blendViscosity([{ crude: C.coldwater, share: 100 - p }, { crude: C.ridgeback, share: p }], PIPE_TEMP_C);
  return v(sharePct) <= PIPE_LIMIT_CST && v(sharePct - 1) > PIPE_LIMIT_CST;
}

/** Challenge c: the most Northfield Sour (whole percent) Ridgeback Light can take and still meet the WTI specification. */
export function wtiSolved(base: CrudeId, added: CrudeId, sharePct: number): boolean {
  if (base !== 'ridgeback' || added !== 'northfield') return false;
  const b = (p: number) => blend([{ crude: C.ridgeback, share: 100 - p }, { crude: C.northfield, share: p }]);
  return meetsWti(b(sharePct)) && !meetsWti(b(sharePct + 1));
}

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
      refs={[{ axis: 'y', at: 0.5, color: '#8a6500', dash: '4 4' }]}
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
          <text x={sx(15) + 6} y={sy(0.5) - 6} className="ax" style={{ fill: '#8a6500' }}>
            sour ↑
          </text>
          <text x={sx(15) + 6} y={sy(0.5) + 14} className="ax" style={{ fill: '#8a6500' }}>
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
  const s1 = useScenario('grades', { crude: 'coldwater' as CrudeId, temp: 20 });
  const sel = C[s1.state.crude];
  const T = s1.state.temp;
  const cls = classify(sel.api, sel.sulfur);
  const viscCurves = useMemo(
    () => CRUDE_IDS.map((id) => ({ id, pts: Array.from({ length: 61 }, (_, t) => [t, viscosity(C[id], t)] as [number, number]) })),
    [],
  );
  const nf0 = viscosity(C.northfield, 0);

  const s2 = useScenario('blend', { base: 'coldwater' as CrudeId, added: 'ridgeback' as CrudeId, share: 10, temp: PIPE_TEMP_C });
  const { base, added, share, temp } = s2.state;
  const parts = [
    { crude: C[base], share: 100 - share },
    { crude: C[added], share },
  ];
  const b = blend(parts);
  const bv = blendViscosity(parts, temp);
  const bvPipe = blendViscosity(parts, PIPE_TEMP_C);
  const curve = useMemo(
    () =>
      Array.from({ length: 101 }, (_, p) => [p, blendViscosity([{ crude: C[base], share: 100 - p }, { crude: C[added], share: p }], temp)] as [number, number]),
    [base, added, temp],
  );
  const half = blend([{ crude: C.ridgeback, share: 50 }, { crude: C.coldwater, share: 50 }]);
  const halfV = blendViscosity([{ crude: C.ridgeback, share: 50 }, { crude: C.coldwater, share: 50 }], 20);

  const solvedA = heatSolved(T);
  const solvedB = diluentSolved(base, added, share);
  const solvedC = wtiSolved(base, added, share);

  return (
    <LessonPage id="oil/1.3">
      <P>
        An assay runs to dozens of pages: yields, densities, sulfur and metals for every cut, and much more. Traders don’t quote all of that. They describe a crude with
        a handful of numbers, and two of them do most of the work. <K tone="teal">API gravity</K>, from <a href={lessonHref('oil/1.2')}>the previous lesson</a>, says
        whether a crude is <b>light</b> or <b>heavy</b>. <K tone="gold">Sulfur</K> content says whether it’s <b>sweet</b> or <b>sour</b> — names said to date from the days when
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
            { label: <K tone="gold">sulfur per barrel</K>, value: `${fmt(sulfurKgPerBarrel(sel), 2)} kg`, tone: 'gold' },
          ]}
        />
        <Legend items={CRUDE_IDS.map((id) => ({ label: NAME[id], color: CRUDE_COLOR[id], kind: 'line' as const }))} />
        <XYChart
          ariaLabel={`Viscosity against temperature for the four crudes, on a logarithmic scale. At ${T} °C: ${CRUDE_IDS.map((id) => `${NAME[id]} ${cst(viscosity(C[id], T))}`).join(', ')}.`}
          height={220}
          x={[0, 60]}
          y={[1, 10000]}
          logY
          yTicks={[1, 10, 100, 1000, 10000]}
          yFormat={(v) => fmt(v)}
          xTicks={[0, 10, 20, 30, 40, 50, 60]}
          xFormat={(v) => `${v} °C`}
          yLabel="Viscosity, centistokes (log scale)"
          series={viscCurves.map(({ id, pts }) => ({ points: pts, color: CRUDE_COLOR[id], width: id === s1.state.crude ? 3.5 : 2 }))}
          refs={[{ axis: 'x', at: T, cursor: true }]}
          markers={[{ x: T, y: viscosity(sel, T), color: CRUDE_COLOR[s1.state.crude], r: 6 }]}
          onScrub={(v) => s1.set({ temp: Math.round(v) })}
          scrubValue={T}
          scrubStep={1}
          scrubLabel="Temperature"
        />
        <Slider label="Temperature" tone="red" value={T} min={0} max={60} onChange={(v) => s1.set({ temp: v })} display={`${T} °C`} />
        <Caption>
          At {T} °C, {NAME[s1.state.crude]} has a viscosity of <K tone="violet">{cst(viscosity(sel, T))}</K>; water’s is about 1 cSt at 20 °C.
        </Caption>
      </Figure>

      <P>
        Ridgeback Light and Seaboard Blend are light and sweet, Northfield Sour medium and sour, Coldwater Heavy heavy and sour. The box marks a real specification: the
        crude that can be delivered against the New York Mercantile Exchange’s light sweet crude futures contract — the contract behind the WTI price, West Texas
        Intermediate — must be between 37° and 42° API with at most 0.42% sulfur. The other great benchmark, Brent, is also a light sweet crude, from fields in the
        North Sea. Notice that Ridgeback Light falls just outside the box: at {fmt(C.ridgeback.api, 1)}°, it’s slightly too light. Many shale crudes are.
      </P>
      <P>
        Why should light, sweet crude be worth more than heavy, sour crude? The readouts give the physical reasons. A barrel of Ridgeback Light has{' '}
        {pct(cumulativeYield(C.ridgeback, 350))} of its volume boiling in the ranges that become gasoline, jet fuel and diesel, against{' '}
        {pct(cumulativeYield(C.coldwater, 350))} for Coldwater Heavy. To make fuels from the rest, a refinery needs expensive equipment that breaks big molecules into
        small ones. And each barrel of Coldwater Heavy brings {fmt(sulfurKgPerBarrel(C.coldwater), 1)} kilograms of sulfur that has to be removed, against{' '}
        {fmt(sulfurKgPerBarrel(C.ridgeback), 2)} kg for Ridgeback Light, along with the metals that poison the catalysts doing that work. So heavy, sour crudes
        generally sell at a discount to light, sweet ones. How large the discount should be depends on what each refinery can do with them, which is the subject of
        Chapter 3.
      </P>

      <H2>Viscosity</H2>
      <P>
        The second chart in this demonstration measures something density doesn’t: how easily the oil flows. <K tone="violet">Viscosity</K> is a fluid’s resistance to
        flowing, and the kinematic viscosity used for oil is measured in centistokes. Water is about 1 cSt at 20 °C. Ridgeback Light, at {cst(viscosity(C.ridgeback, 20))},
        pours almost as easily; Coldwater Heavy, at {cst(viscosity(C.coldwater, 20))}, is closer to syrup. Viscosity also falls steeply as oil warms, and the heavier the
        oil, the steeper the fall: drag the temperature from 20 °C to 50 °C and Coldwater Heavy thins to {cst(viscosity(C.coldwater, 50))}. The curves come from the
        relation the industry standardizes for extrapolating oil viscosity with temperature, fitted to each crude’s density. Viscosity decides how much energy a pipeline
        spends moving a barrel, as we’ll see in <a href={lessonHref('oil/4.1')}>Lesson 4.1</a>.
      </P>

      <Challenge
        id="a"
        question={`Northfield Sour has a viscosity of ${cst(nf0)} at 0 °C. Find the lowest temperature, to the nearest degree, at which Coldwater Heavy flows as easily.`}
        solved={solvedA}
        status={`At ${T} °C, Coldwater Heavy is at ${cst(viscosity(C.coldwater, T))}.`}
        success={`Solved: ${T} °C, where Coldwater Heavy is down to ${cst(viscosity(C.coldwater, T))}. Heat is one way to move heavy oil, and some pipelines and storage tanks are heated for exactly this reason. It’s expensive, though, over hundreds of miles.`}
      />

      <H2>Blending</H2>
      <P>
        The other way to make heavy oil flow is to thin it with something lighter. Blending is everyday work in the oil business — to move crude, to meet a buyer’s
        specification, or to make a cheap crude acceptable to a refinery — and the three properties blend in three different ways. Volumes and densities simply average.
        Sulfur averages by weight, so the denser crude counts for a little more. Viscosity doesn’t average at all: it blends on a doubly logarithmic scale, so a small
        amount of thin oil thins a thick one dramatically. In the next demonstration, choose a base crude and a crude to add, and set the share of the second:
      </P>

      <Figure name="Crude Properties Lab · blending" scenario={s2}>
        <Segmented label="Base crude" value={base} onChange={(v) => s2.set({ base: v })} options={CRUDE_IDS.map((id) => ({ value: id, label: NAME[id] }))} />
        <Segmented label="Added crude" value={added} onChange={(v) => s2.set({ added: v })} options={CRUDE_IDS.map((id) => ({ value: id, label: `+ ${NAME[id]}` }))} />
        <XYChart
          ariaLabel={`Viscosity at ${temp} °C of ${NAME[base]} blended with ${NAME[added]}, against the share added. At ${share}%, the blend is ${cst(bv)}; the pipeline limit is ${PIPE_LIMIT_CST} cSt.`}
          height={220}
          x={[0, 100]}
          y={[1, 10000]}
          logY
          yTicks={[1, 10, 100, 1000, 10000]}
          yFormat={(v) => fmt(v)}
          xTicks={[0, 20, 40, 60, 80, 100]}
          xFormat={(v) => `${v}%`}
          xLabel={`share of ${NAME[added]} in the blend`}
          yLabel={`Viscosity at ${temp} °C, cSt (log scale)`}
          series={[{ points: curve, color: '#ab70b6', width: 3 }]}
          refs={[
            { axis: 'y', at: PIPE_LIMIT_CST, color: '#c4382f', label: `Coldwater pipeline limit, ${PIPE_LIMIT_CST} cSt at ${PIPE_TEMP_C} °C` },
            { axis: 'x', at: share, cursor: true },
          ]}
          markers={[{ x: share, y: bv, color: '#8e4fa0', r: 6 }]}
          onScrub={(v) => s2.set({ share: Math.round(v) })}
          scrubValue={share}
          scrubStep={1}
          scrubLabel="Share of the added crude"
        />
        <Readouts
          items={[
            { label: <K tone="teal">API gravity</K>, value: `${fmt(b.api, 1)}°`, tone: 'teal' },
            { label: 'density', value: `${fmt(b.sg * 999)} kg/m³` },
            { label: <K tone="gold">sulfur</K>, value: `${fmt(b.sulfur, 3)}%`, tone: 'gold' },
            { label: <K tone="violet">{`viscosity at ${temp} °C`}</K>, value: cst(bv), tone: 'violet' },
          ]}
        />
        <Slider label={`Share of ${NAME[added]}`} tone="orange" value={share} min={0} max={100} onChange={(v) => s2.set({ share: v })} display={`${share}%`} />
        <Slider label="Temperature" tone="red" value={temp} min={0} max={60} onChange={(v) => s2.set({ temp: v })} display={`${temp} °C`} />
        <Caption>
          {base === added
            ? 'The two crudes are the same, so the blend is too.'
            : `${100 - share}% ${NAME[base]} and ${share}% ${NAME[added]}: ${meetsWti(b) ? 'within' : 'outside'} the WTI delivery specification, and ${cst(bvPipe)} at ${PIPE_TEMP_C} °C, ${bvPipe <= PIPE_LIMIT_CST ? 'thin enough for' : 'too thick for'} the Coldwater pipeline.`}
        </Caption>
      </Figure>

      <P>
        Mix Ridgeback Light and Coldwater Heavy half and half and the density averages exactly, to {fmt(half.sg * 999)} kg/m³. The API gravity, though, comes out at{' '}
        {fmt(half.api, 1)}°, not the {fmt((C.ridgeback.api + C.coldwater.api) / 2, 1)}° average of the two, because API gravity runs inversely to density. The viscosity at
        20 °C is {cst(halfV)}: a third of the way from the thin crude to the thick one on the chart’s logarithmic scale, which is a tiny fraction of the way in centistokes.
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
        question={`Thin Coldwater Heavy with Ridgeback Light so that it meets the pipeline’s limit of ${PIPE_LIMIT_CST} cSt at ${PIPE_TEMP_C} °C, using the smallest share of Ridgeback Light you can, to the nearest percent.`}
        solved={solvedB}
        status={
          base !== 'coldwater' || added !== 'ridgeback'
            ? 'Choose Coldwater Heavy as the base crude and Ridgeback Light as the added crude.'
            : `With ${share}% Ridgeback Light, the blend is ${cst(bvPipe)} at ${PIPE_TEMP_C} °C.`
        }
        success={`Solved: ${share}% Ridgeback Light brings the blend to ${cst(bvPipe)} at ${PIPE_TEMP_C} °C. A fifth of the barrel cuts the viscosity by a factor of about six. Seaboard Blend, which is thicker than Ridgeback Light, would take more.`}
      />

      <Challenge
        id="c"
        question="Ridgeback Light is slightly too light for the WTI specification. Blend Northfield Sour into it: what is the most Northfield Sour, to the nearest percent, that the blend can contain and still meet the specification?"
        solved={solvedC}
        status={
          base !== 'ridgeback' || added !== 'northfield'
            ? 'Choose Ridgeback Light as the base crude and Northfield Sour as the added crude.'
            : `With ${share}% Northfield Sour: ${fmt(b.api, 1)}° API and ${fmt(b.sulfur, 3)}% sulfur, ${meetsWti(b) ? 'within' : 'outside'} the specification.`
        }
        success={`Solved: ${share}%. Just 1% of Northfield Sour brings the blend under 42°, but sulfur is the binding limit: at ${share + 1}% the blend would carry more than 0.42%. Northfield Sour has more than ten times Ridgeback Light’s sulfur, so a little goes a long way.`}
      />

      <P>
        Density, sulfur and viscosity describe crude oil as it sits in a tank. A refinery’s first job is to separate it, and that depends on what happens when the oil is
        heated — when its molecules start to boil, and which ones leave first. That is the subject of the <a href={lessonHref('oil/1.4')}>next lesson</a>, and it’s the
        physics behind the tall columns that make a refinery recognizable from miles away. You can return to <FigRef to="Crude Properties Lab">the first demonstration</FigRef>{' '}
        to compare the crudes’ viscosities at any temperature.
      </P>
    </LessonPage>
  );
}
