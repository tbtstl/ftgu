import { useMemo } from 'react';
import {
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Slider,
  fmt,
  lessonHref,
  linePath,
  mix,
  scale,
  useScenario,
} from '../../../framework';
import {
  DEFAULT_NETWORK,
  ORIGINS,
  districtProduction,
  networkCapacity,
  routeCrop,
  scaleSupply,
  totalSupply,
  valueCurve,
  type NetworkSettings,
  type Routing,
} from '../../../engines/agriculture/logistics';
import { valleyHistory } from '../../../engines/agriculture/valley';
import { DISTRICT, DISTRICTS, type DistrictId } from '../../../model/agriculture/region';
import { ValleyMap } from '../shared/ValleyMap';
import { centsPlain, perBu } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

/** Lesson 3.5's simulated seasons: each season's valley corn harvest and the average split by district. */
const SEASONS = 400;
let seasonCache: { totals: number[]; supply: Record<DistrictId, number> } | null = null;
export function seasons() {
  if (!seasonCache) {
    const h = valleyHistory(SEASONS);
    const per = h.map((s) => districtProduction(s, DISTRICTS));
    const supply = Object.fromEntries(ORIGINS.map((o) => [o, per.reduce((t, p) => t + p[o], 0) / per.length])) as Record<DistrictId, number>;
    seasonCache = { totals: h.map((s) => s.corn / 1e6), supply };
  }
  return seasonCache;
}

export interface NetState {
  /** Harvest, % of average. */
  harvest: number;
  /** Barge freight, cents per bushel. */
  barge: number;
  /** Capacities, million bushels a year. */
  river: number;
  rail: number;
}

export const NET0: NetState = { harvest: 100, barge: 45, river: 180, rail: 170 };

export function settingsOf(st: NetState): NetworkSettings {
  return { ...DEFAULT_NETWORK, supply: scaleSupply(seasons().supply, st.harvest / 100), barge: st.barge / 100, riverCapacity: st.river, railCapacity: st.rail };
}

function lowerIn(st: NetState): DistrictId[] {
  const base = routeCrop(settingsOf(NET0));
  const r = routeCrop(settingsOf(st));
  if (!base || !r) return ORIGINS;
  return ORIGINS.filter((o) => r.locationValue[o] < base.locationValue[o] - 1e-6);
}

/** Challenge 1: the highest barge rate (whole cents) at which no district's corn is worth less than at 45 cents. */
export function bargeSolved(st: NetState): boolean {
  if (st.harvest !== NET0.harvest || st.river !== NET0.river || st.rail !== NET0.rail) return false;
  return lowerIn(st).length === 0 && lowerIn({ ...st, barge: st.barge + 1 }).length > 0;
}

export interface CapState {
  rail: number;
  river: number;
  ethanol: number;
}

export const CAP0: CapState = { rail: 170, river: 180, ethanol: 96 };

function capSettings(c: CapState): Omit<NetworkSettings, 'supply'> {
  return { ...DEFAULT_NETWORK, railCapacity: c.rail, riverCapacity: c.river, ethanol: c.ethanol };
}

/** The share of the simulated seasons whose harvest is more than the network can use and ship. */
export function fillShare(c: CapState): number {
  const cap = networkCapacity(capSettings(c));
  const t = seasons().totals;
  return t.filter((x) => x > cap).length / t.length;
}

/** Challenge 2: the least rail capacity (in steps of 10 million bushels) that fills the network in no more than one season in ten. */
export function railSolved(c: CapState): boolean {
  if (c.river !== CAP0.river || c.ethanol !== CAP0.ethanol) return false;
  return fillShare(c) <= 0.1 && fillShare({ ...c, rail: c.rail - 10 }) > 0.1;
}

const PLACES_SHOWN = ['halsted', 'dunmore', 'fairview', 'ashby', 'landing', 'bluestem', 'feedyards', 'sable', 'westhaven'];
const RAIL_LINE = '#4d4d4d';
const STORED = GRAPHIC.red;

function valueFill(v: number): string {
  const t = Math.max(0, Math.min(1, (v - 3.8) / 1.5));
  return mix('#f4f1e8', GRAPHIC.green, 0.08 + 0.62 * t);
}

const HUB_XY: Record<string, [number, number]> = { halsted: [352, 74], dunmore: [112, 262], fairview: [318, 208], ashby: [528, 210], landing: [470, 322] };

function Flow({ d, f, color }: { d: string; f: number; color: string }) {
  if (f < 0.5) return null;
  return <path d={d} fill="none" stroke={color} strokeWidth={Math.max(1.5, f / 14)} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />;
}

function NetworkMap({ r }: { r: Routing }) {
  const f = (id: string) => r.flows[id] ?? 0;
  const truck = CROP_LINE.corn;
  const rail = {
    ashby: f('ashby-westhaven'),
    halsted: f('halsted-westhaven'),
    fairview: f('fairview-westhaven'),
    dunmore: f('dunmore-westhaven'),
  };
  const lv = r.locationValue;
  return (
    <ValleyMap
      fill={(id) => valueFill(lv[id])}
      label={(id) => [perBu(lv[id])]}
      places={PLACES_SHOWN}
      ariaLabel={`The valley’s corn routes. ${fmt(r.exports.sable)} million bushels go by barge to Port Sable and ${fmt(r.exports.westhaven)} million by rail to Westhaven${r.stored > 0.5 ? `; ${fmt(r.stored)} million stay in the bins` : ''}. A bushel is worth ${ORIGINS.map((o) => `${perBu(lv[o])} in ${DISTRICT[o].name}`).join(', ')}.`}
      beneath={
        <g>
          <Flow d="M400 236 L470 322" f={f('prairie-landing')} color={truck} />
          <Flow d="M505 242 L470 322" f={f('ridge-landing')} color={truck} />
          <Flow d="M318 208 L372 246" f={f('fairview-bluestem')} color={truck} />
          <Flow d="M470 322 L372 246" f={f('landing-bluestem')} color={truck} />
          <Flow d="M112 262 L150 330" f={f('dunmore-feedyards')} color={truck} />
          <Flow d="M318 208 L150 330" f={f('fairview-feedyards')} color={truck} />
          <Flow d="M352 74 L232 120 L150 330" f={f('halsted-feedyards')} color={truck} />
          <Flow d="M528 210 L318 208" f={rail.ashby} color={RAIL_LINE} />
          <Flow d="M352 74 L112 262" f={rail.halsted} color={RAIL_LINE} />
          <Flow d="M318 208 L112 262" f={rail.ashby + rail.fairview} color={RAIL_LINE} />
          <Flow d="M112 262 L0 214" f={rail.ashby + rail.fairview + rail.halsted + rail.dunmore} color={RAIL_LINE} />
          <Flow d="M470 322 C 540 344, 590 352, 640 392" f={f('landing-sable')} color={GRAPHIC.blue} />
          {Object.entries(HUB_XY).map(([h, [x, y]]) => {
            const s = f(`${h}-stored`);
            return s > 0.5 ? <circle key={h} cx={x} cy={y} r={3 + Math.sqrt(s) * 1.6} fill={STORED} opacity={0.45} /> : null;
          })}
        </g>
      }
    />
  );
}

function CurveChart({ curve, totals, cap }: { curve: Array<{ harvest: number; value: number }>; totals: number[]; cap: number }) {
  const X0 = 300;
  const X1 = 720;
  const x = scale(X0, X1, 60, 620);
  const y = scale(3.6, 5.4, 220, 24);
  const BIN = 20;
  const bins = Array.from({ length: (X1 - X0) / BIN }, () => 0);
  for (const t of totals) bins[Math.max(0, Math.min(bins.length - 1, Math.floor((t - X0) / BIN)))]++;
  const most = Math.max(...bins);
  const pts = curve.filter((c) => Number.isFinite(c.value) && c.harvest >= X0 && c.harvest <= X1);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 256"
      role="img"
      aria-label={`What a bushel of Black Prairie corn is worth as the valley’s harvest grows: ${perBu(pts[0]?.value ?? NaN)} in the smallest harvests, falling in steps to ${perBu(pts[pts.length - 1]?.value ?? NaN)} in the largest; the network fills at ${fmt(cap)} million bushels.`}
    >
      <text className="ax" x={60} y={14}>
        Value of a bushel at Black Prairie farms
      </text>
      <GridY y={y} ticks={[4, 4.5, 5]} x0={60} x1={620} format={(v) => `$${v.toFixed(2)}`} />
      {bins.map((n, i) => {
        const h = (n / most) * 80;
        return n > 0 ? <rect key={i} x={x(X0 + i * BIN) + 1} y={220 - h} width={x(X0 + BIN) - x(X0) - 2} height={h} fill={mix('#fcfcfb', CROP_LINE.corn, 0.4)} /> : null;
      })}
      <line x1={60} x2={620} y1={220} y2={220} className="base" />
      {cap >= X0 && cap <= X1 && (
        <g>
          <line x1={x(cap)} x2={x(cap)} y1={28} y2={220} stroke="#333" strokeDasharray="5 4" />
          <text className="ax" x={x(cap) + 5} y={36}>
            network full
          </text>
        </g>
      )}
      <path d={linePath(pts.map((p) => x(p.harvest)), pts.map((p) => y(p.value)))} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} />
      {[300, 400, 500, 600, 700].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={238}>
          {v}
        </text>
      ))}
      <text className="ax ax-e" x={620} y={253}>
        valley corn harvest, million bushels
      </text>
    </svg>
  );
}

const KS = Array.from({ length: 181 }, (_, i) => 0.55 + i * 0.005);

export default function Lesson() {
  const n = useScenario('network', NET0);
  const route = useMemo(() => routeCrop(settingsOf(n.state)), [n.state]);
  const solved1 = useMemo(() => bargeSolved(n.state), [n.state]);
  const lower = useMemo(() => lowerIn(n.state), [n.state]);
  const harvestNow = totalSupply(settingsOf(n.state).supply);
  const isBase = n.state.harvest === NET0.harvest && n.state.river === NET0.river && n.state.rail === NET0.rail;

  const c = useScenario('capacity', CAP0);
  const curve = useMemo(() => valueCurve({ ...capSettings(c.state), supply: seasons().supply }, 'prairie', KS), [c.state]);
  const marks = useMemo(() => valueCurve({ ...capSettings(c.state), supply: seasons().supply }, 'prairie', [1, 1.2]), [c.state]);
  const cap = networkCapacity(capSettings(c.state));
  const share = fillShare(c.state);
  const solved2 = railSolved(c.state);
  const totals = seasons().totals;

  return (
    <LessonPage id="agriculture/4.4">
      <P>
        The Crane Valley grows about 506 million bushels of corn in an average season, and it can’t use most of it. The ethanol plants around Bluestem take 96
        million bushels a year and the High Plains feedyards 120 million — the 18 million a month of <a href={lessonHref('agriculture/4.2')}>Lesson 4.2</a>. The other
        290 million have to leave, and there are two ways out, the same two that carry grain out of the American Midwest. <K tone="gold">Shuttle trains</K> — about
        110 hopper cars that load at one elevator and run straight through to a port — carry corn west to Westhaven, on the coast. Barges carry it down the Crane from
        Crane Landing to Port Sable. A single river barge holds about 1,500 tons, more than 50,000 bushels of corn, and a towboat on the upper Mississippi pushes
        fifteen of them at once. Most of the corn the United States exports leaves from the Gulf of Mexico after just such a trip down the Mississippi; much of the
        rest goes by shuttle train to the Pacific Northwest or by rail to Mexico.
      </P>
      <P>
        Westhaven pays $5.95 a bushel for corn loaded onto a ship, and Port Sable $5.60 — simulated prices, like every price in this course. Getting there costs
        money. Rail freight to Westhaven runs from $1.05 a bushel at Dunmore, the nearest station, to $1.32 at Ashby, the farthest; barge freight from Crane Landing to
        Port Sable is 45 cents; trucks charge 6 to 34 cents for the shorter hauls between farms, elevators, ethanol plants and feedyards. A port’s price less the
        freight to reach it is a bushel’s <K tone="gold">export parity</K>: the most an exporter could pay for it and break even. And each route can carry only so
        much in a year — in our valley, 170 million bushels by rail and 180 million by river.
      </P>
      <P>
        Routing a year’s crop is then a puzzle with an exact answer. A linear program finds it, sending each bushel by whichever route leaves the most money at the
        farm without overfilling any route. In the next demonstration the map shows the answer. Each district’s corn goes first to its own elevator; the lines are
        where it goes from there, as wide as the flow, and each district is labeled with what one more bushel of its corn would be worth. Change the harvest, the
        barge rate and the two routes’ capacities:
      </P>

      <Figure name="Grain Logistics Network" scenario={n}>
        {route ? <NetworkMap r={route} /> : null}
        <Legend
          items={[
            { label: 'Truck', color: CROP_LINE.corn, kind: 'line' },
            { label: 'Rail', color: RAIL_LINE, kind: 'line' },
            { label: 'Barge', color: GRAPHIC.blue, kind: 'line' },
            { label: 'Left in the bins', color: mix('#fcfcfb', STORED, 0.45) },
          ]}
        />
        <Readouts
          items={[
            { label: 'by barge to Port Sable', value: `${fmt(route?.exports.sable ?? 0)} million bu`, tone: 'blue' },
            { label: 'by rail to Westhaven', value: `${fmt(route?.exports.westhaven ?? 0)} million bu` },
            { label: 'left in the bins', value: `${fmt(route?.stored ?? 0)} million bu`, tone: (route?.stored ?? 0) > 0.5 ? 'red' : 'ink' },
            { label: 'river space worth', value: `${centsPlain(route?.riverValue ?? 0)} a bushel`, tone: 'red' },
          ]}
        />
        <Slider label="Harvest" tone="gold" value={n.state.harvest} min={60} max={140} step={5} onChange={(v) => n.set({ harvest: v })} display={`${fmt(harvestNow)} million bu`} />
        <Slider label="Barge freight" tone="blue" value={n.state.barge} min={20} max={120} onChange={(v) => n.set({ barge: v })} display={`${n.state.barge}¢ a bushel`} />
        <Slider label="River capacity" tone="blue" value={n.state.river} min={60} max={240} step={10} onChange={(v) => n.set({ river: v })} display={`${n.state.river} million bu`} />
        <Slider label="Rail capacity" value={n.state.rail} min={100} max={260} step={10} onChange={(v) => n.set({ rail: v })} display={`${n.state.rail} million bu`} />
      </Figure>

      <P>
        The river is the better deal. A bushel at Crane Landing nets $5.15 by barge, while one at the Fairview elevator nets $4.75 by rail, so the river fills first:
        180 million bushels go by barge, and the other 110 million take the train. (That $4.75 at Fairview is the price “at the terminal” that the elevator of{' '}
        <a href={lessonHref('agriculture/4.3')}>Lesson 4.3</a> set its bids against.) Now look at the labels. Each is a <K tone="green">location value</K> — what one more
        bushel at that place adds to the value of the whole network — and it is what a competitive buyer can afford to pay there. In the Black Prairie it is $4.65: an
        extra bushel would be trucked to Fairview for 10 cents and railed west for $1.20, which is its export parity. The surprise is the River Bottoms. Its corn is a
        short truck ride from the barges, yet it is worth no more than the Black Prairie’s, because the river is full: an extra Bottoms bushel can get on a barge only
        by pushing an Upland Ridge bushel off it and onto a train. The barge’s 42-cent advantage over the train reaches no farm. It belongs to the river space itself,
        as its <K tone="red">scarcity value</K>.
      </P>

      <Challenge
        id="a"
        question="Barge lines can see when the river is full. With an average harvest, 180 million bushels of river and 170 of rail, how high can the barge rate go, to the cent, before corn anywhere in the valley is worth less than it is at 45 cents?"
        solved={solved1}
        status={
          !isBase
            ? 'Keep an average harvest, 180 million bushels of river and 170 million of rail.'
            : lower.length > 0
              ? `At ${n.state.barge}¢, corn is worth less in ${lower.map((o) => DISTRICT[o].name).join(', ')}.`
              : `At ${n.state.barge}¢, every district’s corn is worth what it was at 45¢. Could the rate go higher?`
        }
        success={`Solved: at ${n.state.barge}¢ the barge leaves Upland Ridge corn exactly what the train does, the river space has no scarcity value left, and every district’s corn is worth what it was at 45 cents. One cent more and Ridge corn switches to the train, the river runs short of full, and a bushel in the River Bottoms is worth less. Until then, a higher barge rate only moves the river’s scarcity value from whoever holds barge space to the barge lines.`}
      />

      <P>
        That is why barge rates swing as much as they do. Barge freight on the Mississippi is priced in an open market; it climbs in the autumn, when the harvest
        needs the river most, and ice ends the upper river’s season each winter. A high barge rate in a busy autumn is mostly the river’s scarcity value showing up
        in the freight bill. It costs farmers only once it makes a train — or a bin — the better place for the last bushel.
      </P>

      <H2>When the network fills</H2>
      <P>
        In any one year the routes are what they are. The harvest isn’t. Make it 20% larger than average in <FigRef to="Grain Logistics Network">the network</FigRef>{' '}
        and both routes fill: 42 million bushels can’t leave and stay in the valley’s bins, carried into the next year. We value a bushel carried over at $4.00 at
        the elevator — what next year’s buyers might pay, less a year of storage and interest. Now the last bushel’s outlet is a bin rather than a port, and every
        district’s corn loses 63 cents of value; the Black Prairie’s falls to $4.02. Low water does the same from the other side. Cut the river to 120 million
        bushels, as when barges must load light in a dry autumn, and the train can’t carry the difference; a few hundred thousand bushels stay behind, and that small
        remainder takes 63 cents or more off corn across the valley, because prices are set by the last bushel. Real markets are less abrupt — the ports’ prices and
        next year’s value move too — but they move the same way. In the autumn of 2022 the Mississippi ran so low that barges were loaded light, freight rates set
        records, and corn at river elevators weakened sharply against the futures price; low water returned the next autumn.
      </P>
      <P>
        How often does the valley’s network fill? <a href={lessonHref('agriculture/3.5')}>Lesson 3.5</a> simulated 400 seasons of the valley’s weather and crops, and
        their harvests are the bars in the next demonstration. The line is what a bushel on a Black Prairie farm is worth as the whole valley’s harvest grows, with
        each district keeping its usual share; the dashed line is what the network can take, the valley’s own use plus both routes. Change the routes and the
        ethanol plants:
      </P>

      <Figure name="Grain Logistics Network · how often it fills" scenario={c}>
        <CurveChart curve={curve} totals={totals} cap={cap} />
        <Legend
          items={[
            { label: 'Value of a Black Prairie bushel', color: GRAPHIC.green, kind: 'line' },
            { label: 'Harvests in 400 simulated seasons', color: mix('#fcfcfb', CROP_LINE.corn, 0.4) },
            { label: 'What the network can take', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'network can take', value: `${fmt(cap)} million bu` },
            { label: 'seasons it fills', value: `${fmt(share * 100, 1)}%`, tone: share > 0.1 ? 'red' : 'ink' },
            { label: 'Prairie bushel, average harvest', value: perBu(marks[0].value), tone: 'green' },
            { label: 'harvest 20% larger', value: perBu(marks[1].value), tone: 'green' },
          ]}
        />
        <Slider label="Rail capacity" value={c.state.rail} min={100} max={260} step={10} onChange={(v) => c.set({ rail: v })} display={`${c.state.rail} million bu`} />
        <Slider label="River capacity" tone="blue" value={c.state.river} min={60} max={240} step={10} onChange={(v) => c.set({ river: v })} display={`${c.state.river} million bu`} />
        <Slider label="Ethanol plants’ use" tone="gold" value={c.state.ethanol} min={48} max={192} step={8} onChange={(v) => c.set({ ethanol: v })} display={`${c.state.ethanol} million bu`} />
      </Figure>

      <P>
        The line is a staircase, and each step down is a change in where the last bushel goes. In the smallest harvests the ethanol plants and feedyards must bid
        corn away from the barges, and a Black Prairie bushel is worth $5.15. Then the barges set the price, then the trains — $4.65 through the middle of the range —
        and past 566 million bushels, the bins. With today’s routes that happens in 74 of the 400 seasons, nearly one in five. More capacity moves the cliff to the
        right, and so does more use inside the valley: in a big year, an ethanol plant that uses 48 million bushels does as much for the valley’s farmers as 48
        million bushels more of rail. Economists who studied the ethanol boom of the 2000s found that a new plant raised the local price of corn, most of all nearest
        the plant. The worst squeezes come when a big crop meets a network busy with something else: in the winter of 2013–14 a record American corn crop met
        railroads crowded with crude oil from North Dakota’s new wells, and grain backed up across the northern Plains.
      </P>

      <Challenge
        id="b"
        question="Planners build for the bad years. With the river at 180 million bushels and the ethanol plants at 96 million, how much rail capacity, to the nearest 10 million bushels, does the valley need for its network to fill in no more than one season in ten?"
        solved={solved2}
        status={
          c.state.river !== CAP0.river || c.state.ethanol !== CAP0.ethanol
            ? 'Keep the river at 180 million bushels and the ethanol plants at 96 million.'
            : share > 0.1
              ? `With ${c.state.rail} million bushels of rail, the network fills in ${fmt(share * 100, 1)}% of seasons.`
              : `${fmt(share * 100, 1)}% of seasons fill the network. Could less rail do?`
        }
        success={`Solved: ${c.state.rail} million bushels of rail lets the valley use and ship ${fmt(cap)} million bushels a year, and only ${fmt(share * SEASONS)} of the 400 seasons grow more. The extra ${fmt(c.state.rail - CAP0.rail)} million bushels — ${fmt((c.state.rail - CAP0.rail) / 0.4)} more shuttle trains a year — halves how often the valley’s corn gets stuck. Whether that is worth building is the same question the valley’s farmers asked about bins in Lesson 4.2: what does the capacity cost, and how often will it pay?`}
      />

      <P>
        Through this whole lesson the two ports’ prices stayed put: $5.95 at Westhaven, $5.60 at Port Sable. They are set far from the Crane Valley, by every other
        grain region’s harvest and every importing country’s appetite — the world’s balance of corn and wheat, which is the subject of the next lesson.
      </P>
    </LessonPage>
  );
}
