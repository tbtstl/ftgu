import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Controls,
  Eq,
  Figure,
  FUEL,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  TimeChart,
  Tn,
  clamp,
  fmt,
  hour,
  linePath,
  mw,
  mwh,
  pct,
  scale,
  signed,
  useScenario,
} from '../../framework';
import { energyAbove, lowestPeak, shaveSchedule, withBattery } from '../../engines/ops/peakShave';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';
import { STANDARD_FLEET } from '../../model/fleet';

const WIND_MW = STANDARD_FLEET.find((g) => g.id === 'wind')!.capacity;
const SOLAR_MW = STANDARD_FLEET.find((g) => g.id === 'solar')!.capacity;
/** The reference day's net load: demand minus Ridge wind and Valley solar at today's sizes. */
const NET = SYSTEM_DEMAND.map((d, h) => d - WIND_MW * WIND_CF[h] - SOLAR_MW * SOLAR_CF[h]);
const PEAK = Math.max(...NET);
const PEAK_AT = NET.indexOf(PEAK);
const BAT = FUEL.battery;
const X0 = 52;
const X1 = 628;
const SLOT = (X1 - X0) / 24;
const xc = (h: number) => X0 + (h + 0.5) * SLOT;
const xb = (h: number) => X0 + h * SLOT;

const DEFAULT_SCHEDULE: number[] = Array.from({ length: 24 }, (_, h) => (h >= 1 && h <= 3 ? -100 : h === 16 || h === 17 ? 100 : 0));
const CHALLENGE = { power: 100, energy: 200, target: 1215 };

// ---------------------------------------------------------------------------
// The schedule editor: drag bars up to discharge, down to charge.

function ScheduleEditor({ requested, actual, power, onChange }: { requested: number[]; actual: number[]; power: number; onChange: (s: number[]) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const lim = Math.max(25, power);
  const y = scale(-lim, lim, 176, 24);
  const setAt = (e: PointerEvent<SVGSVGElement>) => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    const h = Math.floor((p.x - X0) / SLOT);
    if (h < 0 || h > 23) return;
    let v = lim * ((100 - p.y) / 76);
    v = clamp(Math.round(v / 10) * 10, -power, power);
    if (Math.abs(v) < 10) v = 0;
    if (requested[h] !== v) {
      const next = [...requested];
      next[h] = v;
      onChange(next);
    }
  };
  const key = (h: number) => (e: KeyboardEvent) => {
    const step = e.key === 'PageUp' || e.key === 'PageDown' ? 50 : 10;
    let v = requested[h];
    if (e.key === 'ArrowUp' || e.key === 'PageUp') v += step;
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') v -= step;
    else if (e.key === 'Home' || e.key === 'Delete' || e.key === 'Backspace') v = 0;
    else return;
    e.preventDefault();
    const next = [...requested];
    next[h] = clamp(v, -power, power);
    onChange(next);
  };
  return (
    <svg
      ref={svg}
      className="chart"
      viewBox="0 0 640 196"
      role="group"
      aria-label="Battery schedule by hour. Drag a bar up to discharge, down to charge; or focus a bar and use the arrow keys."
      style={{ touchAction: 'none', userSelect: 'none', cursor: 'ns-resize' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setAt(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 0) setAt(e);
      }}
    >
      <text className="ax" x={X0} y={12}>
        Battery: ↑ discharging, ↓ charging (MW)
      </text>
      <GridY y={y} ticks={[-power, 0, power]} x0={X0} x1={X1} format={(v) => signed(v)} baseline={0} />
      {requested.map((v, h) => {
        const a = actual[h] ?? 0;
        const rv = clamp(v, -power, power);
        return (
          <g key={h}>
            <rect
              x={xb(h)}
              y={24}
              width={SLOT}
              height={152}
              fill="transparent"
              tabIndex={0}
              role="slider"
              aria-label={`Battery at ${hour(h)}`}
              aria-valuemin={-power}
              aria-valuemax={power}
              aria-valuenow={rv}
              aria-valuetext={rv === 0 ? 'idle' : rv > 0 ? `discharging ${rv} MW` : `charging ${-rv} MW`}
              onKeyDown={key(h)}
            />
            {rv !== 0 && (
              <rect x={xc(h) - SLOT * 0.36} y={Math.min(y(0), y(rv))} width={SLOT * 0.72} height={Math.abs(y(rv) - y(0))} fill="none" stroke={BAT} strokeWidth={1.5} strokeDasharray="3 2" pointerEvents="none" />
            )}
            {Math.abs(a) > 0.05 && (
              <rect x={xc(h) - SLOT * 0.36} y={Math.min(y(0), y(a))} width={SLOT * 0.72} height={Math.abs(y(a) - y(0))} fill={a > 0 ? BAT : GRAPHIC.blue} opacity={0.85} pointerEvents="none" />
            )}
          </g>
        );
      })}
      <line className="base" x1={X0} x2={X1} y1={176} y2={176} />
      {[0, 6, 12, 18, 24].map((hh) => (
        <text key={hh} className="ax ax-m" x={xb(hh)} y={192}>
          {hour(hh)}
        </text>
      ))}
    </svg>
  );
}

function SocChart({ soc, energy }: { soc: number[]; energy: number }) {
  const y = scale(0, Math.max(25, energy), 110, 22);
  const xs = soc.map((_, k) => xb(k));
  return (
    <svg className="chart" viewBox="0 0 640 130" role="img" aria-label={`State of charge over the day, out of ${energy} MWh; ends at ${Math.round(soc[soc.length - 1])} MWh.`}>
      <text className="ax" x={X0} y={12}>
        State of charge, MWh
      </text>
      <GridY y={y} ticks={[0, energy]} x0={X0} x1={X1} format={(v) => fmt(v)} baseline={0} />
      <path d={`${linePath(xs, soc.map(y))} L${X1} ${y(0)} L${X0} ${y(0)} Z`} fill={GRAPHIC.gold} opacity={0.18} />
      <path d={linePath(xs, soc.map(y))} fill="none" stroke={GRAPHIC.gold} strokeWidth={2.5} strokeLinejoin="round" />
      {[0, 6, 12, 18, 24].map((hh) => (
        <text key={hh} className="ax ax-m" x={xb(hh)} y={126}>
          {hour(hh)}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const sc = useScenario('battery', { power: 100, energy: 200, eff: 85, schedule: DEFAULT_SCHEDULE });
  const { power, energy, eff, schedule } = sc.state;
  const battery = { id: 'bat', powerMW: power, energyMWh: energy, efficiency: eff / 100, soc0: 0 };
  const run = withBattery(NET, battery, schedule);
  const peakAt = run.after.indexOf(run.peakAfter);
  const solved = power <= CHALLENGE.power && energy <= CHALLENGE.energy && run.peakAfter <= CHALLENGE.target + 1e-6;

  const s2 = useScenario('power-energy', { power: 100, energy: 200 });
  const b2 = { powerMW: s2.state.power, energyMWh: s2.state.energy, efficiency: 0.85 };
  const cap = lowestPeak(NET, b2);
  const best = withBattery(NET, { id: 'b2', ...b2, soc0: 0 }, shaveSchedule(NET, b2, cap));
  const powerBound = b2.powerMW > 0 && cap <= PEAK - b2.powerMW + 0.5;
  const frontier = useMemo(() => {
    const es = Array.from({ length: 33 }, (_, k) => k * 50);
    return [50, 100, 200, 400].map((p) => ({ p, ys: es.map((e) => lowestPeak(NET, { powerMW: p, energyMWh: e, efficiency: 0.85 })) }));
  }, []);
  const xE = scale(0, 1600, X0, X1);
  const yP = scale(900, 1300, 196, 26);

  const cut = (target: number) => energyAbove(NET, target).mwh;
  const etaOne = Math.sqrt(0.85);

  let msg: string;
  if (run.peakAfter >= PEAK - 0.5) {
    const emptyAt = run.soc.findIndex((v, k) => k > 0 && v <= 0.5 && run.soc[k - 1] > 0.5);
    msg =
      emptyAt > 0 && emptyAt - 1 < PEAK_AT
        ? `The battery is empty by ${hour(emptyAt)}, before the ${hour(PEAK_AT)} peak, so the peak is untouched at ${mw(PEAK)}.`
        : `The peak at ${hour(PEAK_AT)} is untouched at ${mw(PEAK)}.`;
  } else msg = `The highest net load is now ${mw(run.peakAfter)} at ${hour(peakAt)}, ${mw(PEAK - run.peakAfter)} below the original peak.`;

  return (
    <LessonPage id="3.4">
      <P>
        The duck curve from the last lesson has a deep belly in the middle of the day and a steep neck in the evening. If only some of that midday energy could be saved for a
        few hours, both problems would shrink at once. That’s what a battery does. It’s the first plant in this chapter that is neither a source of energy nor a customer, but a
        bit of both at different times.
      </P>
      <P>
        Below is the region’s net load on the reference day — demand minus Ridge wind and Valley solar — with a battery connected to the grid. The battery starts the day empty.
        Drag the bars in the middle chart up to discharge in an hour, or down to charge. The dashed outlines are what you ask for; the solid bars are what the battery can
        actually do, given how full it is:
      </P>

      <Figure
        name="Battery Simulator"
        scenario={sc}
        actions={<Button onClick={() => sc.set({ schedule: Array<number>(24).fill(0) })}>Clear schedule</Button>}
      >
        <TimeChart
          ariaLabel={`Net load before and after the battery. Peak before ${Math.round(PEAK)} MW, after ${Math.round(run.peakAfter)} MW.`}
          series={[
            { values: NET, color: '#8a8a8a', width: 2, dash: '6 5' },
            { values: run.after, color: '#333', width: 2.5 },
          ]}
          refLines={[{ y: run.peakAfter, color: '#333', dash: '2 4', label: `peak ${mw(run.peakAfter)}` }]}
          yMin={200}
          yMax={1700}
          yLabel="Net load, MW"
          yFormat={(v) => fmt(v)}
          height={220}
          cursor={peakAt}
        />
        <Legend
          items={[
            { label: 'Net load without the battery', color: '#8a8a8a', kind: 'line', dashed: true },
            { label: 'With the battery', color: '#333', kind: 'line' },
            { label: 'Discharging', color: BAT },
            { label: 'Charging', color: GRAPHIC.blue },
          ]}
        />
        <ScheduleEditor requested={schedule} actual={run.mw} power={power} onChange={(next) => sc.set({ schedule: next })} />
        <SocChart soc={run.soc} energy={energy} />
        <Readouts
          items={[
            { label: 'peak net load', value: mw(run.peakAfter), tone: run.peakAfter < PEAK - 0.5 ? 'ink' : undefined },
            { label: 'energy charged', value: mwh(run.chargedMWh), tone: 'gold' },
            { label: 'energy delivered', value: mwh(run.dischargedMWh), tone: 'gold' },
            { label: 'lost as heat', value: mwh(run.lossMWh), tone: 'red' },
          ]}
        />
        <Controls columns={2}>
          <Slider label="Power rating" tone="red" value={power} min={25} max={300} step={25} onChange={(v) => sc.set({ power: v })} display={mw(power)} />
          <Slider label="Energy capacity" tone="gold" value={energy} min={25} max={1200} step={25} onChange={(v) => sc.set({ energy: v })} display={mwh(energy)} />
          <Slider label="Round-trip efficiency" value={eff} min={60} max={100} step={1} onChange={(v) => sc.set({ eff: v })} display={`${eff}%`} />
        </Controls>
        <Caption>{msg}</Caption>
      </Figure>

      <P>
        The starting schedule charges overnight and discharges at 16:00, which seems sensible until you look at the state of charge: the battery is empty by 18:00, an hour
        before the {mw(PEAK)} peak at {hour(PEAK_AT)}, so the peak doesn’t move. Timing is most of the job. Drag the discharge later, into the hours the peak actually
        happens.
      </P>
      <P>
        Every battery has two ratings, and it’s worth keeping them apart. The <K c="power">power rating</K>, in megawatts, is how fast it can charge or discharge. The{' '}
        <K c="energy">energy capacity</K>, in megawatt-hours, is how much it can hold. Their ratio is the battery’s <b>duration</b>: this one, at {fmt(power)} MW and{' '}
        {fmt(energy)} MWh, can discharge at full power for {fmt(energy / power, 1)} hours. Many of the large batteries built for the grid in recent years are about four hours long.
      </P>
      <P>
        The two ratings come from different parts of the plant. Power is set mostly by the inverters and the grid connection, energy by the number of battery cells, so a
        developer can choose them almost independently. Operators also tend to avoid running lithium-ion cells completely flat or completely full every day, because it ages
        them faster; our model lets the battery use its whole capacity.
      </P>
      <P>
        Notice, too, that the battery gives back less than it takes. Charging and discharging both lose a little energy as heat, and the share that survives the round trip is the{' '}
        <b>round-trip efficiency</b>: around 85 percent for a typical lithium-ion plant, and the starting value of the slider. Our model splits the loss evenly between the two
        directions:
      </P>
      <Eq label="Round-trip efficiency">
        <span>delivered</span>
        <Op>=</Op>
        <span>charged</span>
        <Op>×</Op>
        <Tn tone="gold">{fmt(Math.sqrt(eff / 100) * 100, 1)}%</Tn>
        <Op>×</Op>
        <Tn tone="gold">{fmt(Math.sqrt(eff / 100) * 100, 1)}%</Tn>
        <Op>=</Op>
        <span>charged</span>
        <Op>×</Op>
        <Tn tone="gold">{eff}%</Tn>
      </Eq>
      <P>
        So a battery is a time-shifter, not a source. Over a day it always consumes more than it delivers, and if it ends the day emptier than it started, it has only borrowed
        energy that something else will have to put back. What it changes is when the energy is used — and on a grid that must balance every instant, when is everything.
      </P>
      <P>
        That cuts both ways. Charging is demand like any other: drag a charging bar into the evening and the peak gets worse, not better. The right hours to charge are the ones
        with the most room to spare, which on this day are the small hours, when net load bottoms out at {mw(Math.min(...NET))}. On a grid with much more solar, like the
        duck of the last lesson, they would be the middle of the day instead.
      </P>

      <Challenge
        id="a"
        question={`With a battery no larger than ${CHALLENGE.power} MW and ${CHALLENGE.energy} MWh, bring the evening peak of net load down to ${fmt(CHALLENGE.target)} MW or less.`}
        solved={solved}
        status={
          power > CHALLENGE.power || energy > CHALLENGE.energy
            ? `The battery is ${fmt(power)} MW and ${fmt(energy)} MWh. Make it no larger than ${CHALLENGE.power} MW and ${CHALLENGE.energy} MWh.`
            : `The peak is ${mw(run.peakAfter)} at ${hour(peakAt)}.`
        }
        success={`Solved. Holding the evening to ${fmt(CHALLENGE.target)} MW means delivering ${mwh(cut(CHALLENGE.target))} spread across three hours, which takes ${mwh(cut(CHALLENGE.target) / etaOne)} of stored energy — and the battery has to be full before the evening starts.`}
      />

      <P>
        A good schedule has a recognizable shape. Rather than discharging flat out for a few hours and stopping, the battery fills in exactly the part of the curve that sticks
        up above the target. That’s also why its energy rating matters as much as its power: the whole area above the line has to fit in the battery.
      </P>

      <H2>Power and energy</H2>
      <P>
        How far could a battery of a given size shave the peak if it were scheduled perfectly? The answer has a neat shape. Imagine lowering a horizontal cap onto the net-load
        curve. Everything above the cap must come from the battery, so the cap can sink no lower than the peak minus the battery’s power rating — and no lower than the point where
        the energy above it, plus the battery’s losses, would overflow the battery. Here is the best a battery can do, charging in the night’s lowest hours:
      </P>

      <Figure name="Battery Simulator · power and energy" scenario={s2}>
        <TimeChart
          ariaLabel={`Best possible peak shaving with ${s2.state.power} MW and ${s2.state.energy} MWh: peak held to ${Math.round(cap)} MW.`}
          series={[
            { values: NET, color: '#8a8a8a', width: 2, dash: '6 5' },
            { values: best.after, color: '#333', width: 2.5 },
            { values: best.mw, color: BAT, kind: 'bar', colors: best.mw.map((v) => (v >= 0 ? BAT : GRAPHIC.blue)), opacity: 0.85 },
          ]}
          refLines={[{ y: cap, color: '#333', dash: '2 4', label: `cap ${mw(cap)}` }]}
          yMin={-400}
          yMax={1400}
          yLabel="MW"
          yFormat={(v) => fmt(v)}
          height={240}
        />
        <svg className="chart" viewBox="0 0 640 230" role="img" aria-label="Lowest achievable peak against energy capacity, for batteries of 50, 100, 200 and 400 MW.">
          <text className="ax" x={X0} y={14}>
            Lowest possible peak, MW
          </text>
          <GridY y={yP} ticks={[900, 1000, 1100, 1200, 1300]} x0={X0} x1={X1} format={(v) => fmt(v)} />
          {frontier.map((f) => (
            <g key={f.p}>
              <path
                d={linePath(
                  f.ys.map((_, k) => xE(k * 50)),
                  f.ys.map((v) => yP(Math.max(900, v))),
                )}
                fill="none"
                stroke={f.p === s2.state.power ? GRAPHIC.red : '#b5b5b5'}
                strokeWidth={f.p === s2.state.power ? 3 : 2}
                strokeLinejoin="round"
              />
              <text className="ax ax-e" x={X1 - 2} y={yP(Math.max(900, f.ys[f.ys.length - 1])) - 6}>
                {f.p} MW
              </text>
            </g>
          ))}
          <circle cx={xE(Math.min(1600, s2.state.energy))} cy={yP(Math.max(900, cap))} r={6} fill={GRAPHIC.red} stroke="#f8f8f8" strokeWidth={2} />
          <line className="base" x1={X0} x2={X1} y1={196} y2={196} />
          {[0, 400, 800, 1200, 1600].map((e) => (
            <text key={e} className="ax ax-m" x={xE(e)} y={212}>
              {fmt(e)}
            </text>
          ))}
          <text className="ax ax-e" x={X1} y={228}>
            Energy capacity, MWh
          </text>
        </svg>
        <Readouts
          items={[
            { label: 'duration', value: s2.state.power > 0 ? `${fmt(s2.state.energy / s2.state.power, 1)} h` : '—' },
            { label: 'lowest possible peak', value: mw(cap) },
            { label: 'cut from the peak', value: mw(PEAK - cap) },
            { label: 'what limits it', value: s2.state.power === 0 || s2.state.energy === 0 ? '—' : powerBound ? 'power' : 'energy', tone: powerBound ? 'red' : 'gold' },
          ]}
        />
        <Slider label="Power rating" tone="red" value={s2.state.power} min={0} max={400} step={25} onChange={(v) => s2.set({ power: v })} display={mw(s2.state.power)} />
        <Slider label="Energy capacity" tone="gold" value={s2.state.energy} min={0} max={1600} step={50} onChange={(v) => s2.set({ energy: v })} display={mwh(s2.state.energy)} />
        <Caption>
          {powerBound
            ? `The cap sits exactly ${mw(s2.state.power)} below the peak: more energy wouldn’t help, only more power would.`
            : `The battery runs out of energy before it runs out of power: it can hold the peak to ${mw(cap)}, and a larger battery would cut deeper.`}
        </Caption>
      </Figure>

      <P>
        With 100 MW, the battery can never cut more than 100 MW from the peak, however much energy it has: past about {fmt(Math.round(cut(PEAK - 100) / etaOne / 10) * 10)} MWh, the extra
        capacity sits unused. With plenty of power, it’s energy that runs out. And each extra slice off the peak costs more energy than the last, because the peak is a hump
        that widens toward its base. Cutting the first 100 MW means covering {mwh(cut(PEAK - 100))} of evening demand; the second 100 MW adds {mwh(cut(PEAK - 200) - cut(PEAK - 100))}{' '}
        more, and the third another {mwh(cut(PEAK - 300) - cut(PEAK - 200))}.
      </P>
      <P>
        That’s why a battery sized for the evening peak is usually a few hours long, and why the same battery can do several jobs: the fast frequency response of Lesson 3.2
        needs plenty of power but very little energy, while shifting the midday solar of Lesson 3.3 into the evening needs hours of storage. Whatever the job, a battery adds
        a {pct(1 - 0.85)} loss to the energy it handles, so it only makes sense when the energy is worth more at the time it comes out than when it went in. In a market, that
        difference in value is a difference in price, and Lesson 6.4 schedules a battery to earn it. In the next lesson we’ll look at a way to move energy through time that needs
        no storage at all: moving the demand itself.
      </P>
    </LessonPage>
  );
}
