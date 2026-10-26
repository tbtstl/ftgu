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
import { STARTING, START_MONTH, confirmReset, money, partChanged, resetCompany, updateCompany, useCompany, when, type CompanyDesign } from '../shared/company';
import { CompanySoFar, ViewSwitch, fleetText, type CompanyView } from '../shared/CompanyUi';
import { XYChart } from '../shared/XYChart';

/** Years of the history left after Northwind starts trading. */
const YEARS_LEFT = (HISTORY_MONTHS - START_MONTH) / 12;
/** "a profit of $3.21m" or "a loss of $1.44m". */
const outcome = (x: number) => (x < 0 ? `a loss of ${money(-x)}` : `a profit of ${money(x)}`);

const COLOR: Record<StrategyKey, { line: string; text: string }> = {
  spot: { line: '#555555', text: TEXT.ink },
  charterOut: { line: GRAPHIC.teal, text: TEXT.teal },
  charterIn: { line: GRAPHIC.orange, text: TEXT.orange },
  reposition: { line: GRAPHIC.violet, text: TEXT.violet },
  hedge: { line: GRAPHIC.blue, text: TEXT.blue },
};

/** "Sell FFAs" → "sell FFAs". */
const lowerFirst = (x: string) => x.replace(/^./, (c) => c.toLowerCase());

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
  /** Run the starting company's fleet (which the text describes) or the reader's. */
  company: CompanyView;
}

export const VIEW_DEFAULTS: ViewState = { firstYear: 1, lastYear: HISTORY_MONTHS / 12, hedge: 50, extraShips: 2, world: 0, company: 'start' };

/** The fleet and financing a view runs. */
export function fleetFor(d: CompanyDesign, view: CompanyView): Pick<CompanyDesign, 'ships' | 'finance'> {
  return view === 'start' ? { ships: STARTING.ships, finance: STARTING.finance } : { ships: d.ships, finance: d.finance };
}

export function optionsOf(v: ViewState): TournamentOptions {
  const first = Math.min(v.firstYear, v.lastYear - 1);
  return { from: (first - 1) * 12, to: v.lastYear * 12, hedgeShare: v.hedge / 100, extraShips: v.extraShips };
}

/** All five strategies for a fleet, its financing and the world's dials over a history. */
export function tournament(ships: CompanyShip[], finance: CompanyFinance, drivers: TournamentDrivers, o: TournamentOptions, hist: History = standardHistory()): TournamentResult[] {
  return STRATEGY_KEYS.map((k) => runStrategy(k, ships, finance, hist, drivers, o));
}

/**
 * The challenge: over the whole twelve years, every strategy loses money on the ships Northwind owns
 * except chartering them out. (Ships chartered in have nothing to charter out; a fleet with no owned
 * ships can't solve it.)
 */
export function onlyCharterOutPays(ships: CompanyShip[], finance: CompanyFinance, drivers: TournamentDrivers, o: TournamentOptions, hist: History = standardHistory()): boolean {
  const owned = ships.filter((s) => s.mode === 'owned');
  if (o.from !== 0 || o.to < HISTORY_MONTHS || !owned.length) return false;
  const r = tournament(owned, finance, drivers, o, hist);
  const by = Object.fromEntries(r.map((x) => [x.strategy, x.total])) as Record<StrategyKey, number>;
  return by.charterOut > 0 && STRATEGY_KEYS.filter((k) => k !== 'charterOut').every((k) => by[k] < 0);
}

// ---------------------------------------------------------------------------
// The starting company's results, quoted in the prose.

const START = STARTING;
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
    /** Each world's lead of repositioning and chartering in over all spot. */
    repositionLead: w.reposition.map((x, i) => x - w.spot[i]),
    charterInLead: w.charterIn.map((x, i) => x - w.spot[i]),
    neutral: totals(NEUTRAL_DRIVERS),
    /** From Year 9, close to when Northwind started trading. */
    fromYear9: Object.fromEntries(
      tournament(START.ships, START.finance, NEUTRAL_DRIVERS, optionsOf({ ...VIEW_DEFAULTS, firstYear: 9 })).map((x) => [x.strategy, x]),
    ) as Record<StrategyKey, TournamentResult>,
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

// The same fourteen worlds as Lesson 5.5's trading lab: our history, ten other draws of demand
// shocks and fuel prices, and three with a piece of the physics changed.
const DRAWS = 10;
export const WORLD_NAMES = ['Our history', ...Array.from({ length: DRAWS }, (_, i) => `Draw ${i + 1}`), 'No harvest season', 'Ships built in a year', 'Steadier cargo demand'];
/** Indexes of the altered worlds. */
export const NO_SEASON = DRAWS + 1;
export const FAST_YARDS = DRAWS + 2;
export const STEADY = DRAWS + 3;
const WORLD_PHRASE = [
  'our history',
  ...Array.from({ length: DRAWS }, (_, i) => `draw ${i + 1}`),
  'the world with no harvest season',
  'the world whose shipyards deliver in a year',
  'the world with steadier cargo demand',
];

let worldCache: History[] | null = null;
export function worlds(): History[] {
  return (worldCache ??= [
    standardHistory(),
    ...Array.from({ length: DRAWS }, (_, i) => historyWith({ seed: i + 1 })),
    historyWith({ seasonal: false }),
    historyWith({ lag: 12 }),
    historyWith({ shock: 0.03 }),
  ]);
}

/** Each strategy's total in each world. */
export function worldTotals(ships: CompanyShip[], finance: CompanyFinance, drivers: TournamentDrivers, o: TournamentOptions): Record<StrategyKey, number[]> {
  const out = Object.fromEntries(STRATEGY_KEYS.map((k) => [k, [] as number[]])) as Record<StrategyKey, number[]>;
  for (const w of worlds()) for (const r of tournament(ships, finance, drivers, o, w)) out[r.strategy].push(r.total);
  return out;
}

const pctOf = (x: number) => `${fmt(x * 100)}%`;

/** The dials in words, for captions: “Brazil’s ore at 60%” or “as it happened”. */
function driversText(d: TournamentDrivers): string {
  const parts = [
    d.soy !== 1 ? `Brazil’s harvest at ${pctOf(d.soy)}` : null,
    d.ore !== 1 ? `Brazil’s ore at ${pctOf(d.ore)}` : null,
    d.congestion ? `${fmt(d.congestion, 1)} extra days at Qingdao` : null,
    d.fleet !== 1 ? `${d.fleet > 1 ? '+' : '−'}${fmt(Math.abs(d.fleet - 1) * 100)}% ships` : null,
    d.panama ? 'Panama closed' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'the world as it happened';
}

export default function Lesson() {
  const company = useCompany();
  const view = useScenario('tournament', VIEW_DEFAULTS);
  const v = view.state;
  const o = optionsOf(v);
  const d = company.drivers;
  const fleetChanged = partChanged(company, 'ships');
  const fleet = fleetFor(company, fleetChanged ? v.company : 'start');
  const ships = fleet.ships;
  const finance = fleet.finance;
  const setDriver = (patch: Partial<TournamentDrivers>) => updateCompany((c) => ({ ...c, drivers: { ...c.drivers, ...patch } }));
  const resetDrivers = () => {
    if (confirmReset('the world’s dials', partChanged(company, 'drivers'))) resetCompany('drivers');
  };
  const scenario = {
    ...view,
    reset: () => {
      if (!confirmReset('the world’s dials', partChanged(company, 'drivers'))) return;
      view.reset();
      resetCompany('drivers');
    },
  };
  const switcher = fleetChanged && (
    <ViewSwitch
      value={v.company}
      onChange={(x) => view.set({ company: x })}
      labels={['Starting fleet', 'Your fleet']}
      note={<>The text describes the starting company’s Kestrel and Albatross. Yours: {fleetText(company)}.</>}
    />
  );

  const results = useMemo(() => tournament(ships, finance, d, o), [ships, finance, d, o.from, o.to, o.hedgeShare, o.extraShips]); // eslint-disable-line react-hooks/exhaustive-deps
  const ranked = [...results].sort((a, b) => b.total - a.total);
  const solved = onlyCharterOutPays(ships, finance, d, o);
  const ownsAny = ships.some((s) => s.mode === 'owned');
  // The challenge is scored on the ships Northwind owns: chartered-in ships have nothing to charter out.
  const hasChartered = ships.some((s) => s.mode === 'chartered');
  const ownedResults = useMemo(
    () => (hasChartered && ownsAny ? tournament(ships.filter((s) => s.mode === 'owned'), finance, d, o) : results),
    [hasChartered, ownsAny, results, ships, finance, d, o.from, o.to, o.hedgeShare, o.extraShips], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const ownedBy = Object.fromEntries(ownedResults.map((r) => [r.strategy, r])) as Record<StrategyKey, TournamentResult>;
  const ownedRanked = [...ownedResults].sort((a, b) => b.total - a.total);
  const onlyHedgeLeft =
    v.hedge > 0 && ownedBy.charterOut.total > 0 && ownedBy.hedge.total >= 0 && STRATEGY_KEYS.filter((k) => k !== 'charterOut' && k !== 'hedge').every((k) => ownedBy[k].total < 0);
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
  const key = JSON.stringify([ships, finance, d, o]);
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
  const startFleet = !fleetChanged || v.company === 'start';
  const runText = `${startFleet ? 'the starting fleet' : 'your fleet'}, ${driversText(d)}, FFAs on ${v.hedge}% of the days, up to ${v.extraShips} Kamsarmax${v.extraShips === 1 ? '' : 'es'} chartered in, Year ${Math.floor(o.from / 12) + 1} to Year ${o.to / 12}`;

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
      <CompanySoFar d={company} lesson={5} />
      <P>
        Five strategies enter the tournament, each one already taught. <K tone="gray">All spot</K> trades every ship on the spot market, month after month, and
        takes whatever the market pays (<a href={lessonHref('shipping/4.1')}>Lesson 4.1</a>). <K tone="teal">Charter out for a year</K> hires each owned ship out in
        twelve-month blocks at the period hire on offer, which in our market is what the fundamentals forecast for the coming year (
        <a href={lessonHref('shipping/5.1')}>5.1</a>, <a href={lessonHref('shipping/5.3')}>5.3</a>). <K tone="orange">Charter in when hire is cheap</K> adds
        Kamsarmaxes on one-year charters whenever the period hire is below what a new ship needs to earn (<a href={lessonHref('shipping/2.5')}>2.5</a>).{' '}
        <K tone="violet">Reposition for the harvest</K> sends the Kamsarmaxes to Brazil each February when the plan of <a href={lessonHref('shipping/5.4')}>Lesson
        5.4</a> expects it to pay. <K tone="blue">Sell FFAs against the fleet</K> sells next month’s index forward for a share of the fleet’s days (
        <a href={lessonHref('shipping/4.5')}>4.5</a>). Every strategy pays the same costs for the fleet: running costs and loan payments on the ships it owns,
        and hire on the ships it chartered in.
      </P>
      <P>
        The tournament is a what-if. Northwind bought its fleet in {when(START_MONTH)}, with only {fmt(YEARS_LEFT, 1)} years of the history left — too short to
        see a strategy through a whole cycle. So the tournament runs the same fleet, on the same terms, through all twelve years, as if Northwind had had it from
        the start. Owned ships keep the prices, loans and running costs of <a href={lessonHref('shipping/6.1')}>Lesson 6.1</a>; ships chartered in are
        rechartered every twelve months at that year’s hire, since a hire fixed in a slump can’t be had for a boom. And each ship earns the market rate, the
        benchmark of <a href={lessonHref('shipping/6.3')}>Lesson 6.3</a>, rather than working your cargo book through your desk, so the strategies differ only in
        their commercial choices.
      </P>
      <P>
        In the next demonstration, the five run side by side through the twelve simulated years. The lines are each strategy’s running profit, and the table
        ranks them. Beside them are the world’s physical dials — Brazil’s harvest and its iron ore, the Panama Canal, the queue at Qingdao and how many ships the
        yards deliver. The dials are part of your company’s record, so the next time you open this lesson the world will be as you left it.
        {fleetChanged && ' Your fleet differs from the starting one, so the switch at the top runs either; the text quotes the starting fleet.'} Turn the dials:
      </P>

      <Figure name="Shipping Strategy Tournament" scenario={scenario} actions={<Button onClick={resetDrivers}>World as it happened</Button>}>
        {switcher}
        <Legend items={STRATEGY_KEYS.map((k) => ({ label: SHORT[k], color: COLOR[k].line, kind: 'line' as const }))} />
        <XYChart
          ariaLabel={`Running profit of five strategies for ${startFleet ? 'the starting fleet' : 'your fleet'} from Year ${Math.floor(o.from / 12) + 1} to Year ${o.to / 12}. ${ranked.map((r) => `${STRATEGY_LABELS[r.strategy]}: ${money(r.total)}`).join('; ')}.`}
          series={series}
          xMin={0}
          xMax={HISTORY_MONTHS / 12}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(x) => (x === 0 ? 'Year 1' : x === 12 ? 'end' : `Year ${x + 1}`)}
          yFormat={(y) => money(y * 1e6, 0)}
          yLabel="Running profit, $ million"
          height={190}
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
            { label: 'Total', cell: (r) => money(r.total), align: 'right' },
            { label: 'Worst 12 months', cell: (r) => money(r.worstYear), align: 'right' },
            { label: 'Deepest drawdown', cell: (r) => money(r.maxDrawdown), align: 'right' },
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
        <Checkbox label="Panama Canal closed" checked={d.panama} onChange={(x) => setDriver({ panama: x })} />
        <Slider label="Fleet days sold as FFAs" tone="blue" value={v.hedge} min={0} max={100} step={10} onChange={(x) => view.set({ hedge: x })} display={`${v.hedge}%`} />
        <Slider label="Ships to charter in" tone="orange" value={v.extraShips} min={0} max={4} onChange={(x) => view.set({ extraShips: x })} display={`${v.extraShips}`} />
        <Slider label="First year" value={v.firstYear} min={1} max={11} onChange={(x) => view.set({ firstYear: x, lastYear: Math.max(v.lastYear, x + 1) })} display={`Year ${v.firstYear}`} />
        <Slider label="Last year" value={v.lastYear} min={2} max={12} onChange={(x) => view.set({ lastYear: x, firstYear: Math.min(v.firstYear, x - 1) })} display={`Year ${v.lastYear}`} />
      </Figure>

      <P>
        Start with the dials as the history happened and the company you began Chapter 6 with, Kestrel and Albatross. Over the twelve years, all spot makes{' '}
        {money(n.spot.total)}, but its worst twelve months lose {money(-n.spot.worstYear)} and at its deepest it stands {money(n.spot.maxDrawdown)} below its
        best. That is the cycle of <a href={lessonHref('shipping/4.4')}>Lesson 4.4</a>, passed straight through to the company. Chartering out makes less,{' '}
        {money(n.charterOut.total)}, but its worst year loses only {money(-n.charterOut.worstYear)} and its drawdown is {money(n.charterOut.maxDrawdown)}: a
        steadier income, bought by giving up the booms. Chartering in when hire is cheap makes the most, {money(n.charterIn.total)}, with the deepest drawdown,{' '}
        {money(n.charterIn.maxDrawdown)}. Repositioning makes {money(n.reposition.total)}, and selling FFAs {money(n.hedge.total)}, with a drawdown a little
        shallower than spot’s, {money(n.hedge.maxDrawdown)}.
      </P>
      <P>
        The table’s last column weighs each profit against its risk: it is the Sharpe ratio of <a href={lessonHref('shipping/5.5')}>Lesson 5.5</a>, a strategy’s
        average monthly profit divided by the standard deviation of its monthly profits and scaled to a year (multiplied by √12). The higher it is, the less the
        profit rests on a few lucky months. Chartering out has the highest, {fmt(n.charterOut.summary.sharpe, 2)} against all spot’s{' '}
        {fmt(n.spot.summary.sharpe, 2)} — less money, earned much more evenly. Set the first year to Year 9, close to when Northwind really started, and over
        those four years all spot makes {money(q.fromYear9.spot.total)} and chartering out {money(q.fromYear9.charterOut.total)}.
      </P>

      <H2>Break each one</H2>
      <P>
        Now take each winner’s physical reason away. Repositioning earns its extra by sending Kamsarmaxes to meet Brazil’s soybean harvest
        (<a href={lessonHref('shipping/3.5')}>3.5</a>), paid for by a freight that already prices the ballast leg (<a href={lessonHref('shipping/3.4')}>3.4</a>).
        Weaken the harvest to 70% of normal and the plan never expects a gain, so the strategy does nothing different: it ends exactly where all spot ends, with{' '}
        {outcome(q.weakSoy.reposition.total)}. Chartering in when hire is cheap is a bet that cheap periods end — that the fleet won’t keep growing. Let the yards
        deliver 5% more ships and the bet fails: it loses {money(-q.moreShips.charterIn.total)} while all spot loses {money(-q.moreShips.spot.total)}. The same
        5% leaves repositioning ahead of all spot, with {outcome(q.moreShips.reposition.total)}, because the harvest is still there.
      </P>
      <P>
        Other dials move everyone who trades spot. Close the Panama Canal and Kamsarmax voyages from the US Gulf grow by thousands of miles (
        <a href={lessonHref('shipping/3.3')}>3.3</a>); all spot rises to {money(q.panama.spot.total)}. Cut Brazil’s iron ore to 70% and the Capesize market falls
        toward its floor: all spot loses {money(-q.weakOre.spot.total)}. Through all of it, chartering out makes the same {money(n.charterOut.total)}, because its
        hires were fixed by what the market expected before any of it happened. That is its whole character: with a 30% stronger harvest, all spot makes{' '}
        {money(q.strongSoy.spot.total)} and chartering out still makes {money(q.strongSoy.charterOut.total)}.
      </P>

      <Challenge
        id="a"
        figure="Shipping Strategy Tournament"
        question="With the window covering all twelve years, set the world’s dials so that, on the ships Northwind owns, every strategy except chartering out loses money."
        solved={solved}
        status={
          !ownsAny
            ? 'Your fleet owns no ships, so there is nothing to charter out: switch the demonstration to the starting fleet, or buy a ship in Lesson 6.1.'
            : !fullWindow
              ? 'Set the window to cover Year 1 to Year 12 first.'
              : `${hasChartered ? 'On the ships you own' : 'Right now'}: ${ownedRanked.map((r) => `${SHORT[r.strategy]} ${money(r.total)}`).join(', ')}.${
                  onlyHedgeLeft ? ` Only the FFA seller still makes money: it sold ${v.hedge}% of the fleet’s days forward at prices that never saw the dials.` : ''
                }`
        }
        success={`Solved. Chartering out still makes ${money(ownedBy.charterOut.total)} on the ships Northwind owns while every strategy that keeps a foot in the spot market loses${v.hedge < 100 ? ' — the FFA seller too, since it sells only part of the fleet’s days' : ''}. Owners charter out to be indifferent to exactly these dials: a weak trade, a glut of ships. The price is that they are indifferent to the good dials as well.`}
      />

      <H2>Luck or skill</H2>
      <P>
        One history is one draw. The cycle model of <a href={lessonHref('shipping/4.4')}>Lesson 4.4</a> could have produced others from the same world, and{' '}
        <a href={lessonHref('shipping/5.5')}>Lesson 5.5</a> showed what a backtest on a single history can hide. In the next demonstration, every strategy runs in
        the same {nWorlds === 14 ? 'fourteen' : fmt(nWorlds)} worlds as that lesson: our history, ten other draws of demand shocks and fuel prices, a world with no harvest season, one whose
        shipyards deliver in a year instead of thirty months, and one with steadier cargo demand. It uses the fleet, dials and settings of{' '}
        <FigRef to="Shipping Strategy Tournament">the first demonstration</FigRef>. Each dot is one strategy’s profit in one world; slide along the worlds to
        follow one of them across the strategies:
      </P>

      <Figure name="Shipping Strategy Tournament · other worlds" scenario={scenario}>
        {switcher}
        <svg
          className="chart"
          viewBox={`0 0 640 ${rowY(STRATEGY_KEYS.length) + 12}`}
          role="img"
          aria-label={`Profit of each strategy in ${nWorlds} worlds. ${STRATEGY_KEYS.filter((k) => k !== 'spot')
            .map((k) => `${STRATEGY_LABELS[k]} beats all spot in ${beats(k)} of ${nWorlds}`)
            .join('; ')}. Highlighted: ${WORLD_NAMES[hl]}.`}
        >
          <text className="ax" x={SX0} y={12}>
            Profit over the window, $ million
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
            label: `${lowerFirst(SHORT[k])} beats all spot`,
            value: `${beats(k)} of ${nWorlds} worlds`,
          }))}
        />
        <Slider label="Follow one world" value={hl} min={0} max={nWorlds - 1} onChange={(x) => view.set({ world: x })} display={WORLD_NAMES[hl]} />
        <Caption>
          In {WORLD_PHRASE[hl]}: {STRATEGY_KEYS.map((k) => `${lowerFirst(SHORT[k])} ${money(many[k][hl])}`).join(', ')}. Running {runText}.
        </Caption>
      </Figure>

      <P>
        With the starting company and the dials as it happened, selling FFAs beats all spot in {q.beat.hedge} of the {nWorlds} worlds, by a little: it trims bad
        months and good ones alike, and our model’s forward curve, as <a href={lessonHref('shipping/5.5')}>Lesson 5.5</a> found, expects slumps to end sooner than
        they do, so selling it pays slightly on top. Repositioning beats all spot in {q.beat.reposition} — every world but the one with no harvest season. There its
        plan, which still expects a harvest, sends the Kamsarmax to Brazil every February anyway, and it ends {money(-q.repositionLead[NO_SEASON])} behind.
        Chartering in beats all spot in {q.beat.charterIn}, leading by as much as {money(q.charterInRange.best)} and trailing by up to{' '}
        {money(-q.charterInRange.worst)}: a leveraged bet that cheap hire will be followed by dearer spot. Chartering out beats all spot in {q.beat.charterOut}.
        Look at the world where shipyards deliver in a year: booms are cut short by ships ordered during them, earnings average far less than in the history, and
        at the prices Northwind paid for its ships every strategy loses. Chartering in loses least there — its extra ships, taken on while hire was cheap, earn{' '}
        {money(q.charterInLead[FAST_YARDS])} more than their hire — but no commercial strategy rescues a company that bought its fleet for a world that didn’t
        happen.
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
