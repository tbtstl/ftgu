import { useMemo } from 'react';
import {
  Caption,
  Challenge,
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
  TEXT,
  fmt,
  lessonHref,
  pct,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { compareChoices, marketMonths, repositionPlan, stayPlan, type AllocationSetup, type Leg, type Plan } from '../../../engines/shipping/allocation';
import type { Equilibrium } from '../../../engines/shipping/market';
import { seaRoute } from '../../../engines/shipping/network';
import { ballastDraft, ladenDraft } from '../../../engines/shipping/voyage';
import { KESTREL } from '../../../model/shipping/vessels';
import { MARKET_CLASSES, ROUTES } from '../../../model/shipping/trades';
import { CARGO_COLOR } from '../shared/tones';
import { WorldMap } from '../shared/WorldMap';
import { XYChart } from '../shared/XYChart';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
const MONTH = 365 / 12;
const HORIZON = 100;
const SOY_MT = ROUTES.find((r) => r.id === 'P-SAN-QIN')!.mtpa;
const COAL = CARGO_COLOR.coal;
const SOY = CARGO_COLOR.grain;

const perDay = (x: number) => `${usd(x)}/day`;
/** Million tonnes a year of soybeans, with a decimal only when it isn't whole. */
const mt = (soy: number) => {
  const x = Math.round(SOY_MT * soy * 10) / 10;
  return `${fmt(x, x % 1 ? 1 : 0)} Mt a year`;
};
const signedDay = (x: number) => `${x >= 0 ? '+' : '−'}${usd(Math.abs(x))}/day`;

export interface AllocationState {
  month: number;
  soy: number;
  bunker: number;
  speed: number;
  /** Extra days waiting per call at Qingdao. */
  waiting: number;
}

export const DEFAULTS: AllocationState = { month: 0, soy: 1, bunker: 600, speed: 12, waiting: 0 };

export function setupOf(s: AllocationState): AllocationSetup {
  return { month: s.month, soy: s.soy, bunker: s.bunker, speed: s.speed, horizon: HORIZON, congestion: s.waiting > 0 ? { QIN: s.waiting } : undefined };
}

/** Both plans, and how much more repositioning earns a day over the horizon. */
export function comparePlans(s: AllocationState): { eqs: Equilibrium[]; stay: Plan; repo: Plan; diff: number } {
  const setup = setupOf(s);
  const eqs = marketMonths(setup);
  const stay = stayPlan(setup, eqs);
  const repo = repositionPlan(setup, eqs);
  return { eqs, stay, repo, diff: repo.tce - stay.tce };
}

/** The harvest-strength slider's values. */
export const SOY_GRID = Array.from({ length: 21 }, (_, i) => Math.round((0.5 + 0.05 * i) * 100) / 100);

/** Where Kestrel's soybean cargo is fixed under a set of plans: the month and that month's market. */
function soyFix(r: { eqs: Equilibrium[]; repo: Plan }) {
  const leg = r.repo.legs.find((l) => l.route === 'P-SAN-QIN')!;
  const k = Math.floor(leg.start / MONTH);
  return { leg, k, eq: r.eqs[k] };
}

/** Ballast miles, measured from China, that Brazil's soybean freight pays for in a month's market. */
export const creditedMiles = (eq: Equilibrium) => eq.routes.find((r) => r.route.id === 'P-SAN-QIN')!.positional;
/** Ships a month Santos draws in ballast from China in a month's market. */
export const shipsFromChina = (eq: Equilibrium) => eq.plan.flows.filter((f) => f.to === 'SAN' && f.from === 'QIN').reduce((a, f) => a + f.ships, 0) / 12;

/** The freight Kestrel's soybeans earn credit for, and Santos's draw on China, in the month she loads. */
export function fixCredit(s: AllocationState) {
  const r = comparePlans(s);
  const { k, eq } = soyFix(r);
  const miles = creditedMiles(eq);
  return { month: (s.month + k) % 12, miles, full: miles >= BALLAST_NM - 1, china: shipsFromChina(eq), diff: r.diff };
}

/** The first challenge's decision month: March, so that Kestrel loads in April, the height of the harvest. */
export const CREDIT_MONTH = 2;

/** The weakest harvest on the slider at which Brazil's freight still pays for all of Kestrel's ballast, deciding in March (null if none). */
export function weakestFullCredit(bunker: number, speed: number, waiting: number): number | null {
  for (const soy of SOY_GRID) if (fixCredit({ month: CREDIT_MONTH, soy, bunker, speed, waiting }).full) return soy;
  return null;
}

/** The first challenge: deciding in March, the weakest harvest at which the freight still credits the whole ballast leg. */
export function harvestSolved(s: AllocationState): boolean {
  if (s.month !== CREDIT_MONTH) return false;
  const w = weakestFullCredit(s.bunker, s.speed, s.waiting);
  return w !== null && Math.abs(s.soy - w) < 1e-9;
}

export interface FlexState {
  month: number;
  vol: number;
  wait: number;
}

export const FLEX_DEFAULTS: FlexState = { month: 1, vol: 0.2, wait: 3 };

/** What waiting is worth: waiting and choosing, against the better plan chosen now, $/day. */
export function waitValue(month: number, vol: number, wait: number) {
  const setup = setupOf({ ...DEFAULTS, month });
  const c = compareChoices(setup, marketMonths(setup), vol, wait);
  return { ...c, value: c.mean.wait - Math.max(c.mean.stay, c.mean.reposition) };
}

/** What free news (no days spent waiting) is worth in each decision month, with the market swinging ±20%. */
export const FREE_NEWS = MONTH_NAMES.map((_, m) => waitValue(m, 0.2, 0).value);
/** The month in which free news is worth most. */
export const FREE_NEWS_BEST = FREE_NEWS.indexOf(Math.max(...FREE_NEWS));

/** The second challenge: with the wait at zero and ±20% swings, the decision month in which the news is worth most. */
export function freeNewsSolved(s: FlexState): boolean {
  return s.wait === 0 && Math.abs(s.vol - 0.2) < 1e-9 && s.month === FREE_NEWS_BEST;
}

// Numbers the prose quotes, all from the model at the default settings.
const JAN = comparePlans(DEFAULTS);
const FEB = comparePlans({ ...DEFAULTS, month: 1 });
const BY_MONTH = MONTH_NAMES.map((_, m) => comparePlans({ ...DEFAULTS, month: m }).diff);
const MEAN_DIFF = BY_MONTH.reduce((a, b) => a + b, 0) / 12;
export const BEST_MONTH = BY_MONTH.indexOf(Math.max(...BY_MONTH));
const soyLeg = (p: Plan) => p.legs.find((l) => l.route === 'P-SAN-QIN')!;
const BALLAST_NM = seaRoute('QIN', 'SAN', { draft: ballastDraft(KESTREL) })!.nm;
const PAR_NM = seaRoute('PAR', 'SAN', { draft: ballastDraft(KESTREL) })!.nm;
const COAL_NM = seaRoute('SAM', 'QIN', { draft: ladenDraft(KESTREL, MARKET_CLASSES.kmax.cargo) })!.nm;
const COAL_DAYS = JAN.stay.legs[0].days;
const BALLAST_DAYS = soyLeg(JAN.repo).start;
/** Brazil's freight credits this many ballast miles, out of season and in the harvest. */
const POS_OFF = creditedMiles(JAN.eqs[0]);
const POS_ON = creditedMiles(JAN.eqs[2]);
/** Ships a month Santos draws from China in April, at the default harvest. */
export const APRIL_CHINA = shipsFromChina(JAN.eqs[3]);
const BUNKER_FEB = [300, 900].map((b) => comparePlans({ ...DEFAULTS, month: 1, bunker: b }).diff);
const BUNKER_JAN = [300, 900].map((b) => comparePlans({ ...DEFAULTS, month: 0, bunker: b }).diff);
const CONG4 = [comparePlans({ ...DEFAULTS, month: 1, waiting: 4 }).diff, comparePlans({ ...DEFAULTS, month: 0, waiting: 4 }).diff];
const SPEED_PLANS = [10, 14].map((sp) => comparePlans({ ...DEFAULTS, month: 1, speed: sp }));
const SPEED_FEB = SPEED_PLANS.map((p) => p.diff);
/** The first challenge's answer at the default fuel, speed and queue. */
export const WEAKEST_FULL = weakestFullCredit(DEFAULTS.bunker, DEFAULTS.speed, DEFAULTS.waiting);
export const APRIL = waitValue(3, 0.2, 3);
export const APRIL5 = waitValue(3, 0.2, 5);
export const FEB3 = waitValue(1, 0.2, 3);
const FEB_FREE = FREE_NEWS[1];
/** The decision month in which the first demonstration's two plans are closest. */
export const CLOSEST = BY_MONTH.map(Math.abs).indexOf(Math.min(...BY_MONTH.map(Math.abs)));
/** Free news's value in the next-best month. */
export const FREE_NEWS_RUNNER_UP = Math.max(...FREE_NEWS.filter((_, m) => m !== FREE_NEWS_BEST));

// Map routes.
const PACIFIC_OUT = seaRoute('QIN', 'SAM', { draft: ballastDraft(KESTREL) })!.points;
const PACIFIC_BACK = seaRoute('SAM', 'QIN', { draft: ladenDraft(KESTREL, MARKET_CLASSES.kmax.cargo) })!.points;
const ATLANTIC_OUT = seaRoute('QIN', 'SAN', { draft: ballastDraft(KESTREL) })!.points;
const ATLANTIC_BACK = seaRoute('SAN', 'QIN', { draft: ladenDraft(KESTREL, MARKET_CLASSES.kmax.cargo) })!.points;

// Timeline geometry.
const GX0 = 150;
const GX1 = 624;
const gx = scale(0, HORIZON, GX0, GX1);
const ROW = [{ y: 44, name: 'Stay in the Pacific' }, { y: 108, name: 'Ballast to Brazil' }];
const BAR_H = 34;

function legFill(l: Leg) {
  if (l.kind === 'ballast') return { fill: '#ffffff', stroke: '#8a8a8a', text: TEXT.gray };
  return l.route === 'P-SAN-QIN' ? { fill: SOY, stroke: '#a88a3c', text: '#3a3a3a' } : { fill: COAL, stroke: '#3f3d3b', text: '#ffffff' };
}

function Timeline({ s, stay, repo, eqs }: { s: AllocationState; stay: Plan; repo: Plan; eqs: Equilibrium[] }) {
  const months = Array.from({ length: Math.ceil(HORIZON / MONTH) }, (_, k) => k);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 176"
      role="img"
      aria-label={`Kestrel's next ${HORIZON} days from Qingdao, deciding in ${MONTH_NAMES[s.month]}. Staying in the Pacific earns ${perDay(stay.tce)}; ballasting to Brazil earns ${perDay(repo.tce)}, fixing soybeans at ${usd(soyLeg(repo).freight ?? 0, 2)} a tonne.`}
    >
      {months.map((k) => {
        const x0 = gx(k * MONTH);
        const x1 = gx(Math.min(HORIZON, (k + 1) * MONTH));
        return (
          <g key={k}>
            {k % 2 === 1 && <rect x={x0} y={22} width={x1 - x0} height={130} fill="#f3f2ee" />}
            <text className="ax" x={x0 + 4} y={14}>
              {MONTH_SHORT[(s.month + k) % 12]} · {usd(eqs[k].tce)}/day
            </text>
          </g>
        );
      })}
      {[stay, repo].map((p, i) => (
        <g key={i}>
          <text x={GX0 - 10} y={ROW[i].y + 14} textAnchor="end" style={{ fontSize: 13, fontWeight: 600, fill: TEXT.ink }}>
            {ROW[i].name}
          </text>
          <text x={GX0 - 10} y={ROW[i].y + 30} textAnchor="end" style={{ fontSize: 13, fontWeight: 500, fill: TEXT.green }}>
            {perDay(p.tce)}
          </text>
          {p.legs.map((l, j) => {
            const c = legFill(l);
            const x = gx(l.start);
            const w = gx(l.start + l.days) - x;
            const label = l.kind === 'ballast' ? `ballast to Santos, ${fmt(l.days, 0)} days` : l.route === 'P-SAN-QIN' ? `soybeans at ${usd(l.freight ?? 0, 2)}/t` : `coal ${usd(l.freight ?? 0, 2)}`;
            return (
              <g key={j}>
                <rect x={x + 0.5} y={ROW[i].y} width={Math.max(0, w - 1)} height={BAR_H} rx={3} fill={c.fill} stroke={c.stroke} strokeDasharray={l.kind === 'ballast' ? '4 3' : undefined} />
                {w > (l.kind === 'voyage' && l.route !== 'P-SAN-QIN' ? 60 : 90) && (
                  <text x={x + w / 2} y={ROW[i].y + BAR_H / 2 + 4} textAnchor="middle" style={{ fontSize: 11, fontWeight: 500, fill: c.text }}>
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}
      {[0, 20, 40, 60, 80, 100].map((d) => (
        <text key={d} className="ax ax-m" x={gx(d)} y={166}>
          {d === 0 ? 'day 0' : d}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const al = useScenario('allocation', DEFAULTS);
  const s = al.state;
  const r = useMemo(() => comparePlans(s), [s]);
  const { k: fixMonth, eq: fixEq } = soyFix(r);
  const credited = creditedMiles(fixEq);
  const fullCredit = credited >= BALLAST_NM - 1;
  const china = shipsFromChina(fixEq);
  const weakest = useMemo(() => (s.month === CREDIT_MONTH ? weakestFullCredit(s.bunker, s.speed, s.waiting) : null), [s.month, s.bunker, s.speed, s.waiting]);
  const solved = s.month === CREDIT_MONTH && weakest !== null && Math.abs(s.soy - weakest) < 1e-9;
  /** One step weaker than the reader's harvest, for the success message. */
  const weaker = useMemo(() => (solved ? fixCredit({ ...s, soy: Math.round((s.soy - 0.05) * 100) / 100 }) : null), [solved, s]);

  const fx = useScenario('flexibility', FLEX_DEFAULTS);
  const f = fx.state;
  const flex = useMemo(() => waitValue(f.month, f.vol, f.wait), [f.month, f.vol, f.wait]);
  const flexSolved = freeNewsSolved(f);
  const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
  const pctiles = flex.stay.map((_, i) => (100 * i) / (flex.stay.length - 1));

  return (
    <LessonPage id="shipping/5.4">
      <P>
        Kestrel has just discharged a cargo of coal in Qingdao, and she is <b>open</b>: free for her next job. Northwind Bulk has two kinds of work to choose from. She
        can stay where she is and run short voyages from Indonesia, loading coal at Samarinda, {fmt(COAL_NM)} nautical miles to the south, and bringing it back to
        China. Or she can sail empty for {fmt(BALLAST_NM)} miles to Santos and come back with 75,000 tonnes of Brazilian soybeans.
      </P>
      <P>
        This is the course’s central mechanism turned into a decision. Ships are mobile, but slowly: <a href={lessonHref('shipping/3.4')}>Lesson 3.4</a> showed that
        cargo flows leave them piling up where cargoes end, in China, and short where cargoes start, in Brazil, and that the only way across is a month or more of
        ballast. <a href={lessonHref('shipping/4.3')}>Lesson 4.3</a> found the market paying for that: a fronthaul trip from the Atlantic earns a premium. So when
        does it pay to make the trip, and what is it worth to put off deciding?
      </P>
      <P>
        We’ll compare the two plans over Kestrel’s next {HORIZON} days. Staying means back-to-back coal round voyages, each about {fmt(COAL_DAYS, 1)} days long at
        12 knots. Repositioning means {fmt(BALLAST_DAYS, 1)} days of ballast, the soybean voyage, and then coal voyages for whatever time is left. Each voyage is fixed
        at the freight rate of the month it starts in, taken from the market model’s months ahead with no surprises yet. In the next demonstration, choose the month
        you decide in, and change the physical world around the decision: Brazil’s harvest, the price of fuel, Kestrel’s speed and the queue at Qingdao. All rates
        are simulated:
      </P>

      <Figure name="Fleet Allocation Optimizer" scenario={al}>
        <WorldMap
          ariaLabel={`Kestrel's two plans from Qingdao: coal round voyages to Samarinda, or ${fmt(BALLAST_NM)} miles in ballast to Santos for soybeans.`}
          ports={['QIN', 'SAM', 'SAN', 'PAR'].map((id) => ({ id, color: id === 'QIN' ? TEXT.ink : '#777' }))}
          routes={[
            { points: ATLANTIC_OUT, color: '#8a8a8a', width: 2, dash: '5 4' },
            { points: ATLANTIC_BACK, color: '#c4a45a', width: 3, flow: true },
            { points: PACIFIC_OUT, color: '#8a8a8a', width: 2, dash: '5 4' },
            { points: PACIFIC_BACK, color: COAL, width: 3, flow: true },
          ]}
        />
        <Legend
          items={[
            { label: 'Coal, Samarinda–Qingdao', color: COAL },
            { label: 'Soybeans, Santos–Qingdao', color: SOY },
            { label: 'In ballast', color: '#8a8a8a', kind: 'line', dashed: true },
          ]}
        />
        <Timeline s={s} stay={r.stay} repo={r.repo} eqs={r.eqs} />
        <Readouts items={[{ label: `repositioning against staying, over the ${HORIZON} days`, value: signedDay(r.diff), tone: r.diff >= 0 ? 'green' : 'red' }]} />
        <Slider label="Deciding in" tone="teal" value={s.month} min={0} max={11} onChange={(v) => al.set({ month: v })} display={MONTH_NAMES[s.month]} />
        <Slider
          label="Brazil’s soybean harvest"
          tone="orange"
          value={s.soy}
          min={0.5}
          max={1.5}
          step={0.05}
          onChange={(v) => al.set({ soy: v })}
          display={mt(s.soy)}
        />
        <Slider label="Bunker price" tone="green" value={s.bunker} min={300} max={900} step={10} onChange={(v) => al.set({ bunker: v })} display={`${usd(s.bunker)}/t`} />
        <Slider label="Kestrel’s speed" tone="teal" value={s.speed} min={10} max={14} step={0.5} onChange={(v) => al.set({ speed: v })} display={`${fmt(s.speed, 1)} kn`} />
        <Slider label="Extra waiting at Qingdao" tone="teal" value={s.waiting} min={0} max={4} onChange={(v) => al.set({ waiting: v })} display={`${s.waiting} days a call`} />
        <Caption>
          {china > 0.05
            ? `Kestrel loads in ${MONTH_NAMES[(s.month + fixMonth) % 12]}, when Santos draws ${china >= 1 ? `about ${fmt(china)} ships a month` : 'less than one ship a month'} in ballast from China, so Brazil’s soybean freight pays for ${fullCredit ? `the whole of her ${fmt(BALLAST_NM)} miles of ballast` : `${fmt(credited)} of her ${fmt(BALLAST_NM)} miles of ballast`}.`
            : `Kestrel loads in ${MONTH_NAMES[(s.month + fixMonth) % 12]}, when Santos draws no ships from China — its empty ships come from closer ports — so Brazil’s soybean freight pays for ${fmt(credited)} miles of ballast from China${fullCredit ? ', all of hers' : `, not all of her ${fmt(BALLAST_NM)}`}.`}
        </Caption>
      </Figure>

      <P>
        Start in January. Staying earns {perDay(JAN.stay.tce)}; repositioning earns {perDay(JAN.repo.tce)}, {usd(Math.abs(JAN.diff))} a day less. Kestrel reaches
        Santos in February and fixes her soybeans at {usd(soyLeg(JAN.repo).freight ?? 0, 2)} a tonne, a slack month’s rate, while the coal voyages she gave up keep
        earning through a spring that is picking up. Now move the decision to February. The ballast leg takes her into March, the harvest is under way, and the
        soybean freight is {usd(soyLeg(FEB.repo).freight ?? 0, 2)} a tonne. Repositioning now earns {perDay(FEB.repo.tce)} against {perDay(FEB.stay.tce)}:{' '}
        {usd(FEB.diff)} a day more, the best of any month. Brazil ships its soybeans mostly from March to July, and a cargo fixed as the season peaks pays the
        season’s rate for the whole long round trip.
      </P>
      <P>
        Step on through the year and the advantage fades. By April the two plans are within {usd(Math.abs(BY_MONTH[3]))} a day of each other, and from May to
        January staying wins every time. Averaged over all twelve months, repositioning trails by {usd(Math.abs(MEAN_DIFF))} a day.
      </P>

      <H2>What the freight already pays for</H2>
      <P>
        If the market prices the ballast leg, why should repositioning lose on an ordinary month? Because the market prices <i>the market’s</i> ballast leg, not
        Kestrel’s. Recall the positional values of <a href={lessonHref('shipping/3.4')}>Lesson 3.4</a>: freight from a loading port pays for the empty miles of the
        ship the market needs to bring there. Out of season, the ships Santos needs come from Paradip, in India, where the coal trades leave Kamsarmaxes free{' '}
        {fmt(PAR_NM)} miles away. Brazil’s freight then pays for {fmt(POS_OFF)} miles of ballast measured from China, and Kestrel must sail {fmt(BALLAST_NM - POS_OFF)}{' '}
        more — about {fmt((BALLAST_NM - POS_OFF) / (24 * 12), 1)} days at 12 knots — that nobody pays for. In the harvest, Santos needs so many ships that it draws
        them from China too, about {fmt(APRIL_CHINA)} a month in April in our model, and the freight then pays for all {fmt(POS_ON)} miles. A
        Kamsarmax open in Qingdao is the marginal ballaster only at the height of the season, which is exactly when it should go.
      </P>
      <P>
        The other drivers move the answer in ways the earlier chapters predict. Raise the bunker price and every difference grows: February’s gain from{' '}
        {usd(BUNKER_FEB[0])} a day at {usd(300)} a tonne to {usd(BUNKER_FEB[1])} at {usd(900)}, January’s loss from {usd(Math.abs(BUNKER_JAN[0]))} to{' '}
        {usd(Math.abs(BUNKER_JAN[1]))}. The empty voyage burns more money, but in a busy month the earnings it is chasing rise with fuel too, the property of our
        model’s speed rule that <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a> found. Add waiting at Qingdao and the Pacific loses its appeal, because the coal
        plan calls there every {fmt(COAL_DAYS)} days or so and queues each time (<a href={lessonHref('shipping/3.2')}>Lesson 3.2</a>): with four extra days a call, February’s gain
        rises to {usd(CONG4[0])} a day and January’s loss shrinks to {usd(Math.abs(CONG4[1]))}. Kestrel’s own speed matters less than you might expect —
        February’s gain is {usd(SPEED_FEB[0])} at 10 knots and {usd(SPEED_FEB[1])} at 14 — because her speed moves both plans together: at 10 knots staying earns{' '}
        {usd(FEB.stay.tce - SPEED_PLANS[0].stay.tce)} a day less than at 12 and repositioning {usd(FEB.repo.tce - SPEED_PLANS[0].repo.tce)} less, so the gap
        between them hardly moves.
      </P>

      <Challenge
        id="a"
        figure="Fleet Allocation Optimizer"
        question={`Decide in March, so that Kestrel loads in April at the height of the harvest, when Santos draws about ${fmt(APRIL_CHINA)} ships a month from China. Weaken Brazil’s harvest one step and watch the caption’s count of those ships. Predict from how fast it falls the weakest harvest on the slider at which Brazil’s freight still pays for all ${fmt(BALLAST_NM)} of Kestrel’s ballast miles, then check.`}
        solved={solved}
        status={
          s.month !== CREDIT_MONTH
            ? `Set the decision month to March; it is ${MONTH_NAMES[s.month]}.`
            : weakest === null
              ? 'With these settings Brazil’s freight never pays for her whole trip in April. Ease the queue or the fuel price back toward the start.'
              : `At ${mt(s.soy)}, the freight pays for ${fullCredit ? 'all' : fmt(credited)} of Kestrel’s ${fmt(BALLAST_NM)} miles.`
        }
        success={`Solved. At ${mt(s.soy)}, ${pct(s.soy)} of a normal harvest, Santos still draws ${china >= 1 ? `about ${fmt(china)} ships a month` : 'a few ships'} from China in April, so Brazil’s freight pays for all of Kestrel’s ${fmt(BALLAST_NM)} miles and repositioning beats staying by ${usd(r.diff)} a day.${
          weaker && !weaker.full
            ? ` One step weaker, Santos needs none of them: the freight pays for only ${fmt(weaker.miles)} miles, and repositioning’s edge ${weaker.diff > 0 ? `shrinks to ${usd(weaker.diff)}` : `turns into a loss of ${usd(-weaker.diff)}`} a day.`
            : ''
        } Kestrel’s long trip is paid for only while ships open in China, like her, are ones the market needs — which is why the opportunity was the harvest all along.`}
      />

      <H2>What flexibility is worth</H2>
      <P>
        So far the future has been known: each month’s rate was the model’s expectation, with no surprises. Real owners decide without knowing what next month will
        pay. That gives a third choice its value. Kestrel could stay uncommitted at Qingdao for a few days, see which way the market moves, and then take whichever
        plan looks better. Waiting costs her those days of earnings and a little fuel at anchor. What it buys is the right to choose later — an <K tone="green">option</K>,
        in the language of finance.
      </P>
      <P>
        In the next demonstration the market’s earnings move each month by a random amount, with the size you set, in 200 simulated futures. For each choice —
        staying, repositioning, and waiting then choosing — the chart sorts its 200 outcomes from worst to best, so each line shows the spread of what that choice
        could earn. The lines are sorted separately, so points at the same place on two lines are usually different futures: compare the lines’ overall heights,
        which the averages in the readouts sum up. Waiting means seeing the next month’s market before committing — all of it, however short the wait, a
        simplification of our model:
      </P>

      <Figure name="Fleet Allocation Optimizer · flexibility" scenario={fx}>
        <XYChart
          ariaLabel={`Outcomes over 200 simulated futures, deciding in ${MONTH_NAMES[f.month]} with the market swinging ${pct(f.vol)} a month. Average earnings: staying ${perDay(flex.mean.stay)}, repositioning ${perDay(flex.mean.reposition)}, waiting ${f.wait} days then choosing ${perDay(flex.mean.wait)}.`}
          series={[
            { xs: pctiles, ys: sorted(flex.stay), color: COAL, width: 2.5 },
            { xs: pctiles, ys: sorted(flex.reposition), color: '#c4a45a', width: 2.5 },
            { xs: pctiles, ys: sorted(flex.wait), color: GRAPHIC.violet, width: 2.5, dash: '6 4' },
          ]}
          xMin={0}
          xMax={100}
          yMin={0}
          xTicks={[0, 25, 50, 75, 100]}
          xFormat={(v) => `${v}%`}
          yFormat={(v) => `$${fmt(v / 1000)}k`.replace('$−', '−$')}
          xLabel="Simulated futures, worst to best"
          yLabel="Earnings over the 100 days, $ per day"
          height={220}
        />
        <Legend
          items={[
            { label: 'Stay in the Pacific', color: COAL, kind: 'line' },
            { label: 'Ballast to Brazil', color: '#c4a45a', kind: 'line' },
            { label: `Wait ${f.wait} days, then choose`, color: GRAPHIC.violet, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'staying, on average', value: perDay(flex.mean.stay), tone: 'green' },
            { label: 'repositioning', value: perDay(flex.mean.reposition), tone: 'green' },
            { label: 'waiting, then choosing', value: perDay(flex.mean.wait), tone: 'violet' },
            { label: 'value of waiting', value: signedDay(flex.value), tone: flex.value > 0 ? 'green' : 'red' },
          ]}
        />
        <Slider label="Deciding in" tone="teal" value={f.month} min={0} max={11} onChange={(v) => fx.set({ month: v })} display={MONTH_NAMES[f.month]} />
        <Slider label="Market swings" tone="green" value={f.vol} min={0} max={0.3} step={0.05} onChange={(v) => fx.set({ vol: v })} display={`±${pct(f.vol)} a month`} />
        <Slider label="Days spent waiting" tone="teal" value={f.wait} min={0} max={20} onChange={(v) => fx.set({ wait: v })} display={`${f.wait} days`} />
      </Figure>

      <P>
        Start in February, the month the first demonstration found repositioning furthest ahead, with the market swinging ±20% a month. Staying averages{' '}
        {perDay(FEB3.mean.stay)} and repositioning {perDay(FEB3.mean.reposition)}; waiting three days and then choosing averages {perDay(FEB3.mean.wait)},{' '}
        {usd(-FEB3.value)} a day worse than simply repositioning now. Set the wait to zero and you see what the news would be worth if it cost nothing: here, only{' '}
        {usd(FEB_FREE)} a day, because nothing next month could say would change the choice.
      </P>

      <Challenge
        id="b"
        question="Keep the wait at zero, so the news costs nothing, and the market swinging ±20% a month. In which month is free news worth most to Kestrel? Predict from the first demonstration before you move the month, then check."
        solved={flexSolved}
        status={
          f.wait !== 0 || Math.abs(f.vol - 0.2) > 1e-9
            ? 'Set the days spent waiting to zero and the market swings to ±20%.'
            : `Deciding in ${MONTH_NAMES[f.month]}, free news is worth ${usd(Math.max(0, flex.value))} a day.`
        }
        success={`Solved: in ${MONTH_NAMES[FREE_NEWS_BEST]} free news is worth ${usd(FREE_NEWS[FREE_NEWS_BEST])} a day, more than three times as much as in any other month. ${MONTH_NAMES[FREE_NEWS_BEST]} is when the first demonstration’s two plans were closest, ${usd(Math.abs(BY_MONTH[CLOSEST]))} a day apart, so a strong or a weak next month can tip the choice either way. When one plan is far ahead, as in February, the same news changes nothing.`}
      />

      <P>
        News is rarely free, though. In April, waiting three days and then choosing still averages {perDay(APRIL.mean.wait)}, against {perDay(APRIL.mean.stay)}{' '}
        for staying and {perDay(APRIL.mean.reposition)} for repositioning: worth {usd(APRIL.value)} a day more than the better plan chosen now. It wins because when
        May turns out strong, the waiting ship heads for Brazil, and when it turns out weak, she stays. Stretch the wait to five days and the value turns to{' '}
        {signedDay(APRIL5.value)}: the information is no better, and the days are gone.
      </P>
      <P>
        That is the shape of every repositioning decision. Keeping a ship uncommitted is worth most when the plans are close and the future uncertain, and least when
        one plan is clearly better — and the waiting itself costs days that can’t be earned back. Owners do this every week, judging whether to fix now or hold a
        ship open, and the judgment rests on the physics underneath: how far the ballast is, how fast she can go, what fuel costs and when the harvest peaks. Change
        any of them in <FigRef to="Fleet Allocation Optimizer">the first demonstration</FigRef> and the opportunity moves or disappears.
      </P>
      <P>
        Each strategy in this chapter has been judged on the model’s months ahead or on one simulated history. In <a href={lessonHref('shipping/5.5')}>the next
        lesson</a> we’ll test strategies — forward freight agreements, fuel hedges and charters — over the whole history, with commissions, and look hard at the ways a
        backtest can flatter a strategy that doesn’t work.
      </P>
    </LessonPage>
  );
}
