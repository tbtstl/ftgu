// Serving a stream of requests: they arrive at random, wait in a queue, are admitted into the
// running batch, have their prompts processed, and then gain one token per step until their replies
// are done (continuous batching). A bigger batch makes more tokens per second and every token slower;
// a busier server makes requests queue. Simulated step by step with a seeded random stream.

import { rng } from '../../model/random';
import { ACCELERATORS } from '../../model/compute/hardware';
import { MODELS, matmulParams } from '../../model/compute/models';
import { BANDWIDTH_EFFICIENCY, COMPUTE_EFFICIENCY, decodeStep, maxBatch, tensorParallelS, weightBytes, type ServeConfig } from './inference';
import { peakFlops } from './roofline';

export interface SchedConfig {
  serve: ServeConfig;
  /** Requests arriving per second, on average (Poisson). */
  arrivalsPerS: number;
  /** Most requests decoding at once. */
  maxBatch: number;
  /** Prompt length, tokens. */
  input: number;
  /** Average reply length, tokens (each reply is uniform between half and one and a half times this). */
  outputMean: number;
  /** Simulated time, s. */
  seconds: number;
  seed?: number;
}

export interface SchedResult {
  requests: number;
  served: number;
  /** Requests still waiting when the simulation ended. */
  waitingAtEnd: number;
  ttftP50: number;
  ttftP95: number;
  /** Average time between a request's tokens, s. */
  tpot: number;
  /** Output tokens per second over the run. */
  throughput: number;
  /** Achieved share of peak arithmetic over the run. */
  utilization: number;
  /** Average decode batch while busy. */
  meanBatch: number;
  /** The queue grew without bound: more requests arrive than the server can finish. */
  overloaded: boolean;
  /** Per-second samples for charts. */
  series: Array<{ t: number; batch: number; queue: number }>;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

/** Time and arithmetic to process `count` prompts of `input` tokens together. */
function prefillBatch(c: ServeConfig, count: number, input: number): { seconds: number; flops: number } {
  if (count <= 0) return { seconds: 0, flops: 0 };
  const m = MODELS[c.model];
  const g = ACCELERATORS[c.gpu];
  const flops = count * (input * 2 * matmulParams(m) + 2 * m.layers * input * input * m.d);
  const computeS = flops / (c.tp * peakFlops(g, c.precision) * COMPUTE_EFFICIENCY);
  const memoryS = weightBytes(c.model, c.precision) / (c.tp * g.bandwidthTBs * 1e12 * BANDWIDTH_EFFICIENCY);
  return { seconds: Math.max(computeS, memoryS) + tensorParallelS(c, count * input), flops };
}

export function simulateServing(cfg: SchedConfig): SchedResult {
  const r = rng(cfg.seed ?? 7);
  const c = cfg.serve;
  const cap = Math.max(1, Math.min(cfg.maxBatch, maxBatch(c, cfg.input + Math.ceil(cfg.outputMean * 1.5))));
  // Arrivals.
  const arrivals: number[] = [];
  const outputs: number[] = [];
  let t = 0;
  for (;;) {
    t += -Math.log(1 - r()) / Math.max(1e-9, cfg.arrivalsPerS);
    if (t >= cfg.seconds) break;
    arrivals.push(t);
    outputs.push(Math.max(1, Math.round(cfg.outputMean * (0.5 + r()))));
  }
  const n = arrivals.length;
  const g = ACCELERATORS[c.gpu];
  const peak = c.tp * peakFlops(g, c.precision);

  let now = 0;
  let next = 0; // next request not yet admitted
  let active = 0;
  let contextSum = 0;
  let iter = 0;
  const finishAt = new Map<number, Array<number>>(); // iteration → request ids finishing after it
  const ttft: number[] = [];
  let tokens = 0;
  let tokenTime = 0; // Σ dt × active, for the token-weighted step time
  let flopsDone = 0;
  let busyBatch = 0;
  let busyIters = 0;
  const series: SchedResult['series'] = [];
  let nextSample = 0;

  while (now < cfg.seconds) {
    // Idle with nothing waiting: jump to the next arrival.
    if (active === 0 && (next >= n || arrivals[next] > now)) {
      if (next >= n) break;
      while (nextSample <= arrivals[next] && nextSample < cfg.seconds) {
        series.push({ t: nextSample, batch: 0, queue: 0 });
        nextSample += 1;
      }
      now = arrivals[next];
    }
    // Admit waiting requests up to the cap.
    let admitted = 0;
    const admittedIds: number[] = [];
    while (next < n && arrivals[next] <= now && active + admitted < cap) {
      admittedIds.push(next);
      admitted++;
      next++;
    }
    const batch = active + admitted;
    contextSum += admitted * cfg.input;
    const pre = prefillBatch(c, admitted, cfg.input);
    const step = decodeStep(c, batch, batch > 0 ? contextSum / batch : cfg.input);
    const dt = pre.seconds + step.seconds;
    now += dt;
    flopsDone += step.flops + pre.flops;
    for (const id of admittedIds) {
      ttft.push(now - arrivals[id]);
      const last = iter + outputs[id] - 1;
      const list = finishAt.get(last);
      if (list) list.push(id);
      else finishAt.set(last, [id]);
    }
    active = batch;
    tokens += batch;
    tokenTime += dt * batch;
    contextSum += batch;
    busyBatch += batch;
    busyIters++;
    const done = finishAt.get(iter);
    if (done) {
      for (const id of done) {
        active--;
        contextSum -= cfg.input + outputs[id];
      }
      finishAt.delete(iter);
    }
    iter++;
    while (nextSample <= now && nextSample < cfg.seconds) {
      let queue = 0;
      for (let k = next; k < n && arrivals[k] <= nextSample; k++) queue++;
      series.push({ t: nextSample, batch: active, queue });
      nextSample += 1;
    }
  }
  while (nextSample < cfg.seconds) {
    series.push({ t: nextSample, batch: 0, queue: 0 });
    nextSample += 1;
  }

  let waitingAtEnd = 0;
  for (let k = next; k < n && arrivals[k] <= cfg.seconds; k++) waitingAtEnd++;
  // Requests never admitted have waited at least until the end: count that toward the tail.
  const waits = [...ttft];
  for (let k = next; k < n; k++) waits.push(Math.max(0, cfg.seconds - arrivals[k]));
  waits.sort((a, b) => a - b);
  const horizon = Math.max(cfg.seconds, now);
  const recentQueue = series.slice(-Math.max(1, Math.floor(series.length / 4)));
  const overloaded = waitingAtEnd > Math.max(5, 0.02 * n) && recentQueue.length > 0 && recentQueue[recentQueue.length - 1].queue >= recentQueue[0].queue;
  return {
    requests: n,
    served: ttft.length,
    waitingAtEnd,
    ttftP50: quantile(waits, 0.5),
    ttftP95: quantile(waits, 0.95),
    tpot: tokens > 0 ? tokenTime / tokens : 0,
    throughput: tokens / horizon,
    utilization: flopsDone / (horizon * peak),
    meanBatch: busyIters ? busyBatch / busyIters : 0,
    overloaded,
    series,
  };
}
