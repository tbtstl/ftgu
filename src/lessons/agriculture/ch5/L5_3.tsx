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
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  mix,
  niceDomain,
  niceTicks,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { EXPIRY, MARKET_YEARS, basisParts, cropYear, harvestCurve, HARVEST_SALE, type BasisParts } from '../../../engines/agriculture/market';
import { cornPrice, type CornSample } from '../../../engines/agriculture/grain';
import type { Hub } from '../../../engines/agriculture/logistics';
import { meanValley } from '../../../engines/agriculture/world';
import { DISTRICTS, PLACE, dateLabel, type DistrictId } from '../../../model/agriculture/region';
import { ValleyMap } from '../shared/ValleyMap';
import { centsPlain } from '../shared/format';
import { MARKET_LINE } from '../shared/tones';

/** Each district's elevator. */
const ELEVATOR: Record<DistrictId, Hub> = { north: 'halsted', plains: 'dunmore', prairie: 'fairview', ridge: 'ashby', bottoms: 'landing' };
/** The frosted corn of Lesson 4.3: light and damaged, No. 4. */
const FROSTED: CornSample = { testWeight: 51, damaged: 9, bcfm: 3.5, moisture: 15 };
export const FROSTED_DISCOUNT = cornPrice(FROSTED, 5).quality;

export interface BasisState {
  /** The valley's harvest, million bushels (506 stands for the average). */
  valley: number;
  /** Days after mid-October harvest. */
  day: number;
  district: DistrictId;
  grade: 'no2' | 'frosted';
}

export const BASIS0: BasisState = { valley: 506, day: 0, district: 'prairie', grade: 'no2' };

export function partsOf(st: BasisState, hub: Hub): BasisParts & { quality: number; total: number } {
  const c = harvestCurve({ valley: st.valley === BASIS0.valley ? meanValley() : st.valley, world: 0, carryIn: 100 });
  const p = basisParts(c, hub, HARVEST_SALE + st.day);
  const quality = st.grade === 'frosted' ? -FROSTED_DISCOUNT : 0;
  return { ...p, quality, total: p.basis + quality };
}

/** Challenge 1: the smallest harvest (in steps of 10 million bushels) at which Fairview's harvest basis is more than 50 cents under its average-year level. */
export function cliffSolved(st: BasisState): boolean {
  if (st.day !== 0 || st.district !== 'prairie' || st.grade !== 'no2' || st.valley % 10 !== 0) return false;
  const base = partsOf(BASIS0, 'fairview').total;
  const under = (v: number) => partsOf({ ...st, valley: v }, 'fairview').total < base - 0.5;
  return under(st.valley) && !under(st.valley - 10);
}

/** What a barge charter earns per bushel in a simulated year: corn bought at Crane Landing, sold at Port Sable, less the charter rate. */
export function charterProfit(year: number, rate: number): number {
  return -cropYear(year).hubBasis.landing - rate;
}

/** Challenge 2: the highest whole-cent charter rate at which the charter earned money on average over the sixty years. */
export function charterSolved(cents: number): boolean {
  const avg = (c: number) => Array.from({ length: MARKET_YEARS }, (_, i) => charterProfit(i + 1, c / 100)).reduce((a, b) => a + b, 0) / MARKET_YEARS;
  return avg(cents) > 0 && avg(cents + 1) <= 0;
}

/** The charter's average profit as unsigned cents: one decimal, or two when it is within a tenth of a cent of zero, so a hair's loss never reads as 0.0¢. */
export function avgCents(avg: number): string {
  return centsPlain(Math.abs(avg), Math.abs(avg) < 0.001 ? 2 : 1);
}

const SEASON_DAYS = EXPIRY.Jul - HARVEST_SALE - 4;

function basisFill(b: number): string {
  const t = Math.max(0, Math.min(1, (b + 2.1) / 1.6));
  return mix('#f4f1e8', GRAPHIC.teal, 0.08 + 0.6 * t);
}

function PartsBars({ p }: { p: ReturnType<typeof partsOf> }) {
  const rows: Array<{ label: string; v: number; color: string }> = [
    { label: 'Network to the port', v: p.network, color: GRAPHIC.gray },
    { label: 'Elevator handling', v: p.handling, color: GRAPHIC.gray },
    { label: 'Harvest pressure', v: p.harvest, color: MARKET_LINE.cash },
    { label: `Carry to ${p.contract}`, v: p.carry, color: MARKET_LINE.futures },
    { label: 'Quality', v: p.quality, color: GRAPHIC.red },
  ];
  const x = scale(-2.2, 0, 200, 620);
  let run = 0;
  return (
    <svg className="chart" viewBox="0 0 640 200" role="img" aria-label={`The basis taken apart: ${rows.map((r) => `${r.label} ${centsPlain(r.v)}`).join(', ')}; total ${centsPlain(p.total)} under ${p.contract}.`}>
      {rows.map((r, i) => {
        const y = 10 + i * 30;
        const a = x(run + r.v);
        const b = x(run);
        run += r.v;
        return (
          <g key={r.label}>
            <text className="lab" x={192} y={y + 15} textAnchor="end" style={{ fontSize: 12.5 }}>
              {r.label}
            </text>
            <rect x={Math.min(a, b)} y={y + 2} width={Math.max(1, Math.abs(b - a))} height={18} fill={mix('#fcfcfb', r.color, 0.6)} />
            <text className="ax" x={Math.min(a, b) - 4} y={y + 15} textAnchor="end">
              {Math.abs(r.v) < 0.005 ? '—' : `−${fmt(Math.abs(r.v) * 100)}¢`}
            </text>
          </g>
        );
      })}
      <line x1={x(0)} x2={x(0)} y1={6} y2={164} stroke="#333" />
      <text className="ax ax-m" x={x(0)} y={178}>
        futures
      </text>
      <line x1={x(p.total)} x2={x(p.total)} y1={6} y2={164} stroke={MARKET_LINE.basis} strokeWidth={2} strokeDasharray="4 3" />
      <text className="ax ax-m" x={x(p.total)} y={192} style={{ fill: TEXT.teal }}>
        basis {usd(p.total, 2)}
      </text>
    </svg>
  );
}

function CharterBars({ rate }: { rate: number }) {
  const ys = Array.from({ length: MARKET_YEARS }, (_, i) => i + 1);
  const profit = ys.map((y) => charterProfit(y, rate));
  const [lo, hi] = niceDomain(Math.min(-0.5, ...profit), Math.max(0.5, ...profit), 4);
  const x = scale(0.5, MARKET_YEARS + 0.5, 60, 620);
  const y = scale(lo, hi, 170, 24);
  const vy = scale(200, 700, 250, 190);
  const w = (x(1) - x(0)) * 0.72;
  return (
    <svg className="chart" viewBox="0 0 640 282" role="img" aria-label={`A barge charter at ${centsPlain(rate)} a bushel earned between ${usd(Math.min(...profit), 2)} and ${usd(Math.max(...profit), 2)} a bushel in the sixty simulated years.`}>
      <text className="ax" x={60} y={14}>
        Charter profit, $ a bushel
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={60} x1={620} format={(v) => usd(v, 2)} baseline={0} />
      {profit.map((v, i) => (
        <rect key={i} x={x(i + 1) - w / 2} y={Math.min(y(v), y(0))} width={w} height={Math.max(0.5, Math.abs(y(v) - y(0)))} fill={mix('#fcfcfb', v >= 0 ? GRAPHIC.green : GRAPHIC.red, 0.6)} />
      ))}
      <text className="ax" x={60} y={186}>
        Valley corn harvest, million bushels
      </text>
      <line x1={60} x2={620} y1={vy(566)} y2={vy(566)} stroke="#333" strokeDasharray="4 4" />
      <text className="ax ax-e" x={618} y={vy(566) - 4}>
        network full
      </text>
      {ys.map((yr) => (
        <circle key={yr} cx={x(yr)} cy={vy(cropYear(yr).valley)} r={2.6} fill={MARKET_LINE.cash} />
      ))}
      {[1, 10, 20, 30, 40, 50, 60].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={272}>
          {t === 1 ? 'year 1' : t}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('basis', BASIS0);
  const hub = ELEVATOR[s.state.district];
  const all = useMemo(() => Object.fromEntries(DISTRICTS.map((d) => [d.id, partsOf(s.state, ELEVATOR[d.id])])) as Record<DistrictId, ReturnType<typeof partsOf>>, [s.state]);
  const p = all[s.state.district];
  const solved1 = useMemo(() => cliffSolved(s.state), [s.state]);
  const date = HARVEST_SALE + s.state.day;

  const ch = useScenario('charter', { cents: 60 });
  const rate = ch.state.cents / 100;
  const profits = useMemo(() => Array.from({ length: MARKET_YEARS }, (_, i) => charterProfit(i + 1, rate)), [rate]);
  const avg = profits.reduce((a, b) => a + b, 0) / profits.length;
  const solved2 = charterSolved(ch.state.cents);

  return (
    <LessonPage id="agriculture/5.3">
      <P>
        In Chapter 4 a bushel at Fairview was worth less than a bushel at the port by what it cost to get it there. <a href={lessonHref('agriculture/5.1')}>Lesson
        5.1</a> named the gap between a cash price and futures the basis; at Port Sable it was only the carry to December. Our futures are for corn on a ship at
        Port Sable, so at an elevator the basis — its cash bid less the futures price — begins with the journey to the port, and takes off everything else that
        lies between the elevator and a ship. Five things, in our valley:
      </P>
      <P>
        First the <i>network</i>: the freight to the port by the routes of <a href={lessonHref('agriculture/4.4')}>Lesson 4.4</a>, and, when the network is full,
        its congestion. Then the elevator’s handling margin. Then <i>harvest pressure</i>, the extra the elevator takes off in the rush to ration its bins: its
        harvest spread of <a href={lessonHref('agriculture/4.3')}>Lesson 4.3</a> less the handling margin. Then <i>carry</i>: corn in October is quoted against
        December futures, and it costs something to hold it until December, as far as the curve of <a href={lessonHref('agriculture/5.2')}>the last lesson</a> pays. Last, quality: corn worse than No. 2
        takes the discounts of <a href={lessonHref('agriculture/4.1')}>Lesson 4.1</a>. In the next demonstration each district is labeled with its elevator’s basis,
        and the bars take apart the basis of the one you choose. Change the valley’s harvest, the date and the grade:
      </P>

      <Figure name="Grain Basis Trader" scenario={s}>
        <ValleyMap
          fill={(id) => basisFill(all[id].total)}
          label={(id) => [`${PLACE[ELEVATOR[id]].name.replace('Crane ', '')} ${usd(all[id].total, 2)}`]}
          selected={s.state.district}
          onSelect={(id) => s.set({ district: id })}
          places={['halsted', 'dunmore', 'fairview', 'ashby', 'landing', 'sable', 'westhaven']}
          ariaLabel={`Each elevator’s basis on ${dateLabel(date)}: ${DISTRICTS.map((d) => `${PLACE[ELEVATOR[d.id]].name} ${usd(all[d.id].total, 2)}`).join(', ')}.`}
          height={390}
        />
        <PartsBars p={p} />
        <Readouts
          items={[
            { label: `${PLACE[hub].name}, ${dateLabel(date)}`, value: `${usd(-p.total, 2)} under ${p.contract}`, tone: 'teal' },
            { label: `${p.contract} futures`, value: usd(p.futures, 2), tone: 'violet' },
            { label: 'cash bid', value: usd(p.futures + p.total, 2), tone: 'gold' },
          ]}
        />
        <Slider label="Valley harvest" tone="gold" value={s.state.valley} min={300} max={700} step={2} onChange={(v) => s.set({ valley: v })} display={`${fmt(s.state.valley)} million bu`} />
        <Slider label="Date" value={s.state.day} min={0} max={SEASON_DAYS} onChange={(v) => s.set({ day: v })} display={dateLabel(date)} />
        <Segmented
          label="Grade"
          value={s.state.grade}
          onChange={(v) => s.set({ grade: v })}
          options={[
            { value: 'no2', label: 'No. 2' },
            { value: 'frosted', label: 'Frosted (No. 4)' },
          ]}
        />
      </Figure>

      <P>
        In an average harvest, Fairview’s basis in mid-October is $1.30 under December: 85 cents of network, 8 of handling, 27 of harvest pressure and 10 of carry.
        Move the date on and it strengthens: the harvest pressure goes by February and the carry shrinks as each contract nears delivery, and by mid-February
        Fairview bids 97 under March. That shape — weakest at harvest, stronger through winter and spring — is one of the most reliable patterns in the grain trade, and it
        is why farmers with bins sell later. Across the valley, Dunmore, next to the feedyards, has the strongest basis, $1.12 under at harvest, and Ashby, whose
        only way out is the long haul west by rail, the weakest, $1.42 under. Make the harvest short and the pattern changes: at 300 million bushels the ethanol
        plants and feedyards bid for every bushel, Fairview’s basis strengthens to 74 under, and Upland Ridge’s farmers drive past Ashby to the barges at Crane Landing.
        Real basis maps look like this too: strongest near the processors and the ports, weakest far from both, and weakest of all at harvest.
      </P>

      <Challenge
        id="a"
        question={
          <>
            Keep the date at harvest, Fairview, and No. 2 corn. Raise the valley’s harvest from its average: at what harvest, to the nearest 10 million bushels,
            does Fairview’s basis first fall more than 50 cents under its average-year level? Predict it first from where the network of{' '}
            <a href={lessonHref('agriculture/4.4')}>Lesson 4.4</a> filled, then check.
          </>
        }
        solved={solved1}
        status={
          s.state.day !== 0 || s.state.district !== 'prairie' || s.state.grade !== 'no2'
            ? 'Set the date to October 15, choose the Black Prairie (Fairview), and No. 2 corn.'
            : s.state.valley % 10 !== 0
              ? 'Use a harvest that is a multiple of 10 million bushels.'
              : `At ${fmt(s.state.valley)} million bushels Fairview bids ${usd(-p.total, 2)} under, ${centsPlain(all.prairie.total - partsOf(BASIS0, 'fairview').total)} from its average-year basis.`
        }
        success={`Solved: at ${fmt(s.state.valley)} million bushels the valley’s railroad and river are full, and Fairview’s basis falls to ${usd(p.total, 2)}: ${centsPlain(-(p.network - partsOf(BASIS0, 'fairview').network))} of the drop is the network filling — the cliff of Lesson 4.4 — and the rest is a wider harvest spread. Ten million bushels less and the corn could still leave the valley this year. Basis doesn’t fall smoothly with the size of the crop; it falls off a cliff where the network fills.`}
      />

      <P>
        Because a cash price has two parts, a farmer can fix them separately. A <i>hedge-to-arrive</i> contract with the elevator fixes the futures part now and
        leaves the basis to be set later; a <i>basis contract</i> does the opposite, fixing the basis and leaving the futures price open. Choosing between them is a
        view on which part will move. In a summer when the crop looks big enough to fill the network, a farmer who fixes the basis before harvest steps around the
        cliff. Quality is part of the bid too: switch the grade to the frosted corn of <a href={lessonHref('agriculture/4.3')}>Lesson 4.3</a> and every elevator takes off another{' '}
        {centsPlain(FROSTED_DISCOUNT)}, the same at Ashby as at Dunmore, because grade discounts come from the buyer’s schedule, not from geography.
      </P>

      <H2>Owning the route</H2>
      <P>
        Who earns the gap between the valley and the port? Whoever owns the way out. A grain merchant who charters barges buys corn at Crane Landing at its basis
        and sells it at Port Sable at the futures price, hedging the price in between; per bushel it earns the difference between the two places — the{' '}
        <K tone="teal">export basis</K> — less the cost of the barge. In a normal year that difference is 87 cents: the 45-cent barge freight plus the 42 cents a bushel of room on the full
        river is worth, its scarcity value in <a href={lessonHref('agriculture/4.4')}>Lesson 4.4</a>. But a charter is booked before anyone knows the crop. In the next demonstration
        each bar is one simulated year’s profit per bushel on a charter booked in advance, and the dots under it are the valley’s harvest. Set the charter rate:
      </P>

      <Figure name="Grain Basis Trader · a barge charter" scenario={ch}>
        <CharterBars rate={rate} />
        <Legend
          items={[
            { label: 'Profit per bushel', color: mix('#fcfcfb', GRAPHIC.green, 0.6) },
            { label: 'Valley harvest', color: MARKET_LINE.cash },
          ]}
        />
        <Readouts
          items={[
            { label: 'average profit', value: `${avg >= 0 ? '' : '−'}${avgCents(avg)} a bushel`, tone: avg >= 0 ? 'green' : 'red' },
            { label: 'years it paid', value: `${profits.filter((v) => v > 0.005).length} of ${MARKET_YEARS}` },
            { label: 'best year', value: usd(Math.max(...profits), 2), tone: 'green' },
            { label: 'worst year', value: usd(Math.min(...profits), 2), tone: 'red' },
          ]}
        />
        <Slider label="Charter rate" tone="blue" value={ch.state.cents} min={40} max={120} onChange={(v) => ch.set({ cents: v })} display={`${ch.state.cents}¢ a bushel`} />
      </Figure>

      <P>
        The export basis takes only a handful of values. It is about 87 cents in 27 of the sixty years; 65 to 71 cents in 22 short crops, when the river has room
        to spare for Upland Ridge’s corn; 45 cents in the two shortest crops, when the river isn’t full at all; and $1.50 in the eight years the valley’s harvest
        filled the network. The one year left over, year 19, brought 567 million bushels, right at the network’s capacity, and an export basis of $1.12. A
        charter at 60 cents paid in 58 of the sixty years, one at 80 cents in only 36 — but the big years pay so much that they make up for most of the
        rest. On the real Mississippi, barge freight rates rise and fall with exactly this scarcity value, and a merchant who books barges or owns a river terminal is, among other
        things, betting on the size of the crop.
      </P>

      <Challenge
        id="b"
        question="Estimate it first from the handful of values the export basis takes, then check: what is the highest charter rate, to the cent, at which the charter earned money on average over the sixty years?"
        solved={solved2}
        status={avg > 0 ? `At ${ch.state.cents}¢ the charter earned ${avgCents(avg)} a bushel on average. Could it pay more?` : `At ${ch.state.cents}¢ the charter lost ${avgCents(avg)} a bushel on average.`}
        success={`Solved: at ${ch.state.cents}¢ the charter just paid, earning ${avgCents(avg)} a bushel on average. That is almost exactly the normal year’s export basis: the big years, when the network filled, and the short ones, when the river ran empty, came close to canceling. The charter is worth the average scarcity of the river — and only a forecast of the crop could tell a merchant when to pay more.`}
      />

      <P>
        Basis is local: what the valley’s own crop, railroad and river do to the price of its corn, as in <FigRef to="Grain Basis Trader">the basis map</FigRef>. Futures are global: what the world’s crops do. A forecast of
        the valley’s harvest is worth most where the valley matters most — in the basis — but the valley’s weather also moves the American crop, and with it the
        futures price. Whether a crop forecast can anticipate the futures market is the question of the next lesson.
      </P>
    </LessonPage>
  );
}
