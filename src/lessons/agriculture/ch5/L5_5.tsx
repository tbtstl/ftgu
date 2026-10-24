import { useMemo } from 'react';
import {
  Challenge,
  Checkbox,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  fmt,
  lessonHref,
  mix,
  niceDomain,
  niceTicks,
  scale,
  stepPath,
  usd,
  useScenario,
} from '../../../framework';
import {
  FIRST_TEST_YEAR,
  allSeasons,
  bestRatio,
  expectedYield,
  revenue,
  summarize,
  walkForward,
  type Farm,
  type Instrument,
} from '../../../engines/agriculture/hedging';
import { MARKET_YEARS } from '../../../engines/agriculture/market';
import { MARKET_LINE } from '../shared/tones';

export interface LabState {
  farm: Farm;
  kind: Instrument;
  /** Share of the expected crop hedged, percent. */
  ratio: number;
  costs: boolean;
}

export const LAB0: LabState = { farm: 'dryland', kind: 'futures', ratio: 100, costs: true };

/** Challenge 1: the futures hedge ratio (in tenths) that made the dryland farm's revenue least variable over the sixty years. */
export function leastVariableSolved(st: LabState): boolean {
  return st.farm === 'dryland' && st.kind === 'futures' && st.costs && st.ratio / 100 === bestRatio(allSeasons('dryland'), 'futures');
}

export interface WalkState {
  kind: 'futures' | 'puts';
  lookback: number;
  year: number;
}

export const WALK0: WalkState = { kind: 'futures', lookback: 20, year: 30 };

/** The year in which the walk-forward futures hedge on a 20-year lookback cost the most against not hedging. */
export function costliestYear(): number {
  const wf = walkForward('futures', 20);
  const all = allSeasons();
  let worst = wf.years[0];
  let gap = Infinity;
  wf.years.forEach((y, i) => {
    const d = wf.revenues[i] - revenue(all[y - 1], 'none', 0);
    if (d < gap) {
      gap = d;
      worst = y;
    }
  });
  return worst;
}

export function costliestSolved(st: WalkState): boolean {
  return st.kind === 'futures' && st.lookback === 20 && st.year === costliestYear();
}

function RevenueChart({ hedged, plain, yields }: { hedged: number[]; plain: number[]; yields: number[] }) {
  const [lo, hi] = niceDomain(Math.min(...hedged, ...plain), Math.max(...hedged, ...plain), 4);
  const x = scale(0.5, hedged.length + 0.5, 60, 620);
  const y = scale(lo, hi, 180, 24);
  const yy = scale(0, 260, 262, 206);
  const w = (x(1) - x(0)) * 0.72;
  const base = Math.max(lo, 0);
  return (
    <svg className="chart" viewBox="0 0 640 292" role="img" aria-label={`Cedar Bend’s corn revenue per acre in sixty simulated years: hedged from ${usd(Math.min(...hedged))} to ${usd(Math.max(...hedged))}, unhedged from ${usd(Math.min(...plain))} to ${usd(Math.max(...plain))}.`}>
      <text className="ax" x={60} y={14}>
        Revenue, $ an acre
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={60} x1={620} format={(v) => usd(v)} />
      {hedged.map((v, i) => (
        <rect key={i} x={x(i + 1) - w / 2} y={y(v)} width={w} height={Math.max(0.5, y(base) - y(v))} fill={mix('#fcfcfb', MARKET_LINE.futures, 0.45)} />
      ))}
      {plain.map((v, i) => (
        <circle key={i} cx={x(i + 1)} cy={y(v)} r={2.4} fill="#333" />
      ))}
      <text className="ax" x={60} y={200}>
        Cedar Bend’s yield, bushels an acre
      </text>
      {yields.map((v, i) => (
        <rect key={i} x={x(i + 1) - w / 2} y={yy(v)} width={w} height={yy(0) - yy(v)} fill={mix('#fcfcfb', MARKET_LINE.cash, 0.6)} />
      ))}
      {[1, 10, 20, 30, 40, 50, 60].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={282}>
          {t === 1 ? 'year 1' : t}
        </text>
      ))}
    </svg>
  );
}

function WalkChart({ years, ratios, diffs, year }: { years: number[]; ratios: number[]; diffs: number[]; year: number }) {
  const x = scale(0.5, MARKET_YEARS + 0.5, 60, 620);
  const ry = scale(0, 1.5, 110, 24);
  const [lo, hi] = niceDomain(Math.min(-50, ...diffs), Math.max(50, ...diffs), 4);
  const dy = scale(lo, hi, 260, 140);
  const w = (x(1) - x(0)) * 0.72;
  return (
    <svg className="chart" viewBox="0 0 640 292" role="img" aria-label={`The hedge ratio chosen each year from year ${FIRST_TEST_YEAR}, between ${fmt(Math.min(...ratios) * 100)}% and ${fmt(Math.max(...ratios) * 100)}%, and what hedging gained or lost against not hedging.`}>
      <text className="ax" x={60} y={14}>
        Hedge ratio chosen from the years before
      </text>
      <GridY y={ry} ticks={[0, 0.5, 1, 1.5]} x0={60} x1={620} format={(v) => `${fmt(v * 100)}%`} />
      <path d={stepPath(years.map(x), ratios.map(ry), (x(1) - x(0)) / 2)} fill="none" stroke={MARKET_LINE.futures} strokeWidth={2} />
      <text className="ax" x={60} y={132}>
        Revenue against not hedging, $ an acre
      </text>
      <GridY y={dy} ticks={niceTicks(lo, hi, 4)} x0={60} x1={620} format={(v) => usd(v)} baseline={0} />
      {diffs.map((v, i) => (
        <rect
          key={i}
          x={x(years[i]) - w / 2}
          y={Math.min(dy(v), dy(0))}
          width={w}
          height={Math.max(0.5, Math.abs(dy(v) - dy(0)))}
          fill={years[i] === year ? (v >= 0 ? GRAPHIC.green : GRAPHIC.red) : mix('#fcfcfb', v >= 0 ? GRAPHIC.green : GRAPHIC.red, 0.55)}
        />
      ))}
      {[FIRST_TEST_YEAR, 20, 30, 40, 50, 60].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={282}>
          {t === FIRST_TEST_YEAR ? `year ${t}` : t}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('lab', LAB0);
  const seasons = useMemo(() => allSeasons(s.state.farm), [s.state.farm]);
  const hedged = useMemo(() => seasons.map((x) => revenue(x, s.state.kind, s.state.ratio / 100, s.state.costs)), [seasons, s.state]);
  const plain = useMemo(() => seasons.map((x) => revenue(x, 'none', 0)), [seasons]);
  const sh = summarize(hedged);
  const sp = summarize(plain);
  const costPerAcre = useMemo(
    () => (s.state.kind === 'none' ? 0 : seasons.reduce((t, x) => t + revenue(x, s.state.kind, s.state.ratio / 100, false) - revenue(x, s.state.kind, s.state.ratio / 100, true), 0) / seasons.length),
    [seasons, s.state],
  );
  const solved1 = useMemo(() => leastVariableSolved(s.state), [s.state]);

  const w = useScenario('walk', WALK0);
  const wf = useMemo(() => walkForward(w.state.kind, w.state.lookback), [w.state.kind, w.state.lookback]);
  const dry = useMemo(() => allSeasons('dryland'), []);
  const diffs = wf.years.map((yr, i) => wf.revenues[i] - revenue(dry[yr - 1], 'none', 0));
  const test = dry.slice(FIRST_TEST_YEAR - 1);
  const inSample = useMemo(() => {
    const r = bestRatio(dry, w.state.kind);
    return { r, sd: summarize(test.map((x) => revenue(x, w.state.kind, r))).sd };
  }, [dry, test, w.state.kind]);
  const wfSd = summarize(wf.revenues).sd;
  const plainSd = summarize(test.map((x) => revenue(x, 'none', 0))).sd;
  const selIndex = Math.max(0, Math.min(wf.years.length - 1, w.state.year - FIRST_TEST_YEAR));
  const solved2 = useMemo(() => costliestSolved(w.state), [w.state]);

  return (
    <LessonPage id="agriculture/5.5">
      <P>
        The last four lessons built the pieces of a grain strategy: the hedge, the curve, the basis and the forecast. A strategy is a rule — sell this much, on
        this day, with this instrument — and the way to judge a rule is to replay it on history, a <K tone="violet">backtest</K>. Backtests lie in three familiar
        ways. They use information nobody had at the time (<i>look-ahead</i>). They tune the rule to the very years they then judge it on (<i>overfitting</i>). And
        they leave out what trading costs. This lesson tests Cedar Bend’s marketing program honestly, on the sixty simulated years, avoiding all three.
      </P>
      <P>
        The program is simple. On March 1 Cedar Bend can sell December futures on part of its expected crop — its average yield is{' '}
        {fmt(expectedYield('dryland'))} bushels an acre — or buy December <K tone="violet">put options</K> instead. A put is the right, but not the duty, to sell
        December futures at a set price, the strike; Cedar Bend buys puts struck at the March futures price. If prices fall, the put pays like a short futures
        position; if they rise, it expires worthless and costs only what was paid for it. We price the puts with Black’s formula from the volatility our market
        implies on March 1, about 15% a year — less than the 20 to 30% real corn options often trade at, because our simulated market has no news about demand,
        energy or policy before harvest. Every cost is counted: about a cent a bushel in commissions and slippage on futures, plus interest on the margin; for
        options, the premium, a cent each way of bid–ask spread and a commission. At harvest Cedar Bend sells its corn at Fairview and closes the hedge. In the
        next demonstration the bars are revenue per acre with the hedge, the dots without it, and the strip at the bottom the farm’s yield. Choose the farm, the
        instrument and how much of the expected crop to hedge:
      </P>

      <Figure name="Agricultural Strategy Lab" scenario={s}>
        <RevenueChart hedged={hedged} plain={plain} yields={seasons.map((x) => x.yield)} />
        <Legend
          items={[
            { label: 'Revenue, hedged', color: mix('#fcfcfb', MARKET_LINE.futures, 0.45) },
            { label: 'Revenue, not hedged', color: '#333' },
            { label: 'Yield', color: mix('#fcfcfb', MARKET_LINE.cash, 0.6) },
          ]}
        />
        <Readouts
          items={[
            { label: 'average revenue', value: `${usd(sh.mean)} an acre`, tone: 'green' },
            { label: 'spread (std. dev.)', value: `${usd(sh.sd)} (unhedged ${usd(sp.sd)})`, tone: sh.sd <= sp.sd ? 'green' : 'red' },
            { label: 'worst year', value: `${usd(sh.worst)} (unhedged ${usd(sp.worst)})`, tone: sh.worst >= sp.worst ? 'green' : 'red' },
            { label: 'costs', value: `${usd(costPerAcre, 2)} an acre a year` },
          ]}
        />
        <Segmented
          label="Farm"
          value={s.state.farm}
          onChange={(v) => s.set({ farm: v })}
          options={[
            { value: 'dryland', label: 'Dryland' },
            { value: 'irrigated', label: 'Irrigated' },
          ]}
        />
        <Segmented
          label="Instrument"
          value={s.state.kind}
          onChange={(v) => s.set({ kind: v })}
          options={[
            { value: 'none', label: 'No hedge' },
            { value: 'futures', label: 'Futures' },
            { value: 'puts', label: 'Puts' },
          ]}
        />
        <Slider label="Share of expected crop hedged" tone="violet" value={s.state.ratio} min={0} max={150} step={10} onChange={(v) => s.set({ ratio: v })} display={`${s.state.ratio}%`} />
        <Checkbox label="Count trading costs" checked={s.state.costs} onChange={(v) => s.set({ costs: v })} />
      </Figure>

      <P>
        Unhedged, Cedar Bend’s dryland corn brought $742 an acre on average, varying by $110 from year to year, and $543 in its worst year. Hedging all of the
        expected crop with futures makes things worse: the spread grows to $133 and the worst year falls to $49 an acre. The reason is physical. Cedar Bend’s
        yield and the price move in opposite directions — their correlation over the sixty years is −0.75 — because the droughts that cut the farm’s yield, as
        in <a href={lessonHref('agriculture/3.2')}>Lesson 3.2</a>, cut the valley’s and raise the price. In a drought the farm has fewer bushels to sell, and a
        full hedge loses money on bushels it never grew. The farm already has a <K tone="gold">natural hedge</K>, and a futures hedge fights it. Puts don’t: in a
        drought they expire worthless at a known cost, and in a glut they pay. With puts on the whole expected crop the spread falls to $87 and the worst year
        rises to $585, at a cost of about $11 an acre a year in average revenue, most of it fees and spreads. Now give the farm center pivots. Irrigated, its yield hardly depends on the weather, the correlation weakens
        to −0.39, and a full futures hedge becomes the best tool: the spread falls from $172 to $90. The right hedge depends on the farm’s physical risk.
      </P>

      <Challenge
        id="a"
        question="For the dryland farm with futures and costs counted, what share of the expected crop, to the nearest 10%, made revenue least variable over the sixty years?"
        solved={solved1}
        status={
          s.state.farm !== 'dryland' || s.state.kind !== 'futures' || !s.state.costs
            ? 'Choose the dryland farm and futures, with costs counted.'
            : `Hedging ${s.state.ratio}% leaves revenue varying by ${usd(sh.sd)} an acre.`
        }
        success={`Solved: hedging ${s.state.ratio}% of the expected crop leaves Cedar Bend’s revenue varying by ${usd(sh.sd)} an acre, the least of any share. Less than half: the rest of the protection comes free from the natural hedge. But notice how we found it — by looking at all sixty years at once, which nobody hedging in year 1 could do.`}
      />

      <H2>Testing on years the rule hasn’t seen</H2>
      <P>
        That 40% was chosen with all sixty years in view, and then judged on the same years. A farmer in year 30 couldn’t have known it. The honest test is{' '}
        <K tone="violet">walk-forward</K>: each year from year {FIRST_TEST_YEAR} on, choose the share that would have been best over the years just before — the
        lookback — and use it for that year alone; then step forward a year and choose again. Every decision uses only the past. In the next demonstration the
        line is the share chosen each year, and the bars are what hedging gained or lost against not hedging. Choose the instrument and the lookback, and pick out
        a year:
      </P>

      <Figure name="Agricultural Strategy Lab · walk-forward" scenario={w}>
        <WalkChart years={wf.years} ratios={wf.ratios} diffs={diffs} year={w.state.year} />
        <Readouts
          items={[
            { label: 'walk-forward spread', value: `${usd(wfSd)} an acre`, tone: wfSd < plainSd ? 'green' : 'red' },
            { label: 'not hedging', value: usd(plainSd) },
            { label: `hindsight best (${fmt(inSample.r * 100)}%)`, value: usd(inSample.sd), tone: 'violet' },
            { label: `year ${wf.years[selIndex]}`, value: `${diffs[selIndex] >= 0 ? '+' : '−'}${usd(Math.abs(diffs[selIndex]))} an acre at ${fmt(wf.ratios[selIndex] * 100)}%`, tone: diffs[selIndex] >= 0 ? 'green' : 'red' },
          ]}
        />
        <Segmented
          label="Instrument"
          value={w.state.kind}
          onChange={(v) => w.set({ kind: v })}
          options={[
            { value: 'futures', label: 'Futures' },
            { value: 'puts', label: 'Puts' },
          ]}
        />
        <Slider label="Lookback" value={w.state.lookback} min={5} max={40} step={5} onChange={(v) => w.set({ lookback: v })} display={`${w.state.lookback} years`} />
        <Slider label="Year" value={w.state.year} min={FIRST_TEST_YEAR} max={MARKET_YEARS} onChange={(v) => w.set({ year: v })} display={String(w.state.year)} />
      </Figure>

      <P>
        With futures and a 20-year lookback, the walk-forward revenue over years 11 to 60 varies by $103 an acre — no better than not hedging at all, $102 over
        the same fifty years — although the hindsight-best share promised $94. The chosen share wanders between 10% and 100% as droughts enter and leave the
        lookback window, so each year’s hedge is tuned to a past that doesn’t repeat. With a 5-year lookback it is worse, $121. Puts survive the test: walked
        forward on the same 20 years their revenue varies by $83, because a put’s protection doesn’t depend on a fragile estimate of how yield and price move
        together. American farmers, for the same reason, lean on revenue insurance whose guarantee rises with the harvest price — so that in a drought it pays for the lost
        bushels at the higher price — and hedge only part of their crop with futures.
      </P>

      <Challenge
        id="b"
        question="With futures and a 20-year lookback, find the year in which hedging cost Cedar Bend the most against not hedging."
        solved={solved2}
        status={
          w.state.kind !== 'futures' || w.state.lookback !== 20
            ? 'Choose futures and a 20-year lookback.'
            : `In year ${wf.years[selIndex]} the hedge ${diffs[selIndex] >= 0 ? 'gained' : 'cost'} ${usd(Math.abs(diffs[selIndex]))} an acre.`
        }
        success={`Solved: in year ${wf.years[selIndex]} the walk-forward rule hedged ${fmt(wf.ratios[selIndex] * 100)}% of the expected crop, a drought cut the yield to ${fmt(dry[wf.years[selIndex] - 1].yield)} bushels an acre, and the futures, sold low in March, had to be bought back high: the hedge cost ${usd(-diffs[selIndex])} an acre. A backtest that reports only the average hides this year; a farm has to survive it.`}
      />

      <P>
        Chapter 5 turned the physical story into prices: futures and their convergence, the curve and the reward for storage, the basis and the value of a route,
        the worth of a forecast, and the honest test of a plan. <FigRef to="Agricultural Strategy Lab">The lab</FigRef> showed the theme of the course in one
        number, the −0.75 that ties Cedar Bend’s yield to the price: the weather that grows the crop also sets what it is worth. Chapter 6 puts everything
        together — a region to farm, a season to forecast, grain to store and ship, and a trading desk to run.
      </P>
    </LessonPage>
  );
}
