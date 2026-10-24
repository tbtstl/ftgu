import { useMemo } from 'react';
import {
  Challenge,
  DataTable,
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
  Swatch,
  Tn,
  fmt,
  lessonHref,
  pct,
  tint,
  useScenario,
} from '../../../framework';
import { fleetRequirement, type Requirement } from '../../../engines/shipping/market';
import { seaRoute } from '../../../engines/shipping/network';
import { PLACE } from '../../../model/shipping/geo';
import { MARKET_CLASSES, OFF_HIRE_DAYS, routesOf, type ClassId } from '../../../model/shipping/trades';
import { HISTORY_EVENTS, HISTORY_MONTHS, standardHistory } from '../../../model/shipping/history';
import { WorldMap } from '../shared/WorldMap';
import { XYChart } from '../shared/XYChart';

const CAPE_ROUTES = routesOf('cape');
const FLEET = MARKET_CLASSES.cape.fleet;
const EARNING_DAYS = 365 - OFF_HIRE_DAYS;
const LADEN_KN = 12;
const BALLAST_KN = 13;
/** Routes that end in Qingdao, whose combined tonnes the challenge holds fixed. */
const QIN_ROUTES = CAPE_ROUTES.filter((r) => r.to === 'QIN').map((r) => r.id);
const OTHER_ROUTES = CAPE_ROUTES.filter((r) => r.to !== 'QIN').map((r) => r.id);
export const BASE_MT: Record<string, number> = Object.fromEntries(CAPE_ROUTES.map((r) => [r.id, r.mtpa]));
export const QIN_TONNES = QIN_ROUTES.reduce((s, id) => s + BASE_MT[id], 0);
export const EXTRA_SHIPS = 50;

const ROUTE_COLOR: Record<string, string> = {
  'C-PHE-QIN': GRAPHIC.orange,
  'C-TUB-QIN': GRAPHIC.violet,
  'C-TUB-ROT': GRAPHIC.blue,
  'C-NEW-QIN': GRAPHIC.gold,
  'C-RBY-PAR': GRAPHIC.teal,
};
const SLIDER_MAX: Record<string, number> = { 'C-PHE-QIN': 1200, 'C-TUB-QIN': 600, 'C-TUB-ROT': 100, 'C-NEW-QIN': 100, 'C-RBY-PAR': 60 };
const SLIDER_STEP: Record<string, number> = { 'C-PHE-QIN': 10, 'C-TUB-QIN': 10, 'C-TUB-ROT': 5, 'C-NEW-QIN': 5, 'C-RBY-PAR': 5 };
const POINTS = Object.fromEntries(CAPE_ROUTES.map((r) => [r.id, seaRoute(r.from, r.to)!.points]));

const placeName = (id: string) => PLACE[id].name;
const routeName = (id: string) => {
  const r = CAPE_ROUTES.find((x) => x.id === id)!;
  return `${placeName(r.from)} → ${placeName(r.to)}`;
};
const mt = (x: number) => `${fmt(x)} Mt`;
const nm = (x: number) => `${fmt(x)} nm`;

/** The Capesize trades' needs with each route's volume in million tonnes a year. */
export function capeNeeds(volumes: Record<string, number>): Requirement {
  const routeScale = Object.fromEntries(CAPE_ROUTES.map((r) => [r.id, (volumes[r.id] ?? r.mtpa) / r.mtpa]));
  return fleetRequirement('cape', { routeScale }, LADEN_KN, BALLAST_KN);
}

const BASE = capeNeeds(BASE_MT);

/**
 * The challenge: Qingdao still receives its 890 million tonnes, the trades to Rotterdam and Paradip are
 * untouched, and the Capesize trades need at least 50 more ships than at the start.
 */
export function sourcingSolved(volumes: Record<string, number>): boolean {
  const qin = QIN_ROUTES.reduce((s, id) => s + (volumes[id] ?? 0), 0);
  if (Math.abs(qin - QIN_TONNES) > 1e-6) return false;
  if (OTHER_ROUTES.some((id) => Math.abs((volumes[id] ?? 0) - BASE_MT[id]) > 1e-6)) return false;
  return capeNeeds(volumes).ships - BASE.ships >= EXTRA_SHIPS - 1e-9;
}

// Numbers the prose quotes.
const ROUTE_BASE = Object.fromEntries(BASE.routes.map((r) => [r.route.id, r]));
const HAUL_RATIO = ROUTE_BASE['C-TUB-QIN'].nm / ROUTE_BASE['C-PHE-QIN'].nm;
const shipsPer10 = (id: string) => capeNeeds({ ...BASE_MT, [id]: BASE_MT[id] + 10 }).ships - BASE.ships;
const PER10_PHE = shipsPer10('C-PHE-QIN');
const PER10_TUB = shipsPer10('C-TUB-QIN');
const SEA_LADEN = BASE.ladenMiles / (24 * LADEN_KN);
const SEA_BALLAST = BASE.ballastMiles / (24 * BALLAST_KN);
const ALL_AUS = capeNeeds({ ...BASE_MT, 'C-PHE-QIN': QIN_TONNES, 'C-TUB-QIN': 0, 'C-NEW-QIN': 0 }).ships;
const ALL_BRZ = capeNeeds({ ...BASE_MT, 'C-PHE-QIN': 0, 'C-TUB-QIN': QIN_TONNES, 'C-NEW-QIN': 0 }).ships;
const SHIFT_PER10 = capeNeeds({ ...BASE_MT, 'C-PHE-QIN': BASE_MT['C-PHE-QIN'] - 10, 'C-TUB-QIN': BASE_MT['C-TUB-QIN'] + 10 }).ships - BASE.ships;
/** The smallest shift from Port Hedland to Tubarão that adds 50 ships, Mt (to a tenth). */
const MIN_SHIFT = (() => {
  for (let s = 0; s <= 300; s += 0.1) {
    const v = { ...BASE_MT, 'C-PHE-QIN': BASE_MT['C-PHE-QIN'] - s, 'C-TUB-QIN': BASE_MT['C-TUB-QIN'] + s };
    if (capeNeeds(v).ships - BASE.ships >= EXTRA_SHIPS) return s;
  }
  return NaN;
})();
const KMAX_BASE = fleetRequirement('kmax', {}, LADEN_KN, BALLAST_KN);

// ---------------------------------------------------------------------------
// The history: each simulated month's tonnes, tonne-miles and ships needed.

interface MonthNeeds {
  tonnes: number;
  tonMiles: number;
  ships: number;
}

function historyNeeds(id: ClassId, withEvents = true): MonthNeeds[] {
  return standardHistory().cls[id].map((m, t) => {
    const ev = withEvents ? HISTORY_EVENTS.find((e) => t >= e.from && t < e.to) : undefined;
    const r = fleetRequirement(id, { demand: m.demand, month: m.month, routeScale: ev?.routeScale, closed: ev?.closed, congestion: ev?.congestion }, LADEN_KN, BALLAST_KN);
    return { tonnes: r.tonnes, tonMiles: r.tonMiles, ships: r.ships };
  });
}

const HIST: Record<ClassId, { actual: MonthNeeds[]; without: MonthNeeds[] }> = {
  cape: { actual: historyNeeds('cape'), without: historyNeeds('cape', false) },
  kmax: { actual: historyNeeds('kmax'), without: historyNeeds('kmax', false) },
};

/** An event's effect on a class: tonnes, tonne-miles and ships, against the same months without it. */
function eventEffect(id: ClassId, i: number) {
  const ev = HISTORY_EVENTS[i];
  const sum = (rows: MonthNeeds[], k: keyof MonthNeeds) => rows.slice(ev.from, ev.to).reduce((s, r) => s + r[k], 0);
  const a = HIST[id].actual;
  const w = HIST[id].without;
  const n = ev.to - ev.from;
  return {
    tonnes: sum(a, 'tonnes') / sum(w, 'tonnes') - 1,
    tonMiles: sum(a, 'tonMiles') / sum(w, 'tonMiles') - 1,
    ships: (sum(a, 'ships') - sum(w, 'ships')) / n,
  };
}

const CONGESTION = HISTORY_EVENTS.findIndex((e) => e.congestion);
const BRAZIL = HISTORY_EVENTS.findIndex((e) => e.routeScale);
const PANAMA = HISTORY_EVENTS.findIndex((e) => e.closed);
const BRAZIL_CAPE = eventEffect('cape', BRAZIL);
const PANAMA_KMAX = eventEffect('kmax', PANAMA);
const CONG_CAPE = eventEffect('cape', CONGESTION);
const CONG_KMAX = eventEffect('kmax', CONGESTION);
const SHORT_LABEL = ['China ports', 'Brazil ore', 'Panama'];

function yearAvg(rows: MonthNeeds[], y: number, k: keyof MonthNeeds) {
  return rows.slice(y * 12, y * 12 + 12).reduce((s, r) => s + r[k], 0) / 12;
}
const CAPE_GROWTH = yearAvg(HIST.cape.actual, 11, 'tonnes') / yearAvg(HIST.cape.actual, 0, 'tonnes') - 1;

export default function Lesson() {
  const tf = useScenario('trade-flows', { ...BASE_MT });
  const vols = tf.state as Record<string, number>;
  const need = useMemo(() => capeNeeds(vols), [vols]);
  const extra = need.ships - BASE.ships;
  const qin = QIN_ROUTES.reduce((s, id) => s + vols[id], 0);
  const othersChanged = OTHER_ROUTES.filter((id) => vols[id] !== BASE_MT[id]);
  const solved = sourcingSolved(vols);
  const totalT = need.tonnes;
  const rows = need.routes.map((r) => ({
    id: r.route.id,
    mt: vols[r.route.id],
    nm: r.nm,
    tm: r.tonMiles,
    shareT: totalT > 0 ? (r.voyages * MARKET_CLASSES.cape.cargo) / totalT : 0,
    shareTm: need.tonMiles > 0 ? r.tonMiles / need.tonMiles : 0,
  }));
  const seaL = need.ladenMiles / (24 * LADEN_KN);
  const seaB = need.ballastMiles / (24 * BALLAST_KN);

  const hs = useScenario('history', { cls: 'cape' as ClassId, year: 6 });
  const id = hs.state.cls;
  const series = useMemo(() => {
    const a = HIST[id].actual;
    const y1t = yearAvg(a, 0, 'tonnes');
    const y1m = yearAvg(a, 0, 'tonMiles');
    const xs = a.map((_, t) => t / 12);
    const tn = a.map((r) => (100 * r.tonnes) / y1t);
    const tm = a.map((r) => (100 * r.tonMiles) / y1m);
    const lo = Math.floor(Math.min(...tn, ...tm) / 20) * 20;
    const hi = Math.ceil(Math.max(...tn, ...tm) / 20) * 20;
    return { xs, tn, tm, lo, hi, y1t, y1m };
  }, [id]);
  const y = hs.state.year - 1;
  const yt = (100 * yearAvg(HIST[id].actual, y, 'tonnes')) / series.y1t;
  const ym = (100 * yearAvg(HIST[id].actual, y, 'tonMiles')) / series.y1m;
  const ys = yearAvg(HIST[id].actual, y, 'ships');
  const className = MARKET_CLASSES[id].name;
  const yearEvents = HISTORY_EVENTS.filter((e) => e.from < (y + 1) * 12 && e.to > y * 12);

  return (
    <LessonPage id="shipping/3.5">
      <P>
        This chapter has measured the world a ship sails through: the length of its sea lanes in <a href={lessonHref('shipping/3.1')}>Lesson 3.1</a>, the days lost
        in port queues in <a href={lessonHref('shipping/3.2')}>Lesson 3.2</a>, the detours forced by closed canals in <a href={lessonHref('shipping/3.3')}>Lesson 3.3</a>,
        and the empty voyages back to the next cargo in <a href={lessonHref('shipping/3.4')}>Lesson 3.4</a>. Each of them uses up ship time. This lesson adds them
        up into the demand for ships itself: how many ships does the world’s trade need, and why does distance matter as much as tonnes?
      </P>
      <P>
        A tonne of iron ore moved from Western Australia to China and a tonne moved from Brazil to China are the same tonne to the steel mill. To a shipowner they
        are very different, because one occupies a ship almost three times as long as the other. Shipping counts its work in{' '}
        <K tone="orange">tonne-miles</K>: one tonne carried one nautical mile. Tonnes times distance, summed over every trade, is the demand that ships have to
        meet.
      </P>
      <P>
        The course’s Capesize world has five trades, carrying {mt(BASE.tonnes / 1e6)} a year between them — round, illustrative volumes of a realistic size, not
        market data. In the next demonstration each trade’s line on the map is drawn as thick as its volume. Change the volumes and watch the tonnes, the
        tonne-miles and the number of Capesizes it takes to carry them all, sailing at {LADEN_KN} knots laden and {BALLAST_KN} in ballast:
      </P>

      <Figure name="Global Trade Flow Model" scenario={tf}>
        <WorldMap
          ariaLabel={`The Capesize trades: ${CAPE_ROUTES.map((r) => `${routeName(r.id)} ${mt(vols[r.id])}`).join(', ')}. They need ${fmt(need.ships)} ships.`}
          lanes={false}
          routes={CAPE_ROUTES.filter((r) => vols[r.id] > 0).map((r) => ({ points: POINTS[r.id], color: ROUTE_COLOR[r.id], width: 0.8 + vols[r.id] * 0.012, opacity: 0.85 }))}
          ports={['TUB', 'ROT', 'RBY', 'PHE', 'NEW', 'PAR', 'QIN'].map((p) => ({
            id: p,
            sub: p === 'QIN' ? `${mt(qin)} in` : undefined,
          }))}
        />
        <Readouts
          items={[
            { label: 'cargo a year', value: mt(need.tonnes / 1e6), tone: 'orange' },
            { label: 'tonne-miles a year', value: `${fmt(need.tonMiles)} billion`, tone: 'orange' },
            { label: 'average haul', value: need.tonnes > 0 ? nm((need.tonMiles * 1e9) / need.tonnes) : '—', tone: 'blue' },
            { label: 'ballast miles per laden mile', value: fmt(need.ballastRatio, 2), tone: 'blue' },
            { label: `Capesizes needed, of a fleet of ${fmt(FLEET)}`, value: fmt(need.ships), tone: need.ships > FLEET ? 'red' : undefined },
          ]}
        />
        {CAPE_ROUTES.map((r) => (
          <Slider
            key={r.id}
            label={
              <>
                <Swatch color={ROUTE_COLOR[r.id]} />
                {routeName(r.id)}, {r.commodity}
              </>
            }
            tone="orange"
            value={vols[r.id]}
            min={0}
            max={SLIDER_MAX[r.id]}
            step={SLIDER_STEP[r.id]}
            onChange={(v) => tf.set({ [r.id]: v })}
            display={`${fmt(vols[r.id])} Mt/yr`}
          />
        ))}
        <DataTable
          caption="Each Capesize trade's tonnes, distance and tonne-miles"
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { label: 'Trade', cell: (r) => <><Swatch color={ROUTE_COLOR[r.id]} />{routeName(r.id)}</> },
            { label: 'Mt', cell: (r) => fmt(r.mt), align: 'right' },
            { label: 'Distance, nm', cell: (r) => fmt(r.nm), align: 'right' },
            { label: 'Bn t-miles', cell: (r) => fmt(r.tm), align: 'right' },
            { label: 'Of tonnes', cell: (r) => pct(r.shareT), align: 'right' },
            { label: 'Of t-miles', cell: (r) => pct(r.shareTm), align: 'right' },
          ]}
        />
        <Eq label={`Ships needed equals port days plus sea days, divided by ${EARNING_DAYS} earning days: ${fmt(need.ships)} ships`}>
          <span>ships</span>
          <Op>=</Op>
          <Frac top={<span>port days + sea days</span>} bottom={<span>{EARNING_DAYS} earning days</span>} />
          <Op>=</Op>
          <Frac
            top={
              <span>
                {fmt(need.portDays)} + <Tn tone="teal">{fmt(seaL + seaB)}</Tn>
              </span>
            }
            bottom={<span>{EARNING_DAYS}</span>}
          />
          <Op>=</Op>
          <span>{fmt(need.ships)}</span>
        </Eq>
      </Figure>

      <P>
        At the starting volumes, Port Hedland to Qingdao carries {pct(ROUTE_BASE['C-PHE-QIN'].voyages * MARKET_CLASSES.cape.cargo / BASE.tonnes)} of the tonnes but
        only {pct(ROUTE_BASE['C-PHE-QIN'].tonMiles / BASE.tonMiles)} of the tonne-miles. Tubarão to Qingdao carries{' '}
        {pct(ROUTE_BASE['C-TUB-QIN'].voyages * MARKET_CLASSES.cape.cargo / BASE.tonnes)} of the tonnes and{' '}
        {pct(ROUTE_BASE['C-TUB-QIN'].tonMiles / BASE.tonMiles)} of the tonne-miles: it is the biggest trade in the model, measured the way ships feel it. Its
        haul, {nm(ROUTE_BASE['C-TUB-QIN'].nm)} round the Cape of Good Hope, is {fmt(HAUL_RATIO, 1)} times the {nm(ROUTE_BASE['C-PHE-QIN'].nm)} from Port Hedland.
        Averaged over every tonne, the Capesize trades carry their cargo {nm((BASE.tonMiles * 1e9) / BASE.tonnes)}.
      </P>
      <P>
        Now add ten million tonnes to each trade in turn and watch the ships. Ten more from Port Hedland need {fmt(PER10_PHE, 1)} more Capesizes; ten more from
        Tubarão need {fmt(PER10_TUB, 1)}, {fmt(PER10_TUB / PER10_PHE, 1)} times as many. That is a little less than the ratio of the distances, because every
        voyage also spends days in port loading and discharging, however far it sails.
      </P>

      <H2>What a ship’s year buys</H2>
      <P>
        The equation in the demonstration is the whole of it. Every voyage costs port days — {fmt(BASE.portDays)} a year across the starting trades — and sea
        days, which are miles divided by miles a day. Laden, the trades sail {fmt(BASE.ladenMiles / 1e6, 1)} million miles a year, {fmt(SEA_LADEN)} days at{' '}
        {LADEN_KN} knots. Each of those miles also has to be sailed back empty: the ore and coal never return, so in our Capesize world there is exactly one ballast
        mile for every laden one, another {fmt(SEA_BALLAST)} days at {BALLAST_KN} knots. A ship is available for {EARNING_DAYS} days a year once drydockings and
        repairs are taken out, so the trades need {fmt(BASE.ships)} ships. The Kamsarmax trades, whose ships can sometimes find their next cargo nearer their last
        port, need {fmt(KMAX_BASE.ballastRatio, 2)} ballast miles per laden mile.
      </P>
      <P>
        The model’s Capesize fleet has {fmt(FLEET)} ships, more than enough at these speeds. But speed is a choice, as <a href={lessonHref('shipping/2.3')}>Lesson
        2.3</a> showed: sail slower and every mile takes longer, so the same trades need more ships. How fast the fleet actually sails depends on what its cargoes
        pay, and that is a question for the next chapter.
      </P>

      <H2>Where China buys its ore</H2>
      <P>
        Qingdao takes {mt(QIN_TONNES)} a year from three sources. Suppose its buyers change where that ore comes from, but not how much they buy. Take it all
        from Western Australia and the Capesize trades need {fmt(ALL_AUS)} ships; take it all from Brazil and they need {fmt(ALL_BRZ)}, far more than the whole
        fleet. Every ten million tonnes switched from Port Hedland to Tubarão ties up {fmt(SHIFT_PER10, 1)} more Capesizes. For shipowners, where a country buys
        its raw materials matters as much as how much it buys.
      </P>

      <Challenge
        id="a"
        question={`Keep the ${mt(QIN_TONNES)} arriving in Qingdao, and leave the trades to Rotterdam and Paradip as they are, but change where Qingdao’s ore and coal come from so that the trades need at least ${EXTRA_SHIPS} more Capesizes.`}
        solved={solved}
        status={
          othersChanged.length
            ? `Set ${othersChanged.map(routeName).join(' and ')} back to ${othersChanged.map((id) => mt(BASE_MT[id])).join(' and ')}.`
            : Math.abs(qin - QIN_TONNES) > 1e-6
              ? `Qingdao now receives ${mt(qin)}; it should receive ${mt(QIN_TONNES)}.`
              : `Qingdao receives ${mt(qin)}, and the trades need ${fmt(extra, 1)} more ships than at the start.`
        }
        success={`Solved. The trades now need ${fmt(extra, 1)} more Capesizes for the same ${mt(QIN_TONNES)} into Qingdao. Moving about ${fmt(MIN_SHIFT)} million tonnes from Port Hedland to Tubarão is enough on its own: each tonne switched sails ${fmt(HAUL_RATIO, 1)} times as far laden, and as far again back in ballast.`}
      />

      <H2>Twelve years of trade</H2>
      <P>
        Demand for ships changes with both tonnes and distance. In the next demonstration, the twelve simulated years of <a href={lessonHref('shipping/2.5')}>Lesson
        2.5</a> are turned into trade: each month’s cargo volumes, with their seasons, their growth and shocks, and the three disruptions written into the
        history. Both lines are indexed to their Year 1 average, so they start together at 100. Choose a size class, and step through the years:
      </P>

      <Figure name="Global Trade Flow Model · history" scenario={hs}>
        <Segmented
          label="Size class"
          value={id}
          onChange={(v) => hs.set({ cls: v })}
          options={[
            { value: 'cape', label: 'Capesize' },
            { value: 'kmax', label: 'Kamsarmax' },
          ]}
        />
        <Legend
          items={[
            { label: 'Tonnes', color: GRAPHIC.orange, kind: 'line' },
            { label: 'Tonne-miles', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Disruptions', color: tint(GRAPHIC.red, 0.3) },
          ]}
        />
        <XYChart
          ariaLabel={`${className} tonnes and tonne-miles over twelve simulated years, indexed to Year 1 = 100. In Year ${hs.state.year} tonnes average ${fmt(yt)} and tonne-miles ${fmt(ym)}.`}
          series={[
            { xs: series.xs, ys: series.tn, color: GRAPHIC.orange, width: 2 },
            { xs: series.xs, ys: series.tm, color: GRAPHIC.blue, width: 1.8 },
          ]}
          xMin={0}
          xMax={HISTORY_MONTHS / 12}
          yMin={series.lo}
          yMax={series.hi}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => fmt(v)}
          yLabel="Index, Year 1 = 100"
          height={230}
          bands={[
            { from: y, to: y + 1, color: tint(GRAPHIC.gray, 0.12) },
            ...HISTORY_EVENTS.map((e, i) => ({ from: e.from / 12, to: e.to / 12, color: tint(GRAPHIC.red, 0.3), label: SHORT_LABEL[i] })),
          ]}
        />
        <Readouts
          items={[
            { label: `tonnes in Year ${hs.state.year}`, value: fmt(yt), tone: 'orange' },
            { label: 'tonne-miles', value: fmt(ym), tone: 'blue' },
            { label: `${className}s needed at ${LADEN_KN} and ${BALLAST_KN} knots`, value: fmt(ys) },
            { label: 'disruptions that year', value: yearEvents.length ? yearEvents.map((e) => e.label).join('; ') : 'none' },
          ]}
        />
        <Slider label="Year" tone="teal" value={hs.state.year} min={1} max={HISTORY_MONTHS / 12} onChange={(v) => hs.set({ year: v })} display={`Year ${hs.state.year}`} />
      </Figure>

      <P>
        Most of the time the two lines move together. Growth and the history’s demand shocks scale every trade at once, so tonnes and tonne-miles rise and fall
        in step: by Year 12 Capesize cargoes are {pct(CAPE_GROWTH)} above Year 1, and so is the work they make. The lines part only when the mix changes. When
        Brazil’s ore mines are disrupted in Year 6, Capesize tonnes fall {pct(-BRAZIL_CAPE.tonnes, 1)} below what the same months would otherwise have carried,
        but tonne-miles fall {pct(-BRAZIL_CAPE.tonMiles, 1)}, because it is the longest haul that stops. The trades need {fmt(-BRAZIL_CAPE.ships)} fewer
        Capesizes while it lasts.
      </P>
      <P>
        Switch to Kamsarmaxes and find the Panama restriction in Year 9. Not a tonne of cargo is lost: grain from the US Gulf still reaches China, the long way
        round through Suez. Tonnes stay where they were, but tonne-miles rise {pct(PANAMA_KMAX.tonMiles, 1)}, and the trades need {fmt(PANAMA_KMAX.ships)} more
        ships. The congestion in China in Year 4 changes neither line at all, yet it ties up {fmt(CONG_CAPE.ships)} Capesizes and {fmt(CONG_KMAX.ships)}{' '}
        Kamsarmaxes waiting at anchor: tonne-miles measure the work, and port days come on top. In{' '}
        <FigRef to="Global Trade Flow Model">the first demonstration</FigRef>, that is the port-days term of the equation.
      </P>
      <P>
        We now know what the world asks of its ships — tonne-miles, the ballast that comes with them and the days in port — and, from Chapter 2, what the fleet
        can give: so many ships, sailing as fast as their owners choose. In <a href={lessonHref('shipping/4.1')}>Chapter 4</a> the two meet, and the meeting
        has a price. We’ll see how a fleet of ships scattered across the oceans becomes a market for freight, and why its rates can double in a season.
      </P>
    </LessonPage>
  );
}
