import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Slider,
  Sup,
  TEXT,
  fmt,
  lessonHref,
  linePath,
  mix,
  pct,
  scale,
  signed,
  usd,
  useScenario,
} from '../../../framework';
import {
  FARM,
  HEAT_THRESHOLD_F,
  SUMMER_HALF_RANGE_F,
  YIELD_PARAMS,
  cornPrice,
  cornYield,
  farmSeason,
  heatFactor,
  waterFactor,
  type SeasonWeather,
} from '../../../engines/weather/crops';
import { archive, monthDays, tempF } from '../../../model/weather/archive';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// Marlow's seasons, with the climate reshaped: summers warmer by `warm` °F, summer rain scaled.

const YEARS = 41;

interface RawSeason {
  year: number;
  /** July–August daily mean temperatures at Marlow, °F. */
  means: number[];
  /** June–August rain, inches. */
  rainIn: number;
}

let rawCache: RawSeason[] | null = null;
function rawSeasons(): RawSeason[] {
  if (rawCache) return rawCache;
  const a = archive();
  rawCache = Array.from({ length: YEARS }, (_, i) => {
    const year = i + 1;
    const means: number[] = [];
    for (const m of [6, 7]) {
      const { start, days } = monthDays(year, m);
      for (let k = 0; k < days; k++) means.push(tempF('marlow', start + k));
    }
    let rainIn = 0;
    for (const m of [5, 6, 7]) {
      const { start, days } = monthDays(year, m);
      for (let k = 0; k < days; k++) rainIn += a.rain.marlow[start + k];
    }
    return { year, means, rainIn };
  });
  return rawCache;
}

/** Marlow's growing-season weather in a year, with every summer day `warm` °F warmer and the rain scaled by `rainScale`. */
export function seasonWith(year: number, warm = 0, rainScale = 1): SeasonWeather {
  const r = rawSeasons()[year - 1];
  let heatDD = 0;
  for (const m of r.means) heatDD += Math.max(0, m + warm + SUMMER_HALF_RANGE_F - HEAT_THRESHOLD_F);
  const july = r.means.slice(0, 31);
  return { heatDD, rainIn: r.rainIn * rainScale, julyF: july.reduce((s, v) => s + v, 0) / 31 + warm };
}

export interface MarlowSeason {
  year: number;
  heatDD: number;
  rainIn: number;
  bushels: number;
  price: number;
  profit: number;
}

/** All 41 simulated seasons at Marlow under a reshaped climate, with the farm's price and profit. */
export function marlowSeasons(warm: number, rainScale: number, share: number): MarlowSeason[] {
  return Array.from({ length: YEARS }, (_, i) => {
    const w = seasonWith(i + 1, warm, rainScale);
    const y = cornYield(w).bushels;
    const f = farmSeason(y, share);
    return { year: i + 1, heatDD: w.heatDD, rainIn: w.rainIn, bushels: y, price: f.price, profit: f.profit };
  });
}

function meanSd(xs: number[]): { mean: number; sd: number } {
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  return { mean, sd: Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length) };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ---------------------------------------------------------------------------
// Challenges.

/** The median summer's heat in the archive, rounded: 96 degree days. */
export const MEDIAN_HEAT = 96;
/** The median summer's rain, rounded: 13.2 inches. */
export const MEDIAN_RAIN = 13.2;
export const RAIN_STEP = 0.1;

/** The farm's profit on one season at the normal $4.50 price, $. */
export function fieldProfit(heatDD: number, rainIn: number): number {
  return farmSeason(cornYield({ heatDD, rainIn, julyF: 0 }).bushels, 0).profit;
}

/** The first challenge: in a median-heat summer, the least rain (to 0.1 in) at which the farm still breaks even. */
export function breakevenRainSolved(st: { heat: number; rain: number }): boolean {
  if (st.heat !== MEDIAN_HEAT) return false;
  return fieldProfit(st.heat, st.rain) >= 0 && fieldProfit(st.heat, st.rain - RAIN_STEP) < 0;
}

export const SHARE_GRID = Array.from({ length: 50 }, (_, i) => (i + 1) / 100);

/** Year-to-year standard deviation of the farm's profit at a share of the national crop, in today's climate, $. */
export function profitSd(share: number): number {
  return meanSd(marlowSeasons(0, 1, share).map((s) => s.profit)).sd;
}

let leastSd: number | null = null;
/** The steadiest the farm's profit gets at any share on the slider, $. */
export function steadiestSd(): number {
  if (leastSd === null) leastSd = Math.min(...SHARE_GRID.map(profitSd));
  return leastSd;
}

/** The second challenge: in today's climate, a share that makes the profit as steady as any share can, to within $1,000. */
export function steadiestSolved(st: { share: number; warm: number; rainScale: number }): boolean {
  if (st.warm !== 0 || Math.abs(st.rainScale - 1) > 1e-9) return false;
  return profitSd(st.share) <= steadiestSd() + 1000;
}

// ---------------------------------------------------------------------------
// The first demonstration: the yield over heat and rain.

const RX = scale(4, 24, 64, 470);
const HY = scale(0, 250, 272, 24);
const R_CELLS = 40;
const H_CELLS = 25;
const ISO = [140, 160, 180, 200, 220];

/** Brown for poor yields, pale for normal, green for good. */
function yieldFill(y: number): string {
  const t = Math.max(0, Math.min(1, (y - 100) / 140));
  return t < 0.57 ? mix('#c08a4d', '#f2eedf', t / 0.57) : mix('#f2eedf', '#8fbf5a', (t - 0.57) / 0.43);
}

/** The heat (degree days) at which the yield is `y` for a season's rain, or null. */
function heatFor(y: number, rain: number): number | null {
  const top = YIELD_PARAMS.potential * waterFactor(rain);
  if (top < y) return null;
  return -Math.log(y / top) / YIELD_PARAMS.heatLoss;
}

const CELLS = (() => {
  const out: Array<{ x: number; y: number; w: number; h: number; fill: string }> = [];
  const dr = 20 / R_CELLS;
  const dh = 250 / H_CELLS;
  for (let i = 0; i < R_CELLS; i++) {
    for (let j = 0; j < H_CELLS; j++) {
      const r = 4 + (i + 0.5) * dr;
      const h = (j + 0.5) * dh;
      const y = cornYield({ heatDD: h, rainIn: r, julyF: 0 }).bushels;
      out.push({ x: RX(4 + i * dr), y: HY(h + dh / 2), w: RX(dr) - RX(0) + 0.5, h: HY(0) - HY(dh) + 0.5, fill: yieldFill(y) });
    }
  }
  return out;
})();

const ISO_PATHS = ISO.map((y) => {
  let d = '';
  let open = false;
  let last: [number, number] | null = null;
  for (let r = 4; r <= 24.0001; r += 0.1) {
    const h = heatFor(y, r);
    if (h === null || h > 250) {
      open = false;
      continue;
    }
    d += `${open ? ' L' : 'M'}${RX(r).toFixed(1)} ${HY(h).toFixed(1)}`;
    open = true;
    last = [RX(r), HY(h)];
  }
  return { y, d, last };
});

function YieldMap({ heat, rain, seasons }: { heat: number; rain: number; seasons: MarlowSeason[] }) {
  const y = cornYield({ heatDD: heat, rainIn: rain, julyF: 0 }).bushels;
  const legend = scale(100, 240, 262, 40);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 314"
      role="img"
      aria-label={`Corn yield at Marlow over a season's heat and rain. With ${fmt(heat)} heat degree days in July and August and ${fmt(rain, 1)} inches of rain from June through August, the yield is ${fmt(y)} bushels an acre. The dots are the archive's 41 simulated seasons, from ${fmt(Math.min(...seasons.map((s) => s.bushels)))} to ${fmt(Math.max(...seasons.map((s) => s.bushels)))} bushels an acre.`}
    >
      <text className="ax" x={64} y={14}>
        Heat degree days, July–August
      </text>
      {CELLS.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill={c.fill} />
      ))}
      <GridY y={HY} ticks={[0, 50, 100, 150, 200, 250]} x0={64} x1={470} />
      {ISO_PATHS.map((p) => (
        <g key={p.y}>
          <path d={p.d} fill="none" stroke="#5f5f5f" strokeWidth={p.y === 180 ? 1.8 : 1} strokeDasharray={p.y === 180 ? undefined : '3 3'} opacity={0.8} />
          {p.last && (
            <text x={Math.min(466, p.last[0]) - 2} y={p.last[1] - 4} textAnchor="end" className="ax" style={{ fill: '#444' }}>
              {p.y}
            </text>
          )}
        </g>
      ))}
      {seasons.map((s) => (
        <circle key={s.year} cx={RX(Math.min(24, s.rainIn))} cy={HY(s.heatDD)} r={3.2} fill="#fcfcfb" stroke="#555" strokeWidth={1.2} />
      ))}
      <line x1={RX(rain)} x2={RX(rain)} y1={24} y2={272} className="cur" />
      <line x1={64} x2={470} y1={HY(heat)} y2={HY(heat)} className="cur" />
      <circle cx={RX(rain)} cy={HY(heat)} r={7} fill={yieldFill(y)} stroke="#222" strokeWidth={2} />
      {[4, 8, 12, 16, 20, 24].map((r) => (
        <text key={r} className="ax ax-m" x={RX(r)} y={290}>
          {r}
        </text>
      ))}
      <text className="ax ax-e" x={470} y={308}>
        rain, June–August, inches
      </text>
      {/* The color key. */}
      <text className="ax" x={520} y={30}>
        bu/acre
      </text>
      {Array.from({ length: 28 }, (_, i) => 100 + i * 5).map((v) => (
        <rect key={v} x={520} y={legend(v + 5)} width={16} height={legend(v) - legend(v + 5) + 0.5} fill={yieldFill(v + 2.5)} />
      ))}
      {[100, 140, 180, 220].map((v) => (
        <text key={v} className="ax" x={542} y={legend(v) + 4}>
          {v}
        </text>
      ))}
      <line x1={516} x2={540} y1={legend(Math.max(100, Math.min(240, y)))} y2={legend(Math.max(100, Math.min(240, y)))} stroke="#222" strokeWidth={2} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second demonstration: the farm's 41 seasons.

const YX = scale(80, 240, 72, 612);
const PY = scale(-800_000, 500_000, 196, 24);
const PRY = scale(2, 8, 296, 226);
const CURVE_Y = Array.from({ length: 81 }, (_, i) => 80 + i * 2);

function kusd(v: number): string {
  if (v === 0) return '$0';
  return (v < 0 ? '−' : '') + `$${fmt(Math.abs(v) / 1000)}k`;
}

function FarmChart({ seasons, share }: { seasons: MarlowSeason[]; share: number }) {
  const worst = seasons.reduce((a, b) => (b.profit < a.profit ? b : a));
  const profitLine = linePath(
    CURVE_Y.map(YX),
    CURVE_Y.map((y) => PY(Math.max(-800_000, Math.min(500_000, farmSeason(y, share).profit)))),
  );
  const priceLine = linePath(
    CURVE_Y.map(YX),
    CURVE_Y.map((y) => PRY(cornPrice(y, share))),
  );
  const losses = seasons.filter((s) => s.profit < 0).length;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 330"
      role="img"
      aria-label={`The Marlow farm's profit in each of 41 simulated seasons against its yield, with ${fmt(share * 100)}% of the national crop grown under the same weather. It loses money in ${losses} seasons; its worst season, year ${worst.year}, yields ${fmt(worst.bushels)} bushels an acre, sells at ${usd(worst.price, 2)} a bushel and loses ${usd(-worst.profit)}.`}
    >
      <text className="ax" x={72} y={14}>
        The farm’s profit for the season
      </text>
      <GridY y={PY} ticks={[-800_000, -400_000, 0, 400_000]} x0={72} x1={612} format={kusd} baseline={0} />
      <line x1={YX(FARM.normalYield)} x2={YX(FARM.normalYield)} y1={24} y2={296} stroke="#9a9a9a" strokeDasharray="2 3" />
      <path d={profitLine} fill="none" stroke={GRAPHIC.green} strokeWidth={2.5} />
      {seasons.map((s) => (
        <circle
          key={s.year}
          cx={YX(Math.max(80, Math.min(240, s.bushels)))}
          cy={PY(Math.max(-800_000, Math.min(500_000, s.profit)))}
          r={s.year === worst.year ? 5.5 : 4}
          fill={s.profit >= 0 ? GRAPHIC.green : GRAPHIC.red}
          stroke="#fcfcfb"
          strokeWidth={1.5}
          opacity={0.9}
        />
      ))}
      <text className="ax" x={YX(Math.max(80, Math.min(240, worst.bushels))) + 9} y={PY(Math.max(-800_000, worst.profit)) + 4} style={{ fill: TEXT.red }}>
        year {worst.year}
      </text>
      <text className="ax" x={72} y={218}>
        Price of corn, $ per bushel
      </text>
      <GridY y={PRY} ticks={[2, 4, 6, 8]} x0={72} x1={612} format={(v) => `$${v}`} />
      <line x1={72} x2={612} y1={PRY(FARM.basePrice)} y2={PRY(FARM.basePrice)} stroke="#9a9a9a" strokeDasharray="4 4" />
      <path d={priceLine} fill="none" stroke={GRAPHIC.green} strokeWidth={2} strokeDasharray="6 3" />
      {[80, 120, 160, 200, 240].map((v) => (
        <text key={v} className="ax ax-m" x={YX(v)} y={312}>
          {v}
        </text>
      ))}
      <text className="ax ax-m" x={YX(FARM.normalYield)} y={312} style={{ fill: '#777' }}>
        normal
      </text>
      <text className="ax ax-e" x={612} y={327}>
        yield, bushels per acre
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s = useScenario('field', { heat: MEDIAN_HEAT, rain: MEDIAN_RAIN });
  const { heat, rain } = s.state;
  const yr = cornYield({ heatDD: heat, rainIn: rain, julyF: 0 });
  const profit = fieldProfit(heat, rain);
  const solved = breakevenRainSolved(s.state);

  const f = useScenario('farm', { share: 0.02, warm: 0, rainScale: 1 });
  const { share, warm, rainScale } = f.state;
  const seasons = useMemo(() => marlowSeasons(warm, rainScale, share), [warm, rainScale, share]);
  const stats = meanSd(seasons.map((x) => x.profit));
  const worst = seasons.reduce((a, b) => (b.profit < a.profit ? b : a));
  const losses = seasons.filter((x) => x.profit < 0).length;
  const solved2 = useMemo(() => steadiestSolved(f.state), [f.state]);

  // Numbers the prose quotes, from today's climate.
  const base = useMemo(() => marlowSeasons(0, 1, 0.02), []);
  const n = useMemo(() => {
    const bush = base.map((x) => x.bushels);
    const sorted = [...base].sort((a, b) => a.bushels - b.bushels);
    const heats = base.map((x) => x.heatDD);
    const rains = base.map((x) => x.rainIn);
    const poor = base.filter((x) => x.bushels < 0.9 * FARM.normalYield);
    const heatLed = poor.filter((x) => heatFactor(x.heatDD) < waterFactor(x.rainIn)).length;
    const st = meanSd(base.map((x) => x.profit));
    const at = (sh: number) => {
      const ss = marlowSeasons(0, 1, sh);
      const m = meanSd(ss.map((x) => x.profit));
      return { ...m, worst: Math.min(...ss.map((x) => x.profit)) };
    };
    const warmed = (w: number) => {
      const ss = marlowSeasons(w, 1, 0.02);
      return { median: median(ss.map((x) => x.bushels)), losses: ss.filter((x) => x.profit < 0).length, mean: meanSd(ss.map((x) => x.profit)).mean };
    };
    const drier = marlowSeasons(0, 0.8, 0.02);
    return {
      medianYield: median(bush),
      best: sorted[sorted.length - 1],
      worst: sorted[0],
      medianHeat: median(heats),
      medianRain: median(rains),
      poor: poor.length,
      heatLed,
      mean: st.mean,
      sd: st.sd,
      losses: base.filter((x) => x.profit < 0).length,
      at40: at(0.4),
      at50: at(0.5),
      warm05: warmed(0.5),
      warm1: warmed(1),
      warm2: warmed(2),
      drier: { median: median(drier.map((x) => x.bushels)), losses: drier.filter((x) => x.profit < 0).length },
    };
  }, [base]);
  const atMedian = cornYield({ heatDD: MEDIAN_HEAT, rainIn: MEDIAN_RAIN, julyF: 0 }).bushels;
  const breakeven = FARM.costPerAcre / FARM.basePrice;
  const normalProfit = farmSeason(FARM.normalYield, 0).profit;

  return (
    <LessonPage id="weather/4.3">
      <P>
        The last two lessons followed the weather into the city: into the gas Calder Gas & Light sends out on a cold day, and into the prices of gas and power. Now
        we go inland, to the corn plains around Marlow, 350 km west of the coast. A farm’s exposure looks different from a utility’s. It doesn’t sell a little more
        or less every day of the winter. It sells one harvest a year, and the weather that matters most comes in a few weeks of high summer.
      </P>
      <P>
        Corn grows faster as it gets warmer, up to a point. Studying decades of yields across thousands of US counties, the economists Wolfram Schlenker and Michael
        Roberts found in 2009 that yields rise with temperature up to about 29 °C (84 °F) and fall steeply above it. The plant is most vulnerable in July, when it
        pollinates: heat and drought then can leave the ears poorly filled. It also needs water, steadily, through the summer — and too much rain does harm as well, by
        waterlogging the roots.
      </P>
      <P>
        Our model of the Marlow crop keeps the two stresses that matter most. Heat is counted as <K tone={WX.index}>heat degree days</K>: for each day of July and
        August, how many degrees its maximum temperature rises above 86 °F (30 °C), summed over the two months — the same 86 °F that US agronomists use as the cap
        when they count corn’s growing degree days. In the model a summer day’s maximum runs about {SUMMER_HALF_RANGE_F} °F above its mean. Water is counted as the{' '}
        <K tone={WX.moisture}>rain</K> that falls from June through August. Each stress keeps a share of the crop’s potential, {YIELD_PARAMS.potential} bushels an
        acre in a summer with neither:
      </P>
      <Eq label="Yield equals 249 bushels per acre times e to the minus 0.003 times the heat degree days, times the share kept after water stress">
        <span>yield</span>
        <Op>=</Op>
        <span>{YIELD_PARAMS.potential}</span>
        <Op>×</Op>
        <span>
          e<Sup>−{YIELD_PARAMS.heatLoss} × <K tone={WX.index}>heat</K></Sup>
        </span>
        <Op>×</Op>
        <span>
          W(<K tone={WX.moisture}>rain</K>)
        </span>
      </Eq>
      <P>
        Here W is 1 for anything from 13 to 18 inches of rain, and falls away on either side: steeply, with the square of the shortfall, in a drought, and more
        gently in a wet summer. The next demonstration maps the result. Each point of the map is a summer, placed by its heat and its rain and shaded by the yield
        it gives; the gray lines join summers with the same yield, and the open dots are the 41 seasons of the course’s simulated archive. Set a season’s heat and
        rain:
      </P>

      <Figure name="Weather-to-Yield Simulator" scenario={s}>
        <YieldMap heat={heat} rain={rain} seasons={base} />
        <Legend
          items={[
            { label: 'Equal yield, bushels per acre', color: '#5f5f5f', kind: 'line', dashed: true },
            { label: 'The archive’s seasons', color: '#555' },
          ]}
        />
        <Readouts
          items={[
            { label: 'yield', value: `${fmt(yr.bushels)} bu/acre` },
            { label: 'kept after the heat', value: pct(yr.heatFactor), tone: WX.index },
            { label: 'kept after the rain', value: pct(yr.waterFactor), tone: WX.moisture },
            { label: 'farm’s profit at $4.50', value: usd(profit), tone: profit < 0 ? 'red' : WX.money },
          ]}
        />
        <Slider label="Heat, July–August" tone={WX.index} value={heat} min={0} max={250} step={1} onChange={(v) => s.set({ heat: v })} display={`${fmt(heat)} degree days`} />
        <Slider label="Rain, June–August" tone={WX.moisture} value={rain} min={4} max={24} step={RAIN_STEP} onChange={(v) => s.set({ rain: v })} display={`${fmt(rain, 1)} in`} />
        <Caption>
          {heatFactor(heat) < waterFactor(rain) - 0.005
            ? `Heat is the larger stress: it takes ${pct(1 - yr.heatFactor)} of the potential, the rain ${pct(1 - yr.waterFactor)}.`
            : waterFactor(rain) < heatFactor(heat) - 0.005
              ? `Water is the larger stress: the rain costs ${pct(1 - yr.waterFactor)} of the potential, the heat ${pct(1 - yr.heatFactor)}.`
              : 'Heat and water cost about the same share of the potential.'}
        </Caption>
      </Figure>

      <P>
        It starts at the archive’s median summer: {fmt(n.medianHeat)} heat degree days and {fmt(n.medianRain, 1)} inches of rain. That summer yields{' '}
        {fmt(atMedian)} bushels an acre. Notice how much the heat of an ordinary summer already costs: a quarter of the potential. Each further heat degree day
        takes another 0.3% — about half a bushel an acre from a normal crop — so a run of hot days in July adds up quickly. The rain works differently. Between 13
        and 18 inches it hardly matters, but below 13 the losses grow with the square of the shortfall: in a median-heat summer, 11 inches yields{' '}
        {fmt(cornYield({ heatDD: MEDIAN_HEAT, rainIn: 11, julyF: 0 }).bushels)} bushels, 9 inches {fmt(cornYield({ heatDD: MEDIAN_HEAT, rainIn: 9, julyF: 0 }).bushels)}
        , and 7 inches {fmt(cornYield({ heatDD: MEDIAN_HEAT, rainIn: 7, julyF: 0 }).bushels)}.
      </P>
      <P>
        The dots show which stress the real risk comes from. The worst season in the archive, year {n.worst.year}, had {fmt(n.worst.heatDD)} heat degree days and
        only {fmt(n.worst.rainIn, 1)} inches of rain, and yielded {fmt(n.worst.bushels)} bushels an acre. Of the {n.poor} seasons that fell more than 10% short of a
        normal {FARM.normalYield}, heat did more of the damage in {n.heatLed} and drought in {n.poor - n.heatLed}. The two often come together, because a dry summer
        is a hot one: with little water to evaporate, the sun’s energy goes into heating the ground and the air (the latent heat of{' '}
        <a href={lessonHref('weather/1.3')}>Lesson 1.3</a>, working in reverse). In the archive, as on the real plains, a hot spell makes rain less likely.
      </P>
      <P>
        Notice, too, that the archive’s median season yields {fmt(n.medianYield)} bushels, less than the {fmt(atMedian)} of a summer that is median in both heat and
        rain. Few summers are typical in both at once; most carry a little of one stress or the other, and losses on one side are not made up on the other.
      </P>
      <P>
        Now put a farm on the map. Our Marlow farm grows {fmt(FARM.acres)} acres of corn at a cost of {usd(FARM.costPerAcre)} an acre, land rent included — about{' '}
        {usd(FARM.acres * FARM.costPerAcre)} a season, spent before the weather is known. In a normal year it harvests {FARM.normalYield} bushels an acre and sells
        them at <K tone={WX.money}>{usd(FARM.basePrice, 2)} a bushel</K>, which brings in {usd(FARM.normalYield * FARM.acres * FARM.basePrice)} and leaves a profit
        of {usd(normalProfit)}. (The farm, its costs and its prices are illustrative, in a realistic range, like everything else in this simulated world.) The
        margin is thin. At {usd(FARM.basePrice, 2)}, the farm breaks even at {fmt(breakeven, 1)} bushels an acre, less than 4% below normal.
      </P>

      <Challenge
        id="a"
        question={`In a summer with the median ${MEDIAN_HEAT} heat degree days, what’s the least June–August rain, to the nearest tenth of an inch, at which the farm still breaks even at $4.50 a bushel?`}
        solved={solved}
        status={
          heat !== MEDIAN_HEAT
            ? `First set the heat back to ${MEDIAN_HEAT} degree days.`
            : profit >= 0
              ? `With ${fmt(rain, 1)} inches the farm makes ${usd(profit)}. Could the summer be drier and still break even?`
              : `With ${fmt(rain, 1)} inches the farm loses ${usd(-profit)}.`
        }
        success={`Solved. With ${fmt(rain, 1)} inches the crop keeps ${pct(yr.waterFactor, 1)} of what the rain allows and yields ${fmt(yr.bushels, 1)} bushels an acre, just above the ${fmt(breakeven, 1)} that covers the costs; a tenth of an inch less and it falls short. Three and a half inches below the median summer’s rain is a dry summer, but not a rare one — and in a hotter one, it would take far more rain to break even.`}
      />

      <H2>Forty-one harvests</H2>
      <P>
        Run the farm through all 41 seasons of the archive. Its yield ranges from {fmt(n.worst.bushels)} to {fmt(n.best.bushels)} bushels an acre, and at a steady{' '}
        {usd(FARM.basePrice, 2)} it loses money in {n.losses} seasons of {YEARS}. Its profit averages {usd(n.mean)}, but swings by {usd(n.sd)} from one season to the
        next (a standard deviation), and in year {n.worst.year} it loses {usd(-Math.min(...base.map((x) => x.profit)))}. A business whose profit is a small difference
        between two large numbers, one of them set by the weather, lives or dies by the weather.
      </P>
      <P>
        But the price isn’t always steady. If only Marlow had a bad summer, the national harvest would hardly notice and the price wouldn’t move. The weather that
        withers Marlow’s corn, though, often covers much of the corn belt at once, and then the whole country’s crop shrinks and the price rises. In 2012, drought
        and heat across the US Midwest cut the national corn yield to about a quarter below what had been expected, and corn futures rose to records above $8 a
        bushel. In our model a 1% smaller national crop raises the price by 2.5%, and the share of the national crop grown under Marlow’s weather decides how much
        Marlow’s yield moves it.
      </P>
      <P>
        In the next demonstration, each dot is one of the 41 seasons, placed by its yield and the farm’s profit, and the green line is the profit the farm would make
        at every yield. The dashed line in the lower panel is the price. Change the share of the national crop that shares Marlow’s weather, and reshape Marlow’s
        climate — warmer summers, more or less summer rain:
      </P>

      <Figure name="Weather-to-Yield Simulator · the farm’s years" scenario={f}>
        <FarmChart seasons={seasons} share={share} />
        <Legend
          items={[
            { label: 'A profitable season', color: GRAPHIC.green },
            { label: 'A losing season', color: GRAPHIC.red },
            { label: 'Profit at each yield', color: GRAPHIC.green, kind: 'line' },
            { label: 'Price at each yield', color: GRAPHIC.green, kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'average profit', value: usd(stats.mean), tone: stats.mean < 0 ? 'red' : WX.money },
            { label: 'swing, season to season', value: usd(stats.sd), tone: WX.money },
            { label: `worst season, year ${worst.year}`, value: usd(worst.profit), tone: worst.profit < 0 ? 'red' : WX.money },
            { label: 'losing seasons', value: `${losses} of ${YEARS}` },
          ]}
        />
        <Slider
          label="Share of the national crop under Marlow’s weather"
          value={share}
          min={0.01}
          max={0.5}
          step={0.01}
          onChange={(v) => f.set({ share: v })}
          display={`${fmt(share * 100)}%`}
        />
        <Slider label="Summers warmer by" tone={WX.temperature} value={warm} min={0} max={3} step={0.5} onChange={(v) => f.set({ warm: v })} display={`+${fmt(warm, 1)} °F`} />
        <Slider
          label="Summer rain"
          tone={WX.moisture}
          value={rainScale}
          min={0.7}
          max={1.3}
          step={0.05}
          onChange={(v) => f.set({ rainScale: v })}
          display={Math.abs(rainScale - 1) < 1e-9 ? 'as in the archive' : `${signed(Math.round((rainScale - 1) * 100))}%`}
        />
      </Figure>

      <P>
        At 2% the price barely moves, the profit line is steep, and the dots spread from {usd(Math.max(...base.map((x) => x.profit)))} to{' '}
        {usd(Math.min(...base.map((x) => x.profit)))}. Raise the share and the line tilts. A poor harvest now sells at a higher price, so the farm loses less in its
        bad years and makes less in its good ones. At 40% — where 2.5 × the share is exactly 1 — a bushel lost is very nearly paid for by the higher price of the
        rest, and the farm’s profit hardly depends on its yield at all: it swings by only {usd(n.at40.sd)}, and its worst season costs it {usd(-n.at40.worst)}. This
        is a <b>natural hedge</b>: the farm’s price and its quantity move in opposite directions. Past that point the farm is over-hedged, its good harvests now
        selling so cheaply that they become its losing seasons; at 50% the swing is back up to {usd(n.at50.sd)}.
      </P>

      <Challenge
        id="b"
        question="Leave Marlow’s climate as it is. What share of the national crop makes the farm’s profit steadiest, to within $1,000 of the smallest swing any share gives?"
        solved={solved2}
        status={
          warm !== 0 || Math.abs(rainScale - 1) > 1e-9
            ? 'First set the summers back to normal and the rain back to the archive’s.'
            : `At ${fmt(share * 100)}%, the profit swings by ${usd(profitSd(share))} from season to season.`
        }
        success={`Solved. At ${fmt(share * 100)}%, the swing is down to ${usd(profitSd(share))}, against ${usd(n.sd)} at 2%. It bottoms out near 40%, where a 1% shortfall in the crop raises the price by almost exactly 1%, so revenue stands still. But notice who pays for this hedge: the buyers of corn, in higher prices. And it only works for a farm whose weather really is the nation’s. A farm hit by a storm that missed its neighbors (Lesson 2.3) gets no help from the price at all.`}
      />

      <P>
        The other two controls are the physical drivers of the risk, and the farm is very sensitive to them. In this model, summers just 0.5 °F warmer drop the
        median yield to {fmt(n.warm05.median)} bushels and turn {n.warm05.losses} of the {YEARS} seasons into losses; at +1 °F the median is {fmt(n.warm1.median)}, and
        at +2 °F it is {fmt(n.warm2.median)} and the farm loses {usd(-n.warm2.mean)} in an average year. Each degree pushes more days over 86 °F and pushes the hot days
        further over it. A fifth less summer rain is gentler on the median, {fmt(n.drier.median)} bushels, but it deepens the drought years and makes{' '}
        {n.drier.losses} of the seasons losses. Try warming with the share at 40%: the natural hedge softens the swings, but it can’t restore an average that the
        climate has taken away. A hedge moves money between good years and bad; it doesn’t make a bad climate good.
      </P>
      <P>
        What the farm needs, then, is protection against particular weather: a hot July and August, or a dry June to August, at Marlow. Chapter 5 builds contracts
        that pay on indices of exactly that kind. Before we get there, two more of the region’s businesses sell something the weather makes directly. In{' '}
        <a href={lessonHref('weather/4.4')}>the next lesson</a>, Hollin Ridge’s wind farm and the Valley solar plant turn wind and sunshine into electricity, and we
        ask how much their output can be forecast — and how much it can’t. Compare <FigRef to="Weather-to-Yield Simulator">the yield map</FigRef>: their power, like
        the corn, depends on the weather in a way that is far from a straight line.
      </P>
    </LessonPage>
  );
}
