import { useDeferredValue, useMemo } from 'react';
import { AxisX, Button, Caption, Challenge, Checkbox, DataTable, FUEL, Figure, GridY, H2, K, LessonPage, P, Readouts, Swatch, Tn, fmt, hour, lessonHref, linePath, mw, mwh, pct, priceFill, scale, usd } from '../../framework';
import { capacityDemandPrice } from '../../engines/market/ancillary';
import { clearAttempts, saveAttempt, updateCapstone, useAttempts, useCapstone } from './capstone';
import { RESERVE_TARGET, WEATHER, argmax, capitalCost, emissions, lineName, listNames, siteName, transitionCapex } from './system';
import { BUDGET, CAPACITY_PRICE, FUTURE_GROWTH, SCENARIO_WEIGHT, TARGET_SLACK, candidates, evaluate, profitTarget, retiredPlants, type Candidate } from './strategy';
import { EmptyNote, FUEL_NAME, FUEL_ORDER, GridControls, GridMap, GridStrip, dollars, useBestPortfolio } from './ui';

const toggle = (id: string, on: boolean) =>
  updateCapstone((x) => ({ ...x, investments: on ? [...x.investments.filter((y) => y !== id), id] : x.investments.filter((y) => y !== id) }), { lesson: '8.6' });

/** A project's name, short enough for a button. */
function shortName(c: Candidate): string {
  if (c.kind === 'line') return c.name.replace(/ by \d+ MW$/, '');
  if (c.kind === 'dr') return 'Demand response';
  if (c.kind === 'battery') return 'Battery';
  const s = c.name.split(',')[0];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The projects as toggle buttons, repeated in the later figures so they can be changed there. */
function ProjectChips({ cands, chosen }: { cands: Candidate[]; chosen: string[] }) {
  return (
    <div role="group" aria-label="Projects in the portfolio" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', margin: '2px 0 10px' }}>
      {cands.map((c) => {
        const on = chosen.includes(c.id);
        return (
          <button key={c.id} type="button" className={'tbtn' + (on ? ' primary' : '')} aria-pressed={on} onClick={() => toggle(c.id, !on)} style={{ minHeight: 36, padding: '0 10px', fontSize: 14 }}>
            {shortName(c)}
          </button>
        );
      })}
    </div>
  );
}

/** The capacity market's sloped demand curve, with where the grid lands on it without projects and with them. */
function CapacityCurve({ requirement, supply0, supply }: { requirement: number; supply0: number; supply: number }) {
  const W = 640;
  const H = 210;
  const X0 = 64;
  const X1 = 624;
  const top = 24;
  const bottom = H - 36;
  const r0 = supply0 / requirement;
  const r1 = supply / requirement;
  const lo = Math.min(0.85, r0 - 0.03, r1 - 0.03);
  const hi = Math.max(1.15, r1 + 0.03, r0 + 0.03);
  const x = scale(lo, hi, X0, X1);
  const y = scale(0, CAPACITY_PRICE.priceCap * 1.12, bottom, top);
  const curve = { target: requirement, ...CAPACITY_PRICE };
  const pts: Array<[number, number]> = [
    [lo, CAPACITY_PRICE.priceCap],
    [CAPACITY_PRICE.lowPoint, CAPACITY_PRICE.priceCap],
    [1, CAPACITY_PRICE.priceAtTarget],
    [CAPACITY_PRICE.highPoint, 0],
    [hi, 0],
  ];
  const p0 = capacityDemandPrice(curve, supply0);
  const p1 = capacityDemandPrice(curve, supply);
  const moved = Math.abs(r1 - r0) > 0.002;
  const labelRight = x(r1) < X1 - 150;
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`The capacity market’s demand curve. Without new projects the grid can deliver ${pct(r0)} of the ${fmt(requirement)} MW requirement, for a price of ${usd(p0)} per MW-day; with your projects ${pct(r1)}, for ${usd(p1)}.`}
    >
      <text className="ax" x={X0} y={14}>
        Capacity price, $ per MW-day
      </text>
      <GridY y={y} ticks={[0, 100, 200, 300, 400, 500]} x0={X0} x1={X1} format={(v) => '$' + fmt(v)} baseline={0} />
      <line x1={x(1)} x2={x(1)} y1={top} y2={bottom} stroke="#9a9a9a" strokeDasharray="4 4" />
      <text className="ax" x={x(1) + 5} y={top + 10}>
        requirement
      </text>
      <path d={linePath(pts.map((p) => x(p[0])), pts.map((p) => y(p[1])))} fill="none" stroke="#3f7a1e" strokeWidth={2.5} />
      {moved && <circle cx={x(r0)} cy={y(p0)} r={4.5} fill="#fff" stroke="#6b6b6b" strokeWidth={1.5} />}
      {moved && (
        <text className="ax" x={x(r0)} y={y(p0) + (p0 > 300 ? 20 : -10)} textAnchor="middle">
          without projects
        </text>
      )}
      <line x1={x(r1)} x2={x(r1)} y1={y(p1)} y2={bottom} stroke="#333" strokeWidth={1.5} />
      <circle cx={x(r1)} cy={y(p1)} r={6} fill="#3f7a1e" stroke="#fff" strokeWidth={1.5} />
      <text className="lab" x={labelRight ? x(r1) + 10 : x(r1) - 10} y={Math.max(top + 12, y(p1) - 10)} textAnchor={labelRight ? 'start' : 'end'}>
        {usd(p1)} per MW-day
      </text>
      <AxisX x={x} ticks={[0.9, 1, 1.1].filter((t) => t > lo && t < hi).concat(lo < 0.8 ? [0.8] : [])} yPos={bottom + 17} format={(v) => pct(v)} />
      <text className="ax" x={X1} y={H - 4} textAnchor="end">
        firm capacity at the hot day’s peak, share of the requirement
      </text>
    </svg>
  );
}

export default function Lesson() {
  const live = useCapstone();
  const d = useDeferredValue(live);
  const attempts = useAttempts();
  const cands = useMemo(() => candidates(d), [d]);
  const ids = useMemo(() => d.investments.filter((id) => cands.some((c) => c.id === id)), [d, cands]);
  const ev = useMemo(() => (d.nodes.length ? evaluate(d, ids) : null), [d, ids]);
  const base0 = useMemo(() => (d.nodes.length ? evaluate(d, []) : null), [d]);
  const search = useBestPortfolio(d);
  const pending = live !== d;

  if (!ev || !base0) {
    return (
      <LessonPage id="8.6">
        <GridStrip d={live} lesson="8.6" />
        <P>
          The strategy challenge needs a grid to invest in, and yours has no substations. Build one in <a href={lessonHref('8.1')}>Lesson 8.1</a>, or reset your grid to
          the starting design.
        </P>
        <Figure name="Grid Strategy Challenge" actions={<GridControls lesson="8.6" />}>
          <EmptyNote>Nothing to invest in.</EmptyNote>
        </Figure>
        <Challenge id="a" question="Build a reliable portfolio that earns nearly as much as the best one for your grid." solved={false} status="Your grid has no substations yet." success="" />
      </LessonPage>
    );
  }

  const retired = retiredPlants(d);
  const chosen = live.investments;
  const best = search.status === 'done' ? search.best : null;
  const target = best ? profitTarget(best.score) : null;
  const solved = !pending && target !== null && ev.valid && ev.score >= target - 1;
  const ranked = [...attempts].sort((a, b) => Number(b.valid) - Number(a.valid) || b.score - a.score);
  const hot = ev.scenarios.find((s) => s.weather === 'hot')!;
  const hotRun = hot.run;
  const hp = argmax(hotRun.demand);
  const hr = hotRun.hours[hp];
  const sys = hotRun.sys;
  const dear = cands.find((c) => c.id === 'peaker')?.addition.gens?.[0]?.node;
  const req = ev.capacity.requirement;

  const hotPrices = d.nodes.map((n) => hr.lmp[n] ?? 0);
  const pLo = Math.min(...hotPrices);
  const pHi = Math.max(...hotPrices);
  const priceRange = pHi - pLo < 0.5 ? `Every node pays ${usd(pHi)} per MWh.` : `Prices run from ${usd(pLo)} to ${usd(pHi)} per MWh.`;
  const bestSaved = ranked.find((a) => a.valid);
  const byFuel: Record<string, number> = {};
  for (const g of sys.gens) byFuel[g.fuel] = (byFuel[g.fuel] ?? 0) + g.capacity;
  const fuels = FUEL_ORDER.filter((f) => byFuel[f]);
  const gridBatt = sys.batteries.filter((b) => b.kind === 'grid');
  const homeBatt = d.nodes.reduce((a, n) => a + (d.vpp.mw[n] ?? 0), 0);
  const totalCapital = capitalCost(d).total + transitionCapex(d) + ev.capital;
  const shed = Object.values(hr.shed).reduce((a, b) => a + b, 0);

  const verdict = pending ? 'Clearing three days of the planning year…' : ev.valid ? 'Your portfolio keeps the grid reliable on all three days and fits the budget.' : ev.problems.join(' ');
  const searchNote =
    search.status === 'working'
      ? `Finding the best portfolio for your grid${search.total ? ` (${search.tried} of ${search.total} tried)` : ''}…`
      : best
        ? `Of all the portfolios that fit the budget, the best earns ${dollars(best.score)} a year.`
        : 'No portfolio within the budget keeps your grid reliable on all three days.';

  return (
    <LessonPage id="8.6">
      <GridStrip d={live} lesson="8.6" />
      <P>
        Every lesson so far has looked at your grid on a single day. Grids are built for decades, though, and the decisions that shape them are made years ahead, against a
        future nobody knows. So this lesson moves your grid forward to a <b>planning year</b>. Demand is {pct(FUTURE_GROWTH)} higher than in{' '}
        <a href={lessonHref('8.2')}>Lesson 8.2</a>, and{' '}
        {retired.length
          ? `${listNames(retired.map((g) => g.name))} ${retired.length > 1 ? 'have' : 'has'} retired, as aging coal and oil plants are doing across North America`
          : 'no plant has retired'}
        .
      </P>
      <P>
        The year is made of the three kinds of day from <a href={lessonHref('8.2')}>Lesson 8.2</a>: typical days ({pct(SCENARIO_WEIGHT.typical)} of the year), hot days (
        {pct(SCENARIO_WEIGHT.hot)}) and calm, cloudy days ({pct(SCENARIO_WEIGHT.calm)}). On each of them the grid has to serve all its demand and survive the loss of any
        single line at the peak.{' '}
        {base0.valid ? 'Yours already does, without new projects.' : `Without new projects yours doesn’t: ${base0.problems[0] ?? ''}`}
      </P>
      <P>
        {base0.valid ? 'To invest in it' : 'To fix that'}, you have a capital budget of {dollars(BUDGET)} and a list of candidate projects placed where the planning year needs them:
        plants and a battery{dear ? ` at ${siteName(dear)}, where it needs power most` : ''}, upgrades on the lines that most limit the dispatch, and a demand-response
        program where demand is largest. Each project pays its annualized capital and fixed costs every year, and earns what the market pays it: an energy margin at its
        own node’s price on each kind of day, from the engine of <a href={lessonHref('8.3')}>Lesson 8.3</a>, and a <K c="price">capacity payment</K>.
      </P>
      <P>
        The capacity payment comes from a sloped capacity market like the one in <a href={lessonHref('4.6')}>Lesson 4.6</a>, and it pays for the megawatts a project can
        deliver at the hot day’s peak. The market’s requirement is that peak plus the {pct(RESERVE_TARGET)} reserve margin of <a href={lessonHref('8.1')}>Lesson 8.1</a>,
        or {mw(req)} on your grid. Short of {pct(CAPACITY_PRICE.lowPoint)} of the requirement the price sits at its cap of {usd(CAPACITY_PRICE.priceCap)} per MW-day; it
        falls to {usd(CAPACITY_PRICE.priceAtTarget)} at the requirement and to nothing at {pct(CAPACITY_PRICE.highPoint)} of it. Without new projects your grid can
        deliver {mw(base0.capacity.supply)} then, {pct(base0.capacity.supply / Math.max(1, req))} of the requirement, so the price would be {usd(base0.capacity.price)}. In
        the next demonstration, choose projects and watch where the grid lands on that curve:
      </P>

      <Figure name="Grid Strategy Challenge" actions={<GridControls lesson="8.6" />}>
        <Readouts
          items={[
            { label: `capital used, of ${dollars(BUDGET)}`, value: dollars(ev.capital), tone: ev.withinBudget ? undefined : 'red' },
            { label: 'portfolio profit per year', value: dollars(ev.score), tone: ev.score >= 0 ? 'green' : 'red' },
            { label: 'constraints', value: pending ? '…' : ev.valid ? 'all met' : `${ev.problems.length} broken`, tone: ev.valid ? 'green' : 'red' },
          ]}
        />
        <div style={{ maxWidth: 600, margin: '6px auto' }}>
          {cands.map((c) => (
            <div key={c.id} style={{ padding: '1px 0', borderBottom: '1px solid #e2e2e2', lineHeight: 1.4 }}>
              <Checkbox
                checked={chosen.includes(c.id)}
                onChange={(on) => toggle(c.id, on)}
                label={
                  <span>
                    <b style={{ fontWeight: 500 }}>{c.name}</b> · {dollars(c.capital)} · {dollars(c.annualCost)} a year{' '}
                    <span style={{ fontSize: 14, color: '#5f5f5f' }}>— {c.detail[0].toLowerCase() + c.detail.slice(1)}</span>
                  </span>
                }
              />
            </div>
          ))}
        </div>
        <CapacityCurve requirement={req} supply0={base0.capacity.supply} supply={ev.capacity.supply} />
        <Caption>{verdict}</Caption>
      </Figure>

      <P>
        That slope is what makes this a puzzle rather than a shopping list. Once the grid nears its requirement, every megawatt of firm capacity you add lowers the
        capacity price paid to every other project, and every plant that runs in the dear hours lowers the energy prices they earn. Projects that look good alone can look
        poor together. A wind or solar farm earns little capacity payment, because it delivers little at an evening peak on a still, hot day, and an upgrade relieves
        exactly the congestion it’s paid from. The cheapest way to meet the constraints is rarely the most profitable, and the most profitable set of projects often
        breaks one.
      </P>

      <H2>Scoring a portfolio</H2>
      <P>
        Your score is the portfolio’s profit per year, and it counts only if the grid stays reliable on all three days and the projects fit the budget. The next
        demonstration breaks the score down by day and by project, and keeps a board of the attempts you save. The projects are repeated as buttons, so you can change
        the portfolio here:
      </P>

      <Figure
        name="Grid Strategy Challenge · scorecard"
        actions={
          <>
            <Button onClick={() => saveAttempt({ score: ev.score, capital: ev.capital, valid: ev.valid, investments: ids })} disabled={pending}>
              Save attempt
            </Button>
            {ranked.length > 0 && <Button onClick={clearAttempts}>Clear saved attempts</Button>}
          </>
        }
      >
        <ProjectChips cands={cands} chosen={chosen} />
        <DataTable
          caption="The planning year’s three kinds of day"
          rows={ev.scenarios}
          rowKey={(s) => s.weather}
          rowClass={(s) => (s.unservedMWh > 0.5 || !s.n1 ? 'hl' : '')}
          columns={[
            { label: 'Day', cell: (s) => WEATHER[s.weather].label },
            { label: 'Share of year', cell: (s) => pct(SCENARIO_WEIGHT[s.weather]) },
            { label: 'Peak', cell: (s) => mw(s.checks.peakMW) },
            { label: 'Unserved', cell: (s) => <Tn tone={s.unservedMWh > 0.5 ? 'red' : 'green'}>{mwh(s.unservedMWh)}</Tn> },
            { label: 'N-1 at the peak', cell: (s) => <Tn tone={s.n1 ? 'green' : 'red'}>{s.n1 ? 'secure' : 'fails'}</Tn> },
          ]}
        />
        {ev.projects.length > 0 ? (
          <DataTable
            caption="What each project earns per year"
            rows={ev.projects}
            rowKey={(p) => p.c.id}
            columns={[
              { label: 'Project', cell: (p) => shortName(p.c) },
              { label: 'Energy', cell: (p) => dollars(p.energy) },
              { label: 'Capacity', cell: (p) => dollars(p.capacity) },
              { label: 'Costs', cell: (p) => dollars(-p.cost) },
              { label: 'Profit', cell: (p) => <Tn tone={p.profit >= 0 ? 'green' : 'red'}>{dollars(p.profit)}</Tn> },
            ]}
            footer={['Portfolio', dollars(ev.projects.reduce((a, p) => a + p.energy, 0)), dollars(ev.projects.reduce((a, p) => a + p.capacity, 0)), dollars(-ev.projects.reduce((a, p) => a + p.cost, 0)), dollars(ev.score)]}
          />
        ) : (
          <Caption>No projects chosen yet.</Caption>
        )}
        <Caption>
          {verdict} {searchNote}
        </Caption>
        {ranked.length > 0 && (
          <DataTable
            caption="Your saved attempts"
            rows={ranked.slice(0, 3)}
            rowKey={(a) => a.id}
            rowClass={(a) => (a.valid ? '' : 'dim')}
            columns={[
              { label: 'Rank', cell: (a) => (a.valid ? String(ranked.filter((x) => x.valid).indexOf(a) + 1) : '—') },
              { label: 'Attempt', cell: (a) => a.name },
              { label: 'Projects', cell: (a) => String(a.investments.length) },
              { label: 'Profit per year', cell: (a) => (a.valid ? dollars(a.score) : 'invalid') },
              {
                label: <span className="sr-only">Load</span>,
                cell: (a) => (
                  <Button onClick={() => updateCapstone((x) => ({ ...x, investments: a.investments }), { lesson: '8.6' })} label={`Load ${a.name}`}>
                    Load
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Figure>

      <P>
        The line upgrades show a problem real transmission faces. An upgrade here is owned like a merchant line and earns its share of the congestion rent on that line,
        the price gap across it times its flow — and the better it works, the smaller that gap becomes: an upgrade that removes a constraint removes its own income. That
        is why most transmission in North America is built as a regulated asset, paid for through rates on the strength of what it saves everyone, rather than on what it
        could earn in the market. Here we score it like any other project, so you can see the gap.
      </P>

      <Challenge
        id="a"
        question={
          target !== null && best
            ? `Choose a portfolio that keeps your grid reliable on all three days, within the ${dollars(BUDGET)} budget, and earns at least ${dollars(target)} a year — within ${pct(TARGET_SLACK)} of the best portfolio for your grid, which earns ${dollars(best.score)}.`
            : `Choose a portfolio that keeps your grid reliable on all three days, within the ${dollars(BUDGET)} budget, and earns within ${pct(TARGET_SLACK)} of what the best portfolio for your grid earns.`
        }
        solved={solved}
        status={
          search.status === 'working'
            ? searchNote
            : !best
              ? `${searchNote} Strengthen it in Lesson 8.1, or reset your grid to try the starting design.`
              : pending
                ? 'Clearing the planning year…'
                : ev.valid
                  ? `Your portfolio is valid and earns ${dollars(ev.score)} a year, against a target of ${dollars(target!)}.`
                  : `Not yet valid: ${ev.problems[0]}`
        }
        success={`Solved: ${dollars(ev.score)} a year from ${dollars(ev.capital)} of capital, with the grid secure on every kind of day${best && ev.score >= best.score - 1 ? ' — the best portfolio there is for your grid' : `, against ${dollars(best?.score ?? 0)} for the best`}. Profit depends on the whole set: each firm megawatt lowers the capacity price for every project in it.`}
      />

      {ev.projects.length > 0 && (
        <P>
          {(() => {
            const sorted = [...ev.projects].sort((a, b) => b.profit - a.profit);
            const bestP = sorted[0];
            const worstP = sorted[sorted.length - 1];
            const first = `In your portfolio, the ${bestP.c.name[0].toLowerCase() + bestP.c.name.slice(1)} does best, at ${dollars(bestP.profit)} a year, ${bestP.capacity > Math.abs(bestP.energy) ? 'mostly from the capacity market' : 'mostly from energy'}.`;
            const second =
              sorted.length > 1 && worstP.profit < 0
                ? ` The ${worstP.c.name[0].toLowerCase() + worstP.c.name.slice(1)} loses ${dollars(-worstP.profit)} a year; it may still be worth keeping if the grid fails without it.`
                : sorted.length > 1
                  ? ' Every project you’ve chosen covers its costs.'
                  : '';
            return first + second;
          })()}{' '}
          The capacity market is paying {usd(ev.capacity.price)} per MW-day, for firm capacity of {mw(ev.capacity.supply)} against a requirement of {mw(req)}.
        </P>
      )}
      <P>
        Real planners do this at a much larger scale. A utility’s integrated resource plan, or a market operator’s transmission study, runs models like this one over
        thousands of hours, many weather years and dozens of futures for fuel prices and demand, and searches far more candidate projects than any person could try by
        hand. The weights matter as much as the models: we’ve said hot days are {pct(SCENARIO_WEIGHT.hot)} of the year, and most of what a peaker earns from energy
        comes on those days. With a different guess, a different portfolio could come out on top.
        {bestSaved ? ` Your best saved attempt so far, ${bestSaved.name}, earns ${dollars(bestSaved.score)} a year.` : ' Save a few attempts to compare them on the board.'}
      </P>

      <H2>Your grid</H2>
      <P>
        Here is the grid you built, in the planning year, at the peak of a hot day — the hardest hour it has to face — with the projects you’ve chosen, which you can
        change here too. Nodes are shaded by price, as in <a href={lessonHref('8.3')}>Lesson 8.3</a>:
      </P>

      <Figure name="Grid Strategy Challenge · your grid">
        <ProjectChips cands={cands} chosen={chosen} />
        <GridMap
          d={d}
          ariaLabel={`Your grid in the planning year at ${hour(hp)} on a hot day. ${priceRange}`}
          nodeInfo={(n) => ({ value: usd(hr.lmp[n] ?? 0), sub: 'per MWh', fill: priceFill(hr.lmp[n] ?? 0) })}
          flows={hr.flows}
          limits={Object.fromEntries(sys.net.lines.map((l) => [l.id, l.limit]))}
          plants={sys.gens}
        />
        <div className="lg" style={{ paddingTop: 8 }}>
          {fuels.map((f) => (
            <span key={f}>
              <Swatch color={FUEL[f]} />
              {FUEL_NAME[f]}
            </span>
          ))}
        </div>
        <Readouts
          items={[
            { label: `demand shed at the ${hour(hp)} peak`, value: mw(shed), tone: shed > 0.5 ? 'red' : 'green' },
            { label: 'emissions on the hot day', value: `${fmt(emissions(hotRun))} t CO₂` },
            { label: 'capital you’ve built, home batteries aside', value: dollars(totalCapital) },
          ]}
        />
        <Caption>
          Plants in the planning year: {fuels.map((f) => `${FUEL_NAME[f]} ${fmt(byFuel[f])} MW`).join(' · ') || 'none'}.{' '}
          {gridBatt.length ? `Grid batteries: ${gridBatt.map((b) => `${fmt(b.powerMW)} MW at ${siteName(b.node)}`).join(', ')}. ` : ''}
          {homeBatt > 0 ? `Home batteries: ${mw(homeBatt)}.` : ''}
        </Caption>
      </Figure>

      <P>
        {ev.chosen.some((c) => c.kind === 'line')
          ? `The upgrade${ev.chosen.filter((c) => c.kind === 'line').length > 1 ? 's' : ''} on ${listNames(ev.chosen.filter((c) => c.kind === 'line').map((c) => lineName(Object.keys(c.addition.upgrades!)[0])))} change how power reaches the load. `
          : ''}
        Look at where the price is highest at this hour, and at which lines are carrying the most. That map draws on much of the course: the flows follow the physics
        of Chapters 1 and 2, the prices come from the auctions of Chapter 4 and the network of Chapter 5, and the batteries schedule themselves against those prices
        with the optimization of <a href={lessonHref('6.4')}>Lesson 6.4</a>, gathered into a fleet as the aggregators of Chapter 7 do. The model behind it balances
        supply and demand hour by hour, though, not second by second: the frequency, inertia and ramping that Chapter 3’s operators manage are left out, and so are the forecasts, hedges
        and risk limits of Chapter 6’s traders.
      </P>
      <P>
        None of these models is the whole truth about a real grid; each leaves things out, and we’ve tried to say what. But together they are the logic that operators and
        markets run every few minutes of every day: physics deciding what is possible, an optimization choosing the cheapest way to do it, and prices telling everyone —
        plant owners, battery fleets, investors, the developer at Tech Park — what their decisions are worth. We started this course with a battery and a resistor. You’ve
        finished it with a grid of your own, and the tools to reason about any other.
      </P>
    </LessonPage>
  );
}
