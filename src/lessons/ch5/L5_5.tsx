import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  Figure,
  H2,
  LessonPage,
  NetworkView,
  P,
  Readouts,
  Slider,
  fmt,
  lessonHref,
  linePath,
  mw,
  priceFill,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { dcopf, type OpfGenerator } from '../../engines/market/opf';
import { fleetOffers, nodalLoads } from '../../engines/market/networkDispatch';
import { STANDARD_FLEET, fleetById } from '../../model/fleet';
import { REGION, REGION_LOAD_SHARE, nodeName } from '../../model/networks';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';

// ---------------------------------------------------------------------------
// Scarcity in one place: Metro at noon, with Central–Metro out and the city's demand rising.

const NOON = 12;
const POCKET_GENS = fleetOffers(STANDARD_FLEET, { windCF: WIND_CF[NOON], solarCF: SOLAR_CF[NOON] });
const POCKET_LOADS = nodalLoads(SYSTEM_DEMAND[NOON], REGION_LOAD_SHARE);
const MAIN_LINE = 'center-city';
const IMPORT_LINES = REGION.lines.filter((l) => l.from === 'city' || l.to === 'city').map((l) => l.id);
const limitOf = (id: string) => REGION.lines.find((l) => l.id === id)!.limit;
// What Metro can import with its main line out, and what it can make itself.
const IMPORT_CAP_OUT = IMPORT_LINES.filter((id) => id !== MAIN_LINE).reduce((t, id) => t + limitOf(id), 0);
const IMPORT_CAP_IN = IMPORT_LINES.reduce((t, id) => t + limitOf(id), 0);
const MILL = fleetById('cc2');
const QUAY = fleetById('oil');
// Lesson 2.6 used $1,000. Markets that also price reserve shortfalls (Lesson 4.6) put it above any
// shortage price plus a plant's cost, or the optimizer would cut customers off rather than run short of reserve.
const VOLL = 5000;
const VOLL_2_6 = 1000;
// Temporary generators for the challenge (illustrative numbers).
const TEMP = { capacity: 100, offer: 300 };
const M_MIN = 600;
const M_MAX = 1050;

export interface PocketState {
  metro: number;
  out: boolean;
  temp: string;
}

function pocketSolve(st: PocketState, lmp = true) {
  const gens: OpfGenerator[] = st.temp ? [...POCKET_GENS, { id: 'temp', node: st.temp, capacity: TEMP.capacity, offer: TEMP.offer }] : POCKET_GENS;
  return dcopf(REGION, gens, { ...POCKET_LOADS, city: st.metro }, { outages: st.out ? [MAIN_LINE] : [], voll: VOLL, lmp });
}

const otherPrices = (r: ReturnType<typeof pocketSolve>) => REGION.nodes.filter((x) => x.id !== 'city').map((x) => r.lmp[x.id] ?? 0);

/** Metro's price, and the highest price anywhere else, as Metro's demand sweeps across the slider. */
function pocketCurve(out: boolean, temp: string) {
  const ms: number[] = [];
  for (let m = M_MIN; m <= M_MAX; m += 5) ms.push(m);
  const res = ms.map((metro) => pocketSolve({ metro, out, temp }));
  return { ms, metro: res.map((r) => r.lmp.city), other: res.map((r) => Math.max(...otherPrices(r))), shed: res.map((r) => r.shed.city ?? 0) };
}

const curveCache = new Map<string, ReturnType<typeof pocketCurve>>();
function curve(out: boolean, temp: string) {
  const key = `${out}|${temp}`;
  let c = curveCache.get(key);
  if (!c) {
    c = pocketCurve(out, temp);
    curveCache.set(key, c);
  }
  return c;
}

// Prose numbers.
const POCKET_START = 640;
export const POCKET_DEFAULTS: PocketState = { metro: POCKET_START, out: true, temp: '' };
/** The pocket challenge: Central–Metro out, Metro at 1,000 MW or more, and nobody cut off. */
export function pocketSolved(st: PocketState): boolean {
  return st.out && st.metro >= 1000 && st.temp === 'city' && (pocketSolve(st, false).shed.city ?? 0) < 1e-6;
}
const AT = (metro: number, out = true, temp = '') => pocketSolve({ metro, out, temp });
const P_START = AT(POCKET_START);
const P_WEST = AT(650);
const P_CUT = AT(900);
const P_SHED = AT(1000);
const P_IN = AT(1000, false);

const LOCAL_NAME: Record<string, string> = { cc2: 'Mill Creek', oil: 'Old Quay', temp: 'the temporary generators' };
const LOCAL_SHORT: Record<string, string> = { cc2: 'Mill Creek', oil: 'Old Quay', temp: 'Temporary' };

// ---------------------------------------------------------------------------
// Oversupply: a windy night on the region's network.

const NIGHT = 3;

export interface NightState {
  demand: number;
  wind: number;
  offer: number;
  floors: boolean;
  out: string;
}
export const NIGHT_DEFAULTS: NightState = { demand: 750, wind: 175, offer: -25, floors: true, out: '' };

function nightSolve(st: NightState) {
  const gens = fleetOffers(STANDARD_FLEET, { windCF: st.wind / fleetById('wind').capacity, solarCF: SOLAR_CF[NIGHT], mustRun: st.floors, offers: { wind: st.offer } });
  const loads = nodalLoads(st.demand, REGION_LOAD_SHARE);
  return dcopf(REGION, gens, loads, { outages: st.out ? [st.out] : [] });
}

/** The negative-price challenge: one substation below zero while another is above it. */
export function mixedSolved(st: NightState): boolean {
  const r = nightSolve(st);
  const p = REGION.nodes.map((x) => r.lmp[x.id] ?? 0);
  return r.feasible && Math.min(...p) < -0.005 && Math.max(...p) > 0.005;
}

const LABEL_OFFSET: Record<string, [number, number]> = {
  'north-center': [34, -14],
  'north-east': [0, -10],
  'harbor-center': [-6, -10],
  'harbor-west': [40, -14],
  'west-center': [34, 4],
  'center-city': [10, -18],
  'east-city': [44, 0],
  'west-city': [10, 22],
};

function lineName(id: string) {
  const l = REGION.lines.find((x) => x.id === id)!;
  return `${nodeName(REGION, l.from)}–${nodeName(REGION, l.to)}`;
}

/** A line through the points that jumps vertically wherever the value changes (prices move in steps). */
function stepLine(xs: number[], ys: number[]): string {
  const px: number[] = [];
  const py: number[] = [];
  xs.forEach((x, i) => {
    if (i > 0 && Math.abs(ys[i] - ys[i - 1]) > 0.01) {
      px.push(x);
      py.push(ys[i - 1]);
    }
    px.push(x);
    py.push(ys[i]);
  });
  return linePath(px, py);
}

export default function Lesson() {
  // ---- Figure 1: scarcity in one place.
  const s = useScenario('pocket', POCKET_DEFAULTS);
  const st = s.state;
  const pr = pocketSolve(st);
  const cv = curve(st.out, st.temp);
  const metroPrice = pr.lmp.city ?? 0;
  const others = otherPrices(pr);
  const maxOther = Math.max(...others);
  const shed = pr.shed.city ?? 0;
  const inService = IMPORT_LINES.filter((id) => !(st.out && id === MAIN_LINE));
  const imports = inService.reduce((t, id) => t + (REGION.lines.find((l) => l.id === id)!.to === 'city' ? 1 : -1) * (pr.flows[id] ?? 0), 0);
  const importCap = st.out ? IMPORT_CAP_OUT : IMPORT_CAP_IN;
  const full = inService.filter((id) => pr.binding.includes(id));
  const local = (['temp', 'oil', 'cc2'] as const).find((id) => {
    const offer = id === 'temp' ? (st.temp === 'city' ? TEMP.offer : NaN) : fleetById(id).marginalCost;
    return Math.abs(offer - metroPrice) < 0.01;
  });
  const lineList = (ids: string[]) => ids.map(lineName).join(' and ');
  let caption: string;
  // The map shows every price and Metro's own plants, and the challenge reports the temporary generators,
  // so the caption explains rather than repeats them.
  if (shed > 0.5) caption = 'Metro’s lines are full and its own plants are flat out, so some of its customers are cut off, and Metro’s price is the value of lost load.';
  else if (metroPrice >= VOLL - 1e-6)
    caption = 'Everything Metro can import or make is in use. The next megawatt would mean cutting someone off, so Metro’s price is already the value of lost load.';
  else if (full.length && full.length === inService.length)
    caption = `${lineList(full)} ${full.length > 1 ? 'are' : 'is'} full, so every extra megawatt has to be made inside the city, and ${local ? LOCAL_NAME[local] : 'a plant in Metro'} ${local === 'temp' ? 'set' : 'sets'} Metro’s price.`;
  else if (full.length) caption = `${lineList(full)} ${full.length > 1 ? 'are' : 'is'} full, so Metro’s price separates from the rest of the region’s.`;
  else caption = 'No line into Metro is full, so every substation pays the same price.';
  const pocketOk = pocketSolved(st);

  const X = scale(M_MIN, M_MAX, 70, 520);
  const Y = scale(1, 4, 118, 22);
  const yOf = (p: number) => Y(Math.log10(Math.max(10, p)));
  const shedFrom = cv.ms.find((_, i) => cv.metro[i] >= VOLL - 1e-6);

  // ---- Figure 2: too much power.
  const n = useScenario('oversupply', NIGHT_DEFAULTS);
  const r = nightSolve(n.state);
  const prices = REGION.nodes.map((x) => r.lmp[x.id] ?? 0);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const curtailed = Math.max(0, n.state.wind - (r.dispatch.wind ?? 0));
  const mixed = mixedSolved(n.state);
  const toggleLine = (id: string) => n.set((st) => ({ out: st.out === id ? '' : id }));

  // Prose numbers for the windy night at the default demand.
  const nightAt = (wind: number) => nightSolve({ demand: 750, wind, offer: -25, floors: true, out: '' });
  const night = useMemo(() => ({ calm: nightAt(175), windy: nightAt(350), loose: nightSolve({ demand: 750, wind: 350, offer: -25, floors: false, out: '' }) }), []);

  return (
    <LessonPage id="5.5">
      <P>
        Most of the time, electricity prices move in a narrow band, set by the running costs of whichever plant is on the margin: a few tens of dollars per
        megawatt-hour. A few hours a year they leave that band entirely. They can jump to hundreds or thousands of dollars, and they can fall below zero, so that
        generators pay to produce. Neither extreme is a malfunction. Both are the market reporting, accurately, that the grid has run short of something.
      </P>

      <H2>Scarcity in one place</H2>
      <P>
        <a href={lessonHref('4.6')}>Lesson 4.6</a> showed what happens when the whole region runs short. Energy and reserves are cleared together, and once there isn’t
        enough capacity left to hold the reserve the operator wants, every missing megawatt is priced at an administrative <b>shortage price</b>, which lifts the energy
        price far above any plant’s running cost. If even that isn’t enough, customers are cut off, and the price becomes the <b>value of lost load</b> from{' '}
        <a href={lessonHref('2.6')}>Lesson 2.6</a>: an estimate of what an hour without power costs the people cut off. Those rare, extreme hours are how a plant needed
        only a few hours a year, like Eastgate, covers its fixed costs; where prices are capped too low for that, the capacity markets of Lesson 4.6 make up the rest.
      </P>
      <P>
        A network adds something new: scarcity can be local. Lesson 2.6 called Metro a load pocket — more than half of the region’s demand, fed by three lines, with just
        two plants of its own, Mill Creek ({mw(MILL.capacity)}) and Old Quay ({mw(QUAY.capacity)}). Once the lines into a pocket are full, it can’t import another
        megawatt, however much spare capacity the rest of the region has. Here is the region at noon, with Valley solar producing{' '}
        {mw(POCKET_GENS.find((g) => g.id === 'solar')!.capacity)} and demand outside Metro as usual, but with Central–Metro, Metro’s main line, out of service. Only
        East–Metro and West–Metro remain, {mw(IMPORT_CAP_OUT)} between them. Drag Metro’s demand up, as air conditioners come on across a hot city:
      </P>

      <Figure name="Extreme Price Laboratory" scenario={s}>
        <NetworkView
          ariaLabel={`The region at noon, Metro’s demand ${mw(st.metro)}. ${st.out ? 'Central–Metro is out of service.' : 'Every line is in service.'} Prices: ${REGION.nodes.map((x) => `${x.name} ${usd(pr.lmp[x.id] ?? 0, 2)}`).join(', ')}. ${shed > 0.5 ? `${mw(shed)} cut off in Metro.` : ''}`}
          width={600}
          height={408}
          onNodeClick={(id) => s.set((p) => ({ temp: p.temp === id ? '' : id }))}
          nodes={REGION.nodes.map((x) => ({
            id: x.id,
            x: x.x,
            y: x.y,
            r: 32,
            label: x.name,
            labelPos: x.id === 'west' ? 'below' : x.id === 'city' ? 'right' : 'above',
            value: usd(pr.lmp[x.id] ?? 0),
            sub: 'per MWh',
            // Cap the shade so the price stays legible at the value of lost load.
            fill: priceFill(Math.min(200, pr.lmp[x.id] ?? 0)),
          }))}
          lines={REGION.lines.map((l) => {
            const out = st.out && l.id === MAIN_LINE;
            const [dx, dy] = LABEL_OFFSET[l.id] ?? [0, -10];
            return {
              id: l.id,
              from: l.from,
              to: l.to,
              flow: out ? 0 : pr.flows[l.id],
              limit: l.limit,
              out,
              label: out ? 'out of service' : `${fmt(Math.abs(pr.flows[l.id]))} / ${fmt(l.limit)}`,
              labelDx: dx,
              labelDy: dy,
            };
          })}
        >
          {(['cc2', 'oil', ...(st.temp === 'city' ? ['temp'] : [])] as string[]).map((id, i) => (
            <text key={id} x={510} y={336 + i * 16} textAnchor="middle" style={{ fontSize: 12, fill: '#444' }}>
              <tspan style={{ fontWeight: 500 }}>{LOCAL_SHORT[id]}</tspan> {fmt(pr.dispatch[id] ?? 0)} of {fmt(id === 'temp' ? TEMP.capacity : fleetById(id).capacity)} MW
            </text>
          ))}
          <text x={510} y={336 + (st.temp === 'city' ? 3 : 2) * 16} textAnchor="middle" style={{ fontSize: 12, fill: shed > 0.5 ? '#c4382f' : '#444', fontWeight: shed > 0.5 ? 600 : 400 }}>
            {shed > 0.5 ? `${fmt(shed)} MW cut off` : `imports ${fmt(imports)} of ${fmt(importCap)} MW`}
          </text>
          {st.temp &&
            (() => {
              const x = REGION.nodes.find((q) => q.id === st.temp)!;
              return <circle cx={x.x} cy={x.y} r={38} fill="none" stroke="#3f7a1e" strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />;
            })()}
        </NetworkView>
        <svg
          className="chart"
          viewBox="0 0 600 158"
          role="img"
          aria-label={`Metro’s price against its demand on a logarithmic scale. At ${mw(st.metro)} it is ${usd(metroPrice, 2)}; the highest price elsewhere is ${usd(maxOther, 2)}.`}
        >
          <text className="ax" x={70} y={12}>
            Price, $ per MWh (each gridline is ten times the one below)
          </text>
          {shedFrom !== undefined && (
            <g>
              <rect x={X(shedFrom - 2.5)} y={22} width={X(M_MAX) - X(shedFrom - 2.5)} height={96} fill="#e75b55" opacity={0.14} />
              <text x={X(shedFrom - 2.5) + 6} y={36} style={{ fontSize: 12, fill: '#c4382f', fontWeight: 500 }}>
                cut off
              </text>
            </g>
          )}
          {[10, 100, 1000, 10000].map((t) => (
            <g key={t}>
              <line className={t === 10 ? 'base' : 'gl'} x1={70} x2={X(M_MAX)} y1={yOf(t)} y2={yOf(t)} />
              <text className="ax ax-e" x={64} y={yOf(t) + 4}>
                ${fmt(t)}
              </text>
            </g>
          ))}
          {[600, 700, 800, 900, 1000].map((d) => (
            <text key={d} className="ax ax-m" x={X(d)} y={134}>
              {fmt(d)}
            </text>
          ))}
          <text className="ax ax-e" x={X(M_MAX)} y={153}>
            Demand in Metro, MW
          </text>
          <path d={stepLine(cv.ms.map(X), cv.other.map(yOf))} fill="none" stroke="#8a8a8a" strokeWidth={2} strokeDasharray="6 4" />
          <path d={stepLine(cv.ms.map(X), cv.metro.map(yOf))} fill="none" stroke="#3f7a1e" strokeWidth={3} strokeLinejoin="round" />
          {(() => {
            // Name the two lines at their right-hand ends, or once if they coincide.
            const ym = yOf(cv.metro[cv.metro.length - 1]);
            const yo = yOf(cv.other[cv.other.length - 1]);
            const style = { fontSize: 12, fontWeight: 500 } as const;
            return Math.abs(ym - yo) < 14 ? (
              <text x={X(M_MAX) + 6} y={ym + 4} style={{ ...style, fill: '#3f7a1e' }}>
                everywhere
              </text>
            ) : (
              <g>
                <text x={X(M_MAX) + 6} y={ym + 4} style={{ ...style, fill: '#3f7a1e' }}>
                  Metro
                </text>
                <text x={X(M_MAX) + 6} y={yo + 4} style={{ ...style, fill: '#6b6b6b' }}>
                  elsewhere,
                </text>
                <text x={X(M_MAX) + 6} y={yo + 18} style={{ ...style, fill: '#6b6b6b' }}>
                  highest
                </text>
              </g>
            );
          })()}
          <line className="cur" x1={X(st.metro)} x2={X(st.metro)} y1={22} y2={118} />
          <circle cx={X(st.metro)} cy={yOf(metroPrice)} r={6} fill="#3f7a1e" stroke="#f8f8f8" strokeWidth={2} />
        </svg>
        <Slider label="Demand in Metro" tone="orange" value={st.metro} min={M_MIN} max={M_MAX} step={10} onChange={(v) => s.set({ metro: v })} display={mw(st.metro)} />
        <Checkbox label="Central–Metro out of service" checked={st.out} onChange={(v) => s.set({ out: v })} />
        <Caption>{caption}</Caption>
      </Figure>

      <P>
        At {mw(POCKET_START)}, nothing is unusual: no line is full, and every substation pays Ironwood’s {usd(P_START.lmp.city)}. Past about {mw(650)}, West–Metro
        fills and Metro’s price separates. Mill Creek, inside the city, sets it at {usd(P_WEST.lmp.city)}, while the rest of the region pays between{' '}
        {usd(Math.min(...otherPrices(P_WEST)))} and {usd(Math.max(...otherPrices(P_WEST)), 2)}. By {mw(900)}, Mill Creek is flat out and East–Metro is full too. Now
        every further megawatt has to be made inside the city, and Old Quay sets Metro’s price at {usd(P_CUT.lmp.city)}. Past{' '}
        {mw(IMPORT_CAP_OUT + MILL.capacity + QUAY.capacity)}, Old Quay is full as well, and the only way left to balance Metro is to cut customers off: its price
        becomes the value of lost load, {usd(VOLL)}, while outside the city nobody pays more than {usd(Math.max(...otherPrices(P_SHED)), 2)}.
      </P>
      <P>
        Lesson 2.6 put the value of lost load at {usd(VOLL_2_6)} per megawatt-hour. Markets that also price reserve shortfalls have to set it higher than any shortage
        price plus a plant’s running cost, or the optimizer would rather cut customers off than run short of reserve, so here we use {usd(VOLL)}, which is also where
        Texas caps its prices today.
      </P>
      <P>
        Now untick the box to put Central–Metro back. At {mw(1000)} in Metro, the demand that was cutting {mw(P_SHED.shed.city ?? 0)} of customers off costs{' '}
        {usd(P_IN.lmp.city)} everywhere: the rest of the region had capacity to spare all along, and the line is what lets it reach the city. That is what makes local
        scarcity different. It isn’t a shortage of generation, but of generation in the right place, and the price reports it only where it’s true. Real load pockets,
        such as New York City, the Boston area and the San Francisco Peninsula, get rules of their own: reserves that must be held inside the pocket, capacity that
        must be located there, and contracts that keep local plants available when the market alone wouldn’t.
      </P>

      <Challenge
        id="b"
        figure="Extreme Price Laboratory"
        question={`With Central–Metro out of service, set Metro’s demand to ${fmt(1000)} MW or more, so that customers are cut off. The operator can bring in ${TEMP.capacity} MW of temporary generators, offered at $${TEMP.offer} per MWh (illustrative numbers). Click a substation on the map to put them there, and keep every customer connected.`}
        solved={pocketOk}
        status={
          !st.out
            ? 'Central–Metro is in service, so Metro isn’t a pocket. Tick the box to take it out again.'
            : st.metro < 1000
              ? `Metro’s demand is ${mw(st.metro)}; raise it to at least ${mw(1000)}.`
              : shed > 0.5
                ? `${mw(shed)} of Metro’s customers are cut off${st.temp ? `, while the temporary generators at ${nodeName(REGION, st.temp)} produce ${mw(pr.dispatch.temp ?? 0)}` : ''}.`
                : 'Nobody is cut off.'
        }
        success={`Solved. Only generators inside Metro help: with East–Metro and West–Metro both full, nothing outside the city can deliver another megawatt to it, however cheap. In Metro the temporary generators run ${mw(pr.dispatch.temp ?? 0)} and set the city’s price at ${usd(TEMP.offer)}; the rest of the region doesn’t notice.`}
      />

      <H2>Too much power</H2>
      <P>
        The other extreme comes at night, when demand is low and the wind is strong. Some plants can’t simply turn off. Harbor Point, our nuclear plant, can’t run
        below 360 MW without shutting down, and restarting a nuclear plant can take days. Ironwood coal has a minimum stable output of 120 MW. Wind farms, meanwhile, often earn money for
        every megawatt-hour they produce whatever the price — in the United States through a federal production tax credit and the sale of renewable energy
        certificates — so a wind farm can pay to produce and still come out ahead. It offers its output at a negative price, here −$25.
      </P>
      <P>
        Here’s the region at 03:00, with demand at {mw(750)} and Ridge wind at half its capacity. Prices are shaded on the map, with negative prices in blue. When the
        grid can’t use all the wind, the operator <b>curtails</b> it — tells the wind farm to produce less than the wind allows — and the readout counts how much.
        Raise the wind and watch the price fall. You can also click any line to take it out of service, and click it again to restore it:
      </P>

      <Figure name="Extreme Price Laboratory · too much power" scenario={n}>
        <NetworkView
          ariaLabel={`The region at night. Prices from ${usd(lo)} to ${usd(hi)} per MWh. ${n.state.out ? `Line ${lineName(n.state.out)} is out of service.` : 'All lines in service.'} Wind curtailed: ${fmt(curtailed)} MW.`}
          width={600}
          height={408}
          onLineClick={toggleLine}
          nodes={REGION.nodes.map((x) => ({
            id: x.id,
            x: x.x,
            y: x.y,
            r: 32,
            label: x.name,
            labelPos: x.id === 'west' ? 'below' : x.id === 'city' ? 'right' : 'above',
            value: r.feasible ? usd(r.lmp[x.id] ?? 0) : '—',
            sub: 'per MWh',
            fill: priceFill(r.lmp[x.id] ?? 0),
          }))}
          lines={REGION.lines.map((l) => {
            const out = l.id === n.state.out;
            const [dx, dy] = LABEL_OFFSET[l.id] ?? [0, -10];
            return {
              id: l.id,
              from: l.from,
              to: l.to,
              flow: out ? 0 : r.flows[l.id],
              limit: l.limit,
              out,
              label: out ? 'out of service' : `${fmt(Math.abs(r.flows[l.id]))} / ${fmt(l.limit)}`,
              labelDx: dx,
              labelDy: dy,
            };
          })}
        >
          <text x={22} y={124} style={{ fontSize: 12, fill: '#444' }}>
            <tspan style={{ fontWeight: 500 }}>Ridge wind</tspan> {fmt(r.dispatch.wind ?? 0)} of {fmt(n.state.wind)} MW
          </text>
          <text x={22} y={140} style={{ fontSize: 12, fill: '#444' }}>
            <tspan style={{ fontWeight: 500 }}>Falls hydro</tspan> {fmt(r.dispatch.hydro ?? 0)} MW
          </text>
          <text x={22} y={312} style={{ fontSize: 12, fill: '#444' }}>
            <tspan style={{ fontWeight: 500 }}>Harbor Point</tspan> {fmt(r.dispatch.nuc ?? 0)} MW
          </text>
          <text x={190} y={350} textAnchor="end" style={{ fontSize: 12, fill: '#444' }}>
            <tspan style={{ fontWeight: 500 }}>Ironwood</tspan> {fmt(r.dispatch.coal ?? 0)} MW
          </text>
          <text x={340} y={160} style={{ fontSize: 12, fill: '#444' }}>
            <tspan style={{ fontWeight: 500 }}>Lakeside</tspan> {fmt(r.dispatch.cc1 ?? 0)} MW
          </text>
        </NetworkView>
        <Readouts items={[{ label: 'wind curtailed', value: mw(curtailed), tone: curtailed > 0.5 ? 'blue' : undefined }]} />
        <Slider label="Ridge wind output" tone="teal" value={n.state.wind} min={0} max={350} step={5} onChange={(v) => n.set({ wind: v })} display={mw(n.state.wind)} />
        <Slider label="Demand" value={n.state.demand} min={600} max={1100} step={10} onChange={(v) => n.set({ demand: v })} display={mw(n.state.demand)} />
        <Slider
          label="Ridge wind’s offer"
          tone="green"
          value={n.state.offer}
          min={-40}
          max={0}
          step={1}
          onChange={(v) => n.set({ offer: v })}
          display={`${usd(n.state.offer)} per MWh`}
        />
        <Checkbox label="Must-run floors: Harbor Point at least 360 MW, Ironwood at least 120 MW" checked={n.state.floors} onChange={(v) => n.set({ floors: v })} />
      </Figure>

      <P>
        At first, the price is set by Falls hydro at {usd(night.calm.lmp.city ?? 0)}: the dam holds back water whenever there’s cheaper power around. As the wind rises, hydro backs off until it’s
        producing nothing, then Harbor Point turns down toward its floor, and the price falls to its $9 offer. Push the wind further and the floors plus the wind exceed demand: with all 350 MW
        blowing, the price is {usd(night.windy.lmp.city ?? 0)}. Something has to give, and the cheapest thing to give up is wind. The operator curtails it, and the price becomes the wind farm’s own offer: one more megawatt of demand would let it curtail one megawatt less, and
        the wind farm is willing to pay $25 for that; change its offer and the price follows. Untick the floors and Ironwood can shut down altogether, leaving room for every megawatt of wind. Harbor Point
        then runs at its full {mw(night.loose.dispatch.nuc ?? 0)}, so the next megawatt would have to come from Falls hydro, and the price is back to hydro’s{' '}
        {usd(night.loose.lmp.city ?? 0)}.
      </P>

      <Challenge
        id="a"
        question="In the second demonstration, produce a negative price at one substation while another has a positive price. Hint: the wind has to be trapped behind a full line. Take North–Central, the North’s main line, out of service, so that Ridge wind can leave the North only over North–East. Then find a wind that fills that line and a demand at which the rest of the region still needs power from plants that burn fuel."
        solved={mixed}
        status={
          r.feasible
            ? `Prices run from ${usd(lo, 2)} to ${usd(hi, 2)} per megawatt-hour.${n.state.out ? '' : ' Every line is in service.'}`
            : 'There’s no feasible dispatch with these settings.'
        }
        success={`Solved. ${REGION.nodes
          .filter((x) => (r.lmp[x.id] ?? 0) < 0)
          .map((x) => x.name)
          .join(' and ')} ${REGION.nodes.filter((x) => (r.lmp[x.id] ?? 0) < 0).length > 1 ? 'are' : 'is'} trapped behind a full line: the wind there can’t get out, so it’s curtailed and sets a negative price, while the rest of the grid pays a positive one.`}
      />

      <P>
        With every line in service, the region’s network can carry Ridge wind anywhere, so the price is negative everywhere or nowhere. To separate them you need
        congestion: take out a line that wind has to use, and keep demand high enough that the rest of the grid still wants power. Then North’s price is set by
        curtailed wind while everyone else’s is set by a plant that’s burning fuel. In real markets, this is common at the far ends of wind-heavy regions such as West
        Texas, where nodal prices fall below zero on windy nights while prices in the cities stay positive.
      </P>
      <P>
        Negative prices are a signal too. They tell inflexible plants that flexibility would pay, batteries and pumped storage to charge, flexible customers to shift
        their use into those hours, and subsidized generators exactly when to stop. Where they show up persistently in one place, they point to where a new line or a
        battery would be most valuable. Markets put floors under them as well, such as −€500 per megawatt-hour in Europe’s day-ahead auctions and −A$1,000 in
        Australia’s National Electricity Market.
      </P>
      <P>
        Both extremes are what happens when the operator runs out of options: no spare capacity where it’s needed in one case, no flexibility in the other. The{' '}
        <a href={lessonHref('5.6')}>last lesson of this chapter</a> is about the option operators protect most carefully of all — keeping the grid within its limits
        even after a line suddenly fails.
      </P>
    </LessonPage>
  );
}
