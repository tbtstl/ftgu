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
  Slider,
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
const ROT_SIN = routeBetween('ROT', 'SIN');
const PAR_SIN = routeBetween('PAR', 'SIN');
const FAR = routeBetween(FARTHEST_FROM_QINGDAO, 'QIN');

export default function Lesson() {
  const s = useScenario('route', { from: 'TUB', to: 'QIN', setting: 'to' as 'from' | 'to', speed: 12 });
  const { from, to, setting, speed } = s.state;
  const r = routeBetween(from, to);
  const days = passageDays(r, speed);
  const fuel = fuelPerDay(KESTREL, speed, LADEN) * (r.nm / (24 * speed));
  const gc = greatCircle(from, to);
  const solved = farthestSolved(from, to);
  const chokeNames = r.chokepoints.map((c) => CHOKEPOINTS[c].name);

  const pick = (id: string) => {
    if (setting === 'from') {
      if (id === to) s.set({ from: id, to: from, setting: 'to' });
      else s.set({ from: id, setting: 'to' });
    } else if (id === from) s.set({ from: to, to: id });
    else s.set({ to: id });
  };
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
        Distances at sea are measured in <K tone="blue">nautical miles</K>. One nautical mile is 1,852 meters, a length chosen because it is one minute of latitude
        — a sixtieth of a degree — along a meridian, which made it easy to measure on a chart. A knot is a nautical mile per hour, so a ship making 12 knots covers
        288 miles a day. The next demonstration is our world: real ports at their real positions, joined by the sea lanes (the faint gray lines) that the course’s
        ships use. Click a port to choose where a voyage starts, then another for where it ends; the blue line is the shortest open way between them along the
        lanes. It starts with Kestrel carrying 75,000 tonnes from Tubarão, in Brazil, to Qingdao, in China:
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
          ariaLabel={`Sea route from ${PLACE[from].name} to ${PLACE[to].name}: ${nm(r.nm)}${chokeNames.length ? `, through ${chokeNames.join(', ')}` : ''}. ${days1(days)} at ${fmt(speed, 1)} knots.`}
          routes={[{ points: r.points, color: GRAPHIC.blue, width: 3, flow: true }]}
          ports={ports}
          chokepoints={r.chokepoints.map((id) => ({ id, closed: false, label: true }))}
        />
        <Readouts
          items={[
            { label: 'distance by sea', value: nm(r.nm), tone: 'blue' },
            { label: r.canalDays ? `days at sea, plus ${fmt(r.canalDays)} in a canal` : 'days at sea', value: days1(days), tone: 'teal' },
            { label: 'Kestrel’s fuel, laden', value: `${fmt(fuel)} t`, tone: 'gold' },
            { label: 'chokepoints passed', value: chokeNames.length ? chokeNames.join(' · ') : 'none' },
          ]}
        />
        <Slider label="Speed" tone="teal" value={speed} min={10} max={15} step={0.5} onChange={(v) => s.set({ speed: v })} display={`${fmt(speed, 1)} kn`} />
        <Eq label={`Days at sea equal distance divided by 24 hours times speed: ${fmt(r.nm)} nautical miles over 24 times ${fmt(speed, 1)} knots is ${fmt(r.nm / (24 * speed), 1)} days`}>
          <K tone="teal">days</K>
          <Op>=</Op>
          <Frac top={<K tone="blue">distance</K>} bottom={<span>24 h × speed</span>} />
          <Op>=</Op>
          <Frac top={<Tn tone="blue">{nm(r.nm)}</Tn>} bottom={<span>24 h × {fmt(speed, 1)} kn</span>} />
          <Op>=</Op>
          <K tone="teal">{days1(r.nm / (24 * speed))}</K>
        </Eq>
        <Caption>
          A great circle, the shortest path over the globe with land ignored, would be {nm(gc)}; the sea route is {pct(r.nm / gc - 1)} longer.
          {roundabout(r) ? ' Our lanes are drawn for the course’s trades; this one crosses the North Pacific and comes down through Indonesia, so it is longer than a real ship’s passage would be.' : ''}
        </Caption>
      </Figure>

      <P>
        In our model, Kestrel sails from Tubarão south and east round the Cape of Good Hope, crosses the Indian Ocean, passes the Sunda Strait into the South China Sea and
        runs north to Qingdao: about {fmt(Math.round(TUB_QIN.nm / 100) * 100)} nautical miles in our model, {days1(passageDays(TUB_QIN, 12))} at 12 knots, on{' '}
        {fmt(fuelPerDay(KESTREL, 12, LADEN) * (TUB_QIN.nm / 288))} tonnes of fuel. A great circle between the two ports is only {nm(greatCircle('TUB', 'QIN'))}, but
        it runs straight across Africa. Notice, too, that the route bends on the flat map. The map stretches the world east to west, more so the farther from the
        equator, so the shortest paths over the globe look curved on it; and on any given passage a master’s track bends further still around the weather, as{' '}
        <a href={lessonHref('shipping/1.5')}>Lesson 1.5</a> showed.
      </P>
      <P>
        Our distances are great-circle lengths measured along each lane’s waypoints. They come out within a few percent of the published distance tables that
        shipbrokers use, close enough for this course, but they are the model’s own numbers, which is why we’ll quote them with an “about.”
      </P>

      <H2>Corridors and chokepoints</H2>
      <P>
        Now set Port Hedland, in Western Australia, as the origin. Its ore reaches Qingdao in about {fmt(Math.round(PHE_QIN.nm / 100) * 100)} miles,{' '}
        {days1(passageDays(PHE_QIN, 12))} at 12 knots: Australia is about a third as far from China as Brazil is. Try New Orleans to Qingdao, the route US grain
        takes to China. The shortest way is through the Panama Canal and across the Pacific, about {fmt(Math.round(NOL_QIN.nm / 100) * 100)} miles plus a day for
        the canal. Rotterdam to Singapore runs through the Strait of Gibraltar, the Mediterranean, the Suez Canal and the Red Sea, about{' '}
        {fmt(Math.round(ROT_SIN.nm / 100) * 100)} miles; Paradip, on India’s east coast, reaches Singapore in about {fmt(Math.round(PAR_SIN.nm / 100) * 100)} through
        the Strait of Malacca.
      </P>
      <P>
        Those narrow places carry a remarkable share of the world’s trade. The Suez Canal opened in 1869 and has no locks: it is a sea-level channel between the
        Mediterranean and the Red Sea. The Panama Canal opened in 1914 and lifts ships through locks to a lake in the middle of the isthmus and back down again. The
        Strait of Malacca is the shortest sea route between the Indian Ocean and the Pacific. Each saves thousands of miles on the routes that use it, and{' '}
        <a href={lessonHref('shipping/3.3')}>Lesson 3.3</a> will close them one at a time to see what that costs.
      </P>

      <Challenge
        id="a"
        question="Qingdao takes ore, coal and grain from all over the world. Which of our cargo ports is farthest from it by sea?"
        solved={solved}
        status={
          from !== 'QIN' && to !== 'QIN'
            ? 'Make Qingdao one end of the voyage, then try the other ports.'
            : `${PLACE[from === 'QIN' ? to : from].name} is ${nm(r.nm)} from Qingdao. Is anywhere farther?`
        }
        success={`Solved. ${PLACE[FARTHEST_FROM_QINGDAO].name} is about ${fmt(Math.round(FAR.nm / 100) * 100)} nautical miles from Qingdao, round the Cape of Good Hope: ${days1(passageDays(FAR, 12))} at 12 knots. Brazil is close to the far side of the world from northern China, and it is also one of China’s largest suppliers of iron ore and soybeans — a fact that will shape every chapter from here on.`}
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
        keeps a ship busy {fmt(C3.nm / C5.nm, 1)} times as long as a tonne of Australian ore. Brazil’s ore is {pct(C3.tonneShare)} of the tonnes and{' '}
        {pct(C3.dayShare)} of the laden days at sea — more than Australia’s {pct(C5.dayShare)}. The Kamsarmax trades tell the same story. Indonesian coal to
        China is {pct(INDO.tonneShare)} of the class’s tonnes but only {pct(INDO.dayShare)} of its laden days; Brazilian soybeans to China are{' '}
        {pct(SOY.tonneShare)} of the tonnes and {pct(SOY.dayShare)} of the days.
      </P>
      <P>
        So counting tonnes misreads how much shipping the world needs. Because every ship in a class carries the same cargo, a trade’s share of laden days is also
        its share of tonnes multiplied by miles — its <b>ton-miles</b>, the measure of shipping demand that <a href={lessonHref('shipping/3.5')}>Lesson 3.5</a> builds
        on. There is a second pattern in <FigRef to="Shipping Network Map · the course’s trades">this demonstration</FigRef>, too: almost every line ends in China or
        India, while the cargoes start in Brazil, Australia, Indonesia, South Africa and the US Gulf. A ship that delivers in Qingdao is in the wrong place for her
        next cargo, and <a href={lessonHref('shipping/3.4')}>Lesson 3.4</a> will follow her back.
      </P>
      <P>
        Distance isn’t the only thing that keeps a ship busy, though. Every voyage starts and ends in a port, and ports have only so many berths. When too many
        ships arrive at once, the late ones wait at anchor, sometimes for weeks, carrying nothing. <a href={lessonHref('shipping/3.2')}>The next lesson</a> builds a
        port and watches its queue form.
      </P>
    </LessonPage>
  );
}
