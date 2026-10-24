import { useDeferredValue, useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  pct,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import { cargoChoice, lngCargo, netback, overseasPrices, type CargoChoice, type LngVoyage } from '../../../engines/gas/lng';
import { normalPlan, scenarioYear, type YearDay } from '../../../engines/gas/market';
import { LNG_VALUE } from '../../../model/gas/demand';
import { GAS_MONTHS, GAS_MONTH_START, GAS_YEAR_DAYS, INJECTION_DAYS } from '../../../model/gas/weather';
import { BAYPORT_LNG, BAYPORT_LNG_FEEDGAS_BCFD, PIPELINE, REFERENCE_DAYS } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { MONTHS, gp, money } from '../shared/format';

// ---------------------------------------------------------------------------
// The trader: one cargo a month for two years, against simulated overseas prices.

type Dest = 'europe' | 'asia';
type Terms = Parameters<typeof cargoChoice>[2];

/** The overseas price path the trader sees (month 0 is a January). */
export const TRADER_SEED = 3;
export const TRADER_MONTHS = 24;
const RAW = overseasPrices(TRADER_SEED, TRADER_MONTHS);
const PLAN = normalPlan();

/** Calder's plan price in a calendar month (0 = January). */
export function calderInMonth(m: number): number {
  return PLAN.price.calder[((m % 12) + 9) % 12];
}

export interface TraderState {
  /** Overseas prices as a share of the simulated path, %. */
  level: number;
  /** Ship charter rate, $/day. */
  charter: number;
  /** Change in Calder's price from the plan, $/MMBtu. */
  shift: number;
}

export const TRADER_DEFAULTS: TraderState = { level: 100, charter: BAYPORT_LNG.charterPerDay, shift: 0 };
export const LEVEL_MIN = 30;
export const LEVEL_MAX = 150;
export const LEVEL_STEP = 5;

function termsWith(charter: number): Terms {
  return { ...BAYPORT_LNG, charterPerDay: charter };
}

function voyageTo(dest: Dest, hub: number, charter: number): LngVoyage {
  return {
    hubPrice: hub,
    feedMultiplier: BAYPORT_LNG.feedMultiplier,
    liquefactionFee: BAYPORT_LNG.liquefactionFee,
    ladenDays: BAYPORT_LNG.destinations[dest].ladenDays,
    charterPerDay: charter,
    voyageFees: BAYPORT_LNG.destinations[dest].voyageFees,
    regasFee: BAYPORT_LNG.regasFee,
  };
}

/** MMBtu loaded on one cargo. */
export const CARGO_MMBTU = lngCargo(voyageTo('europe', 3, BAYPORT_LNG.charterPerDay)).loaded;
/** What a cancelled cargo still costs its buyer: the liquefaction fee on the cargo it didn't lift, $. */
export const CANCEL_COST = BAYPORT_LNG.liquefactionFee * CARGO_MMBTU;

export interface TraderMonth {
  m: number;
  europe: number;
  asia: number;
  calder: number;
  choice: CargoChoice;
}

/** Each month's prices and cargo decision. */
export function traderMonths(s: TraderState): TraderMonth[] {
  const terms = termsWith(s.charter);
  return Array.from({ length: TRADER_MONTHS }, (_, m) => {
    const europe = (RAW.europe[m] * s.level) / 100;
    const asia = (RAW.asia[m] * s.level) / 100;
    const calder = calderInMonth(m) + s.shift;
    return { m, europe, asia, calder, choice: cargoChoice(calder, { europe, asia }, terms) };
  });
}

export interface TraderSummary {
  europe: number;
  asia: number;
  cancelled: number;
  /** Cargoes that sail although they lose money once the fee is counted. */
  atLoss: number;
  /** The buyer's result over the two years, one cargo a month, $ (a cancelled cargo still owes the fee). */
  result: number;
  /** The same if every cargo that loses money counting the fee had been cancelled instead, $. */
  resultCancelEveryLoss: number;
}

export function traderSummary(months: TraderMonth[]): TraderSummary {
  const s: TraderSummary = { europe: 0, asia: 0, cancelled: 0, atLoss: 0, result: 0, resultCancelEveryLoss: 0 };
  for (const { choice: c } of months) {
    if (c.cancel) {
      s.cancelled++;
      s.result -= CANCEL_COST;
      s.resultCancelEveryLoss -= CANCEL_COST;
      continue;
    }
    s[c.best]++;
    s.result += c.margin * CARGO_MMBTU;
    if (c.margin < 0) {
      s.atLoss++;
      s.resultCancelEveryLoss -= CANCEL_COST;
    } else s.resultCancelEveryLoss += c.margin * CARGO_MMBTU;
  }
  return s;
}

/** The highest overseas price level, on the slider's steps, at which at least one cargo is cancelled. */
export function firstCancelLevel(charter: number, shift: number): number {
  for (let l = LEVEL_MAX; l >= LEVEL_MIN; l -= LEVEL_STEP) {
    if (traderSummary(traderMonths({ level: l, charter, shift })).cancelled > 0) return l;
  }
  return NaN;
}

export const FIRST_CANCEL_LEVEL = firstCancelLevel(TRADER_DEFAULTS.charter, 0);

/** The challenge: the highest level with a cancellation, with the starting charter rate and Calder prices. */
export function cancelLevelSolved(s: TraderState): boolean {
  return s.charter === TRADER_DEFAULTS.charter && Math.abs(s.shift) < 1e-9 && s.level === FIRST_CANCEL_LEVEL;
}

/** How much more Asia must pay than Europe for a cargo to earn the same netback there, $/MMBtu. */
export function asiaPremium(europe: number, charter = BAYPORT_LNG.charterPerDay): number {
  const target = netback(voyageTo('europe', 3, charter), europe);
  let lo = europe;
  let hi = europe + 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (netback(voyageTo('asia', 3, charter), mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2 - europe;
}

// ---------------------------------------------------------------------------
// Back home: what overseas prices do to the region.

/** The typical winter of Lessons 4.2 and 5.1. */
export const HOME_SEED = 3;
/** Europe is taken to sit this far below Asia, so Asia is always the better destination. */
export const HOME_EUROPE_GAP = 1.5;
export const HOME_DEFAULTS = { asia: 9 };
export const HOME_MIN = 3;
export const HOME_MAX = 12;
export const HOME_STEP = 0.5;
const GULFWARD = PIPELINE['calder-bayport'];

/** The highest Calder price at which a cargo still sails (fee sunk): the better netback ÷ 1.15. */
export function homeCap(asia: number): number {
  const c = cargoChoice(3, { europe: asia - HOME_EUROPE_GAP, asia }, BAYPORT_LNG);
  return Math.max(c.netback.europe, c.netback.asia) / BAYPORT_LNG.feedMultiplier;
}

/** The typical winter's year with Bayport's terminal bidding for feed gas up to that cap (plus the trip down Gulfward). */
export function homeYear(asia: number): YearDay[] {
  return scenarioYear({ seed: HOME_SEED, demand: { lngValue: homeCap(asia) + GULFWARD.variableCost } });
}

export interface HomeStats {
  cap: number;
  calderAvg: number;
  calderMax: number;
  lngAvg: number;
  /** Days the terminal takes less than its full feed gas, in all and in the injection season. */
  cutDays: number;
  summerCut: number;
}

function statsOf(y: YearDay[], cap: number): HomeStats {
  const full = BAYPORT_LNG_FEEDGAS_BCFD - 1e-6;
  return {
    cap,
    calderAvg: y.reduce((s, d) => s + d.price.calder, 0) / y.length,
    calderMax: Math.max(...y.map((d) => d.price.calder)),
    lngAvg: y.reduce((s, d) => s + d.sectors.lng, 0) / y.length,
    cutDays: y.filter((d) => d.sectors.lng < full).length,
    summerCut: y.filter((d) => d.day < INJECTION_DAYS && d.sectors.lng < full).length,
  };
}

const homeCache = new Map<number, HomeStats>();
export function homeStats(asia: number): HomeStats {
  let s = homeCache.get(asia);
  if (!s) {
    s = statsOf(homeYear(asia), homeCap(asia));
    homeCache.set(asia, s);
  }
  return s;
}

/** The same year with the world's default LNG value, as in Chapter 4. */
export function homeBase(): HomeStats {
  return statsOf(scenarioYear({ seed: HOME_SEED }), LNG_VALUE - GULFWARD.variableCost);
}

/**
 * The challenge: lowering Asia's price from where it starts, the first price (on the slider's steps)
 * at which the terminal is cut back on some day between April and October.
 */
export function firstSummerCut(): number {
  for (let a = HOME_MAX; a >= HOME_MIN - 1e-9; a -= HOME_STEP) if (homeStats(a).summerCut > 0) return a;
  return NaN;
}

export function summerCutSolved(asia: number): boolean {
  return Math.abs(asia - firstSummerCut()) < 1e-9;
}

// ---------------------------------------------------------------------------
// Display.

const EU = GRAPHIC.blue;
const AS = GRAPHIC.violet;
const FEE_ZONE = tint(GRAPHIC.red, 0.22);
const PROFIT = TEXT.green;
const LOSS = TEXT.orange;
const CANCEL = TEXT.red;
const DEST: Record<Dest, string> = { europe: 'Europe', asia: 'Asia' };

const monthLabel = (m: number) => `${MONTHS[m % 12]}, year ${Math.floor(m / 12) + 1}`;

function stepLine(values: number[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  values.forEach((v, m) => {
    xs.push(m, m + 1);
    ys.push(v, v);
  });
  return { xs, ys };
}

export default function Lesson() {
  // ---- Figure 1.
  const s = useScenario('trader', TRADER_DEFAULTS);
  const st = s.state;
  const [cursor, setCursor] = useState(1);
  const months = useMemo(() => traderMonths(st), [st]);
  const sum = traderSummary(months);
  const cm = months[Math.min(TRADER_MONTHS - 1, Math.max(0, Math.floor(cursor)))];
  const feed = months.map((x) => BAYPORT_LNG.feedMultiplier * x.calder);
  const fob = months.map((x) => x.choice.fob);
  const nbEu = months.map((x) => x.choice.netback.europe);
  const nbAs = months.map((x) => x.choice.netback.asia);
  const [y0, y1] = niceDomain(Math.min(0, ...nbEu, ...nbAs), Math.max(8, ...nbEu, ...nbAs, ...fob), 4);
  const feedStep = stepLine(feed);
  const fobStep = stepLine(fob);
  const centers = months.map((x) => x.m + 0.5);
  const solvedA = cancelLevelSolved(st);
  const cmBest = cm.choice.best;
  const cmCargo = lngCargo(voyageTo(cmBest, cm.calder, st.charter));
  const cmPrice = cm[cmBest];

  // ---- Figure 2.
  const h = useScenario('home', HOME_DEFAULTS);
  const asia = useDeferredValue(h.state.asia);
  const year = useMemo(() => homeYear(asia), [asia]);
  const hs = homeStats(asia);
  const base = useMemo(() => scenarioYear({ seed: HOME_SEED }), []);
  const days = year.map((d) => d.day + 0.5);
  const [c0, c1] = niceDomain(0, Math.max(5, ...year.map((d) => d.price.calder), ...base.map((d) => d.price.calder)), 4);
  const solvedB = summerCutSolved(h.state.asia);

  // ---- Numbers for the prose (defaults).
  const D = traderMonths(TRADER_DEFAULTS);
  const DS = traderSummary(D);
  const JAN1 = D[0];
  const FEB1 = D[1];
  const SEP1 = D[8];
  const PREMIUM_9 = asiaPremium(9);
  const AT_LOSS_EXAMPLE = SEP1.choice;
  const L = traderSummary(traderMonths({ ...TRADER_DEFAULTS, level: FIRST_CANCEL_LEVEL }));
  const LOW = traderSummary(traderMonths({ ...TRADER_DEFAULTS, level: 60 }));
  const H9 = homeStats(9);
  const H6 = homeStats(6);
  const H4 = homeStats(4);
  const H3 = homeStats(3);
  const SUMMER_ANSWER = firstSummerCut();
  const S_ANSWER = homeStats(SUMMER_ANSWER);
  const S_ABOVE = homeStats(SUMMER_ANSWER + HOME_STEP);

  return (
    <LessonPage id="gas/5.4">
      <P>
        <a href={lessonHref('gas/5.3')}>The previous lesson</a> followed the region’s gas into its power plants. Bayport’s terminal sends it much further.{' '}
        {fmt(BAYPORT_LNG_FEEDGAS_BCFD, 1)} Bcf/d leaves the region there as LNG, more than Metro burns on a summer day ({fmt(REFERENCE_DAYS.summer.demand.metro, 1)} Bcf/d), and each cargo goes to whichever buyer on another
        continent will pay the most for it. Europe’s benchmark trades at the Dutch TTF hub; LNG bought for northeast Asia is priced by an assessment called the JKM.
        Neither answers to Calder Hub. They rise and fall with their own weather, their own shortages and each other.
      </P>
      <P>
        <a href={lessonHref('gas/3.5')}>Lesson 3.5</a> built the chain that connects them to us and boiled it down to one number, the <K c="price">netback</K>: the
        destination price less shipping and regasification, per MMBtu loaded at Bayport. A buyer who has signed for Bayport’s gas pays the terminal{' '}
        {pct(BAYPORT_LNG.feedMultiplier)} of the Calder price for every MMBtu loaded, plus a fixed fee of {gp(BAYPORT_LNG.liquefactionFee)}. So each month it faces two
        questions. Which destination has the better netback? And is that netback worth sailing for at all? Both answers move with prices on three continents, which is
        what makes the trade an arbitrage: buying where gas is cheap and selling where it’s dear, so long as the gap covers the cost of moving it.
      </P>
      <P>
        Asia usually pays more than Europe, but it’s farther: {BAYPORT_LNG.destinations.asia.ladenDays} days at sea instead of{' '}
        {BAYPORT_LNG.destinations.europe.ladenDays}, a canal toll, more boil-off and nearly twice the charter. With Europe at $9.00, Asia has to pay about{' '}
        {usd(9 + PREMIUM_9, 2)}, {fmt(PREMIUM_9 * 100)}¢ more, before a cargo earns as much there. In the next demonstration, a buyer holds one Bayport cargo a month for two
        years, against a simulated path of overseas prices. The lines are each destination’s netback; the stepped band is what the cargo costs at Bayport, from{' '}
        {pct(BAYPORT_LNG.feedMultiplier)} of the Calder price (its lower edge) to that plus the fee (its upper edge). Scale the overseas prices, change the charter rate or
        Calder’s price, and drag across the chart to read a month:
      </P>

      <Figure name="Global Gas Trader" scenario={s}>
        <XYChart
          xDomain={[0, TRADER_MONTHS]}
          yDomain={[y0, y1]}
          xTicks={[0, 3, 6, 9, 12, 15, 18, 21, 24]}
          xFormat={(v) => (v === 24 ? '' : v === 0 ? 'Jan, yr 1' : v === 12 ? 'Jan, yr 2' : MONTHS[v % 12])}
          yTicks={niceTicks(y0, y1, 4)}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Per MMBtu loaded at Bayport (simulated)"
          height={270}
          series={[
            { xs: fobStep.xs, ys: fobStep.ys, lows: feedStep.ys, kind: 'band', color: FEE_ZONE, opacity: 1 },
            { xs: feedStep.xs, ys: feedStep.ys, color: '#555', width: 1.5 },
            { xs: fobStep.xs, ys: fobStep.ys, color: '#555', width: 1.5, dash: '5 4' },
            { xs: centers, ys: nbEu, color: EU, width: 2.5 },
            { xs: centers, ys: nbAs, color: AS, width: 2.5, dash: '7 4' },
          ]}
          cursor={cm.m + 0.5}
          onScrub={(x) => setCursor(Math.min(TRADER_MONTHS - 1, Math.max(0, Math.floor(x))))}
          scrubLabel="Month of the two years"
          ariaLabel={`Netbacks from Europe and Asia against the cargo’s cost at Bayport, month by month for two years, with overseas prices at ${st.level}% of the simulated path. ${sum.europe} cargoes go to Europe, ${sum.asia} to Asia and ${sum.cancelled} are cancelled; ${sum.atLoss} sail at a loss once the fee is counted.`}
        >
          {(x, y) => (
            <g>
              {months.map((mo) => {
                const c = mo.choice;
                const nb = Math.max(c.netback.europe, c.netback.asia);
                const col = c.cancel ? CANCEL : c.margin < 0 ? LOSS : PROFIT;
                return (
                  <g key={mo.m}>
                    {c.cancel ? (
                      <text x={x(mo.m + 0.5)} y={y(c.fob) - 6} textAnchor="middle" style={{ fontSize: 13, fontWeight: 700, fill: col }}>
                        ✕
                      </text>
                    ) : (
                      <circle cx={x(mo.m + 0.5)} cy={y(nb)} r={4} fill={col} stroke="#fcfcfb" strokeWidth={1.5} />
                    )}
                    <text x={x(mo.m + 0.5)} y={y(y0) - 5} textAnchor="middle" style={{ fontSize: 10, fontWeight: 500, fill: col }}>
                      {c.cancel ? '' : c.best === 'europe' ? 'E' : 'A'}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
        </XYChart>
        <Legend
          items={[
            { label: 'Netback from Europe', color: EU, kind: 'line' },
            { label: 'Netback from Asia', color: AS, kind: 'line', dashed: true },
            { label: '115% of Calder (lower edge) to that plus the fee', color: FEE_ZONE },
            { label: 'Sails at a profit', color: PROFIT },
            { label: 'Sails at a loss', color: LOSS },
            { label: 'Cancelled ✕', color: CANCEL },
          ]}
        />
        <Readouts
          items={[
            { label: 'cargoes to Europe · Asia', value: `${sum.europe} · ${sum.asia}` },
            { label: 'cancelled', value: String(sum.cancelled), tone: sum.cancelled ? 'red' : 'ink' },
            { label: 'sailed at a loss', value: String(sum.atLoss), tone: sum.atLoss ? 'orange' : 'ink' },
            { label: 'the buyer’s two years', value: money(sum.result), tone: sum.result < 0 ? 'red' : 'green' },
            { label: 'had it cancelled every loss', value: money(sum.resultCancelEveryLoss), tone: sum.resultCancelEveryLoss < 0 ? 'red' : 'green' },
          ]}
        />
        <Slider label="Overseas prices" tone="green" value={st.level} min={LEVEL_MIN} max={LEVEL_MAX} step={LEVEL_STEP} onChange={(v) => s.set({ level: v })} display={`${st.level}% of the simulated path`} />
        <Slider label="Charter rate" value={st.charter} min={20_000} max={300_000} step={5_000} onChange={(v) => s.set({ charter: v })} display={`${usd(st.charter)} a day`} />
        <Slider
          label="Calder Hub price"
          tone="green"
          value={st.shift}
          min={-1.5}
          max={3}
          step={0.05}
          onChange={(v) => s.set({ shift: v })}
          display={st.shift === 0 ? 'as planned' : `${st.shift > 0 ? '+' : '−'}${usd(Math.abs(st.shift), 2)} on the plan`}
        />
        <Eq
          label={`${monthLabel(cm.m)}: netback from ${DEST[cmBest]} equals ${usd(cmPrice, 2)} times ${fmt(cmCargo.sentOut)} MMBtu sent out, less ${money(cmCargo.costs.shipping)} shipping and ${money(cmCargo.costs.regas)} regasification, over ${fmt(cmCargo.loaded)} MMBtu loaded: ${usd(cm.choice.netback[cmBest], 2)}`}
        >
          <K c="price">netback</K>
          <Op>=</Op>
          <Frac
            top={
              <span>
                {usd(cmPrice, 2)} × {fmt(cmCargo.sentOut / 1e6, 3)}M − ${fmt(cmCargo.costs.shipping / 1e6, 2)}M − ${fmt(cmCargo.costs.regas / 1e6, 2)}M
              </span>
            }
            bottom={<span>{fmt(cmCargo.loaded / 1e6, 3)}M loaded</span>}
          />
          <Op>=</Op>
          <K c="price">{usd(cm.choice.netback[cmBest], 2)}</K>
        </Eq>
        <Caption>
          {monthLabel(cm.m)}: Europe {usd(cm.europe, 2)}, Asia {usd(cm.asia, 2)}, Calder {usd(cm.calder, 2)}.{' '}
          {cm.choice.cancel
            ? `Even ${DEST[cmBest]}’s netback, ${usd(cm.choice.netback[cmBest], 2)}, doesn’t cover the ${usd(BAYPORT_LNG.feedMultiplier * cm.calder, 2)} the gas costs: the cargo is cancelled, and the buyer still owes the fee, ${money(CANCEL_COST)}.`
            : cm.choice.margin < 0
              ? `The cargo goes to ${DEST[cmBest]} and loses ${usd(-cm.choice.margin, 2)} per MMBtu counting the fee, ${money(-cm.choice.margin * CARGO_MMBTU)} in all — less than the ${money(CANCEL_COST)} fee it would owe if it stayed home.`
              : `The cargo goes to ${DEST[cmBest]} and earns ${usd(cm.choice.margin, 2)} per MMBtu after every cost, ${money(cm.choice.margin * CARGO_MMBTU)} in all.`}
        </Caption>
      </Figure>

      <P>
        Over the two years, {DS.asia} cargoes go to Asia and {DS.europe} to Europe; prices are simulated, and the buyer here holds one cargo a month. In the first
        January Asia pays {usd(JAN1.asia, 2)} against Europe’s {usd(JAN1.europe, 2)}, {fmt((JAN1.asia - JAN1.europe) * 100)}¢ more — less than the longer voyage costs —
        so that cargo goes to Europe, netting {usd(JAN1.choice.netback.europe, 2)}. A month later Asia jumps to {usd(FEB1.asia, 2)} and the next cargo goes to Asia. Cargoes
        switch sides whenever the spread crosses the cost of the longer voyage, and in the real market that switching is what keeps the two regions’ prices from drifting
        further apart than the cost of sailing between them.
      </P>
      <P>
        Now look at the orange dots. In {DS.atLoss} of the 24 months the better netback falls inside the band: above what the gas costs at{' '}
        {pct(BAYPORT_LNG.feedMultiplier)} of Calder, but below that plus the fee. In September of the first year, for example, Europe nets{' '}
        {usd(AT_LOSS_EXAMPLE.netback.europe, 2)} against a cost of {usd(AT_LOSS_EXAMPLE.fob, 2)}, a loss of {usd(-AT_LOSS_EXAMPLE.margin, 2)} per MMBtu counting the
        fee. The cargo sails anyway, and it’s right to. Under contracts like Bayport’s the buyer owes the fee whether or not it lifts the cargo, so by the time it
        decides, the fee is a <b>sunk cost</b>: gone either way. What sailing changes is only the gas, at {pct(BAYPORT_LNG.feedMultiplier)} of Calder, and the voyage;
        against those, September’s cargo earns {usd(AT_LOSS_EXAMPLE.marginFeeSunk, 2)} per MMBtu toward the fee. Over the two years the buyer comes out{' '}
        {money(DS.result)} ahead. Had it cancelled every cargo that lost money counting the fee, it would have paid the fee on each and come out with only{' '}
        {money(DS.resultCancelEveryLoss)}.
      </P>

      <H2>When cargoes stop</H2>
      <P>
        A cargo is cancelled only when even the better netback falls below the lower edge of the band: when the gas itself costs more at Bayport than it fetches
        overseas, after shipping. Lower the overseas prices in <FigRef to="Global Gas Trader">the first demonstration</FigRef> and watch it happen. At{' '}
        {FIRST_CANCEL_LEVEL}% of the simulated path, {L.cancelled} cargoes are cancelled; at 60%, {LOW.cancelled}. Something like this happened in 2020. As the
        pandemic cut demand, gas prices in Europe and Asia fell to their lowest in years, and buyers cancelled many cargoes from the United States, leaving more gas at
        home in a market that already had plenty. Raising Calder’s price does the same from the other end: gas that’s dear at home is worth exporting less often.
      </P>

      <Challenge
        id="a"
        figure="Global Gas Trader"
        question="With the starting charter rate and Calder prices, lower the overseas prices until cargoes start being cancelled. What’s the highest level, on the slider’s steps, at which at least one cargo is cancelled?"
        solved={solvedA}
        status={
          st.charter !== TRADER_DEFAULTS.charter || Math.abs(st.shift) > 1e-9
            ? 'Set the charter rate and Calder’s price back to where they started (Reset), then move only the overseas prices.'
            : sum.cancelled === 0
              ? `At ${st.level}% every cargo sails.`
              : `At ${st.level}%, ${sum.cancelled} cargo${sum.cancelled === 1 ? ' is' : 'es are'} cancelled. Is there a higher level with a cancellation?`
        }
        success={`Solved: ${FIRST_CANCEL_LEVEL}%. There ${L.cancelled} cargoes are cancelled, and a step higher none is. Below that level the weakest months’ best netback no longer covers ${pct(BAYPORT_LNG.feedMultiplier)} of Calder’s price, so sailing would add a loss on the gas to the fee the buyer owes anyway. Notice how many cargoes sail at a loss before the first is cancelled: the fee makes the buyer’s results swing a long way before the gas stops flowing.`}
      />

      <H2>Back home</H2>
      <P>
        Cancelled cargoes don’t vanish from the region’s accounts. The gas they would have carried stays in the region’s pipelines, looking for another buyer, and
        Bayport’s terminal is the biggest single buyer there is. When overseas prices are high, the terminal takes its {fmt(BAYPORT_LNG_FEEDGAS_BCFD, 1)} Bcf/d whatever
        Calder costs, as in Chapter 4. When they fall, the terminal becomes the region’s most price-sensitive customer: it keeps loading only while Calder stays below
        the netback divided by {fmt(BAYPORT_LNG.feedMultiplier, 2)}, its <K c="price">cap</K>. In the next demonstration overseas prices hold steady for a whole gas year
        — Asia at the price you choose and Europe {usd(HOME_EUROPE_GAP, 2)} below it — while the region runs through the typical winter of{' '}
        <a href={lessonHref('gas/5.1')}>Lesson 5.1</a>. The upper chart is Calder’s daily price, with the dashed line the same year at Chapter 4’s LNG value; the lower
        one is the terminal’s feed gas:
      </P>

      <Figure name="Global Gas Trader · back home" scenario={h}>
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[c0, c1]}
          xTicks={GAS_MONTH_START}
          xFormat={(v) => GAS_MONTHS[GAS_MONTH_START.indexOf(v)] ?? ''}
          yTicks={niceTicks(c0, c1, 4)}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Calder Hub, $/MMBtu (simulated)"
          height={200}
          series={[
            { xs: days, ys: base.map((d) => d.price.calder), color: '#9a9a9a', width: 1.5, dash: '4 3' },
            { xs: days, ys: year.map((d) => d.price.calder), color: GRAPHIC.green, width: 2 },
          ]}
          hLines={hs.cap < c1 ? [{ at: hs.cap, color: TEXT.red, dash: '5 4', label: `cap ${usd(hs.cap, 2)}`, labelAt: 'start' }] : []}
          ariaLabel={`Calder Hub’s daily price over the typical winter’s gas year with Asia at ${usd(asia, 2)}: it averages ${usd(hs.calderAvg, 2)} and peaks at ${usd(hs.calderMax, 2)}, against the terminal’s cap of ${usd(hs.cap, 2)}.`}
        />
        <XYChart
          xDomain={[0, GAS_YEAR_DAYS]}
          yDomain={[0, 1.4]}
          xTicks={GAS_MONTH_START}
          xFormat={(v) => GAS_MONTHS[GAS_MONTH_START.indexOf(v)] ?? ''}
          yTicks={[0, 0.4, 0.8, 1.2]}
          yFormat={(v) => fmt(v, 1)}
          yLabel="Bayport’s LNG feed gas, Bcf/d"
          height={150}
          series={[
            { xs: days, ys: year.map((d) => d.sectors.lng), color: GRAPHIC.orange, kind: 'area', opacity: 0.25 },
            { xs: days, ys: year.map((d) => d.sectors.lng), color: GRAPHIC.orange, width: 1.5 },
          ]}
          hLines={[{ at: BAYPORT_LNG_FEEDGAS_BCFD, color: '#777', dash: '4 4', label: 'capacity', labelAt: 'start' }]}
          ariaLabel={`Bayport’s LNG feed gas over the year, averaging ${fmt(hs.lngAvg, 2)} Bcf/d; it takes less than its ${fmt(BAYPORT_LNG_FEEDGAS_BCFD, 1)} Bcf/d on ${hs.cutDays} days.`}
        />
        <Legend
          items={[
            { label: `Calder, Asia at ${usd(asia, 2)}`, color: GRAPHIC.green, kind: 'line' },
            { label: 'Calder at Chapter 4’s LNG value', color: '#9a9a9a', kind: 'line', dashed: true },
            { label: 'LNG feed gas', color: GRAPHIC.orange },
          ]}
        />
        <Readouts
          items={[
            { label: 'the terminal’s cap at Calder', value: gp(hs.cap), tone: 'green' },
            { label: 'Calder’s average', value: gp(hs.calderAvg), tone: 'green' },
            { label: 'LNG exports, average', value: `${fmt(hs.lngAvg, 2)} Bcf/d`, tone: 'orange' },
            { label: 'days cut back', value: `${hs.cutDays} · ${hs.summerCut} Apr–Oct` },
          ]}
        />
        <Slider
          label="Price in Asia (Europe $1.50 below)"
          tone="green"
          value={h.state.asia}
          min={HOME_MIN}
          max={HOME_MAX}
          step={HOME_STEP}
          onChange={(v) => h.set({ asia: v })}
          display={`${usd(h.state.asia, 2)}/MMBtu`}
        />
        <Caption>
          {hs.cutDays === 0
            ? `The terminal takes its full feed gas every day; Calder never reaches the cap.`
            : hs.lngAvg < 0.05
              ? `The cap is below anything the region’s gas sells for: no cargo sails all year.`
              : `On ${hs.cutDays} days the terminal took less than its full feed gas rather than pay more, which held Calder near the ${usd(hs.cap, 2)} cap.`}
        </Caption>
      </Figure>

      <P>
        With Asia at {usd(9, 2)} the cap is {usd(H9.cap, 2)}, and the year looks almost exactly like Chapter 4’s: Calder averages {usd(H9.calderAvg, 2)}, the same to
        the cent as at Chapter 4’s LNG value. The difference is on the coldest days. Calder can’t rise above {usd(H9.cap, 2)}, because at that price the terminal would rather cut
        back than pay more for its gas; on {H9.cutDays} days it does, and the gas it leaves behind goes to the region’s own customers. LNG exports are a release valve for the region’s
        winter peaks.
      </P>
      <P>
        Lower the price in Asia and the valve opens wider. At {usd(6, 2)} the cap falls to {usd(H6.cap, 2)}, below many winter days’ prices, and the terminal cuts back
        on {H6.cutDays} days, all of them in winter; Calder averages {usd(H6.calderAvg, 2)}. At {usd(4, 2)} the cap is {usd(H4.cap, 2)}, the terminal is cut on{' '}
        {H4.cutDays} days, and Calder averages {usd(H4.calderAvg, 2)} and never rises above {usd(H4.calderMax, 2)}: the region’s price now follows a price on another
        continent, through the netback, rather than its own storage and weather. At {usd(3, 2)} nothing sails at all: the region has {fmt(BAYPORT_LNG_FEEDGAS_BCFD, 1)} Bcf/d more gas than buyers at home, and Calder
        sinks to an average of {usd(H3.calderAvg, 2)}, close to what it costs the wells to produce. A region that exports by ship is linked to the world’s prices only
        while its exports flow, and only from below: overseas prices can pull Calder down, but when they rise, Calder answers to its own weather.
      </P>

      <Challenge
        id="b"
        figure="Global Gas Trader · back home"
        question="Lower the price in Asia from where it starts. At what price, on the slider’s steps, is Bayport’s terminal first cut back on a day between April and October?"
        solved={solvedB}
        status={
          hs.summerCut > 0
            ? `At ${usd(h.state.asia, 2)} the terminal is cut back on ${hs.summerCut} days between April and October. Is that the first price where it happens?`
            : `At ${usd(h.state.asia, 2)} it takes its full feed gas all summer; its ${hs.cutDays} cut days are all in winter.`
        }
        success={`Solved: ${usd(SUMMER_ANSWER, 2)}. There the cap is ${usd(S_ANSWER.cap, 2)} and the terminal is cut back on ${S_ANSWER.summerCut} days between April and October; a step higher, at ${usd(SUMMER_ANSWER + HOME_STEP, 2)}, the cap is ${usd(S_ABOVE.cap, 2)} and every cut falls in winter. In summer the terminal competes with the storage fields for the region’s spare gas. Once its cap falls to what storage owners will pay to fill up for winter, the two share the gas and the summer price settles at the cap.`}
      />

      <P>
        Every price gap so far has opened because one thing was in short supply: room on a pipeline, room in storage, a power plant’s alternative fuel, a ship and the
        ocean it crosses. The most violent gaps open when several bind at once, on the coldest days of a hard winter, and when a storm cuts supply just as demand
        peaks. That is the subject of <a href={lessonHref('gas/5.5')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}

