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
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  usd,
  useScenario,
} from '../../../framework';
import { ALBATROSS } from '../../../model/shipping/vessels';
import { PLACE } from '../../../model/shipping/geo';
import { BASE_BUNKER, MARKET_CLASSES, type ClassId } from '../../../model/shipping/trades';
import { OPEX, opexTotal } from '../../../engines/shipping/economics';
import { assignmentCost, bestAssignment, position, type Assignment, type CargoNeed, type OpenShip, type PositionOptions } from '../../../engines/shipping/positioning';
import { fleetRequirement } from '../../../engines/shipping/market';
import { seaRoute } from '../../../engines/shipping/network';
import { ballastDraft, fuelPerDay } from '../../../engines/shipping/voyage';
import { WorldMap, type MapPort, type MapRoute } from '../shared/WorldMap';

// ---------------------------------------------------------------------------
// Demonstration 1: five open Capesizes, four cargoes.

export const SHIPS: OpenShip[] = [
  { id: 'albatross', name: 'Albatross', at: 'QIN', openDay: 0 },
  { id: 'gannet', name: 'Gannet', at: 'SIN', openDay: 3 },
  { id: 'skua', name: 'Skua', at: 'ROT', openDay: 6 },
  { id: 'tern', name: 'Tern', at: 'PAR', openDay: 2 },
  { id: 'fulmar', name: 'Fulmar', at: 'QIN', openDay: 8 },
];

export const CARGOES: CargoNeed[] = [
  { id: 'tub', port: 'TUB', from: 30, to: 40, label: 'Iron ore at Tubarão' },
  { id: 'phe', port: 'PHE', from: 10, to: 16, label: 'Iron ore at Port Hedland' },
  { id: 'rby', port: 'RBY', from: 16, to: 24, label: 'Coal at Richards Bay' },
  { id: 'new', port: 'NEW', from: 18, to: 26, label: 'Coal at Newcastle' },
];

type ShipChoice = 'albatross' | 'gannet' | 'skua' | 'tern' | 'fulmar' | 'none';
export type Plan = Record<string, ShipChoice>;

/** A day of a Capesize's time, valued at her operating cost (Lesson 2.4). */
export const DAY_VALUE = opexTotal(OPEX[ALBATROSS.id]);
const MISS = 1e9;
const DRAFT = ballastDraft(ALBATROSS);

export function positionOptions(speed: number): PositionOptions {
  return { speed, bunker: BASE_BUNKER, dayValue: DAY_VALUE };
}

function toPairs(plan: Plan): Record<string, string | null> {
  return Object.fromEntries(CARGOES.map((c) => [c.id, plan[c.id] && plan[c.id] !== 'none' ? plan[c.id] : null]));
}

/** Positioning cost and cargoes covered by a plan (late or missing cargoes add a large penalty). */
export function planCost(plan: Plan, speed: number): { cost: number; filled: number } {
  return assignmentCost(ALBATROSS, SHIPS, CARGOES, toPairs(plan), positionOptions(speed), MISS);
}

const BEST = new Map<number, Assignment>();

/** The cheapest plan at a ballast speed, covering as many cargoes as possible first. */
export function cheapestPlan(speed: number): Assignment {
  const key = Math.round(speed * 10);
  let b = BEST.get(key);
  if (!b) {
    b = bestAssignment(ALBATROSS, SHIPS, CARGOES, positionOptions(speed), MISS);
    BEST.set(key, b);
  }
  return b;
}

/** The challenge: every cargo covered, at no more than the cheapest plan's cost (to the dollar). */
export function cheapestSolved(plan: Plan, speed: number): boolean {
  // A ship can sail to only one cargo.
  const used = Object.values(plan).filter((s) => s !== 'none');
  if (new Set(used).size !== used.length) return false;
  const best = cheapestPlan(speed);
  const r = planCost(plan, speed);
  return best.filled === CARGOES.length && r.filled === CARGOES.length && r.cost <= best.cost + 1;
}

/**
 * The starting plan: first open, first served. Ships in the order they come open take the cargoes in
 * the order their windows open, which covers all four but sends Albatross and Gannet the wrong way.
 */
export const START_PLAN: Plan = { tub: 'skua', phe: 'albatross', rby: 'tern', new: 'gannet' };

/** The cargoes a ship can reach inside their loading windows at a ballast speed. */
export function reachableCargoes(ship: OpenShip, speed: number): CargoNeed[] {
  const o = positionOptions(speed);
  return CARGOES.filter((c) => position(ALBATROSS, ship, c, o).ok);
}

const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** What the challenge's success message says about the ships a plan leaves without a cargo. */
export function idleNote(plan: Plan, speed: number): string {
  const idle = SHIPS.filter((s) => !CARGOES.some((c) => plan[c.id] === s.id));
  if (!idle.length) return 'No ship is left without a cargo.';
  return idle
    .map((s) => {
      const reach = reachableCargoes(s, speed);
      if (!reach.length) return `${s.name} is left without a cargo, open in ${PLACE[s.at].name} with no cargo she can reach before its loading window closes.`;
      return `${s.name} is left without a cargo: she could reach ${andList(reach.map((c) => PLACE[c.port].name))} in time, but other ships do ${reach.length > 1 ? 'those jobs' : 'that job'} for less.`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Demonstration 2: the world's ballasters.

/** Load and discharge ports in the Atlantic basin; everything else is the Pacific and Indian Oceans. */
const ATLANTIC = new Set(['TUB', 'SAN', 'NOL', 'ROT']);

const SCALES: Record<ClassId, { brazil: string[]; australia: string[] }> = {
  cape: { brazil: ['C-TUB-QIN', 'C-TUB-ROT'], australia: ['C-PHE-QIN'] },
  kmax: { brazil: ['P-SAN-QIN'], australia: ['P-NEW-QIN'] },
};

export function ballasters(cls: ClassId, brazil: number, australia: number) {
  const routeScale: Record<string, number> = {};
  for (const id of SCALES[cls].brazil) routeScale[id] = brazil;
  for (const id of SCALES[cls].australia) routeScale[id] = australia;
  const req = fleetRequirement(cls, { routeScale });
  const intoAtlantic = req.plan.flows.filter((f) => !ATLANTIC.has(f.from) && ATLANTIC.has(f.to)).reduce((s, f) => s + f.ships, 0);
  return { req, intoAtlantic };
}

// Numbers for the prose.
const O12 = positionOptions(12);
const ALB_TUB = position(ALBATROSS, SHIPS[0], CARGOES[0], O12);
const SKUA_TUB = position(ALBATROSS, SHIPS[2], CARGOES[0], O12);
const START12 = planCost(START_PLAN, 12);
const BEST12 = cheapestPlan(12);
const BEST10 = cheapestPlan(10);
const FUEL_BALLAST_12 = fuelPerDay(ALBATROSS, 12, DRAFT);
const FULMAR_NEW_10 = position(ALBATROSS, SHIPS[4], CARGOES[3], positionOptions(10));
export const ALB_NEW_12 = position(ALBATROSS, SHIPS[0], CARGOES[3], O12);
export const GANNET_NEW_12 = position(ALBATROSS, SHIPS[1], CARGOES[3], O12);
export const FULMAR_NEW_12 = position(ALBATROSS, SHIPS[4], CARGOES[3], O12);
const CAPE = ballasters('cape', 1, 1);
const CAPE_B15 = ballasters('cape', 1.5, 1);
const CAPE_A15 = ballasters('cape', 1, 1.5);
const KMAX = ballasters('kmax', 1, 1);
const KMAX_PAR_SAN = KMAX.req.plan.flows.find((f) => f.from === 'PAR' && f.to === 'SAN');
const shipName = (id: string | null) => SHIPS.find((s) => s.id === id)?.name ?? 'no ship';
const nm = (x: number) => `${fmt(x)} nm`;
const days = (x: number) => `${fmt(x, 1)} days`;
const usdK = (x: number) => usd(Math.round(x / 1000) * 1000);

const SHIP_COLOR = TEXT.ink;

export default function Lesson() {
  // ---- Demonstration 1.
  const pos = useScenario('positioning', { speed: 12, ...START_PLAN });
  const speed = pos.state.speed;
  const plan: Plan = Object.fromEntries(CARGOES.map((c) => [c.id, (pos.state as unknown as Plan)[c.id]]));
  const opts = positionOptions(speed);
  const legs = CARGOES.map((c) => {
    const ship = SHIPS.find((s) => s.id === plan[c.id]);
    return { cargo: c, ship, p: ship ? position(ALBATROSS, ship, c, opts) : null };
  });
  const sailing = legs.filter((l) => l.p);
  const covered = legs.filter((l) => l.p?.ok);
  const totNm = sailing.reduce((s, l) => s + l.p!.nm, 0);
  const totDays = sailing.reduce((s, l) => s + l.p!.days, 0);
  const totFuel = sailing.reduce((s, l) => s + l.p!.fuel, 0);
  const totCost = sailing.reduce((s, l) => s + l.p!.cost, 0);
  const best = cheapestPlan(speed);
  const solved = cheapestSolved(plan, speed);
  const startCost = planCost(START_PLAN, speed).cost;
  const assign = (cargo: string, ship: ShipChoice) =>
    pos.set((s) => {
      const next: Record<string, ShipChoice> = {};
      for (const c of CARGOES) {
        const cur = (s as unknown as Plan)[c.id];
        next[c.id] = c.id === cargo ? ship : ship !== 'none' && cur === ship ? 'none' : cur;
      }
      return next;
    });
  const idle = SHIPS.filter((s) => !CARGOES.some((c) => plan[c.id] === s.id));

  const routes1: MapRoute[] = legs
    .filter((l) => l.ship && l.p)
    .map((l) => ({
      points: seaRoute(l.ship!.at, l.cargo.port, { draft: DRAFT })?.points ?? [],
      color: l.p!.ok ? GRAPHIC.teal : GRAPHIC.red,
      dash: l.p!.ok ? undefined : '5 4',
      width: 2.5,
      flow: l.p!.ok,
    }));
  const ports1: MapPort[] = [
    ...CARGOES.map((c) => ({ id: c.port, color: GRAPHIC.orange, sub: `days ${c.from}–${c.to}` })),
    ...['QIN', 'SIN', 'ROT', 'PAR'].map((id) => ({ id, label: false as const, r: 3, color: '#9a9a9a' })),
  ];
  const ships1 = SHIPS.map((s, i) => {
    const pl = PLACE[s.at];
    const second = SHIPS.slice(0, i).some((o) => o.at === s.at);
    return { lat: pl.lat - (second ? 3.2 : 0), lon: pl.lon + (second ? 1.5 : 0), color: SHIP_COLOR, label: s.name, laden: false };
  });

  // ---- Demonstration 2.
  const wb = useScenario('ballasters', { cls: 'cape' as ClassId, brazil: 1, australia: 1 });
  const cls = wb.state.cls;
  const { req, intoAtlantic } = useMemo(() => ballasters(cls, wb.state.brazil, wb.state.australia), [cls, wb.state.brazil, wb.state.australia]);
  const vessel = MARKET_CLASSES[cls].vessel;
  const maxShips = Math.max(...req.plan.flows.map((f) => f.ships), 1);
  const routes2: MapRoute[] = req.plan.flows.map((f) => ({
    points: seaRoute(f.from, f.to, { draft: ballastDraft(vessel) })?.points ?? [],
    color: !ATLANTIC.has(f.from) && ATLANTIC.has(f.to) ? GRAPHIC.orange : GRAPHIC.blue,
    width: 1.5 + 7 * (f.ships / maxShips),
    opacity: 0.85,
  }));
  const ports2: MapPort[] = [
    ...Object.entries(req.plan.ready).map(([id, v]) => ({ id, color: GRAPHIC.orange, sub: nm(v) })),
    ...Object.entries(req.plan.open).map(([id, v]) => ({ id, color: GRAPHIC.blue, sub: nm(v) })),
  ];
  const flowRows = [...req.plan.flows].sort((a, b) => b.ships - a.ships);

  return (
    <LessonPage id="shipping/3.4">
      <P>
        As the trades map of <a href={lessonHref('shipping/3.1')}>Lesson 3.1</a> showed, the trades of our world run one way. Iron ore leaves Brazil and Western
        Australia for China; coal leaves Australia, South Africa and Indonesia for China
        and India; grain leaves the Americas for Asia. Almost nothing comes back in the same ships. So when a Capesize finishes discharging ore in Qingdao she is
        empty, and her next cargo is somewhere else — often an ocean away. The voyage she makes to reach it, carrying only seawater ballast, is a{' '}
        <K tone="blue">ballast voyage</K>. It earns nothing, and it is where the chapter’s question gets its answer: why can ships be scarce in Brazil while others
        sit idle in China?
      </P>
      <P>
        A ship that has finished discharging is said to be <b>open</b>: free for her next job, at a place and on a day. A cargo comes with a{' '}
        <K tone="teal">loading window</K>, or <b>laycan</b>, the days within which the charterer will accept a ship at the loading port. A ship that arrives early
        waits; one that arrives after the window closes loses the cargo to another ship. To compare ballast voyages we’ll count what they cost: the fuel burned,
        at an illustrative {usd(BASE_BUNKER)} a tonne, and the days, each valued at a Capesize’s operating cost of {usd(DAY_VALUE)} from{' '}
        <a href={lessonHref('shipping/2.4')}>Lesson 2.4</a>, because those costs run whether the ship is carrying cargo or not.
      </P>
      <P>
        In the next demonstration, five Capesizes are coming open. Albatross is in Qingdao today, Tern in Paradip on day 2, Gannet in Singapore on day 3, Skua in
        Rotterdam on day 6 and Fulmar in Qingdao on day 8. In reality they’d belong to different owners; for now, imagine one planner deciding for all five. Four
        cargoes need a ship in the coming weeks. Choose a ship for each — the map draws her ballast voyage, solid if she arrives in the window and dashed if she
        doesn’t — and set the speed the ships will sail at in ballast:
      </P>

      <Figure name="Fleet Positioning Simulator" scenario={pos}>
        <WorldMap
          ariaLabel={`Open Capesizes and four cargoes. ${legs.map((l) => `${l.cargo.label}: ${l.ship ? `${l.ship.name}, ${nm(l.p!.nm)} in ballast, ${l.p!.ok ? `arriving day ${fmt(l.p!.arrive, 1)}` : `late, day ${fmt(l.p!.arrive, 1)}`}` : 'no ship'}`).join('. ')}.`}
          routes={routes1}
          ports={ports1}
          ships={ships1}
        />
        {legs.map((l) => (
          <div key={l.cargo.id} style={{ margin: '6px 0 0' }}>
            <div style={{ fontSize: 14, lineHeight: 1.4, color: '#5f5f5f' }}>
              {l.cargo.label}, days {l.cargo.from}–{l.cargo.to}:{' '}
              {l.p ? (
                l.p.ok ? (
                  <span>
                    {l.ship!.name} sails {nm(l.p.nm)} in {days(l.p.days)} and arrives on day {fmt(l.p.arrive, 1)}
                    {l.p.early > 0.05 ? `, then waits ${days(l.p.early)}` : ''} · {usdK(l.p.cost)}
                  </span>
                ) : (
                  <span style={{ color: TEXT.red }}>
                    {l.ship!.name} can’t arrive before day {fmt(l.p.arrive, 1)}: too late
                  </span>
                )
              ) : (
                <span>no ship</span>
              )}
            </div>
            <Segmented
              label={`Ship for ${l.cargo.label}`}
              value={plan[l.cargo.id]}
              onChange={(v) => assign(l.cargo.id, v)}
              options={[...SHIPS.map((s) => ({ value: s.id as ShipChoice, label: s.name })), { value: 'none' as ShipChoice, label: 'none' }]}
            />
          </div>
        ))}
        <Readouts
          items={[
            { label: 'miles in ballast', value: nm(totNm), tone: 'blue' },
            { label: 'days in ballast', value: fmt(totDays, 1), tone: 'teal' },
            { label: 'fuel burned', value: `${fmt(totFuel)} t`, tone: 'gold' },
            { label: 'positioning cost', value: usdK(totCost), tone: 'green' },
          ]}
        />
        <Slider label="Speed in ballast" tone="teal" value={speed} min={10} max={14} step={0.5} onChange={(v) => pos.set({ speed: v })} display={`${fmt(speed, 1)} kn`} />
        <Caption>
          {covered.length < CARGOES.length ? (
            <span style={{ color: TEXT.red }}>
              {covered.length} of {CARGOES.length} cargoes covered
            </span>
          ) : (
            'All four cargoes covered'
          )}
          {idle.length ? `; left without a cargo: ${idle.map((s) => s.name).join(', ')}.` : '; every ship has a cargo.'}
          {solved ? ` This is the cheapest plan at ${fmt(speed, 1)} knots.` : ''}
        </Caption>
      </Figure>

      <P>
        The starting plan follows the simplest rule a planner could use: first open, first served. Albatross, Northwind’s own ship and the first to come open,
        takes the first cargo to load, the ore at Port Hedland; Tern takes the coal at Richards Bay, Gannet the coal at Newcastle, and Skua the Brazilian ore,
        which loads last. Fulmar, open last, is left over. Every cargo is covered, and the four ballast voyages cost {usdK(START12.cost)} together.
      </P>
      <P>
        Skua is the right ship for Tubarão, and it is worth seeing why. Albatross could go instead: from Qingdao she would sail {nm(ALB_TUB.nm)} round the Cape
        of Good Hope — {days(ALB_TUB.days)} at 12 knots, burning {fmt(FUEL_BALLAST_12, 1)} tonnes of fuel a day — and reach the port on day{' '}
        {fmt(ALB_TUB.arrive, 1)}, just inside a window that closes on day {CARGOES[0].to}, for {usdK(ALB_TUB.cost)}. Skua, open in Rotterdam, is{' '}
        {nm(SKUA_TUB.nm)} from Tubarão and could be there on day {fmt(SKUA_TUB.arrive, 1)}, so early that she would wait {days(SKUA_TUB.early)} for the window to
        open, and still her voyage costs only {usdK(SKUA_TUB.cost)}. Distance is the advantage that matters. A ship already in the Atlantic beats one in the
        Pacific for an Atlantic cargo by thousands of miles, and no amount of speed makes that up.
      </P>

      <Challenge
        id="a"
        question="First open, first served covers every cargo, but not at the lowest cost. Predict first: which of its voyages would you change, and which ship would you leave without a cargo? Then cover all four cargoes at the lowest total positioning cost."
        solved={solved}
        status={
          covered.length < CARGOES.length
            ? `${covered.length} of ${CARGOES.length} cargoes are covered.`
            : `All four cargoes are covered for ${usdK(totCost)}. Is there a cheaper plan?`
        }
        success={`Solved. At ${fmt(speed, 1)} knots the cheapest plan sends ${andList(CARGOES.map((c) => `${shipName(best.pairs[c.id])} to ${PLACE[c.port].name}`))}, for ${usdK(best.cost)}, ${usdK(startCost - best.cost)} less than first open, first served. ${idleNote(plan, speed)}`}
      />

      <H2>The window decides who can compete</H2>
      <P>
        At 12 knots the cheapest plan covers all four cargoes for {usdK(BEST12.cost)} and leaves Albatross, the first ship open, without a cargo. Gannet takes
        Port Hedland: from Singapore she is far nearer to it than Albatross is from Qingdao. Newcastle’s cheapest single voyage would be Gannet’s too, at{' '}
        {usdK(GANNET_NEW_12.cost)}, but she saves more at Port Hedland, so Newcastle goes to Fulmar — not to Albatross, though both sail from Qingdao, because
        Albatross would arrive {days(ALB_NEW_12.early)} before the window opens and pay for the wait. Neither the first ship open nor the nearest is always the
        one that should go: what matters is the whole set of voyages, because every ship can only go one way. Slow the fleet to 10 knots in <FigRef to="Fleet Positioning Simulator">the first demonstration</FigRef> and the answer changes. Fulmar, open in Qingdao on day 8, now can’t reach Newcastle before day{' '}
        {fmt(FULMAR_NEW_10.arrive, 1)}, after the window closes on day {CARGOES[3].to}, so the cheapest plan becomes{' '}
        {CARGOES.map((c) => `${shipName(BEST10.pairs[c.id])} to ${PLACE[c.port].name}`).join(', ')}.
      </P>
      <P>
        That is the window’s real role. For a cargo loading in Brazil next week, the ships that can compete are only those already in the Atlantic or already
        sailing toward it. A ship open in Qingdao today needs more than a month to get there, however urgently she is wanted. In the short run, the supply of ships
        for a cargo is fixed by where the ships happen to be.
      </P>

      <H2>The world’s ballasters</H2>
      <P>
        Scale those four cargoes up to a whole year of our world’s trades and the same logic becomes a map. In the next demonstration, the lines are the ballast
        voyages the trades require. Each follows the shortest sea route of <a href={lessonHref('shipping/3.1')}>Lesson 3.1</a>, and together they are planned at
        the least total distance: every ship that discharges somewhere sails empty to wherever ships are needed next. Line widths are voyages a year; the orange
        ones run from the Pacific and Indian Oceans into the Atlantic. Each port is labeled with its <K tone="blue">positional value</K>: how many ballast miles a
        ship there saves, compared with a ship at the worst-placed port, which is labeled 0. Change how much ore Brazil and Australia export, or switch to the
        Kamsarmax trades:
      </P>

      <Figure name="Fleet Positioning Simulator · the world’s ballasters" scenario={wb}>
        <Segmented
          label="Size class"
          value={cls}
          onChange={(v) => wb.set({ cls: v })}
          options={[
            { value: 'cape', label: 'Capesize: ore and coal' },
            { value: 'kmax', label: 'Kamsarmax: grain and coal' },
          ]}
        />
        <WorldMap
          ariaLabel={`Ballast voyages of the ${MARKET_CLASSES[cls].name} trades: ${flowRows.map((f) => `${PLACE[f.from].name} to ${PLACE[f.to].name}, ${fmt(f.ships)} voyages a year`).join('; ')}. ${fmt(intoAtlantic)} ballast voyages a year into the Atlantic.`}
          routes={routes2}
          ports={ports2}
        />
        <Legend
          items={[
            { label: 'Ballast voyages', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Into the Atlantic from the Pacific and Indian Oceans', color: GRAPHIC.orange, kind: 'line' },
            { label: 'Loading port', color: GRAPHIC.orange },
            { label: 'Discharge port', color: GRAPHIC.blue },
          ]}
        />
        <Readouts
          items={[
            { label: 'ships needed at 12 kn laden, 13 in ballast', value: fmt(req.ships) },
            { label: 'ballast miles per laden mile', value: fmt(req.ballastRatio, 2), tone: 'blue' },
            { label: 'ballast voyages a year into the Atlantic', value: fmt(intoAtlantic), tone: 'orange' },
          ]}
        />
        <Slider
          label={cls === 'cape' ? 'Brazil’s ore exports' : 'Brazil’s soybean exports'}
          tone="orange"
          value={wb.state.brazil}
          min={0.5}
          max={1.5}
          step={0.05}
          onChange={(v) => wb.set({ brazil: v })}
          display={`${fmt(wb.state.brazil * 100)}% of today`}
        />
        <Slider
          label={cls === 'cape' ? 'Australia’s ore exports' : 'Australia’s coal exports'}
          tone="orange"
          value={wb.state.australia}
          min={0.5}
          max={1.5}
          step={0.05}
          onChange={(v) => wb.set({ australia: v })}
          display={`${fmt(wb.state.australia * 100)}% of today`}
        />
        <DataTable
          caption="Ballast voyages a year, largest first"
          rows={flowRows}
          rowKey={(f) => `${f.from}-${f.to}`}
          columns={[
            { label: 'Ballast voyage', cell: (f) => `${PLACE[f.from].name} → ${PLACE[f.to].name}` },
            { label: 'Voyages a year', cell: (f) => fmt(f.ships), align: 'right' },
            { label: 'Miles each', cell: (f) => fmt(f.nm), align: 'right' },
          ]}
        />
      </Figure>

      <P>
        In the Capesize trades, {fmt(CAPE.intoAtlantic)} times a year a ship leaves China empty for Brazil, each time sailing {nm(CAPE.req.plan.flows.find((f) => f.from === 'QIN' && f.to === 'TUB')?.nm ?? 0)}.
        No Capesize cargo leaves China, so every ship that arrives there leaves in ballast, and every ballast voyage is a laden voyage run backward: the fleet
        sails exactly {fmt(CAPE.req.ballastRatio, 2)} ballast miles for every laden one. The positional values say how lopsided that makes the map. A ship ready to
        load at Tubarão is worth {nm(CAPE.req.plan.ready.TUB)} fewer ballast miles than one open in Qingdao, and a ship discharging in Rotterdam is{' '}
        {nm(CAPE.req.plan.open.ROT)} better placed than one discharging in China, because from Rotterdam the next Brazilian cargo is a short hop.
      </P>
      <P>
        Raise Brazil’s ore exports by half and the ballast voyages into the Atlantic rise to {fmt(CAPE_B15.intoAtlantic)} a year, and the ships needed to carry the
        trades from {fmt(CAPE.req.ships)} to {fmt(CAPE_B15.req.ships)}: each extra tonne from Brazil ties up a ship for a long laden voyage and an equally long
        empty one. Put Brazil back and raise Australia’s by half instead: the trades need{' '}
        {fmt(CAPE_A15.req.ships)} ships, but not one more ballast voyage enters the Atlantic: Australian
        ore goes to China, and its ships sail straight back. Now switch to the Kamsarmax trades, which are more tangled. Some of the ships that discharge Indonesian and South African coal in India sail
        on to Brazil for soybeans — {fmt(KMAX_PAR_SAN?.ships ?? 0)} voyages a year, {nm(KMAX_PAR_SAN?.nm ?? 0)} each — and some that discharge in China cross the Pacific to
        the US Gulf for grain. Because ships can often find their next cargo nearer than the port their last one came from, the Kamsarmax fleet sails{' '}
        {fmt(KMAX.req.ballastRatio, 2)} ballast miles per laden mile.
      </P>
      <P>
        This is the answer to the chapter’s question. Capacity is plentiful where cargoes end and scarce where they start, and the gap between them is weeks of
        empty sailing. At any moment there may be ships idle in Qingdao and charterers in Tubarão unable to find one, and both can be true for a month, because
        that is how long it takes to close the distance. Ships will make that voyage only if someone pays for it; in{' '}
        <a href={lessonHref('shipping/4.1')}>Chapter 4</a> we’ll see how freight rates do exactly that.
      </P>
      <P>
        Ballast voyages are one way that distance multiplies the work a cargo creates. The other is the length of the laden voyage itself: a tonne of ore from
        Brazil travels nearly three times as far as a tonne from Australia. <a href={lessonHref('shipping/3.5')}>The next lesson</a> measures demand for ships the
        way the industry does, in tonne-miles.
      </P>
    </LessonPage>
  );
}
