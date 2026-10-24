import { useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  Eq,
  FigRef,
  Figure,
  Frac,
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
  Sup,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  usd,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { cheapestSpeed, fuelPerDay, voyage, type Voyage } from '../../../engines/oil/tanker';
import { BUNKER_PRICE, CALDER_DOCK_LIMIT, LIGHTERING_COST, PORT_DAYS, ROUTES, VESSELS, type RouteId, type VesselId } from '../../../model/oil/logistics';
import { StackedBar, XYChart } from '../shared/charts';

const VESSEL_IDS: VesselId[] = ['aframax', 'suezmax', 'vlcc'];
const ROUTE_IDS: RouteId[] = ['northport', 'eastbay', 'seaboard'];
const ROUTE_LABEL: Record<RouteId, string> = { northport: 'Calder → Northport', eastbay: 'Calder → Eastbay', seaboard: 'Seaboard → Calder' };
const VESSEL_COLOR: Record<VesselId, string> = { aframax: '#8fb8d8', suezmax: '#4590ce', vlcc: '#2f5f8f' };
const HIRE_COLOR = '#6d9c37';
const FUEL_COLOR = '#c99a1e';
const PORT_COLOR = '#9a9a9a';
const LIGHTER_COLOR = '#e6a557';

/** Simulated days that pass per second of animation. */
const DAYS_PER_SECOND = 10;
export const SPEED_STEP = 0.1;
export const LIGHTERING_STEP = 0.05;

export interface VoyageState {
  vessel: VesselId;
  route: RouteId;
  speed: number;
  hire: number;
  bunker: number;
}

export const VOYAGE_DEFAULTS: VoyageState = { vessel: 'aframax', route: 'northport', speed: 13, hire: VESSELS.aframax.hire, bunker: BUNKER_PRICE };

export function voyageOf(st: VoyageState): Voyage {
  return voyage({ vessel: st.vessel, route: st.route, speed: st.speed, hire: st.hire, bunker: st.bunker });
}

/** Challenge a: a VLCC to Eastbay at the default hire and bunker price, sailing at the cheapest speed (to a tenth of a knot). */
export function cheapestSpeedSolved(st: VoyageState): boolean {
  if (st.vessel !== 'vlcc' || st.route !== 'eastbay' || st.hire !== VESSELS.vlcc.hire || st.bunker !== BUNKER_PRICE) return false;
  return Math.abs(st.speed - cheapestSpeed('vlcc')) < 0.075;
}

/**
 * Freight per barrel for a class on a route at its own cheapest speed (default hire and bunker
 * price), with a chosen lightering cost for cargo above Port Calder's dock limit, or none if the
 * channel has been dredged.
 */
export function scaleCost(vessel: VesselId, route: RouteId, lightering: number, dredged: boolean): number {
  const base = voyage({ vessel, route, speed: cheapestSpeed(vessel), loadsAtCalder: false });
  const atCalder = ROUTES[route].from === 'Port Calder';
  const extra = atCalder && !dredged ? Math.max(0, VESSELS[vessel].cargo - CALDER_DOCK_LIMIT) * lightering : 0;
  return (base.total + extra) / base.cargo;
}

/** Challenge b: the lowest lightering cost (on 5¢ steps) at which a Suezmax carries crude to Northport more cheaply than a VLCC. */
export function lighteringSolved(lightering: number, dredged: boolean): boolean {
  if (dredged) return false;
  const suez = scaleCost('suezmax', 'northport', lightering, false);
  const prev = Math.round((lightering - LIGHTERING_STEP) * 100) / 100;
  return scaleCost('vlcc', 'northport', lightering, false) > suez && scaleCost('vlcc', 'northport', prev, false) <= suez;
}

function perBbl(x: number): string {
  return usd(x, 2);
}

function kusd(x: number): string {
  return x >= 1e6 ? `$${fmt(x / 1e6, 2)} million` : usd(Math.round(x / 1000) * 1000);
}

// ---------------------------------------------------------------------------
// The map: places and routes as cubic Bézier curves (schematic, not to scale).

type Pt = [number, number];
const PLACES: Record<string, { at: Pt; label: string; anchor: 'start' | 'end' | 'middle'; dx: number; dy: number }> = {
  calder: { at: [150, 128], label: 'Port Calder', anchor: 'end', dx: -10, dy: -8 },
  seaboard: { at: [74, 196], label: 'Seaboard field', anchor: 'start', dx: 10, dy: 18 },
  northport: { at: [476, 52], label: 'Northport', anchor: 'start', dx: 10, dy: 4 },
  eastbay: { at: [586, 196], label: 'Eastbay', anchor: 'end', dx: 0, dy: -12 },
};
const CURVES: Record<RouteId, [Pt, Pt, Pt, Pt]> = {
  northport: [PLACES.calder.at, [260, 104], [360, 36], PLACES.northport.at],
  eastbay: [PLACES.calder.at, [210, 330], [560, 330], PLACES.eastbay.at],
  seaboard: [PLACES.seaboard.at, [92, 160], [120, 136], PLACES.calder.at],
};

function bezier([a, b, c, d]: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  ];
}

/** Points along each route spaced by arc length, for moving the ship at constant speed. */
const SAMPLES: Record<RouteId, Pt[]> = Object.fromEntries(
  ROUTE_IDS.map((r) => {
    const raw = Array.from({ length: 201 }, (_, i) => bezier(CURVES[r], i / 200));
    const len = [0];
    for (let i = 1; i < raw.length; i++) len.push(len[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    const total = len[len.length - 1];
    const out: Pt[] = [];
    let j = 0;
    for (let k = 0; k <= 100; k++) {
      const target = (k / 100) * total;
      while (j < len.length - 2 && len[j + 1] < target) j++;
      const f = (target - len[j]) / Math.max(1e-9, len[j + 1] - len[j]);
      out.push([raw[j][0] + f * (raw[j + 1][0] - raw[j][0]), raw[j][1] + f * (raw[j + 1][1] - raw[j][1])]);
    }
    return [r, out];
  }),
) as Record<RouteId, Pt[]>;

function along(route: RouteId, f: number): { at: Pt; angle: number } {
  const s = SAMPLES[route];
  const x = Math.max(0, Math.min(1, f)) * 100;
  const i = Math.min(99, Math.floor(x));
  const k = x - i;
  const a = s[i];
  const b = s[i + 1];
  return { at: [a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1])], angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
}

function pathD(route: RouteId): string {
  const [a, b, c, d] = CURVES[route];
  return `M${a[0]} ${a[1]} C${b[0]} ${b[1]} ${c[0]} ${c[1]} ${d[0]} ${d[1]}`;
}

/** Where the ship is on day `day` of its round voyage. */
function shipState(v: Voyage, day: number): { f: number; laden: boolean; inPort: string | null } {
  const half = v.portDays / 2;
  const leg = v.seaDays / 2;
  const d = ((day % v.days) + v.days) % v.days;
  if (d < half) return { f: 0, laden: true, inPort: 'loading' };
  if (d < half + leg) return { f: (d - half) / leg, laden: true, inPort: null };
  if (d < 2 * half + leg) return { f: 1, laden: false, inPort: 'discharging' };
  return { f: 1 - (d - 2 * half - leg) / leg, laden: false, inPort: null };
}

function VoyageMap({ st, v, day }: { st: VoyageState; v: Voyage; day: number }) {
  const ship = shipState(v, day);
  const pos = along(st.route, ship.f);
  const angle = ship.laden ? pos.angle : pos.angle + 180;
  const from = ROUTES[st.route].from;
  const to = ROUTES[st.route].to;
  const shown = Math.floor(((day % v.days) + v.days) % v.days) + 1;
  const mid = along(st.route, 0.5).at;
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 262"
      role="img"
      aria-label={`Schematic map, not to scale: a ${VESSELS[st.vessel].name} on the ${fmt(ROUTES[st.route].nm)}-nautical-mile route from ${from} to ${to} and back, at ${fmt(st.speed, 1)} knots: a round voyage of ${fmt(v.days, 1)} days. It is on day ${shown}, ${ship.inPort ? `in port, ${ship.inPort}` : ship.laden ? 'sailing laden' : 'returning in ballast'}.`}
    >
      <rect x={0} y={0} width={640} height={262} fill="#eef4f8" />
      <path d="M0 0 L140 0 Q170 70 158 118 Q150 150 112 168 Q60 186 0 176 Z" fill="#ece6d8" />
      <path d="M430 0 L640 0 L640 92 Q560 98 520 66 Q486 40 430 0 Z" fill="#ece6d8" />
      <path d="M600 150 Q640 150 640 160 L640 262 L588 262 Q574 220 600 150 Z" fill="#ece6d8" />
      {ROUTE_IDS.map((r) => (
        <path key={r} d={pathD(r)} fill="none" stroke={r === st.route ? '#2f5f8f' : '#b9c7d3'} strokeWidth={r === st.route ? 2.5 : 1.5} strokeDasharray={r === st.route ? undefined : '5 5'} />
      ))}
      <text x={mid[0]} y={mid[1] + (st.route === 'eastbay' ? 18 : -8)} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#2f5f8f' }}>
        {fmt(ROUTES[st.route].nm)} nautical miles each way
      </text>
      {Object.entries(PLACES).map(([id, p]) => (
        <g key={id}>
          <circle cx={p.at[0]} cy={p.at[1]} r={5} fill="#333" />
          <text x={p.at[0] + p.dx} y={p.at[1] + p.dy} textAnchor={p.anchor} style={{ fontSize: 12.5, fontWeight: 500, fill: '#333' }}>
            {p.label}
          </text>
        </g>
      ))}
      <g transform={`translate(${pos.at[0].toFixed(1)} ${pos.at[1].toFixed(1)}) rotate(${angle.toFixed(1)})`}>
        <path d="M-13 -5 L9 -5 L14 0 L9 5 L-13 5 Z" fill={ship.laden ? '#ad5310' : '#fcfcfb'} stroke="#333" strokeWidth={1.5} />
      </g>
      <text className="ax" x={12} y={250}>
        Day {shown} of {fmt(v.days, 1)} · {ship.inPort ? `in port, ${ship.inPort}` : ship.laden ? `laden, ${fmt(VESSELS[st.vessel].cargo)} barrels aboard` : 'in ballast, empty'}
      </text>
      <text className="ax ax-e" x={628} y={250}>
        schematic, not to scale
      </text>
    </svg>
  );
}

/** Freight per barrel for each class on each route, at each class's cheapest speed. */
function ScaleBars({ lightering, dredged }: { lightering: number; dredged: boolean }) {
  const X0 = 56;
  const X1 = 624;
  const Y0 = 210;
  const Y1 = 30;
  const max = 6;
  const sy = (v: number) => Y0 - (v / max) * (Y0 - Y1);
  const groupW = (X1 - X0) / ROUTE_IDS.length;
  const barW = 40;
  const rows = ROUTE_IDS.flatMap((r) => VESSEL_IDS.map((v) => ({ r, v, total: scaleCost(v, r, lightering, dredged), base: scaleCost(v, r, 0, true) })));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 248"
      role="img"
      aria-label={`Freight per barrel at each class’s cheapest speed: ${rows.map((x) => `${VESSELS[x.v].name} ${ROUTE_LABEL[x.r]} ${perBbl(x.total)}`).join('; ')}.`}
    >
      <text className="ax" x={X0} y={14}>
        Freight, $ per barrel, each ship at its cheapest speed
      </text>
      {[0, 1, 2, 3, 4, 5, 6].map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={X0} x2={X1} y1={sy(t)} y2={sy(t)} />
          <text className="ax ax-e" x={X0 - 6} y={sy(t) + 4}>
            ${t}
          </text>
        </g>
      ))}
      {ROUTE_IDS.map((r, gi) => {
        const cx = X0 + groupW * (gi + 0.5);
        return (
          <g key={r}>
            {VESSEL_IDS.map((v, vi) => {
              const x = cx + (vi - 1) * (barW + 8) - barW / 2;
              const row = rows.find((q) => q.r === r && q.v === v)!;
              return (
                <g key={v}>
                  <rect x={x} y={sy(row.base)} width={barW} height={sy(0) - sy(row.base)} fill={VESSEL_COLOR[v]} />
                  {row.total > row.base + 1e-9 && <rect x={x} y={sy(row.total)} width={barW} height={sy(row.base) - sy(row.total)} fill={LIGHTER_COLOR} />}
                  <text x={x + barW / 2} y={sy(row.total) - 5} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 500, fill: '#333' }}>
                    {perBbl(row.total)}
                  </text>
                </g>
              );
            })}
            <text className="ax ax-m" x={cx} y={Y0 + 18} style={{ fill: '#333' }}>
              {ROUTE_LABEL[r]}
            </text>
            <text className="ax ax-m" x={cx} y={Y0 + 34}>
              {fmt(ROUTES[r].nm)} nm
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario<VoyageState>('voyage', VOYAGE_DEFAULTS);
  const st = s.state;
  const v = voyageOf(st);
  const vs = cheapestSpeed(st.vessel, st.hire, st.bunker);
  const play = usePlay(true);
  const [day, setDay] = useState(0);
  useAnimationFrame((dt) => setDay((d) => (d + dt * DAYS_PER_SECOND) % 1e6), play.playing);

  const curve = useMemo(
    () => Array.from({ length: 71 }, (_, i) => 9 + i * 0.1).map((sp) => [sp, voyage({ vessel: st.vessel, route: st.route, speed: sp, hire: st.hire, bunker: st.bunker }).perBbl] as [number, number]),
    [st.vessel, st.route, st.hire, st.bunker],
  );
  const best = voyage({ vessel: st.vessel, route: st.route, speed: Math.max(9, Math.min(16, vs)), hire: st.hire, bunker: st.bunker });
  const ys = curve.map((p) => p[1]);
  const [y0, y1] = niceDomain(Math.min(...ys) * 0.97, Math.max(...ys) * 1.01, 4);
  const solvedA = cheapestSpeedSolved(st);

  const s2 = useScenario('scale', { lightering: LIGHTERING_COST, dredged: false });
  const { lightering, dredged } = s2.state;
  const solvedB = lighteringSolved(lightering, dredged);
  const vlccNp = scaleCost('vlcc', 'northport', lightering, dredged);
  const suezNp = scaleCost('suezmax', 'northport', lightering, dredged);

  // Reference numbers for the prose.
  const af13 = voyage({ vessel: 'aframax', route: 'northport', speed: 13 });
  const vl13 = voyage({ vessel: 'vlcc', route: 'eastbay', speed: 13 });
  const vlBest = voyage({ vessel: 'vlcc', route: 'eastbay', speed: cheapestSpeed('vlcc') });
  const NORTHPORT_PRICE = 79;
  const ref = (vessel: VesselId, route: RouteId) => scaleCost(vessel, route, LIGHTERING_COST, false);
  const refFree = (vessel: VesselId, route: RouteId) => scaleCost(vessel, route, LIGHTERING_COST, true);
  const tie = (scaleCost('suezmax', 'northport', 0, false) - scaleCost('vlcc', 'northport', 0, false)) / ((VESSELS.vlcc.cargo - CALDER_DOCK_LIMIT) / VESSELS.vlcc.cargo);

  return (
    <LessonPage id="oil/4.2">
      <P>
        <a href={lessonHref('oil/4.1')}>Lesson 4.1</a> pumped crude 500 miles down the Kessler–Calder line to the coast. That is where pipelines stop. Seaboard Blend
        reaches Port Calder in tankers, and whatever crude or fuel the Calder region has to spare leaves in tankers too, for refineries and markets across the ocean.
        Most of the crude oil traded between countries travels this way. A ship, unlike a pipeline, can go anywhere there’s water deep enough for it, so what a cargo
        costs to move depends mostly on how far it goes, how big the ship is, and how fast it sails.
      </P>
      <P>
        Crude tankers come in a few standard sizes. In our world they are the <b>Aframax</b>, carrying about {fmt(VESSELS.aframax.cargo)} barrels; the{' '}
        <b>Suezmax</b>, about {fmt(VESSELS.suezmax.cargo)} — named as the largest tanker that can pass through the Suez Canal fully laden; and the <b>VLCC</b>, or very
        large crude carrier, about {fmt(VESSELS.vlcc.cargo)}. Port Calder’s tankers sail {fmt(ROUTES.northport.nm)} nautical miles to Northport, a refining center
        across the ocean, or {fmt(ROUTES.eastbay.nm)} to Eastbay, a distant importer; Seaboard Blend comes {fmt(ROUTES.seaboard.nm)} miles from its offshore field.
      </P>
      <P>
        A company that needs a cargo moved <b>charters</b> a ship and pays three kinds of cost. <K c="price">Hire</K> is a daily rate for the ship and its crew, paid for
        every day of the voyage. <K c="energy">Fuel</K>, called bunkers, is paid by the tonne. And every call at a port has its charges. A voyage is a round trip: out
        laden, back empty “in ballast,” with {PORT_DAYS} days in port for loading and discharging. All of the rates here are the course’s simulated ones, for a calm
        market. In the next demonstration, choose a ship and a route, and set the speed and the two prices that matter most, the daily hire and the price of fuel:
      </P>

      <Figure name="Tanker Voyage Planner" scenario={s} play={play}>
        <Segmented
          label="Ship"
          value={st.vessel}
          onChange={(vessel) => s.set({ vessel, hire: VESSELS[vessel].hire })}
          options={VESSEL_IDS.map((id) => ({ value: id, label: `${VESSELS[id].name} · ${fmt(VESSELS[id].cargo / 1e6, 1)}M bbl` }))}
        />
        <Segmented label="Route" value={st.route} onChange={(route) => s.set({ route })} options={ROUTE_IDS.map((id) => ({ value: id, label: ROUTE_LABEL[id] }))} />
        <VoyageMap st={st} v={v} day={day} />
        <Readouts
          items={[
            { label: 'round voyage', value: `${fmt(v.days, 1)} days` },
            { label: <K c="energy">fuel burned</K>, value: `${fmt(v.fuelTonnes)} t`, tone: 'gold' },
            { label: <K c="price">freight per barrel</K>, value: perBbl(v.perBbl), tone: 'green' },
          ]}
        />
        <StackedBar
          title={`Where the ${kusd(v.total)} goes, per barrel`}
          ariaLabel={`Freight per barrel: hire ${perBbl(v.hireCost / v.cargo)}, fuel ${perBbl(v.fuelCost / v.cargo)}, port charges ${perBbl(v.portCost / v.cargo)}, lightering ${perBbl(v.lightering / v.cargo)}.`}
          segments={[
            { id: 'hire', value: v.hireCost / v.cargo, color: HIRE_COLOR, label: 'hire', textColor: '#fff' },
            { id: 'fuel', value: v.fuelCost / v.cargo, color: FUEL_COLOR, label: 'fuel' },
            { id: 'port', value: v.portCost / v.cargo, color: PORT_COLOR, label: 'port', textColor: '#fff' },
            ...(v.lightering > 0 ? [{ id: 'lightering', value: v.lightering / v.cargo, color: LIGHTER_COLOR, label: 'lightering' }] : []),
          ]}
          format={(x) => usd(x, 2)}
        />
        <XYChart
          ariaLabel={`Freight per barrel against speed for this ship and route. At ${fmt(st.speed, 1)} knots it is ${perBbl(v.perBbl)}; the cheapest speed is ${fmt(vs, 2)} knots, at ${perBbl(best.perBbl)}.`}
          height={190}
          x={[9, 16]}
          y={[y0, y1]}
          xTicks={[9, 10, 11, 12, 13, 14, 15, 16]}
          yTicks={niceTicks(y0, y1, 3)}
          xFormat={(x) => `${x} kn`}
          yFormat={(x) => usd(x, 2)}
          yLabel="Freight, $ per barrel, by speed"
          series={[{ points: curve, color: HIRE_COLOR, width: 2.5 }]}
          refs={[{ axis: 'x', at: st.speed, cursor: true }]}
          markers={[
            ...(vs >= 9 && vs <= 16 ? [{ x: vs, y: best.perBbl, color: '#3f7a1e', r: 5, hollow: true, label: 'cheapest', labelDy: 18, labelDx: -8, labelAnchor: 'end' as const }] : []),
            { x: st.speed, y: v.perBbl, color: '#3f7a1e', r: 6 },
          ]}
        />
        <Slider label="Speed" value={st.speed} min={9} max={16} step={SPEED_STEP} onChange={(x) => s.set({ speed: Math.round(x * 10) / 10 })} display={`${fmt(st.speed, 1)} knots`} />
        <Slider label="Charter hire" tone="green" value={st.hire} min={10000} max={150000} step={1000} onChange={(x) => s.set({ hire: x })} display={`${usd(st.hire)} a day`} />
        <Slider label="Bunker fuel" tone="gold" value={st.bunker} min={300} max={1000} step={10} onChange={(x) => s.set({ bunker: x })} display={`${usd(st.bunker)} a tonne`} />
        <Caption>
          At {fmt(st.speed, 1)} knots this {VESSELS[st.vessel].name} burns {fmt(fuelPerDay(VESSELS[st.vessel], st.speed), 1)} tonnes of fuel a day at sea. The cheapest
          speed at these prices is {fmt(vs, 2)} knots{vs < 9 || vs > 16 ? ', outside the slider’s range' : ''}.
        </Caption>
      </Figure>

      <P>
        Start with an Aframax to Northport at 13 knots. The round trip takes {fmt(af13.days, 1)} days and burns {fmt(af13.fuelTonnes)} tonnes of fuel. Hire comes to{' '}
        {kusd(af13.hireCost)}, fuel to {kusd(af13.fuelCost)} and port charges to {kusd(af13.portCost)}: {kusd(af13.total)} in all, or {perBbl(af13.perBbl)} for each of
        its {fmt(VESSELS.aframax.cargo)} barrels. That is about {fmt((af13.perBbl / NORTHPORT_PRICE) * 100, 1)}% of the value of the crude at the course’s simulated
        Northport price of {usd(NORTHPORT_PRICE)} — small, but in a business where crudes differ by a dollar or two, it decides where cargoes go.
      </P>

      <H2>The cheapest speed</H2>
      <P>
        Why not sail flat out? Because the resistance of the water climbs steeply with speed, and the engine’s fuel with it: roughly with the <b>cube</b> of the speed.
        A VLCC burns {fmt(fuelPerDay(VESSELS.vlcc, 14))} tonnes a day at 14 knots, {fmt(fuelPerDay(VESSELS.vlcc, 12))} at 12, and {fmt(fuelPerDay(VESSELS.vlcc, 16))}{' '}
        at 16. Sailing faster shortens the voyage, so fewer days of hire; but each day at sea burns much more fuel, and over a whole voyage the fuel bill grows with the
        square of the speed. Hire falls as speed rises and fuel climbs, so somewhere between them is a speed that costs least per barrel. Setting the slope of the total
        to zero gives it:
      </P>
      <Eq label="Cheapest speed equals the cube root of hire times 14 cubed, divided by twice the fuel burned per day at 14 knots times the bunker price">
        <span>
          v<Sub>cheapest</Sub>
        </span>
        <Op>=</Op>
        <span>∛</span>
        <Frac
          top={
            <>
              <K c="price">hire</K> × 14<Sup>3</Sup>
            </>
          }
          bottom={
            <>
              2 × fuel at 14 knots × <K c="energy">bunker price</K>
            </>
          }
        />
      </Eq>
      <P>
        For a VLCC to Eastbay at the default rates, that’s {fmt(cheapestSpeed('vlcc'), 2)} knots. Compared with 13 knots, the voyage takes{' '}
        {fmt(vlBest.days - vl13.days, 1)} days longer — {fmt(vlBest.days, 1)} instead of {fmt(vl13.days, 1)} — and burns {fmt(vl13.fuelTonnes - vlBest.fuelTonnes)} fewer
        tonnes of fuel, and freight falls from {perBbl(vl13.perBbl)} to {perBbl(vlBest.perBbl)} a barrel. When fuel prices rose sharply in the late 2000s, shipowners
        widely adopted this kind of <b>slow steaming</b>, and slower speeds have stayed common since.
      </P>

      <Challenge
        id="a"
        question="Find the cheapest speed, to a tenth of a knot, for a VLCC sailing from Port Calder to Eastbay at the default hire and bunker price."
        solved={solvedA}
        status={
          st.vessel !== 'vlcc' || st.route !== 'eastbay'
            ? 'Choose the VLCC and the route to Eastbay.'
            : st.hire !== VESSELS.vlcc.hire || st.bunker !== BUNKER_PRICE
              ? `Reset the hire to ${usd(VESSELS.vlcc.hire)} a day and bunkers to ${usd(BUNKER_PRICE)} a tonne.`
              : `At ${fmt(st.speed, 1)} knots, freight is ${usd(v.perBbl, 3)} a barrel.`
        }
        success={`Solved: ${fmt(st.speed, 1)} knots, ${usd(v.perBbl, 3)} a barrel. The curve is very flat near its bottom — a tenth of a knot either way changes freight by a fraction of a cent — but sailing at 13 knots instead costs ${usd(vl13.perBbl - vlBest.perBbl, 3)} a barrel more, ${kusd((vl13.perBbl - vlBest.perBbl) * VESSELS.vlcc.cargo)} on a two-million-barrel cargo.`}
      />

      <P>
        The cheapest speed moves with prices. With bunkers at $400 a tonne, the VLCC’s best speed rises to {fmt(cheapestSpeed('vlcc', VESSELS.vlcc.hire, 400), 1)}{' '}
        knots; at $800, it falls to {fmt(cheapestSpeed('vlcc', VESSELS.vlcc.hire, 800), 1)}. When ships are scarce and hire climbs to $100,000 a day, every day saved
        is worth more, and the best speed rises to {fmt(cheapestSpeed('vlcc', 100000, BUNKER_PRICE), 1)}. That has a consequence for the market as a whole: a fleet that
        slows down carries less. At its cheapest speed, a VLCC on the Eastbay run makes {fmt(365 / vlBest.days, 2)} round trips a year instead of{' '}
        {fmt(365 / vl13.days, 2)} at 13 knots — {fmt((1 - vl13.days / vlBest.days) * 100)}% fewer barrels delivered by the same ships.
      </P>

      <H2>Bigger ships, deeper water</H2>
      <P>
        A VLCC carries almost three times an Aframax’s cargo, but its hire and fuel are nowhere near three times as much: a hull’s cost and resistance grow more slowly
        than the volume it encloses. So bigger ships move a barrel more cheaply — as long as they can get into port. A fully laden VLCC draws about 20 meters of water,
        and many harbors, including much of the U.S. Gulf Coast, are too shallow for one. There, a VLCC loads what it can at the dock and is topped up offshore from
        smaller ships, a costly operation called <b>reverse lightering</b>. In our world, Port Calder’s channel lets a tanker load at most{' '}
        {fmt(CALDER_DOCK_LIMIT)} barrels at the dock; anything more costs {usd(LIGHTERING_COST, 2)} a barrel to top up. In the next demonstration, each ship sails at its
        own cheapest speed. Change what lightering costs, or dredge the channel:
      </P>

      <Figure name="Tanker Voyage Planner · scale" scenario={s2}>
        <Legend
          items={[
            ...VESSEL_IDS.map((id) => ({ label: VESSELS[id].name, color: VESSEL_COLOR[id] })),
            { label: 'Topping up offshore (lightering)', color: LIGHTER_COLOR },
          ]}
        />
        <ScaleBars lightering={lightering} dredged={dredged} />
        <Readouts
          items={[
            { label: <K c="price">VLCC to Northport</K>, value: perBbl(vlccNp), tone: 'green' },
            { label: <K c="price">Suezmax to Northport</K>, value: perBbl(suezNp), tone: 'green' },
            { label: 'cheaper ship on this route', value: vlccNp <= suezNp ? 'VLCC' : 'Suezmax' },
          ]}
        />
        <Slider
          label="Lightering cost"
          tone="green"
          value={lightering}
          min={0}
          max={2.5}
          step={LIGHTERING_STEP}
          onChange={(x) => s2.set({ lightering: Math.round(x * 100) / 100 })}
          display={`${usd(lightering, 2)} a barrel`}
        />
        <Checkbox label="Dredge Port Calder’s channel so a VLCC can load fully at the dock" checked={dredged} onChange={(d) => s2.set({ dredged: d })} />
      </Figure>

      <P>
        Without the port limit, the economies of scale are large. To Northport, at each ship’s cheapest speed, freight runs {perBbl(refFree('aframax', 'northport'))} a
        barrel by Aframax, {perBbl(refFree('suezmax', 'northport'))} by Suezmax and {perBbl(refFree('vlcc', 'northport'))} by VLCC; to Eastbay,{' '}
        {perBbl(refFree('aframax', 'eastbay'))}, {perBbl(refFree('suezmax', 'eastbay'))} and {perBbl(refFree('vlcc', 'eastbay'))}. The longer the voyage, the more the
        size of the ship matters. At Port Calder, lightering the second million barrels at {usd(LIGHTERING_COST, 2)} adds{' '}
        {usd((LIGHTERING_COST * (VESSELS.vlcc.cargo - CALDER_DOCK_LIMIT)) / VESSELS.vlcc.cargo, 2)} to every barrel of a VLCC cargo, so the VLCC to Northport costs{' '}
        {perBbl(ref('vlcc', 'northport'))} — still well below the Suezmax. Seaboard Blend’s offshore terminal has no such limit, and a VLCC brings it to Calder for{' '}
        {perBbl(ref('vlcc', 'seaboard'))} a barrel.
      </P>

      <Challenge
        id="b"
        question="How expensive would lightering have to get before a Suezmax became the cheaper way to send crude from Port Calder to Northport? Find the lowest lightering cost, to the nearest 5 cents, at which it is."
        solved={solvedB}
        status={
          dredged
            ? 'Leave the channel as it is: with no dock limit there is no lightering.'
            : `At ${usd(lightering, 2)} a barrel, the VLCC costs ${usd(vlccNp, 3)} and the Suezmax ${usd(suezNp, 3)}.`
        }
        success={`Solved: ${usd(lightering, 2)}. The VLCC’s advantage on this route is worth about ${usd(tie, 2)} for each barrel it has to top up offshore. That is why ports spend heavily on deeper channels and offshore loading terminals: they let the cheapest ships call fully loaded, and the saving shows up in what a barrel of crude at the port is worth.`}
      />

      <P>
        Freight is a cost on the way from where crude is cheap to where it’s dear, and <a href={lessonHref('oil/4.5')}>Lesson 4.5</a> will put it beside the price
        difference between two places to decide whether a cargo moves at all. You can return to <FigRef to="Tanker Voyage Planner">the first demonstration</FigRef> to
        price any voyage.
      </P>
      <P>
        Ships and pipelines also deliver oil very differently. A pipeline runs day and night at a steady rate; a VLCC arrives every few weeks and puts two million barrels
        ashore in a day or two, while a refinery consumes its crude at a steady pace. Something has to absorb the difference, and that something is a tank. The{' '}
        <a href={lessonHref('oil/4.3')}>next lesson</a> is about storage: how much it costs to hold a barrel, and when holding it pays.
      </P>
    </LessonPage>
  );
}
