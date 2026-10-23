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
  NetworkView,
  P,
  Readouts,
  Slider,
  TimeChart,
  Tn,
  fmt,
  hour,
  lessonHref,
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

/** The challenge: one line out at the reference evening peak, normal ratings, and at least two other lines overloaded. */
export function twoOverloadsSolved(s: PlaygroundState): boolean {
  if (s.hour !== EVENING_PEAK || s.metro !== 0 || s.rating !== 100 || s.out.length !== 1) return false;
  return playground(s).overloads.length >= 2;
}

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

export default function Lesson() {
  const sc = useScenario<PlaygroundState>('playground', PLAYGROUND_DEFAULTS);
  const s = sc.state;
  const { rc, st, overloads } = playground(s);
  const limits = limitsAt(s.rating);
  const inService = REGION.lines.filter((l) => !s.out.includes(l.id));
  const rows = [...inService].sort((a, b) => (st.loading[b.id] ?? 0) - (st.loading[a.id] ?? 0));
  const worst = rows[0];
  const solved = twoOverloadsSolved(s);
  const net = (id: string) => (rc.units.filter((u) => u.node === id).reduce((t, u) => t + st.output[u.id], 0) - st.served[id]);
  const toggleLine = (id: string) => sc.set((p) => ({ out: p.out.includes(id) ? p.out.filter((x) => x !== id) : [...p.out, id] }));

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

  let caption: string;
  if (st.islands.length > 1)
    caption = `The network has split into ${st.islands.length} islands, each of which must now balance its own supply and demand${st.shedTotal > 0.5 ? `; ${mw(st.shedTotal)} of demand can’t be served` : ''}. Lesson 2.6 looks at this in detail.`;
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
        below 80%, orange approaching it, red at or over it. Each node shows its generation minus its demand. Click a line to take it out of service:
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
        <Caption>{caption}</Caption>
        <Slider label="Hour of the reference day" value={s.hour} min={0} max={23} onChange={(v) => sc.set({ hour: v })} display={`${hour(s.hour)} · demand ${mw(rc.demand)}`} />
        <Slider label="Extra demand in Metro" value={s.metro} min={0} max={400} step={10} onChange={(v) => sc.set({ metro: v })} display={mw(s.metro)} />
        <Slider label="Line ratings" tone="red" value={s.rating} min={70} max={130} step={5} onChange={(v) => sc.set({ rating: v })} display={`${s.rating}% of normal`} />
        <Readouts
          items={[
            { label: 'lines overloaded', value: String(overloads.length), tone: overloads.length ? 'red' : undefined },
            { label: `most loaded: ${worst ? lineName(worst.id) : '—'}`, value: worst ? pct(st.loading[worst.id]) : '—', tone: worst && st.loading[worst.id] > 1.001 ? 'red' : undefined },
            { label: 'lines out of service', value: String(s.out.length) },
          ]}
        />
        <DataTable
          caption="Lines in service, most heavily loaded first"
          rows={rows}
          rowKey={(l) => l.id}
          rowClass={(l) => ((st.loading[l.id] ?? 0) > 1.0001 ? 'hl' : '')}
          columns={[
            { label: 'Line', cell: (l) => `${lineName(l.id)} · ${l.kV} kV` },
            { label: 'Flow', cell: (l) => mw(Math.abs(st.flows[l.id])) },
            { label: 'Rating', cell: (l) => mw(limits[l.id]) },
            {
              label: 'Loading',
              cell: (l) => ((st.loading[l.id] ?? 0) > 1.0001 ? <Tn tone="red">{pct(st.loading[l.id])} · overloaded</Tn> : pct(st.loading[l.id] ?? 0)),
            },
          ]}
        />
      </Figure>

      <P>
        At the 7 p.m. peak, with every line in service, nothing is overloaded. The busiest line is West–Metro, carrying 255 of its 300 MW — 85% — because a large share of
        Ironwood’s and Harbor Point’s output reaches Metro that way. Central–Metro carries 425 MW, 71% of its rating. Metro is the region’s load center: it
        uses 792 MW at the peak and produces only 50, so 742 MW has to come in over its three lines.
      </P>
      <P>
        Add demand in Metro and, at first, nothing changes on the lines: the next plant in the merit order is Mill Creek, which sits in Metro itself, so the first 200 MW
        of extra demand is met locally. Beyond that, the Eastgate peaker in the East picks up, and its power flows into Metro, mostly along the East–Metro line. Lower the line
        ratings, as a heat wave would, and West–Metro reaches its limit at 85% of normal.
      </P>
      <P>
        Notice that Metro’s three lines are rated 1,250 MW between them, yet Metro can’t simply import 1,250 MW. Power doesn’t fill lines in order, like water filling
        tanks; it divides by reactance, so one line usually reaches its rating while the others still have room. Which line fills first, and how much more Metro can import
        before it does, depends on where the extra power comes from — exactly the PTDFs of the previous lesson.
      </P>
      <P>
        The figure is showing <b>congestion</b> in its plainest, physical sense: equipment asked to carry more than it safely can. Take a line out and its flow doesn’t
        vanish; it redistributes over the remaining paths, in the proportions we met in <a href={lessonHref('2.4')}>Lesson 2.4</a>, and lines that were comfortable can
        suddenly be overloaded.
      </P>
      <Challenge
        id="a"
        question="At the reference evening peak, with normal ratings and no extra demand, find the single line whose loss overloads two other lines at once."
        solved={solved}
        status={
          s.hour !== EVENING_PEAK || s.metro !== 0 || s.rating !== 100
            ? 'Return to 19:00, normal ratings and no extra demand.'
            : s.out.length !== 1
              ? `Take exactly one line out — right now ${s.out.length} ${s.out.length === 1 ? 'is' : 'are'} out.`
              : `With ${lineName(s.out[0])} out, ${overloads.length === 0 ? 'no line is' : overloads.length === 1 ? `only ${lineName(overloads[0].line)} is` : `${overloads.length} lines are`} overloaded.`
        }
        success={`Solved. Losing Central–Metro forces its ${fmt(Math.abs(playground(PLAYGROUND_DEFAULTS).st.flows['center-city']))} MW onto the other routes into Metro: ${overloads.map((o) => `${lineName(o.line)} rises to ${pct(o.loading)}`).join(' and ')} of its rating.`}
      />
      <P>
        Three other outages — North–East, Harbor–Central and West–Metro — each overload one line, by a few percent. Losing Central–Metro, the biggest road into Metro,
        is in a class of its own: West–Metro would have to carry 172% of its rating, and North–East, which brings Metro power the long way round through East, 124%.
      </P>

      <H2>Congestion through the day</H2>
      <P>
        A line that is fine at 7 p.m. may not be fine at noon, because the dispatch changes hour by hour: solar output peaks in the middle of the day, gas plants come on in
        the evening. The next chart runs the same calculation for every hour of the reference day, with the outages, ratings and extra demand you set in{' '}
        <FigRef to="Congestion Playground">the first demonstration</FigRef>, and plots the
        loading of the three most heavily loaded lines. Drag across it to pick an hour; the first demonstration follows along, so you can open it again to see that
        hour’s flows:
      </P>

      <Figure name="Congestion Playground · through the day" scenario={sc}>
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
      </Figure>

      <P>
        With every line in service, the region never quite congests on the reference day: the busiest hour of the busiest line is West–Metro at 86%, at 6 p.m. and again
        at 8 p.m. Take Central–Metro out and West–Metro is overloaded for most of the day, from 6 a.m. onward, with only a brief reprieve around midday, when Valley solar
        in the East covers some of Metro’s demand from the other side and Ironwood backs off. Take North–Central out instead, and the problem moves to the middle of the day: with no path
        through Central, the North’s wind and hydro and the East’s solar must all reach Metro along East–Metro, which is overloaded for the four hours from 11 a.m. to 3 p.m.
      </P>
      <P>
        Everything here is physical: a list of overloaded equipment, nothing more. Someone has to act on it — by changing which plants run, which means paying some plants
        to produce more and others less, and that in turn means prices that differ from place to place. That is the story of <a href={lessonHref('5.2')}>Chapter 5</a>.
        Before we get there, the next lesson asks what happens if nobody acts in time.
      </P>
    </LessonPage>
  );
}
