import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  DataTable,
  FUEL,
  Figure,
  H2,
  LessonPage,
  NetworkView,
  P,
  Readouts,
  Segmented,
  Slider,
  Swatch,
  fmt,
  lessonHref,
  loadingColor,
  mw,
  pct,
  priceFill,
  scale,
  usd,
  useScenario,
} from '../../framework';
import { dcopf } from '../../engines/market/opf';
import { checkDispatch, contingencyScan, fleetOffers, nodalLoads, type ContingencyCase } from '../../engines/market/networkDispatch';
import { STANDARD_FLEET, fleetById } from '../../model/fleet';
import { REGION, REGION_LOAD_SHARE, nodeName } from '../../model/networks';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';

// The reference evening: 19:00 peak, every line in service.
const HOUR = 19;
const DEMAND = SYSTEM_DEMAND[HOUR];
const GENS = fleetOffers(STANDARD_FLEET, { windCF: WIND_CF[HOUR], solarCF: SOLAR_CF[HOUR] });
const LOADS = nodalLoads(DEMAND, REGION_LOAD_SHARE);
const LINES = REGION.lines.map((l) => l.id);
const BASE = dcopf(REGION, GENS, LOADS);

function lineName(id: string) {
  const l = REGION.lines.find((x) => x.id === id)!;
  return `${nodeName(REGION, l.from)}–${nodeName(REGION, l.to)}`;
}

function secureSolve(contingencies: string[], rating: number, lmp = true) {
  return dcopf(REGION, GENS, LOADS, { contingencies, emergencyRating: rating, lmp });
}

/** The worst post-outage loading across all single-line outages. */
function worstOverall(cases: ContingencyCase[]) {
  return cases.reduce<{ outage: string; line: string; loading: number } | null>((w, c) => {
    if (!c.worst) return w;
    return !w || c.worst.loading > w.loading ? { outage: c.outage, line: c.worst.id, loading: c.worst.loading } : w;
  }, null);
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

// Secure dispatches against every single-line outage, for the prose.
const SECURE_100 = secureSolve(LINES, 1);
const SECURITY_COST: Record<number, number> = Object.fromEntries([1, 1.1, 1.2, 1.3].map((k) => [k, (k === 1 ? SECURE_100 : secureSolve(LINES, k, false)).cost - BASE.cost]));
const CHEAP_SCAN_100 = contingencyScan(REGION, GENS, BASE.dispatch, LOADS, LINES, { emergencyRating: 1 });
const LOSS_CC = CHEAP_SCAN_100.find((c) => c.outage === 'center-city')!;

// The hand-dispatch puzzle: every outage, emergency ratings at 110%.
const PUZZLE_RATING = 1.1;
const PUZZLE_OPT = secureSolve(LINES, PUZZLE_RATING, false);
const PUZZLE_FIXED = { nuc: 400, wind: GENS.find((g) => g.id === 'wind')!.capacity, solar: 0, hydro: 150, oil: 0 };

type Mode = 'cheap' | 'secure';

export default function Lesson() {
  // ---- Figure 1: what the cheapest dispatch risks, and what security costs.
  const s = useScenario('security', { mode: 'cheap' as Mode, trip: '', rating: 100, ...Object.fromEntries(LINES.map((id) => [`k:${id}`, true])) } as {
    mode: Mode;
    trip: string;
    rating: number;
    [key: `k:${string}`]: boolean;
  });
  const rating = s.state.rating / 100;
  const chosen = LINES.filter((id) => s.state[`k:${id}`] !== false);
  const chosenKey = chosen.join(',');
  const secure = useMemo(() => secureSolve(chosenKey ? chosenKey.split(',') : [], rating), [chosenKey, rating]);
  const alone = useMemo(() => Object.fromEntries(LINES.map((id) => [id, secureSolve([id], rating, false).cost - BASE.cost])), [rating]);
  const shown = s.state.mode === 'secure' && secure.feasible ? secure : BASE;
  const scanCheap = contingencyScan(REGION, GENS, BASE.dispatch, LOADS, LINES, { emergencyRating: rating });
  const scanSecure = contingencyScan(REGION, GENS, secure.dispatch, LOADS, LINES, { emergencyRating: rating });
  const scanShown = shown === BASE ? scanCheap : scanSecure;
  const worst = worstOverall(scanShown);
  const trip = s.state.trip;
  const post = trip ? checkDispatch(REGION, GENS, shown.dispatch, LOADS, { outages: [trip], rating }) : null;
  const flows = post ? post.flows : shown.flows;
  const securityCost = secure.feasible ? secure.cost - BASE.cost : NaN;
  const rows = LINES.map((id) => ({
    id,
    cheap: scanCheap.find((c) => c.outage === id)!,
    secure: scanSecure.find((c) => c.outage === id)!,
  }));
  const fmtWorst = (c: ContingencyCase) => (c.worst ? `${lineName(c.worst.id)} ${pct(c.worst.loading)}` : '—');

  let caption: string;
  if (trip && post) {
    caption = post.overloads.length
      ? `With ${lineName(trip)} gone, ${post.overloads.map((o) => `${lineName(o.id)} carries ${fmt(Math.abs(o.flow))} MW against an emergency limit of ${fmt(o.limit)}`).join(', and ')}.`
      : `With ${lineName(trip)} gone, its flow spreads over the other lines, and every one stays within its emergency limit.`;
  } else {
    caption = `${s.state.mode === 'secure' ? 'Secure' : 'Cheapest'} dispatch, before anything trips. Click a line to see the flows the instant after it fails.`;
  }

  // ---- Figure 2: the puzzle.
  const h = useScenario('puzzle', { coal: 300, cc2: 50, ct: 0 });
  const hand: Record<string, number> = { ...PUZZLE_FIXED, coal: h.state.coal, cc2: h.state.cc2, ct: h.state.ct };
  hand.cc1 = DEMAND - Object.values(hand).reduce((t, v) => t + v, 0);
  const lakesideOk = hand.cc1 >= -1e-6 && hand.cc1 <= fleetById('cc1').capacity + 1e-6;
  const handBase = checkDispatch(REGION, GENS, hand, LOADS);
  const handScan = contingencyScan(REGION, GENS, hand, LOADS, LINES, { emergencyRating: PUZZLE_RATING });
  const bars = [
    { key: 'none', label: 'Nothing trips', worst: handBase.worst },
    ...handScan.map((c) => ({ key: c.outage, label: `${lineName(c.outage)} trips`, worst: c.worst })),
  ];
  const failing = bars.filter((b) => b.worst && b.worst.loading > 1 + 1e-6);
  const gap = handBase.cost / PUZZLE_OPT.cost - 1;
  const solved = lakesideOk && failing.length === 0 && gap <= 0.01;
  const BX = scale(0, 2, 250, 560);

  return (
    <LessonPage id="5.6">
      <P>
        In Lesson 5.1, a line was already out of service, and the optimizer simply dispatched around it. That’s the easy case. The hard case is a line that is in
        service right now and might fail in the next second, from a lightning strike, a tree, or a faulty breaker. When it does, its flow moves onto the remaining
        lines instantly, according to the same physics that splits power between paths. No plant can change its output that fast. If the new flows push another line
        past what it can survive, protective relays may take that one out too, and, as we saw in Lesson 2.6, that’s how blackouts cascade.
      </P>
      <P>
        Operators therefore follow the <b>N−1 criterion</b>: the grid must stay within its limits after the loss of any single element. The usual way to meet it is
        preventive. The operator dispatches now so that whichever line trips, the flows left behind are already acceptable. That adds constraints to the optimization:
        for every outage on a list of contingencies, and every line that remains, the flow after the outage must stay within that line’s emergency limit. The result is
        called <b>security-constrained</b> optimal power flow, or, in a market, security-constrained economic dispatch.
      </P>
      <P>
        Here is the reference evening again, every line in service: {mw(DEMAND)} of demand, Ridge wind at {mw(PUZZLE_FIXED.wind)}. Click any line to see what would happen
        the instant after it tripped, then switch to the secure dispatch and try again:
      </P>

      <Figure name="Grid Optimization Challenge" scenario={s}>
        <Segmented
          label="Dispatch"
          value={s.state.mode}
          onChange={(v) => s.set({ mode: v })}
          options={[
            { value: 'cheap', label: 'Cheapest' },
            { value: 'secure', label: 'Secure against outages' },
          ]}
        />
        <NetworkView
          ariaLabel={`${s.state.mode === 'secure' ? 'Secure' : 'Cheapest'} dispatch. ${trip ? `${lineName(trip)} has tripped. ${post && post.overloads.length ? `Overloaded: ${post.overloads.map((o) => lineName(o.id)).join(', ')}.` : 'No line is over its emergency limit.'}` : 'No line has tripped.'} Prices from ${usd(Math.min(...Object.values(shown.lmp)))} to ${usd(Math.max(...Object.values(shown.lmp)))} per MWh.`}
          width={600}
          height={408}
          onLineClick={(id) => s.set((st) => ({ trip: st.trip === id ? '' : id }))}
          nodes={REGION.nodes.map((n) => ({
            id: n.id,
            x: n.x,
            y: n.y,
            r: 32,
            label: n.name,
            labelPos: n.id === 'west' ? 'below' : n.id === 'city' ? 'right' : 'above',
            value: usd(shown.lmp[n.id] ?? 0),
            sub: 'per MWh',
            fill: priceFill(shown.lmp[n.id] ?? 0),
          }))}
          lines={REGION.lines.map((l) => {
            const out = l.id === trip;
            const lim = trip ? l.limit * rating : l.limit;
            const [dx, dy] = LABEL_OFFSET[l.id] ?? [0, -10];
            return {
              id: l.id,
              from: l.from,
              to: l.to,
              flow: out ? 0 : flows[l.id],
              limit: lim,
              out,
              label: out ? 'tripped' : `${fmt(Math.abs(flows[l.id]))} / ${fmt(lim)}`,
              labelDx: dx,
              labelDy: dy,
            };
          })}
        />
        <Caption>{caption}</Caption>
        <Readouts
          items={[
            { label: 'generation cost per hour', value: usd(shown.cost) },
            { label: 'cost of security per hour', value: Number.isFinite(securityCost) ? usd(securityCost) : '—', tone: 'red' },
            {
              label: 'worst line after any one outage',
              value: worst ? pct(worst.loading) : '—',
              tone: worst && worst.loading > 1 + 1e-6 ? 'red' : 'green',
            },
          ]}
        />
        <Slider
          label="Emergency rating, as a share of the normal limit"
          value={s.state.rating}
          min={100}
          max={130}
          step={5}
          onChange={(v) => s.set({ rating: v })}
          display={`${s.state.rating}%`}
        />
        <DataTable
          caption="Each single-line outage: the worst line afterward, and what securing against it costs"
          rows={rows}
          rowKey={(r) => r.id}
          rowClass={(r) => (r.id === trip ? 'hl' : '')}
          columns={[
            {
              label: 'Secure against the loss of',
              cell: (r) => (
                <Checkbox
                  label={lineName(r.id)}
                  checked={s.state[`k:${r.id}`] !== false}
                  onChange={(v) => s.set({ [`k:${r.id}`]: v } as Partial<typeof s.state>)}
                />
              ),
            },
            { label: 'Worst afterward, cheapest', cell: (r) => <span style={{ color: (r.cheap.worst?.loading ?? 0) > 1 + 1e-6 ? '#c4382f' : undefined }}>{fmtWorst(r.cheap)}</span> },
            { label: 'Worst afterward, secure', cell: (r) => <span style={{ color: (r.secure.worst?.loading ?? 0) > 1 + 1e-6 ? '#c4382f' : undefined }}>{fmtWorst(r.secure)}</span> },
            { label: 'Cost to secure alone', cell: (r) => (alone[r.id] > 0.5 ? usd(alone[r.id]) : '$0') },
          ]}
        />
      </Figure>

      <P>
        The cheapest dispatch is the merit order from Chapter 4, and as it stands it overloads nothing. But trip Central–Metro and its{' '}
        {fmt(Math.abs(BASE.flows['center-city']))} MW reroute at once: West–Metro would carry {fmt(Math.abs(LOSS_CC.flows['west-city']))} MW against its 300 MW
        limit, and North–East {fmt(Math.abs(LOSS_CC.flows['north-east']))} against 300. Three other outages would overload a line too, by a few
        percent. The grid is fine until something goes wrong, and then it isn’t.
      </P>
      <P>
        The secure dispatch is the optimizer’s answer when every one of those outages is a constraint. It runs Mill Creek flat out, starts the Eastgate peaker, and
        backs Ironwood down to its floor, so that even with Central–Metro gone, West–Metro ends up exactly at its limit. That insurance costs{' '}
        {usd(SECURITY_COST[1])} an hour, about {pct(SECURITY_COST[1] / BASE.cost)} more than the cheapest dispatch.
      </P>

      <H2>Which outages matter</H2>
      <P>
        The last column of the table prices each contingency on its own. Half of them cost nothing: the cheapest dispatch already survives them. Three cost a few
        hundred dollars an hour. Central–Metro, the region’s main artery into Metro, accounts for nearly all of it. That’s typical. Operators analyze thousands of
        possible outages continuously, but at any moment only a handful of them actually constrain the dispatch, and it’s those few that the market software carries as
        constraints. Untick a box and the optimizer stops protecting against that outage; the cost of security falls accordingly, and so does the grid’s safety margin.
      </P>
      <P>
        Look at the prices on the map, too. In the secure dispatch, no line is full before anything trips, yet prices range from{' '}
        {usd(SECURE_100.lmp.west)} at West to {usd(SECURE_100.lmp.city)} in Metro. A contingency
        constraint prices congestion exactly the way a full line does, because to the optimizer it is one: a line that would be over its limit if another one failed.
        Many of the constraints that separate real nodal prices are of this kind.
      </P>
      <P>
        The other lever is the emergency limit. A conductor takes minutes to heat up, so most lines can carry more than their normal rating for a short time — commonly
        somewhere between fifteen minutes and a few hours — while operators redispatch to bring flows back down. Raise the emergency rating and watch the cost of
        security fall: at 110% it’s {usd(SECURITY_COST[1.1])} an hour, at 120% {usd(SECURITY_COST[1.2])}, and at 130% {usd(SECURITY_COST[1.3])}. Each step trades a little security margin for a lot of money, which is why emergency ratings are set
        carefully, line by line, by engineers who know the equipment.
      </P>

      <H2>The challenge</H2>
      <P>
        Now do the optimizer’s job yourself. The emergency rating is 110%, and the grid must survive the loss of any one of its eight lines. Ridge wind, Harbor Point
        and Falls hydro are fixed, Old Quay is off, and Lakeside makes up the difference. Each bar below is the most heavily loaded line in one situation, as a share of
        the limit that applies — the normal limit if nothing trips, the emergency limit after an outage. Every bar has to stay left of the line:
      </P>

      <Figure name="Grid Optimization Challenge · by hand" scenario={h}>
        <svg
          className="chart"
          viewBox={`0 0 600 ${30 + bars.length * 26}`}
          role="img"
          aria-label={`Worst line loading in each situation. ${failing.length ? `${failing.length} fail: ${failing.map((b) => b.label).join(', ')}.` : 'All within limits.'}`}
        >
          <text className="ax ax-m" x={BX(1)} y={14}>
            limit
          </text>
          {[0, 0.5, 1.5, 2].map((t) => (
            <text key={t} className="ax ax-m" x={BX(t)} y={14}>
              {pct(t)}
            </text>
          ))}
          <line x1={BX(1)} x2={BX(1)} y1={20} y2={24 + bars.length * 26} stroke="#333" strokeWidth={1.5} strokeDasharray="4 4" />
          {bars.map((b, i) => {
            const y = 24 + i * 26;
            const v = b.worst ? Math.min(2, b.worst.loading) : 0;
            // Long bars carry their label inside; short ones just past the end.
            const inside = v > 1.25;
            return (
              <g key={b.key}>
                <text x={240} y={y + 15} textAnchor="end" style={{ fontSize: 13, fill: '#444' }}>
                  {b.label}
                </text>
                <rect x={BX(0)} y={y + 3} width={BX(v) - BX(0)} height={16} fill={loadingColor(b.worst?.loading ?? 0, 1)} rx={2} />
                <text
                  x={inside ? BX(v) - 6 : BX(v) + 6}
                  y={y + 15}
                  textAnchor={inside ? 'end' : 'start'}
                  style={inside ? { fontSize: 12, fill: '#fff', fontWeight: 500 } : { fontSize: 12, fill: '#333', paintOrder: 'stroke', stroke: '#f8f8f8', strokeWidth: 4 }}
                >
                  {b.worst ? `${pct(b.worst.loading)} ${lineName(b.worst.id)}` : ''}
                </text>
              </g>
            );
          })}
        </svg>
        <Readouts
          items={[
            { label: 'your dispatch, per hour', value: usd(handBase.cost), tone: 'green' },
            { label: 'Lakeside makes up', value: mw(hand.cc1), tone: lakesideOk ? undefined : 'red' },
            { label: 'situations failing', value: String(failing.length), tone: failing.length ? 'red' : undefined },
            { label: 'cheapest secure dispatch', value: usd(PUZZLE_OPT.cost) },
          ]}
        />
        {(
          [
            ['coal', 'Ironwood coal', 120, 300],
            ['cc2', 'Mill Creek', 0, 250],
            ['ct', 'Eastgate peaker', 0, 200],
          ] as const
        ).map(([id, name, min, max]) => (
          <Slider
            key={id}
            label={
              <>
                <Swatch color={FUEL[fleetById(id).fuel]} />
                {name} · ${fleetById(id).marginalCost}
              </>
            }
            value={h.state[id]}
            min={min}
            max={max}
            step={5}
            onChange={(v) => h.set({ [id]: v } as Partial<typeof h.state>)}
            display={mw(h.state[id])}
          />
        ))}
      </Figure>

      <Challenge
        id="a"
        question="Dispatch the region by hand so that it survives the loss of any single line at an emergency rating of 110%, for no more than 1% above the cheapest secure dispatch."
        solved={solved}
        status={
          !lakesideOk
            ? `Lakeside would need ${mw(hand.cc1)}, outside its 0–400 MW range.`
            : failing.length
              ? `${failing.length} of ${bars.length} situations ${failing.length === 1 ? 'fails' : 'fail'}: ${failing.map((b) => b.label.replace(' trips', '')).join(', ')}.`
              : `Secure, at ${usd(handBase.cost)} an hour: ${pct(Math.max(0, gap), 1)} above the cheapest secure dispatch.`
        }
        success={`Solved: secure against every single outage for ${usd(handBase.cost)} an hour, within ${pct(Math.max(0, gap), 1)} of the optimizer. The binding case is the loss of Central–Metro, which pushes its flow onto West–Metro; running Mill Creek and Eastgate on the Metro side, and Ironwood less, is what keeps that in check.`}
      />

      <P>
        You’ve now done by hand, on six substations and eight lines, what grid operators’ market software does for thousands of nodes, lines and contingencies:
        day-ahead, when it decides which plants to start, and again every five minutes in real time. Everything in this chapter came out of that one optimization — the
        redispatch around a bottleneck, the different prices at every node, the congestion rent that funds transmission rights, the price spikes when reserves run out,
        and the negative prices when there’s nowhere for the power to go.
      </P>
      <P>
        Those price differences across places and across time are exactly what traders try to anticipate. <a href={lessonHref('6.1')}>Chapter 6</a> looks at how they do
        it, starting with the difference between trading electricity that gets delivered and trading contracts that only settle in money.
      </P>
    </LessonPage>
  );
}
