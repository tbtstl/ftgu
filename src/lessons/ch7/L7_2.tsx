import { useMemo } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Checkbox,
  Eq,
  FUEL,
  Figure,
  Frac,
  GridY,
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
  TimeChart,
  fmt,
  hour,
  kw,
  lessonHref,
  linePath,
  mix,
  mw,
  mwh,
  pct,
  scale,
  useScenario,
} from '../../framework';
import { availabilityDraws, fleetDay, fleetToday, generateFleet } from '../../engines/ops/der';
import { HOME_LOAD_KW, SOLAR_CF } from '../../model/profiles';

const MAX_HOMES = 2000;
const SIZES = [10, 20, 50, 100, 200, 500, 1000, 2000];
const PEAK_HOUR = 18;
const DAYS = 400;

// The fleet: the first N homes of one seeded 2,000-home fleet, so a bigger fleet only adds homes.
const HOMES = generateFleet(MAX_HOMES, 7, 4);
const DAY = fleetDay(HOMES, HOME_LOAD_KW, SOLAR_CF);

type Draws = { totals: number[]; sorted: number[]; mean: number; nameplate: number };
const drawCache = new Map<string, Draws>();
function draws(n: number, shared: boolean): Draws {
  const key = `${n}|${shared}`;
  let d = drawCache.get(key);
  if (!d) {
    const a = availabilityDraws(HOMES, DAY, PEAK_HOUR, { count: n, sharedWeather: shared, days: DAYS });
    d = { totals: a.totals, sorted: [...a.totals].sort((x, y) => x - y), mean: a.mean, nameplate: a.nameplate };
    drawCache.set(key, d);
  }
  return d;
}
function dependable(d: Draws, confidence: number) {
  const i = Math.min(d.sorted.length - 1, Math.max(0, Math.floor((1 - confidence) * d.sorted.length)));
  return d.sorted[i];
}

// Numbers quoted in the prose (1,000 homes, the first simulated day; 95% confidence at 18:00).
const REF_TODAY = fleetToday(HOMES, DAY, 1, 1000);
const REF_1000 = draws(1000, false);
const REF_10 = draws(10, false);
const REF = {
  nameplate: REF_TODAY.nameplateKW / 1000,
  at18: REF_TODAY.totalKW[PEAK_HOUR] / 1000,
  at7: REF_TODAY.totalKW[7] / 1000,
  offline: REF_TODAY.online.filter((o) => !o).length,
  ratio1000: dependable(REF_1000, 0.95) / REF_1000.mean,
  ratio10: dependable(REF_10, 0.95) / REF_10.mean,
  dep1000: dependable(REF_1000, 0.95) / 1000,
  exp1000: REF_1000.mean / 1000,
  sharedPlateau: dependable(draws(2000, true), 0.95) / draws(2000, true).mean,
};

const OFFLINE = '#dcdcdc';
const RESERVE = '#efe9da';

export default function Lesson() {
  const a = useScenario('fleet', { n: 1000, day: 1, at: PEAK_HOUR });
  const b = useScenario('diversity', { size: 0, confidence: 0.95, shared: false });
  const { n, day, at } = a.state;

  const today = useMemo(() => fleetToday(HOMES, DAY, day, n), [n, day]);
  const h = Math.min(23, Math.max(0, at));
  const offline = today.online.filter((o) => !o).length;
  const atReserve = today.online.reduce((s, o, i) => s + (o && today.availableKW[h * n + i] < 0.05 ? 1 : 0), 0);

  const cols = n <= 10 ? 10 : n <= 100 ? 20 : 40;
  const cell = 560 / cols;
  const rows = Math.ceil(n / cols);
  const gridH = rows * cell;

  // Diversity figure.
  const size = SIZES[Math.min(SIZES.length - 1, Math.max(0, b.state.size))];
  const conf = b.state.confidence;
  const shared = b.state.shared;
  const d = draws(size, shared);
  const dep = dependable(d, conf);
  const ratio = d.mean > 0 ? dep / d.mean : 0;
  const curves = useMemo(
    () =>
      [false, true].map((sh) =>
        SIZES.map((s) => {
          const dd = draws(s, sh);
          return dd.mean > 0 ? dependable(dd, conf) / dd.mean : 0;
        }),
      ),
    [conf],
  );
  const prevRatio = b.state.size > 0 ? curves[0][b.state.size - 1] : 0;
  const solved = !shared && Math.abs(conf - 0.95) < 1e-9 && ratio >= 0.9 && prevRatio < 0.9;

  // Histogram of per-home availability.
  const X0 = 60;
  const X1 = 600;
  const xs = scale(0, 6, X0, X1);
  const bins = 60;
  const counts = Array<number>(bins).fill(0);
  for (const t of d.totals) counts[Math.min(bins - 1, Math.max(0, Math.floor((t / size / 6) * bins)))]++;
  const maxShare = Math.max(0.05, ...counts.map((c) => c / d.totals.length));
  const yTop = Math.ceil(maxShare * 20) / 20;
  const ys = scale(0, yTop, 200, 30);
  const perHome = (v: number) => v / size;

  // Curve of dependable ÷ expected against fleet size (log axis).
  const cx = scale(Math.log10(10), Math.log10(2000), 70, 590);
  const cy = scale(0.5, 1, 200, 30);

  return (
    <LessonPage id="7.2">
      <P>
        The home battery from the <a href={lessonHref('7.1')}>previous lesson</a> can deliver 5 kW. A wholesale market deals in megawatts — a thousand times more — and
        expects whatever it buys to show up. No grid operator can schedule, monitor and settle millions of individual batteries, and no household wants to bid into an
        auction. The bridge between them is an <K>aggregator</K>: a company that enrolls many homes, controls their batteries within limits the owners agree to, and offers
        the combined result to the market as if it were one resource.
      </P>
      <P>
        The next demonstration shows such a fleet. Each square is a home with a battery, drawn at one hour of one simulated day. The homes differ the way real ones do: battery sizes from 10 to
        27 kWh, different amounts of rooftop solar and household use, and owners who keep anywhere from 10% to all of their battery in reserve for outages. On any given
        day, some homes are also unreachable — the internet is down, the battery is being serviced, the owner opted out. The chart sums what the reachable homes could
        deliver to the grid for a full hour, starting at each hour of the day:
      </P>

      <Figure
        name="DER Aggregator"
        scenario={a}
        actions={
          <Button onClick={() => a.set((s) => ({ day: s.day + 1 }))} label="Simulate a new day">
            New day
          </Button>
        }
      >
        <Segmented
          label="Fleet size"
          value={String(n)}
          onChange={(v) => a.set({ n: Number(v) })}
          options={[
            { value: '10', label: '10 homes' },
            { value: '100', label: '100 homes' },
            { value: '1000', label: '1,000 homes' },
          ]}
        />
        <svg
          className="diagram"
          viewBox={`0 0 600 ${gridH + 12}`}
          role="img"
          aria-label={`${n} homes at ${hour(h)}: ${offline} unreachable, ${atReserve} at their backup reserve, the rest able to deliver a total of ${mw(today.totalKW[h] / 1000, 2)}.`}
        >
          {Array.from({ length: n }, (_, i) => {
            const x = 20 + (i % cols) * cell;
            const y = 6 + Math.floor(i / cols) * cell;
            const on = today.online[i];
            const av = today.availableKW[h * n + i];
            const fill = !on ? OFFLINE : av < 0.05 ? RESERVE : mix('#d9e7c8', FUEL.battery, av / HOMES[i].batteryKW);
            const g = Math.max(1, cell * 0.12);
            return <rect key={i} x={x + g / 2} y={y + g / 2} width={cell - g} height={cell - g} rx={cell > 20 ? 4 : 1.5} fill={fill} stroke={on ? 'none' : '#b5b5b5'} strokeDasharray={on ? undefined : '2 2'} />;
          })}
        </svg>
        <Legend
          items={[
            { label: 'Can deliver (darker: closer to its full rating)', color: FUEL.battery },
            { label: 'At its owner’s backup reserve', color: RESERVE },
            { label: 'Unreachable today', color: OFFLINE },
          ]}
        />
        <TimeChart
          ariaLabel={`Discharge the fleet could deliver at each hour; nameplate ${mw(today.nameplateKW / 1000, 2)}, ${mw(today.totalKW[h] / 1000, 2)} at ${hour(h)}.`}
          yLabel="Available discharge, MW"
          yMin={0}
          yMax={Math.max(0.01, (today.nameplateKW / 1000) * 1.1)}
          yFormat={(v) => fmt(v, n <= 10 ? 3 : n <= 100 ? 2 : 1)}
          height={220}
          series={[
            { values: today.totalKW.map((v) => v / 1000), color: FUEL.battery, kind: 'area', opacity: 0.35 },
            { values: today.totalKW.map((v) => v / 1000), color: FUEL.battery, width: 2.5 },
          ]}
          refLines={[{ y: today.nameplateKW / 1000, color: '#555', label: 'nameplate' }]}
          cursor={h}
          onScrub={(i) => a.set({ at: i })}
        />
        <TimeChart
          ariaLabel={`Energy stored above owners' reserves in reachable homes: ${mwh(today.energyKWh[h] / 1000, 2)} at ${hour(h)}.`}
          yLabel="Stored above reserves, MWh"
          yMin={0}
          yFormat={(v) => fmt(v, n <= 10 ? 3 : n <= 100 ? 2 : 1)}
          height={150}
          series={[{ values: today.energyKWh.map((v) => v / 1000), color: '#c99a1e', width: 2.5 }]}
          cursor={h}
          onScrub={(i) => a.set({ at: i })}
        />
        <Readouts
          items={[
            { label: 'nameplate (sum of inverters)', value: mw(today.nameplateKW / 1000, n <= 100 ? 2 : 1) },
            { label: `can deliver at ${hour(h)}`, value: mw(today.totalKW[h] / 1000, n <= 100 ? 2 : 1), tone: 'red' },
            { label: 'stored above reserves', value: mwh(today.energyKWh[h] / 1000, n <= 100 ? 2 : 1), tone: 'gold' },
            { label: 'homes unreachable', value: fmt(offline) },
          ]}
        />
        <Caption>Drag across the chart to see the fleet at another hour, or simulate another day.</Caption>
      </Figure>

      <P>
        The first thing to notice is the gap between the line and the dashed one above it. The fleet’s <K c="power">nameplate</K> capacity — the sum of every battery’s
        inverter rating — is {mw(REF.nameplate, 1)} for 1,000 homes. But on the first simulated day, {fmt(REF.offline)} of them are unreachable, many of the rest are
        holding a reserve, and a battery can’t deliver its full rating for an hour unless it holds enough energy above that reserve. At 18:00 the fleet can deliver{' '}
        {mw(REF.at18, 1)}.
      </P>
      <P>
        The shape over the day is the household’s rhythm from the previous lesson. Overnight the batteries drain to run the houses, so by 7:00 the whole fleet can offer only{' '}
        {mw(REF.at7, 2)}. Solar refills them through the morning, and by mid-afternoon most are full. Then the evening use begins to empty them again. For an aggregator,
        the most valuable hours — the evening peak — fall right on that downslope.
      </P>
      <P>
        Now switch between 10, 100 and 1,000 homes, and press “New day” a few times. With ten homes, one unreachable house or one family running the dryer at the wrong
        moment changes the total visibly. With a thousand, the day-to-day changes almost vanish. That is the central fact of aggregation, and it deserves a closer look.
      </P>

      <H2>Many small, independent surprises</H2>
      <P>
        Each home’s contribution at 18:00 is a random quantity: zero if it’s unreachable, otherwise whatever its battery and reserve allow on that day. If the homes behave
        independently, their surprises tend to cancel. The average of the sum grows in proportion to the number of homes, <i>N</i>, but its typical spread grows only as
        √<i>N</i>. Relative to its size, the fleet gets steadier as it grows — the <b>law of large numbers</b>:
      </P>
      <Eq label="Relative spread of a fleet's total falls as one over the square root of the number of homes">
        <Frac top={<span>spread of the total</span>} bottom={<span>expected total</span>} />
        <Op>∝</Op>
        <Frac top={<span>√N</span>} bottom={<span>N</span>} />
        <Op>=</Op>
        <Frac top="1" bottom={<span>√N</span>} />
      </Eq>
      <P>
        That steadiness is what an aggregator sells. A grid operator doesn’t want to know what the fleet delivers on average; it wants to know what the fleet will deliver
        when called. One way to put a number on that is the fleet’s <K c="power">dependable capacity</K>: the amount it can deliver on all but the worst few percent of
        days. The next demonstration simulates {fmt(DAYS)} evenings at 18:00 and plots, for each, what the fleet could deliver per home:
      </P>

      <Figure name="DER Aggregator · diversity" scenario={b}>
        <svg
          className="chart"
          viewBox="0 0 640 236"
          role="img"
          aria-label={`Distribution over ${DAYS} simulated evenings of what a ${size}-home fleet can deliver per home. Expected ${kw(perHome(d.mean), 2)}, dependable ${kw(perHome(dep), 2)} per home.`}
        >
          <text className="ax" x={X0} y={16}>
            Share of evenings
          </text>
          <GridY y={ys} ticks={[0, yTop / 2, yTop]} x0={X0} x1={X1} format={(v) => pct(v)} baseline={0} />
          {counts.map((c, i) => {
            const x0 = xs((i / bins) * 6);
            const x1 = xs(((i + 1) / bins) * 6);
            const v = c / d.totals.length;
            return v > 0 ? <rect key={i} x={x0 + 0.5} y={ys(v)} width={Math.max(0.5, x1 - x0 - 1)} height={ys(0) - ys(v)} fill={FUEL.battery} opacity={0.75} /> : null;
          })}
          <line x1={xs(perHome(d.mean))} x2={xs(perHome(d.mean))} y1={30} y2={200} stroke="#333" strokeWidth={2} />
          <text className="lab" x={xs(perHome(d.mean)) + 4} y={40}>
            expected
          </text>
          <line x1={xs(perHome(dep))} x2={xs(perHome(dep))} y1={30} y2={200} stroke="#c4382f" strokeWidth={2} strokeDasharray="6 4" />
          <text className="lab" x={xs(perHome(dep)) - 4} y={58} textAnchor="end" style={{ fill: '#c4382f' }}>
            dependable
          </text>
          <line x1={xs(perHome(d.nameplate))} x2={xs(perHome(d.nameplate))} y1={30} y2={200} stroke="#777" strokeWidth={1.5} strokeDasharray="2 3" />
          <text className="lab" x={xs(perHome(d.nameplate)) - 4} y={76} textAnchor="end">
            nameplate
          </text>
          {[0, 1, 2, 3, 4, 5, 6].map((v) => (
            <text key={v} className="ax ax-m" x={xs(v)} y={218}>
              {v}
            </text>
          ))}
          <text className="ax ax-e" x={X1} y={234}>
            kW per home at 18:00
          </text>
        </svg>
        <Readouts
          items={[
            { label: 'expected per home', value: kw(perHome(d.mean), 2) },
            { label: `dependable per home (${pct(conf)} of evenings)`, value: kw(perHome(dep), 2), tone: 'red' },
            { label: 'dependable ÷ expected', value: pct(ratio, 1) },
            { label: 'fleet dependable capacity', value: mw(dep / 1000, size < 200 ? 3 : 2) },
          ]}
        />
        <svg className="chart" viewBox="0 0 640 236" role="img" aria-label="Dependable capacity as a share of expected capacity, against fleet size, with and without weather shared by all homes.">
          <text className="ax" x={70} y={16}>
            Dependable ÷ expected
          </text>
          <GridY y={cy} ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]} x0={70} x1={590} format={(v) => pct(v)} />
          <line x1={70} x2={590} y1={cy(0.9)} y2={cy(0.9)} stroke="#999" strokeDasharray="3 4" />
          <path d={linePath(SIZES.map((s) => cx(Math.log10(s))), curves[1].map((v) => cy(Math.max(0.5, v))))} fill="none" stroke="#8a8a8a" strokeWidth={2} strokeDasharray="7 5" />
          <path d={linePath(SIZES.map((s) => cx(Math.log10(s))), curves[0].map((v) => cy(Math.max(0.5, v))))} fill="none" stroke={FUEL.battery} strokeWidth={3} />
          <circle cx={cx(Math.log10(size))} cy={cy(Math.max(0.5, ratio))} r={6} fill={shared ? '#8a8a8a' : FUEL.battery} stroke="#f8f8f8" strokeWidth={2} />
          {SIZES.map((s) => (
            <text key={s} className="ax ax-m" x={cx(Math.log10(s))} y={218}>
              {fmt(s)}
            </text>
          ))}
          <text className="ax ax-e" x={590} y={234}>
            Homes in the fleet
          </text>
        </svg>
        <Legend
          items={[
            { label: 'Each home’s weather and use independent', color: FUEL.battery, kind: 'line' },
            { label: 'Cloudy days shared by every home', color: '#8a8a8a', kind: 'line', dashed: true },
          ]}
        />
        <Slider
          label="Homes in the fleet"
          value={b.state.size}
          min={0}
          max={SIZES.length - 1}
          onChange={(v) => b.set({ size: v })}
          display={`${fmt(size)} homes`}
        />
        <Segmented
          label="Confidence"
          value={String(conf)}
          onChange={(v) => b.set({ confidence: Number(v) })}
          options={[
            { value: '0.9', label: 'Deliver on 90% of evenings' },
            { value: '0.95', label: '95%' },
            { value: '0.99', label: '99%' },
          ]}
        />
        <Checkbox label="Cloudy days hit every home at once" checked={shared} onChange={(v) => b.set({ shared: v })} />
      </Figure>

      <P>
        With ten homes, the histogram is wide and lumpy: the dependable level sits well below the average, at {pct(REF.ratio10)} of it. Each step up in size narrows the
        distribution. A 1,000-home fleet expects {mw(REF.exp1000, 2)} at 18:00 and can count on {mw(REF.dep1000, 2)} — {pct(REF.ratio1000)} of its
        expected capacity — on 95% of evenings. Raising the confidence to 99% moves the dependable line down, since the aggregator must cover rarer bad evenings.
      </P>

      <Challenge
        id="a"
        question="With each home’s weather independent and 95% confidence, find the smallest fleet that can promise at least 90% of its expected capacity."
        solved={solved}
        status={`A fleet of ${fmt(size)} homes can promise ${pct(ratio, 1)} of its expected capacity${shared ? ', with weather shared' : ''}${Math.abs(conf - 0.95) > 1e-9 ? `, at ${pct(conf)} confidence` : ''}.`}
        success={`Solved. ${fmt(size)} homes reach ${pct(ratio, 1)}, while the next size down manages only ${pct(prevRatio, 1)}. Past this point, each extra home adds almost its full expected contribution to what the fleet can promise.`}
      />

      <P>
        Now tick the checkbox. A cloudy day leaves every battery emptier at the same time, and no amount of averaging cancels a surprise that every home shares. The dashed
        curve still rises at first, as the independent part averages out, but then levels off near {pct(REF.sharedPlateau)}: a bigger fleet is steadier only against the
        surprises that differ from home to home. Real fleets face several shared risks of this kind — weather, a heat wave that has everyone running air conditioning, a
        software update that knocks a manufacturer’s devices offline — and an aggregator has to plan for them separately.
      </P>
      <P>
        Grid operators face the same question when they accredit capacity — deciding how much each resource counts toward having enough supply at the peak — and their
        methods are more elaborate than a single percentile. But the lesson carries over: nameplate capacity is what the fleet owns, and{' '}
        <K c="power">
          dependable capacity<Sub>95%</Sub>
        </K>{' '}
        is what it can sell. So far, though, we have only counted the fleet. In the <a href={lessonHref('7.3')}>next lesson</a>, we’ll try to make it actually do something
        on command, through networks that are slower and less reliable than the wires between a power plant and its control room.
      </P>
    </LessonPage>
  );
}
