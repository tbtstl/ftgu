import { useMemo } from 'react';
import {
  Button,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  fmt,
  lessonHref,
  linePath,
  mix,
  scale,
  TEXT,
  useScenario,
} from '../../../framework';
import { observe, type Predictor } from '../../../engines/agriculture/forecast';
import { MARKET_YEARS, checkpointForecast, normCdf, valleyCorn, valleySd } from '../../../engines/agriculture/market';
import { meanValley } from '../../../engines/agriculture/world';
import { NEW_SEASONS } from '../../../engines/agriculture/capstone';
import { dayOf } from '../../../model/agriculture/region';
import { MARKET_LINE } from '../shared/tones';

const AUG1 = dayOf(8, 1);
const Z80 = 1.2816;
/** The five new seasons of the challenge: a wet one, a hot and dry one, a dry one, a cool and wet one, and an ordinary one. */
export const CHALLENGE_SEASONS = [61, 65, 72, 96, 89];

/** The continuous ranked probability score of a normal forecast against what happened: lower is better, in the forecast's own units. */
export function crps(mean: number, sd: number, x: number): number {
  if (sd <= 1e-9) return Math.abs(x - mean);
  const z = (x - mean) / sd;
  const pdf = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  return sd * (z * (2 * normCdf(z) - 1) + 2 * pdf - 1 / Math.sqrt(Math.PI));
}

export interface Entry {
  mean: number;
  half: number;
  locked: boolean;
}

export function climatologyScore(year: number): number {
  return crps(meanValley(), valleySd(), valleyCorn(year));
}

export function modelScore(year: number): number {
  const f = checkpointForecast(year, AUG1, 'full');
  return crps(f.mean, f.sd, valleyCorn(year));
}

export function entryScore(year: number, e: Entry): number {
  return crps(e.mean, e.half / Z80, valleyCorn(year));
}

/**
 * How much better than the long-run average a forecaster must score to show it used the evidence:
 * a quarter lower. The best forecast that ignores the evidence — the same center and band every
 * season — scores only about 3% lower on these five seasons.
 */
export const BEAT_BY = 0.25;

/** Challenge 1: every season forecast and revealed, with an average score at least a quarter lower than the long-run average's. */
export function beatClimatology(entries: Record<string, Entry>): boolean {
  const done = CHALLENGE_SEASONS.every((y) => entries[y]?.locked);
  if (!done) return false;
  const mine = CHALLENGE_SEASONS.reduce((a, y) => a + entryScore(y, entries[y]), 0);
  const clim = CHALLENGE_SEASONS.reduce((a, y) => a + climatologyScore(y), 0);
  return mine <= (1 - BEAT_BY) * clim;
}

/** The regression and the long-run average over all forty new seasons: the average miss of the regression's center, how often its 80% band held the harvest, and both scores. */
export function fortySeasons(): { miss: number; inside: number; model: number; clim: number } {
  const n = NEW_SEASONS.length;
  return {
    miss: NEW_SEASONS.reduce((a, y) => a + Math.abs(checkpointForecast(y, AUG1, 'full').mean - valleyCorn(y)), 0) / n,
    inside: NEW_SEASONS.filter((y) => {
      const f = checkpointForecast(y, AUG1, 'full');
      return Math.abs(valleyCorn(y) - f.mean) <= Z80 * f.sd;
    }).length,
    model: NEW_SEASONS.reduce((a, y) => a + modelScore(y), 0) / n,
    clim: NEW_SEASONS.reduce((a, y) => a + climatologyScore(y), 0) / n,
  };
}

/** For a forecast that misses by `miss`, the band half-width (in steps of 5) that scores best. */
export function bestHalfWidth(miss: number): number {
  let best = 5;
  for (let h = 5; h <= 150; h += 5) if (crps(0, h / Z80, miss) < crps(0, best / Z80, miss) - 1e-12) best = h;
  return best;
}

/** Challenge 2's miss: twice the 40 million bushels the reader checks first, so the answer has to be scaled, not read. */
export const CHALLENGE_MISS = 80;

/**
 * Challenge 2: a band committed for a miss solves when it reaches between 1.25 and 1.75 times the miss — the
 * flat bottom of the curve, where every band scores within about 2% of the best (the best is about 1.54 times).
 */
export function bandGuessSolved(miss: number, half: number | undefined): boolean {
  if (half === undefined || miss <= 0) return false;
  const k = half / miss;
  return k >= 1.25 - 1e-9 && k <= 1.75 + 1e-9;
}

const PRED_LABEL: Record<Predictor, string> = {
  temp: 'Temperature since June 1, °C from normal',
  rain: 'Rain since May 1, inches from normal',
  ndvi: 'Satellite NDVI, last 30 days',
  condition: 'Crop condition, 0–100',
};
const PREDS: Predictor[] = ['rain', 'temp', 'condition', 'ndvi'];

function HistoryScatter({ pred, value, mean, half }: { pred: Predictor; value: number; mean: number; half: number }) {
  const pts = useMemo(() => Array.from({ length: MARKET_YEARS }, (_, i) => ({ v: observe(i + 1, AUG1)[pred], h: valleyCorn(i + 1) })), [pred]);
  const vs = pts.map((p) => p.v).concat(value);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const pad = (hi - lo) * 0.08 || 1;
  const x = scale(lo - pad, hi + pad, 70, 620);
  const y = scale(250, 700, 230, 24);
  return (
    <svg className="chart" viewBox="0 0 640 262" role="img" aria-label={`Sixty past seasons: ${PRED_LABEL[pred]} on August 1 against the valley’s harvest. This season’s value is ${fmt(value, 2)}.`}>
      <text className="ax" x={70} y={14}>
        Valley corn harvest, million bushels
      </text>
      <GridY y={y} ticks={[300, 400, 500, 600, 700]} x0={70} x1={620} format={(v) => fmt(v)} />
      <rect x={70} y={y(mean + half)} width={550} height={Math.max(1, y(mean - half) - y(mean + half))} fill={mix('#fcfcfb', GRAPHIC.teal, 0.25)} />
      <line x1={70} x2={620} y1={y(mean)} y2={y(mean)} stroke={GRAPHIC.teal} strokeWidth={1.5} />
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.v)} cy={y(p.h)} r={3.2} fill={mix('#fcfcfb', MARKET_LINE.cash, 0.85)} />
      ))}
      <line x1={x(value)} x2={x(value)} y1={24} y2={230} stroke="#333" strokeWidth={2} strokeDasharray="5 3" />
      <text className="ax" x={x(value) + 5} y={34} style={{ fill: '#333' }}>
        this season
      </text>
      <text className="ax ax-m" x={345} y={252}>
        {PRED_LABEL[pred]}
      </text>
    </svg>
  );
}

function ScoreCurve({ miss, half, guess }: { miss: number; half: number; guess?: number }) {
  const hs = Array.from({ length: 59 }, (_, i) => 5 + i * 2.5);
  const scores = hs.map((h) => crps(0, h / Z80, miss));
  const top = Math.max(...scores, Math.abs(miss)) * 1.05;
  const x = scale(0, 150, 70, 620);
  const y = scale(0, top, 200, 24);
  const best = hs[scores.indexOf(Math.min(...scores))];
  const shown = guess !== undefined;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 232"
      role="img"
      aria-label={
        shown
          ? `The score of a forecast that misses by ${fmt(miss)} million bushels, for bands of every width: best at about ${fmt(best)} either side. You checked ±${fmt(guess)}.`
          : `A forecast that misses by ${fmt(miss)} million bushels: with no band it scores ${fmt(miss)}. Check a band to see the score for every width.`
      }
    >
      <text className="ax" x={70} y={14}>
        Score (lower is better), million bushels
      </text>
      <GridY y={y} ticks={[0, Math.round(top / 3), Math.round((2 * top) / 3)]} x0={70} x1={620} format={(v) => fmt(v)} />
      {shown && <path d={linePath(hs.map(x), scores.map(y))} fill="none" stroke={GRAPHIC.teal} strokeWidth={2.5} />}
      <line x1={70} x2={620} y1={y(Math.abs(miss))} y2={y(Math.abs(miss))} stroke="#999" strokeDasharray="4 4" />
      <text className="ax ax-e" x={618} y={y(Math.abs(miss)) - 4}>
        a single number, no band
      </text>
      {shown ? (
        <>
          <circle cx={x(guess)} cy={y(crps(0, guess / Z80, miss))} r={8} fill="none" stroke="#333" strokeWidth={1.5} />
          <text className="ax ax-m" x={x(guess)} y={y(crps(0, guess / Z80, miss)) + 22}>
            checked
          </text>
          <circle cx={x(half)} cy={y(crps(0, half / Z80, miss))} r={5.5} fill={GRAPHIC.teal} stroke="#fcfcfb" strokeWidth={1.5} />
        </>
      ) : (
        <>
          <line x1={x(half)} x2={x(half)} y1={24} y2={200} stroke={GRAPHIC.teal} strokeWidth={2} strokeDasharray="5 3" />
          <text className="ax" x={x(half) + 6} y={60} style={{ fill: TEXT.teal }}>
            your band, ±{fmt(half)}: check it to see the scores
          </text>
        </>
      )}
      {[0, 25, 50, 75, 100, 125, 150].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={216}>
          ±{v}
        </text>
      ))}
      <text className="ax ax-e" x={620} y={230}>
        width of the 80% band, million bushels
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('predict', { season: 0, pred: 'rain' as Predictor, entries: {} as Record<string, Entry> });
  const year = CHALLENGE_SEASONS[s.state.season];
  const entry: Entry = s.state.entries[year] ?? { mean: 506, half: 80, locked: false };
  const obs = observe(year, AUG1);
  const setEntry = (patch: Partial<Entry>) => s.set({ entries: { ...s.state.entries, [year]: { ...entry, ...patch } } });
  const done = CHALLENGE_SEASONS.filter((y) => s.state.entries[y]?.locked);
  const myAvg = done.length ? done.reduce((a, y) => a + entryScore(y, s.state.entries[y]), 0) / done.length : NaN;
  const climAvg = done.length ? done.reduce((a, y) => a + climatologyScore(y), 0) / done.length : NaN;
  const modelAvg = done.length ? done.reduce((a, y) => a + modelScore(y), 0) / done.length : NaN;
  const solved1 = beatClimatology(s.state.entries);
  const model = checkpointForecast(year, AUG1, 'full');
  const forty = useMemo(() => fortySeasons(), []);
  const fiveMiss = Math.max(...CHALLENGE_SEASONS.map((y) => Math.abs(checkpointForecast(y, AUG1, 'full').mean - valleyCorn(y))));

  const k = useScenario('score', { miss: 40, half: 25, checked: {} as Record<string, number> });
  const guess = k.state.checked[k.state.miss];
  const challengeGuess = k.state.checked[CHALLENGE_MISS];
  const solved2 = bandGuessSolved(CHALLENGE_MISS, challengeGuess);
  const bestFor = (m: number) => bestHalfWidth(m);

  return (
    <LessonPage id="agriculture/6.3">
      <P>
        In <a href={lessonHref('agriculture/5.4')}>Lesson 5.4</a> a forecast of the valley’s harvest was worth money only when it was earlier or better than the
        market’s. Now you are the forecaster. On August 1 of five new seasons you see what Chapter 3’s forecaster saw — the temperature since June, the rain since
        May, the satellites’ NDVI and the crop’s condition — and you forecast the valley’s corn harvest: a most likely number, and an 80% band around it.
      </P>
      <P>
        The forecasts are scored as in <a href={lessonHref('agriculture/3.4')}>Lesson 3.4</a>, with the continuous ranked probability score, here in million
        bushels: for a bare number it is the miss itself, and a band earns credit when it covers the miss and pays when it is wider than needed. Lower is better.
        Your benchmarks are the long-run average — {fmt(meanValley())} million bushels, give or take {fmt(valleySd())}, the forecast of someone who looks at
        nothing — and the regression of Lesson 3.4.
      </P>
      <P>
        In the next demonstration the dots are the sixty past seasons of Chapter 5, plotted by one of the August 1 observations against the harvest that followed;
        the dashed line is where this season stands, and the shaded band is your forecast. Choose what to plot, set your forecast, and lock it in to see the
        harvest. Once locked, a forecast can’t be changed:
      </P>

      <Figure name="Yield Prediction Challenge" scenario={s}>
        <HistoryScatter pred={s.state.pred} value={obs[s.state.pred]} mean={entry.mean} half={entry.half} />
        <Readouts
          items={[
            { label: `season ${year}, August 1`, value: `rain ${obs.rain >= 0 ? '+' : '−'}${fmt(Math.abs(obs.rain), 1)} in, temperature ${obs.temp >= 0 ? '+' : '−'}${fmt(Math.abs(obs.temp), 1)} °C`, tone: 'blue' },
            { label: 'crop condition, NDVI', value: `${fmt(obs.condition)} / 100, ${fmt(obs.ndvi, 2)}`, tone: 'green' },
            { label: 'your forecast', value: `${fmt(entry.mean)} ± ${fmt(entry.half)} million bu`, tone: 'teal' },
            {
              label: entry.locked ? 'harvest, and scores (you / average / model)' : 'harvest',
              value: entry.locked ? `${fmt(valleyCorn(year))}: ${fmt(entryScore(year, entry), 1)} / ${fmt(climatologyScore(year), 1)} / ${fmt(modelScore(year), 1)}` : 'locked away',
              tone: 'gold',
            },
          ]}
        />
        <Segmented label="Season" value={String(s.state.season)} onChange={(v) => s.set({ season: Number(v) })} options={CHALLENGE_SEASONS.map((y, i) => ({ value: String(i), label: `${y}${s.state.entries[y]?.locked ? ' ✓' : ''}` }))} />
        <Segmented label="Plot" value={s.state.pred} onChange={(v) => s.set({ pred: v })} options={PREDS.map((p) => ({ value: p, label: p === 'ndvi' ? 'NDVI' : p === 'condition' ? 'Condition' : p === 'rain' ? 'Rain' : 'Temperature' }))} />
        <Slider label="Most likely harvest" tone="teal" value={entry.mean} min={250} max={700} step={5} onChange={(v) => !entry.locked && setEntry({ mean: v })} display={`${fmt(entry.mean)} million bu`} disabled={entry.locked} />
        <Slider label="80% band, either side" tone="teal" value={entry.half} min={5} max={150} step={5} onChange={(v) => !entry.locked && setEntry({ half: v })} display={`± ${fmt(entry.half)}`} disabled={entry.locked} />
        <Button onClick={() => setEntry({ locked: true })} disabled={entry.locked} primary>
          {entry.locked ? 'Locked' : 'Lock in and see the harvest'}
        </Button>
      </Figure>

      <P>
        The past seasons are the evidence. Temperature is the clearest signal: the hotter the summer has been, the shorter the crop, and cool summers grow big
        ones. Rain leans the same way — of the fourteen past seasons more than four inches short of rain by August 1, thirteen came in under the average — and a
        poor crop condition rating is a warning. NDVI, on August 1, says the least: by then nearly every canopy in the valley is green, and the satellites’ signal
        comes later, as the leaves start to fail. The regression
        does what a careful forecaster does with this evidence, weighting each observation by how much it has mattered before; on these five seasons it beats the
        long-run average by a wide margin, missing none by more than {fmt(Math.ceil(fiveMiss))} million bushels. That is luckier than usual: over all forty new
        seasons it misses by {fmt(forty.miss)} million bushels on average and scores {fmt(forty.model, 1)}, against the long-run average’s{' '}
        {fmt(forty.clim, 1)}. Can you beat the average by a quarter on these five?
      </P>
      <P>
        Reason the way the regression does. Season 65 reached August 1 hotter than any of the sixty past seasons, 2.7 °C over normal since June, and 7 inches
        short of rain, with the crop rated 74 out of 100. Only four past seasons ran even 1.5 °C hot by August, and all four came in short, the best of them at
        415 million bushels. Every signal points the same way, so the center belongs well under the average — and the band can be narrower than usual, because the
        evidence agrees. A season whose signals disagree, hot but wet, deserves a wider band. The center of a forecast comes from the evidence; its width comes
        from how much the evidence has missed before.
      </P>

      <Challenge
        id="a"
        question="Forecast all five seasons and lock each one in. Is your average score at least a quarter lower than the long-run average’s?"
        solved={solved1}
        status={
          done.length < CHALLENGE_SEASONS.length
            ? `${done.length} of ${CHALLENGE_SEASONS.length} seasons locked in.${done.length ? ` Your average so far: ${fmt(myAvg, 1)}, against ${fmt(climAvg, 1)} for the long-run average.` : ''}`
            : `Your average score is ${fmt(myAvg, 1)}, against ${fmt(climAvg, 1)} for the long-run average; a quarter lower would be ${fmt((1 - BEAT_BY) * climAvg, 1)}. Reset and try again.`
        }
        success={`Solved: your forecasts scored ${fmt(myAvg, 1)} on average, against ${fmt(climAvg, 1)} for the long-run average and ${fmt(modelAvg, 1)} for the regression. You have turned August weather into information about the harvest — which is what a market pays for, as long as it is early or better than everyone else’s.`}
      />

      <H2>What the score rewards</H2>
      <P>
        Why not just state a very wide band and be safe? Because the score charges for width. In the next demonstration one forecast is taken apart: it misses the
        harvest by a set amount, and with no band at all it scores the full miss, the dashed line. A band that covers the miss scores better; a band much wider
        than the miss scores worse again. Start with a miss of 40 million bushels: set the band you expect to score best, check it, and the curve appears with
        the score for every width. Then move the band along it:
      </P>

      <Figure name="Yield Prediction Challenge · the score" scenario={k}>
        <ScoreCurve miss={k.state.miss} half={k.state.half} guess={guess} />
        <Legend
          items={[
            { label: 'Score for each band width', color: GRAPHIC.teal, kind: 'line' },
            { label: 'Score with no band', color: '#999', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'score of this band', value: guess === undefined ? 'check to see' : fmt(crps(0, k.state.half / Z80, k.state.miss), 1), tone: 'teal' },
            { label: 'the band you checked', value: guess === undefined ? 'none yet' : `± ${fmt(guess)}, scoring ${fmt(crps(0, guess / Z80, k.state.miss), 1)}`, tone: 'ink' },
          ]}
        />
        <Slider label="How far the forecast missed" value={k.state.miss} min={0} max={120} step={5} onChange={(v) => k.set({ miss: v })} display={`${fmt(k.state.miss)} million bu`} />
        <Slider label="80% band, either side" tone="teal" value={k.state.half} min={5} max={150} step={5} onChange={(v) => k.set({ half: v })} display={`± ${fmt(k.state.half)}`} />
        <Button onClick={() => k.set({ checked: { ...k.state.checked, [k.state.miss]: k.state.half } })} disabled={guess !== undefined || k.state.miss === 0} primary>
          {guess !== undefined ? `Checked for a miss of ${fmt(k.state.miss)}` : 'Check this band'}
        </Button>
      </Figure>

      <P>
        Over many seasons, as <a href={lessonHref('agriculture/3.4')}>Lesson 3.4</a> found, the way to score best is to state the band you actually believe. A
        forecaster who makes the band narrower to look confident loses when the misses come, and one who widens it to stay safe loses every season. That is what
        makes the score fit for judging the regression of Lesson 3.4, whose August 1 band of ±{fmt(Z80 * model.sd)} million bushels came from its errors on a
        hundred seasons it never saw. On the forty new seasons that band held the harvest {forty.inside} times, about as often as it claims — calibrated, as{' '}
        <a href={lessonHref('agriculture/6.2')}>the last lesson</a> found the farm’s own bands to be. Weather centers judge their ensemble forecasts with this
        same score, season after season.
      </P>

      <Challenge
        id="b"
        question={`A forecast misses by ${CHALLENGE_MISS} million bushels. Predict, from what the 40-million-bushel miss showed, the band that scores best, to the nearest 10 million bushels either side; then set the miss to ${CHALLENGE_MISS}, set your band and check it.`}
        solved={solved2}
        status={
          challengeGuess === undefined
            ? `Set the miss to ${CHALLENGE_MISS} million bushels and your band, then press “Check this band”.`
            : `Your band of ± ${fmt(challengeGuess)} scores ${fmt(crps(0, challengeGuess / Z80, CHALLENGE_MISS), 1)}; the best, about ± ${fmt(bestFor(CHALLENGE_MISS))}, scores ${fmt(crps(0, bestFor(CHALLENGE_MISS) / Z80, CHALLENGE_MISS), 1)}. Reset the demonstration to predict again.`
        }
        success={`Solved: for an ${CHALLENGE_MISS}-million-bushel miss your band of ± ${fmt(challengeGuess ?? 0)} scores ${fmt(crps(0, (challengeGuess ?? 0) / Z80, CHALLENGE_MISS), 1)}, within a whisker of the best, about ± ${fmt(bestFor(CHALLENGE_MISS))} — and far better than the bare miss of ${CHALLENGE_MISS}. The score has no favorite size: double the miss and the best band doubles too, so whatever the miss, the best 80% band reaches about one and a half times as far on either side. A forecaster whose bands are honest has the same proportion, an 80% band about one and a half times its average miss.`}
      />

      <P>
        One more difference matters for a business. You forecast the valley’s harvest here, not your farm’s. The valley’s is what moves the basis and, through
        the American crop, the futures price; your farm’s is what you will have to sell. They move together, but not perfectly — a summer storm can soak one
        district and miss the next — so a farm that hedges on the valley’s forecast carries the difference between them.{' '}
        <FigRef to="Yield Prediction Challenge">The challenge</FigRef> is the forecaster’s side of the business. The merchant’s side is physical: bushels in bins,
        trucks at the scale, trains and barges to book. The next lesson runs the elevator.
      </P>
    </LessonPage>
  );
}
