import { useMemo, useState } from 'react';
import {
  Button,
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
  scale,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { describe, quantile } from '../../../engines/strategy/distribution';
import { districtCrop, valleyFrom, valleySeason } from '../../../engines/agriculture/valley';
import { normalYear, simulatedYear } from '../../../model/agriculture/climate';
import { DISTRICTS, VALLEY_CORN_KAC, type Crop, type DistrictId } from '../../../model/agriculture/region';
import { HistogramChart } from '../shared/HistogramChart';
import { CROP_LINE } from '../shared/tones';

const MAX_SEASONS = 400;
const PER_SECOND = 40;
const SD_BAND = 'rgba(0, 0, 0, .08)';

/** The season whose weather district `d` draws in valley season i when each district has its own: a different shuffle of the 400 for each district. */
export function ownYear(i: number, d: DistrictId): number {
  return ((i * 7 + DISTRICTS.findIndex((x) => x.id === d) * 97) % MAX_SEASONS) + 1;
}

/** Valley production in season i (1-based), millions of bushels, with the districts sharing one year's weather or drawing their own. */
const prodCache = new Map<string, number>();
export function production(i: number, crop: Crop, independent: boolean): number {
  const k = `${i}|${crop}|${independent}`;
  let v = prodCache.get(k);
  if (v === undefined) {
    if (!independent) v = valleySeason(i)[crop] / 1e6;
    else v = valleyFrom((d) => simulatedYear(ownYear(i, d), d))[crop] / 1e6;
    prodCache.set(k, v);
  }
  return v;
}

let normalCache: { corn: number; wheat: number } | null = null;
/** Valley production in a season whose every day has its normal weather, millions of bushels. */
export function normalWeatherProduction(): { corn: number; wheat: number } {
  if (!normalCache) {
    const v = valleyFrom((d) => normalYear(d));
    normalCache = { corn: v.corn / 1e6, wheat: v.wheat / 1e6 };
  }
  return normalCache;
}

let sharedTenthCache: number | null = null;
/** The valley's 1-in-10 bad corn crop over the 400 shared-weather seasons, rounded to the threshold's 5-million-bushel steps. */
export function sharedTenth(): number {
  if (sharedTenthCache === null) {
    const vals = Array.from({ length: MAX_SEASONS }, (_, i) => production(i + 1, 'corn', false));
    sharedTenthCache = Math.round(quantile(vals, 0.1) / 5) * 5;
  }
  return sharedTenthCache;
}

/** The challenge: at least 200 corn seasons run with each district on its own weather, against the shared valley's 1-in-10 bad crop. */
export function independentSolved(n: number, crop: Crop, independent: boolean, threshold: number): boolean {
  return n >= 200 && crop === 'corn' && independent && threshold === sharedTenth();
}

function Runner({ playing, onTick }: { playing: boolean; onTick: (dt: number) => void }) {
  useAnimationFrame(onTick, playing);
  return null;
}

/** Unirrigated corn yields of one district in seasons 1–400, bu/ac. Cached. */
const cornCache = new Map<DistrictId, number[]>();
function districtCorn(d: DistrictId): number[] {
  let v = cornCache.get(d);
  if (!v) {
    v = Array.from({ length: MAX_SEASONS }, (_, i) => districtCrop(i + 1, d, 'corn').yield);
    cornCache.set(d, v);
  }
  return v;
}

/** The correlation coefficient of two equally long samples. */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

export interface PairStats {
  /** Black Prairie and River Bottoms corn yields in valley seasons 1–400, bu/ac. */
  prairie: number[];
  bottoms: number[];
  /** Each district's 1-in-10 bad yield (its 10th percentile). */
  prairieBad: number;
  bottomsBad: number;
  correlation: number;
  /** Seasons with a 1-in-10 bad crop on the Prairie, and how many of them have one in the Bottoms too. */
  prairieBadSeasons: number;
  bothBad: number;
}

/** The Prairie's and the Bottoms' corn over the 400 seasons, sharing each season's weather or drawing their own as in the Monte Carlo. */
const pairCache = new Map<boolean, PairStats>();
export function pairStats(independent: boolean): PairStats {
  let v = pairCache.get(independent);
  if (!v) {
    const P = districtCorn('prairie');
    const B = districtCorn('bottoms');
    const seasons = Array.from({ length: MAX_SEASONS }, (_, i) => i + 1);
    const prairie = seasons.map((i) => P[(independent ? ownYear(i, 'prairie') : i) - 1]);
    const bottoms = seasons.map((i) => B[(independent ? ownYear(i, 'bottoms') : i) - 1]);
    const prairieBad = quantile(prairie, 0.1);
    const bottomsBad = quantile(bottoms, 0.1);
    const badP = prairie.map((x) => x < prairieBad);
    v = {
      prairie,
      bottoms,
      prairieBad,
      bottomsBad,
      correlation: correlation(prairie, bottoms),
      prairieBadSeasons: badP.filter(Boolean).length,
      bothBad: badP.filter((b, i) => b && bottoms[i] < bottomsBad).length,
    };
    pairCache.set(independent, v);
  }
  return v;
}

function PairScatter({ st }: { st: PairStats }) {
  const lo = 60;
  const hi = 240;
  const x = scale(lo, hi, 80, 600);
  const y = scale(lo, hi, 290, 30);
  const c = (v: number) => Math.max(lo, Math.min(hi, v));
  const ticks = [60, 100, 140, 180, 220];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 330"
      role="img"
      aria-label={`Black Prairie against River Bottoms corn yields in 400 simulated seasons: correlation ${fmt(st.correlation, 2)}. In ${st.bothBad} of the Prairie’s ${st.prairieBadSeasons} 1-in-10 bad seasons the Bottoms has a 1-in-10 bad crop too.`}
    >
      <text className="ax" x={80} y={14}>
        River Bottoms corn, bu/ac
      </text>
      <GridY y={y} ticks={ticks} x0={80} x1={600} format={(v) => fmt(v)} />
      <rect x={x(lo)} y={y(st.bottomsBad)} width={x(st.prairieBad) - x(lo)} height={y(lo) - y(st.bottomsBad)} fill="rgba(231, 91, 85, .12)" />
      <line x1={x(st.prairieBad)} x2={x(st.prairieBad)} y1={y(hi)} y2={y(lo)} stroke={GRAPHIC.red} strokeWidth={1.5} strokeDasharray="4 3" />
      <line x1={x(lo)} x2={x(hi)} y1={y(st.bottomsBad)} y2={y(st.bottomsBad)} stroke={GRAPHIC.red} strokeWidth={1.5} strokeDasharray="4 3" />
      <text className="ax" x={x(st.prairieBad) + 4} y={y(hi) + 10} style={{ fill: TEXT.red }}>
        Prairie’s 1-in-10 bad crop
      </text>
      <text className="ax ax-e" x={x(hi)} y={y(st.bottomsBad) - 5} style={{ fill: TEXT.red }}>
        Bottoms’ 1-in-10 bad crop
      </text>
      {st.prairie.map((p, i) => {
        const both = p < st.prairieBad && st.bottoms[i] < st.bottomsBad;
        return <circle key={i} cx={x(c(p))} cy={y(c(st.bottoms[i]))} r={both ? 3.6 : 2.8} fill={both ? GRAPHIC.red : CROP_LINE.corn} opacity={both ? 0.9 : 0.5} />;
      })}
      {ticks.map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={308}>
          {v}
        </text>
      ))}
      <text className="ax ax-e" x={600} y={326}>
        Black Prairie corn, bu/ac
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('monte-carlo', { crop: 'corn' as Crop, independent: 'shared' as 'shared' | 'independent', threshold: 450 });
  const play = usePlay(false);
  const [n, setN] = useState(0);
  const [acc, setAcc] = useState(0);
  const independent = s.state.independent === 'independent';
  const values = useMemo(() => Array.from({ length: n }, (_, i) => production(i + 1, s.state.crop, independent)), [n, s.state.crop, independent]);
  const d = describe(values);
  const below = values.filter((v) => v < s.state.threshold).length;
  const solved = useMemo(() => independentSolved(n, s.state.crop, independent, s.state.threshold), [n, s.state.crop, independent, s.state.threshold]);
  const tenth = sharedTenth();
  const lo = s.state.crop === 'corn' ? 250 : 170;
  const hi = s.state.crop === 'corn' ? 650 : 290;
  const normal = normalWeatherProduction();
  const showSd = n > 20;
  const tick = (dt: number) => {
    const next = acc + dt * PER_SECOND;
    const whole = Math.floor(next);
    if (whole > 0) {
      setN((x) => {
        const v = Math.min(MAX_SEASONS, x + whole);
        if (v >= MAX_SEASONS) play.setPlaying(false);
        return v;
      });
    }
    setAcc(next - whole);
  };

  const c = useScenario('pair', { weather: 'shared' as 'shared' | 'independent' });
  const pair = useMemo(() => pairStats(c.state.weather === 'independent'), [c.state.weather]);
  const shared = pairStats(false);
  const separate = pairStats(true);

  return (
    <LessonPage id="agriculture/3.5">
      <P>
        The last four lessons each looked at uncertainty from one side: geography, extremes, satellites, forecasts. This one adds it all up for the whole valley. The
        question a grain buyer actually needs answered isn’t “what will Cedar Bend yield?” but “how much corn will the Crane Valley produce, and how sure can we
        be?” The honest answer is not a number but a <K tone="gold">distribution</K>: every harvest the valley could plausibly bring in, from the disastrous to the
        bountiful, and how likely each is.
      </P>
      <P>
        The way to get one is the oldest trick in simulation, named after a casino: the <b>Monte Carlo</b> method. Run the valley’s five districts through one
        simulated season, add up the corn, write the number down; then do it again with another season’s weather, and again, hundreds of times. In the next
        demonstration each bar counts the seasons whose valley harvest fell in that range. Press play to run them, and move the threshold to see how many fall
        below it:
      </P>

      <Figure
        name="Harvest Monte Carlo"
        scenario={s}
        play={play}
        actions={
          <>
            <Button onClick={() => setN((x) => Math.min(MAX_SEASONS, x + 100))}>+100 seasons</Button>
            <Button
              onClick={() => {
                play.setPlaying(false);
                setN(0);
              }}
            >
              Clear
            </Button>
          </>
        }
      >
        <Runner playing={play.playing && n < MAX_SEASONS} onTick={tick} />
        <Segmented
          label="Crop"
          value={s.state.crop}
          onChange={(v) => s.set({ crop: v, threshold: v === 'corn' ? 450 : 210 })}
          options={[
            { value: 'corn', label: 'Corn' },
            { value: 'wheat', label: 'Wheat' },
          ]}
        />
        <Segmented
          label="Weather across the districts"
          value={s.state.independent}
          onChange={(v) => s.set({ independent: v })}
          options={[
            { value: 'shared', label: 'One valley-wide season' },
            { value: 'independent', label: 'Each district on its own' },
          ]}
        />
        <HistogramChart
          values={values.length ? values : [NaN]}
          lo={lo}
          hi={hi}
          bins={40}
          color={CROP_LINE[s.state.crop]}
          xFormat={(v) => fmt(v)}
          xLabel={`valley ${s.state.crop} production, millions of bushels`}
          yLabel={`Seasons, of ${n}`}
          band={showSd ? { from: d.mean - d.stdev, to: d.mean + d.stdev, color: SD_BAND } : undefined}
          marks={[
            ...(n ? [{ x: d.mean, label: `average ${fmt(d.mean)}`, color: '#333' }] : []),
            { x: s.state.threshold, label: `threshold ${fmt(s.state.threshold)}`, color: GRAPHIC.red, dash: '4 3', row: 1 },
            ...(s.state.crop === 'corn' ? [{ x: normal.corn, label: `average weather ${fmt(normal.corn)}`, color: '#777', dash: '2 3', row: 1 }] : []),
          ]}
          highlight={(_, b1) => b1 <= s.state.threshold}
          ariaLabel={`Valley ${s.state.crop} production in ${n} simulated seasons${n ? `: average ${fmt(d.mean)} million bushels${showSd ? `, standard deviation ${fmt(d.stdev)}` : ''}, ${fmt(d.q05)} to ${fmt(d.q95)} in 9 seasons of 10, and ${below} seasons below ${fmt(s.state.threshold)}` : ''}.`}
        />
        <Legend items={[{ label: 'Average ± one standard deviation', color: SD_BAND }]} />
        <Readouts
          items={[
            { label: 'standard deviation, million bu', value: showSd ? fmt(d.stdev) : '—' },
            { label: '9 seasons in 10 between', value: showSd ? `${fmt(d.q05)}–${fmt(d.q95)}` : '—' },
            { label: 'below the threshold', value: n ? `${fmt((below / n) * 100, 1)}%` : '—', tone: 'red' },
          ]}
        />
        <Slider
          label="Threshold"
          tone="red"
          value={s.state.threshold}
          min={lo}
          max={hi}
          step={5}
          onChange={(v) => s.set({ threshold: v })}
          display={`${fmt(s.state.threshold)} million bu`}
        />
      </Figure>

      <P>
        After 400 seasons the picture is clear. The valley’s corn harvest averages 506 million bushels, and in 9 seasons out of 10 it lands between 390 and 599.
        But the shape matters as much as the middle: the distribution leans. Its long tail is on the left. The worst season, a valley-wide drought, brought in 269
        million bushels, 237 below the average, while the best brought 630, only 124 above it. Good weather can only fill the kernels so full; bad weather can
        empty them. The median, 512, sits above the average for the same reason.
      </P>
      <P>
        A range and a shape take several numbers to describe. The single number most often used for spread is the <K>standard deviation</K>: take each season’s
        distance from the average, square it, average the squares and take the square root. It is, roughly, how far a typical season strays from the average. For
        the valley’s corn it is 64 million bushels, and the shaded band, the average plus or minus one standard deviation, holds 260 of the 400 seasons — about two
        in three. The other measures of spread in this course are built on it. The “±%” of <a href={lessonHref('agriculture/3.1')}>Lesson 3.1</a> was each
        district’s standard deviation as a share of its average, and the typical error of <a href={lessonHref('agriculture/3.4')}>Lesson 3.4</a> is the same
        calculation with each season’s miss in place of its distance from the average. For a symmetric, bell-shaped spread, eight outcomes in ten lie within 1.28
        standard deviations of the middle and nine in ten within 1.64, which is how Lesson 3.4 drew its band: the forecast plus or minus 1.28 typical errors.
      </P>
      <P>
        The tails have names of their own. The <b>1-in-10 bad crop</b> is the level that only one season in ten falls below — for the valley’s corn about{' '}
        {fmt(tenth)} million bushels, as the threshold will show — and the 1-in-20 bad crop the level one in twenty falls below, the bottom edge of the nine-in-ten
        range. The valley’s leaning distribution bends the bell-shaped rule, in the direction that hurts:
        its 1-in-20 bad crop, 390 million bushels, is 1.81 standard deviations below the average, while its 1-in-20 good crop, 599, is only 1.45 above. When the
        bad tail is what matters, it pays to quote the tail itself.
      </P>
      <P>
        It takes a lot of seasons to see a tail. After ten seasons the average is 521 million bushels and the histogram is a scatter of bars; after 50, 506; after 200, 507. The tail settles far more slowly: the 1-in-20 bad crop is still 408 after 200
        seasons and reaches 390 only by 400, because the rare seasons are the slowest to fill in — the worst drought in the history doesn’t appear until the
        forty-sixth season. Real history is the same, only shorter. A grain belt has a few decades of reliable records, which is very few draws from a distribution
        like this one, and that is one reason risk managers lean on simulations like these — and one reason they are sometimes surprised.
      </P>
      <P>
        One more experiment shows why the shape matters. A season with the average of every day’s weather — a little rain each day and never a hot spell — would grow{' '}
        {fmt(normal.corn)} million bushels, as much as the best of the 400 seasons. Average weather is not typical weather, and the harvest of average weather is not
        the average harvest.
      </P>

      <H2>One sky over the valley</H2>
      <P>
        Each district’s harvest swings, but if their swings were unrelated they would partly cancel, a bad season on the Prairie offset by a fair one in the
        Bottoms. They don’t cancel, because the districts share one sky. In the next demonstration each dot is one of the 400 seasons, with the Black Prairie’s corn
        yield across and the River Bottoms’ up. The dashed lines mark each district’s 1-in-10 bad crop, and the red corner holds the seasons when both have one at
        once. Switch between the two districts sharing each season’s weather and each drawing its own, as in <FigRef to="Harvest Monte Carlo">the Monte Carlo</FigRef>:
      </P>

      <Figure name="Harvest Monte Carlo · two districts" scenario={c}>
        <Segmented
          label="Weather"
          value={c.state.weather}
          onChange={(v) => c.set({ weather: v })}
          options={[
            { value: 'shared', label: 'One valley-wide season' },
            { value: 'independent', label: 'Each district on its own' },
          ]}
        />
        <PairScatter st={pair} />
        <Readouts
          items={[
            { label: 'correlation', value: fmt(pair.correlation, 2) },
            { label: 'Prairie’s 1-in-10 bad seasons that are the Bottoms’ too', value: `${pair.bothBad} of ${pair.prairieBadSeasons}`, tone: 'red' },
          ]}
        />
      </Figure>

      <P>
        Statisticians measure how closely two quantities move together with the <K>correlation</K>: 1 if they rise and fall in lockstep, 0 if knowing one tells
        nothing about the other, and negative if one tends to rise when the other falls. With shared weather the Prairie’s and the Bottoms’ yields have a
        correlation of {fmt(shared.correlation, 2)} — a loose link, because each district has its own storms and its own soil. But the link is tightest where it
        matters most. Of the {shared.prairieBadSeasons} seasons with a 1-in-10 bad crop on the Prairie, the Bottoms has one of its own in {shared.bothBad}, or{' '}
        {fmt((100 * shared.bothBad) / shared.prairieBadSeasons)}%; with separate weather, in {separate.bothBad}, or {fmt((100 * separate.bothBad) / separate.prairieBadSeasons)}%,
        close to the one in ten that chance alone would give. A drought big enough to hurt the Prairie usually covers the Bottoms too.
      </P>

      <Challenge
        id="a"
        figure="Harvest Monte Carlo"
        question={`Predict first: with one valley-wide season, ${fmt(tenth)} million bushels is the valley’s 1-in-10 bad corn crop. If each district drew its own weather instead, would more or fewer than one season in ten fall below it? Then, in the Monte Carlo, set the threshold to ${fmt(tenth)}, let each district draw its own weather, and run at least 200 seasons of corn to check.`}
        solved={solved}
        status={
          s.state.crop !== 'corn'
            ? 'Choose corn.'
            : s.state.threshold !== tenth
              ? `Set the threshold to ${fmt(tenth)} million bushels.`
              : !independent
                ? 'Let each district draw its own weather.'
                : n < 200
                  ? `${n} seasons run so far. Run at least 200.`
                  : ''
        }
        success={`Solved: with each district on its own weather, only ${fmt((below / Math.max(1, n)) * 100, 1)}% of the ${n} seasons fall below ${fmt(tenth)} million bushels, not one in ten, and the valley’s 1-in-10 bad crop rises to about ${fmt(quantile(values, 0.1))}. Separate weather lets a bad season in one district be offset by a fair one in another; shared weather is what keeps the bad tail fat — and the bad tail is what a feed mill or an exporter plans around.`}
      />

      <P>
        Over all 400 seasons, letting each district draw its own weather barely moves the average, but the whole spread shrinks: the standard deviation falls from
        64 million bushels to 46, the 1-in-20 bad crop rises from 390 to 426, and the worst season from 269 to 338. That shared weather is what makes a region’s
        harvest so much riskier than its districts’ separate risks would suggest, and why a buyer can’t make the supply safe by buying from every district at
        once. Wheat, grown in spring and spread more evenly across the districts, is steadier: 9 seasons
        in 10 between 201 and 262 million bushels.
      </P>
      <P>
        One source of uncertainty sits outside these simulations altogether. A harvest is acres times yield, and every season here plants the same{' '}
        {fmt(VALLEY_CORN_KAC / 1000, 1)} million acres of corn. Real acreage moves too. Farmers choose their split between crops each spring at the prices of the
        moment, as in <a href={lessonHref('agriculture/2.1')}>Lesson 2.1</a>, and in the United States the Department of Agriculture surveys their planting
        intentions at the end of March and what they actually planted at the end of June. A wet spring can keep the planters out until it is too late, leaving
        fields unplanted — “prevented planting,” in crop insurance’s term — as across much of the Corn Belt in 2019. Each 1% of the valley’s corn acres is about 5
        million bushels, so an acreage report is news just as a yield forecast is.
      </P>

      <P>
        That is the answer to this chapter’s question. Agricultural supply is uncertain because it is grown outdoors over months, through weather that no one can
        forecast more than a week or two ahead and that hits whole regions at once; because the crop’s response to that weather is lopsided, with deeper losses
        than gains; and because even good observation sees trouble better than bounty. The uncertainty narrows only as the season is actually lived, as{' '}
        <a href={lessonHref('agriculture/1.5')}>Lesson 1.5</a> showed for one field and <a href={lessonHref('agriculture/3.4')}>Lesson 3.4</a>’s forecaster for the
        Prairie. What happens to the grain once it is harvested — how it is graded, dried, stored and moved — is the subject of Chapter 4, and the distributions of{' '}
        <FigRef to="Harvest Monte Carlo">the Monte Carlo</FigRef> become prices in Chapter 5.
      </P>
    </LessonPage>
  );
}
