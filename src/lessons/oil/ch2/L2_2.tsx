import { useId, useMemo } from 'react';
import {
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
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
  mix,
  useScenario,
} from '../../../framework';
import { fieldWell, hoursToReach, productivityIndex, radialPressure, radialRate, radiusOfInvestigation, type RadialWell } from '../../../engines/oil/reservoir';
import { FIELDS, type FieldId } from '../../../model/oil/fields';
import { CRUDE_COLOR } from '../../../model/oil/crudes';
import { XYChart } from '../shared/charts';

const FIELD_IDS: FieldId[] = ['northfield', 'coldwater', 'ridgeback'];
const FIELD_LABEL: Record<FieldId, string> = { northfield: 'Northfield sandstone', coldwater: 'Coldwater heavy-oil sand', ridgeback: 'Ridgeback shale' };
const FIELD_COLOR: Record<FieldId, string> = { northfield: CRUDE_COLOR.northfield, coldwater: CRUDE_COLOR.coldwater, ridgeback: CRUDE_COLOR.ridgeback };
/** The drawdown each field is produced at elsewhere in the course, psi. */
const DRAWDOWN: Record<FieldId, number> = { northfield: 1000, coldwater: 400, ridgeback: 4200 };

export interface FlowState {
  field: FieldId;
  /** log10 of permeability in md. */
  kExp: number;
  /** log10 of oil viscosity in cP. */
  muExp: number;
  drawdown: number;
  skin: number;
}

/** A field's starting values for the first demonstration. */
export function fieldDefaults(id: FieldId): FlowState {
  return { field: id, kExp: Math.log10(FIELDS[id].permeability), muExp: Math.log10(FIELDS[id].oilViscosity), drawdown: DRAWDOWN[id], skin: 0 };
}

/** The well the first demonstration describes. */
export function wellOf(st: FlowState): RadialWell {
  return fieldWell(st.field, { k: 10 ** st.kExp, mu: 10 ** st.muExp, skin: st.skin });
}

/** Drawdown slider maximum: no more than 4,500 psi, and at least 100 psi left at the well. */
export function maxDrawdown(id: FieldId): number {
  return Math.min(4500, FIELDS[id].initialPressure - 100);
}

/** Northfield's productivity index with its own rock and oil, b/d per psi. */
export const NORTHFIELD_PI = productivityIndex(fieldWell('northfield'));
export const MU_STEP = 0.05;

/**
 * Challenge a: with Coldwater's 2,000 md rock and no skin, the highest viscosity on the slider at
 * which its productivity index is at least Northfield's.
 */
export function heavyOilSolved(st: FlowState): boolean {
  if (st.field !== 'coldwater' || st.skin !== 0) return false;
  if (Math.abs(10 ** st.kExp / FIELDS.coldwater.permeability - 1) > 0.02) return false;
  const pi = (muExp: number) => productivityIndex(wellOf({ ...st, muExp }));
  return pi(st.muExp) >= NORTHFIELD_PI && pi(st.muExp + MU_STEP) < NORTHFIELD_PI;
}

/** How far a field's pressure disturbance has spread after `hours`, ft. */
export function reach(id: FieldId, hours: number): number {
  const f = FIELDS[id];
  return radiusOfInvestigation(f.permeability, hours, f.porosity, f.oilViscosity, f.compressibility);
}

export const TIME_STEP = 0.01;
export const HALFWAY_FT = 50;

/** Challenge b: the first time on the slider when a Ridgeback well's disturbance has reached 50 ft. */
export function halfwaySolved(tExp: number): boolean {
  return reach('ridgeback', 10 ** tExp) >= HALFWAY_FT && reach('ridgeback', 10 ** (tExp - TIME_STEP)) < HALFWAY_FT;
}

/** Two significant figures for small numbers, whole numbers for large ones. */
function sig(x: number): string {
  if (x >= 100) return fmt(x);
  if (x >= 10) return fmt(x, 1).replace(/\.0$/, '');
  return x.toLocaleString('en-US', { maximumSignificantDigits: 2 });
}

function ft(x: number): string {
  return `${x < 10 ? fmt(x, 1) : fmt(x)} ft`;
}

function humanTime(hours: number): string {
  if (hours < 48) return `${fmt(hours, hours < 10 ? 1 : 0)} hour${Math.round(hours * 10) === 10 ? '' : 's'}`;
  const days = hours / 24;
  if (days < 120) return `${fmt(days)} days`;
  if (days < 730) return `${fmt(days / 30.44)} months`;
  return `${fmt(days / 365.25, 1)} years`;
}

const LOW = '#f3f7fb';
const HIGH = GRAPHIC.blue;

/** A well at the center of its drainage circle, seen from above, with rings spaced logarithmically. */
function PlanView({ w, pwf, pe, rate, rHalf }: { w: RadialWell; pwf: number; pe: number; rate: number; rHalf: number }) {
  const gid = 'pg' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const CX = 330;
  const CY = 132;
  const R = 112;
  const L = Math.log(w.re / w.rw);
  const rho = (r: number) => (R * Math.max(0, Math.log(Math.max(r, w.rw) / w.rw))) / L;
  const N = 30;
  const span = pe - pwf;
  const rings = Array.from({ length: N }, (_, i) => {
    const i2 = N - 1 - i;
    const rMid = w.rw * (w.re / w.rw) ** ((i2 + 0.5) / N);
    const p = radialPressure(w, rMid, pwf, pe);
    const share = span > 0 ? (p - pwf) / span : 1;
    return { radius: (R * (i2 + 1)) / N, fill: mix(LOW, HIGH, share) };
  });
  const speed = Math.min(120, (40 * rate) / 2000);
  const flow = speed > 0.05 ? { animationDuration: `${(18 / speed).toFixed(3)}s` } : { animationPlayState: 'paused' as const };
  const spokes = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6 + Math.PI / 12);
  const marks = [1, 10, 100].filter((r) => r > w.rw && r < w.re);
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 268"
      role="img"
      aria-label={`A vertical well seen from above at the center of its drainage circle, ${fmt(w.re)} ft in radius, with rings spaced logarithmically. Pressure rises from ${fmt(pwf)} psi at the well to ${fmt(pe)} psi at the edge; half the drop is spent within ${ft(rHalf)} of the well. Oil flows in at ${sig(rate)} STB per day.`}
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={LOW} />
          <stop offset="1" stopColor={HIGH} />
        </linearGradient>
      </defs>
      {rings.map((r, i) => (
        <circle key={i} cx={CX} cy={CY} r={r.radius} fill={r.fill} />
      ))}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="#8a8a8a" strokeWidth={1.5} />
      {marks.map((r) => (
        <g key={r}>
          <circle cx={CX} cy={CY} r={rho(r)} fill="none" stroke="#ffffff" strokeWidth={1} strokeDasharray="3 3" opacity={0.9} />
          <text x={CX + rho(r) + 3} y={CY + 4} className="ax" style={{ fill: '#333' }}>
            {r} ft
          </text>
        </g>
      ))}
      <text x={CX + R + 6} y={CY + 4} className="ax">
        {fmt(w.re)} ft
      </text>
      {rHalf > w.rw && (
        <circle cx={CX} cy={CY} r={rho(rHalf)} fill="none" stroke="#c4382f" strokeWidth={2} strokeDasharray="5 3" />
      )}
      {spokes.map((a, i) => {
        const x0 = CX + R * Math.cos(a);
        const y0 = CY + R * Math.sin(a);
        const x1 = CX + 6 * Math.cos(a);
        const y1 = CY + 6 * Math.sin(a);
        return <path key={i} d={`M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}`} className="flow-dots" stroke="#d0702a" strokeWidth={4} style={flow} />;
      })}
      <circle cx={CX} cy={CY} r={5} fill="#333" />
      <text x={CX} y={CY + R + 22} textAnchor="middle" className="ax">
        well at the center · rings spaced by powers of ten
      </text>
      <g transform="translate(24 40)">
        <text className="ax" x={0} y={0}>
          Pressure
        </text>
        <rect x={0} y={8} width={130} height={10} fill={`url(#${gid})`} stroke="#c9c9c4" strokeWidth={0.5} />
        <text className="ax" x={0} y={34}>
          {fmt(pwf)} psi
        </text>
        <text className="ax ax-e" x={130} y={34}>
          {fmt(pe)} psi
        </text>
        <text className="ax" x={0} y={52}>
          at the well · at the edge
        </text>
        <line x1={0} x2={18} y1={76} y2={76} stroke="#c4382f" strokeWidth={2} strokeDasharray="5 3" />
        <text className="ax" x={24} y={80}>
          half the drop
        </text>
        <line x1={0} x2={18} y1={98} y2={98} stroke="#d0702a" strokeWidth={4} strokeDasharray="0 9" strokeLinecap="round" />
        <text className="ax" x={24} y={102}>
          oil flowing in
        </text>
      </g>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario<FlowState>('flow', fieldDefaults('northfield'));
  const st = s.state;
  const w = wellOf(st);
  const f = FIELDS[st.field];
  const pe = f.initialPressure;
  const dd = Math.min(st.drawdown, maxDrawdown(st.field));
  const pwf = pe - dd;
  const q = radialRate(w, dd);
  const pi = productivityIndex(w);
  const total = Math.log(w.re / w.rw) + w.skin;
  const rHalf = w.rw * Math.exp(total / 2 - w.skin);
  const k = 10 ** st.kExp;
  const mu = 10 ** st.muExp;
  const profile = useMemo(() => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 80; i++) {
      const r = w.rw * (w.re / w.rw) ** (i / 80);
      pts.push([r, radialPressure(w, r, pwf, pe)]);
    }
    return pts;
  }, [w, pwf, pe]);
  const yLo = Math.floor((pwf - 1) / 100) * 100;
  const yHi = Math.ceil((pe + 1) / 100) * 100;

  const nf = fieldWell('northfield');
  const cw = fieldWell('coldwater');
  const rb = fieldWell('ridgeback');
  const nfQ = radialRate(nf, DRAWDOWN.northfield);
  const cwQ = radialRate(cw, DRAWDOWN.coldwater);
  const rbQ = radialRate(rb, DRAWDOWN.ridgeback);
  const halfDist = Math.sqrt(nf.re * nf.rw);
  const lnRatio = Math.log(nf.re / nf.rw);
  const stimulated = radialRate({ ...nf, skin: -3 }, DRAWDOWN.northfield);
  const muMatch = (productivityIndex(cw) * FIELDS.coldwater.oilViscosity) / NORTHFIELD_PI;

  const choose = (id: FieldId) => s.set(fieldDefaults(id));
  const solvedA = heavyOilSolved(st);

  const s2 = useScenario('reach', { tExp: 1.38 });
  const hours = 10 ** s2.state.tExp;
  const solvedB = halfwaySolved(s2.state.tExp);
  const H30 = 30 * 365.25 * 24;
  const lines = useMemo(
    () => FIELD_IDS.map((id) => ({ id, points: [1, H30].map((h) => [h, reach(id, h)] as [number, number]) })),
    [H30],
  );

  return (
    <LessonPage id="oil/2.2">
      <P>
        <a href={lessonHref('oil/2.1')}>Lesson 2.1</a> found Northfield’s oil where all crude oil is found: not in an underground lake, but spread through the tiny
        pores of a rock, held under a seal in a dome-shaped trap. Hundreds of millions of barrels sit there. None of it is worth anything until it reaches a well, and
        how fast it gets there decides how many wells a field needs, how much each one produces, and in the end what the oil costs to bring up.
      </P>
      <P>
        The law that governs that journey was found by a French engineer, Henry Darcy, who measured water seeping through columns of sand and published the result in
        1856, in a report on the public fountains of Dijon. The flow through a slab of porous material is proportional to its area and to the drop in <K tone="blue">pressure</K> across
        it per unit length, and inversely proportional to the fluid’s <K tone="violet">viscosity</K>. The constant of proportionality belongs to the rock alone. It’s
        called <K tone="violet">permeability</K> and measured in darcies: one darcy lets a fluid as viscous as water pass at one cubic centimeter per second through each
        square centimeter, under a pressure gradient of one atmosphere per centimeter. Reservoir rocks are usually quoted in millidarcies. Good sandstones run from tens
        of millidarcies to several darcies; shales are measured in nanodarcies, billionths of a darcy.
      </P>
      <P>
        Around a vertical well, oil converges from every direction. The area it has to pass through shrinks as it approaches — at distance r from the well it’s the
        wall of a cylinder, 2πrh — so the oil speeds up and the pressure gradient steepens. Integrating Darcy’s law from the edge of the area the well drains, at radius
        r<Sub>e</Sub>, to the wellbore, at r<Sub>w</Sub>, gives the rate in stock-tank barrels per day for a <K tone="blue">drawdown</K> Δp, the difference between the
        pressure out in the rock and the pressure in the well:
      </P>
      <Eq
        label={`Rate equals 0.00708 times ${sig(k)} md times ${fmt(w.h)} ft times ${fmt(dd)} psi, divided by ${sig(mu)} cP times ${fmt(w.bo, 2)} times the sum of ${fmt(Math.log(w.re / w.rw), 2)} and a skin of ${fmt(w.skin, 1)}: ${sig(q)} STB per day`}
      >
        <K tone="orange">q</K>
        <Op>=</Op>
        <Frac
          top={
            <>
              0.00708 · <K tone="violet">k</K> · h · <K tone="blue">Δp</K>
            </>
          }
          bottom={
            <>
              <K tone="violet">μ</K> · B<Sub>o</Sub> · (ln(r<Sub>e</Sub>/r<Sub>w</Sub>) + S)
            </>
          }
        />
        <Op>=</Op>
        <Frac
          top={
            <>
              0.00708 · <K tone="violet">{sig(k)}</K> · {fmt(w.h)} · <K tone="blue">{fmt(dd)}</K>
            </>
          }
          bottom={
            <>
              <K tone="violet">{sig(mu)}</K> · {fmt(w.bo, 2)} · ({fmt(Math.log(w.re / w.rw), 2)} {w.skin < 0 ? '−' : '+'} {fmt(Math.abs(w.skin), 1)})
            </>
          }
        />
        <Op>=</Op>
        <K tone="orange">{sig(q)} STB/day</K>
      </Eq>
      <P>
        Here h is the thickness of oil-bearing rock, B<Sub>o</Sub> converts reservoir barrels to the smaller stock-tank barrels of <a href={lessonHref('oil/2.1')}>Lesson
        2.1</a>, the 0.00708 takes care of the field units, and S, the skin, we’ll come to shortly. In the next demonstration, a vertical well sits at the center of the
        circle of rock it drains, {fmt(nf.re)} ft in radius. The rings are spaced by powers of ten in distance, so the few feet around the well get as much room as the
        hundreds of feet beyond. Choose a field, then change the rock, the oil, and the drawdown:
      </P>

      <Figure name="Reservoir Flow Simulator" scenario={s}>
        <Segmented label="Field" value={st.field} onChange={choose} options={FIELD_IDS.map((id) => ({ value: id, label: FIELD_LABEL[id] }))} />
        <PlanView w={w} pwf={pwf} pe={pe} rate={q} rHalf={rHalf} />
        <XYChart
          ariaLabel={`Pressure against distance from the well, on a logarithmic distance scale: ${fmt(pwf)} psi at the wellbore rising to ${fmt(pe)} psi at ${fmt(w.re)} ft. Half the drawdown is spent within ${ft(rHalf)}.`}
          height={190}
          x={[0.2, 1000]}
          logX
          xTicks={[1, 10, 100, 1000]}
          xFormat={(v) => `${fmt(v)} ft`}
          y={[yLo, yHi]}
          yFormat={(v) => fmt(v)}
          xLabel="distance from the well (log scale)"
          yLabel="Pressure, psi"
          series={[{ points: profile, color: GRAPHIC.blue, width: 3 }]}
          refs={rHalf > w.rw ? [{ axis: 'x', at: rHalf, color: '#c4382f', label: 'half the drop' }] : []}
        />
        <Readouts
          items={[
            { label: <K tone="orange">rate</K>, value: `${sig(q)} STB/day`, tone: 'orange' },
            { label: 'productivity index', value: `${sig(pi)} b/d per psi` },
            { label: 'half the drop is spent within', value: rHalf > w.rw ? ft(rHalf) : 'the damaged zone' },
          ]}
        />
        <Slider
          label="Permeability"
          tone="violet"
          value={st.kExp}
          min={-4}
          max={4}
          step={0.05}
          onChange={(v) => s.set({ kExp: Math.round(v * 100) / 100 })}
          display={`${sig(k)} md`}
        />
        <Slider
          label="Oil viscosity"
          tone="violet"
          value={st.muExp}
          min={-0.5}
          max={3}
          step={MU_STEP}
          onChange={(v) => s.set({ muExp: Math.round(v * 100) / 100 })}
          display={`${sig(mu)} cP`}
        />
        <Slider label="Drawdown" tone="blue" value={dd} min={0} max={maxDrawdown(st.field)} step={50} onChange={(v) => s.set({ drawdown: v })} display={`${fmt(dd)} psi`} />
        <Slider label="Skin" value={st.skin} min={-4} max={20} step={0.5} onChange={(v) => s.set({ skin: v })} display={fmt(st.skin, 1)} />
      </Figure>

      <P>
        Start with Northfield: {fmt(FIELDS.northfield.permeability)} millidarcies of sandstone and oil of{' '}
        {fmt(FIELDS.northfield.oilViscosity, 1)} centipoise, a little thicker than water. At a drawdown of {fmt(DRAWDOWN.northfield)} psi the well makes{' '}
        {fmt(nfQ)} barrels a day; its <b>productivity index</b>, the rate per psi of drawdown, is {fmt(NORTHFIELD_PI, 2)}. Coldwater’s loose sand is{' '}
        {fmt(FIELDS.coldwater.permeability / FIELDS.northfield.permeability)} times as permeable, but its oil is {fmt(FIELDS.coldwater.oilViscosity / FIELDS.northfield.oilViscosity)}{' '}
        times as viscous, and the well manages just {fmt(cwQ)} barrels a day at the {fmt(DRAWDOWN.coldwater)} psi such a shallow reservoir can spare. Ridgeback is the
        extreme: Northfield’s sandstone is {fmt(FIELDS.northfield.permeability / FIELDS.ridgeback.permeability)} times as permeable as Ridgeback’s shale, and even a{' '}
        {fmt(DRAWDOWN.ridgeback)} psi drawdown pulls only about {fmt(rbQ, 1)} barrels a day into a vertical well. Rate depends on the ratio of permeability to
        viscosity, and Ridgeback’s ratio is tiny.
      </P>

      <H2>Where the pressure goes</H2>
      <P>
        Look at the pressure chart. Because the oil crosses ever smaller areas as it closes in, the same drop in pressure is spent on each tenfold step in distance:
        as much between 1 and 10 feet from the well as between 10 and 100. With no damage, half of the whole drawdown is used up within{' '}
        {fmt(halfDist)} feet of the wellbore — the square root of r<Sub>e</Sub> times r<Sub>w</Sub> — out of a drainage area {fmt(nf.re)} feet in radius.
      </P>
      <P>
        That makes the rock right next to the well matter out of all proportion to its size. Drilling fluid and fine particles can plug its pores, and the holes shot
        through the steel casing to let oil in can restrict it further. Engineers lump the extra pressure loss into a single number, the <b>skin</b>, added to ln(r<Sub>e</Sub>/r
        <Sub>w</Sub>) = {fmt(lnRatio, 2)}. A skin equal to that, about {fmt(lnRatio, 1)}, halves the well’s rate. Raise the skin in{' '}
        <FigRef to="Reservoir Flow Simulator">the demonstration</FigRef> and watch the pressure jump at the wellbore. Stimulation works the other way: acid that
        dissolves the damage, or a fracture that props open a path into the rock, gives a negative skin. At a skin of −3, the Northfield well makes {fmt(stimulated)}{' '}
        barrels a day.
      </P>

      <Challenge
        id="a"
        figure="Reservoir Flow Simulator"
        question={`Heavy oil is often heated with steam to thin it. Choose Coldwater, keep its 2,000 md rock and a skin of 0, and find the highest oil viscosity on the slider at which a Coldwater well is at least as productive as a Northfield well — ${fmt(NORTHFIELD_PI, 2)} b/d per psi.`}
        solved={solvedA}
        status={
          st.field !== 'coldwater'
            ? 'Choose Coldwater first.'
            : st.skin !== 0 || Math.abs(k / FIELDS.coldwater.permeability - 1) > 0.02
              ? 'Keep Coldwater’s 2,000 md rock, and set the skin to 0.'
              : `At ${sig(mu)} cP, a Coldwater well’s productivity index is ${sig(pi)} b/d per psi, against Northfield’s ${fmt(NORTHFIELD_PI, 2)}.`
        }
        success={`Solved: ${sig(mu)} cP. Coldwater’s rock is ${fmt(FIELDS.coldwater.permeability / FIELDS.northfield.permeability)} times as permeable as Northfield’s, so its oil needs to be only about ${fmt(muMatch)} cP — a tenth of its natural ${fmt(FIELDS.coldwater.oilViscosity)} cP — for its wells to keep up. As Lesson 1.3 showed, heavy oil thins dramatically as it warms, which is why many heavy-oil fields inject steam.`}
      />

      <H2>How far a well can feel</H2>
      <P>
        Darcy’s law in this form describes a well that has settled down, its pressure disturbance spread all the way to the edge of the rock it drains. That doesn’t
        happen at once. When a well opens, only the rock nearest to it feels the lower pressure; the disturbance then diffuses outward, faster in permeable rock and
        slower where the oil is viscous or the rock and fluids expand a lot as pressure falls. The distance it has reached after t hours is the{' '}
        <b>radius of investigation</b>, in feet:
      </P>
      <Eq label="Radius of investigation equals the square root of k t divided by 948 times porosity times viscosity times total compressibility">
        <span>r</span>
        <Op>=</Op>
        <span>√</span>
        <Frac
          top={
            <>
              <K tone="violet">k</K> · t
            </>
          }
          bottom={
            <>
              948 · φ · <K tone="violet">μ</K> · c<Sub>t</Sub>
            </>
          }
        />
      </Eq>
      <P>
        where φ is the porosity and c<Sub>t</Sub> the total compressibility of rock and fluids. In the next demonstration, set the time since a well opened and compare
        how far the disturbance has spread in each of the three fields; note that both axes are logarithmic:
      </P>

      <Figure name="Reservoir Flow Simulator · reach" scenario={s2}>
        <Legend items={FIELD_IDS.map((id) => ({ label: FIELD_LABEL[id], color: FIELD_COLOR[id], kind: 'line' as const }))} />
        <XYChart
          ariaLabel={`How far each well’s pressure disturbance has spread against time, both on logarithmic scales. After ${humanTime(hours)}: ${FIELD_IDS.map((id) => `${FIELDS[id].name} ${ft(reach(id, hours))}`).join(', ')}.`}
          height={260}
          x={[1, 300000]}
          logX
          y={[0.5, 100000]}
          logY
          xTicks={[1, 24, 730.5, 8766, 87660]}
          xFormat={(v) => (v === 1 ? '1 hour' : v === 24 ? '1 day' : v < 1000 ? '1 month' : v < 10000 ? '1 year' : '10 years')}
          yTicks={[1, 10, 100, 1000, 10000, 100000]}
          yFormat={(v) => fmt(v)}
          xLabel="time since the well opened (log scale)"
          yLabel="Reach of the pressure disturbance, ft (log scale)"
          margin={[64, 16, 28, 40]}
          series={lines.map((l) => ({ points: l.points, color: FIELD_COLOR[l.id], width: 2.5 }))}
          refs={[
            { axis: 'y', at: nf.re, color: '#5f5f5f', label: `edge of a vertical well’s drainage, ${fmt(nf.re)} ft` },
            { axis: 'y', at: HALFWAY_FT, color: '#c4382f', label: `halfway between Ridgeback fractures, ${HALFWAY_FT} ft` },
            { axis: 'x', at: hours, cursor: true },
          ]}
          markers={FIELD_IDS.map((id) => ({ x: hours, y: reach(id, hours), color: FIELD_COLOR[id], r: 6 }))}
        />
        <Readouts items={FIELD_IDS.map((id) => ({ label: `${FIELDS[id].name} reach`, value: ft(reach(id, hours)) }))} />
        <Slider
          label="Time since the well opened"
          value={s2.state.tExp}
          min={0}
          max={5.42}
          step={TIME_STEP}
          onChange={(v) => s2.set({ tExp: Math.round(v * 100) / 100 })}
          display={humanTime(hours)}
        />
      </Figure>

      <P>
        A Northfield well feels its whole drainage area within about {fmt(hoursToReach(nf.re, FIELDS.northfield.permeability, FIELDS.northfield.porosity, FIELDS.northfield.oilViscosity, FIELDS.northfield.compressibility))} hours; after that, the steady picture of{' '}
        <FigRef to="Reservoir Flow Simulator">the first demonstration</FigRef> is a good description of it. Coldwater’s viscous oil slows the spread, and it takes
        about {fmt(hoursToReach(cw.re, FIELDS.coldwater.permeability, FIELDS.coldwater.porosity, FIELDS.coldwater.oilViscosity, FIELDS.coldwater.compressibility) / 24)} days to get as far. Ridgeback is in another world. After an hour its disturbance has moved{' '}
        {fmt(reach('ridgeback', 1), 1)} feet into the rock, after a day {fmt(reach('ridgeback', 24), 1)} feet, after a year about {fmt(reach('ridgeback', 8766))} feet,
        and after 30 years only about {fmt(reach('ridgeback', H30))} — still short of the edge of an ordinary well spacing. A Ridgeback well never settles down: as long
        as it produces, it is draining a slowly widening zone around itself, and its rate keeps falling.
      </P>

      <Challenge
        id="b"
        question={`Suppose a Ridgeback well is cracked open with fractures about 100 ft apart, so each fracture face drains the rock up to ${HALFWAY_FT} ft away. How long until the pressure disturbance reaches that far? Find the first time on the slider when Ridgeback’s reach is at least ${HALFWAY_FT} ft.`}
        solved={solvedB}
        status={`After ${humanTime(hours)}, a Ridgeback well’s disturbance has reached ${ft(reach('ridgeback', hours))}.`}
        success={`Solved: about ${humanTime(hours)}. Within three months, the rock between neighboring fractures is all feeling the well — and from then on the fractures compete for the same oil, so the rate falls faster. Space them farther apart and each takes longer to drain its share.`}
      />

      <P>
        That challenge holds the key to shale oil. If oil can’t travel far through the rock, the well has to travel through the rock instead: turn sideways and run
        horizontally for a mile or two inside the oil-bearing layer, then crack the rock open every few dozen feet so that oil never has to move more than a short
        distance to reach a path to the well. Those two techniques — horizontal drilling and multistage hydraulic fracturing — made rocks like Ridgeback’s the biggest
        source of growth in the world’s oil supply during the 2010s. The <a href={lessonHref('oil/2.3')}>next lesson</a> designs such a well, and puts a price on it.
      </P>
    </LessonPage>
  );
}

