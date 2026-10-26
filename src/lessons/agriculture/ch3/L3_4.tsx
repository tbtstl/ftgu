import { useMemo } from 'react';
import {
  Challenge,
  Checkbox,
  Controls,
  Eq,
  Op,
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
  TEXT,
  fmt,
  lessonHref,
  linePath,
  scale,
  areaPath,
  useScenario,
} from '../../../framework';
import { PREDICTORS, PREDICTOR_NAME, fitForecast, forecastSets, observe, type Fit, type Predictor } from '../../../engines/agriculture/forecast';
import { dateLabel, dayOf } from '../../../model/agriculture/region';
import { CROP_LINE } from '../shared/tones';

const DATES = [dayOf(6, 15), dayOf(7, 1), dayOf(7, 15), dayOf(8, 1), dayOf(8, 15), dayOf(9, 1)];
/** An 80% band reaches this many standard deviations either side of the middle of a bell-shaped spread. */
export const Z80 = 1.2816;
const SHORT: Record<Predictor, string> = { temp: 'warmth (°C)', rain: 'extra rain (in)', ndvi: 'NDVI', condition: 'rating' };
type DateKey = '0' | '1' | '2' | '3' | '4' | '5';

const fitCache = new Map<string, Fit>();
/** The regression on these predictors for a forecast date, fitted on seasons 1–100 and tested on 101–200. */
export function fitFor(date: number, predictors: Predictor[]): Fit {
  const k = `${date}|${predictors.join(',')}`;
  let f = fitCache.get(k);
  if (!f) {
    const { train, test } = forecastSets(date);
    f = fitForecast(train, test, predictors);
    fitCache.set(k, f);
  }
  return f;
}

/** The challenge's date, and the observation every forecast in it starts from. */
export const PARTNER_DATE = dayOf(8, 15);
export const PARTNER_BASE: Predictor = 'temp';

/** The observation that, added to temperature, forecasts the unseen seasons best on August 15. */
export function bestPartner(): Predictor {
  const others = PREDICTORS.filter((p) => p !== PARTNER_BASE);
  const errs = others.map((p) => fitFor(PARTNER_DATE, [PARTNER_BASE, p]).rmseTest);
  return others[errs.indexOf(Math.min(...errs))];
}

const PARTNER_LABEL: Record<Predictor, string> = { temp: 'temperature', rain: 'rain since May 1', ndvi: 'satellite NDVI', condition: 'the condition rating' };

/** The typical error on August 15 of temperature alone (`temp`) and of temperature with each other observation. */
export function partnerErrors(): Record<Predictor, number> {
  const out = { temp: fitFor(PARTNER_DATE, [PARTNER_BASE]).rmseTest } as Record<Predictor, number>;
  for (const p of PREDICTORS) if (p !== PARTNER_BASE) out[p] = fitFor(PARTNER_DATE, [PARTNER_BASE, p]).rmseTest;
  return out;
}

/** The challenge: on August 15, temperature and the one observation that adds the most to it. */
export function pairSolved(dateIndex: number, chosen: Predictor[]): boolean {
  if (DATES[dateIndex] !== PARTNER_DATE || chosen.length !== 2 || !chosen.includes(PARTNER_BASE)) return false;
  return chosen.includes(bestPartner());
}

/** How many of the unseen seasons the forecast's 80% band (± Z80 typical errors) holds, and how many harvests fall above or below it. */
export function bandCount(date: number, predictors: Predictor[]): { n: number; inside: number; above: number; below: number } {
  const f = fitFor(date, predictors);
  const h = Z80 * f.rmseTest;
  const misses = forecastSets(date).test.map((o) => o.yield - f.predict(o));
  return { n: misses.length, inside: misses.filter((m) => Math.abs(m) <= h).length, above: misses.filter((m) => m > h).length, below: misses.filter((m) => m < -h).length };
}

/** The standard normal distribution: density and cumulative probability. */
function phi(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}
function Phi(z: number): number {
  // Abramowitz and Stegun 7.1.26, accurate to about 1e-7.
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * The continuous ranked probability score of a bell-shaped forecast (its middle and standard deviation) against what
 * happened, in the outcome's units: lower is better, and with no spread at all it is the plain miss.
 */
export function crps(mean: number, sd: number, actual: number): number {
  if (sd <= 1e-9) return Math.abs(actual - mean);
  const z = (actual - mean) / sd;
  return sd * (z * (2 * Phi(z) - 1) + 2 * phi(z) - 1 / Math.sqrt(Math.PI));
}

/** The average score over the unseen seasons when the forecast's spread is `width` times its typical error (0: a bare number). */
export function meanScore(date: number, predictors: Predictor[], width: number): number {
  const f = fitFor(date, predictors);
  const test = forecastSets(date).test;
  return test.reduce((s, o) => s + crps(f.predict(o), width * f.rmseTest, o.yield), 0) / test.length;
}

function Scatter({ fit, date }: { fit: Fit; date: number }) {
  const test = forecastSets(date).test;
  const x = scale(60, 260, 80, 600);
  const y = scale(60, 260, 260, 30);
  // The 80% band around the perfect-forecast line, clipped to the plot: |forecast − actual| ≤ h.
  const h = Math.min(199, Z80 * fit.rmseTest);
  const band: Array<[number, number]> = [
    [60, 60],
    [60, 60 + h],
    [260 - h, 260],
    [260, 260],
    [260, 260 - h],
    [60 + h, 60],
  ];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Forecast on ${dateLabel(date)} against the actual yield for 100 test seasons. Typical error ${fmt(fit.rmseTest, 1)} bushels; the 80% band reaches ${fmt(Z80 * fit.rmseTest, 1)} bushels either side of a perfect forecast.`}
    >
      <text className="ax" x={80} y={14}>
        Forecast on {dateLabel(date)}, bu/ac
      </text>
      <GridY y={y} ticks={[100, 150, 200, 250]} x0={80} x1={600} format={(v) => fmt(v)} />
      <polygon points={band.map(([a, f]) => `${x(a)},${y(f)}`).join(' ')} fill={CROP_LINE.corn} opacity={0.14} />
      <line x1={x(60)} y1={y(60)} x2={x(260)} y2={y(260)} stroke="#999" strokeDasharray="5 4" />
      {test.map((o) => (
        <circle key={o.year} cx={x(Math.max(60, Math.min(260, o.yield)))} cy={y(Math.max(60, Math.min(260, fit.predict(o))))} r={3.6} fill={CROP_LINE.corn} opacity={0.7} />
      ))}
      {[100, 150, 200, 250].map((v) => (
        <text key={v} className="ax ax-m" x={x(v)} y={280}>
          {v}
        </text>
      ))}
      <text className="ax ax-e" x={600} y={296}>
        actual yield, bu/ac
      </text>
      <text className="ax" x={x(220)} y={y(232)}>
        perfect forecast
      </text>
    </svg>
  );
}

const SEASONS = { drought: 163, middle: 150, bumper: 180 } as const;
type SeasonKey = keyof typeof SEASONS;

function Unfolding({ year, predictors }: { year: number; predictors: Predictor[] }) {
  const pts = DATES.map((d) => {
    const f = fitFor(d, predictors);
    return { d, mid: f.predict(observe(year, d)), err: f.rmseTest };
  });
  const actual = observe(year, DATES[0]).yield;
  const x = scale(dayOf(6, 10), dayOf(9, 15), 80, 600);
  const y = scale(60, 280, 230, 30);
  const xs = pts.map((p) => x(p.d));
  return (
    <svg
      className="chart"
      viewBox="0 0 640 260"
      role="img"
      aria-label={`Forecasts of simulated season ${year} from June 15 to September 1: ${pts.map((p) => `${dateLabel(p.d)} ${fmt(p.mid)}`).join(', ')}. It actually yields ${fmt(actual)} bushels.`}
    >
      <text className="ax" x={80} y={14}>
        Forecast yield, bu/ac, with the range that holds 8 seasons in 10
      </text>
      <GridY y={y} ticks={[100, 150, 200, 250]} x0={80} x1={600} format={(v) => fmt(v)} />
      <path d={areaPath(xs, pts.map((p) => y(p.mid + Z80 * p.err)), pts.map((p) => y(p.mid - Z80 * p.err)))} fill={CROP_LINE.corn} opacity={0.18} />
      <path d={linePath(xs, pts.map((p) => y(p.mid)))} fill="none" stroke={CROP_LINE.corn} strokeWidth={2.5} />
      {pts.map((p) => (
        <circle key={p.d} cx={x(p.d)} cy={y(p.mid)} r={4} fill={CROP_LINE.corn} />
      ))}
      <line x1={80} x2={600} y1={y(actual)} y2={y(actual)} stroke={GRAPHIC.red} strokeWidth={1.8} strokeDasharray="6 4" />
      <text className="ax ax-e" x={600} y={y(actual) - 6} style={{ fill: TEXT.red }}>
        actual {fmt(actual)}
      </text>
      {pts.map((p) => (
        <text key={p.d} className="ax ax-m" x={x(p.d)} y={250}>
          {dateLabel(p.d)}
        </text>
      ))}
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('model', { date: '3' as DateKey, temp: true, rain: true, ndvi: false, condition: false });
  const chosen = PREDICTORS.filter((p) => s.state[p]);
  const date = DATES[Number(s.state.date)];
  const fit = useMemo(() => fitFor(date, chosen), [date, chosen.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => fitFor(date, []), [date]);
  const solved = useMemo(() => pairSolved(Number(s.state.date), chosen), [s.state.date, chosen.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = useMemo(() => bandCount(date, chosen), [date, chosen.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const partner = useMemo(() => partnerErrors(), []);

  const u = useScenario('unfold', { season: 'drought' as SeasonKey, temp: true, rain: true, ndvi: true, condition: true });
  const uChosen = PREDICTORS.filter((p) => u.state[p]);
  const year = SEASONS[u.state.season];

  // Numbers quoted in the prose: the ordinary season on each date, and the calibration and scores of two forecasts.
  const ALL: Predictor[] = ['temp', 'rain', 'ndvi', 'condition'];
  const ordinary = DATES.map((d) => ({ d, mid: fitFor(d, ALL).predict(observe(SEASONS.middle, d)), cond: observe(SEASONS.middle, d).condition, err: fitFor(d, ALL).rmseTest }));
  const ordinaryActual = observe(SEASONS.middle, DATES[0]).yield;
  const [o15, o1] = [ordinary[4], ordinary[5]];
  const aug1 = bandCount(dayOf(8, 1), ['temp', 'rain']);
  const sep1 = bandCount(dayOf(9, 1), ALL);
  const score = (w: number) => fmt(meanScore(dayOf(8, 1), ['temp', 'rain'], w), 1);

  return (
    <LessonPage id="agriculture/3.4">
      <P>
        <a href={lessonHref('agriculture/3.3')}>The previous lesson</a> gave us a satellite’s view of the crop, and <a href={lessonHref('agriculture/3.2')}>the one
        before</a> showed how the weather’s timing shapes the damage. A <K tone="gold">yield forecast</K> puts these together: given what can be observed by a
        certain date, what is this season’s harvest likely to be? Governments publish such forecasts for their own crops and for the world’s, private firms sell
        their own, and traders build more. Most rest on the same simple idea we’ll use here: learn from past seasons how observations relate to final yields, then
        apply that to the season in progress.
      </P>
      <P>
        Our forecaster watches the Black Prairie’s corn. It can observe four things by any date: how much warmer or cooler than normal the summer has been since
        June 1; how much more or less rain has fallen since May 1; the satellite NDVI of the last 30 days, from <a href={lessonHref('agriculture/3.3')}>Lesson
        3.3</a>; and a <K>crop condition rating</K> — scouts’ judgment, from 0 to 100, of how free of stress and disease the crop has looked over the
        past three weeks, with the noise of human judgment. The U.S. Department of Agriculture’s weekly crop progress report does something similar for real
        crops, though instead of one score it gives the share of each crop rated in each of five classes, from very poor to excellent. The forecaster fits a
        straight-line regression of yield on its chosen observations across the first 100 simulated seasons, then is judged on the next 100, which it has never
        seen. In the next demonstration each dot is one of those test seasons; a perfect forecast would put every dot on the dashed line, and the shaded band
        around it, which we’ll come back to, holds the seasons the forecast missed by less than its 80% range. Choose the forecast date and the observations:
      </P>

      <Figure name="Crop Forecast Model" scenario={s}>
        <Segmented label="Forecast date" value={s.state.date} onChange={(v) => s.set({ date: v })} options={DATES.map((d, i) => ({ value: String(i) as DateKey, label: dateLabel(d) }))} />
        <Scatter fit={fit} date={date} />
        <Readouts
          items={[
            { label: 'typical error on unseen seasons', value: `${fmt(fit.rmseTest, 1)} bu`, tone: 'red' },
            { label: 'on the seasons it learned from', value: `${fmt(fit.rmseTrain, 1)} bu` },
            { label: 'guessing the average every year', value: `${fmt(base.rmseTest, 1)} bu` },
            { label: 'share of the swings explained', value: `${fmt(Math.max(0, fit.r2Test) * 100)}%` },
            { label: `inside the 80% band (${count.above} above, ${count.below} below)`, value: `${count.inside} of ${count.n}` },
          ]}
        />
        <Eq label="The fitted forecast">
          <span>yield</span>
          <Op>=</Op>
          <span>{fmt(fit.coef[0], 1)}</span>
          {chosen.map((p, i) => (
            <span key={p}>
              <Op>{fit.coef[i + 1] >= 0 ? '+' : '−'}</Op>
              <span>
                {fmt(Math.abs(fit.coef[i + 1]), Math.abs(fit.coef[i + 1]) < 10 ? 2 : 1)} × {SHORT[p]}
              </span>
            </span>
          ))}
        </Eq>
        <Controls columns={2}>
          {PREDICTORS.map((p) => (
            <Checkbox key={p} label={PREDICTOR_NAME[p]} checked={s.state[p]} onChange={(v) => s.set({ [p]: v } as Partial<typeof s.state>)} />
          ))}
        </Controls>
      </Figure>

      <P>
        With temperature and rain on August 1, the forecaster’s typical miss on the unseen seasons is 18.6 bushels, against 25.0 for simply guessing the average
        every year; it explains 44% of the swings. Each degree of extra summer warmth since June costs about 10 bushels, and each extra inch of rain adds about 2.
        Now move the date. In mid-June no combination does much better than the average — all four together miss by 24.3 — because the weather that decides the
        crop hasn’t happened yet. By August 15 all four miss by 14.0 and explain 69% of the swings; by September 1, 11.6 and 78%. The satellite alone is little use
        on August 1, when nearly every canopy reads the same full green; it starts to help in mid-August, once droughts begin to brown the fields. Notice too that the
        errors on the seasons the model learned from are no better than on the unseen ones — a little worse, in fact, 20.0 bushels against 18.6 on August 1, only
        because the first hundred seasons happened to swing more widely: guessing the average misses them by 26.5, the unseen ones by 25.0. With a handful of
        observations and 100 seasons there is little room to
        <b> overfit</b>; a model with dozens of variables could match its own past almost perfectly and still forecast worse.
      </P>

      <Challenge
        id="a"
        question={`Predict first: on August 15, temperature alone misses the unseen seasons by ${fmt(partner.temp, 1)} bushels. Which one observation would add the most to it — rain, the satellite’s NDVI or the condition rating — and why? Then choose temperature and your pick to check.`}
        solved={solved}
        status={
          DATES[Number(s.state.date)] !== PARTNER_DATE
            ? 'Set the forecast date to August 15.'
            : chosen.length !== 2 || !chosen.includes(PARTNER_BASE)
              ? 'Choose temperature and one other observation.'
              : `Temperature and ${PARTNER_LABEL[chosen.find((p) => p !== PARTNER_BASE)!]}: a typical error of ${fmt(fit.rmseTest, 1)} bushels. Is there a better partner?`
        }
        success={`Solved: temperature and the condition rating together miss by ${fmt(partner.condition, 1)} bushels, against ${fmt(partner.temp, 1)} for temperature alone, ${fmt(partner.rain, 1)} with rain and ${fmt(partner.ndvi, 1)} with NDVI — and a shade better, even, than all four together. Temperature measures how fast the season raced the crop toward maturity; the rating measures the stress the plants actually felt over the last three weeks, from dry soil or disease. By mid-August the satellite mostly repeats temperature, since the hot summers are the ones whose fields brown, and rain since May counts the water without saying when it fell. Two observations that say different things beat two that say the same.`}
      />

      <P>
        Official forecasts work on the same principle with more and better observations. In the United States, the Department of Agriculture’s first survey-based
        forecast of the corn yield comes out in August, built from farmer surveys and from crews who count plants and ears in sample fields — the yield components
        of <a href={lessonHref('agriculture/1.5')}>Lesson 1.5</a>, measured rather than modeled — and it is revised every month until the harvest is in. Private
        forecasters add their own satellite data and weather models, hoping to see the answer before the official number does. Whether that is worth anything is a
        question about markets, and we’ll test it in Chapter 5.
      </P>

      <H2>A forecast that moves</H2>
      <P>
        A forecast isn’t made once. It is remade whenever new observations arrive, and each revision is news: its size is how much the news was worth
        knowing.
      </P>
      <P>
        It has to move because the weather that decides the crop can’t be forecast far ahead. Weather models see the next few days well: a frost or a heat wave is
        usually forecast several days before it arrives — enough warning for a trader to act on, not for a farmer to change what was planted. Their skill fades
        over the following week, and by about two weeks out little is left. Monthly and seasonal outlooks lean on slow signals such as El Niño in the Pacific and
        only tilt the odds, for a Corn Belt summer not by much. So a forecaster in June must treat July and August as unknown, as if they could be any of the
        summers in its records, and each new week of observed weather replaces part of that guess with fact. In the next demonstration the forecaster follows one
        unseen season from mid-June to September, refitting on each date with the chosen observations; the shaded band holds the actual yield in 8 seasons out of 10
        at that date’s typical error, and the dashed line is what the season really produced:
      </P>

      <Figure name="Crop Forecast Model · the season unfolds" scenario={u}>
        <Segmented
          label="Season"
          value={u.state.season}
          onChange={(v) => u.set({ season: v })}
          options={[
            { value: 'drought', label: 'A poor season' },
            { value: 'middle', label: 'An ordinary one' },
            { value: 'bumper', label: 'A bumper one' },
          ]}
        />
        <Unfolding year={year} predictors={uChosen} />
        <Legend
          items={[
            { label: 'Forecast', color: CROP_LINE.corn, kind: 'line' },
            { label: 'Likely range', color: 'rgba(201, 154, 30, .35)' },
            { label: 'Actual yield', color: GRAPHIC.red, kind: 'line', dashed: true },
          ]}
        />
        <Controls columns={2}>
          {PREDICTORS.map((p) => (
            <Checkbox key={p} label={PREDICTOR_NAME[p]} checked={u.state[p]} onChange={(v) => u.set({ [p]: v } as Partial<typeof u.state>)} />
          ))}
        </Controls>
      </Figure>

      <P>
        The poor season is season 163, not the drought of season 46, which is among the seasons the forecaster learned from. The forecaster starts at 166 bushels in
        mid-June — nothing looks wrong yet but a warm, dry start — and lowers its forecast with almost every new reading: 153 on July 1, 141 on August 1, 121 by
        mid-August, as the crop condition rating falls from 95 to 42. It ends within 3 bushels of the actual 120. The ordinary season shows that new information
        can move a forecast the wrong way. The forecaster sits below the true {fmt(ordinaryActual)} all summer and closes to {fmt(o15.mid)} by mid-August; then the
        condition rating slips from {fmt(o15.cond)} to {fmt(o1.cond)}, and the September 1 forecast falls to {fmt(o1.mid)}, {fmt(ordinaryActual - o1.mid)} bushels
        short — further off than two weeks earlier, and outside that date’s band. The bumper season is the instructive one. The forecaster sees a good,
        cool season from early August and raises its forecast to 201 by September, but the crop actually yields 233. Every observation it has tops out in a great
        season: a canopy can’t get greener than full, and a rating can’t go past 100. Forecasts built this way see trouble more clearly than bounty, and a good
        harvest tends to reveal its full size only when the combines roll. That asymmetry will matter when we get to prices.
      </P>

      <H2>Judging a forecast’s band</H2>
      <P>
        Every forecast in this lesson comes with a band, and a band makes a promise: an 80% band should hold the harvest in 8 seasons out of 10. A forecaster whose
        bands hold it more often is drawing them wider than it needs to; one whose bands hold it less often is overconfident. Keeping that promise is called{' '}
        <K>calibration</K>, and no single season can test it — a harvest outside the band may be one of the two seasons in ten the band allows; it takes a count over
        many. In <FigRef to="Crop Forecast Model">the first demonstration</FigRef>, the shaded band holds the dots the forecast missed by less than 1.28
        typical errors. On August 1, with temperature and rain, it holds {aug1.inside} of the 100 unseen seasons, about what it promises. But look at where the
        other {aug1.n - aug1.inside} fall: {aug1.above} harvests came in above the band and only {aug1.below} below it. With all four observations on September 1
        the lean grows, to {sep1.above} above and {sep1.below} below. A calibrated forecast misses about as often on each side; this one misses low in the best
        seasons, the bumper season’s lesson again. (The band was sized on these same seasons, so the count tests only its shape; a fair test sizes the band first
        and counts seasons still to come.)
      </P>
      <P>
        Coverage alone can be gamed: a band from zero to 300 bushels holds every harvest and says nothing. So forecasts are scored on the middle and the width
        together. The score most often used, the <b>continuous ranked probability score</b>, extends the plain miss to a forecast with a band. For a bare number
        it is exactly the miss. For a band it charges both for how far the band sits from the harvest and for how wide it is, so a narrow band near the truth
        scores best, a narrow band far from it scores nearly its full miss, and a needlessly wide one pays a little every season for the harvests it allowed that
        never came. Lower is better. For the August 1 forecast from temperature and rain, the bare number misses the unseen seasons by {score(0)} bushels on
        average. Drawn with its 80% band at 1.28 typical errors, it scores {score(1)}; with a band twice as wide, {score(2)}, and half as wide, {score(0.5)}. The best
        band is within a few percent of the one we drew, about {fmt(Z80 * fitFor(dayOf(8, 1), ['temp', 'rain']).rmseTest)} bushels either side: some one and a
        half times the forecast’s average miss of {score(0)}, since an honest 80% band has to reach well past a typical miss to hold the harvest eight times in ten.
        The score rewards an honest statement of uncertainty, which is why weather centers judge their forecasts with it, and why we’ll use it in Chapter 6.
      </P>

      <P>
        A forecast, then, is a number and a band. The next lesson takes the band seriously: instead
        of one best guess, we’ll run the valley through hundreds of seasons and ask what the whole distribution of harvests looks like — and why its shape, not
        just its middle, is what prices are made of. <FigRef to="Crop Forecast Model">The forecaster</FigRef> narrows that distribution as the season goes on; it
        never makes it vanish.
      </P>
    </LessonPage>
  );
}
