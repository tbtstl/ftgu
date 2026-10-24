import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sub,
  Sup,
  TEXT,
  clamp,
  fmt,
  lessonHref,
  mix,
  pct,
  usd,
  useScenario,
} from '../../../framework';
import { COMPRESSOR_EFFICIENCY, DRIVER_HEAT_RATE, K_GAS, compress, lineCapacity, stationLine, type StationLine } from '../../../engines/gas/compression';
import { zFactor } from '../../../engines/gas/eos';
import { inletPressure, outletPressure, pressureProfile, velocity } from '../../../engines/gas/hydraulics';
import { R_FTLBF, SCF_PER_LBMOL, STD_PSIA, psia, psig, rankine } from '../../../engines/gas/properties';
import { PIPELINE, stationLineOf } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { degF, mmcfd, psigFmt } from '../shared/format';

// ---------------------------------------------------------------------------
// One station.

/** Illustrative gas price for the fuel bill, $/MMBtu. */
export const FUEL_PRICE = 3;
/** The first demonstration starts with Northline's first station at Calder Hub, at its rated flow. */
export const STATION_DEFAULTS = { suction: 765, discharge: 1440, flow: 1800 };
/** Horsepower per (MMcf/d × °R) of the work formula: lb-mol per MMcf, per second, times R, per horsepower. */
const HP_COEF = ((1e6 / SCF_PER_LBMOL / 86400) * R_FTLBF) / 550;
const EXP = (K_GAS - 1) / K_GAS;
const SUCTION_F = 60;
const PIPE_IN = 35;

function compressAt(s: typeof STATION_DEFAULTS) {
  return compress(s.flow, psia(s.suction), psia(s.discharge), SUCTION_F);
}

/** Pipe color for gas at a temperature: pale teal when cool, through gold, to red when hot. */
function heatColor(f: number) {
  const t = clamp((f - SUCTION_F) / 180, 0, 1);
  return t < 0.5 ? mix('#8fb9b3', '#e2b04a', t * 2) : mix('#e2b04a', GRAPHIC.red, t * 2 - 1);
}

/** A pressure gauge, 0–1,600 psig on a 270° dial. */
function Gauge({ cx, cy, value, label }: { cx: number; cy: number; value: number; label: string }) {
  const r = 28;
  const a = ((-135 + (270 * clamp(value, 0, 1600)) / 1600) * Math.PI) / 180;
  const s = (-135 * Math.PI) / 180;
  const e = (135 * Math.PI) / 180;
  const pt = (ang: number, rr: number) => [cx + rr * Math.sin(ang), cy - rr * Math.cos(ang)];
  const [sx, sy] = pt(s, r);
  const [ex, ey] = pt(e, r);
  const [nx, ny] = pt(a, r - 6);
  return (
    <g>
      <line x1={cx} y1={cy + r} x2={cx} y2={151} stroke="#9a9a9a" strokeWidth={3} />
      <circle cx={cx} cy={cy} r={r + 4} fill="#fcfcfb" stroke="#555" strokeWidth={1.5} />
      <path d={`M${sx} ${sy} A${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="#cfcfcf" strokeWidth={3} />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={GRAPHIC.blue} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={3} fill="#444" />
      <text x={cx + r + 10} y={cy - 2} style={{ fontSize: 15, fontWeight: 500, fill: TEXT.blue }}>
        {fmt(value)} psig
      </text>
      <text x={cx + r + 10} y={cy + 15} className="ax">
        {label}
      </text>
    </g>
  );
}

function dots(pxPerS: number) {
  return pxPerS > 0.3 ? { animationDuration: `${(18 / pxPerS).toFixed(3)}s` } : { animationPlayState: 'paused' as const };
}

function StationDiagram({ s, c }: { s: typeof STATION_DEFAULTS; c: ReturnType<typeof compressAt> }) {
  const vIn = s.flow > 0 ? velocity(s.flow * 1e6, psia(s.suction), SUCTION_F, PIPE_IN) : 0;
  const vOut = s.flow > 0 ? velocity(s.flow * 1e6, psia(s.discharge), c.dischargeF, PIPE_IN) : 0;
  const pipe = { strokeWidth: 18, strokeLinecap: 'round' as const, fill: 'none' };
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 250"
      role="img"
      aria-label={`A compressor station taking in ${fmt(s.flow)} MMcf/d at ${fmt(s.suction)} psig and ${SUCTION_F} °F and sending it out at ${fmt(s.discharge)} psig and ${fmt(c.dischargeF)} °F. Its gas turbine delivers ${fmt(c.hp)} horsepower and burns ${fmt(c.fuelMMcfd, 1)} MMcf/d of the gas.`}
    >
      <text x={20} y={196} className="ax">
        from Calder Hub
      </text>
      <text x={620} y={196} className="ax ax-e">
        into Northline
      </text>
      <path d="M20 160 L250 160" stroke={heatColor(SUCTION_F)} {...pipe} />
      <path d="M360 160 L620 160" stroke={heatColor(c.dischargeF)} {...pipe} />
      <path d="M20 160 L250 160" className="flow-dots" stroke="#fff" strokeWidth={5} style={dots(vIn * 1.2)} />
      <path d="M360 160 L620 160" className="flow-dots" stroke="#fff" strokeWidth={5} style={dots(vOut * 1.2)} />
      {/* Fuel tapped from the suction side to the turbine. */}
      <path d="M222 151 L222 66 L250 66" fill="none" stroke="#d9d9d5" strokeWidth={4} strokeLinejoin="round" />
      <path d="M222 151 L222 66 L250 66" className="flow-dots" stroke={GRAPHIC.red} strokeWidth={4} style={dots(c.fuelMMcfd * 2.5)} />
      <text x={214} y={122} textAnchor="end" style={{ fontSize: 12, fill: TEXT.red }}>
        fuel
      </text>
      {/* Turbine, shaft and compressor. */}
      <rect x={250} y={42} width={110} height={50} rx={6} fill="#f4f1ec" stroke="#555" strokeWidth={1.5} />
      <text x={305} y={63} textAnchor="middle" style={{ fontSize: 12, fill: '#333' }}>
        gas turbine
      </text>
      <text x={305} y={81} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: TEXT.red }}>
        {fmt(c.hp)} hp
      </text>
      <path d="M350 42 q6 -8 0 -14 q-6 -6 0 -14" fill="none" stroke="#aaa" strokeWidth={1.5} />
      <path d="M336 42 q6 -8 0 -14 q-6 -6 0 -14" fill="none" stroke="#aaa" strokeWidth={1.5} />
      <line x1={305} y1={92} x2={305} y2={122} stroke="#555" strokeWidth={4} />
      <path d="M250 120 L360 140 L360 180 L250 200 Z" fill="#ecebe6" stroke="#555" strokeWidth={1.5} />
      <text x={305} y={224} textAnchor="middle" className="ax">
        compressor · ratio {c.ratio.toFixed(2)}
      </text>
      <Gauge cx={70} cy={78} value={s.suction} label="suction" />
      <Gauge cx={440} cy={78} value={s.discharge} label="discharge" />
      <text x={160} y={196} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: TEXT.teal }}>
        {degF(SUCTION_F)}
      </text>
      <text x={470} y={196} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: TEXT.teal }}>
        {degF(c.dischargeF)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stations along Northline.

const NL = PIPELINE['calder-metro'];
const NL_LINE: StationLine = stationLineOf(NL);
/** The pressure Northline promises Metro, psia. */
const MIN_DELIVERY = psia(NL.minDeliveryPsig);
export const LINE_DEFAULTS = { stations: NL.stations, flow: 1800 };
/** The challenge: Metro asks for 2.0 Bcf/d. */
export const TARGET_FLOW = 2000;
const MAX_STATIONS = 6;

function lineAt(stations: number) {
  return { ...NL_LINE, stations };
}

/** Whether Northline with this many stations delivers `flow` at or above its promised pressure. */
export function delivers(stations: number, flow: number): boolean {
  const r = stationLine(lineAt(stations), flow);
  return r.feasible && r.deliveryPsia >= MIN_DELIVERY - 1e-9;
}

/** The fewest evenly spaced stations that carry `flow` at or above 765 psig at Metro. */
export function fewestStations(flow: number): number {
  for (let n = 1; n <= MAX_STATIONS; n++) if (delivers(n, flow)) return n;
  return Infinity;
}

export const FEWEST_FOR_TARGET = fewestStations(TARGET_FLOW);

/** The challenge: at least 2.0 Bcf/d delivered at 765 psig or more, with the fewest stations that can do it. */
export function expansionSolved(s: typeof LINE_DEFAULTS): boolean {
  return s.flow >= TARGET_FLOW && s.stations === FEWEST_FOR_TARGET && delivers(s.stations, s.flow);
}

/** Capacity (MMcf/d) of Northline with n stations. */
export function capacityWith(n: number): number {
  return lineCapacity(lineAt(n), MIN_DELIVERY);
}

/** The sawtooth of pressures along the line, in psig, and where the pressure runs out if the line can't carry the flow. */
function lineProfile(stations: number, flow: number) {
  const line = lineAt(stations);
  const res = stationLine(line, flow);
  const segLen = NL.lengthMi / stations;
  const seg = { ...line.pipe, lengthMi: segLen };
  const xs: number[] = [0];
  const ys: number[] = [psig(line.receiptPsia)];
  let gone: { from: number; at: number } | null = null;
  res.stations.forEach((st) => {
    const x0 = st.mile;
    const pd = st.discharge;
    xs.push(x0);
    ys.push(psig(pd));
    const p2 = outletPressure(seg, pd, flow);
    if (Number.isFinite(p2)) {
      pressureProfile(pd, p2, 24).forEach((p, j) => {
        if (j > 0) {
          xs.push(x0 + (segLen * j) / 24);
          ys.push(psig(p));
        }
      });
    } else {
      // The flow needs more than this segment's pressure: draw the fall until it reaches nothing.
      const pin = inletPressure(seg, STD_PSIA, flow);
      const k = (pin * pin - STD_PSIA * STD_PSIA) / segLen;
      const dist = (pd * pd) / k;
      for (let j = 1; j <= 24; j++) {
        const x = (dist * j) / 24;
        xs.push(x0 + x);
        ys.push(Math.max(0, psig(Math.sqrt(Math.max(0, pd * pd - k * x)))));
      }
      gone = { from: x0, at: x0 + dist };
    }
  });
  return { res, xs, ys, gone: gone as { from: number; at: number } | null, segLen };
}

// Numbers quoted in the prose.
const BASE_LINE = stationLine(NL_LINE, 1800);
const CAPS = Array.from({ length: MAX_STATIONS }, (_, i) => capacityWith(i + 1));
const FUEL_4 = stationLine(lineAt(4), 1800);
const FUEL_6 = stationLine(lineAt(6), 1800);
const RATIO_A = compress(1800, psia(300), psia(615));
const RATIO_B = compress(1800, psia(700), psia(1415));
const STATION0 = compressAt(STATION_DEFAULTS);
const STATION0_DOUBLE = compress(3600, psia(765), psia(1440));

export default function Lesson() {
  const s1 = useScenario('station', STATION_DEFAULTS);
  const st = s1.state;
  const c = compressAt(st);
  const r = c.ratio;
  const z1 = zFactor(psia(st.suction), SUCTION_F);
  const z2 = zFactor(psia(st.discharge), c.dischargeF);
  const fuelCost = c.fuelMMBtuPerDay * FUEL_PRICE;

  const s2 = useScenario('line', LINE_DEFAULTS);
  const ln = s2.state;
  const prof = useMemo(() => lineProfile(ln.stations, ln.flow), [ln.stations, ln.flow]);
  const res = prof.res;
  const ok = res.feasible && res.deliveryPsia >= MIN_DELIVERY - 1e-9;
  const cap = CAPS[ln.stations - 1];
  const solved = expansionSolved(ln);
  const deliveryPsig = psig(res.deliveryPsia);

  let lineCaption: string;
  if (!res.feasible && prof.gone)
    lineCaption = `At ${fmt(ln.flow)} MMcf/d, friction would use up all the pressure about ${fmt(Math.round((prof.gone.at - prof.gone.from) / 5) * 5)} miles past the station at mile ${fmt(prof.gone.from)}: with ${ln.stations} station${ln.stations > 1 ? 's' : ''}, Northline can’t carry that much.`;
  else if (!ok)
    lineCaption = `${fmt(ln.flow)} MMcf/d reaches Metro at ${psigFmt(deliveryPsig)}, below the ${fmt(NL.minDeliveryPsig)} psig Northline promises. With ${ln.stations} station${ln.stations > 1 ? 's' : ''}, the most it can deliver at that pressure is ${mmcfd(cap)}.`;
  else
    lineCaption = `${fmt(ln.flow)} MMcf/d reaches Metro at ${psigFmt(deliveryPsig)}. The ${ln.stations} station${ln.stations > 1 ? 's' : ''} need ${fmt(res.totalHp)} horsepower and burn ${pct(res.fuelShare, 2)} of the gas.`;

  const status =
    ln.flow < TARGET_FLOW
      ? `Northline is carrying ${mmcfd(ln.flow)}. Metro wants ${mmcfd(TARGET_FLOW)}.`
      : !ok
        ? `With ${ln.stations} station${ln.stations > 1 ? 's' : ''}, ${mmcfd(ln.flow)} ${res.feasible ? `arrives at only ${psigFmt(deliveryPsig)}` : 'can’t get through at all'}.`
        : `With ${ln.stations} stations, ${mmcfd(ln.flow)} arrives at ${psigFmt(deliveryPsig)}. Could fewer stations do it?`;

  const unreached = Array.from({ length: ln.stations - res.stations.length }, (_, i) => (res.stations.length + i) * prof.segLen);

  return (
    <LessonPage id="gas/1.4">
      <P>
        The previous lesson ended with Northline’s gas losing <K tone="blue">pressure</K> every mile of the way to Metro. One push from 1,440 psig at Calder Hub, falling to
        the 765 psig Northline promises Metro, carries about {mmcfd(CAPS[0])} through its 240 miles. The pipeline sells {fmt(NL.capacityBcfd, 1)} Bcf/d, about{' '}
        {fmt((NL.capacityBcfd * 1000) / CAPS[0], 1)} times that, because it doesn’t ask one push to last the whole way. Three compressor stations along it take the gas in at low pressure, squeeze it, and send it on at
        high pressure again.
      </P>
      <P>
        Squeezing a gas takes work, and most compressor stations on long-distance lines get it from the gas itself: an engine or gas turbine burns a little of the stream
        to drive the compressor. So every cubic foot that reaches Metro has paid, in part, for its own trip. How much depends on how hard the gas is squeezed, how much of it
        there is, and how much of the work turns into heat.
      </P>
      <P>
        In the next demonstration, the station sits at Calder Hub, where Northline begins. Gas arrives from the hub at the <K tone="blue">suction pressure</K>, the
        compressor raises it to the <K tone="blue">discharge pressure</K>, and the turbine that drives it burns <K c="power">fuel</K> tapped from the suction side. The
        dots move at the gas’s speed. Change the two pressures and the <K tone="orange">throughput</K>:
      </P>

      <Figure name="Compressor Simulator" scenario={s1}>
        <StationDiagram s={st} c={c} />
        <Readouts
          items={[
            { label: 'compression ratio', value: r.toFixed(2), tone: 'blue' },
            { label: 'compression power', value: `${fmt(c.hp)} hp`, tone: 'red' },
            { label: 'discharge temperature', value: degF(c.dischargeF), tone: 'teal' },
            { label: 'fuel burned', value: `${fmt(c.fuelMMcfd, 1)} MMcf/d · ${pct(c.fuelShare, 2)}`, tone: 'red' },
            { label: `fuel bill a day at $${FUEL_PRICE.toFixed(2)}/MMBtu`, value: usd(fuelCost), tone: 'green' },
          ]}
        />
        <Slider
          label="Suction pressure"
          tone="blue"
          value={st.suction}
          min={100}
          max={1400}
          step={5}
          onChange={(v) => s1.set((s) => ({ suction: v, discharge: Math.max(s.discharge, v) }))}
          display={psigFmt(st.suction)}
        />
        <Slider
          label="Discharge pressure"
          tone="blue"
          value={st.discharge}
          min={100}
          max={NL.maopPsig}
          step={5}
          onChange={(v) => s1.set((s) => ({ discharge: v, suction: Math.min(s.suction, v) }))}
          display={psigFmt(st.discharge)}
        />
        <Slider label="Throughput" tone="orange" value={st.flow} min={100} max={3600} step={100} onChange={(v) => s1.set({ flow: v })} display={mmcfd(st.flow)} />
        <Eq label={`Compression power equals 0.0859 times throughput times k over k minus 1 times Z times T1 times the quantity r to the 0.219 minus 1, over the efficiency: ${fmt(c.hp)} horsepower`}>
          <K c="power">hp</K>
          <Op>=</Op>
          <span>{HP_COEF.toFixed(4)}</span>
          <Op>×</Op>
          <K tone="orange">{fmt(st.flow)}</K>
          <Op>×</Op>
          <span>{fmt(K_GAS / (K_GAS - 1), 2)}</span>
          <Op>×</Op>
          <span>{fmt((z1 + z2) / 2, 3)}</span>
          <Op>×</Op>
          <K tone="teal">{fmt(rankine(SUCTION_F), 1)}</K>
          <Op>×</Op>
          <Frac
            top={
              <>
                <K tone="blue">{r.toFixed(3)}</K>
                <Sup>{EXP.toFixed(3)}</Sup> − 1
              </>
            }
            bottom={COMPRESSOR_EFFICIENCY.toFixed(2)}
          />
          <Op>=</Op>
          <K c="power">{fmt(c.hp)}</K>
        </Eq>
        <Caption>
          Squeezing {mmcfd(st.flow)} from {psigFmt(st.suction)} to {psigFmt(st.discharge)}, a ratio of {r.toFixed(2)}, takes {fmt(c.hp)} horsepower and heats the gas
          from {degF(SUCTION_F)} to {degF(c.dischargeF)}.
        </Caption>
      </Figure>

      <P>
        At the starting settings the station takes {mmcfd(STATION_DEFAULTS.flow)} in at 765 psig and sends it out at 1,440 psig, the most Northline’s steel is allowed to
        hold — its <b>maximum allowable operating pressure</b>, or MAOP. That takes about {fmt(Math.round(STATION0.hp / 1000) * 1000)} horsepower, or{' '}
        {fmt(STATION0.mw)} megawatts. The turbine burns {fmt(STATION0.fuelMMcfd, 1)} MMcf/d to supply it, {pct(STATION0.fuelShare, 2)} of the gas passing through: at an
        illustrative ${FUEL_PRICE.toFixed(2)} per MMBtu, about {usd(Math.round((STATION0.fuelMMBtuPerDay * FUEL_PRICE) / 1000) * 1000)} of fuel a day.
      </P>
      <P>
        Double the throughput to {mmcfd(3600)} and the power and the fuel double with it, to {fmt(STATION0_DOUBLE.hp)} horsepower and{' '}
        {fmt(STATION0_DOUBLE.fuelMMcfd, 1)} MMcf/d — but the fuel is still {pct(STATION0_DOUBLE.fuelShare, 2)} of the flow, since every cubic foot gets the same
        squeeze. What changes that share is the <K tone="blue">compression ratio</K>, r: the discharge pressure divided by the suction pressure, both measured from
        vacuum, in psia. Try two squeezes that each double the absolute pressure: from 300 to 615 psig, and from 700 to 1,415 psig. The second raises the pressure by more
        than twice as many psi, yet it takes about the same power — {fmt(RATIO_A.hp)} horsepower for the first, {fmt(RATIO_B.hp)} for the second, which is a little
        cheaper because the gas is less ideal at high pressure. Each halving of a gas’s volume costs about the same work whatever pressure it starts from, so it’s the ratio
        that sets the bill.
      </P>
      <P>
        The equation in the demonstration adds up that work. Its {HP_COEF.toFixed(4)} only converts units, turning million cubic feet a day and foot-pounds of work into
        horsepower. The rest is the flow, the gas’s compressibility Z from <a href={lessonHref('gas/1.2')}>Lesson 1.2</a>, its absolute temperature T<Sub>1</Sub> in
        degrees Rankine (degrees Fahrenheit plus 459.67), and the ratio raised to the power (k − 1)/k, where k = {K_GAS} is the ratio of natural gas’s specific heats at constant pressure and at constant volume.
        The compressor is {pct(COMPRESSOR_EFFICIENCY)} efficient, so the work is divided by {COMPRESSOR_EFFICIENCY.toFixed(2)}.
      </P>

      <H2>Where the energy goes</H2>
      <P>
        Compressing a gas heats it. The work done on the molecules speeds them up, and faster molecules are hotter gas. A perfect compressor, one that wasted nothing,
        would multiply the gas’s absolute temperature by r<Sup>(k−1)/k</Sup>: at the starting settings, from {degF(SUCTION_F)} to{' '}
        {degF(STATION0.isentropicDischargeF)}. A real compressor wastes some of its work in turbulence and friction, and the waste ends up as heat in the gas too. With an
        efficiency η, the gas leaves at
      </P>
      <Eq label={`Discharge temperature: T2 equals T1 times 1 plus the quantity r to the 0.219 minus 1 over the efficiency, ${fmt(c.dischargeF)} degrees Fahrenheit`}>
        <K tone="teal">
          T<Sub>2</Sub>
        </K>
        <Op>=</Op>
        <K tone="teal">
          T<Sub>1</Sub>
        </K>
        <Op>×</Op>
        <span>[1 +</span>
        <Frac
          top={
            <>
              <K tone="blue">r</K>
              <Sup>(k−1)/k</Sup> − 1
            </>
          }
          bottom="η"
        />
        <span>]</span>
        <Op>=</Op>
        <K tone="teal">{fmt(rankine(SUCTION_F), 1)} °R</K>
        <Op>×</Op>
        <span>
          [1 + ({r.toFixed(3)}
          <Sup>{EXP.toFixed(3)}</Sup> − 1) / {COMPRESSOR_EFFICIENCY.toFixed(2)}]
        </span>
        <Op>=</Op>
        <K tone="teal">{degF(c.dischargeF)}</K>
      </Eq>
      <P>
        so the {pct(COMPRESSOR_EFFICIENCY)}-efficient compressor in <FigRef to="Compressor Simulator">the first demonstration</FigRef> starts by sending the gas out at{' '}
        {degF(STATION0.dischargeF)}. Squeeze harder and it climbs quickly: from 300 to 1,440 psig, the gas leaves at about {degF(compress(1800, psia(300), psia(1440)).dischargeF)}.
        Many stations cool the gas in banks of fan-blown heat exchangers before it goes back into the pipe. Hot gas takes up more room, so it flows less easily — temperature
        sits in the denominator of the flow equation of <a href={lessonHref('gas/1.3')}>Lesson 1.3</a> — and a pipe’s protective coating is rated only up to a certain
        temperature.
      </P>
      <P>
        The turbine loses more. It burns {fmt(DRIVER_HEAT_RATE)} Btu of gas for every horsepower-hour of work it delivers to the compressor’s shaft, about{' '}
        {pct(2544.43 / DRIVER_HEAT_RATE)} efficient, and the rest leaves up its exhaust stack as heat. Of the fuel’s energy, then, only about{' '}
        {pct((2544.43 / DRIVER_HEAT_RATE) * COMPRESSOR_EFFICIENCY)} — the turbine’s efficiency times the compressor’s — becomes the work a perfect compressor would have
        needed.
      </P>

      <H2>Stations along a line</H2>
      <P>
        A long pipeline is a chain of these. Friction lowers the pressure between stations, as in Lesson 1.3, and each station raises it again. In the next demonstration,
        Northline’s 240 miles have evenly spaced stations, the first at Calder Hub, where gas arrives at 765 psig. Each station discharges at the 1,440 psig MAOP, and the
        line must deliver at least 765 psig to Metro. Change the number of stations and the throughput:
      </P>

      <Figure name="Compressor Simulator · along a pipeline" scenario={s2}>
        <XYChart
          xDomain={[0, NL.lengthMi]}
          yDomain={[0, 1600]}
          xTicks={[0, 40, 80, 120, 160, 200, 240]}
          yTicks={[0, 400, 800, 1200, 1600]}
          yFormat={(v) => fmt(v)}
          yLabel="Pressure, psig"
          xLabel="miles from Calder Hub"
          height={250}
          ariaLabel={`Pressure along Northline with ${ln.stations} station${ln.stations > 1 ? 's' : ''} carrying ${fmt(ln.flow)} MMcf/d. ${
            res.feasible ? `It reaches Metro at ${fmt(deliveryPsig)} psig.` : 'The gas runs out of pressure before Metro.'
          } Capacity at 765 psig delivery: ${fmt(cap)} MMcf/d.`}
          series={[
            { xs: prof.xs, ys: prof.ys, color: GRAPHIC.blue, kind: 'area', opacity: 0.12 },
            { xs: prof.xs, ys: prof.ys, color: GRAPHIC.blue, width: 2.5 },
          ]}
          hLines={[
            { at: NL.maopPsig, color: GRAPHIC.red, dash: '5 4', label: `MAOP ${fmt(NL.maopPsig)} psig` },
            { at: NL.minDeliveryPsig, color: '#777', dash: '5 4', label: `promised to Metro: ${NL.minDeliveryPsig} psig`, labelAt: 'start' },
          ]}
          markers={[
            ...res.stations.map((x) => ({ x: x.mile, y: psig(x.discharge), color: GRAPHIC.red, r: 5 })),
            ...unreached.map((m) => ({ x: m, y: 0, color: '#9a9a9a', r: 5, ring: true })),
            ...(res.feasible
              ? [
                  {
                    x: NL.lengthMi,
                    y: deliveryPsig,
                    color: ok ? GRAPHIC.blue : GRAPHIC.red,
                    r: 6,
                    label: `Metro · ${fmt(deliveryPsig)} psig`,
                    labelPos: (deliveryPsig > 1150 ? 'below' : 'above') as 'below' | 'above',
                  },
                ]
              : []),
          ]}
        />
        <Readouts
          items={[
            { label: `capacity with ${ln.stations} station${ln.stations > 1 ? 's' : ''}`, value: mmcfd(cap), tone: 'orange' },
            { label: 'delivered at Metro', value: res.feasible ? psigFmt(deliveryPsig) : 'nothing', tone: ok ? 'blue' : 'red' },
            { label: 'compression power', value: res.feasible ? `${fmt(res.totalHp)} hp` : '—', tone: 'red' },
            { label: 'fuel burned', value: res.feasible ? `${fmt(res.fuelMMcfd, 1)} MMcf/d · ${pct(res.fuelShare, 2)}` : '—', tone: 'red' },
          ]}
        />
        <Slider label="Compressor stations" value={ln.stations} min={1} max={MAX_STATIONS} onChange={(v) => s2.set({ stations: v })} display={`${ln.stations}, every ${fmt(prof.segLen)} miles`} />
        <Slider label="Throughput" tone="orange" value={ln.flow} min={500} max={2600} step={50} onChange={(v) => s2.set({ flow: v })} display={mmcfd(ln.flow)} />
        {res.stations.length > 0 && (
          <DataTable
            caption="Each station's suction pressure, compression ratio and power"
            rows={res.stations.map((x, i) => ({ ...x, i }))}
            rowKey={(x) => x.i}
            columns={[
              { label: 'Station', cell: (x) => (x.i === 0 ? '1, at Calder Hub' : String(x.i + 1)) },
              { label: 'Mile', cell: (x) => fmt(x.mile), align: 'right' },
              { label: 'Suction', cell: (x) => psigFmt(psig(x.suction)), align: 'right' },
              { label: 'Ratio', cell: (x) => x.compression.ratio.toFixed(2), align: 'right' },
              { label: 'Power', cell: (x) => `${fmt(x.compression.hp)} hp`, align: 'right' },
            ]}
          />
        )}
        <Caption>{lineCaption}</Caption>
      </Figure>

      <P>
        Each station draws a tooth of the saw: a jump at the station, then the curved fall of the previous lesson. With three stations every 80 miles, Northline carries
        1,800 MMcf/d and reaches Metro at {psigFmt(psig(BASE_LINE.deliveryPsia))}, just above its promise. The stations need {fmt(BASE_LINE.totalHp)} horsepower between
        them, about {fmt(BASE_LINE.totalHp * 0.0007457)} megawatts, and burn {fmt(BASE_LINE.fuelMMcfd, 1)} MMcf/d, or {pct(BASE_LINE.fuelShare, 2)} of the gas. At an
        illustrative ${FUEL_PRICE.toFixed(2)} per MMBtu, that fuel adds about {fmt(BASE_LINE.fuelShare * FUEL_PRICE * 100, 1)} cents to the cost of every MMBtu Northline
        carries. Pipelines usually collect it in kind: a shipper hands over a little more gas than it takes out at the far end, and the pipeline keeps the
        difference as fuel.
      </P>
      <P>
        Add stations and the capacity grows: {CAPS.map((v) => fmt(v)).join(', ')} MMcf/d for one to six of them. Each segment gets shorter, and Lesson 1.3 showed that
        throughput grows as one over the square root of length, so the capacity grows about as the square root of the number of stations. The {fmt(CAPS[2])} MMcf/d of
        three stations is where Northline’s {fmt(NL.capacityBcfd, 1)} Bcf/d comes from: a pipeline sells a little less than its hydraulic limit.
      </P>
      <P>
        More stations also burn less fuel for the same flow: carrying 1,800 MMcf/d, four stations burn {pct(FUEL_4.fuelShare, 2)} of it and six{' '}
        {pct(FUEL_6.fuelShare, 2)}. Shorter segments let the pressure fall less before it’s raised again, so the gas spends more of its trip at high pressure — and a high
        pressure loses less to friction. In the flow equation, a given flow fixes P<Sub>1</Sub>² − P<Sub>2</Sub>², which is (P<Sub>1</Sub> − P<Sub>2</Sub>) × (P
        <Sub>1</Sub> + P<Sub>2</Sub>), so the higher the pressures, the smaller the drop between them, and the smaller the ratio each station has to restore. The first
        station’s work is set by the hub: gas reaches it at 765 psig however many stations follow. In our model every station discharges at 1,440 psig whatever the flow; at
        lower flows a real operator would run fewer compressors and let the pressures settle lower, saving fuel. A pipeline’s owners trade capital for fuel: stations
        cost money to build, and every one saves gas for as long as the line runs.
      </P>

      <Challenge
        id="a"
        question="Metro’s utility asks Northline to deliver 2.0 Bcf/d, still at no less than 765 psig. What’s the fewest compressor stations that can do it?"
        solved={solved}
        status={status}
        success={`Solved. ${FEWEST_FOR_TARGET} stations, every ${fmt(NL.lengthMi / FEWEST_FOR_TARGET)} miles. Three top out at ${mmcfd(CAPS[2])}; with ${FEWEST_FOR_TARGET}, capacity rises to ${mmcfd(
          CAPS[FEWEST_FOR_TARGET - 1],
        )}. Carrying 2,000 MMcf/d, they need ${fmt(stationLine(lineAt(FEWEST_FOR_TARGET), TARGET_FLOW).totalHp)} horsepower and burn ${pct(
          stationLine(lineAt(FEWEST_FOR_TARGET), TARGET_FLOW).fuelShare,
          2,
        )} of the gas, against ${pct(FUEL_4.fuelShare, 2)} for 1,800 MMcf/d through the same four: pushing more gas through the same pipe costs more per cubic foot, because the gas moves faster and loses more of its pressure to friction.`}
      />

      <P>
        Adding compression is a common way to expand an existing pipeline, because the steel is already in the ground. It runs out, though: as <FigRef to="Compressor Simulator · along a pipeline">the second demonstration</FigRef> shows, each extra
        station adds less capacity than the one before, and beyond a point the cheaper path is a second pipe laid beside the first.
      </P>
      <P>
        Everything in this lesson was counted in cubic feet: the gas carried, the gas burned. But Metro’s buyers don’t want cubic feet. They want the heat the gas gives
        when it burns, and a cubic foot at 1,440 psig holds far more gas than one at 765 psig, or at a kitchen stove. The <a href={lessonHref('gas/1.5')}>next lesson</a>{' '}
        follows the gas through the meter where Northline hands it to Metro, and turns volumes into energy.
      </P>
    </LessonPage>
  );
}
