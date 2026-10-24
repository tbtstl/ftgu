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
  usd,
} from '../../../framework';
import { BIN_COST_PER_BU, PIVOT_COST_PER_ACRE, farmRecord, summarizeFarm, type FarmDesign, type FarmSummary, type Hybrid } from '../../../engines/agriculture/capstone';
import { MARKET_YEARS } from '../../../engines/agriculture/market';
import { DISTRICT, DISTRICTS, type DistrictId } from '../../../model/agriculture/region';
import { LAND_RENT, PROPERTY_TAX } from '../../../model/agriculture/economics';
import { ValleyMap } from '../shared/ValleyMap';
import { resetFarm, setFarm, useCapstone } from '../shared/capstone';

const YEARS = Array.from({ length: MARKET_YEARS }, (_, i) => i + 1);
export const BIN_SIZES = Array.from({ length: 13 }, (_, i) => i * 25000);

export function summaryOf(d: FarmDesign): FarmSummary {
  return summarizeFarm(farmRecord(d, YEARS).map((x) => x.total));
}

/** Challenge 1: a farm that earns at least $50,000 in an average season and loses no more than $100,000 in a one-in-ten bad one. */
export function resilientSolved(d: FarmDesign): boolean {
  const s = summaryOf(d);
  return s.mean >= 50000 && s.p10 >= -100000;
}

/** The bin size, in steps of 25,000 bushels, at which the farm earns the most on average. */
export function bestBins(d: FarmDesign): number {
  let best = 0;
  let top = -Infinity;
  for (const b of BIN_SIZES) {
    const m = summaryOf({ ...d, bins: b }).mean;
    if (m > top + 1e-6) {
      top = m;
      best = b;
    }
  }
  return best;
}

const k$ = (v: number) => `${v < 0 ? '−' : ''}$${fmt(Math.abs(v) / 1000)}k`;

function YearBars({ totals }: { totals: number[] }) {
  const [lo, hi] = niceDomain(Math.min(0, ...totals), Math.max(0, ...totals), 4);
  const x = scale(0.5, totals.length + 0.5, 60, 620);
  const y = scale(lo, hi, 200, 24);
  const w = (x(1) - x(0)) * 0.72;
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  return (
    <svg className="chart" viewBox="0 0 640 228" role="img" aria-label={`The farm’s profit in each of sixty simulated seasons, from ${k$(Math.min(...totals))} to ${k$(Math.max(...totals))}, averaging ${k$(mean)}.`}>
      <text className="ax" x={60} y={14}>
        Profit in each season
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={60} x1={620} format={k$} baseline={0} />
      {totals.map((v, i) => (
        <rect key={i} x={x(i + 1) - w / 2} y={Math.min(y(v), y(0))} width={w} height={Math.max(0.5, Math.abs(y(v) - y(0)))} fill={mix('#fcfcfb', v >= 0 ? GRAPHIC.green : GRAPHIC.red, 0.6)} />
      ))}
      <line x1={60} x2={620} y1={y(mean)} y2={y(mean)} stroke="#333" strokeDasharray="5 4" />
      <text className="ax ax-e" x={618} y={y(mean) - 4}>
        average {k$(mean)}
      </text>
      {[1, 10, 20, 30, 40, 50, 60].map((t) => (
        <text key={t} className="ax ax-m" x={x(t)} y={220}>
          {t === 1 ? 'season 1' : t}
        </text>
      ))}
    </svg>
  );
}

function BinCurve({ d }: { d: FarmDesign }) {
  const pts = useMemo(() => BIN_SIZES.map((b) => ({ b, m: summaryOf({ ...d, bins: b }).mean })), [d]);
  const [lo, hi] = niceDomain(Math.min(...pts.map((p) => p.m)), Math.max(...pts.map((p) => p.m)), 4);
  const x = scale(0, 300000, 70, 620);
  const y = scale(lo, hi, 190, 24);
  const cur = pts.find((p) => p.b === d.bins);
  return (
    <svg className="chart" viewBox="0 0 640 220" role="img" aria-label={`Average profit against bin space: ${pts.map((p) => `${fmt(p.b / 1000)}k ${k$(p.m)}`).join(', ')}.`}>
      <text className="ax" x={70} y={14}>
        Average profit with storage
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={70} x1={620} format={k$} />
      <path d={linePath(pts.map((p) => x(p.b)), pts.map((p) => y(p.m)))} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} />
      {cur && <circle cx={x(cur.b)} cy={y(cur.m)} r={5.5} fill={GRAPHIC.green} stroke="#fcfcfb" strokeWidth={1.5} />}
      {[0, 50000, 100000, 150000, 200000, 250000, 300000].map((b) => (
        <text key={b} className="ax ax-m" x={x(b)} y={206}>
          {fmt(b / 1000)}k
        </text>
      ))}
      <text className="ax ax-e" x={620} y={218}>
        bin space, bushels
      </text>
    </svg>
  );
}

export default function Lesson() {
  const { farm } = useCapstone();
  const record = useMemo(() => farmRecord(farm, YEARS), [farm]);
  const s = summarizeFarm(record.map((r) => r.total));
  const byDistrict = useMemo(() => Object.fromEntries(DISTRICTS.map((dd) => [dd.id, summaryOf({ ...farm, district: dd.id }).mean])) as Record<DistrictId, number>, [farm]);
  const cornYield = record.reduce((a, r) => a + r.cornYield, 0) / record.length;
  const solved1 = useMemo(() => resilientSolved(farm), [farm]);
  const best = useMemo(() => bestBins(farm), [farm]);
  const solved2 = farm.bins === best;
  const stored = record.reduce((a, r) => a + r.stored, 0) / record.length;
  const perBu = record.reduce((a, r) => a + r.storageGain, 0) / Math.max(1, record.reduce((a, r) => a + r.stored, 0));

  return (
    <LessonPage id="agriculture/6.1">
      <P>
        This chapter runs an agricultural business through the simulated valley, from the ground up: a farm to design, seasons to live through with only a
        forecast to go on, a harvest to predict, grain to store and ship, and a trading desk to run. Each lesson builds on the last, and your choices carry from
        one lesson to the next — they are kept in this browser, and nowhere else. You can change any of them at any time, and the later lessons will follow. It starts with the farm.
      </P>
      <P>
        Like Cedar Bend, the farm has 1,600 acres: the family owns 1,000, paying only property tax of ${PROPERTY_TAX} an acre, and rents the rest at the district’s
        going rent. You choose where it is, how many acres grow corn — the rest grow winter wheat, and corn after corn gives up a tenth of its yield and needs
        more nitrogen, as in <a href={lessonHref('agriculture/2.1')}>Lesson 2.1</a> — whether the corn gets center pivots, and which hybrid. Pivots pump water at $11
        an acre-inch and cost about ${PIVOT_COST_PER_ACRE} an acre a year to own. A later hybrid fills grain longer when the season allows, as in{' '}
        <a href={lessonHref('agriculture/1.2')}>Lesson 1.2</a>, but matures later and leaves more water to dry out of the grain. The corn is sold at harvest at the
        district’s elevator, with the basis of <a href={lessonHref('agriculture/5.3')}>Lesson 5.3</a>, and the wheat at its plan price moved with corn futures. Every
        season is one of the sixty simulated years of Chapter 5, so a dry summer cuts the yield and raises the price in the same year. In the next demonstration
        the bars are the farm’s <K tone="green">profit</K> in each of the sixty seasons — revenue less every cost — and the map shows its average profit if it
        stood in each district. Click a district to move the farm there:
      </P>

      <Figure name="Farm Region Builder" onReset={resetFarm}>
        <ValleyMap
          fill={(id) => mix('#f4f1e8', byDistrict[id] >= 0 ? GRAPHIC.green : GRAPHIC.red, 0.15 + 0.5 * Math.min(1, Math.abs(byDistrict[id]) / 150000))}
          label={(id) => [`${k$(byDistrict[id])} a year`]}
          selected={farm.district}
          onSelect={(id) => setFarm({ district: id })}
          places="none"
          showRail={false}
          ariaLabel={`Average profit if the farm stood in each district: ${DISTRICTS.map((dd) => `${dd.name} ${k$(byDistrict[dd.id])}`).join(', ')}. The farm is in ${DISTRICT[farm.district].name}.`}
          height={390}
        />
        <YearBars totals={record.map((r) => r.total)} />
        <Readouts
          items={[
            { label: 'average season', value: k$(s.mean), tone: s.mean >= 0 ? 'green' : 'red' },
            { label: 'one-in-ten bad season', value: k$(s.p10), tone: s.p10 >= 0 ? 'green' : 'red' },
            { label: 'seasons with a loss', value: `${s.losses} of ${MARKET_YEARS}` },
            { label: 'corn yield, average', value: `${fmt(cornYield)} bu/ac`, tone: 'gold' },
          ]}
        />
        <Slider label="Acres of corn" tone="gold" value={farm.cornAcres} min={0} max={farm.acres} step={100} onChange={(v) => setFarm({ cornAcres: v })} display={`${fmt(farm.cornAcres)} of ${fmt(farm.acres)}`} />
        <Segmented
          label="Hybrid"
          value={farm.hybrid}
          onChange={(v: Hybrid) => setFarm({ hybrid: v })}
          options={[
            { value: 'early', label: 'Early' },
            { value: 'standard', label: 'Standard' },
            { value: 'late', label: 'Late' },
          ]}
        />
        <Checkbox label="Center pivots on the corn" checked={farm.irrigated} onChange={(v) => setFarm({ irrigated: v })} />
      </Figure>

      <P>
        As Cedar Bend farms today — 1,000 acres of corn on the Black Prairie, a standard hybrid, no pivots, 125,000 bushels of bins — the farm made $25,000 in
        an average season, lost money in 26 of the sixty and lost $125,000 in a one-in-ten bad one. Grow 800 acres of corn instead and every corn acre follows
        wheat: the average rises to $54,000 and the bad season shrinks to a $76,000 loss. A late hybrid lifts the average too, but it is a bet on long, warm
        autumns: its worst season loses $213,000, against $160,000 with the standard hybrid. Pivots don’t pay on the Prairie’s deep soils: they add 18 bushels an acre but cost more than
        those bushels earn. Move to the High Plains and they become essential — dryland corn there yields 70 bushels and loses $283,000 a year — but even
        irrigated, corn on the Plains loses money; the district is wheat country, as <a href={lessonHref('agriculture/3.1')}>Lesson 3.1</a> found. The River
        Bottoms earn the most on average, but not reliably: their worst season loses $350,000, more than twice the Prairie’s worst.
      </P>

      <Challenge
        id="a"
        question="Design a farm that earns at least $50,000 in an average season and loses no more than $100,000 in its one-in-ten bad season."
        solved={solved1}
        status={`This farm earns ${k$(s.mean)} in an average season and ${s.p10 >= 0 ? 'makes' : 'loses'} ${k$(Math.abs(s.p10))} in a one-in-ten bad one.`}
        success={`Solved: in ${DISTRICT[farm.district].name}, with ${fmt(farm.cornAcres)} acres of corn, a${farm.hybrid === 'early' ? 'n early' : farm.hybrid === 'late' ? ' late' : ' standard'} hybrid${farm.irrigated ? ' and pivots' : ''}, the farm earns ${k$(s.mean)} in an average season and ${s.p10 >= 0 ? 'makes' : 'loses'} ${k$(Math.abs(s.p10))} in a bad one. That is the farm the rest of the chapter runs; change it any time and the later lessons follow.`}
      />

      <P>
        Two things in this design are fixed, and they matter as much as anything you can change. The family owns most of its land, and so pays tax on those
        acres rather than rent; charge them the district’s rent, as <a href={lessonHref('agriculture/2.5')}>Lesson 2.5</a> did, and almost every design here loses
        money in an average season. Owned land is the farm’s largest hidden asset. And the farm sells its corn at harvest at the elevator’s bid, the weakest price
        of the year, with the rush discount of <a href={lessonHref('agriculture/4.3')}>Lesson 4.3</a> taken off. That is where the last choice comes in.
      </P>

      <H2>How much bin space?</H2>
      <P>
        The last choice is storage. Every bushel stored at harvest and sold hedged in July earns the carry and the harvest basis of{' '}
        <a href={lessonHref('agriculture/5.2')}>Lesson 5.2</a> — {fmt(perBu * 100)} cents a bushel on average, after the bins’ running costs and interest, for this
        farm. But a bushel of bin space costs about {fmt(BIN_COST_PER_BU * 100)} cents a year to own whether it is full or not. In the next demonstration the curve
        is the farm’s average profit against its bin space, and the dot is the space it has:
      </P>

      <Figure name="Farm Region Builder · bins" onReset={() => setFarm({ bins: 125000 })}>
        <BinCurve d={farm} />
        <Readouts
          items={[
            { label: 'bin space', value: `${fmt(farm.bins)} bu` },
            { label: 'stored, average season', value: `${fmt(stored)} bu`, tone: 'gold' },
            { label: 'storage earns', value: `${fmt(perBu * 100)}¢ a bushel`, tone: 'green' },
            { label: 'bins cost', value: `${fmt(BIN_COST_PER_BU * 100)}¢ a bushel of space`, tone: 'red' },
          ]}
        />
        <Slider label="Bin space" value={farm.bins} min={0} max={300000} step={25000} onChange={(v) => setFarm({ bins: v })} display={`${fmt(farm.bins / 1000)},000 bu`} />
      </Figure>

      <P>
        Bins earn in ways the curve doesn’t show, too. A farm with its own storage keeps its combines running while the elevator’s line of trucks is an hour
        long, and it can wait out a harvest when the network is full and the basis has fallen off its cliff. American farms, together, own about half of the
        country’s grain storage space; the rest is at elevators and terminals. In this demonstration, storage earns more than the bins cost, so more bins pay — up
        to a point. Beyond it, the extra space is full only in big years and empty in short ones,
        and an empty bin costs as much as a full one. The best size is a little under the farm’s average crop, because the crop varies: for Cedar Bend, whose corn
        ranged from 73,000 to 211,000 bushels across the sixty seasons, it is 150,000 bushels.
      </P>

      <Challenge
        id="b"
        question="For the farm you designed, what bin space, to the nearest 25,000 bushels, earns the most on average?"
        solved={solved2}
        status={`With ${fmt(farm.bins)} bushels of bins the farm earns ${k$(s.mean)} in an average season.`}
        success={`Solved: ${fmt(farm.bins)} bushels of bins earn this farm ${k$(s.mean)} in an average season, more than any other size. The design is set: ${DISTRICT[farm.district].name}, ${fmt(farm.cornAcres)} acres of corn, ${fmt(farm.bins)} bushels of storage. Its rent is ${usd(LAND_RENT[farm.district])} an acre on the ${fmt(farm.acres - farm.owned)} rented acres.`}
      />

      <P>
        <FigRef to="Farm Region Builder">The design</FigRef> is judged on sixty seasons at once, with hindsight. A farmer lives them one at a time, deciding
        before the weather is known. The next lesson puts this farm into seasons the market history has never seen and runs them day by day, with only the
        forecasts of Chapter 3 to go on.
      </P>
    </LessonPage>
  );
}
