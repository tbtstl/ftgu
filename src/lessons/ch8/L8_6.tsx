import { useDeferredValue, useMemo } from 'react';
import { Button, Caption, Challenge, Checkbox, DataTable, FUEL, Figure, H2, K, LessonPage, P, Readouts, Swatch, Tn, fmt, hour, mw, mwh, pct, priceFill, usd } from '../../framework';
import { CORRIDOR, clearAttempts, saveAttempt, updateCapstone, useAttempts, useCapstone } from './capstone';
import { RESERVE_TARGET, WEATHER, argmax, capitalCost, emissions, lineName, listNames, siteName, transitionCapex } from './system';
import { BUDGET, CAPACITY_PRICE, FUTURE_GROWTH, PROFIT_TARGET, SCENARIO_WEIGHT, candidates, evaluate, retiredPlants } from './strategy';
import { EmptyNote, FUEL_NAME, FUEL_ORDER, GridMap, ResetGridButton, dollars } from './ui';

export default function Lesson() {
  const live = useCapstone();
  const d = useDeferredValue(live);
  const attempts = useAttempts();
  const cands = useMemo(() => candidates(d), [d]);
  const ids = useMemo(() => d.investments.filter((id) => cands.some((c) => c.id === id)), [d, cands]);
  const ev = useMemo(() => (d.nodes.length ? evaluate(d, ids) : null), [d, ids]);
  const base0 = useMemo(() => (d.nodes.length ? evaluate(d, []) : null), [d]);
  const pending = live !== d;

  const toggle = (id: string, on: boolean) =>
    updateCapstone((x) => ({ ...x, investments: on ? [...x.investments.filter((y) => y !== id), id] : x.investments.filter((y) => y !== id) }));

  if (!ev || !base0) {
    return (
      <LessonPage id="8.6">
        <P>The strategy challenge needs a grid to invest in, and yours has no substations. Build one in Lesson 8.1, or reset your grid to the starting design.</P>
        <Figure name="Grid Strategy Challenge" actions={<ResetGridButton />}>
          <EmptyNote>Nothing to invest in.</EmptyNote>
        </Figure>
        <Challenge id="a" question="Build a reliable, profitable portfolio." solved={false} status="Your grid has no substations yet." success="" />
      </LessonPage>
    );
  }

  const retired = retiredPlants(d);
  const solved = ev.valid && ev.score >= PROFIT_TARGET;
  const ranked = [...attempts].sort((a, b) => Number(b.valid) - Number(a.valid) || b.score - a.score);
  const hot = ev.scenarios.find((s) => s.weather === 'hot')!;
  const hotRun = hot.run;
  const hp = argmax(hotRun.demand);
  const hr = hotRun.hours[hp];
  const sys = hotRun.sys;
  const dear = cands.find((c) => c.id === 'peaker')?.addition.gens?.[0]?.node;

  const hotPrices = d.nodes.map((n) => hr.lmp[n] ?? 0);
  const pLo = Math.min(...hotPrices);
  const pHi = Math.max(...hotPrices);
  const priceRange = pHi - pLo < 0.5 ? `Every node pays ${usd(pHi)} per MWh.` : `Prices run from ${usd(pLo)} to ${usd(pHi)} per MWh.`;
  const bestSaved = ranked.find((a) => a.valid);
  const byFuel: Record<string, number> = {};
  for (const g of sys.gens) byFuel[g.fuel] = (byFuel[g.fuel] ?? 0) + g.capacity;
  const fuelText = FUEL_ORDER.filter((f) => byFuel[f]).map((f) => `${FUEL_NAME[f]} ${fmt(byFuel[f])}`);
  const gridBatt = sys.batteries.filter((b) => b.kind === 'grid');
  const homeBatt = d.nodes.reduce((a, n) => a + (d.vpp.mw[n] ?? 0), 0);
  const km = d.lines.reduce((a, l) => a + CORRIDOR[l.id].lengthKm, 0);
  const totalCapital = capitalCost(d).total + transitionCapex(d) + ev.capital;
  const summary = [
    { k: 'Substations', v: `${d.nodes.length}: ${listNames(d.nodes.map(siteName))}` },
    { k: 'Lines', v: `${d.lines.length}, ${fmt(km)} km` },
    { k: 'Plants in the planning year, MW', v: fuelText.join(' · ') || 'none' },
    { k: 'Grid batteries', v: gridBatt.length ? gridBatt.map((b) => `${fmt(b.powerMW)} MW / ${fmt(b.energyMWh)} MWh at ${siteName(b.node)}`).join('; ') : 'none' },
    { k: 'Home batteries (VPP)', v: mw(homeBatt) },
    { k: 'Emissions on the hot day', v: `${fmt(emissions(hotRun))} t CO₂` },
  ];

  return (
    <LessonPage id="8.6">
      <P>
        Every lesson so far has looked at your grid on a single day. Grids are built for decades, though, and the decisions that shape them are made years ahead, against a
        future nobody knows. So the last demonstration moves your grid forward to a <b>planning year</b>. Demand is {pct(FUTURE_GROWTH)} higher than in Lesson 8.2, and{' '}
        {retired.length
          ? `${listNames(retired.map((g) => g.name))} ${retired.length > 1 ? 'have' : 'has'} retired, as aging coal and oil plants are doing across North America`
          : 'no plant has retired'}
        .
        The year is made of the three kinds of day from Lesson 8.2: typical days ({pct(SCENARIO_WEIGHT.typical)} of the year), hot days ({pct(SCENARIO_WEIGHT.hot)}) and
        calm, cloudy days ({pct(SCENARIO_WEIGHT.calm)}).
      </P>
      <P>
        You have a capital budget of {dollars(BUDGET)} and a list of candidate projects, placed where the planning year needs them: plants and a battery
        {dear ? ` at ${siteName(dear)}, where the planning year needs power most` : ''}, upgrades on the lines that most limit the dispatch, and a demand-response program where
        demand is largest. Each project earns what the market pays it: energy margins at its own node’s price on each kind of day, from the engine of Lesson 8.3, plus a{' '}
        <K c="price">capacity payment</K> from a sloped capacity market like the one in Lesson 4.6, for the megawatts it can deliver at the hot day’s peak. It pays its
        annualized capital and fixed costs. A line upgrade is owned like a merchant line and earns its share of the congestion rent on that line.
      </P>
      <P>
        Your score is the profit of the portfolio, per year. It counts only if the grid leaves no demand unserved on any of the three days, can survive the loss of any single
        line at each day’s peak, and the projects fit the budget:
      </P>

      <Figure
        name="Grid Strategy Challenge"
        actions={
          <>
            <Button onClick={() => saveAttempt({ score: ev.score, capital: ev.capital, valid: ev.valid, investments: ids })} disabled={pending}>
              Save attempt
            </Button>
            <Button onClick={() => updateCapstone((x) => ({ ...x, investments: [] }))}>Clear choices</Button>
            <ResetGridButton />
          </>
        }
      >
        <Readouts
          items={[
            { label: `capital used, of ${dollars(BUDGET)}`, value: dollars(ev.capital), tone: ev.withinBudget ? undefined : 'red' },
            { label: 'capacity price, per MW-day', value: usd(ev.capacity.price), tone: 'green' },
            { label: 'portfolio profit per year', value: dollars(ev.score), tone: ev.score >= 0 ? 'green' : 'red' },
            { label: 'constraints', value: pending ? '…' : ev.valid ? 'all met' : `${ev.problems.length} broken`, tone: ev.valid ? 'green' : 'red' },
          ]}
        />
        <div style={{ maxWidth: 600, margin: '8px auto' }}>
          {cands.map((c) => (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', padding: '2px 0', borderBottom: '1px solid #e2e2e2' }}>
              <Checkbox
                checked={live.investments.includes(c.id)}
                onChange={(on) => toggle(c.id, on)}
                label={
                  <span>
                    <b style={{ fontWeight: 500 }}>{c.name}</b> · {dollars(c.capital)} · {dollars(c.annualCost)} a year
                  </span>
                }
              />
              <span style={{ fontSize: 14, color: '#5f5f5f', margin: '-8px 0 6px 30px' }}>{c.detail}</span>
            </div>
          ))}
        </div>
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
            { label: 'Avg. price', cell: (s) => usd(s.run.summary.averagePrice) },
          ]}
        />
        {ev.projects.length > 0 && (
          <DataTable
            caption="What each project earns per year"
            rows={ev.projects}
            rowKey={(p) => p.c.id}
            columns={[
              { label: 'Project', cell: (p) => p.c.name },
              { label: 'Energy', cell: (p) => dollars(p.energy) },
              { label: 'Capacity', cell: (p) => dollars(p.capacity) },
              { label: 'Costs', cell: (p) => dollars(-p.cost) },
              { label: 'Profit', cell: (p) => <Tn tone={p.profit >= 0 ? 'green' : 'red'}>{dollars(p.profit)}</Tn> },
            ]}
            footer={['Portfolio', dollars(ev.projects.reduce((a, p) => a + p.energy, 0)), dollars(ev.projects.reduce((a, p) => a + p.capacity, 0)), dollars(-ev.projects.reduce((a, p) => a + p.cost, 0)), dollars(ev.score)]}
          />
        )}
        <Caption>{pending ? 'Clearing three days of the planning year…' : ev.valid ? 'Your portfolio keeps the grid reliable on all three days and fits the budget.' : ev.problems.join(' ')}</Caption>
        {ranked.length > 0 && (
          <>
            <DataTable
              caption="Your saved attempts"
              rows={ranked}
              rowKey={(a) => a.id}
              rowClass={(a) => (a.valid ? '' : 'dim')}
              columns={[
                { label: 'Rank', cell: (a) => (a.valid ? String(ranked.filter((x) => x.valid).indexOf(a) + 1) : '—') },
                { label: 'Attempt', cell: (a) => a.name },
                { label: 'Projects', cell: (a) => String(a.investments.length) },
                { label: 'Capital', cell: (a) => dollars(a.capital) },
                { label: 'Profit per year', cell: (a) => (a.valid ? dollars(a.score) : 'invalid') },
                {
                  label: <span className="sr-only">Load</span>,
                  cell: (a) => (
                    <Button onClick={() => updateCapstone((x) => ({ ...x, investments: a.investments }))} label={`Load ${a.name}`}>
                      Load
                    </Button>
                  ),
                },
              ]}
            />
            <div style={{ textAlign: 'center', paddingTop: 8 }}>
              <Button onClick={clearAttempts}>Clear saved attempts</Button>
            </div>
          </>
        )}
      </Figure>

      <P>
        {base0.valid
          ? 'Your grid already meets every constraint in the planning year without new projects, so the question is only which projects pay. '
          : `Without new projects your grid doesn’t make it through the planning year. ${base0.problems[0] ?? ''} `}
        The capacity market prices how short of firm capacity the grid is. Its requirement is the hot day’s peak plus the {pct(RESERVE_TARGET)} reserve margin of Lesson 8.1, {mw(ev.capacity.requirement)},
        and the grid can now deliver {mw(ev.capacity.supply)} at that hour. Below about {pct(CAPACITY_PRICE.lowPoint)} of the requirement the price sits at its cap of{' '}
        {usd(CAPACITY_PRICE.priceCap)} per MW-day; at the requirement it is {usd(CAPACITY_PRICE.priceAtTarget)}; above {pct(CAPACITY_PRICE.highPoint)} of it, nothing.
      </P>
      <P>
        That slope is what makes this a puzzle rather than a shopping list. Once the grid nears its requirement, every megawatt of firm capacity you add lowers the
        capacity price paid to every other project, and every plant that runs in the dear hours lowers the energy prices they earn. Projects that look good alone can look poor together. A wind or solar farm earns
        little capacity payment, because it delivers little at an evening peak on a still, hot day, and an upgrade relieves exactly the congestion it’s paid from. The
        cheapest way to meet the constraints is rarely the most profitable, and the most profitable set of projects often breaks one.
      </P>
      <P>
        The line upgrades show a problem real transmission faces. A merchant line earns the price gap across it, and the better it works, the smaller that gap becomes:
        an upgrade that removes a constraint removes its own income. That is why most transmission in North America is built as a regulated asset, paid for through rates
        on the strength of what it saves everyone, rather than on what it could earn in the market. Here we score it like any other project, so you can see the gap.
      </P>

      <Challenge
        id="a"
        question={`Choose a portfolio that keeps the grid reliable on all three days, within the ${dollars(BUDGET)} budget, and earns at least ${dollars(PROFIT_TARGET)} a year.`}
        solved={solved}
        status={pending ? 'Clearing the planning year…' : ev.valid ? `Your portfolio is valid and earns ${dollars(ev.score)} a year.` : `Not yet valid: ${ev.problems[0]}`}
        success={`Solved: ${dollars(ev.score)} a year from ${dollars(ev.capital)} of capital, with the grid secure on every kind of day. Save it to the board, then see whether a different mix does better.`}
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
          The capacity market is paying {usd(ev.capacity.price)} per MW-day, for firm capacity of {mw(ev.capacity.supply)} against a requirement of{' '}
          {mw(ev.capacity.requirement)}.
        </P>
      )}
      <P>
        Real planners do this at a much larger scale. A utility’s integrated resource plan, or a market operator’s transmission study, runs models like this one over
        thousands of hours, many weather years and dozens of futures for fuel prices and demand, and searches far more candidate projects than any person could try by
        hand. The weights matter as much as the models: we’ve said hot days are {pct(SCENARIO_WEIGHT.hot)} of the year, and most of what a peaker earns from energy
        comes on those days. Change the guess, and the best portfolio changes too.
        {bestSaved ? ` Your best saved attempt so far, ${bestSaved.name}, earns ${dollars(bestSaved.score)} a year.` : ' Save a few attempts to compare them on the board.'}
      </P>

      <H2>Your grid</H2>
      <P>
        Here is the grid you built, in the planning year, at the peak of a hot day — the hardest hour it has to face — with the projects you’ve chosen. Nodes are shaded by
        price, as in Lesson 8.3:
      </P>

      <Figure name="Grid Strategy Challenge · your grid" actions={<ResetGridButton />}>
        {d.nodes.length ? (
          <GridMap
            d={d}
            ariaLabel={`Your grid in the planning year at ${hour(hp)} on a hot day. ${priceRange}`}
            nodeInfo={(n) => ({ value: usd(hr.lmp[n] ?? 0), sub: 'per MWh', fill: priceFill(hr.lmp[n] ?? 0) })}
            flows={hr.flows}
            limits={Object.fromEntries(sys.net.lines.map((l) => [l.id, l.limit]))}
            plants={sys.gens}
          />
        ) : (
          <EmptyNote>No grid.</EmptyNote>
        )}
        <Readouts
          items={[
            { label: `hot-day peak, ${hour(hp)}`, value: mw(hotRun.demand[hp]) },
            { label: 'demand shed then', value: mw(Object.values(hr.shed).reduce((a, b) => a + b, 0)), tone: Object.values(hr.shed).some((x) => x > 0.5) ? 'red' : 'green' },
            { label: 'capital you’ve built, home batteries aside', value: dollars(totalCapital) },
          ]}
        />
        <DataTable
          caption="Your grid in the planning year"
          rows={summary}
          rowKey={(r) => r.k}
          columns={[
            { label: 'Your grid', cell: (r) => r.k },
            { label: '', cell: (r) => <span style={{ whiteSpace: 'normal' }}>{r.v}</span>, align: 'left' },
          ]}
        />
        <div className="lg" style={{ paddingTop: 8 }}>
          {FUEL_ORDER.filter((f) => byFuel[f]).map((f) => (
            <span key={f}>
              <Swatch color={FUEL[f]} />
              {FUEL_NAME[f]}
            </span>
          ))}
        </div>
      </Figure>

      <P>
        {ev.chosen.some((c) => c.kind === 'line')
          ? `The upgrade${ev.chosen.filter((c) => c.kind === 'line').length > 1 ? 's' : ''} on ${listNames(ev.chosen.filter((c) => c.kind === 'line').map((c) => lineName(Object.keys(c.addition.upgrades!)[0])))} change how power reaches the load. `
          : ''}
        Look at where the price is highest at this hour, and at which lines are carrying the most. That map is the sum of everything the course has built: the flows follow
        the physics of Chapters 1 and 2, the balance is the one Chapter 3’s operators keep second by second, the prices come from the auctions of Chapter 4 and the
        network of Chapter 5, and the batteries respond to them as the traders of Chapter 6 and the aggregators of Chapter 7 would.
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
