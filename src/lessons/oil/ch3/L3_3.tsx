import { useEffect, useMemo, useState } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, Sub, fmt, lessonHref, mix, pct, usd, useScenario } from '../../../framework';
import { crude } from '../../../engines/oil/assay';
import { HDS, ULSD_LIMIT, distill, hdsHydrogen, hdsSulfurOut, type HdsFeed } from '../../../engines/oil/refining';
import { FUEL_OIL_SULFUR, JET_SULFUR, marginPerBarrel, planRefinery, type RefineryPlan } from '../../../engines/oil/refinery';
import { CRUDE_IDS, CRUDE_SPECS, type CrudeId } from '../../../model/oil/crudes';
import { CORRAN, CRUDE_PRICE, HYDROGEN_COST } from '../../../model/oil/refinery';
import { XYChart } from '../shared/charts';

const NAME: Record<CrudeId, string> = Object.fromEntries(CRUDE_SPECS.map((s) => [s.id, s.name])) as Record<CrudeId, string>;
const SULFUR = '#c99a1e';
const SULFUR_TEXT = '#8a6500';
const HYDROGEN = '#2a9d90';
const HYDROGEN_TEXT = '#23776e';

// ---------------------------------------------------------------------------
// Figure 1: one hydrotreater.

/** Share of a diesel cut's sulfur in the hard, shielded molecules. */
export const HARD_SHARE = 0.15;
/** Hydrogen consumed regardless of sulfur (olefins and some aromatics), scf/bbl. */
export const BASE_H2 = 150;

/** A crude's straight-run diesel cut as hydrotreater feed. */
export function feedOf(id: CrudeId): HdsFeed & { sg: number } {
  const d = distill(crude(id)).diesel;
  return { sulfur: d.sulfur, hardShare: HARD_SHARE, baseHydrogen: BASE_H2, sg: d.sg };
}

export const LHSV_MIN = 0.3;
export const LHSV_MAX = 3;
export const LHSV_STEP = 0.05;
export const CHALLENGE_TEMP = 370;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Product sulfur, ppm. */
export function productPpm(id: CrudeId, tempC: number, lhsv: number): number {
  return hdsSulfurOut(feedOf(id), tempC, lhsv) * 10000;
}

/** Challenge a: Northfield's diesel at 15 ppm or less at 370 °C, at the highest space velocity on the slider. */
export function throughputSolved(id: CrudeId, tempC: number, lhsv: number): boolean {
  if (id !== 'northfield' || tempC !== CHALLENGE_TEMP) return false;
  const ok = (l: number) => hdsSulfurOut(feedOf(id), tempC, l) <= ULSD_LIMIT + 1e-12;
  const next = round2(lhsv + LHSV_STEP);
  return ok(lhsv) && (next > LHSV_MAX + 1e-9 || !ok(next));
}

/** The diesel hydrotreater's feed, m³ per hour, at its full 55 kb/d. */
export const DHT_M3_PER_HOUR = (CORRAN.capacity.dht * 1000 * 0.158987) / 24;

/**
 * An illustrative catalyst-and-reactor charge, $ per barrel: $0.40 at a space velocity of 1 and
 * 350 °C, proportional to the catalyst volume (1/LHSV), and doubling for every 20 °C hotter
 * because a hotter catalyst cokes up and must be replaced sooner. A model assumption, not data.
 */
export const CATALYST_CHARGE = 0.4;
export function catalystCharge(tempC: number, lhsv: number): number {
  return (CATALYST_CHARGE / lhsv) * Math.pow(2, (tempC - 350) / 20);
}

/** Hydrogen cost plus the catalyst charge, $ per barrel of feed. */
export function treatingCost(id: CrudeId, tempC: number, lhsv: number): { hydrogen: number; catalyst: number; scf: number } {
  const f = feedOf(id);
  const scf = hdsHydrogen(f, hdsSulfurOut(f, tempC, lhsv), f.sg);
  return { hydrogen: (scf / 1000) * HYDROGEN_COST, catalyst: catalystCharge(tempC, lhsv), scf };
}

function ppm(x: number): string {
  if (x >= 100) return `${fmt(x)} ppm`;
  if (x >= 10) return `${fmt(x, 1)} ppm`;
  if (x >= 0.1) return `${fmt(x, 2)} ppm`;
  return 'under 0.1 ppm';
}

/** The largest space velocity on the slider grid that reaches a sulfur target (ppm) at a temperature. */
function maxLhsv(id: CrudeId, tempC: number, targetPpm: number): number {
  let best = 0;
  for (let i = 0; i <= Math.round((LHSV_MAX - LHSV_MIN) / LHSV_STEP); i++) {
    const l = round2(LHSV_MIN + i * LHSV_STEP);
    if (productPpm(id, tempC, l) <= targetPpm + 1e-9) best = l;
  }
  return best;
}

/**
 * For each temperature from 340 to 390 °C, the treating cost of Northfield's diesel at the highest
 * space velocity that reaches 15 ppm; the cheapest and dearest of those, $/bbl.
 */
export const CHEAPEST_15 = (() => {
  const costs: number[] = [];
  for (let t = 340; t <= 390; t++) {
    const l = maxLhsv('northfield', t, 15);
    if (l > 0) {
      const c = treatingCost('northfield', t, l);
      costs.push(c.hydrogen + c.catalyst);
    }
  }
  return { min: Math.min(...costs), max: Math.max(...costs) };
})();

/** How much faster both reactions run at 370 °C than at 350 °C. */
const SPEEDUP_370 = Math.exp((-HDS.activation / 8.314) * (1 / (370 + 273.15) - 1 / (350 + 273.15)));

/** A hydrotreating reactor: oil and hydrogen in at the top, a bed sized by space velocity, treated oil out. */
function Reactor({ tempC, lhsv, feedPpm, outPpm, catalystM3 }: { tempC: number; lhsv: number; feedPpm: number; outPpm: number; catalystM3: number }) {
  const heat = (tempC - 320) / 80;
  const bedH = Math.max(36, Math.min(170, catalystM3 * 0.14));
  const cx = 300;
  const top = 40;
  const vesselH = bedH + 70;
  const dots = Array.from({ length: 40 }, (_, i) => ({ x: cx - 46 + (i % 8) * 13, y: top + 40 + Math.floor(i / 8) * (bedH / 5) + ((i % 3) * bedH) / 15 }));
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`A hydrotreating reactor at ${tempC} °C and a space velocity of ${fmt(lhsv, 2)} per hour, holding ${fmt(catalystM3)} cubic meters of catalyst for 55,000 barrels a day. Diesel enters with ${ppm(feedPpm)} of sulfur and leaves with ${ppm(outPpm)}; the sulfur leaves as hydrogen sulfide.`}
    >
      <rect x={cx - 62} y={top} width={124} height={vesselH} rx={40} fill={mix('#f4f1ea', '#f2c4b6', heat)} stroke="#777" strokeWidth={2} />
      <rect x={cx - 52} y={top + 34} width={104} height={bedH} fill="#d9d4c7" stroke="#a9a399" strokeDasharray="3 3" />
      {dots
        .filter((d) => d.y < top + 34 + bedH - 4)
        .map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={3} fill="#8d8579" />
        ))}
      <text x={cx} y={top + 34 + bedH / 2 + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: '#333', paintOrder: 'stroke', stroke: '#d9d4c7', strokeWidth: 4 }}>
        catalyst {fmt(catalystM3)} m³
      </text>
      {/* Feed in */}
      <path d={`M60 ${top + 14} L${cx} ${top + 14} L${cx} ${top + 30}`} fill="none" stroke="#d0702a" strokeWidth={5} />
      <path d={`M60 ${top - 6} L${cx - 20} ${top - 6} L${cx - 20} ${top + 14}`} fill="none" stroke={HYDROGEN} strokeWidth={3} />
      <text x={60} y={top + 30} className="ax">
        diesel cut in: {ppm(feedPpm)} sulfur
      </text>
      <text x={60} y={top - 12} className="ax" style={{ fill: HYDROGEN_TEXT }}>
        hydrogen in
      </text>
      {/* Product out */}
      <path d={`M${cx} ${top + vesselH} L${cx} ${top + vesselH + 20} L590 ${top + vesselH + 20}`} fill="none" stroke="#d0702a" strokeWidth={5} />
      <text x={590} y={top + vesselH + 12} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: outPpm <= 15 ? '#3f7a1e' : '#c4382f' }}>
        treated diesel: {ppm(outPpm)}
      </text>
      <path d={`M${cx + 62} ${top + 50} L470 ${top + 50}`} fill="none" stroke={SULFUR} strokeWidth={3} strokeDasharray="6 4" />
      <text x={476} y={top + 46} className="ax" style={{ fill: SULFUR_TEXT }}>
        hydrogen sulfide
      </text>
      <text x={476} y={top + 62} className="ax">
        → amine unit → sulfur plant
      </text>
      <text x={cx - 70} y={top + vesselH / 2} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: '#c4382f' }}>
        {tempC} °C
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Figure 2: the whole refinery on a Pinyon–Northfield slate.

export const SHARE_STEP = 5;

export interface Slate {
  share: number;
  plan: RefineryPlan;
  marginPerBbl: number;
}

let slates: Slate[] | null = null;
/** The refinery planned on every slate from 0% to 100% Northfield Sour, in 5% steps (solved once). */
export function getSlates(): Slate[] {
  if (!slates) {
    slates = Array.from({ length: 100 / SHARE_STEP + 1 }, (_, i) => {
      const share = i * SHARE_STEP;
      const s = share / 100;
      const plan = planRefinery({ crudeAvailable: { pinyon: (1 - s) * CORRAN.capacity.cdu, northfield: s * CORRAN.capacity.cdu, seaboard: 0, coldwater: 0 } });
      return { share, plan, marginPerBbl: marginPerBarrel(plan) };
    });
  }
  return slates;
}

function slateAt(share: number): Slate {
  const all = getSlates();
  return all[Math.max(0, Math.min(all.length - 1, Math.round(share / SHARE_STEP)))];
}

/** Hydrogen-plant output below this, MMscf/d, counts as idle. */
const PLANT_ON = 0.01;

/** Challenge b: the smallest Northfield share at which the hydrogen plant has to run. */
export function hydrogenPlantSolved(share: number): boolean {
  if (share <= 0) return false;
  return slateAt(share).plan.hydrogen.plant > PLANT_ON && slateAt(share - SHARE_STEP).plan.hydrogen.plant <= PLANT_ON;
}

/** One row per limit: how much of it the slate uses. */
function LimitRows({ plan }: { plan: RefineryPlan }) {
  const rows = [
    { label: 'Diesel hydrotreater', used: plan.unitFeed.dht, cap: CORRAN.capacity.dht, unit: 'kb/d', color: '#d0702a', digits: 1 },
    { label: 'Hydrogen plant', used: plan.hydrogen.plant, cap: CORRAN.hydrogenPlant, unit: 'MMscf/d', color: HYDROGEN, digits: 1 },
    { label: 'Sulfur plant', used: plan.sulfurPlant, cap: CORRAN.sulfurPlant, unit: 't/d', color: SULFUR, digits: 0 },
    { label: 'Fuel oil sulfur', used: plan.fuelOilSulfur, cap: FUEL_OIL_SULFUR, unit: '%', color: '#5d4637', digits: 2 },
  ];
  const X0 = 170;
  const W = 300;
  const rowH = 30;
  return (
    <svg
      className="chart"
      viewBox={`0 0 640 ${rowH * rows.length + 22}`}
      role="img"
      aria-label={`Use of the refinery’s limits: ${rows.map((r) => `${r.label.toLowerCase()} ${fmt(r.used, r.digits)} of ${fmt(r.cap, r.digits === 2 ? 1 : 0)} ${r.unit}`).join('; ')}.`}
    >
      <text className="ax" x={X0} y={12}>
        Share of each limit in use
      </text>
      {rows.map((r, i) => {
        const y = 20 + i * rowH;
        const f = Math.max(0, Math.min(1, r.used / r.cap));
        const full = f > 0.999;
        return (
          <g key={r.label}>
            <text x={X0 - 10} y={y + rowH / 2 + 4} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
              {r.label}
            </text>
            <rect x={X0} y={y + 6} width={W} height={rowH - 12} fill="#efeee9" />
            <rect x={X0} y={y + 6} width={W * f} height={rowH - 12} fill={r.color} opacity={0.85} />
            <text x={X0 + W + 10} y={y + rowH / 2 + 4} style={{ fontSize: 12, fontWeight: full ? 600 : 400, fill: full ? '#c4382f' : '#333' }}>
              {fmt(r.used, r.digits)} of {fmt(r.cap, r.digits === 2 ? 1 : 0)} {r.unit}
              {full ? ' · full' : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario('reactor', { feed: 'northfield' as CrudeId, temp: 350, lhsv: 1 });
  const { feed, temp, lhsv } = s1.state;
  const f = feedOf(feed);
  const feedPpm = f.sulfur * 10000;
  const out = productPpm(feed, temp, lhsv);
  const cost = treatingCost(feed, temp, lhsv);
  const catalystM3 = DHT_M3_PER_HOUR / lhsv;
  const curve = useMemo(() => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 54; i++) {
      const l = LHSV_MIN + i * LHSV_STEP;
      pts.push([l, Math.max(0.1, productPpm(feed, temp, l))]);
    }
    return pts;
  }, [feed, temp]);
  const solvedA = throughputSolved(feed, temp, lhsv);

  // Numbers for the prose, all computed from the engines.
  const nf = feedOf('northfield');
  const nfPpm = nf.sulfur * 10000;
  const nf350 = productPpm('northfield', 350, 1);
  const nf350Hard = HARD_SHARE * Math.exp(-HDS.kHard) * nfPpm;
  const l500 = maxLhsv('northfield', 350, 500);
  const l15 = maxLhsv('northfield', 350, 15);
  const h2 = (id: CrudeId) => hdsHydrogen(feedOf(id), ULSD_LIMIT, feedOf(id).sg);

  const s2 = useScenario('slate', { share: 20 });
  const share = s2.state.share;
  const cur = slateAt(share);
  const all = getSlates();
  const solvedB = hydrogenPlantSolved(share);
  // The shaded "plant runs" band would give challenge b away: it appears once the challenge is solved.
  const [bandShown, setBandShown] = useState(false);
  useEffect(() => {
    if (solvedB) setBandShown(true);
  }, [solvedB]);
  const first = all[0];
  const last = all[all.length - 1];
  const dhtFull = all.find((s) => s.plan.unitFeed.dht >= CORRAN.capacity.dht - 1e-6)!;
  const beforeFull = all[all.indexOf(dhtFull) - 1];
  const foCapped = all.find((s) => s.plan.fuelOilSulfur >= FUEL_OIL_SULFUR - 1e-6)!;
  const plantOn = all.find((s) => s.plan.hydrogen.plant > PLANT_ON)!;
  const best = all.reduce((a, s) => (s.marginPerBbl > a.marginPerBbl ? s : a), all[0]);
  // The squeeze: what gives once the hydrotreater is full.
  const nfCuts = distill(crude('northfield'));
  const cgoPeak = beforeFull.plan.flows.cgoD;
  const cgoGone = all.find((s) => s.share > dhtFull.share && s.plan.flows.cgoD < 0.05)!;
  const iFull = all.indexOf(dhtFull);
  const stepRoom = all[1].marginPerBbl - all[0].marginPerBbl;
  const stepFull = all[iFull + 2].marginPerBbl - all[iFull + 1].marginPerBbl;
  const plantMax = Math.max(...all.map((s) => s.plan.hydrogen.plant));
  const belowPeak = best.plan.margin - last.plan.margin;
  const plantArea = all.filter((s) => s.plan.hydrogen.plant > PLANT_ON).map((s) => s.share);

  return (
    <LessonPage id="oil/3.3">
      <P>
        <a href={lessonHref('oil/3.2')}>Lesson 3.2</a> broke heavy molecules into lighter ones, and found two ways to balance the hydrogen: reject carbon as coke, or add
        hydrogen. Either way, the streams a refinery makes still carry the crude’s <K tone="orange">sulfur</K>, and so do the straight-run cuts from its crude unit. Northfield
        Sour’s diesel cut, from <a href={lessonHref('oil/1.2')}>Lesson 1.2</a>, is {fmt(nf.sulfur, 2)}% sulfur: about {fmt(Math.round(nfPpm / 100) * 100)} parts per
        million (ppm), since 1% is 10,000 ppm. Road diesel in the United States may hold 15 ppm. Closing a gap of more than {fmt(Math.floor(nfPpm / 15 / 50) * 50)} times is the job of the hydrotreater, and this lesson is
        about what that job takes.
      </P>
      <P>
        A hydrotreater mixes the oil with <K tone="teal">hydrogen</K>, heats it to roughly 300–400 °C at tens of atmospheres, and passes it over a catalyst — usually
        cobalt- or nickel-molybdenum on a porous alumina support. On the catalyst, hydrogen breaks the bonds holding each sulfur atom into its molecule. The sulfur
        leaves as hydrogen sulfide, H<Sub>2</Sub>S, and the hydrocarbon keeps the hydrogen in its place. The hydrogen sulfide is washed out of the gas by an amine
        solution and sent to a sulfur plant, which turns it into elemental sulfur that the refinery sells. Nitrogen comes out the same way, as ammonia, and metals
        stay behind on the catalyst.
      </P>
      <P>
        Not all sulfur is equally easy to reach. In thiols, sulfides and simple thiophenes it comes out quickly. The stubborn remainder sits in dibenzothiophenes —
        three fused rings with the sulfur atom in the middle one — and worst of all when methyl groups next to the sulfur shield it from the catalyst, as in
        4,6-dimethyldibenzothiophene. Our model treats a diesel cut’s sulfur as two lumps: {pct(1 - HARD_SHARE)} easy and {pct(HARD_SHARE)} hard, each disappearing at its
        own rate, and both rates rising with <K tone="red">temperature</K>. How long the oil spends on the catalyst is set by the <b>liquid hourly space velocity</b>,
        or LHSV: the volume of feed per hour divided by the volume of catalyst. An LHSV of 1 means an hour of contact; halving it doubles both the time and the
        catalyst.
      </P>
      <P>
        In the next demonstration, choose a crude’s diesel cut, then set the reactor’s temperature and space velocity. The chart shows the sulfur left at every space
        velocity at the current temperature, on a logarithmic scale; the reactor is drawn for the refinery’s 55,000-barrel-a-day hydrotreater, its catalyst bed sized by
        the space velocity:
      </P>

      <Figure name="Refinery Upgrading Lab" scenario={s1}>
        <Segmented label="Feed: the diesel cut of" value={feed} onChange={(v) => s1.set({ feed: v })} options={CRUDE_IDS.map((id) => ({ value: id, label: NAME[id] }))} />
        <Reactor tempC={temp} lhsv={lhsv} feedPpm={feedPpm} outPpm={out} catalystM3={catalystM3} />
        <XYChart
          ariaLabel={`Sulfur left in ${NAME[feed]} diesel against space velocity at ${temp} °C, on a logarithmic scale. At ${fmt(lhsv, 2)} per hour it is ${ppm(out)}; the limit is 15 ppm.`}
          height={210}
          x={[LHSV_MIN, LHSV_MAX]}
          y={[0.1, 30000]}
          logY
          xTicks={[0.5, 1, 1.5, 2, 2.5, 3]}
          xFormat={(v) => fmt(v, 1)}
          yTicks={[0.1, 1, 10, 100, 1000, 10000]}
          yFormat={(v) => (v < 1 ? fmt(v, 1) : fmt(v))}
          xLabel="space velocity, per hour (more throughput →)"
          yLabel="Sulfur in the product, ppm (log scale)"
          series={[{ points: curve, color: SULFUR, width: 3 }]}
          refs={[
            { axis: 'y', at: feedPpm, color: '#8a8a8a', label: `feed, ${ppm(feedPpm)}` },
            { axis: 'y', at: 15, color: '#c4382f', label: 'road diesel limit, 15 ppm' },
            { axis: 'x', at: lhsv, cursor: true },
          ]}
          markers={[{ x: lhsv, y: Math.max(0.1, out), color: SULFUR_TEXT, r: 6 }]}
        />
        <Readouts
          items={[
            { label: <K tone="orange">sulfur out</K>, value: ppm(out), tone: out <= 15 ? 'green' : 'red' },
            { label: <K tone="teal">hydrogen used</K>, value: `${fmt(cost.scf)} scf/bbl`, tone: 'teal' },
            { label: <K c="price">treating cost</K>, value: `${usd(cost.hydrogen + cost.catalyst, 2)}/bbl`, tone: 'green' },
          ]}
        />
        <Slider label="Reactor temperature" tone="red" value={temp} min={320} max={400} onChange={(v) => s1.set({ temp: v })} display={`${temp} °C`} />
        <Slider
          label="Space velocity (LHSV)"
          tone="orange"
          value={lhsv}
          min={LHSV_MIN}
          max={LHSV_MAX}
          step={LHSV_STEP}
          onChange={(v) => s1.set({ lhsv: round2(v) })}
          display={`${fmt(lhsv, 2)} per hour`}
        />
        <Caption>
          Treating cost: hydrogen at an illustrative {usd(HYDROGEN_COST)} per thousand standard cubic feet, {usd(cost.hydrogen, 2)}/bbl, plus a model charge for
          catalyst and reactor of {usd(cost.catalyst, 2)}/bbl that grows with the catalyst volume and with temperature.
        </Caption>
      </Figure>

      <P>
        Start with Northfield’s diesel at 350 °C and a space velocity of 1. The reactor removes more than 99.5% of the sulfur, from about{' '}
        {fmt(Math.round(nfPpm / 100) * 100)} ppm to {fmt(nf350)} — and that still fails the limit more than three times over. Every one of those {fmt(nf350)} ppm is hard
        sulfur: in the model, the easy lump is essentially gone within the first half hour on the catalyst, and what remains, {fmt(nf350Hard)} ppm, is the hard lump’s
        share. Drag the space
        velocity and watch the curve. At 350 °C the reactor can run at an LHSV of {fmt(l500, 2)} and still reach 500 ppm, the limit for American road diesel from 1993
        until the 15 ppm standard took effect in 2006. Reaching 15 ppm needs an LHSV of {fmt(l15, 2)}: almost {fmt(l500 / l15)} times as much catalyst for the last
        stretch.
      </P>

      <H2>Temperature and throughput</H2>
      <P>
        Heat is the other lever. In the model, raising the reactor from 350 to 370 °C makes both reactions run about {fmt(SPEEDUP_370, 1)} times as fast, so the same
        catalyst can treat more oil. It isn’t free: a hotter catalyst lays down coke faster and has to be replaced sooner. The treating cost in the readout counts the
        hydrogen and an illustrative catalyst charge that grows with the catalyst volume and doubles for every 20 °C. In this model the two levers trade off almost
        evenly: anywhere from 340 to 390 °C, with the space velocity set as high as the limit allows, Northfield’s diesel costs between{' '}
        {usd(CHEAPEST_15.min, 2)} and {usd(CHEAPEST_15.max, 2)} a barrel to treat. Refiners use that freedom over a catalyst’s life, starting cool and raising the
        temperature as the catalyst ages.
      </P>

      <Challenge
        id="a"
        question={`Bring Northfield’s diesel to 15 ppm or less at ${CHALLENGE_TEMP} °C with the highest throughput you can. Estimate first: at 350 °C it took a space velocity of ${fmt(l15, 2)}, and at ${CHALLENGE_TEMP} °C the reactions run about ${fmt(SPEEDUP_370, 1)} times as fast. Then find the largest space velocity, to the nearest 0.05, that still meets the limit.`}
        solved={solvedA}
        status={
          feed !== 'northfield' || temp !== CHALLENGE_TEMP
            ? `Choose Northfield’s diesel and set the reactor to ${CHALLENGE_TEMP} °C.`
            : `At an LHSV of ${fmt(lhsv, 2)}, the diesel leaves with ${ppm(out)}.`
        }
        success={`Solved: an LHSV of ${fmt(lhsv, 2)}, leaving ${ppm(out)}. At ${CHALLENGE_TEMP} °C the hydrotreater needs ${fmt(DHT_M3_PER_HOUR / lhsv)} m³ of catalyst for 55,000 barrels a day, against ${fmt(DHT_M3_PER_HOUR / l15)} m³ at 350 °C. One more step, to ${fmt(round2(lhsv + LHSV_STEP), 2)}, and the hard sulfur doesn’t have time to go.`}
      />

      <H2>Where the hydrogen comes from</H2>
      <P>
        Each sulfur atom removed takes about three molecules of hydrogen in our model, on top of a base of {BASE_H2} standard cubic feet per barrel for the double bonds and
        aromatic rings the catalyst saturates along the way. So hydrogen demand follows sulfur: treating Pinyon Light’s diesel to 15 ppm takes {fmt(h2('pinyon'))}{' '}
        scf per barrel, Northfield’s {fmt(h2('northfield'))}, Coldwater Heavy’s {fmt(h2('coldwater'))}. Some hydrogen comes free. The catalytic reformer, which turns
        heavy naphtha into high-octane gasoline, strips hydrogen from the naphtha as it turns rings into aromatics: in our model, a thousand standard cubic feet for every barrel
        it processes. The rest must come from a hydrogen plant, which makes it from natural gas and steam at a cost — {usd(HYDROGEN_COST)} per thousand standard cubic
        feet in our model.
      </P>
      <P>
        A refinery feels this across the whole plant, not in one reactor. In the next demonstration, the Corran refinery runs a slate of Pinyon Light and Northfield
        Sour, and chooses its own routing — which streams go to which unit — to earn the most, using the planning model that{' '}
        <a href={lessonHref('oil/3.5')}>Lesson 3.5</a> opens up. Its prices are the course’s simulated reference prices, with Northfield delivered at{' '}
        {usd(CRUDE_PRICE.pinyon - CRUDE_PRICE.northfield, 2)} less than Pinyon. Make the slate sourer:
      </P>

      <Figure name="Refinery Upgrading Lab · hydrogen balance" scenario={s2}>
        <Legend
          items={[
            { label: 'Hydrogen the hydrotreater uses', color: HYDROGEN, kind: 'line' },
            { label: 'Hydrogen the reformer makes', color: HYDROGEN, kind: 'line', dashed: true },
            ...(bandShown ? [{ label: 'Hydrogen plant running', color: 'rgba(42, 157, 144, 0.14)' }] : []),
          ]}
        />
        <XYChart
          ariaLabel={`Hydrogen across slates from all Pinyon Light to all Northfield Sour. At ${share}% Northfield, the hydrotreater uses ${fmt(cur.plan.hydrogen.used, 1)} MMscf/d, the reformer makes ${fmt(cur.plan.hydrogen.reformer, 1)} and the hydrogen plant ${fmt(cur.plan.hydrogen.plant, 1)}.`}
          height={210}
          x={[0, 100]}
          y={[0, 30]}
          xTicks={[0, 20, 40, 60, 80, 100]}
          xFormat={(v) => `${v}%`}
          yTicks={[0, 10, 20, 30]}
          xLabel="Northfield Sour’s share of the 150 kb/d slate"
          yLabel="Hydrogen, million standard cubic feet a day"
          bands={bandShown && plantArea.length ? [{ from: plantArea[0] - SHARE_STEP / 2, to: 100, color: 'rgba(42, 157, 144, 0.14)', label: 'plant runs' }] : []}
          series={[
            { points: all.map((s) => [s.share, s.plan.hydrogen.reformer] as [number, number]), color: HYDROGEN, width: 2, dash: '6 4' },
            { points: all.map((s) => [s.share, s.plan.hydrogen.used] as [number, number]), color: HYDROGEN, width: 3 },
          ]}
          refs={[{ axis: 'x', at: share, cursor: true }]}
          markers={[
            { x: share, y: cur.plan.hydrogen.used, color: HYDROGEN_TEXT, r: 6 },
            { x: share, y: cur.plan.hydrogen.reformer, color: HYDROGEN, r: 4, hollow: true },
          ]}
        />
        <LimitRows plan={cur.plan} />
        <Readouts
          items={[
            { label: <K c="price">margin per barrel</K>, value: usd(cur.marginPerBbl, 2), tone: 'green' },
            { label: 'diesel made', value: `${fmt(cur.plan.products.diesel, 1)} kb/d`, tone: 'orange' },
            { label: 'fuel oil made', value: `${fmt(cur.plan.products.hsfo, 1)} kb/d` },
          ]}
        />
        <Slider
          label="Northfield Sour in the slate"
          tone="gold"
          value={share}
          min={0}
          max={100}
          step={SHARE_STEP}
          onChange={(v) => s2.set({ share: v })}
          display={`${share}% · ${fmt((share / 100) * CORRAN.capacity.cdu, 1)} kb/d`}
        />
      </Figure>

      <P>
        On Pinyon Light alone, the hydrotreater uses {fmt(first.plan.hydrogen.used, 1)} million standard cubic feet a day (MMscf/d) and the reformer makes{' '}
        {fmt(first.plan.hydrogen.reformer, 1)}: hydrogen to spare. As Northfield’s share grows, demand climbs while supply falls, because Northfield has less heavy naphtha
        for the reformer. The first limit to bind isn’t hydrogen at all. It’s room in the hydrotreater, and Northfield sends it more than diesel: its kerosene carries{' '}
        {fmt(nfCuts.kerosene.sulfur, 2)}% sulfur, more than the {fmt(JET_SULFUR, 1)}% jet fuel may hold, so where Pinyon’s kerosene goes straight into jet fuel,
        Northfield’s has to be hydrotreated first. At {dhtFull.share}% Northfield the hydrotreater’s {CORRAN.capacity.dht} kb/d is full (at {beforeFull.share}% it takes{' '}
        {fmt(beforeFull.plan.unitFeed.dht, 1)}).
      </P>
      <P>
        Something has to give, and it isn’t the sour diesel: on every slate all of it is still hydrotreated, because without the hydrotreater it could only be fuel
        oil. What gives is the coker’s gas oil, which loses its place in the hydrotreater: {fmt(cgoPeak, 1)} kb/d at {beforeFull.share}% Northfield, none by{' '}
        {cgoGone.share}%. Coking residue pays only when its gas oil can be made into diesel; sent to the cracker instead, the gas oil earns too little to beat selling the
        residue as fuel oil. So the coker runs less, and residue goes into fuel oil uncoked. On Northfield alone the crude unit makes{' '}
        {fmt(nfCuts.residue.volume * CORRAN.capacity.cdu, 1)} kb/d of residue, and the coker, with room for {CORRAN.capacity.coker}, takes only{' '}
        {fmt(last.plan.unitFeed.coker, 1)}; {fmt(last.plan.flows.ro_northfield, 1)} goes into fuel oil. Fuel oil rises from {fmt(first.plan.products.hsfo, 1)} kb/d on
        Pinyon alone to {fmt(last.plan.products.hsfo, 1)} on Northfield alone, and by {foCapped.share}% it has reached its {fmt(FUEL_OIL_SULFUR, 1)}% sulfur limit.
        That is the limit for high-sulfur fuel oil, which is burned in power plants and industrial boilers, and by ships fitted with scrubbers that clean their exhaust;
        other ships must burn the 0.5% fuel of <a href={lessonHref('oil/1.2')}>Lesson 1.2</a>. The sulfur plant never comes close to its limit: even on Northfield alone it handles {fmt(last.plan.sulfurPlant)} of its{' '}
        {fmt(CORRAN.sulfurPlant)} tonnes a day.
      </P>

      <Challenge
        id="b"
        question="Estimate first, from where the two hydrogen lines cross: at what share of Northfield Sour does the reformer’s hydrogen stop covering the hydrotreater, so that the hydrogen plant has to run? Then set the slider to the smallest such share, to the nearest 5%."
        solved={solvedB}
        status={`At ${share}% Northfield, the hydrotreater uses ${fmt(cur.plan.hydrogen.used, 1)} MMscf/d and the reformer makes ${fmt(cur.plan.hydrogen.reformer, 1)}.`}
        success={`Solved: ${share}%, the first step past the crossing; the shading now marks where the plant runs. Below it, the reformer’s by-product hydrogen is enough; from here on every extra barrel of sourness is paid for with natural gas. On Northfield alone the plant makes ${fmt(last.plan.hydrogen.plant, 1)} MMscf/d — a small share of its ${fmt(CORRAN.hydrogenPlant)} MMscf/d capacity, because the full hydrotreater caps how much sulfur the refinery can remove.`}
      />

      <P>
        Watch the margin as you go. Each barrel of Northfield costs {usd(CRUDE_PRICE.pinyon - CRUDE_PRICE.northfield, 2)} less than a barrel of Pinyon. While the
        hydrotreater has room, each 5% step toward Northfield adds about {fmt(stepRoom * 100)}¢ to the margin per barrel. Once it is full, a step adds only about{' '}
        {fmt(stepFull * 100)}¢, because each one pushes coker gas oil out of the hydrotreater and residue into fuel oil. The margin per barrel climbs from{' '}
        {usd(first.marginPerBbl, 2)} to a peak of {usd(best.marginPerBbl, 2)} at {best.share}% Northfield. Past that, there is little coker gas oil left to push out and
        the fuel oil is already at its sulfur limit, so the sourest slates are handled in costlier ways: some of Northfield’s kerosene goes into fuel oil, and more of its
        residue has to be coked even though the coker’s gas oil can only go to the cracker. The margin falls to {usd(last.marginPerBbl, 2)}. Hydrogen is a small part of
        that. The hydrogen plant runs from {plantOn.share}% and makes at most {fmt(plantMax, 1)} MMscf/d, about {usd(Math.round((plantMax * 1000 * HYDROGEN_COST) / 100) * 100)}{' '}
        of hydrogen a day, while the margin on Northfield alone is {usd(Math.round(belowPeak / 1000) * 1000)} a day below the peak. That is the economics of a sour crude in
        miniature: its discount has to pay for hydrotreating capacity, hydrogen and sulfur handling, and a refinery with spare hydrotreating can afford to buy sourer crude
        than one without. We’ll put a number on what each crude is worth to Corran in{' '}
        <a href={lessonHref('oil/3.5')}>Lesson 3.5</a>.
      </P>
      <P>
        The hydrotreated diesel and kerosene, the reformate and the cracked gasoline are still only components. None of them is sold as it leaves its unit;
        each is blended with others into a finished fuel that has to meet a list of specifications at once. That is the subject of the{' '}
        <a href={lessonHref('oil/3.4')}>next lesson</a>. You can return to <FigRef to="Refinery Upgrading Lab">the first demonstration</FigRef> to compare how hard each
        crude’s diesel is to treat.
      </P>
    </LessonPage>
  );
}
