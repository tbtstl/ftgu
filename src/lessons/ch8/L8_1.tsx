import { useMemo, useState } from 'react';
import { Button, Caption, Challenge, FUEL, FigRef, Figure, H2, Legend, LessonPage, P, Readouts, Segmented, Slider, Swatch, Tn, fmt, hour, lessonHref, mw, pct } from '../../framework';
import { outageImpact } from '../../engines/ops/adequacy';
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
  removeNode,
  setGenCapacity,
  setLineLimit,
  setNodeLoad,
  toggleLine,
  updateCapstone,
  useCapstone,
  type BuildFuel,
  type CapstoneDesign,
} from './capstone';
import { CAMPUS_BUDGET, CAMPUS_MW, campusCheck } from './challenges';
import { RESERVE_TARGET, capitalCost, checkDesign, lineCapex, lineName, listNames, networkOf, nodeDemand, siteName } from './system';
import { CheckRow, FUEL_NAME, FUEL_ORDER, GridControls, GridMap, dollars } from './ui';

const TECH_LABEL: Record<BuildFuel, string> = { gasCT: 'Gas peaker', gasCC: 'Gas combined cycle', wind: 'Wind', solar: 'Solar', coal: 'Coal', nuclear: 'Nuclear' };

type Selection = { kind: 'node' | 'line'; id: string };

const edit = (fn: (d: CapstoneDesign) => CapstoneDesign, key?: string) => updateCapstone(fn, { lesson: '8.1', key });

/** True while the reader hasn't changed the starting network or plants. */
function untouched(d: CapstoneDesign): boolean {
  const s = defaultDesign();
  return JSON.stringify([d.nodes, d.lines, d.gens.map((g) => [g.id, g.capacity])]) === JSON.stringify([s.nodes, s.lines, s.gens.map((g) => [g.id, g.capacity])]);
}

export default function Lesson() {
  const d = useCapstone();
  // Start on the empty site the challenge is about, so the first move is a click away.
  const [sel, setSel] = useState<Selection>(() => ({ kind: 'node', id: d.nodes.includes('tech') ? 'city' : 'tech' }));
  const [tech, setTech] = useState<BuildFuel>('gasCT');
  const [dispatchMode, setDispatchMode] = useState<'cheap' | 'secure'>('cheap');
  const [tripped, setTripped] = useState<string | null>(null);

  const checks = checkDesign(d);
  const cap = capitalCost(d);
  const start = useMemo(() => {
    const s = defaultDesign();
    return { cap: capitalCost(s), checks: checkDesign(s) };
  }, []);
  const net0 = cap.total - start.cap.total;
  const campus = campusCheck(d);
  const added = campus.added;
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

  // Clicking a corridor only selects it; the editor shows its cost and builds it on request.
  const onLine = (id: string) => setSel({ kind: 'line', id });

  const failing = [!checks.connected.ok && 'connectivity', !checks.capacity.ok && 'capacity', !checks.n1.ok && 'N-1'].filter(Boolean) as string[];
  const techLoad = campus.techLoad;
  const solved = campus.solved;
  const status: string[] = [];
  if (!campus.techBuilt) status.push('Tech Park has no substation yet.');
  else if (techLoad < CAMPUS_MW) status.push(`Tech Park’s demand is ${fmt(techLoad)} MW.`);
  if (campus.cut.length) status.push(`The rest of the region keeps its customers: ${listNames(campus.cut.map(siteName))} ${campus.cut.length > 1 ? 'serve' : 'serves'} less than at the start.`);
  if (failing.length) status.push(`The ${listNames(failing)} check${failing.length > 1 ? 's fail' : ' fails'}.`);
  status.push(`New capital since the starting design: ${dollars(added)}.`);

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

  const fuelsBuilt = FUEL_ORDER.filter((f) => d.gens.some((g) => g.fuel === f && g.capacity > 0));
  const firstMove = untouched(d) && !d.nodes.includes('tech');
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
        it and press Enter) to edit it, and click a dashed corridor between two substations to see what a line along it would cost, then build it if you like. Every
        change is saved as your grid; Undo takes back the last one:
      </P>

      <Figure name="Grid Builder" actions={<GridControls lesson="8.1" />}>
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
        {fuelsBuilt.length > 0 && <Legend items={fuelsBuilt.map((f) => ({ label: FUEL_NAME[f], color: FUEL[f] }))} />}
        <CheckRow ok={checks.connected.ok} title="Connected">
          {checks.empty
            ? 'Build a substation to start.'
            : checks.connected.ok
              ? 'Every substation can reach every other along the lines.'
              : `${listNames(checks.connected.cutOff.map(siteName))} ${checks.connected.cutOff.length > 1 ? 'aren’t' : 'isn’t'} connected to the rest of the grid.`}
        </CheckRow>
        <CheckRow ok={checks.capacity.ok} title="Capacity">
          At the {hour(ph)} peak the plants can deliver {mw(checks.capacity.firm)} against demand of {mw(checks.peakMW)}, a reserve margin of{' '}
          {Number.isFinite(checks.capacity.margin) ? pct(checks.capacity.margin) : '—'}; the target is {pct(RESERVE_TARGET)}, or {mw(checks.capacity.required)}.
        </CheckRow>
        <CheckRow ok={checks.n1.ok} title="N-1 at the peak">
          {n1Text()}
        </CheckRow>
        <Caption>
          Capital cost {dollars(cap.total)}
          {added >= 1e6 ? `, of which ${dollars(added)} is new since the starting design` : ''}.
        </Caption>

        <div className="card" style={{ margin: '10px 0 4px' }}>
          {firstMove && (
            <p style={{ margin: '0 0 6px', fontSize: 15, color: '#5f5f5f', textAlign: 'center' }}>
              Try this first: build a substation at Tech Park, the empty site at the bottom of the map, then click a dashed corridor from it to plan a line.
            </p>
          )}
          {selNode && !nodeBuilt && (
            <>
              <Caption>
                <b style={{ fontWeight: 500 }}>{siteName(selNode)}</b> is an empty site.
              </Caption>
              <div style={{ textAlign: 'center', paddingTop: 8 }}>
                <Button primary onClick={() => edit((x) => buildNode(x, selNode))}>
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
                onChange={(v) => edit((x) => setNodeLoad(x, selNode, v), `load:${selNode}`)}
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
                  onChange={(v) => edit((x) => setGenCapacity(x, g.id, v), `gen:${g.id}`)}
                  display={g.capacity > 0 ? `${fmt(g.capacity)} MW` : 'retired'}
                />
              ))}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', alignItems: 'center', paddingTop: 10 }}>
                <select className="tsel" aria-label="Technology to add" value={tech} onChange={(e) => setTech(e.target.value as BuildFuel)}>
                  {BUILD_TECHS.map((t) => (
                    <option key={t} value={t}>
                      {TECH_LABEL[t]}
                    </option>
                  ))}
                </select>
                <Button primary onClick={() => edit((x) => addGenerator(x, tech, selNode))}>
                  Add {TECH[tech].defaultMW} MW ({dollars(TECH[tech].defaultMW * 1000 * TECH[tech].capexPerKW)})
                </Button>
                <Button onClick={() => edit((x) => removeNode(x, selNode))}>Remove this substation</Button>
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
                    onChange={(v) => edit((x) => setLineLimit(x, selLine, v), `limit:${selLine}`)}
                    display={`${fmt(limitOf(selLine))} MW`}
                  />
                  <Caption>At this rating the line costs {dollars(lineCapex(CORRIDOR[selLine].lengthKm, limitOf(selLine)))} to build.</Caption>
                  <div style={{ textAlign: 'center', paddingTop: 6 }}>
                    <Button onClick={() => edit((x) => toggleLine(x, selLine))}>Remove this line</Button>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', paddingTop: 6 }}>
                  {d.nodes.includes(CORRIDOR[selLine].from) && d.nodes.includes(CORRIDOR[selLine].to) ? (
                    <Button primary onClick={() => edit((x) => toggleLine(x, selLine))}>
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
        customers (<a href={lessonHref('2.3')}>Lesson 2.3</a>). Its customer load is the sum of its customers’ own peaks; they don’t all peak at once, so the demand there at the region’s peak hour, the
        number on the map, is lower — the next lesson takes that apart. A line has a rating, the most power it can carry before overheating, and a reactance that grows
        with its length. Power divides across parallel paths in inverse proportion to reactance (<a href={lessonHref('2.4')}>Lesson 2.4</a>), so a new line changes the flow on every other line, not just
        its own. The numbers on the lines are those flows at the peak hour, against each line’s rating.
      </P>
      <P>
        Every change reruns three checks. The first is simple: power reaches a substation only along lines, so every substation has to be joined to the rest. The
        second asks whether there is enough generation for the hour of highest demand, with room to spare. A grid’s <b>firm capacity</b> in an hour is the output its
        plants can be counted on to deliver then, and we’ll ask for {pct(RESERVE_TARGET)} more of it than demand, which is in the range North American planners use. Wind
        and solar only count for what the weather allows at that hour: at the starting design’s {hour(start.checks.peakHour)} peak, the sun has nearly set and Valley solar counts for {pct(solarAtPeak)} of its nameplate, while
        Ridge wind counts for {pct(windAtPeak)}.
      </P>
      <P>
        The third check is the security standard we met in <a href={lessonHref('2.6')}>Lesson 2.6</a> and again in <a href={lessonHref('5.6')}>Lesson 5.6</a>, known as{' '}
        <b>N-1</b>: the grid must be able to serve the peak even after losing any single line. Your
        grid {checks.n1.ok ? 'passes it' : 'fails it right now'}. {n1Text()}
      </P>
      <P>
        The tally prices what you’ve drawn at illustrative overnight costs in a realistic range: {dollars(SUBSTATION_COST)} per substation, about{' '}
        {dollars(lineCapex(1, 400))} per kilometer for a 400 MW line (more for a higher rating), and from ${fmt(TECH.gasCT.capexPerKW)} per kilowatt for a gas peaker to $
        {fmt(TECH.nuclear.capexPerKW)} for nuclear. At those prices the starting region would cost {dollars(start.cap.total)} to build today, {pct(startGen)} of it in power
        plants{Math.abs(net0) >= 1e6 ? <>; your changes {net0 > 0 ? 'add' : 'save'} <Tn tone="green">{dollars(Math.abs(net0))}</Tn></> : ''}. Real projects cost more
        than their equipment — land, permits, interconnection studies, financing — and the money is the easy part next to the years they take to approve and build.
      </P>

      <H2>Surviving the loss of a line</H2>
      <P>
        Why insist on N-1? A line can trip at any moment — lightning, a tree grown into a conductor, a failed insulator — and protective relays take it out of service in
        a fraction of a second. The power it carried shifts onto the remaining lines instantly, following the reactances, long before anyone could change a power
        plant’s output. If that pushes another line past its limit, it may trip too, and cascades of that kind have turned local faults into regional blackouts. So
        the operator dispatches ahead of time, in a way that leaves every single outage survivable.
      </P>
      <P>The next demonstration shows your grid at its peak hour, the instant after a line trips. Choose a dispatch, then click any line to trip it instead:</P>

      <Figure name="Grid Builder · contingencies">
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
        . That premium is the price of N-1. In <a href={lessonHref('8.3')}>Lesson 8.3</a> we’ll see it
        show up in nodal prices, at hours when every line looks comfortably below its rating.
      </P>
      <P>
        Some outages no dispatch can fix. A substation fed by a single line is cut off the moment that line trips, however strong the line is, which is why the N-1
        check fails for a radial connection. Distribution networks are mostly built radially, and a fault there blacks out a neighborhood; transmission networks are
        meshed, so that every substation has at least two ways in and the loss of one line costs money rather than customers.
      </P>
      <P>
        Our model uses the same rating before and after an outage, which is stricter than practice: as in <a href={lessonHref('5.6')}>Lesson 5.6</a>, real operators
        allow a short-term emergency rating after a trip, which buys them minutes to redispatch, so real grids can be run somewhat harder than ours.
      </P>

      <Challenge
        id="a"
        figure="Grid Builder"
        question={
          <>
            A developer wants to build a data-center campus at Tech Park. Using <FigRef to="Grid Builder">the first demonstration</FigRef>, connect a campus with at least{' '}
            {CAMPUS_MW} MW of demand so that all three checks still pass, spending no more than {dollars(CAMPUS_BUDGET)} on new substations, lines and plants. The rest
            of the region keeps its customers, and retiring plants or lines doesn’t pay for the campus. What you build here stays in your grid for the rest of the
            chapter; Undo or Reset 8.1 takes it back.
          </>
        }
        solved={solved}
        status={status.join(' ')}
        success={`Solved: a ${fmt(techLoad)} MW campus with every check passing, for ${dollars(added)} of new capital. Tech Park needs at least two lines — with only one, losing it would cut the campus off — and the region needs a little more firm capacity, which a gas peaker supplies most cheaply.`}
      />

      <P>
        So far each substation’s demand has been a single number at a single hour. In the next lesson we’ll open that number up into the customers behind it, hour by
        hour, and see what weather and growth do to it.
      </P>
    </LessonPage>
  );
}
