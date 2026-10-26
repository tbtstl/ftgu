import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
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
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  niceDomain,
  niceTicks,
  pct,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import { DAYS_PER_MONTH, TC_ROUTES, dailyPath, panelAssessment, routeTce, weightedIndex, type TcRoute } from '../../../engines/shipping/indices';
import { dailyIndex } from '../../../engines/shipping/ffa';
import { HISTORY_EVENTS, HISTORY_MONTHS, monthLabel, standardHistory } from '../../../model/shipping/history';
import type { ClassId } from '../../../model/shipping/trades';
import { XYChart } from '../shared/XYChart';

const HIST = standardHistory();
export const INDEX_DAYS = HISTORY_MONTHS * DAYS_PER_MONTH;
/** The day the first demonstration opens on: the tenth index day of July, Year 3. */
export const START_DAY = 30 * DAYS_PER_MONTH + 9;
/** A broker who talks the market up reports this much above the truth. */
export const BIAS = 0.15;
/** How close to the market the balanced index must come. */
export const TOLERANCE = 0.001;
const VOYAGE_ROUTE: Record<ClassId, string> = { cape: 'C-TUB-QIN', kmax: 'P-SAN-QIN' };
const CLASS_LABEL: Record<ClassId, string> = { cape: 'Capesize', kmax: 'Kamsarmax' };

const perDay = (x: number) => `$${fmt(x)}/day`;
const usd0 = (x: number) => `$${fmt(x)}`;
const signedPct = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${pct(Math.abs(x), d)}`;

/** A round voyage starts and ends in the same place, so its rate is the market rate. */
export function isRound(r: TcRoute): boolean {
  return r.from.port === r.to.port && r.from.kind === r.to.kind;
}

/** The market rate and each route's true rate on an index day, $/day. */
export function truthOnDay(cls: ClassId, day: number): { market: number; routes: number[] } {
  const p = dailyPath(cls);
  const d = Math.max(0, Math.min(INDEX_DAYS - 1, Math.round(day)));
  const m = HIST.cls[cls][p.month[d]];
  return { market: p.tce[d], routes: TC_ROUTES[cls].map((r) => p.tce[d] + (routeTce(m, r) - m.tce) * p.noise[d]) };
}

export interface PanelSettings {
  panelists: number;
  error: number;
  trim: boolean;
  biased: boolean;
}

/** One route's assessment: the panel's reports (one possibly biased) and the published average. */
export function assess(truth: number, s: PanelSettings, day: number, routeIndex: number): { reports: number[]; published: number } {
  const honest = panelAssessment(truth, { panelists: s.panelists, error: s.error, trim: false, seed: 1000 + routeIndex }, day).reports;
  const reports = s.biased ? [truth * (1 + BIAS), ...honest.slice(1)] : honest;
  const sorted = [...reports].sort((a, b) => a - b);
  const used = s.trim && sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  return { reports, published: used.reduce((a, b) => a + b, 0) / used.length };
}

/** The weights demonstration: a perfect panel, so each route's assessment is its true earnings. */
export interface WeightState {
  cls: ClassId;
  day: number;
  weights: Record<string, number>;
}

/**
 * The challenge: an index of only the fronthaul and the backhaul that lands within 0.1% of the
 * market rate. It works when their weights are in the ratio of the trips' lengths, because the
 * premium out and the discount back are the same positional change.
 */
export function balancedSolved(s: WeightState): boolean {
  const routes = TC_ROUTES[s.cls];
  const w = routes.map((r) => s.weights[r.id] ?? 0);
  const fh = routes.findIndex((r) => r.id.endsWith('FH'));
  const bh = routes.findIndex((r) => r.id.endsWith('BH'));
  if (routes.some((r, i) => isRound(r) && w[i] > 0) || w[fh] <= 0 || w[bh] <= 0) return false;
  const t = truthOnDay(s.cls, s.day);
  return Math.abs(weightedIndex(t.routes, w) / t.market - 1) <= TOLERANCE;
}

// ---------------------------------------------------------------------------
// Numbers for the prose, all from the simulated history.

function premiumStats(cls: ClassId, code: 'FH' | 'BH') {
  const r = TC_ROUTES[cls].find((x) => x.id.endsWith(code))!;
  const v = HIST.cls[cls].map((m) => routeTce(m, r) - m.tce);
  return { min: Math.min(...v), max: Math.max(...v), mean: v.reduce((a, b) => a + b, 0) / v.length, days: r.days };
}
export const KFH = premiumStats('kmax', 'FH');
export const KBH = premiumStats('kmax', 'BH');

/** Average absolute error of a published assessment, over 400 days, as a share of the truth. */
export function panelMiss(s: PanelSettings): number {
  let e = 0;
  for (let d = 0; d < 400; d++) e += Math.abs(assess(10_000, s, d, 0).published / 10_000 - 1);
  return e / 400;
}
export const MISS = {
  one: panelMiss({ panelists: 1, error: 0.05, trim: false, biased: false }),
  five: panelMiss({ panelists: 5, error: 0.05, trim: false, biased: false }),
  ten: panelMiss({ panelists: 10, error: 0.05, trim: false, biased: false }),
  fiveTrim: panelMiss({ panelists: 5, error: 0.05, trim: true, biased: false }),
  fiveBiased: panelMiss({ panelists: 5, error: 0.05, trim: false, biased: true }),
  fiveBiasedTrim: panelMiss({ panelists: 5, error: 0.05, trim: true, biased: true }),
};

function corr(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let c = 0;
  let va = 0;
  let vb = 0;
  a.forEach((x, i) => {
    c += (x - ma) * (b[i] - mb);
    va += (x - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  });
  return c / Math.sqrt(va * vb);
}

function monthlyIndex(cls: ClassId): number[] {
  const idx = dailyIndex(cls);
  return HIST.cls[cls].map((_, m) => idx.slice(m * DAYS_PER_MONTH, (m + 1) * DAYS_PER_MONTH).reduce((a, b) => a + b, 0) / DAYS_PER_MONTH);
}
const K_MONTHLY = monthlyIndex('kmax');
export const K_FREIGHT = HIST.cls.kmax.map((m) => m.freights[VOYAGE_ROUTE.kmax]);
export const K_CORR = corr(K_MONTHLY, K_FREIGHT);
/** Equal-weighted index against the market, averaged over every day. */
export const K_EQUAL_GAP = (() => {
  const idx = dailyIndex('kmax');
  const p = dailyPath('kmax');
  return idx.reduce((s, v, d) => s + v / p.tce[d] - 1, 0) / idx.length;
})();
/** Two months with nearly the same Kamsarmax earnings and very different bunker prices. */
export const PAIR = (() => {
  const ms = HIST.cls.kmax;
  let best = { a: 0, b: 1, gap: -1 };
  for (let i = 0; i < ms.length; i++)
    for (let j = 0; j < ms.length; j++) {
      if (Math.abs(ms[i].tce / ms[j].tce - 1) > 0.05 || ms[i].tce < 12_000 || ms[i].tce > 20_000) continue;
      const gap = ms[i].bunker - ms[j].bunker;
      if (gap > best.gap) best = { a: i, b: j, gap };
    }
  return { dear: best.a, cheap: best.b };
})();

const ROUTE_DOT = '#8a8a8a';

/**
 * A day's routes. With `settings`, each route shows the panel's reports, the true earnings and the
 * published assessment; without, the panel is perfect and the assessment is the truth. With
 * `weights`, the class index sits at the bottom.
 */
function PanelChart({ cls, day, settings, weights }: { cls: ClassId; day: number; settings?: PanelSettings; weights?: number[] }) {
  const routes = TC_ROUTES[cls];
  const t = truthOnDay(cls, day);
  const rows = routes.map((r, i) => ({ r, truth: t.routes[i], ...(settings ? assess(t.routes[i], settings, day, i) : { reports: [] as number[], published: t.routes[i] }) }));
  const index = weights
    ? weightedIndex(
        rows.map((x) => x.published),
        weights,
      )
    : NaN;
  const all = [...rows.flatMap((x) => [...x.reports, x.truth, x.published]), t.market, ...(Number.isFinite(index) ? [index] : [])];
  const [d0, d1] = niceDomain(Math.min(...all) * 0.97, Math.max(...all) * 1.03, 5);
  const X0 = 214;
  const X1 = 622;
  const x = scale(d0, d1, X0, X1);
  const ROW = 44;
  const TOP = 30;
  const indexY = TOP + rows.length * ROW + 20;
  const bottom = weights ? indexY + 14 : TOP + rows.length * ROW;
  const H = bottom + 30;
  const what = settings ? 'assessments' : 'true earnings';
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${H}`}
      role="img"
      aria-label={`${CLASS_LABEL[cls]} route ${what} on ${monthLabel(Math.floor(day / DAYS_PER_MONTH))}: ${rows
        .map((row) => `${row.r.name} ${perDay(row.published)}`)
        .join('; ')}. Market earnings ${perDay(t.market)}${weights ? `; weighted index ${Number.isFinite(index) ? perDay(index) : 'undefined (no weights)'}` : ''}.`}
    >
      {niceTicks(d0, d1, 5).map((v) => (
        <g key={v}>
          <line className="gl" x1={x(v)} x2={x(v)} y1={TOP - 6} y2={bottom} />
          <text className="ax ax-m" x={x(v)} y={H - 4}>
            ${fmt(v / 1000)}k
          </text>
        </g>
      ))}
      <line x1={x(t.market)} x2={x(t.market)} y1={TOP - 12} y2={bottom} stroke="#333" strokeWidth={1.2} strokeDasharray="4 3" />
      <text x={x(t.market)} y={TOP - 16} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
        market {perDay(t.market)}
      </text>
      {rows.map((row, i) => {
        const y = TOP + i * ROW + ROW / 2;
        return (
          <g key={row.r.id}>
            <text x={0} y={y - 3} style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
              {row.r.name.replace(', Atlantic to China', '').replace(', China to the Atlantic', '')}
            </text>
            <text x={0} y={y + 12} className="ax">
              {row.r.days}-day trip{weights ? ` · weight ${fmt(weights[i])}` : ''}
            </text>
            <line x1={X0} x2={X1} y1={y} y2={y} stroke="#e4e2dc" />
            {row.reports.map((v, k) => (
              <circle key={k} cx={x(v)} cy={y} r={4} fill={settings?.biased && k === 0 ? tint(GRAPHIC.red, 0.8) : ROUTE_DOT} opacity={0.75} />
            ))}
            {settings && <line x1={x(row.truth)} x2={x(row.truth)} y1={y - 9} y2={y + 9} stroke="#333" strokeWidth={1.2} />}
            <line x1={x(row.published)} x2={x(row.published)} y1={y - 13} y2={y + 13} stroke={GRAPHIC.green} strokeWidth={3.5} strokeLinecap="round" />
          </g>
        );
      })}
      {weights && (
        <g>
          <line x1={0} x2={X1} y1={indexY - 18} y2={indexY - 18} stroke="#d9d9d5" />
          <text x={0} y={indexY + 4} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.green }}>
            {CLASS_LABEL[cls]} index
          </text>
          {Number.isFinite(index) && (
            <g>
              <path d={`M${x(index)} ${indexY - 8} L${x(index) + 8} ${indexY} L${x(index)} ${indexY + 8} L${x(index) - 8} ${indexY} Z`} fill={TEXT.green} />
              <text
                x={x(index) + (x(index) > (X0 + X1) / 2 ? -14 : 14)}
                y={indexY + 4}
                textAnchor={x(index) > (X0 + X1) / 2 ? 'end' : 'start'}
                style={{ fontSize: 13, fontWeight: 600, fill: TEXT.green }}
              >
                {perDay(index)}
              </text>
            </g>
          )}
        </g>
      )}
    </svg>
  );
}

const DEFAULT_WEIGHTS: Record<string, number> = Object.fromEntries([...TC_ROUTES.kmax, ...TC_ROUTES.cape].map((r) => [r.id, 20]));

export default function Lesson() {
  const b = useScenario('index-panel', { cls: 'kmax' as ClassId, day: START_DAY, panelists: 5, error: 0.05, trim: false, biased: false });
  const st = b.state;
  const routes = TC_ROUTES[st.cls];
  const truth = truthOnDay(st.cls, st.day);
  const fh = routes.findIndex((r) => r.id.endsWith('FH'));
  const bh = routes.findIndex((r) => r.id.endsWith('BH'));
  const miss = useMemo(
    () => panelMiss({ panelists: st.panelists, error: st.error, trim: st.trim, biased: st.biased }),
    [st.panelists, st.error, st.trim, st.biased],
  );

  // The weights.
  const wsc = useScenario('index-weights', { cls: 'kmax' as ClassId, day: START_DAY, weights: DEFAULT_WEIGHTS });
  const ws = wsc.state;
  const wRoutes = TC_ROUTES[ws.cls];
  const weights = wRoutes.map((r) => ws.weights[r.id] ?? 0);
  const wTruth = truthOnDay(ws.cls, ws.day);
  const trueIndex = weightedIndex(wTruth.routes, weights);
  const solved = balancedSolved(ws);
  const wfh = wRoutes.findIndex((r) => r.id.endsWith('FH'));
  const wbh = wRoutes.findIndex((r) => r.id.endsWith('BH'));
  const roundWeighted = wRoutes.some((r, i) => isRound(r) && weights[i] > 0);
  const setWeight = (id: string, v: number) => wsc.set((s) => ({ weights: { ...s.weights, [id]: v } }));
  const dayDisplay = (day: number) => `${monthLabel(Math.floor(day / DAYS_PER_MONTH))}, day ${(day % DAYS_PER_MONTH) + 1}`;

  // Demonstration 2.
  const hs = useScenario('index-history', { cls: 'kmax' as ClassId, month: PAIR.dear });
  const hc = hs.state.cls;
  const series = useMemo(() => {
    const idx = dailyIndex(hc);
    const p = dailyPath(hc);
    const xs: number[] = [];
    const iv: number[] = [];
    const mv: number[] = [];
    for (let d = 0; d < idx.length; d += 3) {
      xs.push(d / DAYS_PER_MONTH / 12);
      iv.push(idx[d]);
      mv.push(p.tce[d]);
    }
    const monthly = monthlyIndex(hc);
    const freight = HIST.cls[hc].map((m) => m.freights[VOYAGE_ROUTE[hc]]);
    return { xs, iv, mv, monthly, freight, corr: corr(monthly, freight), top: Math.max(...iv) };
  }, [hc]);
  const hm = HIST.cls[hc][hs.state.month];
  const mxs = HIST.cls[hc].map((_, i) => (i + 0.5) / 12);
  const bands = HISTORY_EVENTS.map((e) => ({ from: e.from / 12, to: e.to / 12, color: tint(GRAPHIC.red, 0.16) }));
  const freightTop = Math.ceil(Math.max(...series.freight) / 20) * 20;
  const indexTop = Math.ceil(series.top / 10_000) * 10_000;
  const voyageName = hc === 'cape' ? 'Tubarão–Qingdao iron ore' : 'Santos–Qingdao soybeans';

  return (
    <LessonPage id="shipping/4.3">
      <P>
        In <a href={lessonHref('shipping/4.1')}>Lesson 4.1</a> the ships open near Tubarão and the cargoes waiting there found one freight between them, and{' '}
        <a href={lessonHref('shipping/4.2')}>Lesson 4.2</a> showed that the same voyage can be fixed by the tonne or by the day, the time-charter equivalent
        making the two comparable. But every one of those fixtures was a private deal between an owner and a charterer, struck through brokers and recorded, if at
        all, in their notebooks. Nobody posts a price board for ocean freight.
      </P>
      <P>
        Yet a great deal depends on knowing what the market pays. A charter can be written to pay hire linked to it. A bank lending against Kestrel wants to
        know what ships like her are earning. An owner wants to know whether her last voyage was good business or bad luck. And, as{' '}
        <a href={lessonHref('shipping/4.5')}>Lesson 4.5</a> will show, whole markets in freight derivatives settle against it. So how does anyone know what “the
        market” is on a given day?
      </P>
      <P>
        The industry’s answer is the <K tone="green">freight index</K>. The best known are published by the Baltic Exchange in London. Each business day, a panel
        of shipbrokers reports what a standard ship would fix for on each of a set of defined routes — C3, for instance, is iron ore from Tubarão to Qingdao, and
        C5 iron ore from West Australia to Qingdao — and the Exchange publishes route assessments compiled from those reports. It also publishes a time-charter
        average for each size class, and the Baltic Dry Index combines the Capesize, Panamax and Supramax averages into one number. We’ll build a simplified index
        of our own from the course’s simulated market. Its routes, panel and numbers are ours, not the Baltic’s.
      </P>
      <P>
        Our panel assesses time-charter trips: a round voyage in the Atlantic, one in the Pacific, a <b>fronthaul</b> that takes a ship from the Atlantic to
        China and a <b>backhaul</b> that brings one back (Capesizes add a round voyage from China to Brazil). In the next demonstration, each gray dot is one
        broker’s report for a route, the thin black tick is the route’s true earnings that day, and the green bar is the published assessment — the panel’s average.
        Choose a day in the twelve simulated years, and change the panel:
      </P>

      <Figure name="Freight Index Builder" scenario={b}>
        <Segmented label="Size class" value={st.cls} onChange={(cls) => b.set({ cls })} options={[{ value: 'kmax', label: 'Kamsarmax' }, { value: 'cape', label: 'Capesize' }]} />
        <PanelChart cls={st.cls} day={st.day} settings={st} />
        <Legend
          items={[
            { label: 'A broker’s report', color: ROUTE_DOT },
            ...(st.biased ? [{ label: 'The broker talking the market up', color: tint(GRAPHIC.red, 0.8) }] : []),
            { label: 'True route earnings', color: '#333', kind: 'line' as const },
            { label: 'Published assessment', color: GRAPHIC.green, kind: 'line' as const },
          ]}
        />
        <Readouts
          items={[
            { label: 'fronthaul premium that day', value: usd0(truth.routes[fh] - truth.market), tone: 'green' },
            { label: 'backhaul discount that day', value: usd0(truth.market - truth.routes[bh]), tone: 'green' },
            { label: 'average miss, this panel', value: pct(miss, 1) },
          ]}
        />
        <Slider label="Day" tone="teal" value={st.day} min={0} max={INDEX_DAYS - 1} onChange={(v) => b.set({ day: v })} display={dayDisplay(st.day)} />
        <Slider label="Brokers on the panel" value={st.panelists} min={1} max={10} onChange={(v) => b.set({ panelists: v })} display={fmt(st.panelists)} />
        <Slider label="Each broker’s typical error" value={st.error} min={0} max={0.1} step={0.005} onChange={(v) => b.set({ error: v })} display={pct(st.error, 1)} />
        <Checkbox label="One broker talks the market up (+15%)" checked={st.biased} onChange={(v) => b.set({ biased: v })} />
        <Checkbox label="Drop the highest and lowest report" checked={st.trim} onChange={(v) => b.set({ trim: v })} />
        <Caption>The average miss is how far a published assessment lands from the truth, averaged over 400 days with this panel.</Caption>
      </Figure>

      <P>
        Start on the opening day, {monthLabel(Math.floor(START_DAY / DAYS_PER_MONTH))}, with Kamsarmaxes, and look at the black ticks. The two round voyages earn exactly the
        market’s earnings: a ship delivered in a basin and handed back in the same basin has gained and lost nothing in position, so she earns what the market pays every
        ship. The fronthaul earns well above it, and the backhaul well below, as the readouts show. These are the positional values of{' '}
        <a href={lessonHref('shipping/3.4')}>Lesson 3.4</a>, priced. A fronthaul takes a ship from the Atlantic, where ships are scarce, and leaves her in China,
        where they are plentiful; the charterer must pay her owner for the position she gives up. A backhaul does the opposite, and her owner accepts less to
        get her back where the cargoes are:
      </P>
      <Eq label="A trip's earnings equal the market's earnings plus the cost of a ballast mile times the change in position, divided by the trip's days">
        <span>trip earnings</span>
        <Op>=</Op>
        <K tone="green">market earnings</K>
        <Op>+</Op>
        <Frac top={<span>cost of a ballast mile × change in position</span>} bottom={<span>days of the trip</span>} />
      </Eq>
      <P>
        Over the simulated history the Kamsarmax fronthaul paid between {usd0(KFH.min)} and {usd0(KFH.max)} a day more than the market, {usd0(KFH.mean)} on
        average, and the backhaul between {usd0(-KBH.max)} and {usd0(-KBH.min)} less. The premium is largest when ships are dearest, because the ballast voyage
        it replaces is priced at the market’s own earnings.
      </P>

      <H2>A panel, not a price</H2>
      <P>
        No broker sees every fixture, and the routes are standardized — a defined ship, a defined voyage — so each report is a judgment, not a transaction. Turn
        up the brokers’ error and watch the dots scatter. One broker with a 5% typical error misses the truth by {pct(MISS.one, 1)} on an average day; a panel of
        five, by {pct(MISS.five, 1)}; ten, by {pct(MISS.ten, 1)}, as the average-miss readout shows. Averaging cancels honest mistakes, though with diminishing returns.
      </P>
      <P>
        It doesn’t cancel a broker who leans one way — one whose clients are owners, say, and who reports the market a little high. Tick the box that has one
        broker talk the market up by 15%. In a panel of five, the published assessment now misses by {pct(MISS.fiveBiased, 1)} on average. Now drop the highest
        and lowest reports: the miss falls to {pct(MISS.fiveBiasedTrim, 1)}. The biased report is almost always the highest, so trimming removes most of the
        bias. What remains is the noise of the three reports left, plus a slight upward lean, because the report dropped from the bottom was an honest one.
        Trimming has a small cost when everyone is honest — {pct(MISS.fiveTrim, 1)} against{' '}
        {pct(MISS.five, 1)}, since it throws information away — and earns it back when someone isn’t.
        Because so much money settles against these numbers, publishers choose their panelists carefully and watch what they report.
      </P>

      <H2>Weighting the routes</H2>
      <P>
        No single route represents a class. The fronthaul alone would overstate what Kamsarmaxes earn and the backhaul understate it, and either could be swung by
        a few cargoes in one region. A class index weights several routes so that it tracks what a typical ship in the class earns, wherever she trades. With
        equal weights our Kamsarmax index sits {pct(Math.abs(K_EQUAL_GAP), 1)} {K_EQUAL_GAP < 0 ? 'below' : 'above'} the market’s earnings on an average day: the
        fronthaul’s premium and the backhaul’s discount nearly cancel, but not quite. In the next demonstration the panel is perfect, so each route’s assessment
        is its true earnings that day, and the class index at the bottom is their weighted average. Choose a class and a day, and set the weights:
      </P>

      <Figure name="Freight Index Builder · weights" scenario={wsc}>
        <Segmented label="Size class" value={ws.cls} onChange={(cls) => wsc.set({ cls })} options={[{ value: 'kmax', label: 'Kamsarmax' }, { value: 'cape', label: 'Capesize' }]} />
        <PanelChart cls={ws.cls} day={ws.day} weights={weights} />
        <Legend
          items={[
            { label: 'Route earnings (a perfect panel’s assessment)', color: GRAPHIC.green, kind: 'line' as const },
            { label: 'Market earnings', color: '#333', kind: 'line' as const, dashed: true },
          ]}
        />
        <Readouts items={[{ label: 'index against the market', value: Number.isFinite(trueIndex) ? signedPct(trueIndex / wTruth.market - 1, 2) : 'no weights', tone: 'green' }]} />
        <Slider label="Day" tone="teal" value={ws.day} min={0} max={INDEX_DAYS - 1} onChange={(v) => wsc.set({ day: v })} display={dayDisplay(ws.day)} />
        {wRoutes.map((r) => (
          <Slider key={r.id} label={`Weight: ${r.name.replace(/^./, (c) => c.toLowerCase())}`} tone="green" value={ws.weights[r.id] ?? 0} min={0} max={100} onChange={(v) => setWeight(r.id, v)} display={fmt(ws.weights[r.id] ?? 0)} />
        ))}
      </Figure>

      <Challenge
        id="a"
        question="Predict first, from the equation for a trip’s earnings: in what ratio must the fronthaul and the backhaul be weighted for an index of only those two trips to match the market’s earnings? Then set it — no weight on the round voyages — and bring the index within 0.1% of the market."
        solved={solved}
        status={
          roundWeighted
            ? 'Give the round voyages no weight: use only the two trips between the basins.'
            : weights[wfh] <= 0 || weights[wbh] <= 0
              ? 'Give both the fronthaul and the backhaul some weight.'
              : `Not yet: the index is ${signedPct(trueIndex / wTruth.market - 1, 2)} against the market.`
        }
        success={`Solved. The weights must be in the ratio of the trips’ lengths — ${wRoutes[wfh].days} days to ${wRoutes[wbh].days} for the ${CLASS_LABEL[ws.cls]} trips. The fronthaul gains exactly the positional value the backhaul gives back, but spreads it over more days, so its premium a day is smaller than the backhaul’s discount; a fronthaul followed by a backhaul earns what the market pays on every day of the round trip. An index that weights the trips by their days reproduces that, whatever day you choose.`}
      />

      <H2>Twelve years of an index</H2>
      <P>
        In the next demonstration, the upper chart is the equal-weighted index over the twelve simulated years, day by day, with the market’s earnings beneath it, and
        the lower chart is a voyage freight in dollars per tonne on the class’s longest trade, month by month: {voyageName}. The shaded months are the history’s
        disruptions. Move through the months to compare the two:
      </P>

      <Figure name="Freight Index Builder · history" scenario={hs}>
        <Segmented label="Size class" value={hc} onChange={(cls) => hs.set({ cls })} options={[{ value: 'kmax', label: 'Kamsarmax' }, { value: 'cape', label: 'Capesize' }]} />
        <XYChart
          ariaLabel={`${CLASS_LABEL[hc]} time-charter index over twelve simulated years, from ${perDay(Math.min(...series.iv))} to ${perDay(series.top)}. In ${monthLabel(hs.state.month)} it averaged ${perDay(series.monthly[hs.state.month])}.`}
          series={[
            { xs: series.xs, ys: series.mv, color: '#b5b5b5', width: 1.2 },
            { xs: series.xs, ys: series.iv, color: GRAPHIC.green, width: 1.6 },
          ]}
          xMin={0}
          xMax={12}
          yMin={0}
          yMax={indexTop}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => `$${fmt(v / 1000)}k`.replace('$−', '−$')}
          yLabel="Index and market earnings, $ per day"
          bands={bands}
          cursor={(hs.state.month + 0.5) / 12}
          height={180}
        />
        <XYChart
          ariaLabel={`${voyageName} freight, $ per tonne, month by month, from $${fmt(Math.min(...series.freight), 2)} to $${fmt(Math.max(...series.freight), 2)}. In ${monthLabel(hs.state.month)} it was $${fmt(hm.freights[VOYAGE_ROUTE[hc]], 2)}.`}
          series={[{ xs: mxs, ys: series.freight, color: TEXT.ink, width: 1.6 }]}
          xMin={0}
          xMax={12}
          yMin={0}
          yMax={freightTop}
          xTicks={[0, 2, 4, 6, 8, 10, 12]}
          xFormat={(v) => (v === 12 ? 'end' : `Year ${v + 1}`)}
          yFormat={(v) => `$${v}`}
          yLabel={`${voyageName}, $ per tonne`}
          bands={bands}
          cursor={(hs.state.month + 0.5) / 12}
          markers={[{ x: (hs.state.month + 0.5) / 12, y: hm.freights[VOYAGE_ROUTE[hc]], color: TEXT.ink }]}
          height={150}
        />
        <Legend
          items={[
            { label: 'Index (equal weights)', color: GRAPHIC.green, kind: 'line' },
            { label: 'Market earnings', color: '#b5b5b5', kind: 'line' },
            { label: 'Voyage freight', color: TEXT.ink, kind: 'line' },
            { label: 'Disruptions', color: tint(GRAPHIC.red, 0.4) },
          ]}
        />
        <Readouts
          items={[
            { label: 'index that month', value: perDay(series.monthly[hs.state.month]), tone: 'green' },
            { label: 'voyage freight', value: `$${fmt(hm.freights[VOYAGE_ROUTE[hc]], 2)}/t`, tone: 'green' },
            { label: 'bunker price', value: `$${fmt(hm.bunker)}/t` },
          ]}
        />
        <Slider label="Month" tone="teal" value={hs.state.month} min={0} max={HISTORY_MONTHS - 1} onChange={(v) => hs.set({ month: v })} display={monthLabel(hs.state.month)} />
        <Caption>
          {hm.event ? `${monthLabel(hs.state.month)}: ${hm.event.replace(/^./, (c) => c.toLowerCase())}.` : `Over the history, the monthly index and the voyage freight have a correlation of ${fmt(series.corr, 2)}.`}
        </Caption>
      </Figure>

      <P>
        The two charts tell the same story — the boom of Years 2 to 4, the long slump after the deliveries, the sharp recovery at the end — and month by month
        the Kamsarmax index and the soybean freight have a correlation of {fmt(K_CORR, 2)}. But they don’t move one for one. Compare{' '}
        {monthLabel(PAIR.dear)} with {monthLabel(PAIR.cheap)}. Kamsarmaxes earned almost the same in both, {perDay(HIST.cls.kmax[PAIR.dear].tce)} and{' '}
        {perDay(HIST.cls.kmax[PAIR.cheap].tce)}, yet soybeans from Santos paid ${fmt(K_FREIGHT[PAIR.dear], 2)} a tonne in the first and $
        {fmt(K_FREIGHT[PAIR.cheap], 2)} in the second. Bunkers cost ${fmt(HIST.cls.kmax[PAIR.dear].bunker)} a tonne in the first month and $
        {fmt(HIST.cls.kmax[PAIR.cheap].bunker)} in the second. A voyage freight is what the charterer pays, fuel included, as{' '}
        <a href={lessonHref('shipping/2.3')}>Lesson 2.3</a> worked out; a time-charter index is what the ship earns once the fuel is paid for.
      </P>
      <P>
        That is why time-charter averages are the yardstick of the business. An owner compares her ship’s earnings with them to see how well she did; a bank
        values a fleet with them; and the forward contracts of <a href={lessonHref('shipping/4.5')}>Lesson 4.5</a> settle on them. Look again at the twelve years in{' '}
        <FigRef to="Freight Index Builder · history">this demonstration</FigRef>: the index wanders from day to day, but its large moves are slow, long waves. <a href={lessonHref('shipping/4.4')}>The next lesson</a> asks where those waves come from: a fleet that takes years to change, chasing
        demand that changes every month.
      </P>
    </LessonPage>
  );
}
