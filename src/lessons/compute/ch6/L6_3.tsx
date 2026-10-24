import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  fmt,
  lessonHref,
  pct,
  scale,
  usd,
  useScenario,
} from '../../../framework';
import { MARKET_BUYERS, MARKET_SUPPLY, clearMarket, type Clearing } from '../../../engines/compute/marketplace';
import { breakEvenDataTB, moveJob, type MoveResult, type MoveRoute } from '../../../engines/compute/regionMove';
import { DAY_JOBS, scheduleDay, type DayJob, type DaySchedule } from '../../../engines/compute/regionSchedule';
import { SITES, SITE_IDS, type SiteId } from '../../../model/compute/sites';

// ---------------------------------------------------------------------------
// Prices: Lesson 5.5's market, cleared with the round trip the chat and frontier assistants accept.

const INTERACTIVE = new Set(['chat70', 'frontier400']);
const marketCache = new Map<number, Clearing>();

/** Lesson 5.5's reference market with the interactive assistants accepting `lat` ms (memoized). */
export function marketAtLatency(lat: number): Clearing {
  let c = marketCache.get(lat);
  if (!c) {
    c = clearMarket(
      MARKET_BUYERS.map((b) => (INTERACTIVE.has(b.id) ? { ...b, maxRttMs: lat } : b)),
      MARKET_SUPPLY,
    );
    marketCache.set(lat, c);
  }
  return c;
}

/** Link speeds on the slider, Gb/s. */
export const LINKS = [1, 2, 5, 10, 25, 40, 100, 200, 400];
/** Dataset sizes on the slider, TB. */
export const DATA_TB = [0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000];

export interface RouteState {
  /** Index into LINKS. */
  link: number;
  /** Egress fee, cents per GB. */
  egress: number;
  /** Round trip the chat and frontier assistants accept, ms. */
  lat: number;
}

export function routeOf(s: RouteState): MoveRoute {
  const m = marketAtLatency(s.lat);
  return { from: 'techpark', to: 'northfield', priceFrom: m.prices.techpark.A, priceTo: m.prices.northfield.A, linkGbps: LINKS[s.link], egressPerGB: s.egress / 100 };
}

// ---------------------------------------------------------------------------
// The first demonstration: one job, Tech Park or Northfield.

export type JobId = 'pretrain' | 'batch' | 'tune' | 'chat';
export const JOB_IDS: JobId[] = ['pretrain', 'batch', 'tune', 'chat'];
const JOB_LABEL: Record<JobId, string> = { pretrain: 'Pretraining slice', batch: 'Overnight summaries', tune: 'Fine-tuning', chat: 'Chat assistant' };

export function baseJob(id: JobId): DayJob {
  return DAY_JOBS.find((j) => j.id === id)!;
}

/** Index of a job's own dataset on the data slider. */
export function defaultData(id: JobId): number {
  const tb = baseJob(id).dataInTB;
  const i = DATA_TB.indexOf(tb);
  return i >= 0 ? i : 0;
}

export interface JobState extends RouteState {
  job: JobId;
  /** Index into DATA_TB. */
  data: number;
}

export const JOB_DEFAULTS: JobState = { job: 'pretrain', data: defaultData('pretrain'), link: 6, egress: 5, lat: 30 };

/** The job as set: its own GPU-hours, deadline and latency, with the dataset from the slider (results keep the job's own share of it). */
export function jobOf(s: Pick<JobState, 'job' | 'data'>): DayJob {
  const b = baseJob(s.job);
  if (b.dataInTB <= 0) return b;
  const tb = DATA_TB[s.data];
  return { ...b, dataInTB: tb, dataOutTB: (tb * b.dataOutTB) / b.dataInTB };
}

export function runJob(s: JobState): MoveResult {
  return moveJob(jobOf(s), routeOf(s));
}

/** Challenge a: at the starting link and fee, with Northfield out of the assistants' reach, the largest dataset that still saves money. */
export function largestSolved(s: JobState): boolean {
  if (s.job !== 'pretrain' || s.link !== JOB_DEFAULTS.link || s.egress !== JOB_DEFAULTS.egress || s.lat >= SITES.northfield.rttMs) return false;
  const r = runJob(s);
  if (!r.feasible || r.saving <= 0) return false;
  if (s.data >= DATA_TB.length - 1) return true;
  const next = runJob({ ...s, data: s.data + 1 });
  return !next.feasible || next.saving <= 0;
}

// ---------------------------------------------------------------------------
// The second demonstration: a day of jobs sharing one link.

export const DAY_DEFAULTS: RouteState = { link: 6, egress: 5, lat: 30 };

export function dayOf(s: RouteState): DaySchedule {
  return scheduleDay(DAY_JOBS, routeOf(s));
}

/** Jobs that would save money moving on their own, with the fastest link (no queue, no copy limits). */
export function worthMoving(s: RouteState): string[] {
  const route = { ...routeOf(s), linkGbps: LINKS[LINKS.length - 1] };
  return DAY_JOBS.filter((j) => {
    const r = moveJob(j, route);
    return r.feasible && r.saving > 0;
  }).map((j) => j.id);
}

function movesAll(s: RouteState): boolean {
  const worth = worthMoving(s);
  const day = dayOf(s);
  return worth.length > 0 && worth.every((id) => day.rows.find((r) => r.job.id === id)!.decision === 'move');
}

/** Challenge b: the slowest link on the slider that still lets the scheduler move every job worth moving. */
export function slowestSolved(s: RouteState): boolean {
  return movesAll(s) && (s.link === 0 || !movesAll({ ...s, link: s.link - 1 }));
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes, all from the engines.

/** The round trip the assistants accept in Lesson 5.5's reference market, ms. */
export const REF_LAT = 30;
const REF = marketAtLatency(REF_LAT);
const OPEN = marketAtLatency(SITES.northfield.rttMs);
const PRE = runJob(JOB_DEFAULTS);
const PRE_JOB = jobOf(JOB_DEFAULTS);
const ROUTE = routeOf(JOB_DEFAULTS);
const PRE_BE = breakEvenDataTB(PRE_JOB, ROUTE, PRE_JOB.dataOutTB / PRE_JOB.dataInTB);
const bestIdx = (() => {
  let best = -1;
  for (let i = 0; i < DATA_TB.length; i++) {
    const r = runJob({ ...JOB_DEFAULTS, data: i });
    if (r.feasible && r.saving > 0) best = i;
  }
  return best;
})();
const BATCH = { ...JOB_DEFAULTS, job: 'batch' as JobId, data: defaultData('batch') };
const BATCH_AT = (link: number) => runJob({ ...BATCH, link });
const batchSlowest = LINKS.findIndex((_, i) => BATCH_AT(i).feasible);
const DAY = dayOf(DAY_DEFAULTS);
const DAY_SLOW = dayOf({ ...DAY_DEFAULTS, link: LINKS.indexOf(10) });
const DAY_1 = dayOf({ ...DAY_DEFAULTS, link: 0 });
const DAY_HIGH_FEE = dayOf({ ...DAY_DEFAULTS, egress: 9 });
const slowestAll = LINKS.findIndex((_, i) => slowestSolved({ ...DAY_DEFAULTS, link: i }));
const video = DAY.rows.find((r) => r.job.id === 'video')!;
const embed = DAY.rows.find((r) => r.job.id === 'embed')!;

export const LESSON_NUMBERS = {
  near: REF.prices.techpark.A,
  far: REF.prices.northfield.A,
  bayport: REF.prices.bayport.A,
  gap: REF.prices.techpark.A - REF.prices.northfield.A,
  open: OPEN.prices.techpark.A,
  openFar: OPEN.prices.northfield.A,
  preGpuHours: PRE_JOB.gpuHours,
  preGpus: PRE_JOB.gpus,
  preIn: PRE_JOB.dataInTB,
  preOut: PRE_JOB.dataOutTB,
  preRunH: PRE.runH,
  preStay: PRE.stayCost,
  preMoveGpu: PRE.moveCost - PRE.egressCost,
  preEgress: PRE.egressCost,
  preSaving: PRE.saving,
  preCopyH: PRE.transferH,
  preBreakEven: PRE_BE,
  preBestTB: DATA_TB[bestIdx],
  preBestSaving: runJob({ ...JOB_DEFAULTS, data: bestIdx }).saving,
  preNextTB: DATA_TB[bestIdx + 1],
  preNextSaving: runJob({ ...JOB_DEFAULTS, data: bestIdx + 1 }).saving,
  preOpenSaving: runJob({ ...JOB_DEFAULTS, lat: SITES.northfield.rttMs }).saving,
  batchIn: baseJob('batch').dataInTB + baseJob('batch').dataOutTB,
  batchRunH: BATCH_AT(JOB_DEFAULTS.link).runH,
  batchDeadline: baseJob('batch').deadlineHours,
  batchCopy10: BATCH_AT(LINKS.indexOf(10)).transferH,
  batchSlowestLink: LINKS[batchSlowest],
  batchSaving: BATCH_AT(JOB_DEFAULTS.link).saving,
  dayMoved: DAY.moved,
  daySaving: DAY.saving,
  dayStay: DAY.stayTotal,
  dayLinkH: DAY.linkHours,
  daySlowMoved: DAY_SLOW.moved,
  daySlowSaving: DAY_SLOW.saving,
  day1Moved: DAY_1.moved,
  day1Saving: DAY_1.saving,
  highFeeMoved: DAY_HIGH_FEE.moved,
  videoGapSaving: video.job.gpuHours * (REF.prices.techpark.A - REF.prices.northfield.A),
  videoEgress: video.result.egressCost,
  videoTB: video.job.dataInTB + video.job.dataOutTB,
  embedSaving: embed.result.saving,
  chatSaving: DAY.rows.find((r) => r.job.id === 'chat')!.result.saving,
  slowestAllLink: LINKS[slowestAll],
};
const N = LESSON_NUMBERS;

// ---------------------------------------------------------------------------
// Display helpers.

function tbText(tb: number): string {
  if (tb >= 1000) return `${fmt(tb / 1000, tb % 1000 ? 1 : 0)} PB`;
  return `${fmt(tb, tb < 1 ? (tb < 0.1 ? 2 : 1) : 0)} TB`;
}

function hoursText(h: number): string {
  if (!Number.isFinite(h)) return '—';
  if (h < 1) return `${fmt(h * 60)} min`;
  if (h < 10) return `${fmt(h, 1)} h`;
  return `${fmt(h)} h`;
}

const money = (x: number) => usd(x);
const signedMoney = (x: number) => (x >= 0 ? usd(x) : `−${usd(-x)}`);

/** Round trip to users on a log scale, as in Lesson 5.5. */
const RX = (ms: number) => 74 + (Math.log10(Math.max(1, ms)) / Math.log10(60)) * 516;
const SITE_Y = 150;

function RouteMap({ s, r, job }: { s: JobState; r: MoveResult; job: DayJob }) {
  const m = marketAtLatency(s.lat);
  const tp = RX(SITES.techpark.rttMs);
  const nf = RX(SITES.northfield.rttMs);
  const limitX = RX(s.lat);
  const moving = r.feasible && r.saving > 0;
  const arc = `M${tp} ${SITE_Y - 32} C ${tp + 60} 30, ${nf - 80} 30, ${nf} ${SITE_Y - 32}`;
  // Dots move faster on a faster link (the log of its rate, so 1 and 400 Gb/s both stay visible).
  const speed = 6 + 10 * Math.log10(LINKS[s.link]);
  const tbMoved = job.dataInTB + job.dataOutTB;
  const label = `Tech Park, ${SITES.techpark.rttMs} ms from the users, sells an A-class hour for ${usd(m.prices.techpark.A, 2)}; Northfield, ${SITES.northfield.rttMs} ms away, for ${usd(m.prices.northfield.A, 2)}. The chat and frontier assistants accept ${s.lat} ms. ${JOB_LABEL[s.job]}: ${moving ? `moving it saves ${money(r.saving)}` : r.feasible ? `moving it would cost ${money(-r.saving)} more` : 'it can’t move'}.`;
  return (
    <svg className="diagram" viewBox="0 0 640 236" role="img" aria-label={label}>
      <text className="ax" x={74} y={14}>
        Round trip to the users (log scale) · prices for an A-class hour, simulated
      </text>
      {/* Beyond the assistants' limit. */}
      <rect x={limitX} y={100} width={Math.max(0, 604 - limitX)} height={106} fill="rgba(42,157,144,.08)" />
      <line x1={limitX} x2={limitX} y1={100} y2={206} stroke={GRAPHIC.teal} strokeWidth={2} strokeDasharray="5 4" />
      <text x={limitX + (limitX > 430 ? -6 : 6)} y={224} textAnchor={limitX > 430 ? 'end' : 'start'} style={{ fontSize: 12, fill: TEXT.teal }}>
        the assistants accept {s.lat} ms
      </text>
      <line className="base" x1={74} x2={604} y1={SITE_Y} y2={SITE_Y} />
      {[1, 2, 5, 10, 20, 50].map((t) => (
        <g key={t}>
          <line x1={RX(t)} x2={RX(t)} y1={SITE_Y - 4} y2={SITE_Y + 4} stroke="#bbb" />
          <text className="ax ax-m" x={RX(t)} y={SITE_Y + 44}>
            {t} ms
          </text>
        </g>
      ))}
      <text x={40} y={SITE_Y + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#333' }}>
        Users
      </text>
      {/* The wide-area link from Tech Park to Northfield. */}
      <path d={arc} fill="none" stroke={moving ? GRAPHIC.blue : '#d0d0cc'} strokeWidth={3} strokeLinecap="round" />
      {moving && <path d={arc} className="flow-dots" stroke={GRAPHIC.blue} strokeWidth={7} style={{ animationDuration: `${(18 / speed).toFixed(3)}s` }} />}
      <text x={(tp + nf) / 2} y={40} textAnchor="middle" style={{ fontSize: 12, fill: moving ? TEXT.blue : '#777' }}>
        {fmt(LINKS[s.link])} Gb/s link{tbMoved > 0 ? ` · ${tbText(tbMoved)} there and back · ${hoursText(r.transferH)}` : ''}
      </text>
      {SITE_IDS.map((id: SiteId) => {
        const x = RX(SITES[id].rttMs);
        const far = SITES[id].rttMs > s.lat;
        const big = id !== 'bayport';
        const anchor = id === 'bayport' ? 'end' : 'middle';
        const dx = id === 'bayport' ? -8 : 0;
        return (
          <g key={id}>
            <circle cx={x} cy={SITE_Y} r={big ? 8 : 5} fill={far ? '#fff' : '#333'} stroke="#333" strokeWidth={1.5} />
            <text x={x} y={SITE_Y - 16} textAnchor={anchor} dx={dx} style={{ fontSize: 13, fontWeight: 500, fill: '#111' }}>
              {SITES[id].name}
            </text>
            <text x={x} y={SITE_Y + 24} textAnchor={anchor} dx={dx} style={{ fontSize: 13, fontWeight: 600, fill: TEXT.green }}>
              {usd(m.prices[id].A, 2)}/h
            </text>
          </g>
        );
      })}
      {!r.feasible && (
        <text x={74} y={62} style={{ fontSize: 12, fill: TEXT.red }}>
          {r.reason?.includes('deadline') ? 'The copies would make it miss its deadline.' : `It can’t leave: it tolerates ${job.maxRttMs} ms.`}
        </text>
      )}
    </svg>
  );
}

function CostChart({ r, job }: { r: MoveResult; job: DayJob }) {
  const moveGpu = r.moveCost - r.egressCost;
  const blocked = !r.feasible;
  const top = Math.max(r.stayCost, r.moveCost) || 1;
  const x = scale(0, top, 150, 470);
  const totalH = r.transferH + r.runH;
  const hMax = Math.max(job.deadlineHours, Number.isFinite(totalH) ? totalH : 0) * 1.08;
  const xh = scale(0, hMax, 150, 600);
  const inH = Number.isFinite(r.transferH) ? (r.transferH * job.dataInTB) / Math.max(1e-9, job.dataInTB + job.dataOutTB) : 0;
  const outH = Number.isFinite(r.transferH) ? r.transferH - inH : 0;
  const label = `Staying at Tech Park costs ${money(r.stayCost)}; moving costs ${money(moveGpu)} of GPU-hours and ${money(r.egressCost)} of egress, ${money(r.moveCost)} in all. Copying takes ${hoursText(r.transferH)} and the job runs ${hoursText(r.runH)}, against a deadline of ${hoursText(job.deadlineHours)}.`;
  return (
    <svg className="chart" viewBox="0 0 640 176" role="img" aria-label={label}>
      <text className="ax" x={150} y={12}>
        Cost of the job
      </text>
      <text x={142} y={38} textAnchor="end" style={{ fontSize: 13, fill: '#333' }}>
        Stay at Tech Park
      </text>
      <rect x={x(0)} y={25} width={x(r.stayCost) - x(0)} height={18} fill={GRAPHIC.green} opacity={0.75} />
      <text x={x(r.stayCost) + 6} y={38} style={{ fontSize: 12, fill: '#333' }}>
        {money(r.stayCost)}
      </text>
      <text x={142} y={68} textAnchor="end" style={{ fontSize: 13, fill: '#333' }}>
        Move to Northfield
      </text>
      <g opacity={blocked ? 0.3 : 1}>
        <rect x={x(0)} y={55} width={x(moveGpu) - x(0)} height={18} fill={GRAPHIC.green} opacity={0.75} />
        <rect x={x(moveGpu)} y={55} width={Math.max(0, x(r.moveCost) - x(moveGpu))} height={18} fill={GRAPHIC.blue} />
      </g>
      <text x={x(r.moveCost) + 6} y={68} style={{ fontSize: 12, fill: blocked ? TEXT.red : '#333' }}>
        {blocked ? 'not possible' : money(r.moveCost)}
        {!blocked && r.egressCost > 0 ? ` (egress ${money(r.egressCost)})` : ''}
      </text>
      <line className="base" x1={150} x2={600} y1={84} y2={84} />
      <text className="ax" x={150} y={106}>
        Time if it moves
      </text>
      <rect x={xh(0)} y={116} width={Math.max(0, xh(inH) - xh(0))} height={16} fill={GRAPHIC.blue} />
      <rect x={xh(inH)} y={116} width={Math.max(0, xh(inH + r.runH) - xh(inH))} height={16} fill={GRAPHIC.orange} opacity={0.75} />
      <rect x={xh(inH + r.runH)} y={116} width={Math.max(0, xh(inH + r.runH + outH) - xh(inH + r.runH))} height={16} fill={GRAPHIC.blue} />
      <text x={142} y={128} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
        copy · run · copy
      </text>
      {Number.isFinite(job.deadlineHours) && (
        <g>
          <line x1={xh(job.deadlineHours)} x2={xh(job.deadlineHours)} y1={110} y2={140} stroke={GRAPHIC.teal} strokeWidth={2} strokeDasharray="5 4" />
          <text x={xh(job.deadlineHours)} y={156} textAnchor="middle" style={{ fontSize: 12, fill: TEXT.teal }}>
            deadline {hoursText(job.deadlineHours)}
          </text>
        </g>
      )}
      <text className="ax" x={150} y={172}>
        0 h
      </text>
    </svg>
  );
}

const WHY_TEXT: Record<string, string> = {
  moves: 'moves',
  'too far from users': 'stays: too far from its users',
  'misses its deadline': 'stays: the copy would miss its deadline',
  'costs more to move': 'stays: egress outweighs the saving',
  'link busy': 'stays: no link time left today',
};

function DayChart({ day }: { day: DaySchedule }) {
  const rowH = 30;
  const top = 34;
  const x = scale(0, 24, 214, 452);
  const h = top + day.rows.length * rowH + 22;
  const label = day.rows.map((r) => `${r.job.name}: ${WHY_TEXT[r.why]}${r.decision === 'move' ? `, saving ${money(r.result.saving)}, copying from hour ${fmt(r.copyStart, 1)}` : ''}`).join('; ');
  return (
    <svg className="chart" viewBox={`0 0 640 ${h}`} role="img" aria-label={`A day of jobs at Tech Park. ${label}. The link copies for ${hoursText(day.linkHours)}.`}>
      <text className="ax" x={0} y={14}>
        Job
      </text>
      <text className="ax" x={214} y={14}>
        The link’s day: copies queued, hour 0 to 24
      </text>
      <text className="ax ax-e" x={640} y={14}>
        Saving if moved
      </text>
      {[0, 6, 12, 18, 24].map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'gl'} x1={x(t)} x2={x(t)} y1={top - 6} y2={h - 22} />
          <text className="ax ax-m" x={x(t)} y={h - 6}>
            {t} h
          </text>
        </g>
      ))}
      {day.rows.map((r, i) => {
        const y = top + i * rowH;
        const moved = r.decision === 'move';
        const start = Math.min(24, r.copyStart);
        const end = Math.min(24, r.copyStart + r.linkHours);
        return (
          <g key={r.job.id}>
            <text x={0} y={y + 11} style={{ fontSize: 13, fontWeight: moved ? 600 : 400, fill: '#222' }}>
              {r.job.name}
            </text>
            <text x={0} y={y + 25} className="ax">
              {fmt(r.job.gpuHours)} GPU-h · {r.job.dataInTB > 0 ? tbText(r.job.dataInTB + r.job.dataOutTB) : 'no data to move'}
            </text>
            {moved ? (
              <rect x={x(start)} y={y + 2} width={Math.max(2, x(end) - x(start))} height={16} fill={GRAPHIC.blue} />
            ) : (
              <text x={x(0) + 4} y={y + 15} style={{ fontSize: 12, fill: '#777' }}>
                {WHY_TEXT[r.why]}
              </text>
            )}
            <text x={640} y={y + 15} textAnchor="end" style={{ fontSize: 13, fill: moved ? TEXT.green : '#999' }}>
              {r.result.feasible ? signedMoney(r.result.saving) : '—'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario('job', JOB_DEFAULTS);
  const st = s1.state;
  const job = jobOf(st);
  const r = runJob(st);
  const route = routeOf(st);
  const m = marketAtLatency(st.lat);
  const gap = m.prices.techpark.A - m.prices.northfield.A;
  const outShare = job.dataInTB > 0 ? job.dataOutTB / job.dataInTB : 0;
  const be = job.dataInTB > 0 ? breakEvenDataTB(job, route, outShare) : Infinity;
  const solvedA = largestSolved(st);

  const s2 = useScenario('day', DAY_DEFAULTS);
  const dt = s2.state;
  const day = useMemo(() => dayOf(dt), [dt]);
  const worth = useMemo(() => worthMoving(dt), [dt]);
  const solvedB = slowestSolved(dt);

  const caption1 = !r.feasible
    ? r.reason?.includes('deadline')
      ? `Copying ${tbText(job.dataInTB + job.dataOutTB)} over ${fmt(LINKS[st.link])} Gb/s takes ${hoursText(r.transferH)}; with ${hoursText(r.runH)} of running, the job would miss its ${hoursText(job.deadlineHours)} deadline.`
      : `${JOB_LABEL[st.job]} answers people and tolerates ${job.maxRttMs} ms; Northfield is ${SITES.northfield.rttMs} ms away, so it can’t move at any price.`
    : gap <= 0.005
      ? `The assistants can now reach Northfield, so an A-class hour costs ${usd(m.prices.northfield.A, 2)} at both sites. Moving only adds ${money(r.egressCost)} of egress.`
      : r.saving > 0
        ? `Moving saves ${money(r.saving)}: ${fmt(job.gpuHours)} GPU-hours at ${usd(gap, 2)} less each, minus ${money(r.egressCost)} of egress. It stops paying above ${tbText(be)} of data.`
        : `Egress of ${money(r.egressCost)} outweighs the ${money(job.gpuHours * gap)} saved on GPU-hours: the data is too heavy to move.`;

  const statusA = (() => {
    if (st.job !== 'pretrain') return 'Choose the pretraining slice first.';
    if (st.link !== JOB_DEFAULTS.link || st.egress !== JOB_DEFAULTS.egress) return `Set the link back to ${fmt(LINKS[JOB_DEFAULTS.link])} Gb/s and egress to ${JOB_DEFAULTS.egress}¢ per GB.`;
    if (st.lat >= SITES.northfield.rttMs) return `At ${st.lat} ms the assistants can reach Northfield and the price gap is gone. Bring the limit back under ${SITES.northfield.rttMs} ms.`;
    if (!r.feasible || r.saving <= 0) return `At ${tbText(job.dataInTB)} moving no longer saves money (${signedMoney(r.saving)}). Try a smaller dataset.`;
    return `At ${tbText(job.dataInTB)} moving still saves ${money(r.saving)}. Could a bigger dataset still pay?`;
  })();

  const statusB = (() => {
    if (!worth.length) return 'With these settings no job is worth moving at all. Tighten the assistants’ latency limit or lower the fee.';
    const missing = worth.filter((id) => day.rows.find((row) => row.job.id === id)!.decision !== 'move');
    if (missing.length) return `At ${fmt(LINKS[dt.link])} Gb/s, ${missing.length} of the ${worth.length} jobs worth moving stay home.`;
    return `At ${fmt(LINKS[dt.link])} Gb/s every job worth moving moves. Would a slower link do?`;
  })();

  return (
    <LessonPage id="compute/6.3">
      <P>
        The previous lesson decided how much capacity a buyer should commit to. This one asks where the work should run.{' '}
        <a href={lessonHref('compute/5.5')}>Lesson 5.5</a> left a gap in the market: with the chat
        and frontier assistants accepting a {REF_LAT} ms round trip, an A-class hour at Tech Park cleared at <K c="price">{usd(N.near, 2)}</K> and the same
        hour in Northfield at {usd(N.far, 2)}, a difference of {usd(N.gap, 2)}. Nothing about the chips explains it. Northfield
        is {SITES.northfield.rttMs} ms of round trip from the users, too far for replies that people are waiting on (<a href={lessonHref('compute/3.4')}>Lesson 3.4</a>), so its
        GPUs can serve only work that nobody is waiting on, and the least valuable of that work, the overnight batch, sets their price. Its cheap hydro power, its cold air
        (<a href={lessonHref('compute/4.3')}>Lesson 4.3</a>) and its room to grow (<a href={lessonHref('compute/4.2')}>Lesson 4.2</a>) only add to the supply.
      </P>
      <P>
        Work that doesn’t need to be near its users can follow the cheap hours. Buying a good where it is cheap and using it where it would be dear is arbitrage, and here the
        good is a GPU-hour and the trip is the job’s. But a job brings its data. Before a training run can start in Northfield, its training data and its latest checkpoint
        must be copied there, and its results copied back. The copy takes time — the dataset’s size divided by the speed of the wide-area <K tone="blue">link</K> between the
        sites, the same arithmetic as the GPU links of <a href={lessonHref('compute/2.5')}>Lesson 2.5</a>, at a much larger scale — and it can cost money: fees of a few cents
        per gigabyte are common for data leaving a cloud region, called <K c="price">egress</K>. Ours is a simulated 5¢ per GB.
      </P>
      <P>
        In the next demonstration, a job at Tech Park can stay or move to Northfield. The sites sit at their round trip from the users, as in Lesson 5.5, with each one’s
        A-class price; the arc is the link, carrying the job’s data when moving pays. Below, the bars compare what the job costs at home with what it costs away, egress
        included, and the timeline checks that the copies leave time to finish by the deadline. Choose a job, then change its dataset, the link, the egress fee, and the round
        trip the assistants accept — which decides the prices:
      </P>

      <Figure name="Multi-Region Scheduler" scenario={s1}>
        <Segmented
          label="Job"
          value={st.job}
          onChange={(j) => s1.set({ job: j, data: defaultData(j) })}
          options={JOB_IDS.map((id) => ({ value: id, label: JOB_LABEL[id] }))}
        />
        <RouteMap s={st} r={r} job={job} />
        <CostChart r={r} job={job} />
        <Readouts
          items={[
            { label: 'saved by moving', value: r.feasible ? signedMoney(r.saving) : 'can’t move', tone: r.feasible && r.saving > 0 ? 'green' : 'red' },
            { label: 'copying there and back', value: hoursText(r.transferH), tone: 'blue' },
            { label: 'egress fees', value: money(r.egressCost), tone: 'green' },
            { label: 'moving stops paying above', value: Number.isFinite(be) ? tbText(be) : '—', tone: 'blue' },
          ]}
        />
        <Slider
          label="Data to copy in"
          tone="blue"
          value={st.data}
          min={0}
          max={DATA_TB.length - 1}
          disabled={st.job === 'chat'}
          onChange={(data) => s1.set({ data })}
          display={st.job === 'chat' ? '—' : tbText(DATA_TB[st.data])}
        />
        <Slider label="Wide-area link" tone="blue" value={st.link} min={0} max={LINKS.length - 1} onChange={(link) => s1.set({ link })} display={`${fmt(LINKS[st.link])} Gb/s`} />
        <Slider label="Egress fee" tone="green" value={st.egress} min={0} max={12} onChange={(egress) => s1.set({ egress })} display={`${st.egress}¢ per GB`} />
        <Slider label="Assistants accept" tone="teal" value={st.lat} min={10} max={60} onChange={(lat) => s1.set({ lat })} display={`${st.lat} ms round trip`} />
        <Caption>{caption1}</Caption>
      </Figure>

      <P>
        It starts with a slice of a pretraining run: {fmt(N.preGpuHours)} GPU-hours on {fmt(N.preGpus)} A-class GPUs, about {fmt(N.preRunH / 24)} days of running, with{' '}
        {tbText(N.preIn)} of data and checkpoints to copy in and {tbText(N.preOut)} of checkpoints to copy back. At Tech Park it costs {money(N.preStay)}. In Northfield the same
        GPU-hours cost {money(N.preMoveGpu)}, the egress {money(N.preEgress)}, and the job saves {money(N.preSaving)}. Over a 100 Gb/s link the copies take{' '}
        {hoursText(N.preCopyH)}, against more than a week of computing: for a training run, the data is light.
      </P>
      <P>
        Data has weight, though, and at some size it holds a job in place. The egress fee grows with every terabyte, while the saving is fixed by the job’s GPU-hours, so
        moving this job stops paying at about {tbText(N.preBreakEven)} of input — a dataset more than seventy times the one it has.
      </P>

      <Challenge
        id="a"
        question="Moving the pretraining slice over the 100 Gb/s link at 5¢ per GB, with Northfield still out of the assistants’ reach, find the largest dataset on the slider that still saves money."
        solved={solvedA}
        status={statusA}
        success={`Solved. At ${tbText(N.preBestTB)} moving still saves ${money(N.preBestSaving)}; at ${tbText(N.preNextTB)} the egress outweighs the ${usd(N.gap, 2)}-an-hour gap and moving costs ${money(-N.preNextSaving)} more. The exact break-even is about ${tbText(N.preBreakEven)}: the GPU-hours saved, divided by what each terabyte costs to send there and back.`}
      />

      <H2>Work that can’t travel</H2>
      <P>
        Now choose the chat assistant. It runs {fmt(baseJob('chat').gpuHours)} GPU-hours a day, so moving it would save {money(N.chatSaving)} a day — but it answers
        people, who notice every millisecond of round trip on top of the wait for a reply, and it accepts at most {baseJob('chat').maxRttMs} ms. Northfield’s {SITES.northfield.rttMs} ms rule it out at any
        price. Most interactive work is like this: the latency limit is not a preference that a discount can buy off.
      </P>
      <P>
        Deadlines bind in a different way. The overnight summaries must be done in {hoursText(N.batchDeadline)}; they take {hoursText(N.batchRunH)} to run on 500 GPUs, and
        their documents and summaries, {tbText(N.batchIn)} in all, must cross the link first and last. Over 10 Gb/s the copies alone would take {hoursText(N.batchCopy10)}, and
        the job would miss its morning. It takes a link of at least {fmt(N.batchSlowestLink)} Gb/s on the slider to move it in time, and then it saves{' '}
        {money(N.batchSaving)}. A fast link is what turns a price gap into an opportunity for short jobs.
      </P>
      <P>
        Then break the opportunity at its source. Loosen the round trip the assistants accept to {SITES.northfield.rttMs} ms, Northfield’s own distance. They can now be served
        from Northfield, the market of Lesson 5.5 sends some of their work there, and the gap closes: an A-class hour costs {usd(N.open, 2)} at Tech Park and{' '}
        {usd(N.openFar, 2)} in Northfield. Moving the pretraining slice now only costs its egress, {money(-N.preOpenSaving)}. The arbitrage existed because of a physical
        limit on where some work can run; take the limit away and the opportunity goes with it.
      </P>
      <P>
        Moving work also erodes the gap on its own. Each job sent to Northfield is more demand there and less at Tech Park, and, just as building GPUs near the users did in
        Lesson 5.5, enough of it would pull the two prices together. A single job, small next to the market, can take the prices as given; a cloud that moves everything that
        can move is changing them.
      </P>

      <H2>A day of jobs on one link</H2>
      <P>
        A real scheduler faces many jobs at once, and they share the link. In the next demonstration, eight jobs start the day at Tech Park, from the pretraining slice to the
        chat and code-completion services. The scheduler first drops the jobs that can’t move or wouldn’t save money even with the link to themselves. Of the rest, it takes
        the ones that save the most per hour of link time, as long as today’s 24 hours of link time last, and queues their copies so the jobs with the least time to spare
        go first; a job whose data couldn’t arrive in time to meet its deadline stays home. Each bar is a copy on the link’s day. Change the link, the fee and the
        assistants’ latency limit:
      </P>

      <Figure name="Multi-Region Scheduler · a day of jobs" scenario={s2}>
        <DayChart day={day} />
        <Readouts
          items={[
            { label: 'saved today', value: money(day.saving), tone: 'green' },
            { label: 'jobs moved', value: `${day.moved} of ${DAY_JOBS.length}` },
            { label: 'of the day’s GPU bill', value: pct(day.stayTotal > 0 ? day.saving / day.stayTotal : 0), tone: 'green' },
            { label: 'link busy copying', value: hoursText(day.linkHours), tone: 'blue' },
          ]}
        />
        <Slider label="Wide-area link" tone="blue" value={dt.link} min={0} max={LINKS.length - 1} onChange={(link) => s2.set({ link })} display={`${fmt(LINKS[dt.link])} Gb/s`} />
        <Slider label="Egress fee" tone="green" value={dt.egress} min={0} max={12} onChange={(egress) => s2.set({ egress })} display={`${dt.egress}¢ per GB`} />
        <Slider label="Assistants accept" tone="teal" value={dt.lat} min={10} max={60} onChange={(lat) => s2.set({ lat })} display={`${dt.lat} ms round trip`} />
      </Figure>

      <P>
        With a 100 Gb/s link, the scheduler moves {N.dayMoved} jobs and saves {money(N.daySaving)}, {pct(N.daySaving / N.dayStay)} of the{' '}
        {money(N.dayStay)} that all eight would cost at home, while the link spends {hoursText(N.dayLinkH)} copying. The video library stays: transcribing it on cheaper GPUs
        would save {money(N.videoGapSaving)}, but sending its {tbText(N.videoTB)} costs {money(N.videoEgress)} in egress. The embedding job, with a larger share of results to
        send back, saves only {money(N.embedSaving)}, and at 9¢ per GB it stays too, leaving {N.highFeeMoved} jobs moving. The two services stay whatever the settings.
      </P>
      <P>
        Now slow the link. At 10 Gb/s the scheduler can still move {N.daySlowMoved} jobs and save {money(N.daySlowSaving)} — the pretraining slice carries most of the day’s
        value, and it isn’t in a hurry — but the overnight summaries can’t make their deadline. At 1 Gb/s even the pretraining slice’s data no longer fits in a day of link
        time, and only {N.day1Moved} small jobs move, for {money(N.day1Saving)}.
      </P>

      <Challenge
        id="b"
        figure="Multi-Region Scheduler · a day of jobs"
        question="Find the slowest link on the slider at which the scheduler moves every job that is worth moving."
        solved={solvedB}
        status={statusB}
        success={`Solved. At ${fmt(LINKS[dt.link])} Gb/s every job that saves money on its own gets its data across in time; one step slower, the queue on the link makes at least one of them miss its deadline or run out of link time. At the starting fee and latency limit the answer is ${fmt(N.slowestAllLink)} Gb/s.`}
      />

      <H2>What the strategy rests on</H2>
      <P>
        Every part of this strategy can be traced to a physical cause. The price gap exists because interactive work must be near its users (
        <a href={lessonHref('compute/3.4')}>Lesson 3.4</a>), the sites near them are short of megawatts (<a href={lessonHref('compute/4.2')}>Lesson 4.2</a>), and Northfield has
        power, cold air and room (<a href={lessonHref('compute/4.3')}>Lesson 4.3</a>). Which work can exploit it depends on its round-trip limit, its deadline and its data, and
        how much of it can move each day is set by the bandwidth between the sites (<a href={lessonHref('compute/2.5')}>Lessons 2.5</a> and{' '}
        <a href={lessonHref('compute/4.4')}>4.4</a>). Change any of them in <FigRef to="Multi-Region Scheduler">the first demonstration</FigRef> and the opportunity grows,
        shrinks or vanishes. Real clouds weigh more than we have: laws that keep some data in one jurisdiction, the security of moving it, and the engineering of running one
        job across two sites. But the arithmetic of price gap against data and deadline is the core of it.
      </P>
      <P>
        Northfield’s cheap electricity helped make its hours cheap, but electricity was only a few percent of what an hour costs to produce (
        <a href={lessonHref('compute/4.5')}>Lesson 4.5</a>). Its price also changes hour by hour. The next lesson asks how much a GPU cloud can gain by timing its work, and its
        power, to that price.
      </P>
    </LessonPage>
  );
}
