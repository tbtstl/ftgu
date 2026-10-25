import { useMemo, useState } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
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
  Tn,
  fmt,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  pct,
  scale,
  tint,
  useAnimationFrame,
  usePlay,
  useScenario,
} from '../../../framework';
import { maxBatch, prefillS, servingPoint, tensorParallelS, type ServeConfig } from '../../../engines/compute/inference';
import { simulateServing, type SchedResult } from '../../../engines/compute/scheduling';
import { ACCELERATORS } from '../../../model/compute/hardware';
import { WORKLOADS, type ServingWorkload } from '../../../model/compute/workloads';

// ---------------------------------------------------------------------------
// The server: one copy of the 70B model split over four A-class GPUs, as in Lesson 3.2, serving
// prompts of 1,000 tokens with replies that average 300 (anywhere from 150 to 450).

export const SERVE: ServeConfig = { model: '70B', gpu: 'A', tp: 4, precision: 'bf16' };
export const INPUT = 1000;
export const OUTPUT = 300;
/** Simulated time for each run, s. */
export const SECONDS = 120;
/** Requests that fit in memory with every reply at its longest (450 tokens): the simulation's own cap. */
export const CAP_MAX = maxBatch(SERVE, INPUT + Math.ceil(OUTPUT * 1.5));
/** Requests that fit if every reply were the average length, as in Lesson 3.2. */
export const CAP_AVERAGE = maxBatch(SERVE, INPUT + OUTPUT);

/**
 * The service's promise is the chat assistant's, kept from Lesson 3.2's challenge to Lesson 3.5: 95% of requests see a
 * first token within 1.5 s, and tokens come at least every 40 ms.
 */
const CHAT = WORKLOADS.chat70 as ServingWorkload;
export const TTFT_LIMIT = CHAT.ttftMax;
export const TPOT_LIMIT = CHAT.tpotMax;

export const RATE_MIN = 0.5;
export const RATE_MAX = 20;
export const RATE_STEP = 0.5;

export const LAB_DEFAULTS = { rate: 4, cap: 64 };
export const CURVE_DEFAULTS = { rate: 8 };

const cache = new Map<string, SchedResult>();

/** The server under `rate` requests a second with at most `cap` decoding at once (memoized). */
export function runLab(rate: number, cap: number): SchedResult {
  const key = `${rate}|${cap}`;
  let r = cache.get(key);
  if (!r) {
    r = simulateServing({ serve: SERVE, arrivalsPerS: rate, maxBatch: cap, input: INPUT, outputMean: OUTPUT, seconds: SECONDS });
    if (cache.size > 600) cache.clear();
    cache.set(key, r);
  }
  return r;
}

/** Whether a run keeps the service's promise (and its queue isn't growing). */
export function meetsLimits(r: SchedResult): boolean {
  return !r.overloaded && r.ttftP95 <= TTFT_LIMIT && r.tpot <= TPOT_LIMIT;
}

/**
 * The highest arrival rate on the slider's grid that some max batch can serve within the limits, in this one seeded
 * two-minute sample of arrivals (checked in the tests; other samples put it a little higher).
 */
export const BEST_RATE = 7.5;
/** At that rate, the max batches that work: every one from the first to the slider's end. */
export const BEST_CAPS: [number, number] = [91, 309];
/** The max batch whose run the prose quotes at the best rate. */
export const BEST_SHOWN_CAP = 256;

/** The challenge: within the limits at the best rate on the grid (no higher rate on the slider keeps them). */
export function rateSolved(rate: number, cap: number): boolean {
  return rate >= BEST_RATE - 1e-9 && meetsLimits(runLab(rate, cap));
}

/** The server flat out: arrivals at the slider's top, the most its memory holds decoding, the queue unlimited. */
export function flatOut(): SchedResult {
  return runLab(RATE_MAX, CAP_MAX);
}

/** Requests a second the server finishes flat out (each writes OUTPUT tokens on average). */
export function flatOutRequests(): number {
  return flatOut().throughput / OUTPUT;
}

/** Max batches shown as curves in the second demonstration. */
export const CURVE_CAPS = [16, 64, 256];
/** Arrival rates swept for the curves. */
export const CURVE_RATES = [0.5, ...Array.from({ length: 20 }, (_, i) => i + 1)];

/** Time the four GPUs spend reading one 1,000-token prompt, s. */
export const PREFILL_S = prefillS(SERVE, INPUT);
/** Of that, the time spent exchanging partial results between the GPUs, s; the rest is arithmetic. */
export const PREFILL_EXCHANGE_S = tensorParallelS(SERVE, INPUT);

// ---------------------------------------------------------------------------
// Formatting.

function secs(s: number): string {
  if (s < 1) return `${fmt(s, 2)} s`;
  if (s < 10) return `${fmt(s, 1)} s`;
  return `${fmt(s)} s`;
}

function ms(s: number): string {
  return `${fmt(s * 1e3, s < 0.1 ? 1 : 0)} ms`;
}

function rateText(r: number): string {
  return Number.isInteger(r) ? fmt(r) : fmt(r, 1);
}

/** "40 ms", "1.5 s": the promise's limits. */
const TPOT_TEXT = `${fmt(TPOT_LIMIT * 1e3)} ms`;
const TTFT_TEXT = `${rateText(TTFT_LIMIT)} s`;

const QUEUE = GRAPHIC.teal;
const BATCH = '#333333';

/** The status of a run in one sentence. */
export function labCaption(r: SchedResult, rate: number, cap: number): string {
  if (r.overloaded)
    return `Requests arrive faster than the server finishes them: with at most ${fmt(cap)} decoding, it produces ${fmt(r.throughput)} tokens a second, and the queue grows the whole time (${fmt(r.waitingAtEnd)} waiting at the end).`;
  const tpotOver = r.tpot > TPOT_LIMIT;
  const ttftOver = r.ttftP95 > TTFT_LIMIT;
  if (tpotOver && ttftOver) return `The queue keeps up, but both promises are broken: tokens come every ${ms(r.tpot)} and 5% of requests wait over ${secs(r.ttftP95)} to start.`;
  if (tpotOver) return `The queue keeps up, but the batch averages ${fmt(r.meanBatch)} and prompts keep interrupting it, so tokens come every ${ms(r.tpot)}: slower than the ${TPOT_TEXT} promised.`;
  if (ttftOver) return `Tokens come every ${ms(r.tpot)}, but the queue backs up at busy moments: 5% of requests wait over ${secs(r.ttftP95)} for their first token.`;
  return `At ${rateText(rate)} requests a second the batch averages ${fmt(r.meanBatch)}. Both promises are kept: 95% of requests start within ${secs(r.ttftP95)}, and tokens come every ${ms(r.tpot)}.`;
}

// ---------------------------------------------------------------------------
// First demonstration: the queue and the batch at a moment, and both over 120 s.

const SPEED = 6; // simulated seconds per real second

function LabView({ r, cap, playing }: { r: SchedResult; cap: number; playing: boolean }) {
  const [t, setT] = useState(0);
  useAnimationFrame((dt) => setT((x) => (x + dt * SPEED >= SECONDS ? 0 : x + dt * SPEED)), playing);
  const i = Math.min(r.series.length - 1, Math.max(0, Math.floor(t)));
  const now = r.series[i] ?? { t: 0, batch: 0, queue: 0 };

  // The moment: a queue of dots and the server's batch slots, side by side in one band.
  const cols = Math.max(1, Math.min(24, Math.ceil(Math.sqrt(cap * 2))));
  const rows = Math.ceil(cap / cols);
  const cell = Math.min(16, Math.floor(130 / rows), Math.floor(250 / cols));
  const gridW = cols * cell;
  const gridH = rows * cell;
  const gx = 612 - gridW;
  const bandTop = 36;
  const bandH = Math.max(gridH + 12, 80);
  const gy = bandTop + (bandH - gridH) / 2;
  const mid = bandTop + bandH / 2;
  const laneRight = gx - 40;
  const shownQ = Math.min(now.queue, 48);
  const qCols = 12;
  const qRows = Math.max(1, Math.ceil(shownQ / qCols));
  const height = bandTop + bandH + 28;

  // The run over time.
  const maxQ = Math.max(...r.series.map((s) => s.queue));
  const maxB = Math.max(...r.series.map((s) => s.batch));
  const [, yTop] = niceDomain(0, Math.max(cap, maxQ, maxB, 4), 4);
  const X = scale(0, SECONDS, 56, 620);
  const Y = scale(0, yTop, 168, 24);
  const xs = r.series.map((s) => X(s.t + 0.5));
  const qPath = linePath(xs, r.series.map((s) => Y(s.queue)));
  const qArea = `${qPath} L${X(SECONDS)} ${Y(0)} L${X(0)} ${Y(0)} Z`;
  const bPath = linePath(xs, r.series.map((s) => Y(s.batch)));

  return (
    <>
      <svg
        className="diagram"
        viewBox={`0 0 640 ${height}`}
        role="img"
        aria-label={`At ${fmt(i)} s into the run: ${fmt(now.batch)} requests decoding, out of at most ${fmt(cap)}, and ${fmt(now.queue)} waiting.`}
      >
        <text className="ax" x={24} y={24}>
          Waiting · {fmt(now.queue)}
        </text>
        <rect x={24} y={bandTop} width={laneRight - 24} height={bandH} rx={6} fill="none" stroke="#d9d9d5" strokeDasharray="4 4" />
        {Array.from({ length: shownQ }, (_, k) => {
          const col = k % qCols;
          const row = Math.floor(k / qCols);
          return <circle key={k} cx={laneRight - 14 - col * 14} cy={mid - (qRows - 1) * 8 + row * 16} r={5} fill={QUEUE} />;
        })}
        {now.queue > shownQ && (
          <text className="ax" x={32} y={bandTop + bandH - 8} style={{ fill: TEXT.teal }}>
            +{fmt(now.queue - shownQ)} more
          </text>
        )}
        <path d={`M${laneRight + 6} ${mid} L${gx - 10} ${mid}`} stroke="#9a9a9a" strokeWidth={1.5} />
        <path d={`M${gx - 16} ${mid - 5} L${gx - 10} ${mid} L${gx - 16} ${mid + 5}`} fill="none" stroke="#9a9a9a" strokeWidth={1.5} />
        <rect x={gx - 6} y={gy - 6} width={gridW + 12} height={gridH + 12} rx={6} fill="none" stroke="#bdbdb8" />
        <text className="ax" x={gx - 6} y={24}>
          Decoding · {fmt(now.batch)} of at most {fmt(cap)}
        </text>
        {Array.from({ length: cap }, (_, k) => {
          const col = k % cols;
          const row = Math.floor(k / cols);
          const on = k < now.batch;
          return (
            <rect
              key={k}
              x={gx + col * cell + 1}
              y={gy + row * cell + 1}
              width={cell - 2}
              height={cell - 2}
              rx={1.5}
              fill={on ? BATCH : 'none'}
              stroke={on ? 'none' : '#d9d9d5'}
            />
          );
        })}
        <text className="ax ax-e" x={612} y={bandTop + bandH + 20}>
          four A-class 80 GB GPUs · the 70B model
        </text>
        <text className="ax" x={24} y={bandTop + bandH + 20}>
          {fmt(i)} s into the run
        </text>
      </svg>
      <svg
        className="chart"
        viewBox="0 0 640 196"
        role="img"
        aria-label={`Over ${fmt(SECONDS)} s: the batch averages ${fmt(r.meanBatch)} requests and peaks at ${fmt(maxB)}; the queue peaks at ${fmt(maxQ)} waiting${r.overloaded ? ' and is still growing at the end' : ''}.`}
      >
        <text className="ax" x={56} y={12}>
          Requests, second by second
        </text>
        <GridY y={Y} ticks={niceTicks(0, yTop, 4)} x0={56} x1={620} format={(v) => fmt(v)} baseline={0} />
        <path d={qArea} fill={tint(QUEUE, 0.25)} />
        <path d={qPath} fill="none" stroke={QUEUE} strokeWidth={1.5} />
        <line x1={56} x2={620} y1={Y(cap)} y2={Y(cap)} stroke="#9a9a9a" strokeDasharray="5 4" />
        <text className="ax ax-e" x={618} y={Y(cap) - 5}>
          max batch {fmt(cap)}
        </text>
        <path d={bPath} fill="none" stroke={BATCH} strokeWidth={2} strokeLinejoin="round" />
        <line className="cur" x1={X(t)} x2={X(t)} y1={20} y2={168} />
        {[0, 30, 60, 90, 120].map((s) => (
          <text key={s} className={s === SECONDS ? 'ax ax-e' : 'ax ax-m'} x={X(s)} y={186}>
            {s === SECONDS ? '120 s' : `${s}`}
          </text>
        ))}
      </svg>
      <Legend
        items={[
          { label: 'Requests decoding (the batch)', color: BATCH, kind: 'line' },
          { label: 'Requests waiting (the queue)', color: QUEUE },
          { label: 'Max batch', color: '#9a9a9a', kind: 'line', dashed: true },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Second demonstration: waiting and token time against throughput as arrivals rise.

const CURVE_COLOR: Record<number, string> = { 16: GRAPHIC.gold, 64: GRAPHIC.violet, 256: GRAPHIC.blue };

interface CurvePoint {
  rate: number;
  r: SchedResult;
}

function TradeoffCharts({ curves, rate }: { curves: Array<{ cap: number; points: CurvePoint[] }>; rate: number }) {
  const X = scale(0, 3500, 64, 612);
  const lo = Math.log10(0.05);
  const hi = Math.log10(200);
  const Y1 = (s: number) => 150 - ((Math.log10(Math.max(0.05, Math.min(200, s))) - lo) / (hi - lo)) * 126;
  const Y2 = scale(0, 100, 312, 214);
  const at = (pts: CurvePoint[]) => pts.find((p) => p.rate === rate) ?? pts[pts.length - 1];
  const summary = curves.map((c) => {
    const p = at(c.points).r;
    return `max batch ${c.cap}: ${fmt(p.throughput)} tokens a second, first token within ${secs(p.ttftP95)} for 95%, ${ms(p.tpot)} per token${p.overloaded ? ', queue growing' : ''}`;
  });
  return (
    <svg className="chart" viewBox="0 0 640 352" role="img" aria-label={`At ${rateText(rate)} requests a second — ${summary.join('; ')}.`}>
      <text className="ax" x={64} y={12}>
        Time to first token, 95th percentile (log scale)
      </text>
      {[0.1, 1, 10, 100].map((v) => (
        <g key={v}>
          <line className="gl" x1={64} x2={612} y1={Y1(v)} y2={Y1(v)} />
          <text className="ax ax-e" x={58} y={Y1(v) + 4}>
            {v} s
          </text>
        </g>
      ))}
      <line className="base" x1={64} x2={612} y1={150} y2={150} />
      <line x1={64} x2={612} y1={Y1(TTFT_LIMIT)} y2={Y1(TTFT_LIMIT)} stroke={GRAPHIC.red} strokeDasharray="5 4" />
      <text className="ax" x={68} y={Y1(TTFT_LIMIT) - 5} style={{ fill: TEXT.red }}>
        {TTFT_TEXT} promise
      </text>
      <text className="ax" x={64} y={200}>
        Time per output token
      </text>
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line className={v === 0 ? 'base' : 'gl'} x1={64} x2={612} y1={Y2(v)} y2={Y2(v)} />
          <text className="ax ax-e" x={58} y={Y2(v) + 4}>
            {v} ms
          </text>
        </g>
      ))}
      <line x1={64} x2={612} y1={Y2(TPOT_LIMIT * 1000)} y2={Y2(TPOT_LIMIT * 1000)} stroke={GRAPHIC.red} strokeDasharray="5 4" />
      <text className="ax" x={68} y={Y2(TPOT_LIMIT * 1000) - 5} style={{ fill: TEXT.red }}>
        {TPOT_TEXT} promise
      </text>
      {[...curves].reverse().map((c) => {
        const xs = c.points.map((p) => X(p.r.throughput));
        const p = at(c.points);
        const end = c.points[c.points.length - 1];
        return (
          <g key={c.cap}>
            <path d={linePath(xs, c.points.map((q) => Y1(q.r.ttftP95)))} fill="none" stroke={CURVE_COLOR[c.cap]} strokeWidth={2} strokeLinejoin="round" />
            <path d={linePath(xs, c.points.map((q) => Y2(Math.min(100, q.r.tpot * 1000))))} fill="none" stroke={CURVE_COLOR[c.cap]} strokeWidth={2} strokeLinejoin="round" />
            <circle cx={X(p.r.throughput)} cy={Y1(p.r.ttftP95)} r={5.5} fill={p.r.overloaded ? '#fcfcfb' : CURVE_COLOR[c.cap]} stroke={CURVE_COLOR[c.cap]} strokeWidth={2} />
            <circle cx={X(p.r.throughput)} cy={Y2(Math.min(100, p.r.tpot * 1000))} r={5.5} fill={p.r.overloaded ? '#fcfcfb' : CURVE_COLOR[c.cap]} stroke={CURVE_COLOR[c.cap]} strokeWidth={2} />
            <text className="lab" x={X(end.r.throughput) + 6} y={Y1(end.r.ttftP95) + 4} style={{ fill: CURVE_COLOR[c.cap] }}>
              {c.cap}
            </text>
          </g>
        );
      })}
      {[0, 1000, 2000, 3000].map((v) => (
        <text key={v} className="ax ax-m" x={X(v)} y={330}>
          {fmt(v)}
        </text>
      ))}
      <text className="ax ax-e" x={612} y={346}>
        throughput, output tokens per second
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const lab = useScenario('scheduling', LAB_DEFAULTS);
  const { rate, cap } = lab.state;
  const play = usePlay(true);
  const r = useMemo(() => runLab(rate, cap), [rate, cap]);
  const solved = rateSolved(rate, cap);
  const ok = meetsLimits(r);

  const cv = useScenario('tradeoff', CURVE_DEFAULTS);
  const curves = useMemo(() => CURVE_CAPS.map((c) => ({ cap: c, points: CURVE_RATES.map((q) => ({ rate: q, r: runLab(q, c) })) })), []);
  const curveRate = cv.state.rate;
  const rows = curves.map((c) => ({ cap: c.cap, r: (c.points.find((p) => p.rate === curveRate) ?? c.points[0]).r }));

  // Numbers for the prose, all from the engines.
  const g = ACCELERATORS.A;
  const alone = servingPoint(SERVE, 1, INPUT, OUTPUT);
  const full = servingPoint(SERVE, CAP_AVERAGE, INPUT, OUTPUT);
  const start = runLab(LAB_DEFAULTS.rate, LAB_DEFAULTS.cap);
  const jam = runLab(8, 64);
  const open = runLab(8, 256);
  const steadyAtOpen = servingPoint(SERVE, Math.round(open.meanBatch), INPUT, OUTPUT);
  const best = runLab(BEST_RATE, BEST_SHOWN_CAP);
  const flat = flatOut();
  const flatRequests = flatOutRequests();
  const littleWait = OUTPUT * open.tpot;
  const busyShare = 8 * PREFILL_S;
  const capacity = curves.map((c) => Math.max(...c.points.map((p) => p.r.throughput)));
  const gpuHoursAt = (tokensPerS: number) => (SERVE.tp * 1e6) / (tokensPerS * 3600);
  const ghText = (tokensPerS: number) => fmt(gpuHoursAt(tokensPerS), 3);

  const status = r.overloaded
    ? `At ${rateText(rate)} requests a second with a max batch of ${fmt(cap)}, the queue grows without end.`
    : !ok
      ? `At ${rateText(rate)} a second: 95% start within ${secs(r.ttftP95)}, tokens every ${ms(r.tpot)} — ${r.tpot > TPOT_LIMIT ? 'too slow between tokens' : 'too long a wait to start'}.`
      : `${rateText(rate)} requests a second are served within both promises. Can the server take more?`;

  return (
    <LessonPage id="compute/3.4">
      <P>
        The training run of <a href={lessonHref('compute/3.3')}>the previous lesson</a> is one enormous job: a fixed block of GPUs, kept busy for weeks, with no one
        waiting on any single step. Serving a model is the opposite. Requests arrive one at a time, at moments nobody chooses, and behind each one a person is waiting
        for the reply to appear. This lesson is about what that randomness does to a server — and to how much of it can be put to use.
      </P>
      <P>
        <a href={lessonHref('compute/3.2')}>Lesson 3.2</a> found the lever. One copy of the 70B model on four A-class 80 GB GPUs writes {fmt(alone.tokensPerS)}{' '}
        tokens a second for a single request, one every {ms(alone.tpot)}. With {fmt(CAP_AVERAGE)} requests decoding together — all its memory will hold — it writes{' '}
        {fmt(full.tokensPerS)} a second, and each request’s tokens come only twice as slowly, every {ms(full.tpot)}. But that figure assumed the batch was always full.
        A real server can only batch the requests that have arrived, and when they arrive faster than it finishes them, they wait.
      </P>
      <P>
        So a person still sees the two delays of Lesson 3.2, but the <Tn tone="teal">time to first token</Tn> now includes time in the queue as well as the time to
        read their prompt. Suppose the service makes the chat assistant’s promise, which this chapter keeps from Lesson 3.2’s challenge to{' '}
        <a href={lessonHref('compute/3.5')}>Lesson 3.5</a>: a <Tn tone="teal">time per output token</Tn> of no more than {TPOT_TEXT}, and a first token within{' '}
        {TTFT_TEXT} for 95% of requests. That second limit is on the 95th percentile, the wait that only one request in twenty exceeds; an average would hide the
        people who wait longest.
      </P>
      <P>
        In the next demonstration, requests arrive at random, at an average rate you set, each with a 1,000-token prompt and a reply between 150 and 450 tokens long.
        The server works in steps. At each step it admits waiting requests into the batch, up to a maximum you choose, reads the new arrivals’ prompts, and then
        gives every request in the batch one more token; finished requests leave. The top drawing replays the run, and the chart shows it whole: the batch, and the
        queue of requests waiting to join it, second by second over {SECONDS} seconds. The maximum batch stops at {fmt(CAP_MAX)}, not {fmt(CAP_AVERAGE)}, because
        memory must hold every request’s cache with its reply at its longest, {fmt(Math.ceil(OUTPUT * 1.5))} tokens. Change the arrival rate and the maximum batch:
      </P>

      <Figure name="Inference Scheduling Lab" scenario={lab} play={play}>
        <LabView r={r} cap={cap} playing={play.playing} />
        <Readouts
          items={[
            { label: 'first token, 95% within', value: r.overloaded ? `> ${secs(r.ttftP95)}` : secs(r.ttftP95), tone: 'teal' },
            { label: 'time per output token', value: ms(r.tpot), tone: 'teal' },
            { label: 'output tokens per second', value: fmt(r.throughput), tone: 'orange' },
            { label: 'average batch', value: fmt(r.meanBatch) },
            { label: 'arithmetic in use', value: pct(r.utilization), tone: 'orange' },
          ]}
        />
        <Slider label="Arrivals per second" tone="teal" value={rate} min={RATE_MIN} max={RATE_MAX} step={RATE_STEP} onChange={(v) => lab.set({ rate: v })} display={`${rateText(rate)} a second`} />
        <Slider label="Max batch" value={cap} min={1} max={CAP_MAX} onChange={(v) => lab.set({ cap: v })} display={`${fmt(cap)} requests`} />
        <Caption>{labCaption(r, rate, cap)}</Caption>
      </Figure>

      <P>
        At the starting {rateText(LAB_DEFAULTS.rate)} requests a second, with at most {fmt(LAB_DEFAULTS.cap)} decoding, the server keeps up easily. The batch
        averages {fmt(start.meanBatch)}, almost nobody queues, 95% of requests see their first token within {secs(start.ttftP95)}, and tokens come every{' '}
        {ms(start.tpot)}. The batch rises and falls with the arrivals because the server doesn’t choose its size: the traffic does. A request stays about{' '}
        {fmt(OUTPUT)} steps, so the number decoding at once is roughly the arrival rate times how long each one stays — a rule known as Little’s law.
      </P>
      <P>
        Now double the arrivals to 8 a second and leave the maximum at {fmt(LAB_DEFAULTS.cap)}. The batch climbs to its ceiling and stays there, and the queue
        grows for the rest of the run: the server finishes about {fmt(jam.throughput / OUTPUT, 1)} requests a second while 8 arrive. Once that happens, waiting times
        grow without limit — by the end, 5% of requests had waited more than {secs(jam.ttftP95)}. A queue that is growing never settles at some long wait; it just
        keeps getting longer for as long as the imbalance lasts.
      </P>
      <P>
        Raise the maximum to {fmt(256)} and the queue drains: the batch averages {fmt(open.meanBatch)}, and 95% start within {secs(open.ttftP95)}. But the tokens now
        come every {ms(open.tpot)} — just over the {TPOT_TEXT} promised — about twice as slowly as Lesson 3.2’s steady batch of that size, {ms(steadyAtOpen.tpot)}.
        The difference is the prompts. Reading a 1,000-token prompt takes these four GPUs {ms(PREFILL_S)} — {ms(PREFILL_S - PREFILL_EXCHANGE_S)} of arithmetic and{' '}
        {ms(PREFILL_EXCHANGE_S)} of exchanges between them — and while they do it, no one in the batch gets a token. At 8 arrivals a second, that is{' '}
        {ms(busyShare)} of every second spent on prompts. Little’s law closes the loop: each request now stays about {fmt(OUTPUT)} ×{' '}
        {ms(open.tpot)} ≈ {secs(littleWait)}, and 8 a second for {secs(littleWait)} is about {fmt(8 * littleWait)} requests in the batch at once.
      </P>
      <P>
        How much can this server do at all? Push the arrivals to {fmt(RATE_MAX)} a second and the maximum batch to {fmt(CAP_MAX)}. The queue runs away, but the batch
        stays full, and the server writes {fmt(flat.throughput)} tokens a second: flat out, it finishes about {fmt(flatRequests, 1)} requests a second.
      </P>

      <Challenge
        id="a"
        question={`Predict first: flat out, the server finishes about ${fmt(flatRequests, 1)} requests a second. How many a second can it take while keeping both promises — 95% of first tokens within ${TTFT_TEXT}, and no more than ${TPOT_TEXT} between tokens? Estimate, then find the highest arrival rate at which some max batch keeps both.`}
        solved={solved}
        status={status}
        success={`Solved: ${rateText(BEST_RATE)} requests a second, with any max batch from ${fmt(BEST_CAPS[0])} up — only ${fmt((BEST_RATE / flatRequests) * 100)}% of what the server finishes flat out. Any smaller max batch and requests queue too long to start. At ${rateText(BEST_RATE + RATE_STEP)} a second nothing works: a max batch small enough to keep tokens within ${TPOT_TEXT} leaves too many requests waiting over ${TTFT_TEXT}, and one big enough to keep the queue short lets tokens slow past ${TPOT_TEXT}. These edges come from one two-minute sample of random arrivals; another would move them a little.`}
      />

      <H2>The knee</H2>
      <P>
        Why is the edge so sharp — half a request a second more, and no maximum batch keeps both promises — and so far below what the server can do? To see, the
        next demonstration runs the server at every arrival rate from 0.5 to 20 a second, for three maximum batches, and plots what each run
        delivered — its <K tone="orange">throughput</K>, in output tokens per second — against the two delays its users saw. The dots mark the arrival rate you
        choose: solid where the queue keeps up, hollow where it grows without end. Move the arrival rate:
      </P>

      <Figure name="Inference Scheduling Lab · trade-off" scenario={cv}>
        <TradeoffCharts curves={curves} rate={curveRate} />
        <Legend items={CURVE_CAPS.map((c) => ({ label: `max batch ${c}`, color: CURVE_COLOR[c], kind: 'line' as const }))} />
        <DataTable
          caption="What each max batch delivers at the chosen arrival rate"
          rows={rows}
          rowKey={(row) => row.cap}
          rowClass={(row) => (meetsLimits(row.r) ? 'hl' : '')}
          columns={[
            { label: 'Max batch', cell: (row) => fmt(row.cap) },
            { label: 'Tokens per second', cell: (row) => fmt(row.r.throughput), align: 'right' },
            { label: 'First token, 95%', cell: (row) => (row.r.overloaded ? `> ${secs(row.r.ttftP95)}` : secs(row.r.ttftP95)), align: 'right' },
            { label: 'Per token', cell: (row) => ms(row.r.tpot), align: 'right' },
            { label: 'Promises', cell: (row) => (meetsLimits(row.r) ? 'kept' : 'broken'), align: 'right' },
          ]}
        />
        <Slider label="Arrivals per second" tone="teal" value={curveRate} min={1} max={RATE_MAX} onChange={(v) => cv.set({ rate: v })} display={`${fmt(curveRate)} a second`} />
      </Figure>

      <P>
        Each curve has the same shape. At low traffic the wait for a first token is flat and short: the server is idle much of the time, and a new request is
        admitted almost at once. As traffic approaches what the server can finish, the wait turns sharply upward, and past that point it is limited only by how long
        the run lasts. The turn is the <b>knee</b>, and it sits at very different places for the three settings: a server that decodes at most 16 requests at once
        tops out at about {fmt(capacity[0])} tokens a second, one allowed 64 at about {fmt(capacity[1])}, and one allowed 256 at about {fmt(capacity[2])}. The lower
        chart shows the price of the bigger batch: below its knee every setting streams quickly, but near its knee the big batch fills and its tokens slow, past the{' '}
        {TPOT_TEXT} promise.
      </P>
      <P>
        The shape isn’t special to language models. Any server fed by random arrivals waits longer the busier it is, and the wait grows roughly as 1 ÷ (1 − the share
        of the time it is busy) — slowly at first, then explosively as that share approaches one. A server run at 95% of its capacity waits about twice as long as
        one at 90%. That is why the best the challenge allows, {fmt(best.throughput)} tokens a second, is only {fmt((best.throughput / flat.throughput) * 100)}% of
        the {fmt(flat.throughput)} the same server manages flat out.
      </P>

      <H2>Headroom is idle capacity</H2>
      <P>
        Look at the arithmetic in use in <FigRef to="Inference Scheduling Lab">the first demonstration</FigRef>. Even run flat out, the four GPUs use{' '}
        {pct(flat.utilization)} of their {fmt(g.bf16Tflops)} TFLOPS: decoding is limited by memory, as Chapter 2 predicted, and the prompts that do use the
        arithmetic stall everything else. At the challenge’s answer, {pct(best.utilization)}. Serving systems fight both losses. They cut long prompts into pieces and
        fold them into the decoding steps, so no single prompt stalls the batch for long, and some run prompts and replies on separate groups of GPUs altogether, each
        sized for its own kind of work. But no arrangement removes the knee. To keep a promise about waiting, a server must run below its capacity, and the gap is
        hardware that is paid for and idle.
      </P>
      <P>
        That gap has a cost per token. Kept within both promises, this server writes {fmt(best.throughput)} tokens a second, or {ghText(best.throughput)}{' '}
        GPU-hours per million tokens. Run flat out, with nobody waiting on the result — an overnight batch of documents, say — the same four GPUs need{' '}
        {ghText(flat.throughput)} GPU-hours per million tokens. And with every request the same length and the batch always full, Lesson 3.2’s steady figure,{' '}
        {ghText(full.tokensPerS)}. The same hardware, running the same model, costs different amounts per token depending
        on how quickly its users need the answer. Demand also rises and falls through the day, so a server sized for the afternoon peak sits partly idle at night —
        idle capacity that someone pays for, as Chapter 5 will show when it prices on-demand and interruptible capacity.
      </P>
      <Eq label="GPU-hours per million tokens equals GPUs divided by tokens per hour, times a million">
        <span>GPU-hours per million tokens</span>
        <Op>=</Op>
        <span>
          {SERVE.tp} GPUs × 10<Sup>6</Sup> ÷ ({fmt(best.throughput)} tokens/s × 3,600 s)
        </span>
        <Op>=</Op>
        <K tone="orange">{ghText(best.throughput)}</K>
      </Eq>
      <P>
        Every workload so far has been one model on one kind of GPU. A real cloud runs many workloads at once — chat, code completion, batch jobs, training runs —
        each with its own model, its own promises and its own appetite for memory, bandwidth and links, on a fleet that mixes old accelerators with new.{' '}
        <a href={lessonHref('compute/3.5')}>The next lesson</a> asks which work belongs on which hardware.
      </P>
    </LessonPage>
  );
}
