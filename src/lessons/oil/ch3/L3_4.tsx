import { useMemo, type ReactNode } from 'react';
import {
  Button,
  Caption,
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
  Frac,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sub,
  Sup,
  Tn,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  usd,
  useScenario,
} from '../../../framework';
import { BLEND_STREAMS, SUMMER, WINTER, blendProps, meetsSpec, optimizeBlend, type BlendResult, type BlendStreamId, type GasolineSpec } from '../../../engines/oil/refining';
import { StackedBar, XYChart } from '../shared/charts';

const STREAM: Record<BlendStreamId, (typeof BLEND_STREAMS)[number]> = Object.fromEntries(BLEND_STREAMS.map((s) => [s.id, s])) as Record<
  BlendStreamId,
  (typeof BLEND_STREAMS)[number]
>;
const IDS = BLEND_STREAMS.map((s) => s.id);
const FCC = STREAM.fccGasoline;

/** The first challenge's pool size, kb/d, and how close to the optimizer's cost a hand blend must come, $/bbl. */
export const TARGET_VOLUME = 60;
export const COST_TOLERANCE = 0.25;
/** The second challenge's butane target, kb/d, and the vapor-pressure slider's step, psi. */
export const BUTANE_TARGET = 5;
export const RVP_STEP = 0.1;

type Vols = Record<BlendStreamId, number>;

/** The optimizer's cost per barrel for a pool of `volume` kb/d meeting `spec` (Infinity if no blend can). */
export function optimumCost(volume: number, spec: GasolineSpec = SUMMER): number {
  const b = optimizeBlend(spec, volume);
  return b ? blendProps(b).costPerBbl : Infinity;
}

/**
 * Challenge a: a hand-made blend of at least 60 kb/d, using all the FCC gasoline, meeting the summer
 * spec, at no more than $0.25/bbl above the optimizer's cost for a pool of the same size. `peeked`
 * is set by pressing Optimize before solving it, and stays set (nudging the optimizer's blend isn't
 * a hand blend) until the figure is reset.
 */
export function handBlendSolved(vols: Vols, peeked: boolean): boolean {
  if (peeked) return false;
  const r = blendProps(vols);
  if (r.volume < TARGET_VOLUME - 1e-6 || vols.fccGasoline < FCC.available - 1e-6) return false;
  return meetsSpec(r, SUMMER) && r.costPerBbl <= optimumCost(r.volume) + COST_TOLERANCE;
}

/** Butane in the optimal 60 kb/d blend under a vapor-pressure limit, kb/d. */
export function butaneAt(limit: number, volume = TARGET_VOLUME): number {
  const b = optimizeBlend({ ...SUMMER, rvp: limit }, volume);
  return b ? b.butane : NaN;
}

/** Challenge b: the lowest limit (on the slider's 0.1 psi steps) at which the optimal 60 kb/d blend uses 5 kb/d of butane. */
export function butaneFiveSolved(limit: number, volume: number): boolean {
  if (volume !== TARGET_VOLUME) return false;
  const below = Math.round((limit - RVP_STEP) * 10) / 10;
  return butaneAt(limit) >= BUTANE_TARGET - 1e-9 && butaneAt(below) < BUTANE_TARGET;
}

const DEFAULT_VOLS: Vols = { butane: 6, lightNaphtha: 10, reformate: 16, fccGasoline: FCC.available, alkylate: 0 };

/** Butane the cheapest 60 kb/d blend takes for each extra psi of allowed vapor pressure, just above the summer limit, kb/d. */
export const BUTANE_PER_PSI = butaneAt(SUMMER.rvp + 1) - butaneAt(SUMMER.rvp);

/** Cleanest streams carry 1 ppm: the least of them that dilutes all the FCC gasoline to the sulfur limit, kb/d. */
const MIN_CLEAN = (FCC.available * (FCC.sulfur - SUMMER.sulfur)) / (SUMMER.sulfur - 1);

const SUMMER_OPT = optimizeBlend(SUMMER, TARGET_VOLUME)!;
const SUMMER_P = blendProps(SUMMER_OPT);
const WINTER_OPT = optimizeBlend(WINTER, TARGET_VOLUME)!;
const WINTER_P = blendProps(WINTER_OPT);
const DEFAULT_P = blendProps(DEFAULT_VOLS);
const SEASON_GAP = SUMMER_P.costPerBbl - WINTER_P.costPerBbl;
/** What one more psi of allowed vapor pressure saves near the summer limit, $/bbl. */
const PER_PSI = optimumCost(TARGET_VOLUME, { ...SUMMER, rvp: 8.5 }) - optimumCost(TARGET_VOLUME, { ...SUMMER, rvp: 9.5 });

function kbd(v: number): string {
  return `${fmt(v, 1)} kb/d`;
}

function perBbl(v: number): string {
  return Number.isFinite(v) ? usd(v, 2) : '—';
}

function aki(v: number): string {
  return fmt(v, 1);
}

/** A small gap, to enough digits that it doesn't read as zero. */
function gap(x: number): string {
  return fmt(x, x < 0.1 ? 2 : 1);
}

/** "a, b and c". */
function listOf(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function verdict(text: string, ok: boolean): ReactNode {
  return <Tn tone={ok ? 'green' : 'red'}>{`${text} · ${ok ? 'meets' : 'fails'}`}</Tn>;
}

interface TableRow {
  key: string;
  name: ReactNode;
  aki: ReactNode;
  rvp: ReactNode;
  sulfur: ReactNode;
  value: ReactNode;
  cls?: 'hl' | 'dim';
}

/** The five streams' properties, then the blend's (checked) and the specification's limits. */
function BlendTable({ r, spec }: { r: BlendResult; spec: GasolineSpec }) {
  const has = r.volume > 0;
  const rows: TableRow[] = [
    ...BLEND_STREAMS.map((st) => ({
      key: st.id,
      name: st.name,
      aki: aki((st.ron + st.mon) / 2),
      rvp: `${fmt(st.rvp)} psi`,
      sulfur: `${fmt(st.sulfur)} ppm`,
      value: st.value ? usd(st.value) : 'no other outlet',
    })),
    {
      key: 'blend',
      name: <b>This blend</b>,
      aki: has ? verdict(aki(r.aki), r.aki >= spec.aki - 1e-9) : '—',
      rvp: has ? verdict(`${fmt(r.rvp, 1)} psi`, r.rvp <= spec.rvp + 1e-9) : '—',
      sulfur: has ? verdict(`${fmt(r.sulfur, 1)} ppm`, r.sulfur <= spec.sulfur + 1e-9) : '—',
      value: '',
      cls: 'hl',
    },
    { key: 'limit', name: 'Summer limit', aki: `at least ${spec.aki}`, rvp: `at most ${fmt(spec.rvp, 1)} psi`, sulfur: `at most ${spec.sulfur} ppm`, value: '' },
  ];
  return (
    <DataTable
      caption="Each stream’s properties, the blend’s, and the summer specification"
      rows={rows}
      rowKey={(row) => row.key}
      rowClass={(row) => row.cls}
      columns={[
        { label: 'Stream', cell: (row) => row.name },
        { label: <K tone="violet">Octane</K>, cell: (row) => row.aki, align: 'right' },
        { label: <K tone="blue">Vapor pressure</K>, cell: (row) => row.rvp, align: 'right' },
        { label: <K tone="orange">Sulfur</K>, cell: (row) => row.sulfur, align: 'right' },
        { label: 'Value, $/bbl', cell: (row) => row.value, align: 'right' },
      ]}
    />
  );
}

/** What the blend gives away, or how far off spec it is. */
function blendCaption(r: BlendResult, optimized: boolean): string {
  if (r.volume <= 0) return 'The tank is empty.';
  if (!meetsSpec(r, SUMMER)) {
    const gaps: string[] = [];
    if (r.aki < SUMMER.aki - 1e-9) gaps.push(`${gap(SUMMER.aki - r.aki)} octane points short`);
    if (r.rvp > SUMMER.rvp + 1e-9) gaps.push(`${gap(r.rvp - SUMMER.rvp)} psi over the vapor-pressure limit`);
    if (r.sulfur > SUMMER.sulfur + 1e-9) gaps.push(`${gap(r.sulfur - SUMMER.sulfur)} ppm over the sulfur limit`);
    return `Off spec: ${listOf(gaps)}.`;
  }
  const give = r.aki - SUMMER.aki;
  const room = SUMMER.rvp - r.rvp;
  const octane = give < 0.005 ? 'gives away no octane' : `gives away ${gap(give)} octane points`;
  const vapor = room < 0.005 ? 'has its vapor pressure at the limit' : `leaves ${gap(room)} psi of vapor pressure unused`;
  return `On spec. The blend ${octane} and ${vapor}.${optimized ? ' This is the optimizer’s blend.' : ''}`;
}

function BlendBar({ vols, title }: { vols: Vols; title: string }) {
  const total = IDS.reduce((s, id) => s + vols[id], 0);
  return (
    <StackedBar
      title={title}
      ariaLabel={`${title}: ${IDS.map((id) => `${STREAM[id].name} ${kbd(vols[id])}`).join(', ')}; ${kbd(total)} in all.`}
      total={Math.max(total, 1e-9)}
      segments={IDS.filter((id) => vols[id] > 0.005).map((id) => ({ id, value: vols[id], color: STREAM[id].color, label: STREAM[id].name }))}
      format={(v) => fmt(v, 1)}
      height={50}
    />
  );
}

export default function Lesson() {
  // ---- Figure 1: the blend tank.
  const s1 = useScenario('blend', { ...DEFAULT_VOLS, optimized: false, peeked: false });
  const vols: Vols = { butane: s1.state.butane, lightNaphtha: s1.state.lightNaphtha, reformate: s1.state.reformate, fccGasoline: s1.state.fccGasoline, alkylate: s1.state.alkylate };
  const r = blendProps(vols);
  const ok = meetsSpec(r, SUMMER);
  const best = useMemo(() => optimumCost(r.volume), [r.volume]);
  const solvedA = handBlendSolved(vols, s1.state.peeked);
  // Pressing Optimize before the challenge is solved marks the blend as the optimizer's until Reset.
  const optimize = () => s1.set({ ...SUMMER_OPT, optimized: true, peeked: s1.state.peeked || !solvedA });

  let statusA: string;
  if (s1.state.peeked) statusA = 'You’ve seen the optimizer’s answer, so this blend isn’t yours. Press Reset to start again from the original tank and blend by hand.';
  else if (r.volume < TARGET_VOLUME - 1e-6) statusA = `The tank gets ${kbd(r.volume)}; it needs at least ${TARGET_VOLUME}.`;
  else if (vols.fccGasoline < FCC.available - 1e-6) statusA = `Use all ${fmt(FCC.available)} kb/d of FCC gasoline: it has nowhere else to go.`;
  else if (!ok) statusA = `${kbd(r.volume)}, but the blend fails the summer specification.`;
  else statusA = `${kbd(r.volume)} on spec at ${perBbl(r.costPerBbl)} a barrel; the cheapest blend of that size costs ${perBbl(best)}.`;

  // ---- Figure 2: the vapor-pressure limit.
  const s2 = useScenario('seasons', { limit: SUMMER.rvp, volume: TARGET_VOLUME });
  const { limit, volume } = s2.state;
  const sweep = useMemo(() => {
    const pts: Array<{ lim: number; cost: number; butane: number }> = [];
    for (let i = 0; i <= 80; i++) {
      const lim = 7 + i / 10;
      const b = optimizeBlend({ ...SUMMER, rvp: lim }, volume);
      if (b) pts.push({ lim, cost: blendProps(b).costPerBbl, butane: b.butane });
    }
    return pts;
  }, [volume]);
  const opt = optimizeBlend({ ...SUMMER, rvp: limit }, volume);
  const optP = opt ? blendProps(opt) : null;
  const summerAtVol = optimumCost(volume, SUMMER);
  const solvedB = butaneFiveSolved(limit, volume);
  const [c0, c1] = niceDomain(Math.min(...sweep.map((p) => p.cost)), Math.max(...sweep.map((p) => p.cost)), 4);

  return (
    <LessonPage id="oil/3.4">
      <P>
        <a href={lessonHref('oil/3.3')}>Lesson 3.3</a> stripped the sulfur out of the refinery’s streams. Most of them still aren’t products. A barrel of reformate or
        cracked gasoline isn’t sold at the pump any more than crude oil is: what leaves the refinery is a <b>blend</b>, streams from several units mixed in a tank until
        the mixture meets a product’s specification. Every product is blended, but gasoline is the most demanding, so that’s where we’ll look.
      </P>
      <P>
        Our blender has five streams, each from a different corner of the refinery. <b>Butane</b>, from the gases of the crude unit and the cracker, is cheap and
        high in octane, and so volatile that it boils below room temperature. <b>Light naphtha</b>, straight from the crude unit, is mostly straight chains, which, as{' '}
        <a href={lessonHref('oil/1.1')}>Lesson 1.1</a> showed, knock easily. <b>Reformate</b>, from the reformer, is rich in aromatics: high in octane, low in
        volatility, and expensive. <b>FCC gasoline</b>, from the catalytic cracker of <a href={lessonHref('oil/3.2')}>Lesson 3.2</a>, has a fair octane but still
        carries some sulfur. <b>Alkylate</b> is made by joining small molecules from a cracker into branched ones like iso-octane; Corran has no alkylation unit and buys
        it from a neighbor, at the highest price of the five.
      </P>
      <P>
        Regular gasoline in the United States must meet many specifications, and three of them shape the blend. Its <K tone="violet">octane</K>, posted at the pump as
        (R+M)/2 — the average of two laboratory ratings, the research and motor octane numbers — must be at least 87. Its <K tone="blue">vapor pressure</K>, the Reid
        vapor pressure measured at 100 °F, is capped in summer, at 9.0 psi for conventional gasoline under federal rules and lower in some places, because gasoline
        vapor helps form ground-level ozone. And its <K tone="orange">sulfur</K> must average no more than 10 parts per million. Most American gasoline also contains
        about 10% ethanol, added at the terminal; to keep things simple, our blender works with hydrocarbon streams alone.
      </P>
      <P>
        To a good approximation, octane and sulfur mix in proportion to volume: a blend’s value is the volume-weighted average of its streams’. (Octane actually blends
        somewhat nonlinearly, and real blenders use measured blending values; our model keeps the straight average.) Vapor pressure doesn’t average that way. The
        industry blends it through an index, the vapor pressure raised to the power 1.25, which does:
      </P>
      <Eq label="Blend vapor pressure: the volume-weighted average of each stream's RVP to the power 1.25, raised to the power 1 over 1.25">
        <K tone="blue">
          RVP<Sub>blend</Sub>
        </K>
        <Op>=</Op>
        <span>(</span>
        <Frac
          top={
            <>
              Σ <K tone="orange">v<Sub>i</Sub></K> · <K tone="blue">RVP<Sub>i</Sub></K>
              <Sup>1.25</Sup>
            </>
          }
          bottom={
            <>
              Σ <K tone="orange">v<Sub>i</Sub></K>
            </>
          }
        />
        <span>)</span>
        <Sup>1/1.25</Sup>
      </Eq>
      <P>
        In the next demonstration, set how many thousand barrels a day of each stream go into the tank. The table lists each stream’s properties and checks the blend
        against the summer specification.
        The cost is the blend’s opportunity cost: what each stream could have earned if it were sold some other way, at the course’s simulated prices — butane as LPG,
        light naphtha to a chemical plant, and so on. FCC gasoline has no other outlet, so it counts as nothing, and all of it has to go into gasoline:
      </P>

      <Figure name="Fuel Blending Optimizer" scenario={s1} actions={<Button onClick={optimize}>Optimize</Button>}>
        <BlendBar vols={vols} title="The blend, thousand barrels a day" />
        <BlendTable r={r} spec={SUMMER} />
        <Readouts
          items={[
            { label: <K tone="orange">volume</K>, value: kbd(r.volume), tone: 'orange' },
            { label: <K c="price">cost per barrel</K>, value: r.volume > 0 ? perBbl(r.costPerBbl) : '—', tone: 'green' },
            { label: 'cheapest on-spec blend of this size', value: perBbl(best), tone: 'green' },
          ]}
        />
        {BLEND_STREAMS.map((st) => (
          <Slider
            key={st.id}
            label={st.name}
            tone="orange"
            value={vols[st.id]}
            min={0}
            max={st.available}
            step={0.1}
            onChange={(v) => s1.set({ [st.id]: Math.round(v * 10) / 10, optimized: false } as Partial<Vols & { optimized: boolean }>)}
            display={kbd(vols[st.id])}
          />
        ))}
        <Caption>{blendCaption(r, s1.state.optimized)}</Caption>
      </Figure>

      <P>
        The starting blend is cheap, at {perBbl(DEFAULT_P.costPerBbl)} a barrel, and wrong twice over: its octane is {aki(DEFAULT_P.aki)} and its vapor pressure{' '}
        {fmt(DEFAULT_P.rvp, 1)} psi. The {fmt(DEFAULT_VOLS.butane)} kb/d of butane is the problem. Butane’s octane is fine, but at {fmt(STREAM.butane.rvp)} psi its
        vapor pressure is nearly six times the limit, and through the index a little of it goes a long way. Take butane out and the vapor pressure falls, but so does
        the volume, and filling the tank with light naphtha drags the octane down further: it rates only {fmt((STREAM.lightNaphtha.ron + STREAM.lightNaphtha.mon) / 2, 1)}.
        Reformate fixes both, at {usd(STREAM.reformate.value)} a barrel.
      </P>
      <P>
        Sulfur works differently. The FCC gasoline’s {fmt(FCC.sulfur)} ppm has to be diluted with cleaner streams to bring the pool’s average down to 10, and all{' '}
        {fmt(FCC.available)} kb/d of it must be used. At 1 ppm, the other streams have to supply at least {fmt(MIN_CLEAN, 1)} kb/d to do that, so no summer pool
        smaller than about {fmt(FCC.available + MIN_CLEAN)} kb/d can meet the sulfur limit at all.
      </P>

      <Challenge
        id="a"
        question={`Predict first which of the three limits the cheapest blend will press against. Then, by hand, blend at least ${TARGET_VOLUME} kb/d of summer gasoline that uses all the FCC gasoline, meets every specification, and costs no more than ${usd(COST_TOLERANCE, 2)} a barrel above the cheapest blend of the same size.`}
        solved={solvedA}
        status={statusA}
        success={`Solved: ${kbd(r.volume)} at ${perBbl(r.costPerBbl)} a barrel, within ${usd(Math.max(0, r.costPerBbl - best), 2)} of the best possible, with ${gap(Math.max(0, r.aki - SUMMER.aki))} octane points given away and ${gap(Math.max(0, SUMMER.rvp - r.rvp))} psi of vapor pressure unused. Getting closer means pressing harder against those two limits: octane and vapor pressure are the ones that bind, while sulfur sits at ${fmt(r.sulfur, 1)} ppm with room to spare.`}
      />

      <H2>A blend as a linear program</H2>
      <P>
        Blending by hand gets close; finding the best blend exactly is a job for a <b>linear program</b>. The unknowns are the five volumes. Everything the blender cares
        about — total volume, cost, and, through the index, every specification — is a weighted sum of those volumes, so each specification becomes a straight-line
        constraint, and the cost is a straight-line objective to minimize. Gasoline blending was one of the first problems linear programming was put to work on, in the
        early 1950s, and refineries still run their blending this way.
      </P>
      <P>
        Press Optimize in <FigRef to="Fuel Blending Optimizer">the first demonstration</FigRef>. The cheapest {TARGET_VOLUME} kb/d summer blend uses{' '}
        {fmt(SUMMER_OPT.butane, 2)} kb/d of butane, {fmt(SUMMER_OPT.lightNaphtha, 2)} of light naphtha, {fmt(SUMMER_OPT.reformate, 2)} of reformate and all{' '}
        {fmt(SUMMER_OPT.fccGasoline)} of the FCC gasoline, for {perBbl(SUMMER_P.costPerBbl)} a barrel. It sits exactly on two limits: octane {aki(SUMMER_P.aki)} and
        vapor pressure {fmt(SUMMER_P.rvp, 1)} psi. Any octane above 87 is what blenders call <b>giveaway</b>, quality paid for and not charged for, and the optimizer
        never gives any away. The sulfur limit, though, has room to spare at {fmt(SUMMER_P.sulfur, 1)} ppm, and alkylate isn’t used at all: at these prices,
        reformate buys octane and low vapor pressure more cheaply.
      </P>

      <H2>Summer and winter</H2>
      <P>
        The vapor-pressure limit is the expensive one, and it changes with the seasons. In cold weather, gasoline that evaporates more readily helps engines start, so
        winter grades are allowed to be more volatile: 13.5 psi in our model. In the next demonstration, set the limit and the size of the pool; the chart traces the
        optimizer’s cost per barrel across every limit from 7 to 15 psi:
      </P>

      <Figure name="Fuel Blending Optimizer · seasons" scenario={s2}>
        <XYChart
          ariaLabel={`Cost per barrel of the cheapest ${volume} kb/d blend against the vapor-pressure limit, from ${perBbl(sweep[0]?.cost ?? NaN)} at 7 psi to ${perBbl(sweep[sweep.length - 1]?.cost ?? NaN)} at 15 psi. At ${fmt(limit, 1)} psi it costs ${perBbl(optP?.costPerBbl ?? NaN)}.`}
          height={210}
          x={[7, 15]}
          y={[c0, c1]}
          xTicks={[7, 8, 9, 10, 11, 12, 13, 14, 15]}
          yTicks={niceTicks(c0, c1, 4)}
          xFormat={(v) => `${v} psi`}
          yFormat={(v) => `$${fmt(v)}`}
          xLabel="vapor-pressure limit"
          yLabel="Cost of the cheapest blend, $ per barrel"
          series={[{ points: sweep.map((p) => [p.lim, p.cost] as [number, number]), color: '#6d9c37', width: 3 }]}
          refs={[
            { axis: 'x', at: SUMMER.rvp, color: '#c4382f', label: 'summer' },
            { axis: 'x', at: WINTER.rvp, color: '#4590ce', label: 'winter' },
            { axis: 'x', at: limit, cursor: true },
          ]}
          markers={optP ? [{ x: limit, y: optP.costPerBbl, color: '#3f7a1e', r: 6 }] : []}
        />
        <XYChart
          ariaLabel={`Butane in the cheapest blend against the vapor-pressure limit: ${kbd(sweep[0]?.butane ?? 0)} at 7 psi, ${kbd(sweep[sweep.length - 1]?.butane ?? 0)} at 15 psi; ${kbd(opt?.butane ?? 0)} at ${fmt(limit, 1)} psi.`}
          height={150}
          x={[7, 15]}
          y={[0, 10]}
          xTicks={[7, 8, 9, 10, 11, 12, 13, 14, 15]}
          yTicks={[0, 5, 10]}
          xFormat={(v) => `${v} psi`}
          yFormat={(v) => fmt(v)}
          yLabel="Butane in the blend, kb/d"
          series={[{ points: sweep.map((p) => [p.lim, p.butane] as [number, number]), color: STREAM.butane.color, width: 3 }]}
          refs={[{ axis: 'x', at: limit, cursor: true }]}
          markers={opt ? [{ x: limit, y: opt.butane, color: '#4590ce', r: 6 }] : []}
        />
        {opt && <BlendBar vols={opt} title={`The cheapest blend at ${fmt(limit, 1)} psi`} />}
        <Readouts
          items={[
            { label: <K c="price">cost per barrel</K>, value: perBbl(optP?.costPerBbl ?? NaN), tone: 'green' },
            { label: `saving against the ${fmt(SUMMER.rvp, 1)} psi summer limit`, value: optP ? perBbl(summerAtVol - optP.costPerBbl) : '—', tone: 'green' },
          ]}
        />
        <Slider
          label="Vapor-pressure limit"
          tone="blue"
          value={limit}
          min={7}
          max={15}
          step={RVP_STEP}
          onChange={(v) => s2.set({ limit: Math.round(v * 10) / 10 })}
          display={`${fmt(limit, 1)} psi`}
        />
        <Slider label="Gasoline pool" tone="orange" value={volume} min={55} max={70} onChange={(v) => s2.set({ volume: v })} display={kbd(volume)} />
      </Figure>

      <P>
        At the summer limit, the cheapest {TARGET_VOLUME} kb/d blend costs {perBbl(SUMMER_P.costPerBbl)} a barrel; at the winter limit, {perBbl(WINTER_P.costPerBbl)},
        because it can take {fmt(WINTER_OPT.butane, 2)} kb/d of cheap butane instead of {fmt(SUMMER_OPT.butane, 2)} and less reformate. Winter-grade gasoline is{' '}
        {usd(SEASON_GAP, 2)} a barrel, about {fmt((SEASON_GAP / 42) * 100, 1)}¢ a gallon, cheaper to make. The line is almost straight: near the summer limit, each extra
        psi the specification allows saves about {usd(PER_PSI, 2)} a barrel. Change the size of the pool and the gap persists — {perBbl(optimumCost(55))} against{' '}
        {perBbl(optimumCost(55, WINTER))} at 55 kb/d, {perBbl(optimumCost(70))} against {perBbl(optimumCost(70, WINTER))} at 70.
      </P>
      <P>
        Markets see this too. The gasoline futures contract traded on the New York Mercantile Exchange, called RBOB, switches to summer-grade specifications for its
        spring and summer delivery months, and the change shows up in the prices of those months. Chapter 5 comes back to that seasonal pattern.
      </P>

      <Challenge
        id="b"
        question={`The cheapest ${TARGET_VOLUME} kb/d summer blend uses ${fmt(SUMMER_OPT.butane, 2)} kb/d of butane, and each extra psi the limit allows lets in about ${fmt(BUTANE_PER_PSI, 2)} kb/d more. Predict the lowest vapor-pressure limit, to the nearest 0.1 psi, at which the cheapest blend uses at least ${BUTANE_TARGET} kb/d of butane, then set it to check.`}
        solved={solvedB}
        status={volume !== TARGET_VOLUME ? `Set the gasoline pool to ${TARGET_VOLUME} kb/d.` : `At ${fmt(limit, 1)} psi, the cheapest blend uses ${kbd(butaneAt(limit))} of butane.`}
        success={`Solved: ${fmt(limit, 1)} psi. The prediction: ${fmt(BUTANE_TARGET - SUMMER_OPT.butane, 2)} kb/d more butane at ${fmt(BUTANE_PER_PSI, 2)} kb/d per psi needs ${fmt((BUTANE_TARGET - SUMMER_OPT.butane) / BUTANE_PER_PSI, 1)} psi more than the ${fmt(SUMMER.rvp, 1)} psi summer limit. The butane line is nearly straight, so each step in the limit lets the blender swap about the same amount of reformate for butane — the vapor-pressure index, not the octane, decides how much butane fits.`}
      />

      <P>
        The blender’s problem is a small version of the refinery’s. Every unit upstream of the tank faces the same kind of choice: which stream to send where, given the
        units’ capacities, the products’ specifications and what everything is worth. In the <a href={lessonHref('oil/3.5')}>next lesson</a> we’ll write the whole
        Corran refinery as one linear program — crude choice, unit runs and blending together — and see what the refinery as a whole earns.
      </P>
    </LessonPage>
  );
}
