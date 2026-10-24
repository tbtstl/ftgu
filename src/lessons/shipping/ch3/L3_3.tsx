import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  P,
  Readouts,
  Slider,
  Swatch,
  TEXT,
  fmt,
  lessonHref,
  pct,
  useScenario,
} from '../../../framework';
import { PLACE, type Chokepoint } from '../../../model/shipping/geo';
import { ALBATROSS, KESTREL, NEOPANAMAX_BOX, SUEZMAX, VLCC } from '../../../model/shipping/vessels';
import { chokepointName, seaRoute, type SeaRoute } from '../../../engines/shipping/network';
import { fleetRequirement } from '../../../engines/shipping/market';
import { expectedWait } from '../../../engines/shipping/queue';
import { ladenDraft } from '../../../engines/shipping/voyage';
import { WorldMap } from '../shared/WorldMap';
import { XYChart } from '../shared/XYChart';

/** Passage speed used to turn miles into days. */
const SPEED = 13;
const KMAX_DRAFT = ladenDraft(KESTREL, 75_000);
const CAPE_DRAFT = ladenDraft(ALBATROSS, 170_000);

interface Trade {
  id: string;
  from: string;
  to: string;
  ship: string;
  draft: number;
  color: string;
}

const TRADES: Trade[] = [
  { id: 'box', from: 'ROT', to: 'SIN', ship: 'Container ship', draft: NEOPANAMAX_BOX.designDraft, color: '#4590ce' },
  { id: 'suezmax', from: 'RTA', to: 'ROT', ship: 'Suezmax tanker', draft: SUEZMAX.designDraft, color: '#ab70b6' },
  { id: 'vlcc', from: 'RTA', to: 'QIN', ship: 'VLCC', draft: VLCC.designDraft, color: '#c99a1e' },
  { id: 'grain', from: 'NOL', to: 'QIN', ship: 'Kamsarmax, grain', draft: KMAX_DRAFT, color: '#2a9d90' },
  { id: 'coal', from: 'SAM', to: 'PAR', ship: 'Kamsarmax, coal', draft: KMAX_DRAFT, color: '#8d7b6a' },
  { id: 'ore', from: 'TUB', to: 'QIN', ship: 'Capesize, ore', draft: CAPE_DRAFT, color: '#e48850' },
];

const TOGGLES: Chokepoint[] = ['gibraltar', 'suez', 'redsea', 'hormuz', 'malacca', 'panama'];

const nm = (x: number) => `${fmt(x)} nm`;
const days = (x: number) => `${fmt(x, 1)} days`;
const tradeName = (t: Trade) => `${PLACE[t.from].name}–${PLACE[t.to].name}`;
/** Days at sea at 13 knots plus canal days. */
const passageDays = (r: SeaRoute) => r.nm / (24 * SPEED) + r.canalDays;

export interface TradeStatus {
  trade: Trade;
  route: SeaRoute | null;
  open: SeaRoute;
  extraNm: number;
  extraDays: number;
}

export function tradeStatus(closed: Chokepoint[]): TradeStatus[] {
  return TRADES.map((trade) => {
    const open = seaRoute(trade.from, trade.to, { draft: trade.draft })!;
    const route = seaRoute(trade.from, trade.to, { closed, draft: trade.draft });
    return {
      trade,
      route,
      open,
      extraNm: route ? route.nm - open.nm : Infinity,
      extraDays: route ? passageDays(route) - passageDays(open) : Infinity,
    };
  });
}

/** Extra ships the course's dry bulk trades need, at 12 knots laden and 13 in ballast. */
export function extraShips(closed: Chokepoint[]): { cape: number; kmax: number } {
  return {
    cape: fleetRequirement('cape', { closed }).ships - fleetRequirement('cape').ships,
    kmax: fleetRequirement('kmax', { closed }).ships - fleetRequirement('kmax').ships,
  };
}

// ---------------------------------------------------------------------------
// The Panama queue: a stylized canal whose daily transit slots are the servers of a queue.

const GRAIN_PANAMA = seaRoute('NOL', 'QIN', { draft: KMAX_DRAFT })!;
const GRAIN_SUEZ = seaRoute('NOL', 'QIN', { closed: ['panama'], draft: KMAX_DRAFT })!;
/** Extra days for US Gulf–Qingdao grain that goes round by Suez instead of through Panama. */
export const DETOUR_DAYS = passageDays(GRAIN_SUEZ) - passageDays(GRAIN_PANAMA);
/** Variability of a transit: about a day each, give or take. */
const TRANSIT_CV = 0.3;
const HORIZON = 120;
export const CUT_SLOTS = 24;
export const CHALLENGE_DAYS = 60;
const ARRIVAL_STEP = 0.5;

export interface CanalState {
  /** Wait at anchor on each day after the change, days. */
  waits: number[];
  /** Wait once things settle, days. */
  settledWait: number;
  /** Ships at anchor once things settle. */
  settledQueue: number;
  /** Share of ships that go round instead, once things settle. */
  divertShare: number;
  /** Day the wait first reaches the detour (Infinity if it never does). */
  divertDay: number;
  /** Transits a day once things settle. */
  transits: number;
}

/**
 * Below capacity, random arrivals queue for a while at each slot (Erlang C, `expectedWait`). Above
 * it, the line at anchor grows every day by the ships the canal can't pass, so the wait grows too,
 * until it equals the detour; from then on every ship beyond the canal's capacity goes round.
 */
export function canalState(slots: number, arrivals: number): CanalState {
  const c = Math.max(1, Math.round(slots));
  if (arrivals < c) {
    const w = expectedWait(c, arrivals, 1, TRANSIT_CV);
    if (w <= DETOUR_DAYS) {
      return { waits: Array(HORIZON + 1).fill(w), settledWait: w, settledQueue: arrivals * w, divertShare: 0, divertDay: Infinity, transits: arrivals };
    }
    // Within a whisker of capacity the random queue alone outlasts the detour: some ships go round.
    let lo = 0;
    let hi = arrivals;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (expectedWait(c, mid, 1, TRANSIT_CV) < DETOUR_DAYS) lo = mid;
      else hi = mid;
    }
    return { waits: Array(HORIZON + 1).fill(DETOUR_DAYS), settledWait: DETOUR_DAYS, settledQueue: lo * DETOUR_DAYS, divertShare: 1 - lo / arrivals, divertDay: 0, transits: lo };
  }
  const growth = (arrivals - c) / c; // days of wait added each day
  const divertDay = growth > 0 ? DETOUR_DAYS / growth : Infinity;
  const waits = Array.from({ length: HORIZON + 1 }, (_, t) => Math.min(DETOUR_DAYS, growth * t));
  return { waits, settledWait: DETOUR_DAYS, settledQueue: c * DETOUR_DAYS, divertShare: (arrivals - c) / arrivals, divertDay, transits: c };
}

/**
 * The challenge: with the canal cut to 24 slots a day, the most ships a day (on the slider's
 * half-ship steps) that can keep arriving for 60 days before the wait grows as long as the detour.
 */
export function slotCutSolved(slots: number, arrivals: number): boolean {
  if (Math.round(slots) !== CUT_SLOTS) return false;
  return canalState(slots, arrivals).divertDay >= CHALLENGE_DAYS - 1e-9 && canalState(slots, arrivals + ARRIVAL_STEP).divertDay < CHALLENGE_DAYS;
}

// Numbers the prose quotes.
const OPEN = tradeStatus([]);
const NO_SUEZ = tradeStatus(['suez']);
const NO_PANAMA = tradeStatus(['panama']);
const NO_MALACCA = tradeStatus(['malacca']);
const byId = (s: TradeStatus[], id: string) => s.find((x) => x.trade.id === id)!;
const VLCC_SHALLOW = seaRoute('RTA', 'QIN')!;
const BASE_REQ = { cape: fleetRequirement('cape').ships, kmax: fleetRequirement('kmax').ships };
const EXTRA_PANAMA = extraShips(['panama']);
const EXTRA_MALACCA = extraShips(['malacca']);
const EXTRA_SUEZ = extraShips(['suez']);
const NORMAL = { slots: 36, arrivals: 32 };
const DROUGHT = canalState(CUT_SLOTS, NORMAL.arrivals);
const NORMAL_STATE = canalState(NORMAL.slots, NORMAL.arrivals);
const ANSWER = (() => {
  for (let a = 40; a >= 15; a -= ARRIVAL_STEP) if (slotCutSolved(CUT_SLOTS, a)) return a;
  return NaN;
})();

export default function Lesson() {
  const s = useScenario('chokepoints', { closed: [] as Chokepoint[] });
  const closed = s.state.closed;
  const toggle = (c: Chokepoint) => s.set({ closed: closed.includes(c) ? closed.filter((x) => x !== c) : [...closed, c] });
  const key = [...closed].sort().join(',');
  const status = useMemo(() => tradeStatus(key ? (key.split(',') as Chokepoint[]) : []), [key]);
  const extra = useMemo(() => extraShips(key ? (key.split(',') as Chokepoint[]) : []), [key]);
  const blocked = status.filter((x) => !x.route);
  const longer = status.filter((x) => x.route && x.extraNm > 0.5);
  const portIds = [...new Set(TRADES.flatMap((t) => [t.from, t.to]))];

  const q = useScenario('panama-queue', NORMAL);
  const cs = canalState(q.state.slots, q.state.arrivals);
  const solved = slotCutSolved(q.state.slots, q.state.arrivals);
  const xs = Array.from({ length: HORIZON + 1 }, (_, t) => t);
  const over = q.state.arrivals >= q.state.slots;

  return (
    <LessonPage id="shipping/3.3">
      <P>
        <a href={lessonHref('shipping/3.1')}>Lesson 3.1</a> laid out the lanes ships follow, and <a href={lessonHref('shipping/3.2')}>Lesson 3.2</a> showed what
        happens when too many of them arrive at one port. Between the ports, the lanes pass through a handful of narrow places — two canals cut by hand, and a few
        straits between continents and islands — that are the only short way from one ocean to the next. A large share of the world’s trade squeezes through
        them. This lesson asks what happens to voyages when one of them closes, and what that does to the number of ships the world needs.
      </P>
      <P>
        In the next demonstration, six real trades sail their shortest routes through our model’s sea lanes: containers from Rotterdam to Singapore, crude oil
        from Ras Tanura in Saudi Arabia to Rotterdam in a Suezmax tanker and to Qingdao in a VLCC, and three of the dry bulk trades we met in{' '}
        <a href={lessonHref('shipping/3.1')}>Lesson 3.1</a>. Each ship floats at its own laden draft, so each can use only the passages deep enough for it. Click a{' '}
        <K tone="blue">chokepoint</K> on the map, or tab to it and press Enter, to close it; click again to reopen it:
      </P>

      <Figure name="Canal and Strait Simulator" scenario={s}>
        <WorldMap
          ariaLabel={`Six trades and their routes with ${closed.length ? closed.map((c) => chokepointName(c)).join(', ') + ' closed' : 'every chokepoint open'}. ${status
            .map((x) => `${tradeName(x.trade)}: ${x.route ? `${nm(x.route.nm)}${x.extraNm > 0.5 ? `, ${nm(x.extraNm)} longer` : ''}` : 'no sea route'}`)
            .join('; ')}.`}
          routes={status.filter((x) => x.route).map((x) => ({ points: x.route!.points, color: x.trade.color, width: 2.5, flow: x.extraNm > 0.5, opacity: 0.9 }))}
          ports={portIds.map((id) => ({ id, color: blocked.some((b) => b.trade.from === id) ? TEXT.red : '#555' }))}
          chokepoints={TOGGLES.map((id) => ({ id, closed: closed.includes(id), onToggle: () => toggle(id), label: true }))}
        />
        <DataTable
          caption="Each trade's distance with the current closures, and how much longer it is than with every chokepoint open"
          rows={status}
          rowKey={(x) => x.trade.id}
          rowClass={(x) => (!x.route ? 'dim' : x.extraNm > 0.5 ? 'hl' : '')}
          columns={[
            {
              label: 'Trade',
              cell: (x) => (
                <>
                  <Swatch color={x.trade.color} />
                  {tradeName(x.trade)}
                </>
              ),
            },
            { label: 'Ship', cell: (x) => x.trade.ship, align: 'left' },
            { label: 'Distance', cell: (x) => (x.route ? nm(x.route.nm) : 'no sea route'), align: 'right' },
            { label: 'Added nm', cell: (x) => (x.route ? (x.extraNm > 0.5 ? `+${nm(x.extraNm)}` : '—') : '—'), align: 'right' },
            { label: 'Added days', cell: (x) => (x.route ? (x.extraDays > 0.05 ? `+${fmt(x.extraDays, 1)}` : '—') : '—'), align: 'right' },
          ]}
        />
        <Readouts
          items={[
            { label: 'extra Kamsarmaxes the course’s trades need', value: `${fmt(extra.kmax, 1)} ships`, tone: extra.kmax > 0.05 ? 'orange' : undefined },
            { label: 'extra Capesizes', value: `${fmt(extra.cape, 1)} ships`, tone: extra.cape > 0.05 ? 'orange' : undefined },
          ]}
        />
        <Caption>
          {blocked.length
            ? `With the Strait of Hormuz closed, ${blocked.map((b) => tradeName(b.trade)).join(' and ')} ${blocked.length > 1 ? 'have' : 'has'} no sea route at all.`
            : longer.length
              ? `${longer.length} of the six trades now sail farther. Moving dots mark the rerouted voyages.`
              : 'Every trade is on its shortest route. Ships needed are counted at 12 knots laden and 13 in ballast.'}
        </Caption>
      </Figure>

      <P>
        Close the Suez Canal. The canal, opened in 1869, is a sea-level channel with no locks, and it saves Europe–Asia traffic the long way round Africa.
        Without it, the container ship’s voyage from Rotterdam to Singapore grows from {nm(byId(OPEN, 'box').open.nm)} to{' '}
        {nm(byId(NO_SUEZ, 'box').route!.nm)} by way of the Cape of Good Hope: {nm(byId(NO_SUEZ, 'box').extraNm)} and{' '}
        {days(byId(NO_SUEZ, 'box').extraDays)} more at {SPEED} knots. The Suezmax from Ras Tanura adds {nm(byId(NO_SUEZ, 'suezmax').extraNm)}. Closing the Red
        Sea at Bab el-Mandeb, its southern end, or the Strait of Gibraltar, the Mediterranean’s western one, cuts the same shortcut. None of this is hypothetical. In March 2021 the container ship{' '}
        <i>Ever Given</i> ran aground across the canal and blocked it for six days, and since late 2023 attacks on ships in the Red Sea have led many owners to
        send their ships round the Cape instead.
      </P>
      <P>
        The other passages matter to other trades. Close the Panama Canal and the grain from New Orleans to Qingdao goes the other way round the world, through
        Suez: {nm(byId(NO_PANAMA, 'grain').extraNm)} and {days(byId(NO_PANAMA, 'grain').extraDays)} longer. Close the Strait of Malacca, the shortest way between
        the Indian Ocean and the Pacific, and coal from Samarinda to Paradip detours through the Sunda Strait, {nm(byId(NO_MALACCA, 'coal').extraNm)} farther. The
        VLCC doesn’t notice: laden to {fmt(VLCC.designDraft, 1)} meters she is too deep for Malacca anyway and already sails by the Lombok Strait, as deep-draft
        tankers do, {nm(byId(OPEN, 'vlcc').open.nm - VLCC_SHALLOW.nm)} farther than a shallower ship would go. And the Strait of Hormuz has no way round at all.
        Close it and both tanker trades from Ras Tanura vanish from the table. About a fifth of the oil the world consumes passes through Hormuz; pipelines in
        Saudi Arabia and the United Arab Emirates can carry part of it to ports outside the Gulf, but not by sea.
      </P>

      <H2>More miles, more ships</H2>
      <P>
        A detour doesn’t change how much cargo moves. It changes how long each cargo keeps a ship busy, and a ship busy longer on one voyage is not available for
        the next. Carrying the course’s Kamsarmax trades at 12 knots laden and 13 in ballast takes {fmt(BASE_REQ.kmax)} ships with every passage open. Close
        Panama in <FigRef to="Canal and Strait Simulator">the first demonstration</FigRef> and it takes {fmt(EXTRA_PANAMA.kmax, 1)} more — not only because
        the laden voyages from New Orleans are longer, but because the empty voyages that bring ships back to the Gulf for the next cargo are longer too. Close Malacca and the Indonesian coal trade needs {fmt(EXTRA_MALACCA.kmax, 1)} more. The same
        cargo now needs a bigger fleet, and nobody can build one in a hurry.
      </P>
      <P>
        Notice what doesn’t change: the Capesize trades. Closing Suez costs them {fmt(EXTRA_SUEZ.cape, 1)} ships, because in our world none of their routes uses
        any of these six passages. Ore from Brazil to China already goes round the Cape of Good Hope, the shorter way; ore and coal from Australia never pass
        near them. A chokepoint is a choke only for the trades that run through it, which is why closures hit some freight markets hard and leave others alone.
      </P>

      <H2>A canal is a queue</H2>
      <P>
        Closure is the extreme. More often a canal simply can’t pass everyone who wants it. The Panama Canal’s locks lift ships 26 meters to Gatun Lake and lower
        them down the other side, and every lockage spends fresh water from the lake. In 2023 a drought left the lake low, and the canal authority cut both the
        number of ships it passed each day and the draft they could load to. Ships queued at anchor at both ends, and some owners sent theirs the long way instead.
      </P>
      <P>
        In the next demonstration, a stylized Panama Canal offers a number of <K tone="teal">transit slots</K> a day, each passing one ship, and ships arrive at
        random wanting to cross. Like the berths of <a href={lessonHref('shipping/3.2')}>Lesson 3.2</a>, the slots are servers of a queue. The alternative for a
        Kamsarmax carrying grain from New Orleans to Qingdao is to go round by Suez, {days(DETOUR_DAYS)} longer at {SPEED} knots, so no owner will wait longer than
        that. The chart follows the wait at anchor for {HORIZON} days after you set the canal’s slots and the ships wanting to cross:
      </P>

      <Figure name="Canal and Strait Simulator · the Panama queue" scenario={q}>
        <XYChart
          ariaLabel={`Wait at anchor over ${HORIZON} days with ${q.state.slots} slots a day and ${fmt(q.state.arrivals, 1)} ships a day wanting to cross. ${
            over ? `The wait grows until it equals the ${days(DETOUR_DAYS)} detour on day ${fmt(cs.divertDay)}.` : `The wait settles at ${fmt(cs.settledWait * 24)} hours.`
          }`}
          series={[{ xs, ys: cs.waits, color: GRAPHIC.teal, width: 2.5, fillTo: 0, fillOpacity: 0.12 }]}
          xMin={0}
          xMax={HORIZON}
          yMin={0}
          yMax={20}
          yTicks={[0, 5, 10, 15, 20]}
          xTicks={[0, 20, 40, 60, 80, 100, 120]}
          xFormat={(v) => `${v}`}
          yFormat={(v) => `${v} d`}
          xLabel="Days after the change"
          yLabel="Wait at anchor, days"
          refLines={[{ y: DETOUR_DAYS, color: TEXT.red, label: `detour by Suez: ${days(DETOUR_DAYS)}` }]}
          markers={Number.isFinite(cs.divertDay) && cs.divertDay <= HORIZON ? [{ x: cs.divertDay, y: DETOUR_DAYS, color: TEXT.red, label: `ships divert from day ${fmt(cs.divertDay)}`, anchor: cs.divertDay > 80 ? 'end' : 'start', labelDy: 18 }] : []}
          height={220}
        />
        <Readouts
          items={[
            { label: 'wait at anchor once settled', value: cs.settledWait < 1 ? `${fmt(cs.settledWait * 24, 1)} hours` : days(cs.settledWait), tone: 'teal' },
            { label: 'ships at anchor once settled', value: fmt(cs.settledQueue) },
            { label: 'ships going round instead', value: cs.divertShare > 0 ? `${pct(cs.divertShare)} · ${fmt(q.state.arrivals - cs.transits, 1)} a day` : 'none', tone: cs.divertShare > 0 ? 'red' : undefined },
          ]}
        />
        <Slider label="Transit slots a day" tone="teal" value={q.state.slots} min={18} max={40} onChange={(v) => q.set({ slots: v })} display={`${q.state.slots} ships`} />
        <Slider label="Ships wanting to cross a day" value={q.state.arrivals} min={15} max={40} step={ARRIVAL_STEP} onChange={(v) => q.set({ arrivals: v })} display={`${fmt(q.state.arrivals, 1)} ships`} />
        <Caption>
          {over
            ? `The canal passes ${q.state.slots} ships a day and ${fmt(q.state.arrivals, 1)} arrive, so the line at anchor grows by ${fmt(q.state.arrivals - q.state.slots, 1)} a day and the wait by ${fmt(((q.state.arrivals - q.state.slots) / q.state.slots) * 24, 1)} hours a day.`
            : `The slots are busy ${pct(q.state.arrivals / q.state.slots)} of the time; ships that arrive in a bunch wait for one to come free.`}
        </Caption>
      </Figure>

      <P>
        At {NORMAL.slots} slots and {NORMAL.arrivals} ships a day, the canal is busy {pct(NORMAL.arrivals / NORMAL.slots)} of the time and a ship waits about{' '}
        {fmt(NORMAL_STATE.settledWait * 24, 1)} hours on average: random arrivals bunch up now and then, but with so many slots working at once the bunches clear
        quickly. Now cut the slots to {CUT_SLOTS}, as a drought might, and leave the ships coming. The canal can no longer keep up, and nothing in the queue’s
        arithmetic stops it growing: every day {fmt(NORMAL.arrivals - CUT_SLOTS)} more ships join the line than leave it, and the wait lengthens by{' '}
        {fmt(((NORMAL.arrivals - CUT_SLOTS) / CUT_SLOTS) * 24)} hours a day.
      </P>
      <P>
        What stops it is the alternative. On day {fmt(DROUGHT.divertDay)} the wait reaches the {days(DETOUR_DAYS)} it would take to go round, and from then on
        the extra ships turn away: the line steadies at about {fmt(DROUGHT.settledQueue)} ships, the canal passes its {CUT_SLOTS} a day, and{' '}
        {pct(DROUGHT.divertShare)} of the traffic sails the long way. Either way, every ship that wanted the canal now spends about {days(DETOUR_DAYS)} longer on
        its voyage, waiting or steaming. A queue is a chokepoint closing slowly. Real canals soften this with reserved slots that owners book in advance, and
        owners decide on expectations rather than waiting to find out, so real queues need not grow this long; but the limit is the same.
      </P>

      <Challenge
        id="a"
        question={`A drought cuts the canal to ${CUT_SLOTS} slots a day. Find the most ships a day, to the nearest half ship, that can keep arriving for ${CHALLENGE_DAYS} days before the wait at anchor grows as long as the detour.`}
        solved={solved}
        status={
          Math.round(q.state.slots) !== CUT_SLOTS
            ? `Set the slots to ${CUT_SLOTS} first; they are at ${q.state.slots}.`
            : Number.isFinite(cs.divertDay)
              ? `At ${fmt(q.state.arrivals, 1)} ships a day, the wait reaches the detour on day ${fmt(cs.divertDay, 1)}.`
              : `At ${fmt(q.state.arrivals, 1)} ships a day, the canal keeps up and the wait never reaches the detour. Can it take more?`
        }
        success={`Solved: ${fmt(ANSWER, 1)} ships a day. The line grows by the ships the canal can't pass, ${fmt(ANSWER - CUT_SLOTS, 1)} a day, and a ship at its back waits that many ÷ ${CUT_SLOTS} days longer each day, so the wait reaches ${days(DETOUR_DAYS)} on day ${fmt(canalState(CUT_SLOTS, ANSWER).divertDay, 1)}. Half a ship more and it gets there on day ${fmt(canalState(CUT_SLOTS, ANSWER + ARRIVAL_STEP).divertDay, 1)}. A small shortfall can hide in a queue for months; a large one shows up within weeks.`}
      />

      <P>
        Chokepoints and queues do the same thing to the fleet: they make voyages longer, so the same cargo needs more ships. Both also hint at something the
        rest of this chapter takes further. Part of the extra time went into empty voyages, because a ship is useful only where the next cargo is: a Kamsarmax
        that has just discharged in Qingdao can do nothing for grain waiting in New Orleans until she has crossed an ocean to get there. Where ships finish their
        voyages, and the empty voyages that bring them back to the cargo, are the subject of <a href={lessonHref('shipping/3.4')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
