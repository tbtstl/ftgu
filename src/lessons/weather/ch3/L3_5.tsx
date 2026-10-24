import { useDeferredValue, useMemo } from 'react';
import {
  Challenge,
  Checkbox,
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
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  tint,
  useScenario,
} from '../../../framework';
import {
  RAW_SPREAD,
  WINTERS,
  WINTER_DAYS,
  calibrationStats,
  crpsCurve,
  plume,
  winterDay,
  type CalibrationSettings,
  type CalibrationStats,
  type Plume,
} from '../../../engines/weather/calibration';
import { LEAD_MAX, dayInfo, knownShare, tempF } from '../../../model/weather/archive';
import { MONTH_NAMES } from '../../../model/weather/region';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: one ensemble forecast from the archive.

export type EventKind = 'freeze' | 'hard';
/** The events: a daily mean below freezing, or below 20 °F (a hard freeze). */
export const EVENT_THRESHOLD: Record<EventKind, number> = { freeze: 32, hard: 20 };
const EVENT_LABEL: Record<EventKind, string> = { freeze: 'below freezing', hard: 'a hard freeze' };

/** The starting forecast: issued December 11 of winter 6, the eve of a cold outbreak. */
export const PLUME_DEFAULTS = { winter: 6, offset: 10, members: 30, lead: 6, event: 'hard' as EventKind, show: true };
/** Days of observations drawn before the issue date. */
const PAST_DAYS = 4;

/** A forecast's spread as a share of the climate's own day-to-day spread, `lead` days ahead (the same on every day). */
export function spreadShare(lead: number): number {
  return Math.sqrt(1 - knownShare(lead));
}

export const CLIMATE_SHARE_TARGET = 0.9;
/** The first challenge: the first lead at which the forecast's spread reaches 90% of the climate's. */
export function climateLeadSolved(lead: number): boolean {
  return spreadShare(lead) >= CLIMATE_SHARE_TARGET && spreadShare(lead - 1) < CLIMATE_SHARE_TARGET;
}

function dateLabel(d: number): string {
  const { month, dom, year } = dayInfo(d);
  return `${MONTH_NAMES[month]} ${dom}, year ${year}`;
}

function shortDate(d: number): string {
  const { month, dom } = dayInfo(d);
  return `${MONTH_NAMES[month].slice(0, 3)} ${dom}`;
}

const MEMBER = GRAPHIC.blue;
const PX = scale(-PAST_DAYS, LEAD_MAX, 58, 620);
const TOP = 26;
const BOTTOM = 214;
const PROB_TOP = 244;
const PROB_BOTTOM = 304;
const PY = scale(0, 1, PROB_BOTTOM, PROB_TOP);

function PlumeChart({ p, past, lead, threshold, event, show }: { p: Plume; past: number[]; lead: number; threshold: number; event: EventKind; show: boolean }) {
  const n = p.members.length;
  const today = past[past.length - 1];
  const values = [
    ...p.members.flat(),
    ...past,
    ...(show ? p.outcome : []),
    ...p.climMean.map((m, i) => m + p.climSd[i]),
    ...p.climMean.map((m, i) => m - p.climSd[i]),
    threshold,
  ];
  const [lo, hi] = niceDomain(Math.min(...values), Math.max(...values), 4);
  const y = scale(lo, hi, BOTTOM, TOP);
  const leads = Array.from({ length: LEAD_MAX }, (_, i) => i + 1);
  const xs = [0, ...leads].map(PX);
  const probs = leads.map((_, i) => p.members.filter((m) => m[i] < threshold).length / n);
  const happened = leads.map((_, i) => p.outcome[i] < threshold);
  const band = `${linePath(
    leads.map(PX),
    p.climMean.map((m, i) => y(m + p.climSd[i])),
  )} ${leads
    .map((l, i) => `L${PX(l).toFixed(1)} ${y(p.climMean[i] - p.climSd[i]).toFixed(1)}`)
    .reverse()
    .join(' ')} Z`;
  const i = lead - 1;
  const barW = (PX(1) - PX(0)) * 0.6;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 330"
      role="img"
      aria-label={`A ${n}-member ensemble forecast of Calder Bay’s daily mean temperature, issued ${dateLabel(p.issue)}, when the day’s mean was ${fmt(today, 1)} °F. ${lead} days ahead the members average ${fmt(p.mean[i], 1)} °F with a spread of ${fmt(p.sd[i], 1)} °F, and ${pct(probs[i])} of them are ${EVENT_LABEL[event]}.${show ? ` That day came in at ${fmt(p.outcome[i], 1)} °F.` : ''}`}
    >
      <text className="ax" x={58} y={14}>
        Daily mean temperature at Calder Bay, °F
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 4)} x0={58} x1={620} />
      <path d={band} fill="#8a8a8a" opacity={0.12} />
      <path d={linePath(leads.map(PX), p.climMean.map(y))} fill="none" stroke="#8a8a8a" strokeWidth={1.2} strokeDasharray="5 4" />
      <line x1={58} x2={620} y1={y(threshold)} y2={y(threshold)} stroke={GRAPHIC.teal} strokeWidth={1.5} strokeDasharray="2 3" />
      <text x={616} y={y(threshold) - 4} textAnchor="end" className="ax" style={{ fill: TEXT.teal }}>
        {threshold} °F
      </text>
      {p.members.map((m, k) => (
        <path key={k} d={linePath(xs, [y(today), ...m.map(y)])} fill="none" stroke={MEMBER} strokeWidth={1} opacity={Math.max(0.12, Math.min(0.4, 6 / n))} />
      ))}
      <path d={linePath(xs, [y(today), ...p.mean.map(y)])} fill="none" stroke={TEXT.blue} strokeWidth={3} strokeLinejoin="round" />
      <path d={linePath(past.map((_, k) => PX(k - PAST_DAYS)), past.map(y))} fill="none" stroke="#333" strokeWidth={2.5} />
      {past.map((v, k) => (
        <circle key={k} cx={PX(k - PAST_DAYS)} cy={y(v)} r={3} fill="#333" />
      ))}
      {show && (
        <g>
          <path d={linePath(xs, [y(today), ...p.outcome.map(y)])} fill="none" stroke="#333" strokeWidth={1.5} strokeDasharray="4 3" />
          {p.outcome.map((v, k) => (
            <circle key={k} cx={PX(k + 1)} cy={y(v)} r={3} fill="#fcfcfb" stroke="#333" strokeWidth={1.5} />
          ))}
        </g>
      )}
      <line x1={PX(0)} x2={PX(0)} y1={TOP - 6} y2={PROB_BOTTOM} stroke="#777" strokeWidth={1} />
      <text x={PX(0) + 4} y={TOP + 4} className="ax">
        issued
      </text>
      <line className="cur" x1={PX(lead)} x2={PX(lead)} y1={TOP - 6} y2={PROB_BOTTOM} />
      <circle cx={PX(lead)} cy={y(p.mean[i])} r={5} fill={TEXT.blue} stroke="#fcfcfb" strokeWidth={2} />

      <text className="ax" x={58} y={PROB_TOP - 8}>
        Chance of {EVENT_LABEL[event]}
      </text>
      <line className="base" x1={58} x2={620} y1={PROB_BOTTOM} y2={PROB_BOTTOM} />
      <line className="gl" x1={58} x2={620} y1={PY(1)} y2={PY(1)} />
      <text className="ax ax-e" x={52} y={PY(1) + 4}>
        100%
      </text>
      <text className="ax ax-e" x={52} y={PY(0) + 4}>
        0
      </text>
      {leads.map((l, k) => (
        <g key={l}>
          <rect x={PX(l) - barW / 2} y={PY(probs[k])} width={barW} height={PY(0) - PY(probs[k])} fill={l === lead ? TEXT.blue : tint(MEMBER, 0.6)} />
          {show && happened[k] && <circle cx={PX(l)} cy={PY(0) + 9} r={3.5} fill="#333" />}
        </g>
      ))}
      {[0, 3, 6, 9, 12, 15].map((l) => (
        <text key={l} className="ax ax-m" x={PX(l)} y={show ? 326 : 322}>
          {l === 0 ? shortDate(p.issue) : `+${l} d`}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The second demonstration: every winter forecast in the archive, verified.

/** The raw model runs 20 members; the event is a daily mean below freezing. */
export const CAL_MEMBERS = 20;
export const CAL_THRESHOLD = 32;
export const CAL_DEFAULTS = { lead: 5, inflation: 1, bias: 0 };
/** The inflation slider's values. */
export const INFLATION_GRID = Array.from({ length: 51 }, (_, i) => Math.round((0.5 + i * 0.05) * 100) / 100);

export function calSettings(s: { lead: number; inflation: number; bias: number }): CalibrationSettings {
  return { lead: s.lead, threshold: CAL_THRESHOLD, inflation: s.inflation, bias: s.bias, members: CAL_MEMBERS };
}

const bestCache = new Map<number, number>();
/** The lowest mean CRPS any inflation on the slider reaches at a lead (with no bias), °F. */
export function bestCrps(lead: number): number {
  let b = bestCache.get(lead);
  if (b === undefined) {
    b = Math.min(...crpsCurve(lead, 0, INFLATION_GRID));
    bestCache.set(lead, b);
  }
  return b;
}

/**
 * The second challenge: with no bias, an inflation whose forecasts score within a tenth of a
 * percent of the best CRPS any inflation reaches at this lead.
 */
export function calibrationSolved(s: { lead: number; inflation: number; bias: number }): boolean {
  if (s.bias !== 0) return false;
  return calibrationStats(calSettings(s)).crps <= bestCrps(s.lead) * 1.001;
}

function CalibrationChart({ st, lead }: { st: CalibrationStats; lead: number }) {
  const rx = scale(0, 1, 62, 282);
  const ry = scale(0, 1, 262, 42);
  const bins = st.reliability.filter((b) => b.count > 0);
  const flat = st.cases / st.rank.length;
  const maxRank = Math.max(flat * 2, ...st.rank);
  const hx = scale(0, st.rank.length, 344, 620);
  const hy = scale(0, maxRank, 262, 42);
  const bw = hx(1) - hx(0);
  const worst = bins.reduce((a, b) => (Math.abs(b.observed - b.forecast) > Math.abs(a.observed - a.forecast) ? b : a), bins[0]);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Verification of ${fmt(st.cases)} winter forecasts, ${lead} days ahead, of a daily mean below freezing at Calder Bay, with members spread ${fmt(st.effectiveSpread, 2)} times as widely as a calibrated forecast. Reliability: forecasts of about ${pct(worst?.forecast ?? 0)} came true ${pct(worst?.observed ?? 0)} of the time. ${pct(st.outside)} of outcomes fell outside the range of the ${CAL_MEMBERS} members, against ${pct(st.outsideCalibrated, 1)} for a calibrated ensemble.`}
    >
      <text className="ax" x={62} y={16}>
        How often it froze, by forecast probability
      </text>
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line className={v === 0 ? 'base' : 'gl'} x1={rx(0)} x2={rx(1)} y1={ry(v)} y2={ry(v)} />
          <text className="ax ax-e" x={rx(0) - 6} y={ry(v) + 4}>
            {pct(v)}
          </text>
          <text className="ax ax-m" x={rx(v)} y={278}>
            {pct(v)}
          </text>
        </g>
      ))}
      <line x1={rx(0)} y1={ry(0)} x2={rx(1)} y2={ry(1)} stroke="#9a9a9a" strokeWidth={1.2} strokeDasharray="5 4" />
      <text className="ax" x={rx(0.62)} y={ry(0.55)} style={{ fill: '#777' }}>
        perfectly reliable
      </text>
      <path d={linePath(bins.map((b) => rx(b.forecast)), bins.map((b) => ry(b.observed)))} fill="none" stroke={TEXT.blue} strokeWidth={2} />
      {bins.map((b, k) => (
        <circle key={k} cx={rx(b.forecast)} cy={ry(b.observed)} r={2.5 + Math.sqrt(b.count) / 6} fill={TEXT.blue} opacity={0.85} stroke="#fcfcfb" strokeWidth={1.5} />
      ))}
      <text className="ax ax-e" x={rx(1)} y={294}>
        forecast probability
      </text>

      <text className="ax" x={344} y={16}>
        Where the outcome fell among the {CAL_MEMBERS} members
      </text>
      <line className="base" x1={344} x2={620} y1={hy(0)} y2={hy(0)} />
      {st.rank.map((c, k) => (
        <rect key={k} x={hx(k) + 1} y={hy(c)} width={bw - 2} height={hy(0) - hy(c)} fill={k === 0 || k === st.rank.length - 1 ? GRAPHIC.red : tint(MEMBER, 0.7)} />
      ))}
      <line x1={344} x2={620} y1={hy(flat)} y2={hy(flat)} stroke="#555" strokeWidth={1.2} strokeDasharray="5 4" />
      <text className="ax ax-e" x={620} y={hy(flat) - 5}>
        calibrated
      </text>
      <text className="ax" x={344} y={278}>
        colder than all
      </text>
      <text className="ax ax-e" x={620} y={278}>
        warmer than all
      </text>
    </svg>
  );
}

export default function Lesson() {
  // Figure 1.
  const s = useScenario('plume', PLUME_DEFAULTS);
  const { winter, offset, members, lead, event, show } = s.state;
  const issue = winterDay(winter, offset);
  const p = useMemo(() => plume(issue, members), [issue, members]);
  const past = useMemo(() => Array.from({ length: PAST_DAYS + 1 }, (_, k) => tempF('calder', issue - PAST_DAYS + k)), [issue]);
  const threshold = EVENT_THRESHOLD[event];
  const i = lead - 1;
  const prob = p.members.filter((m) => m[i] < threshold).length / members;
  const share = spreadShare(lead);
  const solved = climateLeadSolved(lead);

  // Figure 2.
  const c = useScenario('calibration', CAL_DEFAULTS);
  const deferred = useDeferredValue(c.state);
  const st = useMemo(() => calibrationStats(calSettings(deferred)), [deferred]);
  const best = useMemo(() => bestCrps(deferred.lead), [deferred.lead]);
  const solved2 = useMemo(() => calibrationSolved(deferred), [deferred]);

  // Numbers the prose quotes.
  const ref = useMemo(() => plume(winterDay(PLUME_DEFAULTS.winter, PLUME_DEFAULTS.offset), PLUME_DEFAULTS.members), []);
  const refToday = tempF('calder', winterDay(PLUME_DEFAULTS.winter, PLUME_DEFAULTS.offset));
  const refProb6 = ref.members.filter((m) => m[5] < 20).length / ref.members.length;
  const q = useMemo(() => {
    const cal = (lead: number) => calibrationStats({ lead, threshold: CAL_THRESHOLD, inflation: 1 / RAW_SPREAD, bias: 0, members: CAL_MEMBERS });
    const raw5 = calibrationStats(calSettings(CAL_DEFAULTS));
    const lowBin = raw5.reliability[0];
    const highBin = raw5.reliability[9];
    const hardBase = calibrationStats({ lead: 1, threshold: 20, inflation: 1 / RAW_SPREAD, bias: 0, members: CAL_MEMBERS }).baseRate;
    const grid5 = crpsCurve(5, 0, INFLATION_GRID);
    const bestK5 = INFLATION_GRID[grid5.indexOf(Math.min(...grid5))];
    return { cal1: cal(1), cal5: cal(5), cal10: cal(10), cal15: cal(15), raw5, lowBin, highBin, hardBase, bestK5 };
  }, []);

  return (
    <LessonPage id="weather/3.5">
      <P>
        <a href={lessonHref('weather/3.4')}>The previous lesson</a> ended with a demand: if the future can’t be known exactly, a forecast should say how uncertain
        it is. Weather services do it by running their models not once but many times, each from a slightly different starting state chosen to be consistent with
        the observations, and sometimes with slightly different versions of the model’s physics. The collection of runs is an <K tone={WX.probability}>ensemble</K>,
        and each run is a <b>member</b>. The European Centre for Medium-Range Weather Forecasts, for instance, runs 51 members of its global model every day.
      </P>
      <P>
        An ensemble turns a forecast into a distribution. Where the members agree, the future is well determined; where they fan out, it isn’t. And the share of
        members that cross a threshold is a <K tone={WX.probability}>probability</K>: if 12 of 30 members bring a hard freeze to Calder Bay next Tuesday, the
        ensemble says 40%.
      </P>
      <P>
        Our ensembles come from the course’s simulated archive. For every winter day in its 41 years, the archive holds the forecast issued for it 1 to 15 days
        earlier: an expected temperature and a spread, built only from the information that had been revealed by the day it was issued — never from the outcome.
        The archive doesn’t store individual model runs, so the members here are drawn from each forecast’s distribution, each one a plausible path through the
        coming two weeks. In the next demonstration, the black line is what Calder Bay recorded up to the day the forecast was issued; the blue lines are the
        members, the thick one their average; the gray band is the climate — the normal temperature for each date, plus or minus a typical day’s departure from
        it; and the bars count the members past the event’s threshold each day. Choose a winter, an issue date and an event, and move the highlighted day:
      </P>

      <Figure name="Weather Ensemble Simulator" scenario={s}>
        <Segmented
          label="Event"
          value={event}
          onChange={(v) => s.set({ event: v })}
          options={[
            { value: 'freeze', label: 'Below freezing, 32 °F' },
            { value: 'hard', label: 'Hard freeze, below 20 °F' },
          ]}
        />
        <PlumeChart p={p} past={past} lead={lead} threshold={threshold} event={event} show={show} />
        <Legend
          items={[
            { label: 'Observed', color: '#333', kind: 'line' },
            { label: 'Members', color: tint(MEMBER, 0.6), kind: 'line' },
            { label: 'Ensemble mean', color: TEXT.blue, kind: 'line' },
            { label: 'Climate, ±1 sd', color: '#c9c9c9' },
            { label: 'What happened', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: `forecast for ${shortDate(issue + lead)}`, value: `${fmt(p.mean[i], 1)} ± ${fmt(p.sd[i], 1)} °F`, tone: WX.probability },
            { label: `chance of ${EVENT_LABEL[event]}`, value: pct(prob), tone: WX.probability },
            { label: 'spread, as a share of the climate’s', value: pct(share) },
            { label: 'what happened', value: show ? `${fmt(p.outcome[i], 1)} °F` : 'hidden', tone: WX.temperature },
          ]}
        />
        <Slider label="Winter" value={winter} min={1} max={WINTERS} onChange={(v) => s.set({ winter: v })} display={`year ${winter}–${winter + 1}`} />
        <Slider label="Issued on" value={offset} min={0} max={WINTER_DAYS - LEAD_MAX - 1} onChange={(v) => s.set({ offset: v })} display={shortDate(issue)} />
        <Slider label="Members" tone={WX.probability} value={members} min={5} max={50} onChange={(v) => s.set({ members: v })} display={`${members}`} />
        <Slider label="Highlighted day" value={lead} min={1} max={LEAD_MAX} onChange={(v) => s.set({ lead: v })} display={`${lead} ${lead === 1 ? 'day' : 'days'} ahead`} />
        <Checkbox label="Show what happened" checked={show} onChange={(v) => s.set({ show: v })} />
      </Figure>

      <P>
        The starting forecast was issued on {dateLabel(ref.issue)}, a mild day at {fmt(refToday, 1)} °F. The members agree closely about the next two days and
        then begin to fan out, but nearly all of them bring a cold outbreak: six days ahead they average {fmt(ref.mean[5], 1)} °F, against a normal of{' '}
        {fmt(ref.climMean[5], 1)}, and {pct(refProb6)} of them fall below 20 °F. A hard freeze happens on only about {pct(q.hardBase)} of winter days at Calder
        Bay, so a {pct(refProb6)} chance is a strong signal, not a shrug. The day came in at {fmt(ref.outcome[5], 1)} °F.
      </P>
      <P>
        Watch the plume widen. The spread of the members is {fmt(ref.sd[0], 1)} °F one day ahead, {fmt(ref.sd[5], 1)} at six days and {fmt(ref.sd[14], 1)} at
        fifteen, when it fills the climate’s band: by then the ensemble mean has drifted back close to the normal for the date, and the forecast knows little more
        than the calendar. That is the limit of <a href={lessonHref('weather/3.4')}>Lesson 3.4</a> made visible. Change the number of members and the probabilities
        jump about: with 5 members a probability can only be 0, 20, 40, 60, 80 or 100%, and a single member more or less moves it by a fifth. Large ensembles exist
        partly to make their probabilities smooth.
      </P>

      <Challenge
        id="a"
        question="How many days ahead does the ensemble’s spread first reach 90% of the climate’s own — the point where the forecast has lost most of what it knew?"
        solved={solved}
        status={`${lead} ${lead === 1 ? 'day' : 'days'} ahead, the spread is ${pct(share)} of the climate’s.`}
        success={`Solved. ${lead} days ahead the spread is ${pct(share)} of the climate’s; a day earlier it was ${pct(spreadShare(lead - 1))}. The spread doesn’t depend on the date: in this archive a forecast ${lead} days ahead knows ${pct(knownShare(lead))} of the day-to-day variability, whatever the weather, and the spread is the square root of the rest. Real ensembles are less tidy — some situations are more predictable than others, as Lesson 3.4’s butterfly showed — but their spreads approach the climate’s on a similar time scale.`}
      />

      <H2>Is the forecast honest?</H2>
      <P>
        A single forecast of 40% can never be right or wrong: whether it freezes or not, 40% was a possible answer. Probabilities can only be judged in bulk. A
        forecast is <K tone={WX.probability}>calibrated</K>, or reliable, if its probabilities come true as often as they say: of all the days it gave a 40%
        chance of freezing, it froze on about 40%. The <b>Brier score</b> measures it with a single number, the average squared difference between the forecast
        probability and what happened, counted as 1 or 0. The <b>Brier skill score</b> compares that with always forecasting the event’s base rate — at Calder
        Bay, freezing on {pct(q.cal1.baseRate)} of winter days: 1 is perfect, 0 no better than the base rate, below 0 worse.
      </P>
      <P>
        Calibration is not automatic. The members of a real ensemble share the same model and its flaws, so they tend to agree with each other more than they
        agree with the weather: raw ensembles are often <b>underdispersive</b>, too confident. Weather services correct them statistically against their own past
        forecasts before turning them into probabilities. The next demonstration verifies {fmt(q.cal5.cases)} winter forecasts from the archive, every day of 40
        winters, each judged only against what happened afterward. It starts with a deliberately overconfident model whose {CAL_MEMBERS} members spread only{' '}
        {pct(RAW_SPREAD)} as widely as they should. On the left is the <b>reliability diagram</b>: forecast probability of freezing against how often it froze.
        On the right is the <b>rank histogram</b>: for each forecast, where the outcome fell among the sorted members, from colder than all of them to warmer than
        all. Change the lead, inflate the spread, and add a bias:
      </P>

      <Figure name="Weather Ensemble Simulator · calibration" scenario={c}>
        <CalibrationChart st={st} lead={deferred.lead} />
        <Legend
          items={[
            { label: 'Forecasts, grouped by probability', color: TEXT.blue },
            { label: 'Outcome colder or warmer than every member', color: GRAPHIC.red },
          ]}
        />
        <Readouts
          items={[
            { label: 'Brier skill score', value: fmt(st.brierSkill, 3), tone: WX.probability },
            { label: 'CRPS', value: `${fmt(st.crps, 3)} °F`, tone: WX.probability },
            { label: 'best CRPS any inflation reaches', value: `${fmt(best, 3)} °F` },
            { label: `outcomes outside the members (calibrated: ${pct(st.outsideCalibrated, 1)})`, value: pct(st.outside, 1), tone: st.outside > st.outsideCalibrated * 1.5 ? 'red' : 'ink' },
          ]}
        />
        <Slider label="Lead" value={c.state.lead} min={1} max={LEAD_MAX} onChange={(v) => c.set({ lead: v })} display={`${c.state.lead} ${c.state.lead === 1 ? 'day' : 'days'} ahead`} />
        <Slider
          label="Spread inflation"
          tone={WX.probability}
          value={c.state.inflation}
          min={0.5}
          max={3}
          step={0.05}
          onChange={(v) => c.set({ inflation: v })}
          display={`× ${fmt(c.state.inflation, 2)} (${fmt(RAW_SPREAD * c.state.inflation, 2)} of calibrated)`}
        />
        <Slider label="Bias" tone={WX.temperature} value={c.state.bias} min={-4} max={4} step={0.5} onChange={(v) => c.set({ bias: v })} display={`${c.state.bias > 0 ? '+' : ''}${fmt(c.state.bias, 1)} °F`} />
      </Figure>

      <P>
        Five days ahead, the raw model is overconfident in both directions at once. When it gave freezing a chance below 10%, averaging {pct(q.lowBin.forecast)},
        it froze {pct(q.lowBin.observed)} of the time; when it said 90% or more, averaging {pct(q.highBin.forecast)}, it froze only {pct(q.highBin.observed)}. The
        reliability curve is flatter than the diagonal, the signature of a forecast that pushes its probabilities too close to 0 and 100%. The rank histogram
        says the same thing another way. The outcome fell outside the whole range of the members {pct(q.raw5.outside)} of the time, where a calibrated 20-member
        ensemble would be colder or warmer than all of its members only 2 times in 21, or {pct(2 / 21, 1)} — hence the tall red bars at its two ends.
      </P>
      <P>
        Try the bias as well. Make every member 3 °F too warm and the whole reliability curve lifts above the diagonal: the model now forecasts freezing too
        rarely, so it freezes more often than it says, and the rank histogram tilts, with outcomes piling up colder than the members. A bias is easier to fix than a spread, since a forecaster can simply subtract the
        model’s average error, but either one turns the same information into probabilities that can’t be taken at face value.
      </P>
      <P>
        One more score is worth knowing. The <b>continuous ranked probability score</b>, or CRPS, judges the whole forecast distribution against the outcome
        rather than one threshold, in the variable’s own units: it is the forecast’s error, in degrees, with credit given for honest uncertainty. Like the Brier
        score it is a <b>proper</b> score, meaning no forecaster can improve their expected score by reporting anything other than what they really believe. That
        is what makes it a fair way to find the right spread.
      </P>

      <Challenge
        id="b"
        question="With no bias, inflate the raw model’s spread until its forecasts score as well as any inflation can: a CRPS within a tenth of a percent of the best."
        solved={solved2}
        status={
          c.state.bias !== 0
            ? 'Set the bias back to zero first.'
            : `At × ${fmt(c.state.inflation, 2)}, the CRPS is ${fmt(st.crps, 3)} °F, against ${fmt(best, 3)} °F at best; ${pct(st.outside, 1)} of outcomes fall outside the members.`
        }
        success={`Solved. At × ${fmt(c.state.inflation, 2)}, the members spread ${fmt(RAW_SPREAD * c.state.inflation, 2)} times as widely as a calibrated forecast, and only ${pct(st.outside, 1)} of outcomes fall outside them, close to the ${pct(st.outsideCalibrated, 1)} a calibrated ensemble would give. The best inflation is close to 1 ÷ ${RAW_SPREAD} ≈ ${fmt(1 / RAW_SPREAD, 2)}: a proper score is lowest when the forecast’s spread matches its real errors. Notice how flat the curve is near its minimum — the reliability diagram and the rank histogram show a miscalibration long before the score does.`}
      />

      <P>
        Calibration makes a forecast honest; it doesn’t make it useful. With the spread calibrated, the Brier skill score for freezing is {fmt(q.cal1.brierSkill, 2)}{' '}
        one day ahead, {fmt(q.cal5.brierSkill, 2)} at five days, {fmt(q.cal10.brierSkill, 2)} at ten and {fmt(q.cal15.brierSkill, 2)} at fifteen — reliable at
        every lead, but by two weeks no better than the base rate. Slide the lead in{' '}
        <FigRef to="Weather Ensemble Simulator · calibration">this demonstration</FigRef> and watch the forecasts crowd toward the middle of the reliability
        diagram as the skill drains away. A calibrated forecast that says 39% every day is perfectly honest and nearly worthless; a sharp one that is badly
        calibrated is worse, because it is confidently wrong. What is worth paying for is a forecast that is both — and how much it is worth depends on how far
        ahead you need to know.
      </P>
      <P>
        That answers this chapter’s question. A chaotic atmosphere can’t be predicted exactly, but its probabilities can: measure the present as completely as
        possible, step a model forward, run it many times to map the uncertainty, and check the probabilities against what happens until they can be trusted. The
        rest of the course turns those calibrated distributions into money. Chapter 4 begins with the most direct link between temperature and spending —
        how many degrees a day falls short of comfortable, and how much fuel it takes to make up the difference — in{' '}
        <a href={lessonHref('weather/4.1')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
