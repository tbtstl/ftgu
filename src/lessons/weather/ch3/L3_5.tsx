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
import { useProgress } from '../../../course/progress';
import { WX } from '../shared/tones';

// ---------------------------------------------------------------------------
// The first demonstration: one ensemble forecast from the archive.

export type EventKind = 'freeze' | 'hard';
/** The events: a daily mean below freezing, or below 20 °F. */
export const EVENT_THRESHOLD: Record<EventKind, number> = { freeze: 32, hard: 20 };
const EVENT_LABEL: Record<EventKind, string> = { freeze: 'a mean below freezing', hard: 'a mean below 20 °F' };

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

/** A vertical bracket from `top` to `bottom`, its caps pointing away from the cursor (`dir` −1 left, +1 right). */
function Bracket({ x, top, bottom, color, dir }: { x: number; top: number; bottom: number; color: string; dir: 1 | -1 }) {
  return <path d={`M${x + 4 * dir} ${top} H${x} V${bottom} H${x + 4 * dir}`} fill="none" stroke={color} strokeWidth={2} />;
}

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
      aria-label={`A ${n}-member ensemble forecast of Fenwick Bay’s daily mean temperature, issued ${dateLabel(p.issue)}, when the day’s mean was ${fmt(today, 1)} °F. ${lead} days ahead the members average ${fmt(p.mean[i], 1)} °F with a spread of ${fmt(p.sd[i], 1)} °F, and ${pct(probs[i])} of them bring ${EVENT_LABEL[event]}.${show ? ` That day came in at ${fmt(p.outcome[i], 1)} °F.` : ''}`}
    >
      <text className="ax" x={58} y={14}>
        Daily mean temperature at Fenwick Bay, °F
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
      {/* At the highlighted day: the climate's ±1 sd (gray, left) beside the forecast's (blue, right). */}
      <Bracket x={PX(lead) - 8} top={y(p.climMean[i] + p.climSd[i])} bottom={y(p.climMean[i] - p.climSd[i])} color="#8a8a8a" dir={-1} />
      <Bracket x={PX(lead) + 8} top={y(p.mean[i] + p.sd[i])} bottom={y(p.mean[i] - p.sd[i])} color={TEXT.blue} dir={1} />
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

const curveCache = new Map<string, number[]>();
/** The mean CRPS at every inflation on the slider, for a lead and bias, °F (cached). */
export function crpsByInflation(lead: number, bias: number): number[] {
  const key = `${lead}|${bias}`;
  let c = curveCache.get(key);
  if (!c) {
    c = crpsCurve(lead, bias, INFLATION_GRID);
    if (curveCache.size > 300) curveCache.clear();
    curveCache.set(key, c);
  }
  return c;
}

/** The lowest mean CRPS any inflation on the slider reaches at a lead (with no bias), °F. */
export function bestCrps(lead: number): number {
  return Math.min(...crpsByInflation(lead, 0));
}

/** The span of inflations (with no bias) whose mean CRPS is within `within` of the best at a lead: the flat bottom of the curve. */
export function flatRange(lead: number, within = 0.01): { lo: number; hi: number } {
  const c = crpsByInflation(lead, 0);
  const best = Math.min(...c);
  const ok = INFLATION_GRID.filter((_, i) => c[i] <= best * (1 + within));
  return { lo: ok[0], hi: ok[ok.length - 1] };
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
      aria-label={`Verification of ${fmt(st.cases)} winter forecasts, ${lead} days ahead, of a daily mean below freezing at Fenwick Bay, with members spread ${fmt(st.effectiveSpread, 2)} times as widely as a calibrated forecast. Reliability: forecasts of about ${pct(worst?.forecast ?? 0)} came true ${pct(worst?.observed ?? 0)} of the time. ${pct(st.outside)} of outcomes fell outside the range of the ${CAL_MEMBERS} members, against ${pct(st.outsideCalibrated, 1)} for a calibrated ensemble.`}
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

const CX = scale(0.5, 3, 62, 620);
const C_TOP = 30;
const C_BOTTOM = 106;

/** The mean CRPS against the spread inflation, at the current lead and bias, with the current setting marked. */
function CrpsCurveChart({ curve, inflation, crps, lead, bias }: { curve: number[]; inflation: number; crps: number; lead: number; bias: number }) {
  const [lo, hi] = niceDomain(Math.min(...curve, crps), Math.max(...curve, crps), 3);
  const y = scale(lo, hi, C_BOTTOM, C_TOP);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 140"
      role="img"
      aria-label={`Average CRPS of the winter forecasts ${lead} days ahead${bias ? `, with every member ${fmt(Math.abs(bias), 1)} °F too ${bias > 0 ? 'warm' : 'cold'}` : ''}, against the spread inflation: ${fmt(curve[0], 2)} °F at × 0.5, ${fmt(Math.min(...curve), 2)} °F at its lowest and ${fmt(curve[curve.length - 1], 2)} °F at × 3. At the current × ${fmt(inflation, 2)} it is ${fmt(crps, 3)} °F.`}
    >
      <text className="ax" x={62} y={14}>
        Average CRPS, °F, at each spread inflation (lower is better)
      </text>
      <GridY y={y} ticks={niceTicks(lo, hi, 3)} x0={62} x1={620} format={(v) => fmt(v, 1)} />
      <path d={linePath(INFLATION_GRID.map(CX), curve.map(y))} fill="none" stroke={TEXT.blue} strokeWidth={2} />
      <line className="cur" x1={CX(inflation)} x2={CX(inflation)} y1={C_TOP - 4} y2={C_BOTTOM} />
      <circle cx={CX(inflation)} cy={y(crps)} r={5} fill={TEXT.blue} stroke="#fcfcfb" strokeWidth={2} />
      {[0.5, 1, 1.5, 2, 2.5, 3].map((v) => (
        <text key={v} className="ax ax-m" x={CX(v)} y={C_BOTTOM + 18}>
          × {fmt(v, 1)}
        </text>
      ))}
    </svg>
  );
}

/** Whether a challenge of this lesson is solved now or was on an earlier visit: readouts that would give it away appear once it is. */
function useRevealed(challenge: string, solved: boolean): boolean {
  const done = useProgress()['weather/3.5']?.includes(challenge) ?? false;
  return solved || done;
}

export default function Lesson() {
  // Figure 1.
  const s = useScenario('plume', PLUME_DEFAULTS);
  const { winter, offset, members, lead, event, show } = s.state;
  const issue = winterDay(winter, offset);
  const p = useMemo(() => plume(issue, members), [issue, members]);
  const past = useMemo(() => Array.from({ length: PAST_DAYS + 1 }, (_, k) => tempF('fenwick', issue - PAST_DAYS + k)), [issue]);
  const threshold = EVENT_THRESHOLD[event];
  const i = lead - 1;
  const prob = p.members.filter((m) => m[i] < threshold).length / members;
  const share = spreadShare(lead);
  const solved = climateLeadSolved(lead);
  const showShare = useRevealed('a', solved);

  // Figure 2.
  const c = useScenario('calibration', CAL_DEFAULTS);
  const deferred = useDeferredValue(c.state);
  const st = useMemo(() => calibrationStats(calSettings(deferred)), [deferred]);
  const crpsLine = useMemo(() => crpsByInflation(deferred.lead, deferred.bias), [deferred.lead, deferred.bias]);
  const solved2 = useMemo(() => calibrationSolved(deferred), [deferred]);
  // For the second challenge's success: how wide the curve's flat bottom is, and how miscalibrated its two ends are.
  const flat = useMemo(() => {
    if (!solved2) return null;
    const r = flatRange(deferred.lead);
    const outside = (inflation: number) => calibrationStats(calSettings({ lead: deferred.lead, inflation, bias: 0 })).outside;
    return { ...r, outLo: outside(r.lo), outHi: outside(r.hi) };
  }, [solved2, deferred.lead]);

  // Numbers the prose quotes.
  const ref = useMemo(() => plume(winterDay(PLUME_DEFAULTS.winter, PLUME_DEFAULTS.offset), PLUME_DEFAULTS.members), []);
  const refToday = tempF('fenwick', winterDay(PLUME_DEFAULTS.winter, PLUME_DEFAULTS.offset));
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
        and each run is a <b>member</b>. The European Centre for Medium-Range Weather Forecasts, for instance, runs 51 members of its global model, several times a day.
      </P>
      <P>
        An ensemble turns a forecast into a distribution. Where the members agree, the future is well determined; where they fan out, it isn’t. And the share of
        members that cross a threshold is a <K tone={WX.probability}>probability</K>: if 12 of 30 members give Fenwick Bay a daily mean below 20 °F next Tuesday,
        the ensemble says 40%.
      </P>
      <P>
        Our ensembles come from the course’s simulated archive. For every winter day in its 41 years, the archive holds the forecast issued for it 1 to 15 days
        earlier: an expected temperature and a spread, built only from the information that had been revealed by the day it was issued — never from the outcome.
        The archive doesn’t store individual model runs, so the members here are drawn from each forecast’s distribution, each one a plausible path through the
        coming two weeks. In the next demonstration, the black line is what Fenwick Bay recorded up to the day the forecast was issued; the blue lines are the
        members, the thick one their average; the gray band is the climate — the normal temperature for each date, plus or minus a typical day’s departure from
        it; and the bars count the members past the event’s threshold each day. Choose a winter, an issue date and an event, and move the highlighted day:
      </P>

      <Figure name="Weather Ensemble Simulator" scenario={s}>
        <Segmented
          label="Event"
          value={event}
          onChange={(v) => s.set({ event: v })}
          options={[
            { value: 'freeze', label: 'Mean below freezing, 32 °F' },
            { value: 'hard', label: 'Mean below 20 °F' },
          ]}
        />
        <PlumeChart p={p} past={past} lead={lead} threshold={threshold} event={event} show={show} />
        <Legend
          items={[
            { label: 'Observed', color: '#333', kind: 'line' },
            { label: 'Members', color: tint(MEMBER, 0.6), kind: 'line' },
            { label: 'Ensemble mean, and its ±1 sd at the highlighted day', color: TEXT.blue, kind: 'line' },
            { label: 'Climate, ±1 sd', color: '#c9c9c9' },
            { label: 'What happened', color: '#333', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: `forecast for ${shortDate(issue + lead)}`, value: `${fmt(p.mean[i], 1)} ± ${fmt(p.sd[i], 1)} °F`, tone: WX.probability },
            { label: `chance of ${EVENT_LABEL[event]}`, value: pct(prob), tone: WX.probability },
            showShare
              ? { label: 'spread, as a share of the climate’s', value: pct(share) }
              : { label: 'spread, as a share of the climate’s: challenge a asks', value: '?' },
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
        {fmt(ref.climMean[5], 1)}, and {pct(refProb6)} of them fall below 20 °F. A day that cold happens on only about {pct(q.hardBase)} of winter days at Fenwick
        Bay, so a {pct(refProb6)} chance is a strong signal, not a shrug. The day came in at {fmt(ref.outcome[5], 1)} °F.
      </P>
      <P>
        Watch the plume widen. The spread of the members is {fmt(ref.sd[0], 1)} °F one day ahead, {fmt(ref.sd[5], 1)} at six days and {fmt(ref.sd[14], 1)} at
        fifteen, when it fills the climate’s band: by then the ensemble mean has drifted back close to the normal for the date, and the forecast knows little more
        than the calendar. That is the limit of <a href={lessonHref('weather/3.4')}>Lesson 3.4</a> made visible. Change the number of members and the
        probabilities jump about: with 5 members a probability can only be 0, 20, 40, 60, 80 or 100%, and a single member more or less moves it by a fifth. Large
        ensembles exist partly to make their probabilities smooth.
      </P>
      <P>
        How fast the plume widens follows from what the forecast knows. <a href={lessonHref('weather/3.3')}>Lesson 3.3</a> found that a forecast of Fenwick Bay
        knows {pct(knownShare(1))} of a day’s variability one day ahead, {pct(knownShare(5))} five days ahead and {pct(knownShare(10))} ten days ahead. The
        members spread over the rest: their spread, as a share of the climate’s, is the square root of the share still unknown — √(1 − {fmt(knownShare(5), 2)}) ≈{' '}
        {fmt(spreadShare(5), 2)} five days ahead. At the highlighted day, two brackets compare the forecast’s ±1 sd, in blue, with the climate’s, in gray.
      </P>

      <Challenge
        id="a"
        question="Predict first, from those shares: how many days ahead does the members’ spread first reach 90% of the climate’s — the point where 81% of the day’s variability is still unknown and the forecast has lost most of what it knew? Then move the highlighted day to check, watching the blue bracket close in on the gray one. The spread readout stays hidden until you find it."
        solved={solved}
        status={`${lead} ${lead === 1 ? 'day' : 'days'} ahead, the members’ spread is ${share >= CLIMATE_SHARE_TARGET ? 'past 90% of the climate’s. Is this the first day it gets there?' : 'still under 90% of the climate’s.'}`}
        success={`Solved. ${lead} days ahead the spread is ${pct(share)} of the climate’s; a day earlier it was ${pct(spreadShare(lead - 1))}. A forecast ${lead} days ahead knows ${pct(knownShare(lead))} of the day-to-day variability, and the square root of the ${pct(1 - knownShare(lead))} it doesn’t know is ${fmt(share, 2)}. In this archive the spread doesn’t depend on the date or the weather. Real ensembles are less tidy — some situations are more predictable than others, as Lesson 3.4’s butterfly showed — but their spreads approach the climate’s on a similar time scale.`}
      />

      <H2>Is the forecast honest?</H2>
      <P>
        A single forecast of 40% can never be right or wrong: whether it freezes or not, 40% was a possible answer. Probabilities can only be judged in bulk. A
        forecast is <K tone={WX.probability}>calibrated</K>, or reliable, if its probabilities come true as often as they say: of all the days it gave a 40%
        chance of freezing, it froze on about 40%. (Here a day counts as freezing when its mean temperature is below 32 °F.) The <b>Brier score</b> measures it with a single number, the average squared difference between the forecast
        probability and what happened, counted as 1 or 0. The <b>Brier skill score</b> compares that with always forecasting the event’s base rate — at Fenwick
        Bay, freezing on {pct(q.cal1.baseRate)} of winter days: 1 is perfect, 0 no better than the base rate, below 0 worse.
      </P>
      <P>
        Calibration is not automatic. The members of a real ensemble share the same model and its flaws, so they tend to agree with each other more than they
        agree with the weather: raw ensembles are often <b>underdispersive</b>, too confident. Weather services correct them statistically against their own past
        forecasts before turning them into probabilities. The next demonstration verifies {fmt(q.cal5.cases)} winter forecasts from the archive, every day of 40
        winters, each judged only against what happened afterward. It starts with a deliberately overconfident model whose {CAL_MEMBERS} members spread only{' '}
        {pct(RAW_SPREAD)} as widely as they should. On the left is the <b>reliability diagram</b>: forecast probability of freezing against how often it froze.
        On the right is the <b>rank histogram</b>: for each forecast, where the outcome fell among the sorted members, from colder than all of them to warmer than
        all. Along the bottom runs a third measure, the CRPS, which we’ll come to shortly. Change the lead, inflate the spread, and add a bias:
      </P>

      <Figure name="Weather Ensemble Simulator · calibration" scenario={c}>
        <CalibrationChart st={st} lead={deferred.lead} />
        <CrpsCurveChart curve={crpsLine} inflation={deferred.inflation} crps={st.crps} lead={deferred.lead} bias={deferred.bias} />
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
        Try the bias as well. Make every member 3 °F too warm and nearly the whole reliability curve lifts above the diagonal: the model now forecasts freezing too
        rarely, so it freezes more often than it says, and the rank histogram tilts, with outcomes piling up colder than the members. A bias is easier to fix than a spread, since a forecaster can simply subtract the
        model’s average error, but either one turns the same information into probabilities that can’t be taken at face value.
      </P>
      <P>
        One more score is worth knowing. The <K tone={WX.probability}>continuous ranked probability score</K>, or CRPS, judges the whole forecast distribution
        against the outcome rather than one threshold, in the variable’s own units. For a single forecast, picture its cumulative probability curve — the chance
        of a temperature at or below each value — next to a step from 0 to 1 at the temperature that happened; the CRPS adds up the squared gap between the two
        across every temperature. A forecast with no spread at all scores simply its error in degrees; a spread scores better when it covers the outcome honestly
        and worse when it is wider than it needs to be. Like the Brier score it is a <b>proper</b> score, meaning no forecaster can improve their expected score
        by reporting anything other than what they really believe. That is what makes it a fair way to find the right spread. The chart along the bottom of{' '}
        <FigRef to="Weather Ensemble Simulator · calibration">this demonstration</FigRef> plots it: the average CRPS of all {fmt(q.cal5.cases)} forecasts at
        every spread inflation, for the current lead and bias, with a dot at the current setting. Too narrow a spread is punished for the outcomes it misses, too
        wide a one for its vagueness.
      </P>

      <Challenge
        id="b"
        question={`The raw members spread only ${pct(RAW_SPREAD)} as widely as they should. Predict first: by what factor must their spread be inflated to score best? Then, with no bias, find an inflation at the low point of the CRPS curve: a score within a tenth of a percent of the best any inflation reaches.`}
        solved={solved2}
        status={
          c.state.bias !== 0
            ? 'Set the bias back to zero first.'
            : `At × ${fmt(c.state.inflation, 2)}, the CRPS is ${fmt(st.crps, 3)} °F, and ${pct(st.outside, 1)} of outcomes fall outside the members.`
        }
        success={`Solved. At × ${fmt(c.state.inflation, 2)}, the members spread ${fmt(RAW_SPREAD * c.state.inflation, 2)} times as widely as a calibrated forecast, and only ${pct(st.outside, 1)} of outcomes fall outside them, close to the ${pct(st.outsideCalibrated, 1)} a calibrated ensemble would give. The best inflation is close to 1 ÷ ${RAW_SPREAD} ≈ ${fmt(1 / RAW_SPREAD, 2)}: a proper score is lowest when the forecast’s spread matches its real errors. Notice how flat the curve is near its minimum: every inflation from × ${fmt(flat?.lo ?? 0, 2)} to × ${fmt(flat?.hi ?? 0, 2)} scores within 1% of the best, though at those two ends ${pct(flat?.outLo ?? 0)} and ${pct(flat?.outHi ?? 0)} of outcomes fall outside the members. The reliability diagram and the rank histogram show a miscalibration long before the score does.`}
      />

      <P>
        Calibration makes a forecast honest; it doesn’t make it useful. With the spread calibrated, the Brier skill score for freezing is {fmt(q.cal1.brierSkill, 2)}{' '}
        one day ahead, {fmt(q.cal5.brierSkill, 2)} at five days, {fmt(q.cal10.brierSkill, 2)} at ten and {fmt(q.cal15.brierSkill, 2)} at fifteen — reliable at
        every lead, but by two weeks no better than the base rate. Slide the lead in{' '}
        <FigRef to="Weather Ensemble Simulator · calibration">this demonstration</FigRef> and watch the forecasts crowd toward the middle of the reliability
        diagram as the skill drains away. A calibrated forecast that says {pct(q.cal1.baseRate)} every day is perfectly honest and nearly worthless; a sharp one that is badly
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
