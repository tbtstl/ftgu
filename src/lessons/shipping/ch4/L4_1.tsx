import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
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
  TEXT,
  Tn,
  fmt,
  lessonHref,
  scale,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { ALBATROSS } from '../../../model/shipping/vessels';
import { PLACE } from '../../../model/shipping/geo';
import { MARKET_CLASSES } from '../../../model/shipping/trades';
import { clearMarket, reservation, tceAt, type Clearing, type LaneSpec, type MarketShip, type Offer } from '../../../engines/shipping/clearing';
import { equilibrium, type Equilibrium } from '../../../engines/shipping/market';
import { COMMISSION } from '../../../engines/shipping/voyage';
import { XYChart } from '../shared/XYChart';

// ---------------------------------------------------------------------------
// The Tubarão fortnight.

const CARGO = 170_000;
/** Ships must reach Tubarão within this many days to load this fortnight's cargoes. */
export const WINDOW_DAYS = 45;
export const DEFAULTS = { cargoes: 6, alternative: 15_000, bunker: 600 };

export const LANE: LaneSpec = {
  vessel: ALBATROSS,
  load: 'TUB',
  discharge: 'QIN',
  cargo: CARGO,
  portDays: 6,
  portCosts: MARKET_CLASSES.cape.portCosts,
  ladenSpeed: 11,
  ballastSpeed: 12,
  bunker: DEFAULTS.bunker,
};

export const SHIPS: MarketShip[] = [
  { id: 'heron', name: 'Heron', at: 'TUB', openIn: 4 },
  { id: 'osprey', name: 'Osprey', at: 'SAN', openIn: 7 },
  { id: 'albatross', name: 'Albatross', at: 'RBY', openIn: 2 },
  { id: 'cormorant', name: 'Cormorant', at: 'CVD', openIn: 1 },
  { id: 'shearwater', name: 'Shearwater', at: 'NOL', openIn: 5 },
  { id: 'puffin', name: 'Puffin', at: 'ROT', openIn: 6 },
  { id: 'kittiwake', name: 'Kittiwake', at: 'SIN', openIn: 0 },
  { id: 'guillemot', name: 'Guillemot', at: 'PAR', openIn: 3 },
  { id: 'curlew', name: 'Curlew', at: 'QIN', openIn: 0 },
  { id: 'sandpiper', name: 'Sandpiper', at: 'QIN', openIn: 4 },
  { id: 'plover', name: 'Plover', at: 'QIN', openIn: 12 },
];

/** Charterers' bids, keenest first: what each cargo's buyer will pay before giving it up, $/t. */
export const BIDS = [34, 32, 30, 28.5, 27, 25.5, 24, 22.5, 21, 19.5];
export const MAX_CARGOES = BIDS.length;

export function offersAt(alternative: number, bunker: number): Offer[] {
  return SHIPS.map((s) => reservation(s, { ...LANE, bunker }, alternative, WINDOW_DAYS));
}

export function marketAt(cargoes: number, alternative: number, bunker: number): Clearing {
  return clearMarket(
    offersAt(alternative, bunker),
    BIDS.slice(0, cargoes).map((bid, i) => ({ id: `c${i + 1}`, bid })),
  );
}

/** Heron's surplus: her margin over her reservation at the market freight, on the cargo less commission, $. */
export function heronSurplus(cargoes: number, alternative: number, bunker: number): number {
  const c = marketAt(cargoes, alternative, bunker);
  const heron = offersAt(alternative, bunker).find((o) => o.ship.id === 'heron')!;
  return cargoes >= 1 && Number.isFinite(c.rate) ? (c.rate - heron.reservation) * CARGO * (1 - COMMISSION) : 0;
}

/**
 * The challenge: at the starting earnings elsewhere and bunker price, the fewest cargoes at which
 * Heron's surplus is at least double what six cargoes give her.
 */
export function doubleSolved(cargoes: number, alternative: number, bunker: number): boolean {
  if (alternative !== DEFAULTS.alternative || bunker !== DEFAULTS.bunker) return false;
  const target = 2 * heronSurplus(DEFAULTS.cargoes, alternative, bunker);
  return heronSurplus(cargoes, alternative, bunker) >= target && heronSurplus(cargoes - 1, alternative, bunker) < target;
}

const placeName = (at: string) => PLACE[at].name;
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const perT = (x: number) => `${usd(x, 2)}/t`;
const perDay = (x: number) => `${usd(x)}/day`;

// Numbers for the prose, at the starting settings.
const BASE = marketAt(DEFAULTS.cargoes, DEFAULTS.alternative, DEFAULTS.bunker);
const NEXT = marketAt(DEFAULTS.cargoes + 1, DEFAULTS.alternative, DEFAULTS.bunker);
const OFFERS0 = [...offersAt(DEFAULTS.alternative, DEFAULTS.bunker)].sort((a, b) => a.reservation - b.reservation);
const byId = (offers: Offer[], id: string) => offers.find((o) => o.ship.id === id)!;
const HERON = byId(OFFERS0, 'heron');
const BASE_REACH = Math.max(...BASE.fixtures.map((f) => f.ship.ballastNm));
const CURLEW = byId(OFFERS0, 'curlew');
const PLOVER = byId(OFFERS0, 'plover');
/** Six cargoes' surplus for Heron, and the challenge's answer: the fewest cargoes that double it. */
export const SURPLUS6 = heronSurplus(DEFAULTS.cargoes, DEFAULTS.alternative, DEFAULTS.bunker);
export const DOUBLE_N = Array.from({ length: MAX_CARGOES }, (_, i) => i + 1).find((n) => doubleSolved(n, DEFAULTS.alternative, DEFAULTS.bunker)) ?? MAX_CARGOES;
const DOUBLED = marketAt(DOUBLE_N, DEFAULTS.alternative, DEFAULTS.bunker);
/** The cargoes between six and the answer, whose marginal ships aren't dear enough. */
const SHORT_OF = Array.from({ length: DOUBLE_N - DEFAULTS.cargoes - 1 }, (_, i) => marketAt(DEFAULTS.cargoes + 1 + i, DEFAULTS.alternative, DEFAULTS.bunker));
/** Albatross's earnings when she is the marginal ship, and at the starting six cargoes, $/day. */
export const ALB_MARGINAL_N = Array.from({ length: MAX_CARGOES }, (_, i) => i + 1).find((n) => marketAt(n, DEFAULTS.alternative, DEFAULTS.bunker).fixtures.at(-1)?.ship.ship.id === 'albatross') ?? 0;
const albTceAt = (n: number) => {
  const f = marketAt(n, DEFAULTS.alternative, DEFAULTS.bunker).fixtures.find((x) => x.ship.ship.id === 'albatross')!;
  return tceAt(f.ship, LANE, marketAt(n, DEFAULTS.alternative, DEFAULTS.bunker).rate, DEFAULTS.alternative);
};
export const ALB_TCE_MARGINAL = albTceAt(ALB_MARGINAL_N);
export const ALB_TCE_BASE = albTceAt(DEFAULTS.cargoes);
const ALBATROSS_AT = byId(OFFERS0, 'albatross');

// ---------------------------------------------------------------------------
// The whole market.

const DEMANDS = Array.from({ length: 41 }, (_, i) => 0.6 + i * 0.02);
const BASE_FLEET = MARKET_CLASSES.cape.fleet;

function sweep(fleet: number, bunker: number): Equilibrium[] {
  return DEMANDS.map((d) => equilibrium('cape', { demand: d, fleet, bunker }));
}

const BASELINE = equilibrium('cape');
const SWEEP0 = sweep(BASE_FLEET, 600);
const IDLE_END = DEMANDS[SWEEP0.findIndex((e) => e.idleShips < 0.5)];
const CHOKE = DEMANDS[SWEEP0.findIndex((e) => e.served < 0.999)] ?? 1.4;
const at = (d: number, bunker = 600) => equilibrium('cape', { demand: d, bunker });
const c3 = (e: Equilibrium) => e.routes.find((r) => r.route.id === 'C-TUB-QIN')!.freight;
const pctOf = (d: number) => `${fmt(d * 100)}%`;

// Lay-up: each age group's lay-up point, and the floor they make.
const COHORTS = MARKET_CLASSES.cape.cohorts;
export const OLDEST = COHORTS[COHORTS.length - 1];
export const NEWEST = COHORTS[0];
export interface FloorStep {
  from: number;
  to: number;
  tce: number;
  /** The age group whose lay-up point sets this step (it is partly laid up). */
  cohort: string;
}
/** The floor's steps at the baseline fleet and bunkers: runs of demand with ships idle at one level of earnings. */
export const FLOOR_STEPS: FloorStep[] = (() => {
  const steps: FloorStep[] = [];
  DEMANDS.forEach((d, i) => {
    const e = SWEEP0[i];
    if (e.idleShips < 0.5) return;
    const last = steps[steps.length - 1];
    if (last && Math.abs(last.tce - e.tce) < 1) last.to = d;
    else steps.push({ from: d, to: d, tce: e.tce, cohort: COHORTS.find((k) => Math.abs(k.layup - e.tce) < 1)?.name ?? '' });
  });
  return steps;
})();
const LOWER = FLOOR_STEPS[0];
const UPPER = FLOOR_STEPS[FLOOR_STEPS.length - 1];
// Past the choke: charterers give up cargo while ships are still speeding up.
export const CHOKE_EQ = at(CHOKE);
export const TOP = at(DEMANDS[DEMANDS.length - 1]);
/** Extra earnings per point of demand, $/day: near 90% and past the choke. */
export const SLOPE_LOW = (at(1).tce - at(0.9).tce) / 10;
export const SLOPE_HIGH = (TOP.tce - CHOKE_EQ.tce) / ((DEMANDS[DEMANDS.length - 1] - CHOKE) * 100);
const round100 = (x: number) => Math.round(x / 100) * 100;

// Chart geometry for the staircase.
const X0 = 56;
const X1 = 620;
const Y0 = 220;
const YT = 24;
const SLOT = (X1 - X0) / SHIPS.length;

export default function Lesson() {
  const s = useScenario('tubarao', DEFAULTS);
  const { cargoes, alternative, bunker } = s.state;
  const offers = useMemo(() => offersAt(alternative, bunker), [alternative, bunker]);
  const c = useMemo(() => marketAt(cargoes, alternative, bunker), [cargoes, alternative, bunker]);
  const order = [...c.offers, ...offers.filter((o) => !o.inWindow)];
  const fixedIds = new Set(c.fixtures.map((f) => f.ship.ship.id));
  const marginal = c.fixtures.length ? c.fixtures[c.fixtures.length - 1].ship : null;
  const alb = c.fixtures.find((f) => f.ship.ship.id === 'albatross')?.ship;
  const albTce = alb ? tceAt(alb, { ...LANE, bunker }, c.rate, alternative) : null;
  const solved = doubleSolved(cargoes, alternative, bunker);
  const heronRes = offers.find((o) => o.ship.id === 'heron')!.reservation;
  const gap6 = BASE.rate - HERON.reservation;
  const y = scale(0, 40, Y0, YT);
  const yc = (v: number) => y(Math.min(40, v));
  const bidPath = c.bids
    .map((b, i) => `${i ? 'L' : 'M'}${(X0 + i * SLOT).toFixed(1)} ${yc(b.bid).toFixed(1)} L${(X0 + (i + 1) * SLOT).toFixed(1)} ${yc(b.bid).toFixed(1)}`)
    .join(' ');
  const unfixed = c.bids.length - c.fixtures.length;

  const m = useScenario('whole-market', { demand: 1, fleet: BASE_FLEET, bunker: 600 });
  const curve = useMemo(() => sweep(m.state.fleet, m.state.bunker), [m.state.fleet, m.state.bunker]);
  const ref = useMemo(() => (m.state.bunker !== 600 || m.state.fleet !== BASE_FLEET ? SWEEP0 : null), [m.state.bunker, m.state.fleet]);
  const eq = useMemo(() => equilibrium('cape', { demand: m.state.demand, fleet: m.state.fleet, bunker: m.state.bunker }), [m.state.demand, m.state.fleet, m.state.bunker]);
  const idleEnd = DEMANDS[curve.findIndex((e) => e.idleShips < 0.5)] ?? 1.4;
  const chokeIdx = curve.findIndex((e) => e.served < 0.999);
  const choke = chokeIdx >= 0 ? DEMANDS[chokeIdx] : null;
  const region =
    eq.idleShips >= 0.5
      ? 'Ships are laid up: earnings sit on the floor set by the oldest ships’ lay-up points.'
      : eq.served < 0.999
        ? 'Earnings have passed what the least valuable cargoes can pay: charterers give some of them up, while the ships keep speeding up.'
        : 'Every ship is trading: earnings are whatever makes the fleet steam fast enough to carry the cargo.';

  return (
    <LessonPage id="shipping/4.1">
      <P>
        Chapter 3 ended with a number for demand: the tonne-miles the world’s trades must move, the ballast voyages their lopsided flows force, the days lost in
        port. Chapter 2 gave us supply: a fleet that can slow down or speed up, whose oldest ships are the first to stop paying their way, and that grows only
        years after it’s ordered. This chapter asks how
        the two meet — how a fleet of ships that move becomes a market for moving things — and this lesson starts with one place and one fortnight, to see how many
        separate ships and cargoes arrive at a single price. From here on the course puts prices on things. All of them come from our model: realistic in size,
        simulated in every detail, and not market data.
      </P>
      <P>
        The place is Tubarão, in Brazil, and the cargoes are iron ore for China, {fmt(CARGO)} tonnes each, loading in the next few weeks. Charterers — the mining
        companies and traders who own the ore — need Capesizes to lift them. When an owner and a charterer agree terms for a cargo, the ship is “fixed” and the
        deal is a <K tone="green">fixture</K>. Around the world, eleven Capesizes are about to come <b>open</b>: free of their last
        cargo, wherever that left them. Each owner can work out the least freight per tonne that would make this cargo worth taking, its{' '}
        <K tone="green">reservation freight</K>. It has to pay for sailing empty to Tubarão, for the laden voyage to Qingdao, for fuel, port charges and
        commissions — and for the ship’s time, which is worth whatever she could earn elsewhere instead:
      </P>
      <Eq label="Reservation freight equals fuel plus port costs plus days times the alternative earnings, divided by cargo times one minus commission">
        <K tone="green">reservation</K>
        <Op>=</Op>
        <Frac
          top={
            <span>
              <Tn tone="red">fuel</Tn> + ports + <Tn tone="teal">days</Tn> × <Tn tone="green">alternative</Tn>
            </span>
          }
          bottom={<span>cargo × (1 − commission)</span>}
        />
      </Eq>
      <P>
        In the next demonstration the blue bars are the eleven ships’ reservation freights, cheapest first, labeled with where each comes open. The orange
        staircase is the charterers’ bids, keenest first: the most each will pay before the cargo isn’t worth shipping. A ship must reach Tubarão within{' '}
        {WINDOW_DAYS} days to load in this fortnight’s windows. Set how many cargoes are quoting, what a day of a ship’s time earns elsewhere, and the price of
        bunkers:
      </P>

      <Figure name="Freight Clearing Engine" scenario={s}>
        <Legend
          items={[
            { label: 'Ships’ reservation freights (solid: fixed)', color: GRAPHIC.blue },
            { label: 'Charterers’ bids', color: GRAPHIC.orange, kind: 'line' },
            { label: 'Market freight', color: GRAPHIC.green, kind: 'line' },
          ]}
        />
        <svg
          className="chart"
          viewBox="0 0 640 300"
          role="img"
          aria-label={`Capesize market at Tubarão: ${cargoes} cargoes and ${c.offers.length} ships able to load in time. ${c.fixtures.length} fixtures at ${Number.isFinite(c.rate) ? perT(c.rate) : 'no rate'}; the marginal ship is ${marginal ? `${marginal.ship.name}, open at ${placeName(marginal.ship.at)}` : 'none'}.`}
        >
          <text className="ax" x={X0} y={12}>
            Freight, $ per tonne
          </text>
          <GridY y={y} ticks={[0, 10, 20, 30, 40]} x0={X0} x1={X1} format={(v) => `$${v}`} baseline={0} />
          {Number.isFinite(c.rate) && (
            <rect x={X0} y={yc(c.high)} width={X1 - X0} height={Math.max(0, yc(c.low) - yc(c.high))} fill={tint(GRAPHIC.green, 0.18)} />
          )}
          {order.map((o, i) => {
            const fixed = fixedIds.has(o.ship.id);
            const x = X0 + i * SLOT + 3;
            const top = yc(o.reservation);
            const isAlb = o.ship.id === 'albatross';
            return (
              <g key={o.ship.id}>
                <rect
                  x={x}
                  y={top}
                  width={SLOT - 6}
                  height={Math.max(0, Y0 - top)}
                  fill={o.inWindow ? (fixed ? GRAPHIC.blue : tint(GRAPHIC.blue, 0.35)) : '#ffffff'}
                  stroke={o.inWindow ? 'none' : '#9a9a9a'}
                  strokeDasharray={o.inWindow ? undefined : '3 3'}
                />
                <text x={x + (SLOT - 6) / 2} y={top - 5} textAnchor="middle" style={{ fontSize: 10, fill: isAlb ? TEXT.ink : '#5f5f5f', fontWeight: isAlb ? 600 : 400 }}>
                  {isAlb ? 'Albatross' : o.inWindow ? `$${fmt(o.reservation, 1)}` : 'too late'}
                </text>
                <text
                  x={x + (SLOT - 6) / 2}
                  y={Y0 + 12}
                  textAnchor="end"
                  transform={`rotate(-35 ${x + (SLOT - 6) / 2} ${Y0 + 12})`}
                  style={{ fontSize: 10.5, fill: '#444' }}
                >
                  {placeName(o.ship.at).replace('Off ', 'off ')}
                </text>
              </g>
            );
          })}
          <path d={bidPath} fill="none" stroke={GRAPHIC.orange} strokeWidth={2.5} />
          {Number.isFinite(c.rate) && (
            <g>
              <line x1={X0} x2={X1} y1={yc(c.rate)} y2={yc(c.rate)} stroke={TEXT.green} strokeWidth={2} />
              <text x={X1} y={yc(c.rate) - 6} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: TEXT.green, paintOrder: 'stroke', stroke: '#fcfcfb', strokeWidth: 3 }}>
                market freight {perT(c.rate)}
              </text>
            </g>
          )}
        </svg>
        <Readouts
          items={[
            { label: 'marginal ship', value: marginal ? `${marginal.ship.name}, ${placeName(marginal.ship.at)}` : '—' },
            { label: 'Albatross earns', value: albTce !== null ? perDay(albTce) : 'not fixed', tone: albTce !== null ? 'green' : undefined },
          ]}
        />
        <Slider label="Cargoes this fortnight" tone="orange" value={cargoes} min={1} max={MAX_CARGOES} onChange={(v) => s.set({ cargoes: v })} display={`${cargoes}`} />
        <Slider label="What a day earns elsewhere" tone="green" value={alternative} min={0} max={40_000} step={500} onChange={(v) => s.set({ alternative: v })} display={perDay(alternative)} />
        <Slider label="Bunker price" tone="red" value={bunker} min={300} max={900} step={10} onChange={(v) => s.set({ bunker: v })} display={`${usd(bunker)}/t`} />
        <Caption>
          {Number.isFinite(c.rate)
            ? `Any freight in the shaded band, from ${perT(c.low)} to ${Number.isFinite(c.high) ? perT(c.high) : 'the last bid'}, would clear: no ship left out would take less, and no cargo left out would pay more. We quote the bottom.${unfixed > 0 ? ` ${unfixed} cargo${unfixed > 1 ? 'es go' : ' goes'} unfixed.` : ''}`
            : 'No ship can be had for what any charterer will pay: nothing trades.'}
        </Caption>
      </Figure>

      <P>
        At the starting settings, six cargoes are quoting. Heron, already at Tubarão, needs only {perT(HERON.reservation)}; she has no empty voyage to pay for.
        Every mile a ship must sail in ballast raises the bar a little, so the staircase climbs with distance — the positional advantage of{' '}
        <a href={lessonHref('shipping/3.4')}>Lesson 3.4</a>, now measured in dollars. The six cheapest ships are all within{' '}
        {fmt(Math.ceil(BASE_REACH / 100) * 100)} miles of Tubarão; the sixth is {BASE.fixtures[BASE.fixtures.length - 1].ship.ship.name}, open at{' '}
        {placeName(BASE.fixtures[BASE.fixtures.length - 1].ship.ship.at)}, and the market freight is her reservation: {perT(BASE.rate)}.
      </P>
      <P>
        Notice that every fixture is done at that one freight. A charterer has no reason to pay Heron more than {perT(BASE.rate)} when another ship would accept it,
        and Heron has no reason to take less when the market will pay it. Real fixtures are negotiated privately, ship by ship, through shipbrokers, but
        competition pushes them toward a single going rate in the same way. The cheap ships keep the gap between the freight and their reservations: Heron’s{' '}
        {perT(BASE.rate - HERON.reservation)} on {fmt(CARGO)} tonnes, less commission, is about {usd(Math.round(SURPLUS6 / 1000) * 1000)} for being in
        the right place. The Albatross readout shows rent in daily terms. Set {NUMBER_WORDS[ALB_MARGINAL_N]} cargoes: Albatross, open at{' '}
        {placeName(ALBATROSS_AT.ship.at)}, is now the marginal ship, the freight is her own reservation, and she earns exactly the{' '}
        {perDay(ALB_TCE_MARGINAL)} she could earn elsewhere — nothing more. With six cargoes she earns {perDay(ALB_TCE_BASE)}; the difference is her rent.
      </P>

      <H2>The marginal ship sets the rate</H2>
      <P>
        Now add a seventh cargo. The nearby ships are all taken, and the next cheapest, {NEXT.fixtures[NEXT.fixtures.length - 1].ship.ship.name}, is in{' '}
        {placeName(NEXT.fixtures[NEXT.fixtures.length - 1].ship.ship.at)}, {fmt(NEXT.fixtures[NEXT.fixtures.length - 1].ship.ballastNm)} miles away. The freight
        jumps to {perT(NEXT.rate)}, {fmt((NEXT.rate / BASE.rate - 1) * 100)}% more, for every fixture, because one more cargo had to reach across an ocean. Demand
        for ships hardly bends: the orange staircase sits far above the ships’ costs because a mill short of ore pays almost anything rather than stop. So it’s
        supply, and the position of the marginal ship, that decides the price.
      </P>
      <P>
        The other sliders move every bar together. Raise the earnings available elsewhere and each owner asks more, because a day spent on this voyage is a day
        not spent on another: that is how Brazil’s market is tied to the Pacific’s, and why rates in different places move together. Raise bunkers and the far
        ships rise most, since they burn the most fuel getting here. Plover, open in Qingdao in {fmt(PLOVER.ship.openIn)} days, can’t reach Tubarão until day{' '}
        {fmt(PLOVER.ship.openIn + PLOVER.ballastDays)}, too late for any of this fortnight’s windows, so she doesn’t count at any price.
      </P>

      <Challenge
        id="a"
        question={`Predict first. With six cargoes, Heron’s surplus is about ${usd(Math.round(SURPLUS6 / 1000) * 1000)}. At the starting settings, what is the fewest number of cargoes that at least doubles it? Work it out from the reservation freights on the bars, then set it.`}
        solved={solved}
        status={
          alternative !== DEFAULTS.alternative || bunker !== DEFAULTS.bunker
            ? `Put the earnings elsewhere back to ${perDay(DEFAULTS.alternative)} and the bunker price to ${usd(DEFAULTS.bunker)} a tonne.`
            : cargoes === DEFAULTS.cargoes
              ? `With six cargoes Heron keeps ${perT(gap6)} over her reservation. Predict how many cargoes double that, then set it.`
              : heronSurplus(cargoes, alternative, bunker) < 2 * SURPLUS6
                ? `With ${cargoes} cargo${cargoes > 1 ? 'es' : ''}, Heron keeps ${perT(Number.isFinite(c.rate) ? Math.max(0, c.rate - heronRes) : 0)} over her reservation, against ${perT(gap6)} with six: not yet double.`
                : `With ${cargoes} cargoes Heron’s surplus is more than double, but fewer cargoes already do it.`
        }
        success={`Solved: ${DOUBLE_N} cargoes. Heron’s surplus doubles when the gap between the freight and her ${perT(HERON.reservation)} reservation doubles, to ${perT(2 * (BASE.rate - HERON.reservation))}: a freight of at least ${perT(HERON.reservation + 2 * (BASE.rate - HERON.reservation))}. ${SHORT_OF.map((m) => `${m.fixtures.at(-1)!.ship.ship.name}, from ${placeName(m.fixtures.at(-1)!.ship.ship.at)}, asks ${perT(m.rate)}`).join('; ')}: not enough. The ${ORDINALS[DOUBLE_N]} cargo fetches ${DOUBLED.fixtures.at(-1)!.ship.ship.name} from ${placeName(DOUBLED.fixtures.at(-1)!.ship.ship.at)}, at ${perT(DOUBLED.rate)}, and Heron makes ${usd(heronSurplus(DOUBLE_N, DEFAULTS.alternative, DEFAULTS.bunker))} without moving. The further the marginal ship has to come, the more rent the near ones keep.`}
      />

      <H2>From one port to the whole market</H2>
      <P>
        Our fortnight at Tubarão leaves out most of what Chapters 2 and 3 found: ships that speed up when earnings are good, and a world of trades sending ships
        back and forth. It leaves out one more choice, too. An owner whose ship can’t earn her keep can <K tone="teal">lay her up</K>: moor her in a sheltered
        anchorage with a skeleton crew, cut her insurance and stop her engines. A laid-up ship burns no fuel and saves most of her crew and upkeep, but she still
        pays for the few people aboard, her mooring and her reduced insurance, her loan runs on regardless, and laying her up and bringing her back takes weeks
        and costs money. So lay-up is a last resort. The running-cost break-even of <a href={lessonHref('shipping/2.4')}>Lesson 2.4</a> marks where trading
        starts to lose cash; below it an owner keeps trading at a loss, as long as the loss is smaller than lying idle would cost. Her <b>lay-up point</b> is
        lower still, where the two losses are equal. In our model it is {perDay(OLDEST.layup)} for Capesizes {OLDEST.name}, which burn the most fuel and cost
        the most to keep, falling with age to {perDay(NEWEST.layup)} for those {NEWEST.name} old.
      </P>
      <P>
        The market model puts all of this together. For every trade it counts the ship-days needed — laden voyages, ballast voyages, port calls — and it finds
        the daily earnings, the time-charter equivalent, at which the fleet supplies exactly that many: laid-up ships come back once earnings pass their lay-up
        point, and every ship sails at the speed the rule of <a href={lessonHref('shipping/2.3')}>Lesson 2.3</a> picks for those earnings. The freight on each
        route then pays for the voyage at those earnings, plus the ballast voyage the trade forces.
      </P>
      <P>
        In the next demonstration that market is the world’s Capesizes. The curve is the market’s earnings against demand, as a share of the course’s baseline
        trades, for the fleet and bunker price you set; the dot is the demand you choose:
      </P>

      <Figure name="Freight Clearing Engine · the whole market" scenario={m}>
        <XYChart
          ariaLabel={`Capesize earnings against demand from 60% to 140% of the baseline, for a fleet of ${fmt(m.state.fleet)} ships and bunkers at ${usd(m.state.bunker)} a tonne. At ${pctOf(m.state.demand)} the market pays ${perDay(eq.tce)}, ships sail at ${fmt(eq.ladenSpeed, 1)} knots laden and ${fmt(eq.idleShips)} are idle.`}
          series={[
            ...(ref ? [{ xs: DEMANDS.map((d) => d * 100), ys: ref.map((e) => e.tce), color: '#9a9a9a', width: 1.5, dash: '5 4' }] : []),
            { xs: DEMANDS.map((d) => d * 100), ys: curve.map((e) => e.tce), color: GRAPHIC.green, width: 2.5 },
          ]}
          xMin={60}
          xMax={140}
          yMin={0}
          yMax={70_000}
          yTicks={[0, 20_000, 40_000, 60_000]}
          xTicks={[60, 80, 100, 120, 140]}
          xFormat={(v) => `${v}%`}
          yFormat={(v) => `$${fmt(v / 1000)}k`.replace('$−', '−$')}
          xLabel="Demand, % of the baseline trades"
          yLabel="Market earnings, $ per day (TCE)"
          bands={[
            { from: 60, to: idleEnd * 100, color: tint(GRAPHIC.gray, 0.16), label: 'ships laid up' },
            ...(choke !== null ? [{ from: choke * 100, to: 140, color: tint(GRAPHIC.red, 0.16), label: 'charterers drop cargo' }] : []),
          ]}
          markers={[{ x: m.state.demand * 100, y: Math.min(70_000, eq.tce), color: TEXT.green }]}
          height={240}
        />
        {ref && <Caption>The dashed curve is the baseline fleet with bunkers at $600, for comparison.</Caption>}
        <Readouts
          items={[
            { label: 'market earnings', value: perDay(eq.tce), tone: 'green' },
            { label: 'fleet speed, laden', value: `${fmt(eq.ladenSpeed, 1)} kn`, tone: 'teal' },
            { label: 'ships idle', value: fmt(eq.idleShips) },
            { label: 'cargo carried', value: `${fmt(eq.served * 100, 1)}%` },
            { label: 'freight, Tubarão–Qingdao', value: perT(c3(eq)), tone: 'green' },
          ]}
        />
        <Slider label="Demand" tone="orange" value={m.state.demand} min={0.6} max={1.4} step={0.02} onChange={(v) => m.set({ demand: v })} display={pctOf(m.state.demand)} />
        <Slider label="Fleet" value={m.state.fleet} min={600} max={1_000} step={10} onChange={(v) => m.set({ fleet: v })} display={`${fmt(m.state.fleet)} ships`} />
        <Slider label="Bunker price" tone="red" value={m.state.bunker} min={300} max={900} step={10} onChange={(v) => m.set({ bunker: v })} display={`${usd(m.state.bunker)}/t`} />
        <Caption>{region}</Caption>
      </Figure>

      <P>
        The curve has three parts. Below about {pctOf(IDLE_END)} of baseline demand there are more ships than work, the surplus is laid up, and earnings sit on
        a floor set by the lay-up points — a short staircase, in fact: {perDay(UPPER.tce)} from {pctOf(UPPER.from)} to {pctOf(UPPER.to)}, while only ships{' '}
        {UPPER.cohort} are laid up, and {perDay(LOWER.tce)} at {pctOf(LOWER.to)} and below, where those {LOWER.cohort} old join them. Above the floor every ship
        is needed, and the only way to carry more cargo is to sail faster. Earnings rise to make the extra fuel worth burning: {perDay(at(0.9).tce)} at{' '}
        {pctOf(0.9)}, {perDay(BASELINE.tce)} at the baseline, {perDay(at(1.2).tce)} at {pctOf(1.2)}, as the fleet’s laden speed climbs from{' '}
        {fmt(at(0.9).ladenSpeed, 1)} to {fmt(at(1.2).ladenSpeed, 1)} knots. Past about {pctOf(CHOKE)}, earnings pass {perDay(MARKET_CLASSES.cape.choke)}, more
        than the least valuable cargoes can pay, and charterers start to give them up: at {pctOf(DEMANDS[DEMANDS.length - 1])}, {fmt((1 - TOP.served) * 100)}% of the
        cargo stays ashore. The ships still aren’t at full speed — the fleet averages {fmt(TOP.ladenSpeed, 1)} knots laden there, against a limit of{' '}
        {fmt(MARKET_CLASSES.cape.vMax, 1)} — so faster ships and lost cargo balance the market together, and earnings keep climbing steeply: about{' '}
        {usd(round100(SLOPE_HIGH))} a day for each extra point of demand, against about {usd(round100(SLOPE_LOW))} near {pctOf(0.9)}. A small change in demand
        there moves earnings a lot; on the floor it hardly moves them at all.
      </P>
      <P>
        At the baseline the market pays {perDay(BASELINE.tce)}, and the Brazil–China freight is {perT(c3(BASELINE))}. That is in line with what a ship from
        Qingdao needed in <FigRef to="Freight Clearing Engine">the first demonstration</FigRef> — {perT(CURLEW.reservation)} when a day elsewhere was worth
        $15,000, rather than the {perDay(BASELINE.tce)} the whole market pays — and for the same reason: in the whole market, the ships that carry Brazil’s ore have mostly ballasted from China, so the freight has to pay for that voyage. Add ships
        with the fleet slider and the curve slides right; take them away and it slides left, which is how the orders and scrappings of{' '}
        <a href={lessonHref('shipping/2.5')}>Lesson 2.5</a> reach the price.
      </P>
      <P>
        Now move the bunker price, at the baseline demand and then at {pctOf(0.7)}. When every ship is needed, dearer fuel raises earnings — from{' '}
        {perDay(at(1, 400).tce)} with bunkers at $400 to {perDay(at(1, 800).tce)} at $800 — because the market has to pay ships enough to burn expensive fuel at
        the speed demand requires. On the floor, with ships idle, it makes no difference: {perDay(at(0.7, 400).tce)} either way. That follows from our model’s
        speed rule, and real markets have other ways to adjust, but the direction is right: who pays for fuel depends on how tight the market is.
      </P>
      <P>
        So far a fixture has simply meant a ship and a cargo agreeing on a freight per tonne. In practice there are several ways to hire a ship, and they divide the
        voyage’s risks very differently. <a href={lessonHref('shipping/4.2')}>The next lesson</a> compares the two most common: paying per tonne for a voyage,
        or paying per day for the ship.
      </P>
    </LessonPage>
  );
}
