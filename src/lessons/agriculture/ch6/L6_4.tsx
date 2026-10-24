import { useMemo, useState } from 'react';
import {
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
  linePath,
  mix,
  niceDomain,
  niceTicks,
  scale,
} from '../../../framework';
import { CHARTER_RATE, ELEVATOR_OF, MERCHANT_RUSH, MERCHANT_STORAGE, merchantYear, type MerchantPlan } from '../../../engines/agriculture/capstone';
import { harvestRush } from '../../../engines/agriculture/elevator';
import { MARKET_YEARS, cropYear } from '../../../engines/agriculture/market';
import { meanValley } from '../../../engines/agriculture/world';
import { PLACE } from '../../../model/agriculture/region';
import { MARKET_LINE } from '../shared/tones';
import { DEFAULT_MERCHANT, resetMerchant, setMerchant, useCapstone } from '../shared/capstone';

const HISTORY = Array.from({ length: MARKET_YEARS }, (_, i) => i + 1);
const ALL = Array.from({ length: 100 }, (_, i) => i + 1);

const k$ = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`;
const m$ = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1e6, 2)}M`;

function average(p: MerchantPlan, years: number[], f: (x: ReturnType<typeof merchantYear>) => number = (x) => x.total): number {
  return years.reduce((a, y) => a + f(merchantYear(p, y)), 0) / years.length;
}

/** Challenge 1: the harvest spread (whole cents) that earned the most from buying over the sixty seasons. */
export function bestSpread(): number {
  let best = 30;
  for (let c = 30; c <= 60; c++) if (average({ ...DEFAULT_MERCHANT, spreadCents: c }, HISTORY, (x) => x.buying) > average({ ...DEFAULT_MERCHANT, spreadCents: best }, HISTORY, (x) => x.buying) + 1e-6) best = c;
  return best;
}

/** Challenge 2: storing until July, the share of full carry (in tenths) the curve must pay before storing that earned the most over the sixty seasons. */
export function bestMinCarry(spreadCents: number): number {
  let best = 0;
  let top = -Infinity;
  for (let t = 0; t <= 10; t++) {
    const v = average({ spreadCents, storeUntil: 'Jul', storeMinCarry: t / 10, charterMillions: 0 }, HISTORY, (x) => x.storage);
    if (v > top + 1e-6) {
      top = v;
      best = t / 10;
    }
  }
  return best;
}

/** Challenge 3: the largest charter, in whole millions of bushels, with which no season of the hundred loses money. */
export function largestSafeCharter(p: MerchantPlan): number {
  let ok = 0;
  for (let m = 0; m <= 10; m++) {
    if (ALL.every((y) => merchantYear({ ...p, charterMillions: m }, y).total >= 0)) ok = m;
    else break;
  }
  return ok;
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

export default function Lesson() {
  const { merchant: plan, farm } = useCapstone();
  const hub = ELEVATOR_OF[farm.district];
  const [seasonYear, setSeasonYear] = useState(40);
  const season = { year: seasonYear, set: setSeasonYear };
  const c = cropYear(season.year);
  const rush = useMemo(() => harvestRush({ ...MERCHANT_RUSH, harvest: MERCHANT_RUSH.harvest * (c.valley / meanValley()), spread: plan.spreadCents / 100 }), [c.valley, plan.spreadCents]);
  const my = merchantYear(plan, season.year, hub);
  const spreadBest = useMemo(() => bestSpread(), []);
  const solved1 = plan.spreadCents === spreadBest;
  const minCarryBest = useMemo(() => bestMinCarry(plan.spreadCents), [plan.spreadCents]);
  const solved2 = plan.storeUntil === 'Jul' && Math.abs(plan.storeMinCarry - minCarryBest) < 1e-9;
  const safe = useMemo(() => largestSafeCharter(plan), [plan]);
  const solved3 = plan.charterMillions === safe && safe > 0;
  const histAvg = useMemo(() => average(plan, HISTORY), [plan]);
  const newAvg = useMemo(() => average(plan, ALL.slice(60)), [plan]);
  const totals = useMemo(() => ALL.map((y) => merchantYear(plan, y, hub).total), [plan, hub]);
  const worst = Math.min(...totals);
  const worstYear = ALL[totals.indexOf(worst)];
  const storageAvg = useMemo(() => average(plan, HISTORY, (x) => x.storage), [plan]);
  const charterAvg = useMemo(() => average(plan, HISTORY, (x) => x.charter), [plan]);

  return (
    <LessonPage id="agriculture/6.4">
      <P>
        A farm grows grain; a merchant moves it. Your business also runs the country elevator in your district — {PLACE[hub].name}, for{' '}
        <a href={lessonHref('agriculture/6.1')}>the farm you designed</a> — with the plant of <a href={lessonHref('agriculture/4.3')}>Lesson 4.3</a>: a draw area
        that grows 12 million bushels of corn in an ordinary season, 3 million bushels of bins, a shuttle train a week and a stream of trucks to the ethanol plant.
        The merchant earns money three ways, each from an earlier lesson. It <K tone="gold">buys</K> at harvest, below the corn’s value by its spread. It{' '}
        <K tone="violet">stores</K> the corn left in its bins when the rush is over, hedged, when the curve pays enough. And it <K tone="blue">ships</K>, chartering
        barges before the season at the rate the barge lines offer, {fmt(CHARTER_RATE * 100)} cents a bushel, and earning the export basis of{' '}
        <a href={lessonHref('agriculture/5.3')}>Lesson 5.3</a> on every bushel. The rules you set run through every season: the sixty of the market history and
        the forty new ones.
      </P>
      <P>
        Start with the harvest. In the next demonstration the line is the corn in the elevator’s bins through one season’s harvest, and the dashed line its bin
        space. Choose the season and the spread:
      </P>

      <Figure name="Grain Merchant" onReset={resetMerchant}>
        <RushChart stocks={rush.stocks} />
        <Readouts
          items={[
            { label: `season ${season.year}: valley harvest`, value: `${fmt(c.valley)} million bu`, tone: 'gold' },
            { label: 'bought at harvest', value: `${fmt(rush.bought / 1e6, 2)} million bu` },
            { label: 'turned away', value: `${fmt(rush.turnedAway / 1e6, 2)} million bu`, tone: rush.turnedAway > 1 ? 'red' : 'ink' },
            { label: 'buying margin', value: m$(my.buying), tone: 'green' },
          ]}
        />
        <Slider label="Season" value={season.year} min={1} max={100} onChange={season.set} display={season.year > MARKET_YEARS ? `${season.year} (new)` : String(season.year)} />
        <Slider label="Harvest spread" tone="gold" value={plan.spreadCents} min={30} max={60} onChange={(v) => setMerchant({ spreadCents: v })} display={`${plan.spreadCents}¢`} />
      </Figure>

      <P>
        Every season is a different harvest. In season 40, the reference season, a 35-cent spread buys 6.2 million bushels and earns $1.68 million over handling.
        In season 19, with the valley’s crop just past the network’s limit, the same spread fills the bins and turns 450,000 bushels away. In season 46, the drought,
        the elevator buys only 3.2 million bushels and earns $0.86 million. A narrow spread buys more corn but turns farmers away in big years; a wide one keeps the
        bins clear but buys less. One spread has to serve them all.
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
        question="What harvest spread, in whole cents, earned the most from buying, on average, over the sixty seasons of the history?"
        solved={solved1}
        status={`At ${plan.spreadCents}¢ buying earned ${m$(average(plan, HISTORY, (x) => x.buying))} a season on average.`}
        success={`Solved: ${plan.spreadCents}¢ earned ${m$(average(plan, HISTORY, (x) => x.buying))} a season, a little more than the 35¢ of Lesson 4.3, because over many seasons the big harvests, when a narrow spread turns farmers away, cost more than the small ones save.`}
      />

      <H2>Storing and shipping</H2>
      <P>
        When the rush is over the bins still hold corn — about two million bushels in an average season. The merchant can sell it at harvest, or keep it,
        hedged, and earn what the curve pays. An elevator’s own bins cost little to run at the margin, about {fmt(MERCHANT_STORAGE * 100)} cent a bushel a month
        for fans and shrink, plus interest — less than the commercial rate behind full carry — so storing pays when the curve pays a large enough share of
        full carry, as in <a href={lessonHref('agriculture/5.2')}>Lesson 5.2</a>. The charter is a bet of a different kind: it pays the export basis less{' '}
        {fmt(CHARTER_RATE * 100)} cents on every bushel chartered, a good bet in most seasons and a losing one when the valley’s crop is too short to fill the
        river. In the next demonstration each bar is one season’s profit in its three parts, the history on the left and the new seasons on the right. Set the
        storage and the charter:
      </P>

      <Figure name="Grain Merchant · the business" onReset={resetMerchant}>
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
            { label: 'storage, average', value: k$(storageAvg), tone: 'violet' },
            { label: `worst season (${worstYear})`, value: m$(worst), tone: worst >= 0 ? 'green' : 'red' },
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
      </Figure>

      <P>
        Storing until July whatever the curve says earns about $182,000 a season. Storing only when the curve pays at least half of full carry earns more, about
        $197,000, by skipping the tight seasons when the market is paying holders to sell — the inverse of Lesson 5.2. The charter adds about $280,000 a season
        for every million bushels on average, and costs $150,000 per million in the two shortest crops. The merchant’s buying margin is the cushion: in every
        season it earns something, and the worst of them, the drought of season 46, is where a large charter turns a good business into a losing season. Real grain
        merchants live on exactly these thin, steady margins and guard them the same way, sizing their bets on freight and storage to what a bad year can bear.
      </P>

      <Challenge
        id="b"
        question="Store until July. What share of full carry, to the nearest 10%, should the curve pay before the merchant stores, to earn the most from storage over the sixty seasons?"
        solved={solved2}
        status={plan.storeUntil !== 'Jul' ? 'Choose to store until July.' : `Storing when the curve pays ${fmt(plan.storeMinCarry * 100)}% or more earned ${k$(storageAvg)} a season.`}
        success={`Solved: storing until July only when the curve pays ${fmt(plan.storeMinCarry * 100)}% of full carry or more earned ${k$(storageAvg)} a season — more than storing every year, because the seasons it skips are the inverted ones, when corn is worth more now than later.`}
      />

      <Challenge
        id="c"
        question="With your spread and storage, what is the largest barge charter, in whole millions of bushels, with which no season of the hundred loses money?"
        solved={solved3}
        status={worst >= 0 ? `With ${plan.charterMillions} million bushels chartered every season still makes money; the worst, season ${worstYear}, makes ${m$(worst)}.` : `With ${plan.charterMillions} million bushels chartered, season ${worstYear} loses ${m$(-worst)}.`}
        success={`Solved: ${plan.charterMillions} million bushels of charter adds ${m$(charterAvg)} a season on average, and in the worst season, ${worstYear}, the business still makes ${m$(worst)}. One more million and that season would lose money. The charter is sized to the worst year, not the average one.`}
      />

      <P>
        Notice which seasons the rules were chosen on. The spread and the storage threshold were tuned on the sixty seasons of the history; the forty new seasons
        on the right of the chart played no part. If the new seasons’ average is close to the history’s, the rules have learned something about the valley rather
        than about sixty particular summers — the walk-forward discipline of <a href={lessonHref('agriculture/5.5')}>Lesson 5.5</a>, applied to a physical business.
        Here the new seasons happen to have been kind, with fewer droughts, and the merchant earned more in them than in the history.
      </P>

      <P>
        <FigRef to="Grain Merchant">The merchant</FigRef> and the farm are two halves of one business, and both are exposed to the same weather and the same price.
        The last lesson puts them on one desk, adds the hedges and the forecast trades of Chapter 5, and judges the whole on the seasons it has never seen, asking the question every trading business must answer: is the profit worth the risk?
      </P>
    </LessonPage>
  );
}

