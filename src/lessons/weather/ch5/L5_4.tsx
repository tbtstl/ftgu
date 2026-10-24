import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
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
import {
  DRIVER_DEFAULTS,
  INSTRUMENTS,
  crossMarketIdeas,
  priceCurves,
  weekValue,
  type DayForecast,
  type PhysicalDrivers,
  type TradeIdea,
} from '../../../engines/weather/crossMarket';
import { knownShare } from '../../../model/weather/archive';
import { CALDER } from '../../../model/weather/region';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The week, the view and the physics.

/** Forecast error of each day of next week as the market sees it: a January forecast 6–12 days ahead (Lesson 3.5's spreads). */
export const WEEK_SDS: number[] = Array.from({ length: 7 }, (_, i) => CALDER.winterSd * Math.sqrt(1 - knownShare(6 + i)));
const SD_TYPICAL = WEEK_SDS.reduce((s, v) => s + v, 0) / WEEK_SDS.length;

export interface LabState {
  /** The market's expected daily mean temperature for next week, °F. */
  week: number;
  /** How much colder than the market we expect next week to be, °F. */
  revision: number;
  /** Pipeline capacity into the region, million MMBtu per day. */
  pipeline: number;
  /** Mean wind on Hollin Ridge, m/s. */
  wind: number;
}

export const LAB_DEFAULTS: LabState = { week: 18, revision: 6, pipeline: DRIVER_DEFAULTS.pipeline / 1e6, wind: DRIVER_DEFAULTS.windMs };
export const PIPELINE_STEP = 0.05;

export function labWeek(st: LabState): DayForecast[] {
  return WEEK_SDS.map((sd) => ({ mean: st.week, sd }));
}

export function labDrivers(st: LabState): PhysicalDrivers {
  return { pipeline: Math.round(st.pipeline * 1e6), windMs: st.wind };
}

/** The three trades for a state: HDD future, next week's gas, next week's power. */
export function labIdeas(st: LabState): TradeIdea[] {
  return crossMarketIdeas(labWeek(st), -st.revision, labDrivers(st));
}

/**
 * The first challenge: with the starting week, revision and wind, the smallest pipeline capacity
 * (on the slider's 0.05 steps) at which the gas trade no longer pays its spread.
 */
export function pipelineSolved(st: LabState): boolean {
  const d = LAB_DEFAULTS;
  if (st.week !== d.week || st.revision !== d.revision || st.wind !== d.wind) return false;
  const net = (p: number) => labIdeas({ ...st, pipeline: p })[1].netPerContract;
  const prev = Math.round((st.pipeline - PIPELINE_STEP) * 100) / 100;
  return net(st.pipeline) < 0 && net(prev) >= 0;
}

// ---------------------------------------------------------------------------
// The book.

/** The desk's limit on the standard deviation of next week's P&L, $. */
export const RISK_LIMIT = 500_000;

export interface Book {
  hdd: number;
  gas: number;
  power: number;
}

export const BOOK_DEFAULTS: Book = { hdd: 0, gas: 0, power: 0 };

/**
 * A book's expected profit and its risk. The three trades win or lose on the same cold, so their
 * risks are added as if they moved together — a cautious assumption.
 */
export function bookValue(ideas: TradeIdea[], b: Book): { net: number; risk: number } {
  const n = [b.hdd, b.gas, b.power];
  let net = 0;
  let risk = 0;
  ideas.forEach((x, i) => {
    net += n[i] * x.netPerContract;
    risk += n[i] * x.riskPerContract;
  });
  return { net, risk };
}

/** The most expected profit any book of whole contracts can make within the limit and each market's size limit. */
export function bestBook(ideas: TradeIdea[], limit = RISK_LIMIT): { book: Book; net: number; risk: number } {
  const [h, g, p] = ideas;
  let top = { book: { ...BOOK_DEFAULTS }, net: 0, risk: 0 };
  for (let i = 0; i <= INSTRUMENTS.hdd.maxSize; i++) {
    for (let j = 0; j <= INSTRUMENTS.gas.maxSize; j++) {
      const r0 = i * h.riskPerContract + j * g.riskPerContract;
      if (r0 > limit) break;
      for (let k = 0; k <= INSTRUMENTS.power.maxSize; k++) {
        const risk = r0 + k * p.riskPerContract;
        if (risk > limit) break;
        const net = i * h.netPerContract + j * g.netPerContract + k * p.netPerContract;
        if (net > top.net + 1e-6) top = { book: { hdd: i, gas: j, power: k }, net, risk };
      }
    }
  }
  return top;
}

/** The second challenge: a book within the risk limit that earns within 1% of the best possible. */
export function bookSolved(st: LabState, b: Book): boolean {
  const ideas = labIdeas(st);
  const v = bookValue(ideas, b);
  const best = bestBook(ideas);
  return best.net > 0 && v.risk <= RISK_LIMIT && v.net >= 0.99 * best.net;
}

// ---------------------------------------------------------------------------
// Drawing.

const X0 = 64;
const X1 = 596;
const TX = scale(-10, 70, X0, X1);
const T_GRID = Array.from({ length: 161 }, (_, i) => -10 + i * 0.5);

function bellPath(mean: number, base: number, height: number): string {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of T_GRID) {
    const z = (t - mean) / SD_TYPICAL;
    xs.push(TX(t));
    ys.push(base - height * Math.exp(-(z * z) / 2));
  }
  return `${linePath(xs, ys)} L${TX(70)} ${base} L${TX(-10)} ${base} Z`;
}

interface PanelSpec {
  title: string;
  values: number[];
  yMax: number;
  ticks: number[];
  format: (v: number) => string;
  color: string;
  before: number;
  after: number;
  label: (v: number) => string;
}

function Panel({ p, top, st }: { p: PanelSpec; top: number; st: LabState }) {
  const h = 92;
  const y = scale(0, p.yMax, top + h, top);
  const clip = `l54-${top}`;
  const marketMean = st.week;
  const ourMean = st.week - st.revision;
  const yb = y(Math.min(p.yMax, p.before));
  const ya = y(Math.min(p.yMax, p.after));
  const close = Math.abs(yb - ya) < 13;
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={X0} y={top - 2} width={X1 - X0} height={h + 4} />
        </clipPath>
      </defs>
      <text className="ax" x={X0} y={top - 8}>
        {p.title}
      </text>
      <GridY y={y} ticks={p.ticks} x0={X0} x1={X1} format={p.format} baseline={0} />
      <g clipPath={`url(#${clip})`}>
        <path d={bellPath(marketMean, top + h, 26)} fill="#9a9a9a" opacity={0.18} />
        <path d={bellPath(ourMean, top + h, 26)} fill={GRAPHIC.blue} opacity={0.22} />
        <path d={linePath(T_GRID.map(TX), p.values.map((v) => y(Math.min(p.yMax * 1.05, v))))} fill="none" stroke={p.color} strokeWidth={2.5} />
        <line x1={X0} x2={X1} y1={yb} y2={yb} stroke="#777" strokeWidth={1.2} strokeDasharray="5 4" />
        <line x1={X0} x2={X1} y1={ya} y2={ya} stroke={GRAPHIC.blue} strokeWidth={1.5} strokeDasharray="5 4" />
      </g>
      <text className="ax ax-e" x={X1 - 4} y={close ? Math.min(yb, ya) - 16 : yb - 4}>
        market {p.label(p.before)}
      </text>
      <text className="ax ax-e" x={X1 - 4} y={close ? Math.min(yb, ya) - 4 : ya - 4} style={{ fill: TEXT.blue }}>
        ours {p.label(p.after)}
      </text>
    </g>
  );
}

function CurvesChart({ st }: { st: LabState }) {
  const dr = labDrivers(st);
  const curves = priceCurves(dr);
  const interp = (ys: number[]) =>
    T_GRID.map((t) => {
      const i = Math.min(curves.temps.length - 2, Math.max(0, Math.floor((t - curves.temps[0]) / 2)));
      const f = Math.max(0, Math.min(1, (t - curves.temps[i]) / 2));
      return ys[i] + (ys[i + 1] - ys[i]) * f;
    });
  const days = labWeek(st);
  const before = weekValue(days, 0, dr);
  const after = weekValue(days, -st.revision, dr);
  const panels: PanelSpec[] = [
    {
      title: 'Heating degree days per day',
      values: T_GRID.map((t) => Math.max(0, 65 - t)),
      yMax: 80,
      ticks: [0, 40, 80],
      format: (v) => fmt(v),
      color: GRAPHIC.orange,
      before: before.hdd / 7,
      after: after.hdd / 7,
      label: (v) => `${fmt(v, 1)} a day`,
    },
    {
      title: 'City-gate gas, $ per MMBtu',
      values: interp(curves.gas),
      yMax: 32,
      ticks: [0, 10, 20, 30],
      format: (v) => `$${v}`,
      color: GRAPHIC.green,
      before: before.gas,
      after: after.gas,
      label: (v) => usd(v, 2),
    },
    {
      title: 'Power, day’s average, $ per MWh',
      values: interp(curves.power),
      yMax: 300,
      ticks: [0, 100, 200, 300],
      format: (v) => `$${v}`,
      color: GRAPHIC.green,
      before: before.power,
      after: after.power,
      label: (v) => usd(v),
    },
  ];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 432"
      role="img"
      aria-label={`How degree days, gas and power respond to a January day's temperature, with pipelines of ${fmt(st.pipeline, 2)} million MMBtu a day and ${fmt(st.wind, 1)} m/s of wind. The market expects next week to average ${fmt(st.week)} °F; we expect ${fmt(st.week - st.revision)} °F. Expected over the week: ${fmt(before.hdd)} versus ${fmt(after.hdd)} heating degree days, gas ${usd(before.gas, 2)} versus ${usd(after.gas, 2)}, power ${usd(before.power)} versus ${usd(after.power)}.`}
    >
      {panels.map((p, i) => (
        <Panel key={p.title} p={p} top={22 + i * 130} st={st} />
      ))}
      <line x1={TX(65)} x2={TX(65)} y1={22} y2={404} stroke="#bdbdbd" strokeDasharray="2 3" />
      {[-10, 0, 10, 20, 30, 40, 50, 60, 70].map((t) => (
        <text key={t} className="ax ax-m" x={TX(t)} y={420}>
          {t}°
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={432}>
        daily mean temperature, °F
      </text>
    </svg>
  );
}

function RatioBars({ ideas }: { ideas: TradeIdea[] }) {
  const x = scale(-1.5, 1.5, 200, 600);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 118"
      role="img"
      aria-label={`Expected profit after costs per unit of risk: ${ideas.map((i) => `${i.instrument.name} ${fmt(i.ratio, 2)}`).join(', ')}.`}
    >
      <text className="ax" x={200} y={12}>
        Expected profit after costs, per dollar of risk
      </text>
      {[-1, 0, 1].map((v) => (
        <g key={v}>
          <line className={v === 0 ? 'base' : 'gl'} x1={x(v)} x2={x(v)} y1={20} y2={104} />
          <text className="ax ax-m" x={x(v)} y={116}>
            {fmt(v, 1)}
          </text>
        </g>
      ))}
      {ideas.map((idea, i) => {
        const r = Math.max(-1.5, Math.min(1.5, idea.ratio));
        const y0 = 26 + i * 26;
        const pos = r >= 0;
        return (
          <g key={idea.instrument.id}>
            <text className="lab" x={192} y={y0 + 13} textAnchor="end">
              {idea.instrument.name}
            </text>
            <rect x={Math.min(x(0), x(r))} y={y0} width={Math.abs(x(r) - x(0))} height={18} fill={pos ? GRAPHIC.green : GRAPHIC.red} opacity={0.75} />
            <text className="ax" x={pos ? x(r) + 6 : x(r) - 6} y={y0 + 13} textAnchor={pos ? 'start' : 'end'} style={{ fill: pos ? TEXT.green : TEXT.red, fontWeight: 600 }}>
              {fmt(idea.ratio, 2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const EDGE_UNIT: Record<string, (v: number) => string> = {
  hdd: (v) => `${fmt(v, 1)} HDD`,
  gas: (v) => `${usd(v, 2)}/MMBtu`,
  power: (v) => `${usd(v, 2)}/MWh`,
};

function money(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${fmt(a / 1e6, 2)}M` : a >= 1e4 ? `$${fmt(a / 1e3)}k` : usd(a);
  return v < 0 ? `−${s}` : s;
}

const BOOK_COLORS = { hdd: GRAPHIC.orange, gas: GRAPHIC.green, power: GRAPHIC.gold } as const;

function BookBars({ ideas, book, best }: { ideas: TradeIdea[]; book: Book; best: { net: number } }) {
  const n = [book.hdd, book.gas, book.power];
  const ids = ['hdd', 'gas', 'power'] as const;
  const risks = ideas.map((x, i) => n[i] * x.riskPerContract);
  const nets = ideas.map((x, i) => n[i] * x.netPerContract);
  const riskTotal = risks.reduce((s, v) => s + v, 0);
  const netTotal = nets.reduce((s, v) => s + v, 0);
  const max = Math.max(RISK_LIMIT * 1.4, riskTotal, best.net * 1.1, netTotal);
  const x = scale(0, max, 120, 600);
  const row = (vals: number[], y: number) => {
    let acc = 0;
    return vals.map((v, i) => {
      const w = Math.max(0, x(acc + Math.max(0, v)) - x(acc));
      const el = <rect key={ids[i]} x={x(acc)} y={y} width={w} height={20} fill={BOOK_COLORS[ids[i]]} opacity={0.8} />;
      acc += Math.max(0, v);
      return el;
    });
  };
  return (
    <svg
      className="chart"
      viewBox="0 0 640 116"
      role="img"
      aria-label={`The book: ${book.hdd} HDD futures, ${book.gas} gas contracts and ${book.power} power contracts. Risk ${money(riskTotal)} against a limit of ${money(RISK_LIMIT)}; expected profit after costs ${money(netTotal)}, against ${money(best.net)} for the best book within the limit.`}
    >
      <text className="lab" x={112} y={36} textAnchor="end">
        Risk
      </text>
      {row(risks, 22)}
      <line x1={x(RISK_LIMIT)} x2={x(RISK_LIMIT)} y1={14} y2={50} stroke={GRAPHIC.red} strokeWidth={2} />
      <text className="ax" x={x(RISK_LIMIT) + 4} y={12} style={{ fill: TEXT.red }}>
        limit {money(RISK_LIMIT)}
      </text>
      <text className="lab" x={112} y={82} textAnchor="end">
        Expected profit
      </text>
      {row(nets, 68)}
      {best.net > 0 && (
        <g>
          <line x1={x(best.net)} x2={x(best.net)} y1={60} y2={96} stroke="#333" strokeWidth={1.5} strokeDasharray="4 3" />
          <text className="ax" x={x(best.net) + 4} y={108}>
            best possible {money(best.net)}
          </text>
        </g>
      )}
      <line className="base" x1={120} x2={120} y1={14} y2={96} />
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('lab', LAB_DEFAULTS);
  const st = s.state;
  const ideas = useMemo(() => labIdeas(st), [st]);
  const [hddIdea, gasIdea] = ideas;
  const solved = useMemo(() => pipelineSolved(st), [st]);

  const b = useScenario('book', BOOK_DEFAULTS);
  const book = b.state;
  const value = bookValue(ideas, book);
  const best = useMemo(() => bestBook(ideas), [ideas]);
  const solved2 = useMemo(() => bookSolved(st, book), [st, book]);

  // Numbers the prose quotes, all from the same engines.
  const q = useMemo(() => {
    const at = (patch: Partial<LabState>) => labIdeas({ ...LAB_DEFAULTS, ...patch });
    const dr = labDrivers(LAB_DEFAULTS);
    const days = labWeek(LAB_DEFAULTS);
    const start = at({});
    const curves = priceCurves(dr);
    const gasAt18 = curves.gas[curves.temps.indexOf(18)];
    return {
      start,
      before: weekValue(days, 0, dr),
      after: weekValue(days, -LAB_DEFAULTS.revision, dr),
      gasAt18,
      mild: at({ week: 34 }),
      milder: at({ week: 40 }),
      warm60: at({ week: 60 }),
      cold13: at({ week: 13 }),
      cold14: at({ week: 14 }),
      cold10: at({ week: 10 }),
      frozen: at({ week: 0 }),
      calm: at({ wind: 3 }),
      windy: at({ wind: 13 }),
      pipe180: at({ pipeline: 1.8 }),
      pipe185: at({ pipeline: 1.85 }),
      pipe200: at({ pipeline: 2 }),
      bestStart: bestBook(start),
      bestMild: bestBook(at({ week: 34 })),
    };
  }, []);

  const ratioWord = (x: TradeIdea) => fmt(x.ratio, 2);

  return (
    <LessonPage id="weather/5.4">
      <P>
        <a href={lessonHref('weather/5.3')}>The previous lesson</a> found an edge in information: a forecaster whose view of the coming days is fresher than the
        market’s can see the price of a degree-day contract move before it moves. Suppose it’s Monday in January and the latest forecast for next week has come in{' '}
        {fmt(LAB_DEFAULTS.revision)} °F colder than the one the market is still trading on. The obvious trade is the one we’ve already met: buy Calder Bay’s HDD future.
        But the same six degrees will move other prices too. Every furnace in the city and every gas plant on the grid will feel them, and{' '}
        <a href={lessonHref('weather/4.2')}>Lesson 4.2</a> showed what that does to the gas and power markets. Which market should carry the view?
      </P>
      <P>
        Three simulated contracts are on offer, each settling on next week. The <K tone={WX.index}>HDD future</K> pays $20 for every heating degree day; its
        quoted half-spread is 5 points, $100 a contract, and the market will take at most {INSTRUMENTS.hdd.maxSize} contracts at that price. The{' '}
        <K tone={WX.money}>gas contract</K> delivers 10,000 MMBtu a day to the city gate for seven days, with a half-spread of $0.15 per MMBtu and a limit of{' '}
        {INSTRUMENTS.gas.maxSize}. The <K tone={WX.money}>power contract</K> delivers 25 MW around the clock for the week, 4,200 MWh, with a half-spread of $1.50 per
        MWh and a limit of {INSTRUMENTS.power.maxSize}. Like every price in this course, these are made up for the model; real weather futures trade far less than
        natural gas futures do.
      </P>
      <P>
        For each contract, the <b>edge</b> is how far our expected price for the week sits from the market’s, each averaged over its own forecast distribution —{' '}
        <a href={lessonHref('weather/3.5')}>Lesson 3.5</a>’s spreads, about {fmt(WEEK_SDS[0], 1)} °F six days ahead and {fmt(WEEK_SDS[6], 1)} °F twelve days
        ahead. The edge times the contract’s size is the expected profit before costs; the spread comes off it. The <K tone={WX.probability}>risk</K> is the
        standard deviation of the profit if we hold to settlement, since even our sharper forecast is far from certain. Contracts this different in size can only
        be compared by their ratio: expected profit after costs per dollar of risk. In the next demonstration, the three panels show how a January day’s heating
        degree days, gas price and power price respond to its temperature. The gray bell is the market’s view of next week, the blue one ours, and the dashed
        lines are what each expects. Change the week, our revision and the physics underneath:
      </P>

      <Figure name="Weather-Energy Trading Lab" scenario={s}>
        <CurvesChart st={st} />
        <Legend
          items={[
            { label: 'Market’s view', color: '#bdbdbd' },
            { label: 'Our view', color: GRAPHIC.blue },
            { label: 'Degree days', color: GRAPHIC.orange, kind: 'line' },
            { label: 'Prices', color: GRAPHIC.green, kind: 'line' },
          ]}
        />
        <DataTable
          caption="Each trade per contract: edge, profit before costs, the spread paid, profit after costs, risk and the ratio"
          rows={ideas}
          rowKey={(r) => r.instrument.id}
          columns={[
            { label: 'Market', cell: (r) => r.instrument.name },
            { label: 'Edge', cell: (r) => EDGE_UNIT[r.instrument.id](r.edge), align: 'right' },
            { label: 'Gross', cell: (r) => money(r.grossPerContract), align: 'right' },
            { label: 'Spread', cell: (r) => money(r.costPerContract), align: 'right' },
            { label: 'Net', cell: (r) => money(r.netPerContract), align: 'right' },
            { label: 'Risk', cell: (r) => money(r.riskPerContract), align: 'right' },
          ]}
        />
        <RatioBars ideas={ideas} />
        <Slider label="Next week, as the market sees it" tone={WX.temperature} value={st.week} min={0} max={50} onChange={(v) => s.set({ week: v })} display={`${fmt(st.week)} °F`} />
        <Slider
          label="Our forecast is colder by"
          tone={WX.probability}
          value={st.revision}
          min={0}
          max={10}
          onChange={(v) => s.set({ revision: v })}
          display={`${fmt(st.revision)} °F`}
        />
        <Slider
          label="Pipeline capacity"
          tone={WX.money}
          value={st.pipeline}
          min={1.2}
          max={2.2}
          step={PIPELINE_STEP}
          onChange={(v) => s.set({ pipeline: Math.round(v * 100) / 100 })}
          display={`${fmt(st.pipeline, 2)} million MMBtu/day`}
        />
        <Slider label="Wind on Hollin Ridge" tone={WX.wind} value={st.wind} min={3} max={13} step={0.5} onChange={(v) => s.set({ wind: v })} display={`${fmt(st.wind, 1)} m/s`} />
      </Figure>

      <P>
        At the start, the market expects next week to average {fmt(LAB_DEFAULTS.week)} °F and we expect {fmt(LAB_DEFAULTS.week - LAB_DEFAULTS.revision)} °F. The HDD
        future’s edge is exactly {fmt(q.start[0].edge)} degree days — six degrees on each of seven days — worth {usd(q.start[0].grossPerContract)} a contract before
        the {usd(q.start[0].costPerContract)} spread and {usd(q.start[0].netPerContract)} after it, against {usd(q.start[0].riskPerContract)} of risk: a ratio of{' '}
        {ratioWord(q.start[0])}. Gas has an edge of {usd(q.start[1].edge, 2)} per MMBtu, which on 70,000 MMBtu is {money(q.start[1].netPerContract)} after costs, with{' '}
        {money(q.start[1].riskPerContract)} of risk: {ratioWord(q.start[1])}. Power’s {usd(q.start[2].edge, 2)} per MWh nets {money(q.start[2].netPerContract)} at a
        ratio of {ratioWord(q.start[2])}. Per dollar of risk, the three are close, with the degree-day future slightly ahead.
      </P>
      <P>
        Notice where the market’s expected gas price sits: {usd(q.before.gas, 2)}, though the curve at {fmt(LAB_DEFAULTS.week)} °F reads only {usd(q.gasAt18, 2)}. That is
        the averaging trap of <a href={lessonHref('weather/4.1')}>Lesson 4.1</a> again. The gas curve bends upward, so the chance of a colder week than expected
        adds more than the chance of a milder one takes away, and uncertainty alone raises the expected price.
      </P>

      <H2>The physics picks the market</H2>
      <P>
        Now warm the week. The degree-day future doesn’t notice: below about 45 °F, each degree colder adds one degree day whatever the temperature, so its edge
        stays at {fmt(q.mild[0].edge)} degree days and its ratio at {ratioWord(q.mild[0])}. Gas notices everything. At {fmt(34)} °F the pipelines have room to spare,
        and the same six degrees move gas only {usd(q.mild[1].edge, 2)}; after the spread the trade makes {money(q.mild[1].netPerContract)} at a ratio of{' '}
        {ratioWord(q.mild[1])}. At 40 °F it doesn’t even pay its spread: {money(q.milder[1].netPerContract)}. Go the other way and gas takes over. At 13 °F its ratio
        is {ratioWord(q.cold13[1])} against the future’s {ratioWord(q.cold13[0])}; at 10 °F, {ratioWord(q.cold10[1])}. (At 14 °F it is {ratioWord(q.cold14[1])},
        just short.) Weeks that cold run the pipelines nearly full, on the steep part of 4.2’s curve. Colder still, the price runs into its $30 cap, set by trucked
        gas and storage, and the edge shrinks
        again: at 0 °F a six-degree revision moves gas only {usd(q.frozen[1].edge, 2)}, though with so little room left to move, its risk shrinks too.
      </P>
      <P>
        Power sits in between. It follows gas, because gas plants set its price, and it follows demand, so it also feels the wind of{' '}
        <a href={lessonHref('weather/4.4')}>Lesson 4.4</a>. With a calm 3 m/s on Hollin Ridge, the revision moves power by {usd(q.calm[2].edge, 2)} per MWh; with a
        brisk 13 m/s, by {usd(q.windy[2].edge, 2)}, because every megawatt-hour of wind keeps an expensive gas plant off the margin. The degree-day future, meanwhile,
        is indifferent to the wind; it pays on temperature alone.
      </P>
      <P>
        The gas trade, in other words, isn’t a trade on the weather at all. It’s a trade on the weather meeting a full pipeline. Build more pipeline in{' '}
        <FigRef to="Weather-Energy Trading Lab">the first demonstration</FigRef> and watch the gas curve flatten under the same cold week: at 2.0 million MMBtu a day
        the revision moves gas by just {usd(q.pipe200[1].edge, 2)}.
      </P>

      <Challenge
        id="a"
        question={`Keep the week at ${LAB_DEFAULTS.week} °F, the revision at ${LAB_DEFAULTS.revision} °F and the wind at ${LAB_DEFAULTS.wind} m/s. What is the least pipeline capacity, to the nearest 0.05 million MMBtu a day, at which the gas trade no longer pays its spread?`}
        solved={solved}
        status={
          st.week !== LAB_DEFAULTS.week || st.revision !== LAB_DEFAULTS.revision || st.wind !== LAB_DEFAULTS.wind
            ? `Set the week back to ${LAB_DEFAULTS.week} °F, the revision to ${LAB_DEFAULTS.revision} °F and the wind to ${LAB_DEFAULTS.wind} m/s.`
            : gasIdea.netPerContract >= 0
              ? `At ${fmt(st.pipeline, 2)} million MMBtu a day, the gas trade still nets ${money(gasIdea.netPerContract)} a contract.`
              : `At ${fmt(st.pipeline, 2)} million the gas trade loses ${money(-gasIdea.netPerContract)} a contract. Is that the least capacity that does it?`
        }
        success={`Solved. At ${fmt(st.pipeline, 2)} million MMBtu a day the cold week fills the pipelines so little that six degrees move gas by only ${usd(gasIdea.edge, 2)} — less than the $0.15 spread — and the trade loses ${money(-gasIdea.netPerContract)} a contract. The HDD future still nets ${usd(hddIdea.netPerContract)}. The weather view didn’t change; the physics that turned it into a gas price did.`}
      />

      <H2>Size, spreads and limits</H2>
      <P>
        A ratio says which trade is best per dollar of risk. It doesn’t say how much money a desk can make, because each market will only take so much, and each
        contract comes in a fixed size. Say the desk’s limit is {money(RISK_LIMIT)} of risk on next week. The three trades all win or lose on the same cold, so we’ll
        add their risks as if they moved together, a cautious assumption. In the next demonstration, choose how many contracts to trade in each market, for the
        week and physics set in <FigRef to="Weather-Energy Trading Lab">the first demonstration</FigRef>; the bars show the risk each takes and the profit each is
        expected to make, against the limit and against the best book possible:
      </P>

      <Figure name="Weather-Energy Trading Lab · sizing and limits" scenario={b}>
        <BookBars ideas={ideas} book={book} best={best} />
        <Legend
          items={[
            { label: 'HDD future', color: BOOK_COLORS.hdd },
            { label: 'Gas', color: BOOK_COLORS.gas },
            { label: 'Power', color: BOOK_COLORS.power },
          ]}
        />
        <Readouts
          items={[
            { label: 'expected profit after costs', value: money(value.net), tone: value.net >= 0 ? WX.money : 'red' },
            { label: `risk, against a ${money(RISK_LIMIT)} limit`, value: money(value.risk), tone: value.risk > RISK_LIMIT ? 'red' : WX.probability },
            { label: 'best book within the limit', value: money(best.net), tone: WX.money },
          ]}
        />
        <Slider label="HDD futures" tone={WX.index} value={book.hdd} min={0} max={INSTRUMENTS.hdd.maxSize} onChange={(v) => b.set({ hdd: v })} display={`${book.hdd} contracts`} />
        <Slider label="Gas contracts" tone={WX.money} value={book.gas} min={0} max={INSTRUMENTS.gas.maxSize} onChange={(v) => b.set({ gas: v })} display={`${book.gas} contracts`} />
        <Slider label="Power contracts" tone={WX.energy} value={book.power} min={0} max={INSTRUMENTS.power.maxSize} onChange={(v) => b.set({ power: v })} display={`${book.power} contracts`} />
        <Slider label="Next week, as the market sees it" tone={WX.temperature} value={st.week} min={0} max={50} onChange={(v) => s.set({ week: v })} display={`${fmt(st.week)} °F`} />
        <Slider
          label="Pipeline capacity"
          tone={WX.money}
          value={st.pipeline}
          min={1.2}
          max={2.2}
          step={PIPELINE_STEP}
          onChange={(v) => s.set({ pipeline: Math.round(v * 100) / 100 })}
          display={`${fmt(st.pipeline, 2)} million MMBtu/day`}
        />
        <Caption>
          {value.risk > RISK_LIMIT
            ? `This book takes ${money(value.risk)} of risk, over the limit.`
            : best.net <= 0
              ? 'At these settings no trade pays its costs: the best book is no book.'
              : `The best book within the limit is ${best.book.hdd} HDD futures, ${best.book.gas} gas and ${best.book.power} power contracts, expected to make ${money(best.net)} on ${money(best.risk)} of risk.`}
        </Caption>
      </Figure>

      <P>
        Start with the best ratio and fill the degree-day market: all {INSTRUMENTS.hdd.maxSize} contracts are expected to make {money(q.start[0].netPerContract *
        INSTRUMENTS.hdd.maxSize)}, on {money(q.start[0].riskPerContract * INSTRUMENTS.hdd.maxSize)} of risk. That’s all the weather market will absorb, and it uses
        less than a tenth of the limit. The rest has to go to energy, where contracts are big and lumpy: one gas contract carries {money(q.start[1].riskPerContract)}{' '}
        of risk, one power contract {money(q.start[2].riskPerContract)}. Two power contracts fit and make {money(2 * q.start[2].netPerContract)}; a single gas
        contract also fits and makes {money(q.start[1].netPerContract)}. The best book at the start is {q.bestStart.book.hdd} HDD futures and{' '}
        {q.bestStart.book.gas} gas contract, expected to make {money(q.bestStart.net)} on {money(q.bestStart.risk)} of risk — even though gas has the lowest ratio of
        the three.
      </P>

      <Challenge
        id="b"
        question={`Within the ${money(RISK_LIMIT)} risk limit, build a book expected to make within 1% of the most any book could.`}
        solved={solved2}
        status={
          value.risk > RISK_LIMIT
            ? `This book takes ${money(value.risk)} of risk, more than the limit allows.`
            : best.net <= 0
              ? 'At these settings nothing pays its costs. Make next week colder, or the revision bigger.'
              : `This book is expected to make ${money(value.net)}; the best possible is ${money(best.net)}.`
        }
        success={`Solved: ${book.hdd} HDD futures, ${book.gas} gas and ${book.power} power contracts, expected to make ${money(value.net)} on ${money(value.risk)} of risk. The answer depends on the size of the contracts and the depth of each market as much as on the edge. Warm the week to 34 °F and the best book becomes ${q.bestMild.book.hdd} HDD futures and ${q.bestMild.book.power} power contracts, making ${money(q.bestMild.net)}: gas has nothing left to offer.`}
      />

      <P>
        Every number in this lesson traces back to a physical cause. The degree-day edge is linear because heating demand is linear below 65 °F. The gas edge exists
        only when the region’s pipelines are nearly full, and it vanishes when they aren’t. The power edge depends on the gas plants at the margin and on whether the
        wind is blowing. And the edge itself depends on having the colder forecast before the market does. Take away any one of them in the demonstrations and the
        opportunity goes with it.
      </P>
      <P>
        What none of this shows is whether the edge is real. We assumed our forecast was better than the market’s and that the market would be wrong in exactly the
        way we expected. A strategy has to be tested on history, decision by decision, using only what could have been known at the time — and the easiest way to
        fool yourself is to let tomorrow’s forecast slip into today’s decision. That test, and the ways it goes wrong, are the subject of the next lesson.
      </P>
    </LessonPage>
  );
}
