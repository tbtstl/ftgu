import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Checkbox,
  Eq,
  FigRef,
  Figure,
  Frac,
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
  TEXT,
  fmt,
  hour,
  lessonHref,
  linePath,
  niceDomain,
  niceTicks,
  scale,
  signed,
  tint,
  usd,
  useScenario,
} from '../../../framework';
import {
  TECH_PARK_PUE,
  backtest,
  breakEvenPrices,
  drawAtCap,
  gpuDieShare,
  gpuGridKW,
  hourOutcome,
  modeAt,
  powerCapPlan,
  shiftWork,
  techParkPrices,
  type Mode,
  type PowerPolicy,
} from '../../../engines/compute/powerAware';
import { speedAtPowerShare, annualPue } from '../../../engines/compute/cooling';
import { IDLE_POWER_SHARE, gpuHourCost } from '../../../engines/compute/facilityCost';
import { PRICES } from '../../../model/compute/prices';
import { SITES } from '../../../model/compute/sites';

// ---------------------------------------------------------------------------
// The history: Tech Park's hourly price over the electricity course's 120 days.

const DAYS = techParkPrices();
const ALL = DAYS.flat();
const MEAN_PRICE = ALL.reduce((a, b) => a + b, 0) / ALL.length;
const MAX_PRICE = Math.max(...ALL);
const KW = gpuGridKW();
/** Share of that draw that is the GPU itself, which a power cap limits. */
const DIE = gpuDieShare();
const A_PRICE = PRICES.A.onDemand;
/** What an A-class hour costs to provide at Tech Park (Lesson 4.5's base case), and electricity's share of it. */
const BASE_COST = gpuHourCost({ gpu: 'A', cooling: 'air', site: SITES.techpark, pue: annualPue(SITES.techpark, { cooling: 'air', supplyC: 24 }).pue, utilization: 0.7, serverLifeYears: 5, facilityLifeYears: 15, rate: 0.1 });

/** Energy cost of one busy A-class GPU-hour at a price, $. */
const energyAt = (price: number) => (KW * price) / 1000;

const MODE_COLOR: Record<Mode, string> = { full: tint(GRAPHIC.green, 0.55), capped: GRAPHIC.gold, paused: GRAPHIC.red };

export interface DayState {
  /** Value of an hour of the work at full speed, $. */
  value: number;
  /** The GPU's power cap, % of its rated power. */
  cap: number;
  /** Day of the history, 1–120. */
  day: number;
}

export const DAY_DEFAULTS: DayState = { value: 2.4, cap: 70, day: 73 };
export const VALUE_STEP = 0.05;
export const VALUE_MIN = 0.25;
export const VALUE_MAX = 3;

/** The policy for a setting: cap and pause exactly where each starts to pay. */
export function policyOf(value: number, capPct: number): PowerPolicy {
  const base = { value, capShare: capPct / 100, capAbove: Infinity, pauseAbove: Infinity };
  const be = breakEvenPrices(base);
  return { ...base, capAbove: be.cap, pauseAbove: be.pause };
}

/** One day under the policy, hour by hour, for one A-class GPU. */
export function dayRun(s: DayState) {
  const pol = policyOf(s.value, s.cap);
  const prices = DAYS[s.day - 1];
  const hours = prices.map((price) => {
    const mode = modeAt(price, pol);
    const flat = hourOutcome(price, 'full', pol);
    const out = hourOutcome(price, mode, pol);
    return { price, mode, flat, out };
  });
  const energyFlat = hours.reduce((t, h) => t + h.flat.energyCost, 0);
  const energyPolicy = hours.reduce((t, h) => t + h.out.energyCost, 0);
  const workLost = hours.reduce((t, h) => t + h.flat.work - h.out.work, 0);
  return { pol, hours, energyFlat, energyPolicy, workLost, gain: energyFlat - energyPolicy - workLost };
}

const backtestCache = new Map<string, ReturnType<typeof backtest>>();
/** The policy over all 120 days, for one GPU (cached: it depends only on the value and the cap). */
export function historyRun(value: number, capPct: number) {
  const key = `${value.toFixed(2)}|${capPct}`;
  let r = backtestCache.get(key);
  if (!r) {
    r = backtest(policyOf(value, capPct), DAYS);
    backtestCache.set(key, r);
  }
  return r;
}

/** Challenge a: the highest value (on the slider's grid) at which pausing pays in at least one hour of the history. */
export function pauseValueSolved(value: number): boolean {
  const pays = (v: number) => policyOf(v, 70).pauseAbove < MAX_PRICE;
  return pays(value) && !pays(Math.round((value + VALUE_STEP) * 100) / 100);
}

/** The answer to challenge a, found on the slider's grid. */
export const PAUSE_VALUE_ANSWER = (() => {
  let best = 0;
  for (let v = VALUE_MIN; v <= VALUE_MAX + 1e-9; v = Math.round((v + VALUE_STEP) * 100) / 100) if (policyOf(v, 70).pauseAbove < MAX_PRICE) best = v;
  return best;
})();

// ---------------------------------------------------------------------------
// Figure 2: a hall with a fixed grid connection and more GPUs than it can run at full power.

export const HALL_MW = 20;

export interface HallState {
  /** GPUs the hall owns. */
  owned: number;
  /** The GPUs' power cap, % of their rated power. */
  cap: number;
  /** Counterfactual: speed falls in step with power (no lowering of voltage). */
  linear: boolean;
}

export const HALL_DEFAULTS: HallState = { owned: 20000, cap: 100, linear: false };
export const CAP_MIN = 50;
export const OWNED_MIN = 13000;
export const OWNED_MAX = 24000;

/** GPUs running and work done (in A-class GPUs' worth of work at full speed) at a cap. */
export function hallRun(owned: number, capPct: number, linear = false) {
  const plan = powerCapPlan(HALL_MW, capPct / 100);
  const running = Math.min(owned, plan.gpus);
  const speed = linear ? capPct / 100 : plan.speed;
  return { running, dark: owned - running, speed, work: running * speed, mw: (running * plan.kwPerGpu) / 1000 };
}

/** The cap (whole percent) that gets the most work from `owned` GPUs with the real chip. */
export function bestCap(owned: number): number {
  let best = 100;
  let work = -1;
  for (let c = 100; c >= CAP_MIN; c--) {
    const w = hallRun(owned, c).work;
    if (w > work + 1e-9) {
      work = w;
      best = c;
    }
  }
  return best;
}

export const CHALLENGE_OWNED = 20000;

/** Challenge b: with 20,000 GPUs and the real chip, the cap that does the most work. */
export function capSolved(s: HallState): boolean {
  return s.owned === CHALLENGE_OWNED && !s.linear && s.cap === bestCap(CHALLENGE_OWNED);
}

// ---------------------------------------------------------------------------
// Numbers the prose quotes.

const FULL = hallRun(CHALLENGE_OWNED, 100);
const AT70 = hallRun(CHALLENGE_OWNED, 70);
const BEST_CAP = bestCap(CHALLENGE_OWNED);
const AT_BEST = hallRun(CHALLENGE_OWNED, BEST_CAP);
const ALL_FIT_CAP = (() => {
  for (let c = 100; c >= CAP_MIN; c--) if (hallRun(CHALLENGE_OWNED, c).dark === 0) return c;
  return CAP_MIN;
})();
const AT_ALL_FIT = hallRun(CHALLENGE_OWNED, ALL_FIT_CAP);
const PLAN70 = powerCapPlan(HALL_MW, 0.7);
const PLAN100 = powerCapPlan(HALL_MW, 1);
const EXTRA_GPUS = PLAN70.gpus - PLAN100.gpus;
const EXTRA_WORK = PLAN70.work - PLAN100.work;
/** The hardware an extra GPU adds each year: its server share, network and upkeep. The building and the electricity are the hall's 20 MW either way. */
const HARDWARE_YEAR = BASE_COST.serverYear + BASE_COST.networkYear + BASE_COST.upkeepYear;
const EXTRA_COST = EXTRA_GPUS * HARDWARE_YEAR;

const SPIKE = MAX_PRICE;
const SPIKE_POL = policyOf(A_PRICE, 70);
const SPIKE_FULL = hourOutcome(SPIKE, 'full', SPIKE_POL);
const SPIKE_CAP = hourOutcome(SPIKE, 'capped', SPIKE_POL);
const SPIKE_PAUSE = hourOutcome(SPIKE, 'paused', SPIKE_POL);

/** The power pausing saves: a busy GPU's grid draw less what it still draws idle, kW. */
const PAUSE_KW = KW * (1 - IDLE_POWER_SHARE);
/** The days on which the price ever passes the capping price for $2.40 work capped to 70%. */
const CAP_DAYS = DAYS.map((d, i) => ({ day: i + 1, max: Math.max(...d) })).filter((d) => d.max > policyOf(A_PRICE, 70).capAbove).map((d) => d.day);
/** Where capping $2.40 work to 50% starts to pay, $/MWh. */
const N_CAP50 = policyOf(A_PRICE, 50).capAbove;
/** Challenge a's exact answer: the value at which the history's peak just pays for pausing, $ per hour. */
const N_PAUSE_EXACT = (MAX_PRICE * PAUSE_KW) / 1000;
const RUN_240 = historyRun(2.4, 70);
const RUN_095 = historyRun(0.95, 70);
const RUN_025 = historyRun(0.25, 70);
const POL_095 = policyOf(0.95, 70);
const DAY_DEFAULT = dayRun(DAY_DEFAULTS);

/** Deferrable work: a 12-hour job arriving at noon that must finish within a day, run at once or in the cheapest hours. */
const DEFER = (() => {
  let asap = 0;
  let shifted = 0;
  let n = 0;
  for (let d = 0; d < DAYS.length - 1; d++) {
    const window = [...DAYS[d].slice(12), ...DAYS[d + 1].slice(0, 12)];
    const s = shiftWork(window, 12);
    asap += s.asapCost;
    shifted += s.shiftedCost;
    n++;
  }
  return { asap: asap / n, shifted: shifted / n, saving: (asap - shifted) / n, days: n };
})();

const FLEET_GPUS = 1000;
const FLEET_120_COST = (FLEET_GPUS * BASE_COST.totalYear * DAYS.length) / 365;

export const LESSON_NUMBERS = {
  meanPrice: MEAN_PRICE,
  maxPrice: MAX_PRICE,
  kw: KW,
  meanEnergy: energyAt(MEAN_PRICE),
  meanShare: energyAt(MEAN_PRICE) / A_PRICE,
  costPowerShare: BASE_COST.powerShare,
  valueToEnergy: A_PRICE / energyAt(MEAN_PRICE),
  speed70: speedAtPowerShare(0.7),
  spikeEnergy: SPIKE_FULL.energyCost,
  spikeNetFull: SPIKE_FULL.net,
  spikeNetCap: SPIKE_CAP.net,
  spikeNetPause: SPIKE_PAUSE.net,
  cap240: SPIKE_POL.capAbove,
  pause240: SPIKE_POL.pauseAbove,
  cap095: POL_095.capAbove,
  pause095: POL_095.pauseAbove,
  run240: RUN_240,
  run095: RUN_095,
  run025: RUN_025,
  dayDefault: DAY_DEFAULT,
  pauseAnswer: PAUSE_VALUE_ANSWER,
  pauseKW: PAUSE_KW,
  /** The break-even value the challenge asks for: the history's peak times the power pausing saves. */
  pauseValueExact: N_PAUSE_EXACT,
  capDays: CAP_DAYS,
  cap50: N_CAP50,
  defer: DEFER,
  fleet120Cost: FLEET_120_COST,
  full: FULL,
  at70: AT70,
  bestCap: BEST_CAP,
  atBest: AT_BEST,
  allFitCap: ALL_FIT_CAP,
  atAllFit: AT_ALL_FIT,
  extraGpus: EXTRA_GPUS,
  extraWork: EXTRA_WORK,
  extraCost: EXTRA_COST,
  costPerExtraWork: EXTRA_COST / EXTRA_WORK,
  gpuYear: BASE_COST.totalYear,
  hardwareYear: HARDWARE_YEAR,
  /** How many times a flat-out GPU's hardware cost per unit of work the capped extra work costs. */
  extraCostRatio: EXTRA_COST / EXTRA_WORK / HARDWARE_YEAR,
  dieShare: DIE,
  draw70: drawAtCap(0.7),
  savedKW70: KW * (1 - drawAtCap(0.7)),
};

// ---------------------------------------------------------------------------
// Formatting.

const money = (x: number) => usd(x, 2);
const mwh = (x: number) => `${usd(x)}/MWh`;
const mwh1 = (x: number) => `${usd(x, 1)}/MWh`;
const pct = (x: number) => `${fmt(x * 100)}%`;
const pct1 = (x: number) => `${fmt(x * 100, 1)}%`;
const signedMoney = (x: number) => (Math.round(x * 100) > 0 ? '+' + money(x) : money(x));

// ---------------------------------------------------------------------------
// Charts.

const X0 = 64;
const X1 = 620;
const LOG_LO = 10;
const LOG_HI = 3000;

function DayChart({ run, day, capPct }: { run: ReturnType<typeof dayRun>; day: number; capPct: number }) {
  const top = 26;
  const bot = 196;
  const ly = (p: number) => Math.log10(Math.min(LOG_HI, Math.max(LOG_LO, p)));
  const sy = scale(Math.log10(LOG_LO), Math.log10(LOG_HI), bot, top);
  const y = (p: number) => sy(ly(p));
  const slot = (X1 - X0) / 24;
  const stripTop = 222;
  const stripH = 40;
  const capped = run.hours.filter((h) => h.mode === 'capped').length;
  const paused = run.hours.filter((h) => h.mode === 'paused').length;
  const peak = run.hours.reduce((a, h) => (h.price > a.price ? h : a), run.hours[0]);
  const line = (p: number, color: string, label: string, dy: number) =>
    p <= LOG_HI ? (
      <g>
        <line x1={X0} x2={X1} y1={y(p)} y2={y(p)} stroke={color} strokeWidth={1.4} strokeDasharray="6 4" />
        <text className="ax" x={X0 + 6} y={y(p) + dy} style={{ fill: color === GRAPHIC.red ? TEXT.red : TEXT.gold }}>
          {label}
        </text>
      </g>
    ) : null;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 296"
      role="img"
      aria-label={`Tech Park’s electricity price on day ${day}, from ${mwh(Math.min(...run.hours.map((h) => h.price)))} to ${mwh(peak.price)} at ${hour(run.hours.indexOf(peak))}. Capping to ${capPct}% pays above ${mwh(run.pol.capAbove)} and pausing above ${mwh(run.pol.pauseAbove)}: ${capped} hours capped and ${paused} paused.`}
    >
      <text className="ax" x={X0} y={12}>
        Price at Tech Park, day {day} (log scale)
      </text>
      {[10, 30, 100, 300, 1000, 3000].map((t) => (
        <g key={t}>
          <line className="gl" x1={X0} x2={X1} y1={y(t)} y2={y(t)} />
          <text className="ax ax-e" x={X0 - 6} y={y(t) + 4}>
            {usd(t)}
          </text>
        </g>
      ))}
      {run.hours.map((h, i) => {
        const x = X0 + i * slot + 2;
        return (
          <rect key={i} x={x} y={y(h.price)} width={slot - 4} height={bot - y(h.price)} fill={MODE_COLOR[h.mode]} />
        );
      })}
      {line(run.pol.capAbove, GRAPHIC.gold, Number.isFinite(run.pol.capAbove) ? `capping pays above ${mwh(run.pol.capAbove)}` : '', -5)}
      {line(run.pol.pauseAbove, GRAPHIC.red, `pausing pays above ${mwh(run.pol.pauseAbove)}`, -5)}
      {run.pol.pauseAbove > LOG_HI && (
        <text className="ax" x={X0 + 6} y={top + 10} style={{ fill: TEXT.red }}>
          pausing pays above {mwh(run.pol.pauseAbove)}: off the chart
        </text>
      )}
      <line className="base" x1={X0} x2={X1} y1={bot} y2={bot} />
      <text className="ax" x={X0} y={stripTop - 6}>
        One GPU’s draw from the grid, with its share of the server
      </text>
      {run.hours.map((h, i) => {
        const share = h.out.powerShare;
        const x = X0 + i * slot + 2;
        return <rect key={i} x={x} y={stripTop + stripH * (1 - share)} width={slot - 4} height={stripH * share} fill={MODE_COLOR[h.mode]} />;
      })}
      <line className="base" x1={X0} x2={X1} y1={stripTop + stripH} y2={stripTop + stripH} />
      <text className="ax ax-e" x={X0 - 6} y={stripTop + 4}>
        100%
      </text>
      <text className="ax ax-e" x={X0 - 6} y={stripTop + stripH + 4}>
        0
      </text>
      {[0, 6, 12, 18, 24].map((hh) => (
        <text key={hh} className={hh === 24 ? 'ax ax-e' : 'ax ax-m'} x={X0 + hh * slot} y={stripTop + stripH + 18}>
          {hh === 24 ? '24:00' : hour(hh)}
        </text>
      ))}
    </svg>
  );
}

function HallChart({ s }: { s: HallState }) {
  const top = 26;
  const bot = 196;
  const caps = useMemo(() => Array.from({ length: 101 - CAP_MIN }, (_, i) => CAP_MIN + i), []);
  const real = useMemo(() => caps.map((c) => hallRun(s.owned, c).work), [caps, s.owned]);
  const lin = useMemo(() => caps.map((c) => hallRun(s.owned, c, true).work), [caps, s.owned]);
  const main = s.linear ? lin : real;
  const other = s.linear ? real : lin;
  const [yMin, yMax] = niceDomain(Math.min(...real, ...lin), Math.max(...real, ...lin), 4);
  const sx = scale(CAP_MIN, 100, X0, X1);
  const sy = scale(yMin, yMax, bot, top);
  const cur = hallRun(s.owned, s.cap, s.linear);
  const fullWork = hallRun(s.owned, 100).work;
  const best = bestCap(s.owned);
  return (
    <svg
      className="chart"
      viewBox="0 0 640 230"
      role="img"
      aria-label={`Work done by a ${HALL_MW} MW hall owning ${fmt(s.owned)} A-class GPUs, against the GPUs’ power cap. At ${s.cap}% it runs ${fmt(cur.running)} GPUs and does ${fmt(cur.work)} GPUs’ worth of work, against ${fmt(fullWork)} at full power.${s.linear ? ' Speed falls in step with power here.' : ` The most work comes at ${best}%.`}`}
    >
      <text className="ax" x={X0} y={12}>
        Work done, in A-class GPUs at full speed
      </text>
      <GridY y={sy} ticks={niceTicks(yMin, yMax, 4)} x0={X0} x1={X1} format={(v) => fmt(v)} />
      <line x1={X0} x2={X1} y1={sy(fullWork)} y2={sy(fullWork)} stroke="#777" strokeWidth={1} strokeDasharray="3 4" />
      <text className="ax" x={X0 + 6} y={sy(fullWork) + 14}>
        all at full power
      </text>
      <path d={linePath(caps.map(sx), other.map(sy))} fill="none" stroke="#9a9a9a" strokeWidth={1.5} strokeDasharray="6 4" />
      <path d={linePath(caps.map(sx), main.map(sy))} fill="none" stroke={GRAPHIC.orange} strokeWidth={2.5} strokeLinejoin="round" />
      <line className="cur" x1={sx(s.cap)} x2={sx(s.cap)} y1={top} y2={bot} />
      <circle cx={sx(s.cap)} cy={sy(cur.work)} r={5.5} fill={GRAPHIC.orange} stroke="#fcfcfb" strokeWidth={2} />
      {[50, 60, 70, 80, 90, 100].map((c) => (
        <text key={c} className={c === 100 ? 'ax ax-e' : 'ax ax-m'} x={sx(c)} y={214}>
          {c}%
        </text>
      ))}
      <text className="ax ax-e" x={X1} y={228}>
        GPU power cap, share of its rated power
      </text>
    </svg>
  );
}

function OwnedBar({ s }: { s: HallState }) {
  const cur = hallRun(s.owned, s.cap, s.linear);
  const max = 25000;
  const sx = scale(0, max, X0, X1);
  return (
    <svg className="chart" viewBox="0 0 640 54" role="img" aria-label={`${fmt(cur.running)} of the hall’s ${fmt(s.owned)} GPUs are running; ${fmt(cur.dark)} sit dark for want of power.`}>
      <rect x={X0} y={14} width={sx(cur.running) - X0} height={18} fill={tint(GRAPHIC.orange, 0.7)} />
      <rect x={sx(cur.running)} y={14} width={sx(s.owned) - sx(cur.running)} height={18} fill="#e6e6e3" />
      <text className="ax" x={X0} y={10}>
        GPUs owned: {fmt(cur.running)} running{cur.dark > 0 ? `, ${fmt(cur.dark)} dark` : ''}
      </text>
      <text className="ax ax-e" x={X0 - 6} y={27}>
        GPUs
      </text>
      {[0, 10000, 20000].map((v) => (
        <text key={v} className="ax ax-m" x={sx(v)} y={48}>
          {fmt(v)}
        </text>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function Lesson() {
  const s1 = useScenario('day', DAY_DEFAULTS);
  const st = s1.state;
  const run = useMemo(() => dayRun(st), [st]);
  const hist = useMemo(() => historyRun(st.value, st.cap), [st.value, st.cap]);
  const capped = run.hours.filter((h) => h.mode === 'capped').length;
  const paused = run.hours.filter((h) => h.mode === 'paused').length;
  const pauseNow = run.pol.pauseAbove;
  const solvedA = pauseValueSolved(st.value);
  const capSpeed = speedAtPowerShare(st.cap / 100);

  const s2 = useScenario('hall', HALL_DEFAULTS);
  const hs = s2.state;
  const hall = hallRun(hs.owned, hs.cap, hs.linear);
  const hallFull = hallRun(hs.owned, 100);
  const solvedB = capSolved(hs);

  const dayCaption =
    capped + paused === 0
      ? `On day ${st.day} the price never passes ${mwh(run.pol.capAbove)}, so the GPU runs flat out all day: ${money(run.energyFlat)} of electricity for ${money(24 * st.value)} of work.`
      : `On day ${st.day}, ${capped} hour${capped === 1 ? '' : 's'} capped and ${paused} paused save ${money(run.energyFlat - run.energyPolicy)} of electricity and give up ${money(run.workLost)} of work: ${signedMoney(run.gain)} for the day.`;

  const hallCaption = hs.linear
    ? `With speed falling in step with power, capping only trades GPUs for speed: ${fmt(hall.running)} GPUs at ${hs.cap}% do ${fmt(hall.work)} GPUs’ worth of work, against ${fmt(hallFull.work)} at full power.`
    : hall.dark > 0
      ? `${fmt(hall.running)} GPUs run ${hs.cap === 100 ? 'at full power' : `capped at ${hs.cap}% of their power`}, each keeping ${pct(hall.speed)} of its speed; ${fmt(hall.dark)} sit dark. Work: ${fmt(hall.work)} GPUs’ worth, ${signed((hall.work / hallFull.work - 1) * 100, 1)}% against full power.`
      : `All ${fmt(hs.owned)} GPUs run ${hs.cap === 100 ? 'at full power' : `capped at ${hs.cap}% of their power`}, each keeping ${pct(hall.speed)} of its speed. Work: ${fmt(hall.work)} GPUs’ worth, ${signed((hall.work / hallFull.work - 1) * 100, 1)}% against full power.`;

  return (
    <LessonPage id="compute/6.4">
      <P>
        The previous lesson moved work across the map, to where GPU-hours sold for less. This one keeps the work at Tech Park and moves it through the day instead, around the
        price of the electricity it runs on. Tech Park buys power at the hub price of the electricity course’s region plus delivery charges, and that{' '}
        <K c="price">price</K> moves every hour: over that course’s 120 simulated days it averages {mwh(MEAN_PRICE)}, and on two evenings it passes {usd(2000)}. A data center
        drawing megawatts around the clock seems the natural customer for those swings. The question is whether its GPUs should care.
      </P>
      <P>
        Start with the size of the bill. One busy A-class 80 GB, with its share of the server and the cooling plant (a PUE of {fmt(TECH_PARK_PUE, 2)}, Lesson 4.3), draws{' '}
        <K c="power">{fmt(KW, 2)} kW</K> from the grid. At the average price that is {usd(energyAt(MEAN_PRICE), 3)} of <K c="energy">energy</K> an hour, {pct1(energyAt(MEAN_PRICE) / A_PRICE)} of the
        simulated {money(A_PRICE)} list price of an on-demand hour — the hour is worth nearly {fmt(A_PRICE / energyAt(MEAN_PRICE))} times its electricity. From the cost side the answer is
        the same: electricity is {pct1(BASE_COST.powerShare)} of what an A-class hour costs to provide at Tech Park (<a href={lessonHref('compute/4.5')}>Lesson 4.5</a>). So the
        strategy has to be judged against the work it gives up, not against the power bill alone.
      </P>
      <P>
        A GPU facing an expensive hour has three choices. It can run flat out. It can pause, though an idle GPU still draws about {pct(IDLE_POWER_SHARE)} of its full power
        and does no work at all. Or it can be capped: told to stay under some share of its full power, which it does by lowering its clock and voltage together. That last
        choice is where the physics of <a href={lessonHref('compute/1.5')}>Lesson 1.5</a> comes in. Power rises much faster than speed near the top of a chip’s range, so a GPU
        capped at 70% of its power keeps {pct(speedAtPowerShare(0.7))} of its speed. The cap limits the GPU alone: its share of the server’s CPUs, memory, network cards
        and fans, {pct(1 - DIE)} of what it draws, carries on as before, so a 70% cap takes the draw from the grid only to {pct(drawAtCap(0.7))}. Each choice has a price
        at which it starts to pay — where the energy it saves equals the work it gives up, with a factor of 1,000 to turn dollars per kilowatt-hour into dollars per
        megawatt-hour:
      </P>
      <Eq label="Capping pays above the price at which the energy saved equals the work given up">
        <span>cap pays above</span>
        <Op>=</Op>
        <Frac top={<span>work lost</span>} bottom={<K c="power">kW saved</K>} />
        <Op>=</Op>
        <Frac
          top={
            <span>
              <K c="price">{money((1 - capSpeed) * st.value)}</K> × 1,000
            </span>
          }
          bottom={<K c="power">{fmt(KW * (1 - drawAtCap(st.cap / 100)), 3)} kW</K>}
        />
        <Op>=</Op>
        <K c="price">{Number.isFinite(run.pol.capAbove) ? mwh(run.pol.capAbove) : 'never'}</K>
      </Eq>
      <P>
        In the next demonstration, each bar is an hour of one day’s price at Tech Park, on a logarithmic scale, and the strip beneath is what one A-class GPU, with its
        share of the server, draws that hour. The policy caps the GPU whenever the price is above the point where capping pays, and pauses it above the point where pausing pays. Set the value of the work, the
        cap, and the day:
      </P>

      <Figure name="Power-Aware Scheduler" scenario={s1}>
        <DayChart run={run} day={st.day} capPct={st.cap} />
        <Legend
          items={[
            { label: 'Running flat out', color: MODE_COLOR.full },
            { label: `GPU capped to ${st.cap}% of its power`, color: MODE_COLOR.capped },
            { label: `Paused (idling at ${pct(IDLE_POWER_SHARE)})`, color: MODE_COLOR.paused },
          ]}
        />
        <Slider label="Value of the work" tone="green" value={st.value} min={VALUE_MIN} max={VALUE_MAX} step={VALUE_STEP} onChange={(v) => s1.set({ value: Math.round(v * 100) / 100 })} display={`${money(st.value)} per GPU-hour`} />
        <Slider label="GPU power cap" tone="red" value={st.cap} min={50} max={100} step={5} onChange={(v) => s1.set({ cap: v })} display={st.cap === 100 ? 'no cap' : `${st.cap}% (keeps ${pct(capSpeed)} of speed)`} />
        <Slider label="Day of the history" value={st.day} min={1} max={DAYS.length} onChange={(v) => s1.set({ day: v })} display={`day ${st.day}`} />
        <Caption>{dayCaption}</Caption>
        <Readouts
          items={[
            { label: 'gain over all 120 days', value: money(hist.gain), tone: 'green' },
            { label: 'hours capped over the 120 days', value: fmt(hist.hoursCapped), tone: 'gold' },
            { label: 'hours paused over the 120 days', value: solvedA ? fmt(hist.hoursPaused) : 'after challenge a', tone: 'red' },
          ]}
        />
      </Figure>

      <P>
        It starts on day 73, one of the two evenings of the history when the price passed {usd(2000)}. For three hours it sits near {mwh(MAX_PRICE)}, and at that price a
        flat-out A-class GPU burns {money(SPIKE_FULL.energyCost)} of electricity an hour to do {money(A_PRICE)} of work: it loses {money(-SPIKE_FULL.net)} an hour. Paused, it
        loses {money(-SPIKE_PAUSE.net)}, because the idle draw is still expensive and the work is gone. With the GPU capped to 70%, it loses only {money(-SPIKE_CAP.net)}. For work worth{' '}
        {money(A_PRICE)} an hour, capping pays above {mwh(SPIKE_POL.capAbove)} and pausing above {mwh(SPIKE_POL.pauseAbove)} — a price this history never reaches. Over the
        whole 120 days the policy caps the GPU for {RUN_240.hoursCapped} hours and gains {money(RUN_240.gain)}, against {money(RUN_240.energyFlat)} of electricity in all.
        Move the day through the history: only day {CAP_DAYS[CAP_DAYS.length - 1]}, the other evening, ever passes {mwh(SPIKE_POL.capAbove)} too. And lower the cap:
        a deeper cap pays only at higher prices, {mwh(N_CAP50)} at 50%, because each further step down costs more speed for every kilowatt it saves — though at this
        history’s two spikes, far above either price, the deeper cap gains more.
      </P>
      <P>
        Pausing follows the same rule: the work it gives up, all of it, over the power it saves, which is everything but the idle {pct(IDLE_POWER_SHARE)}:{' '}
        {fmt(KW, 3)} − {fmt(KW * IDLE_POWER_SHARE, 3)} = {fmt(PAUSE_KW, 3)} kW. So it pays once the price passes the work’s hourly value × 1,000 ÷ {fmt(PAUSE_KW, 3)}:
        for {money(A_PRICE)} of work, the {mwh(SPIKE_POL.pauseAbove)} this history never reaches. The cheaper the work, the lower that price.
      </P>

      <Challenge
        id="a"
        question={`Compute first: the history’s highest price is ${mwh(MAX_PRICE)}. What is the highest value of work, to the nearest 5 cents, at which pausing pays in at least one hour of the 120 days? Then set the value of the work to your answer and check it on day 73.`}
        solved={solvedA}
        status={
          st.value === DAY_DEFAULTS.value
            ? 'Compute first, then set the value of the work to your answer.'
            : st.day !== 73
              ? 'Look at day 73, where the history’s spike is, to check your answer.'
              : `At ${money(st.value)}, pausing pays above ${mwh(pauseNow)}. Is this the value you computed?`
        }
        success={`Solved: ${money(PAUSE_VALUE_ANSWER)}. At the peak, ${mwh1(MAX_PRICE)}, the ${fmt(PAUSE_KW, 3)} kW that pausing saves are worth ${fmt(MAX_PRICE, 1)} × ${fmt(PAUSE_KW, 3)} ÷ 1,000 = ${money(N_PAUSE_EXACT)} an hour; at ${money(PAUSE_VALUE_ANSWER)} pausing pays above ${mwh1(policyOf(PAUSE_VALUE_ANSWER, 70).pauseAbove)}, just under the peak, and at ${money(PAUSE_VALUE_ANSWER + VALUE_STEP)} it would need ${mwh(policyOf(PAUSE_VALUE_ANSWER + VALUE_STEP, 70).pauseAbove)}. Work worth any more than that is never worth stopping for the price of power here.`}
      />

      <P>
        Lower the value further and pausing pays more often. Work that sells for {money(0.95)} an hour — the simulated spot price of Lesson 5.4, the kind of work that is
        cheap because it can be interrupted — caps above {mwh(POL_095.capAbove)} and pauses above {mwh(POL_095.pauseAbove)}. The policy now pauses {RUN_095.hoursPaused}{' '}
        hours and caps {RUN_095.hoursCapped}, and gains {money(RUN_095.gain)} over the 120 days. At {money(0.25)} an hour it gains {money(RUN_025.gain)}. The cheaper the
        work, the more often the electricity is worth more than it.
      </P>

      <H2>How big is the prize?</H2>
      <P>
        Not big. Even for the {money(0.95)} work, the policy saves {money(RUN_095.energyFlat - RUN_095.energyPolicy)} of each GPU’s {money(RUN_095.energyFlat)} electricity bill
        over 120 days, and gains {money(RUN_095.gain)} once the lost work is counted. Across a fleet of {fmt(FLEET_GPUS)} GPUs that is {usd(RUN_095.gain * FLEET_GPUS)}, against the{' '}
        {usd(FLEET_120_COST / 1e6, 1)} million those GPUs cost to own over the same 120 days. Lesson 4.5 already said why: a GPU-hour is mostly capital, and electricity is a few percent of it.
        A battery can live on price spikes, as <a href={lessonHref('6.4')}>Lesson 6.4 of the electricity course</a> showed, because energy is all it sells; a GPU sells
        something worth nearly {fmt(A_PRICE / energyAt(MEAN_PRICE))} times its electricity.
      </P>
      <P>
        Work that can simply wait does a little better, because waiting gives up nothing. A 12-hour job that arrives at noon and must be done within a day, run in the
        day’s cheapest hours instead of at once, spends {money(DEFER.shifted)} on electricity instead of {money(DEFER.asap)} — {pct(DEFER.saving / DEFER.asap)} less, or{' '}
        {money(DEFER.saving)} a day per GPU, if the GPU has nothing better to do in the hours it now leaves free. And the spikes themselves come from the grid’s own scarcity,
        the <a href={lessonHref('5.5')}>scarcity pricing</a> of the electricity course. Some grid operators pay large customers to cut their use at such moments, the{' '}
        <a href={lessonHref('3.5')}>demand response</a> of that course, which adds to the value of a GPU fleet that can cap on request — a payment our model leaves out.
      </P>

      <H2>When the megawatts are the limit</H2>
      <P>
        Capping has a second use that matters far more, and it has nothing to do with the price of electricity. Lesson 4.2 found that a site’s grid connection, not its
        power bill, limits how much computing it can hold, and Lesson 5.2 found GPUs sitting built but dark, waiting for data centers with power for them. Suppose a hall at
        Tech Park is allotted {HALL_MW} MW, counting its cooling at a PUE of {fmt(TECH_PARK_PUE, 2)}. At full power it can run {fmt(FULL.running)} A-class GPUs. If it owns{' '}
        {fmt(CHALLENGE_OWNED)}, the rest sit dark. Capped, each GPU draws less, so more of them fit under the same connection, and each keeps more of its speed than its server
        share gives up in power. In the next demonstration, set how many GPUs the hall owns and the cap on every GPU’s power; the curve is the work the hall does at every
        cap:
      </P>

      <Figure name="Power-Aware Scheduler · the connection" scenario={s2}>
        <HallChart s={hs} />
        <OwnedBar s={hs} />
        <Legend
          items={[
            { label: hs.linear ? 'Speed in step with power' : 'Lesson 1.5’s chip', color: GRAPHIC.orange, kind: 'line' },
            { label: hs.linear ? 'Lesson 1.5’s chip' : 'If speed fell in step with power', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <Slider label="GPUs the hall owns" value={hs.owned} min={OWNED_MIN} max={OWNED_MAX} step={100} onChange={(v) => s2.set({ owned: v })} display={fmt(hs.owned)} />
        <Slider label="GPU power cap" tone="red" value={hs.cap} min={CAP_MIN} max={100} onChange={(v) => s2.set({ cap: v })} display={`${hs.cap}%`} />
        <Checkbox label="Speed falls in step with power (no lowering of voltage)" checked={hs.linear} onChange={(v) => s2.set({ linear: v })} />
        <Readouts
          items={[
            { label: 'work, in GPUs at full speed', value: fmt(hall.work), tone: 'orange' },
            { label: 'power used', value: `${fmt(hall.mw, 1)} of ${HALL_MW} MW`, tone: 'red' },
          ]}
        />
        <Caption>{hallCaption}</Caption>
      </Figure>

      <P>
        Lower the cap and watch the curve climb. At 70%, {fmt(AT70.running)} of the {fmt(CHALLENGE_OWNED)} GPUs fit under the {HALL_MW} MW, and together they do the work of{' '}
        {fmt(AT70.work)} A-class GPUs at full speed: {pct1(AT70.work / FULL.work - 1)} more than the {fmt(FULL.running)} that full power allows, from the same connection
        and the same chips. The gain keeps growing until every GPU has room; below that, capping further only slows GPUs that were already running.
      </P>

      <Challenge
        id="b"
        figure="Power-Aware Scheduler · the connection"
        question={`With the hall owning ${fmt(CHALLENGE_OWNED)} A-class GPUs and Lesson 1.5’s chip, find the power cap that gets the most work out of the ${HALL_MW} MW.`}
        solved={solvedB}
        status={
          hs.owned !== CHALLENGE_OWNED
            ? `Set the GPUs the hall owns to ${fmt(CHALLENGE_OWNED)} first.`
            : hs.linear
              ? 'Untick the checkbox: use the real chip.'
              : `At ${hs.cap}% the hall does ${fmt(hall.work)} GPUs’ worth of work.`
        }
        success={`Solved. At ${BEST_CAP}%, ${fmt(AT_BEST.running)} GPUs run and do ${fmt(AT_BEST.work)} GPUs’ worth of work, ${pct1(AT_BEST.work / FULL.work - 1)} more than at full power. One percent lower, at ${ALL_FIT_CAP}%, all ${fmt(CHALLENGE_OWNED)} fit, but each is slower, and they do only ${fmt(AT_ALL_FIT.work)}: the best cap sits just above the point where every GPU fits.`}
      />

      <H2>What makes it work</H2>
      <P>
        Now tick the checkbox in <FigRef to="Power-Aware Scheduler · the connection">the second demonstration</FigRef>. If a capped chip lost speed in exact proportion to
        its power — if it could only slow its clock, not lower its voltage — the curve would fall from the first step: a cap that takes 30% off each GPU takes only{' '}
        {pct(1 - drawAtCap(0.7))} off its draw, so the extra GPUs that fit would do less than the speed every GPU gives up, and capping would only lose work. The whole
        opportunity is the shape of Lesson 1.5’s curve,
        where power falls with the square of the voltage and the voltage can fall with the clock. That is the test this chapter asks of every strategy: point to the physics
        that makes it pay, change the physics, and watch it stop paying.
      </P>
      <P>
        It is also a strategy for GPUs already owned, not a reason to buy more. Filling the {HALL_MW} MW with GPUs capped at 70% instead of full-power ones takes{' '}
        {fmt(EXTRA_GPUS)} more of them: about {usd(EXTRA_COST / 1e6, 1)} million a year of servers, network and upkeep at Lesson 4.5’s {usd(HARDWARE_YEAR)} per GPU —
        the building and the electricity are the same {HALL_MW} MW either way — for {fmt(EXTRA_WORK)} GPUs’ worth of extra work. Each unit of that work costs{' '}
        {fmt(EXTRA_COST / EXTRA_WORK / HARDWARE_YEAR, 1)} times the hardware a GPU running flat out needs for one. When megawatts are the scarce thing and the GPUs are
        already bought, capping turns dark hardware into work; when GPUs are the scarce thing, it wastes them.
      </P>
      <P>
        So for a GPU cloud, electricity is less a price to chase than a capacity to use well. The hourly price matters at the margins — in rare spikes, and for cheap work
        that can wait or stop — while the megawatts a site can draw shape everything else. Every strategy so far has used capacity the operator controls. The next lesson
        turns to capacity bought and sold under contract for years at a time, and to the risks that come with promising today what an hour of GPU time will be worth
        tomorrow.
      </P>
    </LessonPage>
  );
}
