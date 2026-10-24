import { useMemo } from 'react';
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
  fmt,
  lessonHref,
  linePath,
  mix,
  scale,
  useScenario,
} from '../../../framework';
import { observe, type Predictor } from '../../../engines/agriculture/forecast';
import { MARKET_YEARS, checkpointForecast, normCdf, valleyCorn, valleySd } from '../../../engines/agriculture/market';
import { meanValley } from '../../../engines/agriculture/world';
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

/** Challenge 1: every season forecast and revealed, with an average score better than the long-run average's. */
export function beatClimatology(entries: Record<string, Entry>): boolean {
  const done = CHALLENGE_SEASONS.every((y) => entries[y]?.locked);
  if (!done) return false;
  const mine = CHALLENGE_SEASONS.reduce((a, y) => a + entryScore(y, entries[y]), 0);
  const clim = CHALLENGE_SEASONS.reduce((a, y) => a + climatologyScore(y), 0);
  return mine < clim;
}

/** Challenge 2: for a forecast that misses by `miss`, the band half-width (in steps of 5) that scores best. */
export function bestHalfWidth(miss: number): number {
  let best = 5;
  for (let h = 5; h <= 150; h += 5) if (crps(0, h / Z80, miss) < crps(0, best / Z80, miss) - 1e-12) best = h;
  return best;
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

function ScoreCurve({ miss, half }: { miss: number; half: number }) {
  const hs = Array.from({ length: 59 }, (_, i) => 5 + i * 2.5);
  const scores = hs.map((h) => crps(0, h / Z80, miss));
  const top = Math.max(...scores, Math.abs(miss)) * 1.05;
  const x = scale(0, 150, 70, 620);
  const y = scale(0, top, 200, 24);
  const best = hs[scores.indexOf(Math.min(...scores))];
  return (
    <svg className="chart" viewBox="0 0 640 232" role="img" aria-label={`The score of a forecast that misses by ${fmt(miss)} million bushels, for bands of every width: best at about ${fmt(best)} either side.`}>
      <text className="ax" x={70} y={14}>
        Score (lower is better), million bushels
      </text>
      <GridY y={y} ticks={[0, Math.round(top / 3), Math.round((2 * top) / 3)]} x0={70} x1={620} format={(v) => fmt(v)} />
      <path d={linePath(hs.map(x), scores.map(y))} fill="none" stroke={GRAPHIC.teal} strokeWidth={2.5} />
      <line x1={70} x2={620} y1={y(Math.abs(miss))} y2={y(Math.abs(miss))} stroke="#999" strokeDasharray="4 4" />
      <text className="ax ax-e" x={618} y={y(Math.abs(miss)) - 4}>
        a single number, no band
      </text>
      <circle cx={x(half)} cy={y(crps(0, half / Z80, miss))} r={5.5} fill={GRAPHIC.teal} stroke="#fcfcfb" strokeWidth={1.5} />
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

  const k = useScenario('score', { miss: 40, half: 25 });
  const target = bestHalfWidth(k.state.miss);
  const solved2 = k.state.miss === 40 && k.state.half === bestHalfWidth(40);

  return (
    <LessonPage id="agriculture/6.3">
      <P>
        In <a href={lessonHref('agriculture/5.4')}>Lesson 5.4</a> a forecast of the valley’s harvest was worth money only when it was earlier or better than the
        market’s. Now you are the forecaster. On August 1 of five new seasons you see what Chapter 3’s forecaster saw — the temperature since June, the rain since
        May, the satellites’ NDVI and the crop’s condition — and you forecast the valley’s corn harvest: a most likely number, and an 80% band around it.
      </P>
      <P>
        A forecast like that needs a fair score, one that can’t be gamed. Grading only the center would reward a forecaster who never states a band; grading only
        whether the truth fell inside the band would reward bands as wide as the valley. The score here is the <K tone="teal">continuous ranked probability
        score</K>, which weather and crop forecasters use for exactly this: it measures, in million bushels, how far the whole forecast distribution sat from what
        happened. Lower is better. For a forecast with no band it is simply the size of the miss; a band earns credit when it honestly covers the miss, and costs
        when it is wider than needed. Your benchmarks are the long-run average — 506 million bushels, give or take 64, the forecast of someone who looks at
        nothing — and the regression of <a href={lessonHref('agriculture/3.4')}>Lesson 3.4</a>.
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
        long-run average by a wide margin. Can you?
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
        question="Forecast all five seasons and lock each one in. Is your average score better than the long-run average’s?"
        solved={solved1}
        status={
          done.length < CHALLENGE_SEASONS.length
            ? `${done.length} of ${CHALLENGE_SEASONS.length} seasons locked in.${done.length ? ` Your average so far: ${fmt(myAvg, 1)}, against ${fmt(climAvg, 1)} for the long-run average.` : ''}`
            : `Your average score is ${fmt(myAvg, 1)}, against ${fmt(climAvg, 1)} for the long-run average. Reset and try again.`
        }
        success={`Solved: your forecasts scored ${fmt(myAvg, 1)} on average, against ${fmt(climAvg, 1)} for the long-run average and ${fmt(modelAvg, 1)} for the regression. You have turned August weather into information about the harvest — which is what a market pays for, as long as it is early or better than everyone else’s.`}
      />

      <H2>What the score rewards</H2>
      <P>
        Why not just state a very wide band and be safe? Because the score charges for width. In the next demonstration one forecast is taken apart: it misses the
        harvest by a set amount, and the curve shows its score for every width of band. With no band at all the score is the full miss. A band that roughly
        matches the size of the miss scores best; a band much wider scores worse again. Set the miss and the band:
      </P>

      <Figure name="Yield Prediction Challenge · the score" scenario={k}>
        <ScoreCurve miss={k.state.miss} half={k.state.half} />
        <Legend
          items={[
            { label: 'Score for each band width', color: GRAPHIC.teal, kind: 'line' },
            { label: 'Score with no band', color: '#999', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: 'miss', value: `${fmt(k.state.miss)} million bu` },
            { label: 'band', value: `± ${fmt(k.state.half)}`, tone: 'teal' },
            { label: 'score', value: fmt(crps(0, k.state.half / Z80, k.state.miss), 1), tone: 'teal' },
          ]}
        />
        <Slider label="How far the forecast missed" value={k.state.miss} min={0} max={120} step={5} onChange={(v) => k.set({ miss: v })} display={`${fmt(k.state.miss)} million bu`} />
        <Slider label="80% band, either side" tone="teal" value={k.state.half} min={5} max={150} step={5} onChange={(v) => k.set({ half: v })} display={`± ${fmt(k.state.half)}`} />
      </Figure>

      <P>
        The score is <i>proper</i>: over many seasons, the way to score best is to state the band you actually believe. A forecaster who makes the band narrower to
        look confident loses when the misses come, and one who widens it to stay safe loses every season. That is what makes the score fit for judging the regression
        of Lesson 3.4, whose August 1 band of ±{fmt(Z80 * model.sd)} million bushels came from its errors on a hundred seasons it never saw.
      </P>
      <P>
        Forecasters call the two halves of the job <i>calibration</i> — bands that hold the truth as often as they claim, as in{' '}
        <a href={lessonHref('agriculture/6.2')}>the last lesson</a> — and <i>sharpness</i>, bands as narrow as the evidence allows. A proper score rewards
        sharpness only as far as calibration permits. Weather centers judge their ensemble forecasts with this same score, season after season, and the
        forecasters who trade on crops are judged, in the end, by their profit and loss, which is a proper score too.
      </P>

      <Challenge
        id="b"
        question="Set the miss to 40 million bushels. What band width, to the nearest 5 million bushels either side, gives the best score?"
        solved={solved2}
        status={k.state.miss !== 40 ? 'Set the miss to 40 million bushels.' : `A band of ± ${fmt(k.state.half)} scores ${fmt(crps(0, k.state.half / Z80, 40), 1)}.`}
        success={`Solved: for a 40-million-bushel miss the best band is about ± ${fmt(target)} million bushels, scoring ${fmt(crps(0, target / Z80, 40), 1)} — better than the bare miss of 40, and better than any wider or narrower band. A forecaster whose bands are about as wide as their real misses is doing it right.`}
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
