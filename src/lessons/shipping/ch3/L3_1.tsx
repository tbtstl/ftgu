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
  Segmented,
  TEXT,
  Tn,
  fmt,
  lessonHref,
  pct,
  useScenario,
} from '../../../framework';
import { CHOKEPOINTS, PLACE, PLACES, greatCircleNm } from '../../../model/shipping/geo';
import { MARKET_CLASSES, ROUTES, type ClassId } from '../../../model/shipping/trades';
import { KESTREL } from '../../../model/shipping/vessels';
import { seaRoute, type SeaRoute } from '../../../engines/shipping/network';
import { fuelPerDay, ladenDraft } from '../../../engines/shipping/voyage';
import { WorldMap, type MapPort } from '../shared/WorldMap';

/** Kestrel carrying 75,000 t, as in Chapter 2. */
const LADEN = ladenDraft(KESTREL, 75_000);
const CARGO_PORTS = PLACES.filter((p) => p.port).map((p) => p.id);
/** The chapter's laden speed, knots. */
export const SPEED = 12;
const nm = (x: number) => `${fmt(x)} nm`;
const days1 = (x: number) => `${fmt(x, 1)} days`;

/** Kestrel's laden route between two ports. */
export function routeBetween(from: string, to: string): SeaRoute {
  return seaRoute(from, to, { draft: LADEN })!;
}

/** The cargo port farthest from Qingdao by sea, for Kestrel laden. */
export const FARTHEST_FROM_QINGDAO = CARGO_PORTS.filter((p) => p !== 'QIN').reduce((a, b) => (routeBetween(b, 'QIN').nm > routeBetween(a, 'QIN').nm ? b : a));

/** The challenge: a route between Qingdao and the cargo port farthest from it. */
export function farthestSolved(from: string, to: string): boolean {
  return (from === 'QIN' && to === FARTHEST_FROM_QINGDAO) || (to === 'QIN' && from === FARTHEST_FROM_QINGDAO);
}

export interface RoutePick {
  from: string;
  to: string;
  /** What the next click on a port sets. */
  setting: 'from' | 'to';
}

/**
 * A click on a port: the first click chooses where the voyage starts, the next where it ends, and
 * later clicks keep moving the end until the switch is set back to the origin. Clicking the other
 * end of the voyage swaps the two.
 */
export function pickPort(cur: RoutePick, id: string): RoutePick {
  if (cur.setting === 'from') return id === cur.to ? { from: id, to: cur.from, setting: 'to' } : { from: id, to: cur.to, setting: 'to' };
  return id === cur.from ? { from: cur.to, to: id, setting: 'to' } : { from: cur.from, to: id, setting: 'to' };
}

/** Days at sea for a passage, plus canal transits. */
export function passageDays(r: SeaRoute, speedKn: number): number {
  return r.nm / (24 * speedKn) + r.canalDays;
}

/** Routes whose model lanes run longer than a real ship would sail: Panama to Indonesia, Western Australia or India by way of Japan. */
function roundabout(r: SeaRoute): boolean {
  const ends = [r.from, r.to];
  return r.lanes.some((l) => l.id === 'BAL-JPN') && ends.some((e) => ['PHE', 'SAM', 'PAR'].includes(e));
}

const greatCircle = (a: string, b: string) => greatCircleNm([PLACE[a].lat, PLACE[a].lon], [PLACE[b].lat, PLACE[b].lon]);

const CLASS_LABEL: Record<ClassId, string> = { cape: 'Capesize', kmax: 'Kamsarmax' };

export interface TradeRow {
  id: string;
  from: string;
  to: string;
  commodity: string;
  mtpa: number;
  nm: number;
  days12: number;
  tonneShare: number;
  /** Share of the class's laden days at sea (every ship of a class carries the same cargo, so this is also its share of tonne-miles). */
  dayShare: number;
  route: SeaRoute;
}

/** The course's trades for a class, with distances and their shares of tonnes and of laden sea days. */
export function tradeRows(cls: ClassId): TradeRow[] {
  const m = MARKET_CLASSES[cls];
  const draft = ladenDraft(m.vessel, m.cargo);
  const rows = ROUTES.filter((r) => r.cls === cls).map((r) => {
    const route = seaRoute(r.from, r.to, { draft })!;
    return { id: r.id, from: r.from, to: r.to, commodity: r.commodity, mtpa: r.mtpa, nm: route.nm, days12: route.nm / (24 * 12), route };
  });
  const tonnes = rows.reduce((s, r) => s + r.mtpa, 0);
  const tm = rows.reduce((s, r) => s + r.mtpa * r.nm, 0);
  return rows.map((r) => ({ ...r, tonneShare: r.mtpa / tonnes, dayShare: (r.mtpa * r.nm) / tm }));
}

const CAPE = tradeRows('cape');
const KMAX = tradeRows('kmax');
const C5 = CAPE.find((r) => r.id === 'C-PHE-QIN')!;
const C3 = CAPE.find((r) => r.id === 'C-TUB-QIN')!;
const SOY = KMAX.find((r) => r.id === 'P-SAN-QIN')!;
const INDO = KMAX.find((r) => r.id === 'P-SAM-QIN')!;
const TUB_QIN = routeBetween('TUB', 'QIN');
const PHE_QIN = routeBetween('PHE', 'QIN');
const NOL_QIN = routeBetween('NOL', 'QIN');
const ROT_QIN = routeBetween('ROT', 'QIN');
const FAR = routeBetween(FARTHEST_FROM_QINGDAO, 'QIN');
/** A distance rounded to the nearest hundred miles, for the prose’s “about.” */
const about = (x: number) => fmt(Math.round(x / 100) * 100);

export default function Lesson() {
  const s = useScenario('route', { from: 'TUB', to: 'QIN', setting: 'from' as 'from' | 'to' });
  const { from, to, setting } = s.state;
  const r = routeBetween(from, to);
  const days = passageDays(r, SPEED);
  const fuel = fuelPerDay(KESTREL, SPEED, LADEN) * (r.nm / (24 * SPEED));
  const gc = greatCircle(from, to);
  const solved = farthestSolved(from, to);
  const chokeNames = r.chokepoints.map((c) => CHOKEPOINTS[c].name);

  const pick = (id: string) => s.set(pickPort({ from, to, setting }, id));
  const ports: MapPort[] = CARGO_PORTS.map((id) => ({
    id,
    color: id === from ? TEXT.blue : id === to ? TEXT.orange : '#777',
    selected: id === from || id === to,
    sub: id === from ? 'origin' : id === to ? 'destination' : undefined,
    onClick: () => pick(id),
  }));

  const tr = useScenario('trades', { cls: 'cape' as ClassId });
  const rows = tr.state.cls === 'cape' ? CAPE : KMAX;
  const maxMt = Math.max(...rows.map((x) => x.mtpa));
  const tradePorts = useMemo(() => [...new Set(rows.flatMap((x) => [x.from, x.to]))], [rows]);
  const biggest = rows.reduce((a, b) => (b.mtpa > a.mtpa ? b : a));
  const longest = rows.reduce((a, b) => (b.nm > a.nm ? b : a));

  return (
    <LessonPage id="shipping/3.1">
      <P>
        <a href={lessonHref('shipping/2.5')}>Chapter 2</a> ended with the world’s Kamsarmaxes as a single number — a fleet of so many ships that grows when owners
        order and shrinks when they scrap. But a ship is never just part of a number. On any given day she is somewhere: loading ore in Brazil, discharging coal
        in China, or halfway between, and the next cargo that needs her may be a month’s sail away. This chapter asks why freight capacity can be scarce in one part
        of the world while ships sit idle in another, and the answer starts with geography: where the ships go, by which lanes, and how long it takes.
      </P>
      <P>
        Distances at sea are measured in nautical miles and speeds in knots, as in <a href={lessonHref('shipping/1.2')}>Lesson 1.2</a>: a knot is a nautical mile
        an hour, so a ship making {SPEED} knots covers {fmt(24 * SPEED)} miles a day. The next demonstration is our world: real ports at their real positions,
        joined by the sea lanes (the faint gray lines) that the course’s ships use. Click a port to choose where a voyage starts, then another for where it ends; further clicks move the end, and the switch at the top of the
        demonstration sets the start again. The blue line is the shortest open way between the two along the lanes. It starts with Kestrel carrying 75,000
        tonnes from Tubarão, in Brazil, to Qingdao, in China:
      </P>

      <Figure name="Shipping Network Map" scenario={s}>
        <Segmented
          label="Clicking a port sets the"
          value={setting}
          onChange={(v) => s.set({ setting: v })}
          options={[
            { value: 'from', label: 'Click a port to set the origin' },
            { value: 'to', label: '… or the destination' },
          ]}
        />
        <WorldMap
          ariaLabel={`Sea route from ${PLACE[from].name} to ${PLACE[to].name}: ${nm(r.nm)}${chokeNames.length ? `, through ${chokeNames.join(', ')}` : ''}. ${days1(days)} at ${SPEED} knots.`}
          routes={[{ points: r.points, color: GRAPHIC.blue, width: 3, flow: true }]}
          ports={ports}
          chokepoints={r.chokepoints.map((id) => ({ id, closed: false, label: true }))}
        />
        <Eq
          label={`Days equal distance divided by 24 hours times speed${r.canalDays ? ', plus the canal' : ''}: ${fmt(r.nm)} nautical miles over 24 times ${SPEED} knots${r.canalDays ? `, plus ${fmt(r.canalDays)} in a canal,` : ''} is ${days1(days)}`}
        >
          <K tone="teal">days</K>
          <Op>=</Op>
          <Frac top={<K tone="blue">distance</K>} bottom={<span>24 h × speed</span>} />
          {r.canalDays > 0 && (
            <>
              <Op>+</Op>
              <span>canal days</span>
            </>
          )}
          <Op>=</Op>
          <Frac top={<Tn tone="blue">{nm(r.nm)}</Tn>} bottom={<span>24 h × {SPEED} kn</span>} />
          {r.canalDays > 0 && (
            <>
              <Op>+</Op>
              <span>{fmt(r.canalDays)}</span>
            </>
          )}
          <Op>=</Op>
          <K tone="teal">{days1(days)}</K>
        </Eq>
        <Readouts
          items={[
            { label: 'Kestrel’s fuel, laden', value: `${fmt(fuel)} t`, tone: 'gold' },
            { label: 'chokepoints passed', value: chokeNames.length ? chokeNames.join(' · ') : 'none' },
          ]}
        />
        <Caption>
          A great circle, the shortest path over the globe with land ignored, would be {nm(gc)}; the sea route is {pct(r.nm / gc - 1)} longer.
          {roundabout(r) ? ' Our lanes are drawn for the course’s trades; this one crosses the North Pacific and comes down through Indonesia, so it is longer than a real ship’s passage would be.' : ''}
        </Caption>
      </Figure>

      <P>
        In our model, Kestrel sails from Tubarão south and east round the Cape of Good Hope, crosses the Indian Ocean, passes the Sunda Strait into the South China Sea and
        runs north to Qingdao: about {about(TUB_QIN.nm)} nautical miles in our model, {days1(passageDays(TUB_QIN, SPEED))} at {SPEED} knots, on{' '}
        {fmt(fuelPerDay(KESTREL, SPEED, LADEN) * (TUB_QIN.nm / (24 * SPEED)))} tonnes of fuel. A great circle between the two ports is only {nm(greatCircle('TUB', 'QIN'))}, but
        it runs straight across Africa. That is why the route bends: it swings far south to round the Cape, then turns north to pass between the islands of
        Indonesia, because a ship can only go where the sea goes. On any given passage a master’s track bends further still around the weather, as{' '}
        <a href={lessonHref('shipping/1.5')}>Lesson 1.5</a> showed.
      </P>
      <P>
        Our distances are great-circle lengths measured along each lane’s waypoints. They come out within a few percent of the published distance tables that
        shipbrokers use, close enough for this course, but they are the model’s own numbers, which is why we’ll quote them with an “about.”
      </P>

      <H2>Near and far</H2>
      <P>
        Now make Port Hedland, in Western Australia, the origin. Its ore reaches Qingdao in about {about(PHE_QIN.nm)} miles,{' '}
        {days1(passageDays(PHE_QIN, SPEED))} at {SPEED} knots: Australia is about a third as far from China as Brazil is. Set the switch back to the origin and try New
        Orleans to Qingdao, the route US grain takes to China. The shortest way is through the Panama Canal and across the Pacific, about{' '}
        {about(NOL_QIN.nm)} miles plus a day for the canal. Routes like these funnel through a few narrow passages — canals such as Panama and Suez, and
        straits such as Malacca — that the map marks and the readouts list as chokepoints; <a href={lessonHref('shipping/3.3')}>Lesson 3.3</a> closes them one at a time to see what each one saves.
      </P>

      <Challenge
        id="a"
        question={`Qingdao takes ore, coal and grain from all over the world, and Tubarão, about ${about(TUB_QIN.nm)} nautical miles away, is a long haul. Predict first, from the map: is any of our cargo ports farther from Qingdao by sea, and if so, which? Then make Qingdao the origin and click the ports to check.`}
        solved={solved}
        status={
          from !== 'QIN' && to !== 'QIN'
            ? 'Make Qingdao the origin, then click the other ports in turn.'
            : `${PLACE[from === 'QIN' ? to : from].name} is ${nm(r.nm)} from Qingdao. Is anywhere farther?`
        }
        success={`Solved. ${PLACE[FARTHEST_FROM_QINGDAO].name} is about ${about(FAR.nm)} nautical miles from Qingdao, ${fmt(FAR.nm - TUB_QIN.nm)} more than Tubarão: it lies farther south and west along the same coast, so its ships have farther to go to round the Cape of Good Hope, ${days1(passageDays(FAR, SPEED))} at ${SPEED} knots. Rotterdam, through Suez (about ${about(ROT_QIN.nm)}), and New Orleans, through Panama (about ${about(NOL_QIN.nm)}), are both nearer. Brazil is close to the far side of the world from northern China, and it is also one of China’s largest suppliers of iron ore and soybeans — a fact that will shape every chapter from here on.`}
      />

      <H2>Where the cargo goes</H2>
      <P>
        A route is only half the story; the other half is how much travels on it. The next demonstration draws the trades of the course’s world for each size of
        ship, each line as thick as the tonnage it carries in a year. The volumes are illustrative, not market statistics, but they are of a realistic size, and
        the table adds up what each trade asks of the fleet. Switch between the two classes:
      </P>

      <Figure name="Shipping Network Map · the course’s trades" scenario={tr}>
        <Segmented
          label="Ship size"
          value={tr.state.cls}
          onChange={(v) => tr.set({ cls: v })}
          options={[
            { value: 'cape', label: 'Capesize' },
            { value: 'kmax', label: 'Kamsarmax' },
          ]}
        />
        <WorldMap
          ariaLabel={`The ${CLASS_LABEL[tr.state.cls]} trades: ${rows.map((x) => `${PLACE[x.from].name} to ${PLACE[x.to].name}, ${fmt(x.mtpa)} million tonnes a year over ${nm(x.nm)}`).join('; ')}.`}
          routes={[...rows]
            .sort((a, b) => b.mtpa - a.mtpa)
            .map((x) => ({ points: x.route.points, color: GRAPHIC.orange, width: 1.5 + (9 * x.mtpa) / maxMt, opacity: 0.75 }))}
          ports={tradePorts.map((id) => ({ id, color: '#666' }))}
        />
        <DataTable
          caption={`The ${CLASS_LABEL[tr.state.cls]} trades of the course’s world`}
          rows={rows}
          rowKey={(x) => x.id}
          columns={[
            { label: 'Trade', cell: (x) => `${PLACE[x.from].name} → ${PLACE[x.to].name}` },
            { label: 'Cargo', cell: (x) => x.commodity, align: 'left' },
            { label: 'Mt a year', cell: (x) => fmt(x.mtpa), align: 'right' },
            { label: 'Distance', cell: (x) => nm(x.nm), align: 'right' },
            { label: 'Days at 12 kn', cell: (x) => fmt(x.days12, 1), align: 'right' },
            { label: 'Share of tonnes / laden days', cell: (x) => `${pct(x.tonneShare)} / ${pct(x.dayShare)}`, align: 'right' },
          ]}
        />
        <Caption>
          {`${PLACE[biggest.from].name} → ${PLACE[biggest.to].name} carries the most cargo, ${pct(biggest.tonneShare)} of the tonnes; ${PLACE[longest.from].name} → ${PLACE[longest.to].name}, the longest haul, takes ${pct(longest.dayShare)} of the laden days at sea.`}
        </Caption>
      </Figure>

      <P>
        Among the Capesizes, Port Hedland to Qingdao dominates the tonnage: {fmt(C5.mtpa)} million tonnes a year, {pct(C5.tonneShare)} of everything the class
        carries. But a laden voyage from Port Hedland lasts {days1(C5.days12)} at 12 knots, and one from Tubarão {days1(C3.days12)}, so each tonne of Brazilian ore
        sails {fmt(C3.nm / C5.nm, 1)} times as far as a tonne of Australian ore. Brazil’s ore to China is {pct(C3.tonneShare)} of the tonnes and{' '}
        {pct(C3.dayShare)} of the laden days at sea — more than Australia’s {pct(C5.dayShare)}. The Kamsarmax trades tell the same story. Indonesian coal to
        China is {pct(INDO.tonneShare)} of the class’s tonnes but only {pct(INDO.dayShare)} of its laden days; Brazilian soybeans to China are{' '}
        {pct(SOY.tonneShare)} of the tonnes and {pct(SOY.dayShare)} of the days.
      </P>
      <P>
        So counting tonnes misreads how much shipping the world needs. Because every ship in a class carries the same cargo, a trade’s share of laden days is also
        its share of the class’s <K tone="orange">tonne-miles</K>: tonnes multiplied by the nautical miles they travel, so that one tonne carried one mile is one
        tonne-mile. Tonne-miles are how the industry measures the demand for ships, and <a href={lessonHref('shipping/3.5')}>Lesson 3.5</a> turns them into a
        number of ships. There is a second pattern in <FigRef to="Shipping Network Map · the course’s trades">this demonstration</FigRef>, too: almost
        every line ends in China or India, while the cargoes start in Brazil, Australia, Indonesia, South Africa and the US Gulf — which, as{' '}
        <a href={lessonHref('shipping/3.4')}>Lesson 3.4</a> will show, leaves each ship in the wrong place once she has delivered.
      </P>
      <P>
        Distance isn’t the only thing that keeps a ship busy, though. Every voyage starts and ends in a port, and ports have only so many berths. When too many
        ships arrive at once, the late ones wait at anchor, sometimes for weeks, carrying nothing. <a href={lessonHref('shipping/3.2')}>The next lesson</a> builds a
        port and watches its queue form.
      </P>
    </LessonPage>
  );
}
