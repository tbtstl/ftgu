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

const PAIRS: Predictor[][] = [];
for (let i = 0; i < PREDICTORS.length; i++) for (let j = i + 1; j < PREDICTORS.length; j++) PAIRS.push([PREDICTORS[i], PREDICTORS[j]]);

/** The challenge: on August 15, the pair of predictors with the smallest error on the test seasons. */
export function pairSolved(dateIndex: number, chosen: Predictor[]): boolean {
  if (DATES[dateIndex] !== dayOf(8, 15) || chosen.length !== 2) return false;
  const errs = PAIRS.map((p) => fitFor(dayOf(8, 15), p).rmseTest);
  const best = PAIRS[errs.indexOf(Math.min(...errs))];
  return best.every((p) => chosen.includes(p));
}

function Scatter({ fit, date }: { fit: Fit; date: number }) {
  const test = forecastSets(date).test;
  const x = scale(60, 260, 80, 600);
  const y = scale(60, 260, 260, 30);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Forecast on ${dateLabel(date)} against the actual yield for 100 test seasons. Typical error ${fmt(fit.rmseTest, 1)} bushels.`}
    >
      <text className="ax" x={80} y={14}>
        Forecast on {dateLabel(date)}, bu/ac
      </text>
      <GridY y={y} ticks={[100, 150, 200, 250]} x0={80} x1={600} format={(v) => fmt(v)} />
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
      <path d={areaPath(xs, pts.map((p) => y(p.mid + 1.28 * p.err)), pts.map((p) => y(p.mid - 1.28 * p.err)))} fill={CROP_LINE.corn} opacity={0.18} />
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

  const u = useScenario('unfold', { season: 'drought' as SeasonKey, temp: true, rain: true, ndvi: true, condition: true });
  const uChosen = PREDICTORS.filter((p) => u.state[p]);
  const year = SEASONS[u.state.season];

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
        3.3</a>; and a <K tone="teal">crop condition rating</K> — scouts’ judgment, from 0 to 100, of how free of stress and disease the crop has looked over the
        past three weeks, with the noise of human judgment. Real crop reports publish ratings much like it every week. The forecaster fits a straight-line
        regression of yield on its chosen observations across the first 100 simulated seasons, then is judged on the next 100, which it has never seen. In the next
        demonstration each dot is one of those test seasons; a perfect forecast would put every dot on the dashed line. Choose the forecast date and the
        observations:
      </P>

      <Figure name="Crop Forecast Model" scenario={s}>
        <Segmented label="Forecast date" value={s.state.date} onChange={(v) => s.set({ date: v })} options={DATES.map((d, i) => ({ value: String(i) as DateKey, label: dateLabel(d) }))} />
        <Scatter fit={fit} date={date} />
        <Readouts
          items={[
            { label: 'typical error on unseen seasons', value: `${fmt(fit.rmseTest, 1)} bu`, tone: 'red' },
            { label: 'on the seasons it learned from', value: `${fmt(fit.rmseTrain, 1)} bu` },
            { label: 'guessing the average every year', value: `${fmt(base.rmseTest, 1)} bu` },
            { label: 'share of the swings explained', value: `${fmt(Math.max(0, fit.r2Test) * 100)}%`, tone: 'teal' },
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
        errors on the seasons the model learned from are no better than on the unseen ones. With a handful of observations and 100 seasons there is little room to
        <b> overfit</b>; a model with dozens of variables could match its own past almost perfectly and still forecast worse.
      </P>

      <Challenge
        id="a"
        question="On August 15, a forecaster can afford only two of the four observations. Which pair forecasts the unseen seasons best?"
        solved={solved}
        status={
          DATES[Number(s.state.date)] !== dayOf(8, 15)
            ? 'Set the forecast date to August 15.'
            : chosen.length !== 2
              ? `Choose exactly two observations; ${chosen.length} are chosen.`
              : `${chosen.map((p) => PREDICTOR_NAME[p].toLowerCase()).join(' and ')}: a typical error of ${fmt(fit.rmseTest, 1)} bushels.`
        }
        success={`Solved: ${chosen.map((p) => PREDICTOR_NAME[p].toLowerCase()).join(' and ')} together miss by ${fmt(fit.rmseTest, 1)} bushels in a typical unseen season. They complement each other: temperature measures how fast the season raced the crop through grain fill, and the condition rating measures the stress the plants actually felt. Two observations that say different things beat two that say the same.`}
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
        A forecast isn’t made once. It is remade every time new observations arrive, and the interesting thing — for the farmer, and for the market — is how it
        moves. Each revision is news, and the size of the revision is how much the news was worth knowing. In the next demonstration the forecaster follows one unseen season from mid-June to September, refitting on each date with the chosen observations;
        the shaded band holds the actual yield in 8 seasons out of 10 at that date’s typical error, and the dashed line is what the season really produced:
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
        In the poor season the forecaster starts at 166 bushels in mid-June — nothing looks wrong yet but a warm, dry start — and lowers its forecast with almost
        every new reading: 153 on July 1, 141 on August 1, 121 by mid-August, as the crop condition rating falls from 95 to 42. It ends within 3 bushels of the
        actual 120. The ordinary season wanders around its true 185 without straying far. The bumper season is the instructive one. The forecaster sees a good,
        cool season from early August and raises its forecast to 201 by September, but the crop actually yields 233. Every observation it has tops out in a great
        season: a canopy can’t get greener than full, and a rating can’t go past 100. Forecasts built this way see trouble more clearly than bounty, and a good
        harvest tends to reveal its full size only when the combines roll. That asymmetry will matter when we get to prices.
      </P>

      <P>
        Every forecast in this lesson is a single number with an error attached, and the error is as much a part of the forecast as the number. The next lesson takes the error seriously: instead of one best guess, we’ll run the
        valley through hundreds of seasons and ask what the whole distribution of harvests looks like — and why its shape, not just its middle, is what prices are
        made of. <FigRef to="Crop Forecast Model">The forecaster</FigRef> narrows that distribution as the season goes on; it never makes it vanish.
      </P>
    </LessonPage>
  );
}
