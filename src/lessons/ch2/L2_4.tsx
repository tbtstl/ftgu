import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  Eq,
  Figure,
  Frac,
  H2,
  K,
  LessonPage,
  NetworkView,
  Op,
  P,
  Segmented,
  Slider,
  Sub,
  fmt,
  lessonHref,
  mw,
  pct,
  signed,
  useScenario,
} from '../../framework';
import { computePtdf, dcPowerFlow } from '../../engines/physics/powerflow';
import { REGION, THREE_NODE, nodeName } from '../../model/networks';
import type { Network } from '../../model/types';

// ---------------------------------------------------------------------------------------------
// The triangle: generators at A and B, all demand at C (the same grid as Lesson 5.3).

function triangle(xAC: number): Network {
  return { ...THREE_NODE, lines: THREE_NODE.lines.map((l) => (l.id === 'AC' ? { ...l, reactance: xAC } : l)) };
}

export function triangleFlows(pA: number, pB: number, xAC: number) {
  return dcPowerFlow(triangle(xAC), { A: pA, B: pB, C: -(pA + pB) }).flows;
}

// ---------------------------------------------------------------------------------------------
// The region, with one transfer to Metro and an adjustable West–Metro reactance.

type Source = 'north' | 'east' | 'center' | 'harbor' | 'west';
const SOURCES: Source[] = ['north', 'east', 'center', 'harbor', 'west'];
export const WM_RANGE = [0.3, 2, 0.05] as const;
export const CHALLENGE_LINE = 'west-center';

export function regionWith(xWM: number): Network {
  return { ...REGION, lines: REGION.lines.map((l) => (l.id === 'west-city' ? { ...l, reactance: xWM } : l)) };
}

/** Flows for `mwSent` MW injected at `source` and withdrawn in Metro. */
export function transferFlows(source: string, mwSent: number, xWM: number) {
  return dcPowerFlow(regionWith(xWM), { [source]: mwSent, city: -mwSent }).flows;
}

export function zeroFlowSolved(st: { source: string; mw: number; xWM: number }): boolean {
  return st.source === 'harbor' && st.mw >= 100 && Math.abs(transferFlows(st.source, st.mw, st.xWM)[CHALLENGE_LINE]) < 0.5;
}

const lineName = (id: string) => {
  const l = REGION.lines.find((x) => x.id === id)!;
  return `${nodeName(REGION, l.from)}–${nodeName(REGION, l.to)}`;
};

// Label placement for the region's lines (offsets from each line's midpoint).
const LABEL_OFFSET: Record<string, [number, number]> = {
  'north-center': [-26, -6],
  'north-east': [0, -12],
  'harbor-center': [0, -12],
  'harbor-west': [34, -2],
  'west-center': [34, 4],
  'center-city': [10, -14],
  'east-city': [38, 4],
  'west-city': [26, 30],
};

const PLANTS_AT: Record<string, string> = {
  north: 'Falls hydro, Ridge wind',
  east: 'Eastgate peaker, Valley solar',
  center: 'Lakeside',
  harbor: 'Harbor Point',
  west: 'Ironwood',
  city: 'Mill Creek, Old Quay',
};

export default function Lesson() {
  const s1 = useScenario('triangle', { pA: 300, pB: 0, xAC: 1 });
  const { pA, pB, xAC } = s1.state;
  const f1 = triangleFlows(pA, pB, xAC);

  const s2 = useScenario('region', { source: 'harbor' as Source, mw: 100, xWM: 1.4 });
  const { source, mw: sent, xWM } = s2.state;
  const flows = useMemo(() => transferFlows(source, sent, xWM), [source, sent, xWM]);
  const shares = useMemo(() => {
    const { ptdf } = computePtdf(regionWith(xWM));
    return Object.fromEntries(REGION.lines.map((l) => [l.id, ptdf[l.id][source] - ptdf[l.id].city]));
  }, [source, xWM]);
  const solved = zeroFlowSolved(s2.state);
  const fWC = flows[CHALLENGE_LINE];
  const rows = [...REGION.lines].sort((a, b) => Math.abs(shares[b.id]) - Math.abs(shares[a.id]));
  const wcFrom = fWC >= 0 ? 'West' : 'Central';
  const wcTo = fWC >= 0 ? 'Central' : 'West';

  return (
    <LessonPage id="2.4">
      <P>
        On a radial feeder, power has exactly one way to reach each customer. The transmission grid is meshed, so between any two substations there are many routes. Which
        one does the power take? All of them at once, in proportions that nobody chooses. There is no valve or signpost in a substation that sends Lakeside’s output toward
        one town rather than another; the power divides among the available paths according to their electrical properties.
      </P>
      <P>
        Calculating exactly how alternating current divides across a large grid — an <b>AC power flow</b> — means solving a set of nonlinear equations for the voltage and
        phase at every node. Electricity markets, and many planning studies, use a simplification called <b>DC power flow</b>. Despite the name, it’s still a model of an AC grid. It
        keeps only the dominant effect: on high-voltage lines, a line’s <K c="resistance">reactance</K> — its opposition to alternating current, caused by the magnetic field
        around it — is much larger than its resistance, and the power it carries is roughly proportional to the difference in voltage <K c="phase">phase angle</K> between its
        ends, divided by its reactance. The approximation ignores losses and assumes voltages stay near their normal values, and it is accurate enough that the markets
        of Chapter 5 are built on it.
      </P>
      <P>
        Here is the smallest network with a choice of paths: generators at A and B, all the demand at C, and three lines between them. To start, only A is producing, so its
        power can reach C directly, or by way of B. Change the reactance of the direct line:
      </P>

      <Figure name="Power Flow Simulator" scenario={s1}>
        <NetworkView
          ariaLabel={`Three nodes. A produces ${pA} MW and B ${pB} MW for the demand at C. Line A–C carries ${fmt(Math.abs(f1.AC))} MW, A–B ${fmt(Math.abs(f1.AB))} MW, B–C ${fmt(Math.abs(f1.BC))} MW.`}
          width={600}
          height={380}
          flowScale={0.25}
          nodes={THREE_NODE.nodes.map((n) => {
            const inj = n.id === 'A' ? pA : n.id === 'B' ? pB : -(pA + pB);
            return {
              id: n.id,
              x: n.x,
              y: n.y,
              r: 36,
              label: n.id === 'C' ? 'C · demand' : `${n.id} · generator`,
              labelPos: n.id === 'C' ? ('below' as const) : ('above' as const),
              value: signed(inj),
              sub: 'MW',
              fill: '#fff',
            };
          })}
          lines={THREE_NODE.lines.map((l) => ({
            id: l.id,
            from: l.from,
            to: l.to,
            flow: f1[l.id],
            label: `${l.from}–${l.to} · ${fmt(Math.abs(f1[l.id]))} MW`,
            labelDx: l.id === 'AC' ? -78 : l.id === 'BC' ? 78 : 0,
            labelDy: l.id === 'AB' ? -14 : 6,
          }))}
        >
          <text className="ax ax-m" x={168} y={232}>
            x = {xAC.toFixed(2)}
          </text>
          <text className="ax ax-m" x={432} y={232}>
            x = 1.00
          </text>
          <text className="ax ax-m" x={300} y={132}>
            x = 1.00
          </text>
        </NetworkView>
        <Slider label="Output at A" tone="red" value={pA} min={0} max={400} step={10} onChange={(v) => s1.set({ pA: v })} display={mw(pA)} />
        <Slider label="Output at B" tone="red" value={pB} min={0} max={400} step={10} onChange={(v) => s1.set({ pB: v })} display={mw(pB)} />
        <Slider
          label="Reactance of line A–C"
          tone="violet"
          value={xAC}
          min={0.25}
          max={4}
          step={0.25}
          onChange={(v) => s1.set({ xAC: v })}
          display={`${xAC.toFixed(2)}, against 1.00 for the others`}
        />
        <Eq label="Flow on line A–C">
          <span>
            flow<Sub>A–C</Sub>
          </span>
          <Op>=</Op>
          <K c="power">{pA}</K>
          <Op>×</Op>
          <Frac top={<K c="resistance">1 + 1</K>} bottom={<K c="resistance">{`${xAC.toFixed(2)} + 1 + 1`}</K>} />
          <Op>+</Op>
          <K c="power">{pB}</K>
          <Op>×</Op>
          <Frac top={<K c="resistance">1</K>} bottom={<K c="resistance">{`${xAC.toFixed(2)} + 1 + 1`}</K>} />
          <Op>=</Op>
          <K c="power">{fmt(f1.AC)} MW</K>
        </Eq>
        <Caption>
          {pA + pB === 0
            ? 'Nothing is generating, so nothing flows.'
            : Math.abs(f1.AB) < 0.5
              ? 'Line A–B carries nothing: the two generators’ detours through it cancel exactly.'
              : `Line A–B carries ${fmt(Math.abs(f1.AB))} MW from ${f1.AB > 0 ? 'A to B' : 'B to A'}.`}
        </Caption>
      </Figure>

      <P>
        With all three reactances equal, the direct path has half the reactance of the detour through B, so it carries twice as much: two thirds of A’s 300 MW, or 200
        MW, against 100 MW the long way round. Power divides among parallel paths in inverse proportion to their reactance, just as current divides among parallel resistors
        in <a href={lessonHref('1.1')}>Lesson 1.1</a>. Raise the direct line’s reactance to 4 and only a third of the power takes it; cut it to 0.25 and 89% does. Either
        way, some power always takes the detour.
      </P>
      <P>
        Now let B produce as well. Because the DC model is linear, the flows from each generator simply add. B’s power, too, splits between its direct line and a detour,
        and its detour runs through line A–C, the line that seemed to “belong” to A. On line A–B the two detours run in opposite directions: when A’s output times the
        reactance of A–C equals B’s output times the reactance of B–C, they cancel and the line carries nothing, and beyond that point its flow reverses. Power that travels
        along paths other than the obvious one is called <b>loop flow</b>.
      </P>

      <H2>A megawatt injected here</H2>
      <P>
        The course region is the same idea on a larger scale. Its six substations are joined by eight lines: 345 kV lines from North to Central, Harbor to Central, Harbor
        to West and Central to Metro, and 230 kV lines from North to East, West to Central, East to Metro and West to Metro. Each plant from{' '}
        <a href={lessonHref('2.1')}>Lesson 2.1</a> connects at one of them: Falls hydro and Ridge wind in the North, Eastgate and Valley solar in the East, Lakeside at
        Central, Harbor Point at Harbor, Ironwood in the West, and Mill Creek and Old Quay in Metro, where 55% of the demand is.
      </P>
      <P>
        Because flows add, a megawatt injected at one node and taken out at another always spreads across the lines in the same proportions, whatever else is happening on
        the grid. Those proportions are the <b>power transfer distribution factors</b>, or PTDFs: a PTDF of 0.4 means that 40% of each megawatt sent from here to there
        flows over that line. Choose a node to send power from — it all goes to Metro — and watch how it spreads:
      </P>

      <Figure name="Power Flow Simulator · the region" scenario={s2}>
        <Segmented
          label="Send power from"
          value={source}
          onChange={(v) => s2.set({ source: v })}
          options={SOURCES.map((n) => ({ value: n, label: nodeName(REGION, n) }))}
        />
        <NetworkView
          ariaLabel={`The region with ${sent} MW sent from ${nodeName(REGION, source)} to Metro. ${REGION.lines.map((l) => `${lineName(l.id)} ${fmt(Math.abs(flows[l.id]))} MW`).join(', ')}.`}
          width={600}
          height={400}
          flowScale={0.9}
          nodes={REGION.nodes.map((n) => ({
            id: n.id,
            x: n.x,
            y: n.y,
            r: 30,
            label: n.name,
            labelPos: n.id === 'city' ? ('right' as const) : n.id === 'harbor' || n.id === 'west' ? ('below' as const) : n.id === 'center' ? ('right' as const) : ('above' as const),
            labelColor: '#444',
            value: n.id === source ? `+${sent}` : n.id === 'city' ? `−${sent}` : '',
            sub: n.id === source || n.id === 'city' ? 'MW' : undefined,
            fill: '#fff',
          }))}
          lines={REGION.lines.map((l) => ({
            id: l.id,
            from: l.from,
            to: l.to,
            flow: flows[l.id],
            label: `${fmt(Math.abs(flows[l.id]), Math.abs(flows[l.id]) < 10 && Math.abs(flows[l.id]) >= 0.05 ? 1 : 0)} MW${l.id === 'west-city' ? ` · x = ${xWM.toFixed(2)}` : ''}`,
            labelDx: LABEL_OFFSET[l.id][0],
            labelDy: LABEL_OFFSET[l.id][1],
          }))}
        />
        <Slider label="Power sent to Metro" tone="red" value={sent} min={0} max={400} step={10} onChange={(v) => s2.set({ mw: v })} display={mw(sent)} />
        <Slider
          label="Reactance of the West–Metro line"
          tone="violet"
          value={xWM}
          min={WM_RANGE[0]}
          max={WM_RANGE[1]}
          step={WM_RANGE[2]}
          onChange={(v) => s2.set({ xWM: v })}
          display={`${xWM.toFixed(2)} (normally 1.40)`}
        />
        <Eq label="Flow on the West–Central line">
          <span>
            flow<Sub>West–Central</Sub>
          </span>
          <Op>=</Op>
          <span>PTDF</span>
          <Op>×</Op>
          <K c="power">{sent} MW</K>
          <Op>=</Op>
          <span>{fmt(shares[CHALLENGE_LINE], 3)}</span>
          <Op>×</Op>
          <K c="power">{sent} MW</K>
          <Op>=</Op>
          <K c="power">{fmt(fWC, 1)} MW</K>
        </Eq>
        <DataTable
          caption={`How power sent from ${nodeName(REGION, source)} to Metro spreads over the lines`}
          rows={rows}
          rowKey={(l) => l.id}
          rowClass={(l) => (l.id === CHALLENGE_LINE ? 'hl' : '')}
          columns={[
            { label: 'Line', cell: (l) => lineName(l.id) },
            { label: 'PTDF', cell: (l) => fmt(Math.abs(shares[l.id]), 3) },
            { label: 'Share of the transfer', cell: (l) => pct(Math.abs(shares[l.id]), 1) },
            { label: 'Direction', cell: (l) => (Math.abs(flows[l.id]) < 0.05 ? '—' : flows[l.id] > 0 ? `${nodeName(REGION, l.from)} → ${nodeName(REGION, l.to)}` : `${nodeName(REGION, l.to)} → ${nodeName(REGION, l.from)}`) },
          ]}
        />
        <Caption>
          {nodeName(REGION, source)} hosts {PLANTS_AT[source]}. Of every megawatt it sends, {pct(Math.abs(shares['center-city']), 1)} arrives over the Central–Metro line,{' '}
          {pct(Math.abs(shares['west-city']), 1)} over West–Metro and {pct(Math.abs(shares['east-city']), 1)} over East–Metro.
        </Caption>
      </Figure>

      <P>
        Send power from Harbor, where Harbor Point is, and 58% of it leaves by the line to Central and 42% by the line to West. Of what reaches Central, most goes straight on
        to Metro, but some turns north: 11.9% of the transfer travels from Central to North, across to East and into Metro from the east, over lines that have nothing to
        do with Harbor or with its customer. The West–Central line carries 8.6% from West toward Central — power from Harbor that reached West by one line, crossed back
        toward Central by another, and went on to Metro by a third. In real interconnections, flows like these routinely cross the boundaries between neighboring utilities
        and even countries, which is why system operators work with PTDFs every day.
      </P>
      <P>
        Notice, too, that the shares don’t depend on how much is sent: double the transfer and every flow doubles. That linearity is what makes PTDFs useful. To know what
        200 MW more from the North, used in Metro, would do to the Central–Metro line, multiply 200 by a single number.
      </P>

      <H2>Steering the flow</H2>
      <P>
        Operators can’t route power, but they can change the paths. A series capacitor installed on a line cancels part of its reactance and draws more flow onto it; a
        series reactor does the opposite; and a phase-shifting transformer can push flow around a loop in either direction. The second slider changes the reactance of the West–Metro
        line, as such a device would.
      </P>
      <Challenge
        id="a"
        question="Send at least 100 MW from Harbor to Metro, and adjust the West–Metro line until the West–Central line carries no power at all."
        solved={solved}
        status={
          source !== 'harbor'
            ? 'Send the power from Harbor.'
            : sent < 100
              ? 'Send at least 100 MW.'
              : `The West–Central line carries ${fmt(Math.abs(fWC), 1)} MW from ${wcFrom} to ${wcTo}.`
        }
        success={`Solved. At a reactance of ${xWM.toFixed(2)}, the two routes from Harbor to Metro — through Central and through West — are balanced, so the West and Central ends of the line between them sit at the same voltage angle, and a line with no angle difference across it carries nothing.`}
      />
      <P>
        Lowering the West–Metro reactance makes the route through West more attractive, so power that used to cross from West to Central stays on the western route.
        Somewhere around a reactance of 0.65 the two routes are perfectly balanced. It’s the same balance as in a Wheatstone bridge, the circuit used to compare
        resistances, and it illustrates the deepest point of this lesson: what a line carries depends on every other line in the network.
      </P>
      <P>
        That has an uncomfortable consequence. Every line has a limit, and with power spreading over every path, a line can fill up because of a transaction that, on
        paper, has nothing to do with it. In the next lesson we’ll load the region’s lines with the reference day’s dispatch, and watch them fill.
      </P>
    </LessonPage>
  );
}
