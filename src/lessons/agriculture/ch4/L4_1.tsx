import {
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  P,
  Readouts,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { CORN_GRADES, CORN_SCHEDULE, FACTOR_NAME, WHEAT_SCHEDULE, cornGrade, cornPrice, factorGrades, gradeName, wheatGrade, wheatPrice, type CornSample, type GradeFactor } from '../../../engines/agriculture/grain';
import { centsPlain, perBu } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

/** Fairview’s cash bid for No. 2 corn and the mill’s for No. 2 wheat at 11% protein (simulated). */
const CORN_BID = 4.4;
const WHEAT_BID = 6.0;

/** The challenge: the lowest moisture (half-point steps) at which a No. 2 load loses at least 50¢ a bushel to shrink and drying. */
export function moistureSolved(s: CornSample): boolean {
  if (cornGrade(s).grade !== 2 && cornGrade(s).grade !== 1) return false;
  if (s.testWeight < 54 || s.damaged > 5 || s.bcfm > 3) return false;
  const loss = (m: number) => CORN_BID - cornPrice({ ...s, moisture: m }, CORN_BID).netPerBushel;
  return loss(s.moisture) >= 0.5 - 1e-9 && loss(s.moisture - 0.5) < 0.5 - 1e-9;
}

const ROWS: Array<{ key: GradeFactor; label: string; min: number; max: number; higherIsBetter: boolean; unit: string }> = [
  { key: 'testWeight', label: 'Test weight', min: 44, max: 60, higherIsBetter: true, unit: 'lb/bu' },
  { key: 'damaged', label: 'Damaged kernels', min: 0, max: 16, higherIsBetter: false, unit: '%' },
  { key: 'bcfm', label: 'Broken corn and foreign material', min: 0, max: 8, higherIsBetter: false, unit: '%' },
];
const GRADE_TONES = ['#d6e8c8', '#e6efc9', '#f2eccb', '#f4dfc0', '#f1cdb6', '#eab5ab'];

/** Each factor's value against the grade bands it falls in; the worst factor is outlined. */
function GradeBands({ s }: { s: CornSample }) {
  const fg = factorGrades(s);
  const g = cornGrade(s);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 210"
      role="img"
      aria-label={`Test weight ${fmt(s.testWeight, 1)} pounds grades No. ${fg.testWeight}; damaged kernels ${fmt(s.damaged, 1)}% grades ${gradeName(fg.damaged)}; BCFM ${fmt(s.bcfm, 1)}% grades ${gradeName(fg.bcfm)}. The load is ${gradeName(g.grade)}, set by ${FACTOR_NAME[g.limiting]}.`}
    >
      {ROWS.map((r, i) => {
        const y = 22 + i * 62;
        const x = r.higherIsBetter ? scale(r.max, r.min, 40, 600) : scale(r.min, r.max, 40, 600);
        const edges = CORN_GRADES.map((c) => c[r.key]);
        const bounds = [r.higherIsBetter ? r.max : r.min, ...edges, r.higherIsBetter ? r.min : r.max];
        const v = s[r.key];
        return (
          <g key={r.key}>
            <text className="lab" x={40} y={y - 6}>
              {r.label}: {fmt(v, 1)} {r.unit}
            </text>
            {bounds.slice(0, -1).map((b, k) => {
              const x0 = x(b);
              const x1 = x(bounds[k + 1]);
              return (
                <g key={k}>
                  <rect x={Math.min(x0, x1)} y={y} width={Math.abs(x1 - x0)} height={22} fill={GRADE_TONES[k]} />
                  {Math.abs(x1 - x0) > 34 && (
                    <text className="ax ax-m" x={(x0 + x1) / 2} y={y + 15} style={{ fill: '#333' }}>
                      {k < 5 ? `No. ${k + 1}` : 'Sample'}
                    </text>
                  )}
                </g>
              );
            })}
            <rect x={40} y={y} width={560} height={22} fill="none" stroke={g.limiting === r.key && g.grade > 1 ? '#333' : '#ddd'} strokeWidth={g.limiting === r.key && g.grade > 1 ? 2 : 1} />
            <line x1={x(v)} x2={x(v)} y1={y - 4} y2={y + 26} stroke={GRAPHIC.red} strokeWidth={2.5} />
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('corn-grade', { testWeight: 55, damaged: 2.5, bcfm: 1.5, moisture: 15 } as CornSample);
  const st = s.state;
  const g = cornGrade(st);
  const price = cornPrice(st, CORN_BID);
  const solved = moistureSolved(st);

  const w = useScenario('wheat-grade', { protein: 11, testWeight: 59, don: 1 });
  const ws = { ...w.state, damaged: 2 };
  const wp = wheatPrice(ws, WHEAT_BID);

  return (
    <LessonPage id="agriculture/4.1">
      <P>
        The last three chapters followed grain until it left the field. This one follows it after: through dryers and bins, elevators and trains, to the ports and
        the countries that import it. The question is how a crop harvested in a few weeks in one place becomes something that can be bought anywhere, any month of
        the year. The first step is to make a bushel of corn from Cedar Bend interchangeable with a bushel from anywhere else — and that takes a grade.
      </P>
      <P>
        Grain is graded so that buyers and sellers who never see each other can agree on what is being traded. In the United States, inspectors grade a sample of
        each lot against limits set by the Department of Agriculture. For corn, the numerical grades from No. 1 to No. 5 are set by a minimum{' '}
        <K tone="gold">test weight</K> — the weight of a bushel-sized volume, a measure of how plump and dense the kernels are — and by maximum shares of{' '}
        <K tone="red">damaged kernels</K> (heat, frost, mold, insects, sprouting) and of <b>broken corn and foreign material</b>, the fines and chaff that fall
        through a sieve. A lot gets the grade of its worst factor. Most corn changes hands as No. 2, and elevators post their price for No. 2. In the next
        demonstration, change a load’s factors; the bars show the grade each one allows, and the price is what Fairview’s elevator pays per bushel delivered at its
        simulated No. 2 price of {perBu(CORN_BID)}:
      </P>

      <Figure name="Grain Quality Lab" scenario={s}>
        <GradeBands s={st} />
        <Readouts
          items={[
            { label: 'grade', value: gradeName(g.grade), tone: g.grade <= 2 ? 'green' : 'red' },
            { label: 'set by', value: g.grade === 1 ? 'every factor' : FACTOR_NAME[g.limiting] },
            { label: 'bushels paid per bushel delivered', value: fmt(price.paidBushels, 3), tone: 'blue' },
            { label: 'quality discount', value: centsPlain(price.quality), tone: 'red' },
            { label: 'drying charge', value: centsPlain(price.drying), tone: 'red' },
            { label: 'farmer receives, per bushel delivered', value: perBu(price.netPerBushel), tone: 'green' },
          ]}
        />
        <Slider label="Test weight" tone="gold" value={st.testWeight} min={44} max={60} step={0.5} onChange={(v) => s.set({ testWeight: v })} display={`${fmt(st.testWeight, 1)} lb/bu`} />
        <Slider label="Damaged kernels" tone="red" value={st.damaged} min={0} max={16} step={0.5} onChange={(v) => s.set({ damaged: v })} display={`${fmt(st.damaged, 1)}%`} />
        <Slider label="Broken corn and foreign material" value={st.bcfm} min={0} max={8} step={0.5} onChange={(v) => s.set({ bcfm: v })} display={`${fmt(st.bcfm, 1)}%`} />
        <Slider label="Moisture" tone="blue" value={st.moisture} min={13} max={30} step={0.5} onChange={(v) => s.set({ moisture: v })} display={`${fmt(st.moisture, 1)}%`} />
      </Figure>

      <P>
        The starting load is No. 1 on damage and BCFM but only No. 2 on test weight, so it is No. 2 — and No. 2 is all the elevator pays for, because No. 1 earns
        no premium on its schedule. Drop the test weight to 53 pounds and the load becomes No. 3, discounted {centsPlain(CORN_SCHEDULE.testWeight)} a bushel; push
        the damaged kernels past 15% and it is sample grade, and the elevator takes {centsPlain(CORN_SCHEDULE.sample)} more. Each factor is a record of the season:
        light test weight usually means kernels that ran short of sugar in grain fill, as in <a href={lessonHref('agriculture/1.5')}>Lesson 1.5</a>’s dry August;
        damage comes from frost before maturity, mold in a wet autumn, or overheated dryers; and broken corn comes from rough handling of dry grain. A grade
        certificate is, in a sense, a short summary of the season the grain lived through.
      </P>
      <P>
        Moisture isn’t a grade factor at all, yet it costs the most. Corn delivered wet is <b>shrunk</b> to the bushels it would make at 15% moisture — the water
        weight it will lose — less half a percent for handling, and charged {centsPlain(CORN_SCHEDULE.drying, 1)} a point to dry it. At 20% a No. 2 load pays the
        farmer for 0.937 bushels per bushel delivered, less 22.5 cents a bushel of drying, and the farmer receives {perBu(cornPrice({ testWeight: 55, damaged: 2.5, bcfm: 1.5, moisture: 20 }, CORN_BID).netPerBushel)}{' '}
        instead of {perBu(CORN_BID)}. That is the bill <a href={lessonHref('agriculture/2.4')}>Lesson 2.4</a>’s farmer weighed against field losses.
      </P>

      <Challenge
        id="a"
        question="Keep the load No. 2 on every factor. What is the lowest moisture, in half-point steps, at which it loses at least 50 cents a bushel to shrink and drying?"
        solved={solved}
        status={
          st.testWeight < 54 || st.damaged > 5 || st.bcfm > 3
            ? 'Bring every factor back within No. 2: test weight at least 54 pounds, damage at most 5%, BCFM at most 3%.'
            : `At ${fmt(st.moisture, 1)}% moisture the load loses ${centsPlain(CORN_BID - price.netPerBushel)} a bushel.`
        }
        success={`Solved: at ${fmt(st.moisture, 1)}% moisture the farmer receives ${perBu(price.netPerBushel)} for each bushel delivered, ${centsPlain(CORN_BID - price.netPerBushel)} less than a dry load. More than half of the loss is the water itself, which was never corn; the rest is the cost of driving it off. That is why harvest-time corn is priced as much by its moisture meter as by its grade.`}
      />

      <H2>Wheat is bought for what it will bake</H2>
      <P>
        Wheat is graded on similar lines — in our simplified version, test weight and damaged kernels set its grade — but a flour mill cares about something the
        grade doesn’t measure: <K tone="orange">protein</K>. Bread needs strong flour, and strong flour needs protein, so mills pay premiums for high-protein hard red
        winter wheat and discount low-protein loads. Protein depends on the crop’s season as much as its variety: nitrogen in the soil raises it, and a big yield
        dilutes it, because the same nitrogen is spread over more starch. Wheat is also tested for <b>deoxynivalenol</b>, a toxin left by the head scab fungus of{' '}
        <a href={lessonHref('agriculture/2.3')}>Lesson 2.3</a>, which flourishes when it rains during flowering; food regulators set limits on it in flour,
        so mills discount it and reject badly contaminated loads. In the next demonstration, set a load’s protein, test weight and toxin; the bars build the price
        from the Marlow flour mill’s simulated base of {perBu(WHEAT_BID)} for No. 2 at 11% protein:
      </P>

      <Figure name="Grain Quality Lab · wheat" scenario={w}>
        <WheatBars base={WHEAT_BID} protein={wp.protein} quality={wp.quality} net={wp.net} rejected={wp.rejected} />
        <Readouts
          items={[
            { label: 'grade', value: gradeName(wheatGrade(ws)) },
            { label: 'protein premium', value: centsPlain(wp.protein), tone: wp.protein >= 0 ? 'green' : 'red' },
            { label: 'quality discounts', value: centsPlain(-wp.quality), tone: 'red' },
            { label: 'mill pays', value: perBu(wp.net), tone: 'green' },
          ]}
        />
        <Slider label="Protein" tone="orange" value={w.state.protein} min={9} max={15} step={0.1} onChange={(v) => w.set({ protein: Math.round(v * 10) / 10 })} display={`${fmt(w.state.protein, 1)}%`} />
        <Slider label="Test weight" tone="gold" value={w.state.testWeight} min={52} max={62} step={0.5} onChange={(v) => w.set({ testWeight: v })} display={`${fmt(w.state.testWeight, 1)} lb/bu`} />
        <Slider label="Toxin (deoxynivalenol)" tone="red" value={w.state.don} min={0} max={8} step={0.5} onChange={(v) => w.set({ don: v })} display={`${fmt(w.state.don, 1)} ppm`} />
      </Figure>

      <P>
        Each point of protein above 11% is worth {centsPlain(WHEAT_SCHEDULE.proteinPremium)} a bushel to this mill, and each point below costs{' '}
        {centsPlain(WHEAT_SCHEDULE.proteinDiscount)}: a 13% load earns {perBu(wheatPrice({ protein: 13, testWeight: 59, don: 1, damaged: 2 }, WHEAT_BID).net)}, a 10% load{' '}
        {perBu(wheatPrice({ protein: 10, testWeight: 59, don: 1, damaged: 2 }, WHEAT_BID).net)}. Toxin is gentler until it isn’t: below 2 ppm it costs nothing, each
        part per million above costs {centsPlain(WHEAT_SCHEDULE.don)}, and above {WHEAT_SCHEDULE.donReject} ppm the load is turned away from milling and sells as
        feed for {perBu(wheatPrice({ protein: 11, testWeight: 59, don: 6, damaged: 2 }, WHEAT_BID).net)}. Real schedules vary from mill to mill and year to year — in a
        season short of protein, premiums widen — but they all say the same thing in their own numbers: wheat is bought for what it will bake.
      </P>
      <P>
        Grades and schedules turn the valley’s varied harvest into a few standard commodities, which is what lets grain from thousands of farms be pooled, stored and
        shipped together. They are also what makes a futures market possible, as we’ll see in Chapter 5: a futures contract names the grade that can be delivered
        against it — No. 2 yellow corn, for the main American corn contract — with small premiums and discounts for the grades on either side, so that a buyer who
        has never seen the grain knows exactly what a contract is worth. But a bushel of No. 2 corn harvested in October still has to last until whoever buys it needs it, and as{' '}
        <FigRef to="Grain Quality Lab">the moisture slider</FigRef> showed, wet grain doesn’t last. The next lesson puts the grain in a bin and watches it over the
        winter.
      </P>
    </LessonPage>
  );
}

function WheatBars({ base, protein, quality, net, rejected }: { base: number; protein: number; quality: number; net: number; rejected: boolean }) {
  const x = scale(0, 8, 160, 620);
  const rows = [
    { label: 'Base, No. 2 at 11%', from: 0, to: base, color: CROP_LINE.wheat },
    { label: 'Protein', from: base, to: base + (rejected ? Math.min(0, protein) : protein), color: protein >= 0 ? GRAPHIC.green : GRAPHIC.red },
    { label: 'Quality discounts', from: base + (rejected ? Math.min(0, protein) : protein), to: net, color: GRAPHIC.red },
    { label: rejected ? 'Sold as feed' : 'Mill pays', from: 0, to: net, color: rejected ? GRAPHIC.gray : TEXT.green },
  ];
  return (
    <svg className="chart" viewBox="0 0 640 170" role="img" aria-label={`Wheat price: base ${usd(base, 2)}, protein ${usd(protein, 2)}, discounts ${usd(-quality, 2)}, ${rejected ? 'rejected for milling, sold as feed for' : 'the mill pays'} ${usd(net, 2)} a bushel.`}>
      {rows.map((r, i) => {
        const y = 12 + i * 38;
        const a = x(Math.min(r.from, r.to));
        const b = x(Math.max(r.from, r.to));
        return (
          <g key={i}>
            <text className="ax ax-e" x={150} y={y + 16}>
              {r.label}
            </text>
            <rect x={a} y={y} width={Math.max(1, b - a)} height={24} fill={r.color} opacity={0.8} />
            <text className="lab" x={b + 6} y={y + 16}>
              {usd(r.to - (i === 0 || i === 3 ? 0 : r.from), 2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
