import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Challenge,
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
  usd,
  linePath,
  mix,
  niceDomain,
  niceTicks,
  scale,
} from '../../../framework';
import { CHARTER_RATE, ELEVATOR_OF, MERCHANT_RUSH, MERCHANT_STORAGE, harvestCarryShare, merchantYear, type MerchantPlan } from '../../../engines/agriculture/capstone';
import { harvestRush } from '../../../engines/agriculture/elevator';
import { MARKET_YEARS, cropYear } from '../../../engines/agriculture/market';
import type { Hub } from '../../../engines/agriculture/logistics';
import { meanValley } from '../../../engines/agriculture/world';
import { MARKET_LINE } from '../shared/tones';
import { DEFAULT_MERCHANT, resetSpread, resetStorageAndCharter, setMerchant, useCapstone } from '../shared/capstone';
import { SoFar, elevatorPhrase } from '../shared/SoFar';

const HISTORY = Array.from({ length: MARKET_YEARS }, (_, i) => i + 1);
const ALL = Array.from({ length: 100 }, (_, i) => i + 1);
const NEW = ALL.slice(MARKET_YEARS);

const k$ = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`;
const m$ = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, 2)}M`;
/** Money to the thousand, for differences the two-decimal millions hide. */
const m3$ = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, 3)}M`;
/** Money in prose: "$182,000". */
const thousands = (v: number) => usd(Math.round(v / 1000) * 1000);
const millions = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, 2)} million`;

export function average(p: MerchantPlan, years: number[], f: (x: ReturnType<typeof merchantYear>) => number = (x) => x.total, hub: Hub = 'fairview'): number {
  return years.reduce((a, y) => a + f(merchantYear(p, y, hub)), 0) / years.length;
}

/** The spread slider's whole cents. */
export const SPREADS = Array.from({ length: 31 }, (_, i) => 30 + i);

let buyingCurve: Array<{ cents: number; buying: number }> | null = null;
/** What buying earned on average over the history at each spread; buying doesn't depend on the district. */
export function buyingBySpread(): Array<{ cents: number; buying: number }> {
  return (buyingCurve ??= SPREADS.map((cents) => ({ cents, buying: average({ ...DEFAULT_MERCHANT, spreadCents: cents }, HISTORY, (x) => x.buying) })));
}

/** The harvest spread (whole cents) that earned the most from buying over the sixty seasons. */
export function bestSpread(): number {
  return buyingBySpread().reduce((a, b) => (b.buying > a.buying + 1e-6 ? b : a)).cents;
}

/** Challenge 1 solves when the predicted spread earned within $10,000 a season of the best: 37–40¢, the top of the curve. */
export const SPREAD_TOLERANCE = 10000;
export function spreadGuessSolved(cents: number | null): boolean {
  if (cents === null) return false;
  const curve = buyingBySpread();
  const at = curve.find((r) => r.cents === cents);
  const top = Math.max(...curve.map((r) => r.buying));
  return !!at && at.buying >= top - SPREAD_TOLERANCE;
}

/** Challenge 2: storing until July, the share of full carry (in tenths) the curve must pay at harvest before storing that earned the most over the sixty seasons. */
export function bestMinCarry(spreadCents: number, hub: Hub = 'fairview'): number {
  let best = 0;
  let top = -Infinity;
  for (let t = 0; t <= 10; t++) {
    const v = average({ spreadCents, storeUntil: 'Jul', storeMinCarry: t / 10, charterMillions: 0 }, HISTORY, (x) => x.storage, hub);
    if (v > top + 1e-6) {
      top = v;
      best = t / 10;
    }
  }
  return best;
}

/** Below this much a season from storage at the best threshold, the bins are too empty after harvest for the storage challenge to mean anything, $. */
export const MIN_STORAGE = 20000;

/**
 * Challenge 2: storing until July, the threshold solves when it is within one step of the best and
 * earns within 5% of it — 50% or 60% of full carry at the spreads that leave corn to store.
 */
export function storageGuessSolved(p: MerchantPlan, hub: Hub = 'fairview'): boolean {
  if (p.storeUntil !== 'Jul') return false;
  const v = (t: number) => average({ ...p, storeMinCarry: t, charterMillions: 0 }, HISTORY, (x) => x.storage, hub);
  const best = bestMinCarry(p.spreadCents, hub);
  const top = v(best);
  if (top < MIN_STORAGE) return false;
  return Math.abs(p.storeMinCarry - best) <= 0.1 + 1e-9 && v(p.storeMinCarry) >= top * 0.95;
}

/** The seasons of the history a storage threshold skips that storing whenever the curve pays any carry would have kept, and what storing them earned a bushel. */
export function skippedSeasons(spreadCents: number, threshold: number, hub: Hub = 'fairview'): { years: number[]; shares: number[]; perBushel: number } {
  const all = { spreadCents, storeUntil: 'Jul' as const, storeMinCarry: 0, charterMillions: 0 };
  const years = HISTORY.filter((y) => merchantYear(all, y, hub).stored > 0 && harvestCarryShare(y) < threshold - 1e-9);
  const stored = years.reduce((a, y) => a + merchantYear(all, y, hub).stored, 0);
  const earned = years.reduce((a, y) => a + merchantYear(all, y, hub).storage, 0);
  return { years, shares: years.map(harvestCarryShare), perBushel: stored > 0 ? earned / stored : 0 };
}

/** Challenge 3: the largest charter, in whole millions of bushels, with which no season of the history loses money. */
export function largestSafeCharter(p: MerchantPlan, hub: Hub = 'fairview'): number {
  let ok = 0;
  for (let m = 0; m <= 10; m++) {
    if (HISTORY.every((y) => merchantYear({ ...p, charterMillions: m }, y, hub).total >= 0)) ok = m;
    else break;
  }
  return ok;
}

/** The worst season of a set, and what the merchant made in it. */
function worstOf(p: MerchantPlan, years: number[], hub: Hub): { year: number; total: number } {
  return years.map((y) => ({ year: y, total: merchantYear(p, y, hub).total })).reduce((a, b) => (b.total < a.total ? b : a));
}

function RushChart({ stocks }: { stocks: number[] }) {
  const x = scale(0, stocks.length, 60, 620);
  const y = scale(0, 4e6, 190, 24);
  return (
    <svg className="chart" viewBox="0 0 640 222" role="img" aria-label={`Corn in the elevator’s bins through a ${stocks.length}-day harvest, peaking at ${fmt(Math.max(...stocks) / 1e6, 2)} million bushels.`}>
      <text className="ax" x={60} y={14}>
        Corn in the bins, million bushels
      </text>
      <GridY y={y} ticks={[0, 1e6, 2e6, 3e6, 4e6]} x0={60} x1={620} format={(v) => fmt(v / 1e6)} baseline={0} />
      <path d={linePath([x(0), ...stocks.map((_, i) => x(i + 1))], [y(0), ...stocks.map(y)])} fill="none" stroke={MARKET_LINE.cash} strokeWidth={2.5} />
      <line x1={60} x2={620} y1={y(MERCHANT_RUSH.capacity)} y2={y(MERCHANT_RUSH.capacity)} stroke="#333" strokeDasharray="6 4" />
      <text className="ax ax-e" x={618} y={y(MERCHANT_RUSH.capacity) - 5}>
        bin space
      </text>
      {[0, 10, 20, 30, 40, 50].map((d) => (
        <text key={d} className="ax ax-m" x={x(d)} y={210}>
          {d === 0 ? 'harvest begins' : `day ${d}`}
        </text>
      ))}
    </svg>
  );
}

function BusinessBars({ p, hub }: { p: MerchantPlan; hub: Parameters<typeof merchantYear>[2] }) {
  const rows = ALL.map((y) => merchantYear(p, y, hub));
  const tops = rows.map((r) => Math.max(0, r.buying) + Math.max(0, r.storage) + Math.max(0, r.charter));
  const bots = rows.map((r) => Math.min(0, r.storage) + Math.min(0, r.charter));
  const [lo, hi] = niceDomain(Math.min(0, ...bots), Math.max(...tops), 4);
  const x = scale(0.5, ALL.length + 0.5, 60, 620);
  const y = scale(lo, hi, 196, 24);
  const w = (x(1) - x(0)) * 0.78;
  const colors = { buying: MARKET_LINE.cash, storage: MARKET_LINE.futures, charter: GRAPHIC.blue };
  return (
    <svg className="chart" viewBox="0 0 640 228" role="img" aria-label={`The merchant’s profit in each of a hundred seasons, from ${m$(Math.min(...rows.map((r) => r.total)))} to ${m$(Math.max(...rows.map((r) => r.total)))}.`}>
      <text className="ax" x={60} y={14}>
        Profit by season: buying, storage and the charter
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={60} x1={620} format={m$} baseline={0} />
      {rows.map((r, i) => {
        let up = 0;
        let down = 0;
        return (
          <g key={r.year}>
            {(['buying', 'storage', 'charter'] as const).map((part) => {
              const v = r[part];
              if (Math.abs(v) < 1) return null;
              const from = v >= 0 ? up : down;
              const to = from + v;
              if (v >= 0) up = to;
              else down = to;
              return <rect key={part} x={x(i + 1) - w / 2} y={Math.min(y(from), y(to))} width={w} height={Math.max(0.5, Math.abs(y(to) - y(from)))} fill={mix('#fcfcfb', colors[part], 0.7)} />;
            })}
          </g>
        );
      })}
      <line x1={x(60.5)} x2={x(60.5)} y1={20} y2={196} stroke="#333" strokeDasharray="4 3" />
      <text className="ax" x={x(60.5) + 5} y={30}>
        new seasons
      </text>
      {[1, 20, 40, 60, 80, 100].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={214}>
          {t === 1 ? 'season 1' : t}
        </text>
      ))}
    </svg>
  );
}

function SpreadCurve({ guess, current }: { guess: number; current: number }) {
  const pts = buyingBySpread();
  const best = bestSpread();
  const [lo, hi] = niceDomain(Math.min(...pts.map((p) => p.buying)), Math.max(...pts.map((p) => p.buying)), 4);
  const x = scale(30, 60, 70, 620);
  const y = scale(lo, hi, 140, 24);
  const at = (c: number) => pts.find((p) => p.cents === c)?.buying ?? 0;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 172"
      role="img"
      aria-label={`Buying margin over the sixty seasons of the history against the spread: best at ${best} cents, ${m3$(at(best))} a season; your prediction, ${guess} cents, ${m3$(at(guess))}.`}
    >
      <text className="ax" x={70} y={14}>
        Buying margin, average over the history
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 3)} x0={70} x1={620} format={m$} />
      <path d={linePath(pts.map((p) => x(p.cents)), pts.map((p) => y(p.buying)))} fill="none" stroke={MARKET_LINE.cash} strokeWidth={2.5} />
      <line x1={x(current)} x2={x(current)} y1={24} y2={140} stroke="#bbb" strokeDasharray="2 3" />
      <circle cx={x(best)} cy={y(at(best))} r={5} fill={MARKET_LINE.cash} />
      <text className="ax ax-m" x={x(best)} y={y(at(best)) - 9}>
        best, {best}¢
      </text>
      <circle cx={x(guess)} cy={y(at(guess))} r={8} fill="none" stroke="#333" strokeWidth={1.5} />
      <text className="ax ax-m" x={x(guess)} y={y(at(guess)) + 22}>
        your prediction
      </text>
      {[30, 35, 40, 45, 50, 55, 60].map((c) => (
        <text key={c} className="ax ax-m" x={x(c)} y={158}>
          {c}¢
        </text>
      ))}
      <text className="ax ax-e" x={620} y={171}>
        harvest spread
      </text>
    </svg>
  );
}

interface Checks {
  /** The spread predicted for challenge 1; the storage rule and the charter checked for challenges 2 and 3, as keys of the plan they were checked on. */
  a: number | null;
  b: string | null;
  c: string | null;
}

export default function Lesson() {
  const { merchant: plan, farm } = useCapstone();
  const hub = ELEVATOR_OF[farm.district];
  const [seasonYear, setSeasonYear] = useState(40);
  const season = { year: seasonYear, set: setSeasonYear };
  const c = cropYear(season.year);
  const rush = useMemo(() => harvestRush({ ...MERCHANT_RUSH, harvest: MERCHANT_RUSH.harvest * (c.valley / meanValley()), spread: plan.spreadCents / 100 }), [c.valley, plan.spreadCents]);
  const my = merchantYear(plan, season.year, hub);

  // Predict, then check: each challenge's deciding number stays hidden until the reader commits to an answer.
  const [checks, setChecks] = useState<Checks>({ a: null, b: null, c: null });
  const keyB = JSON.stringify([plan.spreadCents, plan.storeUntil, plan.storeMinCarry, hub]);
  const keyC = JSON.stringify([plan, hub]);
  const checkedB = checks.b === keyB;
  const checkedC = checks.c === keyC;

  const spreadBest = useMemo(() => bestSpread(), []);
  const buyingAt = (cents: number) => buyingBySpread().find((r) => r.cents === cents)?.buying ?? 0;
  const solved1 = spreadGuessSolved(checks.a);
  const minCarryBest = useMemo(() => bestMinCarry(plan.spreadCents, hub), [plan.spreadCents, hub]);
  const solved2 = checkedB && storageGuessSolved(plan, hub);
  const safe = useMemo(() => largestSafeCharter(plan, hub), [plan, hub]);
  const solved3 = checkedC && plan.charterMillions === safe && safe > 0;
  const [shown, setShown] = useState({ storage: false, worst: false });
  useEffect(() => {
    if ((solved2 && !shown.storage) || (solved3 && !shown.worst)) setShown({ storage: shown.storage || solved2, worst: shown.worst || solved3 });
  }, [solved2, solved3, shown]);

  const histAvg = useMemo(() => average(plan, HISTORY, undefined, hub), [plan, hub]);
  const newAvg = useMemo(() => average(plan, NEW, undefined, hub), [plan, hub]);
  const worstHist = useMemo(() => worstOf(plan, HISTORY, hub), [plan, hub]);
  const worstNew = useMemo(() => worstOf(plan, NEW, hub), [plan, hub]);
  const storageAvg = useMemo(() => average(plan, HISTORY, (x) => x.storage, hub), [plan, hub]);
  const charterAvg = useMemo(() => average(plan, HISTORY, (x) => x.charter, hub), [plan, hub]);
  const bestStorage = useMemo(() => average({ ...plan, storeUntil: 'Jul', storeMinCarry: minCarryBest, charterMillions: 0 }, HISTORY, (x) => x.storage, hub), [plan, minCarryBest, hub]);

  // The numbers the prose quotes, at the reader's own spread.
  const anyCarry = { spreadCents: plan.spreadCents, storeUntil: 'Jul' as const, storeMinCarry: 0, charterMillions: 0 };
  const leftAvg = useMemo(() => average(anyCarry, HISTORY, (x) => x.stored, hub), [plan.spreadCents, hub]);
  const storeAnyAvg = useMemo(() => average(anyCarry, HISTORY, (x) => x.storage, hub), [plan.spreadCents, hub]);
  const littleToStore = bestStorage < MIN_STORAGE;
  const inverted = HISTORY.filter((y) => harvestCarryShare(y) < 0);
  const leftAfterRush = (y: number) => {
    const r = harvestRush({ ...MERCHANT_RUSH, harvest: MERCHANT_RUSH.harvest * (cropYear(y).valley / meanValley()), spread: plan.spreadCents / 100 });
    return r.stocks[r.stocks.length - 1] ?? 0;
  };
  const skipped = useMemo(() => skippedSeasons(plan.spreadCents, plan.storeMinCarry, hub), [plan.spreadCents, plan.storeMinCarry, hub]);
  const byMonth = useMemo(
    () => (['Mar', 'May', 'Jul'] as const).map((u) => average({ ...plan, storeUntil: u, charterMillions: 0 }, HISTORY, (x) => x.storage, hub)),
    [plan, hub],
  );
  const perMillion = HISTORY.map((y) => ({ year: y, charter: merchantYear({ ...DEFAULT_MERCHANT, charterMillions: 1 }, y).charter, valley: cropYear(y).valley }));
  const charterPerMillion = perMillion.reduce((a, r) => a + r.charter, 0) / perMillion.length;
  const charterLosers = perMillion.filter((r) => r.charter < 0);
  const shortest = [...perMillion].sort((a, b) => a.valley - b.valley).slice(0, charterLosers.length);
  const losersAreShortest = charterLosers.length > 0 && charterLosers.every((r) => shortest.some((q) => q.year === r.year));
  const cushion = charterLosers.map((r) => ({ year: r.year, total: merchantYear({ ...plan, charterMillions: 0 }, r.year, hub).total, perMillion: -r.charter })).reduce((a, b) => (b.total / b.perMillion < a.total / a.perMillion ? b : a), {
    year: 0,
    total: Infinity,
    perMillion: 1,
  });
  const and = (xs: number[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

  return (
    <LessonPage id="agriculture/6.4">
      <P>
        A farm grows grain; a merchant moves it. Your business also runs the grain merchant in your district — {elevatorPhrase(farm)}, for{' '}
        <a href={lessonHref('agriculture/6.1')}>the farm you designed</a> — and, whatever the district, gives it the plant of{' '}
        <a href={lessonHref('agriculture/4.3')}>Lesson 4.3</a>’s elevator: a draw area that grows 12 million bushels of corn in an ordinary season, 3 million
        bushels of bins, a shuttle train a week and a stream of trucks to the ethanol plant. The merchant earns money three ways, each from an earlier lesson.
        It <K tone="gold">buys</K> at harvest, below the corn’s value by its spread. It <K tone="violet">stores</K> the corn left in its bins when the rush is
        over, hedged, when the curve pays enough. And it <K tone="blue">ships</K>, chartering barges before the season at the rate the barge lines offer,{' '}
        {fmt(CHARTER_RATE * 100)} cents a bushel, and earning the export basis of <a href={lessonHref('agriculture/5.3')}>Lesson 5.3</a> on every bushel. The
        rules you set run through every season: the sixty of the market history and the forty new ones.
      </P>
      <SoFar parts={['farm']} />
      <P>
        Start with the harvest. In the next demonstration the line is the corn in the elevator’s bins through one season’s harvest, and the dashed line its bin
        space. Choose the season and the spread:
      </P>

      <Figure name="Grain Merchant" onReset={resetSpread}>
        <RushChart stocks={rush.stocks} />
        <Readouts
          items={[
            { label: `season ${season.year}: valley harvest`, value: `${fmt(c.valley)} million bu`, tone: 'gold' },
            { label: 'bought at harvest', value: `${fmt(rush.bought / 1e6, 2)} million bu` },
            { label: 'turned away', value: `${fmt(rush.turnedAway / 1e6, 2)} million bu`, tone: rush.turnedAway > 1 ? 'red' : 'ink' },
            { label: 'buying margin, this season', value: m$(my.buying), tone: 'green' },
          ]}
        />
        <Slider label="Season" value={season.year} min={1} max={100} onChange={season.set} display={season.year > MARKET_YEARS ? `${season.year} (new)` : String(season.year)} />
        <Slider label="Harvest spread" tone="gold" value={plan.spreadCents} min={30} max={60} onChange={(v) => setMerchant({ spreadCents: v })} display={`${plan.spreadCents}¢`} />
        <Button onClick={() => setChecks({ ...checks, a: checks.a === null ? plan.spreadCents : null })} primary={checks.a === null}>
          {checks.a === null ? 'Check this spread on all sixty seasons' : 'Predict again'}
        </Button>
        {checks.a !== null && <SpreadCurve guess={checks.a} current={plan.spreadCents} />}
      </Figure>

      <P>
        Every season is a different harvest. In season 40, the reference season, a 35-cent spread buys 6.2 million bushels and earns $1.68 million over handling.
        In season 19, with the valley’s crop just past the network’s limit, the same spread fills the bins and turns 450,000 bushels away. In season 46, the drought,
        the elevator buys only 3.2 million bushels and earns $0.86 million.
        {plan.spreadCents !== DEFAULT_MERCHANT.spreadCents ? ` (The demonstration is at your ${plan.spreadCents}-cent spread; set 35 cents to follow these numbers.)` : ''} A
        narrow spread buys more corn but turns farmers away in big years; a wide one keeps the bins clear but buys less. One spread has to serve them all.
      </P>
      <P>
        A real elevator earns on more than the spread. It grades every load and buys off-grade corn at the discounts of{' '}
        <a href={lessonHref('agriculture/4.1')}>Lesson 4.1</a>, blends it into trains that still make No. 2, as in Lesson 4.3, and charges farmers for drying
        wet corn. Our merchant leaves those out, so its margins are a floor: in a frost year like the one in Lesson 4.3, blending alone was worth tens of
        thousands of dollars a train. What it keeps is the core of the business — buy at a spread, hold or sell, ship — and the discipline of setting each rule
        for all seasons at once.
      </P>

      <Challenge
        id="a"
        question="Lesson 4.3 chose 35¢ for an ordinary harvest. Which spread, in whole cents, earned the most from buying on average over the sixty seasons of the history? Estimate first — try a big harvest (season 19) and a short one (season 46) at a few spreads — then set your spread and check it on all sixty."
        solved={solved1}
        status={
          checks.a === null
            ? 'Set the spread you predict, then press “Check this spread on all sixty seasons”.'
            : `Your ${checks.a}¢ earned ${m3$(buyingAt(checks.a))} a season on average; the best spread, ${spreadBest}¢, earned ${m3$(buyingAt(spreadBest))}. Press “Predict again” to try once more.`
        }
        success={`Solved: your ${checks.a}¢ earned ${m3$(buyingAt(checks.a ?? spreadBest))} a season, within $10,000 of the best, ${spreadBest}¢ at ${m3$(buyingAt(spreadBest))} — a few cents wider than Lesson 4.3’s 35¢, because over many seasons the big harvests, when a narrow spread turns farmers away, cost more than the small ones save. The spread on the slider is the one your business keeps.`}
      />

      <H2>Storing and shipping</H2>
      <P>
        {leftAvg >= 0.1e6
          ? `When the rush is over the bins still hold corn — about ${fmt(leftAvg / 1e6, 1)} million bushels in an average season at your ${plan.spreadCents}-cent spread. The merchant can sell it at harvest, or keep it, hedged, and earn what the curve pays.`
          : `At your ${plan.spreadCents}-cent spread the bins are nearly empty when the rush is over, so there is little to store; at 35 cents they still hold about 2 million bushels in an average season, which the merchant can sell at harvest or keep, hedged, to earn what the curve pays.`}{' '}
        An elevator’s own bins cost little to run at the margin, about {fmt(MERCHANT_STORAGE * 100)} cent a bushel a month for fans and shrink, plus interest —
        less than the commercial rate behind full carry — so storing pays when the curve, as it stands at harvest, pays a large enough share of full carry, as in{' '}
        <a href={lessonHref('agriculture/5.2')}>Lesson 5.2</a>. The charter is a bet of a different kind: it pays the export basis less{' '}
        {fmt(CHARTER_RATE * 100)} cents on every bushel chartered, a good bet in most seasons and a losing one when the valley’s crop is too short to fill the
        river. In the next demonstration each bar is one season’s profit in its three parts, the history on the left and the new seasons on the right. Set the
        storage and the charter:
      </P>

      <Figure name="Grain Merchant · the business" onReset={resetStorageAndCharter}>
        <BusinessBars p={plan} hub={hub} />
        <Legend
          items={[
            { label: 'Buying', color: mix('#fcfcfb', MARKET_LINE.cash, 0.7) },
            { label: 'Storage', color: mix('#fcfcfb', MARKET_LINE.futures, 0.7) },
            { label: 'Charter', color: mix('#fcfcfb', GRAPHIC.blue, 0.7) },
          ]}
        />
        <Readouts
          items={[
            { label: 'average season, history', value: m$(histAvg), tone: 'green' },
            { label: 'average, new seasons', value: m$(newAvg), tone: 'green' },
            ...(checkedB || shown.storage ? [{ label: 'storage, average', value: k$(storageAvg), tone: 'violet' as const }] : []),
            ...(checkedC || shown.worst ? [{ label: `worst season, history (${worstHist.year})`, value: m$(worstHist.total), tone: worstHist.total >= 0 ? ('green' as const) : ('red' as const) }] : []),
            { label: `worst, new seasons (${worstNew.year})`, value: m$(worstNew.total), tone: worstNew.total >= 0 ? 'green' : 'red' },
          ]}
        />
        <Segmented
          label="Store until"
          value={plan.storeUntil}
          onChange={(v) => setMerchant({ storeUntil: v })}
          options={[
            { value: 'none', label: 'Sell at harvest' },
            { value: 'Mar', label: 'March' },
            { value: 'May', label: 'May' },
            { value: 'Jul', label: 'July' },
          ]}
        />
        <Slider label="Store only if the curve pays at least" tone="violet" value={plan.storeMinCarry * 100} min={0} max={100} step={10} onChange={(v) => setMerchant({ storeMinCarry: v / 100 })} display={`${fmt(plan.storeMinCarry * 100)}% of full carry`} />
        <Slider label="Barge charter" tone="blue" value={plan.charterMillions} min={0} max={10} onChange={(v) => setMerchant({ charterMillions: v })} display={`${plan.charterMillions} million bu`} />
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 24 }}>
          <Button onClick={() => setChecks({ ...checks, b: keyB })} disabled={checkedB} primary={!checkedB}>
            {checkedB ? 'Storage rule checked' : 'Check the storage rule'}
          </Button>
          <Button onClick={() => setChecks({ ...checks, c: keyC })} disabled={checkedC} primary={!checkedC}>
            {checkedC ? 'Charter checked' : 'Check the charter'}
          </Button>
        </div>
      </Figure>

      <P>
        Storing until July whenever the curve pays any carry at all earns about {thousands(storeAnyAvg)} a season at your {plan.spreadCents}-cent spread.
        {inverted.length === 1
          ? ` Only one season of the history is inverted at harvest — season ${inverted[0]}, the drought, ${leftAfterRush(inverted[0]) < 1 ? 'when the bins are empty anyway' : 'which even a threshold of 0% skips'} — but many pay too little.`
          : ` ${inverted.length} seasons of the history are inverted at harvest, and many more pay too little.`}{' '}
        The merchant’s own cost of keeping a bushel, about a cent a month plus interest on the corn, comes to a little over half of full carry, and in a season
        when the curve pays less than that, the hedged corn earns less than it costs to keep — even though the curve still pays to store.
      </P>

      <Challenge
        id="b"
        question="Store until July. From the merchant’s own cost of keeping corn, predict the share of full carry, to the nearest 10%, the curve should pay at harvest before the merchant stores, to earn the most from storage over the sixty seasons. Set it, then press “Check the storage rule”."
        solved={solved2}
        status={
          plan.storeUntil !== 'Jul'
            ? 'Choose to store until July.'
            : littleToStore
              ? `At a ${plan.spreadCents}-cent spread the bins are nearly empty after harvest, so there is little to store; narrow the spread first.`
              : !checkedB
                ? 'Set the share you predict, then press “Check the storage rule”.'
                : `Storing when the curve pays ${fmt(plan.storeMinCarry * 100)}% or more earned ${k$(storageAvg)} a season, against ${k$(bestStorage)} for the best rule. Try another share and check again.`
        }
        success={`Solved: storing until July only when the curve pays ${fmt(plan.storeMinCarry * 100)}% of full carry or more earned ${k$(storageAvg)} a season, against ${k$(storeAnyAvg)} storing whenever it pays any carry${
          Math.abs(plan.storeMinCarry - minCarryBest) > 1e-9 ? ` and ${k$(bestStorage)} at ${fmt(minCarryBest * 100)}%, the best` : ''
        }. ${
          skipped.years.length
            ? `The ${skipped.years.length} seasons the rule skips paid ${fmt(Math.min(...skipped.shares) * 100)}–${fmt(Math.max(...skipped.shares) * 100)}% of full carry at harvest: carry, but less than the merchant’s own cost of keeping the corn, and storing in them ${skipped.perBushel < 0 ? `lost ${fmt(-skipped.perBushel * 100, 1)} cents a bushel` : `earned only ${fmt(skipped.perBushel * 100, 1)} cents a bushel`} on average.`
            : ''
        }`}
      />

      <P>
        {byMonth[2] >= MIN_STORAGE && plan.storeUntil !== 'none'
          ? `Storing only until March or May, with the same rule, earns less: about ${thousands(byMonth[0])} a season to March and ${thousands(byMonth[1])} to May, against ${thousands(byMonth[2])} to July: in the seasons the rule stores, each month of carry earns more than it costs to keep the corn, so the longest hold earns the most. `
          : 'The merchant could also store only until March or May, but in the seasons worth storing each month of carry earns more than it costs to keep the corn, so the shorter holds earn less than July’s. '}
        As for the charter, it adds about {thousands(charterPerMillion)} a season for every million bushels on average over the history, and costs{' '}
        {thousands(-Math.min(...perMillion.map((r) => r.charter)))} per million in season{charterLosers.length > 1 ? 's' : ''} {and(charterLosers.map((r) => r.year))}
        {losersAreShortest ? `, the history’s ${charterLosers.length === 2 ? 'two' : String(charterLosers.length)} shortest crops` : ''}. The merchant’s buying
        margin is the cushion: in every season it earns something, and the thinnest cushion is season {cushion.year}, when at your {plan.spreadCents}-cent spread
        the elevator earned {millions(cushion.total)} from buying and storage together. Real grain merchants live on exactly these thin, steady margins and guard
        them the same way, sizing their bets on freight and storage to what a bad year can bear.
      </P>

      <Challenge
        id="c"
        question={`With your spread and storage, predict from season ${cushion.year} the largest barge charter, in whole millions of bushels, with which no season of the history loses money. Set it, then press “Check the charter”.`}
        solved={solved3}
        status={
          !checkedC
            ? 'Set the charter you predict, then press “Check the charter”.'
            : worstHist.total >= 0
              ? `With ${plan.charterMillions} million bushels chartered every season of the history still makes money; the worst, season ${worstHist.year}, makes ${m$(worstHist.total)}. A larger charter is safe too: try again.`
              : `With ${plan.charterMillions} million bushels chartered, season ${worstHist.year} of the history loses ${m$(-worstHist.total)}. Try a smaller charter and check again.`
        }
        success={`Solved: ${plan.charterMillions} million bushels of charter adds ${m$(charterAvg)} a season on average, and in the history’s worst season, ${worstHist.year}, the business still makes ${m$(worstHist.total)}. One more million would cost another ${thousands(cushion.perMillion)} in season ${cushion.year} and turn it into a loss. The charter is sized to the worst year, not the average one — and in the new seasons, which played no part in choosing it, the worst, season ${worstNew.year}, ${worstNew.total >= 0 ? `still makes ${m$(worstNew.total)}` : `loses ${m$(-worstNew.total)}`}.`}
      />

      <P>
        Notice which seasons the rules were chosen on. The spread, the storage threshold and the charter were all set on the sixty seasons of the history; the
        forty new seasons on the right of the chart played no part. If the new seasons’ average is close to the history’s, the rules have learned something about
        the valley rather than about sixty particular summers — the walk-forward discipline of <a href={lessonHref('agriculture/5.5')}>Lesson 5.5</a>, applied to
        a physical business. Here the new seasons happen to have had fewer short crops, and with your rules the merchant earned {millions(newAvg)} a season in them,{' '}
        {newAvg >= histAvg ? 'more than' : 'less than'} the {millions(histAvg)} of the history.
      </P>

      <P>
        <FigRef to="Grain Merchant">The merchant</FigRef> and the farm are two halves of one business, and both are exposed to the same weather and the same price.
        The last lesson puts them on one desk, adds the hedges and the forecast trades of Chapter 5, and judges the whole on the seasons it has never seen, asking the question every trading business must answer: is the profit worth the risk?
      </P>
    </LessonPage>
  );
}
