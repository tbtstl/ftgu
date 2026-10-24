import { useMemo, type ReactNode } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  NetworkView,
  P,
  Segmented,
  Slider,
  TimeChart,
  fmt,
  hour,
  lessonHref,
  loadingColor,
  mw,
  pct,
  signed,
  useScenario,
} from '../../framework';
import { islandFlows, overloadedLines } from '../../engines/ops/cascade';
import { EVENING_PEAK, regionCase } from '../../engines/ops/regionGrid';
import { REGION, nodeName } from '../../model/networks';

export interface PlaygroundState {
  hour: number;
  /** Extra demand in Metro, MW. */
  metro: number;
  /** Line ratings as a percentage of normal. */
  rating: number;
  /** Lines out of service. */
  out: string[];
}

export const PLAYGROUND_DEFAULTS: PlaygroundState = { hour: EVENING_PEAK, metro: 0, rating: 100, out: [] };

export function limitsAt(rating: number): Record<string, number> {
  return Object.fromEntries(REGION.lines.map((l) => [l.id, (l.limit * rating) / 100]));
}

/** Merit-order dispatch at the chosen hour, then the flows on whatever lines are left. */
export function playground(s: PlaygroundState, h = s.hour) {
  const rc = regionCase({ hour: h, extraLoad: { city: s.metro } });
  const st = islandFlows(REGION, rc.units, rc.loads, s.out, limitsAt(s.rating));
  return { rc, st, overloads: overloadedLines(st, 1) };
}

export const RATING_RANGE = [70, 130, 5] as const;

/** The lowest rating on the slider's grid at which no line is over its rating at the reference evening peak, with every line in. */
export const LOWEST_SAFE_RATING = (() => {
  let best = -1;
  for (let r = RATING_RANGE[1]; r >= RATING_RANGE[0]; r -= RATING_RANGE[2]) {
    if (playground({ ...PLAYGROUND_DEFAULTS, rating: r }).overloads.length) break;
    best = r;
  }
  return best;
})();

/** Is the figure at the reference evening peak, with every line in service and no extra demand? */
export function atReference(s: PlaygroundState): boolean {
  return s.hour === EVENING_PEAK && s.metro === 0 && s.out.length === 0;
}

/** The challenge: the ratings lowered as far as they can go before the first line is over its rating. */
export function heatWaveSolved(s: PlaygroundState): boolean {
  return atReference(s) && s.rating === LOWEST_SAFE_RATING;
}

/** The three lines into Metro (every one has Metro as its `to` end, so a positive flow is an import). */
export const INTO_METRO = ['center-city', 'east-city', 'west-city'];

/** Metro's imports: the net flow in over its lines, and the combined rating of those in service. */
export function metroImports(s: Pick<PlaygroundState, 'out' | 'rating'>, flows: Record<string, number>) {
  const limits = limitsAt(s.rating);
  const inService = INTO_METRO.filter((id) => !s.out.includes(id));
  return {
    imported: inService.reduce((t, id) => t + flows[id], 0),
    rated: inService.reduce((t, id) => t + limits[id], 0),
  };
}

/** The reference evening peak, and the same hour with the ratings at the challenge's answer. */
const REFERENCE = playground(PLAYGROUND_DEFAULTS);
const HEAT_WAVE = playground({ ...PLAYGROUND_DEFAULTS, rating: LOWEST_SAFE_RATING });
const HEAT_WAVE_IMPORTS = metroImports({ out: [], rating: LOWEST_SAFE_RATING }, HEAT_WAVE.st.flows);

/** Metro's imports at the reference evening peak as a share of its lines' combined rating, and the rating (in 5% steps) at which the lines could just hold them if the imports could be shared out freely. */
export const REFERENCE_IMPORTS = metroImports(PLAYGROUND_DEFAULTS, REFERENCE.st.flows);
export const TANK_SHARE = REFERENCE_IMPORTS.imported / REFERENCE_IMPORTS.rated;
export const TANK_RATING = Math.ceil((TANK_SHARE * 100) / RATING_RANGE[2]) * RATING_RANGE[2];

export const lineName = (id: string) => {
  const l = REGION.lines.find((x) => x.id === id)!;
  return `${nodeName(REGION, l.from)}–${nodeName(REGION, l.to)}`;
};

const LABEL_OFFSET: Record<string, [number, number]> = {
  'north-center': [-40, -4],
  'north-east': [0, -12],
  'harbor-center': [-6, -14],
  'harbor-west': [44, -4],
  'west-center': [44, 6],
  'center-city': [35, -23],
  'east-city': [52, 6],
  'west-city': [10, 24],
};
const LABEL_POS: Record<string, 'above' | 'below' | 'left' | 'right'> = {
  north: 'above',
  east: 'above',
  center: 'right',
  harbor: 'below',
  west: 'below',
  city: 'right',
};
const SERIES_COLORS = [GRAPHIC.violet, GRAPHIC.teal, GRAPHIC.gold];

type OutChoice = 'none' | 'center-city' | 'north-center' | 'other';
const OUT_CHOICES: Array<{ value: OutChoice; label: string }> = [
  { value: 'none', label: 'All lines in' },
  { value: 'center-city', label: 'Central–Metro out' },
  { value: 'north-center', label: 'North–Central out' },
];

// The tanks: each line into Metro drawn as long as its rating and filled to its flow.
const TANK_X0 = 118;
const TANK_PX_PER_MW = 0.6; // 780 MW (Central–Metro at 130%) fits in 468 units
const TANK_X1 = 590;

function MetroTanks({ s, flows, limits }: { s: PlaygroundState; flows: Record<string, number>; limits: Record<string, number> }) {
  const { imported, rated } = metroImports(s, flows);
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 124"
      role="img"
      aria-label={`The lines into Metro: ${INTO_METRO.map((id) => (s.out.includes(id) ? `${lineName(id)} out` : `${lineName(id)} ${fmt(Math.abs(flows[id]))} of ${fmt(limits[id])} MW`)).join(', ')}.`}
    >
      <text className="lab" x={0} y={14}>
        Into Metro: {fmt(imported)} MW, over {s.out.some((id) => INTO_METRO.includes(id)) ? 'lines in service' : 'lines'} rated {fmt(rated)} MW between them
      </text>
      {INTO_METRO.map((id, i) => {
        const y = 32 + i * 31;
        const out = s.out.includes(id);
        const f = Math.abs(flows[id]);
        const cap = limits[id];
        const wCap = cap * TANK_PX_PER_MW;
        const wFlow = Math.min(f * TANK_PX_PER_MW, TANK_X1 - TANK_X0);
        const u = cap > 0 ? f / cap : 0;
        const end = TANK_X0 + Math.max(wCap, wFlow);
        return (
          <g key={id}>
            <text className="ax" x={0} y={y + 13}>
              {lineName(id)}
            </text>
            <rect x={TANK_X0} y={y} width={wCap} height={18} rx={3} fill="#fff" stroke={out ? '#c4c4c4' : '#8a8a8a'} strokeWidth={1.2} strokeDasharray={out ? '4 4' : undefined} />
            {!out && <rect x={TANK_X0} y={y} width={Math.min(wFlow, wCap)} height={18} rx={3} fill={loadingColor(f, cap)} />}
            {!out && wFlow > wCap && <rect x={TANK_X0 + wCap} y={y + 3} width={wFlow - wCap} height={12} fill="#b8302a" />}
            <text className="ax" x={end + 8} y={y + 13} style={{ fill: !out && u > 1.001 ? '#c4382f' : undefined, fontWeight: !out && u >= 0.999 ? 600 : undefined }}>
              {out ? 'out' : pct(u)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const sc = useScenario<PlaygroundState>('playground', PLAYGROUND_DEFAULTS);
  const s = sc.state;
  const { rc, st, overloads } = playground(s);
  const limits = limitsAt(s.rating);
  const inService = REGION.lines.filter((l) => !s.out.includes(l.id));
  const worst = [...inService].sort((a, b) => (st.loading[b.id] ?? 0) - (st.loading[a.id] ?? 0))[0];
  const solved = heatWaveSolved(s);
  const net = (id: string) => (rc.units.filter((u) => u.node === id).reduce((t, u) => t + st.output[u.id], 0) - st.served[id]);
  const toggleLine = (id: string) => sc.set((p) => ({ out: p.out.includes(id) ? p.out.filter((x) => x !== id) : [...p.out, id] }));
  const outChoice: OutChoice = s.out.length === 0 ? 'none' : s.out.length === 1 && (s.out[0] === 'center-city' || s.out[0] === 'north-center') ? s.out[0] : 'other';

  // Loading of every line through the day, with the same outages, ratings and extra demand.
  const day = useMemo(() => {
    const byLine: Record<string, number[]> = Object.fromEntries(REGION.lines.map((l) => [l.id, [] as number[]]));
    for (let h = 0; h < 24; h++) {
      const r = playground(s, h);
      for (const l of REGION.lines) byLine[l.id].push(s.out.includes(l.id) ? 0 : 100 * (r.st.loading[l.id] ?? 0));
    }
    const peakOf = (id: string) => Math.max(...byLine[id]);
    const ranked = [...REGION.lines].sort((a, b) => peakOf(b.id) - peakOf(a.id)).map((l) => l.id);
    const overHours = Array.from({ length: 24 }, (_, h) => REGION.lines.some((l) => byLine[l.id][h] > 100.0001));
    return { byLine, top: ranked.slice(0, 3), overHours };
    // Recompute only when the outages, ratings or extra demand change (not the hour); s.out is keyed by its contents.
  }, [s.out.join(','), s.rating, s.metro]);
  const bands: Array<{ from: number; to: number; color: string }> = [];
  day.overHours.forEach((o, h) => {
    if (!o) return;
    const last = bands[bands.length - 1];
    if (last && last.to === h) last.to = h + 1;
    else bands.push({ from: h, to: h + 1, color: 'rgba(231, 91, 85, 0.12)' });
  });
  const overCount = day.overHours.filter(Boolean).length;

  let caption: ReactNode;
  if (st.islands.length > 1)
    caption = (
      <>
        {`The network has split into ${st.islands.length} islands, each of which must now balance its own supply and demand${st.shedTotal > 0.5 ? `; ${mw(st.shedTotal)} of demand can’t be served` : ''}. `}
        <a href={lessonHref('2.6')}>Lesson 2.6</a> looks at this in detail.
      </>
    );
  else if (overloads.length)
    caption = `${overloads.map((o, i) => `${lineName(o.line)}${i === 0 ? ' is' : ''} at ${pct(o.loading)}`).join(overloads.length > 2 ? ', ' : ' and ')} of ${overloads.length > 1 ? 'their ratings' : 'its rating'}. Nothing in the dispatch knows the network exists.`;
  else caption = `Every line is within its rating. The most heavily loaded is ${lineName(worst.id)}, at ${pct(st.loading[worst.id])}.`;

  return (
    <LessonPage id="2.5">
      <P>
        In the previous lesson, power spread across every path between where it was produced and where it was used. That would be harmless if every line could carry any
        amount. None can. The current in a conductor heats it, as <a href={lessonHref('1.5')}>Lesson 1.5</a> showed, and a hot conductor expands and sags. Let it sag
        too far and it comes close enough to a tree, a building or the ground for the electricity to arc across. A line’s <K c="power">thermal rating</K> is the most power it can
        carry without getting that hot. Long lines can also be held back by limits on voltage or stability; our model includes only the thermal ratings.
      </P>
      <P>
        Ratings depend on the weather. A conductor cools faster in cold, windy air than on a still summer afternoon, so the same line can safely carry more in winter than
        in a heat wave. Operators have long used separate summer and winter ratings, and increasingly they adjust ratings to the actual temperature hour by hour,
        squeezing more out of the lines they already have. Our region’s lines are rated between 300 and 600 MW: the 345 kV line from Central to Metro can carry 600 MW, the 230 kV line from West to Metro only
        300 MW.
      </P>
      <P>
        In the next demonstration, the region’s plants are dispatched in merit order, cheapest first, exactly as if the whole region shared one price and the network didn’t exist — the
        simplest market, which we’ll meet in Chapter 4. The power flows are then whatever physics makes them. Each line is shaded by how close it is to its rating: gray
        below 80%, orange approaching it, red at or over it. Each node shows its generation minus its demand. Under the map, the three lines into Metro are drawn as
        tanks, each as long as its rating and filled to the power it carries. Click a line on the map to take it out of service:
      </P>

      <Figure name="Congestion Playground" scenario={sc}>
        <NetworkView
          ariaLabel={`The region at ${hour(s.hour)} with ${s.out.length} line${s.out.length === 1 ? '' : 's'} out. ${overloads.length ? `Overloaded: ${overloads.map((o) => `${lineName(o.line)} ${pct(o.loading)}`).join(', ')}.` : 'No line is overloaded.'}`}
          width={600}
          height={410}
          flowScale={0.12}
          onLineClick={toggleLine}
          nodes={REGION.nodes.map((n) => {
            const v = net(n.id);
            const shed = st.shed[n.id] > 0.5;
            return {
              id: n.id,
              x: n.x,
              y: n.y,
              r: 31,
              label: n.name,
              labelPos: LABEL_POS[n.id],
              value: signed(v),
              sub: shed ? `${fmt(st.shed[n.id])} MW cut` : 'MW net',
              fill: shed ? '#f6d2cf' : '#fff',
              dead: shed && st.served[n.id] < 0.5,
            };
          })}
          lines={REGION.lines.map((l) => ({
            id: l.id,
            from: l.from,
            to: l.to,
            flow: st.flows[l.id],
            limit: limits[l.id],
            out: s.out.includes(l.id),
            label: s.out.includes(l.id) ? 'out' : `${fmt(Math.abs(st.flows[l.id]))} / ${fmt(limits[l.id])}`,
            labelDx: LABEL_OFFSET[l.id][0],
            labelDy: LABEL_OFFSET[l.id][1],
          }))}
        />
        <MetroTanks s={s} flows={st.flows} limits={limits} />
        <Caption>{caption}</Caption>
        <Slider label="Hour of the reference day" value={s.hour} min={0} max={23} onChange={(v) => sc.set({ hour: v })} display={`${hour(s.hour)} · demand ${mw(rc.demand)}`} />
        <Slider label="Extra demand in Metro" value={s.metro} min={0} max={400} step={10} onChange={(v) => sc.set({ metro: v })} display={mw(s.metro)} />
        <Slider
          label="Line ratings"
          tone="red"
          value={s.rating}
          min={RATING_RANGE[0]}
          max={RATING_RANGE[1]}
          step={RATING_RANGE[2]}
          onChange={(v) => sc.set({ rating: v })}
          display={`${s.rating}% of normal`}
        />
      </Figure>

      <P>
        At the 19:00 peak, with every line in service, nothing is overloaded. The busiest line is West–Metro, carrying 255 of its 300 MW — 85% — because a large share of
        Ironwood’s and Harbor Point’s output reaches Metro that way. Central–Metro carries 425 MW, 71% of its rating. Metro is the region’s load center: it
        uses 792 MW at the peak and produces only 50, so 742 MW has to come in over its three lines.
      </P>
      <P>
        Add demand in Metro and, at first, nothing changes on the lines: the next plant in the merit order is Mill Creek, which sits in Metro itself, so the first 200 MW
        of extra demand is met locally. Beyond that, the Eastgate peaker in the East picks up, and its power flows into Metro, mostly along the East–Metro line.
      </P>
      <P>
        Now look at the tanks. Metro’s three lines are rated 1,250 MW between them, and only 742 MW comes in, yet the West–Metro tank is already 85% full while East–Metro’s
        is under a fifth full. Power doesn’t fill lines in order, the way water poured into a row of tanks fills one and spills into the next; it divides by
        reactance, so one line usually reaches its rating while the others still have room. Which line fills first, and how much more Metro can import before it does, depends on where the extra power comes from — exactly the
        PTDFs of the previous lesson.
      </P>
      <Challenge
        id="a"
        question={`At the 19:00 peak, with every line in service and no extra demand, Metro imports ${fmt(REFERENCE_IMPORTS.imported)} MW: ${pct(TANK_SHARE)} of what its three lines are rated for. If Metro could share that out among its lines as it pleased, a heat wave could cut every rating to ${fmt(TANK_RATING)}% of normal before the lines were full. Predict how far the ratings can really fall, then lower them to check: what is the lowest rating, in the slider’s 5% steps, at which no line is over its rating?`}
        solved={solved}
        status={
          !atReference(s)
            ? 'Return to 19:00, with no extra demand and every line in service.'
            : overloads.length
              ? `At ${s.rating}% of normal, ${overloads.map((o) => lineName(o.line)).join(' and ')} ${overloads.length > 1 ? 'are' : 'is'} over ${overloads.length > 1 ? 'their ratings' : 'its rating'}.`
              : `At ${s.rating}% of normal, every line is within its rating. Can the ratings fall further?`
        }
        success={`Solved: ${LOWEST_SAFE_RATING}% of normal. West–Metro is then full, carrying ${fmt(Math.abs(HEAT_WAVE.st.flows['west-city']))} of its ${fmt(limitsAt(LOWEST_SAFE_RATING)['west-city'])} MW, while Central–Metro is at ${pct(HEAT_WAVE.st.loading['center-city'])} and East–Metro at ${pct(HEAT_WAVE.st.loading['east-city'])}: Metro is importing only ${pct(HEAT_WAVE_IMPORTS.imported / HEAT_WAVE_IMPORTS.rated)} of what its lines are rated for. Power divides by reactance, not by rating, so the first line to fill sets the limit for them all.`}
      />
      <P>
        The figure is showing <b>congestion</b> in its plainest, physical sense: equipment asked to carry more than it safely can. Take a line out and its flow doesn’t
        vanish; it redistributes over the remaining paths, in proportions set by the same reactances that split the flows in <a href={lessonHref('2.4')}>Lesson 2.4</a>,
        and lines that were comfortable can suddenly be overloaded. Take out Central–Metro, the biggest road into Metro, and its{' '}
        {fmt(Math.abs(REFERENCE.st.flows['center-city']))} MW moves onto the other routes: West–Metro would have to carry 172% of its rating, and
        North–East, which brings Metro power the long way round through East, 124%.
      </P>

      <H2>Congestion through the day</H2>
      <P>
        A line that is fine at 19:00 may not be fine at 12:00, because the dispatch changes hour by hour: solar output peaks in the middle of the day, gas plants come on in
        the evening. The next chart runs the same calculation for every hour of the reference day and plots the loading of the three most heavily loaded lines. It uses the
        settings of <FigRef to="Congestion Playground">the first demonstration</FigRef>; the line outage and the ratings are repeated here, so you can change them where
        you’re looking. Drag across the chart to pick an hour; the first demonstration follows along, so you can open it again to see that hour’s flows:
      </P>

      <Figure name="Congestion Playground · through the day" scenario={sc}>
        <Segmented
          label="Lines out of service"
          value={outChoice}
          onChange={(v) => sc.set({ out: v === 'none' || v === 'other' ? [] : [v] })}
          options={OUT_CHOICES}
        />
        <Legend
          items={[
            ...day.top.map((id, i) => ({ label: lineName(id), color: SERIES_COLORS[i], kind: 'line' as const })),
            { label: 'Other lines', color: '#c4c4c4', kind: 'line' as const },
          ]}
        />
        <TimeChart
          ariaLabel={`Loading of each line over the reference day. ${overCount ? `Some line is overloaded in ${overCount} hours.` : 'No line is overloaded at any hour.'} Most loaded: ${day.top.map((id) => `${lineName(id)} up to ${fmt(Math.max(...day.byLine[id]))}%`).join(', ')}.`}
          series={[
            ...REGION.lines.filter((l) => !day.top.includes(l.id)).map((l) => ({ values: day.byLine[l.id].map((v) => Math.min(200, v)), color: '#c4c4c4', width: 1.5 })),
            ...day.top.map((id, i) => ({ values: day.byLine[id].map((v) => Math.min(200, v)), color: SERIES_COLORS[i], width: 3 })),
          ]}
          refLines={[{ y: 100, color: '#c4382f', dash: '6 4', label: 'rating' }]}
          bands={bands}
          yMin={0}
          yMax={200}
          yLabel="Loading, % of rating"
          yFormat={(v) => `${v}%`}
          height={240}
          cursor={s.hour}
          onScrub={(h) => sc.set({ hour: h })}
        />
        <Caption>
          {overCount
            ? `Some line is over its rating in ${overCount} of the day’s 24 hours (shaded).`
            : 'With these settings, every line stays within its rating all day.'}
        </Caption>
        <Slider
          label="Line ratings"
          tone="red"
          value={s.rating}
          min={RATING_RANGE[0]}
          max={RATING_RANGE[1]}
          step={RATING_RANGE[2]}
          onChange={(v) => sc.set({ rating: v })}
          display={`${s.rating}% of normal`}
        />
      </Figure>

      <P>
        With every line in service and normal ratings, the region never quite congests on the reference day: the busiest hour of the busiest line is West–Metro at 86%, at 18:00 and again
        at 20:00. Take Central–Metro out and West–Metro is overloaded for most of the day, from 06:00 onward, with only a brief reprieve from 12:00 to 14:00, when Valley solar
        in the East covers some of Metro’s demand from the other side and Ironwood backs off. Take North–Central out instead, and the problem moves to the middle of the day: with no path
        through Central, the North’s wind and hydro and the East’s solar must all reach Metro along East–Metro, which is overloaded for the four hours from 11:00 to 15:00.
      </P>
      <P>
        Everything here is physical: a list of overloaded equipment, nothing more. Someone has to act on it — by changing which plants run, which means paying some plants
        to produce more and others less, and that in turn means prices that differ from place to place. That is the story of <a href={lessonHref('5.2')}>Chapter 5</a>.
        Before we get there, the next lesson asks what happens if nobody acts in time.
      </P>
    </LessonPage>
  );
}
