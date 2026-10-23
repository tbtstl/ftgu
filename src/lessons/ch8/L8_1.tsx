import { useMemo, useState } from 'react';
import { Button, Caption, Challenge, FUEL, Figure, H2, LessonPage, P, Readouts, Segmented, Slider, Swatch, Tn, fmt, hour, mw, pct } from '../../framework';
import { outageImpact } from '../../engines/ops/adequacy';
import { FUEL_LABEL } from '../../model/fleet';
import { SOLAR_CF, WIND_CF } from '../../model/profiles';
import {
  BUILD_TECHS,
  CORRIDOR,
  LINE_LIMITS,
  SUBSTATION_COST,
  TECH,
  addGenerator,
  buildNode,
  defaultDesign,
  nodeLoad,
  removeGenerator,
  removeNode,
  setGenCapacity,
  setLineLimit,
  setNodeLoad,
  toggleLine,
  updateCapstone,
  useCapstone,
  type BuildFuel,
} from './capstone';
import { RESERVE_TARGET, capitalCost, checkDesign, lineCapex, lineName, listNames, networkOf, nodeDemand, siteName } from './system';
import { CheckRow, GridMap, ResetGridButton, dollars } from './ui';

const TECH_LABEL: Record<BuildFuel, string> = { gasCT: 'Peaker', gasCC: 'Gas CC', wind: 'Wind', solar: 'Solar', coal: 'Coal', nuclear: 'Nuclear' };
const CAMPUS_MW = 250;
const CAMPUS_BUDGET = 400e6;

type Selection = { kind: 'node' | 'line'; id: string };

export default function Lesson() {
  const d = useCapstone();
  const [sel, setSel] = useState<Selection>({ kind: 'node', id: 'city' });
  const [tech, setTech] = useState<BuildFuel>('gasCT');
  const [dispatchMode, setDispatchMode] = useState<'cheap' | 'secure'>('cheap');
  const [tripped, setTripped] = useState<string | null>(null);

  const checks = checkDesign(d);
  const cap = capitalCost(d);
  const start = useMemo(() => {
    const s = defaultDesign();
    return { cap: capitalCost(s), checks: checkDesign(s) };
  }, []);
  const added = cap.total - start.cap.total;
  const net = useMemo(() => networkOf(d), [d]);
  const loads = nodeDemand(d);
  const ph = checks.peakHour;
  const demandAt = (n: string) => loads[n]?.[ph] ?? 0;
  const peakFlows = useMemo(() => outageImpact(net, checks.secureInjections, null).flows, [net, checks]);

  // Figure 2: the instant after a line trips.
  const outage = tripped && d.lines.some((l) => l.id === tripped) ? tripped : (checks.n1.binding[0]?.outage ?? d.lines[0]?.id ?? null);
  const inj = dispatchMode === 'cheap' ? checks.cheapInjections : checks.secureInjections;
  const impact = useMemo(() => outageImpact(net, inj, outage), [net, inj, outage]);
  const cheapImpact = useMemo(() => (outage ? outageImpact(net, checks.cheapInjections, outage) : null), [net, checks, outage]);
  const worst = impact.overloads.length ? impact.overloads.reduce((a, b) => (Math.abs(impact.flows[a]) / limitOf(a) > Math.abs(impact.flows[b]) / limitOf(b) ? a : b)) : null;
  function limitOf(id: string) {
    return d.lines.find((l) => l.id === id)?.limit ?? 1;
  }

  const selNode = sel.kind === 'node' ? sel.id : null;
  const selLine = sel.kind === 'line' ? sel.id : null;
  const nodeBuilt = !!selNode && d.nodes.includes(selNode);
  const lineBuilt = !!selLine && d.lines.some((l) => l.id === selLine);
  const gensHere = selNode ? d.gens.filter((g) => g.node === selNode) : [];

  const onLine = (id: string) => {
    if (!d.lines.some((l) => l.id === id)) updateCapstone((x) => toggleLine(x, id));
    setSel({ kind: 'line', id });
  };

  const failing = [!checks.connected.ok && 'connectivity', !checks.capacity.ok && 'capacity', !checks.n1.ok && 'N-1'].filter(Boolean) as string[];
  const techLoad = nodeLoad(d, 'tech');
  const solved = d.nodes.includes('tech') && techLoad >= CAMPUS_MW && checks.ok && added <= CAMPUS_BUDGET;
  const status: string[] = [];
  if (!d.nodes.includes('tech')) status.push('Tech Park has no substation yet.');
  else if (techLoad < CAMPUS_MW) status.push(`Tech Park’s demand is ${fmt(techLoad)} MW.`);
  if (failing.length) status.push(`The ${listNames(failing)} check${failing.length > 1 ? 's fail' : ' fails'}.`);
  status.push(`Capital added to the starting design: ${dollars(added)}.`);

  const n1Text = () => {
    if (checks.empty) return 'There is no grid to check.';
    if (checks.n1.ok)
      return checks.n1.binding.length
        ? `The peak can be served with any one line out, though only by holding back cheaper plants: losing ${lineName(checks.n1.binding[0].outage)} would push ${lineName(checks.n1.binding[0].line)} to its limit.`
        : 'The peak can be served with any one line out.';
    if (checks.n1.radial.length) return `Losing ${lineName(checks.n1.radial[0].line)} would cut off ${listNames(checks.n1.radial[0].nodes.map(siteName))}.`;
    if (checks.n1.shedMW >= 0.5) return `To survive every single line outage at the peak, the grid would have to turn away ${mw(checks.n1.shedMW)}.`;
    return 'No dispatch at the peak survives every single line outage.';
  };

  const startGen = start.cap.generation / start.cap.total;
  const solarAtPeak = SOLAR_CF[start.checks.peakHour];
  const windAtPeak = WIND_CF[start.checks.peakHour];

  return (
    <LessonPage id="8.1">
      <P>
        Seven chapters have taken the grid apart one piece at a time: the physics of a single wire, the plants and lines of a region, the operators who balance it every
        second, and the markets that decide who runs and at what price. In this last chapter we’ll put the pieces back together. Over six lessons you’ll design a grid,
        give it a day of demand, run a market on it, add renewables and storage, operate a fleet of home batteries, and finally invest in it under a budget. Each lesson
        picks up your grid where the previous one left it — the design is kept in this browser — and each also works from the starting design if you’d rather skip ahead.
      </P>
      <P>
        The starting design is the region we’ve used since Chapter 2: six substations joined by eight high-voltage lines, and the nine plants of the standard fleet, from
        Harbor Point nuclear to Old Quay oil. Three empty sites are marked too — High Plains, Lakeshore and Tech Park — where new substations can go. The small squares
        beside each substation are its power plants, colored by fuel, and the number inside is the demand there at the region’s peak hour. Click a substation (or tab to
        it and press Enter) to edit it, and click a dashed corridor between two substations to build a line along it:
      </P>

      <Figure name="Grid Builder" actions={<ResetGridButton />}>
        <GridMap
          d={d}
          showSites
          ariaLabel={`Your grid: ${d.nodes.length} substations and ${d.lines.length} lines. At the ${hour(ph)} peak, demand is ${fmt(checks.peakMW)} MW. Selected: ${sel.kind === 'node' ? siteName(sel.id) : lineName(sel.id)}.`}
          nodeInfo={(n) => ({ value: fmt(demandAt(n)), sub: 'MW' })}
          flows={peakFlows}
          selectedNode={selNode}
          selectedLine={selLine}
          onNodeClick={(id) => setSel({ kind: 'node', id })}
          onLineClick={onLine}
          lineAction="Select"
        />
        <Readouts
          items={[
            { label: `peak demand, ${hour(ph)}`, value: mw(checks.peakMW) },
            { label: 'firm capacity then', value: mw(checks.capacity.firm) },
            { label: 'reserve margin', value: Number.isFinite(checks.capacity.margin) ? pct(checks.capacity.margin) : '—', tone: checks.capacity.ok ? 'green' : 'red' },
            { label: 'capital cost', value: dollars(cap.total) },
          ]}
        />
        <CheckRow ok={checks.connected.ok} title="Connected">
          {checks.empty
            ? 'Build a substation to start.'
            : checks.connected.ok
              ? 'Every substation can reach every other along the lines.'
              : `${listNames(checks.connected.cutOff.map(siteName))} ${checks.connected.cutOff.length > 1 ? 'aren’t' : 'isn’t'} connected to the rest of the grid.`}
        </CheckRow>
        <CheckRow ok={checks.capacity.ok} title="Capacity">
          At the {hour(ph)} peak the plants can deliver {mw(checks.capacity.firm)} against demand of {mw(checks.peakMW)}; the target is {pct(RESERVE_TARGET)} more than
          demand, or {mw(checks.capacity.required)}.
        </CheckRow>
        <CheckRow ok={checks.n1.ok} title="N-1 at the peak">
          {n1Text()}
        </CheckRow>

        <div className="card" style={{ margin: '14px 0 4px' }}>
          {selNode && !nodeBuilt && (
            <>
              <Caption>
                <b style={{ fontWeight: 500 }}>{siteName(selNode)}</b> is an empty site.
              </Caption>
              <div style={{ textAlign: 'center', paddingTop: 8 }}>
                <Button primary onClick={() => updateCapstone((x) => buildNode(x, selNode))}>
                  Build a substation here ({dollars(SUBSTATION_COST)})
                </Button>
              </div>
            </>
          )}
          {selNode && nodeBuilt && (
            <>
              <Caption>
                <b style={{ fontWeight: 500 }}>{siteName(selNode)}</b> · {mw(demandAt(selNode))} at the peak · {gensHere.length ? `${gensHere.length} plant${gensHere.length > 1 ? 's' : ''}` : 'no plants'}
              </Caption>
              <Slider
                label={`Customer load at ${siteName(selNode)}`}
                value={nodeLoad(d, selNode)}
                min={0}
                max={1500}
                step={10}
                onChange={(v) => updateCapstone((x) => setNodeLoad(x, selNode, v))}
                display={`${fmt(nodeLoad(d, selNode))} MW`}
              />
              {gensHere.map((g) => (
                <Slider
                  key={g.id}
                  label={
                    <>
                      <Swatch color={FUEL[g.fuel]} />
                      {g.name}
                    </>
                  }
                  value={g.capacity}
                  min={0}
                  max={Math.max(TECH[g.fuel].maxMW, g.capacity)}
                  step={10}
                  onChange={(v) => updateCapstone((x) => setGenCapacity(x, g.id, v))}
                  display={`${fmt(g.capacity)} MW`}
                />
              ))}
              {gensHere.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', padding: '6px 0' }}>
                  {gensHere.map((g) => (
                    <Button key={g.id} onClick={() => updateCapstone((x) => removeGenerator(x, g.id))} label={`Remove ${g.name}`}>
                      Remove {g.name}
                    </Button>
                  ))}
                </div>
              )}
              <div style={{ paddingTop: 10 }}>
                <Segmented label="Technology to add" value={tech} onChange={setTech} options={BUILD_TECHS.map((t) => ({ value: t, label: TECH_LABEL[t] }))} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                  <Button primary onClick={() => updateCapstone((x) => addGenerator(x, tech, selNode))}>
                    Add {TECH[tech].defaultMW} MW of {FUEL_LABEL[tech].toLowerCase()} ({dollars(TECH[tech].defaultMW * 1000 * TECH[tech].capexPerKW)})
                  </Button>
                  <Button onClick={() => updateCapstone((x) => removeNode(x, selNode))}>Remove this substation</Button>
                </div>
              </div>
            </>
          )}
          {selLine && CORRIDOR[selLine] && (
            <>
              <Caption>
                <b style={{ fontWeight: 500 }}>{lineName(selLine)}</b> · {CORRIDOR[selLine].lengthKm} km · {lineBuilt ? 'in service' : 'not built'}
              </Caption>
              {lineBuilt ? (
                <>
                  <Slider
                    label={`Rating of ${lineName(selLine)}`}
                    value={limitOf(selLine)}
                    min={LINE_LIMITS.min}
                    max={LINE_LIMITS.max}
                    step={LINE_LIMITS.step}
                    onChange={(v) => updateCapstone((x) => setLineLimit(x, selLine, v))}
                    display={`${fmt(limitOf(selLine))} MW`}
                  />
                  <Caption>At this rating the line costs {dollars(lineCapex(CORRIDOR[selLine].lengthKm, limitOf(selLine)))} to build.</Caption>
                  <div style={{ textAlign: 'center', paddingTop: 6 }}>
                    <Button onClick={() => updateCapstone((x) => toggleLine(x, selLine))}>Remove this line</Button>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', paddingTop: 6 }}>
                  {d.nodes.includes(CORRIDOR[selLine].from) && d.nodes.includes(CORRIDOR[selLine].to) ? (
                    <Button primary onClick={() => updateCapstone((x) => toggleLine(x, selLine))}>
                      Build it at {CORRIDOR[selLine].defaultLimit} MW ({dollars(lineCapex(CORRIDOR[selLine].lengthKm, CORRIDOR[selLine].defaultLimit))})
                    </Button>
                  ) : (
                    <Caption>Both ends need a substation first.</Caption>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Figure>

      <P>
        Each piece of the editor stands for something you’ve met before. A substation is a node where lines meet and transformers step the voltage down for local
        customers (Lesson 2.3). Its customer load is the sum of its customers’ own peaks; they don’t all peak at once, so the demand there at the region’s peak hour, the
        number on the map, is lower — the next lesson takes that apart. A line has a rating, the most power it can carry before overheating, and a reactance that grows
        with its length. Power divides across parallel paths in inverse proportion to reactance (Lesson 2.4), so a new line changes the flow on every other line, not just
        its own. The numbers on the lines are those flows at the peak hour, against each line’s rating.
      </P>
      <P>
        Every change reruns three checks. The first is simple: power reaches a substation only along lines, so every substation has to be joined to the rest. The
        second asks whether there is enough generation for the hour of highest demand, with room to spare. We’ll ask for {pct(RESERVE_TARGET)} more{' '}
        <b>firm capacity</b> than demand, which is in the range North American planners use. Wind and solar only count for what the weather allows at that
        hour: at the starting design’s {hour(start.checks.peakHour)} peak, the sun has nearly set and Valley solar counts for {pct(solarAtPeak)} of its nameplate, while
        Ridge wind counts for {pct(windAtPeak)}.
      </P>
      <P>
        The third check is the security standard from Lesson 5.6, known as <b>N-1</b>: the grid must be able to serve the peak even after losing any single line. Your
        grid {checks.n1.ok ? 'passes it' : 'fails it right now'}. {n1Text()}
      </P>
      <P>
        The tally prices what you’ve drawn at illustrative overnight costs in a realistic range: {dollars(SUBSTATION_COST)} per substation, about{' '}
        {dollars(lineCapex(1, 400))} per kilometer for a 400 MW line (more for a higher rating), and from ${fmt(TECH.gasCT.capexPerKW)} per kilowatt for a gas peaker to $
        {fmt(TECH.nuclear.capexPerKW)} for nuclear. At those prices the starting region would cost {dollars(start.cap.total)} to build today, {pct(startGen)} of it in power
        plants{Math.abs(added) >= 1e6 ? <>; your changes {added > 0 ? 'add' : 'save'} <Tn tone="green">{dollars(Math.abs(added))}</Tn></> : ''}. Real projects cost more
        than their equipment — land, permits, interconnection studies, financing — and the money is the easy part next to the years they take to approve and build.
      </P>

      <Challenge
        id="a"
        question={`A developer wants to build a data-center campus at Tech Park. Connect a campus with at least ${CAMPUS_MW} MW of demand so that all three checks still pass, adding no more than ${dollars(CAMPUS_BUDGET)} to the starting design’s capital cost.`}
        solved={solved}
        status={status.join(' ')}
        success={`Solved: a ${fmt(techLoad)} MW campus with every check passing, for ${dollars(added)} of new capital. Tech Park needs at least two lines — with only one, losing it would cut the campus off — and the region needs a little more firm capacity, which a gas peaker supplies most cheaply.`}
      />

      <H2>Surviving the loss of a line</H2>
      <P>
        Why insist on N-1? A line can trip at any moment — lightning, a tree grown into a conductor, a failed insulator — and protective relays take it out of service in
        a fraction of a second. The power it carried shifts onto the remaining lines instantly, following the reactances, long before anyone could change a power
        plant’s output. If that pushes another line past its limit, it may trip too, and cascades of that kind have turned local faults into regional blackouts. So
        the operator dispatches ahead of time, in a way that leaves every single outage survivable.
      </P>
      <P>The next demonstration shows your grid at its peak hour, the instant after a line trips. Choose a dispatch, then click any line to trip it instead:</P>

      <Figure name="Grid Builder · contingencies" actions={<ResetGridButton />}>
        <Segmented
          label="Dispatch before the outage"
          value={dispatchMode}
          onChange={setDispatchMode}
          options={[
            { value: 'cheap', label: 'Cheapest' },
            { value: 'secure', label: 'N-1 secure' },
          ]}
        />
        {checks.empty || !outage ? (
          <Caption>Your grid has no lines to trip yet.</Caption>
        ) : (
          <GridMap
            d={d}
            ariaLabel={`Your grid at the ${hour(ph)} peak with ${lineName(outage)} tripped, under the ${dispatchMode === 'cheap' ? 'cheapest' : 'secure'} dispatch. ${impact.overloads.length} line${impact.overloads.length === 1 ? ' is' : 's are'} overloaded.`}
            nodeInfo={(n) => ({ value: fmt(demandAt(n)), sub: 'MW', dead: impact.islanded.includes(n) })}
            flows={impact.flows}
            outLines={[outage]}
            lineLabel={(_id, f, lim) => (Math.abs(f) / lim >= 0.8 ? `${pct(Math.abs(f) / lim)}` : '')}
            onLineClick={(id) => setTripped(id)}
            lineAction="Trip"
          />
        )}
        <Readouts
          items={[
            { label: 'line tripped', value: outage ? lineName(outage) : '—' },
            { label: 'lines overloaded', value: String(impact.overloads.length), tone: impact.overloads.length ? 'red' : 'green' },
            { label: 'most heavily loaded line', value: pct(impact.maxLoading) },
            { label: 'cost of security at the peak', value: checks.n1.ok ? `$${fmt(Math.max(0, checks.n1.securityCost))}/h` : 'not secure', tone: checks.n1.ok ? 'green' : 'red' },
          ]}
        />
        <Caption>
          {!outage
            ? 'Build a line first.'
            : impact.islanded.length
              ? `Losing ${lineName(outage)} cuts ${listNames(impact.islanded.map(siteName))} off from the rest of the grid: no dispatch can fix that, only another line can.`
              : impact.overloads.length
                ? `Losing ${lineName(outage)} pushes ${lineName(worst!)} to ${pct(Math.abs(impact.flows[worst!]) / limitOf(worst!))} of its rating before anyone can respond.`
                : `After losing ${lineName(outage)}, every remaining line stays within its rating.`}
        </Caption>
      </Figure>

      <P>
        {cheapImpact && cheapImpact.overloads.length && outage
          ? `With the cheapest dispatch, losing ${lineName(outage)} overloads ${listNames(cheapImpact.overloads.map(lineName))}. `
          : 'On your grid, the outage shown doesn’t overload anything even under the cheapest dispatch; try the others. '}
        The secure dispatch avoids this by running plants closer to the demand ahead of time and importing less over the lines at risk
        {checks.n1.ok ? (
          <>
            , at a cost of <Tn tone="green">${fmt(Math.max(0, checks.n1.securityCost))}</Tn> an hour at your grid’s peak
          </>
        ) : (
          ' — though on your grid right now no dispatch can do it without turning customers away'
        )}
        . That premium is the price of N-1. In Lesson 8.3 we’ll see it
        show up in nodal prices, at hours when every line looks comfortably below its rating.
      </P>
      <P>
        Some outages no dispatch can fix. A substation fed by a single line is cut off the moment that line trips, however strong the line is, which is why the N-1
        check fails for a radial connection. Distribution networks are mostly built radially, and a fault there blacks out a neighborhood; transmission networks are
        meshed, so that every substation has at least two ways in and the loss of one line costs money rather than customers.
      </P>
      <P>
        Our model uses the same rating before and after an outage, which is stricter than practice: real operators allow a short-term emergency rating after a trip,
        which buys them minutes to redispatch, so real grids can be run somewhat harder than ours.
      </P>
      <P>
        So far each substation’s demand has been a single number at a single hour. In the next lesson we’ll open that number up into the customers behind it, hour by
        hour, and see what weather and growth do to it.
      </P>
    </LessonPage>
  );
}
