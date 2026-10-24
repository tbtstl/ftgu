import { useDeferredValue, useMemo } from 'react';
import {
  Button,
  Caption,
  Challenge,
  Checkbox,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Slider,
  Swatch,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import type { CompanyFinance, CompanyShip } from '../../../engines/shipping/company';
import {
  NEUTRAL_DRIVERS,
  STRATEGY_KEYS,
  STRATEGY_LABELS,
  runStrategy,
  type StrategyKey,
  type TournamentDrivers,
  type TournamentOptions,
  type TournamentResult,
} from '../../../engines/shipping/tournament';
import { HISTORY_MONTHS, historyWith, standardHistory, type History } from '../../../model/shipping/history';
import { defaultDesign, resetCompany, updateCompany, useCompany } from '../shared/company';
import { XYChart } from '../shared/XYChart';

const $m = (x: number, d = 1) => `${usd(x / 1e6, d)}m`;
const million = (x: number) => `${usd(x / 1e6, 1)} million`;
/** "a profit of $3.2 million" or "a loss of $1.4 million". */
const outcome = (x: number) => (x < 0 ? `a loss of ${million(-x)}` : `a profit of ${million(x)}`);

const COLOR: Record<StrategyKey, { line: string; text: string }> = {
  spot: { line: '#555555', text: TEXT.ink },
  charterOut: { line: GRAPHIC.teal, text: TEXT.teal },
  charterIn: { line: GRAPHIC.orange, text: TEXT.orange },
  reposition: { line: GRAPHIC.violet, text: TEXT.violet },
  hedge: { line: GRAPHIC.blue, text: TEXT.blue },
};

const SHORT: Record<StrategyKey, string> = {
  spot: 'All spot',
  charterOut: 'Charter out',
  charterIn: 'Charter in',
  reposition: 'Reposition',
  hedge: 'Sell FFAs',
};

export interface ViewState {
  firstYear: number;
  lastYear: number;
  /** Share of the fleet's days sold forward, percent. */
  hedge: number;
  extraShips: number;
  world: number;
}

export const VIEW_DEFAULTS: ViewState = { firstYear: 1, lastYear: HISTORY_MONTHS / 12, hedge: 50, extraShips: 2, world: 0 };

export function optionsOf(v: ViewState): TournamentOptions {
  const first = Math.min(v.firstYear, v.lastYear - 1);
  return { from: (first - 1) * 12, to: v.lastYear * 12, hedgeShare: v.hedge / 100, extraShips: v.extraShips };
}

/** All five strategies for a fleet, its financing and the world's dials over a history. */
export function tournament(ships: CompanyShip[], finance: CompanyFinance, drivers: TournamentDrivers, o: TournamentOptions, hist: History = standardHistory()): TournamentResult[] {
  return STRATEGY_KEYS.map((k) => runStrategy(k, ships, finance, hist, drivers, o));
}

/**
 * The challenge: over the whole twelve years, every strategy loses money except chartering out.
 * (A fleet with no owned ships has nothing to charter out, and can't solve it.)
 */
export function onlyCharterOutPays(ships: CompanyShip[], finance: CompanyFinance, drivers: TournamentDrivers, o: TournamentOptions, hist: History = standardHistory()): boolean {
  if (o.from !== 0 || o.to < HISTORY_MONTHS || !ships.some((s) => s.mode === 'owned')) return false;
  const r = tournament(ships, finance, drivers, o, hist);
  const by = Object.fromEntries(r.map((x) => [x.strategy, x.total])) as Record<StrategyKey, number>;
  return by.charterOut > 0 && STRATEGY_KEYS.filter((k) => k !== 'charterOut').every((k) => by[k] < 0);
}

// ---------------------------------------------------------------------------
// The starting company's results, quoted in the prose.

const START = defaultDesign();
const FULL = optionsOf(VIEW_DEFAULTS);

function totals(d: TournamentDrivers): Record<StrategyKey, TournamentResult> {
  return Object.fromEntries(tournament(START.ships, START.finance, d, FULL).map((x) => [x.strategy, x])) as Record<StrategyKey, TournamentResult>;
}

let quoted: ReturnType<typeof buildQuoted> | null = null;
function buildQuoted() {
  const w = worldTotals(START.ships, START.finance, NEUTRAL_DRIVERS, FULL);
  const beatSpot = (k: StrategyKey) => w[k].filter((x, i) => x > w.spot[i]).length;
  return {
    worlds: w,
    beat: { charterOut: beatSpot('charterOut'), charterIn: beatSpot('charterIn'), reposition: beatSpot('reposition'), hedge: beatSpot('hedge') },
    /** Charter-in's worst shortfall against all spot, and its best lead, across the worlds. */
    charterInRange: {
      worst: Math.min(...w.charterIn.map((x, i) => x - w.spot[i])),
      best: Math.max(...w.charterIn.map((x, i) => x - w.spot[i])),
    },
    neutral: totals(NEUTRAL_DRIVERS),
    weakSoy: totals({ ...NEUTRAL_DRIVERS, soy: 0.7 }),
    strongSoy: totals({ ...NEUTRAL_DRIVERS, soy: 1.3 }),
    moreShips: totals({ ...NEUTRAL_DRIVERS, fleet: 1.05 }),
    panama: totals({ ...NEUTRAL_DRIVERS, panama: true }),
    weakOre: totals({ ...NEUTRAL_DRIVERS, ore: 0.7 }),
  };
}
export function quotedResults() {
  return (quoted ??= buildQuoted());
}

// ---------------------------------------------------------------------------
// Other worlds.

export const WORLD_NAMES = ['As it happened', ...Array.from({ length: 8 }, (_, i) => `Draw ${i + 1}`), 'No harvest season', 'Shipyards in a year'];
const WORLD_PHRASE = ['the history as it happened', ...Array.from({ length: 8 }, (_, i) => `draw ${i + 1}`), 'the world with no harvest season', 'the world whose shipyards deliver in a year'];

let worldCache: History[] | null = null;
export function worlds(): History[] {
  return (worldCache ??= [
    standardHistory(),
    ...Array.from({ length: 8 }, (_, i) => historyWith({ seed: i + 1 })),
    historyWith({ seasonal: false }),
    historyWith({ lag: 12 }),
  ]);
}

/** Each strategy's total in each world. */
export function worldTotals(ships: CompanyShip[], finance: CompanyFinance, drivers: TournamentDrivers, o: TournamentOptions): Record<StrategyKey, number[]> {
  const out = Object.fromEntries(STRATEGY_KEYS.map((k) => [k, [] as number[]])) as Record<StrategyKey, number[]>;
  for (const w of worlds()) for (const r of tournament(ships, finance, drivers, o, w)) out[r.strategy].push(r.total);
  return out;
}

export default function Lesson() {
  const company = useCompany();
  const view = useScenario('tournament', VIEW_DEFAULTS);
  const v = view.state;
  const o = optionsOf(v);
  const d = company.drivers;
  const ships = company.ships;
  const setDriver = (patch: Partial<TournamentDrivers>) => updateCompany((c) => ({ ...c, drivers: { ...c.drivers, ...patch } }));
  const scenario = {
    ...view,
    reset: () => {
      view.reset();
      resetCompany('drivers');
    },
  };

  const results = useMemo(() => tournament(ships, company.finance, d, o), [ships, company.finance, d, o.from, o.to, o.hedgeShare, o.extraShips]);
  const by = Object.fromEntries(results.map((r) => [r.strategy, r])) as Record<StrategyKey, TournamentResult>;
  const ranked = [...results].sort((a, b) => b.total - a.total);
  const solved = onlyCharterOutPays(ships, company.finance, d, o);
  const ownsAny = ships.some((s) => s.mode === 'owned');
  const fullWindow = o.from === 0 && o.to >= HISTORY_MONTHS;
  const q = useMemo(() => quotedResults(), []);

  const series = results.map((r) => {
    let acc = 0;
    return {
      xs: [o.from / 12, ...r.monthly.map((_, i) => (o.from + i + 1) / 12)],
      ys: [0, ...r.monthly.map((x) => (acc += x) / 1e6)],
      color: COLOR[r.strategy].line,
      width: r.strategy === 'spot' ? 2.5 : 2,
    };
  });

  // Other worlds, computed off the critical path.
  const key = JSON.stringify([ships, company.finance, d, o]);
  const deferredKey = useDeferredValue(key);
  const many = useMemo(() => {
    const [s, f, dd, oo] = JSON.parse(deferredKey) as [CompanyShip[], CompanyFinance, TournamentDrivers, TournamentOptions];
    return worldTotals(s, f, dd, oo);
  }, [deferredKey]);
  const beats = (k: StrategyKey) => many[k].filter((x, i) => x > many.spot[i]).length;
  const nWorlds = WORLD_NAMES.length;
  const all = STRATEGY_KEYS.flatMap((k) => many[k]);
  const [lo, hi] = niceDomain(Math.min(0, ...all) / 1e6, Math.max(0, ...all) / 1e6, 5);
  const SX0 = 120;
  const SX1 = 620;
  const sx = scale(lo, hi, SX0, SX1);
  const rowY = (i: number) => 34 + i * 34;
  const hl = Math.min(nWorlds - 1, Math.max(0, v.world));

  const fleetText = ships.map((s) => `${s.name} (${s.cls === 'kmax' ? 'Kamsarmax' : 'Capesize'}, ${s.mode})`).join(', ');
  const n = q.neutral;

  return (
    <LessonPage id="shipping/6.5">
      <P>
        Northwind Bulk now has everything a shipping company has. A fleet, bought and financed in <a href={lessonHref('shipping/6.1')}>Lesson 6.1</a>; trades and the
        cargoes its brokers bring it, in <a href={lessonHref('shipping/6.2')}>6.2</a>; an operations desk that turns cargoes into voyages, in{' '}
        <a href={lessonHref('shipping/6.3')}>6.3</a>; and a view of where the market is going, in <a href={lessonHref('shipping/6.4')}>6.4</a>. One decision is
        left, and it decides more of the company’s result than any voyage: the commercial strategy it runs the fleet under. The question for this last lesson is
        which strategy earns the most for the risk it takes, and which physical facts each one depends on — because a strategy that wins for no reason you can
        name is a strategy that won by luck.
      </P>
      <P>
        Five strategies enter the tournament, each one already taught. <K tone="gray">All spot</K> trades every ship on the spot market, month after month, and
        takes whatever the market pays (<a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>). <K tone="teal">Charter out for a year</K> hires each owned ship out in
        twelve-month blocks at the period hire on offer, which in our market is what the fundamentals forecast for the coming year (
        <a href={lessonHref('shipping/5.1')}>5.1</a>, <a href={lessonHref('shipping/5.3')}>5.3</a>). <K tone="orange">Charter in when hire is cheap</K> adds
        Kamsarmaxes on one-year charters whenever the period hire is below what a new ship needs to earn (<a href={lessonHref('shipping/2.5')}>2.5</a>).{' '}
        <K tone="violet">Reposition for the harvest</K> sends the Kamsarmaxes to Brazil each February when the plan of <a href={lessonHref('shipping/5.4')}>Lesson
        5.4</a> expects it to pay. <K tone="blue">Sell FFAs against the fleet</K> sells next month’s index forward for a share of the fleet’s days (
        <a href={lessonHref('shipping/4.5')}>4.5</a>). Every strategy pays the same operating costs and loan installments, from the fleet you built.
      </P>
      <P>
        In the next demonstration, the five run side by side through the twelve simulated years. The lines are each strategy’s running profit, and the table
        ranks them. Beside them are the world’s physical dials — Brazil’s harvest and its iron ore, the Panama Canal, the queue at Qingdao and how many ships the
        yards deliver. The dials are part of your company’s record, so the next time you open this lesson the world will be as you left it. Turn them:
      </P>

      <Figure
        name="Shipping Strategy Tournament"
        scenario={scenario}
        actions={
          <Button onClick={() => resetCompany('drivers')}>World as it happened</Button>
        }
      >
        <Legend items={STRATEGY_KEYS.map((k) => ({ label: STRATEGY_LABELS[k], color: COLOR[k].line, kind: 'line' as const }))} />
        <XYChart
          ariaLabel={`Running profit of five strategies for your fleet from Year ${Math.floor(o.from / 12) + 1} to Year ${o.to / 12}. ${ranked.map((r) => `${STRATEGY_LABELS[r.strategy]}: ${$m(r.total)}`).join('; ')}.`}
          series={series}
          xMin={0}
          xMax={HISTORY_MONTHS / 12}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(x) => (x === 0 ? 'Year 1' : x === 12 ? 'end' : `Year ${x + 1}`)}
          yFormat={(y) => `$${fmt(y)}m`.replace('$−', '−$')}
          yLabel="Running profit, $ million"
          height={230}
          refLines={[{ y: 0, color: '#9a9a9a', dash: '2 3' }]}
        />
        <DataTable
          caption="The strategies ranked by total profit, with their worst twelve months, deepest drawdown and Sharpe ratio"
          rows={ranked}
          rowKey={(r) => r.strategy}
          columns={[
            {
              label: 'Strategy',
              cell: (r) => (
                <span>
                  <Swatch color={COLOR[r.strategy].line} />
                  {STRATEGY_LABELS[r.strategy]}
                </span>
              ),
            },
            { label: 'Total', cell: (r) => $m(r.total), align: 'right' },
            { label: 'Worst 12 months', cell: (r) => $m(r.worstYear), align: 'right' },
            { label: 'Deepest drawdown', cell: (r) => $m(r.maxDrawdown), align: 'right' },
            { label: 'Sharpe', cell: (r) => fmt(r.summary.sharpe, 2), align: 'right' },
          ]}
        />
        <Slider label="Brazil’s soybean harvest" tone="orange" value={d.soy} min={0.5} max={1.5} step={0.05} onChange={(x) => setDriver({ soy: x })} display={`${fmt(d.soy * 100)}% of normal`} />
        <Slider label="Brazil’s iron-ore exports" tone="orange" value={d.ore} min={0.5} max={1.5} step={0.05} onChange={(x) => setDriver({ ore: x })} display={`${fmt(d.ore * 100)}% of normal`} />
        <Slider label="Extra waiting at Qingdao" tone="teal" value={d.congestion} min={0} max={6} step={0.5} onChange={(x) => setDriver({ congestion: x })} display={`${fmt(d.congestion, 1)} days a call`} />
        <Slider
          label="Ships the yards deliver"
          tone="blue"
          value={d.fleet}
          min={0.95}
          max={1.1}
          step={0.01}
          onChange={(x) => setDriver({ fleet: Math.round(x * 100) / 100 })}
          display={d.fleet === 1 ? 'as it happened' : `${d.fleet > 1 ? '+' : '−'}${fmt(Math.abs(d.fleet - 1) * 100)}% ships`}
        />
        <Checkbox label="Panama Canal closed to the grain trade" checked={d.panama} onChange={(x) => setDriver({ panama: x })} />
        <Slider label="FFAs sold, share of the fleet’s days" tone="blue" value={v.hedge} min={0} max={100} step={10} onChange={(x) => view.set({ hedge: x })} display={`${v.hedge}%`} />
        <Slider label="Kamsarmaxes chartered in when cheap" tone="orange" value={v.extraShips} min={0} max={4} onChange={(x) => view.set({ extraShips: x })} display={`${v.extraShips}`} />
        <Slider label="First year" value={v.firstYear} min={1} max={11} onChange={(x) => view.set({ firstYear: x, lastYear: Math.max(v.lastYear, x + 1) })} display={`Year ${v.firstYear}`} />
        <Slider label="Last year" value={v.lastYear} min={2} max={12} onChange={(x) => view.set({ lastYear: x, firstYear: Math.min(v.firstYear, x - 1) })} display={`Year ${v.lastYear}`} />
        <Caption>
          Your fleet: {fleetText}. {ranked[0] ? `${STRATEGY_LABELS[ranked[0].strategy]} leads, at ${$m(ranked[0].total)}; ` : ''}
          {STRATEGY_LABELS[ranked[ranked.length - 1].strategy].replace(/^./, (c) => c.toLowerCase())} trails, at {$m(ranked[ranked.length - 1].total)}. All money is simulated.
        </Caption>
      </Figure>

      <P>
        Start with the dials as the history happened and the company you began Chapter 6 with, Kestrel and Albatross. Over the twelve years, all spot makes{' '}
        {million(n.spot.total)}, but its worst twelve months lose {million(-n.spot.worstYear)} and at its deepest it stands {million(n.spot.maxDrawdown)} below its
        best. That is the cycle of <a href={lessonHref('shipping/4.4')}>Lesson 4.4</a>, passed straight through to the company. Chartering out makes less,{' '}
        {million(n.charterOut.total)}, but its worst year loses only {million(-n.charterOut.worstYear)} and its drawdown is {million(n.charterOut.maxDrawdown)}: a
        steadier income, bought by giving up the booms. Chartering in when hire is cheap makes the most, {million(n.charterIn.total)}, with the deepest drawdown,{' '}
        {million(n.charterIn.maxDrawdown)}. Repositioning makes {million(n.reposition.total)}, and selling FFAs {million(n.hedge.total)}, with a drawdown a little
        shallower than spot’s, {million(n.hedge.maxDrawdown)}. If you built a different fleet in Lesson 6.1, the demonstration is running yours, and its numbers
        will differ from these.
      </P>

      <H2>Break each one</H2>
      <P>
        Now take each winner’s physical reason away. Repositioning earns its extra by sending Kamsarmaxes to meet Brazil’s soybean harvest
        (<a href={lessonHref('shipping/3.5')}>3.5</a>), paid for by a freight that already prices the ballast leg (<a href={lessonHref('shipping/3.4')}>3.4</a>).
        Weaken the harvest to 70% of normal and the plan never expects a gain, so the strategy does nothing different: it ends exactly where all spot ends, with{' '}
        {outcome(q.weakSoy.reposition.total)}. Chartering in when hire is cheap is a bet that cheap periods end — that the fleet won’t keep growing. Let the yards
        deliver 5% more ships and the bet fails: it loses {million(-q.moreShips.charterIn.total)} while all spot loses {million(-q.moreShips.spot.total)}. The same
        5% leaves repositioning ahead, at {million(q.moreShips.reposition.total)}, because the harvest is still there.
      </P>
      <P>
        Other dials move everyone who trades spot. Close the Panama Canal to the grain trade and Kamsarmax voyages from the US Gulf grow by thousands of miles (
        <a href={lessonHref('shipping/3.3')}>3.3</a>); all spot rises to {million(q.panama.spot.total)}. Cut Brazil’s iron ore to 70% and the Capesize market falls
        toward its floor: all spot loses {million(-q.weakOre.spot.total)}. Through all of it, chartering out makes the same {million(n.charterOut.total)}, because its
        hires were fixed by what the market expected before any of it happened. That is its whole character: with a 30% stronger harvest, all spot makes{' '}
        {million(q.strongSoy.spot.total)} and chartering out still makes {million(q.strongSoy.charterOut.total)}.
      </P>

      <Challenge
        id="a"
        figure="Shipping Strategy Tournament"
        question="With the window covering all twelve years, set the world’s dials so that every strategy except chartering out loses money."
        solved={solved}
        status={
          !ownsAny
            ? 'Your fleet owns no ships, so there is nothing to charter out: go back to Lesson 6.1 and buy one.'
            : !fullWindow
              ? 'Set the window to cover Year 1 to Year 12 first.'
              : `Right now: ${ranked.map((r) => `${SHORT[r.strategy]} ${$m(r.total)}`).join(', ')}.`
        }
        success={`Solved. Chartering out still makes ${$m(by.charterOut.total)} while every strategy that keeps a foot in the spot market loses${v.hedge < 100 ? ' — the FFA seller too, since it sells only part of the fleet’s days' : ''}. Owners charter out to be indifferent to exactly these dials: a weak trade, a glut of ships. The price is that they are indifferent to the good dials as well.`}
      />

      <H2>Luck or skill</H2>
      <P>
        One history is one draw. The cycle model of <a href={lessonHref('shipping/4.4')}>Lesson 4.4</a> could have produced others from the same world, and{' '}
        <a href={lessonHref('shipping/5.5')}>Lesson 5.5</a> showed what a backtest on a single history can hide. In the next demonstration, every strategy runs, with
        your fleet and your dials, in {WORLD_NAMES.length} worlds: the history as it happened, eight other draws of demand shocks and fuel prices, a world with no
        harvest season, and a world whose shipyards deliver in a year instead of thirty months. Each dot is one strategy’s twelve-year profit in one world; slide
        along the worlds to follow one of them across the strategies:
      </P>

      <Figure name="Shipping Strategy Tournament · other worlds" scenario={scenario}>
        <svg
          className="chart"
          viewBox={`0 0 640 ${rowY(STRATEGY_KEYS.length) + 12}`}
          role="img"
          aria-label={`Twelve-year profit of each strategy in ${nWorlds} worlds. ${STRATEGY_KEYS.filter((k) => k !== 'spot')
            .map((k) => `${STRATEGY_LABELS[k]} beats all spot in ${beats(k)} of ${nWorlds}`)
            .join('; ')}. Highlighted: ${WORLD_NAMES[hl]}.`}
        >
          <text className="ax" x={SX0} y={12}>
            Twelve-year profit, $ million
          </text>
          {niceTicks(lo, hi, 5).map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'base' : 'gl'} x1={sx(t)} x2={sx(t)} y1={20} y2={rowY(STRATEGY_KEYS.length) - 14} />
              <text className="ax ax-m" x={sx(t)} y={rowY(STRATEGY_KEYS.length) + 4}>
                {fmt(t)}
              </text>
            </g>
          ))}
          <polyline
            points={STRATEGY_KEYS.map((k, i) => `${sx(many[k][hl] / 1e6).toFixed(1)},${rowY(i)}`).join(' ')}
            fill="none"
            stroke="#333"
            strokeWidth={1.2}
            strokeDasharray="3 3"
          />
          {STRATEGY_KEYS.map((k, i) => (
            <g key={k}>
              <text x={SX0 - 10} y={rowY(i) + 4} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: COLOR[k].text }}>
                {SHORT[k]}
              </text>
              <line className="gl" x1={SX0} x2={SX1} y1={rowY(i)} y2={rowY(i)} />
              {many[k].map((x, w) => (
                <circle key={w} cx={sx(x / 1e6)} cy={rowY(i)} r={w === hl ? 7 : 4.5} fill={COLOR[k].line} opacity={w === hl ? 1 : 0.55} stroke={w === hl ? '#111' : 'none'} strokeWidth={1.5} />
              ))}
            </g>
          ))}
        </svg>
        <Readouts
          items={STRATEGY_KEYS.filter((k) => k !== 'spot').map((k) => ({
            label: `${SHORT[k].toLowerCase()} beats all spot`,
            value: `${beats(k)} of ${nWorlds} worlds`,
          }))}
        />
        <Slider label="Follow one world" value={hl} min={0} max={nWorlds - 1} onChange={(x) => view.set({ world: x })} display={WORLD_NAMES[hl]} />
        <Caption>
          In {WORLD_PHRASE[hl]}: {STRATEGY_KEYS.map((k) => `${SHORT[k].toLowerCase()} ${$m(many[k][hl])}`).join(', ')}.
        </Caption>
      </Figure>

      <P>
        With the starting company and the dials as it happened, selling FFAs beats all spot in {q.beat.hedge} of the {WORLD_NAMES.length} worlds, by a little: it
        trims bad months and good ones alike, and our model’s forward curve, as <a href={lessonHref('shipping/5.5')}>Lesson 5.5</a> found, expects slumps to end
        sooner than they do, so selling it pays slightly on top. Repositioning beats all spot in {q.beat.reposition} — every world but the one with no harvest season,
        where there is nothing in Brazil to reposition for and the strategy, correctly, sits still. Chartering in beats all spot in {q.beat.charterIn}, leading by as
        much as {million(q.charterInRange.best)} when the recovery comes and trailing by up to {million(-q.charterInRange.worst)} when it doesn’t: a leveraged bet on
        recovery. Chartering out beats all spot in {q.beat.charterOut}. Look at the world where shipyards deliver in a year:
        booms are cut short by ships ordered during them, earnings average far less than in the history, and at the prices Northwind paid for its ships every
        strategy loses. No commercial strategy rescues a company that bought its fleet for a world that didn’t happen.
      </P>

      <H2>What the course has built</H2>
      <P>
        Every number in this tournament rests on something physical. The ships carry what their hulls displace at a draft the load lines allow (
        <a href={lessonHref('shipping/1.1')}>1.1</a>); they burn fuel roughly with the cube of their speed, so the market’s earnings decide how fast they sail (
        <a href={lessonHref('shipping/1.3')}>1.3</a>, <a href={lessonHref('shipping/2.3')}>2.3</a>); they wait in queues at ports and canals (
        <a href={lessonHref('shipping/3.2')}>3.2</a>, <a href={lessonHref('shipping/3.3')}>3.3</a>); they finish voyages where cargo is unloaded, not where it is
        loaded, and must sail empty back (<a href={lessonHref('shipping/3.4')}>3.4</a>); and the world needs as many of them as its tonne-miles and ballast miles
        demand (<a href={lessonHref('shipping/3.5')}>3.5</a>). The freight rate is the price at which that mobile, slow-moving capacity matches the cargo, ship by
        ship and route by route (<a href={lessonHref('shipping/4.1')}>4.1</a>), and its long waves come from shipyards that take years to answer it (
        <a href={lessonHref('shipping/4.4')}>4.4</a>).
      </P>
      <P>
        That is the capability this course set out to build: to derive an expectation for freight rates from global trade, the positions of ships, the routes
        between them and how fully the fleet is used — and then to judge a chartering decision or a freight trade by asking which of those physical facts it relies
        on, and what happens to it when that fact changes. The model here is simpler than the real market, and its prices are simulated, but the questions carry
        over. Before trusting a strategy, find the dial in{' '}
        <FigRef to="Shipping Strategy Tournament">the tournament</FigRef> that would break it, and ask how likely the world is to turn it.
      </P>
    </LessonPage>
  );
}
