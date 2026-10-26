import { useMemo, useState } from 'react';
import {
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Slider,
  Sub,
  Sup,
  TEXT,
  clamp,
  fmt,
  lessonHref,
  mix,
  pct,
  useScenario,
} from '../../../framework';
import { packLineOf, packWindow } from '../../../engines/gas/linepack';
import { deliverableOver, injectCapacity, runStorage, storagePressure, withdrawCapacity, type StorageDay, type StorageSpec } from '../../../engines/gas/storage';
import { PIPELINE, REFERENCE_DAYS, STORAGE_SPECS } from '../../../model/gas/world';
import { XYChart } from '../shared/XYChart';
import { MONTH_NAMES } from '../shared/format';

// ---------------------------------------------------------------------------
// The gas year: April 1 to March 31.

const HC = STORAGE_SPECS.hollowcreek;
const SF = STORAGE_SPECS.saltflat;
/** Days in the injection season (April–October) and the withdrawal season (November–March). */
export const INJ_DAYS = 214;
export const WD_DAYS = 151;
const YEAR_DAYS = INJ_DAYS + WD_DAYS;
/** Day of the gas year on which each month starts, April first. */
const MONTH_START = [0, 30, 61, 91, 122, 153, 183, 214, 244, 275, 306, 334];
const MONTH_INDEX = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];

/** "November 1" for a day of the gas year (0 = April 1). */
export function dayLabel(day: number): string {
  const d = clamp(Math.round(day), 0, YEAR_DAYS - 1);
  let m = 0;
  while (m + 1 < MONTH_START.length && MONTH_START[m + 1] <= d) m++;
  return `${MONTH_NAMES[MONTH_INDEX[m]]} ${d - MONTH_START[m] + 1}`;
}

/** The field starts April 30% full and its customers inject enough to fill it by November 1, so the winter (and the first challenge) starts full. */
export const YEAR_DEFAULTS = { start: 36, inject: 0.45, withdraw: 0.6 };
/** The day the first demonstration opens on: January 15, mid-winter. */
const CURSOR_DEFAULT = 289;
type YearState = typeof YEAR_DEFAULTS;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Hollow Creek through a gas year: a steady nomination each season, cut by the ratchets. */
export function gasYear(start: number, inject: number, withdraw: number): StorageDay[] {
  return runStorage(HC, start, [...Array<number>(INJ_DAYS).fill(inject), ...Array<number>(WD_DAYS).fill(-withdraw)]);
}

/** First day of the winter a ratchet cuts the withdrawal, or −1. */
function firstWinterCut(r: StorageDay[]): number {
  for (let d = INJ_DAYS; d < r.length; d++) if (r[d].limited) return d;
  return -1;
}

/**
 * The challenge: with the field full on November 1, the highest steady winter withdrawal (to the
 * hundredth) that no ratchet cuts. With the engine's numbers that is 0.54 Bcf/d.
 */
export function firmSolved(s: YearState): boolean {
  const r = gasYear(s.start, s.inject, s.withdraw);
  if (r[INJ_DAYS - 1].inventory < HC.workingBcf - 1e-6) return false;
  if (s.withdraw <= 0 || firstWinterCut(r) >= 0) return false;
  return firstWinterCut(gasYear(s.start, s.inject, round2(s.withdraw + 0.01))) >= 0;
}

/** The highest uncut steady withdrawal from a full field, Bcf/d, to the hundredth. */
export function firmRate(): number {
  for (let k = 100; k >= 0; k--) if (!runStorage(HC, HC.workingBcf, Array<number>(WD_DAYS).fill(-k / 100)).some((d) => d.limited)) return k / 100;
  return 0;
}

// ---------------------------------------------------------------------------
// Numbers quoted in the prose.

const PIPES_IN = PIPELINE['calder-metro'].capacityBcfd + PIPELINE['sandhill-metro'].capacityBcfd;
const SUMMER = REFERENCE_DAYS.summer.demand.metro;
const WINTER = REFERENCE_DAYS.winter.demand.metro;
const DESIGN = REFERENCE_DAYS.design.demand.metro;
/** What Hollow Creek must supply on the design day, Bcf/d. */
export const DESIGN_NEED = DESIGN - PIPES_IN;
const PACK_SWING = packWindow(packLineOf(PIPELINE['calder-metro']), 0).swing;
/** The least working gas (Bcf) at which Hollow Creek can withdraw the design day's shortfall. */
export const DESIGN_INV = (() => {
  let lo = 0;
  let hi = HC.workingBcf;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (withdrawCapacity(HC, mid) >= DESIGN_NEED) hi = mid;
    else lo = mid;
  }
  return hi;
})();
/** Inventory below which the wells can't deliver their full 1.0 Bcf/d. */
const FULL_RATE_INV = (() => {
  let lo = 0;
  let hi = HC.workingBcf;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (withdrawCapacity(HC, mid) >= HC.maxWithdrawBcfd - 1e-9) hi = mid;
    else lo = mid;
  }
  return hi;
})();
const P_EMPTY = storagePressure(HC, 0);
const P_FULL = storagePressure(HC, HC.workingBcf);
const DEF = gasYear(YEAR_DEFAULTS.start, YEAR_DEFAULTS.inject, YEAR_DEFAULTS.withdraw);
const DEF_NOV1 = DEF[INJ_DAYS - 1].inventory;
const DEF_MAR31 = DEF[YEAR_DAYS - 1].inventory;
/** The day injection is first slowed, the day the field fills, and the day it would have filled at the nominated rate. */
const DEF_INJ_FIRST_CUT = DEF.findIndex((d) => d.limited);
export const DEF_FULL_DAY = DEF.findIndex((d) => d.inventory >= HC.workingBcf - 1e-6);
const DEF_FULL_UNCUT = Math.ceil((HC.workingBcf - YEAR_DEFAULTS.start) / YEAR_DEFAULTS.inject) - 1;
const DEF_WD_CUT = DEF.slice(INJ_DAYS).filter((d) => d.limited).length;
const DEF_FIRST_CUT = firstWinterCut(DEF);
const DEF_BELOW_DESIGN = DEF.findIndex((d, i) => i >= INJ_DAYS && d.inventory < DESIGN_INV);
const FILL_DAYS_HC = daysFlatOut(HC, 'fill');
const DRAW_DAYS_HC = daysFlatOut(HC, 'draw');
const FILL_DAYS_SF = daysFlatOut(SF, 'fill');
const DRAW_DAYS_SF = daysFlatOut(SF, 'draw');
const SEASON_OUT = deliverableOver(HC, HC.workingBcf, WD_DAYS);
const FIRM = firmRate();
const FIRM_RUN = runStorage(HC, HC.workingBcf, Array<number>(WD_DAYS).fill(-FIRM));
const FIRM_LEFT = FIRM_RUN[WD_DAYS - 1].inventory;
const FIRM_NEXT_CUT = runStorage(HC, HC.workingBcf, Array<number>(WD_DAYS).fill(-round2(FIRM + 0.01))).findIndex((d) => d.limited);

/** Days to fill from empty, or to draw from full down to a tenth full, going flat out. */
function daysFlatOut(s: StorageSpec, what: 'fill' | 'draw'): number {
  let inv = what === 'fill' ? 0 : s.workingBcf;
  for (let d = 1; d < 2000; d++) {
    inv += what === 'fill' ? injectCapacity(s, inv) : -withdrawCapacity(s, inv);
    if (what === 'fill' ? inv >= s.workingBcf - 1e-9 : inv <= 0.1 * s.workingBcf) return d;
  }
  return Infinity;
}

// ---------------------------------------------------------------------------
// The two fields in a cold spell.

export const SNAP_DEFAULTS = { fill: 100, days: 10 };
const SNAP_MAX = 30;

/** Cumulative gas (Bcf) a field has delivered after each day of withdrawing flat out, starting at day 0. */
export function coldSpell(s: StorageSpec, inventory: number, days: number): number[] {
  const r = runStorage(s, inventory, Array<number>(days).fill(-1e9));
  return [0, ...r.map((d) => inventory - d.inventory)];
}

/** The first day of a cold spell, both fields starting full, on which Hollow Creek has delivered more than Salt Flat. */
export const CROSSOVER_DAY = (() => {
  const a = coldSpell(HC, HC.workingBcf, 60);
  const b = coldSpell(SF, SF.workingBcf, 60);
  for (let d = 1; d <= 60; d++) if (a[d] > b[d] + 1e-9) return d;
  return Infinity;
})();

/** The second challenge's cold spell, days. */
export const EVEN_DAYS = 10;
/** Gas each field delivers over the challenge's ten days, both starting `fill` percent full. */
export function tenDays(fill: number): { hc: number; sf: number } {
  return { hc: deliverableOver(HC, (fill / 100) * HC.workingBcf, EVEN_DAYS), sf: deliverableOver(SF, (fill / 100) * SF.workingBcf, EVEN_DAYS) };
}
/** The fill (%) at which the two fields deliver the same over ten days: about 29%. */
export const EVEN_FILL = (() => {
  let lo = 1;
  let hi = 100;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const t = tenDays(mid);
    if (t.hc > t.sf) lo = mid;
    else hi = mid;
  }
  return lo;
})();
/** The fill (%) above which Salt Flat's wells are the faster: about 16%. */
export const FASTER_FILL = (() => {
  let lo = 1;
  let hi = 100;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (withdrawCapacity(SF, (mid / 100) * SF.workingBcf) < withdrawCapacity(HC, (mid / 100) * HC.workingBcf)) lo = mid;
    else hi = mid;
  }
  return lo;
})();

/** The second challenge: a ten-day cold spell, both fields starting at the fill where they deliver the same, to within a tenth of a Bcf. */
export function evenFillSolved(s: typeof SNAP_DEFAULTS): boolean {
  // An empty pair delivers nothing either way: that's no answer.
  if (s.days !== EVEN_DAYS || s.fill <= 0) return false;
  const t = tenDays(s.fill);
  return Math.abs(t.hc - t.sf) < 0.1;
}

const SNAP_FULL10 = { hc: deliverableOver(HC, HC.workingBcf, 10), sf: deliverableOver(SF, SF.workingBcf, 10) };
const SNAP_FULL30 = { hc: deliverableOver(HC, HC.workingBcf, 30), sf: deliverableOver(SF, SF.workingBcf, 30) };
const SNAP_QUARTER10 = { hc: deliverableOver(HC, HC.workingBcf / 4, 10), sf: deliverableOver(SF, SF.workingBcf / 4, 10) };
const FILLS = Array.from({ length: 101 }, (_, i) => i);
const CURVES = {
  hcOut: FILLS.map((f) => withdrawCapacity(HC, (f / 100) * HC.workingBcf)),
  hcIn: FILLS.map((f) => injectCapacity(HC, (f / 100) * HC.workingBcf)),
  sfOut: FILLS.map((f) => withdrawCapacity(SF, (f / 100) * SF.workingBcf)),
  sfIn: FILLS.map((f) => injectCapacity(SF, (f / 100) * SF.workingBcf)),
};

const HC_COLOR = GRAPHIC.gold;
const SF_COLOR = '#7a7a7a';
const FLOW = GRAPHIC.orange;

// ---------------------------------------------------------------------------
// The field, drawn in cross-section beside a gauge of its gas.

function FieldDiagram({ day, inventory, flow }: { day: number; inventory: number; flow: number }) {
  const p = storagePressure(HC, inventory);
  const out = withdrawCapacity(HC, inventory);
  const into = injectCapacity(HC, inventory);
  const fill = mix('#f6efd9', GRAPHIC.gold, clamp((p - P_EMPTY) / (P_FULL - P_EMPTY), 0, 1) * 0.75 + 0.15);
  const speed = Math.abs(flow) * 60;
  const dots = speed > 0.5 ? { animationDuration: `${(18 / speed).toFixed(3)}s` } : { animationPlayState: 'paused' as const };
  // The gauge: base gas at the bottom, working gas above it.
  const g0 = 196;
  const gH = 160;
  const total = HC.baseBcf + HC.workingBcf;
  const baseH = (HC.baseBcf / total) * gH;
  const workH = (inventory / total) * gH;
  const bar = (x: number, y: number, v: number, max: number, label: string) => (
    <g>
      <text className="ax" x={x} y={y}>
        {label}
      </text>
      <rect x={x} y={y + 6} width={110} height={12} fill="#efede6" />
      <rect x={x} y={y + 6} width={(110 * v) / max} height={12} fill={FLOW} />
      <text x={x + 116} y={y + 16} style={{ fontSize: 13, fontWeight: 500, fill: TEXT.orange }}>
        {fmt(v, 2)}
      </text>
    </g>
  );
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 214"
      role="img"
      aria-label={`Hollow Creek on ${dayLabel(day)}: ${fmt(inventory, 1)} of ${HC.workingBcf} Bcf of working gas over ${HC.baseBcf} Bcf of base gas, at ${fmt(p)} psia. It is ${flow > 1e-9 ? `injecting ${fmt(flow, 2)} Bcf/d` : flow < -1e-9 ? `withdrawing ${fmt(-flow, 2)} Bcf/d` : 'idle'}; it could withdraw up to ${fmt(out, 2)} or inject up to ${fmt(into, 2)} Bcf/d.`}
    >
      <line x1={10} x2={360} y1={40} y2={40} stroke="#b9b4a6" strokeWidth={1.5} />
      <text className="ax" x={14} y={32}>
        ground
      </text>
      {/* Cap rock arched over the reservoir rock. */}
      <path d="M20 200 Q 190 54 360 200 Z" fill={fill} stroke="none" />
      <path d="M20 200 Q 190 54 360 200" fill="none" stroke="#8d7b6a" strokeWidth={12} strokeLinecap="round" opacity={0.75} />
      <text x={190} y={168} textAnchor="middle" style={{ fontSize: 14, fontWeight: 500, fill: TEXT.blue }}>
        {fmt(p)} psia
      </text>
      <text x={190} y={186} textAnchor="middle" className="ax">
        porous rock under a seal
      </text>
      {/* The well. */}
      <line x1={190} y1={26} x2={190} y2={130} stroke="#9a9a9a" strokeWidth={6} />
      <path d={flow >= 0 ? 'M190 26 L190 128' : 'M190 128 L190 26'} className="flow-dots" stroke="#fff" strokeWidth={3.5} style={dots} />
      <rect x={180} y={16} width={20} height={12} fill="#777" />
      <text x={206} y={24} style={{ fontSize: 13, fontWeight: 500, fill: TEXT.orange }}>
        {flow > 1e-9 ? `in ${fmt(flow, 2)} Bcf/d` : flow < -1e-9 ? `out ${fmt(-flow, 2)} Bcf/d` : 'idle'}
      </text>
      {/* Gauge. */}
      <rect x={400} y={g0 - gH} width={40} height={gH} fill="#fff" stroke="#9a9a9a" />
      <rect x={400} y={g0 - baseH} width={40} height={baseH} fill={mix('#ffffff', GRAPHIC.gold, 0.25)} />
      <rect x={400} y={g0 - baseH - workH} width={40} height={workH} fill={GRAPHIC.gold} />
      <line x1={396} x2={444} y1={g0 - baseH} y2={g0 - baseH} stroke="#8a6500" strokeWidth={1} strokeDasharray="3 3" />
      <text className="ax ax-e" x={392} y={g0 - baseH / 2 + 4}>
        base gas {HC.baseBcf}
      </text>
      <text x={392} y={g0 - baseH - Math.max(workH, 16) / 2 + 4} textAnchor="end" style={{ fontSize: 12, fontWeight: 500, fill: TEXT.gold }}>
        working {fmt(inventory, 1)}
      </text>
      <text className="ax" x={400} y={g0 + 14}>
        Bcf in the field
      </text>
      <text x={470} y={26} style={{ fontSize: 14, fontWeight: 600, fill: '#333' }}>
        {dayLabel(day)}
      </text>
      {bar(470, 52, out, 1.2, 'could withdraw, Bcf/d')}
      {bar(470, 112, into, 1.2, 'could inject, Bcf/d')}
    </svg>
  );
}

// ---------------------------------------------------------------------------

const monthFmt = (d: number) => {
  const i = MONTH_START.indexOf(d);
  return i >= 0 ? MONTH_NAMES[MONTH_INDEX[i]].slice(0, 3) : '';
};

export default function Lesson() {
  const y = useScenario('year', YEAR_DEFAULTS);
  const st = y.state;
  const run = useMemo(() => gasYear(st.start, st.inject, st.withdraw), [st.start, st.inject, st.withdraw]);
  const [cursor, setCursor] = useState(CURSOR_DEFAULT);
  const day = clamp(Math.round(cursor), 0, YEAR_DAYS - 1);
  const invAt = (d: number) => (d <= 0 ? st.start : run[d - 1].inventory);
  const nov1 = run[INJ_DAYS - 1].inventory;
  const mar31 = run[YEAR_DAYS - 1].inventory;
  const injCut = run.slice(0, INJ_DAYS).filter((d) => d.limited).length;
  const wdCut = run.slice(INJ_DAYS).filter((d) => d.limited).length;
  const firstCut = firstWinterCut(run);
  const days = Array.from({ length: YEAR_DAYS + 1 }, (_, i) => i);
  const inventories = days.map(invAt);
  const fdays = run.map((d) => d.day + 0.5);
  const solved = firmSolved(st);
  const full = nov1 >= HC.workingBcf - 1e-6;
  const nextCut = firstWinterCut(gasYear(st.start, st.inject, round2(st.withdraw + 0.01)));

  const status = !full
    ? `On November 1 the field holds ${fmt(nov1, 1)} of its ${HC.workingBcf} Bcf. It should start the winter full: inject more, or start April with more.`
    : st.withdraw <= 0
      ? 'Set a winter withdrawal rate.'
      : firstCut >= 0
        ? `At ${fmt(st.withdraw, 2)} Bcf/d the ratchet cuts the withdrawal from ${dayLabel(firstCut)} on.`
        : `At ${fmt(st.withdraw, 2)} Bcf/d the field keeps up all winter and ends March with ${fmt(mar31, 1)} Bcf. Could it give more?`;

  const s2 = useScenario('cold-spell', SNAP_DEFAULTS);
  const sn = s2.state;
  const hcInv = (sn.fill / 100) * HC.workingBcf;
  const sfInv = (sn.fill / 100) * SF.workingBcf;
  const hcCum = useMemo(() => coldSpell(HC, hcInv, SNAP_MAX), [hcInv]);
  const sfCum = useMemo(() => coldSpell(SF, sfInv, SNAP_MAX), [sfInv]);
  const snapDays = Array.from({ length: sn.days + 1 }, (_, i) => i);
  const hcGot = hcCum[sn.days];
  const sfGot = sfCum[sn.days];
  const solvedB = evenFillSolved(sn);
  const evenAt = Math.round(EVEN_FILL);
  const even = tenDays(evenAt);

  return (
    <LessonPage id="gas/3.4">
      <P>
        <a href={lessonHref('gas/3.3')}>Linepack</a> smooths out a day. The swings that matter most to a city, though, run over months. On a summer day Metro burns{' '}
        {fmt(SUMMER, 1)} Bcf/d of gas; on a cold winter day, {fmt(WINTER, 1)}; on its <b>design day</b>, the coldest day its utility plans for, {fmt(DESIGN, 1)}. The two
        pipelines into the city, Northline and the Valley Line, carry {fmt(PIPES_IN, 2)} Bcf/d between them. So in summer they run at half their capacity, and on the
        design day, as <a href={lessonHref('gas/3.1')}>Lesson 3.1</a> found, Metro needs {fmt(DESIGN_NEED, 2)} Bcf/d more than they can bring —{' '}
        {fmt(DESIGN_NEED * 1000)} MMcf in a single day, nearly twice the {fmt(PACK_SWING)} MMcf that Northline’s linepack can swing even with nothing flowing.
      </P>
      <P>
        Building pipelines big enough for the coldest day would leave most of their steel idle most of the year. The cheaper answer is to move gas through time instead
        of through space: bring it to the city’s doorstep in summer, when the pipes have room, and keep it there until winter. That takes <b>underground storage</b>.
      </P>
      <P>
        Metro’s storage is Hollow Creek, an old gas field near the city, produced long ago and now refilled every summer. A field like it — porous rock that held gas for
        millions of years beneath a seal it couldn’t pass (<a href={lessonHref('gas/2.1')}>Lesson 2.1</a>) — is the most common kind of storage. Not all of the gas in it
        can come out. Nearly half, {HC.baseBcf} Bcf, is <K c="energy">base gas</K>, or cushion gas, which stays in for good and holds up the pressure that pushes the
        rest out. The other {HC.workingBcf} Bcf is <K c="energy">working gas</K>, put in and taken out each year. With only base gas in it, the field’s{' '}
        <K tone="blue">pressure</K> is {fmt(P_EMPTY)} psia; full, {fmt(P_FULL)}.
      </P>
      <P>
        In the next demonstration, Hollow Creek runs through a gas year, April 1 to March 31. Like the North American industry, its operator splits the year in two: an{' '}
        <b>injection season</b> from April through October and a <b>withdrawal season</b> from November through March. Set how much working gas the field starts with,
        and the steady daily rate its customers <i>nominate</i> — ask for — in each season. In the lower chart, the dashed line is what they ask for and the solid line is
        what the field actually does. Drag across either chart to look inside the field on any day:
      </P>

      <Figure name="Storage Reservoir" scenario={y}>
        <FieldDiagram day={day} inventory={invAt(day)} flow={run[day].flow} />
        <XYChart
          xDomain={[0, YEAR_DAYS]}
          yDomain={[0, HC.workingBcf]}
          yTicks={[0, 30, 60, 90, 120]}
          xTicks={MONTH_START}
          xFormat={monthFmt}
          yFormat={(v) => fmt(v)}
          yLabel="Working gas in Hollow Creek, Bcf"
          height={190}
          bands={[{ from: INJ_DAYS, to: YEAR_DAYS, color: 'rgba(0,0,0,0.04)', label: 'withdrawal season' }]}
          series={[
            { xs: days, ys: inventories, color: GRAPHIC.gold, kind: 'area', opacity: 0.3 },
            { xs: days, ys: inventories, color: GRAPHIC.gold, width: 2.5 },
          ]}
          hLines={[{ at: DESIGN_INV, color: '#777', dash: '5 4', label: 'enough for the design day', labelAt: 'start' }]}
          markers={[{ x: day, y: invAt(day), color: TEXT.gold, r: 5 }]}
          cursor={day}
          onScrub={setCursor}
          scrubLabel="Day of the gas year"
          ariaLabel={`Working gas in Hollow Creek through the gas year: ${fmt(st.start)} Bcf on April 1, ${fmt(nov1, 1)} on November 1 and ${fmt(mar31, 1)} on March 31. On ${dayLabel(day)} it holds ${fmt(invAt(day), 1)} Bcf.`}
        />
        <XYChart
          xDomain={[0, YEAR_DAYS]}
          yDomain={[-1.1, 0.9]}
          yTicks={[-1, -0.5, 0, 0.5]}
          xTicks={MONTH_START}
          xFormat={monthFmt}
          yFormat={(v) => (v > 0 ? `+${fmt(v, 1)}` : fmt(v, 1))}
          yLabel="Flow, Bcf/d (+ in, − out)"
          height={150}
          series={[
            { xs: fdays, ys: run.map((d) => d.nominated), color: '#8a8a8a', width: 1.5, dash: '5 4' },
            { xs: fdays, ys: run.map((d) => d.flow), color: FLOW, width: 2.5 },
          ]}
          cursor={day + 0.5}
          onScrub={(x) => setCursor(x - 0.5)}
          scrubLabel="Day of the gas year"
          ariaLabel={`Nominated and actual flow through the gas year. The ratchets cut injection on ${injCut} days and withdrawal on ${wdCut} days. On ${dayLabel(day)} the flow is ${fmt(run[day].flow, 2)} Bcf/d.`}
        />
        <Legend
          items={[
            { label: 'Working gas', color: GRAPHIC.gold },
            { label: 'Nominated flow', color: '#8a8a8a', kind: 'line', dashed: true },
            { label: 'Actual flow', color: FLOW, kind: 'line' },
          ]}
        />
        <Readouts
          items={[
            { label: 'working gas on November 1', value: `${fmt(nov1, 1)} Bcf`, tone: 'gold' },
            { label: 'on March 31', value: `${fmt(mar31, 1)} Bcf`, tone: 'gold' },
            { label: 'days cut by ratchets', value: `${injCut} in · ${wdCut} out` },
          ]}
        />
        <Slider label="Working gas on April 1" tone="gold" value={st.start} min={0} max={HC.workingBcf} onChange={(v) => y.set({ start: v })} display={`${st.start} Bcf`} />
        <Slider label="Injection, April–October" tone="orange" value={st.inject} min={0} max={0.8} step={0.01} onChange={(v) => y.set({ inject: v })} display={`${fmt(st.inject, 2)} Bcf/d`} />
        <Slider label="Withdrawal, November–March" tone="orange" value={st.withdraw} min={0} max={1} step={0.01} onChange={(v) => y.set({ withdraw: v })} display={`${fmt(st.withdraw, 2)} Bcf/d`} />
      </Figure>

      <P>
        At the starting settings the field begins April {pct(YEAR_DEFAULTS.start / HC.workingBcf)} full, at {YEAR_DEFAULTS.start} Bcf, and its customers inject{' '}
        {fmt(YEAR_DEFAULTS.inject, 2)} Bcf/d. At that pace its {HC.workingBcf - YEAR_DEFAULTS.start} Bcf of room would be filled by {dayLabel(DEF_FULL_UNCUT)}, but
        from {dayLabel(DEF_INJ_FIRST_CUT)} on the field can’t take gas as fast as it’s offered, and it is full only on {dayLabel(DEF_FULL_DAY)}. In winter the
        customers ask for {fmt(YEAR_DEFAULTS.withdraw, 2)} Bcf/d, and from {dayLabel(DEF_FIRST_CUT)} on the field can’t keep up: the last {DEF_WD_CUT} days are cut
        short. Over the winter it gives back {fmt(DEF_NOV1 - DEF_MAR31, 1)} Bcf and ends March with {fmt(DEF_MAR31, 1)}.
      </P>

      <H2>Ratchets</H2>
      <P>
        Both limits come from the field’s pressure. Taking gas out of storage works like producing a well (<a href={lessonHref('gas/2.2')}>Lesson 2.2</a>): the rate
        depends on P<Sup>2</Sup> − P<Sub>wf</Sub>
        <Sup>2</Sup>, so it falls as the field empties and its pressure drops. That rate, the most a field can withdraw in a day, is its{' '}
        <K tone="orange">deliverability</K>. Hollow Creek’s wells can deliver their full {fmt(HC.maxWithdrawBcfd, 1)} Bcf/d until the
        field is down to {fmt(FULL_RATE_INV)} Bcf, about two-thirds full; at half full they manage {fmt(withdrawCapacity(HC, HC.workingBcf / 2), 2)}, and at a quarter{' '}
        {fmt(withdrawCapacity(HC, HC.workingBcf / 4), 2)}. Putting gas in works against the same pressure from the other side. Compressors at the surface push it down
        at up to {fmt(HC.maxInjectBcfd, 1)} Bcf/d while the field is low, slowing to {fmt(injectCapacity(HC, HC.workingBcf / 2), 2)} at half full and{' '}
        {fmt(injectCapacity(HC, 0.9 * HC.workingBcf), 2)} at nine-tenths. Storage contracts write these limits into the deal as <b>ratchets</b>: the less gas a
        customer has in the field, the less it can take out in a day, and the more it has, the less it can put in.
      </P>
      <P>
        Ratchets shape the whole year. From empty, Hollow Creek needs {FILL_DAYS_HC} days of flat-out injection to fill — nearly the whole {INJ_DAYS}-day injection
        season. From full, withdrawing as fast as it can for the {WD_DAYS} days of winter, it delivers only {fmt(SEASON_OUT)} of its {HC.workingBcf} Bcf.
      </P>

      <Challenge
        id="a"
        question={`Metro’s utility wants a withdrawal rate it can count on every day of the winter. With Hollow Creek full on November 1, as it is at the starting settings, what’s the highest steady rate, to a hundredth of a Bcf/d, that the field can hold from November through March without a ratchet cutting it? Estimate it first from the rates at half and a quarter full: whatever the rate, the field must still manage it on March 31, the last of the winter’s ${WD_DAYS} days.`}
        solved={solved}
        status={status}
        success={`Solved: ${fmt(FIRM, 2)} Bcf/d. At ${fmt(FIRM + 0.01, 2)} the ratchet would cut it from ${dayLabel(nextCut >= 0 ? nextCut : INJ_DAYS + FIRM_NEXT_CUT)} on. The steady rate delivers ${fmt(HC.workingBcf - FIRM_LEFT, 1)} Bcf over the winter and leaves ${fmt(FIRM_LEFT, 1)} in the ground. Dividing ${HC.workingBcf} Bcf by ${WD_DAYS} days suggests ${fmt(HC.workingBcf / WD_DAYS, 2)}, but a field can’t be counted on for all its working gas at an even rate. The gas left behind isn’t wasted: it’s what keeps the field’s pressure, and its deliverability, up through March.`}
      />

      <H2>The coldest day</H2>
      <P>
        Deliverability matters most on the design day. Metro then needs {fmt(DESIGN_NEED, 2)} Bcf/d more than its pipelines can bring, and in our region only Hollow Creek
        can supply it. It can do that only while it holds at least {fmt(DESIGN_INV)} Bcf of working gas, {pct(DESIGN_INV / HC.workingBcf)} full; below that, its pressure
        is too low to push the gas out fast enough. That threshold is the dashed line in <FigRef to="Storage Reservoir">the first demonstration</FigRef>. At the starting
        settings the field drops below it on {dayLabel(DEF_BELOW_DESIGN)}, so a design-day cold snap after that would find Metro short of gas — not because the region has
        run out, but because the gas that’s left can’t come out of the ground fast enough. That kind of day is the subject of <a href={lessonHref('gas/5.5')}>Lesson 5.5</a>.
      </P>

      <H2>Salt and sandstone</H2>
      <P>
        Hollow Creek is built for a season. The region’s other field, Salt Flat beside Calder Hub, is built for a week or two. Salt caverns are made, not found: an operator drills
        into a thick bed of underground salt and pumps in fresh water, which dissolves a cavern that is then filled with gas. In North America most of them lie along the
        Gulf Coast, where thick salt deposits are common. A cavern has no pores to squeeze gas through, so a few large wells can empty it quickly. Salt Flat holds{' '}
        {SF.workingBcf} Bcf of working gas over {SF.baseBcf} of base gas, a quarter of Hollow Creek’s working gas, but it can deliver {fmt(SF.maxWithdrawBcfd, 1)} Bcf/d —{' '}
        {pct(SF.maxWithdrawBcfd / SF.workingBcf)} of its working gas a day, against Hollow Creek’s {pct(HC.maxWithdrawBcfd / HC.workingBcf, 1)}. It fills from empty in{' '}
        {FILL_DAYS_SF} days and can be drawn from full to a tenth full in {DRAW_DAYS_SF}, so it can cycle several times a year. Hollow Creek takes {DRAW_DAYS_HC} days to
        draw down that far, and cycles once.
      </P>
      <P>
        In the next demonstration, the two fields face the same cold spell, withdrawing as fast as they can. The upper chart shows how fast each can withdraw (solid) and
        inject (dashed) at every fill level; the lower one, how much gas each has delivered as the cold spell goes on. Set how full both fields are when it starts, and
        how long it lasts:
      </P>

      <Figure name="Storage Reservoir · salt and sandstone" scenario={s2}>
        <XYChart
          xDomain={[0, 100]}
          yDomain={[0, 1.4]}
          yTicks={[0, 0.4, 0.8, 1.2]}
          xTicks={[0, 25, 50, 75, 100]}
          xFormat={(v) => `${v}%`}
          yFormat={(v) => fmt(v, 1)}
          yLabel="Most it can withdraw or inject, Bcf/d"
          xLabel="share of working gas in the field"
          height={200}
          series={[
            { xs: FILLS, ys: CURVES.hcIn, color: HC_COLOR, width: 2, dash: '6 4' },
            { xs: FILLS, ys: CURVES.sfIn, color: SF_COLOR, width: 2, dash: '6 4' },
            { xs: FILLS, ys: CURVES.hcOut, color: HC_COLOR, width: 2.5 },
            { xs: FILLS, ys: CURVES.sfOut, color: SF_COLOR, width: 2.5 },
          ]}
          vLines={[{ at: sn.fill, color: '#333', dash: '3 3', width: 1 }]}
          markers={[
            { x: sn.fill, y: withdrawCapacity(HC, hcInv), color: HC_COLOR, r: 5, label: 'Hollow Creek', labelPos: sn.fill > 70 ? 'left' : 'right' },
            { x: sn.fill, y: withdrawCapacity(SF, sfInv), color: SF_COLOR, r: 5, label: 'Salt Flat', labelPos: sn.fill > 70 ? 'left' : 'right' },
          ]}
          ariaLabel={`How fast each field can withdraw and inject at every fill level. At ${sn.fill}% full, Hollow Creek can withdraw ${fmt(withdrawCapacity(HC, hcInv), 2)} Bcf/d and Salt Flat ${fmt(withdrawCapacity(SF, sfInv), 2)}.`}
        />
        <XYChart
          xDomain={[0, SNAP_MAX]}
          yDomain={[0, 32]}
          yTicks={[0, 10, 20, 30]}
          xTicks={[0, 5, 10, 15, 20, 25, 30]}
          yFormat={(v) => fmt(v)}
          yLabel="Gas delivered since the cold spell began, Bcf"
          xLabel="days of cold"
          height={180}
          series={[
            { xs: snapDays, ys: snapDays.map((d) => hcCum[d]), color: HC_COLOR, width: 2.5 },
            { xs: snapDays, ys: snapDays.map((d) => sfCum[d]), color: SF_COLOR, width: 2.5 },
          ]}
          markers={[
            { x: sn.days, y: hcGot, color: HC_COLOR, r: 5 },
            { x: sn.days, y: sfGot, color: SF_COLOR, r: 5 },
          ]}
          ariaLabel={`Over ${sn.days} days of cold starting ${sn.fill}% full, Hollow Creek delivers ${fmt(hcGot, 1)} Bcf and Salt Flat ${fmt(sfGot, 1)} Bcf.`}
        />
        <Legend
          items={[
            { label: 'Hollow Creek (depleted field)', color: HC_COLOR, kind: 'line' },
            { label: 'Salt Flat (salt caverns)', color: SF_COLOR, kind: 'line' },
            { label: 'Injection', color: '#9a9a9a', kind: 'line', dashed: true },
          ]}
        />
        <Readouts
          items={[
            { label: `Hollow Creek over ${sn.days} day${sn.days === 1 ? '' : 's'}`, value: `${fmt(hcGot, 2)} Bcf`, tone: 'gold' },
            { label: `Salt Flat over ${sn.days} day${sn.days === 1 ? '' : 's'}`, value: `${fmt(sfGot, 2)} Bcf` },
          ]}
        />
        <Slider label="How full both fields are" tone="gold" value={sn.fill} min={0} max={100} onChange={(v) => s2.set({ fill: v })} display={`${sn.fill}%`} />
        <Slider label="Length of the cold spell" tone="teal" value={sn.days} min={1} max={SNAP_MAX} onChange={(v) => s2.set({ days: v })} display={`${sn.days} day${sn.days === 1 ? '' : 's'}`} />
      </Figure>

      <P>
        With both fields full, Salt Flat wins a short spell: {fmt(SNAP_FULL10.sf, 1)} Bcf over ten days to Hollow Creek’s {fmt(SNAP_FULL10.hc, 1)}. But it has only{' '}
        {SF.workingBcf} Bcf to give, and its deliverability falls away as it empties. Stretch the spell and Hollow Creek pulls ahead on day {CROSSOVER_DAY}; by day{' '}
        {SNAP_MAX} it leads, {fmt(SNAP_FULL30.hc, 1)} to {fmt(SNAP_FULL30.sf, 1)}. Start both a quarter full and even ten days favor the big field,{' '}
        {fmt(SNAP_QUARTER10.hc, 2)} to {fmt(SNAP_QUARTER10.sf, 2)}.
      </P>

      <Challenge
        id="b"
        figure="Storage Reservoir · salt and sandstone"
        question={`Somewhere between a quarter full and full, the two fields deliver the same over a ten-day cold spell. In the upper chart Salt Flat’s wells are the faster ones at any fill above about ${fmt(FASTER_FILL)}%. Predict first: do the two come out even above that fill or below it, and roughly where? Then find a fill at which their ten-day totals are within a tenth of a Bcf of each other.`}
        solved={solvedB}
        status={
          sn.days !== EVEN_DAYS
            ? `Set the cold spell to ten days: right now it lasts ${sn.days}.`
            : `At ${sn.fill}% full, ${hcGot > sfGot ? 'Hollow Creek' : 'Salt Flat'} is ahead over ten days, ${fmt(Math.max(hcGot, sfGot), 2)} Bcf to ${fmt(Math.min(hcGot, sfGot), 2)}.`
        }
        success={`Solved: they come out even at about ${evenAt}% full, ${fmt(even.hc, 2)} Bcf each — well above ${fmt(FASTER_FILL)}%. Between the two fills Salt Flat’s wells start faster, yet Hollow Creek delivers more. At ${evenAt}% full, ten days at full pace take ${pct(even.sf / ((evenAt / 100) * SF.workingBcf))} of the gas Salt Flat started with, so its rate falls away as it empties, but only ${pct(even.hc / ((evenAt / 100) * HC.workingBcf))} of Hollow Creek’s, which barely slows.`}
      />

      <P>
        The two kinds of storage do different jobs: a depleted field carries a city through a winter, and a salt cavern answers a cold week, a pipeline outage or a
        price spike, then refills in time for the next one. Pipelines move gas across the region, linepack across the hours of a day, and storage across the seasons. Each has a limit, and where a limit binds, gas can be
        short in one place and time while it is plentiful in another: Ridgeback can be producing flat out in the same week that Metro is pulling the last of its fast gas
        out of Hollow Creek. One connection remains. At Bayport, the region’s gas meets the rest of the world — not by pipe, but by ship. That is the subject of{' '}
        <a href={lessonHref('gas/3.5')}>the next lesson</a>.
      </P>
    </LessonPage>
  );
}
