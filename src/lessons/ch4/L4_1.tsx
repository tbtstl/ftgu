import { useMemo } from 'react';
import {
  Button,
  Caption,
  Challenge,
  FUEL,
  Figure,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  SupplyStackChart,
  TEXT,
  areaPath,
  hour,
  lessonHref,
  linePath,
  mw,
  pct,
  scale,
  usd,
  useScenario,
  type StackBlock,
} from '../../framework';
import { STANDARD_FLEET } from '../../model/fleet';
import { SOLAR_CF, SYSTEM_DEMAND, WIND_CF } from '../../model/profiles';
import { comparePlannerMarket, estimateNoise, plannerErrorSweep, plannerEstimates, type PlannerPlant } from '../../engines/market/planner';

const IDS = STANDARD_FLEET.map((g) => g.id);
const NAME: Record<string, string> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, g.name]));
const COLOR: Record<string, string> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, FUEL[g.fuel]]));
const CAP: Record<string, number> = Object.fromEntries(STANDARD_FLEET.map((g) => [g.id, g.capacity]));

/** The fleet in one hour of the reference day: wind and solar offer what the weather allows. */
function plantsAt(h: number): PlannerPlant[] {
  return STANDARD_FLEET.map((g) => ({
    id: g.id,
    mw: g.fuel === 'wind' ? WIND_CF[h] * g.capacity : g.fuel === 'solar' ? SOLAR_CF[h] * g.capacity : g.capacity,
    cost: g.marginalCost,
  }));
}

const DAY = Array.from({ length: 24 }, (_, h) => ({ plants: plantsAt(h), demand: SYSTEM_DEMAND[h] }));
const ERRORS = Array.from({ length: 21 }, (_, i) => i * 0.02);
const X_MAX = 2250;

// The whole-day sweep takes a few tens of milliseconds, so it runs once per page load.
let sweepCache: ReturnType<typeof plannerErrorSweep> | null = null;
function daySweep() {
  if (!sweepCache) sweepCache = plannerErrorSweep(DAY, ERRORS, 200);
  return sweepCache;
}
const MARKET_DAY = DAY.reduce((s, d) => s + comparePlannerMarket(d.plants, {}, d.demand).marketCost, 0);

export default function Lesson() {
  const s1 = useScenario('planner', { hour: 14, error: 15, seed: 3, view: 'planner' as 'planner' | 'market' });
  const s2 = useScenario('whole-day', { error: 16 });
  const { hour: h, error, seed, view } = s1.state;

  const plants = plantsAt(h);
  const demand = SYSTEM_DEMAND[h];
  const noise = useMemo(() => estimateNoise(IDS, seed), [seed]);
  const est = plannerEstimates(plants, error / 100, noise);
  const cmp = comparePlannerMarket(plants, est, demand);
  const shown = view === 'planner' ? cmp.planner : cmp.market;

  const blocks: StackBlock[] = shown.stack.map((st) => {
    const p = plants.find((x) => x.id === st.id)!;
    return {
      id: st.id,
      start: st.start,
      mw: p.mw,
      price: view === 'planner' ? est[p.id] : p.cost,
      dispatched: shown.dispatch[p.id] ?? 0,
      color: COLOR[p.id],
      highlight: cmp.changed.includes(p.id),
      costMark: view === 'planner' ? p.cost : undefined,
    };
  });

  // A live sentence about what the planner gets wrong.
  const more = cmp.changed.filter((id) => (cmp.planner.dispatch[id] ?? 0) > (cmp.market.dispatch[id] ?? 0));
  const less = cmp.changed.filter((id) => (cmp.planner.dispatch[id] ?? 0) < (cmp.market.dispatch[id] ?? 0));
  const names = (ids: string[]) => ids.map((id) => NAME[id]).join(' and ');
  let msg: string;
  if (cmp.extra > 0.5) {
    msg = `The planner runs more of ${names(more)} and less of ${names(less)} than the market would, and pays for every megawatt-hour at true costs.`;
  } else if (cmp.misranked.length > 0) {
    const [a, b] = cmp.misranked[0];
    msg = `The planner has ${NAME[a]} and ${NAME[b]} in the wrong order, but at ${hour(h)} that doesn’t change which plants run, so the mistake costs nothing.`;
  } else {
    msg = 'With these estimates the planner ranks every plant in the right order, so its dispatch is exactly the market’s.';
  }

  // Challenge: a wrong order that costs nothing.
  const solved = cmp.misranked.length > 0 && cmp.extra < 0.5;
  const pair = cmp.misranked[0];
  const sameSide = pair
    ? (() => {
        const qa = cmp.market.dispatch[pair[0]] ?? 0;
        const qb = cmp.market.dispatch[pair[1]] ?? 0;
        const full = (id: string, q: number) => q >= (plants.find((p) => p.id === id)?.mw ?? CAP[id]) - 1e-6;
        if (full(pair[0], qa) && full(pair[1], qb)) return 'both running flat out';
        if (qa <= 1e-6 && qb <= 1e-6) return 'both switched off';
        return 'on the same side of the margin';
      })()
    : '';

  // Second figure: the whole reference day, many sets of estimates.
  const sweep = useMemo(daySweep, []);
  const marketDay = MARKET_DAY;
  const e2 = s2.state.error;
  const pt = sweep.find((p) => Math.abs(p.error * 100 - e2) < 1e-6) ?? sweep[0];
  const x = scale(0, 40, 60, 600);
  const yTop = 35;
  const y = scale(0, yTop, 220, 30);
  const band = areaPath(
    sweep.map((p) => x(p.error * 100)),
    sweep.map((p) => y(Math.min(yTop, p.p90 * 100))),
    sweep.map((p) => y(Math.min(yTop, p.p10 * 100))),
  );
  const meanLine = linePath(
    sweep.map((p) => x(p.error * 100)),
    sweep.map((p) => y(Math.min(yTop, p.mean * 100))),
  );

  return (
    <LessonPage id="4.1">
      <P>
        In Chapter 3 we ran the region’s grid: matching supply to demand from second to second, holding frequency steady, and calling on batteries and flexible customers
        when things got tight. Underneath all of that sat a decision we took for granted. Every hour, someone has to choose which of the nine plants run and how hard. Get
        it wrong and the lights still stay on, but the region pays more than it needs to for every megawatt-hour.
      </P>
      <P>
        The goal is easy to state: meet demand at the lowest total cost. If we knew every plant’s running cost, we’d switch on the cheapest first and work our way up the
        merit order. The difficulty is the “if.” A plant’s cost depends on what it pays for fuel this week, how efficiently its turbines are
        running after the last overhaul, what its contracts say, and a hundred other details. The people who know those details best are the plant’s owners, not whoever
        is doing the scheduling.
      </P>
      <P>
        There are two broad ways to organize the decision. A <b>central planner</b> collects the best estimates it can of each plant’s cost and dispatches on those. A{' '}
        <b>market</b> asks each owner to state the price at which it’s willing to run — its <K c="price">offer</K> — and accepts the cheapest offers. In the next demonstration, both schedule the region on
        the reference day. The planner’s estimates are off by random amounts, and you set their <b>typical error</b>: one standard deviation, so about two-thirds of
        the estimates land within that percentage of the true cost and the rest further out. Each press of New estimates draws a fresh set of errors; the owners offer
        their true costs. Drag through the hours and change the size of the planner’s errors:
      </P>

      <Figure
        name="Central Planner vs. Market"
        scenario={s1}
        actions={
          <Button onClick={() => s1.set({ seed: seed + 1 })} label="Draw a new set of planner estimates">
            New estimates
          </Button>
        }
      >
        <Segmented
          label="Whose ranking to show"
          value={view}
          onChange={(v) => s1.set({ view: v })}
          options={[
            { value: 'planner', label: 'The planner’s ranking' },
            { value: 'market', label: 'The market’s ranking' },
          ]}
        />
        <SupplyStackChart
          ariaLabel={`${view === 'planner' ? 'The planner’s' : 'The market’s'} ranking of nine plants at ${hour(h)}, with ${mw(demand)} of demand. The planner’s dispatch costs ${usd(cmp.plannerCost)} per hour against the market’s ${usd(cmp.marketCost)}.`}
          blocks={blocks}
          demand={demand}
          price={view === 'market' ? cmp.market.price : undefined}
          xMax={X_MAX}
          yMax={200}
        />
        {view === 'planner' && <Legend items={[{ label: 'Block height: the planner’s estimate · dashed line: the true cost', color: '#222', kind: 'line', dashed: true }]} />}
        <Slider label="Hour of the reference day" value={h} min={0} max={23} onChange={(v) => s1.set({ hour: v })} display={`${hour(h)} · ${mw(demand)}`} />
        <Slider label="Typical error in the planner’s estimates" value={error} min={0} max={40} onChange={(v) => s1.set({ error: v })} display={`±${error}%`} />
        <Readouts
          items={[
            { label: 'market’s dispatch, true cost per hour', value: usd(cmp.marketCost), tone: 'green' },
            { label: 'extra cost of the planner’s mistakes', value: usd(cmp.extra), tone: 'green' },
          ]}
        />
        <Caption>{msg}</Caption>
      </Figure>

      <P>
        Both sides follow exactly the same rule — cheapest first — and both meet demand. The only difference is the numbers they rank. At the starting settings, the planner
        believes Lakeside combined-cycle costs $24.80 per megawatt-hour and Ironwood coal $26.19, when in truth Lakeside costs $36 and Ironwood $28. So through the
        afternoon it runs Lakeside where it should run Ironwood, and every one of those megawatt-hours costs $8 more than it needed to. Switch between the two rankings to
        watch the stack re-sort; outlined blocks are the plants the two schedules run differently.
      </P>
      <P>
        Now drag through the day. At some hours, the very same wrong estimates cost nothing at all. Errors that rearrange plants on the same side of the demand line —
        plants that run flat out either way, or that aren’t needed either way — change nothing that happens. A mistake only costs money when it moves a plant across
        the <b>margin</b>, the point where the stack meets demand.
      </P>
      <P>
        The plant sitting at the margin, the last one needed to meet demand, is the <b>marginal plant</b>. In the market’s ranking, the horizontal line running across
        to the demand line is drawn at its offer. That offer is the <K c="price">clearing price</K>: since the marginal plant normally has room to run a little
        harder, it’s also what serving one more megawatt-hour of demand would cost. In most electricity markets, every plant that runs is paid it, and <a href={lessonHref('4.4')}>Lesson 4.4</a> shows why.
      </P>

      <Challenge
        id="a"
        question="Find an hour of the reference day when the planner has plants in the wrong order, yet its dispatch costs no more than the market’s."
        solved={solved}
        status={
          cmp.misranked.length === 0
            ? 'Right now the planner ranks every plant correctly. Raise the error, or draw new estimates.'
            : `At ${hour(h)}, the planner has ${cmp.misranked.length === 1 ? 'one pair' : `${cmp.misranked.length} pairs`} of plants in the wrong order, and its mistakes cost ${usd(cmp.extra)} an hour.`
        }
        success={
          pair
            ? `Solved. At ${hour(h)}, ${NAME[pair[0]]} and ${NAME[pair[1]]} are ${sameSide}, so the order the planner puts them in doesn’t change what runs.`
            : 'Solved.'
        }
      />

      <H2>A whole day of guesses</H2>
      <P>
        One set of estimates is one roll of the dice. To see what errors of a given size cost on average, the next figure schedules the whole reference day with 200
        different sets of planner estimates and compares each with the market’s schedule, which costs $372,718 at true costs. The line is the average extra cost, as a
        share of that; the shaded band spans the luckiest tenth to the unluckiest tenth of the planners:
      </P>

      <Figure name="Central Planner vs. Market · a whole day" scenario={s2}>
        <svg
          className="chart"
          viewBox="0 0 620 262"
          role="img"
          aria-label={`Average extra cost of the planner’s dispatch over the reference day as its estimation error grows. At ±${e2}%, the average is ${pct(pt.mean, 1)} of the day’s cost.`}
        >
          <text className="ax" x={60} y={16}>
            Extra cost of the planner’s day, % of the market’s
          </text>
          <GridY y={y} ticks={[0, 10, 20, 30]} x0={60} x1={600} format={(v) => v + '%'} baseline={0} />
          <path d={band} fill={TEXT.green} opacity={0.14} />
          <path d={meanLine} fill="none" stroke={TEXT.green} strokeWidth={3} strokeLinejoin="round" />
          {[0, 10, 20, 30, 40].map((v) => (
            <text key={v} className="ax ax-m" x={x(v)} y={240}>
              ±{v}%
            </text>
          ))}
          <text className="ax ax-e" x={600} y={258}>
            Typical error in the planner’s estimates
          </text>
          <line className="cur" x1={x(e2)} x2={x(e2)} y1={30} y2={220} />
          <circle cx={x(e2)} cy={y(Math.min(yTop, pt.mean * 100))} r={6} fill={TEXT.green} stroke="#f8f8f8" strokeWidth={2} />
        </svg>
        <Legend
          items={[
            { label: 'Average over 200 sets of estimates', color: TEXT.green, kind: 'line' },
            { label: 'Middle 80% of planners', color: 'rgba(63, 122, 30, 0.25)' },
          ]}
        />
        <Slider label="Typical error in the planner’s estimates" value={e2} min={0} max={40} step={2} onChange={(v) => s2.set({ error: v })} display={`±${e2}%`} />
        <Readouts
          items={[
            { label: 'average extra cost per day', value: usd(pt.mean * marketDay), tone: 'green' },
            { label: 'average per year, if every day were like the reference day', value: usd(pt.mean * marketDay * 365), tone: 'green' },
            { label: 'planners with a perfect day', value: pct(pt.perfect) },
          ]}
        />
      </Figure>

      <P>
        While the errors stay smaller than the gaps between plants’ costs, the planner rarely gets anything wrong: at ±4% not one of the 200 planners makes a costly
        mistake. The closest pair in the fleet, Lakeside at $36 and Mill Creek combined-cycle at $42, are about 15% apart. Once typical errors approach that size, plants
        start trading places at the margin and the cost climbs steeply — at ±10% the average planner wastes 0.8% of the day’s cost, at ±20% about 3.7%. Small
        percentages, but a region like ours spends well over $100 million a year on running costs, and real fleets have hundreds of plants whose costs are much closer
        together than these nine.
      </P>

      <H2>Where the numbers come from</H2>
      <P>
        For most of the twentieth century, the planner was the only option on offer. Electricity came from <b>vertically integrated</b> utilities — state-owned in much of
        the world, privately owned but regulated in the United States — that owned the power plants, the transmission lines and the local wires in their territory. The
        utility dispatched its own plants on its own engineers’ estimates, and a regulator set its prices to cover its costs plus a return on its investment. That
        arrangement also blunted the incentive to keep costs down, since lower costs mostly meant lower regulated prices.
      </P>
      <P>
        Starting with Chile in the early 1980s and England and Wales in 1990, and from the late 1990s in parts of the United States, governments restructured the
        industry. Generation was opened to competition, and <b>independent system operators</b> — ISOs, called regional transmission organizations (RTOs) in some
        regions — took over running the grid and its markets without owning any power plants. Much of the United States is now served by one, while most of the
        Southeast and much of the West still run on the vertically integrated model.
      </P>
      <P>
        Notice what restructuring didn’t remove. An ISO still runs a central optimization every few minutes, much like the planner’s. What changed is where the numbers
        come from: the operator ranks offers submitted by owners who know their own costs and have a reason to keep them low, instead of estimates it has to make itself.
        Whether owners have a reason to offer their <i>true</i> costs depends on how the market pays them, which is the subject of{' '}
        <a href={lessonHref('4.4')}>Lesson 4.4</a>. Even under the best rules, an owner whose plant sets the price can sometimes profit by offering above its cost — that’s
        market power — so every ISO also has a market monitor watching for it.
      </P>
      <P>
        A market also has more players than a planner’s spreadsheet. Before we look at how offers are built, the{' '}
        <a href={lessonHref('4.2')}>next lesson</a> meets everyone who takes part: who decides what, who pays whom, and who carries which risk.
      </P>
    </LessonPage>
  );
}
