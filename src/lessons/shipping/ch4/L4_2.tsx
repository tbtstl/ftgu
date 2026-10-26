import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  FigRef,
  Figure,
  GRAPHIC,
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
  pct,
  usd,
  useScenario,
} from '../../../framework';
import { KESTREL } from '../../../model/shipping/vessels';
import { MARKET_CLASSES } from '../../../model/shipping/trades';
import { seaRoute } from '../../../engines/shipping/network';
import { COMMISSION, ladenDraft } from '../../../engines/shipping/voyage';
import {
  PLANNED,
  equivalentFreight,
  sampleOutcomes,
  timeCharter,
  voyageCharter,
  type CharterVoyage,
  type Outcome,
  type RiskSpread,
} from '../../../engines/shipping/charter';

const CARGO = 75_000;

/** Kestrel's soybean voyage from Santos to Qingdao, as both contracts see it (illustrative terms). */
export const VOYAGE: CharterVoyage = {
  vessel: KESTREL,
  ladenNm: seaRoute('SAN', 'QIN', { draft: ladenDraft(KESTREL, CARGO) })!.nm,
  cargo: CARGO,
  speed: 12,
  laytime: 8,
  portCosts: MARKET_CLASSES.kmax.portCosts,
  canalCost: 0,
  bunker: 600,
  demurrage: 15_000,
};

export const START_HIRE = 15_000;
/** The freight that matches the starting hire as planned, to the cent (the slider's step). */
export const START_FREIGHT = Math.round(equivalentFreight(VOYAGE, START_HIRE) * 100) / 100;

/** The challenge's outcome: dearer bunkers and three days of weather. */
export const CHALLENGE_OUTCOME: Outcome = { bunker: 800, weatherDays: 3, portDelay: 0, offHire: 0 };

/** The lowest freight, to the cent, at which the voyage charter leaves the owner no worse off than the time charter. */
export function matchingFreight(o: Outcome, hire: number): number {
  const target = timeCharter(VOYAGE, hire, o).owner.net;
  // Owner's net is linear in freight: solve, then round up to the next cent.
  const at0 = voyageCharter(VOYAGE, 0, o).owner.net;
  const exact = (target - at0) / (VOYAGE.cargo * (1 - COMMISSION));
  let f = Math.ceil(exact * 100 - 1e-9) / 100;
  if (voyageCharter(VOYAGE, f, o).owner.net < target - 1e-6) f = Math.round((f + 0.01) * 100) / 100;
  return f;
}

export const CHALLENGE_FREIGHT = matchingFreight(CHALLENGE_OUTCOME, START_HIRE);
/** The exact break-even freight for the challenge's outcome, $/t, and how close the reader must come. */
export const BREAK_EVEN = (() => {
  const target = timeCharter(VOYAGE, START_HIRE, CHALLENGE_OUTCOME).owner.net;
  return (target - voyageCharter(VOYAGE, 0, CHALLENGE_OUTCOME).owner.net) / (VOYAGE.cargo * (1 - COMMISSION));
})();
export const FREIGHT_TOLERANCE = 0.02;
/** What each cent of freight adds to the owner's net, after commission, $. */
export const PER_CENT = 0.01 * VOYAGE.cargo * (1 - COMMISSION);
/** With the challenge's outcome and the starting freight, how far the voyage charter leaves the owner short of the time charter, $. */
export const START_SHORTFALL =
  timeCharter(VOYAGE, START_HIRE, CHALLENGE_OUTCOME).owner.net - voyageCharter(VOYAGE, START_FREIGHT, CHALLENGE_OUTCOME).owner.net;

export interface ContractState {
  contract: 'voyage' | 'time';
  freight: number;
  hire: number;
  bunker: number;
  weather: number;
  delay: number;
  offHire: number;
}

/** The challenge's outcome is set: bunkers at $800, three days lost to weather, no port delay, no breakdown, and the starting hire. */
export function outcomeSet(s: ContractState): boolean {
  return s.bunker === CHALLENGE_OUTCOME.bunker && s.weather === CHALLENGE_OUTCOME.weatherDays && s.delay === 0 && s.offHire === 0 && s.hire === START_HIRE;
}

/**
 * The challenge: with that outcome, a freight within two cents of the one at which the voyage charter
 * leaves the owner exactly as well off as the time charter.
 */
export function matchSolved(s: ContractState): boolean {
  return outcomeSet(s) && Math.abs(s.freight - BREAK_EVEN) <= FREIGHT_TOLERANCE + 1e-9;
}

export const DEFAULT_SPREAD = { bunkerSd: 0.12, weatherMean: 1.5, delayMean: 2 };
const BREAKDOWN = { breakdownChance: 0.05, breakdownDays: 3 };
const RUNS = 500;
const SEED = 42;

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const quantile = (s: number[], q: number) => s[Math.floor(q * (s.length - 1))];

export interface RiskSummary {
  ownerVc: number[];
  ownerTc: number[];
  chartVc: number[];
  chartTc: number[];
}

/** 500 seeded outcomes of the voyage under both contracts, sorted. */
export function riskRuns(spread: { bunkerSd: number; weatherMean: number; delayMean: number }, freight: number, hire = START_HIRE): RiskSummary {
  const s: RiskSpread = { ...spread, ...BREAKDOWN };
  const outs = sampleOutcomes(VOYAGE, s, RUNS, SEED);
  const vc = outs.map((o) => voyageCharter(VOYAGE, freight, o));
  const tc = outs.map((o) => timeCharter(VOYAGE, hire, o));
  return {
    ownerVc: sorted(vc.map((r) => r.owner.perUnit)),
    ownerTc: sorted(tc.map((r) => r.owner.perUnit)),
    chartVc: sorted(vc.map((r) => r.charterer.perUnit)),
    chartTc: sorted(tc.map((r) => r.charterer.perUnit)),
  };
}

/** The freight, to the cent, at which the owner's average earnings under the voyage charter reach the time charter's. */
export function averageMatchFreight(spread = DEFAULT_SPREAD, hire = START_HIRE): number {
  const target = mean(riskRuns(spread, 0, hire).ownerTc);
  let lo = 0;
  let hi = 60;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (mean(riskRuns(spread, mid, hire).ownerVc) < target) lo = mid;
    else hi = mid;
  }
  return Math.ceil(hi * 100 - 1e-9) / 100;
}

// Numbers the prose quotes, all at the starting terms.
const PLAN = PLANNED(VOYAGE);
const PLAN_VC = voyageCharter(VOYAGE, START_FREIGHT, PLAN);
const PLAN_TC = timeCharter(VOYAGE, START_HIRE, PLAN);
const at = (o: Partial<Outcome>) => {
  const out = { ...PLAN, ...o };
  return { vc: voyageCharter(VOYAGE, START_FREIGHT, out), tc: timeCharter(VOYAGE, START_HIRE, out) };
};
const DEAR = at({ bunker: 800 });
const STORM = at({ weatherDays: 3 });
const DELAY = at({ portDelay: 4 });
const BROKEN = at({ offHire: 3 });
const BOTH = at(CHALLENGE_OUTCOME);
/** The challenge's gap, split: the voyage owner's extra fuel bill, and the time charter's extra hire, after commission. */
const STORM_FUEL_EXTRA = BOTH.vc.fuel * CHALLENGE_OUTCOME.bunker - PLAN_VC.fuel * PLAN.bunker;
const STORM_HIRE_EXTRA = BOTH.tc.owner.net - PLAN_TC.owner.net;
const RISK0 = riskRuns(DEFAULT_SPREAD, START_FREIGHT);
const AVG_MATCH = averageMatchFreight();

const perDay = (x: number) => `$${fmt(x)}/day`;
const perT = (x: number) => `$${fmt(x, 2)}/t`;
const days = (x: number) => `${fmt(x, 1)} days`;

/** Histogram of a sorted sample into fixed bins, clamped at the ends. */
function histogram(values: number[], lo: number, hi: number, bins: number): number[] {
  const out = Array<number>(bins).fill(0);
  for (const v of values) {
    const k = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)));
    out[k] += 1;
  }
  return out;
}

const VC_COLOR = GRAPHIC.green;
const TC_COLOR = GRAPHIC.teal;

export default function Lesson() {
  const c = useScenario('contract', { contract: 'voyage' as 'voyage' | 'time', freight: START_FREIGHT, hire: START_HIRE, bunker: 600, weather: 0, delay: 0, offHire: 0 });
  const s = c.state;
  const outcome: Outcome = { bunker: s.bunker, weatherDays: s.weather, portDelay: s.delay, offHire: s.offHire };
  const vc = voyageCharter(VOYAGE, s.freight, outcome);
  const tc = timeCharter(VOYAGE, s.hire, outcome);
  const planVcAtTerms = voyageCharter(VOYAGE, s.freight, PLAN);
  const planTcAtTerms = timeCharter(VOYAGE, s.hire, PLAN);
  const eqFreight = equivalentFreight(VOYAGE, s.hire);
  const solved = matchSolved(s);
  const isVoyage = s.contract === 'voyage';
  const fuelCost = vc.fuel * s.bunker;
  const demurrage = VOYAGE.demurrage * s.delay;
  const hireDays = tc.days - s.offHire;

  const ledger = isVoyage
    ? [
        { item: `Freight, ${fmt(CARGO)} t × ${usd(s.freight, 2)}`, owner: s.freight * CARGO, charterer: -s.freight * CARGO },
        { item: `Demurrage, ${fmt(s.delay, 1)} days × ${usd(VOYAGE.demurrage)}`, owner: demurrage, charterer: -demurrage },
        { item: `Commissions, ${pct(COMMISSION)} of freight`, owner: -COMMISSION * s.freight * CARGO, charterer: 0 },
        { item: `Fuel, ${fmt(vc.fuel)} t × ${usd(s.bunker)}`, owner: -fuelCost, charterer: 0 },
        { item: 'Port charges', owner: -VOYAGE.portCosts, charterer: 0 },
      ]
    : [
        { item: `Hire, ${fmt(hireDays, 1)} days × ${usd(s.hire)}`, owner: s.hire * hireDays, charterer: -s.hire * hireDays },
        { item: `Commissions, ${pct(COMMISSION)} of hire`, owner: -COMMISSION * s.hire * hireDays, charterer: 0 },
        { item: `Fuel, ${fmt(tc.fuel)} t × ${usd(s.bunker)}`, owner: 0, charterer: -tc.fuel * s.bunker },
        { item: 'Port charges', owner: 0, charterer: -VOYAGE.portCosts },
      ];
  const result = isVoyage ? vc : tc;
  const money = (x: number) => (Math.abs(x) < 0.5 ? '—' : `${x > 0 ? '+' : '−'}${usd(Math.abs(x))}`);

  // Comparison bars.
  const OX0 = 150;
  const OX1 = 380;
  const CX0 = 420;
  const CX1 = 630;
  const ownerMax = 30_000;
  const chartMax = 30;
  const ox = (v: number) => OX0 + (Math.max(0, Math.min(ownerMax, v)) / ownerMax) * (OX1 - OX0);
  const cx = (v: number) => CX0 + (Math.max(0, Math.min(chartMax, v)) / chartMax) * (CX1 - CX0);
  const rows = [
    { name: 'Voyage charter', r: vc, plan: planVcAtTerms, color: VC_COLOR, y: 44 },
    { name: 'Time charter', r: tc, plan: planTcAtTerms, color: TC_COLOR, y: 84 },
  ];

  let status: string;
  const short = tc.owner.net - vc.owner.net;
  if (s.bunker !== CHALLENGE_OUTCOME.bunker || s.weather !== CHALLENGE_OUTCOME.weatherDays || s.delay !== 0 || s.offHire !== 0)
    status = `First set what happened: bunkers at $800, 3 days of weather, no port delay and no time off hire. Now: ${usd(s.bunker)}, ${fmt(s.weather, 1)}, ${fmt(s.delay, 1)} and ${fmt(s.offHire, 1)}.`;
  else if (s.hire !== START_HIRE) status = `Set the hire back to ${usd(START_HIRE)} a day.`;
  else if (Math.abs(s.freight - START_FREIGHT) < 0.005)
    status = `At ${usd(START_FREIGHT, 2)} a tonne the voyage charter leaves her owner ${usd(short)} short of the time charter. Predict the freight that closes the gap, then set it (the arrow keys move it a cent at a time).`;
  else status = `At ${usd(s.freight, 2)} the voyage charter leaves her owner ${short > 0 ? 'short of' : 'ahead of'} the time charter, by more than two cents’ worth of freight.`;

  // Demonstration 2.
  const rk = useScenario('risk', { ...DEFAULT_SPREAD, freight: START_FREIGHT });
  const { bunkerSd, weatherMean, delayMean, freight: rkFreight } = rk.state;
  const runs = useMemo(() => riskRuns({ bunkerSd, weatherMean, delayMean }, rkFreight), [bunkerSd, weatherMean, delayMean, rkFreight]);
  const HLO = 0;
  const HHI = 25_000;
  const BINS = 50;
  const hv = histogram(runs.ownerVc, HLO, HHI, BINS);
  const ht = histogram(runs.ownerTc, HLO, HHI, BINS);
  const hmax = Math.max(...hv, ...ht, 1);
  const HX0 = 120;
  const HX1 = 624;
  const hx = (v: number) => HX0 + ((Math.max(HLO, Math.min(HHI, v)) - HLO) / (HHI - HLO)) * (HX1 - HX0);
  const bw = (HX1 - HX0) / BINS;
  const panels = [
    { name: 'Voyage charter', h: hv, vals: runs.ownerVc, color: VC_COLOR, base: 92 },
    { name: 'Time charter', h: ht, vals: runs.ownerTc, color: TC_COLOR, base: 176 },
  ];
  const sum = (a: number[]) => ({ avg: mean(a), lo: quantile(a, 0.05), hi: quantile(a, 0.95) });
  const oV = sum(runs.ownerVc);
  const oT = sum(runs.ownerTc);
  const cV = sum(runs.chartVc);
  const cT = sum(runs.chartTc);

  return (
    <LessonPage id="shipping/4.2">
      <P>
        <a href={lessonHref('shipping/4.1')}>The previous lesson</a> watched a spot market clear: ships and cargoes matched at one freight per tonne. But a
        freight per tonne hides a choice. A charterer who needs a ship can buy a voyage — pay so much a tonne to have its cargo carried from one port to another — or hire the
        ship itself by the day and run the voyage on its own account. The two contracts can be set to cost the same. They don’t carry the same risks, and this
        lesson is about the difference.
      </P>
      <P>
        Under a <b>voyage charter</b> the charterer pays <K tone="green">freight</K>, dollars per tonne of cargo. The owner runs the voyage and pays its
        voyage costs: the bunkers, the port charges and any canal tolls. The charterer has a laytime to load and discharge in,
        and pays demurrage if its ports take longer, as in <a href={lessonHref('shipping/2.2')}>Lesson 2.2</a>. Under a <b>time charter</b> the charterer pays{' '}
        <K tone="green">hire</K>, dollars per day, for the use of the ship, crew and all. It buys the bunkers, pays the ports and decides where she goes and how
        fast, the decision we weighed in <a href={lessonHref('shipping/2.3')}>Lesson 2.3</a>. The owner keeps her crewed, insured and in repair, and if she breaks
        down, she is <b>off hire</b>: the hire stops until she is working again. Either way the owner pays brokers and the charterer’s side a commission, here{' '}
        {pct(COMMISSION)} of the freight or the hire.
      </P>
      <P>
        In the next demonstration, Kestrel carries {fmt(CARGO)} tonnes of soybeans from Santos to Qingdao, {fmt(VOYAGE.ladenNm)} nautical miles in our model at{' '}
        {VOYAGE.speed} knots, with {VOYAGE.laytime} days of laytime and demurrage at {usd(VOYAGE.demurrage)} a day. The contract terms start at a freight of{' '}
        {usd(START_FREIGHT, 2)} a tonne and a hire of {usd(START_HIRE)} a day; like every price in this course they are illustrative. Choose which contract to
        look at, then change what actually happens on the voyage — the bunker price paid, days lost to weather, days lost waiting in port, days broken down:
      </P>

      <Figure name="Charter Contract Explorer" scenario={c}>
        <Segmented
          label="Contract"
          value={s.contract}
          onChange={(v) => c.set({ contract: v })}
          options={[
            { value: 'voyage', label: 'Voyage charter' },
            { value: 'time', label: 'Time charter' },
          ]}
        />
        <svg
          className="chart"
          viewBox="0 0 640 112"
          role="img"
          aria-label={`Owner’s earnings: ${perDay(vc.owner.perUnit)} under the voyage charter, ${perDay(tc.owner.perUnit)} under the time charter. Charterer’s cost: ${perT(vc.charterer.perUnit)} and ${perT(tc.charterer.perUnit)}.`}
        >
          <text className="ax" x={OX0} y={14}>
            Owner’s earnings, $ per day
          </text>
          <text className="ax" x={CX0} y={14}>
            Charterer’s cost, $ per tonne
          </text>
          {[0, 10_000, 20_000, 30_000].map((t) => (
            <text key={'o' + t} className="ax ax-m" x={ox(t)} y={108}>
              {t === 0 ? '0' : `${t / 1000}k`}
            </text>
          ))}
          {[0, 10, 20, 30].map((t) => (
            <text key={'c' + t} className="ax ax-m" x={cx(t)} y={108}>
              {`$${t}`}
            </text>
          ))}
          <line className="base" x1={OX0} x2={OX0} y1={22} y2={96} />
          <line className="base" x1={CX0} x2={CX0} y1={22} y2={96} />
          {rows.map((row) => (
            <g key={row.name}>
              <text x={OX0 - 8} y={row.y + 5} textAnchor="end" style={{ fontSize: 12, fontWeight: (row.name === 'Voyage charter') === isVoyage ? 600 : 400, fill: TEXT.ink }}>
                {row.name}
              </text>
              <rect x={OX0} y={row.y - 9} width={Math.max(0, ox(row.r.owner.perUnit) - OX0)} height={18} fill={row.color} opacity={0.85} />
              <line x1={ox(row.plan.owner.perUnit)} x2={ox(row.plan.owner.perUnit)} y1={row.y - 13} y2={row.y + 13} stroke="#333" strokeWidth={1.5} strokeDasharray="3 2" />
              <text x={Math.min(OX1 + 2, ox(row.r.owner.perUnit) + 4)} y={row.y + 4} style={{ fontSize: 11, fill: TEXT.green }} textAnchor={ox(row.r.owner.perUnit) > OX1 - 40 ? 'end' : 'start'}>
                {fmt(row.r.owner.perUnit)}
              </text>
              <rect x={CX0} y={row.y - 9} width={Math.max(0, cx(row.r.charterer.perUnit) - CX0)} height={18} fill={row.color} opacity={0.5} />
              <line x1={cx(row.plan.charterer.perUnit)} x2={cx(row.plan.charterer.perUnit)} y1={row.y - 13} y2={row.y + 13} stroke="#333" strokeWidth={1.5} strokeDasharray="3 2" />
              <text x={Math.min(CX1, cx(row.r.charterer.perUnit) + 4)} y={row.y + 4} style={{ fontSize: 11, fill: TEXT.green }} textAnchor={cx(row.r.charterer.perUnit) > CX1 - 36 ? 'end' : 'start'}>
                {fmt(row.r.charterer.perUnit, 2)}
              </text>
            </g>
          ))}
        </svg>
        <Caption>Bars: what happened. Dashed ticks: the same contract had everything gone to plan.</Caption>
        <DataTable
          caption={`The ${isVoyage ? 'voyage' : 'time'} charter’s ledger: what each side receives (+) and pays (−)`}
          rows={ledger}
          rowKey={(r) => r.item}
          columns={[
            { label: isVoyage ? 'Voyage charter' : 'Time charter', cell: (r) => r.item },
            { label: 'Owner', cell: (r) => money(r.owner), align: 'right' },
            { label: 'Charterer', cell: (r) => money(r.charterer), align: 'right' },
          ]}
          footer={[`Over ${days(result.days)}`, money(result.owner.net), money(result.charterer.net)]}
        />
        <Slider label="Freight (voyage charter)" tone="green" value={s.freight} min={14} max={30} step={0.01} onChange={(v) => c.set({ freight: v })} display={`${usd(s.freight, 2)}/t`} />
        <Slider label="Hire (time charter)" tone="green" value={s.hire} min={8_000} max={30_000} step={250} onChange={(v) => c.set({ hire: v })} display={`${usd(s.hire)}/day`} />
        <Slider label="Bunker price paid" tone="red" value={s.bunker} min={400} max={900} step={10} onChange={(v) => c.set({ bunker: v })} display={`${usd(s.bunker)}/t`} />
        <Slider label="Days lost to weather" tone="teal" value={s.weather} min={0} max={6} step={0.5} onChange={(v) => c.set({ weather: v })} display={days(s.weather)} />
        <Slider label="Port delay beyond laytime" tone="teal" value={s.delay} min={0} max={8} step={0.5} onChange={(v) => c.set({ delay: v })} display={days(s.delay)} />
        <Slider label="Days off hire" tone="teal" value={s.offHire} min={0} max={5} step={0.5} onChange={(v) => c.set({ offHire: v })} display={days(s.offHire)} />
        <Caption>
          As planned, a hire of {usd(s.hire)} a day matches a freight of {usd(eqFreight, 2)} a tonne: both would leave the owner {perDay(timeCharter(VOYAGE, s.hire, PLAN).owner.perUnit)}.
        </Caption>
      </Figure>

      <P>
        Start with everything going to plan. The voyage takes {days(PLAN_VC.days)}, {days(PLAN_VC.seaDays)} of them at sea, and burns {fmt(PLAN_VC.fuel)} tonnes
        of fuel. The time charter at {usd(START_HIRE)} a day, less the {pct(COMMISSION)} commission, leaves Kestrel’s owner {perDay(PLAN_TC.owner.perUnit)}. At{' '}
        {usd(START_FREIGHT, 2)} a tonne, the voyage charter’s freight, less commissions, fuel and port charges, leaves {usd(PLAN_VC.owner.net)} over the same
        days, or {perDay(PLAN_VC.owner.perUnit)}: the voyage’s time-charter equivalent matches the hire, to within the rounding of a cent a tonne. That is the sense
        in which the two contracts are equivalent, and the TCE of <a href={lessonHref('shipping/2.3')}>Lesson 2.3</a> is the bridge between them. The charterer’s
        bills differ a little — {perT(PLAN_VC.charterer.perUnit)} against {perT(PLAN_TC.charterer.perUnit)} — because commission is charged on the whole freight,
        which pays for the fuel too, but only on the hire.
      </P>
      <P>
        Now let things go wrong. Raise the bunker price to $800. Under the voyage charter the owner bought the fuel, so the owner pays: earnings fall to{' '}
        {perDay(DEAR.vc.owner.perUnit)}. Under the time charter the owner doesn’t notice, and the charterer’s cost climbs from {perT(PLAN_TC.charterer.perUnit)} to{' '}
        {perT(DEAR.tc.charterer.perUnit)}. Set the bunker price back and add three days of weather instead. The voyage now takes {days(STORM.vc.days)}; the voyage
        charterer still pays only its freight, so the owner’s net — a smaller {usd(STORM.vc.owner.net)}, since the extra days at sea burn fuel — is spread over
        more days, {perDay(STORM.vc.owner.perUnit)}, while the time
        charterer pays three more days of hire and the fuel burned fighting the sea.
      </P>
      <P>
        Port delays fall the other way. Four days waiting beyond the laytime cost the voyage charterer {usd(4 * VOYAGE.demurrage)} in demurrage, which keeps the
        owner close to whole at {perDay(DELAY.vc.owner.perUnit)}; under the time charter the hire simply runs on. And breakdowns are the owner’s problem under
        both: three days off hire cut her earnings to {perDay(BROKEN.tc.owner.perUnit)} on the time charter and {perDay(BROKEN.vc.owner.perUnit)} on the voyage
        charter, where the lost days come out of her time instead of her hire.
      </P>

      <H2>Who carries what</H2>
      <P>
        Put together, a voyage charter is a fixed price for a job. The owner carries the voyage’s risks — fuel prices, weather, speed, her own reliability — and
        the charterer carries its ports, through laytime and demurrage. A time charter is a rental. The owner carries only her reliability; the charterer carries
        everything about the voyage, and in return controls it. A charterer with its own cargo program and views about routes and speed tends to want ships on
        time charter. One that needs a single cargo moved, and doesn’t want to run a ship, buys a voyage.
      </P>

      <Challenge
        id="a"
        question={`Bunkers rise to $800 a tonne and Kestrel loses three days to weather; no port delay, no time off hire. Set that in the first demonstration with the hire at ${usd(START_HIRE)} and the freight at ${usd(START_FREIGHT, 2)}, and compare the owner’s totals in the two contracts’ ledgers. Predict first: each cent of freight adds ${usd(PER_CENT, 2)} to her owner’s net (${fmt(CARGO)} tonnes, less commission). What freight would have left her as well off as the time charter? Set it, to within two cents.`}
        figure="Charter Contract Explorer"
        solved={solved}
        status={status}
        success={`Solved. The break-even is ${usd(BREAK_EVEN, 2)} a tonne: the ${usd(START_SHORTFALL)} gap is ${fmt(START_SHORTFALL / PER_CENT)} cents of freight, ${usd(BREAK_EVEN - START_FREIGHT, 2)} on top of the starting ${usd(START_FREIGHT, 2)}. Of that, ${usd(STORM_FUEL_EXTRA / (100 * PER_CENT), 2)} pays for the extra fuel — ${fmt(BOTH.vc.fuel)} tonnes at $800 instead of ${fmt(PLAN_VC.fuel)} at $600 — and ${usd(STORM_HIRE_EXTRA / (100 * PER_CENT), 2)} matches the three extra days of hire the time charter pays. An owner fixing a voyage charter is betting on the fuel price and the weather; that bet is part of what freight pays for.`}
      />

      <H2>Trips, periods and bareboats</H2>
      <P>
        Kestrel’s time charter covers a single voyage, a <b>trip time charter</b>. Time charters also run for months or years at a fixed daily hire: a{' '}
        <b>period charter</b>. An owner who fixes Kestrel for a year at {usd(START_HIRE)} a day has swapped the market’s swings — the boom and bust of{' '}
        <a href={lessonHref('shipping/2.5')}>Lesson 2.5</a> — for a known income, and the charterer has taken them on; whether that is a good trade depends on
        where the market goes next, the question of <a href={lessonHref('shipping/5.3')}>Lesson 5.3</a>. At the far end, a <b>bareboat charter</b> hands over the
        ship itself: the charterer crews, insures and runs her, and the owner is little more than a financier.
      </P>

      <H2>Risk, not just rates</H2>
      <P>
        One voyage tells a single story. In the next demonstration, the same voyage is sailed {fmt(RUNS)} times, each with its own draw of what happens: a bunker
        price that may end up higher or lower than when the contract was signed, weather and port delays that vary from voyage to voyage, and a{' '}
        {pct(BREAKDOWN.breakdownChance)} chance of a breakdown averaging {BREAKDOWN.breakdownDays} days. The histograms show the owner’s earnings per day under each
        contract, with the hire fixed at {usd(START_HIRE)}. Widen or narrow the uncertainty, and change the voyage freight:
      </P>

      <Figure name="Charter Contract Explorer · risk" scenario={rk}>
        <Legend
          items={[
            { label: 'Voyage charter', color: VC_COLOR },
            { label: 'Time charter', color: TC_COLOR },
          ]}
        />
        <svg
          className="chart"
          viewBox="0 0 640 214"
          role="img"
          aria-label={`Owner’s earnings in ${RUNS} simulated voyages. Voyage charter: average ${perDay(oV.avg)}, 5th to 95th percentile ${perDay(oV.lo)} to ${perDay(oV.hi)}. Time charter: average ${perDay(oT.avg)}, ${perDay(oT.lo)} to ${perDay(oT.hi)}.`}
        >
          <text className="ax" x={HX0} y={12}>
            Voyages, by the owner’s earnings per day
          </text>
          {panels.map((p) => {
            const m = sum(p.vals);
            return (
              <g key={p.name}>
                <text x={HX0 - 10} y={p.base - 26} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: TEXT.ink }}>
                  {p.name}
                </text>
                {p.h.map((n, i) => (
                  <rect key={i} x={HX0 + i * bw + 0.5} y={p.base - (n / hmax) * 64} width={bw - 1} height={(n / hmax) * 64} fill={p.color} opacity={0.85} />
                ))}
                <line className="base" x1={HX0} x2={HX1} y1={p.base} y2={p.base} />
                <line x1={hx(m.lo)} x2={hx(m.hi)} y1={p.base + 6} y2={p.base + 6} stroke="#333" strokeWidth={1.5} />
                <line x1={hx(m.avg)} x2={hx(m.avg)} y1={p.base - 68} y2={p.base + 9} stroke="#333" strokeWidth={1.5} strokeDasharray="3 2" />
              </g>
            );
          })}
          {[0, 5_000, 10_000, 15_000, 20_000, 25_000].map((t) => (
            <text key={t} className="ax ax-m" x={hx(t)} y={198}>
              {t === 0 ? '$0' : `$${t / 1000}k`}
            </text>
          ))}
          <text className="ax ax-e" x={HX1} y={212}>
            dashed: average · bar under each: middle 90% of voyages
          </text>
        </svg>
        <Readouts
          items={[
            { label: `owner, voyage charter · middle 90%: ${fmt(oV.lo)}–${fmt(oV.hi)}`, value: perDay(oV.avg), tone: 'green' },
            { label: `owner, time charter · middle 90%: ${fmt(oT.lo)}–${fmt(oT.hi)}`, value: perDay(oT.avg), tone: 'green' },
            { label: `charterer, voyage charter · ${fmt(cV.lo, 2)}–${fmt(cV.hi, 2)}`, value: perT(cV.avg), tone: 'green' },
            { label: `charterer, time charter · ${fmt(cT.lo, 2)}–${fmt(cT.hi, 2)}`, value: perT(cT.avg), tone: 'green' },
          ]}
        />
        <Slider label="Bunker price uncertainty" tone="red" value={rk.state.bunkerSd} min={0} max={0.3} step={0.01} onChange={(v) => rk.set({ bunkerSd: v })} display={`±${pct(rk.state.bunkerSd)}`} />
        <Slider label="Average weather delay" tone="teal" value={rk.state.weatherMean} min={0} max={4} step={0.25} onChange={(v) => rk.set({ weatherMean: v })} display={days(rk.state.weatherMean)} />
        <Slider label="Average port delay" tone="teal" value={rk.state.delayMean} min={0} max={5} step={0.25} onChange={(v) => rk.set({ delayMean: v })} display={days(rk.state.delayMean)} />
        <Slider label="Freight (voyage charter)" tone="green" value={rk.state.freight} min={14} max={30} step={0.01} onChange={(v) => rk.set({ freight: v })} display={`${usd(rk.state.freight, 2)}/t`} />
      </Figure>

      <P>
        The two histograms tell the story at a glance. Under the time charter the owner’s earnings barely move: the middle 90% of voyages pay between{' '}
        {perDay(quantile(RISK0.ownerTc, 0.05))} and {perDay(quantile(RISK0.ownerTc, 0.95))}, and only a breakdown dents them. Under the voyage charter they spread
        from {perDay(quantile(RISK0.ownerVc, 0.05))} to {perDay(quantile(RISK0.ownerVc, 0.95))}. The charterer’s costs mirror them: steadier under the voyage charter, where only demurrage moves them,{' '}
        {perT(quantile(RISK0.chartVc, 0.05))} to {perT(quantile(RISK0.chartVc, 0.95))}, and spread from {perT(quantile(RISK0.chartTc, 0.05))} to{' '}
        {perT(quantile(RISK0.chartTc, 0.95))} under the time charter. Nothing about the voyage changed; the contract decided who carries its variance.
      </P>
      <P>
        Notice the averages, too. At {usd(START_FREIGHT, 2)}, the freight that matched the hire as planned, the voyage-charter owner averages{' '}
        {perDay(mean(RISK0.ownerVc))} against {perDay(mean(RISK0.ownerTc))}: weather and port delays can only add days, so the plan is close to the best case. To
        break even on average the freight must be about {usd(AVG_MATCH, 2)} — an allowance for the delays every owner knows to expect, before any reward for
        taking the risk. Slide the uncertainty to zero in <FigRef to="Charter Contract Explorer · risk">this demonstration</FigRef> and the two contracts collapse
        back into one.
      </P>
      <P>
        Every fixture, whichever contract it uses, is a private deal between two parties, agreed through brokers at a price nobody else sees in full. Thousands are
        made each month. So how does anyone — an owner pricing a voyage, a bank valuing a ship, a trader — know what “the market rate” is today?{' '}
        <a href={lessonHref('shipping/4.3')}>The next lesson</a> builds the benchmarks that answer that question.
      </P>
    </LessonPage>
  );
}
