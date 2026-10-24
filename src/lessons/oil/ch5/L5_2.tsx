import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, usd, useScenario } from '../../../framework';
import { NETWORK_DEFAULTS, hubPricesFast } from '../../../engines/oil/network';
import { CRUDE_COLOR } from '../../../model/oil/crudes';
import { HISTORY_DEFAULTS, oilHistory, type HistoryWeek } from '../../../model/oil/history';
import { XYChart, type XYBand } from '../shared/charts';

// ---------------------------------------------------------------------------
// Scenarios and challenge checks.

export type ExpansionYear = '1' | '2' | '3' | '4' | '5' | 'never';

export interface ExplorerState {
  /** Ridgeback Basin growth, kb/d per year. */
  growth: number;
  /** Year the Kessler–Calder expansion opens, or never. */
  year: ExpansionYear;
  /** Capacity the expansion adds, kb/d. */
  add: number;
  /** Rail capacity from Kessler to the coast, kb/d. */
  rail: number;
}

export const DEFAULT_GROWTH = HISTORY_DEFAULTS.basinGrowth;
export const EXPANSION_YEAR = HISTORY_DEFAULTS.expansion ? HISTORY_DEFAULTS.expansion.year : 3;
export const SIZE_STEP = 25;
/** Challenge a: keep the spread under this from the expansion's opening to the end of the five years, $/bbl. */
export const SPREAD_LIMIT = 6;

export const EXPLORER_DEFAULTS: ExplorerState = {
  growth: DEFAULT_GROWTH,
  year: String(EXPANSION_YEAR) as ExpansionYear,
  add: HISTORY_DEFAULTS.expansion ? HISTORY_DEFAULTS.expansion.add : 300,
  rail: HISTORY_DEFAULTS.rail,
};

/** The simulated history for a set of physical drivers. */
export function historyFor(st: ExplorerState): HistoryWeek[] {
  return oilHistory({ basinGrowth: st.growth, rail: st.rail, expansion: st.year === 'never' ? null : { year: Number(st.year), add: st.add } });
}

export interface SpreadStats {
  average: number;
  widest: number;
  fullWeeks: number;
}

/** Brent − WTI statistics from a week onward. */
export function spreadStats(h: HistoryWeek[], fromWeek = 0): SpreadStats {
  const part = h.slice(fromWeek);
  const sp = part.map((w) => w.brent - w.wti);
  return { average: sp.reduce((a, b) => a + b, 0) / Math.max(1, sp.length), widest: Math.max(...sp), fullWeeks: part.filter((w) => w.pipelineUse >= 1).length };
}

/** The widest spread from the opening of a year-3 expansion of `add` kb/d to the end of the history. */
export function widestAfterOpening(add: number, rail: number = EXPLORER_DEFAULTS.rail, growth: number = DEFAULT_GROWTH): number {
  const h = historyFor({ growth, rail, year: String(EXPANSION_YEAR) as ExpansionYear, add });
  return spreadStats(h, EXPANSION_YEAR * 52).widest;
}

/**
 * Challenge a: with the default growth and the expansion opening in year 3, the smallest expansion on
 * the 25 kb/d grid that keeps the spread under $6 from the opening to the end of the five years.
 */
export function smallestExpansionSolved(st: ExplorerState): boolean {
  if (st.growth !== DEFAULT_GROWTH || st.year !== String(EXPANSION_YEAR)) return false;
  if (widestAfterOpening(st.add, st.rail) >= SPREAD_LIMIT) return false;
  return st.add < SIZE_STEP || widestAfterOpening(st.add - SIZE_STEP, st.rail) >= SPREAD_LIMIT;
}

/** The answer to challenge a at a rail capacity: the smallest qualifying expansion on the grid. */
export function smallestExpansion(rail: number = EXPLORER_DEFAULTS.rail): number {
  for (let add = 0; add <= 500; add += SIZE_STEP) if (widestAfterOpening(add, rail) < SPREAD_LIMIT) return add;
  return NaN;
}

/** The price of light crude at Port Calder in a week of history (the network's coastal price). */
export function portCalderPrice(w: HistoryWeek, rail: number = HISTORY_DEFAULTS.rail): number {
  return hubPricesFast({
    ...NETWORK_DEFAULTS,
    basinSupply: w.basinSupply,
    pipeline: w.pipelineCapacity,
    rail,
    northportPrice: w.brent,
    floor: (w.brent * NETWORK_DEFAULTS.floor) / NETWORK_DEFAULTS.northportPrice,
  }).calder;
}

export interface Breakdown {
  brent: number;
  /** Northfield Sour at Kessler: location (WTI − Brent) and quality (Northfield − WTI). */
  nfLocation: number;
  nfQuality: number;
  northfield: number;
  /** Coldwater Heavy at Port Calder: location (Port Calder − Brent) and quality (Coldwater − Port Calder). */
  cwLocation: number;
  cwQuality: number;
  coldwater: number;
  /** Fuel oil's price less Brent. */
  fuelOil: number;
}

/** Each physical crude as benchmark + location + quality, in one week. */
export function breakdown(w: HistoryWeek): Breakdown {
  const calder = portCalderPrice(w);
  return {
    brent: w.brent,
    nfLocation: w.wti - w.brent,
    nfQuality: w.northfield - w.wti,
    northfield: w.northfield,
    cwLocation: calder - w.brent,
    cwQuality: w.coldwater - calder,
    coldwater: w.coldwater,
    fuelOil: w.hsfo - w.brent,
  };
}

export type BuildMode = 'built' | 'never';

export function historyForMode(mode: BuildMode): HistoryWeek[] {
  return oilHistory(mode === 'built' ? {} : { expansion: null });
}

/** Tolerance for challenge b, $/bbl. */
export const CHEAPEST_TOLERANCE = 0.25;

/** Challenge b: with the expansion built, a week in which Northfield Sour sold within 25¢ of its deepest discount to Brent. */
export function cheapestNorthfieldSolved(mode: BuildMode, week: number): boolean {
  if (mode !== 'built') return false;
  const h = historyForMode('built');
  const disc = h.map((w) => w.northfield - w.brent);
  const i = Math.max(0, Math.min(h.length - 1, Math.round(week)));
  return disc[i] <= Math.min(...disc) + CHEAPEST_TOLERANCE;
}

/** Correlation coefficient of two series. */
function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let s = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    s += (a[i] - ma) * (b[i] - mb);
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
  }
  return s / Math.sqrt(sa * sb);
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose, computed once.

let facts: ReturnType<typeof computeFacts> | null = null;
function computeFacts() {
  const d = oilHistory();
  const ne = oilHistory({ expansion: null });
  const firstFull = d.findIndex((w) => w.pipelineUse >= 1);
  const fullSpreads = d.filter((w) => w.pipelineUse >= 1).map((w) => w.brent - w.wti);
  const railFull = ne.findIndex((w) => w.basinSupply > w.pipelineCapacity + HISTORY_DEFAULTS.rail);
  const parts = d.map(breakdown);
  const neParts = ne.map(breakdown);
  const neDisc = neParts.map((p) => p.northfield - p.brent);
  return {
    all: spreadStats(d),
    firstYear: spreadStats(d.slice(0, 52)),
    firstFullYears: d[firstFull].t,
    fullAverage: fullSpreads.reduce((a, b) => a + b, 0) / fullSpreads.length,
    afterOpening: spreadStats(d, EXPANSION_YEAR * 52),
    never: spreadStats(ne),
    railFullYears: railFull >= 0 ? ne[railFull].t : NaN,
    brentMin: Math.min(...d.map((w) => w.brent)),
    brentMax: Math.max(...d.map((w) => w.brent)),
    nfQuality: { min: Math.min(...parts.map((p) => p.nfQuality)), max: Math.max(...parts.map((p) => p.nfQuality)) },
    cwQuality: { min: Math.min(...parts.map((p) => p.cwQuality)), max: Math.max(...parts.map((p) => p.cwQuality)) },
    cwLocation: { min: Math.min(...parts.map((p) => p.cwLocation)), max: Math.max(...parts.map((p) => p.cwLocation)) },
    fuelCorrelation: correlation(
      parts.map((p) => p.cwQuality),
      parts.map((p) => p.fuelOil),
    ),
    neverDeepest: neParts[neDisc.indexOf(Math.min(...neDisc))],
  };
}
function getFacts() {
  if (!facts) facts = computeFacts();
  return facts;
}

// ---------------------------------------------------------------------------
// Display helpers.

const BRENT = '#4590ce';
const WTI = '#d0702a';
const SPREAD = '#6d9c37';
const LOCATION = '#2a9d90';
const FUEL = '#9a9a9a';

function d2(x: number): string {
  return usd(x, 2);
}

function yearsText(t: number): string {
  return `${fmt(t, 1)} years`;
}

/** Contiguous runs of weeks with the Kessler–Calder line full, as x bands in years. */
function fullBands(h: HistoryWeek[], label: boolean): XYBand[] {
  const bands: XYBand[] = [];
  let start = -1;
  h.forEach((w, i) => {
    const full = w.pipelineUse >= 1;
    if (full && start < 0) start = i;
    if ((!full || i === h.length - 1) && start >= 0) {
      const end = full ? i + 1 : i;
      bands.push({ from: start / 52, to: end / 52, color: 'rgba(231, 91, 85, .09)', label: label && bands.length === 0 ? 'line full' : undefined, labelColor: '#c4382f' });
      start = -1;
    }
  });
  return bands;
}

/** Waterfalls for the chosen week: Brent, less location, less quality, gives each crude's price. */
function Waterfall({ b, week }: { b: Breakdown; week: number }) {
  const X0 = 150;
  const X1 = 600;
  const lo = 40;
  const hi = 110;
  const sx = (v: number) => X0 + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (X1 - X0);
  const rowH = 24;
  const top = 22;
  const rows: Array<{ label: string; from: number; to: number; color: string; value: string; strong?: boolean }> = [
    { label: 'Brent', from: lo, to: b.brent, color: BRENT, value: d2(b.brent) },
    { label: 'Northfield: location', from: b.brent + b.nfLocation, to: b.brent, color: LOCATION, value: d2(b.nfLocation) },
    { label: 'quality', from: b.northfield, to: b.brent + b.nfLocation, color: CRUDE_COLOR.northfield, value: d2(b.nfQuality) },
    { label: '= at Kessler', from: lo, to: b.northfield, color: CRUDE_COLOR.northfield, value: d2(b.northfield), strong: true },
    { label: 'Coldwater: location', from: Math.min(b.brent, b.brent + b.cwLocation), to: Math.max(b.brent, b.brent + b.cwLocation), color: LOCATION, value: d2(b.cwLocation) },
    { label: 'quality', from: b.coldwater, to: b.brent + b.cwLocation, color: CRUDE_COLOR.coldwater, value: d2(b.cwQuality) },
    { label: '= at Port Calder', from: lo, to: b.coldwater, color: CRUDE_COLOR.coldwater, value: d2(b.coldwater), strong: true },
  ];
  const H = top + rowH * rows.length + 24;
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${H}`}
      role="img"
      aria-label={`Week ${week + 1}: Brent ${d2(b.brent)}. Northfield Sour at Kessler: location ${d2(b.nfLocation)}, quality ${d2(b.nfQuality)}, price ${d2(b.northfield)}. Coldwater Heavy at Port Calder: location ${d2(b.cwLocation)}, quality ${d2(b.cwQuality)}, price ${d2(b.coldwater)}.`}
    >
      <text className="ax" x={X0} y={14}>
        Week {week + 1}: each price built from Brent, $ per barrel
      </text>
      {[40, 60, 80, 100].map((v) => (
        <g key={v}>
          <line className="gl" x1={sx(v)} x2={sx(v)} y1={top} y2={top + rowH * rows.length} />
          <text className="ax ax-m" x={sx(v)} y={top + rowH * rows.length + 16}>
            ${v}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = top + i * rowH;
        const a = sx(Math.min(r.from, r.to));
        const c = sx(Math.max(r.from, r.to));
        return (
          <g key={i}>
            <text x={X0 - 8} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333', fontWeight: r.strong ? 600 : 400 }}>
              {r.label}
            </text>
            <rect x={a} y={y + 5} width={Math.max(1, c - a)} height={rowH - 10} fill={r.color} opacity={r.strong || i === 0 ? 0.85 : 0.6} />
            <text x={c + 6} y={y + rowH / 2 + 4} style={{ fontSize: 12, fontWeight: r.strong ? 600 : 500, fill: '#333' }}>
              {r.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const f = getFacts();

  // ---- Figure 1.
  const s1 = useScenario<ExplorerState>('benchmarks', EXPLORER_DEFAULTS);
  const st = s1.state;
  const h = historyFor(st);
  const stats = spreadStats(h);
  const solvedA = useMemo(() => smallestExpansionSolved(st), [st]);
  const priceSeries = useMemo(
    () => ({
      brent: h.map((w) => [w.t, w.brent] as [number, number]),
      wti: h.map((w) => [w.t, w.wti] as [number, number]),
      spread: h.map((w) => [w.t, w.brent - w.wti] as [number, number]),
    }),
    [h],
  );
  const pLo = Math.floor(Math.min(...h.map((w) => w.wti)) / 10) * 10;
  const pHi = Math.ceil(Math.max(...h.map((w) => w.brent)) / 10) * 10;
  const bands = fullBands(h, true);
  const never = st.year === 'never';
  const afterOpen = never ? null : spreadStats(h, Number(st.year) * 52);

  // ---- Figure 2.
  const s2 = useScenario('differentials', { mode: 'built' as BuildMode, week: 26 });
  const h2 = historyForMode(s2.state.mode);
  const week = Math.max(0, Math.min(h2.length - 1, Math.round(s2.state.week)));
  const parts = useMemo(() => h2.map(breakdown), [h2]);
  const b = parts[week];
  const solvedB = cheapestNorthfieldSolved(s2.state.mode, week);
  const nfDiscNow = b.northfield - b.brent;

  return (
    <LessonPage id="oil/5.2">
      <P>
        <a href={lessonHref('oil/5.1')}>Lesson 5.1</a> set the level of the oil price with one world balance: when supply runs ahead of demand, stocks build and
        the price falls, and when it runs behind, stocks draw and the price rises. Yet nobody quotes “the” price of oil. The news quotes two, and traders quote dozens
        more, each a little above or below the first two. This lesson is about those two prices — the <b>benchmarks</b> — and the <b>differentials</b> that hang
        every other crude from them.
      </P>
      <P>
        A benchmark is a price that so many people trade that everyone can agree on it. The two that matter most are real, and worth describing exactly.{' '}
        <b>WTI</b>, West Texas Intermediate, is the light sweet crude futures contract of the New York Mercantile Exchange: each contract is 1,000 barrels,
        delivered physically at Cushing, Oklahoma, an inland hub of pipelines and storage tanks. <b>Brent</b> is two things. The ICE Brent futures contract is
        settled in cash against an index; behind it, <b>Dated Brent</b> is the price assessed for physical cargoes of North Sea crude loading in the coming weeks.
        The Brent basket covers several North Sea grades and, since 2023, U.S. WTI Midland crude delivered to Europe. Much of the crude traded between countries is
        priced against Brent. The essential difference is geography: WTI is priced inland, Brent at sea.
      </P>
      <P>
        Our world has the same pair. The <K c="price">Kessler price</K> behaves like WTI, and the Northport price like Brent; both, like every price in this
        course, are simulated by the model, not taken from any market. <a href={lessonHref('oil/4.4')}>Lesson 4.4</a> showed what separates them on a single day: the
        cost of moving a barrel from Kessler to the sea, and, when the Kessler–Calder line is full, the cost of the next-best way out. In the next demonstration the
        model runs for five years of weeks. The Ridgeback Basin grows, the line fills, and the line may be expanded. Set how fast the basin grows, when the expansion
        opens and how big it is, and how much crude the railroad can take:
      </P>

      <Figure name="WTI-Brent Price Explorer" scenario={s1}>
        <Legend
          items={[
            { label: 'Brent (Northport, simulated)', color: BRENT, kind: 'line' },
            { label: 'WTI (Kessler, simulated)', color: WTI, kind: 'line' },
            { label: 'Kessler–Calder line full', color: 'rgba(231, 91, 85, .25)' },
          ]}
        />
        <XYChart
          ariaLabel={`Five years of weekly simulated prices: Brent between ${d2(Math.min(...h.map((w) => w.brent)))} and ${d2(Math.max(...h.map((w) => w.brent)))}, WTI between ${d2(Math.min(...h.map((w) => w.wti)))} and ${d2(Math.max(...h.map((w) => w.wti)))}. The Kessler–Calder line is full in ${stats.fullWeeks} of ${h.length} weeks.`}
          height={210}
          x={[0, 5]}
          y={[pLo, pHi]}
          xTicks={[0, 1, 2, 3, 4, 5]}
          xFormat={(v) => (v === 0 ? 'start' : `year ${v}`)}
          yFormat={(v) => `$${fmt(v)}`}
          yLabel="Crude price, $ per barrel"
          bands={bands}
          series={[
            { points: priceSeries.brent, color: BRENT, width: 2 },
            { points: priceSeries.wti, color: WTI, width: 2 },
          ]}
        />
        <XYChart
          ariaLabel={`The spread, Brent minus WTI: average ${d2(stats.average)}, widest ${d2(stats.widest)}.`}
          height={150}
          x={[0, 5]}
          y={[0, 40]}
          xTicks={[0, 1, 2, 3, 4, 5]}
          xFormat={(v) => (v === 0 ? 'start' : `year ${v}`)}
          yTicks={[0, 10, 20, 30, 40]}
          yFormat={(v) => `$${v}`}
          yLabel="Brent minus WTI, $ per barrel"
          bands={fullBands(h, false)}
          series={[{ points: priceSeries.spread, color: SPREAD, width: 2, fillTo: 0, fillOpacity: 0.2 }]}
          refs={never ? [] : [{ axis: 'x', at: Number(st.year), color: '#555', dash: '4 4', label: 'expansion opens' }]}
        />
        <Readouts
          items={[
            { label: <K c="price">average spread</K>, value: d2(stats.average), tone: 'green' },
            { label: <K c="price">widest spread</K>, value: d2(stats.widest), tone: 'green' },
            { label: <K tone="orange">weeks with the line full</K>, value: `${stats.fullWeeks} of ${h.length}`, tone: 'orange' },
          ]}
        />
        <Slider
          label="Basin growth"
          tone="orange"
          value={st.growth}
          min={0}
          max={150}
          step={5}
          onChange={(v) => s1.set({ growth: v })}
          display={`${fmt(st.growth)} kb/d a year`}
        />
        <Segmented
          label="Expansion opens"
          value={st.year}
          onChange={(v) => s1.set({ year: v })}
          options={[
            { value: '1', label: 'Year 1' },
            { value: '2', label: 'Year 2' },
            { value: '3', label: 'Year 3' },
            { value: '4', label: 'Year 4' },
            { value: '5', label: 'Year 5' },
            { value: 'never', label: 'Never' },
          ]}
        />
        <Slider
          label="Expansion size"
          tone="orange"
          value={st.add}
          min={0}
          max={500}
          step={SIZE_STEP}
          disabled={never}
          onChange={(v) => s1.set({ add: v })}
          display={never ? '—' : `${fmt(st.add)} kb/d`}
        />
        <Slider label="Rail capacity" tone="orange" value={st.rail} min={0} max={300} step={25} onChange={(v) => s1.set({ rail: v })} display={`${fmt(st.rail)} kb/d`} />
        <Caption>
          {stats.fullWeeks === 0
            ? 'The line never fills, so WTI stays a transport cost below Brent throughout.'
            : `The line is full for ${stats.fullWeeks} weeks, and in those weeks WTI is set by Kessler’s next-best outlet, not by Brent less the pipeline tariff.`}
          {afterOpen ? ` From the expansion’s opening on, the spread averages ${d2(afterOpen.average)} and peaks at ${d2(afterOpen.widest)}.` : ''}
        </Caption>
      </Figure>

      <P>
        With the default settings, the first year is quiet: the line has room, and the spread averages {d2(f.firstYear.average)}, the cost of getting a Kessler
        barrel to the coast where it displaces Seaboard crude (Lesson 4.4’s first regime). About {yearsText(f.firstFullYears)} in, the basin outgrows the line.
        From then on the next barrel leaves Kessler by rail, and WTI falls to the coastal price less the rail freight: in the weeks the line is full, the spread
        averages {d2(f.fullAverage)}. The expansion opens in year {EXPANSION_YEAR}, and from then the spread averages {d2(f.afterOpening.average)} and never
        exceeds {d2(f.afterOpening.widest)} — now the coast exports, so WTI sits at export parity, a little further below Brent than in the first year.
      </P>
      <P>
        Choose <b>Never</b> and the story darkens. About {yearsText(f.railFullYears)} in, the railroad is full too, Coldwater crude is held back at its source,
        and WTI collapses to what a stranded barrel is worth: the spread reaches {d2(f.never.widest)}, and averages {d2(f.never.average)} over the five years.
        Notice what doesn’t move. Brent follows exactly the same path in every setting — from {d2(f.brentMin)} to {d2(f.brentMax)} — because the world balance
        doesn’t care where inside it a pipeline is full. The spread is entirely WTI’s doing. That is the model’s version of what happened to WTI when production
        inland outran the pipelines out of Cushing (<a href={lessonHref('oil/4.4')}>Lesson 4.4</a>).
      </P>

      <Challenge
        id="a"
        question={`With the basin growing ${fmt(DEFAULT_GROWTH)} kb/d a year and the expansion opening in year ${EXPANSION_YEAR}, find the smallest expansion, to the nearest ${SIZE_STEP} kb/d, that keeps the spread under $${SPREAD_LIMIT} from the day it opens to the end of the five years.`}
        solved={solvedA}
        status={
          st.growth !== DEFAULT_GROWTH || st.year !== String(EXPANSION_YEAR)
            ? `Set basin growth to ${fmt(DEFAULT_GROWTH)} kb/d a year and the expansion to open in year ${EXPANSION_YEAR}.`
            : `With ${fmt(st.add)} kb/d added, the widest spread after the opening is ${d2(widestAfterOpening(st.add, st.rail))}.`
        }
        success={`Solved: ${fmt(st.add)} kb/d. ${fmt(st.add - SIZE_STEP)} kb/d leaves the basin’s last months of growth with nowhere to go but rail, and the spread jumps back to the rail freight. Pipelines are sized for where production is going, not where it is — which is why expansions are fought over years before they open.`}
      />

      <H2>Differentials</H2>
      <P>
        Benchmarks price a handful of grades. Everything else is priced as a benchmark plus or minus a <K c="price">differential</K>, and the differential has two
        parts we’ve already met. The <b>location</b> part is the cost of getting from where the crude is to where the benchmark is priced, or back (Lesson 4.4). The{' '}
        <b>quality</b> part is what a refinery can make of the crude compared with the benchmark grade (Lesson 4.5). In practice, physical cargoes are commonly priced
        at a benchmark’s average over an agreed window plus a differential, and some national oil companies publish monthly differentials for their grades.
      </P>
      <P>
        In the next demonstration, two of our crudes are taken apart week by week over the same simulated history. Northfield Sour is sold at Kessler, so its location
        part is WTI’s own discount to Brent. Coldwater Heavy is delivered to Port Calder, so its location part is the coast’s small discount to Northport. Drag across
        the chart to choose a week, and switch the expansion off to compare:
      </P>

      <Figure name="WTI-Brent Price Explorer · differentials" scenario={s2}>
        <Segmented
          label="Kessler–Calder expansion"
          value={s2.state.mode}
          onChange={(v) => s2.set({ mode: v })}
          options={[
            { value: 'built', label: `Opens in year ${EXPANSION_YEAR}` },
            { value: 'never', label: 'Never built' },
          ]}
        />
        <Legend
          items={[
            { label: 'Location at Kessler (WTI − Brent)', color: LOCATION, kind: 'line' },
            { label: 'Northfield quality (vs WTI)', color: CRUDE_COLOR.northfield, kind: 'line' },
            { label: 'Coldwater quality (vs light crude at Port Calder)', color: CRUDE_COLOR.coldwater, kind: 'line' },
            { label: 'Fuel oil − Brent', color: FUEL, kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`Differentials over five simulated years. Week ${week + 1}: location at Kessler ${d2(b.nfLocation)}, Northfield quality ${d2(b.nfQuality)}, Coldwater quality ${d2(b.cwQuality)}, fuel oil ${d2(b.fuelOil)} against Brent.`}
          height={220}
          x={[0, 5]}
          y={[-35, 0]}
          xTicks={[0, 1, 2, 3, 4, 5]}
          xFormat={(v) => (v === 0 ? 'start' : `year ${v}`)}
          yTicks={[-30, -20, -10, 0]}
          yFormat={(v) => (v === 0 ? '$0' : `−$${Math.abs(v)}`)}
          yLabel="Differential, $ per barrel"
          series={[
            { points: parts.map((p, i) => [i / 52, p.fuelOil] as [number, number]), color: FUEL, width: 1.5, dash: '5 4' },
            { points: parts.map((p, i) => [i / 52, p.nfLocation] as [number, number]), color: LOCATION, width: 2.5 },
            { points: parts.map((p, i) => [i / 52, p.nfQuality] as [number, number]), color: CRUDE_COLOR.northfield, width: 2 },
            { points: parts.map((p, i) => [i / 52, p.cwQuality] as [number, number]), color: CRUDE_COLOR.coldwater, width: 2 },
          ]}
          refs={[{ axis: 'x', at: week / 52, cursor: true }]}
          onScrub={(v) => s2.set({ week: Math.max(0, Math.min(h2.length - 1, Math.round(v * 52))) })}
          scrubValue={week / 52}
          scrubStep={1 / 52}
          scrubLabel="Week of the history"
        />
        <Waterfall b={b} week={week} />
        <Readouts
          items={[
            { label: <K c="price">Northfield Sour vs Brent</K>, value: d2(nfDiscNow), tone: 'green' },
            { label: <K c="price">Coldwater Heavy vs Brent</K>, value: d2(b.coldwater - b.brent), tone: 'green' },
            { label: 'fuel oil vs Brent', value: d2(b.fuelOil) },
          ]}
        />
      </Figure>

      <P>
        The two parts move for different reasons. Quality differentials follow fuel oil. Northfield Sour’s runs between {d2(f.nfQuality.min)} and{' '}
        {d2(f.nfQuality.max)} against WTI, and Coldwater Heavy’s between {d2(f.cwQuality.min)} and {d2(f.cwQuality.max)} against light crude at Port Calder, and
        Coldwater’s rises and falls almost in step with fuel oil’s own discount to Brent (their correlation over the five years is {fmt(f.fuelCorrelation, 2)}).
        When fuel oil is cheap, the residue that sour and heavy crudes are full of is worth less, and so are they — the mechanism of{' '}
        <a href={lessonHref('oil/4.5')}>Lesson 4.5</a>. Location differentials follow the plumbing. Coldwater’s, at the coast, barely moves, between{' '}
        {d2(f.cwLocation.min)} and {d2(f.cwLocation.max)}; Northfield’s, inland, carries the whole of WTI’s discount and jumps whenever the line fills.
      </P>

      <Challenge
        id="b"
        question={`With the expansion opening in year ${EXPANSION_YEAR}, find a week in which Northfield Sour sold at its deepest discount to Brent (within ${fmt(CHEAPEST_TOLERANCE * 100)} cents).`}
        solved={solvedB}
        status={
          s2.state.mode !== 'built'
            ? `Choose the history in which the expansion opens in year ${EXPANSION_YEAR}.`
            : `In week ${week + 1}, Northfield Sour sold ${d2(-nfDiscNow)} below Brent.`
        }
        success={`Solved: week ${week + 1}, ${d2(-nfDiscNow)} below Brent. Of that, ${d2(-b.nfLocation)} is location — the line was full — and only ${d2(-b.nfQuality)} is quality. A trader who saw only “sour crude is cheap” would have missed that it was the pipeline, not the sulfur, doing most of the work.`}
      />

      <P>
        Switch to the history in which the expansion is never built and the location part swallows everything else: Northfield Sour’s discount to Brent reaches{' '}
        {d2(-(f.neverDeepest.northfield - f.neverDeepest.brent))}, of which only {d2(-f.neverDeepest.nfQuality)} is quality. Separating the two matters to anyone
        who trades them. The quality part
        answers refinery economics and fuel-oil prices, the location part answers pipeline capacity, and they can be hedged — or speculated on — separately, as
        Chapter 6 will. You can return to <FigRef to="WTI-Brent Price Explorer">the first demonstration</FigRef> to see how the basin’s growth and the pipeline’s
        timing set the location part.
      </P>
      <P>
        Crude prices are only half of what a refinery sees. It buys crude at these prices and sells gasoline, diesel and jet fuel, whose prices answer their own
        supply, demand and stocks — and which, because one barrel of crude makes all of them at once, can move against each other. The{' '}
        <a href={lessonHref('oil/5.3')}>next lesson</a> builds the product markets.
      </P>
    </LessonPage>
  );
}
