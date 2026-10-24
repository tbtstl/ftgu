import { useMemo } from 'react';
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
  Slider,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { CORN_GRADES, FACTOR_NAME, blend, cornGrade, cornPrice, gradeName, type CornSample, type GradeFactor } from '../../../engines/agriculture/grain';
import { HANDLING, TRAIN_BUSHELS, harvestRush, harvestSales, type RushOptions } from '../../../engines/agriculture/elevator';
import { centsPlain } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

const BID = 4.4;
const GOOD: CornSample = { testWeight: 57.5, damaged: 2, bcfm: 1.5, moisture: 15 };
const FROSTED: CornSample = { testWeight: 51, damaged: 9, bcfm: 3.5, moisture: 15 };
const FROSTED_COST = cornPrice(FROSTED, BID).netPerBushel;
const NO2 = CORN_GRADES[1];

export function trainOf(share: number): CornSample {
  return blend([
    { bushels: 1 - share, sample: GOOD },
    { bushels: share, sample: FROSTED },
  ]);
}

/** The train buyer’s contract calls for No. 2 and takes anything less at this discount, $ per bushel. */
export const OFF_GRADE = 0.1;

/** What the train sells for per bushel: the No. 2 price, or less if it misses the contract grade. */
export function trainPrice(share: number): number {
  const t = trainOf(share);
  return cornGrade(t).grade <= 2 ? BID : cornPrice(t, BID).netPerBushel - OFF_GRADE;
}

/** The elevator’s gain on a 400,000-bushel train from blending in the discounted frosted corn, $. */
export function blendGain(share: number): number {
  return TRAIN_BUSHELS * (trainPrice(share) - ((1 - share) * BID + share * FROSTED_COST));
}

/** Challenge 1: the largest share of frosted corn (whole percent) the train can carry and still grade No. 2. */
export function blendSolved(sharePct: number): boolean {
  const ok = (p: number) => cornGrade(trainOf(p / 100)).grade <= 2;
  return ok(sharePct) && !ok(sharePct + 1);
}

const BIG_HARVEST = 1.3;
const BASE_RUSH: RushOptions = { harvest: 12e6, spread: 0.35, capacity: 3e6, trainsPerWeek: 1, localPerDay: 30000, days: 50 };

/** Challenge 2: in the big harvest, the narrowest spread (whole cents) that turns no farmer away. */
export function spreadSolved(s: { harvestMult: number; spreadCents: number; capacity: number; trains: number }): boolean {
  if (Math.abs(s.harvestMult - BIG_HARVEST) > 1e-6 || s.capacity !== BASE_RUSH.capacity || s.trains !== BASE_RUSH.trainsPerWeek) return false;
  const turned = (c: number) => harvestRush({ ...BASE_RUSH, harvest: BASE_RUSH.harvest * BIG_HARVEST, spread: c / 100 }).turnedAway;
  return turned(s.spreadCents) < 1 && turned(s.spreadCents - 1) >= 1;
}

function BlendBars({ t }: { t: CornSample }) {
  const rows: Array<{ k: GradeFactor; label: string; lo: number; hi: number; limit: number; better: 'high' | 'low'; unit: string }> = [
    { k: 'testWeight', label: 'Test weight', lo: 50, hi: 58, limit: NO2.testWeight, better: 'high', unit: 'lb' },
    { k: 'damaged', label: 'Damaged kernels', lo: 0, hi: 10, limit: NO2.damaged, better: 'low', unit: '%' },
    { k: 'bcfm', label: 'BCFM', lo: 0, hi: 4, limit: NO2.bcfm, better: 'low', unit: '%' },
  ];
  return (
    <svg className="chart" viewBox="0 0 640 170" role="img" aria-label={`The train’s blend: test weight ${fmt(t.testWeight, 2)} pounds, damaged kernels ${fmt(t.damaged, 2)}%, BCFM ${fmt(t.bcfm, 2)}%, against the No. 2 limits.`}>
      {rows.map((r, i) => {
        const x = scale(r.lo, r.hi, 170, 600);
        const y = 14 + i * 52;
        const okZone = r.better === 'high' ? [x(r.limit), x(r.hi)] : [x(r.lo), x(r.limit)];
        const pass = r.better === 'high' ? t[r.k] >= r.limit - 1e-9 : t[r.k] <= r.limit + 1e-9;
        return (
          <g key={r.k}>
            <text className="lab" x={160} y={y + 18} textAnchor="end">
              {r.label}
            </text>
            <rect x={170} y={y} width={430} height={28} fill="#f2ede4" />
            <rect x={okZone[0]} y={y} width={okZone[1] - okZone[0]} height={28} fill="#dcebcd" />
            <line x1={x(r.limit)} x2={x(r.limit)} y1={y - 3} y2={y + 31} stroke="#333" strokeDasharray="3 3" />
            <text className="ax" x={x(r.limit)} y={y + 42} textAnchor="middle">
              No. 2 limit {fmt(r.limit)}
              {r.unit === '%' ? '%' : ' lb'}
            </text>
            <line x1={x(Math.max(r.lo, Math.min(r.hi, t[r.k])))} x2={x(Math.max(r.lo, Math.min(r.hi, t[r.k])))} y1={y - 2} y2={y + 30} stroke={pass ? TEXT.green : GRAPHIC.red} strokeWidth={3} />
          </g>
        );
      })}
    </svg>
  );
}

function RushChart({ stocks, capacity }: { stocks: number[]; capacity: number }) {
  const x = scale(0, stocks.length, 60, 620);
  const y = scale(0, 5e6, 200, 24);
  return (
    <svg className="chart" viewBox="0 0 640 230" role="img" aria-label={`Corn in Fairview’s bins through a ${stocks.length}-day harvest, peaking at ${fmt(Math.max(...stocks) / 1e6, 2)} million bushels against ${fmt(capacity / 1e6, 1)} million of space.`}>
      <text className="ax" x={60} y={14}>
        Corn in the bins, million bushels
      </text>
      <GridY y={y} ticks={[0, 1e6, 2e6, 3e6, 4e6, 5e6]} x0={60} x1={620} format={(v) => fmt(v / 1e6)} baseline={0} />
      <path d={linePath([x(0), ...stocks.map((_, i) => x(i + 1))], [y(0), ...stocks.map(y)])} fill="none" stroke={CROP_LINE.corn} strokeWidth={2.5} />
      <line x1={60} x2={620} y1={y(capacity)} y2={y(capacity)} stroke="#333" strokeDasharray="6 4" />
      <text className="ax ax-e" x={618} y={y(capacity) - 5}>
        bin space
      </text>
      {[0, 10, 20, 30, 40, 50].map((d) => (
        <text key={d} className="ax ax-m" x={x(d)} y={218}>
          {d === 0 ? 'harvest begins' : `day ${d}`}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const b = useScenario('blend', { share: 20 });
  const train = trainOf(b.state.share / 100);
  const g = cornGrade(train);
  const sale = trainPrice(b.state.share / 100);
  const gain = blendGain(b.state.share / 100);
  const solved1 = blendSolved(b.state.share);

  const r = useScenario('rush', { harvestMult: 1, spreadCents: 35, capacity: 3e6, trains: 1 });
  const rush = useMemo(
    () => harvestRush({ ...BASE_RUSH, harvest: BASE_RUSH.harvest * r.state.harvestMult, spread: r.state.spreadCents / 100, capacity: r.state.capacity, trainsPerWeek: r.state.trains }),
    [r.state],
  );
  const solved2 = useMemo(() => spreadSolved(r.state), [r.state]);

  return (
    <LessonPage id="agriculture/4.3">
      <P>
        Most of Cedar Bend’s corn doesn’t go straight from the farm to a mill or a port. It goes a few miles down the road to the Fairview elevator — the tall
        concrete bins beside the rail line that every grain town has. A <K tone="gold">country elevator</K> is a small business with a simple job: buy grain from
        farmers by the truckload, grade it, dry and store it as needed, blend it, and sell it on by the trainload. Its income is the difference between what it pays
        and what it receives, less what the handling costs. <a href={lessonHref('agriculture/4.1')}>Lesson 4.1</a> showed how grades and discounts set the first of
        those prices; this lesson runs the elevator.
      </P>
      <P>
        Start with blending. This autumn Fairview has two bins of corn. One is good No. 2 from farms like Cedar Bend, bought at the full {usd(BID, 2)} bid. The other
        came from fields frosted before they matured: light and damaged, it grades {gradeName(cornGrade(FROSTED).grade)}, and under the schedule of Lesson 4.1 the
        elevator bought it {centsPlain(BID - FROSTED_COST)} a bushel cheaper. A buyer wants a 400,000-bushel train of No. 2. The train’s grade comes from the blend,
        and averages are forgiving: a load of good corn can carry some bad corn and still pass. In the next demonstration, choose how much of the train comes from
        the frosted bin; the bars are the blend against the No. 2 limits:
      </P>

      <Figure name="Grain Elevator Manager" scenario={b}>
        <BlendBars t={train} />
        <Readouts
          items={[
            { label: 'train grades', value: gradeName(g.grade), tone: g.grade <= 2 ? 'green' : 'red' },
            { label: 'limited by', value: g.grade <= 2 ? '—' : FACTOR_NAME[g.limiting] },
            { label: 'sells for, per bushel', value: usd(sale, 3), tone: 'green' },
            { label: 'gain from blending, this train', value: usd(gain), tone: gain >= 0 ? 'green' : 'red' },
          ]}
        />
        <Slider label="Frosted corn in the train" tone="gold" value={b.state.share} min={0} max={70} onChange={(v) => b.set({ share: v })} display={`${b.state.share}%`} />
      </Figure>

      <P>
        With no frosted corn the train is No. 1 — which earns nothing extra, since the buyer pays for No. 2. Add frosted corn and the elevator keeps its 15-cent
        discount on every frosted bushel while the train still sells as No. 2: at 20% that is $12,000 on this train, at 30% $18,000. The limit isn’t test weight,
        which stays above 54 pounds well past 40%; it is damage. Past the limit the whole train misses the contract, the buyer takes {centsPlain(OFF_GRADE)} a
        bushel off all 400,000 bushels, and the gain becomes a loss of $14,280 at 43%. Blending is how frosted, light or damaged corn finds its way into the
        feed and food supply at a fair price: the farmer is paid for what the corn is, and the elevator earns its margin by putting it where it does no harm.
      </P>

      <Challenge
        id="a"
        question="What is the largest share of frosted corn, to the whole percent, that the train can carry and still grade No. 2?"
        solved={solved1}
        status={g.grade <= 2 ? `At ${b.state.share}% the train is still No. 2. Could it carry more?` : `At ${b.state.share}% the train is ${gradeName(g.grade)}, held back by ${FACTOR_NAME[g.limiting]}.`}
        success={`Solved: at ${b.state.share}% frosted corn the train averages ${fmt(train.damaged, 2)}% damaged kernels, just inside No. 2’s 5%, and the elevator earns ${usd(gain)} on it from the blend alone. One more percent and the whole train drops to No. 3. The tightest factor sets the limit — here damage, not test weight — and an elevator’s blending skill is knowing which factor that is.`}
      />

      <P>
        Elevators come in many shapes. Many country elevators in grain belts are cooperatives owned by the farmers who sell to them; others belong to the large grain
        companies that also own terminals, barges and export elevators. They buy more than corn off the scale on a given day: they offer farmers contracts to buy
        grain for delivery months ahead, they store farmers’ grain for a fee, and they hedge what they own, which is where Chapter 5 will take us. But the core of
        the business is the one we just ran: take in grain of every quality, and send out grain that meets a buyer’s specification, at a margin that pays for the
        concrete, the dryers and the people.
      </P>

      <H2>The harvest rush</H2>
      <P>
        Blending happens all year. The elevator’s hardest weeks are harvest. Farmers bring corn faster than the railroad can take it away, and the bins in between
        are only so big. Fairview’s draw area grows about 12 million bushels in an ordinary year, and about half of it is sold at harvest — the rest the farmers
        keep in their own bins for later, as in <a href={lessonHref('agriculture/4.2')}>the previous lesson</a>. Fairview has 3 million bushels of space; trucks take
        30,000 bushels a day to Bluestem Ethanol, and a shuttle train takes 400,000 at a time. The elevator’s lever is its <K tone="green">spread</K>: how far below
        the price at the terminal it bids. Bid closer and farmers sell more of their corn now; bid further below and more of them keep it on the farm. In the next
        demonstration the line is Fairview’s stocks through a 50-day harvest; set the harvest, the bid spread, the bin space and the trains:
      </P>

      <Figure name="Grain Elevator Manager · harvest rush" scenario={r}>
        <RushChart stocks={rush.stocks} capacity={r.state.capacity} />
        <Legend
          items={[
            { label: 'Corn in the bins', color: CROP_LINE.corn, kind: 'line' },
            { label: 'Bin space', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'farmers sell at harvest', value: `${fmt(harvestSales(r.state.spreadCents / 100) * 100)}%` },
            { label: 'bushels bought', value: `${fmt(rush.bought / 1e6, 2)} million`, tone: 'gold' },
            { label: 'turned away when full', value: `${fmt(rush.turnedAway / 1e6, 2)} million`, tone: rush.turnedAway > 0 ? 'red' : 'ink' },
            { label: 'elevator margin', value: usd(rush.margin), tone: 'green' },
          ]}
        />
        <Slider label="Harvest" tone="gold" value={r.state.harvestMult} min={0.6} max={1.5} step={0.1} onChange={(v) => r.set({ harvestMult: Math.round(v * 10) / 10 })} display={`${fmt(12 * r.state.harvestMult, 1)} million bu`} />
        <Slider label="Bid spread below the terminal" tone="green" value={r.state.spreadCents} min={25} max={60} onChange={(v) => r.set({ spreadCents: v })} display={`${r.state.spreadCents}¢`} />
        <Slider label="Bin space" value={r.state.capacity} min={1e6} max={5e6} step={0.25e6} onChange={(v) => r.set({ capacity: v })} display={`${fmt(r.state.capacity / 1e6, 2)} million bu`} />
        <Slider label="Shuttle trains a week" value={r.state.trains} min={0} max={3} step={0.5} onChange={(v) => r.set({ trains: v })} display={fmt(r.state.trains, 1)} />
      </Figure>

      <P>
        In an ordinary year, with a 35-cent spread, farmers sell half their crop at harvest, the bins peak at 2.8 million bushels and nobody is turned away; Fairview
        buys 6 million bushels and earns $1.62 million over its {centsPlain(HANDLING)} a bushel of handling costs. Now make the harvest 30% larger. At the same
        spread the bins fill on the busiest days, 1.45 million bushels are turned away over 13 days, and those farmers haul their corn to the next elevator or pile
        it at home. There are two ways out. More trains — two a week would carry it all — or a wider spread, so that more farmers keep their corn on the farm until
        the rush is over. Rail capacity is booked well ahead, and in a big year it is often short, so the spread does most of the work.
      </P>

      <Challenge
        id="b"
        question="Make it a big harvest, 15.6 million bushels, with the usual 3 million bushels of space and one train a week. What is the narrowest spread, in whole cents, at which Fairview turns no farmer away?"
        solved={solved2}
        status={
          Math.abs(r.state.harvestMult - BIG_HARVEST) > 1e-6
            ? 'Set the harvest to 15.6 million bushels.'
            : r.state.capacity !== BASE_RUSH.capacity || r.state.trains !== BASE_RUSH.trainsPerWeek
              ? 'Keep 3 million bushels of space and one train a week.'
              : rush.turnedAway >= 1
                ? `At ${r.state.spreadCents}¢, ${fmt(rush.turnedAway / 1e6, 2)} million bushels are turned away.`
                : `At ${r.state.spreadCents}¢ nobody is turned away. Could the elevator bid closer?`
        }
        success={`Solved: at ${r.state.spreadCents}¢ the bins just hold the harvest, and the elevator earns ${usd(rush.margin)}, more than at any other spread. A big crop doesn’t only fill bins; it widens the gap between what farmers are paid at harvest and what the grain is worth at the terminal, because the elevator has to ration its space. We’ll meet that gap again, under its trade name, in Chapter 5.`}
      />

      <P>
        In <FigRef to="Grain Elevator Manager">the blending demonstration</FigRef> and this one, Fairview sold to “the terminal” as if it were next door. It isn’t:
        the corn still has hundreds of miles to go, by rail or by river, and the cost and capacity of that trip decide what Fairview can afford to bid in the first
        place. That journey is the next lesson.
      </P>
    </LessonPage>
  );
}
